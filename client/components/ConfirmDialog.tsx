import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  fontForWeight,
} from "@/constants/theme";

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  const { theme } = useTheme();

  const confirmColor = destructive ? "#D9534F" : theme.link;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={loading ? undefined : onCancel}
    >
      <View style={styles.backdrop} testID={testID}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={loading ? undefined : onCancel}
          accessibilityLabel="Dismiss confirmation"
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
          {message ? (
            <ThemedText
              type="small"
              style={[styles.message, { color: theme.textMuted }]}
            >
              {message}
            </ThemedText>
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
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              onPress={loading ? undefined : onConfirm}
              disabled={loading}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: confirmColor,
                  opacity: loading ? 0.8 : pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              testID={testID ? `${testID}-confirm` : undefined}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[styles.actionText, { color: "#FFFFFF" }]}>
                  {confirmLabel}
                </Text>
              )}
            </Pressable>
          </View>
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
  message: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.md,
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
