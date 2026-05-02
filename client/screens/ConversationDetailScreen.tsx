import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CrisisBanner } from "@/components/CrisisBanner";
import { RenameDialog } from "@/components/RenameDialog";
import { MessageActionSheet } from "@/components/MessageActionSheet";
import { ShareQuoteModal } from "@/components/ShareQuoteModal";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  Typography,
  FontFamily,
  fontForWeight,
} from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import { displayConversationTitle } from "@/lib/conversation-title";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const STORAGE_KEY_AUTH_TOKEN = "solence_auth_token";

type Message = {
  id: number;
  role: string;
  content: string;
  createdAt: string;
  isFavorite?: boolean;
  crisisSupport?: boolean;
};

type ConversationResponse = {
  conversation: {
    id: number;
    title: string;
    createdAt: string;
    reflectionSummary?: string | null;
    reflectionTakeaway?: string | null;
    reflectionGeneratedAt?: string | null;
  };
  messages: Message[];
};

type Props = NativeStackScreenProps<RootStackParamList, "ConversationDetail">;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ConversationDetailScreen({ route, navigation }: Props) {
  const { conversationId, title, scrollToMessageId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();

  const handleContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // ConversationDetail lives at the root stack level, with the bottom tab
    // navigator (`Main`) as a sibling route. Navigating to Main pops this
    // screen off the stack, switches to the HomeTab, and forwards the
    // active-conversation params so SolenceScreen can show a
    // "Continuing {title}" pill — otherwise the home screen would only
    // know an opaque numeric id.
    navigation.navigate("Main", {
      screen: "HomeTab",
      params: {
        activeConversationId: conversationId,
        activeConversationTitle: data?.conversation.title ?? title,
      },
    });
  };

  const [data, setData] = useState<ConversationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState<Set<number>>(new Set());
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  // Per-view dismissal of the crisis support banner. Re-opening this
  // screen (or hot-navigating to a different conversation) resets to
  // showing again — the banner is meant to be present for the user, but
  // dismissable when they've acknowledged it.
  const [crisisBannerDismissed, setCrisisBannerDismissed] = useState(false);
  // Long-press / share state. We track the currently selected message
  // independently from the modal/sheet visibility so a successful share
  // can leave the preview mounted long enough for the share sheet to
  // animate away before we tear down the captured view.
  const [actionSheetMessage, setActionSheetMessage] = useState<Message | null>(
    null,
  );
  const [shareQuoteMessage, setShareQuoteMessage] = useState<Message | null>(
    null,
  );

  // Refs for scroll-to-message behavior. The ScrollView ref lets us call
  // scrollTo with the measured y of the target row; the layoutByMessage
  // map captures each row's y position as it lays out so we don't have to
  // measure imperatively. layoutTick is bumped on every onLayout so the
  // scroll-to effect re-runs whenever new layout info arrives — without
  // it, the effect would fire once before any rows have measured and
  // never re-evaluate. The highlightAnim drives a brief flash on the
  // target so the user can tell which moment we jumped to.
  const scrollRef = useRef<ScrollView | null>(null);
  const layoutByMessage = useRef<Map<number, number>>(new Map());
  const hasScrolledToTarget = useRef(false);
  const highlightAnim = useRef(new Animated.Value(0)).current;
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  // Reset the scroll guard whenever the navigation target changes so a
  // fresh navigation (e.g. tapping a different saved moment) can scroll
  // again instead of being silently no-op'd by a stale "already scrolled"
  // flag.
  useEffect(() => {
    hasScrolledToTarget.current = false;
  }, [scrollToMessageId, conversationId]);

  // Prefer the freshly-loaded conversation title (with the legacy-default
  // fallback applied) so the header updates if the title was backfilled
  // server-side after navigation. After a rename, we update `data` below,
  // which makes this recompute automatically.
  const headerTitle =
    data?.conversation
      ? displayConversationTitle(
          data.conversation.title,
          data.conversation.createdAt,
        )
      : title ?? "Conversation";

  useLayoutEffect(() => {
    navigation.setOptions({
      title: headerTitle,
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => {
              setRenameError(null);
              setRenameVisible(true);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Rename this conversation"
            testID="conversation-detail-rename-button"
            style={({ pressed }) => [
              styles.headerActionButton,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Feather name="edit-2" size={18} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => {
              setDeleteError(null);
              setConfirmVisible(true);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Delete this conversation"
            testID="conversation-detail-delete-button"
            style={({ pressed }) => [
              styles.headerActionButton,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Feather name="trash-2" size={20} color={theme.text} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, headerTitle, theme.text]);

  const handleConfirmRename = async (nextTitle: string) => {
    if (renameSubmitting) return;
    const trimmed = nextTitle.trim();
    if (trimmed.length === 0) {
      setRenameError("Please enter a title.");
      return;
    }
    // Compare against the currently displayed title (which already accounts
    // for the legacy-default fallback) so submitting an unchanged value is
    // treated as a no-op.
    if (trimmed === headerTitle) {
      setRenameVisible(false);
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
        `${apiUrl}/api/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: trimmed }),
        },
      );
      if (!response.ok) {
        let serverMessage: string | null = null;
        try {
          const body = await response.json();
          if (body && typeof body.error === "string") {
            serverMessage = body.error;
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
      // Update the loaded conversation so headerTitle recomputes to the new
      // value, then forward the title back through route params so the back
      // navigation hand-off in ProfileScreen stays consistent.
      setData((prev) =>
        prev
          ? {
              ...prev,
              conversation: { ...prev.conversation, title: updatedTitle },
            }
          : prev,
      );
      navigation.setParams({ title: updatedTitle });
      setRenameVisible(false);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not rename this conversation";
      setRenameError(message);
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleCancelRename = () => {
    if (renameSubmitting) return;
    setRenameVisible(false);
    setRenameError(null);
  };

  const handleConfirmDelete = async () => {
    if (deleteSubmitting) return;
    try {
      setDeleteSubmitting(true);
      setDeleteError(null);
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/conversations/${conversationId}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      setConfirmVisible(false);
      navigation.goBack();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not delete this conversation";
      setDeleteError(message);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleCancelDelete = () => {
    if (deleteSubmitting) return;
    setConfirmVisible(false);
    setDeleteError(null);
  };

  const handleOpenActionSheet = (message: Message) => {
    if (message.role !== "assistant") return;
    Haptics.selectionAsync().catch(() => {});
    setActionSheetMessage(message);
  };

  const handleCloseActionSheet = () => {
    setActionSheetMessage(null);
  };

  const handleSelectAction = (action: "save" | "share" | "copy") => {
    const message = actionSheetMessage;
    if (!message) return;
    setActionSheetMessage(null);
    if (action === "save") {
      handleToggleFavorite(message);
    } else if (action === "share") {
      // Defer opening the share modal a tick so the action sheet's
      // dismissal animation doesn't visibly overlap the preview modal.
      setTimeout(() => setShareQuoteMessage(message), 120);
    } else if (action === "copy") {
      Clipboard.setStringAsync(message.content)
        .then(() => {
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          ).catch(() => {});
          setFavoriteError("Copied to clipboard.");
        })
        .catch(() => {
          setFavoriteError("Couldn't copy that text.");
        });
    }
  };

  const handleCloseShareQuote = () => {
    setShareQuoteMessage(null);
  };

  const handleToggleFavorite = async (message: Message) => {
    if (message.role !== "assistant") return;
    if (favoriteBusy.has(message.id)) return;

    const nextValue = !message.isFavorite;
    // Optimistic update: flip the bookmark immediately and roll back on
    // failure. The server endpoints are idempotent so a duplicate request
    // is harmless, which keeps the UX snappy without risking inconsistency.
    setData((prev) =>
      prev
        ? {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === message.id ? { ...m, isFavorite: nextValue } : m,
            ),
          }
        : prev,
    );
    setFavoriteBusy((current) => {
      const next = new Set(current);
      next.add(message.id);
      return next;
    });
    setFavoriteError(null);
    Haptics.selectionAsync().catch(() => {});

    try {
      const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const apiUrl = getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/messages/${message.id}/favorite`,
        { method: nextValue ? "POST" : "DELETE", headers },
      );
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
    } catch (e) {
      // Roll back the optimistic flip — preserve whatever the server
      // currently believes by reverting to the previous value.
      setData((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === message.id
                  ? { ...m, isFavorite: !nextValue }
                  : m,
              ),
            }
          : prev,
      );
      const fallback = nextValue
        ? "Couldn't save this moment. Try again?"
        : "Couldn't remove this from your saved moments.";
      const messageText = e instanceof Error ? e.message : fallback;
      setFavoriteError(messageText);
    } finally {
      setFavoriteBusy((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
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
          `${apiUrl}/api/conversations/${conversationId}/messages`,
          { headers },
        );
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        const payload = (await response.json()) as ConversationResponse;
        if (cancelled) return;
        setData(payload);
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof Error ? e.message : "Could not load conversation";
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Scroll-to-message effect: once the conversation is loaded and the
  // target row has reported its layout, scroll there and play a brief
  // highlight pulse so the user can spot which moment we jumped to.
  // hasScrolledToTarget guards against re-firing if layouts re-fire on
  // subsequent renders (e.g. when toggling a favorite).
  useEffect(() => {
    if (hasScrolledToTarget.current) return;
    if (!scrollToMessageId || !data) return;
    const y = layoutByMessage.current.get(scrollToMessageId);
    if (y === undefined) return;
    hasScrolledToTarget.current = true;
    setHighlightedId(scrollToMessageId);
    // Subtract the header height so the row lands below the translucent
    // header rather than getting hidden behind it.
    const targetY = Math.max(0, y - headerHeight - Spacing.lg);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: targetY, animated: true });
    });
    Animated.sequence([
      Animated.timing(highlightAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.delay(900),
      Animated.timing(highlightAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setHighlightedId(null);
    });
  }, [data, scrollToMessageId, headerHeight, highlightAnim, layoutTick]);

  // True when any message in this conversation was flagged with crisis-
  // relevant language. Drives the support banner so re-opening a thread
  // that previously triggered the flag still surfaces the resources.
  const hasCrisisSignal = useMemo(
    () => Boolean(data?.messages.some((m) => m.crisisSupport)),
    [data],
  );

  // Animated highlight color: interpolated from transparent to a soft
  // accent tint so the bubble briefly glows without flashing aggressively.
  const highlightBackground = useMemo(
    () =>
      highlightAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(0,0,0,0)", `${theme.orbPrimary}33`],
      }),
    [highlightAnim, theme.orbPrimary],
  );

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      testID="screen-conversation-detail"
    >
      {loading ? (
        <View
          style={styles.centerContainer}
          testID="conversation-detail-loading"
        >
          <ActivityIndicator color={theme.orbPrimary} />
        </View>
      ) : error ? (
        <View
          style={styles.centerContainer}
          testID="conversation-detail-error"
        >
          <Text style={[styles.errorText, { color: theme.textMuted }]}>
            {error}
          </Text>
        </View>
      ) : data && data.messages.length > 0 ? (
        <View testID="conversation-detail-messages">
          {hasCrisisSignal && !crisisBannerDismissed ? (
            <CrisisBanner
              onDismiss={() => setCrisisBannerDismissed(true)}
              style={styles.crisisBanner}
              testID="conversation-detail-crisis-banner"
            />
          ) : null}
          {data.conversation.reflectionSummary &&
          data.conversation.reflectionTakeaway ? (
            <Card
              elevation={1}
              style={styles.reflectionCard}
              testID="conversation-detail-reflection"
            >
              <Text
                style={[styles.reflectionLabel, { color: theme.textMuted }]}
              >
                Reflection
              </Text>
              <Text
                style={[styles.reflectionTakeaway, { color: theme.text }]}
                testID="conversation-detail-reflection-takeaway"
              >
                {data.conversation.reflectionTakeaway}
              </Text>
              <Text
                style={[styles.reflectionSummary, { color: theme.textMuted }]}
                testID="conversation-detail-reflection-summary"
              >
                {data.conversation.reflectionSummary}
              </Text>
            </Card>
          ) : null}
          {favoriteError ? (
            <Text
              style={[styles.favoriteErrorText, { color: theme.textMuted }]}
              testID="conversation-detail-favorite-error"
            >
              {favoriteError}
            </Text>
          ) : null}
          {data.messages.map((message) => {
            const isUser = message.role === "user";
            const bubbleColor = isUser
              ? theme.orbPrimary
              : theme.backgroundDefault;
            const textColor = isUser ? theme.buttonText : theme.text;
            const isHighlighted = highlightedId === message.id;
            const isFavorite = Boolean(message.isFavorite);
            const isBusy = favoriteBusy.has(message.id);
            return (
              <Animated.View
                key={message.id}
                onLayout={(e) => {
                  const previous = layoutByMessage.current.get(message.id);
                  const nextY = e.nativeEvent.layout.y;
                  layoutByMessage.current.set(message.id, nextY);
                  // Only bump the tick when this row is the scroll target
                  // and we haven't acted yet, or when its measured y
                  // changed — that keeps re-renders cheap on chats with
                  // many bubbles while still re-running the scroll effect
                  // as soon as the target row reports a real position.
                  if (
                    scrollToMessageId === message.id &&
                    !hasScrolledToTarget.current &&
                    previous !== nextY
                  ) {
                    setLayoutTick((t) => t + 1);
                  }
                }}
                style={[
                  styles.bubbleRow,
                  { justifyContent: isUser ? "flex-end" : "flex-start" },
                  isHighlighted && {
                    backgroundColor: highlightBackground,
                    borderRadius: BorderRadius.lg,
                  },
                ]}
                testID={`conversation-detail-message-${message.id}`}
              >
                <Pressable
                  onLongPress={
                    !isUser ? () => handleOpenActionSheet(message) : undefined
                  }
                  delayLongPress={300}
                  // Disable the default web "highlight on press" so the
                  // long-press gesture feels native rather than flashing
                  // a hover state.
                  android_disableSound
                  style={({ pressed }) => [
                    styles.bubble,
                    {
                      backgroundColor: bubbleColor,
                      borderBottomRightRadius: isUser
                        ? BorderRadius.xs
                        : BorderRadius.lg,
                      borderBottomLeftRadius: isUser
                        ? BorderRadius.lg
                        : BorderRadius.xs,
                      opacity: !isUser && pressed ? 0.85 : 1,
                    },
                  ]}
                  testID={`conversation-detail-bubble-${message.id}`}
                  accessibilityRole={!isUser ? "button" : undefined}
                  accessibilityHint={
                    !isUser
                      ? "Long-press for save, share, and copy options"
                      : undefined
                  }
                >
                  <Text style={[styles.bubbleText, { color: textColor }]}>
                    {message.content}
                  </Text>
                  <View style={styles.bubbleFooter}>
                    <Text
                      style={[
                        styles.bubbleMeta,
                        {
                          color: isUser
                            ? "rgba(255,255,255,0.7)"
                            : theme.textMuted,
                        },
                      ]}
                    >
                      {formatTimestamp(message.createdAt)}
                    </Text>
                    {!isUser ? (
                      <Pressable
                        onPress={() => handleToggleFavorite(message)}
                        disabled={isBusy}
                        hitSlop={10}
                        style={({ pressed }) => [
                          styles.bubbleFavoriteButton,
                          pressed && { opacity: 0.6 },
                        ]}
                        testID={`conversation-detail-favorite-${message.id}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isFavorite }}
                        accessibilityLabel={
                          isFavorite
                            ? "Remove from saved moments"
                            : "Save this moment"
                        }
                      >
                        <Feather
                          name="bookmark"
                          size={16}
                          color={
                            isFavorite ? theme.orbPrimary : theme.textMuted
                          }
                        />
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      ) : (
        <Card elevation={1}>
          <ThemedText type="h4" style={styles.emptyTitle}>
            No messages yet
          </ThemedText>
          <ThemedText
            type="small"
            style={[styles.emptyDescription, { color: theme.textMuted }]}
          >
            This conversation doesn&rsquo;t have any messages saved.
          </ThemedText>
        </Card>
      )}

      {!loading && !error ? (
        <Pressable
          onPress={handleContinue}
          style={({ pressed }) => [
            styles.continueButton,
            {
              backgroundColor: theme.orbPrimary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Continue this conversation"
          testID="button-continue-conversation"
        >
          <Feather name="message-circle" size={18} color={theme.buttonText} />
          <Text style={[styles.continueButtonText, { color: theme.buttonText }]}>
            Continue this conversation
          </Text>
        </Pressable>
      ) : null}

      <ConfirmDialog
        visible={confirmVisible}
        title="Delete this conversation?"
        message={
          deleteError
            ? deleteError
            : `"${headerTitle}" and all of its messages will be permanently removed. This can't be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        loading={deleteSubmitting}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        testID="conversation-detail-delete-confirm"
      />

      <RenameDialog
        visible={renameVisible}
        title="Rename conversation"
        description="Give this session a name that will help you find it later."
        initialValue={headerTitle}
        placeholder="Conversation title"
        confirmLabel="Save"
        loading={renameSubmitting}
        errorMessage={renameError}
        onConfirm={handleConfirmRename}
        onCancel={handleCancelRename}
        testID="conversation-detail-rename-dialog"
      />

      <MessageActionSheet
        visible={actionSheetMessage !== null}
        isFavorite={Boolean(actionSheetMessage?.isFavorite)}
        onSelect={handleSelectAction}
        onCancel={handleCloseActionSheet}
        testID="conversation-detail-action-sheet"
      />

      <ShareQuoteModal
        visible={shareQuoteMessage !== null}
        quote={shareQuoteMessage?.content ?? null}
        onClose={handleCloseShareQuote}
        testID="conversation-detail-share-quote"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    paddingVertical: Spacing["3xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    textAlign: "center",
  },
  favoriteErrorText: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  crisisBanner: {
    marginBottom: Spacing.lg,
  },
  reflectionCard: {
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  reflectionLabel: {
    ...Typography.small,
    fontSize: 11,
    fontFamily: fontForWeight("600"),
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  reflectionTakeaway: {
    ...Typography.body,
    fontSize: 17,
    lineHeight: 23,
    fontFamily: fontForWeight("600"),
  },
  reflectionSummary: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
  },
  bubbleRow: {
    flexDirection: "row",
    marginBottom: Spacing.md,
    paddingVertical: Spacing.xs / 2,
  },
  bubble: {
    maxWidth: "85%",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
  },
  bubbleText: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
  },
  bubbleFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.xs,
    gap: Spacing.sm,
  },
  bubbleMeta: {
    ...Typography.small,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontForWeight("400"),
  },
  bubbleFavoriteButton: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  emptyTitle: {
    marginBottom: Spacing.xs,
  },
  emptyDescription: {},
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  headerActionButton: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  continueButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
  },
  continueButtonText: {
    ...Typography.body,
    fontFamily: FontFamily.bold,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});
