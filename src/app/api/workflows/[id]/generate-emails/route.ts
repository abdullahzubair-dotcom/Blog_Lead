import { NextRequest, NextResponse } from "next/server";
import { getWorkflow, getWorkflowProspects, getEmailTemplate, upsertOutreachEmail, getContactedAuthorIds } from "@/lib/db/queries";
import { startGen, bumpGen, finishGen, isGenRunning } from "@/lib/email/genBuffer";

export const maxDuration = 300;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";

interface OpenerArticle { title?: string; archetype?: string; published_at?: string; excerpt?: string; readability_text_excerpt?: string }

function fmtDate(iso?: string): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
  catch { return ""; }
}

// Remove em/en dashes and other "AI tells", normalize whitespace.
function sanitize(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")   // em/en dash → comma
    .replace(/\s{2,}/g, " ")
    .replace(/ ,/g, ",")
    .trim();
}

async function generateOpener(authorName: string, pubName: string, articles: OpenerArticle[], tools: string[], guidance?: string): Promise<string> {
  const sorted = [...articles].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const lead = sorted[0];
  const leadTitle = lead?.title ?? "";
  const leadDate = fmtDate(lead?.published_at);
  const leadTopic = (lead?.excerpt ?? lead?.readability_text_excerpt ?? "").slice(0, 300);
  const toolList = tools.slice(0, 3).join(", ");

  const prompt = `Write the opening 1-2 sentences of a personalized outreach email to ${authorName}, a writer at ${pubName}.

Their most recent article:
- Title: ${leadTitle || "(unknown)"}
${leadDate ? `- Published: ${leadDate}` : ""}
${leadTopic ? `- About: ${leadTopic}` : ""}
${toolList ? `They cover: ${toolList}.` : ""}

HARD RULES (must follow all):
- NEVER use em-dashes or en-dashes (— –). Use commas or periods only.
- Reference their specific article naturally. Sound like a real person, not salesy or flattering.
- Keep it SHORT and punchy. No greeting, no sign-off. Plain text, no markdown.
- Default to 1-2 short sentences unless the direction below says otherwise.${guidance ? `\n\nSENDER'S WRITING DIRECTION (obey this exactly, including any length/word limit):\n${guidance}` : ""}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4-5",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  return sanitize(data.choices?.[0]?.message?.content?.trim() ?? "");
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// Runs the actual generation loop DETACHED from the request so it survives tab close.
// Overwrites every included prospect's email (upsert on workflow_id+author_id).
async function runGeneration(workflowId: string, templateId?: string) {
  const template = templateId ? await getEmailTemplate(templateId) : null;
  const { prospects } = await getWorkflowProspects(workflowId, { limit: 500 });
  const contactedElsewhere = await getContactedAuthorIds(workflowId);
  // Only generate for included prospects NOT already contacted in another campaign.
  const included = prospects.filter((p) => p.included && !contactedElsewhere.has(p.author_id));
  // Progress already started in POST; loop just reports per-item completion.

  const CONCURRENCY = 5;
  for (let i = 0; i < included.length; i += CONCURRENCY) {
    const batch = included.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (p) => {
      const author = p.author!;
      const pubName = p.domain?.name ?? p.domain?.host ?? "your publication";
      const tools = (p.articles ?? [])
        .flatMap((a: any) => (a.mentions ?? []).map((m: any) => m.tool_name))
        .filter((v: string, idx: number, arr: string[]) => arr.indexOf(v) === idx)
        .slice(0, 5);

      try {
        const opener = OPENROUTER_KEY
          ? await generateOpener(author.full_name, pubName, p.articles ?? [], tools, template?.guidance)
          : `I came across your work at ${pubName} and found it really insightful.`;

        const firstArticle = [...(p.articles ?? [])].sort((a: any, b: any) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
        const vars: Record<string, string> = {
          author_name: author.full_name,
          pub_name: pubName,
          article_title: firstArticle?.title ?? "",
          article_date: firstArticle?.published_at?.slice(0, 10) ?? "",
          tool_mentioned: tools[0] ?? "AI tools",
          custom_line: opener,
        };

        const subject = sanitize(fillTemplate(template?.subject ?? "Quick note on your recent piece", vars));
        const body = sanitize(fillTemplate(template?.body ?? `Hi {{author_name}},\n\n{{custom_line}}\n\nBest,\nAbdullah`, vars));

        await upsertOutreachEmail({ workflow_id: workflowId, author_id: p.author_id, template_id: templateId ?? undefined, subject, body, status: "ready" });
        bumpGen(workflowId);
      } catch (e: any) {
        bumpGen(workflowId, `${author.full_name}: ${e.message}`);
      }
    }));
  }

  finishGen(workflowId);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { template_id } = await req.json().catch(() => ({}));

  const workflow = await getWorkflow(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (isGenRunning(id)) return NextResponse.json({ started: false, alreadyRunning: true });

  const { prospects } = await getWorkflowProspects(id, { limit: 500 });
  const contactedElsewhere = await getContactedAuthorIds(id);
  const total = prospects.filter((p) => p.included && !contactedElsewhere.has(p.author_id)).length;
  if (total === 0) return NextResponse.json({ started: false, total: 0, reason: "No new prospects to generate (already contacted or none selected)." });

  // Fire-and-forget: generation continues even if the client disconnects.
  startGen(id, total);
  runGeneration(id, template_id).catch(() => finishGen(id));

  return NextResponse.json({ started: true, total });
}
