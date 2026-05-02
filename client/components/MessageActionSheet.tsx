import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  fontForWeight,
} from "@/constants/theme";

type ActionKey = "save" | "share" | "copy";

export type MessageActionSheetProps = {
  visible: boolean;
  isFavorite: boolean;
  onSelect: (action: ActionKey) => void;
  onCancel: () => void;
  testID?: string;
};

export function MessageActionSheet({
  visible,
  isFavorite,
  onSelect,
  onCancel,
  testID,
}: MessageActionSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop} testID={testID}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityLabel="Dismiss action sheet"
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundDefault,
              paddingBottom:
                Spacing.lg + (Platform.OS === "web" ? 0 : insets.bottom),
            },
          ]}
        >
          <View
            style={[
              styles.handle,
              { backgroundColor: theme.backgroundTertiary },
            ]}
          />

          <ActionRow
            icon="bookmark"
            label={isFavorite ? "Remove from saved" : "Save moment"}
            color={theme.text}
            onPress={() => onSelect("save")}
            testID={testID ? `${testID}-save` : undefined}
          />
          <ActionRow
            icon="share"
            label="Share as quote card"
            color={theme.text}
            onPress={() => onSelect("share")}
            testID={testID ? `${testID}-share` : undefined}
          />
          <ActionRow
            icon="copy"
            label="Copy text"
            color={theme.text}
            onPress={() => onSelect("copy")}
            testID={testID ? `${testID}-copy` : undefined}
          />

          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [
              styles.cancelButton,
              {
                backgroundColor: theme.backgroundSecondary,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            accessibilityRole="button"
            testID={testID ? `${testID}-cancel` : undefined}
          >
            <Text style={[styles.cancelText, { color: theme.text }]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  color,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  color: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Feather name={icon} size={18} color={color} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderTopLeftRadius: BorderRadius["2xl"],
    borderTopRightRadius: BorderRadius["2xl"],
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  rowLabel: {
    ...Typography.body,
    fontFamily: fontForWeight("500"),
  },
  cancelButton: {
    marginTop: Spacing.md,
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
  },
});
