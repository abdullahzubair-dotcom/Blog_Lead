// Run: node scripts/021_link_audit.mjs
// Broken-link audit: a daily bot crawls imagine.art's sitemap, reads every link on every
// page, and flags links that 404 (including "soft" 404s — pages that return 200 but are
// really a not-found page). Findings feed a Slack digest + the /link-audit page.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS link_audit_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    status          text NOT NULL DEFAULT 'running',  -- running | completed | failed
    pages_total     int DEFAULT 0,
    pages_checked   int DEFAULT 0,
    links_checked   int DEFAULT 0,
    broken_found    int DEFAULT 0,
    unreachable     int DEFAULT 0,
    error           text,
    slack_posted_at timestamptz
  );
`);

await client.query(`
  CREATE TABLE IF NOT EXISTS link_audit_findings (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id        uuid NOT NULL REFERENCES link_audit_runs(id) ON DELETE CASCADE,
    page_url      text NOT NULL,
    page_author   text,
    link_url      text NOT NULL,
    anchor_text   text,
    context_text  text,
    reason        text NOT NULL,   -- http-404 | http-410 | soft-404 | homepage-redirect
    http_status   int,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, page_url, link_url)
  );
`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_link_findings_run ON link_audit_findings(run_id);`);
console.log("✓ link_audit_runs + link_audit_findings tables");
await client.end();
