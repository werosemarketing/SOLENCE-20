import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createLiveTransport, type LiveTransport } from "@/lib/live-transport";
import { getApiUrl, queryClient } from "@/lib/query-client";
import { realtimeTranscript, type LiveVoiceTurn } from "@shared/realtime";

type State = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "stopping";

export function useLiveVoice() {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<LiveVoiceTurn[]>([]);
  const [muted, setMuted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(180);
  const transport = useRef<LiveTransport | null>(null);
  const session = useRef<{ id: string; token: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const starting = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const stop = useCallback(async () => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (requestTimer.current) clearTimeout(requestTimer.current);
    requestTimer.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    transport.current?.close();
    transport.current = null;
    const ended = session.current;
    session.current = null;
    if (mounted.current) setState("stopping");
    try {
      if (ended) {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 12000);
        let response: Response;
        try {
          response = await fetch(`${getApiUrl()}/api/chat/realtime/${ended.id}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${ended.token}` }, signal: abort.signal,
          });
        } finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error("The microphone is off, but saving could not be confirmed. Your transcript is still shown below.");
        const result = await response.json();
        if (result.saveError) throw new Error("Some turns could not be saved. Your transcript is still shown below.");
        if (result.usageError && mounted.current) {
          setError("Your chat was saved, but usage tracking may be incomplete. Check the usage panel before relying on its estimate.");
        }
        await queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Could not confirm the call ended.");
    } finally {
      if (!starting.current) {
        busy.current = false;
        if (mounted.current) { setState("idle"); setMuted(false); }
      }
    }
  }, []);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (busy.current || starting.current) return;
    busy.current = true;
    starting.current = true;
    const current = ++generation.current;
    const valid = () => mounted.current && current === generation.current;
    setError(""); setTurns([]); setMuted(false); setState("connecting");
    try {
      const token = await AsyncStorage.getItem("solence_auth_token");
      if (!token) throw new Error("Please sign in to try live voice.");
      const connection = await createLiveTransport({
        event: (event) => {
          if (!valid()) return;
          const turn = realtimeTranscript(event);
          if (turn) setTurns((previous) => previous.some((t) => t.id === turn.id) ? previous : [...previous, turn]);
          if (event.type === "conversation.item.truncated") {
            setTurns((previous) => previous.map((t) => t.id === event.item_id ?
              { ...t, text: "[Response interrupted by you.]" } : t));
          }
          if (event.type === "input_audio_buffer.speech_started") setState("listening");
          if (event.type === "input_audio_buffer.speech_stopped") setState("thinking");
          if (event.type === "output_audio_buffer.started") setState("speaking");
          if (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") setState("listening");
          if (event.type === "error") {
            setError("Live voice encountered a connection error. Please try again.");
            void stopRef.current();
          }
          if (event.type === "solence.audio_error") {
            setError("Could not enable speaker playback. Please restart the call.");
            void stopRef.current();
          }
        },
        disconnected: () => {
          if (!valid()) return;
          setError("The live connection ended. You can start another call.");
          void stopRef.current();
        },
      });
      if (!valid()) { connection.close(); return; }
      transport.current = connection;
      const offer = await connection.offer();
      if (!valid()) return;
      const abort = new AbortController();
      controller.current = abort;
      // Hermes/React Native does not consistently implement AbortSignal.any
      // or AbortSignal.timeout. Use a regular AbortController on devices.
      requestTimer.current = setTimeout(() => abort.abort(), 45000);
      const response = await fetch(`${getApiUrl()}/api/chat/realtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sdp: offer }),
        signal: abort.signal,
      });
      const result = await response.json();
      if (requestTimer.current) clearTimeout(requestTimer.current);
      requestTimer.current = null;
      if (!response.ok) throw new Error(result.error || "Could not connect live voice.");
      // Keep the ID even if the user cancelled while the request completed,
      // so the authenticated teardown can hang up the provider call.
      session.current = { id: result.sessionId, token };
      if (!valid()) { await stopRef.current(); return; }
      await connection.answer(result.sdp);
      if (!valid()) return;
      setState("listening");
      setSecondsLeft(result.maxSeconds);
      const expires = Date.now() + result.maxSeconds * 1000;
      timer.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
        if (mounted.current) setSecondsLeft(remaining);
        if (!remaining) void stopRef.current();
      }, 1000);
    } catch (e) {
      if (!valid()) return;
      setError(e instanceof Error ? e.message : "Could not start live voice.");
      await stopRef.current();
    } finally {
      starting.current = false;
      if (!session.current) {
        busy.current = false;
        if (mounted.current) { setState("idle"); setMuted(false); }
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener("change", (next) => {
      // "inactive" can be the microphone permission dialog on iOS.
      if (next === "background" && busy.current) void stopRef.current();
    });
    return () => {
      mounted.current = false;
      listener.remove();
      void stopRef.current();
    };
  }, []);
  const toggleMute = () => {
    setMuted((previous) => { transport.current?.mute(!previous); return !previous; });
  };
  return { state, error, turns, muted, secondsLeft, start, stop, toggleMute };
}
