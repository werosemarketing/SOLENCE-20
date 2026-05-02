import React from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";

type Props = {
  onDismiss: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const CALL_NUMBER = "988";
const TEXT_NUMBER = "741741";
const TEXT_KEYWORD = "HELLO";

// Open a tel:/sms: link, falling back gracefully on web (where some browsers
// won't follow these schemes from a Pressable without user-gesture context).
async function openLink(url: string): Promise<void> {
  try {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(url, "_self");
      return;
    }
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      // Last-ditch attempt — some platforms report unsupported even when
      // the OS will actually handle the scheme.
      await Linking.openURL(url);
    }
  } catch (err) {
    console.log(
      "CrisisBanner: failed to open link",
      url,
      err instanceof Error ? err.message : err,
    );
  }
}

function buildSmsUrl(): string {
  // iOS uses `&body=`, Android uses `?body=`. Web behaves like Android.
  const separator = Platform.OS === "ios" ? "&" : "?";
  return `sms:${TEXT_NUMBER}${separator}body=${TEXT_KEYWORD}`;
}

export function CrisisBanner({ onDismiss, style, testID }: Props) {
  const { theme, isDark } = useTheme();

  // Warm, supportive tones — derived from the orb accent so it feels part
  // of Solence rather than an alarm. Slightly stronger contrast in dark
  // mode so the banner doesn't disappear against the deep background.
  const backgroundColor = isDark
    ? "rgba(214, 107, 50, 0.16)"
    : "rgba(214, 107, 50, 0.10)";
  const borderColor = isDark
    ? "rgba(214, 107, 50, 0.45)"
    : "rgba(214, 107, 50, 0.30)";

  return (
    <View
      accessibilityRole="alert"
      style={[styles.container, { backgroundColor, borderColor }, style]}
      testID={testID ?? "crisis-banner"}
    >
      <View style={styles.row}>
        <Feather
          name="heart"
          size={16}
          color={theme.orbPrimary}
          style={styles.icon}
        />
        <View style={styles.content}>
          <Text
            style={[styles.message, { color: theme.text }]}
            testID="crisis-banner-message"
          >
            You don&rsquo;t have to be alone in this. Solence isn&rsquo;t a
            crisis service, but these lines are free, confidential, and
            available 24/7.
          </Text>

          <Pressable
            onPress={() => openLink(`tel:${CALL_NUMBER}`)}
            accessibilityRole="link"
            accessibilityLabel="Call 988 Suicide and Crisis Lifeline"
            testID="crisis-banner-call-988"
            style={({ pressed }) => [
              styles.actionRow,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Feather name="phone" size={14} color={theme.orbPrimary} />
            <Text style={[styles.actionText, { color: theme.orbPrimary }]}>
              Call or text 988 — Suicide &amp; Crisis Lifeline
            </Text>
          </Pressable>

          <Pressable
            onPress={() => openLink(buildSmsUrl())}
            accessibilityRole="link"
            accessibilityLabel="Text HELLO to 741741, Crisis Text Line"
            testID="crisis-banner-text-741741"
            style={({ pressed }) => [
              styles.actionRow,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Feather
              name="message-square"
              size={14}
              color={theme.orbPrimary}
            />
            <Text style={[styles.actionText, { color: theme.orbPrimary }]}>
              Text HELLO to 741741 — Crisis Text Line
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss crisis support banner"
          testID="crisis-banner-dismiss"
          style={({ pressed }) => [
            styles.dismiss,
            { opacity: pressed ? 0.5 : 1 },
          ]}
        >
          <Feather name="x" size={16} color={theme.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  icon: {
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    marginBottom: Spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: 4,
  },
  actionText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FontFamily.medium,
    textDecorationLine: "underline",
  },
  dismiss: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
});
