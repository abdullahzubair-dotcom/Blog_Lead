import { NextRequest, NextResponse } from "next/server";
import { getAuthorsNeedingEmail, getAuthorsNeedingLinkedin } from "@/lib/db/queries";

// How many authors in this campaign (or all) still lack an email (default) or a LinkedIn.
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaign_id") ?? undefined;
  const mode = req.nextUrl.searchParams.get("mode");
  const authors = mode === "linkedin"
    ? await getAuthorsNeedingLinkedin(campaignId)
    : await getAuthorsNeedingEmail(campaignId);
  return NextResponse.json({ count: authors.length });
}
