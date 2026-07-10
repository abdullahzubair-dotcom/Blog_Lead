"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Mail, Plus, Loader2, Sparkles, Check, AlertCircle, Edit2, FileText, Send, Clock, Search, ChevronDown, Globe, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Workflow, EmailTemplate, OutreachEmail, EmailSendConfig, LinkedinMessage } from "@/lib/types";
import { isGuessSource } from "@/lib/enrich/personFilter";
import { useAuthorDrawer } from "@/components/prospects/useAuthorDrawer";
import { SearchableSelect } from "@/components/ui/searchable-select";

// LinkedIn brand glyph (lucide dropped brand icons). Inherits color via currentColor.
function Linkedin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

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
  ["{{article_link}}", "Link to the article referenced above — delete the whole line if you'd rather not include a link"],
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
  linkedin: LinkedinMessage | null; // generated LinkedIn connection note (copy-paste)
}

// LinkedIn note templates get a different placeholder set (no subject, short body).
const LINKEDIN_PLACEHOLDER_DOCS = [
  ["{{author_name}}", "Writer's full name"],
  ["{{first_name}}", "Writer's first name"],
  ["{{pub_name}}", "Publication name"],
  ["{{custom_line}}", "AI-generated personalized note (already includes a greeting)"],
];
const LINKEDIN_LIMIT = 300; // LinkedIn's connection-note character cap

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
function linkedinOf(contacts: any[]): string | null {
  const c = contacts?.find((c) => c.type === "linkedin");
  if (!c?.value) return null;
  return /^https?:\/\//.test(c.value) ? c.value : `https://${c.value.replace(/^\/+/, "")}`;
}

