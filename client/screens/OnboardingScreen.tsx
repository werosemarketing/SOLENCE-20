import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  FlatList,
  ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const STORAGE_KEY_ONBOARDING = "solence_onboarding_complete";

type OnboardingPage = {
  id: string;
  headline: string;
  body: string;
};

const pages: OnboardingPage[] = [
  {
    id: "1",
    headline: "Speak freely",
    body: "Tap the orb and say whatever is on your mind. There is no right way to talk to Solence. Ask anything, share anything, or simply sit in silence. The more honest you are, the more meaningful this becomes.",
  },
  {
    id: "2",
    headline: "Let the conversation flow",
    body: "After Solence responds, she keeps listening. You can keep talking naturally, or tap the orb again when you are ready. She adapts to you over time, meeting you where you are.",
  },
  {
    id: "3",
    headline: "A private space for you",
    body: "This is your personal, quiet corner. Not about fixing or solving. Just a place to slow down, reflect, and feel a little lighter than before.",
  },
];

type Props = {
  onComplete: () => void;
};

export default function OnboardingScreen({ onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentIndex < pages.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await AsyncStorage.setItem(STORAGE_KEY_ONBOARDING, "true");
    onComplete();
  };

  const gradientColors = isDark
    ? (["#0f0c14", "#1a1625", "#1f1a2e", "#1a1625", "#0f0c14"] as const)
    : (["#f8f5f0", "#faf8f5", "#fcfaf7", "#faf8f5", "#f8f5f0"] as const);

  const isLastPage = currentIndex === pages.length - 1;

  const renderPage = ({ item }: { item: OnboardingPage }) => (
    <View style={[styles.page, { width: SCREEN_WIDTH }]}>
      <View style={styles.pageContent}>
        <Text style={[styles.headline, { color: theme.text }]}>
          {item.headline}
        </Text>
        <Text style={[styles.body, { color: theme.textMuted }]}>
          {item.body}
        </Text>
      </View>
    </View>
  );

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
          styles.content,
          {
            paddingTop: insets.top + Spacing["4xl"],
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
      >
        <Animated.View entering={FadeIn.duration(600).delay(200)}>
          <Text style={[styles.label, { color: theme.textMuted }]}>
            How it works
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInUp.duration(600).delay(400)}
          style={styles.listContainer}
        >
          <FlatList
            ref={flatListRef}
            data={pages}
            renderItem={renderPage}
            keyExtractor={(item) => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            bounces={false}
          />
        </Animated.View>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {pages.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      index === currentIndex
                        ? theme.orbPrimary
                        : isDark
                          ? "rgba(255,255,255,0.15)"
                          : "rgba(0,0,0,0.12)",
                    width: index === currentIndex ? 24 : 8,
                  },
                ]}
              />
            ))}
          </View>

          <Pressable
            onPress={handleNext}
            style={({ pressed }) => [
              styles.nextButton,
              {
                backgroundColor: theme.orbPrimary,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
            testID="onboarding-next-button"
          >
            <Text style={styles.nextButtonText}>
              {isLastPage ? "Begin" : "Continue"}
            </Text>
          </Pressable>

          {!isLastPage ? (
            <Pressable
              onPress={handleComplete}
              style={({ pressed }) => [
                styles.skipButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              testID="onboarding-skip-button"
            >
              <Text style={[styles.skipText, { color: theme.textMuted }]}>
                Skip
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: "300",
    letterSpacing: 3,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  listContainer: {
    flex: 1,
    justifyContent: "center",
  },
  page: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["4xl"],
  },
  pageContent: {
    alignItems: "center",
    maxWidth: 320,
  },
  headline: {
    fontSize: 28,
    fontWeight: "300",
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  body: {
    fontSize: 17,
    lineHeight: 28,
    fontWeight: "300",
    textAlign: "center",
    letterSpacing: 0.3,
  },
  footer: {
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing["3xl"],
    gap: Spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  nextButton: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["4xl"],
    borderRadius: BorderRadius.full,
    width: "100%",
    maxWidth: 300,
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  skipButton: {
    paddingVertical: Spacing.md,
  },
  skipText: {
    fontSize: 15,
    fontWeight: "300",
    letterSpacing: 0.5,
  },
});
