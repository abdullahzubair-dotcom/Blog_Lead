import { NextRequest, NextResponse } from "next/server";
import { getWorkflowEmails, getWorkflowProspects, getSendConfigOrDefault, scheduleWorkflowEmails, setAuthorTimezones, getContactedAuthorIds } from "@/lib/db/queries";
import { computeSmartSchedule, type ScheduleRecipient } from "@/lib/email/schedule";
import { inferTimezones, type TzCandidate } from "@/lib/email/inferTz";

export const maxDuration = 300;

// POST — schedule all ready emails for included prospects. Each email is placed inside
// its RECIPIENT'S local send window, using a per-author timezone that we determine from
// (1) a cached authors.timezone, (2) country-code TLD, or (3) an LLM guess off the
// writer's name + publication. All sends still share one account, so they stay spaced
// apart and under the daily cap. Delivery happens via the Vercel cron → /api/emails/process.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [emails, { prospects }, config] = await Promise.all([
      getWorkflowEmails(id),
      getWorkflowProspects(id, { limit: 1000 }),
      getSendConfigOrDefault(id),
    ]);

    const includedIds = new Set(prospects.filter((p) => p.included).map((p) => p.author_id));
    const prospectByAuthor = new Map(prospects.map((p) => [p.author_id, p]));

    // Never contact someone already emailed/queued in another campaign.
    const contactedElsewhere = await getContactedAuthorIds(id);

    let skippedContacted = 0;
    const sendable = emails.filter((e) => {
      if (!includedIds.has(e.author_id)) return false;
      if (e.status !== "ready" && e.status !== "scheduled") return false;
      if (contactedElsewhere.has(e.author_id)) { skippedContacted++; return false; }
      const contacts = (prospectByAuthor.get(e.author_id) as any)?.contacts ?? [];
      return contacts.some((c: any) => c.type === "mailto");
    });

    if (sendable.length === 0) {
      return NextResponse.json({
        scheduled: 0,
        skippedContacted,
        reason: skippedContacted > 0
          ? `All candidates were already contacted in another campaign (${skippedContacted} skipped).`
          : "No ready emails with a recipient address — generate first.",
      });
    }

    // Resolve each author's timezone. Use the cached value where present; infer the rest.
    const tzByAuthor: Record<string, string> = {};
    const toInfer: TzCandidate[] = [];
    for (const e of sendable) {
      const p: any = prospectByAuthor.get(e.author_id);
      const cached = p?.author?.timezone as string | undefined;
      if (cached) { tzByAuthor[e.author_id] = cached; continue; }
      toInfer.push({
        authorId: e.author_id,
        name: p?.author?.full_name ?? "Unknown",
        publication: p?.domain?.name ?? undefined,
        host: p?.domain?.host ?? undefined,
        country: p?.domain?.country ?? undefined,
        bio: p?.author?.bio ?? undefined,
      });
    }

    if (toInfer.length > 0) {
      const inferred = await inferTimezones(toInfer, config.timezone);
      Object.assign(tzByAuthor, inferred);
      await setAuthorTimezones(inferred).catch(() => {}); // cache for next time
    }

    const recipients: ScheduleRecipient[] = sendable.map((e) => ({
      id: e.id,
      tz: tzByAuthor[e.author_id] || config.timezone,
    }));

    const slots = computeSmartSchedule(recipients, config, new Date());
    await scheduleWorkflowEmails(id, slots.map((s) => s.id), slots.map((s) => s.at));

    // Report the distribution of timezones so it's clear they differ
    const tzCounts: Record<string, number> = {};
    for (const r of recipients) tzCounts[r.tz] = (tzCounts[r.tz] ?? 0) + 1;

    return NextResponse.json({
      scheduled: slots.length,
      skippedContacted,
      firstAt: slots[0]?.at,
      lastAt: slots[slots.length - 1]?.at,
      timezones: tzCounts,
      config: { fallback_timezone: config.timezone, gap_minutes: config.gap_minutes, daily_cap: config.daily_cap, window: `${config.send_hour_start}:00–${config.send_hour_end}:00` },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
