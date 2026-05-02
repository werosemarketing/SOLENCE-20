import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  containsCrisisLanguage,
  evaluateShouldRequestReview,
  MIN_MESSAGES_FOR_REVIEW,
  MIN_SESSION_DURATION_MS,
  MIN_DISTINCT_SESSION_DAYS,
  MIN_DAYS_BETWEEN_PROMPTS,
} from "../../client/lib/rating-evaluator";

const baseCtx = {
  lastPromptedAt: null,
  sessionDates: ["2026-01-01", "2026-01-02", "2026-01-03"],
};

const baseInput = {
  messageCount: MIN_MESSAGES_FOR_REVIEW,
  sessionDurationMs: MIN_SESSION_DURATION_MS,
  hadCrisis: false,
  now: new Date("2026-01-05T12:00:00Z"),
};

describe("containsCrisisLanguage", () => {
  test("flags explicit suicide phrasing", () => {
    assert.equal(containsCrisisLanguage("I keep thinking about suicide"), true);
    assert.equal(containsCrisisLanguage("i feel suicidal lately"), true);
    assert.equal(containsCrisisLanguage("I want to die today"), true);
    assert.equal(containsCrisisLanguage("I might kill myself"), true);
  });

  test("flags self-harm phrasing", () => {
    assert.equal(containsCrisisLanguage("I've been self-harming"), true);
    assert.equal(containsCrisisLanguage("I keep cutting myself"), true);
    assert.equal(containsCrisisLanguage("I want to hurt myself"), true);
  });

  test("does not flag innocuous text", () => {
    assert.equal(containsCrisisLanguage("I had a great day"), false);
    assert.equal(containsCrisisLanguage("the meeting killed me"), false);
    assert.equal(containsCrisisLanguage("nothing to report"), false);
    assert.equal(containsCrisisLanguage(""), false);
    assert.equal(containsCrisisLanguage(null), false);
    assert.equal(containsCrisisLanguage(undefined), false);
  });
});

describe("evaluateShouldRequestReview", () => {
  test("returns true when every gate passes", () => {
    assert.equal(evaluateShouldRequestReview(baseInput, baseCtx), true);
  });

  test("returns false when the conversation contained crisis language", () => {
    assert.equal(
      evaluateShouldRequestReview({ ...baseInput, hadCrisis: true }, baseCtx),
      false,
    );
  });

  test("returns false when message count is below the threshold", () => {
    assert.equal(
      evaluateShouldRequestReview(
        { ...baseInput, messageCount: MIN_MESSAGES_FOR_REVIEW - 1 },
        baseCtx,
      ),
      false,
    );
  });

  test("returns false when the session was too short", () => {
    assert.equal(
      evaluateShouldRequestReview(
        { ...baseInput, sessionDurationMs: MIN_SESSION_DURATION_MS - 1 },
        baseCtx,
      ),
      false,
    );
  });

  test("returns false when fewer than the required distinct session days are recorded", () => {
    const ctx = {
      ...baseCtx,
      sessionDates: ["2026-01-01", "2026-01-02"],
    };
    assert.equal(evaluateShouldRequestReview(baseInput, ctx), false);
  });

  test("treats duplicate session days as a single distinct day", () => {
    const ctx = {
      ...baseCtx,
      sessionDates: ["2026-01-01", "2026-01-01", "2026-01-01"],
    };
    assert.equal(evaluateShouldRequestReview(baseInput, ctx), false);

    const goodCtx = {
      ...baseCtx,
      sessionDates: [
        "2026-01-01",
        "2026-01-01",
        "2026-01-02",
        "2026-01-02",
        "2026-01-03",
      ],
    };
    assert.equal(
      evaluateShouldRequestReview(baseInput, goodCtx),
      true,
    );
    assert.equal(new Set(goodCtx.sessionDates).size, MIN_DISTINCT_SESSION_DAYS);
  });

  test("returns false when prompted recently (inside the cooldown window)", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const recentlyPromptedAt =
      now.getTime() - (MIN_DAYS_BETWEEN_PROMPTS - 1) * 24 * 60 * 60 * 1000;
    assert.equal(
      evaluateShouldRequestReview(
        { ...baseInput, now },
        { ...baseCtx, lastPromptedAt: recentlyPromptedAt },
      ),
      false,
    );
  });

  test("returns true when the cooldown window has elapsed", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const longAgoPromptedAt =
      now.getTime() - (MIN_DAYS_BETWEEN_PROMPTS + 1) * 24 * 60 * 60 * 1000;
    assert.equal(
      evaluateShouldRequestReview(
        { ...baseInput, now },
        { ...baseCtx, lastPromptedAt: longAgoPromptedAt },
      ),
      true,
    );
  });

  test("crisis flag short-circuits even when every other gate passes", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const longAgoPromptedAt =
      now.getTime() - (MIN_DAYS_BETWEEN_PROMPTS + 365) * 24 * 60 * 60 * 1000;
    assert.equal(
      evaluateShouldRequestReview(
        { ...baseInput, now, hadCrisis: true },
        { ...baseCtx, lastPromptedAt: longAgoPromptedAt },
      ),
      false,
    );
  });
});
