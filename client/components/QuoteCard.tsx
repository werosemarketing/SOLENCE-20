import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  fontForWeight,
} from "@/constants/theme";

export const QUOTE_CARD_MAX_LENGTH = 280;
export const QUOTE_CARD_WIDTH = 320;
export const QUOTE_CARD_HEIGHT = 480;

type QuoteCardProps = {
  quote: string;
  testID?: string;
};

function fontSizeForLength(length: number): {
  fontSize: number;
  lineHeight: number;
} {
  if (length <= 80) return { fontSize: 30, lineHeight: 40 };
  if (length <= 140) return { fontSize: 26, lineHeight: 36 };
  if (length <= 200) return { fontSize: 22, lineHeight: 30 };
  return { fontSize: 19, lineHeight: 26 };
}

export function QuoteCard({ quote, testID }: QuoteCardProps) {
  const { theme } = useTheme();
  const { fontSize, lineHeight } = fontSizeForLength(quote.length);

  const trimmed = quote.replace(/\s+/g, " ").trim();

  return (
    <View
      testID={testID}
      style={[
        styles.cardWrapper,
        {
          backgroundColor: theme.backgroundRoot,
        },
      ]}
    >
      <LinearGradient
        colors={[theme.backgroundDefault, theme.backgroundRoot]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardBackground}
      >
        <View
          style={[
            styles.orbGlow,
            { backgroundColor: theme.orbGlow },
          ]}
        />
        <View
          style={[
            styles.orbCore,
            { backgroundColor: theme.orbPrimary },
          ]}
        />

        <View style={styles.quoteBlock}>
          <Text
            style={[
              styles.quoteMark,
              { color: theme.orbPrimary },
            ]}
          >
            &ldquo;
          </Text>
          <Text
            style={[
              styles.quoteText,
              {
                color: theme.text,
                fontSize,
                lineHeight,
              },
            ]}
            testID={testID ? `${testID}-text` : undefined}
          >
            {trimmed}
          </Text>
        </View>

        <View style={styles.attribution}>
          <View
            style={[
              styles.attributionDot,
              { backgroundColor: theme.orbPrimary },
            ]}
          />
          <Text
            style={[
              styles.attributionWordmark,
              { color: theme.text },
            ]}
          >
            Solence
          </Text>
          <Text
            style={[
              styles.attributionUrl,
              { color: theme.textMuted },
            ]}
          >
            solence.ai
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    width: QUOTE_CARD_WIDTH,
    height: QUOTE_CARD_HEIGHT,
    borderRadius: BorderRadius["2xl"],
    overflow: "hidden",
  },
  cardBackground: {
    flex: 1,
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing["3xl"],
    justifyContent: "space-between",
  },
  orbGlow: {
    position: "absolute",
    top: -60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    opacity: 0.55,
  },
  orbCore: {
    position: "absolute",
    top: 28,
    right: 28,
    width: 36,
    height: 36,
    borderRadius: 18,
    opacity: 0.85,
  },
  quoteBlock: {
    flex: 1,
    justifyContent: "center",
    paddingTop: Spacing["2xl"],
  },
  quoteMark: {
    fontFamily: FontFamily.bold,
    fontSize: 64,
    lineHeight: 64,
    marginBottom: -Spacing.md,
    opacity: 0.85,
  },
  quoteText: {
    fontFamily: fontForWeight("400"),
    letterSpacing: 0.2,
  },
  attribution: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingTop: Spacing.lg,
  },
  attributionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  attributionWordmark: {
    fontFamily: fontForWeight("600"),
    fontSize: 14,
    letterSpacing: 0.6,
  },
  attributionUrl: {
    fontFamily: fontForWeight("400"),
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
