import { openai } from "./replit_integrations/audio";

export const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Embed a single piece of text. Returns null on any failure so callers can
 * degrade gracefully (store the row without an embedding, fall back to
 * recency-based retrieval, etc.).
 */
export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: trimmed,
    });
    return response.data[0]?.embedding ?? null;
  } catch (error) {
    console.error("Embedding error:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Embed a batch of texts in one API call. Returns an array aligned with the
 * input; null entries where embedding failed. Returns all-null on API failure.
 */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const cleaned = texts.map((t) => t.trim());
  if (cleaned.length === 0) return [];
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleaned,
    });
    // API preserves input order via the `index` field.
    const out: (number[] | null)[] = new Array(cleaned.length).fill(null);
    for (const item of response.data) {
      out[item.index] = item.embedding;
    }
    return out;
  } catch (error) {
    console.error("Batch embedding error:", error instanceof Error ? error.message : error);
    return texts.map(() => null);
  }
}

/** Cosine similarity between two equal-length vectors. Returns 0 on mismatch. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
