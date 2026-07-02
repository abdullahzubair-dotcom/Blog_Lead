import { NextRequest, NextResponse, after } from "next/server";
import { runDiscoveryPipeline } from "@/lib/pipeline/run";
import { getCampaign, updateCampaign } from "@/lib/db/queries";
import { findLatestCheckpoint } from "@/lib/pipeline/checkpoint";

export const maxDuration = 300; // 5 minutes on Vercel

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let campaignId = body.campaign_id as string | undefined;
  let customKeywords: string[] | undefined;
  let resume: { usedQueries: string[]; round: number; rssComplete: boolean; oldRunId?: string } | undefined;

  // Resume mode — load checkpoint and continue from where we left off
  if (body.resume === true) {
    const cp = await findLatestCheckpoint();
    if (cp) {
      resume = { usedQueries: cp.usedQueries, round: cp.round, rssComplete: cp.rssComplete, oldRunId: cp.runId };
      if (!campaignId && cp.campaignId) campaignId = cp.campaignId;
      if (!customKeywords && cp.customKeywords) customKeywords = cp.customKeywords;
    }
  }

  if (campaignId && !resume) {
    const campaign = await getCampaign(campaignId);
    if (campaign) {
      customKeywords = campaign.keywords.length > 0 ? campaign.keywords : undefined;
      await updateCampaign(campaignId, { status: "running" });
    }
  } else if (campaignId && resume) {
    await updateCampaign(campaignId, { status: "running" }).catch(() => {});
  }

  // Auto-continuation from QStash (no browser to stream to): run the next chunk via after()
  // and return immediately. The UI tracks progress by polling /api/pipeline/live.
  if (body.auto === true) {
    after(async () => {
      try { await runDiscoveryPipeline(undefined, { campaignId, customKeywords, resume }); }
      catch { if (campaignId) await updateCampaign(campaignId, { status: "done" }).catch(() => {}); }
    });
    return NextResponse.json({ continued: true });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // browser disconnected — pipeline keeps running server-side
        }
      };

      try {
        const { runId, stats } = await runDiscoveryPipeline(
          (progress) => send(progress),
          { campaignId, customKeywords, resume }
        );
        send({ stage: "done", runId, stats });
      } catch (e: any) {
        if (campaignId) await updateCampaign(campaignId, { status: "done" }).catch(() => {});
        send({ stage: "error", message: e?.message ?? "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export async function GET() {
  return NextResponse.json({ message: "POST to this endpoint to start discovery" });
}
