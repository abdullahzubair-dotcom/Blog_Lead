import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";
import { getNegotiationSettings } from "@/lib/negotiation/settings";
import { maxOfferFor } from "@/lib/negotiation/pricing";
import { classifyReplyIntent, draftNegotiationReply, type ThreadMessage } from "@/lib/negotiation/agent";
import { updateOutreachEmail } from "@/lib/db/queries";

export const maxDuration = 60;

// POST { emailId, send? } — draft the AI's next negotiation reply for a replied thread.
// Uses the site's DR/traffic to pick the pricing ceiling, classifies their last reply, and
// writes a kind='negotiation' row: status 'draft' for human approval (default), or 'scheduled'
// to auto-send when AI autonomy is ON. Returns the draft + classification + ceiling.
export async function POST(req: NextRequest) {
  const { emailId, send } = await req.json().catch(() => ({}));
  if (!emailId) return NextResponse.json({ error: "emailId required" }, { status: 400 });

  try {
    const { data: email } = await supabaseAdmin
      .from("outreach_emails")
      .select("*, author:authors(id, full_name, domain:domains(host, name, dr, organic_traffic, us_traffic_share))")
      .eq("id", emailId).maybeSingle();
    if (!email) return NextResponse.json({ error: "email not found" }, { status: 404 });

    const initialId = (email as any).kind === "followup" || (email as any).kind === "negotiation"
      ? ((email as any).parent_id ?? email.id) : email.id;

    const { data: threadRows } = await supabaseAdmin
      .from("outreach_emails")
      .select("id, kind, body, subject, created_at, reply_excerpt, reply_subject, replied_at, parent_id, sender_email, sent_by_email, workflow_id, author_id")
      .or(`id.eq.${initialId},parent_id.eq.${initialId}`)
      .order("created_at", { ascending: true });
    const rows = (threadRows ?? []) as any[];
    const initial = rows.find((r) => r.id === initialId) ?? (email as any);

    // Build the conversation (our sent bodies + their reply excerpts) and find their latest reply.
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
    if (!draft) return NextResponse.json({ error: "No OPENROUTER_API_KEY configured — cannot draft" }, { status: 400 });

    const subject = /^re:/i.test(initial.subject ?? "") ? initial.subject : `Re: ${initial.subject ?? "(no subject)"}`;
    const autonomy = settings.ai_autonomy && send !== false && cls.intent !== "hard_no" && cls.intent !== "unsubscribe";
    const status = autonomy ? "scheduled" : "draft";
    const scheduled_at = autonomy ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;

    const { data: row, error } = await supabaseAdmin.from("outreach_emails").insert({
      workflow_id: initial.workflow_id, author_id: initial.author_id, parent_id: initialId,
      kind: "negotiation", subject, body: draft.body, status, scheduled_at,
      sender_email: initial.sender_email, sent_by_email: initial.sent_by_email,
      ai_managed: true, max_offer: ceiling, negotiation_status: draft.statusHint,
    }).select("id").single();
    if (error) throw error;

    // On agreement, record the agreed price and flag it as owed so it lands on the Payments page.
    const agreedPrice = draft.statusHint === "agreed" ? (draft.suggestedOffer ?? cls.priceMentioned ?? null) : null;
    await updateOutreachEmail(initialId, {
      negotiation_status: draft.statusHint,
      negotiation_notes: `their intent: ${cls.intent} (${cls.reason}); our offer: ${draft.suggestedOffer ?? "-"}; ceiling: ${ceiling ?? "placement-only"}`,
      ...(draft.statusHint === "agreed" ? { agreed_price: agreedPrice, payment_status: agreedPrice ? "owed" : null } : {}),
    } as any);

    return NextResponse.json({
      ok: true, draftId: row.id, body: draft.body, classification: cls,
      ceiling, suggestedOffer: draft.suggestedOffer, statusHint: draft.statusHint,
      autonomy, persistedAs: status,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "draft failed" }, { status: 500 });
  }
}
