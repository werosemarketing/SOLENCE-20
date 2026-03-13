import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#403E3E",
    textMuted: "#6b6560",
    buttonText: "#FFFFFF",
    tabIconDefault: "#687076",
    tabIconSelected: "#D66B32",
    link: "#D66B32",
    backgroundRoot: "#FAF1E7",
    backgroundDefault: "#F5EBDD",
    backgroundSecondary: "#EFE3D5",
    backgroundTertiary: "#E5D9CC",
    orbPrimary: "#D66B32",
    orbSecondary: "#E8945E",
    orbGlow: "rgba(214, 107, 50, 0.3)",
  },
  dark: {
    text: "#e8e4e0",
    textMuted: "#a09890",
    buttonText: "#FFFFFF",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: "#E8945E",
    link: "#E8945E",
    backgroundRoot: "#1a1625",
    backgroundDefault: "#242030",
    backgroundSecondary: "#2e2a3a",
    backgroundTertiary: "#383444",
    orbPrimary: "#D66B32",
    orbSecondary: "#E8945E",
    orbGlow: "rgba(214, 107, 50, 0.3)",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  inputHeight: 48,
  buttonHeight: 52,
};

export const BorderRadius = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  "2xl": 40,
  "3xl": 50,
  full: 9999,
};

export const Typography = {
  h1: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700" as const,
  },
  h2: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "300" as const,
    letterSpacing: 2,
  },
  h3: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600" as const,
  },
  h4: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400" as const,
  },
  link: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
  },
  message: {
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "300" as const,
  },
  stateText: {
    fontSize: 16,
    fontWeight: "300" as const,
  },
};

export const FontFamily = {
  light: "MPLUSRounded1c_300Light",
  regular: "MPLUSRounded1c_400Regular",
  medium: "MPLUSRounded1c_500Medium",
  bold: "MPLUSRounded1c_700Bold",
};

export const fontForWeight = (weight: string): string => {
  switch (weight) {
    case "200":
    case "300":
      return FontFamily.light;
    case "500":
      return FontFamily.medium;
    case "600":
    case "700":
    case "800":
    case "900":
      return FontFamily.bold;
    default:
      return FontFamily.regular;
  }
};

export const Fonts = Platform.select({
  ios: {
    sans: FontFamily.regular,
    serif: "ui-serif",
    rounded: FontFamily.regular,
    mono: "ui-monospace",
  },
  default: {
    sans: FontFamily.regular,
    serif: "serif",
    rounded: FontFamily.regular,
    mono: "monospace",
  },
  web: {
    sans: "'M PLUS Rounded 1c', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'M PLUS Rounded 1c', system-ui, sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
