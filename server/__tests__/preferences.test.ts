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
  favorites,
  moodEntries,
  userMemories,
  DEFAULT_REMINDER_TIME,
  DEFAULT_WEEKLY_SUMMARY_TIME,
  DEFAULT_WEEKLY_SUMMARY_DAY,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { registerRoutes } from "../routes";

const TEST_EMAIL_PREFIX = "preferences-test-";

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

async function makeConversation(
  userId: string,
  title: string,
  createdAt?: Date,
): Promise<number> {
  const [row] = await db
    .insert(conversations)
    .values({ userId, title, ...(createdAt ? { createdAt } : {}) })
    .returning();
  createdConversationIds.push(row.id);
  return row.id;
}

async function insertMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
  createdAt?: Date,
): Promise<number> {
  const [row] = await db
    .insert(messages)
    .values({ conversationId, role, content, ...(createdAt ? { createdAt } : {}) })
    .returning();
  return row.id;
}

async function favoriteMessage(
  userId: string,
  messageId: number,
  createdAt?: Date,
): Promise<void> {
  await db
    .insert(favorites)
    .values({ userId, messageId, ...(createdAt ? { createdAt } : {}) });
}

async function insertMood(
  userId: string,
  score: number,
  createdAt: Date,
  phase: "pre" | "post" = "pre",
): Promise<void> {
  await db
    .insert(moodEntries)
    .values({ userId, phase, score, conversationId: null, createdAt });
}

