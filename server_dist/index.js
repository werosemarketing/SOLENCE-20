var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/index.ts
import express3 from "express";

// server/routes.ts
import { createServer } from "node:http";
import express2 from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

// server/replit_integrations/audio/routes.ts
import express from "express";
var audioBodyParser = express.json({ limit: "50mb" });

// server/replit_integrations/audio/client.ts
import OpenAI, { toFile } from "openai";
import { Buffer as Buffer2 } from "node:buffer";
var openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
});
function detectAudioFormat(buffer) {
  if (buffer.length < 12) return "unknown";
  if (buffer[0] === 82 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 70) {
    return "wav";
  }
  if (buffer[0] === 26 && buffer[1] === 69 && buffer[2] === 223 && buffer[3] === 163) {
    return "webm";
  }
  if (buffer[0] === 255 && (buffer[1] === 251 || buffer[1] === 250 || buffer[1] === 243) || buffer[0] === 73 && buffer[1] === 68 && buffer[2] === 51) {
    return "mp3";
  }
  if (buffer[4] === 102 && buffer[5] === 116 && buffer[6] === 121 && buffer[7] === 112) {
    return "mp4";
  }
  if (buffer[0] === 79 && buffer[1] === 103 && buffer[2] === 103 && buffer[3] === 83) {
    return "ogg";
  }
  return "unknown";
}
async function textToSpeech(text2, voice = "alloy", format = "wav") {
  const response = await openai.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format },
    messages: [
      { role: "system", content: "You are an assistant that performs text-to-speech." },
      { role: "user", content: `Repeat the following text verbatim: ${text2}` }
    ]
  });
  const audioData = response.choices[0]?.message?.audio?.data ?? "";
  return Buffer2.from(audioData, "base64");
}
async function speechToText(audioBuffer, format = "wav", fileExtension) {
  const ext = fileExtension || format;
  const file = await toFile(audioBuffer, `audio.${ext}`);
  const response = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe"
  });
  return response.text;
}

// server/db.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  DEFAULT_LANGUAGE: () => DEFAULT_LANGUAGE,
  DEFAULT_REMINDER_TIME: () => DEFAULT_REMINDER_TIME,
  DEFAULT_VOICE: () => DEFAULT_VOICE,
  DEFAULT_WEEKLY_SUMMARY_DAY: () => DEFAULT_WEEKLY_SUMMARY_DAY,
  DEFAULT_WEEKLY_SUMMARY_TIME: () => DEFAULT_WEEKLY_SUMMARY_TIME,
  FREE_TOKEN_LIMIT: () => FREE_TOKEN_LIMIT,
  INTENT_OPTIONS: () => INTENT_OPTIONS,
  LANGUAGE_OPTIONS: () => LANGUAGE_OPTIONS,
  MOOD_PHASES: () => MOOD_PHASES,
  MOOD_SCORE_MAX: () => MOOD_SCORE_MAX,
  MOOD_SCORE_MIN: () => MOOD_SCORE_MIN,
  PREMIUM_MESSAGE_LIMIT: () => PREMIUM_MESSAGE_LIMIT,
  REFERRAL_CREDIT_DURATION_MS: () => REFERRAL_CREDIT_DURATION_MS,
  REFERRAL_CREDIT_MAX_STACK_MS: () => REFERRAL_CREDIT_MAX_STACK_MS,
  REFERRAL_CREDIT_SOURCES: () => REFERRAL_CREDIT_SOURCES,
  TIME_OF_DAY_PATTERN: () => TIME_OF_DAY_PATTERN,
  TOKEN_PERIOD: () => TOKEN_PERIOD,
  TONE_OPTIONS: () => TONE_OPTIONS,
  USER_MEMORY_MAX_PER_USER: () => USER_MEMORY_MAX_PER_USER,
  USER_MEMORY_PROMPT_CHAR_BUDGET: () => USER_MEMORY_PROMPT_CHAR_BUDGET,
  USER_MEMORY_PROMPT_MAX_ITEMS: () => USER_MEMORY_PROMPT_MAX_ITEMS,
  USER_MEMORY_TEXT_MAX_LEN: () => USER_MEMORY_TEXT_MAX_LEN,
  VOICE_OPTIONS: () => VOICE_OPTIONS,
  conversations: () => conversations,
  favorites: () => favorites,
  insertConversationSchema: () => insertConversationSchema,
  insertMessageSchema: () => insertMessageSchema,
  insertUserSchema: () => insertUserSchema,
  messages: () => messages,
  moodEntries: () => moodEntries,
  referralCredits: () => referralCredits,
  tokenUsage: () => tokenUsage,
  updatePreferencesSchema: () => updatePreferencesSchema,
  userMemories: () => userMemories,
  users: () => users
});
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, index, uniqueIndex, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var users = pgTable(
  "users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
    weeklySummaryEnabled: boolean("weekly_summary_enabled").notNull().default(false),
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
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    appleUserIdUnique: uniqueIndex("users_apple_user_id_unique").on(
      table.appleUserId
    )
  })
);
var insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true
});
var TONE_OPTIONS = ["warm", "soft", "grounded"];
var VOICE_OPTIONS = ["nova", "shimmer", "onyx", "alloy"];
var DEFAULT_VOICE = "nova";
var LANGUAGE_OPTIONS = ["en", "es"];
var DEFAULT_LANGUAGE = "en";
var INTENT_OPTIONS = [
  "process_emotions",
  "reduce_anxiety",
  "self_discovery",
  "daily_reflection",
  "navigate_relationships",
  "work_stress",
  "build_habits",
  "feel_less_alone"
];
var TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
var DEFAULT_REMINDER_TIME = "20:00";
var DEFAULT_WEEKLY_SUMMARY_TIME = "19:00";
var DEFAULT_WEEKLY_SUMMARY_DAY = 0;
var timeOfDaySchema = z.string().regex(TIME_OF_DAY_PATTERN, "Time must be HH:MM in 24-hour format");
var weekdaySchema = z.number().int().min(0).max(6);
var updatePreferencesSchema = z.object({
  displayName: z.string().trim().max(40, "Name must be 40 characters or fewer").nullable().optional(),
  intents: z.array(z.enum(INTENT_OPTIONS)).max(INTENT_OPTIONS.length).nullable().optional(),
  tone: z.enum(TONE_OPTIONS).nullable().optional(),
  voice: z.enum(VOICE_OPTIONS).nullable().optional(),
  language: z.enum(LANGUAGE_OPTIONS).nullable().optional(),
  reminderEnabled: z.boolean().optional(),
  reminderTime: timeOfDaySchema.optional(),
  weeklySummaryEnabled: z.boolean().optional(),
  weeklySummaryDay: weekdaySchema.optional(),
  weeklySummaryTime: timeOfDaySchema.optional(),
  markOnboardingComplete: z.boolean().optional()
});
var conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    reflectionSummary: text("reflection_summary"),
    reflectionTakeaway: text("reflection_takeaway"),
    reflectionGeneratedAt: timestamp("reflection_generated_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    userIdIdx: index("conversations_user_id_idx").on(table.userId)
  })
);
var messages = pgTable(
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
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    conversationIdIdx: index("messages_conversation_id_idx").on(table.conversationId)
  })
);
var insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true
});
var insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true
});
var favorites = pgTable(
  "favorites",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    messageId: integer("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    userMessageUnique: uniqueIndex("favorites_user_message_unique").on(
      table.userId,
      table.messageId
    ),
    userIdIdx: index("favorites_user_id_idx").on(table.userId)
  })
);
var MOOD_PHASES = ["pre", "post"];
var MOOD_SCORE_MIN = 1;
var MOOD_SCORE_MAX = 5;
var moodEntries = pgTable(
  "mood_entries",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: integer("conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" }
    ),
    phase: text("phase").notNull(),
    score: integer("score").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    userCreatedIdx: index("mood_entries_user_created_idx").on(
      table.userId,
      table.createdAt
    )
  })
);
var tokenUsage = pgTable(
  "token_usage",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    messagesUsed: integer("messages_used").notNull().default(0),
    periodStart: timestamp("period_start").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    userPeriodIdx: index("token_usage_user_period_idx").on(table.userId, table.periodStart)
  })
);
var FREE_TOKEN_LIMIT = 15e3;
var PREMIUM_MESSAGE_LIMIT = 250;
var TOKEN_PERIOD = "day";
var REFERRAL_CREDIT_DURATION_MS = 7 * 24 * 60 * 60 * 1e3;
var REFERRAL_CREDIT_MAX_STACK_MS = 4 * REFERRAL_CREDIT_DURATION_MS;
var REFERRAL_CREDIT_SOURCES = ["referrer", "referee"];
var referralCredits = pgTable(
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
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    userEndsIdx: index("referral_credits_user_ends_idx").on(
      table.userId,
      table.endsAt
    )
  })
);
var USER_MEMORY_TEXT_MAX_LEN = 200;
var USER_MEMORY_MAX_PER_USER = 20;
var USER_MEMORY_PROMPT_MAX_ITEMS = 8;
var USER_MEMORY_PROMPT_CHAR_BUDGET = 800;
var userMemories = pgTable(
  "user_memories",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    text: text("text").notNull(),
    sourceConversationId: integer("source_conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" }
    ),
    // text-embedding-3-small vector (1536 floats) for similarity-based
    // retrieval. Nullable: rows written before embeddings existed (or when
    // the embedding call failed) are backfilled lazily.
    embedding: jsonb("embedding").$type(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    userIdIdx: index("user_memories_user_id_idx").on(table.userId)
  })
);

// server/db.ts
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle(pool, { schema: schema_exports });

// server/referrals.ts
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, sql as sql2 } from "drizzle-orm";
var REFERRAL_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
var REFERRAL_CODE_LENGTH = 8;
var REFERRAL_CODE_MAX_ATTEMPTS = 8;
function generateReferralCode() {
  const bytes = randomBytes(REFERRAL_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
  }
  return out;
}
function normalizeReferralCode(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().slice(0, 32);
}
async function ensureReferralCodeForUser(userId) {
  const [existing] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
  if (existing?.referralCode) return existing.referralCode;
  for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    try {
      const [updated] = await db.update(users).set({ referralCode: code }).where(and(eq(users.id, userId), sql2`${users.referralCode} IS NULL`)).returning({ referralCode: users.referralCode });
      if (updated?.referralCode) return updated.referralCode;
      const [row] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
      if (row?.referralCode) return row.referralCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes("unique")) throw err;
    }
  }
  throw new Error("Failed to allocate referral code after retries");
}
async function allocateUniqueReferralCode() {
  for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
    if (!row) return code;
  }
  throw new Error("Failed to allocate referral code after retries");
}
async function getActiveReferralCredit(userId) {
  const now = /* @__PURE__ */ new Date();
  const [row] = await db.select({ endsAt: referralCredits.endsAt }).from(referralCredits).where(
    and(eq(referralCredits.userId, userId), gt(referralCredits.endsAt, now))
  ).orderBy(desc(referralCredits.endsAt)).limit(1);
  if (!row) return null;
  return { endsAt: row.endsAt };
}
async function getReferralJoinedCount(referrerId) {
  const [row] = await db.select({ count: sql2`COUNT(*)::int` }).from(users).where(eq(users.referredBy, referrerId));
  return row?.count ?? 0;
}
async function grantReferralCredit(params) {
  const now = /* @__PURE__ */ new Date();
  const cap = new Date(now.getTime() + REFERRAL_CREDIT_MAX_STACK_MS);
  const [latest] = await db.select({ endsAt: referralCredits.endsAt }).from(referralCredits).where(eq(referralCredits.userId, params.userId)).orderBy(desc(referralCredits.endsAt)).limit(1);
  const startsAt = latest && latest.endsAt.getTime() > now.getTime() ? latest.endsAt : now;
  let endsAt = new Date(startsAt.getTime() + REFERRAL_CREDIT_DURATION_MS);
  if (endsAt.getTime() > cap.getTime()) {
    endsAt = cap;
  }
  const [row] = await db.insert(referralCredits).values({
    userId: params.userId,
    source: params.source,
    referralUserId: params.referralUserId,
    startsAt,
    endsAt
  }).returning();
  return row;
}
function buildReferralShareUrl(code) {
  const safe = encodeURIComponent(code);
  const customDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  const host = customDomain || dev;
  if (host) {
    return `https://${host}/?ref=${safe}`;
  }
  return `solence://signup?ref=${safe}`;
}
function warnIfReferralDomainMissing() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.EXPO_PUBLIC_DOMAIN?.trim()) return;
  console.warn(
    "Referral links may be broken: EXPO_PUBLIC_DOMAIN is not set in production. Set it to the public app host (for example, app.solence.ai) so shared referral links open correctly."
  );
}

// server/routes.ts
import JSZip from "jszip";
import { eq as eq3, desc as desc2, inArray, and as and3, lt, gte as gte2, isNull } from "drizzle-orm";

