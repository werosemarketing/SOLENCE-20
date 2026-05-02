import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  fontForWeight,
} from "@/constants/theme";

const ORB_SIZE = 160;
const FAILURES_BEFORE_SIGN_OUT = 3;

type LockScreenProps = {
  onUnlock: () => void;
  onSignOut?: () => void;
  reason?: string;
};

function LockOrb() {
  const layer1Scale = useSharedValue(1);
  const layer2Scale = useSharedValue(1);
  const coreOpacity = useSharedValue(0.9);

  useEffect(() => {
    layer1Scale.value = withRepeat(
      withSequence(
        withTiming(1.06, {
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(0.98, {
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );
    layer2Scale.value = withRepeat(
      withSequence(
        withTiming(1.1, {
          duration: 4500,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(0.94, {
          duration: 4500,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );
    coreOpacity.value = withRepeat(
      withSequence(
        withTiming(0.95, {
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(0.8, {
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );
  }, [coreOpacity, layer1Scale, layer2Scale]);

  const layer1Style = useAnimatedStyle(() => ({
    transform: [{ scale: layer1Scale.value }],
  }));
  const layer2Style = useAnimatedStyle(() => ({
    transform: [{ scale: layer2Scale.value }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    opacity: coreOpacity.value,
  }));

  return (
    <View style={orbStyles.container}>
      <Animated.View
        style={[
          orbStyles.layer,
          {
            width: ORB_SIZE * 2,
            height: ORB_SIZE * 2,
            borderRadius: ORB_SIZE,
            backgroundColor: "rgba(214, 107, 50, 0.08)",
          },
          layer2Style,
        ]}
      />
      <Animated.View
        style={[
          orbStyles.layer,
          {
            width: ORB_SIZE * 1.4,
            height: ORB_SIZE * 1.4,
            borderRadius: ORB_SIZE * 0.7,
            backgroundColor: "rgba(214, 107, 50, 0.16)",
          },
          layer1Style,
        ]}
      />
      <Animated.View style={coreStyle}>
        <LinearGradient
          colors={["#F1B5A6", "#E8945E", "#D66B32", "#A04E1E"] as const}
          style={[
            orbStyles.core,
            {
              width: ORB_SIZE * 0.7,
              height: ORB_SIZE * 0.7,
              borderRadius: ORB_SIZE * 0.35,
            },
          ]}
          start={{ x: 0.3, y: 0.2 }}
          end={{ x: 0.8, y: 0.9 }}
        />
      </Animated.View>
    </View>
  );
}

export default function LockScreen({
  onUnlock,
  onSignOut,
  reason,
}: LockScreenProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failureCount, setFailureCount] = useState(0);
  const [biometricLabel, setBiometricLabel] = useState("Face ID");
  const [hardwareReady, setHardwareReady] = useState<boolean | null>(null);
  const autoTriedRef = useRef(false);

  // Determine which biometric label to show. We check supported types; on
  // devices without biometrics (or web) we fall back to a generic
  // "Unlock" label and let the OS prompt for the device passcode.
  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      if (Platform.OS === "web") {
        if (!cancelled) {
          setBiometricLabel("Unlock");
          setHardwareReady(false);
        }
        return;
      }
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const types =
          await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (cancelled) return;
        if (
          types.includes(
            LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
          )
        ) {
          setBiometricLabel("Face ID");
        } else if (
          types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ) {
          setBiometricLabel("Touch ID");
        } else if (
          types.includes(LocalAuthentication.AuthenticationType.IRIS)
        ) {
          setBiometricLabel("Iris");
        } else {
          setBiometricLabel("Unlock");
        }
        setHardwareReady(hasHardware);
      } catch {
        if (!cancelled) {
          setBiometricLabel("Unlock");
          setHardwareReady(false);
        }
      }
    };
    detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const authenticate = useCallback(async () => {
    if (Platform.OS === "web") {
      setError("Face ID / passcode lock is not available on the web.");
      return;
    }
    if (authenticating) return;
    setAuthenticating(true);
    setError(null);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Solence",
        // Allow OS to fall back to device passcode automatically.
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
      });
      if (result.success) {
        setFailureCount(0);
        onUnlock();
      } else {
        // Common error codes: 'user_cancel', 'system_cancel',
        // 'user_fallback', 'lockout', 'authentication_failed',
        // 'not_enrolled'.
        const code =
          (result as { error?: string; warning?: string }).error ?? "";
        if (code === "not_enrolled" || code === "passcode_not_set") {
          setError(
            "No Face ID, Touch ID, or device passcode is set on this device. You can disable the app lock from Profile.",
          );
        } else if (code === "lockout" || code === "lockout_permanent") {
          setError(
            "Too many attempts. Wait a moment and try again, or use your device passcode.",
          );
        } else if (
          code === "user_cancel" ||
          code === "system_cancel" ||
          code === "app_cancel"
        ) {
          // User backed out — don't alarm them, but bump failure count
          // so the sign-out escape hatch still appears after a few tries.
          setError(null);
        } else {
          setError("Couldn't verify it's you. Please try again.");
        }
        setFailureCount((c) => c + 1);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      setFailureCount((c) => c + 1);
    } finally {
      setAuthenticating(false);
    }
  }, [authenticating, onUnlock]);

  // Auto-prompt once when the lock screen first appears so the user
  // doesn't have to tap a button every cold launch.
  useEffect(() => {
    if (autoTriedRef.current) return;
    if (hardwareReady === null) return;
    if (Platform.OS === "web") return;
    if (!hardwareReady) return;
    autoTriedRef.current = true;
    authenticate();
  }, [authenticate, hardwareReady]);

  const showSignOut = failureCount >= FAILURES_BEFORE_SIGN_OUT && !!onSignOut;

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.backgroundRoot,
          paddingTop: insets.top + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
      testID="lock-screen"
    >
      <View style={styles.body}>
        <LockOrb />
        <Text
          style={[styles.title, { color: theme.text }]}
          testID="lock-screen-title"
        >
          Solence is locked
        </Text>
        <Text
          style={[styles.subtitle, { color: theme.textMuted }]}
          testID="lock-screen-subtitle"
        >
          {reason ??
            "Unlock to continue your conversations. Your messages stay private."}
        </Text>

        {error ? (
          <Text
            style={[styles.error, { color: theme.text }]}
            testID="lock-screen-error"
          >
            {error}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={authenticate}
          disabled={authenticating || Platform.OS === "web"}
          style={({ pressed }) => [
            styles.unlockButton,
            {
              backgroundColor: theme.orbPrimary,
              opacity:
                pressed || authenticating || Platform.OS === "web" ? 0.7 : 1,
            },
          ]}
          testID="lock-screen-unlock"
          accessibilityRole="button"
          accessibilityLabel={`Unlock with ${biometricLabel}`}
        >
          {authenticating ? (
            <ActivityIndicator color={theme.buttonText} />
          ) : (
            <View style={styles.unlockButtonContent}>
              <Feather name="lock" size={16} color={theme.buttonText} />
              <Text
                style={[styles.unlockButtonText, { color: theme.buttonText }]}
              >
                {Platform.OS === "web"
                  ? "Unlock not available on web"
                  : `Unlock with ${biometricLabel}`}
              </Text>
            </View>
          )}
        </Pressable>

        {showSignOut ? (
          <Pressable
            onPress={onSignOut}
            style={({ pressed }) => [
              styles.signOutButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
            testID="lock-screen-sign-out"
            accessibilityRole="button"
            accessibilityLabel="Sign out of Solence"
          >
            <Text style={[styles.signOutText, { color: theme.textMuted }]}>
              Can&rsquo;t unlock? Sign out
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const orbStyles = StyleSheet.create({
  container: {
    width: ORB_SIZE * 2,
    height: ORB_SIZE * 2,
    alignItems: "center",
    justifyContent: "center",
  },
  layer: {
    position: "absolute",
  },
  core: {
    overflow: "hidden",
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: "space-between",
    alignItems: "center",
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
    width: "100%",
  },
  title: {
    ...Typography.h3,
    fontFamily: fontForWeight("600"),
    textAlign: "center",
    marginTop: Spacing.lg,
  },
  subtitle: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
    textAlign: "center",
    maxWidth: 320,
  },
  error: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
  },
  actions: {
    width: "100%",
    alignItems: "center",
    gap: Spacing.md,
  },
  unlockButton: {
    width: "100%",
    maxWidth: 360,
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  unlockButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  unlockButtonText: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
  },
  signOutButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  signOutText: {
    ...Typography.small,
    fontFamily: fontForWeight("500"),
    textDecorationLine: "underline",
  },
});
