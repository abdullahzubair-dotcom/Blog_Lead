"use client";

import { useEffect, useState } from "react";
import { Megaphone, Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Campaign } from "@/lib/types";

function StatusBadge({ status }: { status: Campaign["status"] }) {
  if (status === "done") return <Badge className="bg-green-500/15 text-green-400 border-green-500/30 hover:bg-green-500/15">Done</Badge>;
  if (status === "running") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15"><Loader2 className="h-3 w-3 animate-spin mr-1" />Running</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Draft</Badge>;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", keywordInput: "", keywords: [] as string[] });
  const [saving, setSaving] = useState(false);

  async function fetchCampaigns() {
    setLoading(true);
    const res = await fetch("/api/campaigns");
    if (res.ok) setCampaigns(await res.json());
    setLoading(false);
  }

  useEffect(() => { fetchCampaigns(); }, []);

  function addKeyword() {
    const kw = form.keywordInput.trim().toLowerCase();
    if (!kw || form.keywords.includes(kw)) { setForm(f => ({ ...f, keywordInput: "" })); return; }
    setForm(f => ({ ...f, keywords: [...f.keywords, kw], keywordInput: "" }));
  }

  function removeKeyword(kw: string) {
    setForm(f => ({ ...f, keywords: f.keywords.filter(k => k !== kw) }));
  }

  async function handleCreate() {
    if (!form.name || !form.keywords.length) return;
    setSaving(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, keywords: form.keywords }),
    });
    if (res.ok) {
      setCreating(false);
      setForm({ name: "", keywordInput: "", keywords: [] });
      fetchCampaigns();
    }
    setSaving(false);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-600/15 flex items-center justify-center">
            <Megaphone className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Campaigns</h1>
            <p className="text-sm text-muted-foreground">
              Create campaigns with keywords, then select them in the Discovery dropdown on the Prospects page.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Campaign
        </Button>
      </div>

      {/* Campaign grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading campaigns...
        </div>
      ) : campaigns.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
          <Megaphone className="h-8 w-8 opacity-30" />
          <p className="text-sm">No campaigns yet — create one, then select it when running discovery</p>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />Create Campaign
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <div key={c.id} className="border border-border rounded-xl p-5 bg-card flex flex-col gap-4 hover:border-violet-500/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </div>

              {/* Keywords */}
              <div className="flex flex-wrap gap-1.5">
                {c.keywords.map((kw) => (
                  <span key={kw} className="text-xs bg-violet-500/10 text-violet-300 border border-violet-500/20 px-2 py-0.5 rounded-full">
                    {kw}
                  </span>
                ))}
                {c.keywords.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">No keywords — uses global seeds</span>
                )}
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-auto">
                <span><span className="font-semibold text-foreground">{c.author_count ?? 0}</span> authors</span>
                <span><span className="font-semibold text-foreground">{c.target_hits.toLocaleString()}</span> target hits</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Campaign Dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Campaign name</Label>
              <Input
                placeholder="e.g. Image Generation Q3"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Keywords</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. image generation"
                  value={form.keywordInput}
                  onChange={(e) => setForm(f => ({ ...f, keywordInput: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                />
                <Button type="button" variant="outline" onClick={addKeyword} disabled={!form.keywordInput.trim()}>
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Press Enter or click Add. These focus what writers get discovered when you select this campaign in the discovery dropdown.
              </p>
              {form.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.keywords.map((kw) => (
                    <span key={kw} className="flex items-center gap-1 text-xs bg-violet-500/10 text-violet-300 border border-violet-500/20 px-2 py-0.5 rounded-full">
                      {kw}
                      <button onClick={() => removeKeyword(kw)} className="hover:text-red-400 transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name || !form.keywords.length || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
