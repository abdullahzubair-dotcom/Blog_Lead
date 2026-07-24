// Run: node scripts/040_negotiation_human_intervention.mjs
// Human-intervention on the negotiation agent: when a writer asks for something the AI cannot do
// (send a doc, jump on a call, redirect, sign a contract, answer a factual question, etc.), the
// thread is flagged needs_human instead of auto-drafting a hollow reply. These columns hold the
// detected ask + the human-supplied assist input (and an optional uploaded document to attach).
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`
  ALTER TABLE outreach_emails
    ADD COLUMN IF NOT EXISTS intervention_type text,
    ADD COLUMN IF NOT EXISTS intervention_reason text,
    ADD COLUMN IF NOT EXISTS intervention_ask text,
    ADD COLUMN IF NOT EXISTS intervention_assist_input text,
    ADD COLUMN IF NOT EXISTS intervention_at timestamptz,
    ADD COLUMN IF NOT EXISTS intervention_asset_name text,
    ADD COLUMN IF NOT EXISTS intervention_asset_mime text,
    ADD COLUMN IF NOT EXISTS intervention_asset_b64 text;
  CREATE INDEX IF NOT EXISTS idx_outreach_needs_human ON outreach_emails (negotiation_status) WHERE negotiation_status = 'needs_human';
`);
console.log("040 done: negotiation human-intervention columns added.");
await c.end();
