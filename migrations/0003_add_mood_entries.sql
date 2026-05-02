CREATE TABLE "mood_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" integer,
	"phase" text NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mood_entries" ADD CONSTRAINT "mood_entries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mood_entries_user_created_idx" ON "mood_entries" USING btree ("user_id","created_at");