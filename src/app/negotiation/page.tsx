"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Bot, BookOpen, Sparkles, RefreshCw, ShieldAlert, ChevronDown, ChevronRight, Send, Trash2, Play } from "lucide-react";
import { toast } from "sonner";

interface Thread {
  id: string; authorId: string; name: string; publication: string; host: string;
  dr: number | null; ceiling: number | null; category: string; status: string | null;
  replyKind: string | null; sentiment: string | null; negotiationStatus: string | null;
  aiManaged: boolean; subject: string; replyExcerpt: string | null;
  draftStatus: string | null; draftBody: string | null;
}
interface Msg { from: "us" | "them"; body: string; at: string | null }

const CATS = [
  { key: "queued", label: "Queued" },
  { key: "needs_reply", label: "Needs reply" },
  { key: "negotiating", label: "Negotiating" },
  { key: "agreed", label: "Agreed" },
  { key: "hard_no", label: "Hard no" },
  { key: "automated", label: "Automated" },
  { key: "bounced", label: "Bounced" },
];
const SENTIMENT: Record<string, string> = {
  positive: "text-green-500 border-green-500/40 bg-green-500/10",
  negative: "text-red-500 border-red-500/40 bg-red-500/10",
  neutral: "text-muted-foreground",
};

export default function NegotiationPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [autonomy, setAutonomy] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [tab, setTab] = useState("queued");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [priceOpen, setPriceOpen] = useState(false);
  const [useDefaults, setUseDefaults] = useState(true);
  const [priceForm, setPriceForm] = useState({ max_offer: "", criteria: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [convo, setConvo] = useState<Record<string, Msg[]>>({});
  const [editBody, setEditBody] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/negotiation/threads").then((r) => r.json());
      setThreads(d.threads ?? []); setAutonomy(!!d.autonomy); setCurrency(d.currency ?? "USD");
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = threads.filter((t) => t.category === tab);
  const countFor = (k: string) => threads.filter((t) => t.category === k).length;
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllVisible = () => setSel(new Set(rows.map((r) => r.id)));
  const clearSel = () => setSel(new Set());

  const expand = async (t: Thread) => {
    if (open === t.id) { setOpen(null); return; }
    setOpen(t.id);
    if (!convo[t.id]) {
      const d = await fetch(`/api/negotiation/${t.id}`).then((r) => r.json()).catch(() => ({ conversation: [], draft: null }));
      setConvo((c) => ({ ...c, [t.id]: d.conversation ?? [] }));
      if (d.draft?.body && editBody[t.id] === undefined) setEditBody((e) => ({ ...e, [t.id]: d.draft.body }));
    }
    if (t.draftBody && editBody[t.id] === undefined) setEditBody((e) => ({ ...e, [t.id]: t.draftBody as string }));
  };

  const applyAI = async (managed: boolean) => {
    const ids = [...sel];
    if (ids.length === 0) return;
    setBusy("bulk");
    try {
      const payload: any = { ids, managed };
      if (managed && !useDefaults) {
        if (priceForm.max_offer !== "") payload.max_offer = Number(priceForm.max_offer);
        if (priceForm.criteria) payload.criteria = priceForm.criteria;
      }
      await fetch("/api/emails/ai-manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      toast.success(managed ? `AI negotiation enabled for ${ids.length}${useDefaults ? " (Handbook defaults)" : ""}` : `AI turned off for ${ids.length}`);
      setPriceOpen(false); setPriceForm({ max_offer: "", criteria: "" }); clearSel(); load();
    } catch (e: any) { toast.error(e?.message ?? "failed"); } finally { setBusy(null); }
  };

  // Generate the AI reply. Autonomy ON => sends immediately. OFF => saves a draft and opens it.
  const draft = async (t: Thread) => {
    setBusy(t.id);
    try {
      const r = await fetch("/api/negotiation/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailId: t.id }) }).then((x) => x.json());
      if (r.error) { toast.error(r.error); return; }
      if (r.sent) toast.success(`AI replied and sent (${r.statusHint}${r.suggestedOffer ? ", offer " + currency + " " + r.suggestedOffer : ""})`);
      else if (r.sendError) toast.error(`AI drafted but send failed: ${r.sendError}`);
      else if (r.recipientMissing) toast.error("No recipient email on file, saved as draft");
      else toast.success("Draft ready — review and send below");
      setEditBody((e) => ({ ...e, [t.id]: r.body }));
      setConvo((c) => { const n = { ...c }; delete n[t.id]; return n; }); // force reload of conversation
      setOpen(t.id);
      await load();
      if (open === t.id || !r.sent) { const d = await fetch(`/api/negotiation/${t.id}`).then((x) => x.json()).catch(() => ({ conversation: [] })); setConvo((c) => ({ ...c, [t.id]: d.conversation ?? [] })); }
    } catch (e: any) { toast.error(e?.message ?? "failed"); } finally { setBusy(null); }
  };

  // Process now: check for new replies over IMAP and (if autonomy is on) auto-negotiate them,
  // same as the Sending page's button — so you don't have to leave this page to make it run.
  const processNow = async () => {
    setProcessing(true);
    try {
      const r = await fetch("/api/emails/process", { method: "POST" }).then((x) => x.json());
      const rep = r?.replies?.repliesFound ?? 0;
      const neg = r?.negotiations;
      const negTxt = neg && (neg.sent || neg.drafted) ? ` · AI: ${neg.sent} sent, ${neg.drafted} drafted` : "";
      toast.success(`Checked replies (${rep} new)${negTxt}`);
      load();
    } catch { toast.error("Process failed"); } finally { setProcessing(false); }
  };

  const sendOrDiscard = async (t: Thread, action: "send" | "discard") => {
    setBusy(t.id);
    try {
      const r = await fetch(`/api/negotiation/${t.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, body: editBody[t.id] }) }).then((x) => x.json());
      if (r.error) toast.error(r.error);
      else if (action === "send") { toast.success(`Sent to ${r.to}`); setOpen(null); }
      else toast.success("Draft discarded");
      load();
    } catch (e: any) { toast.error(e?.message ?? "failed"); } finally { setBusy(null); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-heading font-semibold flex items-center gap-2"><Bot className="h-5 w-5" /> Negotiation</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Replies triaged by state. The AI negotiates within each site&apos;s DR-based ceiling and your Handbook.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={autonomy ? "text-amber-500 border-amber-500/40 bg-amber-500/10" : "text-muted-foreground"}>
            <ShieldAlert className="h-3 w-3 mr-1" />{autonomy ? "Autonomy ON — AI sends itself" : "Autonomy OFF — AI drafts for approval"}
          </Badge>
          <Button variant="outline" size="sm" disabled={processing} onClick={processNow} title="Check for new replies now and, if autonomy is on, auto-negotiate them">
            {processing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}Process now
          </Button>
          <Link href="/handbook"><Button variant="outline" size="sm"><BookOpen className="h-4 w-4 mr-1.5" />Handbook</Button></Link>
          <Button variant="ghost" size="icon-sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap border-b border-border">
        {CATS.map((c) => (
          <button key={c.key} onClick={() => { setTab(c.key); clearSel(); }}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === c.key ? "border-violet-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {c.label} <span className="text-xs opacity-60">{countFor(c.key)}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 min-h-9">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={selectAllVisible} disabled={rows.length === 0}>Select all ({rows.length})</Button>
          {sel.size > 0 && <Button variant="ghost" size="sm" onClick={clearSel}>Clear ({sel.size})</Button>}
        </div>
        {sel.size > 0 && (
          <div className="flex items-center gap-2">
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setPriceOpen(true)}>
              <Sparkles className="h-4 w-4 mr-1.5" />Enable AI ({sel.size})
            </Button>
            <Button size="sm" variant="outline" disabled={busy === "bulk"} onClick={() => applyAI(false)}>Turn AI off</Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-10 text-sm">Nothing in this bucket.</p>
      ) : (
        <Card><CardContent className="p-0 divide-y divide-border">
          {rows.map((t) => (
            <div key={t.id}>
              <div className="flex items-start gap-3 p-3">
                <Checkbox checked={sel.has(t.id)} onCheckedChange={() => toggle(t.id)} className="mt-1" />
                <button onClick={() => expand(t)} className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0">
                  {open === t.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="flex-1 min-w-0 space-y-1 cursor-pointer" onClick={() => expand(t)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.publication}</span>
                    {t.dr != null && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">DR {Math.round(t.dr)}</Badge>}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{t.ceiling != null ? `≤ ${currency} ${t.ceiling}` : "placement-only"}</Badge>
                    {t.aiManaged && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-violet-400 border-violet-500/40 bg-violet-500/10"><Bot className="h-2.5 w-2.5 mr-0.5" />AI</Badge>}
                    {t.sentiment && <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${SENTIMENT[t.sentiment] ?? ""}`}>{t.sentiment}</Badge>}
                    {t.draftStatus && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{t.draftStatus === "sent" ? "AI replied" : t.draftStatus === "failed" ? "send failed" : "AI draft ready"}</Badge>}
                  </div>
                  {t.replyExcerpt && <p className="text-xs text-muted-foreground line-clamp-2 break-words">&ldquo;{t.replyExcerpt.slice(0, 240)}&rdquo;</p>}
                </div>
                {(t.category === "needs_reply" || t.category === "negotiating") && (
                  <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => draft(t)} className="shrink-0">
                    {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sparkles className="h-4 w-4 mr-1.5" />{t.draftBody ? "Regenerate" : autonomy ? "AI reply" : "Draft AI reply"}</>}
                  </Button>
                )}
                {t.category === "queued" && (
                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    {t.status === "sent" ? "Sent · awaiting reply" : t.status === "scheduled" ? "Queued to send" : (t.status ?? "queued")}
                  </span>
                )}
              </div>

              {open === t.id && (
                <div className="px-4 pb-4 pl-11 space-y-3 bg-muted/20">
                  <div className="pt-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Conversation</p>
                    {(convo[t.id] ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Loading…</p> : (convo[t.id] ?? []).map((m, i) => (
                      <div key={i} className={`text-xs rounded-lg p-2 mb-1.5 max-w-[85%] whitespace-pre-wrap break-words ${m.from === "us" ? "bg-violet-500/10 ml-auto" : "bg-muted"}`}>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{m.from === "us" ? "Us" : t.name}</div>{m.body}
                      </div>
                    ))}
                  </div>
                  {editBody[t.id] !== undefined ? (
                    <div className="space-y-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">AI draft reply (edit before sending)</p>
                      <Textarea rows={7} value={editBody[t.id]} onChange={(e) => setEditBody((s) => ({ ...s, [t.id]: e.target.value }))} className="text-sm" />
                      <div className="flex gap-2">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy === t.id} onClick={() => sendOrDiscard(t, "send")}><Send className="h-4 w-4 mr-1" />Send reply</Button>
                        <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => draft(t)}><RefreshCw className="h-4 w-4 mr-1" />Regenerate</Button>
                        <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => sendOrDiscard(t, "discard")}><Trash2 className="h-4 w-4 mr-1" />Discard</Button>
                      </div>
                    </div>
                  ) : (t.category === "needs_reply" || t.category === "negotiating") ? (
                    <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => draft(t)}><Sparkles className="h-4 w-4 mr-1.5" />Draft AI reply</Button>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </CardContent></Card>
      )}

      <Dialog open={priceOpen} onOpenChange={setPriceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable AI negotiation for {sel.size} thread{sel.size === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>By default the AI uses your Handbook (pricing tiers by DR, tone, lowball strategy). Turn off &ldquo;Use Handbook defaults&rdquo; only if you want to override the price or add notes for this selection.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm">Use Handbook defaults</Label>
              <Switch checked={useDefaults} onCheckedChange={setUseDefaults} />
            </div>
            {!useDefaults && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Max offer override ({currency})</Label>
                  <Input type="number" min={0} placeholder="use pricing tiers" value={priceForm.max_offer} onChange={(e) => setPriceForm((f) => ({ ...f, max_offer: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Criteria / notes for these threads</Label>
                  <Textarea rows={3} placeholder="e.g. only pay for a do-follow link" value={priceForm.criteria} onChange={(e) => setPriceForm((f) => ({ ...f, criteria: e.target.value }))} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceOpen(false)}>Cancel</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white" disabled={busy === "bulk"} onClick={() => applyAI(true)}>
              {busy === "bulk" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Enable AI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