export default function EmailsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Channel: "email" drips personalized emails; "linkedin" generates copy-paste
  // connection notes (never sent — you paste them into LinkedIn).
  const [mode, setMode] = useState<"email" | "linkedin">("email");

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [genErrors, setGenErrors] = useState<string[]>([]);
  const genTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Template editor
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<{ name: string; subject: string; body: string; guidance: string; channel: "email" | "linkedin" }>({ name: "", subject: "", body: "", guidance: "", channel: "email" });
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

  // Row search (filter the prospect list by name / publication) + author drawer
  const [rowSearch, setRowSearch] = useState("");
  const { openAuthor, drawer } = useAuthorDrawer();

  // Send config + scheduling
  const [config, setConfig] = useState<EmailSendConfig | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [needAppPw, setNeedAppPw] = useState<{ sender: string; label: string } | null>(null); // Send All blocked: chosen identity has no Gmail app password yet
  const { data: session } = useSession();
  const myEmail = session?.user?.email ?? "";

  // "Choose sender" popup — own email vs. a shared inbox (e.g. Zain's) — shown on every Send All
  const [chooseSenderOpen, setChooseSenderOpen] = useState(false);
  const [chosenSender, setChosenSender] = useState<string>(""); // "" = own email
  const [sharedSenders, setSharedSenders] = useState<{ email: string; label: string }[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/workflows").then((r) => r.json()),
      fetch("/api/email-templates").then((r) => r.json()),
      fetch("/api/shared-senders").then((r) => (r.ok ? r.json() : [])),
    ]).then(([wfs, tmpls, shared]) => {
      setWorkflows(wfs ?? []);
      setTemplates(tmpls ?? []);
      setSharedSenders(shared ?? []);
    });
  }, []);

  useEffect(() => {
    if (genTimer.current) { clearInterval(genTimer.current); genTimer.current = null; }
    setGenerating(false);
    if (!selectedWorkflow) { setRows([]); setConfig(null); return; }
    fetchRows(selectedWorkflow.id);
    fetch(`/api/workflows/${selectedWorkflow.id}/send-config`).then((r) => r.ok ? r.json() : null).then(setConfig).catch(() => {});
    fetch(`/api/outreach/contacted?exclude_workflow=${selectedWorkflow.id}`).then((r) => r.json()).then((d) => setContactedElsewhere(new Set(d.authorIds ?? []))).catch(() => {});
    // Resume progress view if a generation for THIS channel is still running (e.g. tab was closed)
    const q = mode === "linkedin" ? "?channel=linkedin" : "";
    fetch(`/api/workflows/${selectedWorkflow.id}/generate-status${q}`).then((r) => r.json()).then((st) => {
      if (st?.running) { setGenerating(true); pollGen(selectedWorkflow.id, mode); }
    }).catch(() => {});
    return () => { if (genTimer.current) { clearInterval(genTimer.current); genTimer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflow, mode]);

  // A selected template belongs to one channel — drop it when it no longer matches the mode.
  useEffect(() => {
    setSelectedTemplate((t) => (t && (mode === "linkedin") !== (t.channel === "linkedin") ? null : t));
  }, [mode]);

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

  // senderEmail: "" = the current user's own Gmail; otherwise a shared inbox's address.
  async function scheduleSend(senderEmail: string) {
    if (!selectedWorkflow) return;
    setChooseSenderOpen(false);
    setScheduling(true);
    const res = await fetch(`/api/workflows/${selectedWorkflow.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(senderEmail ? { sender_email: senderEmail } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (data.needsAppPassword) {
      const shared = sharedSenders.find((s) => s.email === data.sender);
      setNeedAppPw({ sender: data.sender ?? senderEmail, label: shared?.label ?? "your" }); // must add an app password for the chosen identity first
    } else if (res.ok && data.scheduled > 0) {
      const skipped = data.skippedContacted ? ` (${data.skippedContacted} skipped — already contacted elsewhere)` : "";
      const via = data.sentBy && data.sender && data.sentBy !== data.sender ? ` (sent by ${data.sentBy})` : "";
      toast.success(`Scheduled ${data.scheduled} emails from ${data.sender}${via}${skipped}. Opening progress…`);
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
    const [pRes, eRes, lRes] = await Promise.all([
      fetch(`/api/workflows/${workflowId}/prospects?limit=500`).catch(() => null),
      fetch(`/api/workflows/${workflowId}/emails`).catch(() => null),
      fetch(`/api/workflows/${workflowId}/linkedin`).catch(() => null),
    ]);
    const prospects: any[] = pRes?.ok ? (await pRes.json()).prospects ?? [] : [];
    const emails: OutreachEmail[] = eRes?.ok ? await eRes.json() : [];
    const linkedins: LinkedinMessage[] = lRes?.ok ? await lRes.json() : [];
    const emailByAuthor = new Map<string, OutreachEmail>();
    for (const e of emails) emailByAuthor.set(e.author_id, e);
    const liByAuthor = new Map<string, LinkedinMessage>();
    for (const m of linkedins) liByAuthor.set(m.author_id, m);

    setRows(
      prospects.map((p) => ({
        author_id: p.author_id,
        author: p.author,
        articles: p.articles ?? [],
        contacts: p.contacts ?? [],
        included: p.included,
        email: emailByAuthor.get(p.author_id) ?? null,
        linkedin: liByAuthor.get(p.author_id) ?? null,
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
  const pollGen = useCallback((workflowId: string, channel: "email" | "linkedin") => {
    if (genTimer.current) clearInterval(genTimer.current);
    const q = channel === "linkedin" ? "?channel=linkedin" : "";
    const noun = channel === "linkedin" ? "LinkedIn notes" : "emails";
    const tick = async () => {
      const st = await fetch(`/api/workflows/${workflowId}/generate-status${q}`).then((r) => r.json()).catch(() => null);
      if (!st) return;
      setGenProgress({ done: st.done, total: st.total });
      setGenErrors(st.errors ?? []);
      await fetchRows(workflowId); // show completed ones as they land
      if (!st.running) {
        if (genTimer.current) { clearInterval(genTimer.current); genTimer.current = null; }
        setGenerating(false);
        if (st.total > 0) toast.success(`Generated ${st.done} ${noun}${st.errors?.length ? `, ${st.errors.length} errors` : ""}.`);
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

    const endpoint = mode === "linkedin" ? "generate-linkedin" : "generate-emails";
    const res = await fetch(`/api/workflows/${selectedWorkflow.id}/${endpoint}`, {
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
    pollGen(selectedWorkflow.id, mode);
  }

  // Copy a single LinkedIn note (or any text) to the clipboard.
  async function copyText(text: string, label = "Note") {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copied.`); }
    catch { toast.error("Couldn't copy — select and copy manually."); }
  }

  // Copy every generated note for included prospects as a labelled list (bulk paste helper).
  async function copyAllNotes() {
    const blocks = rows
      .filter((r) => r.included && !contactedElsewhere.has(r.author_id) && r.linkedin?.body)
      .map((r) => {
        const url = linkedinOf(r.contacts);
        return `${r.author?.full_name ?? "Unknown"}${url ? ` — ${url}` : ""}\n${r.linkedin!.body}`;
      });
    if (blocks.length === 0) { toast.error("No generated notes to copy yet."); return; }
    await copyText(blocks.join("\n\n———\n\n"), `${blocks.length} notes`);
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
      setTemplateForm({ name: t.name, subject: t.subject, body: t.body, guidance: t.guidance ?? "", channel: t.channel === "linkedin" ? "linkedin" : "email" });
    } else {
      setEditingTemplate(null);
      // New templates default to the current channel.
      if (mode === "linkedin") {
        setTemplateForm({
          name: "",
          subject: "",
          body: "{{custom_line}}", // the note already includes a greeting; add a line if you want
          guidance: "",
          channel: "linkedin",
        });
      } else {
        setTemplateForm({
          name: "",
          subject: "Loved your recent piece on {{tool_mentioned}}",
          body: `Hi {{author_name}},\n\n{{custom_line}}\n\nI read this at: {{article_link}}\n\nI work at ImagineArt, one of the leading AI image generation platforms. I think your audience would love to hear about what we've been building.\n\nWould you be open to a quick chat, or to covering us in a future piece?\n\nBest,\nAbdullah\nImagineArt`,
          guidance: "",
          channel: "email",
        });
      }
      setCreatingTemplate(true);
    }
  }

  function openEmailEditor(row: EmailRow) {
    if (mode === "linkedin") {
      if (!row.linkedin) return;
      setEditingRow(row);
      setEditForm({ subject: "", body: row.linkedin.body ?? "" });
    } else {
      if (!row.email) return;
      setEditingRow(row);
      setEditForm({ subject: row.email.subject ?? "", body: row.email.body ?? "" });
    }
  }

  async function saveEmail() {
    if (!editingRow || !selectedWorkflow) return;
    setSavingEmail(true);
    if (mode === "linkedin") {
      await fetch(`/api/workflows/${selectedWorkflow.id}/linkedin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author_id: editingRow.author_id, body: editForm.body }),
      });
      setRows((rs) => rs.map((r) => r.author_id === editingRow.author_id && r.linkedin
        ? { ...r, linkedin: { ...r.linkedin, body: editForm.body } }
        : r));
      setEditingRow(null);
      setSavingEmail(false);
      toast.success("Note saved.");
      return;
    }
    if (!editingRow.email) { setSavingEmail(false); return; }
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
  // Templates are per-channel — only show the ones for the active mode.
  const channelTemplates = templates.filter((t) => (mode === "linkedin") === (t.channel === "linkedin"));
  // Match what "Send All" actually schedules: included + not contacted elsewhere + has a real
  // email + status ready/scheduled. (Old count included "sent" and ignored these filters.)
  const readyCount = rows.filter((r) =>
    r.included &&
    !contactedElsewhere.has(r.author_id) &&
    !!emailOf(r.contacts) &&
    r.email && (r.email.status === "ready" || r.email.status === "scheduled")
  ).length;
  // LinkedIn notes generated for included, not-elsewhere-contacted prospects.
  const notedCount = rows.filter((r) => r.included && !contactedElsewhere.has(r.author_id) && r.linkedin?.body).length;
  const allIncluded = rows.length > 0 && rows.every((r) => r.included);
  const displayRows = rowSearch.trim()
    ? rows.filter((r) => {
        const q = rowSearch.toLowerCase();
        return (r.author?.full_name ?? "").toLowerCase().includes(q)
          || (emailOf(r.contacts) ?? "").toLowerCase().includes(q)
          || (r.email?.subject ?? "").toLowerCase().includes(q)
          || (r.linkedin?.body ?? "").toLowerCase().includes(q);
      })
    : rows;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Controls bar */}
        <div className="border-b border-border px-6 py-4 flex flex-wrap items-center gap-3 shrink-0">
          {/* Channel toggle — Email drips personalized emails; LinkedIn generates copy-paste notes */}
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5 shrink-0 self-end">
            <button
              type="button"
              onClick={() => setMode("email")}
              className={`flex items-center gap-1.5 rounded-md px-3 h-8 text-sm font-medium transition-colors ${mode === "email" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Mail className="h-3.5 w-3.5" />Email
            </button>
            <button
              type="button"
              onClick={() => setMode("linkedin")}
              className={`flex items-center gap-1.5 rounded-md px-3 h-8 text-sm font-medium transition-colors ${mode === "linkedin" ? "bg-background shadow-sm text-[#0a66c2]" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Linkedin className="h-3.5 w-3.5" />LinkedIn
            </button>
          </div>

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

          <div className="space-y-0.5 min-w-48">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Template</p>
            <div className="flex gap-1">
              <SearchableSelect
                className="w-48"
                value={selectedTemplate?.id ?? ""}
                onChange={(id) => setSelectedTemplate(channelTemplates.find((t) => t.id === id) ?? null)}
                options={channelTemplates.map((t) => ({ id: t.id, label: t.name }))}
                noneLabel={mode === "linkedin" ? "No template (AI note only)" : "No template (AI-only opener)"}
                placeholder="Select template…"
                searchPlaceholder="Search templates…"
              />
              {selectedTemplate && (
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={() => openTemplateEditor(selectedTemplate)}>
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
            {mode === "email" ? (
              <>
                {/* Schedule is per-user now — configured in Settings */}
                <Button size="sm" variant="outline" onClick={() => router.push("/settings")} title="Your timezone, window & spacing (per-user)">
                  <Clock className="h-3.5 w-3.5 mr-1.5" />Schedule
                </Button>
                {/* Stage 3 — schedule the send (drip via SMTP) */}
                <Button
                  size="sm"
                  onClick={() => { setChosenSender(""); setChooseSenderOpen(true); }}
                  disabled={!selectedWorkflow || scheduling || readyCount === 0}
                  className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
                  title={readyCount === 0 ? "Generate emails first" : "Schedule all ready emails to send"}
                >
                  {scheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Send All ({readyCount})
                </Button>
              </>
            ) : (
              /* LinkedIn is generate-only — no sending. Bulk-copy the notes to paste manually. */
              <Button
                size="sm"
                onClick={copyAllNotes}
                disabled={notedCount === 0}
                className="bg-[#0a66c2] hover:bg-[#004182] text-white gap-1.5"
                title={notedCount === 0 ? "Generate notes first" : "Copy all generated notes to paste into LinkedIn"}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy all ({notedCount})
              </Button>
            )}
          </div>
        </div>

        {/* Stats row */}
        {rows.length > 0 && (
          <div className="px-6 py-2 border-b border-border flex items-center gap-4 text-xs text-muted-foreground shrink-0">
            <span><span className="font-semibold text-foreground">{includedRows.length}</span> selected</span>
            {mode === "email" ? (
              <>
                <span><span className="font-semibold text-green-400">{readyCount}</span> ready</span>
                <span><span className="font-semibold text-muted-foreground">{rows.filter((r) => !r.email).length}</span> not generated</span>
              </>
            ) : (
              <>
                <span><span className="font-semibold text-[#0a66c2]">{notedCount}</span> notes ready</span>
                <span><span className="font-semibold text-muted-foreground">{rows.filter((r) => !r.linkedin).length}</span> not generated</span>
              </>
            )}
            {genErrors.length > 0 && (
              <span className="text-red-400"><AlertCircle className="h-3 w-3 inline mr-1" />{genErrors.length} errors</span>
            )}
            <div className="relative ml-auto w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={rowSearch}
                onChange={(e) => setRowSearch(e.target.value)}
                placeholder={mode === "linkedin" ? "Search name, note…" : "Search name, email, subject…"}
                className="w-full h-7 rounded-md border border-input bg-background pl-8 pr-2 text-xs outline-none"
              />
            </div>
            <button
              className="text-xs hover:text-foreground transition-colors shrink-0"
              onClick={() => toggleAllRows(!allIncluded)}
            >
              {allIncluded ? "Deselect all" : "Select all"}
            </button>
          </div>
        )}

        {/* Row list */}
        <div className="flex-1 overflow-y-auto">
          {!selectedWorkflow ? (
            <div className="flex items-center justify-center h-full text-muted-foreground flex-col gap-2">
              {mode === "linkedin" ? <Linkedin className="h-8 w-8 opacity-20" /> : <Mail className="h-8 w-8 opacity-20" />}
              <p className="text-sm">{mode === "linkedin" ? "Select a workflow to generate LinkedIn connection notes" : "Select a workflow to personalize outreach emails"}</p>
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
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{mode === "linkedin" ? "Their article & connection note" : "Their article & subject"}</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24">Status</th>
                  <th className="px-4 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  const author = row.author;
                  const lead = latestArticle(row.articles);
                  const email = emailOf(row.contacts);
                  const gen = row.email;
                  const li = row.linkedin;
                  const liUrl = linkedinOf(row.contacts);
                  const isLi = mode === "linkedin";
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
                              <button onClick={() => openAuthor(row.author_id)} className="truncate hover:text-violet-400 hover:underline text-left" title="View profile & articles">
                                {author?.full_name ?? "Unknown"}
                              </button>
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
                            {isLi ? (
                              liUrl ? (
                                <a href={liUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs truncate max-w-[200px] flex items-center gap-1 text-[#0a66c2] hover:underline" title="Open LinkedIn profile">
                                  <Linkedin className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{liUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
                                </a>
                              ) : (
                                <p className="text-xs text-muted-foreground/50 truncate max-w-[160px]">no LinkedIn on file</p>
                              )
                            ) : email ? (
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
                        {isLi ? (
                          <p className="max-w-md text-sm text-muted-foreground line-clamp-2">
                            {li?.body || <span className="italic opacity-40">Not generated yet</span>}
                          </p>
                        ) : (
                          <p className="truncate max-w-md text-sm">
                            {gen?.subject || <span className="italic opacity-40 text-muted-foreground">Not generated yet</span>}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isLi ? (
                          <Badge variant="outline" className={`text-[11px] capitalize ${li?.body ? "text-[#0a66c2] border-[#0a66c2]/30 bg-[#0a66c2]/10" : "text-muted-foreground border-muted"}`}>
                            {li?.body ? "generated" : "pending"}
                          </Badge>
                        ) : (
                          <StatusBadge status={gen?.status ?? "pending"} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isLi ? (
                          li?.body && (
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => copyText(li.body, author?.full_name ? `${author.full_name}'s note` : "Note")} title="Copy note">
                                <Copy className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEmailEditor(row)}>
                                <Edit2 className="h-3 w-3 mr-1" />Edit
                              </Button>
                            </div>
                          )
                        ) : (
                          gen?.body && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEmailEditor(row)}>
                              <Edit2 className="h-3 w-3 mr-1" />Edit
                            </Button>
                          )
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
            <DialogTitle>
              {editingTemplate
                ? (templateForm.channel === "linkedin" ? "Edit LinkedIn Template" : "Edit Email Template")
                : (templateForm.channel === "linkedin" ? "New LinkedIn Template" : "New Email Template")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Template name</Label>
              <Input placeholder={templateForm.channel === "linkedin" ? "e.g. LinkedIn connect v1" : "e.g. AI Tools Outreach v1"} value={templateForm.name} onChange={(e) => setTemplateForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            {templateForm.channel !== "linkedin" && (
              <div className="space-y-1.5">
                <Label>Subject line</Label>
                <Input placeholder="e.g. Re: your article on {{tool_mentioned}}" value={templateForm.subject} onChange={(e) => setTemplateForm(f => ({ ...f, subject: e.target.value }))} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="flex items-center justify-between">
                <span>{templateForm.channel === "linkedin" ? "Connection note" : "Email body"}</span>
                {templateForm.channel === "linkedin" && (
                  <span className={`text-xs font-normal ${templateForm.body.length > LINKEDIN_LIMIT ? "text-red-400" : "text-muted-foreground"}`}>{templateForm.body.length}/{LINKEDIN_LIMIT}</span>
                )}
              </Label>
              <Textarea
                placeholder={templateForm.channel === "linkedin" ? "{{custom_line}}" : "Hi {{author_name}},&#10;&#10;{{custom_line}}&#10;..."}
                className={`${templateForm.channel === "linkedin" ? "min-h-[120px]" : "min-h-[200px]"} font-mono text-sm`}
                value={templateForm.body}
                onChange={(e) => setTemplateForm(f => ({ ...f, body: e.target.value }))}
              />
              {templateForm.channel === "linkedin" && (
                <p className="text-xs text-muted-foreground">Keep it under {LINKEDIN_LIMIT} characters (LinkedIn's limit). Leave as just {"{{custom_line}}"} to send the AI note verbatim, or wrap it with your own words.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                Writing direction for {"{{custom_line}}"} <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                placeholder={templateForm.channel === "linkedin"
                  ? "e.g. Very warm and brief. Mention one specific thing from their article. No hard pitch — just a genuine reason to connect."
                  : "e.g. Keep it casual and concise. Lead with genuine curiosity about their take on AI video tools. Mention we're a small team, not a big corp. Avoid buzzwords."}
                className="min-h-[90px] text-sm"
                value={templateForm.guidance}
                onChange={(e) => setTemplateForm(f => ({ ...f, guidance: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Steers how the AI writes each personalized {templateForm.channel === "linkedin" ? "note" : "opener"} — tone, angle, what to emphasize or avoid. Applied per-recipient on top of their article context.
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available placeholders</p>
              <div className="grid grid-cols-2 gap-1">
                {(templateForm.channel === "linkedin" ? LINKEDIN_PLACEHOLDER_DOCS : PLACEHOLDER_DOCS).map(([token, desc]) => (
                  <div key={token} className="flex gap-2 text-xs">
                    <code className="text-violet-400 shrink-0">{token}</code>
                    <span className="text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            {templateForm.channel !== "linkedin" && (
              <p className="text-xs text-amber-500/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Heads up: including a link in a cold email increases the chance it lands in spam. The default template has one
                ("I read this at: {"{{article_link}}"}") — delete that line if you'd rather send link-free.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingTemplate(null); setCreatingTemplate(false); }}>Cancel</Button>
            <Button onClick={saveTemplate} disabled={!templateForm.name || !templateForm.body || (templateForm.channel !== "linkedin" && !templateForm.subject) || savingTemplate}>
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
            <SheetTitle>{mode === "linkedin" ? "Edit LinkedIn note" : "Edit Email"}</SheetTitle>
            {editingRow && (
              <p className="text-sm text-muted-foreground">
                {editingRow.author?.full_name}
                {mode === "linkedin"
                  ? linkedinOf(editingRow.contacts) && <span className="text-[#0a66c2]"> · {linkedinOf(editingRow.contacts)!.replace(/^https?:\/\/(www\.)?/, "")}</span>
                  : emailOf(editingRow.contacts) && <span className="text-green-400/80"> · {emailOf(editingRow.contacts)}</span>}
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
            {mode !== "linkedin" && (
              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Input value={editForm.subject} onChange={(e) => setEditForm(f => ({ ...f, subject: e.target.value }))} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="flex items-center justify-between">
                <span>{mode === "linkedin" ? "Connection note" : "Body"}</span>
                {mode === "linkedin" && (
                  <span className={`text-xs font-normal ${editForm.body.length > LINKEDIN_LIMIT ? "text-red-400" : "text-muted-foreground"}`}>{editForm.body.length}/{LINKEDIN_LIMIT}</span>
                )}
              </Label>
              <Textarea className={`${mode === "linkedin" ? "min-h-[160px]" : "min-h-[320px]"} font-mono text-sm`} value={editForm.body} onChange={(e) => setEditForm(f => ({ ...f, body: e.target.value }))} />
              {mode === "linkedin" && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => copyText(editForm.body, "Note")}>
                    <Copy className="h-3 w-3 mr-1" />Copy
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
            <Button variant="outline" onClick={() => setEditingRow(null)}>Cancel</Button>
            <Button onClick={saveEmail} disabled={savingEmail || (mode === "linkedin" && editForm.body.length > LINKEDIN_LIMIT)}>
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
            <p className="text-sm text-muted-foreground">Every email is scheduled in the <span className="text-foreground font-medium">one timezone</span> you pick here — a single, predictable send window for everyone.</p>
          </SheetHeader>
          {config && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 flex items-start gap-2 text-xs text-muted-foreground">
                <Globe className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
                <span>All recipients are standardised to this timezone. You can also change it later on the Sending page and reschedule the queue.</span>
              </div>
              <div className="space-y-1.5">
                <Label>Sending timezone <span className="text-muted-foreground font-normal">(applies to everyone)</span></Label>
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
                Every email sends {config.send_hour_start}:00–{config.send_hour_end}:00 {config.timezone}, {config.gap_minutes} min apart, up to {config.daily_cap}/day. Overflow rolls to the next day.
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

      {/* Send All blocked — the chosen sending identity has no Gmail app password yet */}
      <Dialog open={!!needAppPw} onOpenChange={(v) => { if (!v) setNeedAppPw(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{needAppPw?.label === "your" ? "Add your Gmail app password first" : `${needAppPw?.label}'s Gmail app password isn't set up`}</DialogTitle>
          </DialogHeader>
          {needAppPw?.label === "your" ? (
            <div className="space-y-3 py-1 text-sm">
              <p className="text-muted-foreground">
                Emails send from <span className="text-foreground font-medium">your own Gmail</span>, so you need a Gmail
                <b> app password</b> (not your normal password). One-time setup:
              </p>
              <ol className="space-y-1.5 text-muted-foreground list-decimal pl-5">
                <li>Turn on <a className="text-violet-400 hover:underline" href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noreferrer">2-Step Verification</a>.</li>
                <li>Create an app password (choose “Mail”) at <a className="text-violet-400 hover:underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>.</li>
                <li>Paste it into <b>Settings → Your sending email</b> and save.</li>
              </ol>
              <p className="text-xs text-muted-foreground">You can change it anytime in Settings.</p>
            </div>
          ) : (
            <div className="space-y-3 py-1 text-sm">
              <p className="text-muted-foreground">
                {needAppPw?.sender} needs to sign in and add their own Gmail app password in <b>Settings → Your sending email</b> before anyone can send through this shared inbox.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeedAppPw(null)}>Later</Button>
            {needAppPw?.label === "your" && <Button onClick={() => { setNeedAppPw(null); router.push("/settings"); }}>Go to Settings</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Choose which identity to send from — own email, or a shared inbox */}
      <Dialog open={chooseSenderOpen} onOpenChange={setChooseSenderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send from</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <button
              type="button"
              onClick={() => setChosenSender("")}
              className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors ${chosenSender === "" ? "border-violet-500 bg-violet-500/10" : "border-border hover:bg-muted/40"}`}
            >
              <span className="font-medium">Your own email</span>
              <span className="block text-xs text-muted-foreground">{myEmail || "your Gmail"}</span>
            </button>
            {sharedSenders.map((s) => (
              <button
                key={s.email}
                type="button"
                onClick={() => setChosenSender(s.email)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors ${chosenSender === s.email ? "border-violet-500 bg-violet-500/10" : "border-border hover:bg-muted/40"}`}
              >
                <span className="font-medium">{s.label}&apos;s email</span>
                <span className="block text-xs text-muted-foreground">{s.email} · will show as sent by you in the Sending page</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChooseSenderOpen(false)}>Cancel</Button>
            <Button onClick={() => scheduleSend(chosenSender)} disabled={scheduling} className="bg-violet-600 hover:bg-violet-700 text-white">
              {scheduling && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              <Send className="h-4 w-4 mr-1.5" />Send All ({readyCount})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {drawer}
    </div>
  );
}
