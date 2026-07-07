"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Unlink, Play, Loader2, Send, ExternalLink, ChevronRight, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Progress { runId: string; pagesChecked: number; pagesTotal: number; linksChecked: number; broken: number; unreachable: number; log: string[] }
interface Run {
  id: string; started_at: string; finished_at: string | null; status: string;
  pages_total: number; pages_checked: number; links_checked: number; broken_found: number; unreachable: number;
  slack_posted_at: string | null;
}
interface Finding {
  id: string; page_url: string; page_author: string | null; link_url: string;
  anchor_text: string | null; context_text: string | null; reason: string; http_status: number | null;
}

const REASON_LABEL: Record<string, string> = {
  "http-404": "404", "http-410": "410 gone", "soft-404": "soft 404", "homepage-redirect": "→ homepage",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}

export default function LinkAuditPage() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [testing, setTesting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Settings — webhook + bot token (both write-only) + manual author→Slack-ID overrides
  const [hasWebhook, setHasWebhook] = useState<boolean | null>(null);
  const [webhookInput, setWebhookInput] = useState("");
  const [hasBotToken, setHasBotToken] = useState<boolean | null>(null);
  const [botTokenInput, setBotTokenInput] = useState("");
  const [mapText, setMapText] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const loadStatus = useCallback(async () => {
    const d = await fetch("/api/link-audit/status").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!d) return;
    setRunning(d.running);
    setProgress(d.progress);
    setRuns(d.runs ?? []);
  }, []);

  const loadFindings = useCallback(async (runId?: string | null) => {
    const qs = runId ? `?run_id=${runId}` : "";
    const d = await fetch(`/api/link-audit/findings${qs}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d) { setFindings(d.findings ?? []); setViewRunId(d.runId); }
  }, []);

  useEffect(() => {
    loadStatus();
    loadFindings();
    fetch("/api/link-audit/settings").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setHasWebhook(d.hasWebhook);
      setHasBotToken(d.hasBotToken);
      setMapText(Object.entries(d.slackMap ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n"));
    }).catch(() => {});
  }, [loadStatus, loadFindings]);

  // Poll while a run is live so progress + fresh findings stream in.
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (running) {
      timer.current = setInterval(() => { loadStatus(); if (progress?.runId) loadFindings(progress.runId); }, 4000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, progress?.runId]);

  async function runNow() {
    setStarting(true);
    const d = await fetch("/api/link-audit/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json()).catch(() => null);
    setStarting(false);
    if (d?.started) { toast.success(`Audit started — ${d.pagesTotal} pages queued.`); loadStatus(); }
    else if (d?.alreadyRunning) { toast.info("An audit is already running."); loadStatus(); }
    else toast.error(d?.error ?? "Couldn't start.");
  }

  async function sendTest() {
    setTesting(true);
    const d = await fetch("/api/link-audit/test-slack", { method: "POST" }).then((r) => r.json()).catch(() => null);
    setTesting(false);
    if (d?.ok) toast.success(d.usedRealDigest ? "Sent the latest run's real digest to Slack." : "Test message sent to Slack.");
    else toast.error(d?.error ?? "Slack post failed.");
  }

  async function saveSettings() {
    setSavingSettings(true);
    const slackMap: Record<string, string> = {};
    for (const line of mapText.split("\n")) {
      const m = line.match(/^\s*(.+?)\s*=\s*([A-Z0-9]+)\s*$/);
      if (m) slackMap[m[1]] = m[2];
    }
    const body: Record<string, unknown> = { slackMap };
    if (webhookInput.trim()) body.webhook = webhookInput.trim();
    if (botTokenInput.trim()) body.bot_token = botTokenInput.trim();
    const res = await fetch("/api/link-audit/settings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success(d.directoryUsers ? `Settings saved — found ${d.directoryUsers} workspace members for auto-tagging.` : "Settings saved.");
      if (webhookInput.trim()) { setHasWebhook(true); setWebhookInput(""); }
      if (botTokenInput.trim()) { setHasBotToken(true); setBotTokenInput(""); }
    } else toast.error(d.error ?? "Save failed.");
    setSavingSettings(false);
  }

  // Group findings by broken link — a dead footer link is one group, not many rows.
  const groups = Object.entries(findings.reduce((acc, f) => {
    (acc[f.link_url] ??= []).push(f);
    return acc;
  }, {} as Record<string, Finding[]>));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-600/15 flex items-center justify-center">
            <Unlink className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Link Audit</h1>
            <p className="text-sm text-muted-foreground">
              Daily bot crawls every page in imagine.art&apos;s sitemap and flags links that 404 (including soft 404s). Digest goes to Slack.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={sendTest} disabled={testing || hasWebhook === false} className="gap-1.5" title={hasWebhook === false ? "Add a Slack webhook below first" : "Post the latest digest (or a hello) to Slack"}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send test to Slack
          </Button>
          <Button size="sm" onClick={runNow} disabled={starting || running} className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
            {starting || running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "Running…" : "Run now"}
          </Button>
        </div>
      </div>

      {/* Live progress */}
      {running && progress && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 px-5 py-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
            Crawling — {progress.pagesChecked}/{progress.pagesTotal} pages
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${Math.round((progress.pagesChecked / Math.max(progress.pagesTotal, 1)) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress.linksChecked.toLocaleString()} unique links checked · <span className="text-red-400 font-medium">{progress.broken} broken</span> · {progress.unreachable} unreachable (not counted as broken) · keeps running if you close this tab
          </p>
          {/* Verbose per-page log — newest at the bottom */}
          {(progress.log?.length ?? 0) > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-md bg-black/40 border border-border font-mono text-[11px] leading-relaxed p-3 space-y-0.5 flex flex-col-reverse">
              <div>
                {progress.log.map((line, i) => (
                  <p key={i} className={line.includes("BROKEN") ? "text-red-400" : line.includes("failed") ? "text-amber-400" : "text-muted-foreground"}>{line}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Findings */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium">Broken links {viewRunId && runs.find((r) => r.id === viewRunId) ? `— run ${fmt(runs.find((r) => r.id === viewRunId)!.started_at)}` : ""}</p>
          <Badge variant="outline" className={groups.length > 0 ? "text-red-400 border-red-500/30" : "text-green-400 border-green-500/30"}>
            {groups.length} broken link{groups.length === 1 ? "" : "s"}
          </Badge>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-border rounded-xl px-4 py-6 text-center">
            {runs.some((r) => r.status === "completed") ? "No broken links in this run. 🎉" : "No completed runs yet — hit Run now, or wait for the daily cron."}
          </p>
        ) : (
          <div className="border border-border rounded-xl divide-y divide-border">
            {groups.map(([link, fs]) => (
              <details key={link} className="group">
                <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 list-none">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 transition-transform group-open:rotate-90 shrink-0" />
                  <a href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sm text-red-400 hover:underline truncate flex-1 min-w-0">
                    {link}
                  </a>
                  <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30 shrink-0">{REASON_LABEL[fs[0].reason] ?? fs[0].reason}</Badge>
                  <span className="text-[10px] text-muted-foreground shrink-0">on {fs.length} page{fs.length === 1 ? "" : "s"}</span>
                </summary>
                <div className="px-4 pb-3 pl-11 space-y-2">
                  {fs.map((f) => (
                    <div key={f.id} className="text-xs space-y-0.5">
                      <p>
                        <a href={f.page_url} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline inline-flex items-center gap-1">
                          {new URL(f.page_url).pathname}<ExternalLink className="h-2.5 w-2.5 opacity-60" />
                        </a>
                        <span className="text-muted-foreground"> — by {f.page_author ?? <i>no author on file</i>}</span>
                        {f.anchor_text && <span className="text-muted-foreground"> — link text: &quot;{f.anchor_text.slice(0, 60)}&quot;</span>}
                      </p>
                      {f.context_text && <p className="text-muted-foreground/70 italic line-clamp-2">…{f.context_text}…</p>}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      {/* Run history */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Run history</p>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="border border-border rounded-xl divide-y divide-border">
            {runs.map((r) => (
              <button key={r.id} onClick={() => loadFindings(r.id)} className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30 ${viewRunId === r.id ? "bg-muted/40" : ""}`}>
                {r.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                  : r.status === "failed" ? <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                  : <Clock className="h-4 w-4 text-blue-400 shrink-0" />}
                <span className="text-sm shrink-0">{fmt(r.started_at)}</span>
                <span className="text-xs text-muted-foreground flex-1 truncate">
                  {r.pages_checked}/{r.pages_total} pages · {r.links_checked.toLocaleString()} links · <span className={r.broken_found > 0 ? "text-red-400" : "text-green-400"}>{r.broken_found} broken</span>
                </span>
                {r.slack_posted_at && <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">slack ✓</Badge>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="border border-border rounded-xl p-4 space-y-4">
        <p className="text-sm font-medium">Slack settings</p>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-2">
            Webhook
            {hasWebhook !== null && (
              <Badge variant="outline" className={hasWebhook ? "text-green-400 border-green-500/30 text-[10px]" : "text-amber-400 border-amber-500/30 text-[10px]"}>
                {hasWebhook ? "configured" : "not set"}
              </Badge>
            )}
          </Label>
          <Input
            type="password"
            placeholder="Paste a new https://hooks.slack.com/… URL to replace it"
            value={webhookInput}
            onChange={(e) => setWebhookInput(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Stored encrypted; never displayed back. Leave blank to keep the current one.</p>
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-2">
            Bot token for automatic @-tagging
            {hasBotToken !== null && (
              <Badge variant="outline" className={hasBotToken ? "text-green-400 border-green-500/30 text-[10px]" : "text-amber-400 border-amber-500/30 text-[10px]"}>
                {hasBotToken ? "configured — auto-matching on" : "not set — names shown as plain text"}
              </Badge>
            )}
          </Label>
          <Input
            type="password"
            placeholder="xoxb-… (Slack app bot token with the users:read scope)"
            value={botTokenInput}
            onChange={(e) => setBotTokenInput(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            With a token, digests search the workspace member list and fuzzy-match author names to real users automatically —
            no manual mapping needed. Create one at api.slack.com/apps → OAuth & Permissions → add <code>users:read</code> → install → copy the Bot User OAuth Token. Stored encrypted.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Manual overrides <span className="text-muted-foreground font-normal">(optional — wins over fuzzy matching)</span></Label>
          <Textarea
            placeholder={"One per line, only needed when auto-match can't find someone:\nRyan Hayden = U0123ABCDEF"}
            className="min-h-[80px] font-mono text-xs"
            value={mapText}
            onChange={(e) => setMapText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Member ID from Slack profile → ⋯ → Copy member ID. Authors that resolve neither way appear as plain names.
          </p>
        </div>
        <Button onClick={saveSettings} disabled={savingSettings} size="sm">
          {savingSettings && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}
