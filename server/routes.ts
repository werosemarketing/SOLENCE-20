import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { openai, ensureCompatibleFormat, speechToText } from "./replit_integrations/audio";
import { db } from "./db";
import { users, conversations, messages } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

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

    if (existing.length === 0) {
      const hashedPassword = await bcrypt.hash("TestPass123", 10);
      await db.insert(users).values({
        email: "testuser@solence.ai",
        password: hashedPassword,
      });
      console.log("Test account seeded: testuser@solence.ai");
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

  app.post("/api/chat/voice", audioBodyParser, requireAuth, async (req: Request, res: Response) => {
    try {
      const { audio, text } = req.body;
      const userId = req.user!.userId;

      if (!audio && !text) {
        return res.status(400).json({ error: "Either [audio] or [text] is required" });
      }

      let audioBuffer: Buffer | null = null;
      let audioInputFormat: "wav" | "mp3" = "wav";

      if (audio && !text) {
        const rawBuffer = Buffer.from(audio, "base64");
        const result = await ensureCompatibleFormat(rawBuffer);
        audioBuffer = result.buffer;
        audioInputFormat = result.format;
      }

      let conversationId: number;
      const recentConversations = await db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .orderBy(desc(conversations.createdAt))
        .limit(1);

      if (recentConversations.length > 0) {
        conversationId = recentConversations[0].id;
      } else {
        const [newConv] = await db
          .insert(conversations)
          .values({ userId, title: "Solence Session" })
          .returning();
        conversationId = newConv.id;
      }

      if (text) {
        await db.insert(messages).values({ conversationId, role: "user", content: text });
      }

      const currentMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt);

      const pastConversations = await db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, userId))
        .orderBy(desc(conversations.createdAt))
        .limit(6);

      let pastContext = "";
      if (pastConversations.length > 1) {
        const olderConvIds = pastConversations.slice(1).map((c) => c.id);
        const pastMessages = [];
        for (const convId of olderConvIds) {
          const msgs = await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, convId))
            .orderBy(messages.createdAt);
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
        | { role: "user" | "assistant"; content: string }
        | { role: "user"; content: Array<{ type: string; input_audio: { data: string; format: string } }> };

      const chatHistory: ChatMessage[] = [
        { role: "system", content: SOLENCE_SYSTEM_PROMPT + pastContext },
        ...currentMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      if (audioBuffer) {
        const audioBase64ForInput = audioBuffer.toString("base64");
        chatHistory.push({
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: audioBase64ForInput, format: audioInputFormat } },
          ],
        });
      }

      const sttPromise = audioBuffer
        ? speechToText(audioBuffer, audioInputFormat).catch(() => "")
        : Promise.resolve(text || "");

      const responsePromise = openai.chat.completions.create({
        model: "gpt-audio",
        modalities: ["text", "audio"],
        audio: { voice: "nova", format: "mp3" },
        messages: chatHistory as Parameters<typeof openai.chat.completions.create>[0]["messages"],
      });

      const [userTranscript, response] = await Promise.all([sttPromise, responsePromise]);

      const message = response.choices[0]?.message;
      const audioResponse = message && "audio" in message ? (message as { audio?: { transcript?: string; data?: string }; content?: string | null }).audio : undefined;
      const assistantTranscript = audioResponse?.transcript || message?.content || "";
      const audioData = audioResponse?.data ?? "";

      if (audioBuffer && userTranscript) {
        await db.insert(messages).values({ conversationId, role: "user", content: userTranscript });
      }

      await db.insert(messages).values({ conversationId, role: "assistant", content: assistantTranscript });

      console.log("User said:", userTranscript);
      console.log("Solence response:", assistantTranscript);

      res.json({
        text: assistantTranscript,
        userTranscript,
        audioBase64: audioData,
        audioFormat: "mp3",
      });
    } catch (error) {
      console.error("Voice API error:", error);
      res.status(500).json({ error: "Failed to process voice message" });
    }
  });

  await seedTestAccount();

  const httpServer = createServer(app);

  return httpServer;
}