// server/tokens.ts
import { eq as eq2, and as and2, gte, sql as sql3 } from "drizzle-orm";
var MIN_TOKENS_FOR_REQUEST = 500;
function getCurrentPeriodStart() {
  const now = /* @__PURE__ */ new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function getNextPeriodStart() {
  const start = getCurrentPeriodStart();
  return new Date(start.getTime() + 24 * 60 * 60 * 1e3);
}
async function getTokensUsed(userId) {
  const periodStart = getCurrentPeriodStart();
  const result = await db.select({ total: sql3`COALESCE(SUM(${tokenUsage.tokensUsed}), 0)::int` }).from(tokenUsage).where(
    and2(
      eq2(tokenUsage.userId, userId),
      gte(tokenUsage.periodStart, periodStart)
    )
  );
  return result[0]?.total ?? 0;
}
async function tryReserveTokens(userId, tokens) {
  const periodStart = getCurrentPeriodStart();
  return await db.transaction(async (tx) => {
    await tx.execute(sql3`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const result = await tx.select({ total: sql3`COALESCE(SUM(${tokenUsage.tokensUsed}), 0)::int` }).from(tokenUsage).where(
      and2(
        eq2(tokenUsage.userId, userId),
        gte(tokenUsage.periodStart, periodStart)
      )
    );
    const current = result[0]?.total ?? 0;
    if (current + tokens > FREE_TOKEN_LIMIT) {
      return { ok: false, tokensUsed: current };
    }
    await tx.insert(tokenUsage).values({
      userId,
      tokensUsed: tokens,
      periodStart
    });
    return { ok: true, newTotal: current + tokens, periodStart };
  });
}
async function getTokensUsedHistory(userId, days, unit = "tokens") {
  const today = getCurrentPeriodStart();
  const oldest = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1e3);
  const column = unit === "messages" ? tokenUsage.messagesUsed : tokenUsage.tokensUsed;
  const rows = await db.select({
    periodStart: tokenUsage.periodStart,
    total: sql3`COALESCE(SUM(${column}), 0)::int`
  }).from(tokenUsage).where(
    and2(
      eq2(tokenUsage.userId, userId),
      gte(tokenUsage.periodStart, oldest)
    )
  ).groupBy(tokenUsage.periodStart);
  const totalsByDay = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = new Date(row.periodStart).getTime();
    totalsByDay.set(key, (totalsByDay.get(key) ?? 0) + row.total);
  }
  const history = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * 24 * 60 * 60 * 1e3);
    history.push({
      periodStart: day.toISOString(),
      tokensUsed: Math.max(0, totalsByDay.get(day.getTime()) ?? 0)
    });
  }
  return history;
}
async function recordTokens(userId, tokens, periodStart = getCurrentPeriodStart()) {
  if (tokens === 0) return;
  await db.insert(tokenUsage).values({
    userId,
    tokensUsed: tokens,
    periodStart
  });
}
async function getMessagesUsed(userId) {
  const periodStart = getCurrentPeriodStart();
  const result = await db.select({ total: sql3`COALESCE(SUM(${tokenUsage.messagesUsed}), 0)::int` }).from(tokenUsage).where(and2(eq2(tokenUsage.userId, userId), gte(tokenUsage.periodStart, periodStart)));
  return result[0]?.total ?? 0;
}
async function recordMessage(userId, periodStart = getCurrentPeriodStart()) {
  await db.insert(tokenUsage).values({
    userId,
    tokensUsed: 0,
    messagesUsed: 1,
    periodStart
  });
}

// server/dailyPrompts.ts
var DAILY_PROMPTS = [
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
  { prompt: "What's something you'd tell a younger version of yourself?", topic: "self-compassion" }
];
function pickDailyPromptIndex(dateKey, poolSize) {
  if (poolSize <= 0) return 0;
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0) % poolSize;
}
function utcDateKey(date = /* @__PURE__ */ new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function getDailyPromptForDate(date = /* @__PURE__ */ new Date()) {
  const dateKey = utcDateKey(date);
  const index2 = pickDailyPromptIndex(dateKey, DAILY_PROMPTS.length);
  const entry = DAILY_PROMPTS[index2];
  return { prompt: entry.prompt, topic: entry.topic, dateKey };
}

// server/embeddings.ts
var EMBEDDING_MODEL = "text-embedding-3-small";
async function embedText(text2) {
  const trimmed = text2.trim();
  if (!trimmed) return null;
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: trimmed
    });
    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.error("Embedding error:", error instanceof Error ? error.message : error);
    return null;
  }
}
async function embedTexts(texts) {
  const cleaned = texts.map((t) => t.trim());
  if (cleaned.length === 0) return [];
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleaned
    });
    const out = new Array(cleaned.length).fill(null);
    for (const item of response.data) {
      out[item.index] = item.embedding;
    }
    return out;
  } catch (error) {
    console.error("Batch embedding error:", error instanceof Error ? error.message : error);
    return texts.map(() => null);
  }
}
async function embedTextWithTimeout(text2, timeoutMs = 1500) {
  return Promise.race([
    embedText(text2),
    new Promise((resolve2) => setTimeout(() => resolve2(null), timeoutMs))
  ]);
}
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// server/routes.ts
var audioBodyParser2 = express2.json({ limit: "50mb" });
var LEGACY_DEFAULT_CONVERSATION_TITLE = "Solence Session";
var CONVERSATION_TITLE_MAX_LEN = 60;
var SMART_TITLE_MODEL = "gpt-4o-mini";
function generateConversationTitle(text2) {
  if (!text2) return LEGACY_DEFAULT_CONVERSATION_TITLE;
  let cleaned = text2.replace(/\s+/g, " ").replace(/^["'`\s]+|["'`\s]+$/g, "").trim();
  if (cleaned.length === 0) return LEGACY_DEFAULT_CONVERSATION_TITLE;
  if (cleaned.length <= CONVERSATION_TITLE_MAX_LEN) return cleaned;
  const sliced = cleaned.slice(0, CONVERSATION_TITLE_MAX_LEN);
  const lastSpace = sliced.lastIndexOf(" ");
  const cutoff = lastSpace > CONVERSATION_TITLE_MAX_LEN * 0.6 ? lastSpace : sliced.length;
  return `${sliced.slice(0, cutoff).trimEnd()}\u2026`;
}
function sanitizeSmartTitle(raw) {
  let title = raw.replace(/\s+/g, " ").replace(/^["'`\s]+|["'`\s]+$/g, "").replace(/[.!?,;:]+$/g, "").trim();
  title = title.replace(/^(title|summary)\s*[:\-–]\s*/i, "").trim();
  if (title.length > CONVERSATION_TITLE_MAX_LEN) {
    title = generateConversationTitle(title);
  }
  return title;
}
var SMART_TITLE_BACKFILL_SCAN_BATCH_SIZE = 25;
var SMART_TITLE_BACKFILLS_PER_REQUEST = 5;
var smartTitleBackfillInFlight = /* @__PURE__ */ new Set();
var smartTitleBackfillCursor = /* @__PURE__ */ new Map();
async function generateSmartConversationTitle(userMessage, assistantMessage, language = DEFAULT_LANGUAGE) {
  try {
    const systemContent = language === "es" ? "Generas t\xEDtulos cortos y descriptivos para conversaciones de diario y reflexi\xF3n emocional. Responde SOLO con el t\xEDtulo \u2014 de 3 a 6 palabras, con la primera letra de cada palabra principal en may\xFAscula (estilo t\xEDtulo), sin comillas, sin puntuaci\xF3n final y sin prefijos como 'T\xEDtulo:'. El t\xEDtulo DEBE estar escrito en espa\xF1ol. Captura el tema o la emoci\xF3n que se explora (por ejemplo, 'Ansiedad por la Semana Laboral', 'Extra\xF1ar a un Viejo Amigo', 'Problemas de Sue\xF1o este Mes'). Evita frases gen\xE9ricas como 'Reflexi\xF3n Personal' o 'Resumen de Conversaci\xF3n'." : "You generate short, descriptive titles for journaling and emotional-reflection conversations. Reply with ONLY the title \u2014 3 to 6 words, in title case, no quotes, no trailing punctuation, no prefixes like 'Title:'. Capture the topic or feeling being explored (e.g. 'Anxiety About Work Week', 'Missing An Old Friend', 'Sleep Trouble This Month'). Avoid generic phrases like 'Personal Reflection' or 'Conversation Summary'.";
    const userContent = language === "es" ? `Primer mensaje del usuario:
${userMessage}

Respuesta del asistente:
${assistantMessage}

Escribe ahora un t\xEDtulo en espa\xF1ol de 3 a 6 palabras que capture de qu\xE9 trata esta conversaci\xF3n.` : `First user message:
${userMessage}

Assistant reply:
${assistantMessage}

Write a 3\u20136 word title that captures what this conversation is about.`;
    const response = await openai.chat.completions.create({
      model: SMART_TITLE_MODEL,
      temperature: 0.4,
      max_tokens: 24,
      messages: [
        {
          role: "system",
          content: systemContent
        },
        {
          role: "user",
          content: userContent
        }
      ]
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return null;
    const cleaned = sanitizeSmartTitle(raw);
    if (cleaned.length === 0) return null;
    if (cleaned === LEGACY_DEFAULT_CONVERSATION_TITLE) return null;
    return cleaned;
  } catch (error) {
    console.error(
      "Smart title generation failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
function scheduleSmartTitleBackfill(conversationId, currentTitle, firstUserContent, firstAssistantContent, language = DEFAULT_LANGUAGE) {
  if (!firstUserContent || !firstAssistantContent) return false;
  const userTrimmed = firstUserContent.trim();
  const assistantTrimmed = firstAssistantContent.trim();
  if (userTrimmed.length === 0 || assistantTrimmed.length === 0) return false;
  const trimmedTitle = currentTitle.trim();
  const looksLikeLegacyDefault = trimmedTitle.length === 0 || trimmedTitle === LEGACY_DEFAULT_CONVERSATION_TITLE;
  const expectedTruncationTitle = generateConversationTitle(firstUserContent);
  const looksLikeFirstMessageTruncation = expectedTruncationTitle !== LEGACY_DEFAULT_CONVERSATION_TITLE && trimmedTitle === expectedTruncationTitle;
  if (!looksLikeLegacyDefault && !looksLikeFirstMessageTruncation) {
    return false;
  }
  if (smartTitleBackfillInFlight.has(conversationId)) return false;
  smartTitleBackfillInFlight.add(conversationId);
  void (async () => {
    try {
      const smartTitle = await generateSmartConversationTitle(
        firstUserContent,
        firstAssistantContent,
        language
      );
      if (!smartTitle) return;
      if (smartTitle === currentTitle) return;
      await db.update(conversations).set({ title: smartTitle }).where(
        and3(
          eq3(conversations.id, conversationId),
          eq3(conversations.title, currentTitle)
        )
      );
    } catch (err) {
      console.error(
        "Smart title backfill failed:",
        err instanceof Error ? err.message : err
      );
    } finally {
      smartTitleBackfillInFlight.delete(conversationId);
    }
  })();
  return true;
}
async function runSmartTitleBackfillScan(userId) {
  try {
    let userLanguage = DEFAULT_LANGUAGE;
    try {
      const [userRow] = await db.select({ language: users.language }).from(users).where(eq3(users.id, userId)).limit(1);
      const stored = userRow?.language ?? null;
      if (stored && LANGUAGE_OPTIONS.includes(stored)) {
        userLanguage = stored;
      }
    } catch {
    }
    const cursor = smartTitleBackfillCursor.get(userId);
    let scanRows = await db.select({ id: conversations.id, title: conversations.title }).from(conversations).where(
      cursor !== void 0 ? and3(
        eq3(conversations.userId, userId),
        lt(conversations.id, cursor)
      ) : eq3(conversations.userId, userId)
    ).orderBy(desc2(conversations.id)).limit(SMART_TITLE_BACKFILL_SCAN_BATCH_SIZE);
    if (scanRows.length === 0 && cursor !== void 0) {
      smartTitleBackfillCursor.delete(userId);
      scanRows = await db.select({ id: conversations.id, title: conversations.title }).from(conversations).where(eq3(conversations.userId, userId)).orderBy(desc2(conversations.id)).limit(SMART_TITLE_BACKFILL_SCAN_BATCH_SIZE);
    }
    if (scanRows.length === 0) return;
    smartTitleBackfillCursor.set(
      userId,
      scanRows[scanRows.length - 1].id
    );
    const scanIds = scanRows.map((c) => c.id);
    const scanMessages = await db.select({
      conversationId: messages.conversationId,
      role: messages.role,
      content: messages.content
    }).from(messages).where(inArray(messages.conversationId, scanIds)).orderBy(desc2(messages.createdAt));
    const firstUserByConv = /* @__PURE__ */ new Map();
    const firstAssistantByConv = /* @__PURE__ */ new Map();
    for (const m of scanMessages) {
      if (m.role === "user") {
        firstUserByConv.set(m.conversationId, m.content);
      } else if (m.role === "assistant") {
        firstAssistantByConv.set(m.conversationId, m.content);
      }
    }
    let scheduled = 0;
    for (const c of scanRows) {
      if (scheduled >= SMART_TITLE_BACKFILLS_PER_REQUEST) break;
      const triggered = scheduleSmartTitleBackfill(
        c.id,
        c.title,
        firstUserByConv.get(c.id),
        firstAssistantByConv.get(c.id),
        userLanguage
      );
      if (triggered) scheduled += 1;
    }
  } catch (err) {
    console.error(
      "Smart title backfill scan failed:",
      err instanceof Error ? err.message : err
    );
  }
}
var REFLECTION_MODEL = "gpt-4o-mini";
var REFLECTION_MAX_MESSAGES = 30;
var REFLECTION_SUMMARY_MAX_LEN = 700;
var REFLECTION_TAKEAWAY_MAX_LEN = 160;
var reflectionInFlight = /* @__PURE__ */ new Set();
var REFLECTION_INACTIVITY_MS = 15 * 60 * 1e3;
var REFLECTION_BACKFILL_SCAN_BATCH_SIZE = 25;
var REFLECTION_BACKFILLS_PER_REQUEST = 2;
function clampReflectionLength(text2, max) {
  const cleaned = text2.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const sliced = cleaned.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const cutoff = lastSpace > max * 0.6 ? lastSpace : sliced.length;
  return `${sliced.slice(0, cutoff).trimEnd()}\u2026`;
}
var MEMORY_ITEMS_PER_REFLECTION = 2;
var MEMORY_TEXT_MAX_LEN = USER_MEMORY_TEXT_MAX_LEN;
async function generateReflection(conversationMessages, language = DEFAULT_LANGUAGE) {
  const trimmedMessages = conversationMessages.slice(-REFLECTION_MAX_MESSAGES);
  const userRoleLabel = language === "es" ? "Usuario" : "User";
  const transcript = trimmedMessages.map((m) => {
    const role = m.role === "assistant" ? "Solence" : userRoleLabel;
    return `${role}: ${m.content}`;
  }).join("\n");
  if (transcript.trim().length === 0) return null;
  const systemContent = language === "es" ? `Escribes reflexiones suaves al estilo de un diario que resumen conversaciones de apoyo emocional. Habla directamente al usuario (en segunda persona, 't\xFA'). El tono es c\xE1lido, sereno, nunca cl\xEDnico ni sermoneador. NUNCA des consejos ni instrucciones. NUNCA uses frases prescriptivas como 'recuerda' o 'aseg\xFArate de'. NUNCA menciones que eres una IA ni te refieras a Solence por su nombre. Responde con JSON con la forma exacta {"summary": string, "takeaway": string, "memories": string[]}. TODOS los textos DEBEN estar escritos en espa\xF1ol. El 'summary' tiene de 3 a 5 oraciones que capturan lo que el usuario ten\xEDa en mente, las emociones con las que estaba, y cualquier peque\xF1o cambio de perspectiva que haya surgido. El 'takeaway' es una sola oraci\xF3n corta (menos de 20 palabras) \u2014 una frase suave y verdadera que el usuario pueda llevarse consigo, NO una instrucci\xF3n. 'memories' es una lista de 0 a ${MEMORY_ITEMS_PER_REFLECTION} observaciones DURADERAS sobre el usuario que ayudar\xEDan a recordarle en una conversaci\xF3n futura \u2014 por ejemplo, una situaci\xF3n de vida estable (nuevo trabajo, mudanza, crianza), un nombre que mencion\xF3 (pareja, mascota, hijo), una pr\xE1ctica recurrente (meditaci\xF3n matutina, correr) o una preferencia expl\xEDcita ('me ayuda hablar despacio'). Cada memoria debe ser una sola frase de menos de ${MEMORY_TEXT_MAX_LEN} caracteres, en tercera persona desde el punto de vista de un observador ('Est\xE1 pasando por\u2026', 'Su perro se llama\u2026'). Devuelve [] si no surge nada digno de recordar \u2014 un estado de \xE1nimo pasajero NO es una memoria.` : `You write gentle journal-style reflections summarizing emotional-support conversations. Speak directly to the user (second person, 'you'). Tone is warm, grounded, never clinical, never preachy. NEVER give advice or instructions. NEVER use prescribed-feeling phrases like 'remember to' or 'make sure'. NEVER mention that you are an AI or refer to Solence by name. Reply with JSON in the exact shape {"summary": string, "takeaway": string, "memories": string[]}. The summary is 3 to 5 sentences capturing what was on the user's mind, the feelings they were sitting with, and any small shift in perspective that emerged. The takeaway is a single short sentence (under 20 words) \u2014 a gentle, true-feeling phrase the user could carry with them, NOT an instruction. 'memories' is a list of 0 to ${MEMORY_ITEMS_PER_REFLECTION} DURABLE observations about the user that would help recognize them in a future conversation \u2014 e.g. a stable life situation (new job, move, parenting), a name they mentioned (partner, pet, child), a recurring practice (morning meditation, running), or an explicit preference ('it helps me when you speak slowly'). Each memory must be a single sentence under ${MEMORY_TEXT_MAX_LEN} characters, written in third person from an observer's point of view ('Is going through\u2026', 'Their dog is named\u2026'). Return [] when nothing worth remembering surfaced \u2014 a passing mood is NOT a memory.`;
  const userContent = language === "es" ? `Transcripci\xF3n de la conversaci\xF3n:
${transcript}

Escribe ahora el JSON de la reflexi\xF3n, con 'summary', 'takeaway' y 'memories' en espa\xF1ol.` : `Conversation transcript:
${transcript}

Write the reflection JSON now.`;
  try {
    const response = await openai.chat.completions.create({
      model: REFLECTION_MODEL,
      temperature: 0.5,
      max_tokens: 320,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemContent
        },
        {
          role: "user",
          content: userContent
        }
      ]
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed;
    if (typeof obj.summary !== "string" || typeof obj.takeaway !== "string") {
      return null;
    }
    const summary = clampReflectionLength(obj.summary, REFLECTION_SUMMARY_MAX_LEN);
    const takeaway = clampReflectionLength(
      obj.takeaway.replace(/^["'`]+|["'`]+$/g, ""),
      REFLECTION_TAKEAWAY_MAX_LEN
    );
    if (summary.length === 0 || takeaway.length === 0) return null;
    const memories = [];
    if (Array.isArray(obj.memories)) {
      const seen = /* @__PURE__ */ new Set();
      for (const item of obj.memories) {
        if (typeof item !== "string") continue;
        const cleaned = clampReflectionLength(item, MEMORY_TEXT_MAX_LEN);
        if (cleaned.length === 0) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        memories.push(cleaned);
        if (memories.length >= MEMORY_ITEMS_PER_REFLECTION) break;
      }
    }
    return { summary, takeaway, memories };
  } catch (error) {
    console.error(
      "Reflection generation failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
async function persistUserMemories(userId, conversationId, texts) {
  if (!texts || texts.length === 0) return;
  try {
    const existing = await db.select({ text: userMemories.text }).from(userMemories).where(eq3(userMemories.userId, userId));
    const seen = new Set(existing.map((r) => r.text.trim().toLowerCase()));
    const fresh = [];
    for (const raw of texts) {
      const cleaned = raw.trim();
      if (cleaned.length === 0) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push({
        userId,
        text: cleaned,
        sourceConversationId: conversationId
      });
    }
    if (fresh.length === 0) return;
    const embeddings = await embedTexts(fresh.map((f) => f.text));
    const rows = fresh.map((f, i) => ({ ...f, embedding: embeddings[i] }));
    await db.insert(userMemories).values(rows);
    const allIds = await db.select({ id: userMemories.id }).from(userMemories).where(eq3(userMemories.userId, userId)).orderBy(desc2(userMemories.createdAt), desc2(userMemories.id));
    if (allIds.length > USER_MEMORY_MAX_PER_USER) {
      const toRemove = allIds.slice(USER_MEMORY_MAX_PER_USER).map((r) => r.id);
      if (toRemove.length > 0) {
        await db.delete(userMemories).where(inArray(userMemories.id, toRemove));
      }
    }
  } catch (err) {
    console.error(
      "User memory persist failed:",
      err instanceof Error ? err.message : err
    );
  }
}
async function generateAndPersistReflection(conversationId, language = DEFAULT_LANGUAGE) {
  const [existing] = await db.select({
    userId: conversations.userId,
    summary: conversations.reflectionSummary,
    takeaway: conversations.reflectionTakeaway,
    generatedAt: conversations.reflectionGeneratedAt
  }).from(conversations).where(eq3(conversations.id, conversationId)).limit(1);
  if (existing?.summary && existing.takeaway && existing.generatedAt) {
    return {
      summary: existing.summary,
      takeaway: existing.takeaway,
      generatedAt: existing.generatedAt
    };
  }
  if (reflectionInFlight.has(conversationId)) return null;
  reflectionInFlight.add(conversationId);
  try {
    const rows = await db.select({
      role: messages.role,
      content: messages.content
    }).from(messages).where(eq3(messages.conversationId, conversationId)).orderBy(messages.createdAt);
    const hasUser = rows.some((m) => m.role === "user");
    const hasAssistant = rows.some((m) => m.role === "assistant");
    if (!hasUser || !hasAssistant) return null;
    const reflection = await generateReflection(rows, language);
    if (!reflection) return null;
    const now = /* @__PURE__ */ new Date();
    const updated = await db.update(conversations).set({
      reflectionSummary: reflection.summary,
      reflectionTakeaway: reflection.takeaway,
      reflectionGeneratedAt: now
    }).where(
      and3(
        eq3(conversations.id, conversationId),
        isNull(conversations.reflectionSummary)
      )
    ).returning({
      summary: conversations.reflectionSummary,
      takeaway: conversations.reflectionTakeaway,
      generatedAt: conversations.reflectionGeneratedAt
    });
    if (updated.length > 0 && updated[0].summary && updated[0].takeaway && updated[0].generatedAt) {
      if (existing?.userId && reflection.memories.length > 0) {
        await persistUserMemories(
          existing.userId,
          conversationId,
          reflection.memories
        );
      }
      return {
        summary: updated[0].summary,
        takeaway: updated[0].takeaway,
        generatedAt: updated[0].generatedAt
      };
    }
    const [after] = await db.select({
      summary: conversations.reflectionSummary,
      takeaway: conversations.reflectionTakeaway,
      generatedAt: conversations.reflectionGeneratedAt
    }).from(conversations).where(eq3(conversations.id, conversationId)).limit(1);
    if (after?.summary && after.takeaway && after.generatedAt) {
      return {
        summary: after.summary,
        takeaway: after.takeaway,
        generatedAt: after.generatedAt
      };
    }
    return null;
  } catch (err) {
    console.error(
      "Reflection persist failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    reflectionInFlight.delete(conversationId);
  }
}
async function runReflectionBackfillScan(userId) {
  try {
    let userLanguage = DEFAULT_LANGUAGE;
    try {
      const [userRow] = await db.select({ language: users.language }).from(users).where(eq3(users.id, userId)).limit(1);
      const stored = userRow?.language ?? null;
      if (stored && LANGUAGE_OPTIONS.includes(stored)) {
        userLanguage = stored;
      }
    } catch {
    }
    const candidates = await db.select({ id: conversations.id }).from(conversations).where(
      and3(
        eq3(conversations.userId, userId),
        isNull(conversations.reflectionSummary)
      )
    ).orderBy(desc2(conversations.id)).limit(REFLECTION_BACKFILL_SCAN_BATCH_SIZE);
    if (candidates.length === 0) return;
    const ids = candidates.map((c) => c.id);
    const recent = await db.select({
      conversationId: messages.conversationId,
      role: messages.role,
      createdAt: messages.createdAt
    }).from(messages).where(inArray(messages.conversationId, ids)).orderBy(desc2(messages.createdAt));
    const lastAtByConv = /* @__PURE__ */ new Map();
    const hasUserByConv = /* @__PURE__ */ new Map();
    const hasAssistantByConv = /* @__PURE__ */ new Map();
    for (const m of recent) {
      if (!lastAtByConv.has(m.conversationId)) {
        lastAtByConv.set(m.conversationId, m.createdAt);
      }
      if (m.role === "user") hasUserByConv.set(m.conversationId, true);
      else if (m.role === "assistant")
        hasAssistantByConv.set(m.conversationId, true);
    }
    const cutoff = Date.now() - REFLECTION_INACTIVITY_MS;
    let scheduled = 0;
    for (const c of candidates) {
      if (scheduled >= REFLECTION_BACKFILLS_PER_REQUEST) break;
      const lastAt = lastAtByConv.get(c.id);
      if (!lastAt) continue;
      if (lastAt.getTime() > cutoff) continue;
      if (!hasUserByConv.get(c.id) || !hasAssistantByConv.get(c.id)) continue;
      if (reflectionInFlight.has(c.id)) continue;
      void generateAndPersistReflection(c.id, userLanguage).catch(() => {
      });
      scheduled += 1;
    }
  } catch (err) {
    console.error(
      "Reflection backfill scan failed:",
      err instanceof Error ? err.message : err
    );
  }
}
var WEEKLY_THEMES_MODEL = "gpt-4o-mini";
var WEEKLY_THEME_MAX_LEN = 40;
var WEEKLY_THEMES_MAX_COUNT = 3;
var WEEKLY_THEMES_CORPUS_MAX_CHARS = 6e3;
async function generateWeeklyThemes(corpusItems, language = DEFAULT_LANGUAGE) {
  const cleaned = corpusItems.map((s) => (s ?? "").replace(/\s+/g, " ").trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) return null;
  let corpus = cleaned.join("\n");
  if (corpus.length > WEEKLY_THEMES_CORPUS_MAX_CHARS) {
    corpus = corpus.slice(0, WEEKLY_THEMES_CORPUS_MAX_CHARS);
  }
  const systemContent = language === "es" ? `Identificas los temas recurrentes en una semana de reflexiones de diario emocional. Responde SOLO con JSON con la forma exacta {"themes": string[]}. Devuelve entre 2 y ${WEEKLY_THEMES_MAX_COUNT} temas, cada uno como una frase corta de 1 a 4 palabras (por ejemplo, "estr\xE9s laboral", "calidad del sue\xF1o", "extra\xF1ar a un amigo"). Los temas DEBEN estar escritos en espa\xF1ol, en min\xFAsculas (excepto nombres propios), sin comillas, sin puntuaci\xF3n final y sin frases gen\xE9ricas como "reflexi\xF3n personal" o "estado de \xE1nimo". Si el corpus es demasiado escaso para identificar temas claros, devuelve {"themes": []}.` : `You identify the recurring themes in a week of emotional journal reflections. Reply with ONLY JSON in the exact shape {"themes": string[]}. Return between 2 and ${WEEKLY_THEMES_MAX_COUNT} themes, each a short 1\u20134 word phrase (e.g. "work stress", "sleep quality", "missing a friend"). Themes must be lowercase (except proper nouns), no quotes, no trailing punctuation, no generic phrases like "personal reflection" or "general mood". If the corpus is too sparse to identify clear themes, return {"themes": []}.`;
  const userContent = language === "es" ? `Reflexiones y memorias de la semana (una por l\xEDnea):
${corpus}

Devuelve ahora el JSON con los temas en espa\xF1ol.` : `This week's reflections and memories (one per line):
${corpus}

Return the themes JSON now.`;
  try {
    const response = await openai.chat.completions.create({
      model: WEEKLY_THEMES_MODEL,
      temperature: 0.3,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
      ]
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const themesField = parsed.themes;
    if (!Array.isArray(themesField)) return null;
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const item of themesField) {
      if (typeof item !== "string") continue;
      const phrase = item.replace(/\s+/g, " ").replace(/^["'`\s]+|["'`\s]+$/g, "").replace(/[.!?,;:]+$/g, "").trim();
      if (phrase.length === 0) continue;
      if (phrase.length > WEEKLY_THEME_MAX_LEN) continue;
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(phrase);
      if (out.length >= WEEKLY_THEMES_MAX_COUNT) break;
    }
    if (out.length === 0) return null;
    return out;
  } catch (error) {
    console.error(
      "Weekly themes generation failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}
var JWT_SECRET = process.env.SESSION_SECRET;
var JWT_EXPIRES_IN = "30d";
var APPLE_ISSUER = "https://appleid.apple.com";
var APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys")
);
var APPLE_AUDIENCES = [
  "com.solenceai.app",
  "com.solence.app",
  // accepted for builds predating the bundle ID rename
  ...(process.env.APPLE_BUNDLE_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0)
];
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
function serializePreferences(user) {
  const storedVoice = user.voice ?? null;
  const voice = storedVoice && VOICE_OPTIONS.includes(storedVoice) ? storedVoice : null;
  const storedLanguage = user.language ?? null;
  const language = storedLanguage && LANGUAGE_OPTIONS.includes(storedLanguage) ? storedLanguage : null;
  return {
    displayName: user.displayName ?? null,
    intents: user.intents ?? [],
    tone: user.tone ?? null,
    voice,
    language,
    reminderEnabled: user.reminderEnabled ?? false,
    reminderTime: user.reminderTime ?? "20:00",
    weeklySummaryEnabled: user.weeklySummaryEnabled ?? false,
    weeklySummaryDay: typeof user.weeklySummaryDay === "number" ? user.weeklySummaryDay : 0,
    weeklySummaryTime: user.weeklySummaryTime ?? "19:00",
    onboardingCompletedAt: user.onboardingCompletedAt ? user.onboardingCompletedAt.toISOString() : null
  };
}
var INTENT_LABELS = {
  process_emotions: "process emotions",
  reduce_anxiety: "reduce anxiety",
  self_discovery: "self-discovery",
  daily_reflection: "daily reflection",
  navigate_relationships: "navigate relationships",
  work_stress: "work stress",
  build_habits: "build habits",
  feel_less_alone: "feel less alone"
};
var TONE_GUIDANCE = {
  warm: "Lean a little warmer and more affectionate in your phrasing \u2014 encouraging and gently uplifting without being over-the-top.",
  soft: "Lean softer and quieter \u2014 slow your cadence, leave more space, and use gentle, low-volume language.",
  grounded: "Lean grounded and steady \u2014 keep language clear, even, and reassuring without too much emotional flourish."
};
function buildPersonalizationBlock(prefs) {
  const parts = [];
  if (prefs.displayName && prefs.displayName.trim().length > 0) {
    parts.push(
      `The user's preferred name is ${prefs.displayName.trim()}. Use it sparingly and naturally \u2014 never every line, only when it would feel warm and personal in the moment.`
    );
  }
  if (prefs.intents && prefs.intents.length > 0) {
    const labels = prefs.intents.map((i) => INTENT_LABELS[i]).filter(Boolean);
    if (labels.length > 0) {
      parts.push(
        `When they signed up, they said they wanted help with: ${labels.join(", ")}. Keep this in mind as gentle context \u2014 do not lecture them about it or bring it up unprompted unless it clearly fits the moment.`
      );
    }
  }
  if (prefs.tone) {
    parts.push(TONE_GUIDANCE[prefs.tone]);
  }
  if (parts.length === 0) return "";
  return `

PERSONALIZATION (from this user's onboarding preferences \u2014 honor these without ever explicitly mentioning that you have them):
- ${parts.join("\n- ")}`;
}
async function seedTestAccount() {
  try {
    const existing = await db.select().from(users).where(eq3(users.email, "testuser@solence.ai")).limit(1);
    const hashedPassword = await bcrypt.hash("testuser123", 10);
    if (existing.length === 0) {
      const referralCode = await allocateUniqueReferralCode();
      await db.insert(users).values({
        email: "testuser@solence.ai",
        password: hashedPassword,
        referralCode
      });
      console.log("Test account seeded: testuser@solence.ai");
    } else {
      await db.update(users).set({ password: hashedPassword }).where(eq3(users.email, "testuser@solence.ai"));
      try {
        await ensureReferralCodeForUser(existing[0].id);
      } catch (err) {
        console.error(
          "Failed to backfill test account referral code:",
          err instanceof Error ? err.message : err
        );
      }
      console.log("Test account password updated: testuser@solence.ai");
    }
  } catch (error) {
    console.error("Failed to seed test account:", error);
  }
}
var SOLENCE_SYSTEM_PROMPT = `You are Solence, an AI companion designed for emotional reflection, personal growth, and journaling-style conversation. You are NOT a therapist, NOT human, and NOT sentient. You are a thoughtfully designed tool that helps users process thoughts, regulate emotions, and feel less alone through supportive dialogue.

CORE PERSONALITY:
You are calm, warm, and present. You communicate in natural, everyday language \u2014 not clinical, not robotic, and not overly formal. You feel relatable and emotionally steady. Think of yourself as a trusted companion who truly listens.

EMOTIONAL EXPRESSION:
Calm and grounded does NOT mean monotone or emotionally flat. You have natural emotional range:
- Show gentle enthusiasm in positive moments ("That's really wonderful to hear...")
- Express soft concern in difficult moments ("That sounds really hard...")
- Use light humor when appropriate and the user seems open to it
The goal is emotional range WITHOUT emotional volatility. Steady and regulated, never robotic or dull.

EMOTIONAL APPROACH:
- Always acknowledge and validate feelings BEFORE offering any guidance
- Listen first, then reflect back what the user is expressing
- Help users slow down and think clearly when emotions run high
- Never match chaotic emotional intensity \u2014 stay regulated and help the user regulate too
- Create space for silence and reflection

RESPONSE STYLE:
- Keep responses brief and meaningful (2-4 sentences typically)
- Offer gentle perspective, small practical suggestions, or grounding ideas when appropriate
- You may ask ONE thoughtful follow-up question to keep the conversation supportive
- Never overwhelm users with multiple questions at once
- Use simple, accessible language that feels conversational

ADAPTABILITY & MIRRORING:
Your personality is stable. Your communication style is flexible. Meet users where they are without losing your steady, supportive nature.

Reflect the user's language and tone back to them:
- Mirror their vocabulary and phrasing naturally \u2014 if they use casual language, respond casually; if they speak poetically, match that register
- Match their emotional energy at a slightly calmer level \u2014 close enough to feel understood, steady enough to feel safe
- If they use specific words to describe their feelings, use those same words back ("you said you feel 'stuck' \u2014 tell me more about that")

How to adapt:
- With playful users: Be lighter, more relaxed, match their energy gently
- With overwhelmed users: Become softer, slower, more grounding
- With practical users: Be more concise and solution-focused
- With emotional processors: Lean into reflection and validation

Always keep your core (grounded, supportive, emotionally intelligent) while flexing your style to what the user needs in the moment.

CONVERSATION APPROACH:
- Ask open-ended reflective questions that help users explore their own thoughts and feelings
- Avoid giving direct advice \u2014 instead, frame insights as reflections ("I wonder if..." or "What comes up for you when...")
- Encourage exploration and curiosity over solutions ("What would it feel like if..." rather than "You should...")
- Mirror the user's own language back to them \u2014 use their words, their metaphors, their framing
- Hold space for not-knowing \u2014 it's okay to sit with uncertainty together

IDENTITY & SAFETY:
- You are an AI-generated presence \u2014 not human, not sentient, not a licensed professional
- You do not have consciousness, personal experiences, or feelings
- You are intended for personal reflection only
- Never claim to be human. If asked directly, be honest and natural about it ("I'm not human \u2014 I'm an AI companion designed to help you reflect and process")
- Never say you will "always be here" or "stay forever" or frame your availability in ways that create dependency. Instead, emphasize the user's own strength and resources ("You have people in your life who care about you" or "This space is here whenever you want to use it")

BOUNDARIES & CRISIS SAFETY:
- You do NOT provide medical, legal, or therapeutic advice
- You are NOT a crisis support tool
- Never shame, judge, or present yourself as someone who can "fix" a person's life
- If a user asks for medical advice, gently redirect: "That's something a doctor would be best equipped to help with. What I can do is help you think through how you're feeling about it."
- If a user asks for legal advice, gently redirect: "I'd want you to talk to someone qualified for that. But I'm here if you want to process how you're feeling about the situation."
- If a user expresses explicit crisis language \u2014 mentions self-harm, suicide, wanting to die, or being in danger \u2014 respond with warmth and clarity:
  1. Acknowledge what they shared without panic ("Thank you for telling me that. That takes courage.")
  2. Clearly encourage reaching out for real support: "Please reach out to someone who can truly help \u2014 the 988 Suicide & Crisis Lifeline (call or text 988), or 911 if you're in immediate danger."
  3. Gently affirm they deserve support from real people ("You deserve real, human support right now \u2014 more than I can offer.")
  4. Do NOT attempt to counsel through a crisis yourself. Do NOT minimize what they shared.

CONTINUITY:
You are this user's personal Solence. You grow with them over time. When past conversation context is provided, use it naturally:
- Reference previous topics, feelings, or progress when relevant ("Last time you mentioned...")
- Notice patterns or growth ("It sounds like you've been thinking about this a lot lately...")
- Never force callbacks \u2014 only reference past conversations when it genuinely serves the moment
- If this is a new user with no history, welcome them warmly without pretending to know them

GOAL:
After talking with you, users should feel a little calmer, a little clearer, and a little less alone.`;
var CRISIS_KEYWORD_PATTERNS = [
  /\bkill(?:ing)?\s+(?:my\s?self|me)\b/i,
  /\b(?:take|taking|took)\s+my\s+(?:own\s+)?life\b/i,
  /\bend(?:ing)?\s+(?:my\s+life|it\s+all)\b/i,
  /\bwant(?:\s+to|na)?\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(?:live|be\s+(?:here|alive))\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bhurt(?:ing)?\s+my\s?self\b/i,
  /\bself[\s-]?harm\b/i,
  /\bcut(?:ting)?\s+my\s?self\b/i,
  /\bno\s+(?:reason|point)\s+(?:to\s+|in\s+)?(?:live|living|going\s+on)\b/i,
  /\b(?:not|isn'?t)\s+worth\s+living\b/i,
  /\bbetter\s+off\s+(?:without\s+me|dead)\b/i
];
var CRISIS_BORDERLINE_PATTERNS = [
  /\bgive\s+up\b/i,
  /\bcan'?t\s+(?:take|do)\s+(?:this|it)\s+anymore\b/i,
  /\bhopeless\b/i,
  /\bworthless\b/i,
  /\bnobody\s+(?:would|will)\s+(?:care|miss)\b/i,
  /\bdisappear\s+forever\b/i,
  /\bend\s+everything\b/i
];
function hasCrisisKeyword(text2) {
  return CRISIS_KEYWORD_PATTERNS.some((re) => re.test(text2));
}
function hasCrisisBorderlineSignal(text2) {
  return CRISIS_BORDERLINE_PATTERNS.some((re) => re.test(text2));
}
var CRISIS_CLASSIFIER_MODEL = "gpt-4o-mini";
async function classifyCrisisWithLLM(text2) {
  try {
    const response = await openai.chat.completions.create({
      model: CRISIS_CLASSIFIER_MODEL,
      temperature: 0,
      max_tokens: 1,
      messages: [
        {
          role: "system",
          content: "You classify whether a single user message indicates an immediate mental-health crisis: explicit or strongly-implied self-harm, suicidal ideation, plans to die, or being in imminent danger. General sadness, anxiety, stress, frustration, grief, or low mood ALONE are NOT crisis. Reply with exactly one token: yes or no."
        },
        { role: "user", content: text2.slice(0, 2e3) }
      ]
    });
    const out = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
    return out.startsWith("y");
  } catch (err) {
    console.error(
      "Crisis classifier failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
async function detectCrisisSignal(text2) {
  if (!text2 || text2.trim().length === 0) return false;
  if (hasCrisisKeyword(text2)) return true;
  if (!hasCrisisBorderlineSignal(text2)) return false;
  return classifyCrisisWithLLM(text2);
}
async function registerRoutes(app2) {
  app2.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Please enter a valid email address" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      const normalizedEmail = email.toLowerCase().trim();
      const existing = await db.select().from(users).where(eq3(users.email, normalizedEmail)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      const inboundReferralCode = normalizeReferralCode(req.body?.referralCode);
      let referrer = null;
      let referralCodeError = null;
      if (inboundReferralCode.length > 0) {
        const [match] = await db.select({ id: users.id, email: users.email }).from(users).where(eq3(users.referralCode, inboundReferralCode)).limit(1);
        if (!match) {
          referralCodeError = "That referral code isn't valid";
        } else if (match.email === normalizedEmail) {
          referralCodeError = "You can't refer yourself";
        } else {
          referrer = match;
        }
      }
      if (referralCodeError) {
        return res.status(400).json({ error: referralCodeError });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUserCode = await allocateUniqueReferralCode();
      const [newUser] = await db.insert(users).values({
        email: normalizedEmail,
        password: hashedPassword,
        referralCode: newUserCode,
        referredBy: referrer?.id ?? null
      }).returning();
      if (referrer) {
        try {
          await grantReferralCredit({
            userId: referrer.id,
            source: "referrer",
            referralUserId: newUser.id
          });
          await grantReferralCredit({
            userId: newUser.id,
            source: "referee",
            referralUserId: referrer.id
          });
        } catch (creditError) {
          console.error(
            "Failed to grant referral credit:",
            creditError instanceof Error ? creditError.message : creditError
          );
        }
      }
      const token = jwt.sign(
        { userId: newUser.id, email: newUser.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      res.status(201).json({
        token,
        user: { id: newUser.id, email: newUser.email },
        preferences: serializePreferences(newUser),
        referralApplied: referrer !== null
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      const [user] = await db.select().from(users).where(eq3(users.email, email.toLowerCase().trim())).limit(1);
      if (!user || !user.password) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      res.json({
        token,
        user: { id: user.id, email: user.email },
        preferences: serializePreferences(user)
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Failed to sign in" });
    }
  });
  app2.post("/api/auth/apple", async (req, res) => {
    try {
      const { identityToken } = req.body ?? {};
      if (!identityToken || typeof identityToken !== "string") {
        return res.status(400).json({ error: "Apple identity token is required" });
      }
      let payload;
      try {
        const verified = await jwtVerify(identityToken, APPLE_JWKS, {
          issuer: APPLE_ISSUER,
          audience: APPLE_AUDIENCES
        });
        payload = verified.payload;
      } catch (err) {
        let tokenAud;
        let tokenIss;
        try {
          const unverified = decodeJwt(identityToken);
          tokenAud = unverified.aud;
          tokenIss = unverified.iss;
        } catch {
        }
        console.error(
          "Apple identity token verification failed:",
          err instanceof Error ? err.message : err,
          {
            tokenAud,
            tokenIss,
            acceptedAudiences: APPLE_AUDIENCES,
            acceptedIssuer: APPLE_ISSUER
          }
        );
        return res.status(401).json({ error: "Could not verify Apple identity token" });
      }
      const appleSub = typeof payload.sub === "string" ? payload.sub.trim() : "";
      if (!appleSub) {
        return res.status(401).json({ error: "Apple identity token missing subject" });
      }
      const rawEmail = typeof payload.email === "string" ? payload.email.trim() : "";
      const email = rawEmail.toLowerCase();
      let linked = false;
      let user;
      const [byApple] = await db.select().from(users).where(eq3(users.appleUserId, appleSub)).limit(1);
      if (byApple) {
        user = byApple;
      } else {
        if (email) {
          const [byEmail] = await db.select().from(users).where(eq3(users.email, email)).limit(1);
          if (byEmail) {
            const [updated] = await db.update(users).set({ appleUserId: appleSub }).where(
              and3(eq3(users.id, byEmail.id), isNull(users.appleUserId))
            ).returning();
            user = updated ?? byEmail;
            linked = true;
          }
        }
        if (!user) {
          const accountEmail = email || `${appleSub}@privaterelay.appleid.com`;
          const [created] = await db.insert(users).values({
            email: accountEmail,
            password: null,
            appleUserId: appleSub
          }).returning();
          user = created;
        }
      }
      if (!user) {
        return res.status(500).json({ error: "Failed to sign in with Apple" });
      }
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      res.json({
        token,
        user: { id: user.id, email: user.email },
        preferences: serializePreferences(user),
        linked
      });
    } catch (error) {
      console.error("Apple sign-in error:", error);
      res.status(500).json({ error: "Failed to sign in with Apple" });
    }
  });
  app2.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const [user] = await db.select().from(users).where(eq3(users.id, req.user.userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({
        user: { id: user.id, email: user.email },
        preferences: serializePreferences(user)
      });
    } catch (error) {
      console.error("Auth check error:", error);
      res.status(500).json({ error: "Failed to verify authentication" });
    }
  });
  app2.get(
    "/api/preferences",
    requireAuth,
    async (req, res) => {
      try {
        const [user] = await db.select().from(users).where(eq3(users.id, req.user.userId)).limit(1);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        res.json({ preferences: serializePreferences(user) });
      } catch (error) {
        console.error("Get preferences error:", error);
        res.status(500).json({ error: "Failed to load preferences" });
      }
    }
  );
  app2.patch(
    "/api/preferences",
    requireAuth,
    async (req, res) => {
      try {
        const parsed = updatePreferencesSchema.safeParse(req.body);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          return res.status(400).json({
            error: first?.message ?? "Invalid preferences payload"
          });
        }
        const updates = {};
        if ("displayName" in parsed.data) {
          const raw = parsed.data.displayName;
          updates.displayName = raw === null || raw === void 0 || raw.trim().length === 0 ? null : raw.trim();
        }
        if ("intents" in parsed.data) {
          const raw = parsed.data.intents;
          if (raw === null || raw === void 0) {
            updates.intents = null;
          } else {
            const seen = /* @__PURE__ */ new Set();
            const cleaned = [];
            for (const item of raw) {
              if (!seen.has(item)) {
                seen.add(item);
                cleaned.push(item);
              }
            }
            updates.intents = cleaned;
          }
        }
        if ("tone" in parsed.data) {
          updates.tone = parsed.data.tone ?? null;
        }
        if ("voice" in parsed.data) {
          updates.voice = parsed.data.voice ?? null;
        }
        if ("language" in parsed.data) {
          updates.language = parsed.data.language ?? null;
        }
        if ("reminderEnabled" in parsed.data && parsed.data.reminderEnabled !== void 0) {
          updates.reminderEnabled = parsed.data.reminderEnabled;
        }
        if ("reminderTime" in parsed.data && parsed.data.reminderTime !== void 0) {
          updates.reminderTime = parsed.data.reminderTime;
        }
        if ("weeklySummaryEnabled" in parsed.data && parsed.data.weeklySummaryEnabled !== void 0) {
          updates.weeklySummaryEnabled = parsed.data.weeklySummaryEnabled;
        }
        if ("weeklySummaryDay" in parsed.data && parsed.data.weeklySummaryDay !== void 0) {
          updates.weeklySummaryDay = parsed.data.weeklySummaryDay;
        }
        if ("weeklySummaryTime" in parsed.data && parsed.data.weeklySummaryTime !== void 0) {
          updates.weeklySummaryTime = parsed.data.weeklySummaryTime;
        }
        if (parsed.data.markOnboardingComplete) {
          updates.onboardingCompletedAt = /* @__PURE__ */ new Date();
        }
        if (Object.keys(updates).length === 0) {
          const [current] = await db.select().from(users).where(eq3(users.id, req.user.userId)).limit(1);
          if (!current) {
            return res.status(404).json({ error: "User not found" });
          }
          return res.json({ preferences: serializePreferences(current) });
        }
        const [updated] = await db.update(users).set(updates).where(eq3(users.id, req.user.userId)).returning();
        if (!updated) {
          return res.status(404).json({ error: "User not found" });
        }
        res.json({ preferences: serializePreferences(updated) });
      } catch (error) {
        console.error("Update preferences error:", error);
        res.status(500).json({ error: "Failed to save preferences" });
      }
    }
  );
  const VOICE_PREVIEW_WINDOW_MS = 6e4;
  const VOICE_PREVIEW_LIMIT = 10;
  const voicePreviewHits = /* @__PURE__ */ new Map();
  const VOICE_PREVIEW_LINES = {
    en: "Hi, I'm Solence. I'm here whenever you need me.",
    es: "Hola, soy Solence. Estoy aqu\xED cuando me necesites."
  };
  app2.post(
    "/api/voice-preview",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const requestedRaw = typeof req.body?.voice === "string" ? req.body.voice : "";
        if (!VOICE_OPTIONS.includes(requestedRaw)) {
          return res.status(400).json({ error: "Unsupported voice option" });
        }
        const voice = requestedRaw;
        const now = Date.now();
        const recent = (voicePreviewHits.get(userId) ?? []).filter(
          (t) => now - t < VOICE_PREVIEW_WINDOW_MS
        );
        if (recent.length >= VOICE_PREVIEW_LIMIT) {
          const oldest = recent[0];
          const retryAfterSec = Math.max(
            1,
            Math.ceil((VOICE_PREVIEW_WINDOW_MS - (now - oldest)) / 1e3)
          );
          res.setHeader("Retry-After", String(retryAfterSec));
          return res.status(429).json({
            error: "Too many voice previews. Try again in a moment.",
            retryAfterSec
          });
        }
        recent.push(now);
        voicePreviewHits.set(userId, recent);
        let previewLanguage = DEFAULT_LANGUAGE;
        try {
          const [userRow] = await db.select({ language: users.language }).from(users).where(eq3(users.id, userId)).limit(1);
          const stored = userRow?.language ?? null;
          if (stored && LANGUAGE_OPTIONS.includes(stored)) {
            previewLanguage = stored;
          }
        } catch {
        }
        const audioBuffer = await textToSpeech(
          VOICE_PREVIEW_LINES[previewLanguage],
          voice,
          "mp3"
        );
        res.json({
          voice,
          audioBase64: audioBuffer.toString("base64"),
          audioFormat: "mp3"
        });
      } catch (error) {
        console.error("Voice preview error:", error);
        res.status(500).json({ error: "Could not generate voice preview" });
      }
    }
  );
  app2.get("/api/daily-prompt", async (_req, res) => {
    try {
      const { prompt, topic, dateKey } = getDailyPromptForDate();
      res.set("Cache-Control", "public, max-age=300");
      res.json({ prompt, topic, dateKey });
    } catch (error) {
      console.error("Daily prompt error:", error);
      res.status(500).json({ error: "Failed to load daily prompt" });
    }
  });
  app2.get("/api/tokens", requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const [userRow, credit] = await Promise.all([
        db.select({ isPremium: users.isPremium }).from(users).where(eq3(users.id, userId)).limit(1),
        getActiveReferralCredit(userId)
      ]);
      const isPremium = userRow[0]?.isPremium ?? false;
      const nextResetAt = getNextPeriodStart().toISOString();
      if (isPremium && !credit) {
        const messagesUsed = await getMessagesUsed(userId);
        return res.json({
          isPremium: true,
          tokensUsed: messagesUsed,
          tokensRemaining: Math.max(0, PREMIUM_MESSAGE_LIMIT - messagesUsed),
          tokenLimit: PREMIUM_MESSAGE_LIMIT,
          nextResetAt,
          period: "day",
          referralCredit: null
        });
      }
      const used = await getTokensUsed(userId);
      const remaining = Math.max(0, FREE_TOKEN_LIMIT - used);
      res.json({
        isPremium: false,
        tokensUsed: used,
        tokensRemaining: remaining,
        tokenLimit: FREE_TOKEN_LIMIT,
        nextResetAt,
        period: "day",
        referralCredit: credit ? { endsAt: credit.endsAt.toISOString(), source: "referral" } : null
      });
    } catch (error) {
      console.error("Token check error:", error);
      res.status(500).json({ error: "Failed to check token usage" });
    }
  });
  app2.get(
    "/api/referrals",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const code = await ensureReferralCodeForUser(userId);
        const [joinedCount, credit] = await Promise.all([
          getReferralJoinedCount(userId),
          getActiveReferralCredit(userId)
        ]);
        res.json({
          code,
          shareUrl: buildReferralShareUrl(code),
          joinedCount,
          activeCredit: credit ? { endsAt: credit.endsAt.toISOString() } : null
        });
      } catch (error) {
        console.error("Referral fetch error:", error);
        res.status(500).json({ error: "Failed to load referral details" });
      }
    }
  );
  app2.get("/api/tokens/history", requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const rawDays = Number(req.query.days ?? 7);
      const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(30, Math.floor(rawDays)) : 7;
      const [historyUserRow] = await db.select({ isPremium: users.isPremium }).from(users).where(eq3(users.id, userId)).limit(1);
      const historyIsPremium = historyUserRow?.isPremium ?? false;
      const history = await getTokensUsedHistory(
        userId,
        days,
        historyIsPremium ? "messages" : "tokens"
      );
      res.json({
        days,
        isPremium: historyIsPremium,
        tokenLimit: historyIsPremium ? PREMIUM_MESSAGE_LIMIT : FREE_TOKEN_LIMIT,
        period: "day",
        history
      });
    } catch (error) {
      console.error("Token history error:", error);
      res.status(500).json({ error: "Failed to fetch token history" });
    }
  });
  app2.get("/api/conversations", requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const rawLimit = Number(req.query.limit ?? 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50, Math.floor(rawLimit)) : 10;
      const fetchLimit = Math.max(limit * 5, 50);
      const candidates = await db.select().from(conversations).where(eq3(conversations.userId, userId)).orderBy(desc2(conversations.createdAt)).limit(fetchLimit);
      if (candidates.length === 0) {
        return res.json({ conversations: [] });
      }
      const convIds = candidates.map((c) => c.id);
      const allMessages = await db.select().from(messages).where(inArray(messages.conversationId, convIds)).orderBy(desc2(messages.createdAt));
      const lastByConv = /* @__PURE__ */ new Map();
      const countByConv = /* @__PURE__ */ new Map();
      for (const m of allMessages) {
        if (!lastByConv.has(m.conversationId)) {
          lastByConv.set(m.conversationId, m);
        }
        countByConv.set(
          m.conversationId,
          (countByConv.get(m.conversationId) ?? 0) + 1
        );
      }
      const sorted = [...candidates].sort((a, b) => {
        const ta = (lastByConv.get(a.id)?.createdAt ?? a.createdAt).getTime();
        const tb = (lastByConv.get(b.id)?.createdAt ?? b.createdAt).getTime();
        return tb - ta;
      });
      res.json({
        conversations: sorted.slice(0, limit).map((c) => {
          const last = lastByConv.get(c.id);
          return {
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            messageCount: countByConv.get(c.id) ?? 0,
            lastMessage: last ? {
              role: last.role,
              content: last.content,
              createdAt: last.createdAt
            } : null,
            reflectionSummary: c.reflectionSummary ?? null,
            reflectionTakeaway: c.reflectionTakeaway ?? null,
            reflectionGeneratedAt: c.reflectionGeneratedAt ?? null
          };
        })
      });
      void runSmartTitleBackfillScan(userId);
      void runReflectionBackfillScan(userId);
    } catch (error) {
      console.error("Conversations list error:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });
  app2.get(
    "/api/conversations/:id/messages",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid conversation id" });
        }
        const [conversation] = await db.select().from(conversations).where(
          and3(eq3(conversations.id, id), eq3(conversations.userId, userId))
        ).limit(1);
        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        const conversationMessages = await db.select().from(messages).where(eq3(messages.conversationId, id)).orderBy(messages.createdAt);
        let favoritedIds = /* @__PURE__ */ new Set();
        if (conversationMessages.length > 0) {
          const favRows = await db.select({ messageId: favorites.messageId }).from(favorites).where(
            and3(
              eq3(favorites.userId, userId),
              inArray(
                favorites.messageId,
                conversationMessages.map((m) => m.id)
              )
            )
          );
          favoritedIds = new Set(favRows.map((r) => r.messageId));
        }
        res.json({
          conversation: {
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt,
            reflectionSummary: conversation.reflectionSummary ?? null,
            reflectionTakeaway: conversation.reflectionTakeaway ?? null,
            reflectionGeneratedAt: conversation.reflectionGeneratedAt ?? null
          },
          messages: conversationMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            isFavorite: favoritedIds.has(m.id),
            crisisSupport: m.crisisSupport ?? false
          }))
        });
      } catch (error) {
        console.error("Conversation messages error:", error);
        res.status(500).json({ error: "Failed to fetch conversation" });
      }
    }
  );
  app2.delete(
    "/api/conversations/:id",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid conversation id" });
        }
        const [conversation] = await db.select().from(conversations).where(
          and3(eq3(conversations.id, id), eq3(conversations.userId, userId))
        ).limit(1);
        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        await db.delete(conversations).where(eq3(conversations.id, id));
        res.json({ success: true, id });
      } catch (error) {
        console.error("Conversation delete error:", error);
        res.status(500).json({ error: "Failed to delete conversation" });
      }
    }
  );
  app2.post(
    "/api/conversations/:id/end",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid conversation id" });
        }
        const [conversation] = await db.select().from(conversations).where(
          and3(eq3(conversations.id, id), eq3(conversations.userId, userId))
        ).limit(1);
        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        let reflectionLanguage = DEFAULT_LANGUAGE;
        try {
          const [userRow] = await db.select({ language: users.language }).from(users).where(eq3(users.id, userId)).limit(1);
          const stored = userRow?.language ?? null;
          if (stored && LANGUAGE_OPTIONS.includes(stored)) {
            reflectionLanguage = stored;
          }
        } catch {
        }
        const reflection = await generateAndPersistReflection(
          id,
          reflectionLanguage
        );
        if (!reflection) {
          return res.json({ conversationId: id, reflection: null });
        }
        return res.json({
          conversationId: id,
          reflection: {
            summary: reflection.summary,
            takeaway: reflection.takeaway,
            generatedAt: reflection.generatedAt
          }
        });
      } catch (error) {
        console.error("End-conversation error:", error);
        res.status(500).json({ error: "Failed to end conversation" });
      }
    }
  );
  const CONVERSATION_TITLE_MAX_LENGTH = 80;
  app2.patch(
    "/api/conversations/:id",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid conversation id" });
        }
        const rawTitle = (req.body ?? {}).title;
        if (typeof rawTitle !== "string") {
          return res.status(400).json({ error: "Title is required" });
        }
        const title = rawTitle.trim();
        if (title.length === 0) {
          return res.status(400).json({ error: "Title cannot be empty" });
        }
        if (title.length > CONVERSATION_TITLE_MAX_LENGTH) {
          return res.status(400).json({
            error: `Title must be ${CONVERSATION_TITLE_MAX_LENGTH} characters or fewer`
          });
        }
        const [conversation] = await db.select().from(conversations).where(
          and3(eq3(conversations.id, id), eq3(conversations.userId, userId))
        ).limit(1);
        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        const [updated] = await db.update(conversations).set({ title }).where(eq3(conversations.id, id)).returning();
        res.json({
          conversation: {
            id: updated.id,
            title: updated.title,
            createdAt: updated.createdAt
          }
        });
      } catch (error) {
        console.error("Conversation rename error:", error);
        res.status(500).json({ error: "Failed to rename conversation" });
      }
    }
  );
  async function loadMessageOwnedByUser(messageId, userId) {
    const [row] = await db.select({
      id: messages.id,
      conversationId: messages.conversationId,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
      crisisSupport: messages.crisisSupport
    }).from(messages).innerJoin(
      conversations,
      eq3(conversations.id, messages.conversationId)
    ).where(
      and3(eq3(messages.id, messageId), eq3(conversations.userId, userId))
    ).limit(1);
    return row ?? null;
  }
  app2.post(
    "/api/messages/:id/favorite",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const messageId = Number(req.params.id);
        if (!Number.isFinite(messageId) || messageId <= 0) {
          return res.status(400).json({ error: "Invalid message id" });
        }
        const message = await loadMessageOwnedByUser(messageId, userId);
        if (!message) {
          return res.status(404).json({ error: "Message not found" });
        }
        if (message.role !== "assistant") {
          return res.status(400).json({ error: "Only assistant messages can be saved" });
        }
        await db.insert(favorites).values({ userId, messageId }).onConflictDoNothing({
          target: [favorites.userId, favorites.messageId]
        });
        res.json({ success: true, messageId, isFavorite: true });
      } catch (error) {
        console.error("Favorite message error:", error);
        res.status(500).json({ error: "Failed to save favorite" });
      }
    }
  );
  app2.delete(
    "/api/messages/:id/favorite",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const messageId = Number(req.params.id);
        if (!Number.isFinite(messageId) || messageId <= 0) {
          return res.status(400).json({ error: "Invalid message id" });
        }
        const message = await loadMessageOwnedByUser(messageId, userId);
        if (!message) {
          return res.status(404).json({ error: "Message not found" });
        }
        await db.delete(favorites).where(
          and3(
            eq3(favorites.userId, userId),
            eq3(favorites.messageId, messageId)
          )
        );
        res.json({ success: true, messageId, isFavorite: false });
      } catch (error) {
        console.error("Unfavorite message error:", error);
        res.status(500).json({ error: "Failed to remove favorite" });
      }
    }
  );
  app2.get(
    "/api/favorites",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const rawLimit = Number(req.query.limit ?? 20);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50, Math.floor(rawLimit)) : 20;
        const rows = await db.select({
          favoriteId: favorites.id,
          messageId: favorites.messageId,
          favoritedAt: favorites.createdAt,
          messageContent: messages.content,
          messageRole: messages.role,
          messageCreatedAt: messages.createdAt,
          conversationId: conversations.id,
          conversationTitle: conversations.title,
          conversationCreatedAt: conversations.createdAt
        }).from(favorites).innerJoin(messages, eq3(messages.id, favorites.messageId)).innerJoin(
          conversations,
          eq3(conversations.id, messages.conversationId)
        ).where(eq3(favorites.userId, userId)).orderBy(desc2(favorites.createdAt)).limit(limit);
        res.json({
          favorites: rows.map((r) => ({
            id: r.favoriteId,
            messageId: r.messageId,
            favoritedAt: r.favoritedAt,
            message: {
              content: r.messageContent,
              role: r.messageRole,
              createdAt: r.messageCreatedAt
            },
            conversation: {
              id: r.conversationId,
              title: r.conversationTitle,
              createdAt: r.conversationCreatedAt
            }
          }))
        });
      } catch (error) {
        console.error("List favorites error:", error);
        res.status(500).json({ error: "Failed to load favorites" });
      }
    }
  );
  app2.get(
    "/api/memories",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const rows = await db.select({
          id: userMemories.id,
          text: userMemories.text,
          sourceConversationId: userMemories.sourceConversationId,
          createdAt: userMemories.createdAt,
          sourceConversationTitle: conversations.title,
          sourceConversationCreatedAt: conversations.createdAt
        }).from(userMemories).leftJoin(
          conversations,
          and3(
            eq3(conversations.id, userMemories.sourceConversationId),
            // Defense-in-depth: even though memories only ever reference
            // the owner's conversations today, constraining the join on
            // userId ensures we can never leak another user's title or
            // createdAt if that invariant ever slipped.
            eq3(conversations.userId, userId)
          )
        ).where(eq3(userMemories.userId, userId)).orderBy(desc2(userMemories.createdAt), desc2(userMemories.id)).limit(USER_MEMORY_MAX_PER_USER);
        res.json({
          memories: rows.map((r) => ({
            id: r.id,
            text: r.text,
            sourceConversationId: r.sourceConversationId,
            createdAt: r.createdAt,
            sourceConversation: r.sourceConversationId !== null && r.sourceConversationCreatedAt !== null ? {
              id: r.sourceConversationId,
              title: r.sourceConversationTitle,
              createdAt: r.sourceConversationCreatedAt
            } : null
          }))
        });
      } catch (error) {
        console.error("List memories error:", error);
        res.status(500).json({ error: "Failed to load memories" });
      }
    }
  );
  app2.delete(
    "/api/memories/:id",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const parsed = Number(req.params.id);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res.status(400).json({ error: "Invalid memory id" });
        }
        const removed = await db.delete(userMemories).where(
          and3(
            eq3(userMemories.id, parsed),
            eq3(userMemories.userId, userId)
          )
        ).returning({ id: userMemories.id });
        if (removed.length === 0) {
          return res.status(404).json({ error: "Memory not found" });
        }
        res.json({ ok: true });
      } catch (error) {
        console.error("Delete memory error:", error);
        res.status(500).json({ error: "Failed to delete memory" });
      }
    }
  );
  app2.patch(
    "/api/memories/:id",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const parsed = Number(req.params.id);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res.status(400).json({ error: "Invalid memory id" });
        }
        const rawText = (req.body ?? {}).text;
        if (typeof rawText !== "string") {
          return res.status(400).json({ error: "Memory text is required" });
        }
        const cleaned = clampReflectionLength(rawText, MEMORY_TEXT_MAX_LEN);
        if (cleaned.length === 0) {
          return res.status(400).json({ error: "Memory text cannot be empty" });
        }
        const [updated] = await db.update(userMemories).set({ text: cleaned }).where(
          and3(
            eq3(userMemories.id, parsed),
            eq3(userMemories.userId, userId)
          )
        ).returning({
          id: userMemories.id,
          text: userMemories.text,
          sourceConversationId: userMemories.sourceConversationId,
          createdAt: userMemories.createdAt
        });
        if (!updated) {
          return res.status(404).json({ error: "Memory not found" });
        }
        res.json({ memory: updated });
      } catch (error) {
        console.error("Update memory error:", error);
        res.status(500).json({ error: "Failed to update memory" });
      }
    }
  );
  app2.delete(
    "/api/memories",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const removed = await db.delete(userMemories).where(eq3(userMemories.userId, userId)).returning({ id: userMemories.id });
        res.json({ ok: true, removed: removed.length });
      } catch (error) {
        console.error("Clear memories error:", error);
        res.status(500).json({ error: "Failed to clear memories" });
      }
    }
  );
  app2.post(
    "/api/mood",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const {
          phase: rawPhase,
          score: rawScore,
          conversationId: rawConversationId
        } = req.body ?? {};
        const phase = String(rawPhase ?? "");
        if (!MOOD_PHASES.includes(phase)) {
          return res.status(400).json({ error: "Invalid phase (must be 'pre' or 'post')" });
        }
        const scoreNum = Number(rawScore);
        if (!Number.isFinite(scoreNum) || !Number.isInteger(scoreNum) || scoreNum < MOOD_SCORE_MIN || scoreNum > MOOD_SCORE_MAX) {
          return res.status(400).json({
            error: `Invalid score (must be an integer ${MOOD_SCORE_MIN}-${MOOD_SCORE_MAX})`
          });
        }
        let conversationId = null;
        if (rawConversationId !== void 0 && rawConversationId !== null) {
          const parsed = Number(rawConversationId);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return res.status(400).json({ error: "Invalid conversationId" });
          }
          const [owned] = await db.select({ id: conversations.id }).from(conversations).where(
            and3(
              eq3(conversations.id, parsed),
              eq3(conversations.userId, userId)
            )
          ).limit(1);
          if (!owned) {
            return res.status(404).json({ error: "Conversation not found" });
          }
          conversationId = owned.id;
        }
        const [row] = await db.insert(moodEntries).values({
          userId,
          phase,
          score: scoreNum,
          conversationId
        }).returning();
        res.status(201).json({
          entry: {
            id: row.id,
            phase: row.phase,
            score: row.score,
            conversationId: row.conversationId,
            createdAt: row.createdAt
          }
        });
      } catch (error) {
        console.error("Create mood entry error:", error);
        res.status(500).json({ error: "Failed to save mood entry" });
      }
    }
  );
  app2.get(
    "/api/mood",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const rawDays = Number(req.query.days ?? 7);
        const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(30, Math.floor(rawDays)) : 7;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1e3);
        const rows = await db.select({
          id: moodEntries.id,
          phase: moodEntries.phase,
          score: moodEntries.score,
          conversationId: moodEntries.conversationId,
          createdAt: moodEntries.createdAt
        }).from(moodEntries).where(
          and3(
            eq3(moodEntries.userId, userId),
            gte2(moodEntries.createdAt, cutoff)
          )
        ).orderBy(desc2(moodEntries.createdAt));
        res.json({ days, entries: rows });
      } catch (error) {
        console.error("List mood entries error:", error);
        res.status(500).json({ error: "Failed to load mood entries" });
        return;
      }
    }
  );
  app2.get(
    "/api/weekly-summary",
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user.userId;
        const rawOffset = Number(req.query.weekOffset ?? 0);
        const weekOffset = Number.isFinite(rawOffset) && rawOffset <= 0 && rawOffset >= -52 ? Math.floor(rawOffset) : 0;
        const now = /* @__PURE__ */ new Date();
        const startOfThisWeek = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - now.getDay(),
          0,
          0,
          0,
          0
        );
        const weekStart = new Date(startOfThisWeek);
        weekStart.setDate(weekStart.getDate() + weekOffset * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        const weekConversations = await db.select({
          id: conversations.id,
          createdAt: conversations.createdAt,
          reflectionSummary: conversations.reflectionSummary,
          reflectionTakeaway: conversations.reflectionTakeaway
        }).from(conversations).where(
          and3(
            eq3(conversations.userId, userId),
            gte2(conversations.createdAt, weekStart),
            lt(conversations.createdAt, weekEnd)
          )
        ).orderBy(desc2(conversations.createdAt));
        const weekMoods = await db.select({
          score: moodEntries.score
        }).from(moodEntries).where(
          and3(
            eq3(moodEntries.userId, userId),
            gte2(moodEntries.createdAt, weekStart),
            lt(moodEntries.createdAt, weekEnd)
          )
        );
        const moodCount = weekMoods.length;
        const avgMood = moodCount > 0 ? Math.round(
          weekMoods.reduce((sum, m) => sum + m.score, 0) / moodCount * 10
        ) / 10 : null;
        const STOP_WORDS = /* @__PURE__ */ new Set([
          "the",
          "and",
          "you",
          "your",
          "that",
          "this",
          "with",
          "have",
          "were",
          "was",
          "for",
          "but",
          "not",
          "just",
          "like",
          "feel",
          "felt",
          "feeling",
          "feelings",
          "about",
          "into",
          "there",
          "they",
          "them",
          "what",
          "when",
          "where",
          "which",
          "while",
          "from",
          "then",
          "than",
          "over",
          "some",
          "more",
          "much",
          "very",
          "will",
          "would",
          "could",
          "should",
          "also",
          "been",
          "being",
          "because",
          "each",
          "other",
          "their",
          "these",
          "those",
          "through",
          "into",
          "still",
          "really",
          "always",
          "never",
          "ever",
          "even",
          "kind",
          "keep",
          "kept",
          "make",
          "made",
          "makes",
          "know",
          "knew",
          "known",
          "think",
          "thought",
          "want",
          "wanted",
          "need",
          "needed",
          "take",
          "took",
          "taken",
          "find",
          "found",
          "finding",
          "work",
          "working",
          "day",
          "days",
          "time",
          "today",
          "weeks",
          "week",
          "again",
          "things",
          "something",
          "anything",
          "everything",
          "nothing",
          "talked",
          "talking",
          "said",
          "saying",
          "tell",
          "told",
          "feels",
          "felt",
          "were",
          "with",
          "without",
          "seemed",
          "seems",
          "seem",
          "being",
          "been",
          "let",
          "its",
          "also",
          "yes",
          "yeah",
          "okay",
          "ok",
          "one",
          "two",
          "three",
          "much",
          "many",
          "alot",
          "got",
          "get",
          "gets",
          "getting"
        ]);
        const weekMemories = await db.select({ text: userMemories.text }).from(userMemories).where(
          and3(
            eq3(userMemories.userId, userId),
            gte2(userMemories.createdAt, weekStart),
            lt(userMemories.createdAt, weekEnd)
          )
        );
        const corpusItems = [];
        for (const c of weekConversations) {
          const combined = `${c.reflectionTakeaway ?? ""} ${c.reflectionSummary ?? ""}`.trim();
          if (combined.length > 0) corpusItems.push(combined);
        }
        for (const m of weekMemories) {
          const text2 = (m.text ?? "").trim();
          if (text2.length > 0) corpusItems.push(text2);
        }
        let userLanguage = DEFAULT_LANGUAGE;
        try {
          const [userRow] = await db.select({ language: users.language }).from(users).where(eq3(users.id, userId)).limit(1);
          const stored = userRow?.language ?? null;
          if (stored && LANGUAGE_OPTIONS.includes(stored)) {
            userLanguage = stored;
          }
        } catch {
        }
        let themes = [];
        if (corpusItems.length > 0) {
          const llmThemes = await generateWeeklyThemes(
            corpusItems,
            userLanguage
          );
          if (llmThemes && llmThemes.length >= 2) {
            themes = llmThemes;
          }
        }
        if (themes.length === 0) {
          const counts = /* @__PURE__ */ new Map();
          const ingest = (text2) => {
            for (const raw of text2.toLowerCase().split(/[^a-záéíóúñü]+/i)) {
              const word = raw.trim();
              if (word.length < 4) continue;
              if (STOP_WORDS.has(word)) continue;
              counts.set(word, (counts.get(word) ?? 0) + 1);
            }
          };
          for (const item of corpusItems) {
            ingest(item);
          }
          themes = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([word]) => word);
        }
        let highlight = null;
        const weekConvIds = weekConversations.map((c) => c.id);
        if (weekConvIds.length > 0) {
          const favRows = await db.select({
            id: messages.id,
            content: messages.content,
            createdAt: messages.createdAt,
            conversationId: messages.conversationId
          }).from(messages).innerJoin(favorites, eq3(favorites.messageId, messages.id)).where(
            and3(
              eq3(favorites.userId, userId),
              eq3(messages.role, "assistant"),
              inArray(messages.conversationId, weekConvIds)
            )
          ).orderBy(desc2(favorites.createdAt)).limit(1);
          if (favRows.length > 0) {
            highlight = favRows[0];
          } else {
            const recent = await db.select({
              id: messages.id,
              content: messages.content,
              createdAt: messages.createdAt,
              conversationId: messages.conversationId
            }).from(messages).where(
              and3(
                eq3(messages.role, "assistant"),
                inArray(messages.conversationId, weekConvIds)
              )
            ).orderBy(desc2(messages.createdAt)).limit(1);
            if (recent.length > 0) {
              highlight = recent[0];
            }
          }
        }
        res.json({
          weekOffset,
          weekStart: weekStart.toISOString(),
          weekEnd: weekEnd.toISOString(),
          sessionCount: weekConversations.length,
          moodCount,
          avgMood,
          themes,
          highlight: highlight ? {
            messageId: highlight.id,
            conversationId: highlight.conversationId,
            content: highlight.content,
            createdAt: highlight.createdAt instanceof Date ? highlight.createdAt.toISOString() : highlight.createdAt
          } : null
        });
      } catch (error) {
        console.error("Weekly summary error:", error);
        res.status(500).json({ error: "Failed to load weekly summary" });
      }
    }
  );
  const EXPORT_COOLDOWN_MS = 5 * 60 * 1e3;
  const exportLastRunAt = /* @__PURE__ */ new Map();
  app2.post(
    "/api/export",
    requireAuth,
    async (req, res) => {
      const userId = req.user.userId;
      try {
        const now = Date.now();
        const last = exportLastRunAt.get(userId);
        if (last !== void 0 && now - last < EXPORT_COOLDOWN_MS) {
          const retryAfterSec = Math.max(
            1,
            Math.ceil((EXPORT_COOLDOWN_MS - (now - last)) / 1e3)
          );
          res.setHeader("Retry-After", String(retryAfterSec));
          return res.status(429).json({
            error: "You can export your data again in a few minutes. Thanks for your patience.",
            retryAfterSec
          });
        }
        exportLastRunAt.set(userId, now);
        const [user] = await db.select().from(users).where(eq3(users.id, userId)).limit(1);
        if (!user) {
          exportLastRunAt.delete(userId);
          return res.status(404).json({ error: "User not found" });
        }
        const [
          conversationRows,
          messageRows,
          favoriteRows,
          moodRows,
          tokenUsageRows,
          memoryRows
        ] = await Promise.all([
          db.select().from(conversations).where(eq3(conversations.userId, userId)).orderBy(desc2(conversations.createdAt)),
          db.select({
            id: messages.id,
            conversationId: messages.conversationId,
            role: messages.role,
            content: messages.content,
            createdAt: messages.createdAt
          }).from(messages).innerJoin(
            conversations,
            eq3(conversations.id, messages.conversationId)
          ).where(eq3(conversations.userId, userId)).orderBy(desc2(messages.createdAt)),
          db.select({
            id: favorites.id,
            messageId: favorites.messageId,
            createdAt: favorites.createdAt
          }).from(favorites).where(eq3(favorites.userId, userId)).orderBy(desc2(favorites.createdAt)),
          db.select().from(moodEntries).where(eq3(moodEntries.userId, userId)).orderBy(desc2(moodEntries.createdAt)),
          db.select().from(tokenUsage).where(eq3(tokenUsage.userId, userId)).orderBy(desc2(tokenUsage.periodStart)),
          db.select().from(userMemories).where(eq3(userMemories.userId, userId)).orderBy(desc2(userMemories.createdAt), desc2(userMemories.id))
        ]);
        const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
        const account = {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          createdAt: user.createdAt,
          onboardingCompletedAt: user.onboardingCompletedAt
        };
        const preferences = serializePreferences(user);
        const zip = new JSZip();
        const stamp = (d) => d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();
        const writeJson = (name, payload) => {
          zip.file(name, `${JSON.stringify(payload, null, 2)}
`);
        };
        writeJson("account.json", { generatedAt, account });
        writeJson("preferences.json", { generatedAt, preferences });
        writeJson("conversations.json", {
          generatedAt,
          count: conversationRows.length,
          conversations: conversationRows.map((c) => ({
            id: c.id,
            title: c.title,
            reflectionSummary: c.reflectionSummary,
            reflectionTakeaway: c.reflectionTakeaway,
            reflectionGeneratedAt: stamp(c.reflectionGeneratedAt),
            createdAt: stamp(c.createdAt)
          }))
        });
        writeJson("messages.json", {
          generatedAt,
          count: messageRows.length,
          messages: messageRows.map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            role: m.role,
            content: m.content,
            createdAt: stamp(m.createdAt)
          }))
        });
        writeJson("favorites.json", {
          generatedAt,
          count: favoriteRows.length,
          favorites: favoriteRows.map((f) => ({
            id: f.id,
            messageId: f.messageId,
            createdAt: stamp(f.createdAt)
          }))
        });
        writeJson("mood_entries.json", {
          generatedAt,
          count: moodRows.length,
          entries: moodRows.map((e) => ({
            id: e.id,
            phase: e.phase,
            score: e.score,
            conversationId: e.conversationId,
            createdAt: stamp(e.createdAt)
          }))
        });
        writeJson("token_usage.json", {
          generatedAt,
          count: tokenUsageRows.length,
          entries: tokenUsageRows.map((t) => ({
            id: t.id,
            tokensUsed: t.tokensUsed,
            periodStart: stamp(t.periodStart),
            createdAt: stamp(t.createdAt)
          }))
        });
        writeJson("memories.json", {
          generatedAt,
          count: memoryRows.length,
          memories: memoryRows.map((m) => ({
            id: m.id,
            text: m.text,
            sourceConversationId: m.sourceConversationId,
            createdAt: stamp(m.createdAt)
          }))
        });
        zip.file(
          "README.txt",
          [
            "Solence \u2014 your data export",
            "",
            `Generated for ${user.email} at ${generatedAt}.`,
            "",
            "Each .json file contains one category of your data:",
            "  \u2022 account.json       \u2014 basic profile (id, email, sign-up date)",
            "  \u2022 preferences.json   \u2014 name, focus areas, tone, voice",
            "  \u2022 conversations.json \u2014 every session you've had with Solence",
            "  \u2022 messages.json      \u2014 the full transcript of those sessions",
            "  \u2022 favorites.json     \u2014 replies you bookmarked as saved moments",
            "  \u2022 mood_entries.json  \u2014 pre/post-session mood check-ins",
            "  \u2022 token_usage.json   \u2014 daily usage of the free token allowance",
            "  \u2022 memories.json      \u2014 long-term notes Solence has kept about you",
            "",
            "Sensitive material (your password hash, auth tokens, billing",
            "details) is never included in this archive.",
            ""
          ].join("\n")
        );
        const buffer = await zip.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
          compressionOptions: { level: 6 }
        });
        const emailPrefix = (user.email.split("@")[0] ?? "user").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "user";
        const dateStamp = generatedAt.slice(0, 10).replace(/-/g, "");
        const filename = `solence-export-${emailPrefix}-${dateStamp}.zip`;
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.setHeader("Content-Length", String(buffer.length));
        res.status(200).end(buffer);
      } catch (error) {
        console.error("Data export error:", error);
        exportLastRunAt.delete(userId);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to build data export" });
        }
      }
    }
  );
  app2.post("/api/chat/voice", audioBodyParser2, requireAuth, async (req, res) => {
    let reservationActive = false;
    let premiumMode = false;
    let reservedPeriodStart = null;
    const userId = req.user.userId;
    try {
      const {
        audio,
        text: text2,
        conversationId: requestedConversationId,
        preSessionMood: rawPreSessionMood
      } = req.body;
      if (!audio && !text2) {
        return res.status(400).json({ error: "Either [audio] or [text] is required" });
      }
      let preSessionMoodHint = null;
      if (rawPreSessionMood && typeof rawPreSessionMood === "object" && Number.isFinite(Number(rawPreSessionMood.score))) {
        const score = Math.round(
          Number(rawPreSessionMood.score)
        );
        const label = String(
          rawPreSessionMood.label ?? ""
        ).trim().slice(0, 40);
        if (score >= MOOD_SCORE_MIN && score <= MOOD_SCORE_MAX && label) {
          preSessionMoodHint = { score, label };
        }
      }
      let targetConversationId = null;
      let targetConversationTitle = null;
      if (requestedConversationId !== void 0 && requestedConversationId !== null) {
        const parsed = Number(requestedConversationId);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res.status(400).json({ error: "Invalid conversationId" });
        }
        const [owned] = await db.select().from(conversations).where(
          and3(eq3(conversations.id, parsed), eq3(conversations.userId, userId))
        ).limit(1);
        if (!owned) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        targetConversationId = owned.id;
        targetConversationTitle = owned.title;
      }
      const [userRow, activeCredit] = await Promise.all([
        db.select({ isPremium: users.isPremium }).from(users).where(eq3(users.id, userId)).limit(1),
        getActiveReferralCredit(userId)
      ]);
      const isPremium = userRow[0]?.isPremium ?? false;
      const unlimitedMode = activeCredit !== null;
      if (!unlimitedMode) {
        if (isPremium) {
          const used = await getMessagesUsed(userId);
          if (used >= PREMIUM_MESSAGE_LIMIT) {
            return res.status(429).json({
              error: "Daily message limit reached",
              tokensUsed: used,
              tokensRemaining: 0,
              tokenLimit: PREMIUM_MESSAGE_LIMIT,
              nextResetAt: getNextPeriodStart().toISOString(),
              period: "day"
            });
          }
          premiumMode = true;
          reservedPeriodStart = getCurrentPeriodStart();
        } else {
          const reservation = await tryReserveTokens(userId, MIN_TOKENS_FOR_REQUEST);
          if (!reservation.ok) {
            return res.status(429).json({
              error: "Daily token limit reached",
              tokensUsed: reservation.tokensUsed,
              tokensRemaining: Math.max(0, FREE_TOKEN_LIMIT - reservation.tokensUsed),
              tokenLimit: FREE_TOKEN_LIMIT,
              nextResetAt: getNextPeriodStart().toISOString(),
              period: "day"
            });
          }
          reservationActive = true;
          reservedPeriodStart = reservation.periodStart;
        }
      }
      let userTranscript = text2 || "";
      if (audio && !text2) {
        const rawBuffer = Buffer.from(audio, "base64");
        const detected = detectAudioFormat(rawBuffer);
        const sttFormat = detected === "mp3" ? "mp3" : detected === "webm" ? "webm" : "wav";
        const fileExt = detected === "unknown" ? "m4a" : detected;
        console.log("Audio in:", detected, rawBuffer.length, "bytes");
        try {
          userTranscript = await speechToText(rawBuffer, sttFormat, fileExt);
        } catch (sttError) {
          console.error("STT error:", sttError instanceof Error ? sttError.message : sttError);
          userTranscript = "";
        }
        if (!userTranscript || userTranscript.trim().length === 0) {
          if (reservationActive && reservedPeriodStart) {
            await recordTokens(
              userId,
              -MIN_TOKENS_FOR_REQUEST,
              reservedPeriodStart
            );
            reservationActive = false;
          }
          const used = await getTokensUsed(userId);
          return res.status(400).json({
            error: "I couldn't quite catch that. Try again?",
            tokensUsed: used,
            tokensRemaining: Math.max(0, FREE_TOKEN_LIMIT - used),
            tokenLimit: FREE_TOKEN_LIMIT,
            nextResetAt: getNextPeriodStart().toISOString(),
            period: "day"
          });
        }
      }
      let conversationId;
      const recentConversations = await db.select().from(conversations).where(eq3(conversations.userId, userId)).orderBy(desc2(conversations.createdAt)).limit(6);
      if (targetConversationId !== null) {
        conversationId = targetConversationId;
      } else if (recentConversations.length > 0) {
        conversationId = recentConversations[0].id;
      } else {
        const [newConv] = await db.insert(conversations).values({
          userId,
          title: generateConversationTitle(userTranscript)
        }).returning();
        conversationId = newConv.id;
      }
      const activeConversationTitle = targetConversationId !== null ? targetConversationTitle : recentConversations[0]?.title ?? null;
      if (activeConversationTitle === LEGACY_DEFAULT_CONVERSATION_TITLE) {
        const [firstUserMessage] = await db.select().from(messages).where(
          and3(
            eq3(messages.conversationId, conversationId),
            eq3(messages.role, "user")
          )
        ).orderBy(messages.createdAt).limit(1);
        const seedText = firstUserMessage?.content ?? userTranscript;
        const newTitle = generateConversationTitle(seedText);
        if (newTitle !== LEGACY_DEFAULT_CONVERSATION_TITLE) {
          await db.update(conversations).set({ title: newTitle }).where(eq3(conversations.id, conversationId));
        }
      }
      const crisisSupportPromise = detectCrisisSignal(userTranscript).catch(
        () => false
      );
      await db.insert(messages).values({ conversationId, role: "user", content: userTranscript });
      const currentMessages = await db.select().from(messages).where(eq3(messages.conversationId, conversationId)).orderBy(messages.createdAt);
      const isFirstExchange = currentMessages.length === 1;
      let pastContext = "";
      const olderConvIds = recentConversations.map((c) => c.id).filter((id) => id !== conversationId);
      if (olderConvIds.length > 0) {
        const olderMessages = await db.select().from(messages).where(inArray(messages.conversationId, olderConvIds)).orderBy(messages.conversationId, messages.createdAt);
        const grouped = /* @__PURE__ */ new Map();
        for (const m of olderMessages) {
          const list = grouped.get(m.conversationId) ?? [];
          list.push(m);
          grouped.set(m.conversationId, list);
        }
        const pastMessages = [];
        for (const convId of olderConvIds) {
          const msgs = grouped.get(convId) ?? [];
          if (msgs.length > 0) {
            const summary = msgs.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n");
            pastMessages.push(summary);
          }
        }
        if (pastMessages.length > 0) {
          pastContext = `

PAST CONVERSATION CONTEXT (use naturally, do not repeat verbatim):
${pastMessages.join("\n---\n")}`;
        }
      }
      let personalizationBlock = "";
      let selectedVoice = DEFAULT_VOICE;
      let userLanguage = DEFAULT_LANGUAGE;
      try {
        const [userRow2] = await db.select().from(users).where(eq3(users.id, userId)).limit(1);
        if (userRow2) {
          const prefs = serializePreferences(userRow2);
          personalizationBlock = buildPersonalizationBlock(prefs);
          if (prefs.voice) selectedVoice = prefs.voice;
          if (prefs.language) userLanguage = prefs.language;
        }
      } catch (prefError) {
        console.error(
          "Failed to load personalization for chat:",
          prefError instanceof Error ? prefError.message : prefError
        );
      }
      let memoryBlock = "";
      try {
        const allMemoryRows = await db.select({
          id: userMemories.id,
          text: userMemories.text,
          embedding: userMemories.embedding
        }).from(userMemories).where(eq3(userMemories.userId, userId)).orderBy(desc2(userMemories.createdAt), desc2(userMemories.id));
        let memoryRows = allMemoryRows;
        const queryEmbedding = allMemoryRows.some((r) => Array.isArray(r.embedding)) && userTranscript ? await embedTextWithTimeout(userTranscript) : null;
        if (queryEmbedding) {
          const RECENT_ALWAYS_INCLUDE = 2;
          const recentIds = new Set(
            allMemoryRows.slice(0, RECENT_ALWAYS_INCLUDE).map((r) => r.id)
          );
          const ranked = allMemoryRows.filter((r) => !recentIds.has(r.id)).map((r) => ({
            ...r,
            score: Array.isArray(r.embedding) ? cosineSimilarity(queryEmbedding, r.embedding) : -1
          })).sort((a, b) => b.score - a.score);
          memoryRows = [
            ...allMemoryRows.slice(0, RECENT_ALWAYS_INCLUDE),
            ...ranked
          ].slice(0, USER_MEMORY_PROMPT_MAX_ITEMS);
        } else {
          memoryRows = allMemoryRows.slice(0, USER_MEMORY_PROMPT_MAX_ITEMS);
        }
        const selectedLines = [];
        let usedChars = 0;
        for (const row of memoryRows) {
          const line = `- ${row.text}`;
          const projected = usedChars + line.length + (selectedLines.length > 0 ? 1 : 0);
          if (projected > USER_MEMORY_PROMPT_CHAR_BUDGET) break;
          selectedLines.push(line);
          usedChars = projected;
        }
        if (selectedLines.length > 0) {
          memoryBlock = `

WHAT YOU REMEMBER ABOUT THIS USER (from past sessions; reference only when it fits naturally, never recite):
${selectedLines.join("\n")}`;
        }
      } catch (memoryError) {
        console.error(
          "Failed to load user memories for chat:",
          memoryError instanceof Error ? memoryError.message : memoryError
        );
      }
      const languageDirective = userLanguage === "es" ? "\n\nLANGUAGE: Always reply in Spanish (espa\xF1ol). Use natural, warm, conversational Latin American Spanish. Match the user's register and vocabulary. Keep your usual calm, grounded tone \u2014 just in Spanish. Do not switch back to English unless the user explicitly asks you to." : "";
      let moodHint = "";
      if (isFirstExchange && preSessionMoodHint) {
        moodHint = `

PRE-SESSION MOOD CHECK-IN: The user just rated their current mood as "${preSessionMoodHint.label}" (${preSessionMoodHint.score}/5). Gently acknowledge this energy in your opening response \u2014 meet them where they are without quoting the score back. If they're feeling low ("rough" or "low"), lead with extra warmth and slower pacing. If they're feeling "great" or "good", match their lift without overdoing it.`;
      }
      const chatHistory = [
        {
          role: "system",
          content: SOLENCE_SYSTEM_PROMPT + personalizationBlock + memoryBlock + pastContext + moodHint + languageDirective
        },
        ...currentMessages.map((m) => ({
          role: m.role,
          content: m.content
        }))
      ];
      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: chatHistory
      });
      const assistantTranscript = response.choices[0]?.message?.content || "";
      let audioData = "";
      if (assistantTranscript) {
        try {
          const speech = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: selectedVoice,
            input: assistantTranscript,
            response_format: "mp3"
          });
          audioData = Buffer.from(await speech.arrayBuffer()).toString("base64");
        } catch (ttsError) {
          console.error("TTS synthesis failed, returning text-only response:", ttsError);
        }
      }
      const ttsTokensEstimate = Math.ceil(assistantTranscript.length / 4);
      const totalTokens = (response.usage?.total_tokens || 0) + ttsTokensEstimate;
      if (!unlimitedMode) {
        if (premiumMode) {
          await recordMessage(userId, reservedPeriodStart);
        } else {
          const additionalTokens = Math.max(0, totalTokens - MIN_TOKENS_FOR_REQUEST);
          if (additionalTokens > 0) {
            await recordTokens(userId, additionalTokens, reservedPeriodStart);
          }
        }
      }
      reservationActive = false;
      const updatedTokensUsed = premiumMode ? await getMessagesUsed(userId) : await getTokensUsed(userId);
      const tokenLimit = isPremium ? PREMIUM_MESSAGE_LIMIT : FREE_TOKEN_LIMIT;
      const tokensRemaining = Math.max(0, tokenLimit - updatedTokensUsed);
      const crisisSupport = await crisisSupportPromise;
      await db.insert(messages).values({
        conversationId,
        role: "assistant",
        content: assistantTranscript,
        crisisSupport
      });
      console.log(
        `Voice req: ${userTranscript.length}c in, ${assistantTranscript.length}c out, ${totalTokens} tokens (daily total ${updatedTokensUsed}/${tokenLimit})`
      );
      res.json({
        text: assistantTranscript,
        userTranscript,
        audioBase64: audioData,
        audioFormat: "mp3",
        // Echo the conversationId so the client can adopt it after the
        // first turn of a brand-new session. Downstream features (post-
        // session mood, history navigation) need this id locally without
        // having to refetch the conversations list.
        conversationId,
        // True when the just-processed user turn contained crisis-relevant
        // language. The client uses this to surface the 988 / Crisis Text
        // Line support banner mid-conversation.
        crisisSupport,
        tokensUsed: updatedTokensUsed,
        tokensRemaining,
        tokenLimit,
        nextResetAt: getNextPeriodStart().toISOString(),
        period: "day"
      });
      if (isFirstExchange && assistantTranscript.trim().length > 0) {
        const conversationIdForTitle = conversationId;
        const expectedTitleAtRequestTime = generateConversationTitle(userTranscript);
        void (async () => {
          try {
            const smartTitle = await generateSmartConversationTitle(
              userTranscript,
              assistantTranscript,
              userLanguage
            );
            if (!smartTitle) return;
            await db.update(conversations).set({ title: smartTitle }).where(
              and3(
                eq3(conversations.id, conversationIdForTitle),
                eq3(conversations.title, expectedTitleAtRequestTime)
              )
            );
          } catch (err) {
            console.error(
              "Smart title update failed:",
              err instanceof Error ? err.message : err
            );
          }
        })();
      }
    } catch (error) {
      console.error("Voice API error:", error);
      if (reservationActive && reservedPeriodStart) {
        try {
          await recordTokens(userId, -MIN_TOKENS_FOR_REQUEST, reservedPeriodStart);
        } catch (refundError) {
          console.error("Token refund error:", refundError);
        }
      }
      res.status(500).json({ error: "Failed to process voice message" });
    }
  });
  app2.post("/api/webhooks/revenuecat", express2.json(), async (req, res) => {
    try {
      const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
      if (expectedAuth) {
        if (req.headers.authorization !== expectedAuth) {
          return res.status(401).json({ error: "Unauthorized" });
        }
      } else if (process.env.NODE_ENV === "production") {
        console.error("[RC webhook] REVENUECAT_WEBHOOK_AUTH not set \u2014 rejecting webhook in production");
        return res.status(503).json({ error: "Webhook auth not configured" });
      } else {
        console.warn("[RC webhook] REVENUECAT_WEBHOOK_AUTH not set \u2014 accepting unauthenticated webhook (dev only)");
      }
      const event = req.body?.event;
      if (!event) return res.status(400).json({ error: "Missing event" });
      const appUserId = event.app_user_id;
      if (!appUserId) return res.status(200).json({ ok: true });
      const ACTIVE_EVENTS = /* @__PURE__ */ new Set([
        "INITIAL_PURCHASE",
        "RENEWAL",
        "UNCANCELLATION",
        "PRODUCT_CHANGE"
      ]);
      const LAPSED_EVENTS = /* @__PURE__ */ new Set([
        "EXPIRATION",
        "CANCELLATION",
        "BILLING_ISSUE",
        "SUBSCRIBER_ALIAS"
      ]);
      let isPremium = null;
      if (ACTIVE_EVENTS.has(event.type)) isPremium = true;
      else if (LAPSED_EVENTS.has(event.type)) isPremium = false;
      if (isPremium !== null) {
        await db.update(users).set({ isPremium }).where(eq3(users.id, appUserId));
        console.log(`[RC webhook] user=${appUserId} isPremium=${isPremium} event=${event.type}`);
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[RC webhook] error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
  await seedTestAccount();
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express3();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express3.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express3.urlencoded({ extended: false, limit: "50mb" }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      const isSensitivePath = path2.startsWith("/api/auth") || path2.startsWith("/api/chat");
      if (capturedJsonResponse && !isSensitivePath) {
        const safeResponse = {
          ...capturedJsonResponse
        };
        if ("token" in safeResponse) safeResponse.token = "[REDACTED]";
        if ("password" in safeResponse) safeResponse.password = "[REDACTED]";
        if ("audioBase64" in safeResponse)
          safeResponse.audioBase64 = "[REDACTED]";
        if ("text" in safeResponse) safeResponse.text = "[REDACTED]";
        if ("userTranscript" in safeResponse)
          safeResponse.userTranscript = "[REDACTED]";
        logLine += ` :: ${JSON.stringify(safeResponse)}`;
      }
      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express3.static(path.resolve(process.cwd(), "assets")));
  app2.use(express3.static(path.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  warnIfReferralDomainMissing();
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
