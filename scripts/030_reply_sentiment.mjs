// Run: node scripts/030_reply_sentiment.mjs
// Store sentiment of a genuine reply (positive|neutral|negative) so the inbox list can show it.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS reply_sentiment text;`);
console.log("030 done."); await c.end();
