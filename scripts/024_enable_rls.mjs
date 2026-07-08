// Run: node scripts/024_enable_rls.mjs
// Enables Row Level Security on GenAI Scout's OWN tables only (strict allowlist — this
// Supabase hosts other projects' tables too, which are deliberately left untouched).
//
// Safe for this app by construction:
//   - Every app query goes through supabaseAdmin (service role) which BYPASSES RLS.
//   - Every script goes through DATABASE_URL as the postgres role, which owns the tables
//     and therefore bypasses RLS (we do NOT set FORCE ROW LEVEL SECURITY).
//   - The anon-key client is exported but never used; auth is NextAuth, not Supabase Auth.
// Net effect: nothing changes for the app; the public anon key (which ships in the
// browser bundle) can no longer read/write these tables through PostgREST.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

// Every table this app has ever created (migrations/001 + scripts/004-023 + the
// dashboard-created campaign/workflow/email tables referenced in src/lib/db/queries.ts).
const OUR_TABLES = [
  // 001_initial
  "domains", "authors", "articles", "article_authors", "contacts", "mentions", "links",
  "discovery_hits", "scores", "suppression", "seed_tools", "pipeline_runs", "harvester_config",
  // dashboard-created, used throughout queries.ts
  "campaigns", "campaign_authors", "workflows", "workflow_prospects",
  "email_templates", "outreach_emails", "email_send_config",
  // scripts/004-023
  "learned_sources", "enrichment_runs", "user_email_config", "linkedin_messages",
  "flagged_content", "author_watches", "author_watch_notifications",
  "link_audit_runs", "link_audit_findings",
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: existing } = await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
);
const existingSet = new Set(existing.map((r) => r.tablename));

let enabled = 0, already = 0, missing = 0;
for (const t of OUR_TABLES) {
  if (!existingSet.has(t)) { console.log(`  (skip — not found: ${t})`); missing++; continue; }
  const { rows } = await client.query(
    `SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass`, [t]
  );
  if (rows[0]?.relrowsecurity) { already++; continue; }
  await client.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
  console.log(`  ✓ RLS enabled: ${t}`);
  enabled++;
}

console.log(`\nDone: ${enabled} enabled, ${already} already had RLS, ${missing} not found.`);
console.log(`Untouched (other projects' tables remain as they were):`);
const ours = new Set(OUR_TABLES);
for (const r of existing) if (!ours.has(r.tablename)) console.log(`  - ${r.tablename}`);
await client.end();
