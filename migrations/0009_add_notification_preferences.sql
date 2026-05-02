ALTER TABLE "users"
  ADD COLUMN "reminder_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "reminder_time" text NOT NULL DEFAULT '20:00',
  ADD COLUMN "weekly_summary_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "weekly_summary_day" integer NOT NULL DEFAULT 0,
  ADD COLUMN "weekly_summary_time" text NOT NULL DEFAULT '19:00';
