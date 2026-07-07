import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";

// GET — findings for a run (?run_id=), defaulting to the most recent completed run.
export async function GET(req: NextRequest) {
  let runId = req.nextUrl.searchParams.get("run_id");
  if (!runId) {
    const { data } = await supabaseAdmin
      .from("link_audit_runs").select("id").eq("status", "completed")
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    runId = data?.id ?? null;
  }
  if (!runId) return NextResponse.json({ runId: null, findings: [] });

  const { data: findings } = await supabaseAdmin
    .from("link_audit_findings").select("*").eq("run_id", runId)
    .order("link_url").limit(500);
  return NextResponse.json({ runId, findings: findings ?? [] });
}
