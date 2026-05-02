import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { db } from "../db";
import {
  users,
  conversations,
  messages,
  userMemories,
  USER_MEMORY_MAX_PER_USER,
  USER_MEMORY_PROMPT_MAX_ITEMS,
  USER_MEMORY_PROMPT_CHAR_BUDGET,
  USER_MEMORY_TEXT_MAX_LEN,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { registerRoutes } from "../routes";
import { openai } from "../replit_integrations/audio";

const TEST_EMAIL_PREFIX = "memory-test-";

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
let lastChatSystemPrompt: string | null = null;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  await registerRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  // Stub openai. The reflection generator asks for response_format.json_object
  // — that's our discriminator. Anything else (smart-title backfill, voice
  // chat) returns a benign generic response and records the system prompt
  // so we can assert memory injection.
  originalCreate = openai.chat.completions.create.bind(
    openai.chat.completions,
  );
  (openai.chat.completions as unknown as { create: unknown }).create = async (
    params: {
      messages?: Array<{ role: string; content: string }>;
      response_format?: { type?: string };
      modalities?: string[];
    },
  ) => {
    if (params?.response_format?.type === "json_object") {
      const payload = mockResponseQueue.shift() ?? {
        summary:
          "You shared something heavy and let yourself sit with it for a while. There was a softness in how you noticed your own feelings, even when they felt tangled. By the end you sounded a little steadier than where you started.",
        takeaway: "Letting yourself feel it is part of moving through it.",
        memories: [],
      };
      return {
        choices: [{ message: { content: JSON.stringify(payload) } }],
      };
    }
    // Voice chat path — record the system message so we can verify
    // memory injection, and return a minimal audio-message shape.
    if (Array.isArray(params?.modalities) && params.modalities.includes("audio")) {
      const sys = params.messages?.find((m) => m.role === "system");
      lastChatSystemPrompt = sys?.content ?? "";
      return {
        choices: [
          {
            message: {
              audio: { transcript: "ok", data: "" },
              content: null,
            },
          },
        ],
        usage: { total_tokens: 0 },
      };
    }
    // Smart-title backfill etc.
    return { choices: [{ message: { content: "Auto Test Title" } }] };
  };
});

