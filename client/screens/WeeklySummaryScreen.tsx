import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

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
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const STORAGE_KEY_AUTH_TOKEN = "solence_auth_token";

type WeeklySummaryHighlight = {
  messageId: number;
  conversationId: number;
  content: string;
  createdAt: string;
};

type WeeklySummaryResponse = {
  weekOffset: number;
  weekStart: string;
  weekEnd: string;
  sessionCount: number;
  moodCount: number;
  avgMood: number | null;
  themes: string[];
  highlight: WeeklySummaryHighlight | null;
};

const MOOD_LABELS: Record<number, string> = {
  1: "rough",
  2: "low",
  3: "okay",
  4: "good",
  5: "great",
};

function formatDateRange(
  startIso: string,
  endIso: string,
  locale: string | undefined,
): string {
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    // weekEnd is exclusive (next Sunday) — show the inclusive Saturday.
    const lastDay = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const fmt = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    });
    return `${fmt.format(start)} – ${fmt.format(lastDay)}`;
  } catch {
    return "";
  }
}

function formatHighlightDate(
  iso: string,
  locale: string | undefined,
): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function snippet(content: string, max = 280): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  const sliced = trimmed.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const cutoff = lastSpace > max * 0.7 ? lastSpace : sliced.length;
  return `${sliced.slice(0, cutoff).trimEnd()}…`;
}

