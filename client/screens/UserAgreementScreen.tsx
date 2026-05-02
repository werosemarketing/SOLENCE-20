import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily } from "@/constants/theme";

type Props = {
  onBack: () => void;
};

const SECTION_KEYS = [
  "intro",
  "eligibility",
  "notMedical",
  "privacy",
  "aiLimits",
  "acceptableUse",
  "noWarranty",
  "liability",
  "changes",
  "contact",
] as const;

export default function UserAgreementScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { t } = useTranslation();

  const gradientColors = isDark
    ? (["#0f0c14", "#1a1625", "#1f1a2e", "#1a1625", "#0f0c14"] as const)
    : (["#F5EBDD", "#FAF1E7", "#FDF6F0", "#FAF1E7", "#F5EBDD"] as const);

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
            paddingTop: insets.top + Spacing["3xl"],
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={true}
      >
        <Animated.View entering={FadeInDown.duration(800).delay(200)}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onBack();
            }}
            style={({ pressed }) => [
              styles.backButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            testID="agreement-back-button"
          >
            <Text style={[styles.backText, { color: theme.link }]}>
              {t("common.back")}
            </Text>
          </Pressable>

          <Text style={[styles.title, { color: theme.text }]}>
            {t("agreement.title")}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            {t("headerTitle.appName")}
          </Text>
        </Animated.View>

        {SECTION_KEYS.map((key, index) => (
          <Animated.View
            key={key}
            entering={FadeIn.duration(400).delay(500 + index * 50)}
            style={styles.section}
          >
            <Text style={[styles.sectionHeading, { color: theme.text }]}>
              {t(`agreement.sections.${key}.heading`)}
            </Text>
            <Text style={[styles.sectionBody, { color: theme.textMuted }]}>
              {t(`agreement.sections.${key}.body`)}
            </Text>
          </Animated.View>
        ))}
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
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: Spacing.sm,
    paddingRight: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  backText: {
    fontSize: 16,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 24,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: "500",
    fontFamily: FontFamily.medium,
    letterSpacing: 0.3,
    marginBottom: Spacing.sm,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.2,
  },
  closingSection: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.3)",
  },
  closingText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.2,
    textAlign: "center",
  },
});
