import { supabaseAdmin } from "@/lib/db/supabase";
import { getNegotiationSettings } from "./settings";
import { maxOfferFor } from "./pricing";
import { classifyReplyIntent, draftNegotiationReply, type ThreadMessage } from "./agent";
import { updateOutreachEmail } from "@/lib/db/queries";
import { deliverOutreach } from "@/lib/email/deliver";

export interface NegotiationResult {
  ok: boolean; draftId?: string; body?: string; ceiling: number | null;
  suggestedOffer: number | null; statusHint: string | null; intent: string | null;
  autonomy: boolean; persistedAs: string; sent: boolean; sendError?: string | null; recipientMissing?: boolean;
  error?: string;
}

// Generate (and, when autonomy is ON, immediately SEND) the AI's next negotiation reply for a
// thread. Used by the Negotiation page button AND the send-processor's auto-negotiation loop.
// forceDraft = never auto-send even if autonomy is on (the "just draft it" path).
export async function negotiateThread(emailId: string, opts?: { forceDraft?: boolean }): Promise<NegotiationResult> {
  const base: NegotiationResult = { ok: false, ceiling: null, suggestedOffer: null, statusHint: null, intent: null, autonomy: false, persistedAs: "draft", sent: false };

  const { data: email } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, kind, parent_id, subject, author_id, sender_email, sent_by_email, max_offer, author:authors(full_name, domain:domains(host, name, dr, organic_traffic, us_traffic_share))")
    .eq("id", emailId).maybeSingle();
  if (!email) return { ...base, error: "email not found" };

  const initialId = (email as any).kind === "followup" || (email as any).kind === "negotiation"
    ? ((email as any).parent_id ?? email.id) : email.id;

  const { data: threadRows } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, kind, body, subject, created_at, reply_excerpt, reply_subject, replied_at, parent_id, sender_email, sent_by_email, workflow_id, author_id, message_id")
    .or(`id.eq.${initialId},parent_id.eq.${initialId}`)
    .order("created_at", { ascending: true });
  const rows = (threadRows ?? []) as any[];
  const initial = rows.find((r) => r.id === initialId) ?? (email as any);

  const thread: ThreadMessage[] = [];
  let latestReply: any = null;
  for (const r of rows) {
    if (r.body) thread.push({ from: "us", body: r.body });
    if (r.reply_excerpt) { thread.push({ from: "them", body: r.reply_excerpt }); latestReply = r; }
  }

  const settings = await getNegotiationSettings();
  const dom: any = (email as any).author?.domain ?? null;
  const cls = await classifyReplyIntent(latestReply?.reply_excerpt ?? "", latestReply?.reply_subject ?? "");
  const tier = maxOfferFor(dom?.dr ?? null, dom?.organic_traffic ?? null, dom?.us_traffic_share ?? null, settings.pricing_rules);
  const ceiling = (email as any).max_offer != null ? Number((email as any).max_offer) : (tier?.offer ?? null);

  const draft = await draftNegotiationReply({
    settings, thread,
    authorName: (email as any).author?.full_name ?? "there",
    publication: dom?.name ?? dom?.host ?? "",
    ceiling, floor: settings.min_price, lastIntent: cls.intent, theirPrice: cls.priceMentioned,
  });
  if (!draft) return { ...base, ceiling, intent: cls.intent, error: "No OPENROUTER_API_KEY configured" };

  const subject = /^re:/i.test(initial.subject ?? "") ? initial.subject : `Re: ${initial.subject ?? "(no subject)"}`;
  const autonomy = settings.ai_autonomy && !opts?.forceDraft && cls.intent !== "hard_no" && cls.intent !== "unsubscribe";

  const { data: mc } = await supabaseAdmin.from("contacts").select("value").eq("author_id", initial.author_id).eq("type", "mailto").limit(1).maybeSingle();
  const recipient = ((mc as any)?.value ?? "").replace(/^mailto:/i, "").trim();
  const parentMsgId = (initial as any).message_id ?? undefined;

  // Clear any previous UNSENT draft so we never pile up stale drafts.
  await supabaseAdmin.from("outreach_emails").delete().eq("parent_id", initialId).eq("kind", "negotiation").eq("status", "draft");

  let status = "draft";
  let sent: any = null;
  if (autonomy && recipient) {
    sent = await deliverOutreach({ to: recipient, subject, body: draft.body, sender: initial.sender_email, sentBy: initial.sent_by_email, inReplyTo: parentMsgId, references: parentMsgId }).catch((e: any) => ({ ok: false, error: e?.message }));
    status = sent?.ok ? "sent" : "failed";
  }

  const { data: row } = await supabaseAdmin.from("outreach_emails").insert({
    workflow_id: initial.workflow_id, author_id: initial.author_id, parent_id: initialId,
    kind: "negotiation", subject, body: draft.body, status,
    sent_at: status === "sent" ? new Date().toISOString() : null,
    message_id: sent?.messageId ?? null,
    error: status === "failed" ? (sent?.error ?? "send failed") : null,
    sender_email: initial.sender_email, sent_by_email: initial.sent_by_email,
    ai_managed: true, max_offer: ceiling, negotiation_status: draft.statusHint,
  }).select("id").single();

  const agreedPrice = draft.statusHint === "agreed" ? (draft.suggestedOffer ?? cls.priceMentioned ?? null) : null;
  await updateOutreachEmail(initialId, {
    negotiation_status: draft.statusHint,
    negotiation_notes: `their intent: ${cls.intent} (${cls.reason}); our offer: ${draft.suggestedOffer ?? "-"}; ceiling: ${ceiling ?? "placement-only"}`,
    ...(draft.statusHint === "agreed" ? { agreed_price: agreedPrice, payment_status: agreedPrice ? "owed" : null } : {}),
  } as any);

  return {
    ok: true, draftId: (row as any)?.id, body: draft.body, ceiling,
    suggestedOffer: draft.suggestedOffer, statusHint: draft.statusHint, intent: cls.intent,
    autonomy, persistedAs: status, sent: status === "sent",
    sendError: status === "failed" ? (sent?.error ?? "send failed") : null,
    recipientMissing: autonomy && !recipient,
  };
}
