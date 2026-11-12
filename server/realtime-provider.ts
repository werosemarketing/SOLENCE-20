import WebSocket from "ws";
import { createHash } from "node:crypto";

export type LiveProviderCall = { sdp: string; close: () => Promise<void> };
export type LiveProviderStart = (
  sdp: string, config: object, userId: string,
  onEvent: (event: Record<string, any>) => void,
  onDisconnect: () => void,
) => Promise<LiveProviderCall>;

// Standard OpenAI credentials stay on the backend. Audio travels directly over
// WebRTC; the sideband observes transcripts so saving never trusts client text.
export const startLiveProviderCall: LiveProviderStart = async (
  sdp, config, userId, onEvent, onDisconnect,
) => {
  const apiKey = process.env.OPENAI_REALTIME_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Live voice is not configured on this server.");
  const headers = { Authorization: `Bearer ${apiKey}` };
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(config));
  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST", headers: {
      ...headers,
      "OpenAI-Safety-Identifier": createHash("sha256").update(userId).digest("hex"),
    }, body: form, signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
    const code = body.error?.code?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    if (code === "model_not_found") {
      throw new Error("Live voice is blocked by OpenAI model access (403: model_not_found). The development server needs a key with gpt-realtime access.");
    }
    throw new Error(`OpenAI could not start live voice (${response.status}${code ? `: ${code}` : ""}).`);
  }
  const answer = await response.text();
  const callId = response.headers.get("location")?.match(/\/(rtc_[\w-]+)(?:\?|$)/)?.[1];
  if (!callId || !answer.startsWith("v=0")) throw new Error("OpenAI returned an invalid live voice connection.");
  let closed = false;
  let observer: WebSocket | undefined;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      // Keep observing while hangup drains final completed transcript events.
      const ended = await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/hangup`, {
        method: "POST", headers, signal: AbortSignal.timeout(5000),
      });
      if (!ended.ok && ended.status !== 404) throw new Error("Could not confirm live call ended.");
    } finally {
      await new Promise<void>((resolve) => {
        if (!observer || observer.readyState === WebSocket.CLOSED) { resolve(); return; }
        const timeout = setTimeout(() => { observer?.terminate(); resolve(); }, 1000);
        observer.once("close", () => { clearTimeout(timeout); resolve(); });
        observer.close();
      });
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      observer = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${callId}`, { headers });
      const timeout = setTimeout(() => reject(new Error("Live voice connection timed out.")), 12000);
      observer.once("open", () => { clearTimeout(timeout); resolve(); });
      observer.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Live voice transcript connection failed."));
        if (!closed) onDisconnect();
      });
      observer.on("message", (data) => {
        try { onEvent(JSON.parse(data.toString())); }
        catch { /* A malformed provider event must not crash the server. */ }
      });
      observer.on("close", () => {
        clearTimeout(timeout);
        reject(new Error("Live voice connection closed."));
        if (!closed) onDisconnect();
      });
    });
    return { sdp: answer, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
};
