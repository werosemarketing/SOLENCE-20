import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Upgrade">;

const PRICE_LABEL = "$15.99 / month";

const UNLIMITED_BENEFITS: Array<{ icon: keyof typeof Feather.glyphMap; title: string; body: string }> = [
  {
    icon: "message-circle",
    title: "Unlimited conversations",
    body: "Talk to Solence whenever you need to — no daily ceiling, no waiting for a reset.",
  },
  {
    icon: "moon",
    title: "Solence never has to rest",
    body: "Late-night spirals, early-morning unease — Solence stays available through every hour.",
  },
  {
    icon: "heart",
    title: "Support what you're building",
    body: "Your subscription keeps Solence running for you and helps it keep getting better.",
  },
];

export default function UpgradeScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

  const tokenLimit = route.params?.tokenLimit ?? 15000;
  const resetLabel = route.params?.resetLabel ?? "tomorrow";

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) {
      const k = tokens / 1000;
      return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
    }
    return `${tokens}`;
  };

  const gradientColors = isDark
    ? (["#0f0c14", "#1a1625", "#1f1a2e", "#1a1625", "#0f0c14"] as const)
    : (["#F5EBDD", "#FAF1E7", "#FDF6F0", "#FAF1E7", "#F5EBDD"] as const);

  const handleSubscribe = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Subscription purchase flow is not wired up yet — close the screen so
    // the user returns to the conversation. When billing is added the call
    // here will trigger the in-app purchase instead.
    navigation.goBack();
  };

  const handleClose = () => {
    Haptics.selectionAsync();
    navigation.goBack();
  };

  const cardBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  const cardBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
  const featuredBorder = theme.orbPrimary;
  const featuredBg = isDark ? "rgba(214, 107, 50, 0.12)" : "rgba(214, 107, 50, 0.08)";

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={gradientColors}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <View
        style={[
          styles.closeButtonContainer,
          { top: insets.top + Spacing.sm, right: Spacing.lg },
        ]}
      >
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [
            styles.closeButton,
            {
              backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          accessibilityLabel="Close upgrade screen"
          accessibilityRole="button"
          testID="upgrade-close-button"
        >
          <Feather name="x" size={20} color={theme.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + Spacing["3xl"] + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(700)} style={styles.headerBlock}>
          <Text style={[styles.eyebrow, { color: theme.orbPrimary }]} testID="upgrade-eyebrow">
            Solence Unlimited
          </Text>
          <Text style={[styles.headline, { color: theme.text }]} testID="upgrade-headline">
            Stay in conversation,{"\n"}as long as you need.
          </Text>
          <Text style={[styles.subhead, { color: theme.textMuted }]} testID="upgrade-subhead">
            On the free plan, Solence rests once you reach the daily limit.
            Upgrade and the conversation never has to pause.
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeIn.duration(600).delay(150)}
          style={[
            styles.planCard,
            { backgroundColor: cardBg, borderColor: cardBorder },
          ]}
          testID="plan-card-free"
        >
          <View style={styles.planHeaderRow}>
            <View style={styles.planTitleBlock}>
              <Text style={[styles.planLabel, { color: theme.textMuted }]}>
                Free plan
              </Text>
              <Text style={[styles.planName, { color: theme.text }]}>
                Where you are now
              </Text>
            </View>
            <Text style={[styles.planPriceMuted, { color: theme.textMuted }]}>
              $0
            </Text>
          </View>

          <View style={styles.planDivider} />

          <View style={styles.benefitRow}>
            <Feather name="clock" size={18} color={theme.textMuted} style={styles.benefitIcon} />
            <View style={styles.benefitTextBlock}>
              <Text style={[styles.benefitTitle, { color: theme.text }]} testID="free-cap-text">
                {formatTokens(tokenLimit)} tokens per day
              </Text>
              <Text style={[styles.benefitBody, { color: theme.textMuted }]}>
                Roughly enough for a focused conversation each day.
              </Text>
            </View>
          </View>

          <View style={styles.benefitRow}>
            <Feather name="pause-circle" size={18} color={theme.textMuted} style={styles.benefitIcon} />
            <View style={styles.benefitTextBlock}>
              <Text style={[styles.benefitTitle, { color: theme.text }]} testID="free-rest-text">
                Solence rests when the cap is reached
              </Text>
              <Text style={[styles.benefitBody, { color: theme.textMuted }]}>
                Comes back {resetLabel}.
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          entering={FadeIn.duration(600).delay(300)}
          style={[
            styles.planCard,
            styles.planCardFeatured,
            { backgroundColor: featuredBg, borderColor: featuredBorder },
          ]}
          testID="plan-card-unlimited"
        >
          <View style={styles.recommendedPill}>
            <Text style={styles.recommendedPillText}>Recommended</Text>
          </View>

          <View style={styles.planHeaderRow}>
            <View style={styles.planTitleBlock}>
              <Text style={[styles.planLabel, { color: theme.orbPrimary }]}>
                Unlimited
              </Text>
              <Text style={[styles.planName, { color: theme.text }]}>
                Solence, always available
              </Text>
            </View>
            <View style={styles.planPriceBlock}>
              <Text style={[styles.planPrice, { color: theme.text }]} testID="unlimited-price">
                $15.99
              </Text>
              <Text style={[styles.planPricePer, { color: theme.textMuted }]}>
                per month
              </Text>
            </View>
          </View>

          <View style={styles.planDivider} />

          {UNLIMITED_BENEFITS.map((benefit, index) => (
            <View key={benefit.title} style={styles.benefitRow} testID={`unlimited-benefit-${index}`}>
              <Feather
                name={benefit.icon}
                size={18}
                color={theme.orbPrimary}
                style={styles.benefitIcon}
              />
              <View style={styles.benefitTextBlock}>
                <Text style={[styles.benefitTitle, { color: theme.text }]}>
                  {benefit.title}
                </Text>
                <Text style={[styles.benefitBody, { color: theme.textMuted }]}>
                  {benefit.body}
                </Text>
              </View>
            </View>
          ))}
        </Animated.View>

        <Text style={[styles.fineprint, { color: theme.textMuted }]}>
          Cancel anytime. Your subscription supports the work behind Solence.
        </Text>
      </ScrollView>

      <View
        style={[
          styles.ctaContainer,
          {
            paddingBottom: insets.bottom + Spacing.lg,
            backgroundColor: isDark
              ? "rgba(15, 12, 20, 0.92)"
              : "rgba(250, 241, 231, 0.92)",
            borderTopColor: isDark
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.06)",
          },
        ]}
      >
        <Pressable
          onPress={handleSubscribe}
          style={({ pressed }) => [
            styles.ctaButton,
            { backgroundColor: theme.orbPrimary, opacity: pressed ? 0.9 : 1 },
          ]}
          accessibilityLabel={`Upgrade to Solence Unlimited for ${PRICE_LABEL}`}
          accessibilityRole="button"
          testID="upgrade-subscribe-button"
        >
          <Text style={styles.ctaButtonText}>
            Upgrade — {PRICE_LABEL}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [
            styles.maybeLaterButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
          testID="upgrade-maybe-later-button"
        >
          <Text style={[styles.maybeLaterText, { color: theme.textMuted }]}>
            Maybe later
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  closeButtonContainer: {
    position: "absolute",
    zIndex: 10,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBlock: {
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  eyebrow: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  headline: {
    fontSize: 28,
    lineHeight: 36,
    fontFamily: FontFamily.light,
    fontWeight: "300",
    letterSpacing: 0.3,
    textAlign: "center",
  },
  subhead: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
    textAlign: "center",
    paddingHorizontal: Spacing.md,
  },
  planCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  planCardFeatured: {
    borderWidth: 1.5,
    paddingTop: Spacing["2xl"],
  },
  recommendedPill: {
    position: "absolute",
    top: -12,
    alignSelf: "center",
    backgroundColor: "#D66B32",
    paddingVertical: 4,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  recommendedPillText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: FontFamily.medium,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  planHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  planTitleBlock: {
    flex: 1,
    gap: 2,
  },
  planLabel: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  planName: {
    fontSize: 18,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
    letterSpacing: 0.2,
  },
  planPriceBlock: {
    alignItems: "flex-end",
  },
  planPrice: {
    fontSize: 22,
    fontFamily: FontFamily.bold,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  planPricePer: {
    fontSize: 11,
    fontFamily: FontFamily.regular,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  planPriceMuted: {
    fontSize: 18,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
  },
  planDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(127,127,127,0.25)",
    marginVertical: Spacing.xs,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  benefitIcon: {
    marginTop: 2,
    width: 22,
  },
  benefitTextBlock: {
    flex: 1,
    gap: 2,
  },
  benefitTitle: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  benefitBody: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FontFamily.regular,
    fontWeight: "400",
  },
  fineprint: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
    lineHeight: 18,
    marginTop: Spacing.xs,
  },
  ctaContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  ctaButton: {
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaButtonText: {
    color: "#fff",
    fontSize: 17,
    fontFamily: FontFamily.bold,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  maybeLaterButton: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  maybeLaterText: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
    letterSpacing: 0.3,
  },
});
