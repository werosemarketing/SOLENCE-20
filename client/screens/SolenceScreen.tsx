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
import { useTranslation } from "react-i18next";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import { CrisisBanner } from "@/components/CrisisBanner";
import { MoodSheet } from "@/components/MoodSheet";
import {
  containsCrisisLanguage,
  maybeRequestReview,
  recordSessionDay,
} from "@/lib/rating";
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

const STARTER_PROMPT_KEYS = [
  "solence.starterPrompts.1",
  "solence.starterPrompts.2",
  "solence.starterPrompts.3",
  "solence.starterPrompts.4",
] as const;

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
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const routeActiveConversationId = route?.params?.activeConversationId ?? null;
  const routeActiveConversationTitle =
    route?.params?.activeConversationTitle ?? null;
  const routeBreathingStarter = route?.params?.breathingStarter ?? null;
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
  // Visibility of the in-session crisis support banner. Flipped to true
  // when an API response carries `crisisSupport: true`. The dismiss ref
  // tracks per-app-session dismissal: once the user closes the banner we
  // suppress it for the rest of this session even if subsequent turns
  // also flag, so we don't keep re-popping it in their face.
  const [crisisBannerVisible, setCrisisBannerVisible] = useState(false);
  const crisisBannerDismissedRef = useRef(false);
  // Today's gentle prompt fetched from /api/daily-prompt. Stays null while
  // loading or on a fetch failure so we silently fall back to the static
  // starter chips below — never block the screen on it.
  const [dailyPrompt, setDailyPrompt] = useState<{
    prompt: string;
    topic: string;
    dateKey: string;
  } | null>(null);

  // Mood check-in state. The pre-session sheet pops once per app session
  // before the user starts a chat — `preMoodPromptedRef` gates that. The
  // post-session sheet pops on explicit endConversation when at least one
  // user message was sent — `sessionUserMessageCountRef` gates that.
  // `pendingPreSessionMood` is the score the user just picked; we attach
  // it to the next /api/chat/voice call so the system prompt can honor
  // it on the FIRST exchange, then clear it.
  const [showPreMoodSheet, setShowPreMoodSheet] = useState(false);
  const [showPostMoodSheet, setShowPostMoodSheet] = useState(false);
  const [postMoodConversationId, setPostMoodConversationId] =
    useState<number | null>(null);
  const [moodSubmitting, setMoodSubmitting] = useState(false);
  const [pendingPreSessionMood, setPendingPreSessionMood] = useState<
    { score: number; label: string } | null
  >(null);
  const preMoodPromptedRef = useRef(false);
  const sessionUserMessageCountRef = useRef(0);
  // Wall-clock timestamp of the first user turn in the current session,
  // used by the App-Store-rating gate (we want sessions that lasted at
  // least a couple minutes, not blink-and-it's-over taps).
  const sessionStartedAtRef = useRef<number | null>(null);
  // Set to true the moment we detect crisis language in user input during
  // this session — we then suppress the rating prompt entirely for this
  // conversation, regardless of how long or how chatty it was.
  const sessionHadCrisisRef = useRef(false);
  // When we intercept handleOrbPress / sendTextToAPI to show the pre-mood
  // sheet first, we stash the original action here and replay it once the
  // sheet closes (whether the user picked a mood or skipped).
  const pendingPostMoodActionRef = useRef<
    | { kind: "orb" }
    | { kind: "text"; text: string }
    | null
  >(null);

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
    fetchDailyPrompt();
    // Re-fetch on foreground so a session that spans midnight UTC quietly
    // picks up the new daily prompt without a manual reload.
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        fetchTokenUsage();
        fetchDailyPrompt();
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

  // After finishing the breathing experience the user can choose to
  // "Start a conversation" — that route forwards a starter string here.
  // Pre-fill the text input with it (so the user can edit or send), then
  // clear the param so it can't re-trigger on tab focus.
  useEffect(() => {
    if (!routeBreathingStarter) return;
    setTextInputValue(routeBreathingStarter);
    if (tabNavigation) {
      tabNavigation.setParams({ breathingStarter: undefined });
    }
  }, [routeBreathingStarter, tabNavigation]);

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

  // Pull today's gentle prompt. Public endpoint, no auth needed. Failures
  // are silent — the static starter chips are sufficient on their own, so
  // a flaky network shouldn't degrade the home screen.
  const fetchDailyPrompt = async () => {
    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/daily-prompt`);
      if (!response.ok) return;
      const data = (await response.json()) as {
        prompt?: string;
        topic?: string;
        dateKey?: string;
      };
      if (
        typeof data.prompt === "string" &&
        typeof data.topic === "string" &&
        typeof data.dateKey === "string"
      ) {
        setDailyPrompt({
          prompt: data.prompt,
          topic: data.topic,
          dateKey: data.dateKey,
        });
      }
    } catch (e) {
      console.log("Error fetching daily prompt:", e);
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
    if (!iso) return t("solence.reset.tomorrow");
    try {
      const reset = new Date(iso);
      const now = new Date();
      const diffMs = reset.getTime() - now.getTime();
      const diffMin = Math.round(diffMs / 60000);
      const time = reset.toLocaleTimeString(locale, {
        hour: "numeric",
        minute: "2-digit",
      });
      // Prefer relative wording when refresh is reasonably soon, since
      // "in 4 hours" is more actionable than a clock time the user has to
      // mentally compare against the current time.
      if (diffMin > 0 && diffMin < 60) {
        return t("solence.reset.inMinutes", { count: diffMin });
      }
      const diffHr = Math.round(diffMin / 60);
      if (diffMin > 0 && diffHr <= 12) {
        return t("solence.reset.inHours", { count: diffHr });
      }
      const sameDay = reset.toDateString() === now.toDateString();
      if (sameDay) return t("solence.reset.atTime", { time });
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      if (reset.toDateString() === tomorrow.toDateString()) {
        return t("solence.reset.tomorrowAt", { time });
      }
      return reset.toLocaleString(locale, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return t("solence.reset.tomorrow");
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
        setCurrentMessage(t("solence.errors.recordingTooShort"));
        setVoiceState("idle");
      }
    } catch (e: unknown) {
      console.log("Error stopping recording:", e instanceof Error ? e.message : e);
      setVoiceState("idle");
    }
  };

  // Surface the crisis support banner if the server flagged the latest
  // turn AND the user hasn't already dismissed the banner for this app
  // session. Idempotent — safe to call from every API success path.
  // Also latches `sessionHadCrisisRef` so the App-Store rating prompt
  // is suppressed for the rest of this session — covers voice turns
  // and any server-only crisis detections the client text scan misses.
  const maybeShowCrisisBanner = (data: { crisisSupport?: boolean } | null) => {
    if (!data || data.crisisSupport !== true) return;
    sessionHadCrisisRef.current = true;
    if (crisisBannerDismissedRef.current) return;
    setCrisisBannerVisible(true);
  };

  const dismissCrisisBanner = () => {
    crisisBannerDismissedRef.current = true;
    setCrisisBannerVisible(false);
  };

  const sendAudioToAPI = async (recordingUri: string) => {
    let audioBase64 = "";
    try {
      audioBase64 = await readRecordingAsBase64(recordingUri);

      if (audioBase64.length < 100) {
        setCurrentMessage(t("solence.errors.recordingTooShort"));
        setVoiceState("idle");
        return;
      }

      const apiUrl = getApiUrl();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const moodForRequest = pendingPreSessionMood;
      const response = await fetch(`${apiUrl}/api/chat/voice`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          audio: audioBase64,
          ...(activeConversationId != null
            ? { conversationId: activeConversationId }
            : {}),
          ...(moodForRequest ? { preSessionMood: moodForRequest } : {}),
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
          setCurrentMessage(errData.error || t("solence.errors.couldNotCatch"));
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
      // Adopt the conversationId echoed back by the server. On the very
      // first turn this is what gives the client a handle on the brand-
      // new conversation row (so endConversation can attach a post-mood
      // entry to it). For follow-up turns it's a no-op.
      if (typeof data.conversationId === "number" && activeConversationId == null) {
        setActiveConversationId(data.conversationId);
      }
      maybeShowCrisisBanner(data);
      // The pre-session mood hint only fires on the FIRST exchange — burn
      // the stash so it doesn't accidentally re-inject on later turns.
      if (moodForRequest) setPendingPreSessionMood(null);
      // Voice path: we don't have the user's transcribed text on the client,
      // so we can't crisis-scan it here. The bookkeeping still runs.
      noteUserTurn(null);
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
      setCurrentMessage(t("solence.errors.somethingWentWrong"));
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
      const moodForRequest = pendingPreSessionMood;
      const response = await fetch(`${apiUrl}/api/chat/voice`, {
        method: "POST",
        headers: textHeaders,
        body: JSON.stringify({
          text,
          ...(activeConversationId != null
            ? { conversationId: activeConversationId }
            : {}),
          ...(moodForRequest ? { preSessionMood: moodForRequest } : {}),
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
      if (typeof data.conversationId === "number" && activeConversationId == null) {
        setActiveConversationId(data.conversationId);
      }
      maybeShowCrisisBanner(data);
      if (moodForRequest) setPendingPreSessionMood(null);
      // Text path: scan the user's typed message for crisis language so we
      // can suppress the rating prompt for this session.
      noteUserTurn(text);
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
      setCurrentMessage(t("solence.errors.somethingWentWrong"));
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
      // Mirror sendAudioToAPI: still attach the pre-session mood hint if
      // the user picked one before this attempt — the original send never
      // reached the server, so the "first exchange" is happening here.
      const moodForRequest = pendingPreSessionMood;
      const response = await fetch(`${apiUrl}/api/chat/voice`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          audio: saved.payload,
          ...(activeConversationId != null
            ? { conversationId: activeConversationId }
            : {}),
          ...(moodForRequest ? { preSessionMood: moodForRequest } : {}),
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
          setCurrentMessage(errData.error || t("solence.errors.couldNotCatch"));
          setVoiceState("idle");
          setIsConversationActive(false);
          return;
        }
        throw new Error(`API request failed: ${response.status}`);
      }
      const data = await response.json();
      updateTokensFromResponse(data);
      // Same conversation-id adoption + session-counter bookkeeping as the
      // primary send path, so a successful retry still gates the post-mood
      // sheet correctly when the user later ends the conversation.
      if (typeof data.conversationId === "number" && activeConversationId == null) {
        setActiveConversationId(data.conversationId);
      }
      maybeShowCrisisBanner(data);
      if (moodForRequest) setPendingPreSessionMood(null);
      // Audio retry path: same caveat as the primary voice path — the
      // transcript isn't available client-side for crisis scanning.
      noteUserTurn(null);
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
      setCurrentMessage(t("solence.errors.stillTrouble"));
      setVoiceState("idle");
      setLastVoiceError(saved);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleSendText = () => {
    const trimmed = textInputValue.trim();
    if (!trimmed) return;
    setTextInputValue("");
    // The pre-mood sheet runs at most once per app session and is only
    // relevant to "first turn" of a brand-new conversation. We
    // intentionally gate after we've cleared the input field so it
    // doesn't reappear if the user dismisses the sheet.
    if (maybePromptPreMood({ kind: "text", text: trimmed })) return;
    sendTextToAPI(trimmed);
  };

  const handleOrbPress = () => {
    if (voiceState === "idle") {
      if (maybePromptPreMood({ kind: "orb" })) return;
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

  // Centralizes the bookkeeping every successful user turn needs to do: bump
  // the session counter, stamp the session start on the FIRST turn, and
  // mark today as a session day for the App-Store-rating multi-day gate.
  // Also opportunistically scans typed user input for crisis keywords so we
  // can suppress the rating prompt for the rest of this session.
  const noteUserTurn = (userTextIfKnown?: string | null) => {
    if (sessionUserMessageCountRef.current === 0) {
      sessionStartedAtRef.current = Date.now();
      void recordSessionDay();
    }
    sessionUserMessageCountRef.current += 1;
    if (userTextIfKnown && containsCrisisLanguage(userTextIfKnown)) {
      sessionHadCrisisRef.current = true;
    }
  };

  // Returns true if we intercepted the action to show the pre-mood sheet.
  // The action is replayed by handlePreMoodSheetClosed once the sheet is
  // dismissed (whether the user picked a mood or skipped).
  const maybePromptPreMood = (
    action: { kind: "orb" } | { kind: "text"; text: string },
  ) => {
    if (preMoodPromptedRef.current) return false;
    preMoodPromptedRef.current = true;
    pendingPostMoodActionRef.current = action;
    setShowPreMoodSheet(true);
    Haptics.selectionAsync().catch(() => {});
    return true;
  };

  const replayPendingAction = () => {
    const action = pendingPostMoodActionRef.current;
    pendingPostMoodActionRef.current = null;
    if (!action) return;
    if (action.kind === "orb") {
      setShowStarters(false);
      setIsConversationActive(true);
      shouldContinueListeningRef.current = true;
      startRecording();
    } else {
      sendTextToAPI(action.text);
    }
  };

  // Best-effort POST to /api/mood. We never block the UI on a network
  // failure — a missed mood entry is not worth interrupting the user
  // about. Errors are swallowed and logged.
  const postMoodEntry = async (
    phase: "pre" | "post",
    score: number,
    conversationId: number | null,
  ) => {
    try {
      const apiUrl = getApiUrl();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      await fetch(`${apiUrl}/api/mood`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          phase,
          score,
          ...(conversationId != null ? { conversationId } : {}),
        }),
      });
    } catch (err) {
      console.log("Mood POST failed:", err instanceof Error ? err.message : err);
    }
  };

  const handlePreMoodSelect = async (score: number, label: string) => {
    setMoodSubmitting(true);
    setPendingPreSessionMood({ score, label });
    await postMoodEntry("pre", score, null);
    setMoodSubmitting(false);
    setShowPreMoodSheet(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    replayPendingAction();
  };

  const handlePreMoodSkip = () => {
    setShowPreMoodSheet(false);
    replayPendingAction();
  };

  const handlePostMoodSelect = async (score: number, label: string) => {
    void label;
    setMoodSubmitting(true);
    await postMoodEntry("post", score, postMoodConversationId);
    setMoodSubmitting(false);
    setShowPostMoodSheet(false);
    setPostMoodConversationId(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  };

  const handlePostMoodSkip = () => {
    setShowPostMoodSheet(false);
    setPostMoodConversationId(null);
  };

  // Fire the end-of-session reflection generator on the server. Intentionally
  // fire-and-forget: the user has already moved on (post-mood sheet, or
  // fully torn down), so any latency or failure here must never surface.
  const requestReflectionForConversation = async (conversationId: number) => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      await fetch(`${getApiUrl()}/api/conversations/${conversationId}/end`, {
        method: "POST",
        headers,
      });
    } catch (err) {
      console.log(
        "Reflection request failed:",
        err instanceof Error ? err.message : err,
      );
    }
  };

  const endConversation = () => {
    // Snapshot the just-ended conversation BEFORE we tear state down — the
    // post-mood sheet needs to attach to this id, and we only show it
    // when there was at least one user turn in the session (otherwise
    // there's nothing to reflect on).
    const endedConversationId = activeConversationId;
    const hadInteraction = sessionUserMessageCountRef.current > 0;
    const messageCountForReview = sessionUserMessageCountRef.current;
    const sessionStartedAt = sessionStartedAtRef.current;
    const sessionDurationMs =
      sessionStartedAt != null ? Date.now() - sessionStartedAt : 0;
    const sessionHadCrisis = sessionHadCrisisRef.current;
    sessionUserMessageCountRef.current = 0;
    sessionStartedAtRef.current = null;
    sessionHadCrisisRef.current = false;

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

    if (hadInteraction && endedConversationId != null) {
      setPostMoodConversationId(endedConversationId);
      setShowPostMoodSheet(true);
      // Fire-and-forget: ask the server to generate a reflection summary +
      // takeaway for the just-ended session. The server is idempotent, so
      // a duplicate call (e.g. from a Profile refresh) is a no-op. We
      // deliberately do NOT await — the user shouldn't have to wait for
      // OpenAI before the post-mood sheet appears, and a network error
      // here just means the reflection won't show up; the next end of any
      // session will retry implicitly because the columns are still NULL.
      void requestReflectionForConversation(endedConversationId);
    }

    // Best-effort App Store rating prompt. The library handles all the gates
    // (min messages, min duration, multi-day usage, 4-month cooldown, no-op
    // on web / unsupported devices). Fire-and-forget: any failure is
    // swallowed so the user never sees an error from a courtesy prompt.
    void maybeRequestReview({
      messageCount: messageCountForReview,
      sessionDurationMs,
      hadCrisis: sessionHadCrisis,
    });
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
    if (permissionDenied) return t("solence.permissionDeniedShort");
    if (tokensRemaining <= 0 && !isSubscribed) {
      return t("solence.comesBack", { when: formatResetTime(nextResetAt) });
    }
    switch (voiceState) {
      case "idle":
        return t("solence.tapToBegin");
      case "listening":
        return t("solence.listening");
      case "responding":
        return t("solence.thinking");
      case "speaking":
        return t("solence.speaking");
      default:
        return t("solence.tapToBegin");
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
                      ? t("solence.usage.a11yLimitReached", {
                          when: formatResetTime(nextResetAt),
                        })
                      : t("solence.usage.a11yUsed", {
                          used: formatTokens(tokensUsed),
                          limit: formatTokens(tokenLimit),
                          when: formatResetTime(nextResetAt),
                        })
                  }
                >
                  <Text
                    style={[
                      styles.usageLabel,
                      { color: isLowOnTokens || isOutOfTokens ? theme.orbPrimary : theme.textMuted },
                    ]}
                    testID="text-usage-label"
                  >
                    {t("solence.usage.label", {
                      used: formatTokens(tokensUsed),
                      limit: formatTokens(tokenLimit),
                    })}
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
                    {t("solence.usage.resets", { when: formatResetTime(nextResetAt) })}
                  </Text>
                </Animated.View>
              ) : null}
              <Pressable
                onPress={onSignOut}
                style={styles.signOutButton}
                testID="button-sign-out"
              >
                <Text style={[styles.signOutText, { color: theme.textMuted }]}>
                  {t("solence.signOut")}
                </Text>
              </Pressable>
            </View>
          </Animated.View>

          {crisisBannerVisible ? (
            <Animated.View
              entering={FadeIn.duration(400)}
              style={styles.crisisBannerWrap}
            >
              <CrisisBanner
                onDismiss={dismissCrisisBanner}
                testID="solence-crisis-banner"
              />
            </Animated.View>
          ) : null}

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
                    ? t("solence.openLastA11y", {
                        title: activeConversationTitle.trim(),
                      })
                    : t("solence.openLastDefaultA11y")
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
                  {activeConversationTitle && activeConversationTitle.trim()
                    ? t("solence.continuing", {
                        title: activeConversationTitle.trim(),
                      })
                    : t("solence.continuingDefault")}
                </Text>
              </Pressable>
              <Pressable
                onPress={dismissResumedConversation}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("solence.newConversationA11y")}
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
                  {t("solence.endConversation")}
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
                  {t("solence.errors.openSettings")}
                </Text>
              </Pressable>
            ) : null}

            {permissionDenied && Platform.OS === "web" ? (
              <Text
                style={[styles.settingsButtonText, { color: theme.textMuted, textAlign: "center", paddingHorizontal: 24 }]}
                testID="text-permission-web-help"
              >
                {t("solence.permissionWebHelp")}
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
                  {t("solence.tryAgain")}
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
              <>
                <Animated.View
                  entering={FadeIn.duration(700).delay(500)}
                  style={styles.breatheChipContainer}
                >
                  <Pressable
                    onPress={() => {
                      if (Platform.OS !== "web") {
                        Haptics.selectionAsync().catch(() => {});
                      }
                      navigation.navigate("Breathing");
                    }}
                    style={({ pressed }) => [
                      styles.breatheChip,
                      {
                        backgroundColor: isDark
                          ? "rgba(214,107,50,0.16)"
                          : "rgba(214,107,50,0.10)",
                        borderColor: isDark
                          ? "rgba(214,107,50,0.32)"
                          : "rgba(214,107,50,0.28)",
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Take a breath — open a 60-second guided breathing exercise"
                    testID="button-take-a-breath"
                  >
                    <Feather name="wind" size={14} color={theme.orbPrimary} />
                    <Text
                      style={[styles.breatheChipText, { color: theme.orbPrimary }]}
                    >
                      Take a breath
                    </Text>
                  </Pressable>
                </Animated.View>
                {dailyPrompt ? (
                  <Animated.View
                    entering={FadeIn.duration(800).delay(600)}
                    style={styles.dailyPromptWrap}
                  >
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setTextInputValue(dailyPrompt.prompt);
                      }}
                      style={({ pressed }) => [
                        styles.dailyPromptCard,
                        {
                          backgroundColor: isDark
                            ? "rgba(214, 107, 50, 0.14)"
                            : "rgba(214, 107, 50, 0.10)",
                          borderColor: isDark
                            ? "rgba(214, 107, 50, 0.45)"
                            : "rgba(214, 107, 50, 0.35)",
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Today's prompt: ${dailyPrompt.prompt}`}
                      testID="daily-prompt-card"
                    >
                      <Text
                        style={[
                          styles.dailyPromptLabel,
                          { color: theme.orbPrimary },
                        ]}
                        testID="text-daily-prompt-label"
                      >
                        Today
                      </Text>
                      <Text
                        style={[
                          styles.dailyPromptText,
                          { color: theme.text },
                        ]}
                        testID="text-daily-prompt"
                      >
                        {dailyPrompt.prompt}
                      </Text>
                    </Pressable>
                  </Animated.View>
                ) : null}
                <Animated.View
                  entering={FadeIn.duration(800).delay(800)}
                  style={styles.startersContainer}
                >
                  {STARTER_PROMPT_KEYS.map((promptKey, index) => {
                    const prompt = t(promptKey);
                    return (
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
                    );
                  })}
                </Animated.View>
              </>
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
              placeholder={t("solence.typeMessage")}
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
              {t("solence.subscriptionModal.title")}
            </Text>
            <Text
              style={[
                styles.subscriptionDescription,
                { color: theme.textMuted },
              ]}
            >
              {t("solence.subscriptionModal.body", {
                when: formatResetTime(nextResetAt),
              })}
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
                {t("solence.subscriptionModal.upgrade")}
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
                {t("solence.subscriptionModal.maybeLater")}
              </Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      ) : null}

      <MoodSheet
        visible={showPreMoodSheet}
        variant="pre"
        submitting={moodSubmitting}
        onSelect={handlePreMoodSelect}
        onSkip={handlePreMoodSkip}
      />
      <MoodSheet
        visible={showPostMoodSheet}
        variant="post"
        submitting={moodSubmitting}
        onSelect={handlePostMoodSelect}
        onSkip={handlePostMoodSkip}
      />
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
  crisisBannerWrap: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.lg,
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
  dailyPromptWrap: {
    width: "100%",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    alignItems: "center",
  },
  dailyPromptCard: {
    width: "100%",
    maxWidth: 360,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
  },
  dailyPromptLabel: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: FontFamily.medium,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  dailyPromptText: {
    fontSize: 15,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.3,
    textAlign: "center",
    lineHeight: 22,
  },
  breatheChipContainer: {
    alignItems: "center",
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  breatheChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  breatheChipText: {
    fontSize: 13,
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
