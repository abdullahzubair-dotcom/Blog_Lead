// Run: node scripts/038_recipient_override.mjs
// Admin test-send: route a scheduled email to a chosen address instead of the prospect's real
// mailto (send FROM any team inbox, TO your test inbox), without touching real prospect data.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS recipient_override text;`);
console.log("038 done."); await c.end();
