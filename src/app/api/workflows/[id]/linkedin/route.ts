import { NextRequest, NextResponse } from "next/server";
import { getLinkedinMessages, upsertLinkedinMessage } from "@/lib/db/queries";

// GET — all generated LinkedIn notes for this workflow (merged into rows client-side).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await getLinkedinMessages(id));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH — hand-edit one prospect's note ({ author_id, body }). Upserts on workflow+author.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { author_id, body } = await req.json();
    if (!author_id || typeof body !== "string") {
      return NextResponse.json({ error: "author_id and body required" }, { status: 400 });
    }
    await upsertLinkedinMessage({ workflow_id: id, author_id, body });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
