import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { db } from "../db";
import { users, conversations, messages, favorites } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { registerRoutes } from "../routes";

const TEST_EMAIL_PREFIX = "favorites-test-";

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

  // Conversations cascade-delete messages, and messages cascade-delete
  // favorites — but we explicitly clear in dependency order in case a
  // test failure left orphans behind.
  for (const convId of createdConversationIds) {
    const msgs = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, convId));
    if (msgs.length > 0) {
      await db
        .delete(favorites)
        .where(
          inArray(
            favorites.messageId,
            msgs.map((m) => m.id),
          ),
        );
    }
    await db.delete(messages).where(eq(messages.conversationId, convId));
    await db.delete(conversations).where(eq(conversations.id, convId));
  }
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("POST /api/messages/:id/favorite", () => {
  test("returns 401 when no auth header is provided", async () => {
    const res = await fetch(`${baseUrl}/api/messages/1/favorite`, {
      method: "POST",
    });
    assert.equal(res.status, 401);
  });

  test("favorites a message owned by the caller and is idempotent", async () => {
    const userId = await makeUser("fav-owner");
    const convId = await makeConversation(userId, "owned");
    const msgId = await addMessage(convId, "assistant", "save me");

    const headers = { Authorization: `Bearer ${signToken(userId)}` };

    // First favorite: succeeds.
    const res1 = await fetch(
      `${baseUrl}/api/messages/${msgId}/favorite`,
      { method: "POST", headers },
    );
    assert.equal(res1.status, 200);
    const body1 = (await res1.json()) as { isFavorite: boolean };
    assert.equal(body1.isFavorite, true);

    // Second favorite of the same message: still 200, only one row total.
    const res2 = await fetch(
      `${baseUrl}/api/messages/${msgId}/favorite`,
      { method: "POST", headers },
    );
    assert.equal(res2.status, 200);

    const rows = await db
      .select()
      .from(favorites)
      .where(eq(favorites.messageId, msgId));
    assert.equal(
      rows.length,
      1,
      "favoriting the same message twice must not create duplicate rows",
    );
  });

  test("returns 404 when the message belongs to a different user", async () => {
    const owner = await makeUser("fav-owner-2");
    const intruder = await makeUser("fav-intruder");
    const convId = await makeConversation(owner, "private");
    const msgId = await addMessage(convId, "assistant", "not yours");

    const res = await fetch(
      `${baseUrl}/api/messages/${msgId}/favorite`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${signToken(intruder)}` },
      },
    );
    assert.equal(res.status, 404);

    const rows = await db
      .select()
      .from(favorites)
      .where(eq(favorites.messageId, msgId));
    assert.equal(
      rows.length,
      0,
      "intruder must not be able to create a favorite on someone else's message",
    );
  });

  test("rejects favoriting a user message with 400 (assistant-only)", async () => {
    const userId = await makeUser("fav-user-msg");
    const convId = await makeConversation(userId, "user message");
    const msgId = await addMessage(convId, "user", "I said this");

    const res = await fetch(
      `${baseUrl}/api/messages/${msgId}/favorite`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${signToken(userId)}` },
      },
    );
    assert.equal(res.status, 400);

    const rows = await db
      .select()
      .from(favorites)
      .where(eq(favorites.messageId, msgId));
    assert.equal(
      rows.length,
      0,
      "user-role messages must not be insertable into favorites",
    );
  });

  test("returns 400 for a non-numeric message id", async () => {
    const userId = await makeUser("fav-bad-id");
    const res = await fetch(
      `${baseUrl}/api/messages/not-a-number/favorite`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${signToken(userId)}` },
      },
    );
    assert.equal(res.status, 400);
  });
});

describe("DELETE /api/messages/:id/favorite", () => {
  test("removes an existing favorite for the owner", async () => {
    const userId = await makeUser("unfav-owner");
    const convId = await makeConversation(userId, "owned");
    const msgId = await addMessage(convId, "assistant", "for now");

    const headers = { Authorization: `Bearer ${signToken(userId)}` };
    await fetch(`${baseUrl}/api/messages/${msgId}/favorite`, {
      method: "POST",
      headers,
    });

    const res = await fetch(`${baseUrl}/api/messages/${msgId}/favorite`, {
      method: "DELETE",
      headers,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { isFavorite: boolean };
    assert.equal(body.isFavorite, false);

    const rows = await db
      .select()
      .from(favorites)
      .where(eq(favorites.messageId, msgId));
    assert.equal(rows.length, 0);
  });

  test("is idempotent — unfavoriting a message that isn't favorited still returns 200", async () => {
    const userId = await makeUser("unfav-noop");
    const convId = await makeConversation(userId, "owned");
    const msgId = await addMessage(convId, "assistant", "never saved");

    const res = await fetch(`${baseUrl}/api/messages/${msgId}/favorite`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    assert.equal(res.status, 200);
  });

  test("returns 404 when the message belongs to a different user, leaving any existing favorite intact", async () => {
    const owner = await makeUser("unfav-owner-2");
    const intruder = await makeUser("unfav-intruder");
    const convId = await makeConversation(owner, "private");
    const msgId = await addMessage(convId, "assistant", "not yours");

    // Owner favorites their own message first.
    await fetch(`${baseUrl}/api/messages/${msgId}/favorite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${signToken(owner)}` },
    });

    const res = await fetch(`${baseUrl}/api/messages/${msgId}/favorite`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${signToken(intruder)}` },
    });
    assert.equal(res.status, 404);

    const rows = await db
      .select()
      .from(favorites)
      .where(eq(favorites.messageId, msgId));
    assert.equal(
      rows.length,
      1,
      "another user's DELETE must not remove the owner's favorite",
    );
  });
});

