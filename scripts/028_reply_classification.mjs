// Run: node scripts/028_reply_classification.mjs
// Classify inbound matches so bounce-backs ("address not found", mailer-daemon) and
// auto-replies stop being counted as real replies, and store the content so it's readable.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS reply_kind text;`);        // reply | bounce | auto
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS reply_from text;`);
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS reply_subject text;`);
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS reply_excerpt text;`);
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS bounced_at timestamptz;`);  // set when the address bounced

console.log("028 done.");
await client.end();
