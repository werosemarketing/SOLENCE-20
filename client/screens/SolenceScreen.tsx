import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Stop, Ellipse } from "react-native-svg";
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  useAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ORB_SIZE = SCREEN_WIDTH * 0.6;

type VoiceState = "idle" | "listening" | "responding" | "speaking";

const API_BASE_URL = "https://solence-joelgarciamendez.replit.app";

const FREE_MESSAGE_LIMIT = 5;
const STORAGE_KEY = "solence_daily_usage";

export default function SolenceScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [dailyMessageCount, setDailyMessageCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showSubscriptionPrompt, setShowSubscriptionPrompt] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);

  const breatheScale = useSharedValue(1);
  const pulseScale = useSharedValue(0.6);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer = useAudioPlayer(audioUri || "");

  const isRecordingRef = useRef(false);

  useEffect(() => {
    const newSessionId = `mobile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);
    checkDailyUsage();
  }, []);

  useEffect(() => {
    if (voiceState === "idle") {
      cancelAnimation(pulseScale);
      breatheScale.value = withRepeat(
        withSequence(
          withTiming(1.05, {
            duration: 4000,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(1, {
            duration: 4000,
            easing: Easing.inOut(Easing.ease),
          })
        ),
        -1,
        false
      );
    } else if (voiceState === "listening") {
      cancelAnimation(breatheScale);
      breatheScale.value = 1;
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.15, {
            duration: 600,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(0.95, {
            duration: 600,
            easing: Easing.inOut(Easing.ease),
          })
        ),
        -1,
        false
      );
    } else {
      cancelAnimation(breatheScale);
      cancelAnimation(pulseScale);
      breatheScale.value = 1;
    }
  }, [voiceState]);

  useEffect(() => {
    if (audioPlayer && audioUri) {
      audioPlayer.play();
    }
  }, [audioUri]);

  const animatedOrbStyle = useAnimatedStyle(() => {
    if (voiceState === "listening") {
      return {
        transform: [{ scale: pulseScale.value }],
      };
    }
    return {
      transform: [{ scale: breatheScale.value }],
    };
  });

  const checkDailyUsage = async () => {
    try {
      const today = new Date().toDateString();
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { date, count } = JSON.parse(stored);
        if (date === today) {
          setDailyMessageCount(count);
        } else {
          await AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ date: today, count: 0 })
          );
          setDailyMessageCount(0);
        }
      }
    } catch (e) {
      console.log("Error checking daily usage:", e);
    }
  };

  const incrementDailyUsage = async () => {
    try {
      const today = new Date().toDateString();
      const newCount = dailyMessageCount + 1;
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ date: today, count: newCount })
      );
      setDailyMessageCount(newCount);
      return newCount;
    } catch (e) {
      console.log("Error incrementing usage:", e);
      return dailyMessageCount + 1;
    }
  };

  const canSendMessage = () => {
    if (isSubscribed) return true;
    return dailyMessageCount < FREE_MESSAGE_LIMIT;
  };

  const startRecording = async () => {
    if (!canSendMessage()) {
      setShowSubscriptionPrompt(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();

      if (!status.granted) {
        if (!status.canAskAgain) {
          setPermissionDenied(true);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      isRecordingRef.current = true;
      audioRecorder.record();
      setVoiceState("listening");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      console.log("Error starting recording:", e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const stopRecording = async () => {
    if (!isRecordingRef.current) return;

    try {
      setVoiceState("responding");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      await audioRecorder.stop();
      isRecordingRef.current = false;

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const uri = audioRecorder.uri;
      if (uri) {
        await sendAudioToAPI(uri);
      } else {
        setVoiceState("idle");
      }
    } catch (e) {
      console.log("Error stopping recording:", e);
      setVoiceState("idle");
    }
  };

  const sendAudioToAPI = async (recordingUri: string) => {
    try {
      const formData = new FormData();

      formData.append("audio", {
        uri: recordingUri,
        type: "audio/m4a",
        name: "recording.m4a",
      } as any);
      formData.append("sessionId", sessionId);

      const response = await fetch(`${API_BASE_URL}/api/chat/voice`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("API request failed");
      }

      const data = await response.json();

      await incrementDailyUsage();
      setCurrentMessage(data.text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (data.audioUrl) {
        setAudioUri(`${API_BASE_URL}${data.audioUrl}`);
        setVoiceState("speaking");
      } else {
        setVoiceState("idle");
      }
    } catch (e) {
      console.log("Error sending audio:", e);
      setCurrentMessage("I had trouble hearing you. Please try again.");
      setVoiceState("idle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleOrbPress = () => {
    if (voiceState === "idle") {
      startRecording();
    } else if (voiceState === "listening") {
      stopRecording();
    }
  };

  const openSettings = async () => {
    if (Platform.OS !== "web") {
      try {
        await Linking.openSettings();
      } catch (error) {
        console.log("Cannot open settings:", error);
      }
    }
  };

  const remainingMessages = Math.max(0, FREE_MESSAGE_LIMIT - dailyMessageCount);

  const getStateText = () => {
    if (permissionDenied) return "Microphone access required";
    switch (voiceState) {
      case "idle":
        return "Tap to speak";
      case "listening":
        return "Listening...";
      case "responding":
        return "Thinking...";
      case "speaking":
        return "Speaking...";
      default:
        return "Tap to speak";
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + Spacing["4xl"],
            paddingBottom: insets.bottom + Spacing["4xl"],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>Solence</Text>
          {!isSubscribed && (
            <Text style={[styles.usageText, { color: theme.textMuted }]}>
              {remainingMessages} messages left today
            </Text>
          )}
        </View>

        <View style={styles.orbContainer}>
          <Pressable
            onPress={handleOrbPress}
            disabled={voiceState === "responding" || voiceState === "speaking"}
            style={({ pressed }) => [
              styles.orbPressable,
              { opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityLabel={getStateText()}
            accessibilityRole="button"
            testID="orb-button"
          >
            <Animated.View style={[styles.orbWrapper, animatedOrbStyle]}>
              <View
                style={[
                  styles.orbGlow,
                  { backgroundColor: theme.orbGlow },
                ]}
              />
              <Svg
                width={ORB_SIZE}
                height={ORB_SIZE}
                viewBox="0 0 200 200"
              >
                <Defs>
                  <RadialGradient id="orbGradient" cx="50%" cy="50%" r="50%">
                    <Stop
                      offset="0%"
                      stopColor={theme.orbSecondary}
                      stopOpacity="1"
                    />
                    <Stop
                      offset="70%"
                      stopColor={theme.orbPrimary}
                      stopOpacity="1"
                    />
                    <Stop offset="100%" stopColor="#6b4a3a" stopOpacity="1" />
                  </RadialGradient>
                </Defs>
                <Ellipse
                  cx="100"
                  cy="100"
                  rx="80"
                  ry="80"
                  fill="url(#orbGradient)"
                />
              </Svg>
            </Animated.View>
          </Pressable>

          <Text style={[styles.stateText, { color: theme.textMuted }]}>
            {getStateText()}
          </Text>

          {permissionDenied && Platform.OS !== "web" ? (
            <Pressable
              onPress={openSettings}
              style={styles.settingsButton}
              testID="settings-button"
            >
              <Text style={[styles.settingsButtonText, { color: theme.link }]}>
                Open Settings
              </Text>
            </Pressable>
          ) : null}
        </View>

        {currentMessage ? (
          <View style={styles.messageContainer}>
            <Text style={[styles.messageText, { color: theme.text }]}>
              {currentMessage}
            </Text>
          </View>
        ) : (
          <View style={styles.messageContainer} />
        )}
      </View>

      {showSubscriptionPrompt ? (
        <Pressable
          style={styles.subscriptionOverlay}
          onPress={() => setShowSubscriptionPrompt(false)}
        >
          <Pressable
            style={[
              styles.subscriptionModal,
              { backgroundColor: theme.backgroundRoot },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.subscriptionTitle, { color: theme.text }]}>
              Unlock Unlimited Conversations
            </Text>
            <Text
              style={[
                styles.subscriptionDescription,
                { color: theme.textMuted },
              ]}
            >
              You've used your 5 free messages today. Subscribe for unlimited
              access to Solence.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.subscribeButton,
                { backgroundColor: theme.orbPrimary, opacity: pressed ? 0.9 : 1 },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowSubscriptionPrompt(false);
              }}
              testID="subscribe-button"
            >
              <Text style={styles.subscribeButtonText}>
                Subscribe - $15.99/month
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.cancelButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => setShowSubscriptionPrompt(false)}
              testID="cancel-button"
            >
              <Text
                style={[styles.cancelButtonText, { color: theme.textMuted }]}
              >
                Maybe Later
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
  },
  header: {
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "300",
    letterSpacing: 2,
  },
  usageText: {
    fontSize: 14,
    marginTop: Spacing.sm,
  },
  orbContainer: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  orbPressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  orbWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  orbGlow: {
    position: "absolute",
    width: SCREEN_WIDTH * 0.78,
    height: SCREEN_WIDTH * 0.78,
    borderRadius: SCREEN_WIDTH * 0.39,
    opacity: 0.5,
  },
  stateText: {
    fontSize: 16,
    marginTop: Spacing["2xl"],
    fontWeight: "300",
  },
  settingsButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  settingsButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  messageContainer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["4xl"],
    maxHeight: 200,
    minHeight: 80,
  },
  messageText: {
    fontSize: 18,
    lineHeight: 28,
    textAlign: "center",
    fontWeight: "300",
  },
  subscriptionOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  subscriptionModal: {
    borderRadius: BorderRadius.xl,
    padding: Spacing["3xl"],
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  subscriptionTitle: {
    fontSize: 22,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  subscriptionDescription: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: Spacing["2xl"],
  },
  subscribeButton: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["3xl"],
    borderRadius: BorderRadius.full,
    width: "100%",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  subscribeButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  cancelButton: {
    paddingVertical: Spacing.md,
  },
  cancelButtonText: {
    fontSize: 16,
  },
});
