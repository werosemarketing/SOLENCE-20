import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export const RELOCK_OPTIONS = ["immediately", "1m", "5m", "30m"] as const;
export type RelockThreshold = (typeof RELOCK_OPTIONS)[number];

export const RELOCK_LABELS: Record<RelockThreshold, string> = {
  immediately: "Immediately",
  "1m": "After 1 minute",
  "5m": "After 5 minutes",
  "30m": "After 30 minutes",
};

export type AppLockPreferences = {
  enabled: boolean;
  threshold: RelockThreshold;
};

export const DEFAULT_APP_LOCK_PREFERENCES: AppLockPreferences = {
  enabled: false,
  threshold: "immediately",
};

const STORE_KEY = "solence_app_lock_prefs_v1";

export function thresholdToMs(threshold: RelockThreshold): number {
  switch (threshold) {
    case "immediately":
      return 0;
    case "1m":
      return 60 * 1000;
    case "5m":
      return 5 * 60 * 1000;
    case "30m":
      return 30 * 60 * 1000;
  }
}

function isWeb(): boolean {
  return Platform.OS === "web";
}

export async function loadAppLockPreferences(): Promise<AppLockPreferences> {
  if (isWeb()) {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return { ...DEFAULT_APP_LOCK_PREFERENCES };
      return parsePreferences(raw);
    } catch {
      return { ...DEFAULT_APP_LOCK_PREFERENCES };
    }
  }
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return { ...DEFAULT_APP_LOCK_PREFERENCES };
    return parsePreferences(raw);
  } catch {
    return { ...DEFAULT_APP_LOCK_PREFERENCES };
  }
}

export async function saveAppLockPreferences(
  prefs: AppLockPreferences,
): Promise<void> {
  const serialized = JSON.stringify(prefs);
  if (isWeb()) {
    try {
      window.localStorage.setItem(STORE_KEY, serialized);
    } catch {
      // ignore storage failures on web (private mode, quota)
    }
    return;
  }
  await SecureStore.setItemAsync(STORE_KEY, serialized);
}

function parsePreferences(raw: string): AppLockPreferences {
  try {
    const parsed = JSON.parse(raw) as Partial<AppLockPreferences>;
    const enabled = parsed.enabled === true;
    const threshold: RelockThreshold = RELOCK_OPTIONS.includes(
      parsed.threshold as RelockThreshold,
    )
      ? (parsed.threshold as RelockThreshold)
      : "immediately";
    return { enabled, threshold };
  } catch {
    return { ...DEFAULT_APP_LOCK_PREFERENCES };
  }
}
