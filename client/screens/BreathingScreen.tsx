import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
  BackHandler,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withRepeat,
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

// 4-7-8 cadence (in milliseconds). Configurable in code per the spec.
const INHALE_MS = 4000;
const HOLD_MS = 7000;
const EXHALE_MS = 8000;
const CYCLE_MS = INHALE_MS + HOLD_MS + EXHALE_MS; // 19s
const TOTAL_CYCLES = 3; // ~57s — close to the targeted 60s

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ORB_SIZE = SCREEN_WIDTH * 0.55;

type Phase = "inhale" | "hold" | "exhale";

const PHASE_LABEL: Record<Phase, string> = {
  inhale: "Breathe in",
  hold: "Hold",
  exhale: "Breathe out",
};

const STARTER_AFTER_BREATH = "I just took a breath. Can we sit with this together?";

function BreathingOrb({
  scale,
  glow,
  isDark,
}: {
  scale: SharedValue<number>;
  glow: SharedValue<number>;
  isDark: boolean;
}) {
  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * 1.35 }],
    opacity: glow.value * 0.35,
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * 1.15 }],
    opacity: glow.value * 0.55,
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: 0.85 + glow.value * 0.15,
  }));

  const haloColor = isDark ? "rgba(214, 107, 50, 0.18)" : "rgba(214, 107, 50, 0.14)";
  const ringColor = isDark ? "rgba(214, 107, 50, 0.28)" : "rgba(214, 107, 50, 0.22)";

  return (
    <View style={styles.orbWrap} pointerEvents="none">
      <Animated.View
        style={[
          styles.orbHalo,
          {
            width: ORB_SIZE * 1.9,
            height: ORB_SIZE * 1.9,
            borderRadius: ORB_SIZE,
            backgroundColor: haloColor,
          },
          haloStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.orbHalo,
          {
            width: ORB_SIZE * 1.4,
            height: ORB_SIZE * 1.4,
            borderRadius: ORB_SIZE,
            backgroundColor: ringColor,
          },
          ringStyle,
        ]}
      />
      <Animated.View style={[styles.orbCore, coreStyle]}>
        <LinearGradient
          colors={["#F1B5A6", "#E8945E", "#D66B32", "#A04E1E"] as const}
          style={[
            styles.orbGradient,
            {
              width: ORB_SIZE,
              height: ORB_SIZE,
              borderRadius: ORB_SIZE / 2,
            },
          ]}
          start={{ x: 0.3, y: 0.2 }}
          end={{ x: 0.8, y: 0.9 }}
        />
        <View
          style={[
            styles.orbHighlight,
            {
              width: ORB_SIZE * 0.32,
              height: ORB_SIZE * 0.18,
              borderRadius: ORB_SIZE * 0.16,
              top: ORB_SIZE * 0.16,
              left: ORB_SIZE * 0.18,
            },
          ]}
        />
      </Animated.View>
    </View>
  );
}

type Props = NativeStackScreenProps<RootStackParamList, "Breathing">;

