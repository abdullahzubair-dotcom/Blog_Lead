// Run: node scripts/036_payments.mjs
// Payment tracking on the negotiation anchor (the initial outreach row), plus a one-time
// reset of the negotiation settings to LOWBALL defaults (open low, pay the least).
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS payment_status text;`); // null | owed | requested | paid
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS paid_at timestamptz;`);
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS payment_requested_at timestamptz;`);
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS paid_amount numeric;`);
await c.query(`CREATE INDEX IF NOT EXISTS idx_outreach_payment ON outreach_emails(payment_status) WHERE payment_status IS NOT NULL;`);

// Lowball defaults on the live settings row (idempotent; the Handbook page can still override).
await c.query(`
  UPDATE negotiation_settings
     SET aggressiveness = 'firm',
         opening_percent = 20,
         handbook = 'Goal: get ImagineArt (an AI image/video generation tool) featured or included in the writer''s article, roundup, or list. ALWAYS aim to pay the LEAST possible. Prefer a free or editorial inclusion, and only offer money if they clearly require it. When you do offer, open LOW, concede slowly in small steps, and never jump to the tier ceiling (that is a hard cap, not a target). Be genuinely helpful and specific about why ImagineArt fits their coverage. Keep it human and short. If they clearly decline, thank them and stop.'
   WHERE id = true;
`);
console.log("036 done."); await c.end();
