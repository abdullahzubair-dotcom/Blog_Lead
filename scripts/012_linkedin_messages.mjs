// Run: node scripts/012_linkedin_messages.mjs
// LinkedIn connection-note generation: personalized short notes per workflow prospect,
// generated (not sent) so the user copies them into LinkedIn. Templates gain a channel.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`
  CREATE TABLE IF NOT EXISTS linkedin_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id uuid NOT NULL,
    author_id   uuid NOT NULL,
    template_id uuid,
    body        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workflow_id, author_id)
  );
`);
// Templates can target email or linkedin.
await client.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';`);
console.log("✓ linkedin_messages table + email_templates.channel added");
await client.end();
