"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Inbox, Loader2, RefreshCw, Send, Paperclip, X, Ban, Search, Smile, Frown, Meh, Trophy, AlertTriangle, Archive, ArchiveRestore, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuthorDrawer } from "@/components/prospects/useAuthorDrawer";

interface Person {
  author_id: string; name: string; publication: string; avatar_url: string | null; recipient: string;
  sender_email: string | null; sender_label: string | null;
  category: "replied" | "filtered" | "sent";
  last_at: string | null; replied_at: string | null; bounced_at: string | null;
  reply_kind: string | null; reply_subject: string | null; reply_excerpt: string | null; reply_sentiment: string | null;
  success_at: string | null; subject: string; unread: boolean; dismissed: boolean;
  needs_reply: boolean; ai_managed: boolean; negotiation_status: string | null;
}
interface Msg {
  uid: number; direction: "outbound" | "inbound"; from: string; fromName: string; to: string;
  subject: string; date: string; body: string; kind: string | null; messageId: string | null;
  hasAttachments: boolean; images: string[]; attachments: { filename: string; contentType: string }[];
}

const TABS = [
  { key: "unread", label: "Unread" },
  { key: "needs_reply", label: "Needs your reply" },
  { key: "replied", label: "Responses" },
  { key: "sent", label: "Awaiting" },
  { key: "filtered", label: "Filtered" },
  { key: "dismissed", label: "Dismissed" },
] as const;
type Tab = typeof TABS[number]["key"];

