import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveUsageTracker } from "../realtime-usage";

const done = (id = "response-1") => ({
  type: "response.done", response: { id, usage: {
    input_tokens: 1100, output_tokens: 150,
    input_token_details: { text_tokens: 100, audio_tokens: 1000, cached_tokens: 50,
      cached_tokens_details: { text_tokens: 20, audio_tokens: 30 } },
    output_token_details: { text_tokens: 50, audio_tokens: 100 },
  } },
});

test("realtime costs distinguish audio, text and cached tokens without charging cached input twice", () => {
  const tracker = createLiveUsageTracker();
  tracker.observe(done());
  const usage = tracker.snapshot();
  assert.equal(usage.responses, 1);
  assert.equal(usage.unpricedResponses, 0);
  assert.ok(Math.abs(usage.estimatedUsd - 0.03858) < 1e-10);
  assert.equal(usage.reportedInputTokens, 1100);
  assert.equal(usage.reportedOutputTokens, 150);
  tracker.observe(done());
  assert.deepEqual(tracker.snapshot(), usage);
});

test("unfinished and cancelled responses remain explicitly incomplete until their usage arrives", () => {
  const tracker = createLiveUsageTracker();
  tracker.observe({ type: "response.created", response: { id: "response-1" } });
  assert.equal(tracker.snapshot().unpricedResponses, 1);
  tracker.observe(done());
  assert.equal(tracker.snapshot().responses, 1);
  assert.equal(tracker.snapshot().unpricedResponses, 0);
  tracker.observe({ type: "response.done", response: { id: "cancelled", status: "cancelled" } });
  assert.equal(tracker.snapshot().unpricedResponses, 1);
});

test("unknown models and incomplete token details are not silently priced using guessed rates", () => {
  const tracker = createLiveUsageTracker();
  tracker.observe({ type: "session.created", session: { model: "gpt-realtime-2.1" } });
  tracker.observe(done());
  assert.equal(tracker.snapshot().estimatedUsd, 0);
  assert.equal(tracker.snapshot().unpricedResponses, 1);
  assert.equal(tracker.snapshot().reportedInputTokens, 1100);
  const noCacheDetails = done("missing-cache");
  delete (noCacheDetails.response.usage.input_token_details as any).cached_tokens_details;
  const second = createLiveUsageTracker();
  second.observe(noCacheDetails);
  assert.equal(second.snapshot().unpricedResponses, 1);
});

test("transcription usage is recorded separately and is not falsely included in realtime estimates", () => {
  const tracker = createLiveUsageTracker();
  const event = { type: "conversation.item.input_audio_transcription.completed", item_id: "user-1",
    usage: { input_tokens: 60, output_tokens: 10 } };
  tracker.observe(event);
  tracker.observe(event);
  assert.equal(tracker.snapshot().transcriptionInput, 60);
  assert.equal(tracker.snapshot().transcriptionOutput, 10);
  assert.equal(tracker.snapshot().estimatedUsd, 0);
});

test("new sessions get independent counters; snapshots cannot mutate the tracker", () => {
  const tracker = createLiveUsageTracker();
  tracker.observe(done());
  tracker.snapshot().estimatedUsd = 100;
  assert.ok(tracker.snapshot().estimatedUsd < 1);
  assert.equal(createLiveUsageTracker().snapshot().responses, 0);
});
