"use client";

import { useEffect, useState, useCallback } from "react";
import { GitBranch, Plus, Loader2, Play, CheckCircle2, Filter, Search, ChevronRight, Link2, UserPlus, Download, Sparkles, Mail, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Workflow, Campaign, WorkflowProspect, WorkflowFilters } from "@/lib/types";
import { isGuessSource } from "@/lib/enrich/personFilter";
import { useAuthorDrawer } from "@/components/prospects/useAuthorDrawer";

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
  onOpen,
  onRemove,
  contacted,
}: {
  p: WorkflowProspect;
  onToggle: (authorId: string, included: boolean) => void;
  onOpen: (authorId: string) => void;
  onRemove?: (authorId: string) => void;
  contacted?: boolean;
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
        <button
          onClick={() => onOpen(p.author_id)}
          className="text-sm font-medium truncate max-w-full text-left hover:text-violet-400 hover:underline"
          title="View profile & articles"
        >
          {p.author?.full_name ?? "Unknown"}
        </button>
        <p className="text-xs text-muted-foreground truncate">{pub}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {contacted && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-400 border-amber-500/40" title="Already emailed/queued in another campaign">
            contacted
          </Badge>
        )}
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
        {onRemove && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(p.author_id); }} title="Remove from workflow" className="text-muted-foreground hover:text-red-400 shrink-0">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [wfSearch, setWfSearch] = useState("");
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
  const [contactedElsewhere, setContactedElsewhere] = useState<Set<string>>(new Set());
  const { openAuthor, drawer } = useAuthorDrawer();

  // Search-and-add: query ALL prospects (server-side) and add individuals to this workflow.
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<any[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  // AI find: describe the writers you want → LLM keywords → search ALL prospects → add all.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiIncludeContacted, setAiIncludeContacted] = useState(false);
  const [aiIncludeGuessed, setAiIncludeGuessed] = useState(true);
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResults, setAiResults] = useState<any[]>([]);
  const [aiKeywords, setAiKeywords] = useState<string[]>([]);
  const [aiTotal, setAiTotal] = useState(0);
  const [aiSearched, setAiSearched] = useState(false);
  const [aiAdding, setAiAdding] = useState(false);

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
    // Who's already been emailed/queued in OTHER workflows — shows a "contacted" tag here.
    fetch(`/api/outreach/contacted?exclude_workflow=${wf.id}`)
      .then((r) => r.ok ? r.json() : null).then((d) => setContactedElsewhere(new Set(d?.authorIds ?? []))).catch(() => {});
  }

  async function handleCreate() {
    if (!form.name) return;
    setSaving(true);
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Default filters: only people not yet contacted who have an email on file.
      body: JSON.stringify({ name: form.name, campaign_id: form.campaign_id || undefined, filters: { notContacted: true, emailStatus: "has" } }),
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

  // Remove ONE prospect from the workflow entirely (not just deselect).
  async function removeProspect(authorId: string) {
    if (!selected) return;
    setProspects((ps) => ps.filter((p) => p.author_id !== authorId));
    await fetch(`/api/workflows/${selected.id}/prospects/${authorId}`, { method: "DELETE" }).catch(() => {});
  }

  // Remove ALL prospects from the workflow.
  async function removeAll() {
    if (!selected || prospects.length === 0) return;
    if (!confirm(`Remove all ${prospects.length} prospects from "${selected.name}"? This clears the list (it doesn't delete the authors).`)) return;
    setProspects([]);
    await fetch(`/api/workflows/${selected.id}/prospects`, { method: "DELETE" }).catch(() => {});
  }

  // Select all / Deselect all — ONE bulk request instead of a PATCH per prospect.
  async function toggleAll(included: boolean) {
    if (!selected) return;
    setProspects((ps) => ps.map((p) => ({ ...p, included })));
    await fetch(`/api/workflows/${selected.id}/prospects`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ included }), // no author_ids → applies to all in this workflow
    }).catch(() => {});
  }

  // Search ALL prospects server-side (same index as the Prospects page) to add individuals.
  async function runAddSearch(q: string) {
    setAddQuery(q);
    if (q.trim().length < 2) { setAddResults([]); return; }
    setAddSearching(true);
    const res = await fetch(`/api/prospects?search=${encodeURIComponent(q)}&limit=15&exclude_discarded=true`).then((r) => r.ok ? r.json() : null).catch(() => null);
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

  async function runAiSearch() {
    if (!aiPrompt.trim()) return;
    setAiSearching(true); setAiSearched(true);
    const res = await fetch("/api/prospects/ai-search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: aiPrompt, includeContacted: aiIncludeContacted, includeGuessed: aiIncludeGuessed }),
    }).then((r) => r.ok ? r.json() : null).catch(() => null);
    setAiResults(res?.prospects ?? []); setAiKeywords(res?.keywords ?? []); setAiTotal(res?.total ?? 0);
    setAiSearching(false);
  }

  async function addAllAi() {
    if (!selected || aiResults.length === 0) return;
    setAiAdding(true);
    const ids = aiResults.map((r: any) => r.author.id);
    const res = await fetch(`/api/workflows/${selected.id}/prospects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author_ids: ids }),
    }).then((r) => r.json()).catch(() => ({}));
    setAiAdding(false); setAiOpen(false);
    await fetchProspects(selected);
    // toast via the existing pattern isn't imported here; rely on the refreshed list. Reset.
    setAiResults([]); setAiSearched(false); setAiPrompt("");
  }

  const filteredProspects = prospects.filter((p) => {
    if (!search) return true;
    const name = p.author?.full_name?.toLowerCase() ?? "";
    const pub = (p.domain?.name ?? p.domain?.host ?? "").toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || pub.includes(q);
  });

  const includedCount = prospects.filter((p) => p.included).length;

  // Group workflows by campaign (filtered by the sidebar search box)
  const wfMatch = (w: Workflow) => w.name.toLowerCase().includes(wfSearch.toLowerCase());
  const grouped = campaigns
    .map((c) => ({ campaign: c, items: workflows.filter((w) => w.campaign_id === c.id && wfMatch(w)) }))
    .filter(({ items }) => items.length > 0);
  const uncampaigned = workflows.filter((w) => !w.campaign_id && wfMatch(w));

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
        {workflows.length > 6 && (
          <div className="px-3 py-2 border-b border-border relative">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search workflows…"
              value={wfSearch}
              onChange={(e) => setWfSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        )}
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
              {workflows.length > 0 && grouped.length === 0 && uncampaigned.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No workflows match &ldquo;{wfSearch}&rdquo;
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
                onClick={() => window.open(`/api/workflows/${selected.id}/export`, "_blank")}
                disabled={total === 0}
                title="Download this list (name, articles, domain rating) as a spreadsheet"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export List
              </Button>
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
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 border-violet-500/40 text-violet-300" onClick={() => setAiOpen(true)}>
                <Sparkles className="h-3.5 w-3.5" />AI find
              </Button>
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
                  toggleAll(!allIncluded);
                }}
              >
                {prospects.length > 0 && prospects.every((p) => p.included) ? "Deselect all" : "Select all"}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300 gap-1" disabled={prospects.length === 0} onClick={removeAll}>
                <Trash2 className="h-3.5 w-3.5" />Remove all
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
                    <ProspectRow key={p.id} p={p} onToggle={toggleProspect} onOpen={openAuthor} onRemove={removeProspect} contacted={contactedElsewhere.has(p.author_id)} />
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
              <SearchableSelect
                value={form.campaign_id}
                onChange={(id) => setForm(f => ({ ...f, campaign_id: id }))}
                options={campaigns.map((c) => ({ id: c.id, label: c.name }))}
                noneLabel="All prospects (no campaign filter)"
                placeholder="Select campaign…"
                searchPlaceholder="Search campaigns…"
                menuWidth="w-full"
                className="w-full"
              />
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

      {/* AI find dialog — describe the writers you want, search the whole database */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-[40rem]! w-[calc(100vw-2rem)]! max-h-[88vh] overflow-y-auto" style={{ maxWidth: "40rem", width: "calc(100vw - 2rem)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-400" />AI find prospects</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">Describe the writers you want in plain English — the topics, tools, art types, or industries they cover. We pull out keywords and search <b>all</b> prospects across every campaign.</p>
            <Textarea
              placeholder={"e.g. writers who cover AI video generation for marketers and ecommerce, or people who wrote about Midjourney and product photography"}
              className="min-h-[90px]"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={aiIncludeContacted} onCheckedChange={(v) => setAiIncludeContacted(!!v)} />Include people already contacted</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={aiIncludeGuessed} onCheckedChange={(v) => setAiIncludeGuessed(!!v)} />Include guessed emails (not just verified)</label>
              <p className="text-[11px] text-muted-foreground">Only people who have an email are returned.</p>
            </div>
            <Button size="sm" className="gap-1.5" onClick={runAiSearch} disabled={aiSearching || !aiPrompt.trim()}>
              {aiSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}Search
            </Button>

            {aiKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[11px] text-muted-foreground">keywords:</span>
                {aiKeywords.map((k) => <span key={k} className="text-[11px] bg-violet-500/10 text-violet-300 border border-violet-500/20 px-1.5 py-0.5 rounded-full">{k}</span>)}
              </div>
            )}
            {aiSearched && (
              <>
                {!aiSearching && aiResults.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">{aiTotal} matching prospect{aiTotal === 1 ? "" : "s"} with an email{aiTotal > aiResults.length ? ` (showing ${aiResults.length})` : ""}.</p>
                )}
                <div className="border border-border rounded-md max-h-[420px] overflow-y-auto divide-y divide-border">
                  {aiSearching ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground p-4"><Loader2 className="h-4 w-4 animate-spin" />Searching the database…</div>
                  ) : aiResults.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground text-center">No matching prospects with an email. Try broader wording or enable guessed emails.</p>
                  ) : aiResults.map((r: any) => {
                    const mail = (r.contacts ?? []).find((c: any) => c.type === "mailto");
                    const guessed = mail && isGuessSource(mail.source);
                    // The article that references the search terms — so you can verify the match.
                    const kw = aiKeywords.map((k) => k.toLowerCase());
                    const arts = r.articles ?? [];
                    const ref = arts.find((a: any) => kw.some((k) => `${a.title ?? ""} ${a.excerpt ?? ""} ${a.readability_text_excerpt ?? ""}`.toLowerCase().includes(k)))
                      ?? [...arts].sort((a: any, b: any) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
                    return (
                      <div key={r.author.id} className="flex items-start gap-2 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <button onClick={() => openAuthor(r.author.id)} className="block text-sm break-words hover:text-violet-400 hover:underline text-left">{r.author.full_name}</button>
                          <p className="text-[11px] text-muted-foreground break-words">{r.domain?.name ?? r.domain?.host ?? "—"}{r.score?.composite != null ? ` · ${Math.round(r.score.composite)}pt` : ""}</p>
                          {ref?.title && <p className="text-[11px] text-muted-foreground/70 break-words italic">“{ref.title}”</p>}
                        </div>
                        {ref?.url_canonical && (
                          <a href={ref.url_canonical} target="_blank" rel="noreferrer" title="Open the referencing article" className="shrink-0 inline-flex items-center gap-1 text-[10px] text-violet-400 hover:underline border border-violet-500/30 rounded px-1.5 py-0.5">
                            article<ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                        {mail && <span className={`text-[10px] inline-flex items-center gap-1 rounded px-1 shrink-0 ${guessed ? "text-amber-400 border border-amber-500/40" : "text-emerald-400 border border-emerald-500/40"}`}><Mail className="h-2.5 w-2.5" />{guessed ? "guessed" : "email"}</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)}>Close</Button>
            <Button onClick={addAllAi} disabled={aiAdding || aiResults.length === 0 || !selected} className="gap-1.5">
              {aiAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add all {aiResults.length > 0 ? `(${aiResults.length}${aiTotal > aiResults.length ? ` of ${aiTotal}` : ""})` : ""} to workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {drawer}
    </div>
  );
}
