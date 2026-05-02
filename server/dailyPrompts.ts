// Curated pool of daily reflection prompts. The backend picks one per UTC
// day deterministically (see GET /api/daily-prompt) so every user gets the
// same gentle starter for the day.
//
// EDITING CONVENTION:
//   * Keep the tone soft, open-ended, and never instructive — these are
//     invitations, not assignments.
//   * Aim for 6–14 words per prompt. Short enough to fit on a card, long
//     enough to feel personal.
//   * Avoid clinical or therapy-speak ("process", "regulate", "trigger").
//     Plain, warm, everyday language.
//   * Never include the user's name, dates, or anything time-of-day
//     specific (the same prompt shows all day for everyone).
//   * `topic` is a short lowercase tag used for analytics + future
//     theming. Stick to the existing tags when possible; add new ones
//     sparingly.
//   * Adding/removing/reordering prompts will shift which prompt shows
//     for a given UTC day — that's fine, just be aware.
//   * Keep the pool between roughly 15 and 30 prompts.

export type DailyPrompt = {
  prompt: string;
  topic: string;
};

export const DAILY_PROMPTS: DailyPrompt[] = [
  { prompt: "Today, what felt heaviest?", topic: "weight" },
  { prompt: "What's something you're carrying that nobody knows about?", topic: "secret-weight" },
  { prompt: "Where in your body do you feel today?", topic: "body" },
  { prompt: "What's one small thing that softened your day?", topic: "softness" },
  { prompt: "Who came to mind today, and why?", topic: "connection" },
  { prompt: "What feeling are you most ready to put down?", topic: "release" },
  { prompt: "What's been quietly asking for your attention?", topic: "noticing" },
  { prompt: "If today had a color, what would it be?", topic: "imagery" },
  { prompt: "What do you wish someone would ask you right now?", topic: "longing" },
  { prompt: "What's one thing you're proud of, even a little?", topic: "pride" },
  { prompt: "What did you need today that you didn't get?", topic: "needs" },
  { prompt: "Where did your mind keep wandering today?", topic: "noticing" },
  { prompt: "What's a kindness you forgot to give yourself?", topic: "self-kindness" },
  { prompt: "What's something you're tired of pretending about?", topic: "honesty" },
  { prompt: "What part of today would you replay if you could?", topic: "savoring" },
  { prompt: "What's a question you've been avoiding?", topic: "honesty" },
  { prompt: "When did you feel most like yourself today?", topic: "identity" },
  { prompt: "What's one worry you can set down for tonight?", topic: "release" },
  { prompt: "What did you almost say today, but didn't?", topic: "unspoken" },
  { prompt: "What's been hard to admit, even to yourself?", topic: "honesty" },
  { prompt: "What's a small win from today worth naming?", topic: "pride" },
  { prompt: "What does rest look like for you right now?", topic: "rest" },
  { prompt: "What are you hoping tomorrow looks like?", topic: "hope" },
  { prompt: "What's something you'd tell a younger version of yourself?", topic: "self-compassion" },
];

// Deterministic prompt selection: hash a UTC date key (YYYY-MM-DD) into
// an index. Same date -> same prompt globally; consecutive days produce
// very different indexes thanks to the multiplier mixing.
//
// Exported so the route handler and the test suite share one source of
// truth for the mapping.
export function pickDailyPromptIndex(dateKey: string, poolSize: number): number {
  if (poolSize <= 0) return 0;
  let hash = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    // Equivalent to Math.imul(hash, 16777619) but avoids importing.
    hash = Math.imul(hash, 16777619);
  }
  // Force unsigned then mod into the pool.
  return Math.abs(hash | 0) % poolSize;
}

// UTC date key in YYYY-MM-DD form. The "day" boundary is midnight UTC so
// the same prompt holds for every user worldwide for the same calendar
// day on the server clock.
export function utcDateKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDailyPromptForDate(date: Date = new Date()): {
  prompt: string;
  topic: string;
  dateKey: string;
} {
  const dateKey = utcDateKey(date);
  const index = pickDailyPromptIndex(dateKey, DAILY_PROMPTS.length);
  const entry = DAILY_PROMPTS[index];
  return { prompt: entry.prompt, topic: entry.topic, dateKey };
}
