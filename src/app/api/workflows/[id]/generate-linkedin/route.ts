import { NextRequest, NextResponse, after } from "next/server";
import { getWorkflow, getWorkflowProspects, getEmailTemplate, upsertLinkedinMessage, getContactedAuthorIds } from "@/lib/db/queries";
import { startGen, bumpGen, finishGen, isGenRunning } from "@/lib/email/genBuffer";

export const maxDuration = 300;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";
// LinkedIn caps connection-request notes at 300 characters. Stay comfortably under.
const MAX_CHARS = 280;

interface Article { title?: string; excerpt?: string; readability_text_excerpt?: string; published_at?: string }

// Strip AI tells and clamp to LinkedIn's note limit without cutting mid-word.
function sanitize(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ,/g, ",")
    .replace(/\s+\n/g, "\n")
    .trim();
}
function clampNote(text: string): string {
  const t = sanitize(text).replace(/\n{2,}/g, " ").trim();
  if (t.length <= MAX_CHARS) return t;
  const cut = t.slice(0, MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 200 ? cut.slice(0, lastSpace) : cut).replace(/[,.\s]+$/, "") + ".";
}
function hasPlaceholder(s: string): boolean {
  return /\[[^\]]{1,40}\]/.test(s) || /\{\{[^}]+\}\}/.test(s);
}
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// A short, warm connection note. References their most recent article when we know it.
async function generateNote(authorName: string, pubName: string, articles: Article[], guidance?: string): Promise<string> {
  const first = (authorName ?? "there").trim().split(/\s+/)[0] || "there";
  const sorted = [...articles].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const leadTitle = (sorted[0]?.title ?? "").trim();
  const leadTopic = (sorted[0]?.excerpt ?? sorted[0]?.readability_text_excerpt ?? "").slice(0, 240).trim();

  const fallback = clampNote(
    leadTitle
      ? `Hi ${first}, I really enjoyed your piece "${leadTitle}". I work at ImagineArt (AI creative tools) and would love to connect and follow your work.`
      : `Hi ${first}, I've been following your writing${pubName && pubName !== "your work" ? ` at ${pubName}` : ""} and would love to connect. I work at ImagineArt building AI creative tools.`
  );
  if (!OPENROUTER_KEY || (!leadTitle && !leadTopic)) return fallback;

  const prompt = `Write a LinkedIn CONNECTION REQUEST note to ${authorName}, a writer at ${pubName}.

What we know about them:
- Recent article: ${leadTitle || "(unknown)"}
${leadTopic ? `- About: ${leadTopic}` : ""}

HARD RULES (follow ALL):
- Under ${MAX_CHARS} characters TOTAL (LinkedIn's hard limit). Count carefully. One or two short sentences.
- Start with "Hi ${first},".
- Reference their work specifically but briefly. NEVER invent details not listed above.
- NEVER use bracketed placeholders like [topic] or {{name}}.
- NEVER use em-dashes or en-dashes. Warm, human, not salesy. No hashtags, no emojis, no links.
- I'm from ImagineArt (AI creative tools). A light reason to connect is good; don't hard-pitch.${guidance ? `\n\nSENDER'S DIRECTION (obey, still under ${MAX_CHARS} chars):\n${guidance}` : ""}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4-5",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 160,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim() ?? "";
  return (!out || hasPlaceholder(out)) ? fallback : clampNote(out);
}

// Detached generation loop (survives tab close), keyed `${id}:linkedin` so it runs
// independently of the email generator. Overwrites each included prospect's note.
async function runGeneration(workflowId: string, templateId?: string) {
  const key = `${workflowId}:linkedin`;
  const template = templateId ? await getEmailTemplate(templateId) : null;
  const { prospects } = await getWorkflowProspects(workflowId, { limit: 500 });
  const contactedElsewhere = await getContactedAuthorIds(workflowId);
  const included = prospects.filter((p) => p.included && !contactedElsewhere.has(p.author_id));

  const CONCURRENCY = 5;
  for (let i = 0; i < included.length; i += CONCURRENCY) {
    const batch = included.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (p) => {
      const author = p.author!;
      const pubName = p.domain?.name ?? p.domain?.host ?? "your work";
      try {
        const note = await generateNote(author.full_name, pubName, p.articles ?? [], template?.guidance);
        // If a LinkedIn template is chosen, its body wraps the generated note via {{custom_line}};
        // otherwise the note IS the message.
        let body = note;
        if (template?.body) {
          const first = (author.full_name ?? "there").trim().split(/\s+/)[0] || "there";
          const vars: Record<string, string> = {
            author_name: author.full_name, first_name: first, pub_name: pubName, custom_line: note,
          };
          body = clampNote(fillTemplate(template.body, vars).replace(/\{\{\w+\}\}/g, ""));
        }
        await upsertLinkedinMessage({ workflow_id: workflowId, author_id: p.author_id, template_id: templateId ?? null, body });
        await bumpGen(key);
      } catch (e: any) {
        await bumpGen(key, `${author.full_name}: ${e.message}`);
      }
    }));
  }
  await finishGen(key);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { template_id } = await req.json().catch(() => ({}));
  const key = `${id}:linkedin`;

  const workflow = await getWorkflow(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (await isGenRunning(key)) return NextResponse.json({ started: false, alreadyRunning: true });

  const { prospects } = await getWorkflowProspects(id, { limit: 500 });
  const contactedElsewhere = await getContactedAuthorIds(id);
  const total = prospects.filter((p) => p.included && !contactedElsewhere.has(p.author_id)).length;
  if (total === 0) return NextResponse.json({ started: false, total: 0, reason: "No new prospects to generate (already contacted or none selected)." });

  await startGen(key, total);
  after(async () => { try { await runGeneration(id, template_id); } catch { await finishGen(key); } });

  return NextResponse.json({ started: true, total });
}
