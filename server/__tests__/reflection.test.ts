import { test, before, after, describe, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { db } from "../db";
import { users, conversations, messages } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { registerRoutes } from "../routes";
import { openai } from "../replit_integrations/audio";

const TEST_EMAIL_PREFIX = "reflection-test-";

const createdUserIds: string[] = [];
const createdConversationIds: number[] = [];

async function makeUser(label: string): Promise<string> {
  const email = `${TEST_EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = await bcrypt.hash("test-password", 4);
  const [row] = await db.insert(users).values({ email, password }).returning();
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

async function insertMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  await db.insert(messages).values({ conversationId, role, content });
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
let originalCreate: typeof openai.chat.completions.create;
let mockResponseQueue: Array<unknown> = [];
let mockCallCount = 0;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  await registerRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  // Stub openai.chat.completions.create so the reflection generator returns
  // canned JSON without calling out to the real API. We also smart-title
  // backfill behind the scenes — return a reasonable title shape so it
  // doesn't blow up on the conversations list.
  originalCreate = openai.chat.completions.create.bind(
    openai.chat.completions,
  );
  (openai.chat.completions as unknown as { create: unknown }).create = async (
    params: { messages?: Array<{ role: string; content: string }>; response_format?: { type?: string } },
  ) => {
    mockCallCount += 1;
    // The reflection prompt asks for json_object — that's our discriminator.
    if (params?.response_format?.type === "json_object") {
      const queued = mockResponseQueue.shift();
      const payload =
        queued ?? {
          summary:
            "You shared something heavy and let yourself sit with it for a while. There was a softness in how you noticed your own feelings, even when they felt tangled. By the end you sounded a little steadier than where you started.",
          takeaway: "Letting yourself feel it is part of moving through it.",
        };
      return {
        choices: [
          { message: { content: JSON.stringify(payload) } },
        ],
      };
    }
    // Smart-title backfill path.
    return {
      choices: [{ message: { content: "Auto Test Title" } }],
    };
  };
});

after(async () => {
  // Restore the real openai client.
  if (originalCreate) {
    (openai.chat.completions as unknown as { create: unknown }).create =
      originalCreate;
  }
  if (createdConversationIds.length > 0) {
    await db
      .delete(conversations)
      .where(inArray(conversations.id, createdConversationIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("POST /api/conversations/:id/end", () => {
  test("requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/1/end`, {
      method: "POST",
    });
    assert.equal(res.status, 401);
  });

  test("400 on invalid id", async () => {
    const userId = await makeUser("invalid-id");
    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations/abc/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400);
  });

  test("404 when conversation belongs to a different user", async () => {
    const ownerId = await makeUser("owner");
    const otherId = await makeUser("other");
    const convId = await makeConversation(ownerId, "Owner's chat");
    await insertMessage(convId, "user", "I've been feeling tired lately");
    await insertMessage(convId, "assistant", "Tell me more about that");

    const token = signToken(otherId);
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404);
  });

  test("returns null reflection when conversation has no messages", async () => {
    const userId = await makeUser("empty");
    const convId = await makeConversation(userId, "Empty");
    const token = signToken(userId);
    const callsBefore = mockCallCount;
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { reflection: unknown };
    assert.equal(data.reflection, null);
    // Should not have invoked the model.
    assert.equal(mockCallCount, callsBefore);
  });

  test("returns null reflection when only one role is present", async () => {
    const userId = await makeUser("user-only");
    const convId = await makeConversation(userId, "User only");
    await insertMessage(convId, "user", "Just talking out loud");
    const token = signToken(userId);
    const callsBefore = mockCallCount;
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { reflection: unknown };
    assert.equal(data.reflection, null);
    assert.equal(mockCallCount, callsBefore);
  });

  test("generates + persists reflection on first call, idempotent on retry", async () => {
    const userId = await makeUser("happy");
    const convId = await makeConversation(userId, "Talk");
    await insertMessage(convId, "user", "Work has been overwhelming this week");
    await insertMessage(
      convId,
      "assistant",
      "That sounds heavy — what part has weighed the most?",
    );
    await insertMessage(
      convId,
      "user",
      "It's the meetings — back to back with no time to think",
    );

    mockResponseQueue.push({
      summary:
        "You named that the volume of meetings has left no room to think, and that the week has felt heavy because of it. There was a quiet honesty in how you put words to that pressure. You sounded a little less alone with it by the end.",
      takeaway: "Naming the weight is the first softening of it.",
    });

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      conversationId: number;
      reflection: { summary: string; takeaway: string; generatedAt: string };
    };
    assert.equal(data.conversationId, convId);
    assert.ok(data.reflection);
    assert.match(data.reflection.summary, /quiet honesty/);
    assert.match(data.reflection.takeaway, /Naming the weight/);
    assert.ok(data.reflection.generatedAt);

    // Verify it persisted on the row.
    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId))
      .limit(1);
    assert.equal(row.reflectionSummary, data.reflection.summary);
    assert.equal(row.reflectionTakeaway, data.reflection.takeaway);
    assert.ok(row.reflectionGeneratedAt);

    // Re-call should NOT invoke the model again — idempotent.
    const callsBefore = mockCallCount;
    const res2 = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res2.status, 200);
    const data2 = (await res2.json()) as {
      reflection: { summary: string; takeaway: string };
    };
    assert.equal(data2.reflection.summary, data.reflection.summary);
    assert.equal(data2.reflection.takeaway, data.reflection.takeaway);
    assert.equal(mockCallCount, callsBefore);
  });

  test("clamps absurdly long model output", async () => {
    const userId = await makeUser("longwind");
    const convId = await makeConversation(userId, "Long");
    await insertMessage(convId, "user", "Tell me");
    await insertMessage(convId, "assistant", "Telling you");

    const longSummary = "x ".repeat(800).trim();
    const longTakeaway = "y ".repeat(200).trim();
    mockResponseQueue.push({
      summary: longSummary,
      takeaway: longTakeaway,
    });

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      reflection: { summary: string; takeaway: string };
    };
    assert.ok(data.reflection.summary.length <= 700);
    assert.ok(data.reflection.takeaway.length <= 160);
  });
});

