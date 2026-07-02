import { NextRequest, NextResponse } from "next/server";
import { checkAllKeys } from "@/lib/health/keys";

// Services excluded from the banner alert (still checked/listed, just not warned about).
const SUPPRESSED = new Set(["reoon", "hunter"]);

// GET /api/health/keys — status of every configured external API key.
// ?force=1 bypasses the 10-min cache (used by a manual "recheck" button).
export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const keys = await checkAllKeys(force);
  const broken = keys.filter((k) => k.configured && !k.ok && !SUPPRESSED.has(k.service));
  return NextResponse.json({ keys, broken, healthy: broken.length === 0 });
}
