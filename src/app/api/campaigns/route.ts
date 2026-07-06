import { NextRequest, NextResponse } from "next/server";
import { getCampaigns, createCampaign } from "@/lib/db/queries";

export async function GET() {
  try {
    const campaigns = await getCampaigns();
    return NextResponse.json(campaigns);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, keywords, region, target_hits, seed_writer_name, seed_article_url } = body;
    if (!name || (!keywords?.length && !seed_writer_name && !seed_article_url)) {
      return NextResponse.json({ error: "name and at least one of keywords / seed writer / seed article are required" }, { status: 400 });
    }
    const campaign = await createCampaign({ name, keywords: keywords ?? [], region, target_hits, seed_writer_name, seed_article_url });
    return NextResponse.json(campaign, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
