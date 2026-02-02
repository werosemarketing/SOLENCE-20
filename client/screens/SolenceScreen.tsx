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
  interpolate,
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
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
import * as FileSystem from "expo-file-system/legacy";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const ORB_SIZE = SCREEN_WIDTH * 0.5;

type VoiceState = "idle" | "listening" | "responding" | "speaking";

const API_BASE_URL = "https://solence-joelgarciamendez.replit.app";

const FREE_MESSAGE_LIMIT = 5;
const STORAGE_KEY = "solence_daily_usage";
const AUTO_STOP_DELAY = 5000;

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
          withTiming(0.3, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      )
    );

    translateY.value = withDelay(
      delay,
      withRepeat(
        withTiming(-100, { duration: 10000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );

    translateX.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(30, { duration: 5000, easing: Easing.inOut(Easing.ease) }),
          withTiming(-30, { duration: 5000, easing: Easing.inOut(Easing.ease) })
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
          backgroundColor: isDark ? "rgba(196, 149, 108, 0.4)" : "rgba(157, 107, 83, 0.25)",
        },
        animatedStyle,
      ]}
    />
  );
}

function EtherealOrb({ voiceState, isDark }: { voiceState: VoiceState; isDark: boolean }) {
  const layer1Scale = useSharedValue(1);
  const layer2Scale = useSharedValue(1);
  const layer3Scale = useSharedValue(1);
  const layer1Opacity = useSharedValue(0.6);
  const layer2Opacity = useSharedValue(0.4);
  const layer3Opacity = useSharedValue(0.25);
  const coreOpacity = useSharedValue(0.9);

  useEffect(() => {
    if (voiceState === "listening") {
      layer1Scale.value = withRepeat(
        withSequence(
          withTiming(1.25, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.9, { duration: 400, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer2Scale.value = withRepeat(
        withSequence(
          withTiming(1.35, { duration: 450, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.85, { duration: 450, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer3Scale.value = withRepeat(
        withSequence(
          withTiming(1.45, { duration: 500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.8, { duration: 500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer1Opacity.value = withRepeat(
        withSequence(
          withTiming(0.8, { duration: 300 }),
          withTiming(0.5, { duration: 300 })
        ),
        -1,
        false
      );
      coreOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 300 }),
          withTiming(0.7, { duration: 300 })
        ),
        -1,
        false
      );
    } else if (voiceState === "responding") {
      layer1Scale.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.95, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer2Scale.value = withRepeat(
        withSequence(
          withTiming(1.12, { duration: 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.92, { duration: 900, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer3Scale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.9, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer1Opacity.value = 0.5;
      coreOpacity.value = 0.85;
    } else if (voiceState === "speaking") {
      layer1Scale.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.95, { duration: 200, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer2Scale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 250, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.9, { duration: 250, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer3Scale.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 300, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.88, { duration: 300, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer1Opacity.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 150 }),
          withTiming(0.4, { duration: 150 })
        ),
        -1,
        false
      );
      coreOpacity.value = 0.95;
    } else {
      layer1Scale.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.98, { duration: 4000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer2Scale.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 4500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.96, { duration: 4500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer3Scale.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 5000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.94, { duration: 5000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer1Opacity.value = withRepeat(
        withSequence(
          withTiming(0.65, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.5, { duration: 4000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer2Opacity.value = withRepeat(
        withSequence(
          withTiming(0.45, { duration: 4500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 4500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      layer3Opacity.value = withRepeat(
        withSequence(
          withTiming(0.3, { duration: 5000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.15, { duration: 5000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      coreOpacity.value = withRepeat(
        withSequence(
          withTiming(0.95, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.8, { duration: 4000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [voiceState]);

  const layer1Style = useAnimatedStyle(() => ({
    transform: [{ scale: layer1Scale.value }],
    opacity: layer1Opacity.value,
  }));

  const layer2Style = useAnimatedStyle(() => ({
    transform: [{ scale: layer2Scale.value }],
    opacity: layer2Opacity.value,
  }));

  const layer3Style = useAnimatedStyle(() => ({
    transform: [{ scale: layer3Scale.value }],
    opacity: layer3Opacity.value,
  }));

  const coreStyle = useAnimatedStyle(() => ({
    opacity: coreOpacity.value,
  }));

  const baseColor = isDark ? "rgba(196, 149, 108," : "rgba(180, 130, 95,";

  return (
    <View style={styles.etherealContainer}>
      <Animated.View
        style={[
          styles.etherealLayer,
          {
            width: ORB_SIZE * 2.4,
            height: ORB_SIZE * 2.4,
            borderRadius: ORB_SIZE * 1.2,
            backgroundColor: `${baseColor} 0.08)`,
          },
          layer3Style,
        ]}
      />
      
      <Animated.View
        style={[
          styles.etherealLayer,
          {
            width: ORB_SIZE * 1.8,
            height: ORB_SIZE * 1.8,
            borderRadius: ORB_SIZE * 0.9,
            backgroundColor: `${baseColor} 0.12)`,
          },
          layer2Style,
        ]}
      />
      
      <Animated.View
        style={[
          styles.etherealLayer,
          {
            width: ORB_SIZE * 1.3,
            height: ORB_SIZE * 1.3,
            borderRadius: ORB_SIZE * 0.65,
            backgroundColor: `${baseColor} 0.2)`,
          },
          layer1Style,
        ]}
      />

      <Animated.View style={[styles.coreContainer, coreStyle]}>
        <LinearGradient
          colors={
            isDark
              ? ["#e8c9a8", "#c4956c", "#9d6b53", "#6b4a3a"] as const
              : ["#dbb896", "#c4956c", "#a67850", "#7a5438"] as const
          }
          style={[
            styles.coreGradient,
            {
              width: ORB_SIZE * 0.7,
              height: ORB_SIZE * 0.7,
              borderRadius: ORB_SIZE * 0.35,
            },
          ]}
          start={{ x: 0.3, y: 0.2 }}
          end={{ x: 0.8, y: 0.9 }}
        />
        
        <View
          style={[
            styles.coreHighlight,
            {
              width: ORB_SIZE * 0.25,
              height: ORB_SIZE * 0.15,
              borderRadius: ORB_SIZE * 0.1,
              top: ORB_SIZE * 0.12,
              left: ORB_SIZE * 0.15,
            },
          ]}
        />
      </Animated.View>
    </View>
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
  const [isConversationActive, setIsConversationActive] = useState(false);

  const messageOpacity = useSharedValue(0);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer = useAudioPlayer(audioUri || "");

  const isRecordingRef = useRef(false);
  const autoStopTimerRef = useRef<NodeJS.Timeout | null>(null);
  const shouldContinueListeningRef = useRef(false);

  const particles = useRef(
    Array.from({ length: 12 }, (_, i) => ({
      id: i,
      delay: i * 600,
      size: 3 + Math.random() * 5,
      startX: SCREEN_WIDTH * 0.15 + Math.random() * SCREEN_WIDTH * 0.7,
      startY: SCREEN_HEIGHT * 0.25 + Math.random() * SCREEN_HEIGHT * 0.5,
    }))
  ).current;

  useEffect(() => {
    const newSessionId = `mobile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);
    checkDailyUsage();
  }, []);

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

  useEffect(() => {
    if (audioPlayer) {
      const subscription = audioPlayer.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish && isConversationActive && shouldContinueListeningRef.current) {
          setTimeout(() => {
            if (isConversationActive && canSendMessage()) {
              startRecording();
            }
          }, 500);
        }
      });
      return () => subscription.remove();
    }
  }, [audioPlayer, isConversationActive]);

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

  const clearAutoStopTimer = () => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  };

  const startRecording = async () => {
    console.log("=== START RECORDING ===");
    
    if (!canSendMessage()) {
      console.log("Cannot send - limit reached");
      setShowSubscriptionPrompt(true);
      setIsConversationActive(false);
      shouldContinueListeningRef.current = false;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    try {
      console.log("Requesting permissions...");
      const status = await AudioModule.requestRecordingPermissionsAsync();
      console.log("Permission status:", status.granted);

      if (!status.granted) {
        if (!status.canAskAgain) {
          setPermissionDenied(true);
        }
        setIsConversationActive(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      console.log("Setting audio mode...");
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      console.log("Starting recorder...");
      isRecordingRef.current = true;
      await audioRecorder.record();
      console.log("Recorder started, state:", audioRecorder.isRecording);
      setVoiceState("listening");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      clearAutoStopTimer();
      autoStopTimerRef.current = setTimeout(() => {
        console.log("Auto-stop triggered");
        if (isRecordingRef.current) {
          stopRecording();
        }
      }, AUTO_STOP_DELAY);
    } catch (e: any) {
      console.log("Error starting recording:", e?.message || e);
      isRecordingRef.current = false;
      setVoiceState("idle");
      setIsConversationActive(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const stopRecording = async () => {
    console.log("=== STOP RECORDING ===");
    if (!isRecordingRef.current) {
      console.log("Not recording, skipping stop");
      return;
    }

    clearAutoStopTimer();
    isRecordingRef.current = false;

    try {
      setVoiceState("responding");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      console.log("Stopping recorder...");
      await audioRecorder.stop();
      console.log("Recorder stopped");

      await new Promise(resolve => setTimeout(resolve, 500));

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const uri = audioRecorder.uri;
      console.log("Recording URI:", uri);
      
      if (uri) {
        await sendAudioToAPI(uri);
      } else {
        console.log("No recording URI available");
        setCurrentMessage("Recording was too short. Please try again.");
        setVoiceState("idle");
      }
    } catch (e: any) {
      console.log("Error stopping recording:", e?.message || e);
      setVoiceState("idle");
    }
  };

  const sendAudioToAPI = async (recordingUri: string) => {
    try {
      console.log("Sending audio from:", recordingUri);

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
        const errorText = await response.text();
        console.log("API error:", errorText);
        throw new Error("API request failed");
      }

      const data = await response.json();

      await incrementDailyUsage();
      setCurrentMessage(data.text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (data.audioUrl) {
        setAudioUri(`${API_BASE_URL}${data.audioUrl}`);
        setVoiceState("speaking");
        shouldContinueListeningRef.current = isConversationActive;
      } else {
        if (isConversationActive && canSendMessage()) {
          setTimeout(() => startRecording(), 500);
        } else {
          setVoiceState("idle");
        }
      }
    } catch (e: any) {
      console.log("Error sending audio:", e?.message || e);
      setCurrentMessage("I had trouble hearing you. Please try again.");
      setVoiceState("idle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleOrbPress = () => {
    if (voiceState === "idle") {
      setIsConversationActive(true);
      shouldContinueListeningRef.current = true;
      startRecording();
    } else if (voiceState === "listening") {
      stopRecording();
    }
  };

  const endConversation = () => {
    setIsConversationActive(false);
    shouldContinueListeningRef.current = false;
    clearAutoStopTimer();
    
    if (isRecordingRef.current) {
      audioRecorder.stop();
      isRecordingRef.current = false;
    }
    
    if (audioPlayer) {
      audioPlayer.pause();
    }
    
    setVoiceState("idle");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        return "Tap to begin";
      case "listening":
        return "Listening...";
      case "responding":
        return "Thinking...";
      case "speaking":
        return "Speaking...";
      default:
        return "Tap to begin";
    }
  };

  const gradientColors = isDark 
    ? ["#0f0c14", "#1a1625", "#1f1a2e", "#1a1625", "#0f0c14"] as const
    : ["#f8f5f0", "#faf8f5", "#fcfaf7", "#faf8f5", "#f8f5f0"] as const;

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
            <EtherealOrb voiceState={voiceState} isDark={isDark} />
          </Pressable>

          <Animated.Text 
            entering={FadeIn.duration(600).delay(600)}
            style={[styles.stateText, { color: theme.textMuted }]}
          >
            {getStateText()}
          </Animated.Text>

          {isConversationActive && voiceState !== "idle" ? (
            <Pressable
              onPress={endConversation}
              style={({ pressed }) => [
                styles.endButton,
                { 
                  backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)",
                  opacity: pressed ? 0.7 : 1 
                },
              ]}
              testID="end-conversation-button"
            >
              <Text style={[styles.endButtonText, { color: theme.textMuted }]}>
                End conversation
              </Text>
            </Pressable>
          ) : null}

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
              { backgroundColor: isDark ? "#1f1a2e" : "#fefefe" },
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
  etherealContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: ORB_SIZE * 2.5,
    height: ORB_SIZE * 2.5,
  },
  etherealLayer: {
    position: "absolute",
  },
  coreContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  coreGradient: {
    alignItems: "center",
    justifyContent: "center",
  },
  coreHighlight: {
    position: "absolute",
    backgroundColor: "rgba(255, 255, 255, 0.25)",
  },
  stateText: {
    fontSize: 15,
    marginTop: Spacing.xl,
    fontWeight: "300",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  endButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
  },
  endButtonText: {
    fontSize: 14,
    fontWeight: "400",
    letterSpacing: 1,
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
