import { useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  Typography,
  fontForWeight,
} from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";

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

  const [data, setData] = useState<ConversationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: title ?? "Conversation" });
  }, [navigation, title]);

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
});
