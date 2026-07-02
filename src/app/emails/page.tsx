"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Plus, Loader2, Sparkles, Check, AlertCircle, Edit2, FileText, Send, Clock, Search, ChevronDown, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Workflow, EmailTemplate, OutreachEmail, EmailSendConfig } from "@/lib/types";
import { isGuessSource } from "@/lib/enrich/personFilter";

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Asia/Karachi", "Asia/Dubai", "Asia/Kolkata",
  "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "UTC",
];

const STATUS_COLORS: Record<string, string> = {
  draft: "text-muted-foreground border-muted",
  ready: "text-green-400 border-green-500/30 bg-green-500/10",
  scheduled: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  sent: "text-violet-400 border-violet-500/30 bg-violet-500/10",
  failed: "text-red-400 border-red-500/30 bg-red-500/10",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`text-[11px] capitalize ${STATUS_COLORS[status] ?? ""}`}>
      {status}
    </Badge>
  );
}

const PLACEHOLDER_DOCS = [
  ["{{author_name}}", "Writer's full name"],
  ["{{pub_name}}", "Publication name"],
  ["{{article_title}}", "Their most recent article title"],
  ["{{article_date}}", "Publication date"],
  ["{{tool_mentioned}}", "First AI tool they mentioned"],
  ["{{custom_line}}", "AI-generated personalized opener"],
];

