import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { openai, detectAudioFormat, speechToText, textToSpeech } from "./replit_integrations/audio";
import { db } from "./db";
import {
  users,
  conversations,
  messages,
  favorites,
  moodEntries,
  tokenUsage,
  userMemories,
  USER_MEMORY_TEXT_MAX_LEN,
  USER_MEMORY_MAX_PER_USER,
  USER_MEMORY_PROMPT_MAX_ITEMS,
  USER_MEMORY_PROMPT_CHAR_BUDGET,
  MOOD_PHASES,
  MOOD_SCORE_MIN,
  MOOD_SCORE_MAX,
  FREE_TOKEN_LIMIT,
  PREMIUM_MESSAGE_LIMIT,
  TONE_OPTIONS,
  INTENT_OPTIONS,
  VOICE_OPTIONS,
  DEFAULT_VOICE,
  LANGUAGE_OPTIONS,
  DEFAULT_LANGUAGE,
  updatePreferencesSchema,
  type Tone,
  type Intent,
  type Voice,
  type Language,
  type MoodPhase,
  type UserPreferences,
} from "@shared/schema";
import {
  allocateUniqueReferralCode,
  buildReferralShareUrl,
  ensureReferralCodeForUser,
  getActiveReferralCredit,
  getReferralJoinedCount,
  grantReferralCredit,
  normalizeReferralCode,
} from "./referrals";
import JSZip from "jszip";
import { eq, desc, inArray, and, lt, gte, isNull } from "drizzle-orm";
import {
  MIN_TOKENS_FOR_REQUEST,
  getCurrentPeriodStart,
  getNextPeriodStart,
  getTokensUsed,
  getTokensUsedHistory,
  getMessagesUsed,
  tryReserveTokens,
  recordTokens,
  recordMessage,
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
  language: Language = DEFAULT_LANGUAGE,
): Promise<string | null> {
  try {
    const systemContent =
      language === "es"
        ? "Generas títulos cortos y descriptivos para conversaciones de diario y reflexión emocional. Responde SOLO con el título — de 3 a 6 palabras, con la primera letra de cada palabra principal en mayúscula (estilo título), sin comillas, sin puntuación final y sin prefijos como 'Título:'. El título DEBE estar escrito en español. Captura el tema o la emoción que se explora (por ejemplo, 'Ansiedad por la Semana Laboral', 'Extrañar a un Viejo Amigo', 'Problemas de Sueño este Mes'). Evita frases genéricas como 'Reflexión Personal' o 'Resumen de Conversación'."
        : "You generate short, descriptive titles for journaling and emotional-reflection conversations. Reply with ONLY the title — 3 to 6 words, in title case, no quotes, no trailing punctuation, no prefixes like 'Title:'. Capture the topic or feeling being explored (e.g. 'Anxiety About Work Week', 'Missing An Old Friend', 'Sleep Trouble This Month'). Avoid generic phrases like 'Personal Reflection' or 'Conversation Summary'.";
    const userContent =
      language === "es"
        ? `Primer mensaje del usuario:\n${userMessage}\n\nRespuesta del asistente:\n${assistantMessage}\n\nEscribe ahora un título en español de 3 a 6 palabras que capture de qué trata esta conversación.`
        : `First user message:\n${userMessage}\n\nAssistant reply:\n${assistantMessage}\n\nWrite a 3–6 word title that captures what this conversation is about.`;
    const response = await openai.chat.completions.create({
      model: SMART_TITLE_MODEL,
      temperature: 0.4,
      max_tokens: 24,
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: userContent,
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
  language: Language = DEFAULT_LANGUAGE,
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
        language,
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
    // Load the user's preferred language once so all backfill jobs scheduled
    // by this scan use the right language for title generation.
    let userLanguage: Language = DEFAULT_LANGUAGE;
    try {
      const [userRow] = await db
        .select({ language: users.language })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const stored = userRow?.language ?? null;
      if (
        stored &&
        (LANGUAGE_OPTIONS as readonly string[]).includes(stored)
      ) {
        userLanguage = stored as Language;
      }
    } catch {
      // best-effort: fall back to the default language
    }
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
        userLanguage,
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

// Conversations whose last message is older than this are considered
// "ended" (inactivity / app close) and become eligible for background
// reflection generation, even when the client never explicitly POSTed
// to /api/conversations/:id/end. Tunable; 15 minutes balances "user
// has clearly walked away" against "user is mid-thought".
const REFLECTION_INACTIVITY_MS = 15 * 60 * 1000;
// How many stale conversations we examine per /api/conversations call.
const REFLECTION_BACKFILL_SCAN_BATCH_SIZE = 25;
// How many reflections we fire per scan to bound OpenAI cost per request.
const REFLECTION_BACKFILLS_PER_REQUEST = 2;

function clampReflectionLength(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const sliced = cleaned.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const cutoff = lastSpace > max * 0.6 ? lastSpace : sliced.length;
  return `${sliced.slice(0, cutoff).trimEnd()}…`;
}

// Long-term memory configuration. The reflection generator returns up to
// MEMORY_ITEMS_PER_REFLECTION durable observations about the user that we
// persist to user_memories and surface back into future system prompts.
// Bounding both the count and the text length keeps the prompt-side
// payload predictable and well under the ~200-token budget the chat
// handler reserves for memories.
const MEMORY_ITEMS_PER_REFLECTION = 2;

// Hard cap on individual memory text length we accept from the model.
// Mirrors USER_MEMORY_TEXT_MAX_LEN — duplicated here as a const so the
// validation logic reads cleanly. Anything longer is clamped on a word
// boundary, mirroring how reflection text is clamped.
const MEMORY_TEXT_MAX_LEN = USER_MEMORY_TEXT_MAX_LEN;

type ReflectionResult = {
  summary: string;
  takeaway: string;
  memories: string[];
};

// Ask the model to summarize a conversation into a soft, grounded reflection.
// Returns null on any failure (parse errors, empty result, network) so the
// caller can leave the row untouched and try again later.
async function generateReflection(
  conversationMessages: Array<{ role: string; content: string }>,
  language: Language = DEFAULT_LANGUAGE,
): Promise<ReflectionResult | null> {
  const trimmedMessages = conversationMessages.slice(-REFLECTION_MAX_MESSAGES);
  const userRoleLabel = language === "es" ? "Usuario" : "User";
  const transcript = trimmedMessages
    .map((m) => {
      const role = m.role === "assistant" ? "Solence" : userRoleLabel;
      return `${role}: ${m.content}`;
    })
    .join("\n");
  if (transcript.trim().length === 0) return null;

  const systemContent =
    language === "es"
      ? `Escribes reflexiones suaves al estilo de un diario que resumen conversaciones de apoyo emocional. Habla directamente al usuario (en segunda persona, 'tú'). El tono es cálido, sereno, nunca clínico ni sermoneador. NUNCA des consejos ni instrucciones. NUNCA uses frases prescriptivas como 'recuerda' o 'asegúrate de'. NUNCA menciones que eres una IA ni te refieras a Solence por su nombre. Responde con JSON con la forma exacta {"summary": string, "takeaway": string, "memories": string[]}. TODOS los textos DEBEN estar escritos en español. El 'summary' tiene de 3 a 5 oraciones que capturan lo que el usuario tenía en mente, las emociones con las que estaba, y cualquier pequeño cambio de perspectiva que haya surgido. El 'takeaway' es una sola oración corta (menos de 20 palabras) — una frase suave y verdadera que el usuario pueda llevarse consigo, NO una instrucción. 'memories' es una lista de 0 a ${MEMORY_ITEMS_PER_REFLECTION} observaciones DURADERAS sobre el usuario que ayudarían a recordarle en una conversación futura — por ejemplo, una situación de vida estable (nuevo trabajo, mudanza, crianza), un nombre que mencionó (pareja, mascota, hijo), una práctica recurrente (meditación matutina, correr) o una preferencia explícita ('me ayuda hablar despacio'). Cada memoria debe ser una sola frase de menos de ${MEMORY_TEXT_MAX_LEN} caracteres, en tercera persona desde el punto de vista de un observador ('Está pasando por…', 'Su perro se llama…'). Devuelve [] si no surge nada digno de recordar — un estado de ánimo pasajero NO es una memoria.`
      : `You write gentle journal-style reflections summarizing emotional-support conversations. Speak directly to the user (second person, 'you'). Tone is warm, grounded, never clinical, never preachy. NEVER give advice or instructions. NEVER use prescribed-feeling phrases like 'remember to' or 'make sure'. NEVER mention that you are an AI or refer to Solence by name. Reply with JSON in the exact shape {"summary": string, "takeaway": string, "memories": string[]}. The summary is 3 to 5 sentences capturing what was on the user's mind, the feelings they were sitting with, and any small shift in perspective that emerged. The takeaway is a single short sentence (under 20 words) — a gentle, true-feeling phrase the user could carry with them, NOT an instruction. 'memories' is a list of 0 to ${MEMORY_ITEMS_PER_REFLECTION} DURABLE observations about the user that would help recognize them in a future conversation — e.g. a stable life situation (new job, move, parenting), a name they mentioned (partner, pet, child), a recurring practice (morning meditation, running), or an explicit preference ('it helps me when you speak slowly'). Each memory must be a single sentence under ${MEMORY_TEXT_MAX_LEN} characters, written in third person from an observer's point of view ('Is going through…', 'Their dog is named…'). Return [] when nothing worth remembering surfaced — a passing mood is NOT a memory.`;
  const userContent =
    language === "es"
      ? `Transcripción de la conversación:\n${transcript}\n\nEscribe ahora el JSON de la reflexión, con 'summary', 'takeaway' y 'memories' en español.`
      : `Conversation transcript:\n${transcript}\n\nWrite the reflection JSON now.`;

  try {
    const response = await openai.chat.completions.create({
      model: REFLECTION_MODEL,
      temperature: 0.5,
      max_tokens: 320,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: userContent,
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
    const obj = parsed as {
      summary?: unknown;
      takeaway?: unknown;
      memories?: unknown;
    };
    if (typeof obj.summary !== "string" || typeof obj.takeaway !== "string") {
      return null;
    }
    const summary = clampReflectionLength(obj.summary, REFLECTION_SUMMARY_MAX_LEN);
    const takeaway = clampReflectionLength(
      obj.takeaway.replace(/^["'`]+|["'`]+$/g, ""),
      REFLECTION_TAKEAWAY_MAX_LEN,
    );
    if (summary.length === 0 || takeaway.length === 0) return null;
    // Memories are best-effort: a missing/malformed array degrades to []
    // rather than failing the whole reflection. We dedupe within the
    // batch (case-insensitive) and clamp each item so a chatty model
    // can't slip in 1000-character "memories".
    const memories: string[] = [];
    if (Array.isArray(obj.memories)) {
      const seen = new Set<string>();
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

// Insert a freshly-extracted batch of long-term memories for the user,
// then prune anything beyond USER_MEMORY_MAX_PER_USER (oldest-first).
// Best-effort: any DB error is logged and swallowed so a memory-write
// hiccup never breaks reflection persistence. Skips inserts that match
// (case-insensitive) an existing row so the same observation isn't
// stored twice across sessions.
async function persistUserMemories(
  userId: string,
  conversationId: number,
  texts: string[],
): Promise<void> {
  if (!texts || texts.length === 0) return;
  try {
    const existing = await db
      .select({ text: userMemories.text })
      .from(userMemories)
      .where(eq(userMemories.userId, userId));
    const seen = new Set(existing.map((r) => r.text.trim().toLowerCase()));

    const fresh: { userId: string; text: string; sourceConversationId: number }[] = [];
    for (const raw of texts) {
      const cleaned = raw.trim();
      if (cleaned.length === 0) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push({
        userId,
        text: cleaned,
        sourceConversationId: conversationId,
      });
    }
    if (fresh.length === 0) return;

    await db.insert(userMemories).values(fresh);

    // Prune oldest-first whenever we're over the per-user cap. We pull
    // ids ordered by createdAt DESC, then DELETE everything past the
    // cap by id list — keeps the query portable (no LIMIT in DELETE on
    // every dialect) and bounded in row count.
    const allIds = await db
      .select({ id: userMemories.id })
      .from(userMemories)
      .where(eq(userMemories.userId, userId))
      .orderBy(desc(userMemories.createdAt), desc(userMemories.id));
    if (allIds.length > USER_MEMORY_MAX_PER_USER) {
      const toRemove = allIds
        .slice(USER_MEMORY_MAX_PER_USER)
        .map((r) => r.id);
      if (toRemove.length > 0) {
        await db
          .delete(userMemories)
          .where(inArray(userMemories.id, toRemove));
      }
    }
  } catch (err) {
    console.error(
      "User memory persist failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function generateAndPersistReflection(
  conversationId: number,
  language: Language = DEFAULT_LANGUAGE,
): Promise<{
  summary: string;
  takeaway: string;
  generatedAt: Date;
} | null> {
  // Short-circuit if the row already has a reflection — saves an OpenAI
  // call and keeps the endpoint cheap on repeat taps.
  const [existing] = await db
    .select({
      userId: conversations.userId,
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

    const reflection = await generateReflection(rows, language);
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
      // We — and only we — were the writer that persisted this
      // reflection, so it's safe to insert the matching memories now
      // without risking duplicates from a concurrent generator.
      if (existing?.userId && reflection.memories.length > 0) {
        await persistUserMemories(
          existing.userId,
          conversationId,
          reflection.memories,
        );
      }
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

// Walk one batch of the user's conversations and fire reflection
// generation for any "stale" sessions (no reflection yet, last message
// older than REFLECTION_INACTIVITY_MS, with both user + assistant
// turns). Designed to be called fire-and-forget AFTER the list response
// has been sent — never blocks the API, never throws. This covers the
// inactivity / app-close case where the client never POSTed to /:id/end.
async function runReflectionBackfillScan(userId: string): Promise<void> {
  try {
    let userLanguage: Language = DEFAULT_LANGUAGE;
    try {
      const [userRow] = await db
        .select({ language: users.language })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const stored = userRow?.language ?? null;
      if (
        stored &&
        (LANGUAGE_OPTIONS as readonly string[]).includes(stored)
      ) {
        userLanguage = stored as Language;
      }
    } catch {
      // best-effort: fall back to default
    }

    // Pull a batch of summary-less conversations, newest first. We bound
    // the scan so a long history doesn't translate into a long DB read.
    const candidates = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          isNull(conversations.reflectionSummary),
        ),
      )
      .orderBy(desc(conversations.id))
      .limit(REFLECTION_BACKFILL_SCAN_BATCH_SIZE);

    if (candidates.length === 0) return;

    const ids = candidates.map((c) => c.id);
    const recent = await db
      .select({
        conversationId: messages.conversationId,
        role: messages.role,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .orderBy(desc(messages.createdAt));

    // For each conversation: track the most recent message timestamp +
    // whether it has at least one user and one assistant message.
    const lastAtByConv = new Map<number, Date>();
    const hasUserByConv = new Map<number, boolean>();
    const hasAssistantByConv = new Map<number, boolean>();
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
      if (!lastAt) continue; // no messages → not eligible
      if (lastAt.getTime() > cutoff) continue; // still active
      if (!hasUserByConv.get(c.id) || !hasAssistantByConv.get(c.id)) continue;
      if (reflectionInFlight.has(c.id)) continue;
      // Fire-and-forget; generateAndPersistReflection handles its own
      // dedupe + race-guarded UPDATE.
      void generateAndPersistReflection(c.id, userLanguage).catch(() => {});
      scheduled += 1;
    }
  } catch (err) {
    console.error(
      "Reflection backfill scan failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

// ----- Weekly themes -------------------------------------------------------
//
// The Weekly Summary screen shows a small set of recurring "themes" pulled
// from the week's reflection takeaways/summaries + memories. We previously
// produced these by counting non-stop-words, which works in English but
// produces noisy single-word output in Spanish (and any non-English
// language) and never captures multi-word concepts like "work stress" or
// "sleep quality". This helper asks a lightweight chat model to summarize
// the corpus into 2–3 short, human-readable phrases instead. Returns null
// on any failure (parse error, network, empty model output) so the caller
// can fall back to the keyword extractor and never fail the endpoint.

const WEEKLY_THEMES_MODEL = "gpt-4o-mini";
// Cap each theme phrase so the chip layout stays tidy if the model ever
// returns something verbose. Mirrors the chip's visual budget — anything
// longer is dropped, not truncated, since a half-sentence theme reads
// worse than no theme at all.
const WEEKLY_THEME_MAX_LEN = 40;
const WEEKLY_THEMES_MAX_COUNT = 3;
// Bound the corpus we send to the model. Even a chatty user with dozens
// of reflections in a single week stays well under this when joined,
// but the cap protects token cost on outliers.
const WEEKLY_THEMES_CORPUS_MAX_CHARS = 6000;

async function generateWeeklyThemes(
  corpusItems: string[],
  language: Language = DEFAULT_LANGUAGE,
): Promise<string[] | null> {
  const cleaned = corpusItems
    .map((s) => (s ?? "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return null;

  // Join with newlines so the model sees each reflection / memory as its
  // own item. Truncate the joined corpus on a character budget — we'd
  // rather drop trailing items than send a multi-thousand-token prompt.
  let corpus = cleaned.join("\n");
  if (corpus.length > WEEKLY_THEMES_CORPUS_MAX_CHARS) {
    corpus = corpus.slice(0, WEEKLY_THEMES_CORPUS_MAX_CHARS);
  }

  const systemContent =
    language === "es"
      ? `Identificas los temas recurrentes en una semana de reflexiones de diario emocional. Responde SOLO con JSON con la forma exacta {"themes": string[]}. Devuelve entre 2 y ${WEEKLY_THEMES_MAX_COUNT} temas, cada uno como una frase corta de 1 a 4 palabras (por ejemplo, "estrés laboral", "calidad del sueño", "extrañar a un amigo"). Los temas DEBEN estar escritos en español, en minúsculas (excepto nombres propios), sin comillas, sin puntuación final y sin frases genéricas como "reflexión personal" o "estado de ánimo". Si el corpus es demasiado escaso para identificar temas claros, devuelve {"themes": []}.`
      : `You identify the recurring themes in a week of emotional journal reflections. Reply with ONLY JSON in the exact shape {"themes": string[]}. Return between 2 and ${WEEKLY_THEMES_MAX_COUNT} themes, each a short 1–4 word phrase (e.g. "work stress", "sleep quality", "missing a friend"). Themes must be lowercase (except proper nouns), no quotes, no trailing punctuation, no generic phrases like "personal reflection" or "general mood". If the corpus is too sparse to identify clear themes, return {"themes": []}.`;

  const userContent =
    language === "es"
      ? `Reflexiones y memorias de la semana (una por línea):\n${corpus}\n\nDevuelve ahora el JSON con los temas en español.`
      : `This week's reflections and memories (one per line):\n${corpus}\n\nReturn the themes JSON now.`;

  try {
    const response = await openai.chat.completions.create({
      model: WEEKLY_THEMES_MODEL,
      temperature: 0.3,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
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
    const themesField = (parsed as { themes?: unknown }).themes;
    if (!Array.isArray(themesField)) return null;

    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of themesField) {
      if (typeof item !== "string") continue;
      const phrase = item
        .replace(/\s+/g, " ")
        .replace(/^["'`\s]+|["'`\s]+$/g, "")
        .replace(/[.!?,;:]+$/g, "")
        .trim();
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
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}
const JWT_SECRET: string = process.env.SESSION_SECRET;
const JWT_EXPIRES_IN = "30d";

// Apple's identity tokens are signed JWTs whose public keys live at this
// JWKS endpoint. `createRemoteJWKSet` caches and rotates the keys for us.
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);
// The `aud` claim on a Sign in with Apple identity token is the bundle ID
// of the app the token was issued for. We accept the production bundle by
// default and allow extra audiences (e.g. a dev/staging bundle) via an
// optional comma-separated env var.
const APPLE_AUDIENCES = [
  "com.solence.app",
  ...(process.env.APPLE_BUNDLE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
];

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
  // Same allow-list dance for language. Anything off the list resolves to
  // null so the client falls back to its device-locale default.
  const storedLanguage = user.language ?? null;
  const language =
    storedLanguage &&
    (LANGUAGE_OPTIONS as readonly string[]).includes(storedLanguage)
      ? (storedLanguage as Language)
      : null;
  return {
    displayName: user.displayName ?? null,
    intents: (user.intents ?? []) as Intent[],
    tone: (user.tone ?? null) as Tone | null,
    voice,
    language,
    reminderEnabled: user.reminderEnabled ?? false,
    reminderTime: user.reminderTime ?? "20:00",
    weeklySummaryEnabled: user.weeklySummaryEnabled ?? false,
    weeklySummaryDay:
      typeof user.weeklySummaryDay === "number" ? user.weeklySummaryDay : 0,
    weeklySummaryTime: user.weeklySummaryTime ?? "19:00",
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
      const referralCode = await allocateUniqueReferralCode();
      await db.insert(users).values({
        email: "testuser@solence.ai",
        password: hashedPassword,
        referralCode,
      });
      console.log("Test account seeded: testuser@solence.ai");
    } else {
      await db
        .update(users)
        .set({ password: hashedPassword })
        .where(eq(users.email, "testuser@solence.ai"));
      // Lazily backfill the referral code on the existing test row so
      // the invite card has something to render on first launch.
      try {
        await ensureReferralCodeForUser(existing[0].id);
      } catch (err) {
        console.error(
          "Failed to backfill test account referral code:",
          err instanceof Error ? err.message : err,
        );
      }
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

// ---------------------------------------------------------------------------
// Crisis-language detection
// ---------------------------------------------------------------------------
// We do a two-tier check on each user message:
//   1. A small allowlist of high-confidence keyword/phrase patterns. If any
//      hit, we flag immediately — these phrases are unambiguous enough that
//      we accept the rare false positive in exchange for never missing them.
//   2. For messages that don't trip the keyword list but do contain weaker
//      signals (e.g. "give up", "hopeless"), we ask a small model for a
//      single-token yes/no classification. The model is instructed that
//      sadness, anxiety, stress, frustration, or low mood ALONE are not
//      crisis — only explicit/strongly-implied self-harm or suicidal intent.
//
// Any error in the LLM path defaults to `false` rather than blocking the
// chat reply: we want this signal to add support, never to gate the
// conversation. Solence is not a crisis service — the banner the client
// shows from this flag is the actual safety net.

const CRISIS_KEYWORD_PATTERNS: RegExp[] = [
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
  /\bbetter\s+off\s+(?:without\s+me|dead)\b/i,
];

const CRISIS_BORDERLINE_PATTERNS: RegExp[] = [
  /\bgive\s+up\b/i,
  /\bcan'?t\s+(?:take|do)\s+(?:this|it)\s+anymore\b/i,
  /\bhopeless\b/i,
  /\bworthless\b/i,
  /\bnobody\s+(?:would|will)\s+(?:care|miss)\b/i,
  /\bdisappear\s+forever\b/i,
  /\bend\s+everything\b/i,
];

function hasCrisisKeyword(text: string): boolean {
  return CRISIS_KEYWORD_PATTERNS.some((re) => re.test(text));
}

function hasCrisisBorderlineSignal(text: string): boolean {
  return CRISIS_BORDERLINE_PATTERNS.some((re) => re.test(text));
}

const CRISIS_CLASSIFIER_MODEL = "gpt-4o-mini";

async function classifyCrisisWithLLM(text: string): Promise<boolean> {
  try {
    const response = await openai.chat.completions.create({
      model: CRISIS_CLASSIFIER_MODEL,
      temperature: 0,
      max_tokens: 1,
      messages: [
        {
          role: "system",
          content:
            "You classify whether a single user message indicates an immediate mental-health crisis: explicit or strongly-implied self-harm, suicidal ideation, plans to die, or being in imminent danger. General sadness, anxiety, stress, frustration, grief, or low mood ALONE are NOT crisis. Reply with exactly one token: yes or no.",
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
    });
    const out = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
    return out.startsWith("y");
  } catch (err) {
    console.error(
      "Crisis classifier failed:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

// Public for tests. Returns true when `text` warrants surfacing the crisis
// support banner. Conservative-but-not-trigger-happy: clear self-harm /
// suicidal language fires immediately, ambiguous "I'm exhausted" style
// venting does not.
export async function detectCrisisSignal(text: string): Promise<boolean> {
  if (!text || text.trim().length === 0) return false;
  if (hasCrisisKeyword(text)) return true;
  if (!hasCrisisBorderlineSignal(text)) return false;
  return classifyCrisisWithLLM(text);
}

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

      const normalizedEmail = email.toLowerCase().trim();
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      // Resolve the optional referral code BEFORE insert so we can fail
      // fast on a self-referral (caller is using their own code, which
      // can only happen if they actually own the email matching that
      // code) and so the new user row is born with `referredBy` set.
      const inboundReferralCode = normalizeReferralCode(req.body?.referralCode);
      let referrer:
        | { id: string; email: string }
        | null = null;
      let referralCodeError: string | null = null;
      if (inboundReferralCode.length > 0) {
        const [match] = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.referralCode, inboundReferralCode))
          .limit(1);
        if (!match) {
          referralCodeError = "That referral code isn't valid";
        } else if (match.email === normalizedEmail) {
          // Self-referral: someone trying to use their own code on a new
          // account with the same email. Reject so neither side gets the
          // free week.
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
      const [newUser] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          password: hashedPassword,
          referralCode: newUserCode,
          referredBy: referrer?.id ?? null,
        })
        .returning();

      // Grant the matching pair of free-week credits when a referral
      // actually completed. Failures here never block registration —
      // the user is created either way, we just log the credit failure.
      if (referrer) {
        try {
          await grantReferralCredit({
            userId: referrer.id,
            source: "referrer",
            referralUserId: newUser.id,
          });
          await grantReferralCredit({
            userId: newUser.id,
            source: "referee",
            referralUserId: referrer.id,
          });
        } catch (creditError) {
          console.error(
            "Failed to grant referral credit:",
            creditError instanceof Error ? creditError.message : creditError,
          );
        }
      }

      const token = jwt.sign(
        { userId: newUser.id, email: newUser.email } satisfies AuthPayload,
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.status(201).json({
        token,
        user: { id: newUser.id, email: newUser.email },
        preferences: serializePreferences(newUser),
        referralApplied: referrer !== null,
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

      if (!user || !user.password) {
        // No password set on the row means the account was created via
        // Sign in with Apple and never set an email password — surface the
        // same generic error so we don't reveal which is the case.
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

  app.post("/api/auth/apple", async (req: Request, res: Response) => {
    try {
      const { identityToken } = req.body ?? {};
      if (!identityToken || typeof identityToken !== "string") {
        return res
          .status(400)
          .json({ error: "Apple identity token is required" });
      }

      let payload;
      try {
        const verified = await jwtVerify(identityToken, APPLE_JWKS, {
          issuer: APPLE_ISSUER,
          audience: APPLE_AUDIENCES,
        });
        payload = verified.payload;
      } catch (err) {
        // Decode (without re-verifying the signature) so we can log the
        // offending `aud`/`iss` values. Apple tokens are signed JWTs and
        // we already failed verification above, so we only use this for
        // diagnostics — never for trusting claims.
        let tokenAud: unknown;
        let tokenIss: unknown;
        try {
          const unverified = decodeJwt(identityToken);
          tokenAud = unverified.aud;
          tokenIss = unverified.iss;
        } catch {
          // Token was not a decodable JWT — fall through with undefined.
        }
        console.error(
          "Apple identity token verification failed:",
          err instanceof Error ? err.message : err,
          {
            tokenAud,
            tokenIss,
            acceptedAudiences: APPLE_AUDIENCES,
            acceptedIssuer: APPLE_ISSUER,
          },
        );
        return res
          .status(401)
          .json({ error: "Could not verify Apple identity token" });
      }

      const appleSub =
        typeof payload.sub === "string" ? payload.sub.trim() : "";
      if (!appleSub) {
        return res
          .status(401)
          .json({ error: "Apple identity token missing subject" });
      }

      const rawEmail =
        typeof payload.email === "string" ? payload.email.trim() : "";
      const email = rawEmail.toLowerCase();

      // Order of precedence:
      //   1. Existing account already linked to this Apple sub → just sign in.
      //   2. Existing email/password account with the same email → link Apple
      //      sub to it (one-time link, surfaced to the client via `linked`).
      //   3. Otherwise, create a fresh account using the Apple email (or a
      //      placeholder if Apple chose not to share one on subsequent signs).
      let linked = false;
      let user: UserRow | undefined;

      const [byApple] = await db
        .select()
        .from(users)
        .where(eq(users.appleUserId, appleSub))
        .limit(1);
      if (byApple) {
        user = byApple;
      } else {
        if (email) {
          const [byEmail] = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
          if (byEmail) {
            const [updated] = await db
              .update(users)
              .set({ appleUserId: appleSub })
              .where(
                and(eq(users.id, byEmail.id), isNull(users.appleUserId)),
              )
              .returning();
            user = updated ?? byEmail;
            linked = true;
          }
        }

        if (!user) {
          // Apple omits the email on every sign-in after the first. If we
          // somehow get here without an email (no prior link, no email in
          // token) we have nothing usable to key the account on, so fall
          // back to a synthetic per-Apple-user address. The user can edit
          // it later via preferences if they want.
          const accountEmail = email || `${appleSub}@privaterelay.appleid.com`;
          const [created] = await db
            .insert(users)
            .values({
              email: accountEmail,
              password: null,
              appleUserId: appleSub,
            })
            .returning();
          user = created;
        }
      }

      if (!user) {
        return res.status(500).json({ error: "Failed to sign in with Apple" });
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email } satisfies AuthPayload,
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN },
      );

      res.json({
        token,
        user: { id: user.id, email: user.email },
        preferences: serializePreferences(user),
        linked,
      });
    } catch (error) {
      console.error("Apple sign-in error:", error);
      res.status(500).json({ error: "Failed to sign in with Apple" });
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
        if ("language" in parsed.data) {
          updates.language = parsed.data.language ?? null;
        }
        if ("reminderEnabled" in parsed.data && parsed.data.reminderEnabled !== undefined) {
          updates.reminderEnabled = parsed.data.reminderEnabled;
        }
        if ("reminderTime" in parsed.data && parsed.data.reminderTime !== undefined) {
          updates.reminderTime = parsed.data.reminderTime;
        }
        if (
          "weeklySummaryEnabled" in parsed.data &&
          parsed.data.weeklySummaryEnabled !== undefined
        ) {
          updates.weeklySummaryEnabled = parsed.data.weeklySummaryEnabled;
        }
        if (
          "weeklySummaryDay" in parsed.data &&
          parsed.data.weeklySummaryDay !== undefined
        ) {
          updates.weeklySummaryDay = parsed.data.weeklySummaryDay;
        }
        if (
          "weeklySummaryTime" in parsed.data &&
          parsed.data.weeklySummaryTime !== undefined
        ) {
          updates.weeklySummaryTime = parsed.data.weeklySummaryTime;
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
  const VOICE_PREVIEW_LINES: Record<Language, string> = {
    en: "Hi, I'm Solence. I'm here whenever you need me.",
    es: "Hola, soy Solence. Estoy aquí cuando me necesites.",
  };

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

        // Match the preview line to the user's saved language so the sample
        // voices the user against their actual locale, not a hard-coded
        // English line. Falls back to English on any miss.
        let previewLanguage: Language = DEFAULT_LANGUAGE;
        try {
          const [userRow] = await db
            .select({ language: users.language })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const stored = userRow?.language ?? null;
          if (
            stored &&
            (LANGUAGE_OPTIONS as readonly string[]).includes(stored)
          ) {
            previewLanguage = stored as Language;
          }
        } catch {
          // best-effort: keep the default English preview line
        }

        const audioBuffer = await textToSpeech(
          VOICE_PREVIEW_LINES[previewLanguage],
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
      const [userRow, credit] = await Promise.all([
        db.select({ isPremium: users.isPremium }).from(users).where(eq(users.id, userId)).limit(1),
        getActiveReferralCredit(userId),
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
          referralCredit: null,
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
        referralCredit: credit
          ? { endsAt: credit.endsAt.toISOString(), source: "referral" }
          : null,
      });
    } catch (error) {
      console.error("Token check error:", error);
      res.status(500).json({ error: "Failed to check token usage" });
    }
  });

  // Returns the data the Profile invite card needs in a single round
  // trip: the user's personal code, a copyable share URL, how many
  // friends have already joined via that code, and the current active
  // free-week credit (if any).
  app.get(
    "/api/referrals",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const code = await ensureReferralCodeForUser(userId);
        const [joinedCount, credit] = await Promise.all([
          getReferralJoinedCount(userId),
          getActiveReferralCredit(userId),
        ]);
        res.json({
          code,
          shareUrl: buildReferralShareUrl(code),
          joinedCount,
          activeCredit: credit
            ? { endsAt: credit.endsAt.toISOString() }
            : null,
        });
      } catch (error) {
        console.error("Referral fetch error:", error);
        res.status(500).json({ error: "Failed to load referral details" });
      }
    },
  );

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

      // Fire-and-forget reflection backfill scan. Catches conversations
      // that "ended" via inactivity or app close (no explicit POST to
      // /:id/end) — when the user reopens the app and lists their
      // conversations, any session whose last message is older than the
      // inactivity cutoff and that has both user + assistant turns gets
      // a reflection generated in the background. Bounded per request,
      // error-swallowing, never blocks the response.
      void runReflectionBackfillScan(userId);
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
            crisisSupport: m.crisisSupport ?? false,
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

        // Resolve the user's preferred language so the reflection comes back
        // in the language they chose. Best-effort — any failure here just
        // falls back to English, which still yields a valid reflection.
        let reflectionLanguage: Language = DEFAULT_LANGUAGE;
        try {
          const [userRow] = await db
            .select({ language: users.language })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const stored = userRow?.language ?? null;
          if (
            stored &&
            (LANGUAGE_OPTIONS as readonly string[]).includes(stored)
          ) {
            reflectionLanguage = stored as Language;
          }
        } catch {
          // best-effort: fall back to the default language
        }

        const reflection = await generateAndPersistReflection(
          id,
          reflectionLanguage,
        );
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
        crisisSupport: messages.crisisSupport,
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

  // ── Long-term memories ────────────────────────────────────────────
  // Powers the Profile "What Solence remembers" card. Memories are
  // produced by the reflection generator and folded back into the chat
  // system prompt; the user can review, delete individual items, or
  // wipe the entire list at any time. All endpoints are scoped strictly
  // to the caller's userId.

  app.get(
    "/api/memories",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        // Left-join conversations so each memory can carry enough source
        // context for the Profile "What Solence remembers" card to render
        // a tappable "From a chat on <date>" link. The FK is `set null`
        // on conversation delete, so a deleted source row simply yields
        // a null sourceConversation here and the UI renders the memory
        // without a link.
        const rows = await db
          .select({
            id: userMemories.id,
            text: userMemories.text,
            sourceConversationId: userMemories.sourceConversationId,
            createdAt: userMemories.createdAt,
            sourceConversationTitle: conversations.title,
            sourceConversationCreatedAt: conversations.createdAt,
          })
          .from(userMemories)
          .leftJoin(
            conversations,
            and(
              eq(conversations.id, userMemories.sourceConversationId),
              // Defense-in-depth: even though memories only ever reference
              // the owner's conversations today, constraining the join on
              // userId ensures we can never leak another user's title or
              // createdAt if that invariant ever slipped.
              eq(conversations.userId, userId),
            ),
          )
          .where(eq(userMemories.userId, userId))
          .orderBy(desc(userMemories.createdAt), desc(userMemories.id))
          .limit(USER_MEMORY_MAX_PER_USER);
        res.json({
          memories: rows.map((r) => ({
            id: r.id,
            text: r.text,
            sourceConversationId: r.sourceConversationId,
            createdAt: r.createdAt,
            sourceConversation:
              r.sourceConversationId !== null &&
              r.sourceConversationCreatedAt !== null
                ? {
                    id: r.sourceConversationId,
                    title: r.sourceConversationTitle,
                    createdAt: r.sourceConversationCreatedAt,
                  }
                : null,
          })),
        });
      } catch (error) {
        console.error("List memories error:", error);
        res.status(500).json({ error: "Failed to load memories" });
      }
    },
  );

  app.delete(
    "/api/memories/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const parsed = Number(req.params.id);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res.status(400).json({ error: "Invalid memory id" });
        }
        // Ownership check is baked into the WHERE clause: the row is
        // only deleted when it belongs to the caller, so a malicious
        // client guessing ids can't wipe another user's memory.
        const removed = await db
          .delete(userMemories)
          .where(
            and(
              eq(userMemories.id, parsed),
              eq(userMemories.userId, userId),
            ),
          )
          .returning({ id: userMemories.id });
        if (removed.length === 0) {
          return res.status(404).json({ error: "Memory not found" });
        }
        res.json({ ok: true });
      } catch (error) {
        console.error("Delete memory error:", error);
        res.status(500).json({ error: "Failed to delete memory" });
      }
    },
  );

  // Edit a single memory's text in place. Mirrors the DELETE handler's
  // ownership check (the WHERE clause restricts to the caller's rows so
  // a guessed id can't reach another user's memory) and reuses the same
  // clamp the reflection generator runs on freshly-extracted memories,
  // so a user-edited memory never grows past the prompt-side budget.
  app.patch(
    "/api/memories/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
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
          return res
            .status(400)
            .json({ error: "Memory text cannot be empty" });
        }
        const [updated] = await db
          .update(userMemories)
          .set({ text: cleaned })
          .where(
            and(
              eq(userMemories.id, parsed),
              eq(userMemories.userId, userId),
            ),
          )
          .returning({
            id: userMemories.id,
            text: userMemories.text,
            sourceConversationId: userMemories.sourceConversationId,
            createdAt: userMemories.createdAt,
          });
        if (!updated) {
          return res.status(404).json({ error: "Memory not found" });
        }
        res.json({ memory: updated });
      } catch (error) {
        console.error("Update memory error:", error);
        res.status(500).json({ error: "Failed to update memory" });
      }
    },
  );

  app.delete(
    "/api/memories",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const removed = await db
          .delete(userMemories)
          .where(eq(userMemories.userId, userId))
          .returning({ id: userMemories.id });
        res.json({ ok: true, removed: removed.length });
      } catch (error) {
        console.error("Clear memories error:", error);
        res.status(500).json({ error: "Failed to clear memories" });
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
        return;
      }
    },
  );

  // ── Weekly reflection summary ──────────────────────────────────────
  // Returns a gentle aggregate of the caller's week: how many sessions
  // they had, their average mood, a few recurring themes pulled from
  // reflection takeaways, and a single "highlight" assistant line they
  // can re-read. `weekOffset=0` is the current week (Sunday-anchored
  // in local-server time, which is good enough for a soft summary).
  app.get(
    "/api/weekly-summary",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.user!.userId;
        const rawOffset = Number(req.query.weekOffset ?? 0);
        const weekOffset =
          Number.isFinite(rawOffset) && rawOffset <= 0 && rawOffset >= -52
            ? Math.floor(rawOffset)
            : 0;

        // Anchor to the start of "this week" (Sunday 00:00 local), then
        // shift backwards by weekOffset weeks. Capping the lookback at
        // 52 weeks keeps the query bounded for any reasonable history.
        const now = new Date();
        const startOfThisWeek = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - now.getDay(),
          0,
          0,
          0,
          0,
        );
        const weekStart = new Date(startOfThisWeek);
        weekStart.setDate(weekStart.getDate() + weekOffset * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        // Conversations *started* in this week count as a session. We
        // intentionally don't count message activity inside an older
        // conversation — it's the act of opening a new one that the
        // user thinks of as "this week's reflection time".
        const weekConversations = await db
          .select({
            id: conversations.id,
            createdAt: conversations.createdAt,
            reflectionSummary: conversations.reflectionSummary,
            reflectionTakeaway: conversations.reflectionTakeaway,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, userId),
              gte(conversations.createdAt, weekStart),
              lt(conversations.createdAt, weekEnd),
            ),
          )
          .orderBy(desc(conversations.createdAt));

        // Mood: average across all entries (pre + post) in the window.
        const weekMoods = await db
          .select({
            score: moodEntries.score,
          })
          .from(moodEntries)
          .where(
            and(
              eq(moodEntries.userId, userId),
              gte(moodEntries.createdAt, weekStart),
              lt(moodEntries.createdAt, weekEnd),
            ),
          );
        const moodCount = weekMoods.length;
        const avgMood =
          moodCount > 0
            ? Math.round(
                (weekMoods.reduce((sum, m) => sum + m.score, 0) / moodCount) *
                  10,
              ) / 10
            : null;

        // Themes: very lightweight keyword extraction over the week's
        // reflection takeaways + summaries. We tokenize, drop stop
        // words, count, and surface the top 3. Not a model call — this
        // is a soft "here's what kept coming up" hint, and we'd rather
        // be cheap and predictable than perfectly insightful.
        const STOP_WORDS = new Set([
          "the","and","you","your","that","this","with","have","were","was","for","but","not","just","like","feel","felt","feeling","feelings","about","into","there","they","them","what","when","where","which","while","from","then","than","over","some","more","much","very","will","would","could","should","also","been","being","because","each","other","their","these","those","through","into","still","really","always","never","ever","even","kind","keep","kept","make","made","makes","know","knew","known","think","thought","want","wanted","need","needed","take","took","taken","find","found","finding","work","working","day","days","time","today","weeks","week","again","things","something","anything","everything","nothing","talked","talking","said","saying","tell","told","feels","felt","were","with","without","seemed","seems","seem","being","been","let","its","also","yes","yeah","okay","ok","one","two","three","much","many","alot","got","get","gets","getting",
        ]);
        // Memories captured during the week add another signal to the
        // theme corpus — they're the things Solence chose to remember
        // about the user, so they tend to mirror what's been on their
        // mind (per the spec: include memory content alongside
        // reflections when computing themes).
        const weekMemories = await db
          .select({ text: userMemories.text })
          .from(userMemories)
          .where(
            and(
              eq(userMemories.userId, userId),
              gte(userMemories.createdAt, weekStart),
              lt(userMemories.createdAt, weekEnd),
            ),
          );

        // Build the corpus once — it's used by both the LLM path
        // (preferred) and the keyword fallback below. Each reflection
        // contributes its takeaway + summary as a single item; each
        // memory contributes its text. Empty strings are filtered out
        // by generateWeeklyThemes itself.
        const corpusItems: string[] = [];
        for (const c of weekConversations) {
          const combined = `${c.reflectionTakeaway ?? ""} ${c.reflectionSummary ?? ""}`.trim();
          if (combined.length > 0) corpusItems.push(combined);
        }
        for (const m of weekMemories) {
          const text = (m.text ?? "").trim();
          if (text.length > 0) corpusItems.push(text);
        }

        // Look up the user's preferred language so the LLM responds in
        // the right tongue. Best-effort: any failure falls through to
        // the default language and the prompt still works.
        let userLanguage: Language = DEFAULT_LANGUAGE;
        try {
          const [userRow] = await db
            .select({ language: users.language })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const stored = userRow?.language ?? null;
          if (
            stored &&
            (LANGUAGE_OPTIONS as readonly string[]).includes(stored)
          ) {
            userLanguage = stored as Language;
          }
        } catch {
          // best-effort: fall back to default
        }

        // Try the LLM first — it produces multi-word, language-aware
        // phrases like "work stress" / "estrés laboral" instead of
        // single tokens. On any failure (including no corpus content)
        // we fall back to the keyword extractor so the endpoint never
        // returns a broken themes block.
        let themes: string[] = [];
        if (corpusItems.length > 0) {
          const llmThemes = await generateWeeklyThemes(
            corpusItems,
            userLanguage,
          );
          // Require at least 2 themes to honour the 2–3 contract — a
          // lone single phrase reads more like a label than a "themes"
          // section, so we'd rather fall through to the keyword
          // extractor in that case.
          if (llmThemes && llmThemes.length >= 2) {
            themes = llmThemes;
          }
        }

        if (themes.length === 0) {
          // Keyword fallback: tokenize, drop stop words, count, and
          // surface the top 3. Cheap and predictable — used when the
          // model call fails, returns nothing usable, or there's no
          // corpus to summarize at all.
          const counts = new Map<string, number>();
          const ingest = (text: string) => {
            for (const raw of text.toLowerCase().split(/[^a-záéíóúñü]+/i)) {
              const word = raw.trim();
              if (word.length < 4) continue;
              if (STOP_WORDS.has(word)) continue;
              counts.set(word, (counts.get(word) ?? 0) + 1);
            }
          };
          for (const item of corpusItems) {
            ingest(item);
          }
          themes = [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 3)
            .map(([word]) => word);
        }

        // Highlight quote: first try a favorited assistant message from
        // the week (the user explicitly said "this stays with me"),
        // falling back to the most recent assistant message. Both paths
        // are scoped to conversations the user owns AND created during
        // this week, so we never bleed lines from an older session.
        type HighlightRow = {
          id: number;
          content: string;
          createdAt: Date;
          conversationId: number;
        };
        let highlight: HighlightRow | null = null;
        const weekConvIds = weekConversations.map((c) => c.id);
        if (weekConvIds.length > 0) {
          const favRows = await db
            .select({
              id: messages.id,
              content: messages.content,
              createdAt: messages.createdAt,
              conversationId: messages.conversationId,
            })
            .from(messages)
            .innerJoin(favorites, eq(favorites.messageId, messages.id))
            .where(
              and(
                eq(favorites.userId, userId),
                eq(messages.role, "assistant"),
                inArray(messages.conversationId, weekConvIds),
              ),
            )
            .orderBy(desc(favorites.createdAt))
            .limit(1);
          if (favRows.length > 0) {
            highlight = favRows[0];
          } else {
            const recent = await db
              .select({
                id: messages.id,
                content: messages.content,
                createdAt: messages.createdAt,
                conversationId: messages.conversationId,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.role, "assistant"),
                  inArray(messages.conversationId, weekConvIds),
                ),
              )
              .orderBy(desc(messages.createdAt))
              .limit(1);
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
          highlight: highlight
            ? {
                messageId: highlight.id,
                conversationId: highlight.conversationId,
                content: highlight.content,
                createdAt:
                  highlight.createdAt instanceof Date
                    ? highlight.createdAt.toISOString()
                    : highlight.createdAt,
              }
            : null,
        });
      } catch (error) {
        console.error("Weekly summary error:", error);
        res.status(500).json({ error: "Failed to load weekly summary" });
      }
    },
  );

  // ── Data export ────────────────────────────────────────────────────
  // Stream a zip of the caller's data back to them. One JSON file per
  // category, scoped strictly to userId. Rate-limited per user to a
  // single export every EXPORT_COOLDOWN_MS so it can't be hammered.
  const EXPORT_COOLDOWN_MS = 5 * 60 * 1000;
  const exportLastRunAt = new Map<string, number>();

  app.post(
    "/api/export",
    requireAuth,
    async (req: Request, res: Response) => {
      const userId = req.user!.userId;
      try {
        const now = Date.now();
        const last = exportLastRunAt.get(userId);
        if (last !== undefined && now - last < EXPORT_COOLDOWN_MS) {
          const retryAfterSec = Math.max(
            1,
            Math.ceil((EXPORT_COOLDOWN_MS - (now - last)) / 1000),
          );
          res.setHeader("Retry-After", String(retryAfterSec));
          return res.status(429).json({
            error:
              "You can export your data again in a few minutes. Thanks for your patience.",
            retryAfterSec,
          });
        }
        // Reserve the slot now so two simultaneous taps can't both pass
        // the gate. If the build fails we roll the timestamp back below.
        exportLastRunAt.set(userId, now);

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) {
          exportLastRunAt.delete(userId);
          return res.status(404).json({ error: "User not found" });
        }

        // Pull every category in parallel. All queries are scoped to
        // userId (directly or through the conversation join) so there is
        // no chance of leaking another user's rows into this archive.
        const [
          conversationRows,
          messageRows,
          favoriteRows,
          moodRows,
          tokenUsageRows,
          memoryRows,
        ] = await Promise.all([
          db
            .select()
            .from(conversations)
            .where(eq(conversations.userId, userId))
            .orderBy(desc(conversations.createdAt)),
          db
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
            .where(eq(conversations.userId, userId))
            .orderBy(desc(messages.createdAt)),
          db
            .select({
              id: favorites.id,
              messageId: favorites.messageId,
              createdAt: favorites.createdAt,
            })
            .from(favorites)
            .where(eq(favorites.userId, userId))
            .orderBy(desc(favorites.createdAt)),
          db
            .select()
            .from(moodEntries)
            .where(eq(moodEntries.userId, userId))
            .orderBy(desc(moodEntries.createdAt)),
          db
            .select()
            .from(tokenUsage)
            .where(eq(tokenUsage.userId, userId))
            .orderBy(desc(tokenUsage.periodStart)),
          db
            .select()
            .from(userMemories)
            .where(eq(userMemories.userId, userId))
            .orderBy(desc(userMemories.createdAt), desc(userMemories.id)),
        ]);

        const generatedAt = new Date().toISOString();
        const account = {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          createdAt: user.createdAt,
          onboardingCompletedAt: user.onboardingCompletedAt,
        };
        const preferences = serializePreferences(user);

        const zip = new JSZip();
        const stamp = (d: Date | string | null | undefined): string | null =>
          d == null
            ? null
            : d instanceof Date
              ? d.toISOString()
              : new Date(d).toISOString();

        const writeJson = (name: string, payload: unknown): void => {
          zip.file(name, `${JSON.stringify(payload, null, 2)}\n`);
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
            createdAt: stamp(c.createdAt),
          })),
        });
        writeJson("messages.json", {
          generatedAt,
          count: messageRows.length,
          messages: messageRows.map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            role: m.role,
            content: m.content,
            createdAt: stamp(m.createdAt),
          })),
        });
        writeJson("favorites.json", {
          generatedAt,
          count: favoriteRows.length,
          favorites: favoriteRows.map((f) => ({
            id: f.id,
            messageId: f.messageId,
            createdAt: stamp(f.createdAt),
          })),
        });
        writeJson("mood_entries.json", {
          generatedAt,
          count: moodRows.length,
          entries: moodRows.map((e) => ({
            id: e.id,
            phase: e.phase,
            score: e.score,
            conversationId: e.conversationId,
            createdAt: stamp(e.createdAt),
          })),
        });
        writeJson("token_usage.json", {
          generatedAt,
          count: tokenUsageRows.length,
          entries: tokenUsageRows.map((t) => ({
            id: t.id,
            tokensUsed: t.tokensUsed,
            periodStart: stamp(t.periodStart),
            createdAt: stamp(t.createdAt),
          })),
        });
        writeJson("memories.json", {
          generatedAt,
          count: memoryRows.length,
          memories: memoryRows.map((m) => ({
            id: m.id,
            text: m.text,
            sourceConversationId: m.sourceConversationId,
            createdAt: stamp(m.createdAt),
          })),
        });
        zip.file(
          "README.txt",
          [
            "Solence — your data export",
            "",
            `Generated for ${user.email} at ${generatedAt}.`,
            "",
            "Each .json file contains one category of your data:",
            "  • account.json       — basic profile (id, email, sign-up date)",
            "  • preferences.json   — name, focus areas, tone, voice",
            "  • conversations.json — every session you've had with Solence",
            "  • messages.json      — the full transcript of those sessions",
            "  • favorites.json     — replies you bookmarked as saved moments",
            "  • mood_entries.json  — pre/post-session mood check-ins",
            "  • token_usage.json   — daily usage of the free token allowance",
            "  • memories.json      — long-term notes Solence has kept about you",
            "",
            "Sensitive material (your password hash, auth tokens, billing",
            "details) is never included in this archive.",
            "",
          ].join("\n"),
        );

        const buffer = await zip.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        });

        const emailPrefix =
          (user.email.split("@")[0] ?? "user")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 32) || "user";
        const dateStamp = generatedAt.slice(0, 10).replace(/-/g, "");
        const filename = `solence-export-${emailPrefix}-${dateStamp}.zip`;

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Content-Length", String(buffer.length));
        res.status(200).end(buffer);
      } catch (error) {
        console.error("Data export error:", error);
        // Roll the cooldown back so the user can retry without waiting
        // five minutes after a server-side failure.
        exportLastRunAt.delete(userId);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to build data export" });
        }
      }
    },
  );

  app.post("/api/chat/voice", audioBodyParser, requireAuth, async (req: Request, res: Response) => {
    let reservationActive = false;
    let premiumMode = false;
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

      // Active referral credit acts as a subscription override: while
      // it's in effect, we skip the daily-cap check entirely. We also
      // skip recording usage during the credit window so the chart
      // honestly reflects "this was free".
      const [userRow, activeCredit] = await Promise.all([
        db.select({ isPremium: users.isPremium }).from(users).where(eq(users.id, userId)).limit(1),
        getActiveReferralCredit(userId),
      ]);
      const isPremium = userRow[0]?.isPremium ?? false;
      const unlimitedMode = activeCredit !== null;

      if (!unlimitedMode) {
        if (isPremium) {
          // Premium: enforce daily message cap (250/day)
          const used = await getMessagesUsed(userId);
          if (used >= PREMIUM_MESSAGE_LIMIT) {
            return res.status(429).json({
              error: "Daily message limit reached",
              tokensUsed: used,
              tokensRemaining: 0,
              tokenLimit: PREMIUM_MESSAGE_LIMIT,
              nextResetAt: getNextPeriodStart().toISOString(),
              period: "day",
            });
          }
          premiumMode = true;
          reservedPeriodStart = getCurrentPeriodStart();
        } else {
          // Free: enforce daily token cap
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
        }
      }

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
          // In unlimited (referral-credit) mode we never reserved, so
          // there's nothing to refund.
          if (reservationActive && reservedPeriodStart) {
            await recordTokens(
              userId,
              -MIN_TOKENS_FOR_REQUEST,
              reservedPeriodStart,
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

      // Run crisis-language detection on the user's turn in parallel with
      // the rest of the request setup. Default to false on any failure so
      // a flaky classifier never blocks the chat reply.
      const crisisSupportPromise = detectCrisisSignal(userTranscript).catch(
        () => false,
      );

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
      let userLanguage: Language = DEFAULT_LANGUAGE;
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
          if (prefs.language) userLanguage = prefs.language;
        }
      } catch (prefError) {
        console.error(
          "Failed to load personalization for chat:",
          prefError instanceof Error ? prefError.message : prefError,
        );
      }

      // Long-term memory snippets carried over from past reflections.
      // These are short, durable observations about the user (e.g. names
      // they mentioned, a stable life situation) rather than mood-of-the-
      // moment notes. The storage cap (USER_MEMORY_MAX_PER_USER) governs
      // how many we keep; we apply tighter prompt-side budgets here so
      // the injected block stays close to a ~200 token target regardless
      // of how full the user's store is. Newest memories win when we
      // truncate. The prompt explicitly tells the model not to recite
      // memories verbatim, mirroring how `pastContext` is framed.
      let memoryBlock = "";
      try {
        const memoryRows = await db
          .select({ text: userMemories.text })
          .from(userMemories)
          .where(eq(userMemories.userId, userId))
          .orderBy(desc(userMemories.createdAt), desc(userMemories.id))
          .limit(USER_MEMORY_PROMPT_MAX_ITEMS);
        const selectedLines: string[] = [];
        let usedChars = 0;
        for (const row of memoryRows) {
          const line = `- ${row.text}`;
          // +1 accounts for the join newline once we have at least one line.
          const projected =
            usedChars + line.length + (selectedLines.length > 0 ? 1 : 0);
          if (projected > USER_MEMORY_PROMPT_CHAR_BUDGET) break;
          selectedLines.push(line);
          usedChars = projected;
        }
        if (selectedLines.length > 0) {
          memoryBlock = `\n\nWHAT YOU REMEMBER ABOUT THIS USER (from past sessions; reference only when it fits naturally, never recite):\n${selectedLines.join("\n")}`;
        }
      } catch (memoryError) {
        console.error(
          "Failed to load user memories for chat:",
          memoryError instanceof Error ? memoryError.message : memoryError,
        );
      }

      // When the user has chosen Spanish, instruct the model to reply in
      // Spanish. We append this AFTER personalization so the language
      // directive is the most recent line of the system prompt and harder
      // for the model to wash out.
      const languageDirective =
        userLanguage === "es"
          ? "\n\nLANGUAGE: Always reply in Spanish (español). Use natural, warm, conversational Latin American Spanish. Match the user's register and vocabulary. Keep your usual calm, grounded tone — just in Spanish. Do not switch back to English unless the user explicitly asks you to."
          : "";

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
          content:
            SOLENCE_SYSTEM_PROMPT +
            personalizationBlock +
            memoryBlock +
            pastContext +
            moodHint +
            languageDirective,
        },
        ...currentMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      // Two-call flow (much cheaper than single gpt-audio call whose audio
      // output tokens cost ~$64/1M):
      //   1. Full-quality text model generates the reply at text pricing.
      //   2. gpt-4o-mini-tts synthesizes the spoken audio from that text.
      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: chatHistory as Parameters<typeof openai.chat.completions.create>[0]["messages"],
      });

      const assistantTranscript = response.choices[0]?.message?.content || "";

      let audioData = "";
      if (assistantTranscript) {
        const speech = await openai.audio.speech.create({
          model: "gpt-4o-mini-tts",
          voice: selectedVoice,
          input: assistantTranscript,
          response_format: "mp3",
        });
        audioData = Buffer.from(await speech.arrayBuffer()).toString("base64");
      }

      // The TTS endpoint doesn't report token usage, so estimate its input
      // tokens from the transcript length (~4 chars/token) and sum with the
      // chat call's usage so the daily free-tier accounting stays sensible.
      const ttsTokensEstimate = Math.ceil(assistantTranscript.length / 4);
      const totalTokens = (response.usage?.total_tokens || 0) + ttsTokensEstimate;
      // Skip usage recording entirely while a referral credit is active —
      // the daily-cap chart honestly reflects "this was free during the
      // unlimited window".
      if (!unlimitedMode) {
        if (premiumMode) {
          await recordMessage(userId, reservedPeriodStart!);
        } else {
          const additionalTokens = Math.max(0, totalTokens - MIN_TOKENS_FOR_REQUEST);
          if (additionalTokens > 0) {
            await recordTokens(userId, additionalTokens, reservedPeriodStart!);
          }
        }
      }
      reservationActive = false;
      const wasPremium = premiumMode;
      premiumMode = false;

      const updatedTokensUsed = wasPremium
        ? await getMessagesUsed(userId)
        : await getTokensUsed(userId);
      const tokenLimit = isPremium ? PREMIUM_MESSAGE_LIMIT : FREE_TOKEN_LIMIT;
      const tokensRemaining = Math.max(0, tokenLimit - updatedTokensUsed);

      // Resolve the crisis check before persisting the assistant message so
      // the flag is stored on the row that the client will surface a
      // support banner against when re-opening this conversation.
      const crisisSupport = await crisisSupportPromise;

      await db.insert(messages).values({
        conversationId,
        role: "assistant",
        content: assistantTranscript,
        crisisSupport,
      });

      console.log(
        `Voice req: ${userTranscript.length}c in, ${assistantTranscript.length}c out, ` +
          `${totalTokens} tokens (daily total ${updatedTokensUsed}/${tokenLimit})`,
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
              userLanguage,
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

  // ── RevenueCat Webhook ──────────────────────────────────────────────────
  // RC sends POST events when subscriptions change. We flip isPremium on the
  // user row so the voice route enforces the right daily cap immediately.
  app.post("/api/webhooks/revenuecat", express.json(), async (req: Request, res: Response) => {
    try {
      const event = req.body?.event;
      if (!event) return res.status(400).json({ error: "Missing event" });

      const appUserId: string | undefined = event.app_user_id;
      if (!appUserId) return res.status(200).json({ ok: true }); // anonymous, ignore

      // Resolve the RC anonymous/alias ID to our DB user id.
      // RC sends our internal userId as the app_user_id after we call
      // Purchases.logIn(userId) — which we should do on the client after auth.
      const ACTIVE_EVENTS = new Set([
        "INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE",
      ]);
      const LAPSED_EVENTS = new Set([
        "EXPIRATION", "CANCELLATION", "BILLING_ISSUE", "SUBSCRIBER_ALIAS",
      ]);

      let isPremium: boolean | null = null;
      if (ACTIVE_EVENTS.has(event.type)) isPremium = true;
      else if (LAPSED_EVENTS.has(event.type)) isPremium = false;

      if (isPremium !== null) {
        await db
          .update(users)
          .set({ isPremium })
          .where(eq(users.id, appUserId));
        console.log(`[RC webhook] user=${appUserId} isPremium=${isPremium} event=${event.type}`);
      }

      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[RC webhook] error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  await seedTestAccount();

  const httpServer = createServer(app);

  return httpServer;
}
