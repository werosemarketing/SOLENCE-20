import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as StoreReview from "expo-store-review";

import {
  evaluateShouldRequestReview,
  type ReviewEvaluationInput,
} from "./rating-evaluator";

export {
  containsCrisisLanguage,
  evaluateShouldRequestReview,
  MIN_MESSAGES_FOR_REVIEW,
  MIN_SESSION_DURATION_MS,
  MIN_DISTINCT_SESSION_DAYS,
  MIN_DAYS_BETWEEN_PROMPTS,
  type ReviewEvaluationInput,
  type ReviewEvaluationContext,
} from "./rating-evaluator";

const STORAGE_KEY_LAST_PROMPTED = "solence:rating:lastPromptedAt";
const STORAGE_KEY_SESSION_DATES = "solence:rating:sessionDates";

const MAX_TRACKED_SESSION_DATES = 30;

function todayDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function readSessionDates(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_SESSION_DATES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

async function writeSessionDates(dates: string[]): Promise<void> {
  try {
    const trimmed = dates.slice(-MAX_TRACKED_SESSION_DATES);
    await AsyncStorage.setItem(
      STORAGE_KEY_SESSION_DATES,
      JSON.stringify(trimmed),
    );
  } catch {
    // best-effort; never throw from a counter helper.
  }
}

async function readLastPromptedAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_LAST_PROMPTED);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function writeLastPromptedAt(ms: number): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_LAST_PROMPTED, String(ms));
  } catch {
    // best-effort.
  }
}

// Mark today as a session day. Idempotent: calling it multiple times the
// same calendar day is a no-op so we don't inflate the distinct-days count.
export async function recordSessionDay(now: Date = new Date()): Promise<void> {
  const today = todayDateKey(now);
  const existing = await readSessionDates();
  if (existing.includes(today)) return;
  await writeSessionDates([...existing, today]);
}

// Reads the persisted counters and returns whether the trigger should fire.
// Defensive: returns false on any read error.
export async function shouldRequestReview(
  input: ReviewEvaluationInput,
): Promise<boolean> {
  try {
    const [lastPromptedAt, sessionDates] = await Promise.all([
      readLastPromptedAt(),
      readSessionDates(),
    ]);
    return evaluateShouldRequestReview(input, { lastPromptedAt, sessionDates });
  } catch {
    return false;
  }
}

// Triggers the OS rating sheet if all gates pass and the platform supports
// it. Returns true if the prompt was actually requested. No-ops on web and
// on devices where StoreReview isn't available.
export async function maybeRequestReview(
  input: ReviewEvaluationInput,
): Promise<boolean> {
  try {
    if (Platform.OS === "web") return false;

    const ok = await shouldRequestReview(input);
    if (!ok) return false;

    const available = await StoreReview.isAvailableAsync();
    if (!available) return false;

    const hasAction = await StoreReview.hasAction();
    if (!hasAction) return false;

    await StoreReview.requestReview();
    await writeLastPromptedAt((input.now ?? new Date()).getTime());
    return true;
  } catch (err) {
    console.log(
      "Rating prompt failed:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

// Test-only helpers. Exposed for unit tests; not used by the app.
export const __test = {
  STORAGE_KEY_LAST_PROMPTED,
  STORAGE_KEY_SESSION_DATES,
  todayDateKey,
  readLastPromptedAt,
  readSessionDates,
  writeLastPromptedAt,
  writeSessionDates,
};
