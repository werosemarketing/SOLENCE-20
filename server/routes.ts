import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { openai, detectAudioFormat, speechToText } from "./replit_integrations/audio";
import { db } from "./db";
import { users, conversations, messages, FREE_TOKEN_LIMIT } from "@shared/schema";
import { eq, desc, inArray, and } from "drizzle-orm";
import {
  MIN_TOKENS_FOR_REQUEST,
  getCurrentPeriodStart,
  getNextPeriodStart,
  getTokensUsed,
  getTokensUsedHistory,
  tryReserveTokens,
  recordTokens,
} from "./tokens";

const audioBodyParser = express.json({ limit: "50mb" });

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

      res.status(201).json({ token, user: { id: newUser.id, email: newUser.email } });
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

      res.json({ token, user: { id: user.id, email: user.email } });
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

      res.json({ user: { id: user.id, email: user.email } });
    } catch (error) {
      console.error("Auth check error:", error);
      res.status(500).json({ error: "Failed to verify authentication" });
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
          };
        }),
      });
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

        res.json({
          conversation: {
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt,
          },
          messages: conversationMessages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
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

  app.post("/api/chat/voice", audioBodyParser, requireAuth, async (req: Request, res: Response) => {
    let reservationActive = false;
    let reservedPeriodStart: Date | null = null;
    const userId = req.user!.userId;
    try {
      const { audio, text, conversationId: requestedConversationId } = req.body;

      if (!audio && !text) {
        return res.status(400).json({ error: "Either [audio] or [text] is required" });
      }

      // Optional caller-supplied target conversation. We validate ownership
      // before trusting it — never let a request append to another user's
      // conversation just because it knows the id.
      let targetConversationId: number | null = null;
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
        const [newConv] = await db
          .insert(conversations)
          .values({ userId, title: "Solence Session" })
          .returning();
        conversationId = newConv.id;
      }

      await db.insert(messages).values({ conversationId, role: "user", content: userTranscript });

      const currentMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt);

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

      const chatHistory: ChatMessage[] = [
        { role: "system", content: SOLENCE_SYSTEM_PROMPT + pastContext },
        ...currentMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-audio",
        modalities: ["text", "audio"],
        audio: { voice: "nova", format: "mp3" },
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
        tokensUsed: updatedTokensUsed,
        tokensRemaining,
        tokenLimit: FREE_TOKEN_LIMIT,
        nextResetAt: getNextPeriodStart().toISOString(),
        period: "day",
      });
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
