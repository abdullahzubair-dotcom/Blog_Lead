"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ScanSearch, Play, Loader2, AlertTriangle, ExternalLink, GitPullRequest, Ticket,
  Send, History as HistoryIcon, CheckCircle2, XCircle, HelpCircle, Wrench, Users, Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { IndexingReport } from "@/lib/indexing/types";
import type { Verdict } from "@/lib/indexing/gate";
import type { Rating } from "@/lib/indexing/cwv";
import type { Priority, Owner } from "@/lib/indexing/classify";
import type { ChangeRequestPreview } from "@/lib/indexing/routing";

/* ─────────────────────────── plain-language dictionaries ─────────────────────────── */
// Everything the crawler produces is developer/SEO jargon; these maps translate it into
// language a non-technical SEO teammate can act on. Keyed by the stable machine values.

const VERDICT_UI: Record<Verdict, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  pass: { label: "Healthy", cls: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30", Icon: CheckCircle2 },
  flag: { label: "Needs attention", cls: "text-amber-500 bg-amber-500/10 border-amber-500/30", Icon: AlertTriangle },
  block: { label: "Serious problem", cls: "text-red-500 bg-red-500/10 border-red-500/30", Icon: XCircle },
};

const PRIORITY_UI: Record<Priority, { label: string; cls: string }> = {
  p0: { label: "Urgent", cls: "text-red-500 bg-red-500/10 border-red-500/30" },
  p1: { label: "High", cls: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  p2: { label: "Normal", cls: "text-muted-foreground bg-muted border-border" },
};

const OWNER_UI: Record<Owner, string> = {
  webdev: "Web team",
  seo: "SEO team",
  content: "Content team",
};

const ratingClass: Record<Rating, string> = {
  good: "text-emerald-500",
  needs_improvement: "text-amber-500",
  poor: "text-red-500",
  unknown: "text-muted-foreground",
};

function renderUI(mode: string): { label: string; cls: string } {
  if (mode === "ssr") return { label: "Loads instantly", cls: "text-emerald-500" };
  if (mode === "mixed") return { label: "Some content needs code", cls: "text-amber-500" };
  if (mode === "client-rendered") return { label: "Content loads via code", cls: "text-red-500" };
  return { label: "Couldn't check", cls: "text-muted-foreground" };
}

// Predicted Google outcome, in human words.
function googleResult(state: string): { label: string; cls: string } {
  const m: Record<string, { label: string; cls: string }> = {
    "Submitted and indexed": { label: "Likely to show in Google", cls: "text-emerald-500" },
    "Crawled – currently not indexed": { label: "Google may skip this page", cls: "text-amber-500" },
    "Not found (404)": { label: "Page is broken (404)", cls: "text-red-500" },
    "Server error (5xx)": { label: "Server error", cls: "text-red-500" },
    "Page with redirect": { label: "Redirects to another page", cls: "text-amber-500" },
    "Excluded by 'noindex' tag": { label: "Blocked from Google", cls: "text-red-500" },
    "Blocked by robots.txt": { label: "Blocked from crawlers", cls: "text-red-500" },
    "Duplicate, Google chose different canonical": { label: "Google prefers another URL", cls: "text-amber-500" },
  };
  return m[state] ?? { label: state, cls: "text-muted-foreground" };
}

// What each problem means, in plain English. Keyed by the gate-failure "reason".
const EXPLAIN: Record<string, { title: string; why: string }> = {
  js_gated: {
    title: "Content only appears after code runs",
    why: "Google's first look and AI search tools (ChatGPT, Perplexity, Claude) don't run page code. If the main content only shows up after code runs, they may see a nearly-blank page — so it can be invisible in search and AI answers.",
  },
  thin_or_duplicate: {
    title: "Too little unique content",
    why: "This page is short or very similar to other pages. Google may decide it isn't worth showing in search.",
  },
  missing_schema: {
    title: "Missing structured data",
    why: "Structured data helps Google understand what the page is and can unlock richer search results. This page has none.",
  },
  missing_canonical: {
    title: "No 'official URL' tag",
    why: "The canonical tag tells Google which URL is the main one. Without it Google guesses — and can pick the wrong version.",
  },
  not_self_canonical: {
    title: "Names a different page as the original",
    why: "This page points at another URL as the 'original', so Google may index that one instead of this page.",
  },
  has_noindex: {
    title: "Set to hide from Google",
    why: "This page tells Google not to index it. If that was left on by mistake, the page will never appear in search.",
  },
  is_redirect: {
    title: "This URL redirects away",
    why: "The address sends visitors to a different page. Links pointing here lose their value — they should point to the final page.",
  },
  robots_disallowed: {
    title: "Blocked by robots.txt",
    why: "The site is telling search crawlers not to visit this page. If it should be in Google, that rule needs removing.",
  },
  missing_title: {
    title: "Missing page title",
    why: "The title is the blue link text in Google results. Without one, Google makes something up.",
  },
  missing_meta_description: {
    title: "Missing description",
    why: "The description is the grey text under the title in Google. Missing it means Google writes its own.",
  },
  missing_h1: {
    title: "Missing main heading",
    why: "The main heading (H1) tells Google and readers the page's topic at a glance.",
  },
  multiple_h1: {
    title: "More than one main heading",
    why: "Several main headings muddy what the page is mainly about.",
  },
  cwv_slow: {
    title: "Slow page experience",
    why: "Real visitors experience this page type as slow, unresponsive, or visually jumpy. Google uses page speed as a ranking tie-breaker, and slow pages lose visitors.",
  },
};

function explain(reason: string, fallbackLabel: string): { title: string; why: string } {
  if (reason.startsWith("http_status=")) {
    const code = reason.split("=")[1];
    return { title: `Page returns an error (${code})`, why: "The page didn't load normally, so Google can't index it." };
  }
  return EXPLAIN[reason] ?? { title: fallbackLabel, why: "" };
}

/* ─────────────────────────── small components ─────────────────────────── */

function Tip({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex cursor-help align-middle text-muted-foreground/70 hover:text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" />
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className={cn("text-2xl font-semibold", tone)}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

interface RunSummary {
  id: string; target: string; started_at: string; finished_at: string;
  analyzed: number; templates_count: number; issues_count: number; p0_count: number;
  js_gated_count: number; created_by: string | null; created_at: string;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}

// Tiny dependency-free sparkline.
function Sparkline({ values, color, width = 130, height = 34 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values
    .map((val, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1];
  const lastX = width;
  const lastY = height - ((last - min) / range) * (height - 4) - 2;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}

// For these metrics lower is better, so a decrease reads as an improvement.
function TrendCard({ label, values, color }: { label: string; values: number[]; color: string }) {
  const latest = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const delta = latest - first;
  const improved = delta < 0;
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-end gap-3 mt-1">
        <div className="text-2xl font-semibold" style={{ color }}>{latest}</div>
        <Sparkline values={values} color={color} />
      </div>
      {values.length >= 2 && delta !== 0 && (
        <div className={cn("text-xs mt-1", improved ? "text-emerald-500" : "text-red-500")}>
          {improved ? "↓" : "↑"} {Math.abs(delta)} since your first check
        </div>
      )}
      {delta === 0 && values.length >= 2 && <div className="text-xs mt-1 text-muted-foreground">no change</div>}
    </div>
  );
}

function Trends({ history }: { history: RunSummary[] }) {
  const chrono = [...history].reverse(); // stored newest-first → plot oldest→newest
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-sm font-medium flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-violet-500" /> Trend over your last {chrono.length} checks
      </div>
      <div className="grid grid-cols-2 gap-6 max-w-md">
        <TrendCard label="Pages hidden from search" values={chrono.map((h) => h.js_gated_count)} color="#ef4444" />
        <TrendCard label="Total issues found" values={chrono.map((h) => h.issues_count)} color="#f59e0b" />
      </div>
    </div>
  );
}

/* ─────────────────────────── page ─────────────────────────── */

export function PageHealthPanel() {
  const [count, setCount] = useState(15);
  const [scope, setScope] = useState<"important" | "sample">("important");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [template, setTemplate] = useState("");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<IndexingReport | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);

  async function loadHistory() {
    const d = await fetch("/api/indexing/history").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d?.ok) setHistory(d.runs ?? []);
  }
  useEffect(() => { loadHistory(); }, []);

  async function run() {
    setRunning(true);
    setReport(null);
    setRunId(null);
    try {
      const res = await fetch("/api/indexing/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: count, device, template: template || undefined, moneyFirst: scope === "important" }),
      });
      const d = await res.json();
      if (d?.ok && d.report) {
        setReport(d.report as IndexingReport);
        setRunId(d.runId ?? null);
        toast.success(`Checked ${d.report.analyzed} pages.`);
        loadHistory();
      } else {
        toast.error(d?.error ?? "Scan failed.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Scan failed.");
    } finally {
      setRunning(false);
    }
  }

  async function openHistoryRun(id: string) {
    const d = await fetch(`/api/indexing/history/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d?.ok && d.report) { setReport(d.report as IndexingReport); setRunId(id); }
    else toast.error("Couldn't load that scan.");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ScanSearch className="h-6 w-6 text-violet-500" /> Page Health Check
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Checks whether your imagine.art pages can actually be seen by Google and AI search tools —
          and gives you a clear, plain-English fix for anything that's wrong. Nothing is changed on
          your site; you decide what to send to the team.
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-5">
          <div className="space-y-1.5">
            <Label>What should I check?</Label>
            <div className="flex rounded-md border border-border overflow-hidden w-fit">
              <button
                onClick={() => setScope("important")}
                className={cn("px-3 py-2 text-sm", scope === "important" ? "bg-violet-600 text-white" : "hover:bg-muted")}
              >
                My most important pages
              </button>
              <button
                onClick={() => setScope("sample")}
                className={cn("px-3 py-2 text-sm border-l border-border", scope === "sample" ? "bg-violet-600 text-white" : "hover:bg-muted")}
              >
                A sample of the whole site
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="count" className="flex items-center gap-1">
              How many pages <Tip text="More pages = more thorough, but the check takes longer. 15 is a good start." />
            </Label>
            <Input id="count" type="number" min={1} max={40} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-24" />
          </div>
          <Button onClick={run} disabled={running} size="lg" className="ml-auto">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Checking…" : "Check my pages"}
          </Button>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground w-fit">Advanced options</summary>
          <div className="mt-3 flex flex-wrap items-end gap-5">
            <div className="space-y-1.5">
              <Label htmlFor="device" className="flex items-center gap-1">
                Speed measured for <Tip text="Google mainly judges the mobile experience, so mobile is the default." />
              </Label>
              <select id="device" value={device} onChange={(e) => setDevice(e.target.value as "mobile" | "desktop")} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm w-32">
                <option value="mobile">Phone</option>
                <option value="desktop">Desktop</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template" className="flex items-center gap-1">
                Only one page type <Tip text="Optional. Limits the check to one template, e.g. apps/[slug]. Leave blank to check across types." />
              </Label>
              <Input id="template" placeholder="e.g. apps/[slug]" value={template} onChange={(e) => setTemplate(e.target.value)} className="w-52" />
            </div>
          </div>
        </details>
      </div>

      {running && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening each page the way Google sees it (twice — with and without code) and measuring speed. Hang tight.
        </div>
      )}

      {report && <Report report={report} runId={runId} />}

      {!report && history.length >= 2 && <Trends history={history} />}

      {!report && history.length > 0 && (
        <div className="rounded-lg border border-border">
          <div className="p-3 border-b border-border text-sm font-medium flex items-center gap-2">
            <HistoryIcon className="h-4 w-4" /> Past checks
          </div>
          <div className="divide-y divide-border">
            {history.map((h) => (
              <button key={h.id} onClick={() => openHistoryRun(h.id)} className="w-full text-left p-3 text-sm hover:bg-muted/40 flex items-center gap-3 flex-wrap">
                <span className="text-muted-foreground">{fmt(h.created_at)}</span>
                <span>{h.analyzed} pages checked</span>
                {h.js_gated_count > 0 && <><span className="text-muted-foreground">·</span><span className="text-amber-500">{h.js_gated_count} hidden from search</span></>}
                {h.created_by && <span className="text-muted-foreground ml-auto">{h.created_by}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type DispatchState = { status: "idle" | "loading" | "done" | "error"; ref?: string; error?: string };

function Report({ report, runId }: { report: IndexingReport; runId: string | null }) {
  const v = report.counts.verdicts;
  const needsWork = v.flag + v.block;
  const [routingState, setRoutingState] = useState<Record<number, DispatchState>>({});
  const [slackState, setSlackState] = useState<DispatchState>({ status: "idle" });

  async function dispatchRouting(i: number, preview: ChangeRequestPreview) {
    setRoutingState((s) => ({ ...s, [i]: { status: "loading" } }));
    const endpoint = preview.kind === "pr" ? "/api/indexing/pr" : "/api/indexing/ticket";
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview, runId }) });
      const d = await res.json();
      if (d?.ok) {
        const ref = preview.kind === "pr" ? d.pr?.url : d.issue?.url;
        setRoutingState((s) => ({ ...s, [i]: { status: "done", ref } }));
        toast.success(preview.kind === "pr" ? `Fix drafted as PR #${d.pr.number}.` : `Ticket ${d.issue.identifier} created.`);
      } else {
        setRoutingState((s) => ({ ...s, [i]: { status: "error", error: d?.error } }));
        toast.error(d?.error ?? "Failed.");
      }
    } catch (e: any) {
      setRoutingState((s) => ({ ...s, [i]: { status: "error", error: e?.message } }));
      toast.error(e?.message ?? "Failed.");
    }
  }

  async function postSlack() {
    setSlackState({ status: "loading" });
    try {
      const res = await fetch("/api/indexing/slack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: report.slackPreview, runId }) });
      const d = await res.json();
      if (d?.ok) { setSlackState({ status: "done" }); toast.success("Shared to Slack."); }
      else { setSlackState({ status: "error", error: d?.error }); toast.error(d?.error ?? "Slack post failed."); }
    } catch (e: any) {
      setSlackState({ status: "error", error: e?.message }); toast.error(e?.message ?? "Slack post failed.");
    }
  }

  return (
    <div className="space-y-4">
      {/* Plain-English headline */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="text-base">
          {needsWork === 0 ? (
            <span className="flex items-center gap-2 text-emerald-500"><CheckCircle2 className="h-5 w-5" /> All {report.analyzed} pages checked look healthy.</span>
          ) : (
            <span>
              We checked <b>{report.analyzed}</b> pages.{" "}
              <b className="text-amber-500">{needsWork}</b> need attention
              {report.counts.jsGated > 0 && <> — including <b className="text-red-500">{report.counts.jsGated}</b> that Google &amp; AI search may not be able to see</>}.
              {" "}Start with the <b>What to fix</b> tab below.
            </span>
          )}
        </div>
      </div>

      {/* env warnings, de-jargoned */}
      {report.notes.some((n) => n.includes("PAGESPEED")) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Speed scores are turned off — add a free Google PageSpeed key to see how fast pages feel to real visitors.</span>
        </div>
      )}

      {/* friendly stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Pages checked" value={report.analyzed} />
        <Stat label="Healthy" value={v.pass} tone="text-emerald-500" />
        <Stat label="Need attention" value={needsWork} tone={needsWork ? "text-amber-500" : undefined} />
        <Stat label="Hidden from search" value={report.counts.jsGated} tone={report.counts.jsGated ? "text-red-500" : undefined} />
      </div>

      <Tabs defaultValue="fix">
        <TabsList>
          <TabsTrigger value="fix">What to fix ({report.routing.length})</TabsTrigger>
          <TabsTrigger value="pages">All pages</TabsTrigger>
          <TabsTrigger value="speed">Speed</TabsTrigger>
          <TabsTrigger value="types">Page types</TabsTrigger>
          <TabsTrigger value="share">Share</TabsTrigger>
        </TabsList>

        {/* WHAT TO FIX — the hero, action-first */}
        <TabsContent value="fix" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Each card is one problem, grouped so a whole page-type is fixed at once. Send it to the right
            team with one click — this opens a pull request or a Linear ticket for them; nothing changes on your site.
          </p>
          {report.routing.length === 0 && <div className="text-sm text-emerald-500">Nothing to fix — every page checked passed. 🎉</div>}
          {report.routing.map((r, i) => {
            const st = routingState[i] ?? { status: "idle" as const };
            const ex = explain(r.reason, r.title);
            return (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex items-start gap-2 flex-wrap">
                  <Badge variant="outline" className={cn("text-[10px] uppercase", PRIORITY_UI[r.priority].cls)}>{PRIORITY_UI[r.priority].label}</Badge>
                  <div className="font-medium">{ex.title}</div>
                  <span className="text-xs text-muted-foreground ml-auto">Affects {r.urls.length} page{r.urls.length === 1 ? "" : "s"}</span>
                </div>
                {ex.why && <p className="text-sm text-muted-foreground mt-2">{ex.why}</p>}
                <div className="mt-3 flex items-start gap-2 text-sm">
                  <Wrench className="h-4 w-4 shrink-0 mt-0.5 text-violet-500" />
                  <span><b>What to do:</b> {r.fix}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" /> Best handled by the <b className="text-foreground/90">{OWNER_UI[r.owner]}</b>
                </div>

                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer w-fit">Show affected pages</summary>
                  <ul className="mt-1.5 space-y-0.5">
                    {r.urls.slice(0, 30).map((u) => (
                      <li key={u}><a href={u} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">{u.replace(/^https?:\/\/[^/]+/, "")} <ExternalLink className="h-3 w-3" /></a></li>
                    ))}
                    {r.urls.length > 30 && <li>…and {r.urls.length - 30} more</li>}
                  </ul>
                </details>

                <div className="mt-3 flex items-center gap-2">
                  {st.status === "done" ? (
                    <a href={st.ref} target="_blank" rel="noreferrer" className="text-sm text-emerald-500 flex items-center gap-1 hover:underline">
                      <CheckCircle2 className="h-4 w-4" /> {r.kind === "pr" ? "Fix drafted" : "Ticket created"} — open it <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <Button
                      size="sm"
                      disabled={st.status === "loading"}
                      onClick={() => dispatchRouting(i, r)}
                      title={r.kind === "pr" ? "Opens a pull request the web team reviews and merges. Nothing changes on your site until they approve it." : "Creates a Linear ticket for the team to pick up."}
                    >
                      {st.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : r.kind === "pr" ? <GitPullRequest className="h-3.5 w-3.5" /> : <Ticket className="h-3.5 w-3.5" />}
                      {r.kind === "pr" ? "Draft the fix (pull request)" : "Create a ticket"}
                    </Button>
                  )}
                  {st.status === "error" && <span className="text-xs text-red-500">{st.error}</span>}
                </div>
              </div>
            );
          })}
        </TabsContent>

        {/* ALL PAGES */}
        <TabsContent value="pages" className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">Every page we checked and how it's doing. Hover the “?” on any label for a plain explanation.</p>
          {!report.gscConfigured && (
            <p className="text-xs text-muted-foreground/70">
              Tip: connect Google Search Console (ask your admin — see <code>docs/GSC_SETUP.md</code>) to show the real Google status beside each prediction.
            </p>
          )}
          {report.urls.map((u) => {
            const vu = VERDICT_UI[u.gate.verdict];
            const gr = googleResult(u.predicted.state);
            const rm = renderUI(u.renderMode);
            return (
              <div key={u.url} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn("text-[10px] gap-1", vu.cls)}><vu.Icon className="h-3 w-3" /> {vu.label}</Badge>
                  <a href={u.url} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline flex items-center gap-1">{u.path} <ExternalLink className="h-3 w-3" /></a>
                  {u.isMoney && <Badge variant="outline" className="text-violet-500 border-violet-500/40 text-[10px]">important</Badge>}
                  <span className={cn("text-xs ml-auto", gr.cls)}>{gr.label}</span>
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                  <span className={rm.cls}>{rm.label}</span>
                  <Tip text="How the page delivers its content. 'Loads instantly' means Google & AI tools can read it right away. 'Loads via code' means they may see a blank page." />
                  {u.gsc?.coverageState && (
                    <>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="flex items-center gap-1">
                        Google says: <span className="text-foreground/90">{u.gsc.coverageState}</span>
                        <Tip text="The real status from Google Search Console — what Google actually reports for this URL today, next to our prediction on the right." />
                      </span>
                    </>
                  )}
                </div>
                {u.issues.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {u.issues.map((issue) => {
                      const ex = explain(issue.reason, issue.label);
                      return (
                        <span key={issue.reason} title={ex.why} className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] cursor-help">
                          {ex.title}
                        </span>
                      );
                    })}
                  </div>
                )}
                {u.error && <div className="mt-1 text-xs text-red-500">Couldn't load this page ({u.error}).</div>}
              </div>
            );
          })}
        </TabsContent>

        {/* SPEED (CWV) */}
        <TabsContent value="speed" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            How fast pages feel to real visitors — Google uses this in rankings. Measured per page-type.
          </p>
          {report.cwv.length === 0 && <div className="text-sm text-muted-foreground">No speed data yet.</div>}
          {report.cwv.map((c) => (
            <div key={c.template} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-xs">{c.template}</span>
                <a href={c.representativeUrl} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">{c.representativeUrl.replace(/^https?:\/\/[^/]+/, "")}</a>
              </div>
              {c.hasField ? (
                <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                  {([["lcp", "Loading speed"], ["inp", "Responsiveness"], ["cls", "Visual stability"]] as const).map(([m, human]) => (
                    <div key={m}>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">{human} <Tip text={m === "lcp" ? "How long until the main content appears. Good ≤ 2.5s." : m === "inp" ? "How quickly the page responds when tapped/clicked. Good ≤ 200ms." : "How much the layout jumps around while loading. Good ≤ 0.1."} /></div>
                      <div className={cn("font-semibold", ratingClass[c.evaluation[m].rating])}>
                        {c.evaluation[m].value ?? "n/a"}{m === "cls" ? "" : "ms"}{" "}
                        <span className="text-[10px]">{c.evaluation[m].rating === "good" ? "✓ good" : c.evaluation[m].rating === "needs_improvement" ? "could be better" : c.evaluation[m].rating === "poor" ? "poor" : ""}</span>
                      </div>
                      {c.diagnosis[m].length > 0 && (
                        <ul className="mt-1 text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">{c.diagnosis[m].map((d, i) => <li key={i}>{d}</li>)}</ul>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs text-muted-foreground">Not enough real-visitor data yet{c.error ? ` (${c.error})` : ""}.</div>
              )}
            </div>
          ))}
        </TabsContent>

        {/* PAGE TYPES */}
        <TabsContent value="types" className="mt-4">
          <p className="text-sm text-muted-foreground mb-3">Your pages grouped by design template. Problems usually hit a whole template at once, so fixing one template fixes many pages.</p>
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b border-border">
                <tr className="[&>th]:text-left [&>th]:p-3 [&>th]:font-medium">
                  <th>Page type</th><th className="flex items-center gap-1">How it loads <Tip text="'Loads instantly' is good for search. 'Loads via code' means Google & AI tools may not see the content." /></th><th>Pages checked</th><th>Health</th>
                </tr>
              </thead>
              <tbody>
                {report.templates.map((t) => {
                  const rm = renderUI(t.renderMode);
                  const bad = t.verdicts.flag + t.verdicts.block;
                  return (
                    <tr key={t.template} className="border-b border-border/50 [&>td]:p-3 align-top">
                      <td className="font-mono text-xs">{t.template} {t.moneyPage && <Badge variant="outline" className="ml-1 text-violet-500 border-violet-500/40 text-[10px]">important</Badge>}</td>
                      <td className={rm.cls}>{rm.label}{t.jsGatedCount > 0 && <span className="text-red-500"> ({t.jsGatedCount}/{t.urlCount} hidden)</span>}</td>
                      <td>{t.urlCount}</td>
                      <td>{bad === 0 ? <span className="text-emerald-500">all healthy</span> : <span className="text-amber-500">{bad} need attention</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* SHARE */}
        <TabsContent value="share" className="mt-4">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-sm text-muted-foreground flex items-center gap-1"><Sparkles className="h-4 w-4" /> Post a summary of this check to your team's Slack.</div>
              {slackState.status === "done" ? (
                <span className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Shared</span>
              ) : (
                <Button size="sm" disabled={slackState.status === "loading"} onClick={postSlack}>
                  {slackState.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Share to Slack
                </Button>
              )}
            </div>
            {slackState.status === "error" && <div className="text-xs text-red-500 mb-2">{slackState.error}</div>}
            <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded p-3">{report.slackPreview}</pre>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
