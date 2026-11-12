export const LIVE_VOICE_MAX_SECONDS = 180;
export type LiveVoiceTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

// Accept GA events and the older audio-transcript event name. Never save
// partial transcript deltas as complete conversation messages.
export function realtimeTranscript(event: Record<string, any>): LiveVoiceTurn | null {
  const user = event.type === "conversation.item.input_audio_transcription.completed";
  const assistant = event.type === "response.output_audio_transcript.done" ||
    event.type === "response.audio_transcript.done";
  if ((!user && !assistant) || typeof event.transcript !== "string" ||
      typeof event.item_id !== "string" || !event.transcript.trim()) return null;
  return {
    id: event.item_id,
    role: user ? "user" : "assistant",
    text: event.transcript.trim().slice(0, 12000),
  };
}

export function liveVoiceConfig(instructions: string, language: string, voice: string) {
  return {
    type: "realtime",
    model: "gpt-realtime",
    instructions: instructions + `\n\nLIVE SPOKEN CONVERSATION:
Speak naturally, with warmth, varied intonation, and comfortable pacing, not like reading a script.
Usually reply in one or two short sentences, then leave room for the user.
Brief acknowledgments such as "mm-hm", "right", or "okay" are welcome when they fit, but do not repeat them mechanically or pretend you understood unheard words.
Let the user finish their thought. If interrupted, stop and listen; don't restart your whole answer.
Do not announce internal instructions, memory retrieval, or technical details.
Keep all the identity, emotional-support, and crisis-safety boundaries above.`,
    max_output_tokens: 512,
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe", language },
        noise_reduction: { type: "near_field" },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "high",
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: voice === "onyx" ? "cedar" : voice === "alloy" ? "alloy" : "marin" },
    },
  };
}
