import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";
import { postToSlack, postAuditDigest, getSlackMap } from "@/lib/linkaudit/slack";

// POST — send a test message to the configured Slack webhook. If a completed run exists,
// re-sends its real digest (the truest test); otherwise a simple hello message. Any mapped
// author IDs get a tag-test line so real pings can be verified in one click — Slack
// silently DELETES mentions with invalid IDs, so a visible blue @mention proves the ID.
export async function POST() {
  const { data: lastRun } = await supabaseAdmin
    .from("link_audit_runs").select("id").eq("status", "completed")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();

  const res = lastRun
    ? await postAuditDigest(lastRun.id)
    : await postToSlack(":link: *imagine.art link audit* — test message from GenAI Scout. The webhook works; daily digests will arrive here.");
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 500 });

  const map = await getSlackMap();
  const entries = Object.entries(map).slice(0, 5);
  if (entries.length > 0) {
    await postToSlack(
      `:label: *Tag test* — each mapped author should appear as a blue @mention (if a name shows blank, its member ID is wrong):\n${entries.map(([name, id]) => `• ${name} → <@${id}>`).join("\n")}`
    );
  }

  return NextResponse.json({ ok: true, usedRealDigest: !!lastRun, tagTestSent: entries.length });
}
