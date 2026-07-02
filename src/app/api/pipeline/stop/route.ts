import { NextResponse } from "next/server";
import { stopPipeline } from "@/lib/pipeline/abort";

export async function POST() {
  const stopped = stopPipeline();
  return NextResponse.json({ stopped });
}
