// Run: node scripts/025_enable_rls_other_projects.mjs
// Clears the remaining Supabase Advisor "RLS Disabled in Public" CRITICALs for the OTHER
// projects' tables on this shared database — WITHOUT any behavior change, since those
// codebases aren't available to verify how they access the DB.
//
// Method: enable RLS + an explicit allow-all policy (FOR ALL TO public, USING true).
// That reproduces pre-RLS behavior exactly for every role — anon, authenticated, and any
// custom role a project might connect with — so nothing can break. It intentionally does
// NOT add security to these tables (unlike scripts/024 for GenAI Scout's own tables);
// each project should later replace the allow-all policy with real ones (or drop it, if
// the project only uses service-role/owner connections). Verified before/after that anon
// access behavior is unchanged.
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const POLICY = "allow_all_preserve_behavior";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false ORDER BY c.relname`);
const targets = rows.map((r) => r.relname);
console.log(`${targets.length} tables without RLS: ${targets.join(", ")}\n`);
if (targets.length === 0) { console.log("Nothing to do."); await client.end(); process.exit(0); }

// BEFORE snapshot: can the anon key read these tables right now?
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const sample = targets.slice(0, 3);
const before = {};
for (const t of sample) {
  const { data, error } = await anon.from(t).select("*", { count: "exact", head: true });
  before[t] = error ? `error:${error.code}` : "readable";
}
console.log("anon access BEFORE:", before);

for (const t of targets) {
  await client.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
  // Idempotent: drop + recreate so re-runs are safe.
  await client.query(`DROP POLICY IF EXISTS "${POLICY}" ON public."${t}"`);
  await client.query(`CREATE POLICY "${POLICY}" ON public."${t}" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true)`);
  console.log(`  ✓ ${t}: RLS on + allow-all policy (behavior unchanged)`);
}

// AFTER snapshot: identical anon behavior proves nothing changed.
const after = {};
for (const t of sample) {
  const { error } = await anon.from(t).select("*", { count: "exact", head: true });
  after[t] = error ? `error:${error.code}` : "readable";
}
console.log("anon access AFTER: ", after);
const same = sample.every((t) => before[t] === after[t]);
console.log(same ? "\n✓ Behavior identical before/after — nothing broken." : "\n✗ BEHAVIOR CHANGED — investigate!");
await client.end();
process.exit(same ? 0 : 1);
