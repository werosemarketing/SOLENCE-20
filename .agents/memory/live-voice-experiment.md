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
