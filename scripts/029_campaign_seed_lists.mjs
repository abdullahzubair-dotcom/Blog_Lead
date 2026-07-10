// Run: node scripts/029_campaign_seed_lists.mjs
// Let a campaign carry LISTS of sites and articles to outreach (not just one seed writer).
// Discovery harvests authors from these on top of keyword search.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS seed_domains text[] NOT NULL DEFAULT '{}';`);      // sites to mine
await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS seed_article_urls text[] NOT NULL DEFAULT '{}';`); // specific article URLs

console.log("029 done.");
await client.end();