function timeLabel(iso?: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
function Sentiment({ s }: { s: string | null }) {
  if (s === "positive") return <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 border border-emerald-500/40 rounded px-1"><Smile className="h-3 w-3" />positive</span>;
  if (s === "negative") return <span className="inline-flex items-center gap-1 text-[10px] text-red-400 border border-red-500/40 rounded px-1"><Frown className="h-3 w-3" />negative</span>;
  if (s === "neutral") return <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 border border-amber-500/40 rounded px-1"><Meh className="h-3 w-3" />neutral</span>;
  return null;
}
function ListSkeleton() {
  return <div className="p-2 space-y-1">{Array.from({ length: 8 }).map((_, i) => (
    <div key={i} className="flex items-start gap-2.5 px-2 py-2.5 animate-pulse">
      <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
      <div className="flex-1 space-y-1.5"><div className="h-3 bg-muted rounded w-2/3" /><div className="h-2.5 bg-muted/60 rounded w-1/2" /></div>
    </div>))}</div>;
}
function ThreadSkeleton() {
  return <div className="px-5 py-4 space-y-3">{[0, 1, 2].map((i) => (
    <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"} animate-pulse`}>
      <div className={`h-16 rounded-2xl bg-muted ${i % 2 ? "w-[55%]" : "w-[65%]"}`} />
    </div>))}</div>;
}

export default function InboxPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("unread");
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "unread" | "name" | "sentiment">("recent");
  const [sentFilter, setSentFilter] = useState<"all" | "positive" | "neutral" | "negative">("all");
  const [wonOnly, setWonOnly] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadErr, setThreadErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string>("");
  const [accounts, setAccounts] = useState<{ email: string; label: string }[]>([]);
  const [me, setMe] = useState<string>("");
  const [viewAs, setViewAs] = useState<string>(""); // empty = own inbox
  const asQ = viewAs ? `?as=${encodeURIComponent(viewAs)}` : "";

  const [replyText, setReplyText] = useState("");
  const [attachments, setAttachments] = useState<{ filename: string; content: string; contentType: string }[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const { openAuthor, drawer } = useAuthorDrawer();

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch(`/api/inbox${asQ}`).then((r) => r.json());
      setPeople(d.people ?? []); setCounts(d.counts ?? {});
      setAccounts(d.accounts ?? []); setMe(d.me ?? "");
    } catch {}
    setLoading(false);
  }, [asQ]);
  useEffect(() => { loadList(); setSelected(null); }, [loadList]);

  const loadThread = useCallback(async (p: Person) => {
    setThreadLoading(true); setThreadErr(null); setMessages([]);
    try {
      const d = await fetch(`/api/inbox/${p.author_id}${asQ}`).then((r) => r.json());
      setMessages(d.messages ?? []); setAccount(d.target?.account ?? "");
      if (d.error) setThreadErr(d.error);
    } catch (e: any) { setThreadErr(e?.message ?? "Failed to load conversation"); }
    setThreadLoading(false);
    setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [asQ]);

  function selectPerson(p: Person) {
    setSelected(p); setReplyText(""); setAttachments([]); loadThread(p);
    if (p.unread) { setPeople((ps) => ps.map((x) => x.author_id === p.author_id ? { ...x, unread: false } : x)); setCounts((c) => ({ ...c, unread: Math.max(0, (c.unread ?? 1) - 1) })); }
  }

  async function dismiss(p: Person, dismissed: boolean, e?: React.MouseEvent) {
    e?.stopPropagation();
    setPeople((ps) => ps.map((x) => x.author_id === p.author_id ? { ...x, dismissed } : x));
    setCounts((c) => ({ ...c, dismissed: (c.dismissed ?? 0) + (dismissed ? 1 : -1) }));
    await fetch(`/api/inbox/${p.author_id}/dismiss${asQ}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismissed }) }).catch(() => {});
    toast.info(dismissed ? `${p.name} moved to Dismissed.` : `${p.name} restored.`);
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const next: typeof attachments = [];
    for (const f of Array.from(files).slice(0, 10)) {
      if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name} is over 8MB — skipped.`); continue; }
      const content = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
      next.push({ filename: f.name, content, contentType: f.type || "application/octet-stream" });
    }
    setAttachments((a) => [...a, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function sendReply() {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    const lastMsgId = [...messages].reverse().find((m) => m.messageId)?.messageId ?? null;
    const res = await fetch(`/api/inbox/${selected.author_id}/reply${asQ}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: replyText, inReplyTo: lastMsgId, attachments }),
    }).then((r) => r.json()).catch(() => ({ error: "network error" }));
    setSending(false);
    if (res.ok) {
      toast.success(`Reply sent to ${selected.name}.`);
      setMessages((m) => [...m, {
        uid: -Date.now(), direction: "outbound", from: account, fromName: "You", to: selected.recipient,
        subject: res.subject ?? "", date: new Date().toISOString(), body: replyText, kind: null,
        messageId: res.messageId ?? null, hasAttachments: attachments.length > 0,
        images: attachments.filter((a) => a.contentType.startsWith("image/")).map((a) => a.content), attachments: [],
      }]);
      setReplyText(""); setAttachments([]);
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      setTimeout(() => selected && loadThread(selected), 7000);
    } else toast.error(res.error ?? "Couldn't send reply.");
  }

  const inTab = (p: Person) => tab === "dismissed" ? p.dismissed
    : !p.dismissed && (tab === "unread" ? p.unread : tab === "needs_reply" ? p.needs_reply : p.category === tab);
  const dateOf = (p: Person) => new Date(p.last_at ?? p.replied_at ?? p.success_at ?? 0).getTime();
  const sentRank = (s: string | null) => (s === "positive" ? 0 : s === "neutral" ? 1 : s === "negative" ? 2 : 3);
  // The AI negotiator owns this thread and is still working it — block manual replies to avoid
  // colliding with it (take it over on the Negotiation page first).
  const aiLocked = !!selected?.ai_managed && [null, "negotiating"].includes(selected?.negotiation_status ?? null);
  const filtered = people
    .filter((p) => inTab(p)
      && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.publication.toLowerCase().includes(q.toLowerCase()) || p.recipient.toLowerCase().includes(q.toLowerCase()))
      && (sentFilter === "all" || p.reply_sentiment === sentFilter)
      && (!wonOnly || !!p.success_at))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "oldest") return dateOf(a) - dateOf(b);
      if (sortBy === "unread") return a.unread === b.unread ? dateOf(b) - dateOf(a) : (a.unread ? -1 : 1);
      if (sortBy === "sentiment") { const r = sentRank(a.reply_sentiment) - sentRank(b.reply_sentiment); return r !== 0 ? r : dateOf(b) - dateOf(a); }
      return dateOf(b) - dateOf(a); // recent
    });

  return (
    <div className="-m-6 flex h-[calc(100vh-64px)] overflow-hidden">
      {/* People list */}
      <div className="w-80 border-r border-border flex flex-col shrink-0 overflow-hidden min-h-0">
        <div className="p-3 border-b border-border flex items-center gap-2 shrink-0">
          <Inbox className="h-4 w-4 text-violet-500 shrink-0" />
          <p className="text-sm font-semibold flex-1">Inbox</p>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={loadList} title="Refresh"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
        {accounts.length > 1 && (
          <div className="px-3 py-2 border-b border-border shrink-0">
            <select
              value={viewAs || me}
              onChange={(e) => setViewAs(e.target.value === me ? "" : e.target.value)}
              className="w-full h-8 text-xs rounded-md border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-violet-500"
              title="View another team member's inbox"
            >
              {accounts.map((a) => (
                <option key={a.email} value={a.email}>{a.email === me ? `${a.label} (you)` : `${a.label} — ${a.email}`}</option>
              ))}
            </select>
            {viewAs && viewAs !== me && <p className="text-[10px] text-amber-500 mt-1">Viewing {viewAs} as admin</p>}
          </div>
        )}
        <div className="px-3 py-2 border-b border-border relative shrink-0">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 pl-8 text-sm" />
        </div>
        <div className="flex flex-wrap gap-1 px-2 py-2 border-b border-border shrink-0">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`text-xs px-2 py-1 rounded-md font-medium ${tab === t.key ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:bg-muted/40"}`}>
              {t.label} <span className="opacity-70 tabular-nums">{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
        {/* Sort + filter toolbar */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} title="Sort" className="h-7 rounded-md border border-border bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-500">
            <option value="recent">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="unread">Unread first</option>
            <option value="name">Name A–Z</option>
            <option value="sentiment">Sentiment</option>
          </select>
          <div className="flex items-center gap-0.5 ml-auto">
            <button onClick={() => setSentFilter("all")} title="All sentiments" className={`px-1.5 h-7 rounded-md text-[11px] ${sentFilter === "all" ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:bg-muted/40"}`}>All</button>
            <button onClick={() => setSentFilter("positive")} title="Positive only" className={`p-1 h-7 rounded-md ${sentFilter === "positive" ? "bg-emerald-500/15 text-emerald-400" : "text-muted-foreground hover:bg-muted/40"}`}><Smile className="h-3.5 w-3.5" /></button>
            <button onClick={() => setSentFilter("neutral")} title="Neutral only" className={`p-1 h-7 rounded-md ${sentFilter === "neutral" ? "bg-amber-500/15 text-amber-400" : "text-muted-foreground hover:bg-muted/40"}`}><Meh className="h-3.5 w-3.5" /></button>
            <button onClick={() => setSentFilter("negative")} title="Negative only" className={`p-1 h-7 rounded-md ${sentFilter === "negative" ? "bg-red-500/15 text-red-400" : "text-muted-foreground hover:bg-muted/40"}`}><Frown className="h-3.5 w-3.5" /></button>
            <button onClick={() => setWonOnly((w) => !w)} title="Wins only" className={`p-1 h-7 rounded-md ${wonOnly ? "bg-amber-500/15 text-amber-400" : "text-muted-foreground hover:bg-muted/40"}`}><Trophy className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? <ListSkeleton /> : filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {tab === "unread" ? "No unread replies. 🎉" : tab === "needs_reply" ? "Nobody waiting on your reply. 🎉" : tab === "dismissed" ? "Nothing dismissed." : tab === "filtered" ? "No bounces or auto-replies." : tab === "sent" ? "Nobody awaiting a reply." : "No responses yet."}
            </p>
          ) : filtered.map((p) => (
            <div key={p.author_id} onClick={() => selectPerson(p)} className={`group w-full text-left px-3 py-2.5 border-b border-border/60 flex items-start gap-2.5 hover:bg-muted/40 cursor-pointer ${selected?.author_id === p.author_id ? "bg-muted/50" : ""}`}>
              <div className="relative shrink-0">
                <Avatar className="h-8 w-8"><AvatarImage src={p.avatar_url ?? undefined} /><AvatarFallback className="text-xs">{p.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                {p.unread && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-violet-500 ring-2 ring-background" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm truncate flex-1 ${p.unread ? "font-semibold" : "font-medium"}`}>{p.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{timeLabel(p.last_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{p.reply_excerpt || p.publication || p.recipient}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {p.success_at && <Trophy className="h-3 w-3 text-amber-400" />}
                  {p.category === "replied" && <Sentiment s={p.reply_sentiment} />}
                  {p.bounced_at && <span className="text-[10px] text-red-400 border border-red-500/40 rounded px-1 inline-flex items-center gap-1"><Ban className="h-3 w-3" />bounced</span>}
                  {p.reply_kind === "auto" && !p.bounced_at && <span className="text-[10px] text-muted-foreground border border-border rounded px-1">auto-reply</span>}
                </div>
              </div>
              <button onClick={(e) => dismiss(p, !p.dismissed, e)} title={p.dismissed ? "Restore" : "Dismiss (push aside)"} className="opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-foreground p-1">
                {p.dismissed ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Inbox className="h-8 w-8 opacity-20" /><p className="text-sm">Pick a person to see the full conversation and reply.</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0">
              <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={selected.avatar_url ?? undefined} /><AvatarFallback className="text-xs">{selected.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
              <div className="min-w-0">
                <button onClick={() => openAuthor(selected.author_id)} className="text-sm font-semibold hover:text-violet-400 hover:underline text-left truncate block">{selected.name}</button>
                <p className="text-xs text-muted-foreground truncate">{selected.recipient}{account ? ` · via ${selected.sender_label ?? account}` : ""}</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {selected.category === "replied" && <Sentiment s={selected.reply_sentiment} />}
                <Button size="sm" variant="outline" className="h-8" onClick={() => openAuthor(selected.author_id)}>View profile</Button>
                <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={(e) => dismiss(selected, !selected.dismissed, e)}>{selected.dismissed ? <><ArchiveRestore className="h-3.5 w-3.5" />Restore</> : <><Archive className="h-3.5 w-3.5" />Dismiss</>}</Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => loadThread(selected)} title="Refresh"><RefreshCw className={`h-3.5 w-3.5 ${threadLoading ? "animate-spin" : ""}`} /></Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
              {threadLoading ? <ThreadSkeleton /> : threadErr && messages.length === 0 ? (
                <div className="flex items-start gap-2 text-sm text-amber-500 bg-amber-500/8 border border-amber-500/25 rounded-md px-3 py-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{threadErr}</div>
              ) : messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages found in the mailbox for this person.</p>
              ) : messages.map((m) => {
                const mine = m.direction === "outbound"; const bounce = m.kind === "bounce", auto = m.kind === "auto";
                return (
                  <div key={m.uid} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-violet-600/90 text-white rounded-br-sm" : bounce ? "bg-red-500/10 border border-red-500/30 rounded-bl-sm" : auto ? "bg-muted/40 border border-border rounded-bl-sm" : "bg-muted rounded-bl-sm"}`}>
                      <div className={`flex items-center gap-2 mb-1 text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
                        <span className="font-semibold">{mine ? "You" : (m.fromName || m.from)}</span>
                        {bounce && <span className="inline-flex items-center gap-0.5 text-red-400"><Ban className="h-2.5 w-2.5" />bounce</span>}
                        {auto && <span>auto-reply</span>}
                        {m.hasAttachments && <Paperclip className="h-2.5 w-2.5" />}
                        <span className="ml-auto">{timeLabel(m.date)}</span>
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed break-words">{m.body || <span className="opacity-60 italic">(no text)</span>}</div>
                      {m.images?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.images.map((src, i) => (
                            <a key={i} href={src} target="_blank" rel="noreferrer">
                              <img src={src} alt="" loading="lazy" className="max-h-40 max-w-[220px] rounded-md border border-border/50 object-contain bg-white/5" />
                            </a>
                          ))}
                        </div>
                      )}
                      {m.attachments?.filter((a) => !a.contentType.startsWith("image/")).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.attachments.filter((a) => !a.contentType.startsWith("image/")).map((a, i) => (
                            <span key={i} className={`inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 ${mine ? "bg-white/15" : "bg-background border border-border"}`}><Paperclip className="h-2.5 w-2.5" />{a.filename}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>

            <div className="border-t border-border p-3 shrink-0">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {attachments.map((a, i) => (
                    <div key={i} className="relative group">
                      {a.contentType.startsWith("image/") ? <img src={a.content} alt={a.filename} className="h-14 w-14 object-cover rounded-md border border-border" /> : <div className="h-14 w-14 flex items-center justify-center rounded-md border border-border bg-muted text-[9px] text-center p-1 break-all">{a.filename}</div>}
                      <button onClick={() => setAttachments((at) => at.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )}
              {aiLocked && (
                <div className="flex items-center gap-2 mb-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-2.5 py-1.5">
                  <Bot className="h-3.5 w-3.5 shrink-0" />
                  <span>The AI negotiator is handling this thread. Take it over on the <a href="/negotiation" className="underline">Negotiation page</a> (Hand off) before replying here.</span>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={() => fileRef.current?.click()} title="Attach images" disabled={aiLocked}><Paperclip className="h-4 w-4" /></Button>
                <Textarea placeholder={aiLocked ? "AI is handling this thread — hand off on the Negotiation page to reply here." : `Reply to ${selected.name}…`} disabled={aiLocked} className="min-h-[44px] max-h-40 flex-1 resize-none disabled:opacity-60" value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }} />
                <Button size="sm" className="h-9 shrink-0 gap-1.5" disabled={sending || !replyText.trim() || aiLocked} onClick={sendReply}>{sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send</Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 pl-11">Replies thread into the Gmail conversation · ⌘/Ctrl+Enter to send</p>
            </div>
          </>
        )}
      </div>
      {drawer}
    </div>
  );
}
