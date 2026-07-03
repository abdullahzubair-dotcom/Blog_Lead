// Run: node scripts/011_user_email_config.mjs
// Per-user sending: each logged-in user sends from their OWN Gmail via their own app
// password, with their own schedule. app_password is stored ENCRYPTED (AES-256-GCM).
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`
  CREATE TABLE IF NOT EXISTS user_email_config (
    user_email       text PRIMARY KEY,
    app_password_enc text,                         -- encrypted Gmail app password
    from_name        text,
    timezone         text NOT NULL DEFAULT 'America/New_York',
    send_hour_start  int  NOT NULL DEFAULT 9,
    send_hour_end    int  NOT NULL DEFAULT 17,
    gap_minutes      int  NOT NULL DEFAULT 15,
    daily_cap        int  NOT NULL DEFAULT 50,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
  );
`);
// Which user's mailbox each outreach email is sent from.
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS sender_email text;`);
console.log("✓ user_email_config table + outreach_emails.sender_email added");
await client.end();
