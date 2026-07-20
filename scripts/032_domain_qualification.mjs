// Run: node scripts/032_domain_qualification.mjs
// Qualification metrics per domain, from the Outreach Requirement sheet's 4 filters:
//   1. DR >= 50            -> `dr` (real Ahrefs Domain Rating, free endpoint, 0 units)
//   2. organic traffic     -> `organic_traffic` (null = unverified; filled by Ahrefs/Semrush later)
//   3. USA majority > 50%  -> `us_traffic_share` (0-100 %, null = unverified)
//   4. relevancy           -> computed per-author from keyword/mention signals (no column needed)
// dr_proxy_score (the old heuristic) is kept separate and untouched.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`ALTER TABLE domains ADD COLUMN IF NOT EXISTS dr numeric;`);
await c.query(`ALTER TABLE domains ADD COLUMN IF NOT EXISTS dr_checked_at timestamptz;`);
await c.query(`ALTER TABLE domains ADD COLUMN IF NOT EXISTS organic_traffic bigint;`);
await c.query(`ALTER TABLE domains ADD COLUMN IF NOT EXISTS us_traffic_share numeric;`);
await c.query(`ALTER TABLE domains ADD COLUMN IF NOT EXISTS traffic_checked_at timestamptz;`);
await c.query(`ALTER TABLE domains ADD COLUMN IF NOT EXISTS metrics_source text;`);
await c.query(`CREATE INDEX IF NOT EXISTS idx_domains_dr ON domains(dr);`);
console.log("032 done."); await c.end();
