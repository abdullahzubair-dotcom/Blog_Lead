// Run: node scripts/009_enrichment_runs.mjs
// Stores each Email Finder run (per-person steps + results) so it can be reopened later
// and shown with the exact same activity UI.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`
  CREATE TABLE IF NOT EXISTS enrichment_runs (
    id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id   text,
    campaign_name text,
    total         integer     NOT NULL DEFAULT 0,
    done          integer     NOT NULL DEFAULT 0,
    found         integer     NOT NULL DEFAULT 0,
    by_source     jsonb       NOT NULL DEFAULT '{}',
    people        jsonb       NOT NULL DEFAULT '[]',
    started_at    timestamptz,
    finished_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS enrichment_runs_finished_idx ON enrichment_runs (finished_at DESC);
`);
console.log("✓ enrichment_runs table created");
await client.end();