// One merged row per prospect — carries their article context, target email,
// inclusion state, and the generated email (if any).
interface EmailRow {
  author_id: string;
  author: any;
  articles: any[];
  contacts: any[];
  included: boolean;
  email: OutreachEmail | null;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

function latestArticle(articles: any[]): any | null {
  if (!articles?.length) return null;
  return [...articles].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
}

function emailOf(contacts: any[]): string | null {
  const c = contacts?.find((c) => c.type === "mailto");
  return c ? c.value.replace(/^mailto:/, "") : null;
}
function emailIsGuess(contacts: any[]): boolean {
  const c = contacts?.find((c) => c.type === "mailto");
  return isGuessSource(c?.source);
}

export default function EmailsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [genErrors, setGenErrors] = useState<string[]>([]);
  const genTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Template editor
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: "", subject: "", body: "", guidance: "" });
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Email editor
  const [editingRow, setEditingRow] = useState<EmailRow | null>(null);
  const [editForm, setEditForm] = useState({ subject: "", body: "" });
  const [savingEmail, setSavingEmail] = useState(false);

  // Authors already contacted in OTHER campaigns (excluded from sending)
  const [contactedElsewhere, setContactedElsewhere] = useState<Set<string>>(new Set());

  // Workflow search picker
  const [wfSearch, setWfSearch] = useState("");
  const [wfOpen, setWfOpen] = useState(false);

  // Send config + scheduling
  const [config, setConfig] = useState<EmailSendConfig | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/workflows").then((r) => r.json()),
      fetch("/api/email-templates").then((r) => r.json()),
    ]).then(([wfs, tmpls]) => {
      setWorkflows(wfs ?? []);
      setTemplates(tmpls ?? []);
    });
  }, []);

  useEffect(() => {
    if (genTimer.current) { clearInterval(genTimer.current); genTimer.current = null; }
    if (!selectedWorkflow) { setRows([]); setConfig(null); setGenerating(false); return; }
    fetchRows(selectedWorkflow.id);
    fetch(`/api/workflows/${selectedWorkflow.id}/send-config`).then((r) => r.ok ? r.json() : null).then(setConfig).catch(() => {});
    fetch(`/api/outreach/contacted?exclude_workflow=${selectedWorkflow.id}`).then((r) => r.json()).then((d) => setContactedElsewhere(new Set(d.authorIds ?? []))).catch(() => {});
    // Resume progress view if a generation is still running from before (e.g. tab was closed)
    fetch(`/api/workflows/${selectedWorkflow.id}/generate-status`).then((r) => r.json()).then((st) => {
      if (st?.running) { setGenerating(true); pollGen(selectedWorkflow.id); }
    }).catch(() => {});
    return () => { if (genTimer.current) { clearInterval(genTimer.current); genTimer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflow]);

  async function saveConfig() {
    if (!selectedWorkflow || !config) return;
    setSavingConfig(true);
    const res = await fetch(`/api/workflows/${selectedWorkflow.id}/send-config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (res.ok) { setConfig(await res.json()); toast.success("Schedule saved."); setShowSchedule(false); }
    else toast.error("Failed to save schedule.");
    setSavingConfig(false);
  }

  async function scheduleSend() {
    if (!selectedWorkflow) return;
    setScheduling(true);
    const res = await fetch(`/api/workflows/${selectedWorkflow.id}/send`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.scheduled > 0) {
      const zones = data.timezones ? Object.keys(data.timezones).length : 1;
      const skipped = data.skippedContacted ? ` (${data.skippedContacted} skipped — already contacted elsewhere)` : "";
      toast.success(`Scheduled ${data.scheduled} emails across ${zones} timezone${zones === 1 ? "" : "s"}${skipped}. Opening progress…`);
      router.push("/sending");
    } else if (res.ok) {
      toast.error(data.reason ?? "Nothing to schedule — generate emails first.");
    } else {
      toast.error(data.error ?? "Failed to schedule.");
    }
    setScheduling(false);
  }

  async function fetchRows(workflowId: string) {
    setLoading(true);
    const [pRes, eRes] = await Promise.all([
      fetch(`/api/workflows/${workflowId}/prospects?limit=500`).catch(() => null),
      fetch(`/api/workflows/${workflowId}/emails`).catch(() => null),
    ]);
    const prospects: any[] = pRes?.ok ? (await pRes.json()).prospects ?? [] : [];
    const emails: OutreachEmail[] = eRes?.ok ? await eRes.json() : [];
    const emailByAuthor = new Map<string, OutreachEmail>();
    for (const e of emails) emailByAuthor.set(e.author_id, e);

    setRows(
      prospects.map((p) => ({
        author_id: p.author_id,
        author: p.author,
        articles: p.articles ?? [],
        contacts: p.contacts ?? [],
        included: p.included,
        email: emailByAuthor.get(p.author_id) ?? null,
      }))
    );
    setLoading(false);
  }

  async function toggleInclude(authorId: string, included: boolean) {
    if (!selectedWorkflow) return;
    setRows((rs) => rs.map((r) => r.author_id === authorId ? { ...r, included } : r));
    await fetch(`/api/workflows/${selectedWorkflow.id}/prospects/${authorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ included }),
    }).catch(() => {});
  }

  // Select all / Deselect all — one bulk request, not a PATCH per row.
  async function toggleAllRows(included: boolean) {
    if (!selectedWorkflow) return;
    setRows((rs) => rs.map((r) => ({ ...r, included })));
    await fetch(`/api/workflows/${selectedWorkflow.id}/prospects`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ included }),
    }).catch(() => {});
  }

  // Clear the "contacted elsewhere" flag so this person can be emailed again (the manual
  // override). Un-dims their row and re-enables the checkbox immediately.
  async function uncontact(authorId: string) {
    setContactedElsewhere((s) => { const n = new Set(s); n.delete(authorId); return n; });
    await fetch(`/api/authors/${authorId}/contacted`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacted: false }),
    }).catch(() => {});
  }

  // Poll generation status; runs whether we started it this session or are resuming a
  // job that kept running while the tab was closed. Refetches rows so finished emails
  // appear immediately, and stops when the run is done.
  const pollGen = useCallback((workflowId: string) => {
    if (genTimer.current) clearInterval(genTimer.current);
    const tick = async () => {
      const st = await fetch(`/api/workflows/${workflowId}/generate-status`).then((r) => r.json()).catch(() => null);
      if (!st) return;
      setGenProgress({ done: st.done, total: st.total });
      setGenErrors(st.errors ?? []);
      await fetchRows(workflowId); // show completed ones as they land
      if (!st.running) {
        if (genTimer.current) { clearInterval(genTimer.current); genTimer.current = null; }
        setGenerating(false);
        if (st.total > 0) toast.success(`Generated ${st.done} emails${st.errors?.length ? `, ${st.errors.length} errors` : ""}.`);
      }
    };
    tick();
    genTimer.current = setInterval(tick, 2500);
  }, []);

  async function generateAll() {
    if (!selectedWorkflow) return;
    const includedCount = rows.filter((r) => r.included).length;
    if (includedCount === 0) { toast.error("No prospects selected — include at least one."); return; }

    setGenerating(true);
    setGenProgress({ done: 0, total: includedCount });
    setGenErrors([]);

    const res = await fetch(`/api/workflows/${selectedWorkflow.id}/generate-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: selectedTemplate?.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.started === false) {
      if (data.alreadyRunning) { toast.info("Generation already running — showing progress."); }
      else { toast.error(data.reason ?? "Couldn't start generation."); setGenerating(false); return; }
    }
    // Generation now runs on the server independent of this tab. Poll for progress.
    pollGen(selectedWorkflow.id);
  }

  async function saveTemplate() {
    setSavingTemplate(true);
    if (editingTemplate) {
      await fetch(`/api/email-templates/${editingTemplate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateForm),
      });
      setTemplates((ts) => ts.map((t) => t.id === editingTemplate.id ? { ...t, ...templateForm } : t));
    } else {
      const res = await fetch("/api/email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateForm),
      });
      if (res.ok) {
        const t = await res.json();
        setTemplates((ts) => [t, ...ts]);
        setSelectedTemplate(t);
      }
    }
    setEditingTemplate(null);
    setCreatingTemplate(false);
    setSavingTemplate(false);
  }

  function openTemplateEditor(t?: EmailTemplate) {
    if (t) {
      setEditingTemplate(t);
      setTemplateForm({ name: t.name, subject: t.subject, body: t.body, guidance: t.guidance ?? "" });
    } else {
      setEditingTemplate(null);
      setTemplateForm({ name: "", subject: "Loved your recent piece on {{tool_mentioned}}", body: `Hi {{author_name}},\n\n{{custom_line}}\n\nI work at ImagineArt, one of the leading AI image generation platforms. I think your audience would love to hear about what we've been building.\n\nWould you be open to a quick chat, or to covering us in a future piece?\n\nBest,\nAbdullah\nImagineArt`, guidance: "" });
      setCreatingTemplate(true);
    }
  }

  function openEmailEditor(row: EmailRow) {
    if (!row.email) return;
    setEditingRow(row);
    setEditForm({ subject: row.email.subject ?? "", body: row.email.body ?? "" });
  }

  async function saveEmail() {
    if (!editingRow?.email) return;
    setSavingEmail(true);
    const emailId = editingRow.email.id;
    await fetch(`/api/emails/${emailId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editForm, status: "ready" }),
    });
    setRows((rs) => rs.map((r) => r.author_id === editingRow.author_id && r.email
      ? { ...r, email: { ...r.email, ...editForm, status: "ready" } }
      : r));
    setEditingRow(null);
    setSavingEmail(false);
    toast.success("Email saved.");
  }

  const includedRows = rows.filter((r) => r.included);
  const readyCount = rows.filter((r) => r.email && (r.email.status === "ready" || r.email.status === "sent")).length;
  const allIncluded = rows.length > 0 && rows.every((r) => r.included);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Controls bar */}
        <div className="border-b border-border px-6 py-4 flex flex-wrap items-center gap-3 shrink-0">
          <div className="space-y-0.5 min-w-56 relative">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Workflow</p>
            <button
              type="button"
              className="w-56 h-8 rounded-md border border-input bg-background px-2 text-sm flex items-center justify-between gap-2"
              onClick={() => { setWfOpen((o) => !o); setWfSearch(""); }}
            >
              <span className="truncate">{selectedWorkflow?.name ?? "Select workflow..."}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
            </button>
            {wfOpen && (
              <div className="absolute z-30 mt-1 w-72 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
                <div className="relative border-b border-border">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    autoFocus
                    placeholder="Search workflows..."
                    className="w-full h-9 bg-transparent pl-8 pr-2 text-sm outline-none"
                    value={wfSearch}
                    onChange={(e) => setWfSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {workflows.filter((w) => w.name.toLowerCase().includes(wfSearch.toLowerCase())).map((w) => (
                    <button
                      key={w.id}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center justify-between gap-2 ${selectedWorkflow?.id === w.id ? "bg-muted/40" : ""}`}
                      onClick={() => { setSelectedWorkflow(w); setWfOpen(false); }}
                    >
                      <span className="truncate">{w.name}</span>
                      {w.prospect_count ? <span className="text-xs text-muted-foreground shrink-0">{w.prospect_count}</span> : null}
                    </button>
                  ))}
                  {workflows.filter((w) => w.name.toLowerCase().includes(wfSearch.toLowerCase())).length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted-foreground text-center">No workflows match</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-0.5 min-w-40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Template</p>
            <div className="flex gap-1">
              <select
                className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={selectedTemplate?.id ?? ""}
                onChange={(e) => setSelectedTemplate(templates.find((t) => t.id === e.target.value) ?? null)}
              >
                <option value="">No template (AI-only opener)</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {selectedTemplate && (
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openTemplateEditor(selectedTemplate)}>
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => openTemplateEditor()}>
            <Plus className="h-3.5 w-3.5 mr-1" />Template
          </Button>

          <div className="ml-auto flex items-center gap-3">
            {generating && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {genProgress.done}/{genProgress.total} generated
              </div>
            )}
            {/* Stage 2 — generate/personalize */}
            <Button onClick={generateAll} disabled={!selectedWorkflow || generating} size="sm">
              {generating
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating...</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate ({includedRows.length})</>}
            </Button>
            {/* Schedule settings */}
            <Button size="sm" variant="outline" onClick={() => setShowSchedule(true)} disabled={!selectedWorkflow} title="Timezone, sending window & spacing">
              <Clock className="h-3.5 w-3.5 mr-1.5" />Schedule
            </Button>
            {/* Stage 3 — schedule the send (drip via SMTP) */}
            <Button
              size="sm"
              onClick={scheduleSend}
              disabled={!selectedWorkflow || scheduling || readyCount === 0}
              className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
              title={readyCount === 0 ? "Generate emails first" : "Schedule all ready emails to send"}
            >
              {scheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send All ({readyCount})
            </Button>
          </div>
        </div>

        {/* Stats row */}
        {rows.length > 0 && (
          <div className="px-6 py-2 border-b border-border flex items-center gap-4 text-xs text-muted-foreground shrink-0">
            <span><span className="font-semibold text-foreground">{includedRows.length}</span> selected</span>
            <span><span className="font-semibold text-green-400">{readyCount}</span> ready</span>
            <span><span className="font-semibold text-muted-foreground">{rows.filter((r) => !r.email).length}</span> not generated</span>
            {genErrors.length > 0 && (
              <span className="text-red-400"><AlertCircle className="h-3 w-3 inline mr-1" />{genErrors.length} errors</span>
            )}
            <button
              className="ml-auto text-xs hover:text-foreground transition-colors"
              onClick={() => rows.forEach((r) => { if (r.included === allIncluded) toggleInclude(r.author_id, !allIncluded); })}
            >
              {allIncluded ? "Deselect all" : "Select all"}
            </button>
          </div>
        )}

        {/* Row list */}
        <div className="flex-1 overflow-y-auto">
          {!selectedWorkflow ? (
            <div className="flex items-center justify-center h-full text-muted-foreground flex-col gap-2">
              <Mail className="h-8 w-8 opacity-20" />
              <p className="text-sm">Select a workflow to personalize outreach emails</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading...
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm flex-col gap-3">
              <p>No prospects in this workflow yet — run it from the Workflows page first</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background border-b border-border z-10">
                <tr>
                  <th className="w-10 px-4 py-2.5"></th>
                  <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Author</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Their article & subject</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24">Status</th>
                  <th className="px-4 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const author = row.author;
                  const lead = latestArticle(row.articles);
                  const email = emailOf(row.contacts);
                  const gen = row.email;
                  const contacted = contactedElsewhere.has(row.author_id);
                  return (
                    <tr
                      key={row.author_id}
                      className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${!row.included || contacted ? "opacity-40" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <Checkbox checked={row.included && !contacted} disabled={contacted} onCheckedChange={(v) => toggleInclude(row.author_id, v === true)} />
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={author?.avatar_url} />
                            <AvatarFallback className="bg-violet-600 text-white text-[10px] font-semibold">
                              {author?.full_name?.slice(0, 2)?.toUpperCase() ?? "??"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[180px] flex items-center gap-1.5">
                              {author?.full_name ?? "Unknown"}
                              {contacted && (
                                <button
                                  type="button"
                                  onClick={() => uncontact(row.author_id)}
                                  title="Contacted in another campaign. Click to allow emailing them again."
                                  className="text-[9px] uppercase tracking-wide text-amber-500 border border-amber-500/40 rounded px-1 shrink-0 hover:bg-amber-500/15 cursor-pointer"
                                >
                                  contacted ✕
                                </button>
                              )}
                            </p>
                            {email ? (
                              <p className="text-xs truncate max-w-[200px] flex items-center gap-1">
                                <span className={emailIsGuess(row.contacts) ? "text-amber-400/90" : "text-green-400/80"}>{email}</span>
                                {emailIsGuess(row.contacts) && <span className="text-[9px] uppercase tracking-wide text-amber-500 border border-amber-500/40 rounded px-1 shrink-0">guess</span>}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground/50 truncate max-w-[160px]">no email on file</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {lead && (
                          <p className="text-[11px] text-muted-foreground truncate max-w-md flex items-center gap-1">
                            <FileText className="h-3 w-3 shrink-0 opacity-60" />
                            <span className="truncate">{lead.title ?? "untitled"}</span>
                            {lead.published_at && <span className="opacity-60 shrink-0">· {fmtDate(lead.published_at)}</span>}
                          </p>
                        )}
                        <p className="truncate max-w-md text-sm">
                          {gen?.subject || <span className="italic opacity-40 text-muted-foreground">Not generated yet</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={gen?.status ?? "pending"} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {gen?.body && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEmailEditor(row)}>
                            <Edit2 className="h-3 w-3 mr-1" />Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Template Editor Dialog */}
      <Dialog open={!!(editingTemplate || creatingTemplate)} onOpenChange={(v) => { if (!v) { setEditingTemplate(null); setCreatingTemplate(false); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "New Email Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Template name</Label>
              <Input placeholder="e.g. AI Tools Outreach v1" value={templateForm.name} onChange={(e) => setTemplateForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Subject line</Label>
              <Input placeholder="e.g. Re: your article on {{tool_mentioned}}" value={templateForm.subject} onChange={(e) => setTemplateForm(f => ({ ...f, subject: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email body</Label>
              <Textarea placeholder="Hi {{author_name}},&#10;&#10;{{custom_line}}&#10;..." className="min-h-[200px] font-mono text-sm" value={templateForm.body} onChange={(e) => setTemplateForm(f => ({ ...f, body: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                Writing direction for {"{{custom_line}}"} <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                placeholder="e.g. Keep it casual and concise. Lead with genuine curiosity about their take on AI video tools. Mention we're a small team, not a big corp. Avoid buzzwords."
                className="min-h-[90px] text-sm"
                value={templateForm.guidance}
                onChange={(e) => setTemplateForm(f => ({ ...f, guidance: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Steers how the AI writes each personalized opener — tone, angle, what to emphasize or avoid. Applied per-recipient on top of their article context.
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available placeholders</p>
              <div className="grid grid-cols-2 gap-1">
                {PLACEHOLDER_DOCS.map(([token, desc]) => (
                  <div key={token} className="flex gap-2 text-xs">
                    <code className="text-violet-400 shrink-0">{token}</code>
                    <span className="text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingTemplate(null); setCreatingTemplate(false); }}>Cancel</Button>
            <Button onClick={saveTemplate} disabled={!templateForm.name || !templateForm.subject || !templateForm.body || savingTemplate}>
              {savingTemplate && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Editor Sheet — shows article context so edits stay personal */}
      <Sheet open={!!editingRow} onOpenChange={(v) => { if (!v) setEditingRow(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 gap-0 overflow-hidden">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <SheetTitle>Edit Email</SheetTitle>
            {editingRow && (
              <p className="text-sm text-muted-foreground">
                {editingRow.author?.full_name}
                {emailOf(editingRow.contacts) && <span className="text-green-400/80"> · {emailOf(editingRow.contacts)}</span>}
              </p>
            )}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {editingRow && latestArticle(editingRow.articles) && (
              <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-xs">
                <p className="font-semibold text-muted-foreground uppercase tracking-wider">Referencing their article</p>
                {(() => {
                  const a = latestArticle(editingRow.articles);
                  return (
                    <>
                      <p className="text-foreground">{a.title ?? "untitled"}</p>
                      <p className="text-muted-foreground">
                        {fmtDate(a.published_at)}
                        {a.url_canonical && <> · <a href={a.url_canonical} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">view</a></>}
                      </p>
                      {a.excerpt && <p className="text-muted-foreground/70 line-clamp-2">{a.excerpt}</p>}
                    </>
                  );
                })()}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={editForm.subject} onChange={(e) => setEditForm(f => ({ ...f, subject: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Body</Label>
              <Textarea className="min-h-[320px] font-mono text-sm" value={editForm.body} onChange={(e) => setEditForm(f => ({ ...f, body: e.target.value }))} />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
            <Button variant="outline" onClick={() => setEditingRow(null)}>Cancel</Button>
            <Button onClick={saveEmail} disabled={savingEmail}>
              {savingEmail && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              <Check className="h-4 w-4 mr-1.5" />Save Changes
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Schedule settings Sheet */}
      <Sheet open={showSchedule} onOpenChange={setShowSchedule}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 gap-0 overflow-hidden">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <SheetTitle>Sending schedule</SheetTitle>
            <p className="text-sm text-muted-foreground">Each recipient is scheduled in <span className="text-foreground font-medium">their own local time</span> — inferred from their site/country, or an AI guess. These settings define the daily window &amp; spacing applied per person.</p>
          </SheetHeader>
          {config && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 flex items-start gap-2 text-xs text-muted-foreground">
                <Globe className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
                <span>Emails are sent per-recipient in their local timezone. The setting below is only the <span className="text-foreground">fallback</span> used when we can&apos;t determine someone&apos;s timezone.</span>
              </div>
              <div className="space-y-1.5">
                <Label>Fallback timezone <span className="text-muted-foreground font-normal">(when a recipient&apos;s can&apos;t be inferred)</span></Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={config.timezone}
                  onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
                >
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Send from (hour)</Label>
                  <Input type="number" min={0} max={23} value={config.send_hour_start}
                    onChange={(e) => setConfig({ ...config, send_hour_start: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Send until (hour)</Label>
                  <Input type="number" min={1} max={24} value={config.send_hour_end}
                    onChange={(e) => setConfig({ ...config, send_hour_end: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Gap between emails (min)</Label>
                  <Input type="number" min={1} value={config.gap_minutes}
                    onChange={(e) => setConfig({ ...config, gap_minutes: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Max per day</Label>
                  <Input type="number" min={1} value={config.daily_cap}
                    onChange={(e) => setConfig({ ...config, daily_cap: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>From name</Label>
                <Input placeholder="Waleed Idrees" value={config.from_name ?? ""}
                  onChange={(e) => setConfig({ ...config, from_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>From email</Label>
                <Input placeholder="waleed.idrees@imagine.art" value={config.from_email ?? ""}
                  onChange={(e) => setConfig({ ...config, from_email: e.target.value })} />
                <p className="text-xs text-muted-foreground">Leave blank to use the default sender configured on the server.</p>
              </div>
              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                Each email lands in the recipient&apos;s local {config.send_hour_start}:00–{config.send_hour_end}:00 window, {config.gap_minutes} min apart, up to {config.daily_cap}/day. Overflow rolls to the next day. Unknown timezones fall back to {config.timezone}.
              </div>
            </div>
          )}
          <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
            <Button variant="outline" onClick={() => setShowSchedule(false)}>Cancel</Button>
            <Button onClick={saveConfig} disabled={savingConfig}>
              {savingConfig && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              <Check className="h-4 w-4 mr-1.5" />Save Schedule
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
