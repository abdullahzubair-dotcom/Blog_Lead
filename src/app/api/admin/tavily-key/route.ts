import { NextRequest, NextResponse } from "next/server";
import { getTavilyUsage, setTavilyKeyOverride, clearTavilyKeyOverride, hasTavilyKeyOverride } from "@/lib/search/tavilyUsage";

// GET — whether an override key is currently set (never returns the key itself) + live usage.
export async function GET() {
  const [override, usage] = await Promise.all([hasTavilyKeyOverride(), getTavilyUsage()]);
  return NextResponse.json({ hasOverride: override, usage });
}

// POST — swap in a new Tavily key at runtime, no redeploy needed. Resets the usage counter
// since a new/different key starts its own quota.
export async function POST(req: NextRequest) {
  const { key } = await req.json().catch(() => ({}));
  if (typeof key !== "string" || !key.trim()) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }
  try {
    await setTavilyKeyOverride(key.trim());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE — revert to the TAVILY_API_KEY env var.
export async function DELETE() {
  await clearTavilyKeyOverride();
  return NextResponse.json({ ok: true });
}
