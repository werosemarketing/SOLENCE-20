import { test, before, after, afterEach, describe } from "node:test";
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
import { openai } from "../replit_integrations/audio";

const TEST_EMAIL_PREFIX = "smart-title-test-";

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
): Promise<void> {
  await db.insert(messages).values({ conversationId, role, content });
}

async function getConversationTitle(id: number): Promise<string | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  return row?.title ?? null;
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

// Wait for a predicate to become true by polling the database. The smart
// title write is fire-and-forget after the response is sent, so we have to
// poll instead of awaiting it directly.
async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  predicate: (value: T) => boolean,
  { timeoutMs = 2000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value != null && predicate(value)) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const final = await fn();
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms. Last value: ${JSON.stringify(final)}`,
  );
}

// Build a fake gpt-audio response shaped like what the route expects.
function fakeAudioResponse(assistantTranscript: string) {
  return {
    choices: [
      {
        message: {
          audio: { transcript: assistantTranscript, data: "" },
          content: null,
        },
      },
    ],
    usage: { total_tokens: 100 },
  };
}

// Replace `openai.chat.completions.create` with a stub that dispatches by
// model. Returns a restore function. The route makes two distinct calls:
//   1. model "gpt-audio"   — the actual chat completion
//   2. model "gpt-4o-mini" — the smart title summarizer
// The handlers below let each test control both independently.
type CreateArgs = { model?: string; [k: string]: unknown };
function installOpenAiMock(handlers: {
  audio: (args: CreateArgs) => unknown;
  smartTitle: (args: CreateArgs) => unknown;
}) {
  const original = openai.chat.completions.create.bind(openai.chat.completions);
  // The OpenAI types overload `create` heavily; we deliberately shadow with
  // a permissive signature here because the route only inspects a small,
  // well-known shape of the response.
  (openai.chat.completions as unknown as { create: (args: CreateArgs) => unknown }).create = (
    args: CreateArgs,
  ) => {
    if (args.model === "gpt-audio") {
      return Promise.resolve(handlers.audio(args));
    }
    if (args.model === "gpt-4o-mini") {
      // Smart title handler is allowed to throw or reject — the route
      // catches both and falls back to the truncation title.
      try {
        const result = handlers.smartTitle(args);
        return Promise.resolve(result);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    throw new Error(`Unexpected openai model in test: ${String(args.model)}`);
  };
  return () => {
    (openai.chat.completions as unknown as { create: typeof original }).create = original;
  };
}

let server: Server;
let baseUrl: string;
let restoreOpenAi: (() => void) | null = null;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  await registerRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  if (restoreOpenAi) {
    restoreOpenAi();
    restoreOpenAi = null;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );

  for (const convId of createdConversationIds) {
    await db.delete(messages).where(eq(messages.conversationId, convId));
    await db.delete(conversations).where(eq(conversations.id, convId));
  }
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("smart conversation titles via POST /api/chat/voice", () => {
  test("first exchange in a brand-new conversation is renamed to the smart title", async () => {
    const userId = await makeUser("first-exchange");

    const SMART_TITLE = "Worried About Tomorrow's Interview";
    restoreOpenAi = installOpenAiMock({
      audio: () => fakeAudioResponse("That sounds stressful — tell me more."),
      smartTitle: () => ({
        choices: [{ message: { content: SMART_TITLE } }],
      }),
    });

    const userMessage =
      "I'm worried about my big job interview tomorrow morning";
    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(userId)}`,
      },
      body: JSON.stringify({ text: userMessage }),
    });
    assert.equal(res.status, 200, "first chat request should succeed");
    const body = (await res.json()) as { text: string };
    assert.equal(body.text, "That sounds stressful — tell me more.");

    // Find the conversation that the route created for this user.
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId));
    assert.ok(conv, "a conversation should have been created");
    createdConversationIds.push(conv.id);

    // The smart title write is fire-and-forget — wait for it to land.
    const finalTitle = await waitFor(
      () => getConversationTitle(conv.id),
      (t) => t === SMART_TITLE,
    );
    assert.equal(
      finalTitle,
      SMART_TITLE,
      "the conversation should have been renamed to the smart title",
    );
  });

  test("follow-up message in an existing conversation does NOT overwrite the title", async () => {
    const userId = await makeUser("follow-up");
    const EXISTING_TITLE = "An Existing Conversation Title";
    const convId = await makeConversation(userId, EXISTING_TITLE);
    // Seed prior history so isFirstExchange will be false on the next turn.
    await addMessage(convId, "user", "earlier user turn");
    await addMessage(convId, "assistant", "earlier assistant turn");

    let smartTitleCalled = false;
    restoreOpenAi = installOpenAiMock({
      audio: () => fakeAudioResponse("Continuing the conversation."),
      smartTitle: () => {
        smartTitleCalled = true;
        return {
          choices: [{ message: { content: "Should Not Be Used" } }],
        };
      },
    });

    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(userId)}`,
      },
      body: JSON.stringify({
        text: "another user turn",
        conversationId: convId,
      }),
    });
    assert.equal(res.status, 200);

    // Give any (incorrectly scheduled) async title work a chance to run.
    await new Promise((r) => setTimeout(r, 200));

    assert.equal(
      smartTitleCalled,
      false,
      "smart title model must NOT be called for non-first exchanges",
    );
    const titleAfter = await getConversationTitle(convId);
    assert.equal(
      titleAfter,
      EXISTING_TITLE,
      "follow-up messages must not rename the conversation",
    );
  });

  test("when smart title throws, the truncation title is kept and the chat still succeeds", async () => {
    const userId = await makeUser("throws");

    restoreOpenAi = installOpenAiMock({
      audio: () => fakeAudioResponse("I'm here to listen."),
      smartTitle: () => {
        throw new Error("simulated upstream model failure");
      },
    });

    const userMessage = "Today felt heavy and I'm not sure why";
    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(userId)}`,
      },
      body: JSON.stringify({ text: userMessage }),
    });
    assert.equal(
      res.status,
      200,
      "chat should still succeed when smart title throws",
    );

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId));
    assert.ok(conv, "a conversation should have been created");
    createdConversationIds.push(conv.id);

    // Allow the fire-and-forget background task to run (and fail).
    await new Promise((r) => setTimeout(r, 200));

    const titleAfter = await getConversationTitle(conv.id);
    assert.equal(
      titleAfter,
      userMessage,
      "title should remain the first-message truncation when smart title fails",
    );
  });

  test("when smart title returns an empty string, the truncation title is kept", async () => {
    const userId = await makeUser("empty");

    restoreOpenAi = installOpenAiMock({
      audio: () => fakeAudioResponse("Tell me more about that."),
      smartTitle: () => ({
        choices: [{ message: { content: "   " } }],
      }),
    });

    const userMessage = "I keep replaying that argument in my head";
    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(userId)}`,
      },
      body: JSON.stringify({ text: userMessage }),
    });
    assert.equal(res.status, 200);

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId));
    assert.ok(conv);
    createdConversationIds.push(conv.id);

    await new Promise((r) => setTimeout(r, 200));

    const titleAfter = await getConversationTitle(conv.id);
    assert.equal(
      titleAfter,
      userMessage,
      "title should remain the truncation when smart title is empty/whitespace",
    );
  });
});
