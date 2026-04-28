import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadConversations(controller.signal);
      return () => {
        controller.abort();
      };
    }, [loadConversations]),
  );

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
  conversationsCard: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xl,
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
