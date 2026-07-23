import React, { useEffect, useState } from "react";
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
import * as AppleAuthentication from "expo-apple-authentication";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";

type Props = {
  onAuthenticated: (token: string, userId?: string) => void;
  // Optional referral code captured from a deep link
  // (`solence://signup?ref=CODE`). When present, we drop the user into
  // sign-up mode with the code prefilled so they don't have to retype
  // it.
  initialReferralCode?: string | null;
};

export default function AuthScreen({
  onAuthenticated,
  initialReferralCode,
}: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { t } = useTranslation();

  // If a deep-link delivered a referral code, default to sign-up so the
  // user actually sees / can edit the prefilled code.
  const hasInitialCode = Boolean(initialReferralCode && initialReferralCode.trim().length > 0);
  const [isSignUp, setIsSignUp] = useState(hasInitialCode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState(
    initialReferralCode ? initialReferralCode.trim().toLowerCase() : "",
  );
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (!cancelled) setAppleAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setAppleAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const gradientColors = isDark
    ? (["#0f0c14", "#1a1625", "#1f1a2e", "#1a1625", "#0f0c14"] as const)
    : (["#F5EBDD", "#FAF1E7", "#FDF6F0", "#FAF1E7", "#F5EBDD"] as const);

  const handleSubmit = async () => {
    setError("");
    setInfo("");

    if (!email.trim() || !password) {
      setError(t("auth.errors.missingFields"));
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError(t("auth.errors.passwordMismatch"));
      return;
    }

    if (isSignUp && password.length < 6) {
      setError(t("auth.errors.passwordTooShort"));
      return;
    }

    setIsLoading(true);
    try {
      const apiUrl = getApiUrl();
      const endpoint = isSignUp ? "/api/auth/register" : "/api/auth/login";
      // Trim/normalize the referral code on the way out so a stray
      // copy-paste with surrounding whitespace doesn't break matching.
      const trimmedReferral = referralCode.trim();
      const body: Record<string, unknown> = {
        email: email.trim(),
        password,
      };
      if (isSignUp && trimmedReferral.length > 0) {
        body.referralCode = trimmedReferral;
      }
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || t("auth.errors.generic"));
        return;
      }

      onAuthenticated(data.token, data.user?.id);
    } catch {
      setError(t("auth.errors.network"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setError("");
    setInfo("");
    setAppleLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        setError("Apple did not return an identity token. Please try again.");
        return;
      }

      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/auth/apple`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityToken: credential.identityToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Could not sign in with Apple");
        return;
      }

      if (data.linked) {
        setInfo("We linked Sign in with Apple to your existing account.");
      }

      onAuthenticated(data.token, data.user?.id);
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      // ERR_REQUEST_CANCELED is fired when the user dismisses the native
      // Apple sheet. Treat that as a no-op rather than an error.
      if (code === "ERR_REQUEST_CANCELED") {
        return;
      }
      setError("Apple sign-in failed. Please try again.");
    } finally {
      setAppleLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setError("");
    setInfo("");
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
              {t("auth.appName")}
            </Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              {isSignUp ? t("auth.createAccount") : t("auth.welcomeBack")}
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            style={styles.formContainer}
          >
            {appleAvailable ? (
              <View style={styles.appleSection}>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={
                    isSignUp
                      ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                      : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                  }
                  buttonStyle={
                    isDark
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={BorderRadius.full}
                  style={styles.appleButton}
                  onPress={handleAppleSignIn}
                />
                {appleLoading ? (
                  <View
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFillObject,
                      styles.appleLoadingOverlay,
                    ]}
                  >
                    <ActivityIndicator color={isDark ? "#000" : "#fff"} />
                  </View>
                ) : null}

                <View style={styles.dividerRow}>
                  <View
                    style={[
                      styles.dividerLine,
                      {
                        backgroundColor: isDark
                          ? "rgba(255,255,255,0.12)"
                          : "rgba(0,0,0,0.1)",
                      },
                    ]}
                  />
                  <Text
                    style={[styles.dividerText, { color: theme.textMuted }]}
                  >
                    or
                  </Text>
                  <View
                    style={[
                      styles.dividerLine,
                      {
                        backgroundColor: isDark
                          ? "rgba(255,255,255,0.12)"
                          : "rgba(0,0,0,0.1)",
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}

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
                placeholder={t("auth.emailPlaceholder")}
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
                placeholder={t("auth.passwordPlaceholder")}
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
                  placeholder={t("auth.confirmPasswordPlaceholder")}
                  placeholderTextColor={theme.textMuted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  testID="input-confirm-password"
                />
              </View>
            ) : null}

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
                  placeholder="Referral code (optional)"
                  placeholderTextColor={theme.textMuted}
                  value={referralCode}
                  onChangeText={(value) =>
                    setReferralCode(value.toLowerCase())
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="input-referral-code"
                />
              </View>
            ) : null}

            {error ? (
              <Text style={styles.errorText} testID="text-error">
                {error}
              </Text>
            ) : null}

            {info ? (
              <Text
                style={[styles.infoText, { color: theme.textMuted }]}
                testID="text-info"
              >
                {info}
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
                  {isSignUp
                    ? t("auth.createAccountButton")
                    : t("auth.signIn")}
                </Text>
              )}
            </Pressable>

            <Pressable onPress={toggleMode} style={styles.toggleButton} testID="button-toggle-mode">
              <Text style={[styles.toggleText, { color: theme.textMuted }]}>
                {isSignUp ? t("auth.haveAccount") : t("auth.noAccount")}
                <Text style={{ color: theme.link }}>
                  {isSignUp ? t("auth.signIn") : t("auth.signUp")}
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
  appleSection: {
    gap: Spacing.lg,
  },
  appleButton: {
    width: "100%",
    height: 50,
  },
  appleLoadingOverlay: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    letterSpacing: 1,
    textTransform: "uppercase",
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
  infoText: {
    fontSize: 13,
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