after(async () => {
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

describe("Memory extraction during reflection", () => {
  test("persists memories returned by the reflection model", async () => {
    const userId = await makeUser("extract");
    const convId = await makeConversation(userId, "Extract");
    await insertMessage(convId, "user", "I just started a new job at a clinic");
    await insertMessage(
      convId,
      "assistant",
      "How is that landing for you so far?",
    );

    mockResponseQueue.push({
      summary:
        "You shared the start of a new chapter at the clinic and the swirl of feelings around it. There was honesty in how you held both the excitement and the unease. You sounded steadier by the end.",
      takeaway: "Beginnings can hold both things at once.",
      memories: [
        "Recently started a new job at a clinic.",
        "Their dog is named Pico.",
      ],
    });

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);

    // Memories are persisted after the reflection UPDATE — wait briefly
    // since the call awaits inside the route, but be defensive.
    const stored = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.userId, userId));
    assert.equal(stored.length, 2);
    const texts = stored.map((m) => m.text).sort();
    assert.deepEqual(
      texts,
      ["Recently started a new job at a clinic.", "Their dog is named Pico."].sort(),
    );
    for (const row of stored) {
      assert.equal(row.sourceConversationId, convId);
    }
  });

  test("dedupes against existing memories (case-insensitive)", async () => {
    const userId = await makeUser("dedupe");
    const convId = await makeConversation(userId, "Dedupe");
    await insertMessage(convId, "user", "Same thing again");
    await insertMessage(convId, "assistant", "Tell me");

    await db.insert(userMemories).values({
      userId,
      text: "Their dog is named Pico.",
      sourceConversationId: null,
    });

    mockResponseQueue.push({
      summary:
        "You returned to a familiar thread and let yourself sit with what comes up around it. There was care in how you turned it over. You sounded a little less alone with it by the end.",
      takeaway: "Returning is its own form of attention.",
      memories: [
        "their dog is named pico.", // duplicate, different case
        "Practices yoga most mornings.",
      ],
    });

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);

    const stored = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.userId, userId));
    assert.equal(stored.length, 2);
    const lc = stored.map((m) => m.text.toLowerCase()).sort();
    assert.deepEqual(
      lc,
      ["practices yoga most mornings.", "their dog is named pico."].sort(),
    );
  });

  test("prunes oldest when over the per-user cap", async () => {
    const userId = await makeUser("cap");
    const convId = await makeConversation(userId, "Cap");
    await insertMessage(convId, "user", "More memories");
    await insertMessage(convId, "assistant", "Sure");

    // Pre-seed up to the cap with timestamped rows so we know which
    // ones are the "oldest" and should be evicted first. We stamp
    // createdAt explicitly so the prune ordering is deterministic.
    const baseTs = Date.now() - USER_MEMORY_MAX_PER_USER * 60_000;
    for (let i = 0; i < USER_MEMORY_MAX_PER_USER; i++) {
      await db.insert(userMemories).values({
        userId,
        text: `seed memory ${i}`,
        sourceConversationId: null,
        createdAt: new Date(baseTs + i * 60_000),
      });
    }

    mockResponseQueue.push({
      summary:
        "You came back for another check-in and let yourself talk through what's been on your mind. There was a quiet steadiness in the way you kept showing up. You sounded a little more grounded by the end.",
      takeaway: "Showing up is its own quiet practice.",
      memories: ["fresh memory A", "fresh memory B"],
    });

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);

    const stored = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.userId, userId));
    assert.equal(stored.length, USER_MEMORY_MAX_PER_USER);
    const texts = stored.map((m) => m.text);
    // The two newest insertions must survive.
    assert.ok(texts.includes("fresh memory A"));
    assert.ok(texts.includes("fresh memory B"));
    // The oldest two seeds (0 and 1) must have been evicted.
    assert.ok(!texts.includes("seed memory 0"));
    assert.ok(!texts.includes("seed memory 1"));
    // A newer seed should still be present.
    assert.ok(texts.includes(`seed memory ${USER_MEMORY_MAX_PER_USER - 1}`));
  });

  test("missing/empty memories field degrades gracefully", async () => {
    const userId = await makeUser("nomem");
    const convId = await makeConversation(userId, "NoMem");
    await insertMessage(convId, "user", "Just talking");
    await insertMessage(convId, "assistant", "Go ahead");

    // Payload without a `memories` field at all.
    mockResponseQueue.push({
      summary:
        "You shared a thread of thought and let yourself follow it without rushing. There was patience in how you noticed each piece. You sounded a little lighter by the end.",
      takeaway: "Slowness can be its own kindness.",
    });

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/conversations/${convId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);

    const stored = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.userId, userId));
    assert.equal(stored.length, 0);
  });
});

describe("GET /api/memories", () => {
  test("requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/memories`);
    assert.equal(res.status, 401);
  });

  test("returns the caller's memories newest-first, scoped to the caller", async () => {
    const userA = await makeUser("listA");
    const userB = await makeUser("listB");
    await db.insert(userMemories).values([
      {
        userId: userA,
        text: "A older",
        sourceConversationId: null,
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        userId: userA,
        text: "A newer",
        sourceConversationId: null,
        createdAt: new Date(),
      },
      {
        userId: userB,
        text: "B private",
        sourceConversationId: null,
      },
    ]);

    const tokenA = signToken(userA);
    const res = await fetch(`${baseUrl}/api/memories`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      memories: Array<{ id: number; text: string }>;
    };
    const texts = data.memories.map((m) => m.text);
    assert.deepEqual(texts, ["A newer", "A older"]);
    assert.ok(!texts.includes("B private"));
  });
});

describe("DELETE /api/memories/:id", () => {
  test("requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/memories/1`, { method: "DELETE" });
    assert.equal(res.status, 401);
  });

  test("400 on invalid id", async () => {
    const userId = await makeUser("del-bad");
    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/memories/not-a-number`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400);
  });

  test("404 when the memory belongs to another user (no leak)", async () => {
    const owner = await makeUser("owner-del");
    const other = await makeUser("other-del");
    const [row] = await db
      .insert(userMemories)
      .values({ userId: owner, text: "owner only", sourceConversationId: null })
      .returning();

    const token = signToken(other);
    const res = await fetch(`${baseUrl}/api/memories/${row.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404);

    // Still present.
    const [check] = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, row.id))
      .limit(1);
    assert.ok(check);
  });

  test("removes the row when called by the owner", async () => {
    const userId = await makeUser("del-ok");
    const [row] = await db
      .insert(userMemories)
      .values({ userId, text: "to be deleted", sourceConversationId: null })
      .returning();

    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/memories/${row.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);

    const after = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, row.id))
      .limit(1);
    assert.equal(after.length, 0);
  });
});

