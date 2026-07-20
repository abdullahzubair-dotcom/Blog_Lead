// Run: node scripts/035_handbook_controls.mjs
// Extra negotiation-handbook controls the user drives from the Email Handbook page:
//   aggressiveness  - how hard/fast the AI pushes and concedes
//   opening_percent - where in the [floor..ceiling] range the AI opens
//   style_rules     - hard writing rules for every generated email (e.g. no em dashes)
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`ALTER TABLE negotiation_settings ADD COLUMN IF NOT EXISTS aggressiveness text DEFAULT 'balanced';`);
await c.query(`ALTER TABLE negotiation_settings ADD COLUMN IF NOT EXISTS opening_percent int DEFAULT 40;`);
await c.query(`ALTER TABLE negotiation_settings ADD COLUMN IF NOT EXISTS style_rules text DEFAULT 'Plain text only. Never use em dashes or en dashes; use commas or periods instead. No bracketed placeholders. Keep it short and human.';`);
console.log("035 done."); await c.end();
