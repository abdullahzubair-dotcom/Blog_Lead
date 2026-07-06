import { upsertContact, saveEnrichmentRun, markEmailSearchAttempted } from "@/lib/db/queries";
import { resolveEmailCascade } from "@/lib/enrich/cascade";
import { resolveLinkedinCascade } from "@/lib/enrich/linkedinCascade";
import type { DomainPattern } from "@/lib/enrich/patternInfer";
import { isLikelyPersonName, isRoleEmail } from "@/lib/enrich/personFilter";
import {
  enrichStep, enrichResult, finishEnrich, getEnrich, doneCount,
  snapshotToRedis, checkAbort, clearEnrichTargets,
} from "@/lib/enrich/enrichBuffer";
import { qstashPublish, isServerless } from "@/lib/qstash";

const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;

export interface EnrichTarget { id: string; name: string; host: string; publication: string }
export type FindMode = "email" | "linkedin";

// Leave headroom under Vercel's 300s function limit: process until this, then hand off to a
// fresh invocation via QStash. Locally (no limit) we run the whole list in one pass.
const CHUNK_BUDGET_MS = isServerless() ? 200_000 : Infinity;

interface Caches {
  patternCache: Map<string, DomainPattern | null>;
  domainVerify: Map<string, "safe" | "catch_all" | "invalid" | "unknown">;
}

async function processOne(a: EnrichTarget, mode: FindMode, caches: Caches): Promise<void> {
  const onStep = (detail: string) => enrichStep(a.name, detail, a.publication, a.id);

  if (!isLikelyPersonName(a.name, a.publication)) {
    enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false });
    return;
  }

  // ── LinkedIn-only mode ──────────────────────────────────────────────
  if (mode === "linkedin") {
    const issues: string[] = [];
    const li = await resolveLinkedinCascade(a, { onStep, onIssue: (m) => issues.push(m) });
    if (li) {
      await upsertContact({ author_id: a.id, type: "linkedin", value: li.url, confidence: 0.85, source: `linkedin-${li.source}`, verified_syntax: true }).catch(() => {});
      enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: true, email: li.url, source: `linkedin-${li.source}` });
    } else {
      enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false, issues });
    }
    return;
  }

  // ── Email mode (full cascade) ────────────────────────────────────────
  const issues: string[] = [];
  let discoveredLinkedin: string | null = null;
  let r = await resolveEmailCascade(a, {
    onStep,
    onIssue: (m) => issues.push(m),
    onLinkedin: (url) => { discoveredLinkedin = url; },
    patternCache: caches.patternCache,
    domainVerify: caches.domainVerify,
  });

  if (discoveredLinkedin) {
    onStep(`saved LinkedIn: ${(discoveredLinkedin as string).replace("https://", "")}`);
    await upsertContact({ author_id: a.id, type: "linkedin", value: discoveredLinkedin, confidence: 0.85, source: "linkedin-cascade", verified_syntax: true }).catch(() => {});
  }

  if (r) {
    const e = r.email.toLowerCase().trim();
    if (!EMAIL_RE.test(e) || isRoleEmail(e)) r = null;
    else r = { ...r, email: e };
  }

  // Mark attempted regardless of outcome — this is what lets a future run target only
  // authors who've truly never been searched, instead of re-trying known failures.
  await markEmailSearchAttempted(a.id).catch(() => {});

  if (r) {
    await upsertContact({ author_id: a.id, type: "mailto", value: `mailto:${r.email}`, confidence: r.score ? r.score / 100 : 0.8, source: r.source, verified_syntax: true }).catch(() => {});
    enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: true, email: r.email, source: r.source, issues });
  } else {
    enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false, issues });
  }
}

// Process targets[startIndex..] until the chunk budget, streaming per-step progress to the
// buffer (mirrored to Redis) and persisting each result to the DB as it goes. On Vercel, if
// the budget is hit with work remaining, it hands the rest to a fresh invocation via QStash
// (resuming at doneCount) so a run of any size completes across serverless functions.
export async function enrichLoop(
  targets: EnrichTarget[],
  mode: FindMode = "email",
  campaignId?: string,
  startIndex = 0,
): Promise<void> {
  const caches: Caches = { patternCache: new Map(), domainVerify: new Map() };
  const startedAt = Date.now();
  const snap = setInterval(() => { void snapshotToRedis(); }, 2500);

  try {
    let i = startIndex;
    for (; i < targets.length; i++) {
      if (await checkAbort()) break;

      // Out of time on this invocation — hand off the remainder and stop WITHOUT finishing.
      if (Date.now() - startedAt > CHUNK_BUDGET_MS) {
        await snapshotToRedis();
        const handed = await qstashPublish("/api/enrich/run", { continue: true, campaign_id: campaignId, mode });
        if (handed) { clearInterval(snap); return; } // next chunk resumes at doneCount()
        break; // no QStash — stop here (partial); a manual re-run continues
      }

      try { await processOne(targets[i], mode, caches); }
      catch { enrichResult({ name: targets[i].name, authorId: targets[i].id, publication: targets[i].publication, found: false }); }
    }
  } finally {
    clearInterval(snap);
  }

  // Reached the end (or aborted / no-QStash): finalize.
  finishEnrich();
  await snapshotToRedis();
  const run = getEnrich();
  if (run) {
    await saveEnrichmentRun({
      key: run.key, campaignName: run.campaignName, total: run.total, done: run.done,
      found: run.found, bySource: run.bySource, people: run.people, startedAt: run.startedAt,
    }).catch(() => {});
  }
  await clearEnrichTargets();
}

// Re-exported so callers can resume at the right spot on a continuation chunk.
export { doneCount };
