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

  // Run the pipeline via after() so it's fully independent of the caller's tab/connection:
  // closing the tab never stops it (Vercel keeps the function alive for after() work, up to
  // maxDuration; long crawls then auto-continue via QStash). The UI shows progress by polling
  // /api/pipeline/live (Redis-durable), and the QStash auto-continuation path is identical.
  after(async () => {
    try { await runDiscoveryPipeline(undefined, { campaignId, customKeywords, resume }); }
    catch { if (campaignId) await updateCampaign(campaignId, { status: "done" }).catch(() => {}); }
  });
  return NextResponse.json({ started: true, auto: body.auto === true });
}

export async function GET() {
  return NextResponse.json({ message: "POST to this endpoint to start discovery" });
}
