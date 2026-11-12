import { test } from "node:test";
import assert from "node:assert/strict";
import { openai, textToSpeech } from "../replit_integrations/audio/client";

test("voice samples use the allowed dedicated speech model and return real audio bytes", async (t) => {
  t.mock.method(openai.chat.completions, "create", () => {
    throw new Error("Voice previews must not use audio chat completions");
  });
  t.mock.method(openai.audio.speech, "create", async (params: Record<string, unknown>) => {
    assert.equal(params.model, "gpt-4o-mini-tts");
    assert.equal(params.voice, "nova");
    assert.equal(params.input, "Hi, I'm Solence.");
    assert.equal(params.response_format, "mp3");
    return { arrayBuffer: async () => new Uint8Array([0x49, 0x44, 0x33, 0]).buffer };
  });
  assert.equal((await textToSpeech("Hi, I'm Solence.", "nova", "mp3")).toString("ascii", 0, 3), "ID3");
});

test("empty preview audio fails explicitly rather than showing a fake playing state", async (t) => {
  t.mock.method(openai.audio.speech, "create", async () => ({
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  await assert.rejects(textToSpeech("Hello", "alloy", "mp3"), /no audio/);
});

test("legacy pcm16 callers map to the speech endpoint's PCM format", async (t) => {
  t.mock.method(openai.audio.speech, "create", async (params: Record<string, unknown>) => {
    assert.equal(params.response_format, "pcm");
    return { arrayBuffer: async () => new Uint8Array([0, 1]).buffer };
  });
  assert.equal((await textToSpeech("Hello", "alloy", "pcm16")).length, 2);
});
