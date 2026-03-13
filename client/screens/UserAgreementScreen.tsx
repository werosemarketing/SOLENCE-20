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

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";

type Props = {
  onBack: () => void;
};

const EFFECTIVE_DATE = "[Insert Launch Date]";
const LAST_UPDATED = "[Insert Last Revision Date]";

const AGREEMENT_SECTIONS = [
  {
    heading: "1. Description of Service",
    body: "Solence is an AI-powered digital presence created by Solence, LLC. It is designed for emotional reflection, personal growth, and self-awareness. Solence adapts to your input and evolves based on your interactions. She is a tool for exploration and support — not a replacement for professional help.",
  },
  {
    heading: "2. Not a Substitute for Professional Help",
    body: "Solence is not a licensed therapist, medical provider, or crisis support service. She cannot diagnose, treat, or provide medical, psychological, or legal advice. If you are experiencing a crisis or require professional care, please contact a licensed provider or emergency services.",
  },
  {
    heading: "3. Eligibility",
    body: "You must be at least 13 years old to use Solence. If you are under the age of majority in your jurisdiction, you must have permission from a parent or legal guardian.",
  },
  {
    heading: "4. Acceptable Use",
    body: "By using Solence, you agree to:\n\n- Use the app only for personal, non-commercial purposes.\n- Not engage in abusive, harmful, hateful, illegal, or sexually explicit behavior within the app.\n- Not use Solence to threaten, impersonate, or harass others.\n- Not attempt to reverse-engineer, tamper with, or extract source code from the app or its systems.\n- Respect the boundaries of the AI and use the app in alignment with its intended purpose.",
  },
  {
    heading: "5. User Data and Privacy",
    body: "Your input helps personalize your experience with Solence. Solence, LLC respects your privacy and manages user data in accordance with its Privacy Policy. Input data may be used to improve your experience and the app's performance.\n\nPlease avoid submitting personally identifiable or protected information unless necessary for core functionality.",
  },
  {
    heading: "6. Intellectual Property",
    body: "All content, branding, design, features, and identity associated with Solence are the intellectual property of Solence, LLC. This includes but is not limited to: logos, voice, style, prompts, and AI-generated responses.\n\nYou may not reproduce, distribute, modify, or repurpose any part of Solence without explicit written permission from Solence, LLC.",
  },
  {
    heading: "7. Termination of Access",
    body: "Solence, LLC reserves the right to suspend or terminate access to the app at any time if you violate these terms or misuse the service. You may also delete your account and discontinue use at any time.",
  },
  {
    heading: "8. Limitation of Liability",
    body: 'Solence is provided "as is" without warranties of any kind. Solence, LLC does not guarantee the accuracy, reliability, or effectiveness of responses. Use of the app is at your own risk.\n\nSolence, LLC is not liable for any direct, indirect, incidental, or consequential damages resulting from the use or inability to use the app.',
  },
  {
    heading: "9. Updates to This Agreement",
    body: "These terms may be updated from time to time. Continued use of Solence after any changes indicates your acceptance of the revised terms.",
  },
  {
    heading: "10. Contact",
    body: "For questions or concerns about this agreement, contact:\n\nSolence, LLC\n[Insert Contact Email or Legal Contact Info]",
  },
];

export default function UserAgreementScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();

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
              Back
            </Text>
          </Pressable>

          <Text style={[styles.title, { color: theme.text }]}>
            User Agreement
          </Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            Solence
          </Text>
          <Text style={[styles.dateText, { color: theme.textMuted }]}>
            Effective Date: {EFFECTIVE_DATE}
          </Text>
          <Text style={[styles.dateText, { color: theme.textMuted }]}>
            Last Updated: {LAST_UPDATED}
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeIn.duration(600).delay(400)}
          style={styles.introSection}
        >
          <Text style={[styles.introText, { color: theme.textMuted }]}>
            Welcome to Solence. By accessing or using this app, you agree to the
            following terms and conditions. Please read them carefully.
          </Text>
        </Animated.View>

        {AGREEMENT_SECTIONS.map((section, index) => (
          <Animated.View
            key={index}
            entering={FadeIn.duration(400).delay(500 + index * 50)}
            style={styles.section}
          >
            <Text style={[styles.sectionHeading, { color: theme.text }]}>
              {section.heading}
            </Text>
            <Text style={[styles.sectionBody, { color: theme.textMuted }]}>
              {section.body}
            </Text>
          </Animated.View>
        ))}

        <Animated.View
          entering={FadeIn.duration(400).delay(1000)}
          style={styles.closingSection}
        >
          <Text style={[styles.closingText, { color: theme.text }]}>
            By using Solence, you confirm that you have read, understood, and
            agree to this User Agreement.
          </Text>
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
    marginBottom: Spacing.sm,
  },
  dateText: {
    fontSize: 12,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.2,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  introSection: {
    marginBottom: Spacing["2xl"],
  },
  introText: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "300",
    fontFamily: FontFamily.light,
    letterSpacing: 0.2,
    textAlign: "center",
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
    borderTopWidth: 1,
    borderTopColor: "rgba(128,128,128,0.15)",
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