describe("GET /api/conversations enrichment", () => {
  test("includes reflection fields on each row", async () => {
    const userId = await makeUser("enrich");
    const convId = await makeConversation(userId, "Enriched");
    await insertMessage(convId, "user", "hey");
    await insertMessage(convId, "assistant", "hi");
    await db
      .update(conversations)
      .set({
        reflectionSummary: "A short reflection on what came up.",
        reflectionTakeaway: "You showed up here, that counts.",
        reflectionGeneratedAt: new Date(),
      })
      .where(eq(conversations.id, convId));

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations?limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      conversations: Array<{
        id: number;
        reflectionSummary: string | null;
        reflectionTakeaway: string | null;
        reflectionGeneratedAt: string | null;
      }>;
    };
    const row = data.conversations.find((c) => c.id === convId);
    assert.ok(row);
    assert.equal(row.reflectionSummary, "A short reflection on what came up.");
    assert.equal(row.reflectionTakeaway, "You showed up here, that counts.");
    assert.ok(row.reflectionGeneratedAt);
  });
});

describe("GET /api/conversations reflection backfill", () => {
  test("generates reflection in background for stale, summary-less conversations", async () => {
    const userId = await makeUser("backfill");
    const convId = await makeConversation(userId, "Stale chat");
    await insertMessage(convId, "user", "I keep replaying yesterday in my head");
    await insertMessage(
      convId,
      "assistant",
      "What part of yesterday is staying with you?",
    );

    // Force the messages to look "stale" (older than the 15-minute
    // inactivity cutoff) so the backfill considers this conversation
    // ended-by-walking-away.
    const oldTs = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    await db
      .update(messages)
      .set({ createdAt: oldTs })
      .where(eq(messages.conversationId, convId));

    mockResponseQueue.push({
      summary:
        "You came back to a thought from yesterday and let yourself sit with it. There was care in the way you turned it over rather than pushing it away. By the end you sounded a little less stuck inside it.",
      takeaway: "Returning to a thought is its own form of tending to it.",
    });

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations?limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);

    // The backfill is fire-and-forget; poll briefly for the row to
    // gain a reflection (bounded so a real failure still surfaces).
    let persisted: typeof conversations.$inferSelect | undefined;
    for (let i = 0; i < 40; i++) {
      const [row] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, convId))
        .limit(1);
      if (row?.reflectionSummary) {
        persisted = row;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(persisted, "expected backfill to persist a reflection");
    assert.match(persisted!.reflectionSummary!, /turned it over/);
    assert.match(persisted!.reflectionTakeaway!, /Returning to a thought/);
    assert.ok(persisted!.reflectionGeneratedAt);
  });

  test("does NOT generate reflection for active (recent) conversations", async () => {
    const userId = await makeUser("active");
    const convId = await makeConversation(userId, "Active chat");
    // Recent messages — well within the inactivity window.
    await insertMessage(convId, "user", "still typing");
    await insertMessage(convId, "assistant", "take your time");

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations?limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);

    // Give any fire-and-forget work a moment to misbehave, then verify
    // the conversation is still summary-less.
    await new Promise((r) => setTimeout(r, 300));
    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId))
      .limit(1);
    assert.equal(row.reflectionSummary, null);
    assert.equal(row.reflectionTakeaway, null);
    assert.equal(row.reflectionGeneratedAt, null);
  });
});

describe("GET /api/conversations/:id/messages enrichment", () => {
  test("includes reflection fields on the conversation object", async () => {
    const userId = await makeUser("detail");
    const convId = await makeConversation(userId, "Detail");
    await insertMessage(convId, "user", "ok");
    await insertMessage(convId, "assistant", "okay");
    await db
      .update(conversations)
      .set({
        reflectionSummary: "Detail summary text.",
        reflectionTakeaway: "Detail takeaway.",
        reflectionGeneratedAt: new Date(),
      })
      .where(eq(conversations.id, convId));

    const token = signToken(userId);
    const res = await fetch(
      `${baseUrl}/api/conversations/${convId}/messages`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json()) as {
      conversation: {
        id: number;
        reflectionSummary: string | null;
        reflectionTakeaway: string | null;
        reflectionGeneratedAt: string | null;
      };
    };
    assert.equal(data.conversation.reflectionSummary, "Detail summary text.");
    assert.equal(data.conversation.reflectionTakeaway, "Detail takeaway.");
    assert.ok(data.conversation.reflectionGeneratedAt);
  });
});
