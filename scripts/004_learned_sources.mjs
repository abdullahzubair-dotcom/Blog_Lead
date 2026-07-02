// Run: node scripts/004_learned_sources.mjs
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS learned_sources (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    type        text        NOT NULL CHECK (type IN ('subreddit', 'domain', 'rss_feed')),
    value       text        NOT NULL,
    score       numeric     NOT NULL DEFAULT 0,
    times_seen  integer     NOT NULL DEFAULT 1,
    promoted    boolean     NOT NULL DEFAULT false,
    rejected    boolean     NOT NULL DEFAULT false,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (type, value)
  );

  CREATE INDEX IF NOT EXISTS learned_sources_type_idx ON learned_sources (type);
  CREATE INDEX IF NOT EXISTS learned_sources_promoted_idx ON learned_sources (promoted);
`);

console.log("✓ learned_sources table created");
await client.end();
