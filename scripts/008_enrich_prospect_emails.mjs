// Run: node scripts/008_enrich_prospect_emails.mjs
// Backfills author emails using a free waterfall, storing hits as mailto contacts:
//   1) guess patterns + Reoon POWER verify   (REOON_API_KEY, 600/mo free, real SMTP+catch-all)
//   2) Hunter finder                          (HUNTER_API_KEY, 25/mo free, name+domain)
//   3) Blitz LinkedIn employee chain          (BLITZ_API_KEY, unlimited but LinkedIn-only)
// Skips authors that already have an email.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const { REOON_API_KEY, HUNTER_API_KEY, BLITZ_API_KEY } = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── patterns ──
const normLocal = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
function candidates(name, domain) {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
  const p = name.trim().split(/\s+/).map(normLocal).filter(Boolean);
  if (!p.length || !clean) return [];
  const [first, last] = [p[0], p[p.length - 1]];
  const set = new Set();
  if (first !== last) { set.add(`${first}.${last}`); set.add(first); set.add(`${first[0]}${last}`); set.add(`${first}${last}`); }
  else set.add(first);
  return [...set].map((l) => `${l}@${clean}`);
}

// ── Reoon verify (POWER) ──
async function verifyReoon(email) {
  if (!REOON_API_KEY) return null;
  await sleep(150);
  try {
    const r = await fetch(`https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${REOON_API_KEY}&mode=power`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const d = await r.json();
    return { safe: d.status === "safe" || d.is_safe_to_send === true, catchAll: d.status === "catch_all" || d.is_catch_all === true };
  } catch { return null; }
}
async function guessAndVerify(name, domain) {
  if (!REOON_API_KEY) return null;
  for (const c of candidates(name, domain).slice(0, 4)) {
    const v = await verifyReoon(c);
    if (!v) continue;
    if (v.catchAll) return null;
    if (v.safe) return c;
  }
  return null;
}

// ── Hunter finder ──
async function hunter(name, domain) {
  if (!HUNTER_API_KEY) return null;
  await sleep(120);
  try {
    const r = await fetch(`https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&full_name=${encodeURIComponent(name)}&api_key=${HUNTER_API_KEY}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.data?.email && (d.data.score ?? 0) >= 70 ? d.data.email : null;
  } catch { return null; }
}

// ── Blitz chain (cached per domain) ──
const H = { "x-api-key": BLITZ_API_KEY, "Content-Type": "application/json" };
const bPost = async (p, b) => { await sleep(220); try { const r = await fetch("https://api.blitz-api.ai" + p, { method: "POST", headers: H, body: JSON.stringify(b), signal: AbortSignal.timeout(20000) }); return r.ok ? r.json() : null; } catch { return null; } };
const companyCache = new Map(), empCache = new Map();
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
function match(name, people) {
  const t = norm(name); if (!t) return null; const toks = t.split(" ").filter(Boolean);
  for (const p of people) if (p.full_name && norm(p.full_name) === t) return p;
  if (toks.length >= 2) { const [f, l] = [toks[0], toks[toks.length - 1]]; for (const p of people) { const pn = norm(p.full_name ?? ""); if (pn.includes(f) && pn.includes(l)) return p; } }
  return null;
}
async function blitz(name, host) {
  if (!BLITZ_API_KEY) return null;
  if (!companyCache.has(host)) { const r = await bPost("/v2/enrichment/domain-to-linkedin", { domain: host }); companyCache.set(host, r?.found ? r.company_linkedin_url : null); }
  const company = companyCache.get(host); if (!company) return null;
  if (!empCache.has(company)) { const all = []; let page = 1, tp = 1; do { const e = await bPost("/v2/search/employee-finder", { company_linkedin_url: company, max_results: 50, page }); if (e?.results?.length) all.push(...e.results); tp = e?.total_pages ?? 1; page++; } while (page <= Math.min(tp, 6)); empCache.set(company, all); }
  const person = match(name, empCache.get(company)); if (!person?.linkedin_url) return null;
  const em = await bPost("/v2/enrichment/email", { person_linkedin_url: person.linkedin_url });
  return em?.found ? em.email : null;
}

async function resolveEmail(name, host) {
  return (await guessAndVerify(name, host)) || (await hunter(name, host)) || (await blitz(name, host)) || null;
}

// ── main ──
console.log(`sources: reoon=${!!REOON_API_KEY} hunter=${!!HUNTER_API_KEY} blitz=${!!BLITZ_API_KEY}\n`);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows: authors } = await client.query(`
  SELECT a.id, a.full_name, d.host FROM authors a JOIN domains d ON a.primary_domain_id = d.id
  WHERE d.host IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.author_id = a.id AND c.type = 'mailto')
  ORDER BY d.host`);
console.log(`${authors.length} authors without an email.\n`);

let found = 0;
const bySource = { "guess+reoon": 0, hunter: 0, blitz: 0 };
for (const a of authors) {
  const email = await resolveEmail(a.full_name, a.host);
  if (email) {
    await client.query(`INSERT INTO contacts (author_id, type, value, confidence, source, verified_syntax) VALUES ($1,'mailto',$2,0.9,'enrich',true) ON CONFLICT (author_id, type, value) DO NOTHING`, [a.id, `mailto:${email}`]);
    found++;
    console.log(`  ✓ ${a.full_name} @ ${a.host} → ${email}`);
  }
}
console.log(`\n=== DONE === ${found}/${authors.length} emails found & saved.`);
await client.end();
