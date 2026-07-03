import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { getWorkflowEmails, getWorkflowProspects, getUserEmailConfig, scheduleWorkflowEmails, getContactedAuthorIds } from "@/lib/db/queries";
import { computeSmartSchedule, type ScheduleRecipient } from "@/lib/email/schedule";
import type { EmailSendConfig } from "@/lib/types";

export const maxDuration = 300;

// POST — schedule all ready emails for included prospects. Sends from the LOGGED-IN USER'S
// own Gmail, on THEIR schedule (timezone/window/spacing/cap). Requires the user to have set
// their Gmail app password first (else returns needsAppPassword for the UI popup). Each
// scheduled email is stamped with the sender; delivery happens via the send-processor.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await auth().catch(() => null);
    const senderEmail = (session?.user?.email as string | undefined) ?? "";
    if (!senderEmail) return NextResponse.json({ error: "not signed in" }, { status: 401 });

    const userCfg = await getUserEmailConfig(senderEmail);
    if (!userCfg.hasPassword) {
      return NextResponse.json({
        needsAppPassword: true,
        reason: "Add your Gmail app password in Settings so emails send from your own address.",
      });
    }
    // Shape the per-user config for computeSmartSchedule.
    const config: EmailSendConfig = {
      id: "", workflow_id: id, provider: "smtp", created_at: "",
      timezone: userCfg.timezone, send_hour_start: userCfg.send_hour_start, send_hour_end: userCfg.send_hour_end,
      gap_minutes: userCfg.gap_minutes, daily_cap: userCfg.daily_cap, from_name: userCfg.from_name, from_email: senderEmail,
    };

    const [emails, { prospects }] = await Promise.all([
      getWorkflowEmails(id),
      getWorkflowProspects(id, { limit: 1000 }),
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

    // Everyone in this sender's queue is scheduled in the sender's own timezone/window.
    const recipients: ScheduleRecipient[] = sendable.map((e) => ({ id: e.id, tz: config.timezone }));

    const slots = computeSmartSchedule(recipients, config, new Date());
    await scheduleWorkflowEmails(id, slots.map((s) => s.id), slots.map((s) => s.at), senderEmail);

    return NextResponse.json({
      scheduled: slots.length,
      skippedContacted,
      sender: senderEmail,
      firstAt: slots[0]?.at,
      lastAt: slots[slots.length - 1]?.at,
      timezone: config.timezone,
      config: { timezone: config.timezone, gap_minutes: config.gap_minutes, daily_cap: config.daily_cap, window: `${config.send_hour_start}:00–${config.send_hour_end}:00` },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
