import { NextRequest, NextResponse } from "next/server";
import { getSendingStatus } from "@/lib/db/queries";
import { inferTimezone, localTimeLabel } from "@/lib/email/timezones";
import { isGuessSource } from "@/lib/enrich/personFilter";

// Sending status for the progress page. Enriches upcoming/recent emails with the
// recipient's inferred timezone + a local-time label so the UI can show "9:14 AM PKT".
export async function GET(req: NextRequest) {
  const workflowId = req.nextUrl.searchParams.get("workflow_id") ?? undefined;
  const { counts, upcoming, recent } = await getSendingStatus(workflowId);

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
      author_name: e.author?.full_name ?? "Unknown",
      publication: e.author?.domain?.name ?? host ?? "",
      subject: e.subject ?? "",
      status: e.status,
      scheduled_at: e.scheduled_at,
      sent_at: e.sent_at,
      error: e.error,
      tz,
      local_label: when ? localTimeLabel(when, tz) : null,
      guess: isGuessSource(mailto?.source),
    };
  };

  return NextResponse.json({
    counts,
    upcoming: upcoming.map(enrich),
    recent: recent.map(enrich),
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  });
}
