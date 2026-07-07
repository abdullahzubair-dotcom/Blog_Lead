// Run: node scripts/023_link_audit_occurrences.mjs
// Per-occurrence structural data for each broken link (zone: nav/footer/section + nearest
// heading + anchor), so "where is this link" is derived from the DOM, not guessed from a
// text window. Also lets unreachable links be stored (reason='unreachable') for the
// digest's "couldn't verify" list.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE link_audit_findings ADD COLUMN IF NOT EXISTS occurrences jsonb;`);
console.log("✓ link_audit_findings.occurrences column added");
await client.end();
