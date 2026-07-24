// Run: node scripts/042_negotiation_activity.mjs
// Audit log for the (shared) Negotiation page: who did what on each thread — draft / send / assist /
// handoff / discard by a teammate, and auto-sends by the AI. Everyone sees every thread, so this is
// the attribution trail of every action.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`
  CREATE TABLE IF NOT EXISTS negotiation_activity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    anchor_id uuid,          -- the initial outreach_emails id (thread anchor)
    author_id uuid,
    actor text,              -- who did it: a user's email, or 'ai-autonomy'
    action text,             -- draft | send | assist | handoff | discard
    detail text,
    created_at timestamptz DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS negotiation_activity_anchor_idx ON negotiation_activity (anchor_id, created_at DESC);
`);
console.log("042 done: negotiation_activity table created.");
await c.end();
