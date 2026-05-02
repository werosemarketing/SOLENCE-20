import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";

import { QuoteCard, QUOTE_CARD_MAX_LENGTH } from "@/components/QuoteCard";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  fontForWeight,
} from "@/constants/theme";

export type ShareQuoteModalProps = {
  visible: boolean;
  quote: string | null;
  onClose: () => void;
  testID?: string;
};

export function ShareQuoteModal({
  visible,
  quote,
  onClose,
  testID,
}: ShareQuoteModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  // The view-shot ref attaches a `capture()` method to the underlying View
  // host node so we can rasterise the QuoteCard imperatively when the user
  // taps Share.
  const viewShotRef = useRef<ViewShotRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset transient state every time the modal is reopened so a previous
  // error / success banner doesn't bleed into a new share session.
  useEffect(() => {
    if (visible) {
      setBusy(false);
      setError(null);
      setSuccess(null);
    }
  }, [visible]);

  const trimmedQuote = (quote ?? "").replace(/\s+/g, " ").trim();
  const tooLong = trimmedQuote.length > QUOTE_CARD_MAX_LENGTH;

  const handleShare = async () => {
    if (busy || tooLong || !trimmedQuote) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // Wait one frame so the off-screen card has definitely laid out
      // before we ask view-shot to rasterise it. Without this, the very
      // first capture after the modal opens occasionally returns an
      // empty image on Android.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      const ref = viewShotRef.current;
      if (!ref || typeof ref.capture !== "function") {
        throw new Error("Could not prepare the quote card.");
      }

      if (Platform.OS === "web") {
        // On web, captureRef returns a data-uri (the .web shim ignores
        // the `result` option). We trigger a download instead of opening
        // a native share sheet, which doesn't exist in browsers.
        const uri = await ref.capture();
        triggerWebDownload(uri);
        setSuccess("Quote card downloaded.");
        return;
      }

      const uri = await ref.capture();
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        throw new Error("Sharing isn't available on this device.");
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "Share this moment from Solence",
        UTI: "public.png",
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Couldn't share this quote.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}
    >
      <View style={styles.backdrop} testID={testID}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={busy ? undefined : onClose}
          accessibilityLabel="Dismiss share preview"
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <View
          style={[
            styles.dialog,
            {
              backgroundColor: theme.backgroundDefault,
              paddingBottom:
                Spacing.xl + (Platform.OS === "web" ? 0 : insets.bottom),
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>
              Share as quote
            </Text>
            <Pressable
              onPress={busy ? undefined : onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID={testID ? `${testID}-close` : undefined}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Feather name="x" size={20} color={theme.textMuted} />
            </Pressable>
          </View>

          {tooLong ? (
            <View
              style={styles.tooLongContainer}
              testID={testID ? `${testID}-too-long` : undefined}
            >
              <Feather name="info" size={20} color={theme.textMuted} />
              <Text
                style={[
                  styles.tooLongText,
                  { color: theme.textMuted },
                ]}
              >
                This message is a little too long to fit beautifully on a
                quote card. Try copying the text instead.
              </Text>
            </View>
          ) : (
            <View style={styles.cardContainer}>
              <ViewShot
                ref={viewShotRef}
                options={{
                  format: "png",
                  quality: 1,
                  result: Platform.OS === "web" ? "data-uri" : "tmpfile",
                }}
                style={styles.cardShot}
              >
                <QuoteCard
                  quote={trimmedQuote}
                  testID={testID ? `${testID}-card` : undefined}
                />
              </ViewShot>
            </View>
          )}

          {error ? (
            <Text
              style={[styles.statusText, { color: "#D9534F" }]}
              testID={testID ? `${testID}-error` : undefined}
            >
              {error}
            </Text>
          ) : success ? (
            <Text
              style={[styles.statusText, { color: theme.textMuted }]}
              testID={testID ? `${testID}-success` : undefined}
            >
              {success}
            </Text>
          ) : null}

          <Pressable
            onPress={handleShare}
            disabled={busy || tooLong}
            style={({ pressed }) => [
              styles.shareButton,
              {
                backgroundColor: theme.orbPrimary,
                opacity: busy || tooLong ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              Platform.OS === "web" ? "Download quote card" : "Share quote card"
            }
            testID={testID ? `${testID}-share` : undefined}
          >
            {busy ? (
              <ActivityIndicator color={theme.buttonText} />
            ) : (
              <>
                <Feather
                  name={Platform.OS === "web" ? "download" : "share"}
                  size={18}
                  color={theme.buttonText}
                />
                <Text
                  style={[styles.shareButtonText, { color: theme.buttonText }]}
                >
                  {Platform.OS === "web" ? "Download" : "Share"}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function triggerWebDownload(dataUri: string) {
  if (typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = dataUri;
  link.download = `solence-quote-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  dialog: {
    width: "100%",
    maxWidth: 380,
    borderRadius: BorderRadius["2xl"],
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  title: {
    ...Typography.h4,
    fontFamily: fontForWeight("600"),
  },
  closeButton: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  cardContainer: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  cardShot: {
    backgroundColor: "transparent",
  },
  tooLongContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing["2xl"],
  },
  tooLongText: {
    flex: 1,
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    lineHeight: 20,
  },
  statusText: {
    ...Typography.small,
    fontFamily: fontForWeight("400"),
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.full,
  },
  shareButtonText: {
    ...Typography.body,
    fontFamily: fontForWeight("600"),
    letterSpacing: 0.3,
  },
});
