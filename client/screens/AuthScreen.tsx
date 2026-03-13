import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";

type Props = {
  onAuthenticated: (token: string) => void;
};

export default function AuthScreen({ onAuthenticated }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const gradientColors = isDark
    ? (["#0f0c14", "#1a1625", "#1f1a2e", "#1a1625", "#0f0c14"] as const)
    : (["#F5EBDD", "#FAF1E7", "#FDF6F0", "#FAF1E7", "#F5EBDD"] as const);

  const handleSubmit = async () => {
    setError("");

    if (!email.trim() || !password) {
      setError("Please enter your email and password");
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (isSignUp && password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);
    try {
      const apiUrl = getApiUrl();
      const endpoint = isSignUp ? "/api/auth/register" : "/api/auth/login";
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      onAuthenticated(data.token);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setError("");
    setConfirmPassword("");
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={gradientColors}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={[
            styles.content,
            {
              paddingTop: insets.top + Spacing["4xl"],
              paddingBottom: insets.bottom + Spacing["2xl"],
            },
          ]}
        >
          <Animated.View entering={FadeIn.duration(800)} style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>
              SOLENCE
            </Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              {isSignUp ? "Create your account" : "Welcome back"}
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            style={styles.formContainer}
          >
            <View
              style={[
                styles.inputContainer,
                {
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.04)",
                  borderColor: isDark
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(0,0,0,0.08)",
                },
              ]}
            >
              <TextInput
                style={[styles.input, { color: theme.text }]}
                placeholder="Email"
                placeholderTextColor={theme.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="input-email"
              />
            </View>

            <View
              style={[
                styles.inputContainer,
                {
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.04)",
                  borderColor: isDark
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(0,0,0,0.08)",
                },
              ]}
            >
              <TextInput
                style={[styles.input, { color: theme.text }]}
                placeholder="Password"
                placeholderTextColor={theme.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                testID="input-password"
              />
            </View>

            {isSignUp ? (
              <View
                style={[
                  styles.inputContainer,
                  {
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.04)",
                    borderColor: isDark
                      ? "rgba(255,255,255,0.1)"
                      : "rgba(0,0,0,0.08)",
                  },
                ]}
              >
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Confirm password"
                  placeholderTextColor={theme.textMuted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  testID="input-confirm-password"
                />
              </View>
            ) : null}

            {error ? (
              <Text style={styles.errorText} testID="text-error">
                {error}
              </Text>
            ) : null}

            <Pressable
              onPress={handleSubmit}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.submitButton,
                {
                  backgroundColor: theme.orbPrimary,
                  opacity: pressed ? 0.9 : isLoading ? 0.7 : 1,
                },
              ]}
              testID="button-submit"
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {isSignUp ? "Create Account" : "Sign In"}
                </Text>
              )}
            </Pressable>

            <Pressable onPress={toggleMode} style={styles.toggleButton} testID="button-toggle-mode">
              <Text style={[styles.toggleText, { color: theme.textMuted }]}>
                {isSignUp
                  ? "Already have an account? "
                  : "Don't have an account? "}
                <Text style={{ color: theme.link }}>
                  {isSignUp ? "Sign In" : "Sign Up"}
                </Text>
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing["2xl"],
    justifyContent: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing["4xl"],
  },
  title: {
    fontSize: 32,
    fontWeight: "200",
    fontFamily: FontFamily.light,
    letterSpacing: 6,
    textTransform: "uppercase",
    marginBottom: Spacing.md,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.5,
  },
  formContainer: {
    width: "100%",
    maxWidth: 360,
    alignSelf: "center",
    gap: Spacing.lg,
  },
  inputContainer: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  input: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
  },
  errorText: {
    color: "#D32F2F",
    fontSize: 14,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  submitButton: {
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    fontFamily: FontFamily.bold,
    letterSpacing: 0.5,
  },
  toggleButton: {
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  toggleText: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
    letterSpacing: 0.2,
  },
});
