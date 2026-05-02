import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  intents: text("intents").array(),
  tone: text("tone"),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const TONE_OPTIONS = ["warm", "soft", "grounded"] as const;
export type Tone = (typeof TONE_OPTIONS)[number];

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
  markOnboardingComplete: z.boolean().optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export type UserPreferences = {
  displayName: string | null;
  intents: Intent[];
  tone: Tone | null;
  onboardingCompletedAt: string | null;
};

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
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

export const tokenUsage = pgTable(
  "token_usage",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    periodStart: timestamp("period_start").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    userPeriodIdx: index("token_usage_user_period_idx").on(table.userId, table.periodStart),
  }),
);

export type TokenUsage = typeof tokenUsage.$inferSelect;

export const FREE_TOKEN_LIMIT = 15000;
export const TOKEN_PERIOD = "day" as const;
