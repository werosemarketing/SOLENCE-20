import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Linking from "expo-linking";
import * as LocalAuthentication from "expo-local-authentication";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RenameDialog } from "@/components/RenameDialog";
import { PersonalizationDialog } from "@/components/PersonalizationDialog";
import { MessageActionSheet } from "@/components/MessageActionSheet";
import { ShareQuoteModal } from "@/components/ShareQuoteModal";
import {
  TimePickerModal,
  openAndroidTimePicker,
} from "@/components/TimePickerModal";
import { ThemedText } from "@/components/ThemedText";
import {
  DEFAULT_APP_LOCK_PREFERENCES,
  RELOCK_LABELS,
  RELOCK_OPTIONS,
  loadAppLockPreferences,
  saveAppLockPreferences,
  type AppLockPreferences,
  type RelockThreshold,
} from "@/lib/app-lock";
import { useTheme } from "@/hooks/useTheme";
import {
  TEXT_SCALE_OPTIONS,
  useTextScale,
  type TextScaleId,
} from "@/hooks/useTextScale";
import {
  Spacing,
  BorderRadius,
  Typography,
  fontForWeight,
} from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import { displayConversationTitle } from "@/lib/conversation-title";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_VOICE,
  EMPTY_PREFERENCES,
  INTENT_LABELS,
  LANGUAGES,
  LANGUAGE_LABELS,
  TONE_LABELS,
  VOICES,
  VOICE_DESCRIPTIONS,
  VOICE_LABELS,
  type ClientPreferences,
} from "@/lib/preferences";
import { setAppLanguage } from "@/lib/i18n";
import {
  cancelDailyReminder,
  cancelWeeklySummary,
  formatTimeOfDayLabel,
  isNotificationsSupported,
  requestNotificationPermissionsAsync,
  scheduleDailyReminder,
  scheduleWeeklySummary,
} from "@/lib/notifications";
import {
  USER_MEMORY_TEXT_MAX_LEN,
  type Intent,
  type Language,
  type Tone,
  type Voice,
} from "@shared/schema";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const REMINDER_TIME_OPTIONS = [
  "07:00",
  "12:00",
  "18:00",
  "19:00",
  "20:00",
  "22:00",
];
const WEEKLY_DAY_OPTIONS = [0, 1, 2, 3, 4, 5, 6];

// Identifies the picker target so a single TimePickerModal can drive both
// the daily reminder and weekly summary cards.
type TimePickerTarget = "reminder" | "weekly";

// Best-effort detection of whether the user's locale formats clock times
// in 24-hour notation. Used to pre-configure the native time picker so
// early risers / night-shift folks see the format they expect.
function isLocale24Hour(locale: string | undefined): boolean {
  try {
    const sample = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).format(new Date(2020, 0, 1, 13, 0, 0));
    return !/AM|PM|a\.\s?m\.|p\.\s?m\./i.test(sample);
  } catch {
    return false;
  }
}

// Convert a stored "HH:MM" 24-hour string into a Date so we can hand it to
// @react-native-community/datetimepicker as its initial value.
function timeStringToDate(value: string): Date {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value ?? "");
  const hour = match ? Number(match[1]) : 20;
  const minute = match ? Number(match[2]) : 0;
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

// Format a Date as the canonical 24-hour "HH:MM" string we persist
// server-side and hand to the local notification scheduler.
function dateToTimeString(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

const STORAGE_KEY_AUTH_TOKEN = "solence_auth_token";
const HISTORY_DAYS = 7;

// Convert a binary response (the export zip) to base64 so we can hand it to
// expo-file-system on native. We do this in 32 KB chunks because passing a
// huge byte array straight to String.fromCharCode(...spread) blows the JS
// call-stack limit on large archives.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(
      null,
      Array.from(chunk) as unknown as number[],
    );
  }
  return globalThis.btoa(binary);
}

const DEFAULT_TOKEN_LIMIT = 15000;
const RECENT_CONVERSATIONS_LIMIT = 10;

type HistoryEntry = {
  periodStart: string;
  tokensUsed: number;
};

type HistoryResponse = {
  days: number;
  tokenLimit: number;
  period: string;
  history: HistoryEntry[];
};

type ConversationListItem = {
  id: number;
  title: string;
  createdAt: string;
  messageCount: number;
  lastMessage: {
    role: string;
    content: string;
    createdAt: string;
  } | null;
  reflectionSummary?: string | null;
  reflectionTakeaway?: string | null;
  reflectionGeneratedAt?: string | null;
};

type ConversationsResponse = {
  conversations: ConversationListItem[];
};

type MoodEntry = {
  id: number;
  phase: "pre" | "post";
  score: number;
  conversationId: number | null;
  createdAt: string;
};

type MoodResponse = {
  days: number;
  entries: MoodEntry[];
};

// Shape returned by GET /api/referrals — what the invite card needs in
// a single round trip.
type ReferralResponse = {
  code: string;
  shareUrl: string;
  joinedCount: number;
  activeCredit: { endsAt: string } | null;
};

const MOOD_LABELS: Record<number, string> = {
  1: "rough",
  2: "low",
  3: "okay",
  4: "good",
  5: "great",
};

type SavedMoment = {
  id: number;
  messageId: number;
  favoritedAt: string;
  message: {
    role: string;
    content: string;
    createdAt: string;
  };
  conversation: {
    id: number;
    title: string;
    createdAt: string;
  };
};

type FavoritesResponse = {
  favorites: SavedMoment[];
};

type Memory = {
  id: number;
  text: string;
  sourceConversationId: number | null;
  createdAt: string;
  // Joined from the originating conversation server-side. Null when the
  // source conversation no longer exists (the FK is `set null` on delete)
  // or when the memory was extracted without a source — those rows render
  // without a "From a chat on …" link.
  sourceConversation: {
    id: number;
    title: string | null;
    createdAt: string;
  } | null;
};

type MemoriesResponse = {
  memories: Memory[];
};

const SAVED_MOMENTS_LIMIT = 10;
const SAVED_MOMENT_SNIPPET_MAX_LEN = 220;

function snippetForMoment(content: string): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= SAVED_MOMENT_SNIPPET_MAX_LEN) return trimmed;
  const sliced = trimmed.slice(0, SAVED_MOMENT_SNIPPET_MAX_LEN);
  const lastSpace = sliced.lastIndexOf(" ");
  const cutoff =
    lastSpace > SAVED_MOMENT_SNIPPET_MAX_LEN * 0.7
      ? lastSpace
      : sliced.length;
  return `${sliced.slice(0, cutoff).trimEnd()}…`;
}

// Cache the most recent preview blob URL on web so we can revoke it before
// creating a new one — otherwise we leak object URLs every time the user
// previews a different voice.
let voicePreviewBlobUrl: string | null = null;

