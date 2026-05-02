import { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  fontForWeight,
} from "@/constants/theme";

type Props = {
  visible: boolean;
  value: Date;
  is24Hour: boolean;
  locale?: string;
  onSelect: (date: Date) => void;
  onCancel: () => void;
  testID?: string;
};

export function TimePickerModal({
  visible,
  value,
  is24Hour,
  locale,
  onSelect,
  onCancel,
  testID,
}: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Date>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  if (Platform.OS !== "ios") return null;

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
          accessibilityLabel={t("common.cancel")}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <View
          style={[
            styles.dialog,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <DateTimePicker
            value={draft}
            mode="time"
            display="spinner"
            is24Hour={is24Hour}
            locale={locale}
            onChange={(_event: DateTimePickerEvent, d?: Date) => {
              if (d) setDraft(d);
            }}
            textColor={theme.text}
            accentColor={theme.orbPrimary}
            style={styles.picker}
            testID={testID ? `${testID}-picker` : undefined}
          />
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.btn,
                {
                  backgroundColor: theme.backgroundSecondary,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              testID={testID ? `${testID}-cancel` : undefined}
            >
              <Text style={[styles.btnText, { color: theme.text }]}>
                {t("common.cancel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onSelect(draft)}
              style={({ pressed }) => [
                styles.btn,
                {
                  backgroundColor: theme.link,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              testID={testID ? `${testID}-confirm` : undefined}
            >
              <Text style={[styles.btnText, { color: "#FFFFFF" }]}>
                {t("common.done")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Imperative Android picker — Android's DateTimePicker is dialog-based and
// has its own dismiss/confirm UI, so we don't render anything; we just open
// it on demand from the caller.
export function openAndroidTimePicker(opts: {
  value: Date;
  is24Hour: boolean;
  onSelect: (date: Date) => void;
}) {
  if (Platform.OS !== "android") return;
  DateTimePickerAndroid.open({
    value: opts.value,
    mode: "time",
    is24Hour: opts.is24Hour,
    onChange: (event: DateTimePickerEvent, date?: Date) => {
      if (event.type === "set" && date) opts.onSelect(date);
    },
  });
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
    padding: Spacing.lg,
  },
  picker: {
    alignSelf: "stretch",
  },
  actions: {
    marginTop: Spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  btn: {
    flex: 1,
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
  },
});
