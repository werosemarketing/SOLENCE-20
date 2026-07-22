-- Add nullable jsonb embedding column for similarity-based memory retrieval
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "embedding" jsonb;
