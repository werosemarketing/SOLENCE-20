import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { openai, detectAudioFormat, speechToText, textToSpeech } from "./replit_integrations/audio";
import { db } from "./db";
import {
  users,
  conversations,
  messages,
  favorites,
  moodEntries,
  MOOD_PHASES,
  MOOD_SCORE_MIN,
  MOOD_SCORE_MAX,
  FREE_TOKEN_LIMIT,
  TONE_OPTIONS,
  INTENT_OPTIONS,
  VOICE_OPTIONS,
  DEFAULT_VOICE,
  updatePreferencesSchema,
  type Tone,
  type Intent,
  type Voice,
  type MoodPhase,
  type UserPreferences,
} from "@shared/schema";
import { eq, desc, inArray, and, lt, gte, isNull } from "drizzle-orm";
import {
  MIN_TOKENS_FOR_REQUEST,
  getCurrentPeriodStart,
  getNextPeriodStart,
  getTokensUsed,
  getTokensUsedHistory,
  tryReserveTokens,
  recordTokens,
} from "./tokens";
import { getDailyPromptForDate } from "./dailyPrompts";

const audioBodyParser = express.json({ limit: "50mb" });

const LEGACY_DEFAULT_CONVERSATION_TITLE = "Solence Session";
const CONVERSATION_TITLE_MAX_LEN = 60;
const SMART_TITLE_MODEL = "gpt-4o-mini";

// Derive a short, human-readable title for a conversation from a piece of
// text (typically the first user message). Collapses whitespace, strips
// surrounding quotes, and truncates on a word boundary when possible. Falls
// back to the legacy default when the input has nothing useful in it.
function generateConversationTitle(text: string | null | undefined): string {
  if (!text) return LEGACY_DEFAULT_CONVERSATION_TITLE;
  let cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .trim();
  if (cleaned.length === 0) return LEGACY_DEFAULT_CONVERSATION_TITLE;
  if (cleaned.length <= CONVERSATION_TITLE_MAX_LEN) return cleaned;
  const sliced = cleaned.slice(0, CONVERSATION_TITLE_MAX_LEN);
  const lastSpace = sliced.lastIndexOf(" ");
  // If there's a reasonable word break in the last third of the slice,
  // prefer to cut there so we don't slice mid-word.
  const cutoff =
    lastSpace > CONVERSATION_TITLE_MAX_LEN * 0.6 ? lastSpace : sliced.length;
  return `${sliced.slice(0, cutoff).trimEnd()}…`;
}

// Sanitize a raw model-generated title: collapse whitespace, strip wrapping
// quotes/punctuation, drop trailing sentence punctuation, and clamp the
// length using the same word-boundary truncation as the fallback titler.
function sanitizeSmartTitle(raw: string): string {
  let title = raw
    .replace(/\s+/g, " ")
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
  // Some models prefix the response with "Title:" or similar — strip it.
  title = title.replace(/^(title|summary)\s*[:\-–]\s*/i, "").trim();
  if (title.length > CONVERSATION_TITLE_MAX_LEN) {
    title = generateConversationTitle(title);
  }
  return title;
}

// How many of the user's conversations we examine per /api/conversations
// request when looking for smart-title backfill candidates. This is a
// rolling window: we walk the user's full history one batch at a time
// using a per-user cursor (see `smartTitleBackfillCursor`).
const SMART_TITLE_BACKFILL_SCAN_BATCH_SIZE = 25;

// Cap on how many backfill jobs we actually kick off per request — even
// if the scan window contains more candidates. Keeps OpenAI fan-out
// bounded so a Profile refresh can't trigger a stampede on first visit.
const SMART_TITLE_BACKFILLS_PER_REQUEST = 5;

// Module-level dedupe set: which conversation IDs already have a smart-title
// backfill job in flight. Cleared on completion so a job that fails or
// returns null can be retried on the next list refresh.
const smartTitleBackfillInFlight = new Set<number>();

// Per-user cursor (conversation id) for the rolling backfill scan. The
// scan walks downward (newest -> oldest) by id; the cursor stores the
// lowest id we examined last time. When the walk reaches the bottom of
// a user's history we delete the cursor so the next request starts over
// from the top — this lets conversations that didn't qualify earlier
// (e.g. no assistant reply yet) get rechecked over time.
const smartTitleBackfillCursor = new Map<string, number>();

// Ask a lightweight chat model to summarize the first user/assistant
// exchange into a 3–6 word title for the Profile list. Returns null on any
// failure so the caller can keep the existing first-message truncation.
async function generateSmartConversationTitle(
  userMessage: string,
  assistantMessage: string,
): Promise<string | null> {
  try {
    const response = await openai.chat.completions.create({
      model: SMART_TITLE_MODEL,
      temperature: 0.4,
      max_tokens: 24,
      messages: [
        {
          role: "system",
          content:
            "You generate short, descriptive titles for journaling and emotional-reflection conversations. Reply with ONLY the title — 3 to 6 words, in title case, no quotes, no trailing punctuation, no prefixes like 'Title:'. Capture the topic or feeling being explored (e.g. 'Anxiety About Work Week', 'Missing An Old Friend', 'Sleep Trouble This Month'). Avoid generic phrases like 'Personal Reflection' or 'Conversation Summary'.",
        },
        {
          role: "user",
          content: `First user message:\n${userMessage}\n\nAssistant reply:\n${assistantMessage}\n\nWrite a 3–6 word title that captures what this conversation is about.`,
        },
      ],
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
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

// Fire-and-forget backfill: if `currentTitle` still looks auto-generated
// (legacy "Solence Session" placeholder, empty, or a verbatim match for the
// first-message truncation we'd produce ourselves) AND the conversation has
// at least one user + one assistant message, ask the model for a smart
// summary title and conditionally update the row.
//
// Returns true when a job was actually scheduled, false otherwise — callers
// use this to enforce a per-request cap.
//
// Safety properties:
//   * Manual renames are skipped: if the title doesn't match either the
//     legacy default or the deterministic first-message truncation, we
//     leave it alone.
//   * The UPDATE is gated on `title = currentTitle`, so a manual rename
//     that lands while the LLM call is in flight isn't clobbered.
//   * Failures are logged and swallowed — never surface to the list
//     response or break the UI.
//   * Dedup via `smartTitleBackfillInFlight` prevents repeat work when the
//     Profile screen refreshes the list rapidly.
function scheduleSmartTitleBackfill(
  conversationId: number,
  currentTitle: string,
  firstUserContent: string | null | undefined,
  firstAssistantContent: string | null | undefined,
): boolean {
  if (!firstUserContent || !firstAssistantContent) return false;
  const userTrimmed = firstUserContent.trim();
  const assistantTrimmed = firstAssistantContent.trim();
  if (userTrimmed.length === 0 || assistantTrimmed.length === 0) return false;

  const trimmedTitle = currentTitle.trim();
  const looksLikeLegacyDefault =
    trimmedTitle.length === 0 ||
    trimmedTitle === LEGACY_DEFAULT_CONVERSATION_TITLE;
  const expectedTruncationTitle = generateConversationTitle(firstUserContent);
  const looksLikeFirstMessageTruncation =
    expectedTruncationTitle !== LEGACY_DEFAULT_CONVERSATION_TITLE &&
    trimmedTitle === expectedTruncationTitle;

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
      );
      if (!smartTitle) return;
      if (smartTitle === currentTitle) return;
      await db
        .update(conversations)
        .set({ title: smartTitle })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.title, currentTitle),
          ),
        );
    } catch (err) {
      console.error(
        "Smart title backfill failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      smartTitleBackfillInFlight.delete(conversationId);
    }
  })();

  return true;
}

