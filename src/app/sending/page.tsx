"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Play, Globe, Edit2, Ban, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface StatusEmail {
  id: string;
  author_name: string;
  publication: string;
  subject: string;
  status: string;
  scheduled_at?: string;
  sent_at?: string;
  error?: string;
  tz: string;
  local_label: string | null;
  guess?: boolean;
}

interface Status {
  counts: Record<string, number>;
  upcoming: StatusEmail[];
  recent: StatusEmail[];
  total: number;
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className={`text-3xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function sentLabel(iso?: string): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

export default function SendingPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null); // live clock (client-only, ticks every 1s)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const tzAbbr = now
    ? new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value
    : "";

  // Edit-a-queued-email sheet
  const [editing, setEditing] = useState<StatusEmail | null>(null);
  const [editForm, setEditForm] = useState({ subject: "", body: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetch("/api/emails/status").then((r) => r.json());
      setStatus(data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 5000); // live-poll every 5s
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  async function processNow() {
    setProcessing(true);
    try {
      const res = await fetch("/api/emails/process", { method: "POST" });
      const data = await res.json();
      if (res.ok) toast.success(data.skipped ? "A send run is already in progress." : `Processed — ${data.sent} sent of ${data.due} due.`);
      else toast.error(data.error ?? "Processing failed");
      await load();
    } catch { toast.error("Processing failed"); }
    setProcessing(false);
  }

  // Cancel a queued email — back to "ready", removed from the send queue.
  async function cancelScheduled(e: StatusEmail) {
    setCancelling(e.id);
    await fetch(`/api/emails/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ready", scheduled_at: null }),
    }).catch(() => {});
    setCancelling(null);
    toast.info(`Unscheduled — ${e.author_name} won't be sent until you re-schedule.`);
    await load();
  }

  async function openEditor(e: StatusEmail) {
    setEditing(e);
    setEditForm({ subject: e.subject ?? "", body: "" });
    setEditLoading(true);
    const full = await fetch(`/api/emails/${e.id}`).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (full) setEditForm({ subject: full.subject ?? "", body: full.body ?? "" });
    setEditLoading(false);
  }

  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    await fetch(`/api/emails/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    }).catch(() => {});
    setSavingEdit(false);
    setEditing(null);
    toast.success("Email updated — the queued version will send with your changes.");
    await load();
  }

  const c = status?.counts ?? {};
  const scheduled = c.scheduled ?? 0;
  const sent = c.sent ?? 0;
  const failed = c.failed ?? 0;
  const nextUp = status?.upcoming?.[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Send className="h-7 w-7 text-violet-500" />
            Sending
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Emails drip out automatically at each recipient&apos;s local time. This page updates live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {now && (
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm tabular-nums" title="Your current local time — queued sends fire at each recipient's local time">
              <Clock className="h-3.5 w-3.5 text-violet-400" />
              <span className="font-medium">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className="text-xs text-muted-foreground">{tzAbbr}</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={processNow} disabled={processing} className="gap-1.5" title="Send any emails that are due right now">
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Process due now
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Scheduled" value={scheduled} color="text-blue-400" />
        <Stat label="Sent" value={sent} color="text-green-400" />
        <Stat label="Failed" value={failed} color="text-red-400" />
        <Stat label="Drafts / ready" value={(c.draft ?? 0) + (c.ready ?? 0)} color="text-muted-foreground" />
      </div>

      {/* Automation status banner */}
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-5 py-3 flex items-center gap-3 text-sm">
        <Globe className="h-4 w-4 text-violet-400 shrink-0" />
        {scheduled > 0 ? (
          <span>
            <span className="font-semibold text-foreground">{scheduled}</span> queued ·
            <span className="text-green-400 font-semibold"> {sent}</span> already sent.
            {nextUp?.local_label && <> Next: <span className="text-foreground">{nextUp.author_name}</span> at <span className="text-foreground">{nextUp.local_label}</span> (their time).</>}
            {" "}A scheduler checks for due emails on a schedule and sends them automatically.
          </span>
        ) : (
          <span className="text-muted-foreground">Nothing scheduled. Generate emails in a workflow, then hit “Send All”.</span>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Upcoming queue — cancel or edit before they go out */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-blue-400" />Queued — not yet sent ({scheduled})
          </div>
          <div className="max-h-[520px] overflow-y-auto divide-y divide-border">
            {(status?.upcoming ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No emails scheduled</p>
            ) : (
              status!.upcoming.map((e) => (
                <div key={e.id} className="px-4 py-3 flex items-center gap-3 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5">
                      {e.author_name}
                      {e.guess && <span className="text-[9px] uppercase tracking-wide text-amber-500 border border-amber-500/40 rounded px-1 shrink-0">guess</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{e.subject || e.publication}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-blue-400">{e.local_label}</p>
                    <p className="text-[10px] text-muted-foreground">{e.tz.split("/").pop()?.replace("_", " ")}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Edit this email" onClick={() => openEditor(e)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400" title="Cancel — remove from queue"
                      disabled={cancelling === e.id} onClick={() => cancelScheduled(e)}>
                      {cancelling === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent activity — who's been emailed */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-green-400" />Sent &amp; failed
          </div>
          <div className="max-h-[520px] overflow-y-auto divide-y divide-border">
            {(status?.recent ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing sent yet</p>
            ) : (
              status!.recent.map((e) => (
                <div key={e.id} className="px-4 py-3 flex items-center gap-3">
                  {e.status === "sent"
                    ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.author_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {e.status === "failed" ? <span className="text-red-400">{e.error}</span> : (e.subject || e.publication)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant="outline" className={`text-[10px] ${e.status === "sent" ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"}`}>
                      {e.status}
                    </Badge>
                    {e.status === "sent" && e.sent_at && <p className="text-[10px] text-muted-foreground mt-0.5">{sentLabel(e.sent_at)}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit-a-queued-email sheet */}
      <Sheet open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 gap-0 overflow-hidden">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <SheetTitle>Edit queued email</SheetTitle>
            {editing && <p className="text-sm text-muted-foreground">{editing.author_name} · sends {editing.local_label} ({editing.tz.split("/").pop()?.replace("_", " ")})</p>}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {editLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Subject</Label>
                  <Input value={editForm.subject} onChange={(e) => setEditForm((f) => ({ ...f, subject: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Body</Label>
                  <Textarea className="min-h-[320px] font-mono text-sm" value={editForm.body} onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))} />
                </div>
              </>
            )}
          </div>
          <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit || editLoading}>
              {savingEdit && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              <Check className="h-4 w-4 mr-1.5" />Save Changes
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
