// Qualification + fit rating from the Outreach Requirement sheet's 4 filters:
//   1. DR >= 50                         (real Ahrefs DR)
//   2. Total organic traffic >= 10K/mo  (real when a paid source is connected; else unverified)
//   3. USA majority > 50%               (real when a paid source is connected; else unverified)
//   4. Relevancy: >= 5 seed-keyword matches OR a clear AI-image/art/design niche
//
// "Unverified" (null traffic / US-share) never DISQUALIFIES — the two free filters (DR +
// relevancy) qualify a prospect now, and the paid filters tighten it later once real data
// lands. No value is ever fabricated. `fit` (0-100) blends every real signal we have into a
// single "connection to the requirements" rating.

export const DR_MIN = 50;
export const TRAFFIC_MIN = 10_000;
export const US_MIN = 50; // percent
export const RELEVANCE_MIN = 40; // 0-100 topical-relevance bar (proxy for ">=5 seed matches / clear niche")

export interface QualifyInput {
  dr: number | null;            // real Ahrefs DR, or null if not checked yet
  organicTraffic: number | null; // monthly organic visits, or null if unverified
  usTrafficShare: number | null; // 0-100, or null if unverified
  relevance: number;             // 0-100 (from the score model — blends LLM + keyword + mentions)
  mentionCount: number;          // # of tool/topic mentions across their articles
  articleCount: number;
  hasEmail: boolean;
  contactConfidence: number;     // 0-1 best contact
}

export interface Qualification {
  dr: number | null;
  drPass: boolean;
  traffic: number | null;
  trafficPass: boolean | null;   // null = unverified
  usShare: number | null;
  usPass: boolean | null;        // null = unverified
  relevance: number;
  relevancePass: boolean;
  qualified: boolean;            // meets the free filters, and no verified paid filter fails
  fit: number;                   // 0-100 overall connection-to-requirements rating
  checks: { label: string; state: "pass" | "fail" | "unverified" }[];
}

export function qualifyProspect(i: QualifyInput): Qualification {
  const drPass = i.dr != null && i.dr >= DR_MIN;
  const trafficPass = i.organicTraffic == null ? null : i.organicTraffic >= TRAFFIC_MIN;
  const usPass = i.usTrafficShare == null ? null : i.usTrafficShare > US_MIN;
  // Relevancy: strong topical relevance OR clearly wrote about the space (>=5 mentions).
  const relevancePass = i.relevance >= RELEVANCE_MIN || i.mentionCount >= 5;

  // Qualified = both free filters pass, and neither paid filter has a VERIFIED failure.
  const qualified = drPass && relevancePass && trafficPass !== false && usPass !== false;

  // ─── Fit (0-100): weighted average of the real signals we actually have ───────
  // DR and relevance always count; traffic/US only join once verified; reachability
  // rewards an actionable (emailable) prospect. Weights renormalize over present signals.
  const drScore = i.dr == null ? null : Math.min(100, i.dr);
  const relScore = Math.min(100, i.relevance);
  const reach = i.hasEmail ? 100 : Math.round((i.contactConfidence || 0) * 100);
  const trafficScore = i.organicTraffic == null ? null : Math.min(100, Math.round((i.organicTraffic / TRAFFIC_MIN) * 60)); // 10K -> 60, caps at 100
  const usScore = i.usTrafficShare == null ? null : Math.min(100, Math.round(i.usTrafficShare));

  const parts: { w: number; v: number }[] = [
    { w: 0.40, v: drScore ?? -1 },
    { w: 0.30, v: relScore },
    { w: 0.15, v: reach },
    { w: 0.10, v: trafficScore ?? -1 },
    { w: 0.05, v: usScore ?? -1 },
  ].filter((p) => p.v >= 0);
  const wsum = parts.reduce((s, p) => s + p.w, 0) || 1;
  const fit = Math.round(parts.reduce((s, p) => s + p.w * p.v, 0) / wsum);

  const checks: Qualification["checks"] = [
    { label: `DR ≥ ${DR_MIN}`, state: i.dr == null ? "unverified" : drPass ? "pass" : "fail" },
    { label: `Traffic ≥ ${(TRAFFIC_MIN / 1000)}K`, state: trafficPass == null ? "unverified" : trafficPass ? "pass" : "fail" },
    { label: `US > ${US_MIN}%`, state: usPass == null ? "unverified" : usPass ? "pass" : "fail" },
    { label: "Relevant", state: relevancePass ? "pass" : "fail" },
  ];

  return {
    dr: i.dr, drPass,
    traffic: i.organicTraffic, trafficPass,
    usShare: i.usTrafficShare, usPass,
    relevance: i.relevance, relevancePass,
    qualified, fit, checks,
  };
}
