import { NextRequest, NextResponse, after } from "next/server";
import { runDiscoveryPipeline } from "@/lib/pipeline/run";
import { getCampaign, updateCampaign } from "@/lib/db/queries";
import { findLatestCheckpoint } from "@/lib/pipeline/checkpoint";

export const maxDuration = 300; // 5 minutes on Vercel

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let campaignId = body.campaign_id as string | undefined;
  let customKeywords: string[] | undefined;
  let seedWriter: { name?: string; articleUrl?: string } | undefined;
  let resume: { usedQueries: string[]; round: number; rssComplete: boolean; discoveryDone?: boolean; oldRunId?: string } | undefined;

  // Resume mode — load checkpoint and continue from where we left off
  if (body.resume === true) {
    const cp = await findLatestCheckpoint();
    if (cp) {
      resume = { usedQueries: cp.usedQueries, round: cp.round, rssComplete: cp.rssComplete, discoveryDone: cp.discoveryDone, oldRunId: cp.runId };
      if (!campaignId && cp.campaignId) campaignId = cp.campaignId;
      if (!customKeywords && cp.customKeywords) customKeywords = cp.customKeywords;
    }
  }

  if (campaignId && !resume) {
    const campaign = await getCampaign(campaignId);
    if (campaign) {
      customKeywords = campaign.keywords.length > 0 ? campaign.keywords : undefined;
      if (campaign.seed_writer_name || campaign.seed_article_url) {
        seedWriter = { name: campaign.seed_writer_name ?? undefined, articleUrl: campaign.seed_article_url ?? undefined };
      }
      await updateCampaign(campaignId, { status: "running" });
    }
  } else if (campaignId && resume) {
    await updateCampaign(campaignId, { status: "running" }).catch(() => {});
  }

  // Run the pipeline via after() so it's fully independent of the caller's tab/connection:
  // closing the tab never stops it (Vercel keeps the function alive for after() work, up to
  // maxDuration; long crawls then auto-continue via QStash). The UI shows progress by polling
  // /api/pipeline/live (Redis-durable), and the QStash auto-continuation path is identical.
  // (seedWriter is only ever set on a fresh, non-resumed run — see discover/route.ts above —
  // and runDiscoveryPipeline itself also guards on !isResuming, so a resume never re-runs it.)
  after(async () => {
    try { await runDiscoveryPipeline(undefined, { campaignId, customKeywords, seedWriter, resume }); }
    catch { if (campaignId) await updateCampaign(campaignId, { status: "done" }).catch(() => {}); }
  });
  return NextResponse.json({ started: true, auto: body.auto === true });
}

export async function GET() {
  return NextResponse.json({ message: "POST to this endpoint to start discovery" });
}
