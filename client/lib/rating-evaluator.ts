// Pure, dependency-free helpers for the App Store rating gate. Lives
// outside `rating.ts` so unit tests can import it directly without
// pulling in React Native or AsyncStorage.

export const MIN_MESSAGES_FOR_REVIEW = 6;
export const MIN_SESSION_DURATION_MS = 2 * 60 * 1000;
export const MIN_DISTINCT_SESSION_DAYS = 3;
export const MIN_DAYS_BETWEEN_PROMPTS = 120;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CRISIS_KEYWORD_PATTERNS: RegExp[] = [
  /\bsuicide\b/i,
  /\bsuicidal\b/i,
  /\bkill (myself|me)\b/i,
  /\bend (my|it all)\b/i,
  /\b(want|wanted|wanting) to die\b/i,
  /\bself[- ]?harm(ing|ed)?\b/i,
  /\bhurt(ing)? myself\b/i,
  /\bcut(ting)? myself\b/i,
];

export function containsCrisisLanguage(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  return CRISIS_KEYWORD_PATTERNS.some((re) => re.test(text));
}

export type ReviewEvaluationInput = {
  messageCount: number;
  sessionDurationMs: number;
  hadCrisis: boolean;
  now?: Date;
};

export type ReviewEvaluationContext = {
  lastPromptedAt: number | null;
  sessionDates: string[];
};

// Pure evaluator. Returns true only when every gate from the task brief
// passes. Order of checks is intentional: the cheapest, most-likely-to-fail
// guards run first so the common "no rating" path is fast.
export function evaluateShouldRequestReview(
  input: ReviewEvaluationInput,
  ctx: ReviewEvaluationContext,
): boolean {
  if (input.hadCrisis) return false;
  if (input.messageCount < MIN_MESSAGES_FOR_REVIEW) return false;
  if (input.sessionDurationMs < MIN_SESSION_DURATION_MS) return false;

  const distinctDays = new Set(ctx.sessionDates).size;
  if (distinctDays < MIN_DISTINCT_SESSION_DAYS) return false;

  if (ctx.lastPromptedAt != null) {
    const now = (input.now ?? new Date()).getTime();
    const elapsedDays = (now - ctx.lastPromptedAt) / MS_PER_DAY;
    if (elapsedDays < MIN_DAYS_BETWEEN_PROMPTS) return false;
  }

  return true;
}
