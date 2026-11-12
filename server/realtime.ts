import express, { type Express, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LIVE_VOICE_MAX_SECONDS, liveVoiceConfig, realtimeTranscript, type LiveVoiceTurn } from "../shared/realtime";
import { startLiveProviderCall, type LiveProviderStart, type LiveProviderCall } from "./realtime-provider";
import { createLiveUsageTracker, type LiveUsageStore, type LiveUsageRecord } from "./realtime-usage";

type Context = { conversationId: number; instructions: string; language: string; voice: string };
type Options = {
  requireAuth: RequestHandler;
  loadContext: (userId: string, conversationId?: number) => Promise<Context>;
  persistTurn: (conversationId: number, turn: LiveVoiceTurn, createdAt: Date, messageId?: number) => Promise<number>;
  startCall?: LiveProviderStart;
  enabled?: boolean;
  usageStore?: LiveUsageStore;
  finalizeConversation?: (conversationId: number, language: string) => Promise<void>;
};
const input = z.object({
  sdp: z.string().min(20).max(64000).refine((s) => s.startsWith("v=0"), "Invalid SDP offer"),
  conversationId: z.number().int().positive().optional(),
});

export function registerRealtimeRoutes(app: Express, options: Options) {
  const active = new Map<string, {
    userId: string; conversationId: number; call?: LiveProviderCall;
    callPromise?: Promise<LiveProviderCall>; ending?: Promise<void>;
    queue: Promise<void>; seen: Set<string>; saved: number; saveError: boolean;
    ended: boolean; timer?: ReturnType<typeof setTimeout>;
    record: LiveUsageRecord; usageTracker: ReturnType<typeof createLiveUsageTracker>; usageError: boolean;
    language: string;
  }>();
  const pending = new Set<string>();
  const starts = new Map<string, number[]>();
  const startCall = options.startCall ?? startLiveProviderCall;
  const gate: RequestHandler = (_req, res, next) => {
    if (!(options.enabled ?? process.env.NODE_ENV === "development")) {
      res.status(404).json({ error: "Not found" }); return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  };
  async function saveUsage(session: NonNullable<ReturnType<typeof active.get>>) {
    if (!options.usageStore) return;
    await options.usageStore.save({ ...session.record, usage: session.usageTracker.snapshot() });
  }
  app.get("/api/chat/realtime/usage", gate, options.requireAuth, async (req, res) => {
    if (!options.usageStore) { res.status(503).json({ error: "Usage tracking is unavailable." }); return; }
    try { res.json(await options.usageStore.summary(req.user!.userId)); }
    catch { res.status(503).json({ error: "Could not load live voice usage. Please retry." }); }
  });
  async function end(id: string) {
    const session = active.get(id);
    if (!session) return;
    session.ended = true;
    if (!session.ending) session.ending = (async () => {
      session.record.endedAt = new Date();
      session.record.status = session.record.connectedAt ? "ended" : "failed";
      clearTimeout(session.timer);
      const call = session.call ?? await session.callPromise?.catch(() => undefined);
      await call?.close().catch(() => { session.saveError = true; });
      await session.queue;
      if (session.usageError) session.record.status = "tracking_error";
      await saveUsage(session).catch(() => { session.usageError = true; });
      if (session.saved >= 2 && !session.saveError && options.finalizeConversation) {
        void options.finalizeConversation(session.conversationId, session.language).catch(() => {
          console.error("Live voice reflection generation failed; history backfill can retry.");
        });
      }
      // Retain the result briefly so retries can confirm saving completed.
      session.timer = setTimeout(() => active.delete(id), 60000);
      session.timer.unref();
    })();
    await session.ending;
  }
  app.post("/api/chat/realtime", gate, express.json({ limit: "70kb" }), options.requireAuth, async (req, res) => {
    const userId = req.user!.userId;
    const parsed = input.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "A valid audio connection offer is required." }); return; }
    if (pending.has(userId) || [...active.values()].some((s) => s.userId === userId && !s.ended)) {
      res.status(409).json({ error: "End your current live call before starting another." }); return;
    }
    const now = Date.now();
    for (const [key, times] of starts) {
      const recent = times.filter((time) => now - time < 3600000);
      if (recent.length) starts.set(key, recent); else starts.delete(key);
    }
    const keys = [`user:${userId}`, `ip:${req.ip}`];
    if (active.size >= 30 || keys.some((key) => (starts.get(key)?.length ?? 0) >= 10)) {
      res.status(429).json({ error: "Live voice test limit reached. Try again later." }); return;
    }
    for (const key of keys) starts.set(key, [...(starts.get(key) ?? []), now]);
    pending.add(userId);
    let id: string | undefined;
    let disconnected = false;
    res.on("close", () => {
      if (!res.writableEnded) { disconnected = true; if (id) void end(id); }
    });
    try {
      const ctx = await options.loadContext(userId, parsed.data.conversationId);
      if (disconnected) return;
      id = randomUUID();
      const session = {
        userId, conversationId: ctx.conversationId,
        queue: Promise.resolve(), seen: new Set<string>(), saved: 0,
        saveError: false, ended: false,
        usageTracker: createLiveUsageTracker(), usageError: false, language: ctx.language,
        record: {
          id, userId, conversationId: ctx.conversationId, startedAt: new Date(),
          connectedAt: null, endedAt: null, status: "starting", usage: createLiveUsageTracker().snapshot(),
        },
      } as NonNullable<ReturnType<typeof active.get>>;
      active.set(id, session);
      try { await saveUsage(session); }
      catch { throw new Error("Could not start live voice usage tracking. Please retry."); }
      const createdTimes = new Map<string, Date>();
      const messageIds = new Map<string, number>();
      const truncated = new Set<string>();
      session.callPromise = startCall(parsed.data.sdp, liveVoiceConfig(ctx.instructions, ctx.language, ctx.voice), userId, (event) => {
        if (session.usageTracker.observe(event)) {
          session.queue = session.queue.then(() => saveUsage(session)).catch(() => {
            session.usageError = true;
            console.error("Live voice usage could not be saved.");
          });
        }
        const itemId = event.item?.id ?? event.item_id;
        if (typeof itemId === "string" && !createdTimes.has(itemId)) createdTimes.set(itemId, new Date());
        const wasTruncated = event.type === "conversation.item.truncated" && typeof event.item_id === "string";
        if (wasTruncated) truncated.add(event.item_id);
        const turn = wasTruncated
          ? { id: event.item_id as string, role: "assistant" as const, text: "[Response interrupted by the user.]" }
          : realtimeTranscript(event);
        if (!turn || (session.seen.has(turn.id) && !wasTruncated)) return;
        session.seen.add(turn.id);
        session.queue = session.queue.then(async () => {
          try {
            const messageId = messageIds.get(turn.id);
            const savedId = await options.persistTurn(ctx.conversationId, {
              ...turn, text: truncated.has(turn.id) ? "[Response interrupted by the user.]" : turn.text,
            }, createdTimes.get(turn.id) ?? new Date(), messageId);
            messageIds.set(turn.id, savedId);
            if (!messageId) session.saved += 1;
          } catch {
            session.saveError = true;
            console.error("Live voice transcript could not be saved.");
          }
        });
      }, () => { if (id) void end(id); });
      session.call = await session.callPromise;
      if (session.ended || disconnected) { await end(id); return; }
      session.record.connectedAt = new Date();
      session.record.status = "active";
      try { await saveUsage(session); }
      catch { throw new Error("Could not save live voice usage tracking. Please retry."); }
      if (session.ended || disconnected) { await end(id); return; }
      session.timer = setTimeout(() => { if (id) void end(id); }, LIVE_VOICE_MAX_SECONDS * 1000);
      session.timer.unref();
      res.json({
        sessionId: id, sdp: session.call.sdp, conversationId: ctx.conversationId,
        maxSeconds: LIVE_VOICE_MAX_SECONDS,
      });
    } catch (error) {
      if (id) await end(id);
      if (!disconnected) res.status(502).json({
        error: error instanceof Error ? error.message : "Could not start live voice.",
      });
    } finally { pending.delete(userId); }
  });
  app.delete("/api/chat/realtime/:id", gate, options.requireAuth, async (req, res) => {
    const id = String(req.params.id);
    const session = active.get(id);
    if (!session || session.userId !== req.user!.userId) {
      res.status(404).json({ error: "Live call not found." }); return;
    }
    await end(id);
    res.json({ saved: session.saved, saveError: session.saveError, conversationId: session.conversationId,
      usageError: session.usageError });
  });
}
