import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const STORAGE_KEY_DISCLAIMER = "solence_disclaimer_accepted";

type Props = {
  onAccept: () => void;
};

export default function DisclaimerScreen({ onAccept }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  const handleAccept = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await AsyncStorage.setItem(STORAGE_KEY_DISCLAIMER, "true");
    onAccept();
  };

  const gradientColors = isDark
    ? (["#0f0c14", "#1a1625", "#1f1a2e", "#1a1625", "#0f0c14"] as const)
    : (["#f8f5f0", "#faf8f5", "#fcfaf7", "#faf8f5", "#f8f5f0"] as const);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={gradientColors}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Spacing["4xl"],
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(800).delay(200)}>
          <Text style={[styles.title, { color: theme.text }]}>
            Before we begin
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeIn.duration(600).delay(500)}
          style={styles.disclaimerCard}
        >
          <View
            style={[
              styles.cardInner,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(0,0,0,0.03)",
              },
            ]}
          >
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              What Solence is
            </Text>
            <Text style={[styles.cardBody, { color: theme.textMuted }]}>
              Solence is an AI-generated presence designed for personal
              reflection, emotional processing, and mindful conversation. She is
              a companion for your inner world.
            </Text>

            <View style={styles.divider} />

            <Text style={[styles.cardTitle, { color: theme.text }]}>
              What Solence is not
            </Text>
            <Text style={[styles.cardBody, { color: theme.textMuted }]}>
              Solence is not human, not sentient, and not a licensed
              professional. She does not provide medical, legal, or therapeutic
              advice and is not a crisis support tool.
            </Text>

            <View style={styles.divider} />

            <Text style={[styles.cardTitle, { color: theme.text }]}>
              If you need support
            </Text>
            <Text style={[styles.cardBody, { color: theme.textMuted }]}>
              If you are in crisis or need immediate help, please contact
              emergency services or a licensed mental health provider.
            </Text>
            <Text style={[styles.resourceText, { color: theme.link }]}>
              988 Suicide & Crisis Lifeline{"\n"}Call or text 988
            </Text>
          </View>
        </Animated.View>

        <Animated.View
          entering={FadeIn.duration(600).delay(800)}
          style={styles.footerSection}
        >
          <Text style={[styles.agreementText, { color: theme.textMuted }]}>
            By continuing, you acknowledge that Solence is intended for personal
            reflection only and is not a substitute for professional care.
          </Text>

          <Pressable
            onPress={handleAccept}
            style={({ pressed }) => [
              styles.acceptButton,
              {
                backgroundColor: theme.orbPrimary,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
            testID="accept-disclaimer-button"
          >
            <Text style={styles.acceptButtonText}>I Understand</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing["2xl"],
    flexGrow: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "200",
    letterSpacing: 4,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: Spacing["3xl"],
  },
  disclaimerCard: {
    marginBottom: Spacing["2xl"],
  },
  cardInner: {
    borderRadius: BorderRadius.lg,
    padding: Spacing["2xl"],
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "500",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "300",
    letterSpacing: 0.2,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(128,128,128,0.15)",
    marginVertical: Spacing.xl,
  },
  resourceText: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "500",
    marginTop: Spacing.md,
    letterSpacing: 0.3,
  },
  footerSection: {
    marginTop: "auto",
    alignItems: "center",
    paddingTop: Spacing.xl,
  },
  agreementText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    fontWeight: "300",
    letterSpacing: 0.2,
    marginBottom: Spacing["2xl"],
    paddingHorizontal: Spacing.lg,
  },
  acceptButton: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["4xl"],
    borderRadius: BorderRadius.full,
    width: "100%",
    maxWidth: 300,
    alignItems: "center",
  },
  acceptButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
