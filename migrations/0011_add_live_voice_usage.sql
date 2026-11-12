CREATE TABLE IF NOT EXISTS live_voice_sessions (
  id text PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id integer REFERENCES conversations(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  connected_at timestamptz,
  ended_at timestamptz,
  status text NOT NULL,
  usage jsonb NOT NULL,
  estimated_usd double precision NOT NULL DEFAULT 0,
  pricing_version text NOT NULL
);
CREATE INDEX IF NOT EXISTS live_voice_sessions_user_started_idx
  ON live_voice_sessions(user_id, started_at);
