import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";
import { getBuffer, isRunning } from "@/lib/pipeline/eventBuffer";

export async function GET() {
  const bufferAlive = isRunning();

  const { data: runs } = await supabaseAdmin
    .from("pipeline_runs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1);

  let activeRun = runs?.[0] ?? null;

  // Auto-close any DB run that the in-process buffer has no knowledge of —
  // means the process restarted, crashed, or the run was stopped without writing "completed".
  if (activeRun && !bufferAlive) {
    await supabaseAdmin
      .from("pipeline_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: "Auto-closed: process restarted or pipeline stopped" })
      .eq("id", activeRun.id);
    activeRun = null;
  }

  // Live counts from DB — source of truth regardless of SSE state
  const [totRow, procRow, authRow] = await Promise.all([
    supabaseAdmin.from("discovery_hits").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("discovery_hits").select("id", { count: "exact", head: true }).eq("processed", true),
    supabaseAdmin.from("authors").select("id", { count: "exact", head: true }),
  ]);

  const buffer = getBuffer();

  return NextResponse.json({
    isRunning: isRunning() || !!activeRun,
    activeRun,
    totalHits: totRow.count ?? 0,
    processedHits: procRow.count ?? 0,
    totalAuthors: authRow.count ?? 0,
    // Replay buffered events if available (survives browser refresh)
    bufferedEvents: buffer ? buffer.events.slice(-200) : [],
    bufferRunId: buffer?.runId ?? null,
    elapsedMs: activeRun ? Date.now() - new Date(activeRun.started_at).getTime() : 0,
  });
}
