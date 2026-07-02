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
    const { name, keywords, region, target_hits } = body;
    if (!name || !keywords?.length) {
      return NextResponse.json({ error: "name and keywords required" }, { status: 400 });
    }
    const campaign = await createCampaign({ name, keywords, region, target_hits });
    return NextResponse.json(campaign, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
