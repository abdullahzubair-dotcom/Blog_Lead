import { NextRequest, NextResponse } from "next/server";
import { toggleWorkflowProspect } from "@/lib/db/queries";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; aid: string }> }
) {
  const { id, aid } = await params;
  try {
    const { included } = await req.json();
    await toggleWorkflowProspect(id, aid, Boolean(included));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
