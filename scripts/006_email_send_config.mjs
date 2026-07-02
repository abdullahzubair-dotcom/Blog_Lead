// Run: node scripts/006_email_send_config.mjs
// Per-workflow email sending schedule: timezone, daily send window, and spacing
// between messages so outreach drips out naturally instead of blasting all at once.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS email_send_config (
    id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    workflow_id     uuid        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    timezone        text        NOT NULL DEFAULT 'America/New_York',
    send_hour_start integer     NOT NULL DEFAULT 9,   -- 24h, inclusive
    send_hour_end   integer     NOT NULL DEFAULT 17,  -- 24h, exclusive
    gap_minutes     integer     NOT NULL DEFAULT 15,  -- spacing between sends
    daily_cap       integer     NOT NULL DEFAULT 50,  -- max sends per day
    from_name       text,
    from_email      text,
    provider        text        NOT NULL DEFAULT 'smtp' CHECK (provider IN ('smtp', 'blitz')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workflow_id)
  );

  CREATE INDEX IF NOT EXISTS email_send_config_workflow_idx ON email_send_config (workflow_id);
`);

console.log("✓ email_send_config table created");
await client.end();
