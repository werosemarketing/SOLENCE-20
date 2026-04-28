import { useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

const STORAGE_KEY_AUTH_TOKEN = "solence_auth_token";

type Message = {
  id: number;
  role: string;
  content: string;
  createdAt: string;
};

type ConversationResponse = {
  conversation: {
    id: number;
    title: string;
    createdAt: string;
  };
  messages: Message[];
};

type Props = NativeStackScreenProps<ProfileStackParamList, "ConversationDetail">;

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
  const { conversationId, title } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();

  const handleContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // ConversationDetail sits in the Profile stack which is itself a screen
    // inside the bottom tab navigator. Navigating from the tab navigator to
    // HomeTab both switches tabs and forwards the param to SolenceScreen.
    const tabNav = navigation.getParent<
      BottomTabNavigationProp<MainTabParamList>
    >();
    if (tabNav) {
      tabNav.navigate("HomeTab", { activeConversationId: conversationId });
    }
  };

  const [data, setData] = useState<ConversationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title ?? "Conversation",
      headerRight: () => (
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
      ),
    });
  }, [navigation, title, theme.text]);

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

  return (
    <ScrollView
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
          {data.messages.map((message) => {
            const isUser = message.role === "user";
            const bubbleColor = isUser
              ? theme.orbPrimary
              : theme.backgroundDefault;
            const textColor = isUser ? theme.buttonText : theme.text;
            return (
              <View
                key={message.id}
                style={[
                  styles.bubbleRow,
                  { justifyContent: isUser ? "flex-end" : "flex-start" },
                ]}
                testID={`conversation-detail-message-${message.id}`}
              >
                <View
                  style={[
                    styles.bubble,
                    {
                      backgroundColor: bubbleColor,
                      borderBottomRightRadius: isUser
                        ? BorderRadius.xs
                        : BorderRadius.lg,
                      borderBottomLeftRadius: isUser
                        ? BorderRadius.lg
                        : BorderRadius.xs,
                    },
                  ]}
                >
                  <Text style={[styles.bubbleText, { color: textColor }]}>
                    {message.content}
                  </Text>
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
                </View>
              </View>
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
            : `"${title ?? "This conversation"}" and all of its messages will be permanently removed. This can't be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        loading={deleteSubmitting}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        testID="conversation-detail-delete-confirm"
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
  bubbleRow: {
    flexDirection: "row",
    marginBottom: Spacing.md,
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
  bubbleMeta: {
    ...Typography.small,
    fontSize: 11,
    lineHeight: 14,
    marginTop: Spacing.xs,
    fontFamily: fontForWeight("400"),
  },
  emptyTitle: {
    marginBottom: Spacing.xs,
  },
  emptyDescription: {},
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
