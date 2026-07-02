import { inferTimezone } from "@/lib/email/timezones";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? "";

export interface TzCandidate {
  authorId: string;
  name: string;
  publication?: string;
  host?: string;
  country?: string;
  bio?: string;
}

// Valid IANA-ish check so the LLM can't hand us garbage that Intl will throw on.
function isValidTz(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; }
  catch { return false; }
}

// Resolve each author's IANA timezone. Fast path: country-code TLD / explicit country
// (free, deterministic). Everything left over — the .com / neutral-TLD majority — goes to
// the LLM in batches, guessing from the writer's name + publication. Returns authorId → tz.
export async function inferTimezones(candidates: TzCandidate[], fallback: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const needLLM: TzCandidate[] = [];

  for (const c of candidates) {
    const fromTld = inferTimezone(c.host, c.country, "");
    if (fromTld) out[c.authorId] = fromTld; // TLD/country gave a real signal
    else needLLM.push(c);
  }

  if (needLLM.length === 0 || !OPENROUTER_KEY) {
    for (const c of needLLM) out[c.authorId] = fallback;
    return out;
  }

  const BATCH = 25;
  for (let i = 0; i < needLLM.length; i += BATCH) {
    const batch = needLLM.slice(i, i + BATCH);
    try {
      const guessed = await guessBatch(batch);
      for (const c of batch) {
        const g = guessed[c.authorId];
        out[c.authorId] = g && isValidTz(g) ? g : fallback;
      }
    } catch {
      for (const c of batch) out[c.authorId] = fallback;
    }
  }

  return out;
}

async function guessBatch(batch: TzCandidate[]): Promise<Record<string, string>> {
  const list = batch.map((c, i) =>
    `${i}. writer="${c.name}" publication="${c.publication ?? c.host ?? "unknown"}"${c.bio ? ` bio="${c.bio.slice(0, 120)}"` : ""}`
  ).join("\n");

  const prompt = `For each writer below, give the single most likely IANA timezone they work in, based on their publication and name. Publications are usually tied to a country/region (e.g. TechCrunch→America/Los_Angeles, The Guardian→Europe/London, YourStory→Asia/Kolkata, Gizmodo Australia→Australia/Sydney). If genuinely unsure, use America/New_York.

Writers:
${list}

Reply ONLY with a JSON object mapping each number to an IANA timezone string, e.g. {"0":"America/Los_Angeles","1":"Europe/London"}. No prose.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4-5",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 900,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as Record<string, string>;

  // Map index → authorId
  const result: Record<string, string> = {};
  batch.forEach((c, i) => {
    const tz = parsed[String(i)];
    if (tz) result[c.authorId] = tz;
  });
  return result;
}
