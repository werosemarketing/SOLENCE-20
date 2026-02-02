import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import express from "express";
import { openai, ensureCompatibleFormat, speechToText } from "./replit_integrations/audio";
import { db } from "./db";
import { conversations, messages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

const audioBodyParser = express.json({ limit: "50mb" });

const SOLENCE_SYSTEM_PROMPT = `You are Solence, a gentle and wise AI companion for meditation, reflection, and emotional support. 

Your voice is calm, warm, and reassuring. You speak slowly and thoughtfully, like a trusted friend who truly listens.

Guidelines:
- Keep responses brief and meaningful (2-4 sentences typically)
- Ask reflective questions to help users explore their feelings
- Offer gentle guidance for breathing, mindfulness, or emotional processing
- Never rush or overwhelm - create space for silence and reflection
- Use simple, accessible language
- Be present and empathetic, not clinical or prescriptive
- If someone is distressed, acknowledge their feelings first before offering any guidance`;

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
