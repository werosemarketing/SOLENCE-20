import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  fontForWeight,
  FontFamily,
} from "@/constants/theme";
import { INTENTS, TONES, type ClientPreferences } from "@/lib/preferences";
import type { Intent, Tone } from "@shared/schema";

type Props = {
  visible: boolean;
  initial: ClientPreferences;
  loading?: boolean;
  errorMessage?: string | null;
  onConfirm: (next: {
    displayName: string | null;
    intents: Intent[];
    tone: Tone | null;
  }) => void;
  onCancel: () => void;
};

export function PersonalizationDialog({
  visible,
  initial,
  loading = false,
  errorMessage,
  onConfirm,
  onCancel,
}: Props) {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation();
  const [name, setName] = useState(initial.displayName ?? "");
  const [intents, setIntents] = useState<Intent[]>(initial.intents);
  const [tone, setTone] = useState<Tone | null>(initial.tone);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setName(initial.displayName ?? "");
      setIntents(initial.intents);
      setTone(initial.tone);
      const focusTimer = setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
      return () => clearTimeout(focusTimer);
    }
  }, [visible, initial]);

  const toggleIntent = (intent: Intent) => {
    setIntents((prev) =>
      prev.includes(intent)
        ? prev.filter((i) => i !== intent)
        : [...prev, intent],
    );
  };

  const selectTone = (next: Tone) => {
    setTone((prev) => (prev === next ? null : next));
  };

  const handleSubmit = () => {
    if (loading) return;
    const trimmed = name.trim();
    onConfirm({
      displayName: trimmed.length > 0 ? trimmed : null,
      intents,
      tone,
    });
  };

  const chipBackground = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  const chipBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const chipSelectedBackground = isDark
    ? "rgba(255,255,255,0.12)"
    : "rgba(0,0,0,0.08)";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={loading ? undefined : onCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={loading ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel={t("personalization.dismissA11y")}
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: isDark ? "#1f1a2e" : "#fefefe",
              borderColor: isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.06)",
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.title, { color: theme.text }]}>
              {t("personalization.title")}
            </Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              {t("personalization.subtitle")}
            </Text>

            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.text }]}>
                {t("personalization.nameLabel")}
              </Text>
              <TextInput
                ref={inputRef}
                value={name}
                onChangeText={setName}
                placeholder={t("personalization.namePlaceholder")}
                placeholderTextColor={
                  isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)"
                }
                maxLength={40}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: chipBackground,
                    borderColor: chipBorder,
                  },
                ]}
                testID="personalization-name-input"
              />
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.text }]}>
                {t("personalization.intentsLabel")}
              </Text>
              <View style={styles.chipsWrap}>
                {INTENTS.map((intent) => {
                  const selected = intents.includes(intent);
                  return (
                    <Pressable
                      key={intent}
                      onPress={() => toggleIntent(intent)}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor: selected
                            ? chipSelectedBackground
                            : chipBackground,
                          borderColor: selected
                            ? theme.orbPrimary
                            : chipBorder,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                      testID={`personalization-intent-${intent}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: selected ? theme.text : theme.textMuted,
                            fontFamily: selected
                              ? FontFamily.medium
                              : FontFamily.regular,
                          },
                        ]}
                      >
                        {t(`intents.${intent}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.text }]}>
                {t("personalization.toneLabel")}
              </Text>
              <View style={styles.toneStack}>
                {TONES.map((toneOption) => {
                  const selected = tone === toneOption;
                  return (
                    <Pressable
                      key={toneOption}
                      onPress={() => selectTone(toneOption)}
                      style={({ pressed }) => [
                        styles.toneCard,
                        {
                          backgroundColor: selected
                            ? chipSelectedBackground
                            : chipBackground,
                          borderColor: selected
                            ? theme.orbPrimary
                            : chipBorder,
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                      testID={`personalization-tone-${toneOption}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.toneTitle, { color: theme.text }]}>
                        {t(`tones.${toneOption}.label`)}
                      </Text>
                      <Text
                        style={[
                          styles.toneDescription,
                          { color: theme.textMuted },
                        ]}
                      >
                        {t(`tones.${toneOption}.description`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {errorMessage ? (
              <Text
                style={[styles.errorText, { color: theme.orbPrimary }]}
                testID="personalization-error"
              >
                {errorMessage}
              </Text>
            ) : null}
          </ScrollView>

          <View
            style={[
              styles.footerRow,
              {
                borderTopColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.06)",
              },
            ]}
          >
            <Pressable
              onPress={loading ? undefined : onCancel}
              style={({ pressed }) => [
                styles.cancelButton,
                { opacity: loading ? 0.4 : pressed ? 0.6 : 1 },
              ]}
              testID="personalization-cancel"
            >
              <Text style={[styles.cancelText, { color: theme.textMuted }]}>
                {t("personalization.cancel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={loading}
              style={({ pressed }) => [
                styles.confirmButton,
                {
                  backgroundColor: theme.orbPrimary,
                  opacity: loading ? 0.7 : pressed ? 0.85 : 1,
                },
              ]}
              testID="personalization-save"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.confirmText}>
                  {t("personalization.save")}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "92%",
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },
  scrollContent: {
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  title: {
    ...Typography.h3,
    fontFamily: fontForWeight("600"),
  },
  subtitle: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
  },
  section: {
    gap: Spacing.sm,
  },
  sectionLabel: {
    ...Typography.body,
    fontFamily: fontForWeight("500"),
    marginTop: Spacing.sm,
  },
  input: {
    fontSize: 16,
    fontFamily: FontFamily.regular,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    letterSpacing: 0.2,
  },
  toneStack: {
    gap: Spacing.sm,
  },
  toneCard: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    gap: Spacing.xs / 2,
  },
  toneTitle: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
  },
  toneDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FontFamily.light,
  },
  errorText: {
    textAlign: "center",
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelButton: {
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
  },
  cancelText: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
  },
  confirmButton: {
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: FontFamily.bold,
  },
});
