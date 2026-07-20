"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, BookOpen, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface PricingRule { min_dr?: number; min_traffic?: number; min_us_share?: number; max_offer: number; label?: string }
interface Settings {
  ai_autonomy: boolean; handbook: string; tone: string; max_thread_length: number;
  min_price: number; currency: string; anti_highball: string; pricing_rules: PricingRule[];
}

export default function HandbookPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/negotiation/settings").then((r) => r.json()).then((d) => { setS(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => (p ? { ...p, [k]: v } : p));
  const setRule = (i: number, patch: Partial<PricingRule>) =>
    setS((p) => (p ? { ...p, pricing_rules: p.pricing_rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : p));
  const addRule = () => setS((p) => (p ? { ...p, pricing_rules: [...p.pricing_rules, { min_dr: 50, min_traffic: 10000, min_us_share: 50, max_offer: 100, label: "" }] } : p));
  const delRule = (i: number) => setS((p) => (p ? { ...p, pricing_rules: p.pricing_rules.filter((_, j) => j !== i) } : p));

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const res = await fetch("/api/negotiation/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      if (!res.ok) throw new Error((await res.json()).error ?? "save failed");
      setS(await res.json());
      toast.success("Handbook saved");
    } catch (e: any) { toast.error(e?.message ?? "save failed"); }
    finally { setSaving(false); }
  };

  if (loading || !s) {
    return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-heading font-semibold flex items-center gap-2"><BookOpen className="h-5 w-5" /> Email Handbook</h1>
          <p className="text-sm text-muted-foreground mt-0.5">The single brief your AI negotiator follows — goals, tone, limits, and price.</p>
        </div>
        <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
          {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save
        </Button>
      </div>

      {/* Master autonomy toggle */}
      <Card className={s.ai_autonomy ? "border-amber-500/40" : ""}>
        <CardContent className="p-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label className="flex items-center gap-2 text-sm font-medium"><ShieldAlert className={`h-4 w-4 ${s.ai_autonomy ? "text-amber-500" : "text-muted-foreground"}`} />AI autonomy</Label>
            <p className="text-xs text-muted-foreground max-w-xl">
              When <b>off</b> (recommended), the AI <b>drafts</b> every negotiation reply and waits for you to approve and send it.
              When <b>on</b>, the AI sends replies on its own within these rules. Hard-no's and unsubscribes are never auto-sent.
            </p>
          </div>
          <Switch checked={s.ai_autonomy} onCheckedChange={(v) => set("ai_autonomy", v)} />
        </CardContent>
      </Card>

      {/* Negotiation brief */}
      <Card>
        <CardHeader><CardTitle className="text-base">Negotiation brief</CardTitle><CardDescription>What we want, and how to get there. This is the core instruction the model reads.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Goal & criteria</Label>
            <Textarea rows={5} value={s.handbook} onChange={(e) => set("handbook", e.target.value)} placeholder="e.g. Get ImagineArt featured in their article…" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Tone</Label>
            <Input value={s.tone} onChange={(e) => set("tone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Handling high openers (anti-highball)</Label>
            <Textarea rows={2} value={s.anti_highball} onChange={(e) => set("anti_highball", e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Max messages / thread</Label>
              <Input type="number" min={1} value={s.max_thread_length} onChange={(e) => set("max_thread_length", parseInt(e.target.value) || 1)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Min price (floor)</Label>
              <Input type="number" min={0} value={s.min_price} onChange={(e) => set("min_price", parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Currency</Label>
              <Input value={s.currency} onChange={(e) => set("currency", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pricing tiers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricing tiers</CardTitle>
          <CardDescription>The most we&apos;ll offer, by the site&apos;s Domain Rating and US traffic. The negotiator uses the highest tier a site qualifies for and never exceeds it. Metrics we can&apos;t verify yet (traffic/US) don&apos;t block a tier.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_1fr_1.4fr_auto] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground px-1">
            <span>Min DR</span><span>Min traffic</span><span>Min US %</span><span>Max offer ({s.currency})</span><span>Label</span><span />
          </div>
          {s.pricing_rules.map((r, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_1.4fr_auto] gap-2 items-center">
              <Input type="number" value={r.min_dr ?? ""} onChange={(e) => setRule(i, { min_dr: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="—" />
              <Input type="number" value={r.min_traffic ?? ""} onChange={(e) => setRule(i, { min_traffic: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="—" />
              <Input type="number" value={r.min_us_share ?? ""} onChange={(e) => setRule(i, { min_us_share: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="—" />
              <Input type="number" value={r.max_offer} onChange={(e) => setRule(i, { max_offer: Number(e.target.value) })} />
              <Input value={r.label ?? ""} onChange={(e) => setRule(i, { label: e.target.value })} placeholder="label" />
              <Button variant="ghost" size="icon-sm" onClick={() => delRule(i)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRule}><Plus className="h-4 w-4 mr-1" />Add tier</Button>
          {s.pricing_rules.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Current default: <Badge variant="secondary" className="font-normal">up to {s.currency} {Math.max(...s.pricing_rules.map((r) => r.max_offer))}</Badge> for the top tier.
              Sites below every tier get a placement-only ask (no money offered).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
