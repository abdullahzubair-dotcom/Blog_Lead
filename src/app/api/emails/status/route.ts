import { NextRequest, NextResponse } from "next/server";
import { getSendingStatus, getSharedSenders } from "@/lib/db/queries";
import { inferTimezone, localTimeLabel } from "@/lib/email/timezones";
import { isGuessSource } from "@/lib/enrich/personFilter";

// Sending status for the progress page. Counts are all-time; queued + sent/failed lists
// are paginated (?recent_offset / ?upcoming_offset) so the UI can load more back through
// the full history. ROI rates are computed from the all-time counts.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const workflowId = sp.get("workflow_id") ?? undefined;
  const recentOffset = parseInt(sp.get("recent_offset") ?? "0", 10) || 0;
  const upcomingOffset = parseInt(sp.get("upcoming_offset") ?? "0", 10) || 0;
  // Grow-a-window pagination: the page passes the total count it wants shown so a 5s poll
  // always returns the whole shown set (offset stays 0). Capped so a poll can't get huge.
  const recentLimit = Math.min(500, parseInt(sp.get("recent_limit") ?? "40", 10) || 40);
  const upcomingLimit = Math.min(500, parseInt(sp.get("upcoming_limit") ?? "60", 10) || 60);
  const followupLimit = Math.min(500, parseInt(sp.get("followup_limit") ?? "200", 10) || 200);
  const repliedLimit = Math.min(500, parseInt(sp.get("replied_limit") ?? "200", 10) || 200);

  const [{ counts, upcoming, upcomingTotal, recent, recentTotal, followups, followupsTotal, replied, repliedTotal }, sharedSenders] = await Promise.all([
    getSendingStatus({ workflowId, recentOffset, recentLimit, upcomingOffset, upcomingLimit, followupLimit, repliedLimit }),
    getSharedSenders(),
  ]);
  const sharedLabelByEmail = new Map(sharedSenders.map((s) => [s.email, s.label]));

  const enrich = (e: any) => {
    const host = e.author?.domain?.host as string | undefined;
    const country = e.author?.domain?.country as string | undefined;
    const tz = e.author?.timezone || inferTimezone(host, country, "America/New_York");
    const when = e.scheduled_at ?? e.sent_at;
    const mailto = (e.author?.contacts ?? []).find((c: any) => c.type === "mailto");
    return {
      id: e.id,
      author_id: e.author_id,
      sender_email: e.sender_email ?? null,
      sender_label: e.sender_email ? sharedLabelByEmail.get(e.sender_email) ?? null : null,
      sent_by_email: e.sent_by_email ?? null,
      author_name: e.author?.full_name ?? "Unknown",
      publication: e.author?.domain?.name ?? host ?? "",
      subject: e.subject ?? "",
      status: e.status,
      kind: e.kind ?? "initial",
      parent_id: e.parent_id ?? null,
      scheduled_at: e.scheduled_at,
      sent_at: e.sent_at,
      error: e.error,
      replied_at: e.replied_at ?? null,
      bounced_at: e.bounced_at ?? null,
      reply_kind: e.reply_kind ?? null,
      reply_from: e.reply_from ?? null,
      reply_subject: e.reply_subject ?? null,
      reply_excerpt: e.reply_excerpt ?? null,
      success_at: e.success_at ?? null,
      success_link: e.success_link ?? null,
      success_notes: e.success_notes ?? null,
      tz,
      local_label: when ? localTimeLabel(when, tz) : null,
      guess: isGuessSource(mailto?.source),
    };
  };

  const sent = counts.sent ?? 0;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  const roi = {
    replyRate: pct(counts.replied ?? 0, sent),          // replies ÷ sent
    winRate: pct(counts.success ?? 0, sent),            // coverage secured ÷ sent
    replyToWin: pct(counts.success ?? 0, counts.replied ?? 0), // conversion of replies → wins
  };

  return NextResponse.json({
    counts, roi,
    upcoming: upcoming.map(enrich), upcomingTotal,
    recent: recent.map(enrich), recentTotal,
    followups: followups.map(enrich), followupsTotal,
    replied: replied.map(enrich), repliedTotal,
  });
}
