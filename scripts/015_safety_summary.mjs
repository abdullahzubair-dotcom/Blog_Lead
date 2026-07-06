// Run: node scripts/015_safety_summary.mjs
// Adds a human-readable safety_summary column so an author's score can be understood
// without opening each flagged article.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE authors ADD COLUMN IF NOT EXISTS safety_summary text;`);
console.log("✓ authors.safety_summary column added");
await client.end();
