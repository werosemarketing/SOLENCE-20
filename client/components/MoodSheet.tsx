import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  fontForWeight,
} from "@/constants/theme";

// 1-5 scale used everywhere in the mood feature. The labels are the
// same five words shown to the user; we keep them here so the screens
// don't drift apart over time.
export const MOOD_OPTIONS: { score: number; label: string }[] = [
  { score: 1, label: "rough" },
  { score: 2, label: "low" },
  { score: 3, label: "okay" },
  { score: 4, label: "good" },
  { score: 5, label: "great" },
];

export function moodLabelForScore(score: number): string | null {
  return MOOD_OPTIONS.find((o) => o.score === score)?.label ?? null;
}

interface MoodSheetProps {
  visible: boolean;
  variant: "pre" | "post";
  submitting?: boolean;
  onSelect: (score: number, label: string) => void;
  onSkip: () => void;
}

export function MoodSheet({
  visible,
  variant,
  submitting = false,
  onSelect,
  onSkip,
}: MoodSheetProps) {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation();
  const [pending, setPending] = useState<number | null>(null);

  const title =
    variant === "pre" ? t("mood.preTitle") : t("mood.postTitle");
  const subtitle =
    variant === "pre" ? t("mood.preSubtitle") : t("mood.postSubtitle");

  const handlePress = (score: number, label: string) => {
    if (submitting) return;
    setPending(score);
    onSelect(score, label);
  };

  const handleSkip = () => {
    if (submitting) return;
    setPending(null);
    onSkip();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={submitting ? undefined : handleSkip}
    >
      <View style={styles.backdrop} testID={`mood-sheet-${variant}`}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={submitting ? undefined : handleSkip}
          accessibilityLabel={t("mood.dismissA11y")}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <ThemedText type="h4" style={styles.title}>
            {title}
          </ThemedText>
          <ThemedText
            type="small"
            style={[styles.subtitle, { color: theme.textMuted }]}
          >
            {subtitle}
          </ThemedText>

          <View style={styles.row}>
            {MOOD_OPTIONS.map((opt) => {
              const isPending = pending === opt.score && submitting;
              const localizedLabel = t(`mood.options.${opt.score}`);
              return (
                <Pressable
                  key={opt.score}
                  onPress={() => handlePress(opt.score, opt.label)}
                  disabled={submitting}
                  style={({ pressed }) => [
                    styles.dot,
                    {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(0,0,0,0.04)",
                      borderColor: isPending
                        ? theme.orbPrimary
                        : "transparent",
                      opacity: pressed ? 0.7 : submitting ? 0.6 : 1,
                    },
                  ]}
                  testID={`mood-option-${variant}-${opt.score}`}
                  accessibilityRole="button"
                  accessibilityLabel={t("mood.scoreA11y", {
                    label: localizedLabel,
                    score: opt.score,
                  })}
                >
                  {isPending ? (
                    <ActivityIndicator size="small" color={theme.orbPrimary} />
                  ) : (
                    <Text style={[styles.dotScore, { color: theme.text }]}>
                      {opt.score}
                    </Text>
                  )}
                  <Text style={[styles.dotLabel, { color: theme.textMuted }]}>
                    {localizedLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={handleSkip}
            disabled={submitting}
            style={({ pressed }) => [
              styles.skip,
              { opacity: pressed ? 0.6 : submitting ? 0.5 : 1 },
            ]}
            testID={`mood-skip-${variant}`}
            accessibilityRole="button"
          >
            <Text style={[styles.skipText, { color: theme.textMuted }]}>
              {t("mood.skip")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  subtitle: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  dot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    paddingVertical: Spacing.sm,
  },
  dotScore: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
    fontSize: 18,
    lineHeight: 22,
  },
  dotLabel: {
    ...Typography.small,
    fontSize: 11,
    marginTop: 2,
    textTransform: "lowercase",
  },
  skip: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  skipText: {
    ...Typography.small,
    fontFamily: fontForWeight("500"),
  },
});
