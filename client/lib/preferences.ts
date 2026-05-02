import { INTENT_OPTIONS, TONE_OPTIONS, type Intent, type Tone } from "@shared/schema";

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

export type ClientPreferences = {
  displayName: string | null;
  intents: Intent[];
  tone: Tone | null;
  onboardingCompletedAt: string | null;
};

export const EMPTY_PREFERENCES: ClientPreferences = {
  displayName: null,
  intents: [],
  tone: null,
  onboardingCompletedAt: null,
};