export default function BreathingScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  const [phase, setPhase] = useState<Phase>("inhale");
  const [finished, setFinished] = useState(false);

  const scale = useSharedValue(0.7);
  const glow = useSharedValue(0.4);
  const finishedRef = useRef(false);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const tapHaptic = () => {
    if (Platform.OS === "web") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const completionHaptic = () => {
    if (Platform.OS === "web") return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  };

  const clearAllTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  const close = () => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    navigation.goBack();
  };

  const startConversation = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    navigation.navigate("Main", {
      screen: "HomeTab",
      params: { breathingStarter: STARTER_AFTER_BREATH },
    });
  };

  useEffect(() => {
    // Drive the orb on the UI thread with a deterministic loop. Phase state
    // updates (for the label/haptics) are scheduled with setTimeout so they
    // stay in lock-step with the visual animation.
    scale.value = withRepeat(
      withSequence(
        withTiming(1.18, {
          duration: INHALE_MS,
          easing: Easing.inOut(Easing.cubic),
        }),
        withTiming(1.18, { duration: HOLD_MS, easing: Easing.linear }),
        withTiming(0.7, {
          duration: EXHALE_MS,
          easing: Easing.inOut(Easing.cubic),
        }),
      ),
      TOTAL_CYCLES,
      false,
    );

    glow.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: INHALE_MS,
          easing: Easing.inOut(Easing.cubic),
        }),
        withTiming(0.95, { duration: HOLD_MS, easing: Easing.linear }),
        withTiming(0.4, {
          duration: EXHALE_MS,
          easing: Easing.inOut(Easing.cubic),
        }),
      ),
      TOTAL_CYCLES,
      false,
    );

    // Schedule label + haptic transitions for every phase across all cycles.
    tapHaptic();
    setPhase("inhale");
    for (let i = 0; i < TOTAL_CYCLES; i++) {
      const cycleStart = i * CYCLE_MS;
      // Hold begins after inhale.
      timersRef.current.push(
        setTimeout(() => {
          if (finishedRef.current) return;
          setPhase("hold");
          tapHaptic();
        }, cycleStart + INHALE_MS),
      );
      // Exhale begins after hold.
      timersRef.current.push(
        setTimeout(() => {
          if (finishedRef.current) return;
          setPhase("exhale");
          tapHaptic();
        }, cycleStart + INHALE_MS + HOLD_MS),
      );
      // Next inhale (skip on the final cycle — that's the finish boundary).
      if (i < TOTAL_CYCLES - 1) {
        timersRef.current.push(
          setTimeout(() => {
            if (finishedRef.current) return;
            setPhase("inhale");
            tapHaptic();
          }, cycleStart + CYCLE_MS),
        );
      }
    }
    // Finish the experience cleanly at the end of the last exhale.
    timersRef.current.push(
      setTimeout(() => {
        if (finishedRef.current) return;
        finishedRef.current = true;
        cancelAnimation(scale);
        cancelAnimation(glow);
        scale.value = withTiming(0.85, { duration: 600 });
        glow.value = withTiming(0.55, { duration: 600 });
        completionHaptic();
        setFinished(true);
      }, TOTAL_CYCLES * CYCLE_MS),
    );

    return () => {
      finishedRef.current = true;
      clearAllTimers();
      cancelAnimation(scale);
      cancelAnimation(glow);
    };
  }, []);

  // On Android, intercept the hardware back to call our close handler so the
  // animations are torn down via the unmount effect (which already happens).
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, []);

  const gradientColors = isDark
    ? (["#1a1625", "#242030", "#2e2a3a"] as const)
    : (["#FAF1E7", "#F5EBDD", "#EFE3D5"] as const);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      testID="breathing-screen"
    >
      <LinearGradient
        colors={gradientColors}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <Pressable
        onPress={close}
        hitSlop={12}
        style={[
          styles.closeButton,
          {
            top: insets.top + Spacing.sm,
            backgroundColor: isDark
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.05)",
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Close breathing exercise"
        testID="button-close-breathing"
      >
        <Feather name="x" size={20} color={theme.text} />
      </Pressable>

      <View
        style={[
          styles.body,
          {
            paddingTop: insets.top + Spacing["3xl"],
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
      >
        <View style={styles.orbContainer}>
          <BreathingOrb scale={scale} glow={glow} isDark={isDark} />
        </View>

        {!finished ? (
          <Animated.View
            key={phase}
            entering={FadeIn.duration(600)}
            exiting={FadeOut.duration(400)}
            style={styles.labelContainer}
          >
            <Text
              style={[styles.phaseLabel, { color: theme.text }]}
              testID="text-breathing-phase"
            >
              {PHASE_LABEL[phase]}
            </Text>
            <Text style={[styles.subLabel, { color: theme.textMuted }]}>
              {phase === "hold" ? "Hold gently" : "Follow the orb"}
            </Text>
          </Animated.View>
        ) : (
          <Animated.View
            key="finished"
            entering={FadeIn.duration(700)}
            style={styles.finishedContainer}
            testID="breathing-finished"
          >
            <Text style={[styles.finishedTitle, { color: theme.text }]}>
              How do you feel?
            </Text>
            <Text style={[styles.finishedSubtitle, { color: theme.textMuted }]}>
              Take a moment with what came up.
            </Text>

            <Pressable
              onPress={startConversation}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.orbPrimary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Start a conversation with Solence"
              testID="button-start-conversation"
            >
              <Text style={styles.primaryButtonText}>Start a conversation</Text>
            </Pressable>

            <Pressable
              onPress={close}
              style={({ pressed }) => [
                styles.secondaryButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="button-close-finished"
            >
              <Text
                style={[styles.secondaryButtonText, { color: theme.textMuted }]}
              >
                Close
              </Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  closeButton: {
    position: "absolute",
    right: Spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
  },
  orbContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  orbWrap: {
    width: ORB_SIZE * 2,
    height: ORB_SIZE * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  orbHalo: {
    position: "absolute",
  },
  orbCore: {
    alignItems: "center",
    justifyContent: "center",
  },
  orbGradient: {
    alignItems: "center",
    justifyContent: "center",
  },
  orbHighlight: {
    position: "absolute",
    backgroundColor: "rgba(255, 255, 255, 0.28)",
  },
  labelContainer: {
    alignItems: "center",
    paddingBottom: Spacing["3xl"],
  },
  phaseLabel: {
    fontSize: 28,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 4,
    textTransform: "uppercase",
  },
  subLabel: {
    marginTop: Spacing.sm,
    fontSize: 13,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 1.2,
  },
  finishedContainer: {
    alignItems: "center",
    paddingBottom: Spacing.lg,
    width: "100%",
  },
  finishedTitle: {
    fontSize: 24,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 1.5,
    textAlign: "center",
  },
  finishedSubtitle: {
    marginTop: Spacing.sm,
    fontSize: 14,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.4,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  primaryButton: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["3xl"],
    borderRadius: BorderRadius.full,
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: FontFamily.bold,
    letterSpacing: 0.5,
  },
  secondaryButton: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.5,
  },
});