async function savePreviewAudio(base64: string): Promise<string> {
  if (Platform.OS === "web") {
    if (voicePreviewBlobUrl) {
      try {
        URL.revokeObjectURL(voicePreviewBlobUrl);
      } catch {
        // ignore revoke errors
      }
    }
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      bytes[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "audio/mp3" });
    voicePreviewBlobUrl = URL.createObjectURL(blob);
    return voicePreviewBlobUrl;
  }
  const fileUri =
    FileSystem.cacheDirectory + `solence_voice_preview_${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}

function formatTokens(value: number): string {
  if (value >= 10000) return `${(value / 1000).toFixed(0)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${value}`;
}

function formatDayLabel(
  iso: string,
  isToday: boolean,
  t: (key: string) => string,
  locale?: string,
): string {
  if (isToday) return t("time.today");
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { weekday: "short" });
}

function formatFullDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatRelativeTime(
  iso: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale?: string,
): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return t("time.now");
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return t("time.minutesAgoShort", { count: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t("time.hoursAgoShort", { count: diffHr });
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return t("time.daysAgoShort", { count: diffDay });
  const d = new Date(iso);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const { scaleId: textScaleId, setScaleId: setTextScaleId } = useTextScale();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [tokenLimit, setTokenLimit] = useState<number>(DEFAULT_TOKEN_LIMIT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<
    ConversationListItem[] | null
  >(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] =
    useState<ConversationListItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingRename, setPendingRename] =
    useState<ConversationListItem | null>(null);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // "Saved moments" card state. Loads on focus alongside conversations so
  // bookmarks the user just toggled inside ConversationDetail are reflected
  // when they swipe back to the Profile tab.
  const [savedMoments, setSavedMoments] = useState<SavedMoment[] | null>(
    null,
  );
  const [savedMomentsLoading, setSavedMomentsLoading] = useState(true);
  const [savedMomentsError, setSavedMomentsError] = useState<string | null>(
    null,
  );
  const [unfavoritingId, setUnfavoritingId] = useState<number | null>(null);
  const [savedMomentActionError, setSavedMomentActionError] = useState<
    string | null
  >(null);
  // Long-press / share state for the saved-moments rows. Mirrors the same
  // pattern used in ConversationDetail so the action sheet and share modal
  // behave consistently across surfaces.
  const [actionSheetMoment, setActionSheetMoment] =
    useState<SavedMoment | null>(null);
  const [shareQuoteMoment, setShareQuoteMoment] =
    useState<SavedMoment | null>(null);

  // 7-day mood window powering the "Mood this week" card. Loaded on
  // focus so post-session entries created during a chat are reflected
  // when the user swipes back to the Profile tab.
  const [moodEntries, setMoodEntries] = useState<MoodEntry[] | null>(null);
  const [moodLoading, setMoodLoading] = useState(true);
  const [moodError, setMoodError] = useState<string | null>(null);

  // Long-term memory card state. The list is bounded server-side
  // (USER_MEMORY_MAX_PER_USER) so we don't paginate. Per-row delete +
  // a "clear all" confirmation are the user's controls. Errors degrade
  // to inline text under the card title so a flaky network can't block
  // the rest of Profile.
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const [memoryRemovingId, setMemoryRemovingId] = useState<number | null>(
    null,
  );
  const [memoryActionError, setMemoryActionError] = useState<string | null>(
    null,
  );
  const [showClearMemoriesConfirm, setShowClearMemoriesConfirm] =
    useState(false);
  const [clearMemoriesSubmitting, setClearMemoriesSubmitting] = useState(false);
  // In-place edit state for individual memories. The dialog opens when
  // `pendingEditMemory` is non-null; submitting calls PATCH /api/memories/:id
  // and replaces the row in state with the server-clamped text on success.
  const [pendingEditMemory, setPendingEditMemory] = useState<Memory | null>(
    null,
  );
  const [editMemorySubmitting, setEditMemorySubmitting] = useState(false);
  const [editMemoryError, setEditMemoryError] = useState<string | null>(null);

  // "Invite a friend" card state. Lazily loaded — failures degrade the
  // card to a quiet error message instead of blocking the rest of
  // Profile, since referrals are an optional feature.
  const [referral, setReferral] = useState<ReferralResponse | null>(null);
  const [referralLoading, setReferralLoading] = useState(true);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareInFlight, setShareInFlight] = useState(false);

  const [preferences, setPreferences] =
    useState<ClientPreferences>(EMPTY_PREFERENCES);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [showPersonalization, setShowPersonalization] = useState(false);
  const [personalizationSaving, setPersonalizationSaving] = useState(false);
  const [personalizationError, setPersonalizationError] = useState<
    string | null
  >(null);

  // Notifications (daily reminder + weekly summary) state. Saving is
  // optimistic against /api/preferences and the local schedule is
  // (re-)installed on opt-in / time change. On web everything is
  // disabled and we render a helper note pointing to Expo Go.
  const [notificationsSaving, setNotificationsSaving] = useState<
    "reminder" | "weekly" | null
  >(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [notificationsBlocked, setNotificationsBlocked] = useState(false);

  // Which custom-time picker (if any) is currently open. Drives the iOS
  // modal's `visible` prop. On Android the picker is fully imperative
  // (DateTimePickerAndroid.open) and never sets this state.
  const [timePickerTarget, setTimePickerTarget] =
    useState<TimePickerTarget | null>(null);

  // "Solence's voice" picker state. Selection saves immediately on tap;
  // preview hits a separate rate-limited endpoint and plays via expo-audio.
  const [voiceSaving, setVoiceSaving] = useState<Voice | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<Voice | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState<Voice | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewPlayer = useAudioPlayer("");
  const previewPlayingRef = useRef<Voice | null>(null);

  // "Your data" export state. The button shows a brief inline status while
  // the zip is being built and shared. Errors (including the 5-min rate
  // limit) are surfaced beneath the button rather than in a modal.
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Privacy & Lock state. Mirrors expo-secure-store-backed prefs and
  // talks to expo-local-authentication for the disable-time
  // re-authentication step. On web the section is rendered but
  // disabled — biometrics aren't available there.
  const [appLockPrefs, setAppLockPrefs] = useState<AppLockPreferences>(
    DEFAULT_APP_LOCK_PREFERENCES,
  );
  const [appLockLoading, setAppLockLoading] = useState(true);
  const [appLockSaving, setAppLockSaving] = useState(false);
  const [appLockError, setAppLockError] = useState<string | null>(null);
  const [biometricSupported, setBiometricSupported] = useState<boolean | null>(
    null,
  );

  // "Language" picker state — mirrors the voice picker's optimistic save +
  // rollback pattern. The selected language is also persisted to
  // AsyncStorage and pushed into i18next so the UI re-renders in the new
  // language without a reload.
  const [languageSaving, setLanguageSaving] = useState<Language | null>(null);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const loadPreferences = useCallback(async (signal?: AbortSignal) => {
    try {
      setPreferencesLoading(true);
      setPreferencesError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/preferences`, {
        headers,
        signal,
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const data = (await response.json()) as { preferences: ClientPreferences };
      if (signal?.aborted) return;
      setPreferences({
        displayName: data.preferences.displayName ?? null,
        intents: data.preferences.intents ?? [],
        tone: data.preferences.tone ?? null,
        voice: data.preferences.voice ?? null,
        language: data.preferences.language ?? null,
        reminderEnabled: data.preferences.reminderEnabled ?? false,
        reminderTime: data.preferences.reminderTime ?? "20:00",
        weeklySummaryEnabled: data.preferences.weeklySummaryEnabled ?? false,
        weeklySummaryDay:
          typeof data.preferences.weeklySummaryDay === "number"
            ? data.preferences.weeklySummaryDay
            : 0,
        weeklySummaryTime: data.preferences.weeklySummaryTime ?? "19:00",
        onboardingCompletedAt: data.preferences.onboardingCompletedAt ?? null,
      });
    } catch (e) {
      if (signal?.aborted) return;
      const message =
        e instanceof Error ? e.message : "Could not load personalization";
      setPreferencesError(message);
    } finally {
      if (!signal?.aborted) setPreferencesLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadPreferences(controller.signal);
    return () => controller.abort();
  }, [loadPreferences]);

  // Load app-lock prefs + biometric capability on mount. Web is hardwired
  // to "no biometrics" — there's no real device to authenticate with.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await loadAppLockPreferences();
        if (cancelled) return;
        setAppLockPrefs(prefs);
        if (Platform.OS === "web") {
          setBiometricSupported(false);
        } else {
          try {
            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            const enrolled = await LocalAuthentication.isEnrolledAsync();
            if (!cancelled) setBiometricSupported(hasHardware && enrolled);
          } catch {
            if (!cancelled) setBiometricSupported(false);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setAppLockError(
            e instanceof Error
              ? e.message
              : "Could not load lock preferences",
          );
        }
      } finally {
        if (!cancelled) setAppLockLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Toggle app-lock on/off. Turning ON only requires that the device
  // can authenticate — we don't immediately lock the user out of the
  // session they're already in. Turning OFF requires a successful
  // local auth step first so a stranger holding the unlocked phone
  // can't simply flip the protection off.
  const handleToggleAppLock = useCallback(
    async (next: boolean) => {
      if (appLockSaving || appLockLoading) return;
      if (Platform.OS === "web") return;
      setAppLockError(null);

      if (next) {
        // Enabling: confirm hardware + enrollment, then save.
        try {
          setAppLockSaving(true);
          const hasHardware = await LocalAuthentication.hasHardwareAsync();
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          if (!hasHardware) {
            setAppLockError(
              "This device doesn't support Face ID, Touch ID, or a passcode lock.",
            );
            return;
          }
          if (!enrolled) {
            setAppLockError(
              "Set up Face ID, Touch ID, or a device passcode first, then try again.",
            );
            return;
          }
          const updated: AppLockPreferences = {
            ...appLockPrefs,
            enabled: true,
          };
          await saveAppLockPreferences(updated);
          setAppLockPrefs(updated);
          setBiometricSupported(true);
        } catch (e) {
          setAppLockError(
            e instanceof Error ? e.message : "Could not enable app lock",
          );
        } finally {
          setAppLockSaving(false);
        }
        return;
      }

      // Disabling: re-authenticate first, then save.
      try {
        setAppLockSaving(true);
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Confirm to turn off the Solence lock",
          disableDeviceFallback: false,
          cancelLabel: "Cancel",
        });
        if (!result.success) {
          setAppLockError(
            "Authentication required to turn off the lock. Please try again.",
          );
          return;
        }
        const updated: AppLockPreferences = {
          ...appLockPrefs,
          enabled: false,
        };
        await saveAppLockPreferences(updated);
        setAppLockPrefs(updated);
      } catch (e) {
        setAppLockError(
          e instanceof Error ? e.message : "Could not turn off app lock",
        );
      } finally {
        setAppLockSaving(false);
      }
    },
    [appLockPrefs, appLockLoading, appLockSaving],
  );

  // Choose a re-lock threshold. We persist immediately — there's no
  // separate "save" affordance. Disabled when the lock itself is off,
  // since the value would be meaningless.
  const handleSelectRelock = useCallback(
    async (threshold: RelockThreshold) => {
      if (appLockSaving) return;
      if (!appLockPrefs.enabled) return;
      if (appLockPrefs.threshold === threshold) return;
      const previous = appLockPrefs;
      setAppLockPrefs({ ...appLockPrefs, threshold });
      try {
        setAppLockSaving(true);
        setAppLockError(null);
        await saveAppLockPreferences({ ...appLockPrefs, threshold });
      } catch (e) {
        setAppLockPrefs(previous);
        setAppLockError(
          e instanceof Error ? e.message : "Could not save lock timing",
        );
      } finally {
        setAppLockSaving(false);
      }
    },
    [appLockPrefs, appLockSaving],
  );

  // Persist a partial preferences update with the same optimistic-then-
  // rollback pattern used by the voice / language pickers. Returns true
  // when the server confirms the write so callers can chain the local
  // notification (re)scheduling on success only.
  const persistPreferenceUpdate = useCallback(
    async (
      patch: Partial<ClientPreferences>,
    ): Promise<{ ok: true; data: ClientPreferences } | { ok: false; message: string }> => {
      try {
        const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const apiUrl = getApiUrl();
        const response = await fetch(`${apiUrl}/api/preferences`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(patch),
        });
        if (!response.ok) {
          let message = `Couldn't save (${response.status})`;
          try {
            const data = await response.json();
            if (data && typeof data.error === "string") message = data.error;
          } catch {
            // ignore parse failure
          }
          return { ok: false, message };
        }
        const payload = (await response.json()) as {
          preferences: ClientPreferences;
        };
        return { ok: true, data: payload.preferences };
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Network error",
        };
      }
    },
    [],
  );

  // Toggle the daily reminder. Permission is requested only on opt-in
  // (per task brief). On opt-out we cancel the scheduled notification
  // first so a stale entry doesn't continue firing if the server save
  // round-trip fails — better to be silent than to nag.
  const handleToggleReminder = useCallback(
    async (next: boolean) => {
      if (notificationsSaving) return;
      if (Platform.OS === "web") return;
      const previous = preferences.reminderEnabled;
      if (previous === next) return;
      setReminderError(null);
      setNotificationsSaving("reminder");

      // Optimistic UI update.
      setPreferences((p) => ({ ...p, reminderEnabled: next }));

      try {
        if (next) {
          const perm = await requestNotificationPermissionsAsync();
          if (!perm.granted) {
            setPreferences((p) => ({ ...p, reminderEnabled: previous }));
            setReminderError(t("profile.reminders.errorPermission"));
            setNotificationsBlocked(!perm.canAskAgain);
            return;
          }
          setNotificationsBlocked(false);
          const result = await persistPreferenceUpdate({
            reminderEnabled: true,
            reminderTime: preferences.reminderTime,
          });
          if (!result.ok) {
            setPreferences((p) => ({ ...p, reminderEnabled: previous }));
            setReminderError(result.message);
            return;
          }
          await scheduleDailyReminder(preferences.reminderTime, preferences.language, {
            title: t("profile.reminders.notificationTitle"),
            body: t("profile.reminders.notificationBody"),
          });
        } else {
          // Cancel locally first so silence is immediate even if the
          // network blip flips the optimistic update back.
          await cancelDailyReminder();
          const result = await persistPreferenceUpdate({
            reminderEnabled: false,
          });
          if (!result.ok) {
            // Re-schedule to restore previous behavior since save failed.
            setPreferences((p) => ({ ...p, reminderEnabled: previous }));
            setReminderError(result.message);
            await scheduleDailyReminder(preferences.reminderTime, preferences.language, {
              title: t("profile.reminders.notificationTitle"),
              body: t("profile.reminders.notificationBody"),
            }).catch(() => {});
            return;
          }
        }
      } finally {
        setNotificationsSaving(null);
      }
    },
    [
      notificationsSaving,
      preferences.reminderEnabled,
      preferences.reminderTime,
      preferences.language,
      persistPreferenceUpdate,
      t,
    ],
  );

  // Choose a reminder time chip. Saves the new time immediately. When
  // reminders are off, the tap simply records the preference (so the
  // chip the user just picked persists for when they later opt in).
  const handleSelectReminderTime = useCallback(
    async (time: string) => {
      if (notificationsSaving) return;
      if (Platform.OS === "web") return;
      if (preferences.reminderTime === time) return;
      const previous = preferences.reminderTime;
      setReminderError(null);
      setNotificationsSaving("reminder");
      setPreferences((p) => ({ ...p, reminderTime: time }));
      try {
        const result = await persistPreferenceUpdate({ reminderTime: time });
        if (!result.ok) {
          setPreferences((p) => ({ ...p, reminderTime: previous }));
          setReminderError(result.message);
          return;
        }
        if (preferences.reminderEnabled) {
          await scheduleDailyReminder(time, preferences.language, {
            title: t("profile.reminders.notificationTitle"),
            body: t("profile.reminders.notificationBody"),
          });
        }
      } finally {
        setNotificationsSaving(null);
      }
    },
    [
      notificationsSaving,
      preferences.reminderTime,
      preferences.reminderEnabled,
      preferences.language,
      persistPreferenceUpdate,
      t,
    ],
  );

  // Toggle the weekly summary notification. Mirrors the daily reminder
  // handler — permission on opt-in, cancel-first on opt-out.
  const handleToggleWeeklySummary = useCallback(
    async (next: boolean) => {
      if (notificationsSaving) return;
      if (Platform.OS === "web") return;
      const previous = preferences.weeklySummaryEnabled;
      if (previous === next) return;
      setWeeklyError(null);
      setNotificationsSaving("weekly");
      setPreferences((p) => ({ ...p, weeklySummaryEnabled: next }));
      try {
        if (next) {
          const perm = await requestNotificationPermissionsAsync();
          if (!perm.granted) {
            setPreferences((p) => ({ ...p, weeklySummaryEnabled: previous }));
            setWeeklyError(t("profile.weeklySummary.errorPermission"));
            setNotificationsBlocked(!perm.canAskAgain);
            return;
          }
          setNotificationsBlocked(false);
          const result = await persistPreferenceUpdate({
            weeklySummaryEnabled: true,
            weeklySummaryDay: preferences.weeklySummaryDay,
            weeklySummaryTime: preferences.weeklySummaryTime,
          });
          if (!result.ok) {
            setPreferences((p) => ({ ...p, weeklySummaryEnabled: previous }));
            setWeeklyError(result.message);
            return;
          }
          await scheduleWeeklySummary(
            preferences.weeklySummaryDay,
            preferences.weeklySummaryTime,
            preferences.language,
            {
              title: t("profile.weeklySummary.notificationTitle"),
              body: t("profile.weeklySummary.notificationBody"),
            },
          );
        } else {
          await cancelWeeklySummary();
          const result = await persistPreferenceUpdate({
            weeklySummaryEnabled: false,
          });
          if (!result.ok) {
            setPreferences((p) => ({ ...p, weeklySummaryEnabled: previous }));
            setWeeklyError(result.message);
            await scheduleWeeklySummary(
              preferences.weeklySummaryDay,
              preferences.weeklySummaryTime,
              preferences.language,
              {
                title: t("profile.weeklySummary.notificationTitle"),
                body: t("profile.weeklySummary.notificationBody"),
              },
            ).catch(() => {});
            return;
          }
        }
      } finally {
        setNotificationsSaving(null);
      }
    },
    [
      notificationsSaving,
      preferences.weeklySummaryEnabled,
      preferences.weeklySummaryDay,
      preferences.weeklySummaryTime,
      preferences.language,
      persistPreferenceUpdate,
      t,
    ],
  );

  const handleSelectWeeklyDay = useCallback(
    async (day: number) => {
      if (notificationsSaving) return;
      if (Platform.OS === "web") return;
      if (preferences.weeklySummaryDay === day) return;
      const previous = preferences.weeklySummaryDay;
      setWeeklyError(null);
      setNotificationsSaving("weekly");
      setPreferences((p) => ({ ...p, weeklySummaryDay: day }));
      try {
        const result = await persistPreferenceUpdate({ weeklySummaryDay: day });
        if (!result.ok) {
          setPreferences((p) => ({ ...p, weeklySummaryDay: previous }));
          setWeeklyError(result.message);
          return;
        }
        if (preferences.weeklySummaryEnabled) {
          await scheduleWeeklySummary(
            day,
            preferences.weeklySummaryTime,
            preferences.language,
            {
              title: t("profile.weeklySummary.notificationTitle"),
              body: t("profile.weeklySummary.notificationBody"),
            },
          );
        }
      } finally {
        setNotificationsSaving(null);
      }
    },
    [
      notificationsSaving,
      preferences.weeklySummaryDay,
      preferences.weeklySummaryEnabled,
      preferences.weeklySummaryTime,
      preferences.language,
      persistPreferenceUpdate,
      t,
    ],
  );

  const handleSelectWeeklyTime = useCallback(
    async (time: string) => {
      if (notificationsSaving) return;
      if (Platform.OS === "web") return;
      if (preferences.weeklySummaryTime === time) return;
      const previous = preferences.weeklySummaryTime;
      setWeeklyError(null);
      setNotificationsSaving("weekly");
      setPreferences((p) => ({ ...p, weeklySummaryTime: time }));
      try {
        const result = await persistPreferenceUpdate({ weeklySummaryTime: time });
        if (!result.ok) {
          setPreferences((p) => ({ ...p, weeklySummaryTime: previous }));
          setWeeklyError(result.message);
          return;
        }
        if (preferences.weeklySummaryEnabled) {
          await scheduleWeeklySummary(
            preferences.weeklySummaryDay,
            time,
            preferences.language,
            {
              title: t("profile.weeklySummary.notificationTitle"),
              body: t("profile.weeklySummary.notificationBody"),
            },
          );
        }
      } finally {
        setNotificationsSaving(null);
      }
    },
    [
      notificationsSaving,
      preferences.weeklySummaryTime,
      preferences.weeklySummaryDay,
      preferences.weeklySummaryEnabled,
      preferences.language,
      persistPreferenceUpdate,
      t,
    ],
  );

  // Opens the native time picker for the requested target. On Android the
  // picker is fully imperative — the dialog appears on the spot and we hand
  // the chosen time back to the same persistence path as the preset chips.
  // On iOS we just flip state so a Modal-rendered DateTimePicker mounts.
  const openCustomTimePicker = useCallback(
    (target: TimePickerTarget) => {
      if (Platform.OS === "web") return;
      if (notificationsSaving) return;
      if (preferencesLoading) return;
      const is24Hour = isLocale24Hour(locale);
      if (Platform.OS === "android") {
        const initial =
          target === "reminder"
            ? preferences.reminderTime
            : preferences.weeklySummaryTime;
        openAndroidTimePicker({
          value: timeStringToDate(initial),
          is24Hour,
          onSelect: (date) => {
            const formatted = dateToTimeString(date);
            if (target === "reminder") {
              void handleSelectReminderTime(formatted);
            } else {
              void handleSelectWeeklyTime(formatted);
            }
          },
        });
        return;
      }
      setTimePickerTarget(target);
    },
    [
      notificationsSaving,
      preferencesLoading,
      locale,
      preferences.reminderTime,
      preferences.weeklySummaryTime,
      handleSelectReminderTime,
      handleSelectWeeklyTime,
    ],
  );

  const handleConfirmCustomTime = useCallback(
    (date: Date) => {
      const target = timePickerTarget;
      setTimePickerTarget(null);
      if (!target) return;
      const formatted = dateToTimeString(date);
      if (target === "reminder") {
        void handleSelectReminderTime(formatted);
      } else {
        void handleSelectWeeklyTime(formatted);
      }
    },
    [timePickerTarget, handleSelectReminderTime, handleSelectWeeklyTime],
  );

  const handleCancelCustomTime = useCallback(() => {
    setTimePickerTarget(null);
  }, []);

  const handleOpenWeeklySummary = useCallback(() => {
    navigation.navigate("WeeklySummary", { weekOffset: 0 });
  }, [navigation]);

  const handleOpenSettings = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      await Linking.openSettings();
    } catch {
      // openSettings unavailable — quietly ignore
    }
  }, []);

  // Track when the preview finishes so we can flip the play indicator off.
  useEffect(() => {
    const subscription = previewPlayer.addListener(
      "playbackStatusUpdate",
      (status: { didJustFinish?: boolean }) => {
        if (status.didJustFinish) {
          previewPlayingRef.current = null;
          setPreviewPlaying(null);
        }
      },
    );
    return () => {
      subscription.remove();
    };
  }, [previewPlayer]);

  // Pause any in-flight preview when this screen unmounts so audio doesn't
  // keep playing in the background. On web, also revoke the cached blob URL
  // so we don't leak object URLs across screen lifetimes.
  useEffect(() => {
    return () => {
      try {
        previewPlayer.pause();
      } catch {
        // player may already be torn down
      }
      if (Platform.OS === "web" && voicePreviewBlobUrl) {
        try {
          URL.revokeObjectURL(voicePreviewBlobUrl);
        } catch {
          // ignore revoke errors
        }
        voicePreviewBlobUrl = null;
      }
    };
  }, [previewPlayer]);

  const handleSelectVoice = async (next: Voice) => {
    if (voiceSaving) return;
    // Don't let a tap race against the initial GET — the in-flight load
    // could otherwise overwrite the user's choice when it resolves.
    if (preferencesLoading) return;
    if ((preferences.voice ?? DEFAULT_VOICE) === next) return;
    const previous = preferences.voice;
    // Optimistic update so the row feels instant.
    setPreferences((p) => ({ ...p, voice: next }));
    setVoiceSaving(next);
    setVoiceError(null);
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ voice: next }),
      });
      if (!response.ok) {
        let message = `Couldn't save voice (${response.status})`;
        try {
          const data = await response.json();
          if (data && typeof data.error === "string") message = data.error;
        } catch {
          // ignore parse failure
        }
        throw new Error(message);
      }
      const data = (await response.json()) as {
        preferences: ClientPreferences;
      };
      setPreferences((p) => ({
        ...p,
        voice: data.preferences.voice ?? next,
      }));
    } catch (e) {
      // Roll back optimistic change so the UI matches what the server has.
      setPreferences((p) => ({ ...p, voice: previous }));
      setVoiceError(
        e instanceof Error ? e.message : "Could not save voice choice",
      );
    } finally {
      setVoiceSaving(null);
    }
  };

  const handleSelectLanguage = async (next: Language) => {
    if (languageSaving) return;
    // Same race-guard as the voice picker: don't fight the initial GET.
    if (preferencesLoading) return;
    if ((preferences.language ?? DEFAULT_LANGUAGE) === next) return;
    const previous = preferences.language;
    setPreferences((p) => ({ ...p, language: next }));
    setLanguageSaving(next);
    setLanguageError(null);
    // Switch the in-app language immediately so the rest of the UI feels
    // instant. If the server save fails we'll roll both back below.
    try {
      await setAppLanguage(next);
    } catch {
      // Non-fatal — i18n changeLanguage failure is rare and we still
      // attempt the server save.
    }
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ language: next }),
      });
      if (!response.ok) {
        let message =
          t("profile.language.errorGeneric") ??
          `Couldn't save language (${response.status})`;
        try {
          const data = await response.json();
          if (data && typeof data.error === "string") message = data.error;
        } catch {
          // ignore parse failure
        }
        throw new Error(message);
      }
      const data = (await response.json()) as {
        preferences: ClientPreferences;
      };
      setPreferences((p) => ({
        ...p,
        language: data.preferences.language ?? next,
      }));
    } catch (e) {
      // Roll back both the optimistic state change and the i18n switch.
      setPreferences((p) => ({ ...p, language: previous }));
      const fallback = previous ?? DEFAULT_LANGUAGE;
      try {
        await setAppLanguage(fallback);
      } catch {
        // ignore — error message below still surfaces.
      }
      setLanguageError(
        e instanceof Error ? e.message : t("profile.language.errorGeneric"),
      );
    } finally {
      setLanguageSaving(null);
    }
  };

  const handlePreviewVoice = async (voice: Voice) => {
    if (previewLoading) return;
    setPreviewError(null);
    // If the user taps preview on the voice currently playing, treat it as
    // a stop button.
    if (previewPlayingRef.current === voice) {
      try {
        previewPlayer.pause();
      } catch {
        // ignore
      }
      previewPlayingRef.current = null;
      setPreviewPlaying(null);
      return;
    }
    setPreviewLoading(voice);
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/voice-preview`, {
        method: "POST",
        headers,
        body: JSON.stringify({ voice }),
      });
      if (!response.ok) {
        let message = `Preview failed (${response.status})`;
        try {
          const data = await response.json();
          if (data && typeof data.error === "string") message = data.error;
        } catch {
          // ignore
        }
        throw new Error(message);
      }
      const data = (await response.json()) as {
        audioBase64: string;
        audioFormat: string;
      };
      if (!data.audioBase64) {
        throw new Error("No audio returned");
      }
      const uri = await savePreviewAudio(data.audioBase64);
      // Best-effort audio routing — same pattern SolenceScreen uses for
      // playback. Failure here is non-fatal; we still try to play.
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
        });
      } catch {
        // ignore
      }
      previewPlayer.replace(uri);
      previewPlayer.play();
      previewPlayingRef.current = voice;
      setPreviewPlaying(voice);
    } catch (e) {
      setPreviewError(
        e instanceof Error ? e.message : "Couldn't play that preview",
      );
    } finally {
      setPreviewLoading(null);
    }
  };

  const openPersonalization = () => {
    setPersonalizationError(null);
    setShowPersonalization(true);
  };

  const cancelPersonalization = () => {
    if (personalizationSaving) return;
    setShowPersonalization(false);
    setPersonalizationError(null);
  };

  const savePersonalization = async (next: {
    displayName: string | null;
    intents: Intent[];
    tone: Tone | null;
  }) => {
    if (personalizationSaving) return;
    try {
      setPersonalizationSaving(true);
      setPersonalizationError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          displayName: next.displayName,
          intents: next.intents,
          tone: next.tone,
        }),
      });
      if (!response.ok) {
        let message = `Couldn't save (${response.status})`;
        try {
          const data = await response.json();
          if (data && typeof data.error === "string") message = data.error;
        } catch {
          // ignore JSON parse failure
        }
        throw new Error(message);
      }
      const data = (await response.json()) as {
        preferences: ClientPreferences;
      };
      setPreferences((prev) => ({
        displayName: data.preferences.displayName ?? null,
        intents: data.preferences.intents ?? [],
        tone: data.preferences.tone ?? null,
        // Personalization PATCH doesn't touch voice — preserve whatever the
        // user already had selected so the voice picker UI stays in sync.
        voice: data.preferences.voice ?? prev.voice ?? null,
        // Same for language: not part of personalization, preserve existing.
        language: data.preferences.language ?? prev.language ?? null,
        // Notification preferences are managed in their own card and aren't
        // part of personalization; preserve them so the reminder/weekly UI
        // doesn't reset after saving personalization.
        reminderEnabled: prev.reminderEnabled,
        reminderTime: prev.reminderTime,
        weeklySummaryEnabled: prev.weeklySummaryEnabled,
        weeklySummaryDay: prev.weeklySummaryDay,
        weeklySummaryTime: prev.weeklySummaryTime,
        onboardingCompletedAt:
          data.preferences.onboardingCompletedAt ??
          prev.onboardingCompletedAt,
      }));
      setShowPersonalization(false);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not save personalization";
      setPersonalizationError(message);
    } finally {
      setPersonalizationSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const apiUrl = getApiUrl();
        const response = await fetch(
          `${apiUrl}/api/tokens/history?days=${HISTORY_DAYS}`,
          { headers },
        );
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        const data = (await response.json()) as HistoryResponse;
        if (cancelled) return;
        setHistory(data.history);
        if (typeof data.tokenLimit === "number" && data.tokenLimit > 0) {
          setTokenLimit(data.tokenLimit);
        }
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof Error ? e.message : "Could not load usage history";
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadConversations = useCallback(async (signal?: AbortSignal) => {
    try {
      setConversationsLoading(true);
      setConversationsError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/conversations?limit=${RECENT_CONVERSATIONS_LIMIT}`,
        { headers, signal },
      );
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const data = (await response.json()) as ConversationsResponse;
      if (signal?.aborted) return;
      setConversations(data.conversations);
    } catch (e) {
      if (signal?.aborted) return;
      const message =
        e instanceof Error
          ? e.message
          : "Could not load recent conversations";
      setConversationsError(message);
    } finally {
      if (!signal?.aborted) setConversationsLoading(false);
    }
  }, []);

  const loadSavedMoments = useCallback(async (signal?: AbortSignal) => {
    try {
      setSavedMomentsLoading(true);
      setSavedMomentsError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/favorites?limit=${SAVED_MOMENTS_LIMIT}`,
        { headers, signal },
      );
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const data = (await response.json()) as FavoritesResponse;
      if (signal?.aborted) return;
      setSavedMoments(data.favorites);
    } catch (e) {
      if (signal?.aborted) return;
      const message =
        e instanceof Error ? e.message : "Could not load saved moments";
      setSavedMomentsError(message);
    } finally {
      if (!signal?.aborted) setSavedMomentsLoading(false);
    }
  }, []);

  const loadReferral = useCallback(async (signal?: AbortSignal) => {
    try {
      setReferralLoading(true);
      setReferralError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/referrals`, {
        headers,
        signal,
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const data = (await response.json()) as ReferralResponse;
      if (signal?.aborted) return;
      setReferral(data);
    } catch (e) {
      if (signal?.aborted) return;
      const message =
        e instanceof Error ? e.message : "Could not load invite details";
      setReferralError(message);
    } finally {
      if (!signal?.aborted) setReferralLoading(false);
    }
  }, []);

  const loadMemories = useCallback(async (signal?: AbortSignal) => {
    try {
      setMemoriesLoading(true);
      setMemoriesError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/memories`, {
        headers,
        signal,
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const data = (await response.json()) as MemoriesResponse;
      if (signal?.aborted) return;
      setMemories(data.memories);
    } catch (e) {
      if (signal?.aborted) return;
      const message =
        e instanceof Error ? e.message : "Could not load your memories";
      setMemoriesError(message);
    } finally {
      if (!signal?.aborted) setMemoriesLoading(false);
    }
  }, []);

  const handleDeleteMemory = useCallback(
    async (memory: Memory) => {
      if (memoryRemovingId !== null) return;
      setMemoryRemovingId(memory.id);
      setMemoryActionError(null);
      // Optimistic remove — a failure rolls the row back so the user
      // never sees a memory disappear when the request didn't actually
      // land on the server.
      const previous = memories;
      setMemories((prev) =>
        prev ? prev.filter((m) => m.id !== memory.id) : prev,
      );
      try {
        const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const apiUrl = getApiUrl();
        const response = await fetch(
          `${apiUrl}/api/memories/${memory.id}`,
          { method: "DELETE", headers },
        );
        if (!response.ok && response.status !== 404) {
          throw new Error(`Request failed (${response.status})`);
        }
      } catch (e) {
        setMemories(previous);
        setMemoryActionError(
          e instanceof Error ? e.message : "Couldn't remove that memory.",
        );
      } finally {
        setMemoryRemovingId(null);
      }
    },
    [memories, memoryRemovingId],
  );

  const requestEditMemory = useCallback((memory: Memory) => {
    setEditMemoryError(null);
    setMemoryActionError(null);
    setPendingEditMemory(memory);
  }, []);

  const cancelEditMemory = useCallback(() => {
    if (editMemorySubmitting) return;
    setPendingEditMemory(null);
    setEditMemoryError(null);
  }, [editMemorySubmitting]);

  const confirmEditMemory = useCallback(
    async (nextText: string) => {
      if (!pendingEditMemory || editMemorySubmitting) return;
      const target = pendingEditMemory;
      const trimmed = nextText.trim();
      if (trimmed.length === 0) {
        setEditMemoryError(t("profile.memories.editDialog.errorEmpty"));
        return;
      }
      if (trimmed === target.text) {
        setPendingEditMemory(null);
        setEditMemoryError(null);
        return;
      }
      try {
        setEditMemorySubmitting(true);
        setEditMemoryError(null);
        const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const apiUrl = getApiUrl();
        const response = await fetch(
          `${apiUrl}/api/memories/${target.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ text: trimmed }),
          },
        );
        if (!response.ok) {
          let serverMessage: string | null = null;
          try {
            const data = await response.json();
            if (data && typeof data.error === "string") {
              serverMessage = data.error;
            }
          } catch {
            // ignore body parse errors
          }
          throw new Error(
            serverMessage ?? t("profile.memories.editDialog.errorGeneric"),
          );
        }
        const payload = (await response.json()) as { memory?: Memory };
        // Use the server's clamped/cleaned text so the UI mirrors what
        // will actually feed back into future system prompts.
        const updatedText = payload.memory?.text ?? trimmed;
        setMemories((current) =>
          current
            ? current.map((m) =>
                m.id === target.id ? { ...m, text: updatedText } : m,
              )
            : current,
        );
        setPendingEditMemory(null);
      } catch (e) {
        setEditMemoryError(
          e instanceof Error
            ? e.message
            : t("profile.memories.editDialog.errorGeneric"),
        );
      } finally {
        setEditMemorySubmitting(false);
      }
    },
    [pendingEditMemory, editMemorySubmitting, t],
  );

  const handleConfirmClearMemories = useCallback(async () => {
    setClearMemoriesSubmitting(true);
    setMemoryActionError(null);
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/memories`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      setMemories([]);
      setShowClearMemoriesConfirm(false);
    } catch (e) {
      setMemoryActionError(
        e instanceof Error
          ? e.message
          : "Couldn't clear your memories. Try again?",
      );
    } finally {
      setClearMemoriesSubmitting(false);
    }
  }, []);

  const loadMoodEntries = useCallback(async (signal?: AbortSignal) => {
    try {
      setMoodLoading(true);
      setMoodError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/mood?days=7`, {
        headers,
        signal,
      });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const data = (await response.json()) as MoodResponse;
      if (signal?.aborted) return;
      setMoodEntries(data.entries);
    } catch (e) {
      if (signal?.aborted) return;
      const message =
        e instanceof Error ? e.message : "Could not load mood history";
      setMoodError(message);
    } finally {
      if (!signal?.aborted) setMoodLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadConversations(controller.signal);
      loadSavedMoments(controller.signal);
      loadMoodEntries(controller.signal);
      loadMemories(controller.signal);
      // Refresh referral data on focus too — `joinedCount` and the
      // active credit window may both change after a friend signs up
      // (or the credit naturally expires).
      loadReferral(controller.signal);
      return () => {
        controller.abort();
      };
    }, [loadConversations, loadSavedMoments, loadMoodEntries, loadMemories, loadReferral]),
  );

  // Open the system share sheet with the user's invite blurb. We use
  // React Native's built-in Share API rather than expo-sharing because
  // we want to share text/URL (not a file) and it's available without
  // an extra dependency. Falls back to a quiet error message if the
  // sheet can't open (e.g. web platform without navigator.share).
  const handleShareInvite = async () => {
    if (!referral || shareInFlight) return;
    setShareError(null);
    setShareInFlight(true);
    try {
      const message = `Try Solence with me — your first week of unlimited reflection is on us. Use code ${referral.code.toUpperCase()} or open ${referral.shareUrl}`;
      await Share.share({
        message,
        url: referral.shareUrl,
      });
    } catch (e) {
      setShareError(
        e instanceof Error ? e.message : "Couldn't open the share sheet",
      );
    } finally {
      setShareInFlight(false);
    }
  };

  const handleOpenSavedMoment = (moment: SavedMoment) => {
    navigation.navigate("ConversationDetail", {
      conversationId: moment.conversation.id,
      title: displayConversationTitle(
        moment.conversation.title,
        moment.conversation.createdAt,
      ),
      scrollToMessageId: moment.messageId,
    });
  };

  // Open the conversation a memory was learned from. Only invoked when
  // `memory.sourceConversation` is non-null (the row's link is hidden
  // otherwise), so the screen always has a valid id + title to push.
  const handleOpenMemorySource = (memory: Memory) => {
    if (!memory.sourceConversation) return;
    navigation.navigate("ConversationDetail", {
      conversationId: memory.sourceConversation.id,
      title: displayConversationTitle(
        memory.sourceConversation.title,
        memory.sourceConversation.createdAt,
      ),
    });
  };

  const handleOpenSavedMomentActionSheet = (moment: SavedMoment) => {
    Haptics.selectionAsync().catch(() => {});
    setActionSheetMoment(moment);
  };

  const handleCloseSavedMomentActionSheet = () => {
    setActionSheetMoment(null);
  };

  const handleSelectSavedMomentAction = (
    action: "save" | "share" | "copy",
  ) => {
    const moment = actionSheetMoment;
    if (!moment) return;
    setActionSheetMoment(null);
    if (action === "save") {
      // Saved moments are already favorited in this list, so this acts as
      // an "unsave" shortcut and matches the bookmark icon to the right.
      handleUnfavoriteMoment(moment);
    } else if (action === "share") {
      setTimeout(() => setShareQuoteMoment(moment), 120);
    } else if (action === "copy") {
      Clipboard.setStringAsync(moment.message.content)
        .then(() => {
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});
          setSavedMomentActionError("Copied to clipboard.");
        })
        .catch(() => {
          setSavedMomentActionError("Couldn't copy that text.");
        });
    }
  };

  const handleCloseShareSavedMoment = () => {
    setShareQuoteMoment(null);
  };

  const handleUnfavoriteMoment = async (moment: SavedMoment) => {
    if (unfavoritingId !== null) return;
    setUnfavoritingId(moment.id);
    setSavedMomentActionError(null);
    // Optimistic removal: drop the row immediately so the list feels
    // responsive. Restore on failure so the user can try again.
    const previous = savedMoments;
    setSavedMoments((current) =>
      current ? current.filter((m) => m.id !== moment.id) : current,
    );
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/messages/${moment.messageId}/favorite`,
        { method: "DELETE", headers },
      );
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
    } catch (e) {
      setSavedMoments(previous);
      const message =
        e instanceof Error
          ? e.message
          : "Couldn't remove this from your saved moments.";
      setSavedMomentActionError(message);
    } finally {
      setUnfavoritingId(null);
    }
  };

  const requestDeleteConversation = (conversation: ConversationListItem) => {
    setDeleteError(null);
    setPendingDelete(conversation);
  };

  const cancelDeleteConversation = () => {
    if (deleteSubmitting) return;
    setPendingDelete(null);
    setDeleteError(null);
  };

  const requestRenameConversation = (conversation: ConversationListItem) => {
    setRenameError(null);
    setPendingRename(conversation);
  };

  const cancelRenameConversation = () => {
    if (renameSubmitting) return;
    setPendingRename(null);
    setRenameError(null);
  };

  const confirmRenameConversation = async (nextTitle: string) => {
    if (!pendingRename || renameSubmitting) return;
    const target = pendingRename;
    const trimmed = nextTitle.trim();
    if (trimmed.length === 0) {
      setRenameError("Please enter a title.");
      return;
    }
    if (trimmed === target.title) {
      setPendingRename(null);
      setRenameError(null);
      return;
    }
    try {
      setRenameSubmitting(true);
      setRenameError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/conversations/${target.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: trimmed }),
        },
      );
      if (!response.ok) {
        let serverMessage: string | null = null;
        try {
          const data = await response.json();
          if (data && typeof data.error === "string") {
            serverMessage = data.error;
          }
        } catch {
          // ignore body parse errors
        }
        throw new Error(serverMessage ?? `Request failed (${response.status})`);
      }
      const payload = (await response.json()) as {
        conversation: { id: number; title: string };
      };
      const updatedTitle = payload.conversation?.title ?? trimmed;
      setConversations((current) =>
        current
          ? current.map((c) =>
              c.id === target.id ? { ...c, title: updatedTitle } : c,
            )
          : current,
      );
      setPendingRename(null);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not rename this conversation";
      setRenameError(message);
    } finally {
      setRenameSubmitting(false);
    }
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDelete || deleteSubmitting) return;
    const target = pendingDelete;
    try {
      setDeleteSubmitting(true);
      setDeleteError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/conversations/${target.id}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      setConversations((current) =>
        current ? current.filter((c) => c.id !== target.id) : current,
      );
      setPendingDelete(null);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not delete this conversation";
      setDeleteError(message);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // Builds and downloads/shares the user's data archive. The server returns
  // the zip in a single response (mobile fetch can't stream); on native we
  // write it to the cache and hand it to the OS share sheet, on web we
  // trigger a normal browser download via an anchor click.
  const handleExportData = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    setExportStatus("Packaging your data\u2026");
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/export`, {
        method: "POST",
        headers,
      });

      if (response.status === 429) {
        const body = (await response
          .json()
          .catch(() => null)) as { retryAfterSec?: number } | null;
        const seconds = body?.retryAfterSec ?? 300;
        const minutes = Math.max(1, Math.ceil(seconds / 60));
        throw new Error(
          `You can export your data again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        );
      }
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename =
        filenameMatch?.[1] ?? `solence-export-${Date.now()}.zip`;

      if (Platform.OS === "web") {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        setExportStatus("Your download has started.");
      } else {
        const buffer = await response.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        const cacheDir = FileSystem.cacheDirectory;
        if (!cacheDir) {
          throw new Error("Could not access local storage to save the file");
        }
        const uri = `${cacheDir}${filename}`;
        await FileSystem.writeAsStringAsync(uri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: "application/zip",
            UTI: "public.zip-archive",
            dialogTitle: "Save your Solence data",
          });
          setExportStatus("Your data is ready to share or save.");
        } else {
          setExportStatus(`Saved to ${uri}`);
        }
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not export your data";
      setExportError(message);
      setExportStatus(null);
    } finally {
      setExporting(false);
    }
  };

  const totalUsed = history
    ? history.reduce((sum, day) => sum + day.tokensUsed, 0)
    : 0;
  const dailyAverage = history && history.length > 0
    ? Math.round(totalUsed / history.length)
    : 0;

  const handleOpenConversation = (conversation: ConversationListItem) => {
    navigation.navigate("ConversationDetail", {
      conversationId: conversation.id,
      title: displayConversationTitle(conversation.title, conversation.createdAt),
    });
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      testID="screen-profile"
    >
      <Card elevation={1} style={styles.headerCard}>
        <View style={styles.personalizationHeader}>
          <View style={styles.personalizationHeaderText}>
            <ThemedText type="h4" style={styles.cardTitle}>
              {t("profile.personalization.title")}
            </ThemedText>
            <ThemedText
              type="small"
              style={[styles.cardDescription, { color: theme.textMuted }]}
            >
              {t("profile.personalization.subtitle")}
            </ThemedText>
          </View>
          <Pressable
            onPress={openPersonalization}
            style={({ pressed }) => [
              styles.personalizationEdit,
              {
                borderColor: theme.orbPrimary,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            testID="profile-personalization-edit"
            accessibilityRole="button"
            accessibilityLabel={t("profile.personalization.editA11y")}
          >
            <Feather name="edit-2" size={14} color={theme.orbPrimary} />
            <Text
              style={[
                styles.personalizationEditText,
                { color: theme.orbPrimary },
              ]}
            >
              {t("profile.personalization.edit")}
            </Text>
          </Pressable>
        </View>

        {preferencesLoading ? (
          <View
            style={styles.personalizationLoading}
            testID="profile-personalization-loading"
          >
            <ActivityIndicator color={theme.orbPrimary} />
          </View>
        ) : preferencesError ? (
          <View
            style={styles.personalizationError}
            testID="profile-personalization-error"
          >
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {preferencesError}
            </Text>
            <Pressable
              onPress={() => loadPreferences()}
              style={({ pressed }) => [
                styles.personalizationRetry,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              testID="profile-personalization-retry"
            >
              <Text
                style={[
                  styles.personalizationRetryText,
                  { color: theme.orbPrimary },
                ]}
              >
                {t("profile.personalization.retry")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.personalizationFields}>
            <View style={styles.personalizationRow}>
              <Text
                style={[
                  styles.personalizationLabel,
                  { color: theme.textMuted },
                ]}
              >
                {t("profile.personalization.fields.name")}
              </Text>
              <Text
                style={[
                  styles.personalizationValue,
                  { color: theme.text },
                  !preferences.displayName && {
                    color: theme.textMuted,
                    fontStyle: "italic",
                  },
                ]}
                testID="profile-personalization-name"
              >
                {preferences.displayName ?? t("profile.personalization.fields.notSet")}
              </Text>
            </View>
            <View style={styles.personalizationRow}>
              <Text
                style={[
                  styles.personalizationLabel,
                  { color: theme.textMuted },
                ]}
              >
                {t("profile.personalization.fields.focus")}
              </Text>
              {preferences.intents.length > 0 ? (
                <View style={styles.personalizationChipsWrap}>
                  {preferences.intents.map((intent) => (
                    <View
                      key={intent}
                      style={[
                        styles.personalizationChip,
                        {
                          backgroundColor: theme.backgroundSecondary,
                          borderColor: theme.backgroundSecondary,
                        },
                      ]}
                      testID={`profile-personalization-intent-${intent}`}
                    >
                      <Text
                        style={[
                          styles.personalizationChipText,
                          { color: theme.text },
                        ]}
                      >
                        {t(`intents.${intent}`)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text
                  style={[
                    styles.personalizationValue,
                    { color: theme.textMuted, fontStyle: "italic" },
                  ]}
                >
                  {t("profile.personalization.fields.notSet")}
                </Text>
              )}
            </View>
            <View style={styles.personalizationRow}>
              <Text
                style={[
                  styles.personalizationLabel,
                  { color: theme.textMuted },
                ]}
              >
                {t("profile.personalization.fields.tone")}
              </Text>
              <Text
                style={[
                  styles.personalizationValue,
                  { color: theme.text },
                  !preferences.tone && {
                    color: theme.textMuted,
                    fontStyle: "italic",
                  },
                ]}
                testID="profile-personalization-tone"
              >
                {preferences.tone
                  ? t(`tones.${preferences.tone}.label`)
                  : t("profile.personalization.fields.notSet")}
              </Text>
            </View>
          </View>
        )}
      </Card>

      <Card elevation={1} style={styles.textSizeCard} testID="profile-text-size-card">
        <ThemedText type="h4" style={styles.cardTitle}>
          Text size
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          Make text easier to read across the app. Your choice is saved on this
          device.
        </ThemedText>
        <View
          style={[
            styles.textSizeSegment,
            { backgroundColor: theme.backgroundSecondary },
          ]}
          accessibilityRole="radiogroup"
          testID="profile-text-size-segment"
        >
          {TEXT_SCALE_OPTIONS.map((option) => {
            const selected = option.id === textScaleId;
            return (
              <Pressable
                key={option.id}
                onPress={() => {
                  if (option.id !== textScaleId) {
                    setTextScaleId(option.id as TextScaleId);
                  }
                }}
                style={({ pressed }) => [
                  styles.textSizeSegmentItem,
                  selected && {
                    backgroundColor: theme.backgroundRoot,
                    borderColor: theme.orbPrimary,
                  },
                  !selected && { borderColor: "transparent" },
                  pressed && { opacity: 0.75 },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Text size ${option.label}`}
                testID={`profile-text-size-${option.id}`}
              >
                <Text
                  style={{
                    fontSize: 13 * option.scale,
                    lineHeight: 18 * option.scale,
                    fontFamily: fontForWeight(selected ? "600" : "400"),
                    color: selected ? theme.text : theme.textMuted,
                    letterSpacing: 0.2,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View
          style={[
            styles.textSizePreview,
            { borderColor: theme.backgroundSecondary },
          ]}
          testID="profile-text-size-preview"
        >
          <ThemedText
            type="small"
            style={[styles.textSizePreviewLabel, { color: theme.textMuted }]}
          >
            Preview
          </ThemedText>
          <ThemedText type="body" style={styles.textSizePreviewBody}>
            The more truth you bring, the more alive she becomes.
          </ThemedText>
        </View>
      </Card>

      <Card elevation={1} style={styles.languageCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          {t("profile.language.title")}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          {t("profile.language.subtitle")}
        </ThemedText>

        {languageError ? (
          <Text
            style={[styles.voiceErrorText, { color: theme.textMuted }]}
            testID="profile-language-save-error"
          >
            {languageError}
          </Text>
        ) : null}

        <View style={styles.voiceList} testID="profile-language-list">
          {LANGUAGES.map((language) => {
            const isSelected =
              (preferences.language ?? DEFAULT_LANGUAGE) === language;
            const isSaving = languageSaving === language;
            return (
              <View
                key={language}
                style={[
                  styles.voiceRow,
                  {
                    backgroundColor: isSelected
                      ? theme.backgroundSecondary
                      : "transparent",
                    borderColor: isSelected
                      ? theme.orbPrimary
                      : theme.backgroundSecondary,
                  },
                ]}
                testID={`profile-language-row-${language}`}
              >
                <Pressable
                  onPress={() => handleSelectLanguage(language)}
                  disabled={isSaving || preferencesLoading}
                  style={({ pressed }) => [
                    styles.voiceRowMain,
                    pressed && { opacity: 0.6 },
                  ]}
                  testID={`profile-language-select-${language}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={t("profile.language.selectA11y", {
                    language: LANGUAGE_LABELS[language],
                  })}
                >
                  <View style={styles.voiceRowText}>
                    <Text
                      style={[styles.voiceRowTitle, { color: theme.text }]}
                      testID={`profile-language-label-${language}`}
                    >
                      {LANGUAGE_LABELS[language]}
                    </Text>
                    <Text
                      style={[
                        styles.voiceRowDescription,
                        { color: theme.textMuted },
                      ]}
                    >
                      {t(`profile.language.options.${language}.description`)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.voiceRadio,
                      {
                        borderColor: isSelected
                          ? theme.orbPrimary
                          : theme.textMuted,
                      },
                    ]}
                  >
                    {isSaving ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.orbPrimary}
                      />
                    ) : isSelected ? (
                      <View
                        style={[
                          styles.voiceRadioDot,
                          { backgroundColor: theme.orbPrimary },
                        ]}
                        testID={`profile-language-selected-${language}`}
                      />
                    ) : null}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </Card>

      <Card elevation={1} style={styles.voiceCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          {t("profile.voice.title")}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          {t("profile.voice.subtitle")}
        </ThemedText>

        {voiceError ? (
          <Text
            style={[styles.voiceErrorText, { color: theme.textMuted }]}
            testID="profile-voice-save-error"
          >
            {voiceError}
          </Text>
        ) : null}
        {previewError ? (
          <Text
            style={[styles.voiceErrorText, { color: theme.textMuted }]}
            testID="profile-voice-preview-error"
          >
            {previewError}
          </Text>
        ) : null}

        <View style={styles.voiceList} testID="profile-voice-list">
          {VOICES.map((voice) => {
            const isSelected =
              (preferences.voice ?? DEFAULT_VOICE) === voice;
            const isSaving = voiceSaving === voice;
            const isLoadingPreview = previewLoading === voice;
            const isPlaying = previewPlaying === voice;
            return (
              <View
                key={voice}
                style={[
                  styles.voiceRow,
                  {
                    backgroundColor: isSelected
                      ? theme.backgroundSecondary
                      : "transparent",
                    borderColor: isSelected
                      ? theme.orbPrimary
                      : theme.backgroundSecondary,
                  },
                ]}
                testID={`profile-voice-row-${voice}`}
              >
                <Pressable
                  onPress={() => handleSelectVoice(voice)}
                  disabled={isSaving || preferencesLoading}
                  style={({ pressed }) => [
                    styles.voiceRowMain,
                    pressed && { opacity: 0.6 },
                  ]}
                  testID={`profile-voice-select-${voice}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={t("profile.voice.selectA11y", {
                    voice: t(`voices.${voice}.label`),
                  })}
                >
                  <View style={styles.voiceRowText}>
                    <Text
                      style={[styles.voiceRowTitle, { color: theme.text }]}
                      testID={`profile-voice-label-${voice}`}
                    >
                      {t(`voices.${voice}.label`)}
                    </Text>
                    <Text
                      style={[
                        styles.voiceRowDescription,
                        { color: theme.textMuted },
                      ]}
                    >
                      {t(`voices.${voice}.description`)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.voiceRadio,
                      {
                        borderColor: isSelected
                          ? theme.orbPrimary
                          : theme.textMuted,
                      },
                    ]}
                  >
                    {isSaving ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.orbPrimary}
                      />
                    ) : isSelected ? (
                      <View
                        style={[
                          styles.voiceRadioDot,
                          { backgroundColor: theme.orbPrimary },
                        ]}
                        testID={`profile-voice-selected-${voice}`}
                      />
                    ) : null}
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => handlePreviewVoice(voice)}
                  disabled={isLoadingPreview}
                  style={({ pressed }) => [
                    styles.voicePreviewButton,
                    {
                      borderColor: theme.orbPrimary,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                  testID={`profile-voice-preview-${voice}`}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isPlaying
                      ? t("profile.voice.stopPreviewA11y", {
                          voice: t(`voices.${voice}.label`),
                        })
                      : t("profile.voice.previewA11y", {
                          voice: t(`voices.${voice}.label`),
                        })
                  }
                >
                  {isLoadingPreview ? (
                    <ActivityIndicator
                      size="small"
                      color={theme.orbPrimary}
                    />
                  ) : (
                    <>
                      <Feather
                        name={isPlaying ? "square" : "play"}
                        size={12}
                        color={theme.orbPrimary}
                      />
                      <Text
                        style={[
                          styles.voicePreviewText,
                          { color: theme.orbPrimary },
                        ]}
                      >
                        {isPlaying ? t("profile.voice.stop") : t("profile.voice.preview")}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      </Card>

      <Card elevation={1} style={styles.lockCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          Privacy & Lock
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          Require Face ID, Touch ID, or your device passcode to open Solence.
        </ThemedText>

        {appLockLoading ? (
          <View style={styles.loadingContainer} testID="profile-lock-loading">
            <ActivityIndicator color={theme.orbPrimary} />
          </View>
        ) : (
          <View>
            <View
              style={[
                styles.lockToggleRow,
                { borderBottomColor: theme.backgroundSecondary },
              ]}
            >
              <View style={styles.lockToggleText}>
                <Text
                  style={[styles.lockToggleTitle, { color: theme.text }]}
                  testID="profile-lock-toggle-label"
                >
                  Require Face ID / passcode
                </Text>
                <Text
                  style={[
                    styles.lockToggleHelp,
                    { color: theme.textMuted },
                  ]}
                >
                  {Platform.OS === "web"
                    ? "Available on iOS and Android — open Solence in Expo Go on your device."
                    : biometricSupported === false
                      ? "Set up Face ID, Touch ID, or a device passcode in Settings to enable this."
                      : "When on, Solence asks to authenticate after it returns from the background."}
                </Text>
              </View>
              <Switch
                value={appLockPrefs.enabled}
                onValueChange={handleToggleAppLock}
                disabled={
                  Platform.OS === "web" ||
                  appLockSaving ||
                  (biometricSupported === false && !appLockPrefs.enabled)
                }
                trackColor={{
                  false: theme.backgroundSecondary,
                  true: theme.orbPrimary,
                }}
                thumbColor={
                  Platform.OS === "android"
                    ? appLockPrefs.enabled
                      ? theme.orbSecondary
                      : theme.backgroundTertiary
                    : undefined
                }
                testID="profile-lock-toggle"
                accessibilityLabel="Require Face ID or passcode to open Solence"
              />
            </View>

            {appLockError ? (
              <Text
                style={[styles.lockError, { color: theme.textMuted }]}
                testID="profile-lock-error"
              >
                {appLockError}
              </Text>
            ) : null}

            <View style={styles.lockTimerSection}>
              <Text
                style={[styles.lockTimerLabel, { color: theme.textMuted }]}
              >
                Re-lock
              </Text>
              <View style={styles.lockTimerOptions}>
                {RELOCK_OPTIONS.map((option) => {
                  const isSelected = appLockPrefs.threshold === option;
                  const disabled =
                    !appLockPrefs.enabled ||
                    appLockSaving ||
                    Platform.OS === "web";
                  return (
                    <Pressable
                      key={option}
                      onPress={() => handleSelectRelock(option)}
                      disabled={disabled}
                      style={({ pressed }) => [
                        styles.lockTimerChip,
                        {
                          borderColor: isSelected
                            ? theme.orbPrimary
                            : theme.backgroundSecondary,
                          backgroundColor: isSelected
                            ? theme.backgroundSecondary
                            : "transparent",
                          opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
                        },
                      ]}
                      testID={`profile-lock-timer-${option}`}
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: isSelected,
                        disabled,
                      }}
                      accessibilityLabel={`Re-lock ${RELOCK_LABELS[option]}`}
                    >
                      <Text
                        style={[
                          styles.lockTimerChipText,
                          {
                            color: isSelected
                              ? theme.orbPrimary
                              : theme.text,
                          },
                        ]}
                      >
                        {RELOCK_LABELS[option]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </Card>

      <Card elevation={1} style={styles.remindersCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          {t("profile.reminders.title")}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          {t("profile.reminders.subtitle")}
        </ThemedText>

        <View
          style={[
            styles.lockToggleRow,
            { borderBottomColor: theme.backgroundSecondary },
          ]}
        >
          <View style={styles.lockToggleText}>
            <Text
              style={[styles.lockToggleTitle, { color: theme.text }]}
              testID="profile-reminder-toggle-label"
            >
              {t("profile.reminders.toggleLabel")}
            </Text>
            <Text
              style={[styles.lockToggleHelp, { color: theme.textMuted }]}
            >
              {Platform.OS === "web"
                ? t("profile.reminders.toggleHelpWeb")
                : notificationsBlocked
                  ? t("profile.reminders.toggleHelpDenied")
                  : t("profile.reminders.toggleHelp")}
            </Text>
          </View>
          <Switch
            value={preferences.reminderEnabled}
            onValueChange={handleToggleReminder}
            disabled={
              Platform.OS === "web" ||
              notificationsSaving === "reminder" ||
              preferencesLoading
            }
            trackColor={{
              false: theme.backgroundSecondary,
              true: theme.orbPrimary,
            }}
            thumbColor={
              Platform.OS === "android"
                ? preferences.reminderEnabled
                  ? theme.orbSecondary
                  : theme.backgroundTertiary
                : undefined
            }
            testID="profile-reminder-toggle"
            accessibilityLabel={t("profile.reminders.toggleLabel")}
          />
        </View>

        {reminderError ? (
          <Text
            style={[styles.lockError, { color: theme.textMuted }]}
            testID="profile-reminder-error"
          >
            {reminderError}
          </Text>
        ) : null}

        {Platform.OS !== "web" && notificationsBlocked ? (
          <Pressable
            onPress={handleOpenSettings}
            style={({ pressed }) => [
              styles.openSettingsButton,
              {
                borderColor: theme.orbPrimary,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            testID="profile-reminder-open-settings"
            accessibilityRole="button"
          >
            <Text
              style={[styles.openSettingsText, { color: theme.orbPrimary }]}
            >
              {t("profile.reminders.openSettings")}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.lockTimerSection}>
          <Text style={[styles.lockTimerLabel, { color: theme.textMuted }]}>
            {t("profile.reminders.timeLabel")}
          </Text>
          <View style={styles.lockTimerOptions}>
            {REMINDER_TIME_OPTIONS.map((option) => {
              const isSelected = preferences.reminderTime === option;
              const disabled =
                Platform.OS === "web" ||
                notificationsSaving === "reminder" ||
                preferencesLoading;
              const label = formatTimeOfDayLabel(option, locale);
              return (
                <Pressable
                  key={option}
                  onPress={() => handleSelectReminderTime(option)}
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.lockTimerChip,
                    {
                      borderColor: isSelected
                        ? theme.orbPrimary
                        : theme.backgroundSecondary,
                      backgroundColor: isSelected
                        ? theme.backgroundSecondary
                        : "transparent",
                      opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
                    },
                  ]}
                  testID={`profile-reminder-time-${option}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected, disabled }}
                  accessibilityLabel={`${t("profile.reminders.timeLabel")} ${label}`}
                >
                  <Text
                    style={[
                      styles.lockTimerChipText,
                      {
                        color: isSelected ? theme.orbPrimary : theme.text,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            {(() => {
              const isCustomSelected =
                !REMINDER_TIME_OPTIONS.includes(preferences.reminderTime);
              const disabled =
                Platform.OS === "web" ||
                notificationsSaving === "reminder" ||
                preferencesLoading;
              const customLabel = isCustomSelected
                ? formatTimeOfDayLabel(preferences.reminderTime, locale)
                : t("profile.reminders.customLabel");
              return (
                <Pressable
                  onPress={() => openCustomTimePicker("reminder")}
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.lockTimerChip,
                    styles.customTimerChip,
                    {
                      borderColor: isCustomSelected
                        ? theme.orbPrimary
                        : theme.backgroundSecondary,
                      backgroundColor: isCustomSelected
                        ? theme.backgroundSecondary
                        : "transparent",
                      opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
                    },
                  ]}
                  testID="profile-reminder-time-custom"
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: isCustomSelected,
                    disabled,
                  }}
                  accessibilityLabel={`${t("profile.reminders.timeLabel")} ${customLabel}`}
                >
                  <Feather
                    name="clock"
                    size={14}
                    color={isCustomSelected ? theme.orbPrimary : theme.text}
                  />
                  <Text
                    style={[
                      styles.lockTimerChipText,
                      {
                        color: isCustomSelected
                          ? theme.orbPrimary
                          : theme.text,
                      },
                    ]}
                  >
                    {customLabel}
                  </Text>
                </Pressable>
              );
            })()}
          </View>
        </View>
      </Card>

      <Card elevation={1} style={styles.weeklyCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          {t("profile.weeklySummary.title")}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          {t("profile.weeklySummary.subtitle")}
        </ThemedText>

        <Pressable
          onPress={handleOpenWeeklySummary}
          style={({ pressed }) => [
            styles.weeklyOpenButton,
            {
              borderColor: theme.orbPrimary,
              backgroundColor: pressed
                ? theme.backgroundSecondary
                : "transparent",
            },
          ]}
          testID="profile-weekly-open"
          accessibilityRole="button"
          accessibilityLabel={t("profile.weeklySummary.openA11y")}
        >
          <Feather name="calendar" size={16} color={theme.orbPrimary} />
          <Text
            style={[styles.weeklyOpenText, { color: theme.orbPrimary }]}
          >
            {t("profile.weeklySummary.openButton")}
          </Text>
          <Feather name="chevron-right" size={16} color={theme.orbPrimary} />
        </Pressable>

        <View
          style={[
            styles.lockToggleRow,
            { borderBottomColor: theme.backgroundSecondary },
          ]}
        >
          <View style={styles.lockToggleText}>
            <Text
              style={[styles.lockToggleTitle, { color: theme.text }]}
              testID="profile-weekly-toggle-label"
            >
              {t("profile.weeklySummary.toggleLabel")}
            </Text>
            <Text
              style={[styles.lockToggleHelp, { color: theme.textMuted }]}
            >
              {Platform.OS === "web"
                ? t("profile.weeklySummary.toggleHelpWeb")
                : notificationsBlocked
                  ? t("profile.weeklySummary.toggleHelpDenied")
                  : t("profile.weeklySummary.toggleHelp")}
            </Text>
          </View>
          <Switch
            value={preferences.weeklySummaryEnabled}
            onValueChange={handleToggleWeeklySummary}
            disabled={
              Platform.OS === "web" ||
              notificationsSaving === "weekly" ||
              preferencesLoading
            }
            trackColor={{
              false: theme.backgroundSecondary,
              true: theme.orbPrimary,
            }}
            thumbColor={
              Platform.OS === "android"
                ? preferences.weeklySummaryEnabled
                  ? theme.orbSecondary
                  : theme.backgroundTertiary
                : undefined
            }
            testID="profile-weekly-toggle"
            accessibilityLabel={t("profile.weeklySummary.toggleLabel")}
          />
        </View>

        {weeklyError ? (
          <Text
            style={[styles.lockError, { color: theme.textMuted }]}
            testID="profile-weekly-error"
          >
            {weeklyError}
          </Text>
        ) : null}

        <View style={styles.lockTimerSection}>
          <Text style={[styles.lockTimerLabel, { color: theme.textMuted }]}>
            {t("profile.weeklySummary.dayLabel")}
          </Text>
          <View style={styles.lockTimerOptions}>
            {WEEKLY_DAY_OPTIONS.map((day) => {
              const isSelected = preferences.weeklySummaryDay === day;
              const disabled =
                Platform.OS === "web" ||
                notificationsSaving === "weekly" ||
                preferencesLoading;
              const label = t(`profile.mood.dayLabels.${day}`);
              return (
                <Pressable
                  key={day}
                  onPress={() => handleSelectWeeklyDay(day)}
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.weeklyDayChip,
                    {
                      borderColor: isSelected
                        ? theme.orbPrimary
                        : theme.backgroundSecondary,
                      backgroundColor: isSelected
                        ? theme.backgroundSecondary
                        : "transparent",
                      opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
                    },
                  ]}
                  testID={`profile-weekly-day-${day}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected, disabled }}
                  accessibilityLabel={`${t("profile.weeklySummary.dayLabel")} ${label}`}
                >
                  <Text
                    style={[
                      styles.lockTimerChipText,
                      {
                        color: isSelected ? theme.orbPrimary : theme.text,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.lockTimerSection}>
          <Text style={[styles.lockTimerLabel, { color: theme.textMuted }]}>
            {t("profile.weeklySummary.timeLabel")}
          </Text>
          <View style={styles.lockTimerOptions}>
            {REMINDER_TIME_OPTIONS.map((option) => {
              const isSelected = preferences.weeklySummaryTime === option;
              const disabled =
                Platform.OS === "web" ||
                notificationsSaving === "weekly" ||
                preferencesLoading;
              const label = formatTimeOfDayLabel(option, locale);
              return (
                <Pressable
                  key={option}
                  onPress={() => handleSelectWeeklyTime(option)}
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.lockTimerChip,
                    {
                      borderColor: isSelected
                        ? theme.orbPrimary
                        : theme.backgroundSecondary,
                      backgroundColor: isSelected
                        ? theme.backgroundSecondary
                        : "transparent",
                      opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
                    },
                  ]}
                  testID={`profile-weekly-time-${option}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected, disabled }}
                  accessibilityLabel={`${t("profile.weeklySummary.timeLabel")} ${label}`}
                >
                  <Text
                    style={[
                      styles.lockTimerChipText,
                      {
                        color: isSelected ? theme.orbPrimary : theme.text,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            {(() => {
              const isCustomSelected = !REMINDER_TIME_OPTIONS.includes(
                preferences.weeklySummaryTime,
              );
              const disabled =
                Platform.OS === "web" ||
                notificationsSaving === "weekly" ||
                preferencesLoading;
              const customLabel = isCustomSelected
                ? formatTimeOfDayLabel(preferences.weeklySummaryTime, locale)
                : t("profile.weeklySummary.customLabel");
              return (
                <Pressable
                  onPress={() => openCustomTimePicker("weekly")}
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.lockTimerChip,
                    styles.customTimerChip,
                    {
                      borderColor: isCustomSelected
                        ? theme.orbPrimary
                        : theme.backgroundSecondary,
                      backgroundColor: isCustomSelected
                        ? theme.backgroundSecondary
                        : "transparent",
                      opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
                    },
                  ]}
                  testID="profile-weekly-time-custom"
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: isCustomSelected,
                    disabled,
                  }}
                  accessibilityLabel={`${t("profile.weeklySummary.timeLabel")} ${customLabel}`}
                >
                  <Feather
                    name="clock"
                    size={14}
                    color={isCustomSelected ? theme.orbPrimary : theme.text}
                  />
                  <Text
                    style={[
                      styles.lockTimerChipText,
                      {
                        color: isCustomSelected
                          ? theme.orbPrimary
                          : theme.text,
                      },
                    ]}
                  >
                    {customLabel}
                  </Text>
                </Pressable>
              );
            })()}
          </View>
        </View>
      </Card>

      <Card elevation={1} style={styles.historyCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          {t("profile.tokens.title", { days: HISTORY_DAYS })}
        </ThemedText>
        <ThemedText type="small" style={[styles.cardDescription, { color: theme.textMuted }]}>
          {t("profile.tokens.description", { cap: formatTokens(tokenLimit) })}
        </ThemedText>

        {loading ? (
          <View style={styles.loadingContainer} testID="profile-history-loading">
            <ActivityIndicator color={theme.orbPrimary} />
          </View>
        ) : error ? (
          <View style={styles.errorContainer} testID="profile-history-error">
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {error}
            </Text>
          </View>
        ) : history && history.length > 0 ? (
          <View style={styles.chartContainer} testID="profile-history-chart">
            <View style={styles.chart}>
              {history.map((day, index) => {
                const isToday = index === history.length - 1;
                const ratio = tokenLimit > 0
                  ? Math.min(1, day.tokensUsed / tokenLimit)
                  : 0;
                const filledHeightPct = Math.max(ratio * 100, day.tokensUsed > 0 ? 4 : 0);
                const labelColor = isToday ? theme.orbPrimary : theme.textMuted;
                const barColor = isToday ? theme.orbPrimary : theme.orbSecondary;
                const trackColor = theme.backgroundSecondary;
                const dateLabel = formatDayLabel(day.periodStart, isToday, t, locale);
                const accessibilityLabel = `${formatFullDate(day.periodStart, locale)}: ${formatTokens(day.tokensUsed)} of ${formatTokens(tokenLimit)} tokens used`;
                return (
                  <View
                    key={day.periodStart}
                    style={styles.barColumn}
                    accessibilityLabel={accessibilityLabel}
                    accessibilityRole="image"
                    testID={`profile-history-bar-${index}`}
                  >
                    <Text
                      style={[styles.barValue, { color: theme.textMuted }]}
                      numberOfLines={1}
                    >
                      {formatTokens(day.tokensUsed)}
                    </Text>
                    <View style={[styles.barTrack, { backgroundColor: trackColor }]}>
                      {filledHeightPct > 0 ? (
                        <View
                          style={[
                            styles.barFill,
                            {
                              height: `${filledHeightPct}%`,
                              backgroundColor: barColor,
                            },
                          ]}
                        />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.barLabel,
                        { color: labelColor, fontWeight: isToday ? "600" : "400" },
                      ]}
                      numberOfLines={1}
                    >
                      {dateLabel}
                    </Text>
                  </View>
                );
              })}
            </View>

            <View style={[styles.legendRow, { borderTopColor: theme.backgroundSecondary }]}>
              <View style={styles.legendItem}>
                <Text style={[styles.legendValue, { color: theme.text }]} testID="profile-history-total">
                  {formatTokens(totalUsed)}
                </Text>
                <Text style={[styles.legendLabel, { color: theme.textMuted }]}>
                  {t("profile.tokens.total")}
                </Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={[styles.legendValue, { color: theme.text }]} testID="profile-history-average">
                  {formatTokens(dailyAverage)}
                </Text>
                <Text style={[styles.legendLabel, { color: theme.textMuted }]}>
                  {t("profile.tokens.average")}
                </Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={[styles.legendValue, { color: theme.text }]}>
                  {formatTokens(tokenLimit)}
                </Text>
                <Text style={[styles.legendLabel, { color: theme.textMuted }]}>
                  {t("profile.tokens.cap")}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
      </Card>

      <Card elevation={1} style={styles.savedMomentsCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          {t("profile.favorites.title")}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          {t("profile.favorites.subtitle")}
        </ThemedText>

        {savedMomentActionError ? (
          <Text
            style={[styles.errorText, { color: theme.textMuted }]}
            testID="profile-saved-moments-action-error"
          >
            {savedMomentActionError}
          </Text>
        ) : null}

        {savedMomentsLoading ? (
          <View
            style={styles.loadingContainer}
            testID="profile-saved-moments-loading"
          >
            <ActivityIndicator color={theme.orbPrimary} />
          </View>
        ) : savedMomentsError ? (
          <View
            style={styles.errorContainer}
            testID="profile-saved-moments-error"
          >
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {savedMomentsError}
            </Text>
          </View>
        ) : savedMoments && savedMoments.length > 0 ? (
          <View testID="profile-saved-moments-list">
            {savedMoments.map((moment, index) => {
              const isLast = index === savedMoments.length - 1;
              const titleLabel = displayConversationTitle(
                moment.conversation.title,
                moment.conversation.createdAt,
              );
              const isRemoving = unfavoritingId === moment.id;
              return (
                <View
                  key={moment.id}
                  style={[
                    styles.savedMomentRow,
                    !isLast && {
                      borderBottomColor: theme.backgroundSecondary,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Pressable
                    onPress={() => handleOpenSavedMoment(moment)}
                    onLongPress={() => handleOpenSavedMomentActionSheet(moment)}
                    delayLongPress={300}
                    style={({ pressed }) => [
                      styles.savedMomentContent,
                      pressed && { opacity: 0.6 },
                    ]}
                    testID={`profile-saved-moment-row-${moment.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("profile.favorites.openA11y", { title: titleLabel })}
                    accessibilityHint="Long-press to share or copy this moment"
                  >
                    <View style={styles.savedMomentHeader}>
                      <Text
                        style={[
                          styles.savedMomentSource,
                          { color: theme.text },
                        ]}
                        numberOfLines={1}
                        testID={`profile-saved-moment-source-${moment.id}`}
                      >
                        {titleLabel}
                      </Text>
                      <Text
                        style={[
                          styles.savedMomentTime,
                          { color: theme.textMuted },
                        ]}
                        numberOfLines={1}
                      >
                        {formatRelativeTime(moment.favoritedAt, t, locale)}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.savedMomentSnippet,
                        { color: theme.textMuted },
                      ]}
                      numberOfLines={3}
                      testID={`profile-saved-moment-snippet-${moment.id}`}
                    >
                      {snippetForMoment(moment.message.content)}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleUnfavoriteMoment(moment)}
                    disabled={isRemoving}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.conversationActionButton,
                      { backgroundColor: theme.backgroundSecondary },
                      pressed && { opacity: 0.6 },
                      isRemoving && { opacity: 0.5 },
                    ]}
                    testID={`profile-saved-moment-remove-${moment.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("profile.favorites.removeA11y", { title: titleLabel })}
                  >
                    {isRemoving ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.textMuted}
                      />
                    ) : (
                      <Feather
                        name="bookmark"
                        size={16}
                        color={theme.orbPrimary}
                      />
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <View
            style={styles.emptyContainer}
            testID="profile-saved-moments-empty"
          >
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {t("profile.favorites.emptyExpanded")}
            </Text>
          </View>
        )}
      </Card>

      <Card elevation={1} style={styles.memoriesCard}>
        <View style={styles.memoriesHeader}>
          <View style={styles.memoriesHeaderText}>
            <ThemedText type="h4" style={styles.cardTitle}>
              {t("profile.memories.title")}
            </ThemedText>
            <ThemedText
              type="small"
              style={[styles.cardDescription, { color: theme.textMuted }]}
            >
              {t("profile.memories.subtitle")}
            </ThemedText>
          </View>
          {memories && memories.length > 0 ? (
            <Pressable
              onPress={() => {
                setMemoryActionError(null);
                setShowClearMemoriesConfirm(true);
              }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.memoriesClearButton,
                {
                  borderColor: theme.backgroundSecondary,
                  backgroundColor: theme.backgroundSecondary,
                },
                pressed && { opacity: 0.6 },
              ]}
              testID="profile-memories-clear-all"
              accessibilityRole="button"
              accessibilityLabel={t("profile.memories.clearAll")}
            >
              <Feather name="trash-2" size={14} color={theme.textMuted} />
              <Text
                style={[
                  styles.memoriesClearButtonText,
                  { color: theme.text },
                ]}
              >
                {t("profile.memories.clearAll")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {memoryActionError ? (
          <Text
            style={[styles.errorText, { color: theme.textMuted }]}
            testID="profile-memories-action-error"
          >
            {memoryActionError}
          </Text>
        ) : null}

        {memoriesLoading ? (
          <View
            style={styles.loadingContainer}
            testID="profile-memories-loading"
          >
            <ActivityIndicator color={theme.orbPrimary} />
          </View>
        ) : memoriesError ? (
          <View style={styles.errorContainer} testID="profile-memories-error">
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {memoriesError}
            </Text>
          </View>
        ) : memories && memories.length > 0 ? (
          <View testID="profile-memories-list">
            {memories.map((memory, index) => {
              const isLast = index === memories.length - 1;
              const isRemoving = memoryRemovingId === memory.id;
              // Only render the "From a chat on …" link when the source
              // conversation still exists. Memories whose source was
              // deleted (or that were created without one) get their FK
              // nulled server-side and the join returns no row, so we
              // simply hide the link rather than ever showing a dead
              // tap target.
              const source = memory.sourceConversation;
              const sourceDateLabel = source
                ? new Date(source.createdAt).toLocaleDateString(locale, {
                    month: "short",
                    day: "numeric",
                  })
                : null;
              return (
                <View
                  key={memory.id}
                  style={[
                    styles.memoryRow,
                    !isLast && {
                      borderBottomColor: theme.backgroundSecondary,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                  testID={`profile-memory-row-${memory.id}`}
                >
                  <View style={styles.memoryContent}>
                    <Text
                      style={[styles.memoryText, { color: theme.text }]}
                      testID={`profile-memory-text-${memory.id}`}
                    >
                      {memory.text}
                    </Text>
                    {source && sourceDateLabel ? (
                      <Pressable
                        onPress={() => handleOpenMemorySource(memory)}
                        hitSlop={6}
                        style={({ pressed }) => [
                          styles.memorySourceLink,
                          pressed && { opacity: 0.6 },
                        ]}
                        testID={`profile-memory-source-${memory.id}`}
                        accessibilityRole="link"
                        accessibilityLabel={t(
                          "profile.memories.sourceA11y",
                          { date: sourceDateLabel },
                        )}
                      >
                        <Text
                          style={[
                            styles.memorySourceText,
                            { color: theme.textMuted },
                          ]}
                          numberOfLines={1}
                        >
                          {t("profile.memories.fromChatOn", {
                            date: sourceDateLabel,
                          })}
                        </Text>
                        <Feather
                          name="chevron-right"
                          size={14}
                          color={theme.textMuted}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => requestEditMemory(memory)}
                    disabled={isRemoving}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.conversationActionButton,
                      { backgroundColor: theme.backgroundSecondary },
                      pressed && { opacity: 0.6 },
                      isRemoving && { opacity: 0.5 },
                    ]}
                    testID={`profile-memory-edit-${memory.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("profile.memories.editA11y")}
                  >
                    <Feather
                      name="edit-2"
                      size={16}
                      color={theme.textMuted}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteMemory(memory)}
                    disabled={isRemoving}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.conversationActionButton,
                      { backgroundColor: theme.backgroundSecondary },
                      pressed && { opacity: 0.6 },
                      isRemoving && { opacity: 0.5 },
                    ]}
                    testID={`profile-memory-remove-${memory.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("profile.memories.removeA11y")}
                  >
                    {isRemoving ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.textMuted}
                      />
                    ) : (
                      <Feather
                        name="x"
                        size={16}
                        color={theme.textMuted}
                      />
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyContainer} testID="profile-memories-empty">
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {t("profile.memories.empty")}
            </Text>
          </View>
        )}

        <Text
          style={[styles.memoriesPrivacyText, { color: theme.textMuted }]}
        >
          {t("profile.memories.privacy")}
        </Text>
      </Card>

      <Card elevation={1} style={styles.moodCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          {t("profile.mood.title")}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          {t("profile.mood.subtitle")}
        </ThemedText>

        {moodLoading ? (
          <View style={styles.loadingContainer} testID="profile-mood-loading">
            <ActivityIndicator color={theme.orbPrimary} />
          </View>
        ) : moodError ? (
          <View style={styles.errorContainer} testID="profile-mood-error">
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {moodError}
            </Text>
          </View>
        ) : moodEntries && moodEntries.length > 0 ? (
          (() => {
            // Build a per-day bucket for the last 7 calendar days. We keep
            // the LATEST entry per day (entries arrive newest-first, so the
            // first one we see for a given day wins). Days without a
            // check-in render as a faint dot — never as 0, which would
            // misleadingly imply "rough mood".
            //
            // Bucket dates are derived via setDate() rather than fixed
            // millisecond subtraction so DST transitions don't skip or
            // duplicate a calendar day. Summaries (avg, most recent) are
            // computed from in-bucket entries only so the chart and the
            // numbers always agree, even when the API's rolling-hours
            // window pulls in entries that fall outside our calendar
            // window.
            const buckets: { date: Date; entry: MoodEntry | null }[] = [];
            for (let i = 6; i >= 0; i--) {
              const d = new Date();
              d.setHours(0, 0, 0, 0);
              d.setDate(d.getDate() - i);
              buckets.push({ date: d, entry: null });
            }
            for (const entry of moodEntries) {
              const created = new Date(entry.createdAt);
              created.setHours(0, 0, 0, 0);
              const bucket = buckets.find(
                (b) => b.date.getTime() === created.getTime(),
              );
              if (bucket && bucket.entry == null) bucket.entry = entry;
            }

            const inBucket = buckets
              .map((b) => b.entry)
              .filter((e): e is MoodEntry => e != null);
            const avg = inBucket.length
              ? inBucket.reduce((sum, e) => sum + e.score, 0) / inBucket.length
              : 0;
            const mostRecent = inBucket[0] ?? null;

            return (
              <View testID="profile-mood-content">
                <View style={styles.moodChart}>
                  {buckets.map((bucket, idx) => {
                    const score = bucket.entry?.score ?? null;
                    // Dot size scales smoothly with score 1→5 (12px → 28px).
                    const size = score ? 12 + (score - 1) * 4 : 6;
                    const isEmpty = score == null;
                    return (
                      <View
                        key={idx}
                        style={styles.moodDayCol}
                        testID={`profile-mood-day-${idx}`}
                      >
                        <View style={styles.moodDotSlot}>
                          <View
                            style={[
                              styles.moodDot,
                              {
                                width: size,
                                height: size,
                                borderRadius: size / 2,
                                backgroundColor: isEmpty
                                  ? "transparent"
                                  : theme.orbPrimary,
                                borderColor: isEmpty
                                  ? theme.textMuted
                                  : "transparent",
                                borderWidth: isEmpty ? 1 : 0,
                                opacity: isEmpty ? 0.35 : 0.85,
                              },
                            ]}
                          />
                        </View>
                        <Text
                          style={[
                            styles.moodDayLabel,
                            { color: theme.textMuted },
                          ]}
                        >
                          {t(`profile.mood.dayLabels.${bucket.date.getDay()}`)}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {inBucket.length > 0 ? (
                  <View
                    style={[
                      styles.moodSummaryRow,
                      { borderTopColor: theme.backgroundSecondary },
                    ]}
                  >
                    <View style={styles.moodSummaryBlock}>
                      <Text
                        style={[
                          styles.moodSummaryLabel,
                          { color: theme.textMuted },
                        ]}
                      >
                        {t("profile.mood.average")}
                      </Text>
                      <Text
                        style={[
                          styles.moodSummaryValue,
                          { color: theme.text },
                        ]}
                        testID="profile-mood-average"
                      >
                        {t("profile.mood.averageValue", { value: avg.toFixed(1) })}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.moodSummaryDivider,
                        { backgroundColor: theme.backgroundSecondary },
                      ]}
                    />
                    <View style={styles.moodSummaryBlock}>
                      <Text
                        style={[
                          styles.moodSummaryLabel,
                          { color: theme.textMuted },
                        ]}
                      >
                        {t("profile.mood.mostRecent")}
                      </Text>
                      <Text
                        style={[
                          styles.moodSummaryValue,
                          { color: theme.text },
                        ]}
                        testID="profile-mood-most-recent"
                      >
                        {mostRecent
                          ? t(`profile.mood.labels.${mostRecent.score}`)
                          : t("profile.mood.noEntry")}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })()
        ) : (
          <View style={styles.emptyContainer} testID="profile-mood-empty">
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {t("profile.mood.emptyExpanded")}
            </Text>
          </View>
        )}
      </Card>

      {(() => {
        // Pull reflections out of the already-loaded conversations list so
        // we don't need a separate endpoint. Show at most the 5 most
        // recent — the list is already sorted by last-activity desc.
        const reflectionItems = (conversations ?? [])
          .filter(
            (c): c is ConversationListItem & {
              reflectionSummary: string;
              reflectionTakeaway: string;
              reflectionGeneratedAt: string;
            } =>
              Boolean(
                c.reflectionSummary &&
                  c.reflectionTakeaway &&
                  c.reflectionGeneratedAt,
              ),
          )
          .sort(
            (a, b) =>
              new Date(b.reflectionGeneratedAt).getTime() -
              new Date(a.reflectionGeneratedAt).getTime(),
          )
          .slice(0, 5);

        // Hide the whole card while we're loading or errored — the recent
        // conversations card already surfaces those states for the same
        // data source, so duplicating them here would feel noisy.
        if (
          conversationsLoading ||
          conversationsError ||
          reflectionItems.length === 0
        ) {
          return null;
        }

        return (
          <Card
            elevation={1}
            style={styles.reflectionsCard}
            testID="profile-reflections-card"
          >
            <ThemedText type="h4" style={styles.cardTitle}>
              {t("profile.reflections.title")}
            </ThemedText>
            <ThemedText
              type="small"
              style={[styles.cardDescription, { color: theme.textMuted }]}
            >
              {t("profile.reflections.subtitle")}
            </ThemedText>
            <View testID="profile-reflections-list">
              {reflectionItems.map((c, index) => {
                const isLast = index === reflectionItems.length - 1;
                const titleLabel = displayConversationTitle(
                  c.title,
                  c.createdAt,
                );
                return (
                  <Pressable
                    key={c.id}
                    onPress={() =>
                      handleOpenConversation(c)
                    }
                    style={({ pressed }) => [
                      styles.reflectionRow,
                      !isLast && {
                        borderBottomColor: theme.backgroundSecondary,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                      pressed && { opacity: 0.6 },
                    ]}
                    testID={`profile-reflection-row-${c.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("profile.conversations.openA11y", { title: titleLabel })}
                  >
                    <View style={styles.reflectionRowHeader}>
                      <Text
                        style={[
                          styles.reflectionRowSource,
                          { color: theme.text },
                        ]}
                        numberOfLines={1}
                      >
                        {titleLabel}
                      </Text>
                      <Text
                        style={[
                          styles.reflectionRowTime,
                          { color: theme.textMuted },
                        ]}
                        numberOfLines={1}
                      >
                        {formatRelativeTime(c.reflectionGeneratedAt, t, locale)}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.reflectionRowTakeaway,
                        { color: theme.text },
                      ]}
                      numberOfLines={2}
                      testID={`profile-reflection-takeaway-${c.id}`}
                    >
                      {c.reflectionTakeaway}
                    </Text>
                    <Text
                      style={[
                        styles.reflectionRowSummary,
                        { color: theme.textMuted },
                      ]}
                      numberOfLines={3}
                      testID={`profile-reflection-summary-${c.id}`}
                    >
                      {c.reflectionSummary}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        );
      })()}

      <Card elevation={1} style={styles.inviteCard} testID="profile-invite-card">
        <ThemedText type="h4" style={styles.cardTitle}>
          Invite a friend, share a free week
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          When a friend signs up with your code, you both get a week of
          unlimited reflection on us.
        </ThemedText>

        {referralLoading ? (
          <View
            style={styles.loadingContainer}
            testID="profile-invite-loading"
          >
            <ActivityIndicator color={theme.orbPrimary} />
          </View>
        ) : referralError ? (
          <View
            style={styles.errorContainer}
            testID="profile-invite-error"
          >
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {referralError}
            </Text>
            <Pressable
              onPress={() => loadReferral()}
              style={({ pressed }) => [
                styles.personalizationRetry,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              testID="profile-invite-retry"
            >
              <Text
                style={[
                  styles.personalizationRetryText,
                  { color: theme.orbPrimary },
                ]}
              >
                Retry
              </Text>
            </Pressable>
          </View>
        ) : referral ? (
          <View>
            {referral.activeCredit ? (
              <View
                style={[
                  styles.inviteCreditBanner,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderColor: theme.orbPrimary,
                  },
                ]}
                testID="profile-invite-credit-banner"
              >
                <Feather
                  name="gift"
                  size={14}
                  color={theme.orbPrimary}
                />
                <Text
                  style={[
                    styles.inviteCreditText,
                    { color: theme.text },
                  ]}
                  testID="text-invite-credit"
                >
                  Free week active until{" "}
                  {new Date(referral.activeCredit.endsAt).toLocaleDateString(
                    undefined,
                    { month: "short", day: "numeric" },
                  )}
                </Text>
              </View>
            ) : null}

            <View
              style={[
                styles.inviteCodeBox,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.backgroundSecondary,
                },
              ]}
            >
              <Text
                style={[
                  styles.inviteCodeLabel,
                  { color: theme.textMuted },
                ]}
              >
                Your code
              </Text>
              <Text
                style={[styles.inviteCode, { color: theme.text }]}
                testID="text-referral-code"
                selectable
              >
                {referral.code.toUpperCase()}
              </Text>
            </View>

            <Pressable
              onPress={handleShareInvite}
              disabled={shareInFlight}
              style={({ pressed }) => [
                styles.inviteShareButton,
                {
                  backgroundColor: theme.orbPrimary,
                  opacity: pressed ? 0.85 : shareInFlight ? 0.7 : 1,
                },
              ]}
              testID="button-invite-share"
              accessibilityRole="button"
              accessibilityLabel="Share invite link"
            >
              {shareInFlight ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather name="share-2" size={16} color="#fff" />
                  <Text style={styles.inviteShareButtonText}>
                    Share invite
                  </Text>
                </>
              )}
            </Pressable>

            {shareError ? (
              <Text
                style={[
                  styles.errorText,
                  { color: theme.textMuted, marginTop: Spacing.sm },
                ]}
                testID="text-invite-share-error"
              >
                {shareError}
              </Text>
            ) : null}

            <Text
              style={[
                styles.inviteCounter,
                { color: theme.textMuted },
              ]}
              testID="text-referrals-count"
            >
              {referral.joinedCount === 0
                ? "No friends have joined yet."
                : referral.joinedCount === 1
                  ? "1 friend has joined."
                  : `${referral.joinedCount} friends have joined.`}
            </Text>
          </View>
        ) : null}
      </Card>

      <Card elevation={1} style={styles.conversationsCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          {t("profile.conversations.title")}
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          {t("profile.conversations.subtitle")}
        </ThemedText>

        {conversationsLoading ? (
          <View
            style={styles.loadingContainer}
            testID="profile-conversations-loading"
          >
            <ActivityIndicator color={theme.orbPrimary} />
          </View>
        ) : conversationsError ? (
          <View
            style={styles.errorContainer}
            testID="profile-conversations-error"
          >
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {conversationsError}
            </Text>
          </View>
        ) : conversations && conversations.length > 0 ? (
          <View testID="profile-conversations-list">
            {conversations.map((conversation, index) => {
              const isLast = index === conversations.length - 1;
              const preview = conversation.lastMessage?.content?.trim() ?? "";
              const previewLabel =
                preview.length > 0 ? preview : t("profile.conversations.noMessages");
              const stampSource =
                conversation.lastMessage?.createdAt ?? conversation.createdAt;
              const rolePrefix =
                conversation.lastMessage?.role === "assistant"
                  ? t("profile.conversations.rolePrefix.assistant")
                  : conversation.lastMessage?.role === "user"
                    ? t("profile.conversations.rolePrefix.user")
                    : "";
              const titleLabel = displayConversationTitle(
                conversation.title,
                conversation.createdAt,
              );
              return (
                <View
                  key={conversation.id}
                  style={[
                    styles.conversationRow,
                    !isLast && {
                      borderBottomColor: theme.backgroundSecondary,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Pressable
                    onPress={() => handleOpenConversation(conversation)}
                    style={({ pressed }) => [
                      styles.conversationContent,
                      pressed && { opacity: 0.6 },
                    ]}
                    testID={`profile-conversation-row-${conversation.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("profile.conversations.openA11y", { title: titleLabel })}
                  >
                    <View style={styles.conversationHeader}>
                      <Text
                        style={[
                          styles.conversationTitle,
                          { color: theme.text },
                        ]}
                        numberOfLines={1}
                        testID={`profile-conversation-title-${conversation.id}`}
                      >
                        {titleLabel}
                      </Text>
                      <Text
                        style={[
                          styles.conversationTime,
                          { color: theme.textMuted },
                        ]}
                        numberOfLines={1}
                        testID={`profile-conversation-time-${conversation.id}`}
                      >
                        {formatRelativeTime(stampSource, t, locale)}
                      </Text>
                    </View>
                    {conversation.reflectionTakeaway ? (
                      <Text
                        style={[
                          styles.conversationTakeaway,
                          { color: theme.text },
                        ]}
                        numberOfLines={2}
                        testID={`profile-conversation-takeaway-${conversation.id}`}
                      >
                        {conversation.reflectionTakeaway}
                      </Text>
                    ) : (
                      <Text
                        style={[
                          styles.conversationPreview,
                          { color: theme.textMuted },
                        ]}
                        numberOfLines={2}
                        testID={`profile-conversation-preview-${conversation.id}`}
                      >
                        {`${rolePrefix}${previewLabel}`}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => requestRenameConversation(conversation)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.conversationActionButton,
                      { backgroundColor: theme.backgroundSecondary },
                      pressed && { opacity: 0.6 },
                    ]}
                    testID={`profile-conversation-rename-${conversation.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("profile.conversations.renameA11y", { title: titleLabel })}
                  >
                    <Feather
                      name="edit-2"
                      size={16}
                      color={theme.textMuted}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => requestDeleteConversation(conversation)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.conversationActionButton,
                      { backgroundColor: theme.backgroundSecondary },
                      pressed && { opacity: 0.6 },
                    ]}
                    testID={`profile-conversation-delete-${conversation.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("profile.conversations.deleteA11y", { title: titleLabel })}
                  >
                    <Feather
                      name="trash-2"
                      size={18}
                      color={theme.textMuted}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <View
            style={styles.emptyContainer}
            testID="profile-conversations-empty"
          >
            <Text style={[styles.errorText, { color: theme.textMuted }]}>
              {t("profile.conversations.emptyExpanded")}
            </Text>
          </View>
        )}
      </Card>

      <Card elevation={1} style={styles.exportCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          Your data
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          Download an archive of everything Solence has stored for you &mdash;
          your account, preferences, conversations, messages, saved moments,
          mood entries, and usage history. One JSON file per category, plus a
          short README.
        </ThemedText>

        <Pressable
          onPress={handleExportData}
          disabled={exporting}
          style={({ pressed }) => [
            styles.exportButton,
            {
              backgroundColor: theme.orbPrimary,
              opacity: exporting ? 0.7 : pressed ? 0.85 : 1,
            },
          ]}
          testID="button-export-data"
          accessibilityRole="button"
          accessibilityLabel="Export my data"
          accessibilityState={{ disabled: exporting, busy: exporting }}
        >
          {exporting ? (
            <ActivityIndicator color={theme.backgroundRoot} />
          ) : (
            <Text
              style={[styles.exportButtonText, { color: theme.backgroundRoot }]}
            >
              Export my data
            </Text>
          )}
        </Pressable>

        {exportError ? (
          <Text
            style={[styles.exportStatusText, { color: theme.textMuted }]}
            testID="text-export-error"
          >
            {exportError}
          </Text>
        ) : exportStatus ? (
          <Text
            style={[styles.exportStatusText, { color: theme.textMuted }]}
            testID="text-export-status"
          >
            {exportStatus}
          </Text>
        ) : (
          <Text style={[styles.exportStatusText, { color: theme.textMuted }]}>
            You can request a fresh archive every 5 minutes.
          </Text>
        )}
      </Card>

      <PersonalizationDialog
        visible={showPersonalization}
        initial={preferences}
        loading={personalizationSaving}
        errorMessage={personalizationError}
        onConfirm={savePersonalization}
        onCancel={cancelPersonalization}
      />

      <RenameDialog
        visible={pendingRename !== null}
        title={t("profile.conversations.renameDialog.title")}
        description={t("profile.conversations.renameDialog.description")}
        initialValue={pendingRename?.title ?? ""}
        placeholder={t("profile.conversations.renameDialog.placeholder")}
        confirmLabel={t("profile.conversations.renameDialog.confirm")}
        loading={renameSubmitting}
        errorMessage={renameError}
        onConfirm={confirmRenameConversation}
        onCancel={cancelRenameConversation}
        testID="profile-rename-dialog"
      />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={t("profile.conversations.deleteConfirm.title")}
        message={
          deleteError
            ? deleteError
            : pendingDelete
              ? t("profile.conversations.deleteConfirm.messageWithTitle", {
                  title: displayConversationTitle(
                    pendingDelete.title,
                    pendingDelete.createdAt,
                  ),
                })
              : undefined
        }
        confirmLabel={t("profile.conversations.deleteConfirm.confirm")}
        cancelLabel={t("profile.conversations.deleteConfirm.cancel")}
        destructive
        loading={deleteSubmitting}
        onConfirm={confirmDeleteConversation}
        onCancel={cancelDeleteConversation}
        testID="profile-delete-confirm"
      />

      <RenameDialog
        visible={pendingEditMemory !== null}
        title={t("profile.memories.editDialog.title")}
        description={t("profile.memories.editDialog.description")}
        initialValue={pendingEditMemory?.text ?? ""}
        placeholder={t("profile.memories.editDialog.placeholder")}
        confirmLabel={t("profile.memories.editDialog.confirm")}
        maxLength={USER_MEMORY_TEXT_MAX_LEN}
        loading={editMemorySubmitting}
        errorMessage={editMemoryError}
        onConfirm={confirmEditMemory}
        onCancel={cancelEditMemory}
        testID="profile-memory-edit-dialog"
      />

      <ConfirmDialog
        visible={showClearMemoriesConfirm}
        title={t("profile.memories.clearConfirmTitle")}
        message={
          memoryActionError
            ? memoryActionError
            : t("profile.memories.clearConfirmMessage")
        }
        confirmLabel={t("profile.memories.clearConfirmAction")}
        destructive
        loading={clearMemoriesSubmitting}
        onConfirm={handleConfirmClearMemories}
        onCancel={() => {
          if (clearMemoriesSubmitting) return;
          setShowClearMemoriesConfirm(false);
        }}
        testID="profile-memories-clear-confirm"
      />

      <MessageActionSheet
        visible={actionSheetMoment !== null}
        isFavorite
        onSelect={handleSelectSavedMomentAction}
        onCancel={handleCloseSavedMomentActionSheet}
        testID="profile-saved-moment-action-sheet"
      />

      <ShareQuoteModal
        visible={shareQuoteMoment !== null}
        quote={shareQuoteMoment?.message.content ?? null}
        onClose={handleCloseShareSavedMoment}
        testID="profile-saved-moment-share-quote"
      />

      <TimePickerModal
        visible={timePickerTarget !== null}
        value={timeStringToDate(
          timePickerTarget === "weekly"
            ? preferences.weeklySummaryTime
            : preferences.reminderTime,
        )}
        is24Hour={isLocale24Hour(locale)}
        locale={locale}
        onSelect={handleConfirmCustomTime}
        onCancel={handleCancelCustomTime}
        testID="profile-time-picker"
      />
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    paddingVertical: Spacing.xl,
  },
  historyCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  voiceCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  textSizeCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  textSizeSegment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: BorderRadius.full,
    gap: 4,
  },
  textSizeSegmentItem: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  textSizePreview: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  textSizePreviewLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: fontForWeight("500"),
  },
  textSizePreviewBody: {
    fontFamily: fontForWeight("300"),
  },
  lockCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  lockToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lockToggleText: {
    flex: 1,
    gap: 4,
  },
  lockToggleTitle: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
  },
  lockToggleHelp: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    lineHeight: 18,
  },
  lockError: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    marginTop: Spacing.sm,
    textAlign: "left",
  },
  lockTimerSection: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  lockTimerLabel: {
    ...Typography.small,
    fontSize: 12,
    fontFamily: fontForWeight("500"),
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  lockTimerOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs + 2,
  },
  lockTimerChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  customTimerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  lockTimerChipText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
  remindersCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  weeklyCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  weeklyOpenButton: {
    marginTop: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  weeklyOpenText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
  weeklyDayChip: {
    minWidth: 38,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  openSettingsButton: {
    alignSelf: "flex-start",
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  openSettingsText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
  languageCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  voiceList: {
    gap: Spacing.sm,
  },
  voiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  voiceRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  voiceRowText: {
    flex: 1,
    gap: 2,
  },
  voiceRowTitle: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
  },
  voiceRowDescription: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
  },
  voiceRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  voicePreviewButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minWidth: 84,
    justifyContent: "center",
  },
  voicePreviewText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
  voiceErrorText: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  inviteCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  inviteCreditBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  inviteCreditText: {
    ...Typography.small,
    fontFamily: fontForWeight("500"),
    flex: 1,
  },
  inviteCodeBox: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    alignItems: "center",
    gap: Spacing.xs,
  },
  inviteCodeLabel: {
    ...Typography.small,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: fontForWeight("500"),
  },
  inviteCode: {
    ...Typography.h4,
    fontFamily: fontForWeight("700"),
    fontSize: 28,
    letterSpacing: 4,
  },
  inviteShareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.lg,
  },
  inviteShareButtonText: {
    color: "#fff",
    ...Typography.body,
    fontFamily: fontForWeight("600"),
    letterSpacing: 0.3,
  },
  inviteCounter: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    textAlign: "center",
    marginTop: Spacing.md,
  },
  conversationsCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  exportCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  exportButton: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  exportButtonText: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
  },
  exportStatusText: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  savedMomentsCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  memoriesCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  memoriesHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  memoriesHeaderText: {
    flex: 1,
  },
  memoriesClearButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  memoriesClearButtonText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
  memoryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  memoryContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  memoryText: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
    lineHeight: 22,
  },
  memorySourceLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  memorySourceText: {
    ...Typography.small,
    fontFamily: fontForWeight("500"),
  },
  memoriesPrivacyText: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    marginTop: Spacing.lg,
    lineHeight: 18,
  },
  moodCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  moodChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  moodDayCol: {
    flex: 1,
    alignItems: "center",
    gap: Spacing.xs,
  },
  moodDotSlot: {
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  moodDot: {},
  moodDayLabel: {
    ...Typography.small,
    fontSize: 11,
    fontFamily: fontForWeight("500"),
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  moodSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  moodSummaryBlock: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  moodSummaryDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
  },
  moodSummaryLabel: {
    ...Typography.small,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  moodSummaryValue: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
    fontSize: 16,
  },
  savedMomentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  savedMomentContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  savedMomentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  savedMomentSource: {
    flex: 1,
    ...Typography.small,
    fontSize: 12,
    fontFamily: fontForWeight("600"),
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  savedMomentTime: {
    ...Typography.small,
    fontSize: 11,
    fontFamily: fontForWeight("400"),
  },
  savedMomentSnippet: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
  },
  personalizationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  personalizationHeaderText: {
    flex: 1,
  },
  personalizationEdit: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  personalizationEditText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
  personalizationLoading: {
    paddingVertical: Spacing.xl,
    alignItems: "center",
  },
  personalizationError: {
    paddingVertical: Spacing.lg,
    alignItems: "center",
    gap: Spacing.sm,
  },
  personalizationRetry: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  personalizationRetryText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
  personalizationFields: {
    marginTop: Spacing.md,
    gap: Spacing.md,
  },
  personalizationRow: {
    gap: Spacing.xs,
  },
  personalizationLabel: {
    ...Typography.small,
    fontSize: 12,
    fontFamily: fontForWeight("500"),
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  personalizationValue: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
  },
  personalizationChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs / 2,
  },
  personalizationChip: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  personalizationChipText: {
    fontSize: 13,
    fontFamily: fontForWeight("500"),
  },
  cardTitle: {
    marginBottom: Spacing.xs,
  },
  cardDescription: {
    marginBottom: Spacing.xl,
  },
  loadingContainer: {
    paddingVertical: Spacing["3xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  errorContainer: {
    paddingVertical: Spacing["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    paddingVertical: Spacing["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    textAlign: "center",
  },
  chartContainer: {
    marginTop: Spacing.sm,
  },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 180,
  },
  barColumn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.xs / 2,
  },
  barValue: {
    ...Typography.small,
    fontSize: 11,
    lineHeight: 14,
    marginBottom: Spacing.xs,
    fontFamily: fontForWeight("400"),
  },
  barTrack: {
    width: "70%",
    maxWidth: 28,
    height: 120,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  barFill: {
    width: "100%",
    borderRadius: BorderRadius.sm,
  },
  barLabel: {
    ...Typography.small,
    fontSize: 12,
    lineHeight: 16,
    marginTop: Spacing.sm,
    fontFamily: fontForWeight("400"),
  },
  legendRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.xl,
    paddingTop: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legendItem: {
    flex: 1,
    alignItems: "center",
  },
  legendValue: {
    ...Typography.h4,
    fontFamily: fontForWeight("600"),
  },
  legendLabel: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    marginTop: Spacing.xs,
  },
  conversationRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  conversationContent: {
    flex: 1,
  },
  conversationActionButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  conversationTitle: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
    flex: 1,
    marginRight: Spacing.sm,
  },
  conversationTime: {
    ...Typography.small,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontForWeight("400"),
  },
  conversationPreview: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
  },
  conversationTakeaway: {
    ...Typography.body,
    fontFamily: fontForWeight("500"),
    fontStyle: "italic",
  },
  reflectionsCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  reflectionRow: {
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  reflectionRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  reflectionRowSource: {
    flex: 1,
    ...Typography.small,
    fontSize: 12,
    fontFamily: fontForWeight("600"),
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  reflectionRowTime: {
    ...Typography.small,
    fontSize: 11,
    fontFamily: fontForWeight("400"),
  },
  reflectionRowTakeaway: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
    marginTop: Spacing.xs,
  },
  reflectionRowSummary: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    lineHeight: 18,
  },
});
