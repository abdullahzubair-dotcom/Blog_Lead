// Run: node scripts/020_shared_sender_admin.mjs
// Makes shared sending identities (e.g. Zain) manageable from Admin instead of hardcoded —
// reuses user_email_config (same table every per-user Gmail config already lives in).
// shared_sender_label non-null marks a row as a shared-sender candidate; enabled toggles
// whether it's currently offered in the "Send from" picker.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE user_email_config ADD COLUMN IF NOT EXISTS shared_sender_label text;`);
await client.query(`ALTER TABLE user_email_config ADD COLUMN IF NOT EXISTS shared_sender_enabled boolean NOT NULL DEFAULT true;`);
// Migrate the one hardcoded shared sender (Zain) into the DB-driven list.
await client.query(
  `UPDATE user_email_config SET shared_sender_label = 'Zain', shared_sender_enabled = true WHERE user_email = 'zain.abedien@imagine.art'`
);
console.log("✓ shared_sender_label/shared_sender_enabled columns added; Zain migrated in");
await client.end();
