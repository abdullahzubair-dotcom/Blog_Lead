// Run: node scripts/022_link_audit_location_hint.mjs
// Stores the AI-written "where exactly is this link on the page" explanation per finding,
// so both the /link-audit page and the Slack digest show it (computed once at run finalize).
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE link_audit_findings ADD COLUMN IF NOT EXISTS location_hint text;`);
console.log("✓ link_audit_findings.location_hint column added");
await client.end();
