export type LiveUsageTotals = {
  responses: number;
  unpricedResponses: number;
  reportedInputTokens: number;
  reportedOutputTokens: number;
  inputText: number;
  inputAudio: number;
  cachedText: number;
  cachedAudio: number;
  outputText: number;
  outputAudio: number;
  transcriptionInput: number;
  transcriptionOutput: number;
  estimatedUsd: number;
};

export type LiveUsageSummary = {
  calls: number;
  durationSeconds: number;
  responses: number;
  estimatedUsd: number;
  incompleteCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latest: Array<{
    id: string; startedAt: string; durationSeconds: number;
    status: string; responses: number; estimatedUsd: number; incomplete: boolean; usage: LiveUsageTotals;
  }>;
};

export const LIVE_USAGE_COST_NOTICE =
  "Estimate for reported gpt-realtime usage only, not an OpenAI invoice. Transcription, previews, and reflection generation are billed separately. Usage can lag until a response finishes. Earlier tests are not included.";
