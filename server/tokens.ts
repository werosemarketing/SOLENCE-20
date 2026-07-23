import { db } from "./db";
import { tokenUsage, FREE_TOKEN_LIMIT, PREMIUM_MESSAGE_LIMIT } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export const MIN_TOKENS_FOR_REQUEST = 500;

export function getCurrentPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function getNextPeriodStart(): Date {
  const start = getCurrentPeriodStart();
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

export async function getTokensUsed(userId: string): Promise<number> {
  const periodStart = getCurrentPeriodStart();
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${tokenUsage.tokensUsed}), 0)::int` })
    .from(tokenUsage)
    .where(
      and(
        eq(tokenUsage.userId, userId),
        gte(tokenUsage.periodStart, periodStart),
      ),
    );
  return result[0]?.total ?? 0;
}

/**
 * Atomically check the user's daily quota and reserve tokens. We acquire a
 * transaction-scoped Postgres advisory lock keyed on the user id so that
 * concurrent requests for the same user are serialized; this prevents the
 * SELECT SUM + INSERT pair from racing and overshooting the daily cap.
 *
 * Returns the periodStart used for the reservation so the caller can record
 * any later refund or additional usage against the same day, even if the
 * request straddles UTC midnight.
 */
export async function tryReserveTokens(
  userId: string,
  tokens: number,
): Promise<
  | { ok: true; newTotal: number; periodStart: Date }
  | { ok: false; tokensUsed: number }
> {
  const periodStart = getCurrentPeriodStart();
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const result = await tx
      .select({ total: sql<number>`COALESCE(SUM(${tokenUsage.tokensUsed}), 0)::int` })
      .from(tokenUsage)
      .where(
        and(
          eq(tokenUsage.userId, userId),
          gte(tokenUsage.periodStart, periodStart),
        ),
      );
    const current = result[0]?.total ?? 0;
    if (current + tokens > FREE_TOKEN_LIMIT) {
      return { ok: false as const, tokensUsed: current };
    }
    await tx.insert(tokenUsage).values({
      userId,
      tokensUsed: tokens,
      periodStart,
    });
    return { ok: true as const, newTotal: current + tokens, periodStart };
  });
}

/**
 * Returns per-day token totals for the most recent `days` UTC-day periods,
 * including days with no usage (filled with 0). Days are returned in ascending
 * order (oldest first). The newest entry corresponds to today's UTC period.
 */
export async function getTokensUsedHistory(
  userId: string,
  days: number,
  // Premium usage is counted in messages, not tokens — pass "messages" so
  // history charts reflect the premium user's actual consumption.
  unit: "tokens" | "messages" = "tokens",
): Promise<{ periodStart: string; tokensUsed: number }[]> {
  const today = getCurrentPeriodStart();
  const oldest = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const column = unit === "messages" ? tokenUsage.messagesUsed : tokenUsage.tokensUsed;
  const rows = await db
    .select({
      periodStart: tokenUsage.periodStart,
      total: sql<number>`COALESCE(SUM(${column}), 0)::int`,
    })
    .from(tokenUsage)
    .where(
      and(
        eq(tokenUsage.userId, userId),
        gte(tokenUsage.periodStart, oldest),
      ),
    )
    .groupBy(tokenUsage.periodStart);

  const totalsByDay = new Map<number, number>();
  for (const row of rows) {
    const key = new Date(row.periodStart).getTime();
    totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + row.total);
  }

  const history: { periodStart: string; tokensUsed: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    history.push({
      periodStart: day.toISOString(),
      tokensUsed: Math.max(0, totalsByDay.get(day.getTime()) ?? 0),
    });
  }
  return history;
}

export async function recordTokens(
  userId: string,
  tokens: number,
  periodStart: Date = getCurrentPeriodStart(),
): Promise<void> {
  if (tokens === 0) return;
  await db.insert(tokenUsage).values({
    userId,
    tokensUsed: tokens,
    periodStart,
  });
}

/**
 * Returns the number of messages used by a premium user today (UTC day).
 */
export async function getMessagesUsed(userId: string): Promise<number> {
  const periodStart = getCurrentPeriodStart();
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${tokenUsage.messagesUsed}), 0)::int` })
    .from(tokenUsage)
    .where(and(eq(tokenUsage.userId, userId), gte(tokenUsage.periodStart, periodStart)));
  return result[0]?.total ?? 0;
}

/**
 * Records one message consumed by a premium user. Called after a successful
 * voice/chat response — no upfront reservation needed since the daily cap
 * (250) is low-stakes enough that a slight race is acceptable.
 */
export async function recordMessage(
  userId: string,
  periodStart: Date = getCurrentPeriodStart(),
): Promise<void> {
  await db.insert(tokenUsage).values({
    userId,
    tokensUsed: 0,
    messagesUsed: 1,
    periodStart,
  });
}
