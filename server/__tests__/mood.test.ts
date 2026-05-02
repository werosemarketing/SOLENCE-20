import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { db } from "../db";
import { users, conversations, messages, moodEntries } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { registerRoutes } from "../routes";

const TEST_EMAIL_PREFIX = "mood-test-";

const createdUserIds: string[] = [];
const createdConversationIds: number[] = [];
const createdMoodEntryIds: number[] = [];

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

async function insertMoodEntry(
  userId: string,
  phase: "pre" | "post",
  score: number,
  createdAt: Date,
  conversationId: number | null = null,
): Promise<number> {
  const [row] = await db
    .insert(moodEntries)
    .values({ userId, phase, score, conversationId, createdAt })
    .returning();
  createdMoodEntryIds.push(row.id);
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

  // Mood entries reference conversations with ON DELETE SET NULL, so the
  // order doesn't strictly matter — but we explicitly clear in dependency
  // order in case a test failure left orphans behind.
  if (createdMoodEntryIds.length > 0) {
    await db
      .delete(moodEntries)
      .where(inArray(moodEntries.id, createdMoodEntryIds));
  }
  for (const convId of createdConversationIds) {
    // Belt-and-suspenders: any mood entries that the routes created
    // (and we therefore didn't track) are caught by user-scoped cleanup
    // below, so we only need to clear messages here.
    await db.delete(messages).where(eq(messages.conversationId, convId));
    await db.delete(conversations).where(eq(conversations.id, convId));
  }
  for (const id of createdUserIds) {
    // Sweep up any mood entries created by hitting the API during tests
    // (the route handler doesn't return ids in a way we track here).
    await db.delete(moodEntries).where(eq(moodEntries.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("POST /api/mood", () => {
  test("returns 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/api/mood`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase: "pre", score: 3 }),
    });
    assert.equal(res.status, 401);
  });

  test("rejects an invalid phase", async () => {
    const userId = await makeUser("bad-phase");
    const res = await fetch(`${baseUrl}/api/mood`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(userId)}`,
      },
      body: JSON.stringify({ phase: "during", score: 3 }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), /phase/i);
  });

  test("rejects scores outside 1-5", async () => {
    const userId = await makeUser("bad-score");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(userId)}`,
    };
    for (const bad of [0, 6, 2.5, "high", null, -1]) {
      const res = await fetch(`${baseUrl}/api/mood`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phase: "pre", score: bad }),
      });
      assert.equal(res.status, 400, `score=${JSON.stringify(bad)} should 400`);
    }
  });

  test("persists a pre-session entry without a conversationId", async () => {
    const userId = await makeUser("pre-ok");
    const res = await fetch(`${baseUrl}/api/mood`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(userId)}`,
      },
      body: JSON.stringify({ phase: "pre", score: 4 }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      entry?: { id: number; phase: string; score: number; conversationId: number | null };
    };
    assert.ok(body.entry, "entry should be returned");
    assert.equal(body.entry!.phase, "pre");
    assert.equal(body.entry!.score, 4);
    assert.equal(body.entry!.conversationId, null);

    const rows = await db
      .select()
      .from(moodEntries)
      .where(eq(moodEntries.userId, userId));
    assert.equal(rows.length, 1);
  });

  test("persists a post-session entry tied to the caller's conversation", async () => {
    const userId = await makeUser("post-ok");
    const convId = await makeConversation(userId, "post mood");
    const res = await fetch(`${baseUrl}/api/mood`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(userId)}`,
      },
      body: JSON.stringify({ phase: "post", score: 5, conversationId: convId }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      entry?: { phase: string; score: number; conversationId: number | null };
    };
    assert.equal(body.entry!.phase, "post");
    assert.equal(body.entry!.score, 5);
    assert.equal(body.entry!.conversationId, convId);
  });

  test("rejects a conversationId owned by another user", async () => {
    const ownerId = await makeUser("owner");
    const intruderId = await makeUser("intruder");
    const convId = await makeConversation(ownerId, "owner conv");
    const res = await fetch(`${baseUrl}/api/mood`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(intruderId)}`,
      },
      body: JSON.stringify({ phase: "post", score: 3, conversationId: convId }),
    });
    assert.equal(res.status, 404);
    const rows = await db
      .select()
      .from(moodEntries)
      .where(eq(moodEntries.userId, intruderId));
    assert.equal(rows.length, 0, "no mood entry should be created");
  });
});

describe("GET /api/mood", () => {
  test("returns 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/api/mood`);
    assert.equal(res.status, 401);
  });

  test("only returns the caller's entries inside the day window", async () => {
    const userA = await makeUser("window-a");
    const userB = await makeUser("window-b");

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    // Inside window
    await insertMoodEntry(userA, "pre", 3, new Date(now - 1 * dayMs));
    await insertMoodEntry(userA, "post", 4, new Date(now - 2 * dayMs));
    // Outside window (10 days ago)
    await insertMoodEntry(userA, "pre", 1, new Date(now - 10 * dayMs));
    // Different user — must NOT appear
    await insertMoodEntry(userB, "pre", 5, new Date(now - 1 * dayMs));

    const res = await fetch(`${baseUrl}/api/mood?days=7`, {
      headers: { Authorization: `Bearer ${signToken(userA)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      days: number;
      entries: Array<{ score: number; phase: string }>;
    };
    assert.equal(body.days, 7);
    assert.equal(body.entries.length, 2, "2 in-window entries for userA");
    // Newest first
    assert.equal(body.entries[0].score, 3);
    assert.equal(body.entries[1].score, 4);
  });

  test("clamps days to a max of 30", async () => {
    const userId = await makeUser("clamp");
    const res = await fetch(`${baseUrl}/api/mood?days=999`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { days: number };
    assert.equal(body.days, 30);
  });

  test("falls back to 7 days when the query is bogus", async () => {
    const userId = await makeUser("default");
    const res = await fetch(`${baseUrl}/api/mood?days=abc`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { days: number };
    assert.equal(body.days, 7);
  });
});
