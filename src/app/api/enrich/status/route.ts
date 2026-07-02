import { NextResponse } from "next/server";
import { getEnrich } from "@/lib/enrich/enrichBuffer";

// Live progress + verbose log of the current/last email-finding run.
export async function GET() {
  const run = getEnrich();
  if (!run) return NextResponse.json({ running: false, total: 0, done: 0, found: 0, bySource: {}, people: [] });
  return NextResponse.json({
    running: run.running,
    total: run.total,
    done: run.done,
    found: run.found,
    bySource: run.bySource,
    campaignName: run.campaignName,
    people: run.people, // one entry per author: { name, steps, status, email, source }
  });
}
