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
  withDelay,
  Easing,
  cancelAnimation,
  interpolate,
  withSpring,
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Stop, Ellipse, Circle } from "react-native-svg";
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  useAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const ORB_SIZE = SCREEN_WIDTH * 0.55;

type VoiceState = "idle" | "listening" | "responding" | "speaking";

const API_BASE_URL = "https://solence-joelgarciamendez.replit.app";

const FREE_MESSAGE_LIMIT = 5;
const STORAGE_KEY = "solence_daily_usage";

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

function AmbientParticle({ delay, size, startX, startY, isDark }: { 
  delay: number; 
  size: number; 
  startX: number; 
  startY: number;
  isDark: boolean;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.4, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      )
    );

    translateY.value = withDelay(
      delay,
      withRepeat(
        withTiming(-80, { duration: 8000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );

    translateX.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(20, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
          withTiming(-20, { duration: 4000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      )
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: startX,
          top: startY,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: isDark ? "rgba(196, 149, 108, 0.3)" : "rgba(157, 107, 83, 0.2)",
        },
        animatedStyle,
      ]}
    />
  );
}

function InnerGlow({ voiceState, isDark }: { voiceState: VoiceState; isDark: boolean }) {
  const glowOpacity = useSharedValue(0.3);
  const glowScale = useSharedValue(1);

  useEffect(() => {
    if (voiceState === "listening") {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 300, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 300, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 300, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else if (voiceState === "responding") {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.2, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.95, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else if (voiceState === "speaking") {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.35, { duration: 200, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      glowScale.value = 1.05;
    } else {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.35, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.2, { duration: 4000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.02, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.98, { duration: 4000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [voiceState]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: ORB_SIZE * 1.6,
          height: ORB_SIZE * 1.6,
          borderRadius: ORB_SIZE * 0.8,
          backgroundColor: isDark ? "rgba(196, 149, 108, 0.25)" : "rgba(196, 149, 108, 0.35)",
        },
        animatedStyle,
      ]}
    />
  );
}

function OuterAura({ voiceState, isDark }: { voiceState: VoiceState; isDark: boolean }) {
  const auraOpacity = useSharedValue(0.1);
  const auraScale = useSharedValue(1);

  useEffect(() => {
    if (voiceState === "listening") {
      auraOpacity.value = withRepeat(
        withSequence(
          withTiming(0.25, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.08, { duration: 400, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      auraScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.95, { duration: 400, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else {
      auraOpacity.value = withRepeat(
        withSequence(
          withTiming(0.12, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.05, { duration: 6000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      auraScale.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.97, { duration: 6000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [voiceState]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: auraOpacity.value,
    transform: [{ scale: auraScale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: ORB_SIZE * 2.2,
          height: ORB_SIZE * 2.2,
          borderRadius: ORB_SIZE * 1.1,
          backgroundColor: isDark ? "rgba(196, 149, 108, 0.15)" : "rgba(157, 107, 83, 0.12)",
        },
        animatedStyle,
      ]}
    />
  );
}

export default function SolenceScreen() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [dailyMessageCount, setDailyMessageCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showSubscriptionPrompt, setShowSubscriptionPrompt] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);

  const breatheScale = useSharedValue(1);
  const pulseScale = useSharedValue(1);
  const orbRotation = useSharedValue(0);
  const messageOpacity = useSharedValue(0);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer = useAudioPlayer(audioUri || "");

  const isRecordingRef = useRef(false);

  const particles = useRef(
    Array.from({ length: 8 }, (_, i) => ({
      id: i,
      delay: i * 800,
      size: 4 + Math.random() * 6,
      startX: SCREEN_WIDTH * 0.2 + Math.random() * SCREEN_WIDTH * 0.6,
      startY: SCREEN_HEIGHT * 0.3 + Math.random() * SCREEN_HEIGHT * 0.4,
    }))
  ).current;

  useEffect(() => {
    const newSessionId = `mobile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);
    checkDailyUsage();

    orbRotation.value = withRepeat(
      withTiming(360, { duration: 120000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  useEffect(() => {
    if (voiceState === "idle") {
      cancelAnimation(pulseScale);
      pulseScale.value = 1;
      breatheScale.value = withRepeat(
        withSequence(
          withTiming(1.04, {
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
          withTiming(1.12, {
            duration: 500,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(0.92, {
            duration: 500,
            easing: Easing.inOut(Easing.ease),
          })
        ),
        -1,
        false
      );
    } else if (voiceState === "responding") {
      cancelAnimation(breatheScale);
      cancelAnimation(pulseScale);
      breatheScale.value = withRepeat(
        withSequence(
          withTiming(1.02, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.98, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else if (voiceState === "speaking") {
      cancelAnimation(breatheScale);
      cancelAnimation(pulseScale);
      breatheScale.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: 300, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.97, { duration: 300, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [voiceState]);

  useEffect(() => {
    if (currentMessage) {
      messageOpacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.ease) });
    } else {
      messageOpacity.value = 0;
    }
  }, [currentMessage]);

  useEffect(() => {
    if (audioPlayer && audioUri) {
      audioPlayer.play();
    }
  }, [audioUri]);

  const animatedOrbStyle = useAnimatedStyle(() => {
    const scale = voiceState === "listening" ? pulseScale.value : breatheScale.value;
    return {
      transform: [
        { scale },
        { rotate: `${orbRotation.value}deg` },
      ],
    };
  });

  const animatedMessageStyle = useAnimatedStyle(() => ({
    opacity: messageOpacity.value,
    transform: [
      { translateY: interpolate(messageOpacity.value, [0, 1], [10, 0]) },
    ],
  }));

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

  const gradientColors = isDark 
    ? ["#1a1625", "#1f1a2e", "#251e35", "#1f1a2e", "#1a1625"] as const
    : ["#faf8f5", "#f8f4ef", "#f5f0e8", "#f8f4ef", "#faf8f5"] as const;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={gradientColors}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {particles.map((particle) => (
        <AmbientParticle
          key={particle.id}
          delay={particle.delay}
          size={particle.size}
          startX={particle.startX}
          startY={particle.startY}
          isDark={isDark}
        />
      ))}

      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + Spacing["4xl"],
            paddingBottom: insets.bottom + Spacing["4xl"],
          },
        ]}
      >
        <Animated.View 
          entering={FadeInDown.duration(800).delay(200)}
          style={styles.header}
        >
          <Text style={[styles.title, { color: theme.text }]}>Solence</Text>
          {!isSubscribed && (
            <Animated.Text 
              entering={FadeIn.duration(600).delay(400)}
              style={[styles.usageText, { color: theme.textMuted }]}
            >
              {remainingMessages} messages left today
            </Animated.Text>
          )}
        </Animated.View>

        <View style={styles.orbContainer}>
          <Pressable
            onPress={handleOrbPress}
            disabled={voiceState === "responding" || voiceState === "speaking"}
            style={({ pressed }) => [
              styles.orbPressable,
              { opacity: pressed ? 0.95 : 1 },
            ]}
            accessibilityLabel={getStateText()}
            accessibilityRole="button"
            testID="orb-button"
          >
            <OuterAura voiceState={voiceState} isDark={isDark} />
            <InnerGlow voiceState={voiceState} isDark={isDark} />
            
            <Animated.View style={[styles.orbWrapper, animatedOrbStyle]}>
              <Svg
                width={ORB_SIZE}
                height={ORB_SIZE}
                viewBox="0 0 200 200"
              >
                <Defs>
                  <RadialGradient id="orbGradient" cx="40%" cy="35%" r="65%">
                    <Stop
                      offset="0%"
                      stopColor="#d4a574"
                      stopOpacity="1"
                    />
                    <Stop
                      offset="35%"
                      stopColor={theme.orbSecondary}
                      stopOpacity="1"
                    />
                    <Stop
                      offset="70%"
                      stopColor={theme.orbPrimary}
                      stopOpacity="1"
                    />
                    <Stop offset="100%" stopColor="#5a3d2b" stopOpacity="1" />
                  </RadialGradient>
                  <RadialGradient id="highlightGradient" cx="30%" cy="25%" r="40%">
                    <Stop offset="0%" stopColor="#fff" stopOpacity="0.25" />
                    <Stop offset="100%" stopColor="#fff" stopOpacity="0" />
                  </RadialGradient>
                </Defs>
                <Circle
                  cx="100"
                  cy="100"
                  r="80"
                  fill="url(#orbGradient)"
                />
                <Ellipse
                  cx="75"
                  cy="70"
                  rx="35"
                  ry="25"
                  fill="url(#highlightGradient)"
                />
              </Svg>
            </Animated.View>
          </Pressable>

          <Animated.Text 
            entering={FadeIn.duration(600).delay(600)}
            style={[styles.stateText, { color: theme.textMuted }]}
          >
            {getStateText()}
          </Animated.Text>

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

        <Animated.View style={[styles.messageContainer, animatedMessageStyle]}>
          {currentMessage ? (
            <Text style={[styles.messageText, { color: theme.text }]}>
              {currentMessage}
            </Text>
          ) : null}
        </Animated.View>
      </View>

      {showSubscriptionPrompt ? (
        <Pressable
          style={styles.subscriptionOverlay}
          onPress={() => setShowSubscriptionPrompt(false)}
        >
          <Animated.View
            entering={FadeIn.duration(300)}
            style={[
              styles.subscriptionModal,
              { backgroundColor: isDark ? "#252030" : "#fefefe" },
            ]}
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
          </Animated.View>
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
    fontSize: 32,
    fontWeight: "200",
    letterSpacing: 6,
    textTransform: "uppercase",
  },
  usageText: {
    fontSize: 13,
    marginTop: Spacing.md,
    fontWeight: "300",
    letterSpacing: 1,
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
  stateText: {
    fontSize: 15,
    marginTop: Spacing["3xl"],
    fontWeight: "300",
    letterSpacing: 2,
    textTransform: "uppercase",
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
    paddingHorizontal: Spacing["2xl"],
    paddingBottom: Spacing["3xl"],
    maxHeight: 200,
    minHeight: 80,
  },
  messageText: {
    fontSize: 17,
    lineHeight: 28,
    textAlign: "center",
    fontWeight: "300",
    letterSpacing: 0.3,
  },
  subscriptionOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  subscriptionModal: {
    borderRadius: BorderRadius["2xl"],
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
    letterSpacing: 0.5,
  },
  subscriptionDescription: {
    fontSize: 15,
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
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  cancelButton: {
    paddingVertical: Spacing.md,
  },
  cancelButtonText: {
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
