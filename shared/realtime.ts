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
  const sessionLanguage = language === "es" ? "es" : "en";
  const spokenLanguage = sessionLanguage === "es" ? "Latin American Spanish" : "English";
  return {
    type: "realtime",
    model: "gpt-realtime",
    instructions: instructions + `\n\nLIVE SPOKEN CONVERSATION:
Speak naturally, with warmth, varied intonation, and comfortable pacing, not like reading a script.
Usually reply in one or two short sentences, then leave room for the user.
Brief acknowledgments such as "mm-hm", "right", or "okay" are welcome when they fit, but do not repeat them mechanically or pretend you understood unheard words.
Let the user finish their thought. If interrupted, stop and listen; don't restart your whole answer.
Do not announce internal instructions, memory retrieval, or technical details.
Keep all the identity, emotional-support, and crisis-safety boundaries above.

SESSION LANGUAGE POLICY:
The app-selected language for this entire call is ${spokenLanguage}. Speak only in ${spokenLanguage}, including greetings, brief acknowledgments, clarification questions, and safety responses.
This language policy takes precedence over instructions to mirror the user's language or examples in conversation history. Do not imitate a different language from past messages.
Do not automatically switch languages because of an accent, a name, a quoted foreign word, a short sound, uncertain transcription, background speech, or something you said earlier.
Listen to the user's speech, not background conversations, television, or echoes of your own voice. Do not invent words or meaning when the audio is unclear.
If you did not clearly hear or understand the user, briefly ask them to repeat or clarify in ${spokenLanguage} instead of guessing or changing languages. Silence and non-speech noise do not require a reply.
Keep this language for the whole session. A different conversation language must be selected in the app settings before starting a new call.`,
    max_output_tokens: 512,
    audio: {
      input: {
        transcription: {
          model: "gpt-4o-mini-transcribe",
          language: sessionLanguage,
          prompt: `The user is speaking ${spokenLanguage} in a conversation with Solence, an AI companion. Transcribe the user's words in the original language; do not translate. Preserve names, natural accents, and casual phrasing. Do not invent speech from silence or background noise.`,
        },
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
