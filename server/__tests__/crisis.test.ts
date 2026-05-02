import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { db } from "../db";
import { users, conversations, messages } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { detectCrisisSignal, registerRoutes } from "../routes";
import { openai } from "../replit_integrations/audio";

const TEST_EMAIL_PREFIX = "crisis-test-";

const createdUserIds: string[] = [];
const createdConversationIds: number[] = [];

async function makeUser(label: string): Promise<string> {
  const email = `${TEST_EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = await bcrypt.hash("test-password", 4);
  const [row] = await db.insert(users).values({ email, password }).returning();
  createdUserIds.push(row.id);
  return row.id;
}

function signToken(userId: string): string {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set for tests");
  }
  return jwt.sign({ userId, email: "test@example.com" }, process.env.SESSION_SECRET, {
    expiresIn: "1h",
  });
}

let server: Server;
let baseUrl: string;
let originalCreate: typeof openai.chat.completions.create;

// Track per-test classifier behavior. Keys are normalized substrings of the
// user prompt; the value is what the classifier should return ("yes"/"no").
// Anything that doesn't match falls back to a default ("no") so we never
// accidentally let the live OpenAI API get hit during tests.
const classifierResponses = new Map<string, "yes" | "no">();
let classifierDefault: "yes" | "no" | "throw" = "no";
let classifierCallCount = 0;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  await registerRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  originalCreate = openai.chat.completions.create.bind(openai.chat.completions);

  // Stub openai for both: (1) the crisis classifier (max_tokens: 1), and
  // (2) the chat reply path. The chat reply path returns a canned
  // assistant transcript so the /api/chat/voice endpoint can complete
  // without hitting the network.
  (openai.chat.completions as unknown as { create: unknown }).create = async (
    params: {
      model?: string;
      max_tokens?: number;
      messages?: Array<{ role: string; content: string }>;
      modalities?: string[];
      response_format?: { type?: string };
    },
  ) => {
    // Classifier path — single-token yes/no.
    if (params?.max_tokens === 1) {
      classifierCallCount += 1;
      const userMsg =
        params.messages?.find((m) => m.role === "user")?.content?.toLowerCase() ?? "";
      let answer: "yes" | "no" = classifierDefault === "yes" ? "yes" : "no";
      for (const [needle, reply] of classifierResponses.entries()) {
        if (userMsg.includes(needle.toLowerCase())) {
          answer = reply;
          break;
        }
      }
      if (classifierDefault === "throw") {
        throw new Error("classifier failure (test)");
      }
      return {
        choices: [{ message: { content: answer } }],
      };
    }
    // Voice chat reply path.
    if (params?.modalities && params.modalities.includes("audio")) {
      return {
        choices: [
          {
            message: {
              audio: { transcript: "I'm here with you.", data: "" },
              content: "I'm here with you.",
            },
          },
        ],
        usage: { total_tokens: 50 },
      };
    }
    // Smart-title backfill / reflection generator paths — return harmless
    // placeholders so they never throw if they get triggered.
    if (params?.response_format?.type === "json_object") {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "test",
                takeaway: "test",
              }),
            },
          },
        ],
      };
    }
    return {
      choices: [{ message: { content: "Test Title" } }],
    };
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

describe("detectCrisisSignal()", () => {
  test("flags explicit suicidal language via the keyword shortlist", async () => {
    classifierResponses.clear();
    classifierDefault = "no";
    const callsBefore = classifierCallCount;

    assert.equal(await detectCrisisSignal("I want to kill myself."), true);
    assert.equal(await detectCrisisSignal("I just want to die"), true);
    assert.equal(
      await detectCrisisSignal("I've been thinking about suicide"),
      true,
    );
    assert.equal(
      await detectCrisisSignal("I'm going to end my life tonight"),
      true,
    );
    assert.equal(
      await detectCrisisSignal("Sometimes I hurt myself when it gets bad"),
      true,
    );

    // Keyword path must NOT consult the LLM classifier.
    assert.equal(classifierCallCount, callsBefore);
  });

  test("does not flag general low mood / sadness / anxiety", async () => {
    classifierResponses.clear();
    classifierDefault = "no";

    assert.equal(await detectCrisisSignal("I'm feeling really anxious today"), false);
    assert.equal(await detectCrisisSignal("Work has been so stressful"), false);
    assert.equal(await detectCrisisSignal("I'm just sad lately"), false);
    assert.equal(await detectCrisisSignal(""), false);
    assert.equal(await detectCrisisSignal("   "), false);
  });

  test("uses the LLM classifier for borderline phrasing", async () => {
    classifierResponses.clear();
    // Borderline indicator "give up" — the classifier decides.
    classifierResponses.set("give up", "yes");
    classifierDefault = "no";
    const before = classifierCallCount;

    const result = await detectCrisisSignal(
      "I just want to give up. I don't see the point.",
    );
    assert.equal(result, true);
    // The classifier must have been consulted exactly once for this call.
    assert.equal(classifierCallCount, before + 1);
  });

  test("borderline phrasing the classifier rejects stays unflagged", async () => {
    classifierResponses.clear();
    classifierDefault = "no";

    const result = await detectCrisisSignal(
      "I'm so hopeless about my career right now",
    );
    assert.equal(result, false);
  });

  test("classifier errors default to false (never blocks the chat)", async () => {
    classifierResponses.clear();
    classifierDefault = "throw";

    const result = await detectCrisisSignal(
      "Honestly I just want to give up on everything",
    );
    assert.equal(result, false);

    classifierDefault = "no";
  });
});

describe("POST /api/chat/voice — crisis flag plumbing", () => {
  test("returns crisisSupport: true and persists it on the assistant message", async () => {
    classifierResponses.clear();
    classifierDefault = "no";

    const userId = await makeUser("voice-flag");
    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: "Honestly I want to kill myself" }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      crisisSupport: boolean;
      conversationId: number;
    };
    assert.equal(data.crisisSupport, true);
    assert.ok(Number.isFinite(data.conversationId));
    createdConversationIds.push(data.conversationId);

    // The assistant row should be persisted with crisis_support = true.
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, data.conversationId));
    const assistantRow = rows.find((r) => r.role === "assistant");
    assert.ok(assistantRow, "expected an assistant message row to exist");
    assert.equal(assistantRow.crisisSupport, true);
  });

  test("returns crisisSupport: false on innocuous text", async () => {
    classifierResponses.clear();
    classifierDefault = "no";

    const userId = await makeUser("voice-noflag");
    const token = signToken(userId);
    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: "I just had a great walk in the park today" }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      crisisSupport: boolean;
      conversationId: number;
    };
    assert.equal(data.crisisSupport, false);
    createdConversationIds.push(data.conversationId);

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, data.conversationId));
    const assistantRow = rows.find((r) => r.role === "assistant");
    assert.ok(assistantRow);
    assert.equal(assistantRow.crisisSupport, false);
  });
});

describe("GET /api/conversations/:id/messages — crisis flag exposure", () => {
  test("includes crisisSupport on each message row", async () => {
    classifierResponses.clear();
    classifierDefault = "no";

    const userId = await makeUser("messages-flag");
    const token = signToken(userId);

    // First, generate a flagged exchange via the live endpoint.
    const postRes = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: "I keep thinking about suicide" }),
    });
    const postData = (await postRes.json()) as { conversationId: number };
    createdConversationIds.push(postData.conversationId);

    const getRes = await fetch(
      `${baseUrl}/api/conversations/${postData.conversationId}/messages`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(getRes.status, 200);
    const getData = (await getRes.json()) as {
      messages: Array<{ role: string; content: string; crisisSupport: boolean }>;
    };
    assert.ok(getData.messages.length >= 2);
    for (const m of getData.messages) {
      assert.equal(typeof m.crisisSupport, "boolean");
    }
    const assistantMessage = getData.messages.find((m) => m.role === "assistant");
    assert.ok(assistantMessage);
    assert.equal(assistantMessage.crisisSupport, true);
  });
});
