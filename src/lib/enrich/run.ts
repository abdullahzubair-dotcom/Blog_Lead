import { upsertContact, saveEnrichmentRun } from "@/lib/db/queries";
import { resolveEmailCascade } from "@/lib/enrich/cascade";
import { resolveLinkedinCascade } from "@/lib/enrich/linkedinCascade";
import type { DomainPattern } from "@/lib/enrich/patternInfer";
import { isLikelyPersonName, isRoleEmail } from "@/lib/enrich/personFilter";
import { enrichStep, enrichResult, finishEnrich, getEnrich, isEnrichAborted } from "@/lib/enrich/enrichBuffer";

const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;

export interface EnrichTarget { id: string; name: string; host: string; publication: string }
export type FindMode = "email" | "linkedin";

// Detached loop. Per author, runs the full cascade, streaming each step into the buffer.
// mode="email" → full cascade (posts → LinkedIn → Blitz → socials → pattern → AI-scan).
// mode="linkedin" → LinkedIn-only pass (posts → socials → web search), stored as a contact.
export async function enrichLoop(targets: EnrichTarget[], mode: FindMode = "email"): Promise<void> {
  const patternCache = new Map<string, DomainPattern | null>();
  const domainVerify = new Map<string, "safe" | "catch_all" | "invalid" | "unknown">();

  try {
    for (const a of targets) {
      if (isEnrichAborted()) break;

      // ── LinkedIn-only mode ──────────────────────────────────────────────
      if (mode === "linkedin") {
        try {
          if (!isLikelyPersonName(a.name, a.publication)) {
            enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false });
            continue;
          }
          const onStep = (detail: string) => enrichStep(a.name, detail, a.publication, a.id);
          const issues: string[] = [];
          const li = await resolveLinkedinCascade(a, { onStep, onIssue: (m) => issues.push(m) });
          if (li) {
            await upsertContact({
              author_id: a.id, type: "linkedin", value: li.url,
              confidence: 0.85, source: `linkedin-${li.source}`, verified_syntax: true,
            }).catch(() => {});
            enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: true, email: li.url, source: `linkedin-${li.source}` });
          } else {
            enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false, issues });
          }
        } catch {
          enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false });
        }
        continue;
      }

      // ── Email mode (full cascade) ────────────────────────────────────────
      try {
        if (!isLikelyPersonName(a.name, a.publication)) {
          enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false });
          continue;
        }

        const onStep = (detail: string) => enrichStep(a.name, detail, a.publication, a.id);
        const issues: string[] = [];
        let r = await resolveEmailCascade(a, { onStep, onIssue: (m) => issues.push(m), patternCache, domainVerify });

        // Final catch-all: never store a malformed or generic/role inbox, whatever the source.
        if (r) {
          const e = r.email.toLowerCase().trim();
          if (!EMAIL_RE.test(e) || isRoleEmail(e)) r = null;
          else r = { ...r, email: e };
        }

        if (r) {
          await upsertContact({
            author_id: a.id, type: "mailto", value: `mailto:${r.email}`,
            confidence: r.score ? r.score / 100 : 0.8, source: r.source, verified_syntax: true,
          }).catch(() => {});
          enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: true, email: r.email, source: r.source, issues });
        } else {
          enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false, issues });
        }
      } catch {
        enrichResult({ name: a.name, authorId: a.id, publication: a.publication, found: false });
      }
    }
  } finally {
    finishEnrich();
    // Persist the run so it can be reopened in run history with the same UI.
    const run = getEnrich();
    if (run) {
      await saveEnrichmentRun({
        key: run.key, campaignName: run.campaignName, total: run.total, done: run.done,
        found: run.found, bySource: run.bySource, people: run.people, startedAt: run.startedAt,
      }).catch(() => {});
    }
  }
}
