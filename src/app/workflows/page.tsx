"use client";

import { useEffect, useState, useCallback } from "react";
import { GitBranch, Plus, Loader2, Play, CheckCircle2, Filter, Search, ChevronRight, Link2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Workflow, Campaign, WorkflowProspect, WorkflowFilters } from "@/lib/types";
import { isGuessSource } from "@/lib/enrich/personFilter";

function StatusBadge({ status }: { status: Workflow["status"] }) {
  if (status === "ready") return <Badge className="bg-green-500/15 text-green-400 border-green-500/30 hover:bg-green-500/15">Ready</Badge>;
  if (status === "running") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15"><Loader2 className="h-3 w-3 animate-spin mr-1" />Running</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Draft</Badge>;
}

const ARCHETYPES = ["", "listicle", "review", "comparison", "tutorial", "opinion", "roundup"];

interface ScoreStats { count: number; min: number; max: number; avg: number; median: number }

function FilterPanel({ filters, onChange, stats }: { filters: WorkflowFilters; onChange: (f: WorkflowFilters) => void; stats?: ScoreStats | null }) {
  return (
    <div className="space-y-4 p-4 border border-border rounded-xl bg-muted/20">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Filter className="h-3.5 w-3.5" />Filters
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Min score</Label>
          <Input
            type="number"
            min={0} max={100}
            placeholder="0"
            value={filters.minScore ?? ""}
            onChange={(e) => onChange({ ...filters, minScore: e.target.value ? Number(e.target.value) : undefined })}
          />
          {stats && stats.count > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground pt-0.5">
              <span>low <span className="text-foreground tabular-nums">{stats.min}</span></span>
              <span>median <span className="text-foreground tabular-nums">{stats.median}</span></span>
              <span>avg <span className="text-foreground tabular-nums">{stats.avg}</span></span>
              <span>high <span className="text-foreground tabular-nums">{stats.max}</span></span>
              <span className="w-full text-muted-foreground/60">across {stats.count.toLocaleString()} scored prospects</span>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max prospects</Label>
          <Input
            type="number"
            min={1}
            placeholder="200"
            value={filters.limit ?? ""}
            onChange={(e) => onChange({ ...filters, limit: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Article type</Label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filters.archetype ?? ""}
            onChange={(e) => onChange({ ...filters, archetype: e.target.value || undefined })}
          >
            {ARCHETYPES.map((a) => <option key={a} value={a}>{a || "Any"}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Email</Label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filters.emailStatus ?? "any"}
            onChange={(e) => onChange({ ...filters, emailStatus: (e.target.value as WorkflowFilters["emailStatus"]) || undefined })}
          >
            <option value="any">Any</option>
            <option value="has">Has email</option>
            <option value="verified">Found / sourced</option>
            <option value="guessed">Guessed (pattern)</option>
            <option value="none">No email</option>
            <option value="linkedin_no_email">Has LinkedIn, no email</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Sort direction</Label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={filters.sortDir ?? "desc"}
            onChange={(e) => onChange({ ...filters, sortDir: e.target.value as "asc" | "desc" })}
          >
            <option value="desc">Highest score first</option>
            <option value="asc">Lowest score first</option>
          </select>
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Tool filter</Label>
          <Input
            placeholder="e.g. Midjourney"
            value={filters.tool ?? ""}
            onChange={(e) => onChange({ ...filters, tool: e.target.value || undefined })}
          />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <Checkbox
            id="has-contact"
            checked={!!filters.hasContact}
            onCheckedChange={(v) => onChange({ ...filters, hasContact: v === true || undefined })}
          />
          <Label htmlFor="has-contact" className="text-xs cursor-pointer">Has email address</Label>
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <Checkbox
            id="not-contacted"
            checked={!!filters.notContacted}
            onCheckedChange={(v) => onChange({ ...filters, notContacted: v === true || undefined })}
          />
          <Label htmlFor="not-contacted" className="text-xs cursor-pointer">Only not-yet-emailed prospects</Label>
        </div>
      </div>
    </div>
  );
}

function ProspectRow({
  p,
  onToggle,
}: {
  p: WorkflowProspect;
  onToggle: (authorId: string, included: boolean) => void;
}) {
  const score = p.score?.composite ?? null;
  const pub = p.domain?.name ?? p.domain?.host ?? "Unknown";
  const email = p.contacts?.find((c) => c.type === "mailto");
  const emailGuess = isGuessSource(email?.source);
  const li = p.contacts?.find((c) => c.type === "linkedin");
  const liUrl = li ? (li.value.startsWith("http") ? li.value : `https://${li.value}`) : null;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${!p.included ? "opacity-50" : ""}`}>
      <Checkbox
        checked={p.included}
        onCheckedChange={(v) => onToggle(p.author_id, v === true)}
      />
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={p.author?.avatar_url ?? undefined} />
        <AvatarFallback className="bg-violet-600 text-white text-xs font-semibold">
          {p.author?.full_name?.slice(0, 2)?.toUpperCase() ?? "??"}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{p.author?.full_name ?? "Unknown"}</p>
        <p className="text-xs text-muted-foreground truncate">{pub}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {liUrl && (
          <a href={liUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
            className="text-[#0a66c2] hover:text-[#0a66c2]/80" title={liUrl.replace(/^https?:\/\/(www\.)?/, "")}>
            <Link2 className="h-3.5 w-3.5" />
          </a>
        )}
        {email && (
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${emailGuess ? "text-amber-400 border-amber-500/40" : "text-green-400 border-green-500/30"}`}>
            {emailGuess ? "email · guess" : "email"}
          </Badge>
        )}
        {score !== null && (
          <span className={`text-xs font-mono font-semibold w-8 text-right ${score >= 70 ? "text-green-400" : score >= 40 ? "text-amber-400" : "text-muted-foreground"}`}>
            {score}
          </span>
        )}
        <span className="text-xs text-muted-foreground w-4 text-right">#{p.rank}</span>
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", campaign_id: "" });
  const [saving, setSaving] = useState(false);

  // Selected workflow detail
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [prospects, setProspects] = useState<WorkflowProspect[]>([]);
  const [total, setTotal] = useState(0);
  const [prospectsLoading, setProspectsLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [filters, setFilters] = useState<WorkflowFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [scoreStats, setScoreStats] = useState<ScoreStats | null>(null);

  // Search-and-add: query ALL prospects (server-side) and add individuals to this workflow.
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<any[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  async function fetchAll() {
    setLoading(true);
    const [wRes, cRes] = await Promise.all([fetch("/api/workflows"), fetch("/api/campaigns")]);
    if (wRes.ok) setWorkflows(await wRes.json());
    if (cRes.ok) setCampaigns(await cRes.json());
    setLoading(false);
  }

  useEffect(() => { fetchAll(); }, []);

  async function fetchProspects(wf: Workflow) {
    setProspectsLoading(true);
    const res = await fetch(`/api/workflows/${wf.id}/prospects?limit=200`);
    if (res.ok) {
      const data = await res.json();
      setProspects(data.prospects ?? []);
      setTotal(data.total ?? 0);
    }
    setProspectsLoading(false);
  }

  function selectWorkflow(wf: Workflow) {
    setSelected(wf);
    setFilters(wf.filters ?? {});
    setSearch("");
    setScoreStats(null);
    fetchProspects(wf);
    fetch(`/api/score-stats${wf.campaign_id ? `?campaign_id=${wf.campaign_id}` : ""}`)
      .then((r) => r.ok ? r.json() : null).then(setScoreStats).catch(() => {});
  }

  async function handleCreate() {
    if (!form.name) return;
    setSaving(true);
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, campaign_id: form.campaign_id || undefined, filters: {} }),
    });
    if (res.ok) {
      const wf = await res.json();
      setCreating(false);
      setForm({ name: "", campaign_id: "" });
      await fetchAll();
      selectWorkflow(wf);
    }
    setSaving(false);
  }

  async function runWorkflow() {
    if (!selected) return;
    setRunning(true);

    // Save updated filters first
    await fetch(`/api/workflows/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters }),
    });

    const res = await fetch(`/api/workflows/${selected.id}/run`, { method: "POST" });
    if (res.ok) {
      const { count } = await res.json();
      setSelected((s) => s ? { ...s, status: "ready", prospect_count: count } : s);
      fetchProspects(selected);
      setWorkflows((ws) => ws.map((w) => w.id === selected.id ? { ...w, status: "ready", prospect_count: count } : w));
    }
    setRunning(false);
  }

  async function toggleProspect(authorId: string, included: boolean) {
    if (!selected) return;
    setProspects((ps) => ps.map((p) => p.author_id === authorId ? { ...p, included } : p));
    await fetch(`/api/workflows/${selected.id}/prospects/${authorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ included }),
    });
  }

  // Search ALL prospects server-side (same index as the Prospects page) to add individuals.
  async function runAddSearch(q: string) {
    setAddQuery(q);
    if (q.trim().length < 2) { setAddResults([]); return; }
    setAddSearching(true);
    const res = await fetch(`/api/prospects?search=${encodeURIComponent(q)}&limit=15`).then((r) => r.ok ? r.json() : null).catch(() => null);
    setAddResults(res?.prospects ?? []);
    setAddSearching(false);
  }

  async function addToWorkflow(authorId: string) {
    if (!selected) return;
    setAddingId(authorId);
    await fetch(`/api/workflows/${selected.id}/prospects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author_id: authorId }),
    }).catch(() => {});
    setAddingId(null);
    await fetchProspects(selected);
  }

  const filteredProspects = prospects.filter((p) => {
    if (!search) return true;
    const name = p.author?.full_name?.toLowerCase() ?? "";
    const pub = (p.domain?.name ?? p.domain?.host ?? "").toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || pub.includes(q);
  });

  const includedCount = prospects.filter((p) => p.included).length;

  // Group workflows by campaign
  const grouped = campaigns
    .filter((c) => workflows.some((w) => w.campaign_id === c.id))
    .map((c) => ({ campaign: c, items: workflows.filter((w) => w.campaign_id === c.id) }));
  const uncampaigned = workflows.filter((w) => !w.campaign_id);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border flex flex-col shrink-0 overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold">Workflows</p>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading...
            </div>
          ) : (
            <>
              {grouped.map(({ campaign, items }) => (
                <div key={campaign.id}>
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{campaign.name}</p>
                  {items.map((wf) => (
                    <button
                      key={wf.id}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2 group ${selected?.id === wf.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70"}`}
                      onClick={() => selectWorkflow(wf)}
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0 opacity-50" />
                      <span className="flex-1 truncate">{wf.name}</span>
                      {wf.prospect_count ? <span className="text-xs text-muted-foreground">{wf.prospect_count}</span> : null}
                    </button>
                  ))}
                </div>
              ))}
              {uncampaigned.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">No campaign</p>
                  {uncampaigned.map((wf) => (
                    <button
                      key={wf.id}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2 ${selected?.id === wf.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70"}`}
                      onClick={() => selectWorkflow(wf)}
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0 opacity-50" />
                      <span className="flex-1 truncate">{wf.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {workflows.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No workflows yet
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground flex-col gap-3">
            <GitBranch className="h-8 w-8 opacity-20" />
            <p className="text-sm">Select a workflow from the sidebar, or create a new one</p>
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-1.5" />New Workflow
            </Button>
          </div>
        ) : (
          <>
            {/* Workflow header */}
            <div className="border-b border-border px-6 py-4 flex items-center gap-4 shrink-0">
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{selected.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selected.campaign?.name ?? "No campaign"} · {total} prospects · <StatusBadge status={selected.status} />
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(true)}
              >
                <Filter className="h-3.5 w-3.5 mr-1.5" />
                Filters
              </Button>
              <Button
                size="sm"
                onClick={runWorkflow}
                disabled={running}
              >
                {running ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Running...</> : <><Play className="h-3.5 w-3.5 mr-1.5" />Run Workflow</>}
              </Button>
            </div>

            {/* Prospect controls */}
            <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by name or publication..."
                  className="pl-8 h-8 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {/* Search-and-add individual prospects from the whole database */}
              <div className="relative">
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { setAddOpen((o) => !o); setAddQuery(""); setAddResults([]); }}>
                  <UserPlus className="h-3.5 w-3.5" />Add prospect
                </Button>
                {addOpen && (
                  <div className="absolute z-40 mt-1 right-0 w-80 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
                    <div className="relative border-b border-border">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      {addSearching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      <input
                        autoFocus
                        placeholder="Search all prospects by name or publication…"
                        className="w-full h-9 bg-transparent pl-8 pr-8 text-sm outline-none"
                        value={addQuery}
                        onChange={(e) => runAddSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                      {addQuery.trim().length < 2 ? (
                        <p className="px-3 py-3 text-xs text-muted-foreground text-center">Type at least 2 characters</p>
                      ) : addResults.length === 0 && !addSearching ? (
                        <p className="px-3 py-3 text-xs text-muted-foreground text-center">No matching prospects</p>
                      ) : (
                        addResults.map((r: any) => {
                          const inWf = prospects.some((p) => p.author_id === r.author.id && p.included);
                          const mail = (r.contacts ?? []).find((c: any) => c.type === "mailto");
                          return (
                            <div key={r.author.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm truncate">{r.author.full_name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {r.domain?.name ?? r.domain?.host ?? "—"}{mail ? " · has email" : ""}
                                </p>
                              </div>
                              <Button
                                size="sm" variant={inWf ? "ghost" : "outline"}
                                className="h-7 px-2 text-xs shrink-0"
                                disabled={inWf || addingId === r.author.id}
                                onClick={() => addToWorkflow(r.author.id)}
                              >
                                {addingId === r.author.id ? <Loader2 className="h-3 w-3 animate-spin" /> : inWf ? <><CheckCircle2 className="h-3 w-3 mr-1" />Added</> : "Add"}
                              </Button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground ml-auto">
                {includedCount} of {prospects.length} selected
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={prospects.length === 0}
                onClick={() => {
                  const allIncluded = prospects.length > 0 && prospects.every((p) => p.included);
                  prospects.forEach((p) => toggleProspect(p.author_id, !allIncluded));
                }}
              >
                {prospects.length > 0 && prospects.every((p) => p.included) ? "Deselect all" : "Select all"}
              </Button>
            </div>

            {/* Prospect list */}
            <div className="flex-1 overflow-y-auto">
              {prospectsLoading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading prospects...
                </div>
              ) : filteredProspects.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm flex-col gap-2">
                  {prospects.length === 0 ? (
                    <>
                      <p>No prospects yet — run the workflow to generate them</p>
                      <Button size="sm" onClick={runWorkflow} disabled={running}>
                        <Play className="h-3.5 w-3.5 mr-1.5" />Run Workflow
                      </Button>
                    </>
                  ) : (
                    <p>No results match your search</p>
                  )}
                </div>
              ) : (
                <div>
                  {filteredProspects.map((p) => (
                    <ProspectRow key={p.id} p={p} onToggle={toggleProspect} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create workflow dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Workflow name</Label>
              <Input
                placeholder="e.g. Top 100 Image Gen Writers"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Campaign (optional)</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={form.campaign_id}
                onChange={(e) => setForm(f => ({ ...f, campaign_id: e.target.value }))}
              >
                <option value="">All prospects (no campaign filter)</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filter Sheet */}
      <Sheet open={showFilters} onOpenChange={setShowFilters}>
        <SheetContent side="right" className="w-80">
          <SheetHeader>
            <SheetTitle>Workflow Filters</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <FilterPanel filters={filters} onChange={setFilters} stats={scoreStats} />
            <Button
              className="w-full"
              onClick={() => { setShowFilters(false); runWorkflow(); }}
              disabled={running}
            >
              {running ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Running...</> : <><Play className="h-4 w-4 mr-1.5" />Apply & Run</>}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
