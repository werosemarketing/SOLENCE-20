import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable(
  "users",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    // Password is nullable so Apple-only accounts (created via Sign in with
    // Apple, no email/password ever set) don't need a synthetic placeholder.
    password: text("password"),
    // Apple's "sub" claim — stable per (Apple ID, app team). Nullable for
    // existing email/password users; set on first Sign in with Apple either
    // by creating a new account or by linking to an existing email match.
    appleUserId: text("apple_user_id"),
    displayName: text("display_name"),
    intents: text("intents").array(),
    tone: text("tone"),
    voice: text("voice"),
    // BCP-47-style language tag the user picked for the Solence UI and AI
    // replies. Nullable so legacy rows + brand-new accounts fall back to
    // English (DEFAULT_LANGUAGE) without a backfill.
    language: text("language"),
    // Gentle daily reminder preference. The notification itself is scheduled
    // and delivered locally on-device via expo-notifications; the server
    // only stores the user's choice so it survives a reinstall and can be
    // re-applied on a new device. `reminderTime` is stored as a 24-hour
    // "HH:MM" string interpreted in the user's local timezone by the
    // device that schedules the notification.
    reminderEnabled: boolean("reminder_enabled").notNull().default(false),
    reminderTime: text("reminder_time").notNull().default("20:00"),
    // Weekly reflection summary preference. Same on-device scheduling
    // model as the daily reminder. `weeklySummaryDay` follows JS's
    // getDay() convention (0=Sunday … 6=Saturday); time is "HH:MM".
    weeklySummaryEnabled: boolean("weekly_summary_enabled")
      .notNull()
      .default(false),
    weeklySummaryDay: integer("weekly_summary_day").notNull().default(0),
    weeklySummaryTime: text("weekly_summary_time").notNull().default("19:00"),
    onboardingCompletedAt: timestamp("onboarding_completed_at"),
    // Personal share code printed on the Profile invite card. Generated on
    // first registration (or lazily backfilled for legacy rows). Lower-cased
    // alphanumerics, 8 chars — short enough to type, big enough to avoid
    // collisions in any realistic install base.
    referralCode: text("referral_code").unique(),
    // The user who referred this account at signup. Set once at register
    // time and never changed; used to prevent the same account being
    // counted as a referee twice and to protect against self-referral.
    referredBy: varchar("referred_by"),
    // Set to true by the RevenueCat webhook when a Premium subscription is active.
    isPremium: boolean("is_premium").notNull().default(false),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    appleUserIdUnique: uniqueIndex("users_apple_user_id_unique").on(
      table.appleUserId,
    ),
  }),
);

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const TONE_OPTIONS = ["warm", "soft", "grounded"] as const;
export type Tone = (typeof TONE_OPTIONS)[number];

// Curated subset of OpenAI gpt-audio voices Solence is allowed to use.
// "nova" is the implicit default when a user hasn't picked one yet.
export const VOICE_OPTIONS = ["nova", "shimmer", "onyx", "alloy"] as const;
export type Voice = (typeof VOICE_OPTIONS)[number];
export const DEFAULT_VOICE: Voice = "nova";

export const LANGUAGE_OPTIONS = ["en", "es"] as const;
export type Language = (typeof LANGUAGE_OPTIONS)[number];
export const DEFAULT_LANGUAGE: Language = "en";

export const INTENT_OPTIONS = [
  "process_emotions",
  "reduce_anxiety",
  "self_discovery",
  "daily_reflection",
  "navigate_relationships",
  "work_stress",
  "build_habits",
  "feel_less_alone",
] as const;
export type Intent = (typeof INTENT_OPTIONS)[number];

// 24-hour "HH:MM" string with leading zeros — matches the format used by
// the on-device daily/weekly notification schedulers. Stored as text so we
// keep timezone interpretation on the device that does the scheduling.
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_REMINDER_TIME = "20:00";
export const DEFAULT_WEEKLY_SUMMARY_TIME = "19:00";
// 0 = Sunday … 6 = Saturday, matching JavaScript's Date.getDay().
export const DEFAULT_WEEKLY_SUMMARY_DAY = 0;

const timeOfDaySchema = z
  .string()
  .regex(TIME_OF_DAY_PATTERN, "Time must be HH:MM in 24-hour format");
const weekdaySchema = z.number().int().min(0).max(6);

export const updatePreferencesSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(40, "Name must be 40 characters or fewer")
    .nullable()
    .optional(),
  intents: z
    .array(z.enum(INTENT_OPTIONS))
    .max(INTENT_OPTIONS.length)
    .nullable()
    .optional(),
  tone: z.enum(TONE_OPTIONS).nullable().optional(),
  voice: z.enum(VOICE_OPTIONS).nullable().optional(),
  language: z.enum(LANGUAGE_OPTIONS).nullable().optional(),
  reminderEnabled: z.boolean().optional(),
  reminderTime: timeOfDaySchema.optional(),
  weeklySummaryEnabled: z.boolean().optional(),
  weeklySummaryDay: weekdaySchema.optional(),
  weeklySummaryTime: timeOfDaySchema.optional(),
  markOnboardingComplete: z.boolean().optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export type UserPreferences = {
  displayName: string | null;
  intents: Intent[];
  tone: Tone | null;
  voice: Voice | null;
  language: Language | null;
  reminderEnabled: boolean;
  reminderTime: string;
  weeklySummaryEnabled: boolean;
  weeklySummaryDay: number;
  weeklySummaryTime: string;
  onboardingCompletedAt: string | null;
};

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    reflectionSummary: text("reflection_summary"),
    reflectionTakeaway: text("reflection_takeaway"),
    reflectionGeneratedAt: timestamp("reflection_generated_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    userIdIdx: index("conversations_user_id_idx").on(table.userId),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    // True when this message turn was flagged as containing crisis-relevant
    // language (self-harm, suicide ideation, etc.). Persisted on the row so
    // that re-opening a conversation can re-render the support banner.
    crisisSupport: boolean("crisis_support").notNull().default(false),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    conversationIdIdx: index("messages_conversation_id_idx").on(table.conversationId),
  }),
);

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// Per-user bookmarks for individual assistant messages. The unique index on
// (user_id, message_id) makes the favorite/unfavorite endpoints naturally
// idempotent — re-favoriting the same message is a no-op rather than a
// duplicate row, and re-deleting a non-existent favorite returns 0 rows.
export const favorites = pgTable(
  "favorites",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    userMessageUnique: uniqueIndex("favorites_user_message_unique").on(
      table.userId,
      table.messageId,
    ),
    userIdIdx: index("favorites_user_id_idx").on(table.userId),
  }),
);

