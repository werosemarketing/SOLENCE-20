import { useMemo } from "react";
import { Text, type TextProps, Platform, type TextStyle } from "react-native";

import { useTheme } from "@/hooks/useTheme";
import { useTextScale } from "@/hooks/useTextScale";
import { Typography, Fonts, fontForWeight } from "@/constants/theme";

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: "h1" | "h2" | "h3" | "h4" | "body" | "small" | "link";
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = "body",
  ...rest
}: ThemedTextProps) {
  const { theme, isDark } = useTheme();
  const { scale } = useTextScale();

  const getColor = () => {
    if (isDark && darkColor) {
      return darkColor;
    }

    if (!isDark && lightColor) {
      return lightColor;
    }

    if (type === "link") {
      return theme.link;
    }

    return theme.text;
  };

  const getTypeStyle = () => {
    switch (type) {
      case "h1":
        return Typography.h1;
      case "h2":
        return Typography.h2;
      case "h3":
        return Typography.h3;
      case "h4":
        return Typography.h4;
      case "body":
        return Typography.body;
      case "small":
        return Typography.small;
      case "link":
        return Typography.link;
      default:
        return Typography.body;
    }
  };

  const typeStyle = getTypeStyle();
  const fontFamily = Platform.OS === "web"
    ? Fonts?.sans
    : fontForWeight(typeStyle.fontWeight);

  // Scale the type-style font size and lineHeight, plus any caller-provided
  // overrides via the `style` prop, so adjusting text size in Profile cleanly
  // propagates to every ThemedText without each call site needing to opt in.
  const scaledStyle = useMemo<TextStyle>(() => {
    if (scale === 1) {
      return typeStyle as TextStyle;
    }
    const next: TextStyle = { ...(typeStyle as TextStyle) };
    if (typeof next.fontSize === "number") {
      next.fontSize = next.fontSize * scale;
    }
    if (typeof next.lineHeight === "number") {
      next.lineHeight = next.lineHeight * scale;
    }
    return next;
  }, [typeStyle, scale]);

  const scaledOverride = useMemo<TextStyle | null>(() => {
    if (scale === 1 || !style) return null;
    // Caller styles can be a single object or an array — flatten so we can
    // read fontSize/lineHeight regardless of how they were passed in.
    const flat = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : (style as TextStyle);
    const override: TextStyle = {};
    if (typeof flat.fontSize === "number") {
      override.fontSize = flat.fontSize * scale;
    }
    if (typeof flat.lineHeight === "number") {
      override.lineHeight = flat.lineHeight * scale;
    }
    return Object.keys(override).length > 0 ? override : null;
  }, [style, scale]);

  return (
    <Text
      style={[{ color: getColor(), fontFamily }, scaledStyle, style, scaledOverride]}
      {...rest}
    />
  );
}
