import { NextResponse } from "next/server";
import { getPipelineRuns } from "@/lib/db/queries";

export async function GET() {
  const runs = await getPipelineRuns(20);
  return NextResponse.json(runs);
}
