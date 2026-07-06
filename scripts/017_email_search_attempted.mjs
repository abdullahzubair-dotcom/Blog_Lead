// Run: node scripts/017_email_search_attempted.mjs
// Tracks whether the email finder has ever attempted an author before, independent of
// whether it found anything — lets the finder target only brand-new authors instead of
// repeatedly re-trying known failures (which just wastes Blitz/Hunter/Reoon API calls).
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE authors ADD COLUMN IF NOT EXISTS email_search_attempted_at timestamptz;`);
console.log("✓ authors.email_search_attempted_at column added");
await client.end();
