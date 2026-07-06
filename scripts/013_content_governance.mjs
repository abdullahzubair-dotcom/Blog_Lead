// Run: node scripts/013_content_governance.mjs
// Additive schema for three features: author safety screening, author-watch
// notifications, and writer/article-seeded discovery campaigns.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// ── Safety screening ────────────────────────────────────────────────────────
await client.query(`ALTER TABLE authors ADD COLUMN IF NOT EXISTS safety_score numeric(5,2) DEFAULT 100;`);
await client.query(`ALTER TABLE authors ADD COLUMN IF NOT EXISTS safety_checked_at timestamptz;`);
await client.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS safety_checked_at timestamptz;`);
await client.query(`
  CREATE TABLE IF NOT EXISTS flagged_content (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id   uuid REFERENCES authors(id) ON DELETE CASCADE,
    article_id  uuid REFERENCES articles(id) ON DELETE CASCADE,
    category    text NOT NULL,   -- nsfw | hate_violence_illegal | political_controversy
    severity    text NOT NULL,   -- low | medium | high
    reason      text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (article_id)
  );
`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_flagged_content_author ON flagged_content(author_id);`);
console.log("✓ safety_score/safety_checked_at columns + flagged_content table");

// ── Author-watch notifications ──────────────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS author_watches (
    user_email      text NOT NULL,
    author_id       uuid NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_checked_at timestamptz,
    PRIMARY KEY (user_email, author_id)
  );
`);
await client.query(`
  CREATE TABLE IF NOT EXISTS author_watch_notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email  text NOT NULL,
    author_id   uuid NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    article_id  uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    read_at     timestamptz,
    emailed_at  timestamptz,
    UNIQUE (user_email, article_id)
  );
`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_watch_notif_user ON author_watch_notifications(user_email, created_at DESC);`);
console.log("✓ author_watches + author_watch_notifications tables");

// ── Writer/article-seeded campaigns ─────────────────────────────────────────
await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS seed_writer_name text;`);
await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS seed_article_url text;`);
console.log("✓ campaigns.seed_writer_name / seed_article_url columns");

await client.end();
