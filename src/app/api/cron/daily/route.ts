import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@auth";

export const maxDuration = 300;

// Vercel Hobby allows only 2 cron jobs, so this single daily entry fans out to every
// once-a-day task: the author-watch notifications check and the broken-link audit.
// Each target endpoint keeps its own lock/auth/chunking — this just triggers them with
// the same CRON_SECRET convention the external caller would use.
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  const session = await auth().catch(() => null);
  return !!session;
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const secret = process.env.CRON_SECRET ?? "";
  if (!base) return NextResponse.json({ error: "APP_URL/NEXTAUTH_URL not set" }, { status: 500 });
  const hit = (path: string) =>
    fetch(`${base}${path}?key=${encodeURIComponent(secret)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

  // Link audit start returns fast (work continues via after()+QStash in its own function).
  const audit = await hit("/api/link-audit/run").then((r) => r.json()).catch((e) => ({ error: e?.message }));

  // Daily email finding — dig out emails for any authors still missing one (only_new keeps it
  // to authors never searched, so it doesn't re-spend credits on the same people every day).
  const finder = await fetch(`${base}/api/enrich/run?key=${encodeURIComponent(secret)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ only_new: true }),
  }).then((r) => r.json()).catch((e) => ({ error: e?.message }));

  // Notifications check does its work inside the request — run it post-response so this
  // cron returns quickly; Vercel keeps the function alive for after() work.
  after(async () => { await hit("/api/notifications/check").catch(() => {}); });

  return NextResponse.json({ ok: true, audit, finder, notifications: "triggered" });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
