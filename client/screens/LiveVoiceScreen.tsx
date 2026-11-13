import React, { useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { useLiveVoice } from "@/hooks/useLiveVoice";
import { LiveUsagePanel } from "@/components/LiveUsagePanel";
import { CrisisBanner } from "@/components/CrisisBanner";
import { containsCrisisLanguage } from "@/lib/rating";
import { useLiveVoiceAccess } from "@/hooks/useLiveVoiceAccess";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { useTranslation } from "react-i18next";

export default function LiveVoiceScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const voice = useLiveVoice();
  const access = useLiveVoiceAccess();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation();
  const scroll = useRef<ScrollView>(null);
  const [showCrisis, setShowCrisis] = useState(true);
  const active = voice.state !== "idle" && voice.state !== "stopping";
  const connected = active && voice.state !== "connecting";
  const labels = {
    idle: "Ready when you are", connecting: "Connecting live audio…",
    listening: voice.muted ? "Microphone muted" : "Listening — just speak naturally",
    thinking: "With you…", speaking: "Solence is speaking — you can interrupt",
    stopping: "Ending the call and saving…",
  };
  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot, paddingBottom: insets.bottom + 16 }]}>
      <Text style={[styles.badge, { color: theme.textMuted }]}>{t("liveVoice.badge")}</Text>
      <Text style={[styles.title, { color: theme.text }]}>A more natural conversation</Text>
      <Text style={[styles.description, { color: theme.textMuted }]}>
        Start once, then talk freely. Solence hears your voice directly and streams its reply.
        You can interrupt without tapping. Each call is limited to 3 minutes.
      </Text>
      <View style={[styles.orb, { backgroundColor: theme.orbPrimary }]}>
        <Feather name={voice.muted ? "mic-off" : voice.state === "speaking" ? "volume-2" : "mic"} size={42} color="#FFFFFF" />
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.status, { color: theme.text }]}>{labels[voice.state]}</Text>
      {connected ? <Text style={{ color: theme.textMuted, textAlign: "center" }}>
        {Math.floor(voice.secondsLeft / 60)}:{String(voice.secondsLeft % 60).padStart(2, "0")} left in this call
      </Text> : null}
      <View style={styles.controls}>
        {connected ? <Pressable accessibilityRole="button" onPress={voice.toggleMute}
          style={[styles.secondary, { borderColor: theme.textMuted }]}>
          <Text style={{ color: theme.text }}>{voice.muted ? "Unmute" : "Mute"}</Text>
        </Pressable> : null}
        <Pressable accessibilityRole="button" testID="live-voice-toggle"
          disabled={voice.state === "stopping" || (!active && (access.data?.allowed !== true || !!access.error))}
          onPress={() => {
            if (active) { void voice.stop(); return; }
            if (access.data?.allowed !== true || access.error) return;
            setShowCrisis(true);
            void voice.start();
          }}
          style={[styles.primary, {
            backgroundColor: active ? "#9B4848" : theme.orbPrimary,
            opacity: !active && (access.data?.allowed !== true || access.error) ? 0.5 : 1,
          }]}>
          <Text style={styles.buttonText}>{active ? "End call" : voice.state === "stopping" ? "Saving…" : "Start live voice"}</Text>
        </Pressable>
      </View>
      {!active && access.isFetching ? <Text style={[styles.error, { color: theme.textMuted }]}>
        {t("liveVoice.checking")}
      </Text> : null}
      {!active && access.error ? <Pressable accessibilityRole="button" onPress={() => { void access.refetch(); }}>
        <Text style={[styles.error, { color: theme.text }]}>{t("liveVoice.retry")}</Text>
      </Pressable> : null}
      {!active && !access.error && access.data?.allowed === false ? <View>
        <Text style={[styles.error, { color: theme.textMuted }]}>{t("liveVoice.requiresUnlimited")}</Text>
        <Pressable accessibilityRole="button" testID="live-voice-upgrade" onPress={() => navigation.navigate("Upgrade")}>
          <Text style={[styles.error, { color: theme.orbPrimary }]}>{t("liveVoice.upgrade")}</Text>
        </Pressable>
      </View> : null}
      {voice.error ? <View accessibilityRole="alert">
        <Text selectable style={[styles.error, { color: theme.text }]}>{voice.error}</Text>
        {voice.error.includes("permission") ? <Pressable onPress={() => { void Linking.openSettings(); }}>
          <Text style={[styles.error, { color: theme.orbPrimary }]}>Open microphone settings</Text>
        </Pressable> : null}
      </View> : null}
      {showCrisis && voice.turns.some((turn) => turn.role === "user" && containsCrisisLanguage(turn.text)) ?
        <CrisisBanner onDismiss={() => setShowCrisis(false)} /> : null}
      <ScrollView ref={scroll} style={styles.transcript} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {voice.turns.map((turn) => <View key={turn.id} style={styles.turn}>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>{turn.role === "user" ? "YOU" : "SOLENCE"}</Text>
          <Text selectable style={{ color: theme.text, fontSize: 16, lineHeight: 24 }}>{turn.text}</Text>
        </View>)}
        {__DEV__ ? <LiveUsagePanel active={voice.state !== "idle"} /> : null}
      </ScrollView>
      <Text style={[styles.notice, { color: theme.textMuted }]}>
        {t("liveVoice.notice")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  badge: { fontSize: 11, letterSpacing: 1, textAlign: "center", marginBottom: 12 },
  title: { fontSize: 25, fontWeight: "600", textAlign: "center" },
  description: { fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 12 },
  orb: { width: 106, height: 106, borderRadius: 53, alignItems: "center", justifyContent: "center", alignSelf: "center", marginVertical: 22 },
  status: { textAlign: "center", fontSize: 16, marginBottom: 6 },
  controls: { flexDirection: "row", justifyContent: "center", gap: 12, marginVertical: 18 },
  primary: { paddingVertical: 15, paddingHorizontal: 25, borderRadius: 28 },
  secondary: { paddingVertical: 15, paddingHorizontal: 24, borderRadius: 28, borderWidth: 1 },
  buttonText: { color: "#FFFFFF", fontWeight: "600", fontSize: 16 },
  error: { textAlign: "center", marginBottom: 12, lineHeight: 20 },
  transcript: { flex: 1 },
  turn: { marginBottom: 18, gap: 5 },
  notice: { fontSize: 11, lineHeight: 16, textAlign: "center", paddingTop: 12 },
});
