import { NextRequest, NextResponse, after } from "next/server";
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

// Remove em/en dashes and other "AI tells"; normalize spacing WITHOUT flattening paragraphs
// (keep single/double newlines so the email keeps its structure).
function sanitize(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")   // em/en dash → comma
    .replace(/[ \t]{2,}/g, " ")     // collapse runs of spaces/tabs only (not newlines)
    .replace(/ ,/g, ",")
    .replace(/[ \t]+\n/g, "\n")     // trim trailing spaces on each line
    .replace(/\n{3,}/g, "\n\n")     // cap blank lines at one
    .trim();
}

// Free-mail hosts aren't a "publication" — "your readers at gmail.com" reads wrong.
const FREE_MAIL = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com", "aol.com", "me.com", "live.com", "msn.com"]);
function cleanPubName(pub: string): string {
  return FREE_MAIL.has((pub ?? "").toLowerCase().replace(/^www\./, "")) ? "your work" : pub;
}

// An email must NEVER ship with a literal placeholder the model invented.
function hasPlaceholder(s: string): boolean {
  return /\[[^\]]{1,40}\]/.test(s) || /\{\{[^}]+\}\}/.test(s);
}

async function generateOpener(authorName: string, pubName: string, articles: OpenerArticle[], tools: string[], guidance?: string): Promise<string> {
  const sorted = [...articles].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const lead = sorted[0];
  const leadTitle = (lead?.title ?? "").trim();
  const leadDate = fmtDate(lead?.published_at);
  const leadTopic = (lead?.excerpt ?? lead?.readability_text_excerpt ?? "").slice(0, 300).trim();
  const toolList = tools.slice(0, 3).join(", ");
  const hasContent = !!(leadTitle || leadTopic);

  // A safe, specific-free opener used whenever we can't (or shouldn't) fabricate specifics —
  // no AI key, no real article content, or the model returned placeholder junk.
  const fallback = leadTitle
    ? `I really enjoyed your recent piece, "${leadTitle}".`
    : `I've been following your writing${pubName && pubName !== "your work" ? ` at ${pubName}` : ""} and really enjoy it.`;

  if (!OPENROUTER_KEY || !hasContent) return fallback;

  const prompt = `Write the opening 1-2 sentences of a COLD outreach email to ${authorName}, a writer at ${pubName}.

What we actually know about them:
- Article title: ${leadTitle || "(unknown)"}
${leadDate ? `- Published: ${leadDate}` : ""}
${leadTopic ? `- About: ${leadTopic}` : ""}
${toolList ? `- They cover: ${toolList}` : ""}

HARD RULES (follow ALL):
- NEVER output bracketed placeholders like [topic], [name], [specific point], [publication]. Only mention details explicitly listed above; if a detail isn't given, DON'T reference it.
- This is a first-ever cold email. Do NOT imply prior contact or use "Re:".
- NEVER use em-dashes or en-dashes (— –). Commas or periods only.
- Sound like a real person. Not salesy, not fawning. SHORT and punchy, 1-2 sentences.
- No greeting, no sign-off, plain text, no markdown.${guidance ? `\n\nSENDER'S WRITING DIRECTION (obey exactly, including any length/word limit):\n${guidance}` : ""}`;

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
  const out = sanitize(data.choices?.[0]?.message?.content?.trim() ?? "");
  // Guard: if the model still slipped in a placeholder or returned nothing, use the fallback.
  return (!out || hasPlaceholder(out)) ? fallback : out;
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
      const pubName = cleanPubName(p.domain?.name ?? p.domain?.host ?? "your work");
      const tools = (p.articles ?? [])
        .flatMap((a: any) => (a.mentions ?? []).map((m: any) => m.tool_name))
        .filter((v: string, idx: number, arr: string[]) => arr.indexOf(v) === idx)
        .slice(0, 5);

      try {
        const opener = await generateOpener(author.full_name, pubName, p.articles ?? [], tools, template?.guidance);

        const firstArticle = [...(p.articles ?? [])].sort((a: any, b: any) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
        // Append a real, unmangled link to the article the opener references — appended
        // programmatically rather than trusted to the LLM so the URL always comes through intact.
        const articleLink: string | undefined = firstArticle?.url_canonical;
        const customLine = articleLink ? `${opener}\n\nI read this at: ${articleLink}` : opener;
        const vars: Record<string, string> = {
          author_name: author.full_name,
          pub_name: pubName,
          article_title: firstArticle?.title ?? "",
          article_date: firstArticle?.published_at?.slice(0, 10) ?? "",
          tool_mentioned: tools[0] ?? "AI tools",
          custom_line: customLine,
        };

        // Fill template, drop any leftover unfilled {{tokens}}, and tidy whitespace.
        const clean = (s: string) => sanitize(fillTemplate(s, vars).replace(/\{\{\w+\}\}/g, "").replace(/\n{3,}/g, "\n\n"));
        const subject = clean(template?.subject ?? "Quick note on your recent piece");
        const body = clean(template?.body ?? `Hi {{author_name}},\n\n{{custom_line}}\n\nBest,\nAbdullah`);

        await upsertOutreachEmail({ workflow_id: workflowId, author_id: p.author_id, template_id: templateId ?? undefined, subject, body, status: "ready" });
        await bumpGen(workflowId);
      } catch (e: any) {
        await bumpGen(workflowId, `${author.full_name}: ${e.message}`);
      }
    }));
  }

  await finishGen(workflowId);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { template_id } = await req.json().catch(() => ({}));

  const workflow = await getWorkflow(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (await isGenRunning(id)) return NextResponse.json({ started: false, alreadyRunning: true });

  const { prospects } = await getWorkflowProspects(id, { limit: 500 });
  const contactedElsewhere = await getContactedAuthorIds(id);
  const total = prospects.filter((p) => p.included && !contactedElsewhere.has(p.author_id)).length;
  if (total === 0) return NextResponse.json({ started: false, total: 0, reason: "No new prospects to generate (already contacted or none selected)." });

  // Mark started BEFORE responding so the progress poll (possibly on another serverless
  // instance) sees it immediately in Redis. after() keeps the function alive to run the
  // generation post-response — the Vercel-supported way to do work after the response
  // (a bare fire-and-forget promise gets frozen once the response is sent).
  await startGen(id, total);
  after(async () => { try { await runGeneration(id, template_id); } catch { await finishGen(id); } });

  return NextResponse.json({ started: true, total });
}
