// Run: node scripts/010_contacted_override.mjs
// Manual override for an author's "contacted" state, toggled from the prospect drawer.
//   NULL  = derive from outreach history (default)
//   true  = force "contacted" (never email again)
//   false = force "not contacted" (email them again, even if previously sent)
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE authors ADD COLUMN IF NOT EXISTS contacted_override boolean;`);
console.log("✓ authors.contacted_override column added");
await client.end();
