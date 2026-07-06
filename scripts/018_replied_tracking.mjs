// Run: node scripts/018_replied_tracking.mjs
// Manual "did they reply?" tracking on outreach emails — there's no inbox integration, so
// this is a checkbox the user toggles themselves. Powers the reply-rate stat on /sending.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS replied_at timestamptz;`);
console.log("✓ outreach_emails.replied_at column added");
await client.end();
