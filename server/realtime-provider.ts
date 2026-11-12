import WebSocket from "ws";
import { createHash } from "node:crypto";

export type LiveProviderCall = { sdp: string; close: () => Promise<void> };
export type LiveProviderStart = (
  sdp: string, config: object, userId: string,
  onEvent: (event: Record<string, any>) => void,
  onDisconnect: () => void,
) => Promise<LiveProviderCall>;

async function providerError(response: globalThis.Response, stage: string): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
  const code = body.error?.code?.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return new Error(`OpenAI could not ${stage} (${response.status}${code ? `: ${code}` : ""}).`);
}

export async function negotiateLiveCall(
  sdp: string, config: object, userId: string, apiKey: string,
  request: typeof fetch = fetch,
) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  // Use OpenAI's documented short-lived-token connection flow. Keep both
  // credentials on the server; the native app receives only the SDP answer.
  const authorization = await request("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST", headers: {
      ...headers,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": createHash("sha256").update(userId).digest("hex"),
    }, body: JSON.stringify({ session: config }), signal: AbortSignal.timeout(15000),
  });
  if (!authorization.ok) throw await providerError(authorization, "authorize live voice");
  const credential = await authorization.json() as { value?: string };
  if (typeof credential.value !== "string" || !credential.value) {
    throw new Error("OpenAI returned an invalid live voice authorization.");
  }
  const response = await request("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential.value}`, "Content-Type": "application/sdp" },
    body: sdp, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw await providerError(response, "connect live voice");
  const answer = await response.text();
  const callId = response.headers.get("location")?.match(/\/(rtc_[\w-]+)(?:\?|$)/)?.[1];
  if (!callId || !answer.startsWith("v=0")) throw new Error("OpenAI returned an invalid live voice connection.");
  return { answer, callId };
}

// Standard OpenAI credentials stay on the backend. Audio travels directly over
// WebRTC; the sideband observes transcripts so saving never trusts client text.
export const startLiveProviderCall: LiveProviderStart = async (
  sdp, config, userId, onEvent, onDisconnect,
) => {
  const apiKey = process.env.OPENAI_REALTIME_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Live voice is not configured on this server.");
  const headers = { Authorization: `Bearer ${apiKey}` };
  const { answer, callId } = await negotiateLiveCall(sdp, config, userId, apiKey);
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
