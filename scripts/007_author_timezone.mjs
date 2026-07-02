// Run: node scripts/007_author_timezone.mjs
// Cache each author's inferred IANA timezone so scheduling can send at their local time.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`ALTER TABLE authors ADD COLUMN IF NOT EXISTS timezone text;`);
console.log("✓ authors.timezone column added");
await client.end();
