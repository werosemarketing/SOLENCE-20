import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  fontForWeight,
} from "@/constants/theme";

interface RenameDialogProps {
  visible: boolean;
  title: string;
  description?: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
  loading?: boolean;
  errorMessage?: string | null;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  testID?: string;
}

export function RenameDialog({
  visible,
  title,
  description,
  initialValue,
  placeholder,
  confirmLabel,
  cancelLabel,
  maxLength = 80,
  loading = false,
  errorMessage,
  onConfirm,
  onCancel,
  testID,
}: RenameDialogProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("renameDialog.defaultConfirm");
  const resolvedCancelLabel = cancelLabel ?? t("renameDialog.defaultCancel");
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      const focusTimer = setTimeout(() => {
        inputRef.current?.focus();
      }, 80);
      return () => clearTimeout(focusTimer);
    }
  }, [visible, initialValue]);

  const trimmed = value.trim();
  const canSubmit = !loading && trimmed.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onConfirm(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={loading ? undefined : onCancel}
    >
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.backdrop} testID={testID}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={loading ? undefined : onCancel}
            accessibilityLabel={t("renameDialog.dismissA11y")}
            testID={testID ? `${testID}-backdrop` : undefined}
          />
          <View
            style={[
              styles.dialog,
              { backgroundColor: theme.backgroundDefault },
            ]}
          >
            <ThemedText type="h4" style={styles.title}>
              {title}
            </ThemedText>
            {description ? (
              <ThemedText
                type="small"
                style={[styles.description, { color: theme.textMuted }]}
              >
                {description}
              </ThemedText>
            ) : null}

            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={theme.textMuted}
              maxLength={maxLength}
              editable={!loading}
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: errorMessage ? "#D9534F" : "transparent",
                },
              ]}
              testID={testID ? `${testID}-input` : undefined}
            />

            {errorMessage ? (
              <Text
                style={[styles.errorText, { color: "#D9534F" }]}
                testID={testID ? `${testID}-error` : undefined}
              >
                {errorMessage}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                onPress={loading ? undefined : onCancel}
                disabled={loading}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    opacity: loading ? 0.6 : pressed ? 0.7 : 1,
                  },
                ]}
                accessibilityRole="button"
                testID={testID ? `${testID}-cancel` : undefined}
              >
                <Text style={[styles.actionText, { color: theme.text }]}>
                  {resolvedCancelLabel}
                </Text>
              </Pressable>
              <Pressable
                onPress={canSubmit ? handleSubmit : undefined}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: theme.link,
                    opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1,
                  },
                ]}
                accessibilityRole="button"
                testID={testID ? `${testID}-confirm` : undefined}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.actionText, { color: "#FFFFFF" }]}>
                    {resolvedConfirmLabel}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  dialog: {
    width: "100%",
    maxWidth: 360,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
  },
  title: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  description: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  input: {
    ...Typography.body,
    fontFamily: fontForWeight("400"),
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
  },
  errorText: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  actionButton: {
    flex: 1,
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
  },
});
