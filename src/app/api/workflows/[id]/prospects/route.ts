import { NextRequest, NextResponse } from "next/server";
import { getWorkflowProspects, addWorkflowProspect, setWorkflowProspectsIncluded } from "@/lib/db/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  try {
    const result = await getWorkflowProspects(id, { offset, limit });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — add ONE author to this workflow (search-and-add). Body: { author_id }.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { author_id } = await req.json();
    if (!author_id) return NextResponse.json({ error: "author_id required" }, { status: 400 });
    await addWorkflowProspect(id, author_id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH — bulk include/exclude in one request (Select all / Deselect all). Body:
// { included: boolean, author_ids?: string[] } — omit author_ids to affect all in the workflow.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { included, author_ids } = await req.json();
    await setWorkflowProspectsIncluded(id, included === true, Array.isArray(author_ids) ? author_ids : undefined);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
