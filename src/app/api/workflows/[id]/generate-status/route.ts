import { NextRequest, NextResponse } from "next/server";
import { getGen } from "@/lib/email/genBuffer";

// Progress of an in-flight (or just-finished) generation for this workflow.
// ?channel=linkedin polls the LinkedIn-note generation (keyed separately) so email
// and LinkedIn runs don't clobber each other's progress.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channel = req.nextUrl.searchParams.get("channel");
  const gen = await getGen(channel === "linkedin" ? `${id}:linkedin` : id);
  if (!gen) return NextResponse.json({ running: false, done: 0, total: 0, errors: [] });
  return NextResponse.json({
    running: gen.running,
    done: gen.done,
    total: gen.total,
    errors: gen.errors,
  });
}
