import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";
import { postToSlack, postAuditDigest } from "@/lib/linkaudit/slack";

// POST — send a test message to the configured Slack webhook. If a completed run exists,
// re-sends its real digest (the truest test); otherwise a simple hello message.
export async function POST() {
  const { data: lastRun } = await supabaseAdmin
    .from("link_audit_runs").select("id").eq("status", "completed")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();

  const res = lastRun
    ? await postAuditDigest(lastRun.id)
    : await postToSlack(":link: *imagine.art link audit* — test message from GenAI Scout. The webhook works; daily digests will arrive here.");

  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true, usedRealDigest: !!lastRun });
}
