import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";
import { getBufferDurable, isRunAlive } from "@/lib/pipeline/eventBuffer";

export async function GET() {
  // "Alive" = a recent Redis heartbeat (or an in-memory run on this instance). Durable, so a
  // run executing on ANOTHER serverless instance isn't mistaken for dead.
  const alive = await isRunAlive();

  const { data: runs } = await supabaseAdmin
    .from("pipeline_runs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1);

  let activeRun = runs?.[0] ?? null;

  // Only auto-close a DB "running" row when there's NO live heartbeat AND it's old enough
  // that it can't just be mid-startup — i.e. the run genuinely died (function killed / restart).
  const stale = activeRun && (Date.now() - new Date(activeRun.started_at).getTime()) > 90_000;
  if (activeRun && !alive && stale) {
    await supabaseAdmin
      .from("pipeline_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: "Auto-closed: no heartbeat (function ended or process restarted)" })
      .eq("id", activeRun.id);
    activeRun = null;
  }

  // Live counts from DB — source of truth regardless of SSE/instance state
  const [totRow, procRow, authRow] = await Promise.all([
    supabaseAdmin.from("discovery_hits").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("discovery_hits").select("id", { count: "exact", head: true }).eq("processed", true),
    supabaseAdmin.from("authors").select("id", { count: "exact", head: true }),
  ]);

  const buffer = await getBufferDurable();

  return NextResponse.json({
    isRunning: alive || !!activeRun,
    activeRun,
    totalHits: totRow.count ?? 0,
    processedHits: procRow.count ?? 0,
    totalAuthors: authRow.count ?? 0,
    // Replay buffered events (durable, survives refresh + instance change)
    bufferedEvents: buffer?.events ?? [],
    bufferRunId: buffer?.runId ?? null,
    elapsedMs: activeRun ? Date.now() - new Date(activeRun.started_at).getTime() : 0,
  });
}
