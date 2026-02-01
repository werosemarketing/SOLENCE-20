import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#2d2a26",
    textMuted: "#6b6560",
    buttonText: "#FFFFFF",
    tabIconDefault: "#687076",
    tabIconSelected: "#9d6b53",
    link: "#9d6b53",
    backgroundRoot: "#faf8f5",
    backgroundDefault: "#f5f2ed",
    backgroundSecondary: "#efe9e2",
    backgroundTertiary: "#e5ddd4",
    orbPrimary: "#9d6b53",
    orbSecondary: "#c4956c",
    orbGlow: "rgba(196, 149, 108, 0.3)",
  },
  dark: {
    text: "#e8e4e0",
    textMuted: "#a09890",
    buttonText: "#FFFFFF",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: "#c4956c",
    link: "#c4956c",
    backgroundRoot: "#1a1625",
    backgroundDefault: "#242030",
    backgroundSecondary: "#2e2a3a",
    backgroundTertiary: "#383444",
    orbPrimary: "#9d6b53",
    orbSecondary: "#c4956c",
    orbGlow: "rgba(196, 149, 108, 0.3)",
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

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
