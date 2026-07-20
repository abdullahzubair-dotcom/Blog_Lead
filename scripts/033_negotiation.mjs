// Run: node scripts/033_negotiation.mjs
// AI negotiation: a singleton settings/handbook row (editable prompt, tone, thread length,
// min price, anti-highball, DR/traffic-based pricing tiers, and the master autonomy toggle),
// plus per-thread negotiation state on outreach_emails.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`
  CREATE TABLE IF NOT EXISTS negotiation_settings (
    id boolean PRIMARY KEY DEFAULT true,
    ai_autonomy boolean NOT NULL DEFAULT false,      -- OFF = AI drafts for human approval; ON = AI sends itself
    handbook text,                                   -- the negotiation brief / criteria the model follows
    tone text DEFAULT 'Warm, concise, human, professional. Never pushy or robotic.',
    max_thread_length int DEFAULT 4,                 -- max back-and-forth messages the AI will send before escalating
    min_price numeric DEFAULT 0,                     -- floor: never offer/accept below this
    currency text DEFAULT 'USD',
    anti_highball text DEFAULT 'If they open very high, do not anchor to it. Acknowledge, restate our value, come back near our tier ceiling, and move in small steps.',
    pricing_rules jsonb DEFAULT '[{"min_dr":50,"min_traffic":10000,"min_us_share":50,"max_offer":150,"label":"DR 50+ & 10k US traffic"}]'::jsonb,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT negotiation_settings_singleton CHECK (id)
  );
`);
// Seed the singleton row with a sensible default handbook if empty.
await c.query(`
  INSERT INTO negotiation_settings (id, handbook)
  VALUES (true, $1)
  ON CONFLICT (id) DO NOTHING;
`, [
  "Goal: get ImagineArt (an AI image/video generation tool) featured or included in the writer's article, roundup, or list. " +
  "Be genuinely helpful and specific about why ImagineArt fits their coverage. Negotiate placement and, if they ask for payment, " +
  "price using the pricing tiers (based on the site's Domain Rating + US traffic). Start at the low end of the range and move up " +
  "in small steps only if needed, never above the tier ceiling or below the floor. Keep it human and short. If they clearly decline, " +
  "thank them warmly and stop."
]);

await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS ai_managed boolean NOT NULL DEFAULT false;`);
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS negotiation_status text;`); // negotiating|agreed|declined|stalled|auto|blocked
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS agreed_price numeric;`);
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS max_offer numeric;`);      // per-thread ceiling (from a pricing tier or an override)
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS negotiation_notes text;`);
await c.query(`CREATE INDEX IF NOT EXISTS idx_outreach_ai_managed ON outreach_emails(ai_managed) WHERE ai_managed;`);

console.log("033 done."); await c.end();
