ALTER TABLE "conversations" ADD COLUMN "reflection_summary" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "reflection_takeaway" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "reflection_generated_at" timestamp;
