import { NextResponse } from "next/server";
import { abortEnrich } from "@/lib/enrich/enrichBuffer";

export async function POST() {
  abortEnrich();
  return NextResponse.json({ ok: true });
}
