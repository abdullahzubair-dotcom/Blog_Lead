import { NextRequest, NextResponse } from "next/server";
import { getGen } from "@/lib/email/genBuffer";

// Progress of an in-flight (or just-finished) email generation for this workflow.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gen = await getGen(id);
  if (!gen) return NextResponse.json({ running: false, done: 0, total: 0, errors: [] });
  return NextResponse.json({
    running: gen.running,
    done: gen.done,
    total: gen.total,
    errors: gen.errors,
  });
}
