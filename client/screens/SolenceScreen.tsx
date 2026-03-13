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
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";

let currentBlobUrl: string | null = null;

const saveBase64Audio = async (base64: string): Promise<string> => {
  if (Platform.OS === "web") {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
    }
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "audio/mp3" });
    currentBlobUrl = URL.createObjectURL(blob);
    return currentBlobUrl;
  }
  const audioFileUri = FileSystem.cacheDirectory + `solence_response_${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(audioFileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return audioFileUri;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const ORB_SIZE = SCREEN_WIDTH * 0.5;

type VoiceState = "idle" | "listening" | "responding" | "speaking";

const FREE_MESSAGE_LIMIT = 5;
const STORAGE_KEY = "solence_daily_usage";
const AUTO_STOP_DELAY = 15000;

const STARTER_PROMPTS = [
  "Can I tell you something real?",
  "I don't even know where to start.",
  "What do I do with this feeling?",
  "Who are you, really?",
];

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
          backgroundColor: isDark ? "rgba(214, 107, 50, 0.4)" : "rgba(214, 107, 50, 0.25)",
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

  const baseColor = isDark ? "rgba(214, 107, 50," : "rgba(214, 107, 50,";

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
              ? ["#F1B5A6", "#E8945E", "#D66B32", "#A04E1E"] as const
              : ["#F1B5A6", "#E8945E", "#D66B32", "#A04E1E"] as const
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

type SolenceScreenProps = {
  authToken: string | null;
  onSignOut: () => void;
};

export default function SolenceScreen({ authToken, onSignOut }: SolenceScreenProps) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [dailyMessageCount, setDailyMessageCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showSubscriptionPrompt, setShowSubscriptionPrompt] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [showStarters, setShowStarters] = useState(true);

  const messageOpacity = useSharedValue(0);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioPlayer = useAudioPlayer("");
  const audioPlayingRef = useRef(false);

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
    const subscription = audioPlayer.addListener("playbackStatusUpdate", (status: { didJustFinish?: boolean }) => {
      if (status.didJustFinish && audioPlayingRef.current) {
        audioPlayingRef.current = false;
        if (shouldContinueListeningRef.current && canSendMessage()) {
          startRecording();
        } else {
          setVoiceState("idle");
        }
      }
    });
    return () => subscription.remove();
  }, [audioPlayer]);

  const webAudioRef = useRef<HTMLAudioElement | null>(null);

  const playResponseAudio = async (uri: string) => {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      setVoiceState("speaking");

      if (Platform.OS === "web") {
        if (webAudioRef.current) {
          webAudioRef.current.pause();
          webAudioRef.current.removeAttribute("src");
        }
        const audio = new Audio(uri);
        webAudioRef.current = audio;
        audioPlayingRef.current = true;
        audio.onended = () => {
          audioPlayingRef.current = false;
          if (shouldContinueListeningRef.current && canSendMessage()) {
            startRecording();
          } else {
            setVoiceState("idle");
          }
        };
        audio.onerror = () => {
          console.log("Web audio playback error");
          audioPlayingRef.current = false;
          setVoiceState("idle");
        };
        await audio.play();
      } else {
        audioPlayingRef.current = true;
        audioPlayer.replace(uri);
        audioPlayer.play();
      }
    } catch (e: unknown) {
      console.log("Audio playback error:", e instanceof Error ? e.message : e);
      audioPlayingRef.current = false;
      setVoiceState("idle");
    }
  };

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

  const readRecordingAsBase64 = async (uri: string): Promise<string> => {
    if (Platform.OS === "web") {
      const response = await fetch(uri);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1] || "";
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    return FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  };

  const startRecording = async () => {
    if (!canSendMessage()) {
      setShowSubscriptionPrompt(true);
      setIsConversationActive(false);
      shouldContinueListeningRef.current = false;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        if (!status.canAskAgain) {
          setPermissionDenied(true);
        }
        setIsConversationActive(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      isRecordingRef.current = true;
      audioRecorder.record();
      setVoiceState("listening");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      clearAutoStopTimer();
      autoStopTimerRef.current = setTimeout(() => {
        if (isRecordingRef.current) {
          stopRecording();
        }
      }, AUTO_STOP_DELAY);
    } catch (e: unknown) {
      console.log("Error starting recording:", e instanceof Error ? e.message : e);
      isRecordingRef.current = false;
      setVoiceState("idle");
      setIsConversationActive(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const stopRecording = async () => {
    if (!isRecordingRef.current) return;

    clearAutoStopTimer();
    isRecordingRef.current = false;

    try {
      setVoiceState("responding");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      await audioRecorder.stop();

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const uri = audioRecorder.uri;
      if (uri) {
        sendAudioToAPI(uri);
      } else {
        setCurrentMessage("Recording was too short. Please try again.");
        setVoiceState("idle");
      }
    } catch (e: unknown) {
      console.log("Error stopping recording:", e instanceof Error ? e.message : e);
      setVoiceState("idle");
    }
  };

  const sendAudioToAPI = async (recordingUri: string) => {
    try {
      const audioBase64 = await readRecordingAsBase64(recordingUri);

      if (audioBase64.length < 100) {
        setCurrentMessage("Recording was too short. Please try again.");
        setVoiceState("idle");
        return;
      }

      const apiUrl = getApiUrl();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${apiUrl}/api/chat/voice`, {
        method: "POST",
        headers,
        body: JSON.stringify({ audio: audioBase64 }),
      });

      if (!response.ok) {
        throw new Error("API request failed");
      }

      const data = await response.json();
      await incrementDailyUsage();
      setCurrentMessage(data.text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (data.audioBase64) {
        const audioFileUri = await saveBase64Audio(data.audioBase64);
        shouldContinueListeningRef.current = isConversationActive;
        await playResponseAudio(audioFileUri);
      } else {
        if (isConversationActive && canSendMessage()) {
          setTimeout(() => startRecording(), 300);
        } else {
          setVoiceState("idle");
        }
      }
    } catch (e: unknown) {
      console.log("Error sending audio:", e instanceof Error ? e.message : e);
      setCurrentMessage("I had trouble hearing you. Please try again.");
      setVoiceState("idle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const sendTextToAPI = async (text: string) => {
    if (!canSendMessage()) {
      setShowSubscriptionPrompt(true);
      return;
    }

    setShowStarters(false);
    setIsConversationActive(true);
    setVoiceState("responding");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const apiUrl = getApiUrl();
      const textHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) {
        textHeaders["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${apiUrl}/api/chat/voice`, {
        method: "POST",
        headers: textHeaders,
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error("API request failed");

      const data = await response.json();
      await incrementDailyUsage();
      setCurrentMessage(data.text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (data.audioBase64) {
        const audioFileUri = await saveBase64Audio(data.audioBase64);
        shouldContinueListeningRef.current = true;
        await playResponseAudio(audioFileUri);
      } else {
        setVoiceState("idle");
      }
    } catch (e: unknown) {
      console.log("Error sending text:", e instanceof Error ? e.message : e);
      setCurrentMessage("Something went wrong. Please try again.");
      setVoiceState("idle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleOrbPress = () => {
    if (voiceState === "idle") {
      setShowStarters(false);
      setIsConversationActive(true);
      shouldContinueListeningRef.current = true;
      startRecording();
    } else if (voiceState === "listening") {
      stopRecording();
    } else if (voiceState === "speaking") {
      audioPlayingRef.current = false;
      if (Platform.OS === "web" && webAudioRef.current) {
        webAudioRef.current.pause();
        webAudioRef.current.onended = null;
      } else {
        audioPlayer.pause();
      }
      setShowStarters(false);
      setIsConversationActive(true);
      shouldContinueListeningRef.current = true;
      startRecording();
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
    
    if (Platform.OS === "web" && webAudioRef.current) {
      webAudioRef.current.pause();
      webAudioRef.current.onended = null;
    } else if (audioPlayer) {
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
    : ["#F5EBDD", "#FAF1E7", "#FDF6F0", "#FAF1E7", "#F5EBDD"] as const;

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
          {!isSubscribed ? (
            <Animated.Text 
              entering={FadeIn.duration(600).delay(400)}
              style={[styles.usageText, { color: theme.textMuted }]}
            >
              {remainingMessages} messages left today
            </Animated.Text>
          ) : null}
          <Pressable
            onPress={onSignOut}
            style={styles.signOutButton}
            testID="button-sign-out"
          >
            <Text style={[styles.signOutText, { color: theme.textMuted }]}>
              Sign Out
            </Text>
          </Pressable>
        </Animated.View>

        <View style={styles.orbContainer}>
          <Pressable
            onPress={handleOrbPress}
            disabled={voiceState === "responding"}
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
        </View>

        <View style={styles.bottomSection}>
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

          {showStarters && voiceState === "idle" && !currentMessage ? (
            <Animated.View
              entering={FadeIn.duration(800).delay(800)}
              style={styles.startersContainer}
            >
              {STARTER_PROMPTS.map((prompt, index) => (
                <Pressable
                  key={index}
                  onPress={() => sendTextToAPI(prompt)}
                  style={({ pressed }) => [
                    styles.starterChip,
                    {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(0,0,0,0.04)",
                      borderColor: isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(0,0,0,0.06)",
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                  testID={`starter-prompt-${index}`}
                >
                  <Text
                    style={[styles.starterText, { color: theme.textMuted }]}
                  >
                    {prompt}
                  </Text>
                </Pressable>
              ))}
            </Animated.View>
          ) : (
            <Animated.View style={[styles.messageContainer, animatedMessageStyle]}>
              {currentMessage ? (
                <Text style={[styles.messageText, { color: theme.text }]}>
                  {currentMessage}
                </Text>
              ) : null}
            </Animated.View>
          )}
        </View>
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
    fontFamily: FontFamily.light,
    letterSpacing: 6,
    textTransform: "uppercase",
  },
  usageText: {
    fontSize: 13,
    marginTop: Spacing.md,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 1,
  },
  signOutButton: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  signOutText: {
    fontSize: 13,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.3,
  },
  orbContainer: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  bottomSection: {
    alignItems: "center",
    paddingBottom: Spacing.md,
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
    fontFamily: FontFamily.light,
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
    fontFamily: FontFamily.regular,
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
    fontFamily: FontFamily.medium,
  },
  startersContainer: {
    paddingHorizontal: Spacing["2xl"],
    paddingBottom: Spacing["3xl"],
    paddingTop: Spacing.md,
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 80,
  },
  starterChip: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  starterText: {
    fontSize: 14,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.3,
    textAlign: "center",
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
    fontFamily: FontFamily.light,
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
    fontFamily: FontFamily.bold,
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
    fontFamily: FontFamily.bold,
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
