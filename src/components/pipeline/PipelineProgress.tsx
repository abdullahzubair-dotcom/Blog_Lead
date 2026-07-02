"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, XCircle, Loader2, Clock, Zap, Hash, Rss,
  Globe, FileSearch, BookOpen, Brain, ChevronRight,
} from "lucide-react";

export interface PipelineProgress {
  stage: string;
  message: string;
  harvester?: string;
  query?: string;
  hitsDiscovered?: number;
  processed?: number;
  authors?: number;
  errors?: number;
  stats?: Record<string, number>;
}

interface PipelineProgressProps {
  events: PipelineProgress[];
  isRunning: boolean;
  isDone: boolean;
  isError: boolean;
  isStopping?: boolean;
  stats?: Record<string, number>;
  onStop?: () => void;
  onRestart?: () => void;
  elapsedMs?: number;
}

// ── Harvester metadata ─────────────────────────────────────────────────────
const HARVESTERS = [
  { key: "gdelt",       label: "GDELT",         icon: Globe,      color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
  { key: "hackernews",  label: "Hacker News",   icon: Zap,        color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
  { key: "reddit",      label: "Reddit",         icon: Hash,       color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/20" },
  { key: "rss",         label: "RSS/Feeds",      icon: Rss,        color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  { key: "wordpress",   label: "WordPress",      icon: FileSearch, color: "text-cyan-400",    bg: "bg-cyan-500/10 border-cyan-500/20" },
  { key: "ghost",       label: "Ghost CMS",      icon: BookOpen,   color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20" },
  { key: "websearch",   label: "Web Search",     icon: Globe,      color: "text-teal-400",    bg: "bg-teal-500/10 border-teal-500/20" },
  { key: "scrapegraph", label: "ScrapeGraph AI", icon: Zap,        color: "text-fuchsia-400", bg: "bg-fuchsia-500/10 border-fuchsia-500/20" },
  { key: "commoncrawl", label: "Common Crawl",   icon: Globe,      color: "text-pink-400",    bg: "bg-pink-500/10 border-pink-500/20" },
  { key: "wayback",     label: "Wayback",        icon: Clock,      color: "text-slate-400",   bg: "bg-slate-500/10 border-slate-500/20" },
] as const;

type HarvKey = typeof HARVESTERS[number]["key"];

interface HarvState {
  status: "idle" | "running" | "done" | "skipped" | "error";
  hits: number;
  lastQuery?: string;
  lastMessage?: string;
  queryCount: number;
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function PipelineProgress({
  events, isRunning, isDone, isError, isStopping, stats, onStop, onRestart, elapsedMs,
}: PipelineProgressProps) {
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll activity log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events.length]);

  // ── Processing stage progress tracking ──────────────────────────────────
  // Read stats from events directly — they carry hitsDiscovered/processed fields
  // from the server-side stats spread. Never rely solely on the stats prop since
  // pipelineStats in page.tsx only updates when the server sends a data.stats key.
  const latestWithStats = [...events].reverse().find(
    (e) => (e.hitsDiscovered ?? 0) > 0 || (e.processed ?? 0) > 0
  );
  const totalHits = latestWithStats?.hitsDiscovered ?? stats?.hitsDiscovered ?? 0;
  const processed = latestWithStats?.processed ?? stats?.processed ?? 0;

  // Parse total from "Processing batch: X hits (Y done so far)" messages as fallback
  let parsedTotal = totalHits;
  for (const ev of events) {
    const m = ev.message.match(/Processing batch:\s*\d+\s*hits?\s*\((\d+)\s*done/i);
    if (m) { parsedTotal = Math.max(parsedTotal, parseInt(m[1], 10) + 100); }
    const m2 = ev.message.match(/(\d+)\s*raw hits? collected/i);
    if (m2) { parsedTotal = Math.max(parsedTotal, parseInt(m2[1], 10)); }
  }
  const effectiveTotal = parsedTotal || totalHits;

  // Compute processing rate (articles/min) from elapsed time
  let ratePerMin = 0;
  let etaSec: number | null = null;
  const hasProcessed = processed > 0;
  // Only start computing rate once we're in the process stage and have elapsed time
  const processStartIdx = events.findIndex((e) => e.stage === "process");
  if (hasProcessed && elapsedMs && elapsedMs > 0 && processStartIdx >= 0) {
    // Rough elapsed since process stage started: assume harvesting took ~25% of time
    const processElapsedMin = (elapsedMs * 0.7) / 60_000;
    ratePerMin = processElapsedMin > 0.1 ? processed / processElapsedMin : 0;
    if (ratePerMin > 0 && effectiveTotal > processed) {
      etaSec = Math.round(((effectiveTotal - processed) / ratePerMin) * 60);
    }
  }
  const processPct = effectiveTotal > 0 ? Math.min(99, Math.round((processed / effectiveTotal) * 100)) : 0;
  const isProcessing = events.some((e) => e.stage === "process") && !isDone && !isError;

  // ── Derive per-harvester state from events ───────────────────────────────
  const harvesterState: Record<string, HarvState> = {};
  for (const h of HARVESTERS) {
    harvesterState[h.key] = { status: "idle", hits: 0, queryCount: 0 };
  }

  for (const ev of events) {
    const hk = ev.harvester as HarvKey | undefined;
    if (!hk || !harvesterState[hk]) continue;
    const hs = harvesterState[hk];
    const msg = ev.message.toLowerCase();

    if (msg.includes("disabled") || msg.includes("skipping")) {
      hs.status = "skipped";
    } else if (msg.includes("error") && !msg.includes("starting")) {
      if (hs.status !== "done") hs.status = "error";
    } else if (msg.includes("starting") || msg.includes("enabled")) {
      if (hs.status === "idle") hs.status = "running";
    } else if (msg.includes("complete") || msg.includes("done")) {
      hs.status = "done";
    } else {
      if (hs.status === "idle") hs.status = "running";
    }

    if (ev.query && ev.query !== hs.lastQuery) {
      hs.lastQuery = ev.query;
      hs.queryCount++;
    }
    hs.lastMessage = ev.message;

    // Parse hit counts from messages like '"runway" → 12 articles found (total: 47)'
    const totalMatch = ev.message.match(/total:\s*(\d+)/i);
    if (totalMatch) hs.hits = parseInt(totalMatch[1], 10);
    const arrowMatch = ev.message.match(/→\s*(\d+)\s+(?:articles?|hits?|stories?|results?|links?|posts?)/i);
    if (arrowMatch && !totalMatch) hs.hits += parseInt(arrowMatch[1], 10);
  }

  // Mark all running harvesters as done when pipeline finishes
  if (isDone || isError) {
    for (const hk of Object.keys(harvesterState)) {
      if (harvesterState[hk].status === "running") harvesterState[hk].status = "done";
    }
  }

  // ── Overall stage + progress ─────────────────────────────────────────────
  const lastStage = events[events.length - 1]?.stage ?? "idle";
  const STAGE_STEPS = ["discover", "harvester", "process", "learn", "complete"];
  const stageIdx = STAGE_STEPS.indexOf(isDone ? "complete" : lastStage);
  const pct = isDone ? 100 : isError ? 0 : Math.max(5, Math.round(((stageIdx + 1) / STAGE_STEPS.length) * 95));

  const STAGE_LABELS: Record<string, string> = {
    discover: "Setting up harvesters",
    harvester: "Harvesting sources",
    process: "Profiling authors",
    learn: "Learning from run",
    complete: "Complete",
    stopped: "Stopped",
    error: "Error",
    idle: "Ready",
  };

  // ── Harvester card ───────────────────────────────────────────────────────
  const HarvCard = ({ h }: { h: typeof HARVESTERS[number] }) => {
    const hs = harvesterState[h.key];
    const Icon = h.icon;
    return (
      <div className={`flex flex-col gap-1.5 rounded-lg border p-2.5 transition-all ${
        hs.status === "idle"    ? "border-border bg-muted/30 opacity-50" :
        hs.status === "skipped" ? "border-border bg-muted/20 opacity-40" :
        hs.status === "running" ? h.bg + " shadow-sm" :
        hs.status === "done"    ? "border-emerald-500/20 bg-emerald-500/5" :
        hs.status === "error"   ? "border-destructive/20 bg-destructive/5" :
        "border-border"
      }`}>
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon className={`h-3.5 w-3.5 shrink-0 ${
              hs.status === "idle" || hs.status === "skipped" ? "text-muted-foreground" : h.color
            }`} />
            <span className={`text-xs font-medium truncate ${
              hs.status === "idle" || hs.status === "skipped" ? "text-muted-foreground" : "text-foreground"
            }`}>{h.label}</span>
          </div>
          {hs.status === "running" && <Loader2 className="h-3 w-3 shrink-0 text-amber-400 animate-spin" />}
          {hs.status === "done"    && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />}
          {hs.status === "error"   && <XCircle className="h-3 w-3 shrink-0 text-destructive" />}
          {hs.status === "skipped" && <span className="text-[9px] text-muted-foreground">off</span>}
        </div>

        {hs.status !== "idle" && hs.status !== "skipped" && (
          <div className="space-y-0.5">
            {hs.hits > 0 && (
              <p className={`text-[11px] font-semibold ${h.color}`}>{hs.hits} hits</p>
            )}
            {hs.lastQuery && hs.status === "running" && (
              <p className="text-[10px] text-muted-foreground truncate" title={hs.lastQuery}>
                <ChevronRight className="inline h-2.5 w-2.5" />"{hs.lastQuery}"
              </p>
            )}
            {hs.lastMessage && hs.status !== "running" && (
              <p className="text-[10px] text-muted-foreground truncate leading-tight" title={hs.lastMessage}>
                {hs.lastMessage.slice(0, 50)}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Activity log color by harvester ─────────────────────────────────────
  const HARVESTER_COLORS: Record<string, string> = {
    gdelt: "text-blue-400", hackernews: "text-amber-400", reddit: "text-orange-400",
    rss: "text-emerald-400", wordpress: "text-cyan-400", ghost: "text-violet-400",
    commoncrawl: "text-pink-400", wayback: "text-slate-400", brave: "text-red-400",
  };

  const STAGE_COLORS: Record<string, string> = {
    discover: "text-violet-400", process: "text-blue-400", learn: "text-emerald-400",
    complete: "text-emerald-400", stopped: "text-amber-400", error: "text-red-400",
  };

  return (
    <div className="space-y-4">
      {/* ── Header: overall status ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {isRunning && !isStopping && <Loader2 className="h-4 w-4 text-violet-500 animate-spin shrink-0" />}
          {isStopping && <Loader2 className="h-4 w-4 text-amber-500 animate-spin shrink-0" />}
          {isDone && !isRunning && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
          {isError && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {isStopping ? "Stopping…" : STAGE_LABELS[lastStage] ?? "Running"}
              {isProcessing && (effectiveTotal > 0 || processed > 0) && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  — {processed.toLocaleString()}{effectiveTotal > 0 ? ` / ${effectiveTotal.toLocaleString()}` : ""} articles
                  <span className={`ml-1.5 font-semibold ${processPct > 66 ? "text-emerald-400" : processPct > 33 ? "text-amber-400" : "text-blue-400"}`}>
                    ({processPct}%)
                  </span>
                </span>
              )}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {elapsedMs != null && elapsedMs > 0 && (
                <p className="text-xs text-muted-foreground">{fmt(elapsedMs)} elapsed</p>
              )}
              {isProcessing && ratePerMin > 0 && (
                <p className="text-xs text-muted-foreground">
                  {ratePerMin.toFixed(1)} articles/min
                  {etaSec != null && etaSec < 7200 && (
                    <span className="ml-2 text-foreground font-medium">· ~{fmt(etaSec * 1000)} left</span>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {isRunning && !isStopping && onStop && (
            <button onClick={onStop}
              className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors">
              <XCircle className="h-3.5 w-3.5" />
              Stop
            </button>
          )}
          {(isDone || isError || lastStage === "stopped") && onRestart && (
            <button onClick={onRestart}
              className="flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-500 hover:bg-violet-500/20 transition-colors">
              <Loader2 className="h-3.5 w-3.5" />
              Run Again
            </button>
          )}
        </div>
      </div>

      {/* ── Overall stage progress bar ── */}
      <div className="space-y-1.5">
        <Progress value={pct} className="h-1.5" />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Harvesting</span>
          <span>Profiling</span>
          <span>Learning</span>
          <span>Done</span>
        </div>
      </div>

      {/* ── Profiling sub-progress bar ── */}
      {isProcessing && (effectiveTotal > 0 || processed > 0) && (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">Profiling authors</span>
            <span className="text-muted-foreground tabular-nums">
              {processed.toLocaleString()}{effectiveTotal > 0 ? ` of ${effectiveTotal.toLocaleString()}` : ""} articles
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-500"
              style={{ width: `${processPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {ratePerMin > 0
                ? `${ratePerMin.toFixed(1)} articles/min`
                : "calculating rate…"}
            </span>
            <span>
              {etaSec != null && etaSec < 7200
                ? `~${fmt(etaSec * 1000)} remaining`
                : processed === 0
                ? "estimating…"
                : "almost done"}
            </span>
          </div>
        </div>
      )}

      {/* ── Harvester grid ── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Harvesters</p>
        <div className="grid grid-cols-3 gap-2">
          {HARVESTERS.map((h) => <HarvCard key={h.key} h={h} />)}
        </div>
      </div>

      {/* ── Live activity feed ── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Activity Log</p>
        <div
          ref={logRef}
          className="bg-background border border-border rounded-lg p-3 h-48 overflow-y-auto font-mono text-[11px] space-y-0.5 scroll-smooth"
        >
          {events.length === 0 ? (
            <p className="text-muted-foreground/60 italic">
              {isRunning
                ? "Waiting for events… pipeline is running in background"
                : "No event log available for this run"}
            </p>
          ) : (
            events.map((ev, i) => {
              const color = ev.harvester
                ? HARVESTER_COLORS[ev.harvester] ?? "text-muted-foreground"
                : STAGE_COLORS[ev.stage] ?? "text-muted-foreground";
              const tag = ev.harvester ?? ev.stage;
              return (
                <p key={i} className="leading-relaxed">
                  <span className={`${color} font-semibold`}>[{tag}]</span>{" "}
                  <span className="text-foreground/80">{ev.message}</span>
                </p>
              );
            })
          )}
          {isRunning && !isStopping && (
            <p className="text-violet-400 animate-pulse">▌</p>
          )}
        </div>
      </div>

      {/* ── Stats summary ── */}
      {stats && (stats.hitsDiscovered != null || stats.processed != null) && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Hits", value: stats.hitsDiscovered, color: "text-blue-400" },
            { label: "Processed", value: stats.processed, color: "text-violet-400" },
            { label: "Authors", value: stats.authors, color: "text-emerald-400" },
            { label: "Errors", value: stats.errors, color: "text-destructive" },
          ].map(({ label, value, color }) => value != null ? (
            <div key={label} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </div>
          ) : null)}
          {stats.learnedSubreddits != null && stats.learnedSubreddits > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center col-span-2">
              <div className="flex items-center justify-center gap-1.5">
                <Brain className="h-4 w-4 text-violet-400" />
                <p className="text-sm font-semibold text-foreground">
                  {stats.learnedSubreddits} subreddits · {stats.learnedDomains ?? 0} domains learned
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Check Admin → Learning to review</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
