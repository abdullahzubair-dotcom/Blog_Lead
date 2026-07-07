// Run: node scripts/019_shared_sender_attribution.mjs
// Supports sending "as" a shared inbox (e.g. Zain's) while still tracking who actually
// initiated the send — sender_email becomes the identity that technically sends the mail
// (whichever Gmail's SMTP credentials are used), sent_by_email is the original user who
// clicked Send.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS sent_by_email text;`);
console.log("✓ outreach_emails.sent_by_email column added");
await client.end();
