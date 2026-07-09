// Create (or replace) an Upstash QStash schedule that pings the send-processor every 30
// minutes, so scheduled emails go out near each recipient's local time. This sidesteps the
// Vercel Hobby "one cron per day" limit.
//
// Prereqs in .env.local:
//   QSTASH_TOKEN   — from console.upstash.com → QStash → "QSTASH_TOKEN"
//   CRON_SECRET    — same secret your deployed app uses (already set)
// Run: node scripts/setup-qstash.mjs https://YOUR-APP.vercel.app
import { Client } from "@upstash/qstash";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const base = process.argv[2] || process.env.APP_URL || process.env.NEXTAUTH_URL;
const token = process.env.QSTASH_TOKEN;
const secret = process.env.CRON_SECRET;

if (!token) { console.error("✗ QSTASH_TOKEN missing in .env.local (console.upstash.com → QStash)"); process.exit(1); }
if (!base) { console.error("✗ Pass your deployed base URL: node scripts/setup-qstash.mjs https://your-app.vercel.app"); process.exit(1); }

const root = base.replace(/\/$/, "");
const client = new Client({ token });
const authHeaders = secret ? { Authorization: `Bearer ${secret}` } : {};

// Two schedules, both on QStash (reliable delivery) rather than Vercel Hobby cron, which is
// best-effort and was silently skipping the daily run:
//   1. send-processor every 30 min (timezone-accurate email delivery + reply/follow-up sweep)
//   2. daily fan-out at 08:00 UTC (broken-link audit + author-watch notifications)
const schedules = [
  { path: "/api/emails/process", cron: "*/30 * * * *", desc: "send-processor every 30 min" },
  { path: "/api/cron/daily", cron: "0 8 * * *", desc: "daily audit + notifications at 08:00 UTC" },
];

for (const { path, cron, desc } of schedules) {
  const destination = `${root}${path}`;
  // Remove any existing schedule for this destination first (idempotent re-run).
  const existing = await client.schedules.list().catch(() => []);
  for (const s of existing) {
    if (s.destination === destination) { await client.schedules.delete(s.scheduleId); console.log(`· removed old schedule ${s.scheduleId}`); }
  }
  const res = await client.schedules.create({ destination, cron, method: "POST", headers: authHeaders });
  console.log(`✓ ${res.scheduleId} — POST ${destination} (${desc})`);
}
console.log(secret ? "  → forwarding Authorization: Bearer <CRON_SECRET>" : "  ⚠ no CRON_SECRET set — endpoints must be open");