describe("GET /api/favorites", () => {
  test("returns 401 when no auth header is provided", async () => {
    const res = await fetch(`${baseUrl}/api/favorites`);
    assert.equal(res.status, 401);
  });

  test("returns only the caller's favorites, enriched with message + conversation context, newest first", async () => {
    const userA = await makeUser("list-a");
    const userB = await makeUser("list-b");

    const convA = await makeConversation(userA, "A's chat");
    const convB = await makeConversation(userB, "B's chat");

    const msgA1 = await addMessage(convA, "assistant", "first A reply");
    const msgA2 = await addMessage(convA, "assistant", "second A reply");
    const msgB1 = await addMessage(convB, "assistant", "B's reply");

    // Favorite in order so the most-recent ordering is well-defined.
    await fetch(`${baseUrl}/api/messages/${msgA1}/favorite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${signToken(userA)}` },
    });
    await fetch(`${baseUrl}/api/messages/${msgA2}/favorite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${signToken(userA)}` },
    });
    await fetch(`${baseUrl}/api/messages/${msgB1}/favorite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${signToken(userB)}` },
    });

    const res = await fetch(`${baseUrl}/api/favorites`, {
      headers: { Authorization: `Bearer ${signToken(userA)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      favorites: Array<{
        messageId: number;
        message: { content: string; role: string };
        conversation: { id: number; title: string };
      }>;
    };

    const ids = body.favorites.map((f) => f.messageId);
    assert.ok(
      !ids.includes(msgB1),
      "user A must not see user B's favorites",
    );
    assert.equal(ids.length, 2);
    // Newest favorite first — msgA2 was favorited after msgA1.
    assert.equal(ids[0], msgA2);
    assert.equal(ids[1], msgA1);

    // Each entry should carry enough context to render the saved-moments
    // card without an extra round-trip.
    const top = body.favorites[0];
    assert.equal(top.message.content, "second A reply");
    assert.equal(top.message.role, "assistant");
    assert.equal(top.conversation.id, convA);
    assert.equal(top.conversation.title, "A's chat");
  });

  test("respects the limit query param (clamped to 1..50)", async () => {
    const userId = await makeUser("list-limit");
    const convId = await makeConversation(userId, "many");
    const msgIds: number[] = [];
    for (let i = 0; i < 4; i++) {
      msgIds.push(await addMessage(convId, "assistant", `msg ${i}`));
    }
    const headers = { Authorization: `Bearer ${signToken(userId)}` };
    for (const id of msgIds) {
      await fetch(`${baseUrl}/api/messages/${id}/favorite`, {
        method: "POST",
        headers,
      });
    }

    const res = await fetch(`${baseUrl}/api/favorites?limit=2`, { headers });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { favorites: unknown[] };
    assert.equal(body.favorites.length, 2);
  });
});

describe("GET /api/conversations/:id/messages — favorite enrichment", () => {
  test("includes isFavorite per message for the caller", async () => {
    const userId = await makeUser("enrich-owner");
    const convId = await makeConversation(userId, "with favorites");
    const m1 = await addMessage(convId, "user", "hi");
    const m2 = await addMessage(convId, "assistant", "hello back");
    const m3 = await addMessage(convId, "assistant", "another reply");

    const headers = { Authorization: `Bearer ${signToken(userId)}` };
    await fetch(`${baseUrl}/api/messages/${m2}/favorite`, {
      method: "POST",
      headers,
    });

    const res = await fetch(
      `${baseUrl}/api/conversations/${convId}/messages`,
      { headers },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      messages: Array<{ id: number; isFavorite: boolean }>;
    };
    const byId = new Map(body.messages.map((m) => [m.id, m.isFavorite]));
    assert.equal(byId.get(m1), false);
    assert.equal(byId.get(m2), true);
    assert.equal(byId.get(m3), false);
  });

  test("isFavorite is per-user — another user's favorite does not leak", async () => {
    const owner = await makeUser("enrich-owner-2");
    const other = await makeUser("enrich-other");
    const convId = await makeConversation(owner, "shared id only");
    const msgId = await addMessage(convId, "assistant", "scoped");

    // Owner favorites it.
    await fetch(`${baseUrl}/api/messages/${msgId}/favorite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${signToken(owner)}` },
    });

    // The other user can't even read this conversation, so we just
    // verify the messages list for the owner reports it as favorited.
    const res = await fetch(
      `${baseUrl}/api/conversations/${convId}/messages`,
      { headers: { Authorization: `Bearer ${signToken(owner)}` } },
    );
    const body = (await res.json()) as {
      messages: Array<{ id: number; isFavorite: boolean }>;
    };
    assert.equal(body.messages[0].isFavorite, true);

    // And confirm the favorite is keyed to the owner, not the other user.
    const otherFavRows = await db
      .select()
      .from(favorites)
      .where(eq(favorites.userId, other));
    assert.equal(otherFavRows.length, 0);
  });
});
