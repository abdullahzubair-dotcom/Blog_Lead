// Run: node scripts/005_template_guidance.mjs
// Adds an optional "guidance" column to email_templates — free-text writing direction
// that steers the AI-generated {{custom_line}} opener (tone, angle, what to emphasize).
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS guidance text;
`);

console.log("✓ email_templates.guidance column added");
await client.end();
