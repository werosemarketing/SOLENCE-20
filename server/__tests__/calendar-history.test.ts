import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import {
  calendarDateKey,
  localDateForKey,
  moodCalendarBuckets,
  recentCalendarKeys,
} from "../../shared/calendar";
import { db } from "../db";
import { tokenUsage, users } from "../../shared/schema";
import { getCalendarUsageHistory, getTokensUsedHistory } from "../tokens";
import { registerRoutes } from "../routes";

function inZone(zone: string, check: () => void) {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    check();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe("device calendar dates", () => {
  test("Wednesday remains Wednesday west and east of UTC", () => {
    for (const [zone, timestamp] of [
      ["America/Chicago", "2026-11-12T02:00:00Z"],
      ["Pacific/Auckland", "2026-11-10T23:00:00Z"],
    ]) {
      inZone(zone, () => {
        const now = new Date(timestamp);
        assert.equal(calendarDateKey(now), "2026-11-11");
        assert.equal(calendarDateKey(now, zone), "2026-11-11");
        assert.equal(localDateForKey("2026-11-11").getDay(), 3);
        assert.equal(recentCalendarKeys(7, now).at(-1), "2026-11-11");
      });
    }
  });

  test("a Thursday UTC mood belongs to Wednesday in Chicago", () => {
    inZone("America/Chicago", () => {
      const entries = [
        { score: 2, createdAt: "2026-11-12T00:00:00Z" },
        { score: 5, createdAt: "2026-11-12T02:00:00Z" },
        { score: 1, createdAt: "2026-11-05T02:00:00Z" },
        { score: 3, createdAt: "2026-11-12T07:00:00Z" },
      ];
      const buckets = moodCalendarBuckets(entries, new Date("2026-11-12T03:00:00Z"));
      assert.equal(buckets.length, 7);
      assert.equal(buckets.at(-1)?.key, "2026-11-11");
      assert.equal(buckets.at(-1)?.entry?.score, 5);
      assert.equal(buckets.filter((b) => b.isToday).length, 1);
      assert.equal(buckets.filter((b) => b.entry).length, 1);
    });
  });

  test("local midnight moves Today to the next day without a restart", () => {
    inZone("America/Chicago", () => {
      assert.equal(moodCalendarBuckets([], new Date("2026-11-12T05:59:00Z")).at(-1)?.key, "2026-11-11");
      assert.equal(moodCalendarBuckets([], new Date("2026-11-12T06:01:00Z")).at(-1)?.key, "2026-11-12");
    });
  });

  test("daylight-saving changes keep seven distinct consecutive dates", () => {
    for (const timestamp of ["2026-03-10T12:00:00Z", "2026-11-03T12:00:00Z"]) {
      inZone("America/Chicago", () => {
        const keys = recentCalendarKeys(7, new Date(timestamp));
        assert.equal(new Set(keys).size, 7);
        for (let i = 1; i < keys.length; i++) {
          assert.equal(Date.parse(keys[i]) - Date.parse(keys[i - 1]), 86_400_000);
        }
      });
    }
  });
});

const createdUsers: string[] = [];
async function usageUser(timestamps: string[], amounts: number[]) {
  const [user] = await db.insert(users).values({
    email: `calendar-history-${crypto.randomUUID()}@example.invalid`,
    password: "not-a-login-account",
  }).returning();
  createdUsers.push(user.id);
  await db.insert(tokenUsage).values(timestamps.map((timestamp, i) => ({
    userId: user.id,
    periodStart: new Date(`${timestamp.slice(0, 10)}T00:00:00Z`),
    createdAt: new Date(timestamp),
    tokensUsed: amounts[i],
    messagesUsed: i + 1,
  })));
  return user.id;
}

after(async () => {
  for (const id of createdUsers) {
    await db.delete(tokenUsage).where(eq(tokenUsage.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("local-calendar usage history", () => {
  test("groups real usage by local midnight, with empty days and premium counts", async () => {
    const userId = await usageUser([
      "2026-11-11T05:59:00Z",
      "2026-11-11T06:01:00Z",
      "2026-11-12T02:00:00Z",
      "2026-11-12T06:00:00Z",
    ], [11, 22, 33, 44]);
    const now = new Date("2026-11-12T03:00:00Z");
    const history = await getCalendarUsageHistory(userId, 7, "tokens", "America/Chicago", now);
    assert.equal(history.length, 7);
    assert.equal(history.at(-1)?.date, "2026-11-11");
    assert.equal(history.at(-2)?.tokensUsed, 11);
    assert.equal(history.at(-1)?.tokensUsed, 55);
    assert.equal(history[0].tokensUsed, 0);
    const premium = await getCalendarUsageHistory(userId, 7, "messages", "America/Chicago", now);
    assert.equal(premium.at(-1)?.tokensUsed, 5);
  });

  test("includes the full 25-hour local day when daylight saving ends", async () => {
    const userId = await usageUser([
      "2026-11-01T04:59:00Z",
      "2026-11-01T05:00:00Z",
      "2026-11-02T05:59:00Z",
      "2026-11-02T06:00:00Z",
    ], [1, 10, 20, 100]);
    const history = await getCalendarUsageHistory(
      userId, 1, "tokens", "America/Chicago", new Date("2026-11-01T20:00:00Z"),
    );
    assert.deepEqual(history.map((h) => [h.date, h.tokensUsed]), [["2026-11-01", 30]]);
  });

  test("UTC quota history remains available for older app clients", async () => {
    const userId = await usageUser([new Date().toISOString()], [123]);
    const legacy = await getTokensUsedHistory(userId, 7);
    assert.equal(legacy.length, 7);
    assert.equal(legacy.at(-1)?.tokensUsed, 123);
  });

  test("history API honors a valid timezone and rejects invalid ones", async () => {
    const userId = await usageUser([new Date().toISOString()], [7]);
    assert.ok(process.env.SESSION_SECRET);
    const token = jwt.sign({ userId }, process.env.SESSION_SECRET, { expiresIn: "1m" });
    const app = express();
    await registerRoutes(app);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const response = await fetch(`${base}/api/tokens/history?timeZone=America%2FChicago`, { headers });
      assert.equal(response.status, 200);
      const body = await response.json() as {
        timeZone: string;
        history: { date: string; tokensUsed: number }[];
      };
      assert.equal(body.timeZone, "America/Chicago");
      assert.equal(body.history.length, 7);
      assert.match(body.history.at(-1)!.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(body.history.at(-1)?.tokensUsed, 7);
      for (const zone of ["Invalid/Timezone", "", "UTC&timeZone=America/Chicago"]) {
        const invalid = await fetch(`${base}/api/tokens/history?timeZone=${zone}`, { headers });
        assert.equal(invalid.status, 400);
      }
      const legacy = await fetch(`${base}/api/tokens/history`, { headers });
      assert.equal(legacy.status, 200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
