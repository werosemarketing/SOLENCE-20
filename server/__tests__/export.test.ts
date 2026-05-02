import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import JSZip from "jszip";

import { db } from "../db";
import {
  users,
  conversations,
  messages,
  favorites,
  moodEntries,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { registerRoutes } from "../routes";

const TEST_EMAIL_PREFIX = "export-test-";

const createdUserIds: string[] = [];
const createdConversationIds: number[] = [];

async function makeUser(label: string): Promise<{ id: string; email: string }> {
  const email = `${TEST_EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = await bcrypt.hash("test-password", 4);
  const [row] = await db
    .insert(users)
    .values({ email, password, displayName: `Label ${label}` })
    .returning();
  createdUserIds.push(row.id);
  return { id: row.id, email: row.email };
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

async function favorite(userId: string, messageId: number): Promise<void> {
  await db.insert(favorites).values({ userId, messageId });
}

async function addMood(
  userId: string,
  phase: "pre" | "post",
  score: number,
  conversationId: number | null = null,
): Promise<void> {
  await db.insert(moodEntries).values({ userId, phase, score, conversationId });
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
    await db.delete(moodEntries).where(eq(moodEntries.userId, id));
    await db.delete(favorites).where(eq(favorites.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

async function unzip(buffer: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    out.set(name, await zip.files[name].async("string"));
  }
  return out;
}

describe("POST /api/export", () => {
  test("returns 401 when no auth header is provided", async () => {
    const res = await fetch(`${baseUrl}/api/export`, { method: "POST" });
    assert.equal(res.status, 401);
  });

  test("returns a zip with one JSON per category, scoped to the caller", async () => {
    const owner = await makeUser("owner");
    const stranger = await makeUser("stranger");

    const ownerConv = await makeConversation(owner.id, "Owner conversation");
    const ownerUserMsg = await addMessage(ownerConv, "user", "owner says hi");
    const ownerBotMsg = await addMessage(
      ownerConv,
      "assistant",
      "owner reply text",
    );
    await favorite(owner.id, ownerBotMsg);
    await addMood(owner.id, "pre", 3);
    await addMood(owner.id, "post", 4, ownerConv);

    // Stranger has data the owner must NOT see.
    const strangerConv = await makeConversation(
      stranger.id,
      "Stranger private session",
    );
    await addMessage(strangerConv, "user", "stranger user message");
    const strangerBot = await addMessage(
      strangerConv,
      "assistant",
      "stranger assistant reply",
    );
    await favorite(stranger.id, strangerBot);
    await addMood(stranger.id, "pre", 2);

    const res = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { Authorization: `Bearer ${signToken(owner.id)}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    const disposition = res.headers.get("content-disposition") ?? "";
    assert.match(disposition, /attachment; filename="solence-export-/);
    assert.match(disposition, /\.zip"$/);

    const buffer = Buffer.from(await res.arrayBuffer());
    assert.ok(buffer.length > 0, "zip body must be non-empty");

    const files = await unzip(buffer);
    for (const required of [
      "account.json",
      "preferences.json",
      "conversations.json",
      "messages.json",
      "favorites.json",
      "mood_entries.json",
      "token_usage.json",
      "README.txt",
    ]) {
      assert.ok(files.has(required), `archive should contain ${required}`);
    }

    const account = JSON.parse(files.get("account.json") as string);
    assert.equal(account.account.id, owner.id);
    assert.equal(account.account.email, owner.email);
    // Sensitive fields must never be included in the archive.
    assert.equal(
      "password" in account.account,
      false,
      "account export must not include password",
    );

    const conv = JSON.parse(files.get("conversations.json") as string);
    assert.equal(conv.count, 1);
    assert.equal(conv.conversations[0].id, ownerConv);
    assert.equal(conv.conversations[0].title, "Owner conversation");

    const msgs = JSON.parse(files.get("messages.json") as string);
    assert.equal(msgs.count, 2);
    const msgIds = msgs.messages.map((m: { id: number }) => m.id).sort();
    assert.deepEqual(msgIds, [ownerUserMsg, ownerBotMsg].sort());
    // No stranger content should ever appear in the owner's export.
    for (const m of msgs.messages as { content: string }[]) {
      assert.ok(
        !m.content.toLowerCase().includes("stranger"),
        `message "${m.content}" should not appear in owner's export`,
      );
    }

    const favs = JSON.parse(files.get("favorites.json") as string);
    assert.equal(favs.count, 1);
    assert.equal(favs.favorites[0].messageId, ownerBotMsg);

    const moods = JSON.parse(files.get("mood_entries.json") as string);
    assert.equal(moods.count, 2);

    // README must spell out that secrets are excluded.
    const readme = files.get("README.txt") as string;
    assert.match(readme, /password/i);
    // Whole archive content must not include the password hash anywhere.
    for (const [, contents] of files) {
      assert.ok(
        !contents.includes("$2"),
        "exported files must not contain a bcrypt hash",
      );
    }
  });

  test("rate-limits a second export within the cooldown window", async () => {
    const u = await makeUser("rate-limit");
    const headers = { Authorization: `Bearer ${signToken(u.id)}` };

    const first = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers,
    });
    assert.equal(first.status, 200);
    // Drain the body so the connection can close cleanly.
    await first.arrayBuffer();

    const second = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers,
    });
    assert.equal(second.status, 429);
    const retryAfter = second.headers.get("retry-after");
    assert.ok(retryAfter, "rate-limited response must include Retry-After");
    const body = (await second.json()) as { retryAfterSec?: number };
    assert.ok(
      typeof body.retryAfterSec === "number" && body.retryAfterSec > 0,
      "rate-limited response must include retryAfterSec",
    );
  });
});
