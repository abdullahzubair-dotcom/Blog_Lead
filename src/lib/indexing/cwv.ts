// Core Web Vitals monitor (PRD R7) + diagnosis (R8). Pass/fail is judged on FIELD (CrUX p75)
// data — synthetic lab can't measure INP — while the Lighthouse LAB audits in the same PSI
// response drive the per-metric diagnosis (LCP element, INP long-tasks, CLS sources).
// Ported from imagine-seo-engine's core-web-vitals + pagespeed connector. One PSI call per URL.

export type Rating = "good" | "needs_improvement" | "poor" | "unknown";
export type Device = "mobile" | "desktop";

export interface MetricThresholds {
  good: number;
  poor: number;
}

// INP replaced FID on 2024-03-12. Values in ms except CLS (unitless).
export const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const satisfies Record<string, MetricThresholds>;

export interface MetricEval {
  value?: number;
  rating: Rating;
}

export interface VitalsEval {
  lcp: MetricEval;
  inp: MetricEval;
  cls: MetricEval;
  /** All three present AND "good". */
  passesField: boolean;
  /** Any metric lacks field data (CrUX insufficient). */
  hasGaps: boolean;
}

export interface CwvDiagnosis {
  lcp: string[];
  inp: string[];
  cls: string[];
}

export interface CwvResult {
  template: string;
  representativeUrl: string;
  device: Device;
  hasField: boolean;
  vitals: { lcpMs?: number; inpMs?: number; cls?: number };
  evaluation: VitalsEval;
  diagnosis: CwvDiagnosis;
  error?: string;
}

const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

function evalMetric(value: number | undefined, t: MetricThresholds): MetricEval {
  if (value === undefined || Number.isNaN(value)) return { value: undefined, rating: "unknown" };
  const rating: Rating =
    value <= t.good ? "good" : value > t.poor ? "poor" : "needs_improvement";
  return { value, rating };
}

export function evaluateVitals(v: { lcpMs?: number; inpMs?: number; cls?: number }): VitalsEval {
  const lcp = evalMetric(v.lcpMs, THRESHOLDS.lcp);
  const inp = evalMetric(v.inpMs, THRESHOLDS.inp);
  const cls = evalMetric(v.cls, THRESHOLDS.cls);
  const metrics = [lcp, inp, cls];
  return {
    lcp,
    inp,
    cls,
    passesField: metrics.every((m) => m.rating === "good"),
    hasGaps: metrics.some((m) => m.rating === "unknown"),
  };
}

// ── R8 diagnosis: parse the Lighthouse lab audits for each metric's likely cause ──
type Audits = Record<string, any>;

function auditItems(audits: Audits, id: string): any[] {
  return audits?.[id]?.details?.items ?? [];
}
function nodeLabel(item: any): string | undefined {
  const n = item?.node ?? item;
  return (n?.nodeLabel || n?.snippet || n?.selector || "").toString().slice(0, 120) || undefined;
}
function ms(audits: Audits, id: string): number | undefined {
  const v = audits?.[id]?.numericValue;
  return typeof v === "number" ? Math.round(v) : undefined;
}

function diagnose(audits: Audits): CwvDiagnosis {
  const lcp: string[] = [];
  const inp: string[] = [];
  const cls: string[] = [];
  if (!audits) return { lcp, inp, cls };

  // LCP
  const lcpEl = nodeLabel(auditItems(audits, "largest-contentful-paint-element")[0]?.items?.[0]);
  if (lcpEl) lcp.push(`LCP element: ${lcpEl}`);
  const ttfb = ms(audits, "server-response-time");
  if (ttfb && ttfb > 600) lcp.push(`Slow TTFB (~${ttfb}ms)`);
  const rbr = auditItems(audits, "render-blocking-resources");
  if (rbr.length) lcp.push(`${rbr.length} render-blocking resource(s)`);

  // INP (architectural — long main-thread work)
  const longTasks = auditItems(audits, "long-tasks");
  if (longTasks.length) {
    const total = Math.round(longTasks.reduce((s, i) => s + (i.duration ?? 0), 0));
    inp.push(`${longTasks.length} long main-thread task(s) (~${total}ms total)`);
  }
  const bootup = ms(audits, "bootup-time");
  if (bootup && bootup > 2000) inp.push(`Heavy JS execution / bootup (~${bootup}ms)`);
  const mtw = ms(audits, "mainthread-work-breakdown");
  if (mtw && mtw > 3000) inp.push(`High main-thread work (~${mtw}ms)`);

  // CLS
  const shifts = auditItems(audits, "layout-shift-elements").map(nodeLabel).filter(Boolean);
  if (shifts.length) cls.push(`Shifting element(s): ${shifts.slice(0, 3).join("; ")}`);
  const unsized = auditItems(audits, "unsized-images");
  if (unsized.length) cls.push(`${unsized.length} image(s) without explicit dimensions`);

  return { lcp, inp, cls };
}

/**
 * Pull field p75 + lab-audit diagnosis for one representative URL of a template.
 * Uses PAGESPEED_API_KEY when set (PSI v5 returns a 0 daily quota without a key).
 */
export async function analyzeCwv(
  template: string,
  representativeUrl: string,
  device: Device = "mobile",
): Promise<CwvResult> {
  const params = new URLSearchParams({ url: representativeUrl, strategy: device });
  params.append("category", "performance");
  const key = process.env.PAGESPEED_API_KEY;
  if (key) params.set("key", key);

  const base: Omit<CwvResult, "vitals" | "evaluation" | "diagnosis" | "hasField"> = {
    template,
    representativeUrl,
    device,
  };

  try {
    const res = await fetch(`${PSI}?${params.toString()}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      const evaluation = evaluateVitals({});
      return {
        ...base,
        hasField: false,
        vitals: {},
        evaluation,
        diagnosis: { lcp: [], inp: [], cls: [] },
        error: `PSI HTTP ${res.status}`,
      };
    }
    const data: any = await res.json();
    const metrics = data?.loadingExperience?.metrics;
    const clsRaw = metrics?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
    const vitals = {
      lcpMs: metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile,
      inpMs: metrics?.INTERACTION_TO_NEXT_PAINT?.percentile,
      // CrUX reports CLS ×100 (integer); normalize to a 0–1 score.
      cls: clsRaw === undefined ? undefined : clsRaw / 100,
    };
    return {
      ...base,
      hasField: metrics !== undefined,
      vitals,
      evaluation: evaluateVitals(vitals),
      diagnosis: diagnose(data?.lighthouseResult?.audits),
    };
  } catch (e: any) {
    return {
      ...base,
      hasField: false,
      vitals: {},
      evaluation: evaluateVitals({}),
      diagnosis: { lcp: [], inp: [], cls: [] },
      error: e?.message ?? "PSI request failed",
    };
  }
}
