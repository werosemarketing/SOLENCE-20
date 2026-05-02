import {
  DEFAULT_LANGUAGE,
  DEFAULT_VOICE,
  INTENT_OPTIONS,
  LANGUAGE_OPTIONS,
  TONE_OPTIONS,
  VOICE_OPTIONS,
  type Intent,
  type Language,
  type Tone,
  type Voice,
} from "@shared/schema";

export const INTENT_LABELS: Record<Intent, string> = {
  process_emotions: "Process emotions",
  reduce_anxiety: "Reduce anxiety",
  self_discovery: "Self-discovery",
  daily_reflection: "Daily reflection",
  navigate_relationships: "Navigate relationships",
  work_stress: "Work stress",
  build_habits: "Build habits",
  feel_less_alone: "Feel less alone",
};

export const TONE_LABELS: Record<Tone, string> = {
  warm: "Warm",
  soft: "Soft",
  grounded: "Grounded",
};

export const TONE_DESCRIPTIONS: Record<Tone, string> = {
  warm: "Encouraging and gently uplifting.",
  soft: "Quiet, slow, lots of space.",
  grounded: "Steady, even, reassuring.",
};

export const INTENTS: readonly Intent[] = INTENT_OPTIONS;
export const TONES: readonly Tone[] = TONE_OPTIONS;
export const VOICES: readonly Voice[] = VOICE_OPTIONS;
export const LANGUAGES: readonly Language[] = LANGUAGE_OPTIONS;
export { DEFAULT_VOICE, DEFAULT_LANGUAGE };

// Native-name labels so each option reads in its own language regardless of
// the active app locale. The radio card pairs the label with a localized
// description that DOES translate.
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  es: "Español",
};

// Short, user-facing label paired with a one-word vibe tag (per task brief
// e.g. "Warm — Nova"). The tag is the human descriptor; the proper noun is
// OpenAI's voice id we send to the API.
export const VOICE_LABELS: Record<Voice, string> = {
  nova: "Warm — Nova",
  shimmer: "Soft — Shimmer",
  onyx: "Grounded — Onyx",
  alloy: "Bright — Alloy",
};

export const VOICE_DESCRIPTIONS: Record<Voice, string> = {
  nova: "Friendly and bright. The default Solence voice.",
  shimmer: "Gentle and airy, with lots of breathing room.",
  onyx: "Lower and steadier — feels grounded and calm.",
  alloy: "Crisp and lively, with a touch more energy.",
};

export type ClientPreferences = {
  displayName: string | null;
  intents: Intent[];
  tone: Tone | null;
  voice: Voice | null;
  language: Language | null;
  onboardingCompletedAt: string | null;
};

export const EMPTY_PREFERENCES: ClientPreferences = {
  displayName: null,
  intents: [],
  tone: null,
  voice: null,
  language: null,
  onboardingCompletedAt: null,
};
