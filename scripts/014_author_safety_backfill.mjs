// Run: node scripts/014_author_safety_backfill.mjs
// Screens every existing article (using already-stored text — no re-fetching pages) for
// NSFW / hate-violence-illegal / political-controversy content, flags matches, and
// recomputes each author's aggregate safety_score. Resumable: only processes articles
// where safety_checked_at is still null, so it's safe to interrupt and re-run.
//
// The classifier prompt/logic here is intentionally kept in sync with (but duplicated
// from, since this runs outside the Next.js/TS build) src/lib/extract/safety.ts, which is
// what runs live during discovery.
import pg from "pg";
import PQueue from "p-queue";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const { OPENROUTER_API_KEY } = process.env;
const MODEL = "anthropic/claude-haiku-4-5";
const CONCURRENCY = 8; // parallel OpenRouter calls — DB writes still go through one shared client

if (!OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY not set — nothing to do (screening fails open).");
  process.exit(0);
}

async function classify(title, text) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: "user",
          content: `You are screening an article for brand-safety reasons before a company decides whether to pitch its author for coverage.

Flag it ONLY if it is a genuine instance of one of these three categories:
1. NSFW — sexual/adult content.
2. HATE_VIOLENCE_ILLEGAL — hate speech, extremism, graphic violence, or promoting illegal activity.
3. POLITICAL_CONTROVERSY — opinionated, hot-button political or religious advocacy (not neutral reporting).

IMPORTANT: an article that merely REPORTS ON, EXPLAINS, or CRITIQUES one of these topics journalistically is NOT the same as advocating or containing it. Do not flag neutral coverage, historical analysis, or policy explainers. Only flag if the article's own content/tone actually falls into one of the categories.

Title: ${(title ?? "").slice(0, 150)}
Excerpt: ${(text ?? "").slice(0, 600)}

Reply in this exact format only, nothing else, all on one line:
CATEGORY=NONE SEVERITY=NONE REASON=none
or
CATEGORY=NSFW SEVERITY=HIGH REASON=<why, under 12 words, specific to this article>
(CATEGORY one of: NONE, NSFW, HATE_VIOLENCE_ILLEGAL, POLITICAL_CONTROVERSY. SEVERITY one of: NONE, LOW, MEDIUM, HIGH. REASON is a short human-readable explanation someone could read instead of opening the article.)`,
        }],
        max_tokens: 60,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const reply = (data.choices?.[0]?.message?.content ?? "").trim();
    const catMatch = reply.match(/CATEGORY=(NONE|NSFW|HATE_VIOLENCE_ILLEGAL|POLITICAL_CONTROVERSY)/i);
    const sevMatch = reply.match(/SEVERITY=(NONE|LOW|MEDIUM|HIGH)/i);
    const reasonMatch = reply.match(/REASON=(.+)$/i);
    const cat = catMatch?.[1]?.toUpperCase();
    const sev = sevMatch?.[1]?.toUpperCase();
    const reason = reasonMatch?.[1]?.trim().replace(/\.$/, "");
    if (!cat || cat === "NONE" || !sev || sev === "NONE") return null;
    return {
      category: cat.toLowerCase(),
      severity: sev.toLowerCase(),
      reason: reason && reason.toLowerCase() !== "none" ? reason : null,
    };
  } catch {
    return null; // fail open
  }
}

function scoreWeight(category, severity) {
  const weights = category === "political_controversy"
    ? { high: 15, medium: 8, low: 3 }
    : { high: 30, medium: 18, low: 8 };
  return weights[severity] ?? 0;
}

const CATEGORY_LABEL = {
  nsfw: "NSFW/sexual content",
  hate_violence_illegal: "hate/violence/illegal content",
  political_controversy: "political or religious controversy",
};

function buildSummary(score, flags) {
  if (flags.length === 0) return null;
  const shown = flags.slice(0, 3).map((f) => {
    const label = CATEGORY_LABEL[f.category] ?? f.category;
    return f.reason ? `${label} (${f.severity}) — ${f.reason}` : `${label} (${f.severity})`;
  });
  const more = flags.length > 3 ? `; and ${flags.length - 3} more` : "";
  const noun = flags.length === 1 ? "post" : "posts";
  return `Score ${score}/100 — ${flags.length} flagged ${noun}: ${shown.join("; ")}${more}.`;
}

// A single Client can't handle overlapping concurrent queries (node-postgres serializes on
// one connection and Supabase's pooler drops it) — use a Pool so each parallel worker gets
// its own connection.
const client = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: CONCURRENCY + 2 });

const { rows: articles } = await client.query(`
  SELECT a.id, a.title, a.readability_text_excerpt, aa.author_id
  FROM articles a
  LEFT JOIN article_authors aa ON aa.article_id = a.id
  WHERE a.safety_checked_at IS NULL
  ORDER BY a.created_at
`);

console.log(`${articles.length} unchecked articles found. Running with ${CONCURRENCY} parallel workers.`);
if (articles.length === 0) { await client.end(); process.exit(0); }

let flagged = 0, checked = 0;
const touchedAuthors = new Set();
const queue = new PQueue({ concurrency: CONCURRENCY });

for (const row of articles) {
  queue.add(async () => {
    const result = await classify(row.title, row.readability_text_excerpt);
    if (result && row.author_id) {
      await client.query(
        `INSERT INTO flagged_content (author_id, article_id, category, severity, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (article_id) DO UPDATE SET category = EXCLUDED.category, severity = EXCLUDED.severity, reason = EXCLUDED.reason`,
        [row.author_id, row.id, result.category, result.severity, result.reason]
      );
      touchedAuthors.add(row.author_id);
      flagged++;
    }
    await client.query(`UPDATE articles SET safety_checked_at = now() WHERE id = $1`, [row.id]);
    checked++;
    if (checked % 50 === 0 || checked === articles.length) {
      console.log(`${checked}/${articles.length} checked, ${flagged} flagged so far...`);
    }
  });
}
await queue.onIdle();

console.log(`Recomputing safety_score for ${touchedAuthors.size} affected authors...`);
for (const authorId of touchedAuthors) {
  const { rows: flags } = await client.query(`SELECT category, severity, reason FROM flagged_content WHERE author_id = $1`, [authorId]);
  let score = 100;
  for (const f of flags) score -= scoreWeight(f.category, f.severity);
  score = Math.max(0, Math.min(100, score));
  const summary = buildSummary(score, flags);
  await client.query(`UPDATE authors SET safety_score = $1, safety_summary = $2, safety_checked_at = now() WHERE id = $3`, [score, summary, authorId]);
}

console.log(`Done. ${checked} articles screened, ${flagged} flagged, ${touchedAuthors.size} author scores updated.`);
await client.end();