describe("DELETE /api/memories (clear all)", () => {
  test("requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/memories`, { method: "DELETE" });
    assert.equal(res.status, 401);
  });

  test("clears only the caller's memories", async () => {
    const userA = await makeUser("clearA");
    const userB = await makeUser("clearB");
    await db.insert(userMemories).values([
      { userId: userA, text: "A1", sourceConversationId: null },
      { userId: userA, text: "A2", sourceConversationId: null },
      { userId: userB, text: "B1", sourceConversationId: null },
    ]);

    const token = signToken(userA);
    const res = await fetch(`${baseUrl}/api/memories`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; removed: number };
    assert.equal(body.ok, true);
    assert.equal(body.removed, 2);

    const aLeft = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.userId, userA));
    assert.equal(aLeft.length, 0);
    const bLeft = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.userId, userB));
    assert.equal(bLeft.length, 1);
  });
});

describe("Memory injection in /api/chat/voice system prompt", () => {
  test("injects WHAT YOU REMEMBER block when memories exist", async () => {
    const userId = await makeUser("inject");
    await db.insert(userMemories).values([
      {
        userId,
        text: "Their dog is named Pico.",
        sourceConversationId: null,
      },
      {
        userId,
        text: "Recently started a new job at a clinic.",
        sourceConversationId: null,
      },
    ]);

    lastChatSystemPrompt = null;
    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hey" }),
    });
    assert.equal(res.status, 200);

    assert.ok(lastChatSystemPrompt, "expected chat call to record system prompt");
    assert.match(lastChatSystemPrompt!, /WHAT YOU REMEMBER ABOUT THIS USER/);
    assert.match(lastChatSystemPrompt!, /Pico/);
    assert.match(lastChatSystemPrompt!, /clinic/);
  });

  test("caps the injected block by item count and char budget, keeping newest first", async () => {
    const userId = await makeUser("inject-budget");
    // Insert way more rows than the prompt cap, each near the per-item
    // length cap, so the budget logic has something to clip. We also
    // tag rows so we can tell newest from oldest by substring match.
    const filler = "x".repeat(USER_MEMORY_TEXT_MAX_LEN - 10);
    const rows = Array.from({ length: USER_MEMORY_MAX_PER_USER }, (_, i) => ({
      userId,
      text: `mem-${String(i).padStart(2, "0")}-${filler}`,
      sourceConversationId: null,
    }));
    // Insert oldest-first so the LAST insert wins as "newest" per createdAt.
    for (const row of rows) {
      await db.insert(userMemories).values(row);
    }

    lastChatSystemPrompt = null;
    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hey" }),
    });
    assert.equal(res.status, 200);
    assert.ok(lastChatSystemPrompt);

    const block = lastChatSystemPrompt!.split(
      "WHAT YOU REMEMBER ABOUT THIS USER",
    )[1];
    assert.ok(block, "expected memory block in system prompt");
    // Stop at the next system-prompt section (we know pastContext / mood /
    // language directives are appended after this with a blank line).
    const blockBody = block.split("\n\n")[0];
    const lines = blockBody
      .split("\n")
      .filter((l) => l.trim().startsWith("- "));

    assert.ok(
      lines.length <= USER_MEMORY_PROMPT_MAX_ITEMS,
      `expected at most ${USER_MEMORY_PROMPT_MAX_ITEMS} memory lines, got ${lines.length}`,
    );
    const joinedLen = lines.join("\n").length;
    assert.ok(
      joinedLen <= USER_MEMORY_PROMPT_CHAR_BUDGET,
      `expected memory block body <= ${USER_MEMORY_PROMPT_CHAR_BUDGET} chars, got ${joinedLen}`,
    );
    // Newest memory (highest index) must be present; oldest must not be.
    const newestTag = `mem-${String(USER_MEMORY_MAX_PER_USER - 1).padStart(2, "0")}`;
    const oldestTag = "mem-00";
    assert.ok(
      lines.some((l) => l.includes(newestTag)),
      "expected newest memory to be included",
    );
    assert.ok(
      lines.every((l) => !l.includes(oldestTag)),
      "expected oldest memory to be dropped by the budget",
    );
  });

  test("omits the block entirely when the user has no memories", async () => {
    const userId = await makeUser("inject-empty");

    lastChatSystemPrompt = null;
    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hey" }),
    });
    assert.equal(res.status, 200);

    assert.ok(lastChatSystemPrompt);
    assert.doesNotMatch(
      lastChatSystemPrompt!,
      /WHAT YOU REMEMBER ABOUT THIS USER/,
    );
  });
});
