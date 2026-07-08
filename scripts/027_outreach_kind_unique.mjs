// Run: node scripts/027_outreach_kind_unique.mjs
// Follow-ups are stored as a second outreach_emails row (kind='followup') for the same
// (workflow_id, author_id). The old UNIQUE(workflow_id, author_id) forbade that. Widen it to
// include kind: one initial + one follow-up per author per workflow (also a DB-level guarantee
// of "only one follow-up per recipient"). All existing rows are kind='initial', so no row can
// violate the new, stricter-per-kind constraint.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Any legacy rows with a NULL kind would break the 3-col unique — normalize first.
await client.query(`UPDATE outreach_emails SET kind = 'initial' WHERE kind IS NULL;`);

await client.query(`ALTER TABLE outreach_emails DROP CONSTRAINT IF EXISTS outreach_emails_workflow_id_author_id_key;`);
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'outreach_emails_workflow_author_kind_key'
    ) THEN
      ALTER TABLE outreach_emails
        ADD CONSTRAINT outreach_emails_workflow_author_kind_key UNIQUE (workflow_id, author_id, kind);
    END IF;
  END $$;
`);

const { rows } = await client.query(`
  SELECT conname FROM pg_constraint
  WHERE conrelid = 'outreach_emails'::regclass AND contype = 'u';
`);
console.log("unique constraints now:", rows.map((r) => r.conname).join(", "));
await client.end();
console.log("027 done.");