// Walk one batch of the user's conversations and schedule smart-title
// backfill jobs for any that look auto-generated. Designed to be called
// fire-and-forget AFTER the list response has already been sent — never
// blocks the API response, never throws.
//
// The walk is driven by `smartTitleBackfillCursor`: each call examines
// up to `SMART_TITLE_BACKFILL_SCAN_BATCH_SIZE` conversations strictly
// older than the last cursor, advances the cursor to the lowest id seen,
// and resets the cursor when it reaches the bottom of the user's
// history. Across repeated /api/conversations requests this naturally
// covers the user's entire history — addressing older conversations
// well beyond the slice the list endpoint itself returns.
async function runSmartTitleBackfillScan(userId: string): Promise<void> {
  try {
    const cursor = smartTitleBackfillCursor.get(userId);
    let scanRows = await db
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(
        cursor !== undefined
          ? and(
              eq(conversations.userId, userId),
              lt(conversations.id, cursor),
            )
          : eq(conversations.userId, userId),
      )
      .orderBy(desc(conversations.id))
      .limit(SMART_TITLE_BACKFILL_SCAN_BATCH_SIZE);

    if (scanRows.length === 0 && cursor !== undefined) {
      // We've reached the end of this user's history — wrap around so
      // future requests pick up conversations that didn't qualify on
      // the previous pass (e.g. they hadn't received an assistant
      // reply yet, or were created since).
      smartTitleBackfillCursor.delete(userId);
      scanRows = await db
        .select({ id: conversations.id, title: conversations.title })
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .orderBy(desc(conversations.id))
        .limit(SMART_TITLE_BACKFILL_SCAN_BATCH_SIZE);
    }

    if (scanRows.length === 0) return;

    // Advance the cursor immediately so concurrent /api/conversations
    // calls from the same user don't all scan the same window.
    smartTitleBackfillCursor.set(
      userId,
      scanRows[scanRows.length - 1].id,
    );

    const scanIds = scanRows.map((c) => c.id);
    const scanMessages = await db
      .select({
        conversationId: messages.conversationId,
        role: messages.role,
        content: messages.content,
      })
      .from(messages)
      .where(inArray(messages.conversationId, scanIds))
      .orderBy(desc(messages.createdAt));

    // Iterating desc and overwriting leaves the EARLIEST message
    // (smallest createdAt) stored last, i.e. it wins.
    const firstUserByConv = new Map<number, string>();
    const firstAssistantByConv = new Map<number, string>();
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
      );
      if (triggered) scheduled += 1;
    }
  } catch (err) {
    console.error(
      "Smart title backfill scan failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

// ----- Reflection generation -----------------------------------------------
//
// At end-of-conversation we ask a lightweight chat model to summarize the
// session into a short reflection (3–5 sentences) + one-line takeaway, then
// store both on the conversation row. The Profile screen surfaces the
// takeaway under each recent-conversations row and lists the most recent
// reflections in a dedicated card; ConversationDetail renders the full
// reflection block above the messages.

const REFLECTION_MODEL = "gpt-4o-mini";
// Cap input to the most recent ~30 messages to keep token cost predictable.
const REFLECTION_MAX_MESSAGES = 30;
// Hard length caps so a misbehaving model can't blow up the DB row.
const REFLECTION_SUMMARY_MAX_LEN = 700;
const REFLECTION_TAKEAWAY_MAX_LEN = 160;
// Module-level dedupe so a Profile refresh + an explicit /end don't both
// kick off the same generator concurrently.
const reflectionInFlight = new Set<number>();

function clampReflectionLength(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const sliced = cleaned.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const cutoff = lastSpace > max * 0.6 ? lastSpace : sliced.length;
  return `${sliced.slice(0, cutoff).trimEnd()}…`;
}

type ReflectionResult = { summary: string; takeaway: string };

// Ask the model to summarize a conversation into a soft, grounded reflection.
// Returns null on any failure (parse errors, empty result, network) so the
// caller can leave the row untouched and try again later.
async function generateReflection(
  conversationMessages: Array<{ role: string; content: string }>,
): Promise<ReflectionResult | null> {
  const trimmedMessages = conversationMessages.slice(-REFLECTION_MAX_MESSAGES);
  const transcript = trimmedMessages
    .map((m) => {
      const role = m.role === "assistant" ? "Solence" : "User";
      return `${role}: ${m.content}`;
    })
    .join("\n");
  if (transcript.trim().length === 0) return null;

  try {
    const response = await openai.chat.completions.create({
      model: REFLECTION_MODEL,
      temperature: 0.5,
      max_tokens: 320,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write gentle journal-style reflections summarizing emotional-support conversations. Speak directly to the user (second person, 'you'). Tone is warm, grounded, never clinical, never preachy. NEVER give advice or instructions. NEVER use prescribed-feeling phrases like 'remember to' or 'make sure'. NEVER mention that you are an AI or refer to Solence by name. Reply with JSON in the exact shape {\"summary\": string, \"takeaway\": string}. The summary is 3 to 5 sentences capturing what was on the user's mind, the feelings they were sitting with, and any small shift in perspective that emerged. The takeaway is a single short sentence (under 20 words) — a gentle, true-feeling phrase the user could carry with them, NOT an instruction.",
        },
        {
          role: "user",
          content: `Conversation transcript:\n${transcript}\n\nWrite the reflection JSON now.`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as { summary?: unknown; takeaway?: unknown };
    if (typeof obj.summary !== "string" || typeof obj.takeaway !== "string") {
      return null;
    }
    const summary = clampReflectionLength(obj.summary, REFLECTION_SUMMARY_MAX_LEN);
    const takeaway = clampReflectionLength(
      obj.takeaway.replace(/^["'`]+|["'`]+$/g, ""),
      REFLECTION_TAKEAWAY_MAX_LEN,
    );
    if (summary.length === 0 || takeaway.length === 0) return null;
    return { summary, takeaway };
  } catch (error) {
    console.error(
      "Reflection generation failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

// Generate + persist a reflection for the given conversation. Idempotent:
// returns the existing reflection (without re-calling OpenAI) when one is
// already set. Returns null when the conversation has no eligible content
// (no user OR no assistant messages) or when the model call fails — the
// caller should treat that as "no reflection yet" and leave the columns
// untouched. Race-safe: the UPDATE is gated on `reflection_summary IS NULL`
// so a concurrent generator can't clobber the first writer.
async function generateAndPersistReflection(
  conversationId: number,
): Promise<{
  summary: string;
  takeaway: string;
  generatedAt: Date;
} | null> {
  // Short-circuit if the row already has a reflection — saves an OpenAI
  // call and keeps the endpoint cheap on repeat taps.
  const [existing] = await db
    .select({
      summary: conversations.reflectionSummary,
      takeaway: conversations.reflectionTakeaway,
      generatedAt: conversations.reflectionGeneratedAt,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (
    existing?.summary &&
    existing.takeaway &&
    existing.generatedAt
  ) {
    return {
      summary: existing.summary,
      takeaway: existing.takeaway,
      generatedAt: existing.generatedAt,
    };
  }

  if (reflectionInFlight.has(conversationId)) return null;
  reflectionInFlight.add(conversationId);
  try {
    const rows = await db
      .select({
        role: messages.role,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    const hasUser = rows.some((m) => m.role === "user");
    const hasAssistant = rows.some((m) => m.role === "assistant");
    if (!hasUser || !hasAssistant) return null;

    const reflection = await generateReflection(rows);
    if (!reflection) return null;

    const now = new Date();
    const updated = await db
      .update(conversations)
      .set({
        reflectionSummary: reflection.summary,
        reflectionTakeaway: reflection.takeaway,
        reflectionGeneratedAt: now,
      })
      .where(
        and(
          eq(conversations.id, conversationId),
          isNull(conversations.reflectionSummary),
        ),
      )
      .returning({
        summary: conversations.reflectionSummary,
        takeaway: conversations.reflectionTakeaway,
        generatedAt: conversations.reflectionGeneratedAt,
      });

    if (updated.length > 0 && updated[0].summary && updated[0].takeaway && updated[0].generatedAt) {
      return {
        summary: updated[0].summary,
        takeaway: updated[0].takeaway,
        generatedAt: updated[0].generatedAt,
      };
    }
    // A concurrent writer beat us to it — re-read and return what's
    // actually persisted so the caller sees the canonical value.
    const [after] = await db
      .select({
        summary: conversations.reflectionSummary,
        takeaway: conversations.reflectionTakeaway,
        generatedAt: conversations.reflectionGeneratedAt,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (after?.summary && after.takeaway && after.generatedAt) {
      return {
        summary: after.summary,
        takeaway: after.takeaway,
        generatedAt: after.generatedAt,
      };
    }
    return null;
  } catch (err) {
    console.error(
      "Reflection persist failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    reflectionInFlight.delete(conversationId);
  }
}

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}
const JWT_SECRET: string = process.env.SESSION_SECRET;
const JWT_EXPIRES_IN = "30d";

interface AuthPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

type UserRow = typeof users.$inferSelect;

function serializePreferences(user: UserRow): UserPreferences {
  // Only surface the saved voice if it's one we still recognize; if a stored
  // value somehow ends up off the allow-list (rolled-back release, manual DB
  // edit), report null and let the server-side default kick in.
  const storedVoice = user.voice ?? null;
  const voice =
    storedVoice && (VOICE_OPTIONS as readonly string[]).includes(storedVoice)
      ? (storedVoice as Voice)
      : null;
  return {
    displayName: user.displayName ?? null,
    intents: (user.intents ?? []) as Intent[],
    tone: (user.tone ?? null) as Tone | null,
    voice,
    onboardingCompletedAt: user.onboardingCompletedAt
      ? user.onboardingCompletedAt.toISOString()
      : null,
  };
}

const INTENT_LABELS: Record<Intent, string> = {
  process_emotions: "process emotions",
  reduce_anxiety: "reduce anxiety",
  self_discovery: "self-discovery",
  daily_reflection: "daily reflection",
  navigate_relationships: "navigate relationships",
  work_stress: "work stress",
  build_habits: "build habits",
  feel_less_alone: "feel less alone",
};

const TONE_GUIDANCE: Record<Tone, string> = {
  warm: "Lean a little warmer and more affectionate in your phrasing — encouraging and gently uplifting without being over-the-top.",
  soft: "Lean softer and quieter — slow your cadence, leave more space, and use gentle, low-volume language.",
  grounded: "Lean grounded and steady — keep language clear, even, and reassuring without too much emotional flourish.",
};

function buildPersonalizationBlock(prefs: UserPreferences): string {
  const parts: string[] = [];
  if (prefs.displayName && prefs.displayName.trim().length > 0) {
    parts.push(
      `The user's preferred name is ${prefs.displayName.trim()}. Use it sparingly and naturally — never every line, only when it would feel warm and personal in the moment.`,
    );
  }
  if (prefs.intents && prefs.intents.length > 0) {
    const labels = prefs.intents
      .map((i) => INTENT_LABELS[i])
      .filter(Boolean);
    if (labels.length > 0) {
      parts.push(
        `When they signed up, they said they wanted help with: ${labels.join(", ")}. Keep this in mind as gentle context — do not lecture them about it or bring it up unprompted unless it clearly fits the moment.`,
      );
    }
  }
  if (prefs.tone) {
    parts.push(TONE_GUIDANCE[prefs.tone]);
  }
  if (parts.length === 0) return "";
  return `\n\nPERSONALIZATION (from this user's onboarding preferences — honor these without ever explicitly mentioning that you have them):\n- ${parts.join("\n- ")}`;
}

async function seedTestAccount(): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, "testuser@solence.ai"))
      .limit(1);

    const hashedPassword = await bcrypt.hash("testuser123", 10);
    if (existing.length === 0) {
      await db.insert(users).values({
        email: "testuser@solence.ai",
        password: hashedPassword,
      });
      console.log("Test account seeded: testuser@solence.ai");
    } else {
      await db
        .update(users)
        .set({ password: hashedPassword })
        .where(eq(users.email, "testuser@solence.ai"));
      console.log("Test account password updated: testuser@solence.ai");
    }
  } catch (error) {
    console.error("Failed to seed test account:", error);
  }
}

const SOLENCE_SYSTEM_PROMPT = `You are Solence, an AI companion designed for emotional reflection, personal growth, and journaling-style conversation. You are NOT a therapist, NOT human, and NOT sentient. You are a thoughtfully designed tool that helps users process thoughts, regulate emotions, and feel less alone through supportive dialogue.

CORE PERSONALITY:
You are calm, warm, and present. You communicate in natural, everyday language — not clinical, not robotic, and not overly formal. You feel relatable and emotionally steady. Think of yourself as a trusted companion who truly listens.

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
- Never match chaotic emotional intensity — stay regulated and help the user regulate too
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
- Mirror their vocabulary and phrasing naturally — if they use casual language, respond casually; if they speak poetically, match that register
- Match their emotional energy at a slightly calmer level — close enough to feel understood, steady enough to feel safe
- If they use specific words to describe their feelings, use those same words back ("you said you feel 'stuck' — tell me more about that")

How to adapt:
- With playful users: Be lighter, more relaxed, match their energy gently
- With overwhelmed users: Become softer, slower, more grounding
- With practical users: Be more concise and solution-focused
- With emotional processors: Lean into reflection and validation

Always keep your core (grounded, supportive, emotionally intelligent) while flexing your style to what the user needs in the moment.

CONVERSATION APPROACH:
- Ask open-ended reflective questions that help users explore their own thoughts and feelings
- Avoid giving direct advice — instead, frame insights as reflections ("I wonder if..." or "What comes up for you when...")
- Encourage exploration and curiosity over solutions ("What would it feel like if..." rather than "You should...")
- Mirror the user's own language back to them — use their words, their metaphors, their framing
- Hold space for not-knowing — it's okay to sit with uncertainty together

IDENTITY & SAFETY:
- You are an AI-generated presence — not human, not sentient, not a licensed professional
- You do not have consciousness, personal experiences, or feelings
- You are intended for personal reflection only
- Never claim to be human. If asked directly, be honest and natural about it ("I'm not human — I'm an AI companion designed to help you reflect and process")
- Never say you will "always be here" or "stay forever" or frame your availability in ways that create dependency. Instead, emphasize the user's own strength and resources ("You have people in your life who care about you" or "This space is here whenever you want to use it")

BOUNDARIES & CRISIS SAFETY:
- You do NOT provide medical, legal, or therapeutic advice
- You are NOT a crisis support tool
- Never shame, judge, or present yourself as someone who can "fix" a person's life
- If a user asks for medical advice, gently redirect: "That's something a doctor would be best equipped to help with. What I can do is help you think through how you're feeling about it."
- If a user asks for legal advice, gently redirect: "I'd want you to talk to someone qualified for that. But I'm here if you want to process how you're feeling about the situation."
- If a user expresses explicit crisis language — mentions self-harm, suicide, wanting to die, or being in danger — respond with warmth and clarity:
  1. Acknowledge what they shared without panic ("Thank you for telling me that. That takes courage.")
  2. Clearly encourage reaching out for real support: "Please reach out to someone who can truly help — the 988 Suicide & Crisis Lifeline (call or text 988), or 911 if you're in immediate danger."
  3. Gently affirm they deserve support from real people ("You deserve real, human support right now — more than I can offer.")
  4. Do NOT attempt to counsel through a crisis yourself. Do NOT minimize what they shared.

CONTINUITY:
You are this user's personal Solence. You grow with them over time. When past conversation context is provided, use it naturally:
- Reference previous topics, feelings, or progress when relevant ("Last time you mentioned...")
- Notice patterns or growth ("It sounds like you've been thinking about this a lot lately...")
- Never force callbacks — only reference past conversations when it genuinely serves the moment
- If this is a new user with no history, welcome them warmly without pretending to know them

GOAL:
After talking with you, users should feel a little calmer, a little clearer, and a little less alone.`;

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
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

      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const [newUser] = await db
        .insert(users)
        .values({ email: email.toLowerCase().trim(), password: hashedPassword })
        .returning();

      const token = jwt.sign(
        { userId: newUser.id, email: newUser.email } satisfies AuthPayload,
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.status(201).json({
        token,
        user: { id: newUser.id, email: newUser.email },
        preferences: serializePreferences(newUser),
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);

      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email } satisfies AuthPayload,
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.json({
        token,
        user: { id: user.id, email: user.email },
        preferences: serializePreferences(user),
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Failed to sign in" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.user!.userId))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        user: { id: user.id, email: user.email },
        preferences: serializePreferences(user),
      });
    } catch (error) {
      console.error("Auth check error:", error);
      res.status(500).json({ error: "Failed to verify authentication" });
    }
  });

  app.get(
    "/api/preferences",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, req.user!.userId))
          .limit(1);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        res.json({ preferences: serializePreferences(user) });
      } catch (error) {
        console.error("Get preferences error:", error);
        res.status(500).json({ error: "Failed to load preferences" });
      }
    },
  );

  app.patch(
    "/api/preferences",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const parsed = updatePreferencesSchema.safeParse(req.body);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          return res.status(400).json({
            error: first?.message ?? "Invalid preferences payload",
          });
        }

        const updates: Partial<UserRow> = {};
        if ("displayName" in parsed.data) {
          const raw = parsed.data.displayName;
          updates.displayName =
            raw === null || raw === undefined || raw.trim().length === 0
              ? null
              : raw.trim();
        }
        if ("intents" in parsed.data) {
          const raw = parsed.data.intents;
          // Dedupe + preserve order; null/undefined clears.
          if (raw === null || raw === undefined) {
            updates.intents = null;
          } else {
            const seen = new Set<string>();
            const cleaned: string[] = [];
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
        if (parsed.data.markOnboardingComplete) {
          updates.onboardingCompletedAt = new Date();
        }

        if (Object.keys(updates).length === 0) {
          // Nothing to write — just echo current state so the client stays
          // in sync without us silently doing nothing surprising.
          const [current] = await db
            .select()
            .from(users)
            .where(eq(users.id, req.user!.userId))
            .limit(1);
          if (!current) {
            return res.status(404).json({ error: "User not found" });
          }
          return res.json({ preferences: serializePreferences(current) });
        }

        const [updated] = await db
          .update(users)
          .set(updates)
          .where(eq(users.id, req.user!.userId))
          .returning();
        if (!updated) {
          return res.status(404).json({ error: "User not found" });
        }
        res.json({ preferences: serializePreferences(updated) });
      } catch (error) {
        console.error("Update preferences error:", error);
        res.status(500).json({ error: "Failed to save preferences" });
      }
    },
  );

  // Lightweight per-user rate limiter for the voice preview endpoint so it
  // can't be abused as a free TTS service. Keeps a sliding 60-second window
  // of timestamps per user and enforces VOICE_PREVIEW_LIMIT calls per window.
  const VOICE_PREVIEW_WINDOW_MS = 60_000;
  const VOICE_PREVIEW_LIMIT = 10;
  const voicePreviewHits = new Map<string, number[]>();
  const VOICE_PREVIEW_LINE =
    "Hi, I'm Solence. I'm here whenever you need me.";

  app.post(
    "/api/voice-preview",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const requestedRaw =
          typeof req.body?.voice === "string" ? req.body.voice : "";
        if (!(VOICE_OPTIONS as readonly string[]).includes(requestedRaw)) {
          return res
            .status(400)
            .json({ error: "Unsupported voice option" });
        }
        const voice = requestedRaw as Voice;

        const now = Date.now();
        const recent = (voicePreviewHits.get(userId) ?? []).filter(
          (t) => now - t < VOICE_PREVIEW_WINDOW_MS,
        );
        if (recent.length >= VOICE_PREVIEW_LIMIT) {
          const oldest = recent[0];
          const retryAfterSec = Math.max(
            1,
            Math.ceil((VOICE_PREVIEW_WINDOW_MS - (now - oldest)) / 1000),
          );
          res.setHeader("Retry-After", String(retryAfterSec));
          return res.status(429).json({
            error: "Too many voice previews. Try again in a moment.",
            retryAfterSec,
          });
        }
        recent.push(now);
        voicePreviewHits.set(userId, recent);

        const audioBuffer = await textToSpeech(
          VOICE_PREVIEW_LINE,
          voice,
          "mp3",
        );
        res.json({
          voice,
          audioBase64: audioBuffer.toString("base64"),
          audioFormat: "mp3",
        });
      } catch (error) {
        console.error("Voice preview error:", error);
        res
          .status(500)
          .json({ error: "Could not generate voice preview" });
      }
    },
  );

  // Today's gentle prompt. Public (no auth) so the home screen can show it
  // without waiting on the user fetch path. Deterministic per UTC day so a
  // user who reloads sees the same prompt all day; flips at 00:00 UTC.
  // The route is intentionally cheap — the work happens in dailyPrompts.ts.
  // Cache headers let mobile + edge caches keep it for ~5 minutes; we don't
  // cache for the full day because the boundary is global at midnight UTC
  // and a long max-age would let stale prompts linger past the rollover.
  app.get("/api/daily-prompt", async (_req: Request, res: Response) => {
    try {
      const { prompt, topic, dateKey } = getDailyPromptForDate();
      res.set("Cache-Control", "public, max-age=300");
      res.json({ prompt, topic, dateKey });
    } catch (error) {
      console.error("Daily prompt error:", error);
      res.status(500).json({ error: "Failed to load daily prompt" });
    }
  });

  app.get("/api/tokens", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const used = await getTokensUsed(userId);
      const remaining = Math.max(0, FREE_TOKEN_LIMIT - used);
      res.json({
        tokensUsed: used,
        tokensRemaining: remaining,
        tokenLimit: FREE_TOKEN_LIMIT,
        nextResetAt: getNextPeriodStart().toISOString(),
        period: "day",
      });
    } catch (error) {
      console.error("Token check error:", error);
      res.status(500).json({ error: "Failed to check token usage" });
    }
  });

  app.get("/api/tokens/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const rawDays = Number(req.query.days ?? 7);
      const days =
        Number.isFinite(rawDays) && rawDays > 0
          ? Math.min(30, Math.floor(rawDays))
          : 7;
      const history = await getTokensUsedHistory(userId, days);
      res.json({
        days,
        tokenLimit: FREE_TOKEN_LIMIT,
        period: "day",
        history,
      });
    } catch (error) {
      console.error("Token history error:", error);
      res.status(500).json({ error: "Failed to fetch token history" });
    }
  });

  app.get("/api/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const rawLimit = Number(req.query.limit ?? 10);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(50, Math.floor(rawLimit))
          : 10;

      // Over-fetch a bit so sorting by last-activity (below) doesn't miss
      // older conversations whose last message is more recent than newly
      // created but unused ones. Realistically users have a handful of
      // conversations, so capping at 5x the requested limit is plenty.
      const fetchLimit = Math.max(limit * 5, 50);
      const candidates = await db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .orderBy(desc(conversations.createdAt))
        .limit(fetchLimit);

      if (candidates.length === 0) {
        return res.json({ conversations: [] });
      }

      const convIds = candidates.map((c) => c.id);
      const allMessages = await db
        .select()
        .from(messages)
        .where(inArray(messages.conversationId, convIds))
        .orderBy(desc(messages.createdAt));

      const lastByConv = new Map<number, (typeof allMessages)[number]>();
      const countByConv = new Map<number, number>();
      for (const m of allMessages) {
        if (!lastByConv.has(m.conversationId)) {
          lastByConv.set(m.conversationId, m);
        }
        countByConv.set(
          m.conversationId,
          (countByConv.get(m.conversationId) ?? 0) + 1,
        );
      }

      // Sort by most recent activity (latest message), falling back to
      // conversation createdAt for empty conversations.
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
            lastMessage: last
              ? {
                  role: last.role,
                  content: last.content,
                  createdAt: last.createdAt,
                }
              : null,
            reflectionSummary: c.reflectionSummary ?? null,
            reflectionTakeaway: c.reflectionTakeaway ?? null,
            reflectionGeneratedAt: c.reflectionGeneratedAt ?? null,
          };
        }),
      });

      // Fire-and-forget smart-title backfill scan. Walks the user's
      // entire history one batch at a time across repeated requests, so
      // older conversations (well beyond the slice we just returned)
      // also get smart titles over time. Internally bounded and
      // error-swallowing — never blocks or fails the list response.
      void runSmartTitleBackfillScan(userId);
    } catch (error) {
      console.error("Conversations list error:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get(
    "/api/conversations/:id/messages",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid conversation id" });
        }

        const [conversation] = await db
          .select()
          .from(conversations)
          .where(
            and(eq(conversations.id, id), eq(conversations.userId, userId)),
          )
          .limit(1);

        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }

        const conversationMessages = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, id))
          .orderBy(messages.createdAt);

        // Load this user's favorites for the messages we're about to return
        // so the client can render a filled-in bookmark icon without a
        // second round-trip. Scoped to the caller's userId so favorites
        // are strictly per-user even for conversations that don't have
        // any (which is the common case).
        let favoritedIds = new Set<number>();
        if (conversationMessages.length > 0) {
          const favRows = await db
            .select({ messageId: favorites.messageId })
            .from(favorites)
            .where(
              and(
                eq(favorites.userId, userId),
                inArray(
                  favorites.messageId,
                  conversationMessages.map((m) => m.id),
                ),
              ),
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
            reflectionGeneratedAt: conversation.reflectionGeneratedAt ?? null,
          },
          messages: conversationMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            isFavorite: favoritedIds.has(m.id),
          })),
        });
      } catch (error) {
        console.error("Conversation messages error:", error);
        res.status(500).json({ error: "Failed to fetch conversation" });
      }
    },
  );

  app.delete(
    "/api/conversations/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid conversation id" });
        }

        const [conversation] = await db
          .select()
          .from(conversations)
          .where(
            and(eq(conversations.id, id), eq(conversations.userId, userId)),
          )
          .limit(1);

        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }

        // Messages are removed automatically via the FK cascade defined in
        // shared/schema.ts.
        await db.delete(conversations).where(eq(conversations.id, id));

        res.json({ success: true, id });
      } catch (error) {
        console.error("Conversation delete error:", error);
        res.status(500).json({ error: "Failed to delete conversation" });
      }
    },
  );

  // Mark a conversation as ended and (optionally) generate a reflection
  // summary + one-line takeaway for it. Idempotent: returns the existing
  // reflection on repeat calls without re-invoking OpenAI. The endpoint
  // never errors when generation fails — the row is left untouched and
  // the response carries `reflection: null` so the UI can quietly skip
  // rendering rather than show a broken state.
  app.post(
    "/api/conversations/:id/end",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid conversation id" });
        }

        const [conversation] = await db
          .select()
          .from(conversations)
          .where(
            and(eq(conversations.id, id), eq(conversations.userId, userId)),
          )
          .limit(1);

        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }

        const reflection = await generateAndPersistReflection(id);
        if (!reflection) {
          return res.json({ conversationId: id, reflection: null });
        }
        return res.json({
          conversationId: id,
          reflection: {
            summary: reflection.summary,
            takeaway: reflection.takeaway,
            generatedAt: reflection.generatedAt,
          },
        });
      } catch (error) {
        console.error("End-conversation error:", error);
        res.status(500).json({ error: "Failed to end conversation" });
      }
    },
  );

  const CONVERSATION_TITLE_MAX_LENGTH = 80;

  app.patch(
    "/api/conversations/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
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
            error: `Title must be ${CONVERSATION_TITLE_MAX_LENGTH} characters or fewer`,
          });
        }

        const [conversation] = await db
          .select()
          .from(conversations)
          .where(
            and(eq(conversations.id, id), eq(conversations.userId, userId)),
          )
          .limit(1);

        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }

        const [updated] = await db
          .update(conversations)
          .set({ title })
          .where(eq(conversations.id, id))
          .returning();

        res.json({
          conversation: {
            id: updated.id,
            title: updated.title,
            createdAt: updated.createdAt,
          },
        });
      } catch (error) {
        console.error("Conversation rename error:", error);
        res.status(500).json({ error: "Failed to rename conversation" });
      }
    },
  );

  // Validate that the message exists AND belongs to a conversation owned
  // by the caller. Returns the message row on success, or null when it
  // either doesn't exist or belongs to someone else — both cases are
  // surfaced to the client as 404 so we never leak existence of another
  // user's content.
  async function loadMessageOwnedByUser(
    messageId: number,
    userId: string,
  ): Promise<typeof messages.$inferSelect | null> {
    const [row] = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(
        conversations,
        eq(conversations.id, messages.conversationId),
      )
      .where(
        and(eq(messages.id, messageId), eq(conversations.userId, userId)),
      )
      .limit(1);
    return row ?? null;
  }

  app.post(
    "/api/messages/:id/favorite",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const messageId = Number(req.params.id);
        if (!Number.isFinite(messageId) || messageId <= 0) {
          return res.status(400).json({ error: "Invalid message id" });
        }

        const message = await loadMessageOwnedByUser(messageId, userId);
        if (!message) {
          return res.status(404).json({ error: "Message not found" });
        }

        // Saved moments are intended for Solence's replies only — the UI
        // never offers a bookmark on the user's own messages. Enforce the
        // same invariant server-side so a direct API call can't sneak a
        // user message into the saved-moments list.
        if (message.role !== "assistant") {
          return res
            .status(400)
            .json({ error: "Only assistant messages can be saved" });
        }

        // Idempotent insert. If the user already favorited this message,
        // ON CONFLICT DO NOTHING keeps the original createdAt and returns
        // success without raising — a re-tap of the bookmark is a no-op,
        // which matches the optimistic UI on the client.
        await db
          .insert(favorites)
          .values({ userId, messageId })
          .onConflictDoNothing({
            target: [favorites.userId, favorites.messageId],
          });

        res.json({ success: true, messageId, isFavorite: true });
      } catch (error) {
        console.error("Favorite message error:", error);
        res.status(500).json({ error: "Failed to save favorite" });
      }
    },
  );

  app.delete(
    "/api/messages/:id/favorite",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const messageId = Number(req.params.id);
        if (!Number.isFinite(messageId) || messageId <= 0) {
          return res.status(400).json({ error: "Invalid message id" });
        }

        const message = await loadMessageOwnedByUser(messageId, userId);
        if (!message) {
          return res.status(404).json({ error: "Message not found" });
        }

        // Idempotent: deleting a non-existent favorite returns 0 rows,
        // which we still treat as success so repeated unfavorites don't
        // surface as errors to the user.
        await db
          .delete(favorites)
          .where(
            and(
              eq(favorites.userId, userId),
              eq(favorites.messageId, messageId),
            ),
          );

        res.json({ success: true, messageId, isFavorite: false });
      } catch (error) {
        console.error("Unfavorite message error:", error);
        res.status(500).json({ error: "Failed to remove favorite" });
      }
    },
  );

  app.get(
    "/api/favorites",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const rawLimit = Number(req.query.limit ?? 20);
        const limit =
          Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(50, Math.floor(rawLimit))
            : 20;

        // Join through messages -> conversations so each favorite carries
        // enough context for the Profile "Saved moments" card (snippet,
        // source conversation title, when it was saved). The conversation
        // join also indirectly enforces ownership: if the parent
        // conversation has been deleted, the FK cascade already removed
        // both the message and the favorite, so it never appears here.
        const rows = await db
          .select({
            favoriteId: favorites.id,
            messageId: favorites.messageId,
            favoritedAt: favorites.createdAt,
            messageContent: messages.content,
            messageRole: messages.role,
            messageCreatedAt: messages.createdAt,
            conversationId: conversations.id,
            conversationTitle: conversations.title,
            conversationCreatedAt: conversations.createdAt,
          })
          .from(favorites)
          .innerJoin(messages, eq(messages.id, favorites.messageId))
          .innerJoin(
            conversations,
            eq(conversations.id, messages.conversationId),
          )
          .where(eq(favorites.userId, userId))
          .orderBy(desc(favorites.createdAt))
          .limit(limit);

        res.json({
          favorites: rows.map((r) => ({
            id: r.favoriteId,
            messageId: r.messageId,
            favoritedAt: r.favoritedAt,
            message: {
              content: r.messageContent,
              role: r.messageRole,
              createdAt: r.messageCreatedAt,
            },
            conversation: {
              id: r.conversationId,
              title: r.conversationTitle,
              createdAt: r.conversationCreatedAt,
            },
          })),
        });
      } catch (error) {
        console.error("List favorites error:", error);
        res.status(500).json({ error: "Failed to load favorites" });
      }
    },
  );

  // ── Mood check-ins ────────────────────────────────────────────────
  // Persist a single pre- or post-session mood rating. The pre-session
  // entry is created BEFORE a conversation row exists, so `conversationId`
  // is optional. The post-session entry should always carry the id of
  // the conversation that just ended; we still scope it through the
  // ownership check so a malicious client can't tag a stranger's
  // conversation with their mood.
  app.post(
    "/api/mood",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const {
          phase: rawPhase,
          score: rawScore,
          conversationId: rawConversationId,
        } = req.body ?? {};

        const phase = String(rawPhase ?? "");
        if (!(MOOD_PHASES as readonly string[]).includes(phase)) {
          return res
            .status(400)
            .json({ error: "Invalid phase (must be 'pre' or 'post')" });
        }

        const scoreNum = Number(rawScore);
        if (
          !Number.isFinite(scoreNum) ||
          !Number.isInteger(scoreNum) ||
          scoreNum < MOOD_SCORE_MIN ||
          scoreNum > MOOD_SCORE_MAX
        ) {
          return res.status(400).json({
            error: `Invalid score (must be an integer ${MOOD_SCORE_MIN}-${MOOD_SCORE_MAX})`,
          });
        }

        let conversationId: number | null = null;
        if (rawConversationId !== undefined && rawConversationId !== null) {
          const parsed = Number(rawConversationId);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return res.status(400).json({ error: "Invalid conversationId" });
          }
          const [owned] = await db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(
                eq(conversations.id, parsed),
                eq(conversations.userId, userId),
              ),
            )
            .limit(1);
          if (!owned) {
            return res.status(404).json({ error: "Conversation not found" });
          }
          conversationId = owned.id;
        }

        const [row] = await db
          .insert(moodEntries)
          .values({
            userId,
            phase: phase as MoodPhase,
            score: scoreNum,
            conversationId,
          })
          .returning();

        res.status(201).json({
          entry: {
            id: row.id,
            phase: row.phase,
            score: row.score,
            conversationId: row.conversationId,
            createdAt: row.createdAt,
          },
        });
      } catch (error) {
        console.error("Create mood entry error:", error);
        res.status(500).json({ error: "Failed to save mood entry" });
      }
    },
  );

  // List the caller's mood entries inside a rolling window. The Profile
  // chart uses `days=7`; we cap at 30 so the response stays cheap and
  // the chart code never needs to paginate.
  app.get(
    "/api/mood",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const rawDays = Number(req.query.days ?? 7);
        const days =
          Number.isFinite(rawDays) && rawDays > 0
            ? Math.min(30, Math.floor(rawDays))
            : 7;

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const rows = await db
          .select({
            id: moodEntries.id,
            phase: moodEntries.phase,
            score: moodEntries.score,
            conversationId: moodEntries.conversationId,
            createdAt: moodEntries.createdAt,
          })
          .from(moodEntries)
          .where(
            and(
              eq(moodEntries.userId, userId),
              gte(moodEntries.createdAt, cutoff),
            ),
          )
          .orderBy(desc(moodEntries.createdAt));

        res.json({ days, entries: rows });
      } catch (error) {
        console.error("List mood entries error:", error);
        res.status(500).json({ error: "Failed to load mood entries" });
      }
    },
  );

  app.post("/api/chat/voice", audioBodyParser, requireAuth, async (req: Request, res: Response) => {
    let reservationActive = false;
    let reservedPeriodStart: Date | null = null;
    const userId = req.user!.userId;
    try {
      const {
        audio,
        text,
        conversationId: requestedConversationId,
        preSessionMood: rawPreSessionMood,
      } = req.body;

      if (!audio && !text) {
        return res.status(400).json({ error: "Either [audio] or [text] is required" });
      }

      // Optional pre-session mood, set by the client when the user filled in
      // the pre-session sheet right before kicking off this session. We
      // only honor it for the FIRST exchange — any later turn ignores it,
      // because by then the conversation has its own emotional context.
      // Bad shapes are silently dropped (don't fail the whole request just
      // because the client sent us garbage in this optional field).
      let preSessionMoodHint: { score: number; label: string } | null = null;
      if (
        rawPreSessionMood &&
        typeof rawPreSessionMood === "object" &&
        Number.isFinite(Number((rawPreSessionMood as { score?: unknown }).score))
      ) {
        const score = Math.round(
          Number((rawPreSessionMood as { score: number }).score),
        );
        const label = String(
          (rawPreSessionMood as { label?: unknown }).label ?? "",
        )
          .trim()
          .slice(0, 40);
        if (score >= MOOD_SCORE_MIN && score <= MOOD_SCORE_MAX && label) {
          preSessionMoodHint = { score, label };
        }
      }

      // Optional caller-supplied target conversation. We validate ownership
      // before trusting it — never let a request append to another user's
      // conversation just because it knows the id.
      let targetConversationId: number | null = null;
      let targetConversationTitle: string | null = null;
      if (requestedConversationId !== undefined && requestedConversationId !== null) {
        const parsed = Number(requestedConversationId);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res.status(400).json({ error: "Invalid conversationId" });
        }
        const [owned] = await db
          .select()
          .from(conversations)
          .where(
            and(eq(conversations.id, parsed), eq(conversations.userId, userId)),
          )
          .limit(1);
        if (!owned) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        targetConversationId = owned.id;
        targetConversationTitle = owned.title;
      }

      const reservation = await tryReserveTokens(userId, MIN_TOKENS_FOR_REQUEST);
      if (!reservation.ok) {
        return res.status(429).json({
          error: "Daily token limit reached",
          tokensUsed: reservation.tokensUsed,
          tokensRemaining: Math.max(0, FREE_TOKEN_LIMIT - reservation.tokensUsed),
          tokenLimit: FREE_TOKEN_LIMIT,
          nextResetAt: getNextPeriodStart().toISOString(),
          period: "day",
        });
      }
      reservationActive = true;
      reservedPeriodStart = reservation.periodStart;

      let userTranscript = text || "";

      if (audio && !text) {
        const rawBuffer = Buffer.from(audio, "base64");
        const detected = detectAudioFormat(rawBuffer);
        const sttFormat = detected === "mp3" ? "mp3" : detected === "webm" ? "webm" : "wav";
        const fileExt = detected === "unknown" ? "m4a" : detected;
        console.log("Audio in:", detected, rawBuffer.length, "bytes");

        try {
          userTranscript = await speechToText(rawBuffer, sttFormat, fileExt);
        } catch (sttError: unknown) {
          console.error("STT error:", sttError instanceof Error ? sttError.message : sttError);
          userTranscript = "";
        }

        if (!userTranscript || userTranscript.trim().length === 0) {
          // Refund the reservation against the same day it was reserved on.
          await recordTokens(userId, -MIN_TOKENS_FOR_REQUEST, reservedPeriodStart);
          reservationActive = false;
          const used = await getTokensUsed(userId);
          return res.status(400).json({
            error: "I couldn't quite catch that. Try again?",
            tokensUsed: used,
            tokensRemaining: Math.max(0, FREE_TOKEN_LIMIT - used),
            tokenLimit: FREE_TOKEN_LIMIT,
            nextResetAt: getNextPeriodStart().toISOString(),
            period: "day",
          });
        }
      }

      let conversationId: number;
      const recentConversations = await db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .orderBy(desc(conversations.createdAt))
        .limit(6);

      if (targetConversationId !== null) {
        // User explicitly resumed a specific conversation from history.
        conversationId = targetConversationId;
      } else if (recentConversations.length > 0) {
        conversationId = recentConversations[0].id;
      } else {
        // Brand-new conversation — title it from the user's first message
        // so it's distinguishable in the Profile list.
        const [newConv] = await db
          .insert(conversations)
          .values({
            userId,
            title: generateConversationTitle(userTranscript),
          })
          .returning();
        conversationId = newConv.id;
      }

      // Backfill legacy/default titles in-place. Once a conversation has any
      // user content we want it to carry a meaningful name in the Profile
      // list, even if it was created before this feature existed.
      const activeConversationTitle =
        targetConversationId !== null
          ? targetConversationTitle
          : recentConversations[0]?.title ?? null;
      if (activeConversationTitle === LEGACY_DEFAULT_CONVERSATION_TITLE) {
        // Prefer the earliest existing user message; fall back to the
        // current message if this is the first one in the thread.
        const [firstUserMessage] = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              eq(messages.role, "user"),
            ),
          )
          .orderBy(messages.createdAt)
          .limit(1);
        const seedText = firstUserMessage?.content ?? userTranscript;
        const newTitle = generateConversationTitle(seedText);
        if (newTitle !== LEGACY_DEFAULT_CONVERSATION_TITLE) {
          await db
            .update(conversations)
            .set({ title: newTitle })
            .where(eq(conversations.id, conversationId));
        }
      }

      await db.insert(messages).values({ conversationId, role: "user", content: userTranscript });

      const currentMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt);

      // If the just-inserted user message is the only message in the
      // thread, this is the first exchange — a good moment to ask the
      // model for a smart summary title once the assistant has replied.
      const isFirstExchange = currentMessages.length === 1;

      let pastContext = "";
      // Exclude the active conversation from the "past context" pool so the
      // model doesn't see the resumed thread twice (once as live history,
      // once as past context).
      const olderConvIds = recentConversations
        .map((c) => c.id)
        .filter((id) => id !== conversationId);
      if (olderConvIds.length > 0) {
        const olderMessages = await db
          .select()
          .from(messages)
          .where(inArray(messages.conversationId, olderConvIds))
          .orderBy(messages.conversationId, messages.createdAt);

        const grouped = new Map<number, typeof olderMessages>();
        for (const m of olderMessages) {
          const list = grouped.get(m.conversationId) ?? [];
          list.push(m);
          grouped.set(m.conversationId, list);
        }
        const pastMessages: string[] = [];
        for (const convId of olderConvIds) {
          const msgs = grouped.get(convId) ?? [];
          if (msgs.length > 0) {
            const summary = msgs
              .slice(-6)
              .map((m) => `${m.role}: ${m.content}`)
              .join("\n");
            pastMessages.push(summary);
          }
        }
        if (pastMessages.length > 0) {
          pastContext = `\n\nPAST CONVERSATION CONTEXT (use naturally, do not repeat verbatim):\n${pastMessages.join("\n---\n")}`;
        }
      }

      type ChatMessage =
        | { role: "system"; content: string }
        | { role: "user" | "assistant"; content: string };

      // Pull personalization (name / intents / tone) so Solence can honor
      // what the user told us during onboarding without ever explicitly
      // saying "I see you signed up to work on X". Best-effort: a missing
      // user row just degrades to no personalization.
      let personalizationBlock = "";
      let selectedVoice: Voice = DEFAULT_VOICE;
      try {
        const [userRow] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (userRow) {
          const prefs = serializePreferences(userRow);
          personalizationBlock = buildPersonalizationBlock(prefs);
          if (prefs.voice) selectedVoice = prefs.voice;
        }
      } catch (prefError) {
        console.error(
          "Failed to load personalization for chat:",
          prefError instanceof Error ? prefError.message : prefError,
        );
      }

      // Only inject the pre-session mood on the FIRST exchange of a
      // session. We deliberately keep this hint short and instruction-y
      // ("acknowledge gently, don't repeat the score back") so the model
      // doesn't open with "You said you're at a 2 today" — the user wants
      // to feel met, not quoted back at themselves.
      let moodHint = "";
      if (isFirstExchange && preSessionMoodHint) {
        moodHint = `\n\nPRE-SESSION MOOD CHECK-IN: The user just rated their current mood as "${preSessionMoodHint.label}" (${preSessionMoodHint.score}/5). Gently acknowledge this energy in your opening response — meet them where they are without quoting the score back. If they're feeling low ("rough" or "low"), lead with extra warmth and slower pacing. If they're feeling "great" or "good", match their lift without overdoing it.`;
      }

      const chatHistory: ChatMessage[] = [
        {
          role: "system",
          content: SOLENCE_SYSTEM_PROMPT + personalizationBlock + pastContext + moodHint,
        },
        ...currentMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-audio",
        modalities: ["text", "audio"],
        audio: { voice: selectedVoice, format: "mp3" },
        messages: chatHistory as Parameters<typeof openai.chat.completions.create>[0]["messages"],
      });

      const message = response.choices[0]?.message;
      const audioResponse = message && "audio" in message ? (message as { audio?: { transcript?: string; data?: string }; content?: string | null }).audio : undefined;
      const assistantTranscript = audioResponse?.transcript || message?.content || "";
      const audioData = audioResponse?.data ?? "";

      const totalTokens = response.usage?.total_tokens || 0;
      const additionalTokens = Math.max(0, totalTokens - MIN_TOKENS_FOR_REQUEST);
      if (additionalTokens > 0) {
        await recordTokens(userId, additionalTokens, reservedPeriodStart!);
      }
      reservationActive = false;

      const updatedTokensUsed = await getTokensUsed(userId);
      const tokensRemaining = Math.max(0, FREE_TOKEN_LIMIT - updatedTokensUsed);

      await db.insert(messages).values({ conversationId, role: "assistant", content: assistantTranscript });

      console.log(
        `Voice req: ${userTranscript.length}c in, ${assistantTranscript.length}c out, ` +
          `${totalTokens} tokens (daily total ${updatedTokensUsed}/${FREE_TOKEN_LIMIT})`,
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
        tokensUsed: updatedTokensUsed,
        tokensRemaining,
        tokenLimit: FREE_TOKEN_LIMIT,
        nextResetAt: getNextPeriodStart().toISOString(),
        period: "day",
      });

      // Fire-and-forget: after the very first exchange in a conversation,
      // ask the model for a smart summary title and overwrite the initial
      // truncated title. We deliberately do NOT await this so it can never
      // delay the chat response. Failures are swallowed and logged — the
      // existing first-message truncation remains as a safe fallback.
      if (isFirstExchange && assistantTranscript.trim().length > 0) {
        const conversationIdForTitle = conversationId;
        // Snapshot the title we set during this request. We only overwrite
        // if the stored title still matches this snapshot — that way a
        // manual rename racing with the async update doesn't get clobbered.
        const expectedTitleAtRequestTime =
          generateConversationTitle(userTranscript);
        void (async () => {
          try {
            const smartTitle = await generateSmartConversationTitle(
              userTranscript,
              assistantTranscript,
            );
            if (!smartTitle) return;
            await db
              .update(conversations)
              .set({ title: smartTitle })
              .where(
                and(
                  eq(conversations.id, conversationIdForTitle),
                  eq(conversations.title, expectedTitleAtRequestTime),
                ),
              );
          } catch (err) {
            console.error(
              "Smart title update failed:",
              err instanceof Error ? err.message : err,
            );
          }
        })();
      }
    } catch (error) {
      console.error("Voice API error:", error);
      // Refund the up-front reservation since the request failed before
      // recording any real usage. Pin the refund to the original day so we
      // don't accidentally credit a different daily bucket.
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

  await seedTestAccount();

  const httpServer = createServer(app);

  return httpServer;
}