export default function WeeklySummaryScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "WeeklySummary">>();
  const initialOffset = route.params?.weekOffset ?? 0;

  const [weekOffset, setWeekOffset] = useState<number>(initialOffset);
  const [data, setData] = useState<WeeklySummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number, mode: "initial" | "refresh") => {
      try {
        if (mode === "initial") {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError(null);
        const token = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const apiUrl = getApiUrl();
        const response = await fetch(
          `${apiUrl}/api/weekly-summary?weekOffset=${offset}`,
          { headers },
        );
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        const payload = (await response.json()) as WeeklySummaryResponse;
        setData(payload);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : t("weeklySummary.errorGeneric");
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(weekOffset, "initial");
  }, [load, weekOffset]);

  const titleLabel = useMemo(() => {
    if (weekOffset === 0) return t("weeklySummary.thisWeek");
    if (weekOffset === -1) return t("weeklySummary.lastWeek");
    return t("weeklySummary.weeksAgo", { count: Math.abs(weekOffset) });
  }, [weekOffset, t]);

  const rangeLabel = useMemo(() => {
    if (!data) return "";
    return formatDateRange(data.weekStart, data.weekEnd, locale);
  }, [data, locale]);

  const goPrev = () => setWeekOffset((v) => Math.max(-52, v - 1));
  const goNext = () => setWeekOffset((v) => Math.min(0, v + 1));

  const isEmpty =
    !!data &&
    data.sessionCount === 0 &&
    data.moodCount === 0 &&
    data.themes.length === 0 &&
    !data.highlight;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(weekOffset, "refresh")}
          tintColor={theme.orbPrimary}
        />
      }
      testID="weekly-summary-scroll"
    >
      <View style={styles.weekNav}>
        <Pressable
          onPress={goPrev}
          disabled={weekOffset <= -52}
          style={({ pressed }) => [
            styles.weekNavButton,
            {
              borderColor: theme.backgroundSecondary,
              opacity: weekOffset <= -52 ? 0.3 : pressed ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t("weeklySummary.previousA11y")}
          testID="weekly-summary-prev"
        >
          <Feather name="chevron-left" size={20} color={theme.text} />
        </Pressable>
        <View style={styles.weekNavLabels}>
          <ThemedText
            type="h4"
            style={styles.weekNavTitle}
            testID="weekly-summary-title"
          >
            {titleLabel}
          </ThemedText>
          {rangeLabel ? (
            <Text
              style={[styles.weekNavRange, { color: theme.textMuted }]}
              testID="weekly-summary-range"
            >
              {rangeLabel}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={goNext}
          disabled={weekOffset >= 0}
          style={({ pressed }) => [
            styles.weekNavButton,
            {
              borderColor: theme.backgroundSecondary,
              opacity: weekOffset >= 0 ? 0.3 : pressed ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t("weeklySummary.nextA11y")}
          testID="weekly-summary-next"
        >
          <Feather name="chevron-right" size={20} color={theme.text} />
        </Pressable>
      </View>

      {loading ? (
        <View
          style={styles.loadingContainer}
          testID="weekly-summary-loading"
        >
          <ActivityIndicator color={theme.orbPrimary} />
        </View>
      ) : error ? (
        <Card elevation={1} style={styles.card}>
          <Text
            style={[styles.errorText, { color: theme.textMuted }]}
            testID="weekly-summary-error"
          >
            {error}
          </Text>
          <Pressable
            onPress={() => load(weekOffset, "refresh")}
            style={({ pressed }) => [
              styles.retryButton,
              {
                borderColor: theme.orbPrimary,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            accessibilityRole="button"
            testID="weekly-summary-retry"
          >
            <Text
              style={[styles.retryButtonText, { color: theme.orbPrimary }]}
            >
              {t("weeklySummary.retry")}
            </Text>
          </Pressable>
        </Card>
      ) : data ? (
        <>
          {isEmpty ? (
            <Card elevation={1} style={styles.card}>
              <ThemedText type="h4" style={styles.cardTitle}>
                {t("weeklySummary.empty.title")}
              </ThemedText>
              <Text
                style={[styles.cardBody, { color: theme.textMuted }]}
                testID="weekly-summary-empty"
              >
                {t("weeklySummary.empty.body")}
              </Text>
            </Card>
          ) : (
            <>
              <View style={styles.statsRow}>
                <Card elevation={1} style={styles.statCard}>
                  <Text
                    style={[styles.statLabel, { color: theme.textMuted }]}
                  >
                    {t("weeklySummary.sessions.title")}
                  </Text>
                  <Text
                    style={[styles.statValue, { color: theme.text }]}
                    testID="weekly-summary-sessions"
                  >
                    {data.sessionCount > 0
                      ? t("weeklySummary.sessions.value", {
                          count: data.sessionCount,
                        })
                      : t("weeklySummary.sessions.empty")}
                  </Text>
                </Card>
                <Card elevation={1} style={styles.statCard}>
                  <Text
                    style={[styles.statLabel, { color: theme.textMuted }]}
                  >
                    {t("weeklySummary.mood.title")}
                  </Text>
                  {data.avgMood != null ? (
                    <>
                      <Text
                        style={[styles.statValue, { color: theme.text }]}
                        testID="weekly-summary-mood"
                      >
                        {t("weeklySummary.mood.value", {
                          value: data.avgMood.toFixed(1),
                        })}
                      </Text>
                      <Text
                        style={[
                          styles.statSubvalue,
                          { color: theme.textMuted },
                        ]}
                      >
                        {t("weeklySummary.mood.entries", {
                          count: data.moodCount,
                        })}
                        {" · "}
                        {MOOD_LABELS[Math.round(data.avgMood)] ?? ""}
                      </Text>
                    </>
                  ) : (
                    <Text
                      style={[styles.statValue, { color: theme.textMuted }]}
                      testID="weekly-summary-mood-empty"
                    >
                      {t("weeklySummary.mood.empty")}
                    </Text>
                  )}
                </Card>
              </View>

              <Card elevation={1} style={styles.card}>
                <ThemedText type="h4" style={styles.cardTitle}>
                  {t("weeklySummary.themes.title")}
                </ThemedText>
                {data.themes.length > 0 ? (
                  <View
                    style={styles.themeChips}
                    testID="weekly-summary-themes"
                  >
                    {data.themes.map((theme_) => (
                      <View
                        key={theme_}
                        style={[
                          styles.themeChip,
                          {
                            backgroundColor: theme.backgroundSecondary,
                            borderColor: theme.backgroundSecondary,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.themeChipText,
                            { color: theme.text },
                          ]}
                        >
                          {theme_}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text
                    style={[styles.cardBody, { color: theme.textMuted }]}
                    testID="weekly-summary-themes-empty"
                  >
                    {t("weeklySummary.themes.empty")}
                  </Text>
                )}
              </Card>

              <Card elevation={1} style={styles.card}>
                <ThemedText type="h4" style={styles.cardTitle}>
                  {t("weeklySummary.highlight.title")}
                </ThemedText>
                {data.highlight ? (
                  <Pressable
                    onPress={() =>
                      navigation.navigate("ConversationDetail", {
                        conversationId: data.highlight!.conversationId,
                        scrollToMessageId: data.highlight!.messageId,
                      })
                    }
                    style={({ pressed }) => [
                      styles.highlightBlock,
                      {
                        borderLeftColor: theme.orbPrimary,
                        backgroundColor: theme.backgroundSecondary,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    testID="weekly-summary-highlight"
                  >
                    <Text
                      style={[styles.highlightQuote, { color: theme.text }]}
                    >
                      {snippet(data.highlight.content)}
                    </Text>
                    <Text
                      style={[
                        styles.highlightDate,
                        { color: theme.textMuted },
                      ]}
                    >
                      {formatHighlightDate(
                        data.highlight.createdAt,
                        locale,
                      )}
                    </Text>
                  </Pressable>
                ) : (
                  <Text
                    style={[styles.cardBody, { color: theme.textMuted }]}
                    testID="weekly-summary-highlight-empty"
                  >
                    {t("weeklySummary.highlight.empty")}
                  </Text>
                )}
              </Card>
            </>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  weekNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  weekNavButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  weekNavLabels: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  weekNavTitle: {
    textAlign: "center",
  },
  weekNavRange: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
  },
  loadingContainer: {
    paddingVertical: Spacing.xl * 2,
    alignItems: "center",
  },
  card: {
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  cardTitle: {
    marginBottom: Spacing.xs,
  },
  cardBody: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
    lineHeight: 22,
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  statCard: {
    flex: 1,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xs,
  },
  statLabel: {
    ...Typography.small,
    fontFamily: fontForWeight("500"),
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontSize: 11,
  },
  statValue: {
    ...Typography.h4,
    fontFamily: fontForWeight("600"),
  },
  statSubvalue: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
  },
  themeChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs + 2,
  },
  themeChip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  themeChipText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
  highlightBlock: {
    borderLeftWidth: 3,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  highlightQuote: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
    lineHeight: 24,
    fontStyle: "italic",
  },
  highlightDate: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
  },
  errorText: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
    textAlign: "center",
  },
  retryButton: {
    alignSelf: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  retryButtonText: {
    ...Typography.small,
    fontFamily: fontForWeight("600"),
  },
});
