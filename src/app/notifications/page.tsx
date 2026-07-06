"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Bell, Search, Loader2, X, CheckCircle2, FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthorDrawer } from "@/components/prospects/useAuthorDrawer";

interface Watch {
  author_id: string;
  created_at: string;
  last_checked_at: string | null;
  author: { id: string; full_name: string; domain?: { host?: string; name?: string } | null; contacts?: { type: string; value: string }[] };
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
              return (
                <div key={w.author_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <button onClick={() => openAuthor(w.author_id)} className="text-sm font-medium hover:text-violet-400 hover:underline truncate text-left">
                      {w.author.full_name}
                    </button>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {w.author.domain?.name ?? w.author.domain?.host ?? "—"} · checked {timeAgo(w.last_checked_at)}
                      {!hasPage && " · no known page to check yet"}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => removeWatch(w.author_id)} title="Stop watching">
                    <X className="h-3.5 w-3.5" />
                  </Button>
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
