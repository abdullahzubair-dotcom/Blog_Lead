import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { openProposalPr } from "@/lib/indexing/repo";
import type { ChangeRequestPreview } from "@/lib/indexing/routing";
import { logDispatch } from "@/lib/indexing/persist";

export const maxDuration = 60;

// Opens a real GitHub PR for one routing preview. Session-only (no CRON_SECRET path) — this
// is a write action visible to others and must always be a deliberate human click, never an
// automated/scheduled call.
export async function POST(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const preview = body?.preview as ChangeRequestPreview | undefined;
  const runId: string | null = body?.runId ?? null;
  if (!preview || preview.kind !== "pr") {
    return NextResponse.json({ ok: false, error: "expected a PR-routed preview" }, { status: 400 });
  }

  try {
    const pr = await openProposalPr(preview, new Date().toISOString());
    await logDispatch({
      runId,
      kind: "pr",
      reason: preview.reason,
      title: preview.title,
      targetRef: pr.url,
      status: "ok",
      dispatchedBy: session.user.email,
    });
    return NextResponse.json({ ok: true, pr });
  } catch (e: any) {
    const message = e?.message ?? "PR creation failed";
    await logDispatch({
      runId,
      kind: "pr",
      reason: preview.reason,
      title: preview.title,
      status: "error",
      error: message,
      dispatchedBy: session.user.email,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
