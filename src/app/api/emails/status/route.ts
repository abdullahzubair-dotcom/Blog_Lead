import { NextRequest, NextResponse } from "next/server";
import { getSendingStatus, getSharedSenders } from "@/lib/db/queries";
import { inferTimezone, localTimeLabel } from "@/lib/email/timezones";
import { isGuessSource } from "@/lib/enrich/personFilter";

// Sending status for the progress page. Enriches upcoming/recent emails with the
// recipient's inferred timezone + a local-time label so the UI can show "9:14 AM PKT".
export async function GET(req: NextRequest) {
  const workflowId = req.nextUrl.searchParams.get("workflow_id") ?? undefined;
  const [{ counts, upcoming, recent }, sharedSenders] = await Promise.all([
    getSendingStatus(workflowId),
    getSharedSenders(), // labels shown even if since disabled — history should still read "from Zain"
  ]);
  const sharedLabelByEmail = new Map(sharedSenders.map((s) => [s.email, s.label]));

  const enrich = (e: any) => {
    const host = e.author?.domain?.host as string | undefined;
    const country = e.author?.domain?.country as string | undefined;
    // Prefer the cached per-author timezone (what scheduling actually used).
    const tz = e.author?.timezone || inferTimezone(host, country, "America/New_York");
    const when = e.scheduled_at ?? e.sent_at;
    const mailto = (e.author?.contacts ?? []).find((c: any) => c.type === "mailto");
    return {
      id: e.id,
      author_id: e.author_id,
      sender_email: e.sender_email ?? null,
      sender_label: e.sender_email ? sharedLabelByEmail.get(e.sender_email) ?? null : null, // e.g. "Zain" when sent through a shared inbox
      sent_by_email: e.sent_by_email ?? null, // who actually clicked Send, if different from sender_email
      author_name: e.author?.full_name ?? "Unknown",
      publication: e.author?.domain?.name ?? host ?? "",
      subject: e.subject ?? "",
      status: e.status,
      scheduled_at: e.scheduled_at,
      sent_at: e.sent_at,
      error: e.error,
      replied_at: e.replied_at ?? null,
      tz,
      local_label: when ? localTimeLabel(when, tz) : null,
      guess: isGuessSource(mailto?.source),
    };
  };

  // Reply rate is of SUCCESSFULLY SENT emails only — a failed send can't have gotten a
  // reply, so it's excluded from the denominator even if someone manually checked it.
  const repliedAmongSent = recent.filter((e: any) => e.status === "sent" && e.replied_at).length;
  const replyRate = counts.sent > 0 ? Math.round((repliedAmongSent / counts.sent) * 1000) / 10 : 0;

  return NextResponse.json({
    counts,
    replyRate,
    upcoming: upcoming.map(enrich),
    recent: recent.map(enrich),
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  });
}
