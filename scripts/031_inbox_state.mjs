// Run: node scripts/031_inbox_state.mjs
// Per-user inbox state: last time they opened a person's thread (for unread) + dismissed flag.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`
  CREATE TABLE IF NOT EXISTS inbox_state (
    user_email   text NOT NULL,
    author_id    uuid NOT NULL,
    last_seen_at timestamptz,
    dismissed    boolean NOT NULL DEFAULT false,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_email, author_id)
  );
  CREATE INDEX IF NOT EXISTS inbox_state_user_idx ON inbox_state (user_email);
`);
console.log("031 done."); await c.end();
