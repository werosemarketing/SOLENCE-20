ALTER TABLE "users" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by" varchar;--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_unique" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE TABLE "referral_credits" (
"id" serial PRIMARY KEY NOT NULL,
"user_id" text NOT NULL,
"source" text NOT NULL,
"referral_user_id" text,
"starts_at" timestamp NOT NULL,
"ends_at" timestamp NOT NULL,
"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "referral_credits_user_ends_idx" ON "referral_credits" USING btree ("user_id","ends_at");
