import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
  Linking,
  KeyboardAvoidingView,
  AppState,
  type AppStateStatus,
} from "react-native";
import { Feather } from "@expo/vector-icons";
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
import { LinearGradient } from "expo-linear-gradient";
import * as FileSystem from "expo-file-system/legacy";

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  useBottomTabBarHeight,
  type BottomTabNavigationProp,
  type BottomTabScreenProps,
} from "@react-navigation/bottom-tabs";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";

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
  route?: BottomTabScreenProps<MainTabParamList, "HomeTab">["route"];
  navigation?: BottomTabNavigationProp<MainTabParamList, "HomeTab">;
};

export default function SolenceScreen({
  authToken,
  onSignOut,
  route,
  navigation: tabNavigation,
}: SolenceScreenProps) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme, isDark } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const routeActiveConversationId = route?.params?.activeConversationId ?? null;
  const routeActiveConversationTitle =
    route?.params?.activeConversationTitle ?? null;
  const [activeConversationId, setActiveConversationId] = useState<number | null>(
    routeActiveConversationId,
  );
  const [activeConversationTitle, setActiveConversationTitle] = useState<
    string | null
  >(routeActiveConversationTitle);

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [tokensRemaining, setTokensRemaining] = useState(15000);
  const [tokenLimit, setTokenLimit] = useState(15000);
  const [nextResetAt, setNextResetAt] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showSubscriptionPrompt, setShowSubscriptionPrompt] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [showStarters, setShowStarters] = useState(true);
  const [textInputValue, setTextInputValue] = useState("");
  const [lastVoiceError, setLastVoiceError] = useState<{
    kind: "audio" | "text";
    payload: string;
  } | null>(null);

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
    fetchTokenUsage();
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        fetchTokenUsage();
      }
    });
    return () => sub.remove();
  }, []);

  // When the user resumes a specific conversation from the Profile tab, the
  // tab is navigated to with an activeConversationId param. Adopt it as the
  // active target, clear the starter prompts (this is no longer a fresh
  // session), and immediately strip the param from the route so it doesn't
  // re-trigger if the user later starts a brand new chat from the same tab.
  useEffect(() => {
    if (routeActiveConversationId == null) return;
    setActiveConversationId(routeActiveConversationId);
    setActiveConversationTitle(routeActiveConversationTitle);
    setShowStarters(false);
    setCurrentMessage("");
    setLastVoiceError(null);
    if (tabNavigation) {
      tabNavigation.setParams({
        activeConversationId: undefined,
        activeConversationTitle: undefined,
      });
    }
  }, [routeActiveConversationId, routeActiveConversationTitle, tabNavigation]);

  // Auto-refresh token balance shortly after the daily reset moment so the
  // UI reflects the new quota without needing a manual reload.
  useEffect(() => {
    if (!nextResetAt) return;
    const resetMs = new Date(nextResetAt).getTime();
    const delay = resetMs - Date.now() + 5000;
    if (!isFinite(delay) || delay <= 0 || delay > 24 * 60 * 60 * 1000) return;
    const timer = setTimeout(() => {
      fetchTokenUsage();
    }, delay);
    return () => clearTimeout(timer);
  }, [nextResetAt]);

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

        const onPlaybackEnd = () => {
          audioPlayingRef.current = false;
          if (shouldContinueListeningRef.current && canSendMessage()) {
            startRecording();
          } else {
            setVoiceState("idle");
          }
        };

        audio.onended = onPlaybackEnd;
        audio.onerror = () => {
          console.log("Web audio playback error");
          audioPlayingRef.current = false;
          setVoiceState("idle");
        };

        audio.onloadedmetadata = () => {
          const duration = audio.duration;
          if (duration && isFinite(duration)) {
            setTimeout(() => {
              if (audioPlayingRef.current) {
                console.log("Audio safety timeout triggered");
                audio.pause();
                onPlaybackEnd();
              }
            }, (duration + 2) * 1000);
          }
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

  const fetchTokenUsage = async () => {
    try {
      const apiUrl = getApiUrl();
      const headers: Record<string, string> = {};
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const response = await fetch(`${apiUrl}/api/tokens`, { headers });
      if (response.ok) {
        const data = await response.json();
        setTokensRemaining(data.tokensRemaining);
        setTokenLimit(data.tokenLimit);
        if (data.nextResetAt) setNextResetAt(data.nextResetAt);
      }
    } catch (e) {
      console.log("Error fetching token usage:", e);
    }
  };

  const updateTokensFromResponse = (data: {
    tokensRemaining?: number;
    tokenLimit?: number;
    nextResetAt?: string;
  }) => {
    if (data.tokensRemaining !== undefined) {
      setTokensRemaining(data.tokensRemaining);
    }
    if (data.tokenLimit !== undefined) {
      setTokenLimit(data.tokenLimit);
    }
    if (data.nextResetAt) {
      setNextResetAt(data.nextResetAt);
    }
  };

  const formatResetTime = (iso: string | null): string => {
    if (!iso) return "tomorrow";
    try {
      const reset = new Date(iso);
      const now = new Date();
      const diffMs = reset.getTime() - now.getTime();
      const diffMin = Math.round(diffMs / 60000);
      const time = reset.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      // Prefer relative wording when refresh is reasonably soon, since
      // "in 4 hours" is more actionable than a clock time the user has to
      // mentally compare against the current time.
      if (diffMin > 0 && diffMin < 60) {
        return `in ${diffMin} minute${diffMin === 1 ? "" : "s"}`;
      }
      const diffHr = Math.round(diffMin / 60);
      if (diffMin > 0 && diffHr <= 12) {
        return `in about ${diffHr} hour${diffHr === 1 ? "" : "s"}`;
      }
      const sameDay = reset.toDateString() === now.toDateString();
      if (sameDay) return `at ${time}`;
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      if (reset.toDateString() === tomorrow.toDateString()) {
        return `tomorrow at ${time}`;
      }
      return reset.toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "tomorrow";
    }
  };

  const canSendMessage = () => {
    if (isSubscribed) return true;
    return tokensRemaining > 0;
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
      // Always re-check the current OS permission state. requestRecordingPermissionsAsync
      // is safe to call repeatedly: on iOS the system dialog only ever appears
      // the first time and afterwards it returns the cached status without
      // prompting. This means a user who flipped mic access back on in Settings
      // will recover automatically the next time they tap the orb.
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        setPermissionDenied(true);
        // Stop any in-progress conversation loop so we don't keep retrying
        // recording behind the scenes.
        setIsConversationActive(false);
        shouldContinueListeningRef.current = false;
        setVoiceState("idle");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      // Permission is now granted — clear any previous denial banner so the
      // "Open Settings" affordance disappears.
      if (permissionDenied) setPermissionDenied(false);

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
    let audioBase64 = "";
    try {
      audioBase64 = await readRecordingAsBase64(recordingUri);

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
        body: JSON.stringify({
          audio: audioBase64,
          ...(activeConversationId != null
            ? { conversationId: activeConversationId }
            : {}),
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const errData = await response.json();
          updateTokensFromResponse(errData);
          setShowSubscriptionPrompt(true);
          setVoiceState("idle");
          setIsConversationActive(false);
          shouldContinueListeningRef.current = false;
          return;
        }
        if (response.status === 400) {
          const errData = await response.json();
          updateTokensFromResponse(errData);
          setCurrentMessage(errData.error || "I couldn't quite catch that. Try again?");
          setVoiceState("idle");
          if (isConversationActive && canSendMessage()) {
            setTimeout(() => startRecording(), 1000);
          }
          return;
        }
        console.log("Voice API error:", response.status, response.statusText);
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      updateTokensFromResponse(data);
      setCurrentMessage(data.text);
      setLastVoiceError(null);
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
      setCurrentMessage("Something went wrong. Tap retry to try again.");
      setVoiceState("idle");
      // Pause the auto-listen loop, but keep the conversation active so the
      // retry pill resumes the same session seamlessly. The user can tap
      // "End conversation" if they want to fully tear down.
      shouldContinueListeningRef.current = false;
      if (audioBase64.length >= 100) {
        setLastVoiceError({ kind: "audio", payload: audioBase64 });
      }
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
        body: JSON.stringify({
          text,
          ...(activeConversationId != null
            ? { conversationId: activeConversationId }
            : {}),
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          const errData = await response.json();
          updateTokensFromResponse(errData);
          setShowSubscriptionPrompt(true);
          setVoiceState("idle");
          return;
        }
        throw new Error("API request failed");
      }

      const data = await response.json();
      updateTokensFromResponse(data);
      setCurrentMessage(data.text);
      setLastVoiceError(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (data.audioBase64) {
        const audioFileUri = await saveBase64Audio(data.audioBase64);
        shouldContinueListeningRef.current = false;
        await playResponseAudio(audioFileUri);
      } else {
        setVoiceState("idle");
      }
    } catch (e: unknown) {
      console.log("Error sending text:", e instanceof Error ? e.message : e);
      setCurrentMessage("Something went wrong. Tap retry to try again.");
      setVoiceState("idle");
      setLastVoiceError({ kind: "text", payload: text });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const retryLastVoiceMessage = async () => {
    if (!lastVoiceError) return;
    const saved = lastVoiceError;
    setLastVoiceError(null);
    setCurrentMessage("");
    if (saved.kind === "text") {
      sendTextToAPI(saved.payload);
      return;
    }
    setIsConversationActive(true);
    setVoiceState("responding");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const apiUrl = getApiUrl();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      const response = await fetch(`${apiUrl}/api/chat/voice`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          audio: saved.payload,
          ...(activeConversationId != null
            ? { conversationId: activeConversationId }
            : {}),
        }),
      });
      if (!response.ok) {
        if (response.status === 429) {
          const errData = await response.json();
          updateTokensFromResponse(errData);
          setShowSubscriptionPrompt(true);
          setVoiceState("idle");
          setIsConversationActive(false);
          shouldContinueListeningRef.current = false;
          return;
        }
        if (response.status === 400) {
          const errData = await response.json();
          updateTokensFromResponse(errData);
          setCurrentMessage(errData.error || "I couldn't quite catch that. Try again?");
          setVoiceState("idle");
          setIsConversationActive(false);
          return;
        }
        throw new Error(`API request failed: ${response.status}`);
      }
      const data = await response.json();
      updateTokensFromResponse(data);
      setCurrentMessage(data.text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (data.audioBase64) {
        const audioFileUri = await saveBase64Audio(data.audioBase64);
        // We just resumed an active conversation, so ensure auto-listen kicks
        // back in after the response audio finishes. Reading
        // isConversationActive here would be stale because setIsConversationActive
        // earlier in this function hasn't flushed yet.
        shouldContinueListeningRef.current = true;
        await playResponseAudio(audioFileUri);
      } else {
        setVoiceState("idle");
      }
    } catch (e: unknown) {
      console.log("Retry failed:", e instanceof Error ? e.message : e);
      setCurrentMessage("Still having trouble connecting. Tap retry to try again.");
      setVoiceState("idle");
      setLastVoiceError(saved);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleSendText = () => {
    const trimmed = textInputValue.trim();
    if (!trimmed) return;
    setTextInputValue("");
    sendTextToAPI(trimmed);
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
    // Once the user explicitly ends a resumed session, drop the override so
    // the next interaction resumes the default (most-recent) target instead
    // of silently continuing to append to the old thread.
    setActiveConversationId(null);
    setActiveConversationTitle(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Dismissing the resumed-conversation pill clears the override but leaves
  // any in-progress voice/audio state alone — the user is just saying "next
  // message goes to a fresh thread, not this old one".
  const dismissResumedConversation = () => {
    setActiveConversationId(null);
    setActiveConversationTitle(null);
    Haptics.selectionAsync().catch(() => {});
  };

  // Tapping the body of the resumed-conversation pill pushes the
  // ConversationDetail screen onto the root stack so the user can re-read
  // the earlier exchange. ConversationDetail lives at the root level (not
  // inside a tab), so pressing back returns to whichever tab the user came
  // from — Home in this case — instead of jumping to the Profile tab.
  // We deliberately do NOT clear `activeConversationId` here — when the
  // user navigates back, the pill is still active so the next message
  // keeps appending to the same thread.
  const openResumedConversation = () => {
    if (activeConversationId == null) return;
    Haptics.selectionAsync().catch(() => {});
    navigation.navigate("ConversationDetail", {
      conversationId: activeConversationId,
      title: activeConversationTitle ?? undefined,
    });
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

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return `${tokens}`;
  };

  // Clamp the visible bar between 0 and 100 in case the server briefly reports
  // numbers outside the expected range (e.g. an over-spend that pushes
  // tokensRemaining negative). Without clamping the bar would either disappear
  // or overflow its track.
  const tokensUsed = Math.max(0, tokenLimit - tokensRemaining);
  const usageBarPercent = tokenLimit > 0
    ? Math.max(0, Math.min(100, Math.round((tokensUsed / tokenLimit) * 100)))
    : 0;
  const isLowOnTokens =
    tokenLimit > 0 && tokensRemaining > 0 && tokensRemaining / tokenLimit < 0.2;
  const isOutOfTokens = tokensRemaining <= 0;
  const usageAccentColor = isOutOfTokens || isLowOnTokens
    ? theme.orbPrimary
    : isDark
      ? "rgba(232, 228, 224, 0.55)"
      : "rgba(64, 62, 62, 0.45)";
  const usageTrackColor = isDark
    ? "rgba(255, 255, 255, 0.08)"
    : "rgba(0, 0, 0, 0.06)";

  const getStateText = () => {
    if (permissionDenied) return "Microphone access required";
    if (tokensRemaining <= 0 && !isSubscribed) {
      return `Comes back ${formatResetTime(nextResetAt)}`;
    }
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

  const isInputDisabled = voiceState === "listening" || voiceState === "responding" || voiceState === "speaking";

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

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View
          style={[
            styles.content,
            {
              paddingTop: insets.top + Spacing.xl,
              paddingBottom: tabBarHeight + Spacing.sm,
            },
          ]}
        >
          <Animated.View 
            entering={FadeInDown.duration(800).delay(200)}
            style={styles.header}
          >
            <Text style={[styles.title, { color: theme.text }]}>Solence</Text>
            <View style={styles.headerRow}>
              {!isSubscribed ? (
                <Animated.View
                  entering={FadeIn.duration(600).delay(400)}
                  style={styles.usageBlock}
                  testID="usage-indicator"
                  accessibilityLabel={
                    isOutOfTokens
                      ? `Daily limit reached. Resets ${formatResetTime(nextResetAt)}.`
                      : `${formatTokens(tokensUsed)} of ${formatTokens(tokenLimit)} tokens used today. Resets ${formatResetTime(nextResetAt)}.`
                  }
                >
                  <Text
                    style={[
                      styles.usageLabel,
                      { color: isLowOnTokens || isOutOfTokens ? theme.orbPrimary : theme.textMuted },
                    ]}
                    testID="text-usage-label"
                  >
                    {formatTokens(tokensUsed)} of {formatTokens(tokenLimit)} used today
                  </Text>
                  <View
                    style={[styles.usageTrack, { backgroundColor: usageTrackColor }]}
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: 100, now: usageBarPercent }}
                  >
                    <View
                      style={[
                        styles.usageFill,
                        {
                          width: `${usageBarPercent}%`,
                          backgroundColor: usageAccentColor,
                        },
                      ]}
                      testID="usage-fill"
                    />
                  </View>
                  <Text
                    style={[styles.usageReset, { color: theme.textMuted }]}
                    testID="text-usage-reset"
                  >
                    Resets {formatResetTime(nextResetAt)}
                  </Text>
                </Animated.View>
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
            </View>
          </Animated.View>

          {activeConversationId != null ? (
            <Animated.View
              entering={FadeIn.duration(400)}
              style={[
                styles.resumedBanner,
                {
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(0,0,0,0.05)",
                  borderColor: isDark
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(0,0,0,0.08)",
                },
              ]}
              testID="resumed-conversation-banner"
            >
              <Pressable
                onPress={openResumedConversation}
                accessibilityRole="button"
                accessibilityLabel={
                  activeConversationTitle && activeConversationTitle.trim()
                    ? `Open ${activeConversationTitle.trim()} to read past messages`
                    : "Open your last conversation to read past messages"
                }
                testID="open-resumed-conversation-button"
                style={({ pressed }) => [
                  styles.resumedBannerBody,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Feather
                  name="message-circle"
                  size={13}
                  color={theme.textMuted}
                />
                <Text
                  style={[
                    styles.resumedBannerText,
                    { color: theme.textMuted },
                  ]}
                  numberOfLines={1}
                  testID="text-resumed-conversation"
                >
                  Continuing{" "}
                  {activeConversationTitle && activeConversationTitle.trim()
                    ? activeConversationTitle.trim()
                    : "your last conversation"}
                </Text>
              </Pressable>
              <Pressable
                onPress={dismissResumedConversation}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Start a new conversation instead"
                testID="dismiss-resumed-conversation-button"
                style={({ pressed }) => [
                  styles.resumedBannerClose,
                  { opacity: pressed ? 0.5 : 1 },
                ]}
              >
                <Feather name="x" size={14} color={theme.textMuted} />
              </Pressable>
            </Animated.View>
          ) : null}

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

            {permissionDenied && Platform.OS === "web" ? (
              <Text
                style={[styles.settingsButtonText, { color: theme.textMuted, textAlign: "center", paddingHorizontal: 24 }]}
                testID="text-permission-web-help"
              >
                Allow microphone access from your browser&apos;s address bar, then tap the orb again.
              </Text>
            ) : null}

            {lastVoiceError && voiceState === "idle" ? (
              <Pressable
                onPress={retryLastVoiceMessage}
                style={({ pressed }) => [
                  styles.retryButton,
                  {
                    backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                    borderColor: theme.orbPrimary,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                testID="retry-button"
              >
                <Feather name="refresh-cw" size={14} color={theme.orbPrimary} />
                <Text style={[styles.retryButtonText, { color: theme.orbPrimary }]}>
                  Try again
                </Text>
              </Pressable>
            ) : null}

            <Animated.View style={[styles.messageContainer, animatedMessageStyle]}>
              {currentMessage ? (
                <Text style={[styles.messageText, { color: theme.text }]}>
                  {currentMessage}
                </Text>
              ) : null}
            </Animated.View>

            {showStarters && voiceState === "idle" && !currentMessage ? (
              <Animated.View
                entering={FadeIn.duration(800).delay(800)}
                style={styles.startersContainer}
              >
                {STARTER_PROMPTS.map((prompt, index) => (
                  <Pressable
                    key={index}
                    onPress={() => {
                      setTextInputValue(prompt);
                    }}
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
            ) : null}
          </View>

          <View style={[
            styles.inputRow,
            {
              backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
              borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
            },
          ]}>
            <TextInput
              style={[
                styles.textInput,
                { color: theme.text },
              ]}
              placeholder="Type a message..."
              placeholderTextColor={isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)"}
              value={textInputValue}
              onChangeText={setTextInputValue}
              editable={!isInputDisabled}
              onSubmitEditing={handleSendText}
              returnKeyType="send"
              multiline={false}
              testID="input-message"
            />
            <Pressable
              onPress={handleSendText}
              disabled={isInputDisabled || !textInputValue.trim()}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: textInputValue.trim() && !isInputDisabled
                    ? theme.orbPrimary
                    : isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              testID="button-send"
            >
              <Feather
                name="arrow-up"
                size={20}
                color={textInputValue.trim() && !isInputDisabled ? "#fff" : theme.textMuted}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

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
              Solence needs to rest
            </Text>
            <Text
              style={[
                styles.subscriptionDescription,
                { color: theme.textMuted },
              ]}
            >
              You've reached today's limit. Solence comes back{" "}
              {formatResetTime(nextResetAt)}, or you can upgrade for unlimited
              conversations now.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.subscribeButton,
                { backgroundColor: theme.orbPrimary, opacity: pressed ? 0.9 : 1 },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowSubscriptionPrompt(false);
                navigation.navigate("Upgrade", {
                  tokenLimit,
                  resetLabel: formatResetTime(nextResetAt),
                });
              }}
              testID="subscribe-button"
            >
              <Text style={styles.subscribeButtonText}>
                Upgrade
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
  keyboardAvoid: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
  },
  header: {
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  title: {
    fontSize: 32,
    fontWeight: "200",
    fontFamily: FontFamily.light,
    letterSpacing: 6,
    textTransform: "uppercase",
  },
  usageBlock: {
    alignItems: "center",
    gap: 4,
    minWidth: 160,
  },
  usageLabel: {
    fontSize: 11,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.4,
  },
  usageTrack: {
    width: 160,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  usageFill: {
    height: "100%",
    borderRadius: 2,
  },
  usageReset: {
    fontSize: 10,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.3,
    opacity: 0.85,
  },
  signOutButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
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
  resumedBanner: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: Spacing.xs,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xs,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    maxWidth: "90%",
  },
  resumedBannerBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    flexShrink: 1,
  },
  resumedBannerText: {
    fontSize: 12,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  resumedBannerClose: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
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
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: FontFamily.medium,
    letterSpacing: 0.5,
  },
  startersContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    paddingTop: Spacing.xs,
    gap: Spacing.xs,
  },
  starterChip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  starterText: {
    fontSize: 13,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.3,
    textAlign: "center",
  },
  messageContainer: {
    paddingHorizontal: Spacing.lg,
    maxHeight: 120,
    minHeight: 40,
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
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xs,
    paddingVertical: Platform.OS === "ios" ? Spacing.sm : Spacing.xs,
    gap: Spacing.sm,
    width: "100%",
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
    paddingVertical: Spacing.xs,
    minHeight: 24,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
