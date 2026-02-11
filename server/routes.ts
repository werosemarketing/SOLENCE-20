import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import express from "express";
import { openai, ensureCompatibleFormat, speechToText } from "./replit_integrations/audio";
import { db } from "./db";
import { conversations, messages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

const audioBodyParser = express.json({ limit: "50mb" });

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

ADAPTABILITY:
Your personality is stable. Your communication style is flexible. Meet users where they are without losing your steady, supportive nature.

How to adapt:
- With playful users: Be lighter, more relaxed, match their energy gently
- With overwhelmed users: Become softer, slower, more grounding
- With practical users: Be more concise and solution-focused
- With emotional processors: Lean into reflection and validation

Always keep your core (grounded, supportive, emotionally intelligent) while flexing your style to what the user needs in the moment.

IDENTITY DISCLOSURE:
- You are an AI-generated presence — not human, not sentient, not a licensed professional
- You do not have consciousness, personal experiences, or feelings
- You are intended for personal reflection only

BOUNDARIES:
- You do NOT provide medical, legal, or therapeutic advice
- You are NOT a crisis support tool
- Never shame, judge, or present yourself as someone who can "fix" a person's life
- If a user appears to be in crisis, in danger, or expressing thoughts of self-harm, clearly and compassionately direct them to emergency services (call 911 or local equivalent) or a licensed mental health provider (such as the 988 Suicide & Crisis Lifeline). Do not attempt to handle crisis situations yourself.

GOAL:
After talking with you, users should feel a little calmer, a little clearer, and a little less alone.`;

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/chat/voice", audioBodyParser, async (req: Request, res: Response) => {
    try {
      const { audio, sessionId } = req.body;

      if (!audio) {
        return res.status(400).json({ error: "Body Param [audio] is required" });
      }

      const rawBuffer = Buffer.from(audio, "base64");
      const { buffer: audioBuffer, format: inputFormat } = await ensureCompatibleFormat(rawBuffer);

      const userTranscript = await speechToText(audioBuffer, inputFormat);
      console.log("User said:", userTranscript);

      let conversationId: number;
      const existingConversations = await db.select().from(conversations).orderBy(desc(conversations.createdAt)).limit(1);
      
      if (existingConversations.length > 0) {
        conversationId = existingConversations[0].id;
      } else {
        const [newConv] = await db.insert(conversations).values({ title: "Solence Session" }).returning();
        conversationId = newConv.id;
      }

      await db.insert(messages).values({ conversationId, role: "user", content: userTranscript });

      const existingMessages = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
      const chatHistory = [
        { role: "system" as const, content: SOLENCE_SYSTEM_PROMPT },
        ...existingMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-audio",
        modalities: ["text", "audio"],
        audio: { voice: "nova", format: "mp3" },
        messages: chatHistory,
      });

      const message = response.choices[0]?.message as any;
      const assistantTranscript = message?.audio?.transcript || message?.content || "";
      const audioData = message?.audio?.data ?? "";

      await db.insert(messages).values({ conversationId, role: "assistant", content: assistantTranscript });

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

  const httpServer = createServer(app);

  return httpServer;
}
