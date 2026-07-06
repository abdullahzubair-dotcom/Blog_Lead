"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Bell, Search, Loader2, X, CheckCircle2, FileText, Eye, FlaskConical, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthorDrawer } from "@/components/prospects/useAuthorDrawer";

interface Watch {
  author_id: string;
  created_at: string;
  last_checked_at: string | null;
  author: { id: string; full_name: string; domain?: { host?: string; name?: string } | null; contacts?: { type: string; value: string }[] };
}

interface TestResult {
  website: string | null;
  checked: boolean;
  authorPageUrl: string | null;
  newArticlesFound: number;
  newArticles: { title: string | null; url: string; publishedAt: string | null }[];
  notified: number;
  emailed: number;
  latestArticle: { title: string | null; url: string; publishedAt: string | null } | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "no date on file";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return "no date on file"; }
}

interface Notification {
  id: string;
  created_at: string;
  read_at: string | null;
  author: { id: string; full_name: string };
  article: { id: string; title: string | null; url_canonical: string; published_at?: string };
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never checked";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function NotificationsPage() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const { openAuthor, drawer } = useAuthorDrawer();

  // Search-and-add author picker
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // "Test watcher" — runs the same recheck the daily cron does, for one author, right now.
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const load = useCallback(async () => {
    const [w, n] = await Promise.all([
      fetch("/api/notifications/watches").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/notifications").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    setWatches(w ?? []);
    setNotifications(n ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Light polling purely for UI freshness — the actual checking runs server-side via the
    // daily cron regardless of whether this tab is open.
    pollTimer.current = setInterval(load, 60_000);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [load]);

  async function runSearch(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const res = await fetch(`/api/prospects?search=${encodeURIComponent(q)}&limit=15`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setResults(res?.prospects ?? []);
    setSearching(false);
  }

  async function addWatch(authorId: string) {
    setAddingId(authorId);
    await fetch("/api/notifications/watches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author_id: authorId }),
    }).catch(() => {});
    setAddingId(null);
    toast.success("Watching — you'll be notified of new posts.");
    load();
  }

  async function testWatcher(authorId: string) {
    setTestingId(authorId);
    const res = await fetch(`/api/notifications/watches/${authorId}/test`, { method: "POST" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setTestingId(null);
    if (!res) { toast.error("Test failed — check the server logs."); return; }
    setTestResults((prev) => ({ ...prev, [authorId]: res }));
    if (!res.checked) toast.info("No known page on file to check for this writer yet.");
    else if (res.newArticlesFound > 0) toast.success(`Found ${res.newArticlesFound} new article(s) — notified & emailed.`);
    else toast.info("Checked — nothing new since last time.");
    load(); // refresh last_checked_at + notification feed
  }

  async function removeWatch(authorId: string) {
    setWatches((ws) => ws.filter((w) => w.author_id !== authorId));
    await fetch(`/api/notifications/watches/${authorId}`, { method: "DELETE" }).catch(() => {});
  }

  async function markRead(id: string) {
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    await fetch(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => {});
  }

  const watchedIds = new Set(watches.map((w) => w.author_id));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-600/15 flex items-center justify-center">
          <Bell className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Watch specific writers — we check once a day and email you when they publish something new.
          </p>
        </div>
      </div>

      {/* Author picker */}
      <div className="border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium">Watch a writer</p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <input
            placeholder="Search prospects by name or publication…"
            className="w-full h-9 rounded-md border border-input bg-background pl-8 pr-8 text-sm outline-none"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
          />
        </div>
        {query.trim().length >= 2 && (
          <div className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border">
            {results.length === 0 && !searching ? (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">No matching prospects</p>
            ) : (
              results.map((r: any) => {
                const already = watchedIds.has(r.author.id);
                return (
                  <div key={r.author.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{r.author.full_name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{r.domain?.name ?? r.domain?.host ?? "—"}</p>
                    </div>
                    <Button
                      size="sm" variant={already ? "ghost" : "outline"}
                      className="h-7 px-2 text-xs shrink-0"
                      disabled={already || addingId === r.author.id}
                      onClick={() => addWatch(r.author.id)}
                    >
                      {addingId === r.author.id ? <Loader2 className="h-3 w-3 animate-spin" /> : already ? <><CheckCircle2 className="h-3 w-3 mr-1" />Watching</> : "Watch"}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Watch list */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Watching ({watches.length})</p>
        {loading ? (
          <div className="flex items-center justify-center h-16 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading...</div>
        ) : watches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not watching anyone yet — search above to add a writer.</p>
        ) : (
          <div className="border border-border rounded-xl divide-y divide-border">
            {watches.map((w) => {
              const hasPage = (w.author.contacts ?? []).some((c) => c.type === "author_page");
              const result = testResults[w.author_id];
              const isTesting = testingId === w.author_id;
              return (
                <div key={w.author_id}>
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <button onClick={() => openAuthor(w.author_id)} className="text-sm font-medium hover:text-violet-400 hover:underline truncate text-left">
                        {w.author.full_name}
                      </button>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {w.author.domain?.name ?? w.author.domain?.host ?? "—"} · checked {timeAgo(w.last_checked_at)}
                        {!hasPage && " · no known page to check yet"}
                      </p>
                    </div>
                    <Button
                      variant="outline" size="sm" className="h-7 px-2 text-xs shrink-0 gap-1"
                      onClick={() => testWatcher(w.author_id)}
                      disabled={isTesting}
                      title="Run the same daily check right now, for just this writer"
                    >
                      {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                      Test watcher
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => removeWatch(w.author_id)} title="Stop watching">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Verbose test result */}
                  {result && (
                    <div className="px-4 pb-3 -mt-0.5 text-xs space-y-2 bg-muted/20">
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">{result.website ?? "Unknown website"}</span>
                        {result.checked ? (
                          <> — checked <a href={result.authorPageUrl!} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">{result.authorPageUrl}</a></>
                        ) : (
                          <span className="text-amber-500"> — no known page on file to check</span>
                        )}
                      </p>
                      <p className="text-muted-foreground">
                        {result.newArticlesFound > 0
                          ? <span className="text-green-400">{result.newArticlesFound} new article(s) found — {result.notified} notified, {result.emailed} emailed</span>
                          : result.checked ? "No new articles — everything on their page is already on file." : null}
                      </p>
                      {result.newArticles.length > 0 && (
                        <div className="space-y-1 pl-3 border-l-2 border-green-500/30">
                          {result.newArticles.map((a) => (
                            <p key={a.url}>
                              <a href={a.url} target="_blank" rel="noreferrer" className="text-foreground hover:underline inline-flex items-center gap-1">
                                {a.title ?? a.url}<ExternalLink className="h-2.5 w-2.5 opacity-50" />
                              </a>
                              <span className="text-muted-foreground"> · {fmtDate(a.publishedAt)}</span>
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="text-muted-foreground pt-1 border-t border-border/50">
                        <span className="uppercase tracking-wide text-[10px] font-semibold">Latest on file</span>{" "}
                        {result.latestArticle ? (
                          <>
                            <a href={result.latestArticle.url} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
                              {result.latestArticle.title ?? result.latestArticle.url}
                            </a>
                            <span> · {fmtDate(result.latestArticle.publishedAt)}</span>
                          </>
                        ) : "no articles on file for them yet"}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notification feed */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Recent activity</p>
        {notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No new content yet from anyone you're watching.</p>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`border rounded-lg px-4 py-3 flex items-start gap-3 ${n.read_at ? "border-border" : "border-violet-500/40 bg-violet-500/5"}`}
                onClick={() => !n.read_at && markRead(n.id)}
              >
                <FileText className={`h-4 w-4 shrink-0 mt-0.5 ${n.read_at ? "text-muted-foreground" : "text-violet-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{n.author.full_name}</span> posted new content
                  </p>
                  <a href={n.article.url_canonical} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sm text-violet-400 hover:underline truncate block">
                    {n.article.title ?? n.article.url_canonical}
                  </a>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                {!n.read_at && <Eye className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {drawer}
    </div>
  );
}
