CREATE TABLE IF NOT EXISTS "user_memories" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "text" text NOT NULL,
  "source_conversation_id" integer,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "user_memories_source_conversation_id_conversations_id_fk"
    FOREIGN KEY ("source_conversation_id") REFERENCES "conversations"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "user_memories_user_id_idx" ON "user_memories" ("user_id");
