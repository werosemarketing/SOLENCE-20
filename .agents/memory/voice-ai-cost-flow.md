---
name: Voice chat two-call flow
description: Why voice replies use text model + TTS instead of gpt-audio
---
Rule: never revert `/api/chat/voice` (or `voiceChat` helper) to a single gpt-audio call with `modalities: ["text","audio"]`.
**Why:** gpt-audio audio output tokens cost ~$64/1M; the two-call flow (gpt-5.1 text reply, then gpt-4o-mini-tts synthesis) is far cheaper with identical response shape.
**How to apply:** TTS endpoint reports no usage — token accounting sums chat usage + ~chars/4 estimate. TTS failures must fall back to text-only (not throw), or the outer catch over-refunds the free-tier reservation after chat tokens were already spent.
