import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { db } from "../db";
import { users, tokenUsage, FREE_TOKEN_LIMIT } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  tryReserveTokens,
  recordTokens,
  getCurrentPeriodStart,
  MIN_TOKENS_FOR_REQUEST,
} from "../tokens";
import { registerRoutes } from "../routes";

const TEST_EMAIL_PREFIX = "tokens-test-";

async function createTestUser(label: string): Promise<string> {
  const email = `${TEST_EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = await bcrypt.hash("test-password", 4);
  const [row] = await db
    .insert(users)
    .values({ email, password })
    .returning();
  return row.id;
}

async function clearUserUsage(userId: string): Promise<void> {
  await db.delete(tokenUsage).where(eq(tokenUsage.userId, userId));
}

async function sumTokens(userId: string, periodStart?: Date): Promise<number> {
  const condition = periodStart
    ? and(eq(tokenUsage.userId, userId), eq(tokenUsage.periodStart, periodStart))
    : eq(tokenUsage.userId, userId);
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${tokenUsage.tokensUsed}), 0)::int` })
    .from(tokenUsage)
    .where(condition);
  return result[0]?.total ?? 0;
}

const createdUserIds: string[] = [];

async function makeUser(label: string): Promise<string> {
  const id = await createTestUser(label);
  createdUserIds.push(id);
  return id;
}

after(async () => {
  if (createdUserIds.length > 0) {
    for (const id of createdUserIds) {
      await db.delete(tokenUsage).where(eq(tokenUsage.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
});

describe("tryReserveTokens", () => {
  test("never exceeds the daily cap under concurrent calls for the same user", async () => {
    const userId = await makeUser("concurrent");
    await clearUserUsage(userId);

    // Each reservation is 1500 tokens. With FREE_TOKEN_LIMIT=15000, only
    // 10 can succeed. We fire 30 concurrent attempts and verify the cap
    // is honored exactly.
    const reservationSize = 1500;
    const totalAttempts = 30;
    const expectedMaxSuccess = Math.floor(FREE_TOKEN_LIMIT / reservationSize);

    const results = await Promise.all(
      Array.from({ length: totalAttempts }, () =>
        tryReserveTokens(userId, reservationSize),
      ),
    );

    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    assert.equal(
      successes.length,
      expectedMaxSuccess,
      `expected exactly ${expectedMaxSuccess} successful reservations, got ${successes.length}`,
    );
    assert.equal(
      failures.length,
      totalAttempts - expectedMaxSuccess,
      "remaining attempts should fail",
    );

    const total = await sumTokens(userId);
    assert.ok(
      total <= FREE_TOKEN_LIMIT,
      `total tokens reserved (${total}) must not exceed cap (${FREE_TOKEN_LIMIT})`,
    );
    assert.equal(total, expectedMaxSuccess * reservationSize);
  });

  test("rejects with current usage when the cap is already reached", async () => {
    const userId = await makeUser("at-cap");
    await clearUserUsage(userId);

    // Pre-fill exactly to the cap.
    await recordTokens(userId, FREE_TOKEN_LIMIT);

    const result = await tryReserveTokens(userId, MIN_TOKENS_FOR_REQUEST);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.tokensUsed, FREE_TOKEN_LIMIT);
    }
  });
});

describe("STT-failure refund flow", () => {
  test("refund is credited against the original day's periodStart even when 'today' has moved on", async () => {
    const userId = await makeUser("refund");
    await clearUserUsage(userId);

    // Simulate a reservation that happened "yesterday" (before midnight).
    // The route captures `reservation.periodStart` and reuses it for the
    // refund so the credit lands on the original day, not the new one.
    const yesterday = new Date(getCurrentPeriodStart().getTime() - 24 * 60 * 60 * 1000);
    await db.insert(tokenUsage).values({
      userId,
      tokensUsed: MIN_TOKENS_FOR_REQUEST,
      periodStart: yesterday,
    });

    // STT fails — apply the refund pinned to the captured periodStart.
    await recordTokens(userId, -MIN_TOKENS_FOR_REQUEST, yesterday);

    const yesterdayTotal = await sumTokens(userId, yesterday);
    const todayTotal = await sumTokens(userId, getCurrentPeriodStart());

    assert.equal(
      yesterdayTotal,
      0,
      "the refund must zero out yesterday's bucket, not bleed into today",
    );
    assert.equal(
      todayTotal,
      0,
      "today's bucket must not be touched by a refund pinned to yesterday",
    );

    // Confirm the negative row physically exists with the correct periodStart.
    const refundRows = await db
      .select()
      .from(tokenUsage)
      .where(
        and(
          eq(tokenUsage.userId, userId),
          eq(tokenUsage.periodStart, yesterday),
        ),
      );
    const negativeRow = refundRows.find((r) => r.tokensUsed === -MIN_TOKENS_FOR_REQUEST);
    assert.ok(negativeRow, "expected a -MIN_TOKENS_FOR_REQUEST row for yesterday");
    assert.equal(
      negativeRow!.periodStart.getTime(),
      yesterday.getTime(),
      "refund row periodStart must equal the original reservation's periodStart",
    );
  });

  test("recordTokens defaults to today when no periodStart is provided", async () => {
    const userId = await makeUser("default-period");
    await clearUserUsage(userId);

    await recordTokens(userId, 1234);

    const today = getCurrentPeriodStart();
    const todayTotal = await sumTokens(userId, today);
    assert.equal(todayTotal, 1234);
  });
});

describe("/api/chat/voice 429 response shape", () => {
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
  });

  test("returns 429 with nextResetAt, period, tokensUsed, tokensRemaining, tokenLimit when over cap", async () => {
    const userId = await makeUser("429");
    await clearUserUsage(userId);

    // Push the user to the cap so the next request must be rejected.
    await recordTokens(userId, FREE_TOKEN_LIMIT);

    if (!process.env.SESSION_SECRET) {
      throw new Error("SESSION_SECRET must be set for tests");
    }
    const token = jwt.sign(
      { userId, email: "test@example.com" },
      process.env.SESSION_SECRET,
      { expiresIn: "1h" },
    );

    const res = await fetch(`${baseUrl}/api/chat/voice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: "hello" }),
    });

    assert.equal(res.status, 429, "should reject with 429 when over the daily cap");

    const body = (await res.json()) as Record<string, unknown>;

    assert.equal(body.error, "Daily token limit reached");
    assert.equal(body.tokenLimit, FREE_TOKEN_LIMIT);
    assert.equal(body.tokensUsed, FREE_TOKEN_LIMIT);
    assert.equal(body.tokensRemaining, 0);
    assert.equal(body.period, "day");
    assert.equal(typeof body.nextResetAt, "string");
    // nextResetAt should be a valid ISO-8601 timestamp in the future.
    const nextReset = new Date(body.nextResetAt as string);
    assert.ok(!Number.isNaN(nextReset.getTime()), "nextResetAt must parse as a date");
    assert.ok(
      nextReset.getTime() > Date.now(),
      "nextResetAt must be in the future",
    );
    // It should equal the next UTC midnight.
    const expectedReset = new Date(getCurrentPeriodStart().getTime() + 24 * 60 * 60 * 1000);
    assert.equal(nextReset.getTime(), expectedReset.getTime());

    // The over-limit request must not consume any additional tokens.
    const totalAfter = await sumTokens(userId);
    assert.equal(
      totalAfter,
      FREE_TOKEN_LIMIT,
      "rejected request must not record any extra usage",
    );
  });
});
