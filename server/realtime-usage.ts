import type { LiveUsageTotals } from "../shared/live-usage";

// USD per million tokens, verified against OpenAI's gpt-realtime model page.
// https://developers.openai.com/api/docs/models/gpt-realtime
export const LIVE_PRICING_VERSION = "gpt-realtime-2026-11-12";
const rates = { inputText: 4, inputAudio: 32, cachedText: 0.4, cachedAudio: 0.4, outputText: 16, outputAudio: 64 };
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function createLiveUsageTracker() {
  const seen = new Set<string>();
  const pending = new Set<string>();
  let model = "gpt-realtime";
  const totals: LiveUsageTotals = {
    responses: 0, unpricedResponses: 0, reportedInputTokens: 0, reportedOutputTokens: 0,
    inputText: 0, inputAudio: 0,
    cachedText: 0, cachedAudio: 0, outputText: 0, outputAudio: 0,
    transcriptionInput: 0, transcriptionOutput: 0, estimatedUsd: 0,
  };
  return {
    snapshot: () => ({
      ...totals, responses: totals.responses + pending.size,
      unpricedResponses: totals.unpricedResponses + pending.size,
    }),
    observe(event: Record<string, any>): boolean {
      if ((event.type === "session.created" || event.type === "session.updated") && typeof event.session?.model === "string") {
        model = event.session.model;
      }
      if (event.type === "response.created" && typeof event.response?.id === "string" && !seen.has(event.response.id)) {
        pending.add(event.response.id);
        return true;
      }
      const transcription = event.type === "conversation.item.input_audio_transcription.completed";
      if (transcription) {
        if (typeof event.item_id !== "string" || seen.has(`transcript:${event.item_id}`)) return false;
        seen.add(`transcript:${event.item_id}`);
        totals.transcriptionInput += count(event.usage?.input_tokens) ?? 0;
        totals.transcriptionOutput += count(event.usage?.output_tokens) ?? 0;
        return true;
      }
      if (event.type !== "response.done" || typeof event.response?.id !== "string") return false;
      const response = event.response;
      if (seen.has(response.id)) return false;
      seen.add(response.id);
      pending.delete(response.id);
      totals.responses++;
      const usage = response.usage;
      totals.reportedInputTokens += count(usage?.input_tokens) ?? 0;
      totals.reportedOutputTokens += count(usage?.output_tokens) ?? 0;
      const input = usage?.input_token_details;
      const output = usage?.output_token_details;
      const cached = count(input?.cached_tokens);
      const values = {
        inputText: count(input?.text_tokens), inputAudio: count(input?.audio_tokens),
        cachedText: cached === 0 ? 0 : count(input?.cached_tokens_details?.text_tokens),
        cachedAudio: cached === 0 ? 0 : count(input?.cached_tokens_details?.audio_tokens),
        outputText: count(output?.text_tokens), outputAudio: count(output?.audio_tokens),
      };
      if (!/^gpt-realtime(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ||
          Object.values(values).some(value => value === null) ||
          values.cachedText! + values.cachedAudio! !== cached ||
          values.cachedText! > values.inputText! || values.cachedAudio! > values.inputAudio! ||
          values.inputText! + values.inputAudio! !== count(usage?.input_tokens) ||
          values.outputText! + values.outputAudio! !== count(usage?.output_tokens)) {
        totals.unpricedResponses++;
        return true;
      }
      const known = values as Record<keyof typeof rates, number>;
      for (const key of Object.keys(rates) as Array<keyof typeof rates>) totals[key] += known[key];
      totals.estimatedUsd += (
        (known.inputText - known.cachedText) * rates.inputText +
        (known.inputAudio - known.cachedAudio) * rates.inputAudio +
        known.cachedText * rates.cachedText + known.cachedAudio * rates.cachedAudio +
        known.outputText * rates.outputText + known.outputAudio * rates.outputAudio
      ) / 1_000_000;
      return true;
    },
  };
}

export type LiveUsageRecord = {
  id: string; userId: string; conversationId: number; startedAt: Date;
  connectedAt: Date | null; endedAt: Date | null; status: string;
  usage: LiveUsageTotals;
};
export type LiveUsageStore = {
  save: (record: LiveUsageRecord) => Promise<void>;
  summary: (userId: string) => Promise<import("../shared/live-usage").LiveUsageSummary>;
};
