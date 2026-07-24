import { supabaseAdmin } from "@/lib/db/supabase";
import { getNegotiationSettings } from "./settings";
import { maxOfferFor } from "./pricing";
import { classifyReplyIntent, draftNegotiationReply, type ThreadMessage } from "./agent";
import { updateOutreachEmail, getUserEmailConfig } from "@/lib/db/queries";
import { deliverOutreach } from "@/lib/email/deliver";

// The reply goes out from the initial's sender inbox, so it must be SIGNED by that person, not a
// hardcoded name. Prefer their configured From name; else derive a first name from the address.
function firstNameFromEmail(e?: string | null): string | undefined {
  if (!e) return undefined;
  const local = (e.split("@")[0] || "").split(/[._+-]/)[0] || "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : undefined;
}

// Human-readable "why a person is needed" per intervention type (shown on the Negotiation page).
const INTERVENTION_REASON: Record<string, string> = {
  asset_request: "They want a document/assets the AI cannot attach on its own.",
  identity_verification: "They want proof of who we are (LinkedIn / website / references).",
  sync_contact: "They want a live call or meeting, which only a person can take.",
  scheduling: "They want availability or a calendar link.",
  redirect: "They pointed us to a different contact to email.",
  process_portal: "They want us to submit via a form/portal or create an account.",
  legal_contract: "They want a contract/NDA handled or signed.",
  payment_details: "They want invoice/PO/bank/tax details.",
  factual_question: "They asked a factual question the AI must not fabricate.",
  over_policy: "They want terms beyond our price ceiling or policy.",
  inbound_attachment: "They sent a file for us to review.",
  other_channel: "They want to move to another channel (WhatsApp/phone/etc.).",
  other: "This reply needs a person to handle it.",
};

export interface NegotiationResult {
  ok: boolean; draftId?: string; body?: string; ceiling: number | null;
  suggestedOffer: number | null; statusHint: string | null; intent: string | null;
  autonomy: boolean; persistedAs: string; sent: boolean; sendError?: string | null; recipientMissing?: boolean;
  error?: string;
}

