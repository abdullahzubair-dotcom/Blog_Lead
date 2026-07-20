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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Bot, BookOpen, Sparkles, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface Thread {
  id: string; authorId: string; name: string; publication: string; host: string;
  dr: number | null; ceiling: number | null; category: string;
  replyKind: string | null; sentiment: string | null; negotiationStatus: string | null;
  aiManaged: boolean; subject: string; replyExcerpt: string | null; draftStatus: string | null;
}

const CATS = [
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
  const [tab, setTab] = useState("needs_reply");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceForm, setPriceForm] = useState({ max_offer: "", criteria: "" });
  const [busy, setBusy] = useState<string | null>(null);

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
  const selectedInTab = rows.filter((r) => sel.has(r.id)).length;

  const applyAI = async (managed: boolean) => {
    const ids = [...sel];
    if (ids.length === 0) return;
    setBusy("bulk");
    try {
      await fetch("/api/emails/ai-manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, managed, max_offer: priceForm.max_offer === "" ? undefined : Number(priceForm.max_offer), criteria: priceForm.criteria || undefined }),
      });
      toast.success(managed ? `AI negotiation enabled for ${ids.length}` : `AI turned off for ${ids.length}`);
      setPriceOpen(false); setPriceForm({ max_offer: "", criteria: "" }); clearSel(); load();
    } catch (e: any) { toast.error(e?.message ?? "failed"); } finally { setBusy(null); }
  };

  const draft = async (id: string) => {
    setBusy(id);
    try {
      const r = await fetch("/api/negotiation/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailId: id }) }).then((x) => x.json());
      if (r.error) toast.error(r.error);
      else if (r.autonomy) toast.success(`AI replied automatically (${r.statusHint}, offer ${r.suggestedOffer ? currency + " " + r.suggestedOffer : "none"})`);
      else toast.success(`Draft ready (${r.statusHint}) — approve it on the Sending page`);
      load();
    } catch (e: any) { toast.error(e?.message ?? "failed"); } finally { setBusy(null); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-heading font-semibold flex items-center gap-2"><Bot className="h-5 w-5" /> Negotiation</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Replies triaged by state. Pick threads for the AI to negotiate, using the site&apos;s DR-based price ceiling and your Handbook.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={autonomy ? "text-amber-500 border-amber-500/40 bg-amber-500/10" : "text-muted-foreground"}>
            <ShieldAlert className="h-3 w-3 mr-1" />{autonomy ? "Autonomy ON — AI sends itself" : "Autonomy OFF — AI drafts for approval"}
          </Badge>
          <Link href="/handbook"><Button variant="outline" size="sm"><BookOpen className="h-4 w-4 mr-1.5" />Handbook</Button></Link>
          <Button variant="ghost" size="icon-sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Triage tabs */}
      <div className="flex gap-1 flex-wrap border-b border-border">
        {CATS.map((c) => (
          <button key={c.key} onClick={() => { setTab(c.key); clearSel(); }}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === c.key ? "border-violet-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {c.label} <span className="text-xs opacity-60">{countFor(c.key)}</span>
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      <div className="flex items-center justify-between gap-3 min-h-9">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={selectAllVisible} disabled={rows.length === 0}>Select all ({rows.length})</Button>
          {sel.size > 0 && <Button variant="ghost" size="sm" onClick={clearSel}>Clear ({sel.size})</Button>}
        </div>
        {sel.size > 0 && (
          <div className="flex items-center gap-2">
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setPriceOpen(true)}>
              <Sparkles className="h-4 w-4 mr-1.5" />Enable AI + set price ({sel.size})
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
            <div key={t.id} className="flex items-start gap-3 p-3">
              <Checkbox checked={sel.has(t.id)} onCheckedChange={() => toggle(t.id)} className="mt-1" />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.publication}</span>
                  {t.dr != null && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">DR {Math.round(t.dr)}</Badge>}
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{t.ceiling != null ? `≤ ${currency} ${t.ceiling}` : "placement-only"}</Badge>
                  {t.aiManaged && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-violet-400 border-violet-500/40 bg-violet-500/10"><Bot className="h-2.5 w-2.5 mr-0.5" />AI</Badge>}
                  {t.sentiment && <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${SENTIMENT[t.sentiment] ?? ""}`}>{t.sentiment}</Badge>}
                  {t.draftStatus && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{t.draftStatus === "sent" ? "AI replied" : `AI ${t.draftStatus}`}</Badge>}
                </div>
                {t.replyExcerpt && <p className="text-xs text-muted-foreground line-clamp-2 break-words">&ldquo;{t.replyExcerpt.slice(0, 240)}&rdquo;</p>}
              </div>
              {(t.category === "needs_reply" || t.category === "negotiating") && (
                <Button size="sm" variant="outline" disabled={busy === t.id} onClick={() => draft(t.id)} className="shrink-0">
                  {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sparkles className="h-4 w-4 mr-1.5" />{autonomy ? "AI reply" : "Draft AI reply"}</>}
                </Button>
              )}
            </div>
          ))}
        </CardContent></Card>
      )}

      {/* Pricing / criteria popup */}
      <Dialog open={priceOpen} onOpenChange={setPriceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable AI negotiation for {sel.size} thread{sel.size === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>The AI negotiates within each site&apos;s DR-based ceiling. Override the ceiling and add any per-selection criteria below (optional). Leave the price blank to use the Handbook&apos;s pricing tiers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Max offer override ({currency}) — optional</Label>
              <Input type="number" min={0} placeholder="use pricing tiers" value={priceForm.max_offer} onChange={(e) => setPriceForm((f) => ({ ...f, max_offer: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Criteria / notes for these threads — optional</Label>
              <Textarea rows={3} placeholder="e.g. only pay if they include a do-follow link; push for a dedicated section" value={priceForm.criteria} onChange={(e) => setPriceForm((f) => ({ ...f, criteria: e.target.value }))} />
            </div>
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
