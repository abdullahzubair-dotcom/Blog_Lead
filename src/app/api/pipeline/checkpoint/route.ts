import { NextResponse } from "next/server";
import { findLatestCheckpoint } from "@/lib/pipeline/checkpoint";

export async function GET() {
  const checkpoint = findLatestCheckpoint();
  return NextResponse.json(checkpoint ?? null);
}
