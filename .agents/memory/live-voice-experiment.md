---
name: Live voice experiment
description: Scope and validation rules for the native conversational voice trial.
---

The realtime voice path is a separate development-only experiment, not a replacement for the standard text-plus-speech flow.

**Why:** The user requested a native development test of more conversational, lower-latency voice, not a production rollout. Realtime uses a different speech model and can cost more.

**How to apply:** Keep the existing default voice behavior and cost protections intact. Require an explicit production decision before enabling realtime for live users. Keep provider credentials on the backend, retain Solence's identity and crisis boundaries, and bound experimental call duration.

Successful ephemeral credential creation does not establish access to the requested realtime model.

**Why:** Credential creation returned success while actual WebRTC call creation rejected the same model with an access error.

**How to apply:** Verify actual call initialization and the server observer connection before claiming realtime is operational. A no-media handshake can validate setup without transmitting a person's microphone audio; always end the test call.

Use the documented short-lived-token flow for this experiment, keeping the token on the backend as well as the standard API credential.

**Why:** After realtime appeared in both keys' allowed model lists, direct multipart call creation still returned a model-access error. Authorizing the session first, then exchanging plain SDP using its short-lived credential, successfully established both the call and transcript observer. The error was not sufficient evidence that the user's model setting was wrong.

**How to apply:** Preserve the working authorization-plus-SDP sequence. Distinguish authorization failures from connection failures in diagnostics, and confirm the actual exchange before asking the user to change keys or permissions again.

Live voice must stay in the app-selected language throughout a call, rather than switching automatically when speech is ambiguous.

**Why:** The user reported a call that started normally in English and then unexpectedly spoke French, and asked for reliable understanding without language switching. A transcription language hint alone does not constrain the realtime model's spoken replies. The user confirmed that the explicit session-language policy fixed the switching.

**How to apply:** Apply a session-wide spoken-language policy as well as recognition hints. It must take precedence over language mirroring and old conversation examples. Unclear speech should elicit a clarification in the selected language, not guesses or an automatic language change; preserve the user's Spanish preference when selected.
