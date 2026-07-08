// Run: node scripts/026_replies_followups_success.mjs
// Reply detection (IMAP), auto follow-ups, success/ROI tracking, and author discard.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// ── Reply detection: store the RFC Message-ID we send with, to thread replies via IMAP ──
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS message_id text;`);
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS reply_checked_at timestamptz;`);

// ── Auto follow-ups: a follow-up is its own row (kind='followup') pointing at the parent ──
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'initial';`); // initial | followup
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES outreach_emails(id) ON DELETE SET NULL;`);
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS followup_skipped boolean NOT NULL DEFAULT false;`); // per-email safety valve

// ── Success / ROI: mark that a sent email led to real coverage ──
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS success_at timestamptz;`);
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS success_link text;`);
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS success_notes text;`);

await client.query(`CREATE INDEX IF NOT EXISTS idx_outreach_status_sentat ON outreach_emails(status, sent_at DESC);`);

// ── Author discard: exclude from all workflows ──
await client.query(`ALTER TABLE authors ADD COLUMN IF NOT EXISTS discarded boolean NOT NULL DEFAULT false;`);

console.log("✓ outreach_emails: message_id, reply_checked_at, kind, parent_id, followup_skipped, success_at/link/notes");
console.log("✓ authors.discarded");
await client.end();
