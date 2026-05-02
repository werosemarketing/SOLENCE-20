import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { registerRoutes } from "../routes";
import {
  DAILY_PROMPTS,
  pickDailyPromptIndex,
  utcDateKey,
  getDailyPromptForDate,
} from "../dailyPrompts";

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

describe("daily prompt selection", () => {
  test("pool size sits in the documented 15-30 range", () => {
    assert.ok(
      DAILY_PROMPTS.length >= 15 && DAILY_PROMPTS.length <= 30,
      `expected pool size in [15, 30], got ${DAILY_PROMPTS.length}`,
    );
  });

  test("every prompt has a non-empty prompt and topic", () => {
    for (const entry of DAILY_PROMPTS) {
      assert.equal(typeof entry.prompt, "string");
      assert.ok(entry.prompt.trim().length > 0, "prompt must be non-empty");
      assert.equal(typeof entry.topic, "string");
      assert.ok(entry.topic.trim().length > 0, "topic must be non-empty");
    }
  });

  test("same dateKey returns the same prompt", () => {
    const a = getDailyPromptForDate(new Date(Date.UTC(2026, 4, 2, 1, 0, 0)));
    const b = getDailyPromptForDate(new Date(Date.UTC(2026, 4, 2, 23, 59, 59)));
    assert.equal(a.dateKey, "2026-05-02");
    assert.equal(b.dateKey, "2026-05-02");
    assert.equal(a.prompt, b.prompt);
    assert.equal(a.topic, b.topic);
  });

  test("different dateKeys generally select different prompts", () => {
    // Walk a window of consecutive days; we don't require strict
    // uniqueness (collisions are possible with a 24-prompt pool over
    // ~14 days), but we DO expect substantially more than one prompt
    // to appear — proving the selection actually varies.
    const seen = new Set<string>();
    const start = Date.UTC(2026, 0, 1);
    const days = 14;
    for (let i = 0; i < days; i++) {
      const d = new Date(start + i * 24 * 60 * 60 * 1000);
      seen.add(getDailyPromptForDate(d).prompt);
    }
    assert.ok(
      seen.size >= Math.min(7, DAILY_PROMPTS.length),
      `expected at least 7 distinct prompts across ${days} days, got ${seen.size}`,
    );
  });

  test("pickDailyPromptIndex is stable per dateKey", () => {
    const key = "2026-07-15";
    const i1 = pickDailyPromptIndex(key, DAILY_PROMPTS.length);
    const i2 = pickDailyPromptIndex(key, DAILY_PROMPTS.length);
    assert.equal(i1, i2);
    assert.ok(i1 >= 0 && i1 < DAILY_PROMPTS.length);
  });

  test("utcDateKey reflects the UTC calendar day, not the local one", () => {
    // 23:30 UTC on 2026-05-02 is 2026-05-02 in UTC even though some
    // local timezones already see 2026-05-03.
    const key = utcDateKey(new Date(Date.UTC(2026, 4, 2, 23, 30, 0)));
    assert.equal(key, "2026-05-02");
  });
});

describe("GET /api/daily-prompt", () => {
  test("returns prompt, topic, and dateKey without auth", async () => {
    const res = await fetch(`${baseUrl}/api/daily-prompt`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      prompt: string;
      topic: string;
      dateKey: string;
    };
    assert.equal(typeof body.prompt, "string");
    assert.ok(body.prompt.length > 0);
    assert.equal(typeof body.topic, "string");
    assert.ok(body.topic.length > 0);
    assert.match(body.dateKey, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("matches the prompt selected by getDailyPromptForDate for today", async () => {
    const expected = getDailyPromptForDate();
    const res = await fetch(`${baseUrl}/api/daily-prompt`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      prompt: string;
      topic: string;
      dateKey: string;
    };
    // Note: there is a vanishingly small race where the test crosses
    // midnight UTC between expected and actual; we accept either today
    // or tomorrow's prompt to keep the test non-flaky.
    const tomorrow = getDailyPromptForDate(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );
    assert.ok(
      (body.prompt === expected.prompt && body.dateKey === expected.dateKey) ||
        (body.prompt === tomorrow.prompt && body.dateKey === tomorrow.dateKey),
      "endpoint should return the deterministic UTC-day prompt",
    );
  });

  test("sets a short Cache-Control header", async () => {
    const res = await fetch(`${baseUrl}/api/daily-prompt`);
    assert.equal(res.status, 200);
    const cacheControl = res.headers.get("cache-control");
    assert.ok(cacheControl, "Cache-Control header should be present");
    assert.match(cacheControl!, /max-age=/);
  });
});
