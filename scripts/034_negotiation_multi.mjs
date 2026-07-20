// Run: node scripts/034_negotiation_multi.mjs
// The unique (workflow_id, author_id, kind) constraint caps each kind at one row per author
// per workflow — right for 'initial'/'followup' (dedup), but a negotiation thread has MANY
// back-and-forth 'negotiation' replies. Replace the full constraint with a PARTIAL unique
// index that excludes 'negotiation', so multi-turn negotiation works while initials/followups
// stay deduped. (upsertOutreachEmail switches to check-then-write since it can't use a partial
// index as an ON CONFLICT arbiter.)
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`ALTER TABLE outreach_emails DROP CONSTRAINT IF EXISTS outreach_emails_workflow_author_kind_key;`);
await c.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS outreach_emails_wf_author_kind_partial
    ON outreach_emails (workflow_id, author_id, kind)
    WHERE kind <> 'negotiation';
`);
console.log("034 done."); await c.end();
