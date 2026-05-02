import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RenameDialog } from "@/components/RenameDialog";
import { PersonalizationDialog } from "@/components/PersonalizationDialog";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  Typography,
  fontForWeight,
} from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import { displayConversationTitle } from "@/lib/conversation-title";
import {
  DEFAULT_VOICE,
  EMPTY_PREFERENCES,
  INTENT_LABELS,
  TONE_LABELS,
  VOICES,
  VOICE_DESCRIPTIONS,
  VOICE_LABELS,
  type ClientPreferences,
} from "@/lib/preferences";
import type { Intent, Tone, Voice } from "@shared/schema";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const STORAGE_KEY_AUTH_TOKEN = "solence_auth_token";
const HISTORY_DAYS = 7;
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

function formatDayLabel(iso: string, isToday: boolean): string {
  if (isToday) return "Today";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
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

  const [preferences, setPreferences] =
    useState<ClientPreferences>(EMPTY_PREFERENCES);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [showPersonalization, setShowPersonalization] = useState(false);
  const [personalizationSaving, setPersonalizationSaving] = useState(false);
  const [personalizationError, setPersonalizationError] = useState<
    string | null
  >(null);

  // "Solence's voice" picker state. Selection saves immediately on tap;
  // preview hits a separate rate-limited endpoint and plays via expo-audio.
  const [voiceSaving, setVoiceSaving] = useState<Voice | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<Voice | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState<Voice | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewPlayer = useAudioPlayer("");
  const previewPlayingRef = useRef<Voice | null>(null);

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

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadConversations(controller.signal);
      loadSavedMoments(controller.signal);
      return () => {
        controller.abort();
      };
    }, [loadConversations, loadSavedMoments]),
  );

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
              Personalization
            </ThemedText>
            <ThemedText
              type="small"
              style={[styles.cardDescription, { color: theme.textMuted }]}
            >
              Shape how Solence greets you and the tone she leans into.
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
            accessibilityLabel="Edit personalization"
          >
            <Feather name="edit-2" size={14} color={theme.orbPrimary} />
            <Text
              style={[
                styles.personalizationEditText,
                { color: theme.orbPrimary },
              ]}
            >
              Edit
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
                Retry
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
                Name
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
                {preferences.displayName ?? "Not set"}
              </Text>
            </View>
            <View style={styles.personalizationRow}>
              <Text
                style={[
                  styles.personalizationLabel,
                  { color: theme.textMuted },
                ]}
              >
                Focus
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
                        {INTENT_LABELS[intent]}
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
                  Not set
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
                Tone
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
                {preferences.tone ? TONE_LABELS[preferences.tone] : "Not set"}
              </Text>
            </View>
          </View>
        )}
      </Card>

      <Card elevation={1} style={styles.voiceCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          Solence&rsquo;s voice
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          Pick the voice Solence speaks with. Tap Preview to hear a short sample.
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
                  accessibilityLabel={`Select voice ${VOICE_LABELS[voice]}`}
                >
                  <View style={styles.voiceRowText}>
                    <Text
                      style={[styles.voiceRowTitle, { color: theme.text }]}
                      testID={`profile-voice-label-${voice}`}
                    >
                      {VOICE_LABELS[voice]}
                    </Text>
                    <Text
                      style={[
                        styles.voiceRowDescription,
                        { color: theme.textMuted },
                      ]}
                    >
                      {VOICE_DESCRIPTIONS[voice]}
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
                      ? `Stop preview of ${VOICE_LABELS[voice]}`
                      : `Preview ${VOICE_LABELS[voice]}`
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
                        {isPlaying ? "Stop" : "Preview"}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      </Card>

      <Card elevation={1} style={styles.historyCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          Last {HISTORY_DAYS} days
        </ThemedText>
        <ThemedText type="small" style={[styles.cardDescription, { color: theme.textMuted }]}>
          Your daily token usage compared to the {formatTokens(tokenLimit)} daily cap.
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
                const dateLabel = formatDayLabel(day.periodStart, isToday);
                const accessibilityLabel = `${formatFullDate(day.periodStart)}: ${formatTokens(day.tokensUsed)} of ${formatTokens(tokenLimit)} tokens used`;
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
                  Total used
                </Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={[styles.legendValue, { color: theme.text }]} testID="profile-history-average">
                  {formatTokens(dailyAverage)}
                </Text>
                <Text style={[styles.legendLabel, { color: theme.textMuted }]}>
                  Daily average
                </Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={[styles.legendValue, { color: theme.text }]}>
                  {formatTokens(tokenLimit)}
                </Text>
                <Text style={[styles.legendLabel, { color: theme.textMuted }]}>
                  Daily cap
                </Text>
              </View>
            </View>
          </View>
        ) : null}
      </Card>

      <Card elevation={1} style={styles.savedMomentsCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          Saved moments
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          Replies you bookmarked from your conversations.
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
                    style={({ pressed }) => [
                      styles.savedMomentContent,
                      pressed && { opacity: 0.6 },
                    ]}
                    testID={`profile-saved-moment-row-${moment.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Open saved moment from ${titleLabel}`}
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
                        {formatRelativeTime(moment.favoritedAt)}
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
                    accessibilityLabel={`Remove saved moment from ${titleLabel}`}
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
              Tap the bookmark on any reply from Solence to keep it here.
            </Text>
          </View>
        )}
      </Card>

      <Card elevation={1} style={styles.conversationsCard}>
        <ThemedText type="h4" style={styles.cardTitle}>
          Recent conversations
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.cardDescription, { color: theme.textMuted }]}
        >
          Tap any session to revisit what you talked about with Solence.
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
              const previewLabel = preview.length > 0 ? preview : "No messages yet";
              const stampSource =
                conversation.lastMessage?.createdAt ?? conversation.createdAt;
              const rolePrefix =
                conversation.lastMessage?.role === "assistant"
                  ? "Solence: "
                  : conversation.lastMessage?.role === "user"
                    ? "You: "
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
                    accessibilityLabel={`Open conversation ${titleLabel}`}
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
                        {formatRelativeTime(stampSource)}
                      </Text>
                    </View>
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
                    accessibilityLabel={`Rename conversation ${conversation.title}`}
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
                    accessibilityLabel={`Delete conversation ${titleLabel}`}
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
              You haven&rsquo;t had any sessions yet. Open Solence to start one.
            </Text>
          </View>
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
        title="Rename conversation"
        description="Give this session a name that will help you find it later."
        initialValue={pendingRename?.title ?? ""}
        placeholder="Conversation title"
        confirmLabel="Save"
        loading={renameSubmitting}
        errorMessage={renameError}
        onConfirm={confirmRenameConversation}
        onCancel={cancelRenameConversation}
        testID="profile-rename-dialog"
      />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete this conversation?"
        message={
          deleteError
            ? deleteError
            : pendingDelete
              ? `"${displayConversationTitle(pendingDelete.title, pendingDelete.createdAt)}" and all of its messages will be permanently removed. This can't be undone.`
              : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        loading={deleteSubmitting}
        onConfirm={confirmDeleteConversation}
        onCancel={cancelDeleteConversation}
        testID="profile-delete-confirm"
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
  conversationsCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  savedMomentsCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
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
});
