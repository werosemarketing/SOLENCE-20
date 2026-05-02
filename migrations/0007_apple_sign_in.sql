ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apple_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_apple_user_id_unique" ON "users" USING btree ("apple_user_id");
