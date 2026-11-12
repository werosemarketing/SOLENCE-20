---
name: Auxiliary AI model access
description: Why reflection generation uses the enabled app text model and needs a content-level success check.
---

Use the app's permitted text model for background reflections; do not assume a smaller or older model is available to the configured OpenAI project.

**Why:** Voice conversations and speech synthesis worked, but the old reflection model was outside the project's allowed models. The reflection endpoint intentionally returned HTTP 200 with a null reflection, which made missing notes look like an empty-state or timing issue. Switching reflection generation to the already-enabled app text model restored the intended path without requiring another key.

**How to apply:** When changing models for cost reasons, verify actual access before switching. When diagnosing missing notes, verify a non-null generated reflection, not merely an HTTP success response. Keep transcription, preview, and reflection charges distinct from the realtime-only token-cost estimate.
