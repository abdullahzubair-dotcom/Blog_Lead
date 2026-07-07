import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { getWorkflowEmails, getWorkflowProspects, getUserEmailConfig, scheduleWorkflowEmails, getContactedAuthorIds, getEnabledSharedSenders } from "@/lib/db/queries";
import { computeSmartSchedule, type ScheduleRecipient } from "@/lib/email/schedule";
import type { EmailSendConfig } from "@/lib/types";

export const maxDuration = 300;

// POST — schedule all ready emails for included prospects.
// Body: { sender_email?: string } — omit (or your own address) to send from your own Gmail
// as before; pass a currently-enabled shared inbox's address (managed in Admin) to send
// from that identity instead. Either way, sent_by_email always records who actually
// clicked Send, so attribution isn't lost when sending through a shared inbox.
// Requires the CHOSEN identity to have a Gmail app password set (else needsAppPassword).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await auth().catch(() => null);
    const sentByEmail = (session?.user?.email as string | undefined) ?? "";
    if (!sentByEmail) return NextResponse.json({ error: "not signed in" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    let senderEmail = sentByEmail;
    let shared: { email: string; label: string } | undefined;
    if (typeof body.sender_email === "string" && body.sender_email && body.sender_email !== sentByEmail) {
      shared = (await getEnabledSharedSenders()).find((s) => s.email === body.sender_email);
      if (!shared) {
        return NextResponse.json({ error: "That shared inbox isn't available right now — it may have been turned off in Admin." }, { status: 400 });
      }
      senderEmail = shared.email;
    }

    const userCfg = await getUserEmailConfig(senderEmail);
    if (!userCfg.hasPassword) {
      return NextResponse.json({
        needsAppPassword: true,
        sender: senderEmail,
        reason: shared
          ? `${shared.label}'s Gmail app password isn't set up yet.`
          : "Add your Gmail app password in Settings so emails send from your own address.",
      });
    }
    // Shape the chosen identity's config for computeSmartSchedule (timezone/window/cap
    // protect whichever Gmail account is actually sending, so they come from its owner).
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
    await scheduleWorkflowEmails(id, slots.map((s) => s.id), slots.map((s) => s.at), senderEmail, sentByEmail);

    return NextResponse.json({
      scheduled: slots.length,
      skippedContacted,
      sender: senderEmail,
      sentBy: sentByEmail,
      firstAt: slots[0]?.at,
      lastAt: slots[slots.length - 1]?.at,
      timezone: config.timezone,
      config: { timezone: config.timezone, gap_minutes: config.gap_minutes, daily_cap: config.daily_cap, window: `${config.send_hour_start}:00–${config.send_hour_end}:00` },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
