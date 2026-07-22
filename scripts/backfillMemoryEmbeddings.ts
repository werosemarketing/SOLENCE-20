/**
 * One-time backfill: compute text-embedding-3-small embeddings for any
 * user_memories rows that don't have one yet.
 *
 * Run with: npx tsx scripts/backfillMemoryEmbeddings.ts
 * Idempotent — only touches rows where embedding IS NULL.
 */
import { db } from "../server/db";
import { userMemories } from "../shared/schema";
import { embedTexts } from "../server/embeddings";
import { eq, isNull } from "drizzle-orm";

const BATCH_SIZE = 100;

async function main() {
  const rows = await db
    .select({ id: userMemories.id, text: userMemories.text })
    .from(userMemories)
    .where(isNull(userMemories.embedding));

  console.log(`Found ${rows.length} memory rows without embeddings`);
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const embeddings = await embedTexts(batch.map((r) => r.text));
    for (let j = 0; j < batch.length; j++) {
      const embedding = embeddings[j];
      if (!embedding) {
        console.warn(`Skipping row ${batch[j].id}: embedding failed`);
        continue;
      }
      await db
        .update(userMemories)
        .set({ embedding })
        .where(eq(userMemories.id, batch[j].id));
      updated++;
    }
    console.log(`Progress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  console.log(`Done. Updated ${updated}/${rows.length} rows.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
