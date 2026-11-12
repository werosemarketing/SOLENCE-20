import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { getApiUrl } from "@/lib/query-client";
import { LIVE_USAGE_COST_NOTICE, type LiveUsageSummary } from "@shared/live-usage";

function duration(seconds: number) {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

export function LiveUsagePanel({ active }: { active: boolean }) {
  const { theme } = useTheme();
  const { data, error, isPending, refetch } = useQuery<LiveUsageSummary>({
    queryKey: ["/api/chat/realtime/usage"],
    queryFn: async () => {
      const token = await AsyncStorage.getItem("solence_auth_token");
      if (!token) throw new Error("Sign in to see usage.");
      const response = await fetch(`${getApiUrl()}/api/chat/realtime/usage`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Could not load usage. Your totals have not been reset.");
      return response.json();
    },
    refetchInterval: active ? 5000 : false,
    retry: 1,
  });
  useEffect(() => { void refetch(); }, [active, refetch]);
  return (
    <View style={[styles.panel, { borderColor: theme.textMuted }]} testID="live-usage-panel">
      <Text style={[styles.title, { color: theme.text }]}>Usage across your test calls</Text>
      {isPending ? <Text style={{ color: theme.textMuted }}>Loading saved usage…</Text> : null}
      {error ? <Pressable onPress={() => { void refetch(); }} accessibilityRole="button">
        <Text style={{ color: theme.text }}>{error.message} Tap to retry.</Text>
      </Pressable> : null}
      {data ? <>
        <Text style={{ color: theme.text }}>
          {data.calls} calls · {duration(data.durationSeconds)} connected ·{" "}
          {data.responses ? `~$${data.estimatedUsd.toFixed(4)} USD` : "No priced responses yet"}
        </Text>
        <Text style={[styles.small, { color: theme.textMuted }]}>
          {data.inputTokens.toLocaleString()} input / {data.outputTokens.toLocaleString()} output tokens
          {" · "}{data.cachedInputTokens.toLocaleString()} cached input
        </Text>
        {data.responses > 0 && data.durationSeconds > 0 ? (
          <Text style={[styles.small, { color: theme.textMuted }]}>
            ~${(data.estimatedUsd * 60 / data.durationSeconds).toFixed(4)} per connected minute
          </Text>
        ) : null}
        {data.incompleteCalls > 0 ? <Text style={[styles.small, { color: theme.textMuted }]}>
          {data.incompleteCalls} call(s) still active or with incomplete usage; this estimate may be low.
        </Text> : null}
        {data.latest.map(call => <View key={call.id} style={styles.call}>
          <Text style={[styles.small, { color: theme.text }]}>
            {new Date(call.startedAt).toLocaleString()} · {duration(call.durationSeconds)} ·{" "}
            {call.responses ? `~$${call.estimatedUsd.toFixed(4)}` : "—"}{call.incomplete ? " · partial" : ""}
          </Text>
          <Text style={[styles.small, { color: theme.textMuted }]}>
            {call.status} · {call.usage.reportedInputTokens} input /{" "}
            {call.usage.reportedOutputTokens} output tokens
          </Text>
        </View>)}
      </> : null}
      <Text style={[styles.small, { color: theme.textMuted }]}>{LIVE_USAGE_COST_NOTICE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, marginVertical: 12, gap: 8 },
  title: { fontSize: 15, fontWeight: "600" },
  small: { fontSize: 11, lineHeight: 16 },
  call: { gap: 3, marginTop: 4 },
});
