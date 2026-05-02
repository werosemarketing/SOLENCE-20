import React, { useState } from "react";
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";

const STORAGE_KEY_DISCLAIMER = "solence_disclaimer_accepted";

type Props = {
  onAccept: () => void;
  onViewAgreement: () => void;
};

export default function DisclaimerScreen({ onAccept, onViewAgreement }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);

  const handleAccept = async () => {
    if (!agreed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await AsyncStorage.setItem(STORAGE_KEY_DISCLAIMER, "true");
    onAccept();
  };

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
            paddingTop: insets.top + Spacing["4xl"],
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(800).delay(200)}>
          <Text style={[styles.title, { color: theme.text }]}>
            {t("disclaimer.headline")}
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
            <Text style={[styles.cardBody, { color: theme.textMuted }]}>
              {t("disclaimer.intro")}
            </Text>

            <View style={styles.spacer} />

            <Text style={[styles.cardSubheading, { color: theme.text }]}>
              {t("disclaimer.notHumanTitle")}
            </Text>
            <Text style={[styles.cardBody, { color: theme.textMuted }]}>
              {t("disclaimer.notHumanBody")}
            </Text>

            <View style={styles.spacer} />

            <Text style={[styles.cardSubheading, { color: theme.text }]}>
              {t("disclaimer.notTherapyTitle")}
            </Text>
            <Text style={[styles.cardBody, { color: theme.textMuted }]}>
              {t("disclaimer.notTherapyBody")}
            </Text>

            <View style={styles.spacer} />

            <Text style={[styles.cardSubheading, { color: theme.text }]}>
              {t("disclaimer.crisisTitle")}
            </Text>
            <Text style={[styles.cardBody, { color: theme.textMuted }]}>
              {t("disclaimer.crisisBody")}
              {"\n\n"}
              {t("disclaimer.crisisLifeline")}
              {"\n"}
              {t("disclaimer.crisisText")}
              {"\n"}
              {t("disclaimer.crisisEmergency")}
            </Text>
          </View>
        </Animated.View>

        <Animated.View
          entering={FadeIn.duration(600).delay(800)}
          style={styles.footerSection}
        >
          <Pressable
            onPress={() => setAgreed(!agreed)}
            style={styles.checkboxRow}
            testID="agree-checkbox"
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: isDark
                    ? "rgba(255,255,255,0.3)"
                    : "rgba(0,0,0,0.2)",
                  backgroundColor: agreed
                    ? theme.orbPrimary
                    : "transparent",
                },
              ]}
            >
              {agreed ? (
                <Text style={styles.checkmark}>{"✓"}</Text>
              ) : null}
            </View>
            <Text style={[styles.checkboxLabel, { color: theme.text }]}>
              {t("disclaimer.agreeButton")}
            </Text>
          </Pressable>

          <Pressable
            onPress={onViewAgreement}
            style={({ pressed }) => [
              styles.agreementLink,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            testID="view-agreement-button"
          >
            <Text style={[styles.agreementLinkText, { color: theme.link }]}>
              {t("disclaimer.viewAgreement")}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleAccept}
            style={({ pressed }) => [
              styles.acceptButton,
              {
                backgroundColor: agreed
                  ? theme.orbPrimary
                  : isDark
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(0,0,0,0.08)",
                opacity: pressed && agreed ? 0.9 : 1,
              },
            ]}
            disabled={!agreed}
            testID="accept-disclaimer-button"
          >
            <Text
              style={[
                styles.acceptButtonText,
                {
                  color: agreed
                    ? "#fff"
                    : isDark
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(0,0,0,0.25)",
                },
              ]}
            >
              {t("common.confirm")}
            </Text>
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
    fontFamily: FontFamily.light,
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
  cardSubheading: {
    fontSize: 15,
    fontWeight: "500",
    fontFamily: FontFamily.medium,
    letterSpacing: 0.3,
    marginBottom: Spacing.xs,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.2,
  },
  spacer: {
    height: Spacing.lg,
  },
  footerSection: {
    marginTop: "auto",
    alignItems: "center",
    paddingTop: Spacing.xl,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  checkmark: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700" as const,
    fontFamily: FontFamily.bold,
  },
  checkboxLabel: {
    fontSize: 16,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.3,
    flex: 1,
  },
  agreementLink: {
    marginBottom: Spacing["2xl"],
    paddingVertical: Spacing.sm,
  },
  agreementLinkText: {
    fontSize: 14,
    fontWeight: "400",
    fontFamily: FontFamily.regular,
    letterSpacing: 0.3,
    textDecorationLine: "underline",
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
    fontSize: 17,
    fontWeight: "600",
    fontFamily: FontFamily.bold,
    letterSpacing: 0.5,
  },
});
