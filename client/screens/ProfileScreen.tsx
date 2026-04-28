import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography, fontForWeight } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";

const STORAGE_KEY_AUTH_TOKEN = "solence_auth_token";
const HISTORY_DAYS = 7;
const DEFAULT_TOKEN_LIMIT = 15000;

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

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [tokenLimit, setTokenLimit] = useState<number>(DEFAULT_TOKEN_LIMIT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const totalUsed = history
    ? history.reduce((sum, day) => sum + day.tokensUsed, 0)
    : 0;
  const dailyAverage = history && history.length > 0
    ? Math.round(totalUsed / history.length)
    : 0;

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
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  headerCard: {
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
});
