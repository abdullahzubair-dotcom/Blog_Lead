import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";
import { getNegotiationSettings } from "@/lib/negotiation/settings";
import { maxOfferFor } from "@/lib/negotiation/pricing";

// GET — every outreach thread that has engagement (a reply / bounce / auto-reply) or is
// AI-managed, classified into triage buckets and priced by the site's DR tier. Powers the
// Negotiation page: needs-reply / negotiating / agreed / hard-no / automated / bounced.
export async function GET() {
  try {
    const settings = await getNegotiationSettings();
    const { data } = await supabaseAdmin
      .from("outreach_emails")
      .select("id, author_id, subject, status, replied_at, bounced_at, reply_kind, reply_sentiment, reply_excerpt, reply_subject, negotiation_status, ai_managed, max_offer, sent_at, created_at, sender_email, author:authors(full_name, domain:domains(host, name, dr, organic_traffic, us_traffic_share))")
      .eq("kind", "initial")
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(1000);

    const rows = (data ?? []).filter((r: any) => r.replied_at || r.bounced_at || r.ai_managed || r.negotiation_status);

    // The latest negotiation reply per thread (to read/send/regenerate on the page).
    const ids = rows.map((r: any) => r.id);
    const draftByParent = new Map<string, { status: string; body: string; id: string }>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data: kids } = await supabaseAdmin
        .from("outreach_emails").select("id, parent_id, status, body, created_at")
        .eq("kind", "negotiation").in("parent_id", ids.slice(i, i + 300))
        .order("created_at", { ascending: false });
      for (const k of kids ?? []) if (!draftByParent.has((k as any).parent_id)) draftByParent.set((k as any).parent_id, { status: (k as any).status, body: (k as any).body, id: (k as any).id });
    }

    const threads = rows.map((r: any) => {
      const dom = r.author?.domain ?? null;
      const tier = maxOfferFor(dom?.dr ?? null, dom?.organic_traffic ?? null, dom?.us_traffic_share ?? null, settings.pricing_rules);
      const ceiling = r.max_offer != null ? Number(r.max_offer) : (tier?.offer ?? null);
      const draft = draftByParent.get(r.id);
      // Buckets: bounced / automated / hard_no / agreed take precedence. Then a reply that we
      // have NOT answered yet = needs_reply; one we've replied to = negotiating. No reply yet
      // (AI-managed, scheduled or sent) = queued (waiting on them).
      let category: string;
      if (r.bounced_at) category = "bounced";
      else if (r.reply_kind === "auto") category = "automated";
      else if (r.negotiation_status === "declined") category = "hard_no";
      else if (r.negotiation_status === "agreed") category = "agreed";
      else if (r.replied_at) category = draft?.status === "sent" ? "negotiating" : "needs_reply";
      else category = "queued";
      return {
        status: r.status,
        id: r.id, authorId: r.author_id, name: r.author?.full_name ?? "Unknown",
        publication: dom?.name ?? dom?.host ?? "", host: dom?.host ?? "", dr: dom?.dr ?? null,
        ceiling, category, replyKind: r.reply_kind, sentiment: r.reply_sentiment,
        repliedAt: r.replied_at, bouncedAt: r.bounced_at, sentAt: r.sent_at, negotiationStatus: r.negotiation_status,
        aiManaged: r.ai_managed, subject: r.subject, replyExcerpt: r.reply_excerpt,
        sender: r.sender_email,
        draftStatus: draftByParent.get(r.id)?.status ?? null,
        // Only an UNSENT draft (draft/failed) is editable/sendable. Once sent, it is read-only
        // history (badge "AI replied"), so don't hand the page a body to re-show or re-send.
        draftBody: draftByParent.get(r.id)?.status === "sent" ? null : (draftByParent.get(r.id)?.body ?? null),
      };
    });

    return NextResponse.json({ threads, autonomy: settings.ai_autonomy, currency: settings.currency });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