export type Favorite = typeof favorites.$inferSelect;

// Lightweight mood check-ins captured before/after a conversation. The
// `phase` field discriminates between the two prompts; `score` is a 1-5
// scale (rough → great). `conversationId` is nullable because the pre-
// session check-in fires BEFORE a conversation row exists; the post-
// session entry links to the just-ended conversation. Index on
// (userId, createdAt) keeps the Profile chart query cheap.
export const MOOD_PHASES = ["pre", "post"] as const;
export type MoodPhase = (typeof MOOD_PHASES)[number];
export const MOOD_SCORE_MIN = 1;
export const MOOD_SCORE_MAX = 5;

export const moodEntries = pgTable(
  "mood_entries",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: integer("conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    phase: text("phase").notNull(),
    score: integer("score").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    userCreatedIdx: index("mood_entries_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export type MoodEntry = typeof moodEntries.$inferSelect;

export const tokenUsage = pgTable(
  "token_usage",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    messagesUsed: integer("messages_used").notNull().default(0),
    periodStart: timestamp("period_start").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    userPeriodIdx: index("token_usage_user_period_idx").on(table.userId, table.periodStart),
  }),
);

export type TokenUsage = typeof tokenUsage.$inferSelect;

export const FREE_TOKEN_LIMIT = 15000;
export const PREMIUM_MESSAGE_LIMIT = 250;
export const TOKEN_PERIOD = "day" as const;

// Each successful referral grants this much "free" unlimited time to both
// the referrer and the referee. Stored as ms so date arithmetic stays
// boring and timezone-free.
export const REFERRAL_CREDIT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
// Hard cap on how much credit a single user can stack. Multiple successful
// referrals compound, but never beyond this window from "now" — keeps
// the unlimited override from drifting indefinitely into the future.
export const REFERRAL_CREDIT_MAX_STACK_MS = 4 * REFERRAL_CREDIT_DURATION_MS;

// Source of a credit row. 'referrer' is the inviter; 'referee' is the
// new account that signed up using the code. Stored as plain text so the
// column can grow new sources later without a schema migration.
export const REFERRAL_CREDIT_SOURCES = ["referrer", "referee"] as const;
export type ReferralCreditSource = (typeof REFERRAL_CREDIT_SOURCES)[number];

// Free-week credits granted to a user via the referral system. Each row
// represents a single grant; the active credit window for a user is the
// row with the latest `endsAt` that's still in the future. Indexed on
// (user_id, ends_at) so the active-credit lookup stays cheap.
export const referralCredits = pgTable(
  "referral_credits",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    source: text("source").notNull(),
    // The other user in the pair (referrer's row points at the referee
    // and vice versa). Nullable so we don't lose the credit row if the
    // counterparty is later deleted; foreign key omitted for the same
    // reason — credits should outlive account deletions.
    referralUserId: text("referral_user_id"),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userEndsIdx: index("referral_credits_user_ends_idx").on(
      table.userId,
      table.endsAt,
    ),
  }),
);

export type ReferralCredit = typeof referralCredits.$inferSelect;

// Long-term memory snippets Solence carries across conversations. Each row
// is a single short, durable observation about the user (e.g. "Working
// through stress at a new job") extracted by the reflection generator at
// end-of-conversation. The chat handler folds the most recent snippets
// into the system prompt so Solence can reference them naturally without
// re-reading entire transcripts. `sourceConversationId` is nullable +
// `set null` on conversation delete so a memory survives the user
// removing the originating session — the user can still see and clear
// it from the Profile "What Solence remembers" card.
export const USER_MEMORY_TEXT_MAX_LEN = 200;
// Hard cap on how many memory rows we keep per user. Anything above this
// gets pruned oldest-first whenever the reflection generator inserts a
// fresh batch — keeps the prompt-side payload small and bounded.
export const USER_MEMORY_MAX_PER_USER = 20;
// Prompt-side budget for the "WHAT YOU REMEMBER" block injected into the
// chat system prompt. The storage cap above governs how many memories we
// retain; these tighter caps govern how many we surface per request so
// the system prompt stays close to a ~200 token budget regardless of how
// full the user's memory store is. Newest memories win when truncating.
export const USER_MEMORY_PROMPT_MAX_ITEMS = 8;
export const USER_MEMORY_PROMPT_CHAR_BUDGET = 800;

export const userMemories = pgTable(
  "user_memories",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    text: text("text").notNull(),
    sourceConversationId: integer("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("user_memories_user_id_idx").on(table.userId),
  }),
);

export type UserMemory = typeof userMemories.$inferSelect;
