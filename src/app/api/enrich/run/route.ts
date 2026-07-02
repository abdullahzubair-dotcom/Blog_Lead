import { NextRequest, NextResponse } from "next/server";
import { getAuthorsNeedingEmail, getAuthorsNeedingLinkedin, getCampaign } from "@/lib/db/queries";
import { startEnrich, isEnrichRunning } from "@/lib/enrich/enrichBuffer";
import { enrichLoop, type FindMode } from "@/lib/enrich/run";

export const maxDuration = 300;

// POST { campaign_id?, mode? } — start an on-demand finding run for the campaign's (or all)
// authors that lack an email (mode="email", default) or a LinkedIn (mode="linkedin").
// Runs detached so it survives tab close.
export async function POST(req: NextRequest) {
  if (isEnrichRunning()) return NextResponse.json({ started: false, alreadyRunning: true });

  const { campaign_id, mode } = await req.json().catch(() => ({}));
  const findMode: FindMode = mode === "linkedin" ? "linkedin" : "email";
  const targets = findMode === "linkedin"
    ? await getAuthorsNeedingLinkedin(campaign_id)
    : await getAuthorsNeedingEmail(campaign_id);
  if (targets.length === 0) {
    return NextResponse.json({ started: false, total: 0, reason: findMode === "linkedin" ? "Every author already has a LinkedIn on file." : "No authors without an email." });
  }

  const campaign = campaign_id ? await getCampaign(campaign_id).catch(() => null) : null;
  startEnrich(campaign_id ?? "all", targets.length, campaign?.name);
  enrichLoop(targets, findMode); // fire-and-forget — free sources + Blitz

  return NextResponse.json({ started: true, total: targets.length, mode: findMode });
}
