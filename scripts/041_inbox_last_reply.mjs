// Run: node scripts/041_inbox_last_reply.mjs
// Track when WE last replied to a person from the inbox, so the "Needs your reply" section doesn't
// keep showing threads we already answered manually (manual inbox replies aren't outreach_emails
// rows, so they were invisible to needs_reply before this).
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`ALTER TABLE inbox_state ADD COLUMN IF NOT EXISTS last_reply_at timestamptz;`);
console.log("041 done: inbox_state.last_reply_at added.");
await c.end();
