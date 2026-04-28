import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { db } from "../db";
import { users, conversations, messages } from "@shared/schema";
import { eq } from "drizzle-orm";
import { registerRoutes } from "../routes";

const TEST_EMAIL_PREFIX = "conversations-test-";

const createdUserIds: string[] = [];
const createdConversationIds: number[] = [];

async function makeUser(label: string): Promise<string> {
  const email = `${TEST_EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = await bcrypt.hash("test-password", 4);
  const [row] = await db
    .insert(users)
    .values({ email, password })
    .returning();
  createdUserIds.push(row.id);
  return row.id;
}

async function makeConversation(userId: string, title: string): Promise<number> {
  const [row] = await db
    .insert(conversations)
    .values({ userId, title })
    .returning();
  createdConversationIds.push(row.id);
  return row.id;
}

async function addMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
): Promise<number> {
  const [row] = await db
    .insert(messages)
    .values({ conversationId, role, content })
    .returning();
  return row.id;
}

function signToken(userId: string): string {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set for tests");
  }
  return jwt.sign(
    { userId, email: "test@example.com" },
    process.env.SESSION_SECRET,
    { expiresIn: "1h" },
  );
}

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  await registerRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );

  // Clean up any rows we created. Conversations cascade-delete their messages,
  // but defensively delete messages first in case the cascade test failed.
  for (const convId of createdConversationIds) {
    await db.delete(messages).where(eq(messages.conversationId, convId));
    await db.delete(conversations).where(eq(conversations.id, convId));
  }
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("GET /api/conversations", () => {
  test("returns 401 when no auth header is provided", async () => {
    const res = await fetch(`${baseUrl}/api/conversations`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Authentication required");
  });

  test("returns 401 when the bearer token is invalid", async () => {
    const res = await fetch(`${baseUrl}/api/conversations`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Invalid or expired token");
  });

  test("only returns conversations belonging to the authenticated user", async () => {
    const userA = await makeUser("list-a");
    const userB = await makeUser("list-b");

    const convA1 = await makeConversation(userA, "A's first chat");
    const convA2 = await makeConversation(userA, "A's second chat");
    const convB1 = await makeConversation(userB, "B's only chat");

    // Give each conversation a message so the list endpoint exercises its
    // last-message lookup path.
    await addMessage(convA1, "user", "hello from A1");
    await addMessage(convA2, "user", "hello from A2");
    await addMessage(convB1, "user", "hello from B1");

    const res = await fetch(`${baseUrl}/api/conversations`, {
      headers: { Authorization: `Bearer ${signToken(userA)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      conversations: Array<{ id: number; title: string }>;
    };
    const ids = body.conversations.map((c) => c.id);
    assert.ok(ids.includes(convA1), "user A should see their first conversation");
    assert.ok(ids.includes(convA2), "user A should see their second conversation");
    assert.ok(
      !ids.includes(convB1),
      "user A must not see user B's conversations",
    );
  });
});

describe("GET /api/conversations/:id/messages", () => {
  test("returns 401 when no auth header is provided", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/1/messages`);
    assert.equal(res.status, 401);
  });

  test("returns the conversation and its messages for the owner", async () => {
    const userId = await makeUser("get-owner");
    const convId = await makeConversation(userId, "owned chat");
    await addMessage(convId, "user", "first");
    await addMessage(convId, "assistant", "second");

    const res = await fetch(
      `${baseUrl}/api/conversations/${convId}/messages`,
      { headers: { Authorization: `Bearer ${signToken(userId)}` } },
    );
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      conversation: { id: number; title: string };
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.conversation.id, convId);
    assert.equal(body.conversation.title, "owned chat");
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].content, "first");
    assert.equal(body.messages[1].content, "second");
  });

  test("returns 404 when the conversation belongs to a different user", async () => {
    const owner = await makeUser("get-owner-2");
    const intruder = await makeUser("get-intruder");
    const convId = await makeConversation(owner, "private chat");
    await addMessage(convId, "user", "secret content");

    const res = await fetch(
      `${baseUrl}/api/conversations/${convId}/messages`,
      { headers: { Authorization: `Bearer ${signToken(intruder)}` } },
    );
    assert.equal(
      res.status,
      404,
      "must not leak another user's conversation as 200/403",
    );
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Conversation not found");
  });

  test("returns 400 for a non-numeric conversation id", async () => {
    const userId = await makeUser("get-bad-id");
    const res = await fetch(
      `${baseUrl}/api/conversations/not-a-number/messages`,
      { headers: { Authorization: `Bearer ${signToken(userId)}` } },
    );
    assert.equal(res.status, 400);
  });
});

describe("DELETE /api/conversations/:id", () => {
  test("returns 401 when no auth header is provided", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/1`, {
      method: "DELETE",
    });
    assert.equal(res.status, 401);
  });

  test("returns 404 when the conversation belongs to a different user and leaves it intact", async () => {
    const owner = await makeUser("del-owner");
    const intruder = await makeUser("del-intruder");
    const convId = await makeConversation(owner, "do not delete me");
    await addMessage(convId, "user", "still here");

    const res = await fetch(`${baseUrl}/api/conversations/${convId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${signToken(intruder)}` },
    });
    assert.equal(res.status, 404);

    // Confirm the conversation and its message were NOT deleted.
    const stillThere = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId));
    assert.equal(
      stillThere.length,
      1,
      "another user's DELETE must not remove the conversation",
    );

    const remainingMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId));
    assert.equal(remainingMessages.length, 1);
  });

  test("deletes the conversation and cascades to its messages for the owner", async () => {
    const userId = await makeUser("del-cascade");
    const convId = await makeConversation(userId, "to be deleted");
    await addMessage(convId, "user", "msg 1");
    await addMessage(convId, "assistant", "msg 2");
    await addMessage(convId, "user", "msg 3");

    // Sanity check: messages exist before deletion.
    const before = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId));
    assert.equal(before.length, 3);

    const res = await fetch(`${baseUrl}/api/conversations/${convId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; id: number };
    assert.equal(body.success, true);
    assert.equal(body.id, convId);

    // Conversation is gone.
    const convAfter = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId));
    assert.equal(convAfter.length, 0);

    // Messages are gone too — this is the FK cascade in shared/schema.ts.
    const msgsAfter = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId));
    assert.equal(
      msgsAfter.length,
      0,
      "deleting a conversation must cascade-delete all its messages",
    );
  });

  test("returns 400 for a non-numeric conversation id", async () => {
    const userId = await makeUser("del-bad-id");
    const res = await fetch(`${baseUrl}/api/conversations/not-a-number`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    assert.equal(res.status, 400);
  });
});
