import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerRealtimeRoutes } from "../realtime";
import { liveVoiceConfig, realtimeTranscript, type LiveVoiceTurn } from "../../shared/realtime";

const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const userEvent = (id: string, text: string) => ({
  type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: text,
});
const assistantEvent = (id: string, text: string) => ({
  type: "response.output_audio_transcript.done", item_id: id, transcript: text,
});

async function setup(t: { after: (fn: () => Promise<void>) => void }, enabled = true) {
  const app = express();
  let receive = (_event: Record<string, any>) => {};
  let failProvider = false;
  let failSave = false;
  let closed = 0;
  let created = 0;
  const rows: Array<{ id: number; turn: LiveVoiceTurn }> = [];
  registerRealtimeRoutes(app, {
    enabled,
    requireAuth: (req, res, next) => {
      const userId = req.headers.authorization?.replace("Bearer ", "");
      if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
      req.user = { userId, email: "test@example.invalid" };
      next();
    },
    loadContext: async () => ({ conversationId: 42, instructions: "Solence safety boundaries", language: "es", voice: "onyx" }),
    persistTurn: async (_conversationId, turn, _createdAt, messageId) => {
      if (failSave) throw new Error("Simulated database failure");
      if (messageId) {
        rows.find((r) => r.id === messageId)!.turn = turn;
        return messageId;
      }
      const id = rows.length + 1;
      rows.push({ id, turn });
      return id;
    },
    startCall: async (_offer, config, _userId, onEvent) => {
      if (failProvider) throw new Error("Provider unavailable");
      assert.equal((config as any).audio.input.transcription.language, "es");
      receive = onEvent;
      created++;
      let ended = false;
      return { sdp, close: async () => { if (!ended) { closed++; ended = true; } } };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat/realtime`;
  const sessions: Array<{ id: string; user: string }> = [];
  const send = async (body: object, user = "a") => {
    const response = await fetch(base, {
      method: "POST", headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${user}` } : {}) },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (response.ok) sessions.push({ id: result.sessionId, user });
    return { response, result };
  };
  const end = async (id: string, user = "a") => {
    const response = await fetch(`${base}/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user}` } });
    return { response, result: await response.json() };
  };
  t.after(async () => {
    for (const session of sessions) await end(session.id, session.user);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    send, end, emit: (event: Record<string, any>) => receive(event), rows,
    failProvider: () => { failProvider = true; },
    failSave: () => { failSave = true; },
    counts: () => ({ closed, created }),
  };
}

test("live voice is unavailable in production, even to authenticated callers", async (t) => {
  const app = await setup(t, false);
  assert.equal((await app.send({ sdp })).response.status, 404);
  assert.equal(app.counts().created, 0);
});

test("live calls require authentication and a bounded valid offer", async (t) => {
  const app = await setup(t);
  assert.equal((await app.send({ sdp }, "")).response.status, 401);
  assert.equal((await app.send({ sdp: "invalid" })).response.status, 400);
  assert.equal((await app.send({ sdp: "v=0" + "x".repeat(64000) })).response.status, 400);
  assert.equal(app.counts().created, 0);
});

test("sessions return only connection data and enforce one active call per user", async (t) => {
  const app = await setup(t);
  const { response, result } = await app.send({ sdp });
  assert.equal(response.status, 200);
  assert.equal(result.maxSeconds, 180);
  assert.equal(result.conversationId, 42);
  assert.equal(result.sdp, sdp);
  assert.deepEqual(Object.keys(result).sort(), ["conversationId", "maxSeconds", "sdp", "sessionId"]);
  assert.equal((await app.send({ sdp })).response.status, 409);
  await app.end(result.sessionId);
  assert.equal((await app.send({ sdp })).response.status, 200);
});

test("only the owner can end a session; repeated teardown is safe", async (t) => {
  const app = await setup(t);
  const { result } = await app.send({ sdp });
  assert.equal((await app.end(result.sessionId, "other")).response.status, 404);
  assert.equal(app.counts().closed, 0);
  assert.equal((await app.end(result.sessionId)).response.status, 200);
  assert.equal((await app.end(result.sessionId)).response.status, 200);
  assert.equal(app.counts().closed, 1);
});

