// Run: node scripts/032_indexing_reports.mjs
// Persists Indexing & Core Web Vitals scan history (additive — new tables only, nothing
// existing touched). One row per run with the full report as JSONB (mirrors
// enrichment_runs' `people jsonb` pattern), plus a dispatch log for live PR/ticket/Slack
// actions taken against a run's routing previews.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS indexing_runs (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    target                text        NOT NULL,
    started_at            timestamptz NOT NULL,
    finished_at           timestamptz NOT NULL,
    duration_ms           integer     NOT NULL DEFAULT 0,
    limit_requested       integer     NOT NULL DEFAULT 0,
    discovered            integer     NOT NULL DEFAULT 0,
    analyzed              integer     NOT NULL DEFAULT 0,
    templates_count       integer     NOT NULL DEFAULT 0,
    issues_count          integer     NOT NULL DEFAULT 0,
    p0_count              integer     NOT NULL DEFAULT 0,
    js_gated_count        integer     NOT NULL DEFAULT 0,
    playwright_enabled    boolean     NOT NULL DEFAULT false,
    pagespeed_key_present boolean     NOT NULL DEFAULT false,
    report                jsonb       NOT NULL,
    created_by            text,
    created_at            timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS indexing_runs_created_idx ON indexing_runs (created_at DESC);
`);

await client.query(`
  CREATE TABLE IF NOT EXISTS indexing_dispatches (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id       uuid        REFERENCES indexing_runs(id) ON DELETE CASCADE,
    kind         text        NOT NULL,   -- pr | ticket | slack
    reason       text,
    title        text        NOT NULL,
    target_ref   text,                  -- PR url / ticket url
    status       text        NOT NULL,  -- ok | error
    error        text,
    dispatched_by text,
    created_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS indexing_dispatches_run_idx ON indexing_dispatches (run_id);
`);

console.log("✓ indexing_runs + indexing_dispatches tables");
await client.end();
