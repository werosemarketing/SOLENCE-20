---
name: Live voice experiment
description: Scope and validation rules for the native conversational voice trial.
---

Realtime voice is included in the existing Unlimited subscription on native iOS and Android. Keep standard text-plus-speech voice available; do not create a new subscription tier.

**Why:** After testing realtime successfully, the user explicitly chose to roll it out in the existing Unlimited subscription rather than introduce a higher-priced plan. Realtime uses a different speech model and can cost more.

**How to apply:** Check the server-side subscription before starting paid calls; never trust a client entitlement claim. Keep provider credentials on the backend, retain Solence's identity and crisis boundaries, and preserve bounded call duration and rate limits. This product decision is not permission to publish or submit builds automatically.

Successful ephemeral credential creation does not establish access to the requested realtime model.

**Why:** Credential creation returned success while actual WebRTC call creation rejected the same model with an access error.

**How to apply:** Verify actual call initialization and the server observer connection before claiming realtime is operational. A no-media handshake can validate setup without transmitting a person's microphone audio; always end the test call.

Use the documented short-lived-token flow for this experiment, keeping the token on the backend as well as the standard API credential.

**Why:** After realtime appeared in both keys' allowed model lists, direct multipart call creation still returned a model-access error. Authorizing the session first, then exchanging plain SDP using its short-lived credential, successfully established both the call and transcript observer. The error was not sufficient evidence that the user's model setting was wrong.

**How to apply:** Preserve the working authorization-plus-SDP sequence. Distinguish authorization failures from connection failures in diagnostics, and confirm the actual exchange before asking the user to change keys or permissions again.

Live voice must stay in the app-selected language throughout a call, rather than switching automatically when speech is ambiguous.

**Why:** The user reported a call that started normally in English and then unexpectedly spoke French, and asked for reliable understanding without language switching. A transcription language hint alone does not constrain the realtime model's spoken replies. The user confirmed that the explicit session-language policy fixed the switching.

**How to apply:** Apply a session-wide spoken-language policy as well as recognition hints. It must take precedence over language mirroring and old conversation examples. Unclear speech should elicit a clarification in the selected language, not guesses or an automatic language change; preserve the user's Spanish preference when selected.