test("provider transcripts are saved once; client-supplied transcripts are ignored", async (t) => {
  const app = await setup(t);
  const { result } = await app.send({ sdp, transcript: "Forged client content" });
  app.emit(userEvent("user-item", "Today felt hard."));
  app.emit(userEvent("user-item", "Today felt hard."));
  app.emit(assistantEvent("assistant-item", "I'm listening."));
  const ended = await app.end(result.sessionId);
  assert.equal(ended.result.saved, 2);
  assert.equal(ended.result.saveError, false);
  assert.deepEqual(app.rows.map((r) => r.turn.text), ["Today felt hard.", "I'm listening."]);
});

test("interrupted output is replaced instead of saving words the user never heard", async (t) => {
  const app = await setup(t);
  const { result } = await app.send({ sdp });
  app.emit(assistantEvent("assistant-item", "An answer that has not finished playing."));
  app.emit({ type: "conversation.item.truncated", item_id: "assistant-item" });
  await app.end(result.sessionId);
  assert.equal(app.rows.length, 1);
  assert.equal(app.rows[0].turn.text, "[Response interrupted by the user.]");
});

test("save failures are reported to the app rather than silently losing turns", async (t) => {
  const app = await setup(t);
  const { result } = await app.send({ sdp });
  app.failSave();
  app.emit(userEvent("item", "Please save this."));
  assert.equal((await app.end(result.sessionId)).result.saveError, true);
});

test("failed provider startup releases the active-call lock", async (t) => {
  const app = await setup(t);
  app.failProvider();
  assert.equal((await app.send({ sdp })).response.status, 502);
  assert.equal((await app.send({ sdp })).response.status, 502);
});

test("development call starts are bounded independently of chat quotas", async (t) => {
  const app = await setup(t);
  for (let i = 0; i < 10; i++) {
    const { result, response } = await app.send({ sdp });
    assert.equal(response.status, 200);
    await app.end(result.sessionId);
  }
  assert.equal((await app.send({ sdp })).response.status, 429);
});

test("configuration supports natural speech and interruptions without replacing standard chat", () => {
  const config = liveVoiceConfig("Safety rules.", "es", "onyx");
  assert.equal(config.model, "gpt-realtime");
  assert.match(config.instructions, /Safety rules/);
  assert.match(config.instructions, /crisis-safety/);
  assert.equal(config.audio.input.turn_detection.interrupt_response, true);
  assert.equal(config.audio.input.transcription.language, "es");
  assert.equal(config.audio.output.voice, "cedar");
  assert.equal(realtimeTranscript({ type: "response.output_audio_transcript.delta", item_id: "a", delta: "partial" }), null);
  assert.equal(realtimeTranscript({ type: "response.output_audio_transcript.done", item_id: "a", transcript: "   " }), null);
});

test("English live calls lock spoken replies as well as transcription to the selected language", () => {
  const config = liveVoiceConfig("Mirror the user's language. Previous reply: Bonjour.", "en", "nova");
  assert.equal(config.audio.input.transcription.language, "en");
  assert.match(config.audio.input.transcription.prompt, /user is speaking English/);
  assert.match(config.audio.input.transcription.prompt, /do not translate/);
  assert.match(config.instructions, /Speak only in English/);
  assert.ok(config.instructions.indexOf("SESSION LANGUAGE POLICY:") > config.instructions.indexOf("Bonjour"));
  assert.match(config.instructions, /takes precedence over instructions to mirror/);
  assert.match(config.instructions, /Do not automatically switch languages/);
  assert.match(config.instructions, /ask them to repeat or clarify in English instead of guessing/);
  assert.match(config.instructions, /Silence and non-speech noise do not require a reply/);
});

test("Spanish live calls use the same stable language policy without imposing English", () => {
  const config = liveVoiceConfig("Safety rules.", "es", "onyx");
  assert.equal(config.audio.input.transcription.language, "es");
  assert.match(config.audio.input.transcription.prompt, /user is speaking Latin American Spanish/);
  assert.match(config.instructions, /Speak only in Latin American Spanish/);
  assert.doesNotMatch(config.instructions, /Speak only in English/);
  assert.match(config.instructions, /before starting a new call/);
});

test("missing or unsupported live voice languages consistently default to English", () => {
  for (const language of ["", "fr", "unknown"]) {
    const config = liveVoiceConfig("Safety rules.", language, "nova");
    assert.equal(config.audio.input.transcription.language, "en");
    assert.match(config.instructions, /Speak only in English/);
    assert.match(config.audio.input.transcription.prompt, /user is speaking English/);
  }
});