// Generate (and, when autonomy is ON, immediately SEND) the AI's next negotiation reply for a
// thread. Used by the Negotiation page button AND the send-processor's auto-negotiation loop.
// forceDraft = never auto-send even if autonomy is on (the "just draft it" path).
export async function negotiateThread(emailId: string, opts?: { forceDraft?: boolean; assistInput?: string | null }): Promise<NegotiationResult> {
  const base: NegotiationResult = { ok: false, ceiling: null, suggestedOffer: null, statusHint: null, intent: null, autonomy: false, persistedAs: "draft", sent: false };
  const assisting = !!(opts?.assistInput && opts.assistInput.trim());

  const { data: email } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, kind, parent_id, subject, author_id, sender_email, sent_by_email, max_offer, author:authors(full_name, domain:domains(host, name, dr, organic_traffic, us_traffic_share))")
    .eq("id", emailId).maybeSingle();
  if (!email) return { ...base, error: "email not found" };

  const initialId = (email as any).kind === "followup" || (email as any).kind === "negotiation"
    ? ((email as any).parent_id ?? email.id) : email.id;

  const { data: threadRows } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, kind, body, subject, created_at, reply_excerpt, reply_subject, replied_at, parent_id, sender_email, sent_by_email, workflow_id, author_id, message_id, recipient_override")
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

  // HUMAN-INTERVENTION SHORT-CIRCUIT. If the writer asked for something the AI cannot do (a
  // document/call/redirect/etc.) and no human assist input was supplied, never draft or send a
  // hollow reply — flag the thread for a person and stop. (When assisting, the human HAS provided
  // what's needed, so we fall through and draft a truthful reply.)
  if (cls.intent === "needs_human" && !assisting) {
    await supabaseAdmin.from("outreach_emails").delete().eq("parent_id", initialId).eq("kind", "negotiation").eq("status", "draft");
    const itype = cls.interventionType ?? "other";
    await updateOutreachEmail(initialId, {
      negotiation_status: "needs_human",
      intervention_type: itype,
      intervention_ask: cls.interventionAsk ?? "asked for something the AI cannot do",
      intervention_reason: INTERVENTION_REASON[itype] ?? INTERVENTION_REASON.other,
      intervention_at: new Date().toISOString(),
      negotiation_notes: `needs human: ${itype} — ${cls.interventionAsk ?? ""}`,
    } as any);
    return { ...base, ok: true, ceiling, intent: cls.intent, statusHint: "needs_human", persistedAs: "needs_human" };
  }

  // When assisting, load any uploaded document so the draft can truthfully say it's attached.
  let asset: { name: string; mime: string; b64: string } | null = null;
  if (assisting) {
    const { data: a } = await supabaseAdmin.from("outreach_emails")
      .select("intervention_asset_name, intervention_asset_mime, intervention_asset_b64").eq("id", initialId).maybeSingle();
    if ((a as any)?.intervention_asset_b64) asset = { name: (a as any).intervention_asset_name || "attachment", mime: (a as any).intervention_asset_mime || "application/octet-stream", b64: (a as any).intervention_asset_b64 };
  }

  // Sign as the person whose inbox this reply is sent from (initial.sender_email).
  const senderCfg = (initial as any).sender_email ? await getUserEmailConfig((initial as any).sender_email).catch(() => null) : null;
  const senderName = (senderCfg?.from_name?.trim().split(/\s+/)[0]) || firstNameFromEmail((initial as any).sender_email);

  const draft = await draftNegotiationReply({
    settings, thread,
    authorName: (email as any).author?.full_name ?? "there",
    publication: dom?.name ?? dom?.host ?? "",
    ceiling, floor: settings.min_price, lastIntent: cls.intent, theirPrice: cls.priceMentioned,
    senderName,
    assistInput: assisting ? opts!.assistInput : null,
    assistHasAttachment: !!asset,
  });
  if (!draft) return { ...base, ceiling, intent: cls.intent, error: "No OPENROUTER_API_KEY configured" };

  // Post-generation guard tripped inside the agent (model tried to promise a capability with no
  // backing input): route to a human instead of sending the fabricated reply.
  if (draft.needsHuman) {
    await supabaseAdmin.from("outreach_emails").delete().eq("parent_id", initialId).eq("kind", "negotiation").eq("status", "draft");
    const itype = draft.interventionType ?? "other";
    await updateOutreachEmail(initialId, {
      negotiation_status: "needs_human",
      intervention_type: itype,
      intervention_ask: draft.interventionAsk ?? "reply would need something the AI cannot provide",
      intervention_reason: INTERVENTION_REASON[itype] ?? INTERVENTION_REASON.other,
      intervention_at: new Date().toISOString(),
      negotiation_notes: `needs human (guard): ${itype}`,
    } as any);
    return { ...base, ok: true, ceiling, intent: "needs_human", statusHint: "needs_human", persistedAs: "needs_human" };
  }

  const subject = /^re:/i.test(initial.subject ?? "") ? initial.subject : `Re: ${initial.subject ?? "(no subject)"}`;
  const autonomy = settings.ai_autonomy && !opts?.forceDraft && cls.intent !== "hard_no" && cls.intent !== "unsubscribe" && cls.intent !== "needs_human";

  const { data: mc } = await supabaseAdmin.from("contacts").select("value").eq("author_id", initial.author_id).eq("type", "mailto").limit(1).maybeSingle();
  // Test-send override on the initial keeps the whole AI thread on the test address.
  const recipient = ((initial as any).recipient_override && (initial as any).recipient_override.trim())
    || ((mc as any)?.value ?? "").replace(/^mailto:/i, "").trim();
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
    recipient_override: (initial as any).recipient_override ?? null,
    ai_managed: true, max_offer: ceiling, negotiation_status: draft.statusHint,
  }).select("id").single();

  const agreedPrice = draft.statusHint === "agreed" ? (draft.suggestedOffer ?? cls.priceMentioned ?? null) : null;
  await updateOutreachEmail(initialId, {
    negotiation_status: draft.statusHint,
    negotiation_notes: `their intent: ${cls.intent} (${cls.reason}); our offer: ${draft.suggestedOffer ?? "-"}; ceiling: ${ceiling ?? "placement-only"}`,
    ...(draft.statusHint === "agreed" ? { agreed_price: agreedPrice, payment_status: agreedPrice ? "owed" : null } : {}),
    // Assisting resolves the intervention: clear the ask/reason so it leaves the Human-intervention
    // bucket. The uploaded asset (if any) is kept until the reply is actually sent, then cleared.
    ...(assisting ? { intervention_ask: null, intervention_reason: null, intervention_at: null, intervention_type: null } : {}),
  } as any);

  return {
    ok: true, draftId: (row as any)?.id, body: draft.body, ceiling,
    suggestedOffer: draft.suggestedOffer, statusHint: draft.statusHint, intent: cls.intent,
    autonomy, persistedAs: status, sent: status === "sent",
    sendError: status === "failed" ? (sent?.error ?? "send failed") : null,
    recipientMissing: autonomy && !recipient,
  };
}