async function insertMemory(
  userId: string,
  text: string,
  createdAt: Date,
): Promise<void> {
  await db
    .insert(userMemories)
    .values({ userId, text, createdAt });
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

  // Wipe per-user data we created. Memories/favorites/mood entries cascade
  // off conversations only loosely (mood is SET NULL, memories use SET
  // NULL), so we clear them by user before deleting the conversations
  // and finally the users.
  for (const userId of createdUserIds) {
    await db.delete(userMemories).where(eq(userMemories.userId, userId));
    await db.delete(favorites).where(eq(favorites.userId, userId));
    await db.delete(moodEntries).where(eq(moodEntries.userId, userId));
  }
  if (createdConversationIds.length > 0) {
    // Messages cascade with conversations; favorites already cleared above.
    await db
      .delete(conversations)
      .where(inArray(conversations.id, createdConversationIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

// --- PATCH /api/preferences validation ---------------------------------

describe("PATCH /api/preferences validation", () => {
  test("accepts valid reminderTime, weeklySummaryDay, weeklySummaryTime", async () => {
    const userId = await makeUser("valid-prefs");
    const res = await fetch(`${baseUrl}/api/preferences`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(userId)}`,
      },
      body: JSON.stringify({
        reminderEnabled: true,
        reminderTime: "07:30",
        weeklySummaryEnabled: true,
        weeklySummaryDay: 3,
        weeklySummaryTime: "21:05",
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      preferences: {
        reminderEnabled: boolean;
        reminderTime: string;
        weeklySummaryEnabled: boolean;
        weeklySummaryDay: number;
        weeklySummaryTime: string;
      };
    };
    assert.equal(body.preferences.reminderEnabled, true);
    assert.equal(body.preferences.reminderTime, "07:30");
    assert.equal(body.preferences.weeklySummaryEnabled, true);
    assert.equal(body.preferences.weeklySummaryDay, 3);
    assert.equal(body.preferences.weeklySummaryTime, "21:05");

    // Confirm the row was actually persisted, not just echoed back.
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    assert.equal(row.reminderEnabled, true);
    assert.equal(row.reminderTime, "07:30");
    assert.equal(row.weeklySummaryEnabled, true);
    assert.equal(row.weeklySummaryDay, 3);
    assert.equal(row.weeklySummaryTime, "21:05");
  });

  test("accepts the boundary HH:MM values (00:00 and 23:59)", async () => {
    const userId = await makeUser("boundary-times");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(userId)}`,
    };
    for (const time of ["00:00", "23:59", "09:09", "12:00"]) {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ reminderTime: time, weeklySummaryTime: time }),
      });
      assert.equal(res.status, 200, `time=${time} should be accepted`);
      const body = (await res.json()) as {
        preferences: { reminderTime: string; weeklySummaryTime: string };
      };
      assert.equal(body.preferences.reminderTime, time);
      assert.equal(body.preferences.weeklySummaryTime, time);
    }
  });

  test("accepts the full weekday range 0-6", async () => {
    const userId = await makeUser("weekday-range");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(userId)}`,
    };
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ weeklySummaryDay: day }),
      });
      assert.equal(res.status, 200, `day=${day} should be accepted`);
      const body = (await res.json()) as {
        preferences: { weeklySummaryDay: number };
      };
      assert.equal(body.preferences.weeklySummaryDay, day);
    }
  });

  test("rejects malformed reminderTime", async () => {
    const userId = await makeUser("bad-reminder-time");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(userId)}`,
    };
    for (const bad of [
      "7:30",      // missing leading zero
      "24:00",     // hours out of range
      "12:60",     // minutes out of range
      "12-30",     // wrong separator
      "noon",      // not a time
      "",          // empty string
      "12:300",    // too many minute digits
      "1230",      // missing colon
    ]) {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ reminderTime: bad }),
      });
      assert.equal(
        res.status,
        400,
        `reminderTime=${JSON.stringify(bad)} should be rejected`,
      );
      const body = (await res.json()) as { error?: string };
      assert.match(String(body.error), /HH:MM|time/i);
    }
  });

  test("rejects malformed weeklySummaryTime", async () => {
    const userId = await makeUser("bad-weekly-time");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(userId)}`,
    };
    for (const bad of ["8:00", "25:00", "10:65", "abc", "12:5"]) {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ weeklySummaryTime: bad }),
      });
      assert.equal(
        res.status,
        400,
        `weeklySummaryTime=${JSON.stringify(bad)} should be rejected`,
      );
    }
  });

  test("rejects out-of-range weeklySummaryDay", async () => {
    const userId = await makeUser("bad-weekday");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(userId)}`,
    };
    for (const bad of [-1, 7, 8, 1.5, "monday", null]) {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ weeklySummaryDay: bad }),
      });
      assert.equal(
        res.status,
        400,
        `weeklySummaryDay=${JSON.stringify(bad)} should be rejected`,
      );
    }
  });

  test("rejects non-boolean reminderEnabled / weeklySummaryEnabled", async () => {
    const userId = await makeUser("bad-bool");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(userId)}`,
    };
    for (const body of [
      { reminderEnabled: "yes" },
      { reminderEnabled: 1 },
      { weeklySummaryEnabled: "true" },
      { weeklySummaryEnabled: 0 },
    ]) {
      const res = await fetch(`${baseUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });
      assert.equal(
        res.status,
        400,
        `payload=${JSON.stringify(body)} should be rejected`,
      );
    }
  });

  test("partial update leaves other fields untouched", async () => {
    const userId = await makeUser("partial");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signToken(userId)}`,
    };
    // Seed a baseline.
    await fetch(`${baseUrl}/api/preferences`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        reminderEnabled: true,
        reminderTime: "06:15",
        weeklySummaryEnabled: true,
        weeklySummaryDay: 5,
        weeklySummaryTime: "18:45",
      }),
    });
    // Touch only the weekly day.
    const res = await fetch(`${baseUrl}/api/preferences`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ weeklySummaryDay: 1 }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      preferences: {
        reminderEnabled: boolean;
        reminderTime: string;
        weeklySummaryEnabled: boolean;
        weeklySummaryDay: number;
        weeklySummaryTime: string;
      };
    };
    assert.equal(body.preferences.reminderEnabled, true);
    assert.equal(body.preferences.reminderTime, "06:15");
    assert.equal(body.preferences.weeklySummaryEnabled, true);
    assert.equal(body.preferences.weeklySummaryDay, 1);
    assert.equal(body.preferences.weeklySummaryTime, "18:45");
  });

  test("a fresh account exposes the documented defaults", async () => {
    const userId = await makeUser("defaults");
    const res = await fetch(`${baseUrl}/api/preferences`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      preferences: {
        reminderEnabled: boolean;
        reminderTime: string;
        weeklySummaryEnabled: boolean;
        weeklySummaryDay: number;
        weeklySummaryTime: string;
      };
    };
    assert.equal(body.preferences.reminderEnabled, false);
    assert.equal(body.preferences.reminderTime, DEFAULT_REMINDER_TIME);
    assert.equal(body.preferences.weeklySummaryEnabled, false);
    assert.equal(body.preferences.weeklySummaryDay, DEFAULT_WEEKLY_SUMMARY_DAY);
    assert.equal(
      body.preferences.weeklySummaryTime,
      DEFAULT_WEEKLY_SUMMARY_TIME,
    );
  });

  test("requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reminderTime: "07:00" }),
    });
    assert.equal(res.status, 401);
  });
});

// --- GET /api/weekly-summary ------------------------------------------

// Mirror the route's Sunday-anchored window math so we can place seed
// rows precisely inside / outside the window without depending on the
// time-of-day the test runs.
function weekWindowFor(weekOffset: number): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay() + weekOffset * 7,
    0,
    0,
    0,
    0,
  );
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

describe("GET /api/weekly-summary window math", () => {
  test("requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/weekly-summary`);
    assert.equal(res.status, 401);
  });

  test("weekOffset=0 returns the current Sunday-anchored 7-day window", async () => {
    const userId = await makeUser("offset-0");
    const res = await fetch(`${baseUrl}/api/weekly-summary?weekOffset=0`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      weekOffset: number;
      weekStart: string;
      weekEnd: string;
    };
    assert.equal(body.weekOffset, 0);

    const expected = weekWindowFor(0);
    const startedAt = new Date(body.weekStart);
    const endedAt = new Date(body.weekEnd);
    assert.equal(startedAt.getTime(), expected.start.getTime());
    assert.equal(endedAt.getTime(), expected.end.getTime());
    // Sunday-anchored => start.getDay() must be 0.
    assert.equal(startedAt.getDay(), 0);
    // Exactly 7 days wide.
    assert.equal(endedAt.getTime() - startedAt.getTime(), 7 * 24 * 60 * 60 * 1000);
  });

  test("negative weekOffset shifts the window backward by N weeks", async () => {
    const userId = await makeUser("offset-neg");
    for (const offset of [-1, -3, -10]) {
      const res = await fetch(
        `${baseUrl}/api/weekly-summary?weekOffset=${offset}`,
        { headers: { Authorization: `Bearer ${signToken(userId)}` } },
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        weekOffset: number;
        weekStart: string;
        weekEnd: string;
      };
      assert.equal(body.weekOffset, offset);
      const expected = weekWindowFor(offset);
      assert.equal(new Date(body.weekStart).getTime(), expected.start.getTime());
      assert.equal(new Date(body.weekEnd).getTime(), expected.end.getTime());
    }
  });

  test("clamps positive weekOffset (future) to 0", async () => {
    const userId = await makeUser("offset-pos");
    const res = await fetch(`${baseUrl}/api/weekly-summary?weekOffset=3`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as {
      weekOffset: number;
      weekStart: string;
    };
    assert.equal(body.weekOffset, 0);
    assert.equal(
      new Date(body.weekStart).getTime(),
      weekWindowFor(0).start.getTime(),
    );
  });

  test("clamps weekOffset below -52 to 0 and tolerates non-numeric input", async () => {
    const userId = await makeUser("offset-bogus");
    const headers = { Authorization: `Bearer ${signToken(userId)}` };
    for (const value of ["-999", "abc", "NaN"]) {
      const res = await fetch(
        `${baseUrl}/api/weekly-summary?weekOffset=${value}`,
        { headers },
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { weekOffset: number };
      assert.equal(body.weekOffset, 0, `value=${value} should clamp to 0`);
    }
  });

  test("floors fractional offsets toward more recent week", async () => {
    const userId = await makeUser("offset-frac");
    const res = await fetch(`${baseUrl}/api/weekly-summary?weekOffset=-1.4`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as { weekOffset: number };
    // Math.floor(-1.4) === -2.
    assert.equal(body.weekOffset, -2);
  });
});

describe("GET /api/weekly-summary aggregation", () => {
  test("empty week returns zero counts, null mood, and null highlight", async () => {
    const userId = await makeUser("empty-week");
    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      sessionCount: number;
      moodCount: number;
      avgMood: number | null;
      themes: string[];
      highlight: unknown;
    };
    assert.equal(body.sessionCount, 0);
    assert.equal(body.moodCount, 0);
    assert.equal(body.avgMood, null);
    assert.deepEqual(body.themes, []);
    assert.equal(body.highlight, null);
  });

  test("sessionCount counts only conversations created inside the window", async () => {
    const userId = await makeUser("session-count");
    const thisWeek = weekWindowFor(0);
    const lastWeek = weekWindowFor(-1);

    // 3 in this week.
    const inA = new Date(thisWeek.start.getTime() + 1 * 60 * 60 * 1000);
    const inB = new Date(thisWeek.start.getTime() + 2 * 24 * 60 * 60 * 1000);
    const inC = new Date(thisWeek.end.getTime() - 60 * 60 * 1000);
    await makeConversation(userId, "A", inA);
    await makeConversation(userId, "B", inB);
    await makeConversation(userId, "C", inC);

    // 2 outside (last week + before that). Also the boundary at weekEnd
    // is exclusive — a conversation exactly at weekEnd belongs to the
    // *next* week, never to the current one.
    const outBefore = new Date(lastWeek.start.getTime() + 60 * 60 * 1000);
    await makeConversation(userId, "Out before", outBefore);
    await makeConversation(userId, "On boundary", new Date(thisWeek.end));

    const res = await fetch(`${baseUrl}/api/weekly-summary?weekOffset=0`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as { sessionCount: number };
    assert.equal(body.sessionCount, 3);

    const lastWeekRes = await fetch(
      `${baseUrl}/api/weekly-summary?weekOffset=-1`,
      { headers: { Authorization: `Bearer ${signToken(userId)}` } },
    );
    const lastWeekBody = (await lastWeekRes.json()) as { sessionCount: number };
    assert.equal(lastWeekBody.sessionCount, 1);
  });

  test("avgMood averages all in-window mood entries, rounded to 1 decimal", async () => {
    const userId = await makeUser("avg-mood");
    const thisWeek = weekWindowFor(0);
    const inAt = new Date(thisWeek.start.getTime() + 4 * 60 * 60 * 1000);

    // Inside window: 2, 3, 5, 4 -> avg 3.5
    await insertMood(userId, 2, inAt, "pre");
    await insertMood(userId, 3, inAt, "post");
    await insertMood(userId, 5, inAt, "pre");
    await insertMood(userId, 4, inAt, "post");

    // Outside window: should be ignored.
    await insertMood(userId, 1, weekWindowFor(-2).start, "pre");

    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as {
      moodCount: number;
      avgMood: number | null;
    };
    assert.equal(body.moodCount, 4);
    assert.equal(body.avgMood, 3.5);
  });

  test("avgMood rounds non-terminating averages to one decimal", async () => {
    const userId = await makeUser("avg-mood-round");
    const thisWeek = weekWindowFor(0);
    const at = new Date(thisWeek.start.getTime() + 60 * 60 * 1000);
    // 1+2+2 = 5 / 3 = 1.6666… -> 1.7
    await insertMood(userId, 1, at, "pre");
    await insertMood(userId, 2, at, "pre");
    await insertMood(userId, 2, at, "post");

    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as { avgMood: number | null };
    assert.equal(body.avgMood, 1.7);
  });

  test("avgMood is null when no mood entries fall inside the window", async () => {
    const userId = await makeUser("avg-mood-empty");
    // Entry well outside the window.
    await insertMood(userId, 4, weekWindowFor(-5).start);
    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as {
      moodCount: number;
      avgMood: number | null;
    };
    assert.equal(body.moodCount, 0);
    assert.equal(body.avgMood, null);
  });

  test("themes pulls top-3 keywords from in-window reflections + memories, drops stop words", async () => {
    const userId = await makeUser("themes");
    const thisWeek = weekWindowFor(0);
    const inAt = new Date(thisWeek.start.getTime() + 60 * 60 * 1000);

    const convId = await makeConversation(userId, "Themes A", inAt);
    await db
      .update(conversations)
      .set({
        // "with the and that" are stop words; "boundaries" and "sleep"
        // should win. Repeating "boundaries" makes it the top hit.
        reflectionTakeaway:
          "Boundaries with the people that matter feel hard.",
        reflectionSummary:
          "You sat with the weight of saying no and what boundaries cost.",
      })
      .where(eq(conversations.id, convId));

    const conv2 = await makeConversation(userId, "Themes B", inAt);
    await db
      .update(conversations)
      .set({
        reflectionTakeaway: "Sleep has been hard this week.",
        reflectionSummary:
          "Boundaries showed up again and sleep felt elusive.",
      })
      .where(eq(conversations.id, conv2));

    // Memories also feed the theme corpus.
    await insertMemory(userId, "Working on better sleep routines.", inAt);
    await insertMemory(userId, "Practicing healthier boundaries.", inAt);

    // Out-of-window noise that must NOT influence themes.
    const outConv = await makeConversation(
      userId,
      "Old",
      weekWindowFor(-3).start,
    );
    await db
      .update(conversations)
      .set({
        reflectionTakeaway: "Vacation vacation vacation vacation.",
        reflectionSummary: "Vacation vacation vacation.",
      })
      .where(eq(conversations.id, outConv));

    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as { themes: string[] };
    assert.ok(Array.isArray(body.themes));
    assert.ok(body.themes.length <= 3, "at most 3 themes");
    assert.ok(
      body.themes.includes("boundaries"),
      `expected 'boundaries' in themes, got ${JSON.stringify(body.themes)}`,
    );
    assert.ok(
      body.themes.includes("sleep"),
      `expected 'sleep' in themes, got ${JSON.stringify(body.themes)}`,
    );
    // Out-of-window content must not bleed in.
    assert.ok(
      !body.themes.includes("vacation"),
      `'vacation' must not appear in themes, got ${JSON.stringify(body.themes)}`,
    );
    // 'boundaries' appears more often than 'sleep' so it should rank higher.
    assert.equal(body.themes[0], "boundaries");
  });

  test("highlight prefers a favorited assistant message over the latest one", async () => {
    const userId = await makeUser("highlight-fav");
    const thisWeek = weekWindowFor(0);
    const earlyTs = new Date(thisWeek.start.getTime() + 60 * 60 * 1000);
    const midTs = new Date(thisWeek.start.getTime() + 24 * 60 * 60 * 1000);
    const lateTs = new Date(thisWeek.start.getTime() + 3 * 24 * 60 * 60 * 1000);

    const convId = await makeConversation(userId, "Highlights", earlyTs);
    await insertMessage(convId, "user", "Tell me something gentle", earlyTs);
    const earlyAssistantId = await insertMessage(
      convId,
      "assistant",
      "You are doing the work, even when it's quiet.",
      midTs,
    );
    await insertMessage(
      convId,
      "assistant",
      "Right now is the latest line — newest by createdAt.",
      lateTs,
    );

    // Favorite the EARLIER assistant line; the route should still pick
    // it over the chronologically later one.
    await favoriteMessage(userId, earlyAssistantId, midTs);

    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as {
      highlight: { messageId: number; content: string } | null;
    };
    assert.ok(body.highlight, "expected a highlight");
    assert.equal(body.highlight!.messageId, earlyAssistantId);
    assert.match(body.highlight!.content, /doing the work/);
  });

  test("highlight falls back to the most recent assistant message when nothing is favorited", async () => {
    const userId = await makeUser("highlight-recent");
    const thisWeek = weekWindowFor(0);
    const earlyTs = new Date(thisWeek.start.getTime() + 60 * 60 * 1000);
    const lateTs = new Date(thisWeek.start.getTime() + 2 * 24 * 60 * 60 * 1000);

    const convId = await makeConversation(userId, "Recent", earlyTs);
    await insertMessage(convId, "user", "hey", earlyTs);
    await insertMessage(
      convId,
      "assistant",
      "An earlier reflection I might forget.",
      earlyTs,
    );
    const newestId = await insertMessage(
      convId,
      "assistant",
      "The most recent steady thought from this week.",
      lateTs,
    );

    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as {
      highlight: { messageId: number; content: string } | null;
    };
    assert.ok(body.highlight, "expected a highlight");
    assert.equal(body.highlight!.messageId, newestId);
    assert.match(body.highlight!.content, /most recent steady thought/);
  });

  test("highlight ignores assistant messages from conversations started outside the window", async () => {
    const userId = await makeUser("highlight-old");
    // Conversation started two weeks ago — even messages timestamped
    // inside this week shouldn't count, because the route scopes by the
    // conversation's createdAt window.
    const oldConv = await makeConversation(
      userId,
      "Old conv",
      weekWindowFor(-2).start,
    );
    const inThisWeek = new Date(weekWindowFor(0).start.getTime() + 60 * 60 * 1000);
    await insertMessage(oldConv, "user", "hi", inThisWeek);
    await insertMessage(
      oldConv,
      "assistant",
      "A line that should NOT be picked up.",
      inThisWeek,
    );

    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(userId)}` },
    });
    const body = (await res.json()) as {
      sessionCount: number;
      highlight: unknown;
    };
    assert.equal(body.sessionCount, 0);
    assert.equal(body.highlight, null);
  });

  test("never returns another user's data", async () => {
    const me = await makeUser("isolated-me");
    const them = await makeUser("isolated-them");
    const thisWeek = weekWindowFor(0);
    const at = new Date(thisWeek.start.getTime() + 60 * 60 * 1000);

    // 'them' has lots of activity.
    const theirConv = await makeConversation(them, "Theirs", at);
    const theirMsg = await insertMessage(
      theirConv,
      "assistant",
      "Their private highlight line.",
      at,
    );
    await favoriteMessage(them, theirMsg, at);
    await insertMood(them, 5, at);

    const res = await fetch(`${baseUrl}/api/weekly-summary`, {
      headers: { Authorization: `Bearer ${signToken(me)}` },
    });
    const body = (await res.json()) as {
      sessionCount: number;
      moodCount: number;
      avgMood: number | null;
      highlight: unknown;
    };
    assert.equal(body.sessionCount, 0);
    assert.equal(body.moodCount, 0);
    assert.equal(body.avgMood, null);
    assert.equal(body.highlight, null);
  });
});
