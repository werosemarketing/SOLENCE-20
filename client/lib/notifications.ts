import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import {
  DEFAULT_REMINDER_TIME,
  DEFAULT_WEEKLY_SUMMARY_DAY,
  DEFAULT_WEEKLY_SUMMARY_TIME,
  TIME_OF_DAY_PATTERN,
  type Language,
} from "@shared/schema";

// Stable identifiers so re-scheduling automatically replaces the prior
// scheduled notification — Expo cancels by id, no manual cleanup needed.
export const DAILY_REMINDER_ID = "solence-daily-reminder";
export const WEEKLY_SUMMARY_ID = "solence-weekly-summary";

// Categories embedded in the notification payload so the response listener
// in App/RootStackNavigator can route the user to the right place.
export const NOTIFICATION_CATEGORIES = {
  dailyReminder: "solence.daily_reminder",
  weeklySummary: "solence.weekly_summary",
} as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[keyof typeof NOTIFICATION_CATEGORIES];

export type NotificationCopy = {
  title: string;
  body: string;
};

// Foreground behavior: while the app is in the foreground, surface the
// banner + play the soft sound so a user who opted in still notices the
// gentle nudge even if they happen to be using Solence at that moment.
let foregroundHandlerInstalled = false;
function ensureForegroundHandler() {
  if (foregroundHandlerInstalled) return;
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  foregroundHandlerInstalled = true;
}

export function isNotificationsSupported(): boolean {
  return Platform.OS !== "web";
}

export function parseTimeOfDay(value: string | null | undefined): {
  hour: number;
  minute: number;
} {
  if (typeof value === "string" && TIME_OF_DAY_PATTERN.test(value)) {
    const [h, m] = value.split(":");
    return { hour: Number(h), minute: Number(m) };
  }
  const [h, m] = DEFAULT_REMINDER_TIME.split(":");
  return { hour: Number(h), minute: Number(m) };
}

// Format a stored "HH:MM" 24-hour string into a localized clock label
// (e.g., "8:00 PM" in en-US). Falls back to the raw value if Intl barfs.
export function formatTimeOfDayLabel(
  value: string,
  locale: string | undefined,
): string {
  const { hour, minute } = parseTimeOfDay(value);
  try {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

// Ask for OS permission. ONLY call from an opt-in user gesture per task
// brief — never at app launch. Web returns a synthetic "denied" so the UI
// can render its disabled state without throwing.
export async function requestNotificationPermissionsAsync(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  if (Platform.OS === "web") {
    return { granted: false, canAskAgain: false };
  }
  ensureForegroundHandler();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") {
    return { granted: true, canAskAgain: existing.canAskAgain ?? true };
  }
  if (!existing.canAskAgain) {
    return { granted: false, canAskAgain: false };
  }
  const result = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });
  return {
    granted: result.status === "granted",
    canAskAgain: result.canAskAgain ?? false,
  };
}

// Default copy used when the caller doesn't pass language-specific strings
// (e.g., a fresh install with no i18n in scope yet).
const DEFAULT_DAILY_COPY: Record<Language, NotificationCopy> = {
  en: {
    title: "A quiet moment with Solence",
    body: "When you're ready, I'm here.",
  },
  es: {
    title: "Un momento tranquilo con Solence",
    body: "Cuando quieras, aquí estoy.",
  },
};

const DEFAULT_WEEKLY_COPY: Record<Language, NotificationCopy> = {
  en: {
    title: "Your week with Solence",
    body: "A gentle look back at your reflections this week.",
  },
  es: {
    title: "Tu semana con Solence",
    body: "Una mirada suave a tus reflexiones de esta semana.",
  },
};

function copyForCategory(
  category: NotificationCategory,
  language: Language | null | undefined,
  override: NotificationCopy | null | undefined,
): NotificationCopy {
  if (override) return override;
  const lang: Language =
    language === "es" || language === "en" ? language : "en";
  return category === NOTIFICATION_CATEGORIES.dailyReminder
    ? DEFAULT_DAILY_COPY[lang]
    : DEFAULT_WEEKLY_COPY[lang];
}

export async function scheduleDailyReminder(
  time: string,
  language: Language | null | undefined,
  copy?: NotificationCopy,
): Promise<boolean> {
  if (Platform.OS === "web") return false;
  ensureForegroundHandler();
  const { hour, minute } = parseTimeOfDay(time);
  // Cancel any prior schedule under our stable id so this becomes a true
  // "replace" rather than stacking duplicates.
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
  } catch {
    // No existing schedule — fine.
  }
  const text = copyForCategory(
    NOTIFICATION_CATEGORIES.dailyReminder,
    language,
    copy,
  );
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER_ID,
    content: {
      title: text.title,
      body: text.body,
      sound: "default",
      data: { category: NOTIFICATION_CATEGORIES.dailyReminder },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour,
      minute,
      repeats: true,
    },
  });
  return true;
}

export async function cancelDailyReminder(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID);
  } catch {
    // Already gone — fine.
  }
}

// expo-notifications uses a 1=Sunday … 7=Saturday weekday convention for
// calendar triggers, while our schema follows JS's getDay() (0=Sun…6=Sat).
function toExpoWeekday(day: number): number {
  const safe = Number.isFinite(day) ? Math.floor(day) : DEFAULT_WEEKLY_SUMMARY_DAY;
  return (((safe % 7) + 7) % 7) + 1;
}

export async function scheduleWeeklySummary(
  day: number,
  time: string,
  language: Language | null | undefined,
  copy?: NotificationCopy,
): Promise<boolean> {
  if (Platform.OS === "web") return false;
  ensureForegroundHandler();
  const { hour, minute } = parseTimeOfDay(time || DEFAULT_WEEKLY_SUMMARY_TIME);
  const weekday = toExpoWeekday(day);
  try {
    await Notifications.cancelScheduledNotificationAsync(WEEKLY_SUMMARY_ID);
  } catch {
    // No existing schedule.
  }
  const text = copyForCategory(
    NOTIFICATION_CATEGORIES.weeklySummary,
    language,
    copy,
  );
  await Notifications.scheduleNotificationAsync({
    identifier: WEEKLY_SUMMARY_ID,
    content: {
      title: text.title,
      body: text.body,
      sound: "default",
      data: { category: NOTIFICATION_CATEGORIES.weeklySummary },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      weekday,
      hour,
      minute,
      repeats: true,
    },
  });
  return true;
}

export async function cancelWeeklySummary(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(WEEKLY_SUMMARY_ID);
  } catch {
    // Already gone — fine.
  }
}

// Convenience: pull the category out of a notification response payload so
// the navigation listener can branch without touching expo-notifications
// internals. Returns null when there's no recognizable category.
export function categoryFromResponse(
  response: Notifications.NotificationResponse | null | undefined,
): NotificationCategory | null {
  const data = response?.notification?.request?.content?.data;
  const raw = (data as { category?: unknown } | undefined)?.category;
  if (
    raw === NOTIFICATION_CATEGORIES.dailyReminder ||
    raw === NOTIFICATION_CATEGORIES.weeklySummary
  ) {
    return raw;
  }
  return null;
}

// Re-installs the foreground handler so the App can wire it up at boot
// without exposing the internal `ensureForegroundHandler`.
export function configureNotificationsForApp(): void {
  ensureForegroundHandler();
}
