import { getAuthorArticleUrls, getKnownEmailsByDomain } from "@/lib/db/queries";
import { scrapePageSignals, type PageSignals } from "./pageSignals";
import { findLinkedinUrl } from "./findLinkedin";
import { linkedinToEmail, blitzEnabled } from "./blitz";
import { resolveDomainPattern, type DomainPattern } from "./patternInfer";
import { aiScrapeEmail, aiScrapeEnabled } from "./aiScrape";
import { isRoleEmail } from "./personFilter";
import { verifyEmail } from "./verify";
import { registrableDomain } from "@/lib/util/domain";

export interface CascadeTarget { id: string; name: string; host: string; publication: string }
export interface CascadeResult { email: string; source: string; score?: number }

// Upper bound on how many of an author's posts we scan for their LinkedIn. Scanning stops
// early the moment a LinkedIn (or direct email) is found, so most authors scan far fewer.
const MAX_POSTS_SCAN = 50;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// Full per-person cascade. Emits onStep(detail) for the live verbose feed. Order:
//  1. scrape their recent article/author pages → direct email + social links
//  2. get LinkedIn (from those pages, or a DuckDuckGo name+company search)
//  3. LinkedIn → Blitz → email   ← the unlock (Blitz is unlimited)
//  4. scrape their socials/personal site for an email
//  5. domain email-pattern (from emails we already have)
//  6. AI-scan the site with your Claude key
export async function resolveEmailCascade(
  t: CascadeTarget,
  ctx: {
    onStep: (detail: string) => void;
    // onIssue records a REAL provider failure (Blitz/Reoon/AI/search error) — distinct
    // from a clean "nothing found" — so the UI can say "couldn't complete" vs "no email".
    onIssue?: (detail: string) => void;
    patternCache: Map<string, DomainPattern | null>;
    domainVerify: Map<string, "safe" | "catch_all" | "invalid" | "unknown">;
  },
): Promise<CascadeResult | null> {
  const { onStep } = ctx;
  // Fires on any provider failure: log it as a ⚠ step AND record it as an issue.
  const onFail = (provider: string) => (msg: string) => {
    onStep(`⚠ ${provider} failed: ${msg}`);
    ctx.onIssue?.(`${provider}: ${msg}`);
  };
  const socials: PageSignals = { emails: [] };
  const absorb = (sig: PageSignals | null) => {
    if (!sig) return;
    socials.linkedin ??= sig.linkedin;
    socials.twitter ??= sig.twitter;
    socials.instagram ??= sig.instagram;
    socials.mastodon ??= sig.mastodon;
    socials.personalSite ??= sig.personalSite;
  };

  // 1) Scan ALL their posts for a direct email + their LinkedIn (stop scanning once
  //    LinkedIn turns up — that's enough to get the email via Blitz).
  const urls = await getAuthorArticleUrls(t.id, MAX_POSTS_SCAN).catch(() => []);
  if (urls.length) {
    onStep(`scanning ${urls.length} post${urls.length === 1 ? "" : "s"} for email & LinkedIn…`);
    for (let i = 0; i < urls.length; i++) {
      onStep(`↳ post ${i + 1}/${urls.length}: ${hostOf(urls[i])}`);
      const sig = await scrapePageSignals(urls[i]);
      if (sig?.emails[0]) { onStep(`found email on their page`); return { email: sig.emails[0], source: "page-scrape", score: 90 }; }
      absorb(sig);
      if (socials.linkedin) { onStep(`found LinkedIn on a post: ${socials.linkedin.replace("https://", "")}`); break; }
    }
  }

  // 2) No LinkedIn yet? Check their social profiles (bios often link LinkedIn + email).
  if (!socials.linkedin) {
    for (const [label, surl] of [["X", socials.twitter], ["Instagram", socials.instagram], ["site", socials.personalSite]] as const) {
      if (!surl || socials.linkedin) continue;
      onStep(`checking ${label} profile for LinkedIn/email…`);
      const sig = await scrapePageSignals(surl);
      if (sig?.emails[0]) { onStep(`found email on ${label}`); return { email: sig.emails[0], source: "social", score: 80 }; }
      absorb(sig);
      if (socials.linkedin) onStep(`found LinkedIn on ${label}: ${socials.linkedin.replace("https://", "")}`);
    }
  }

  // 3) Still no LinkedIn? Search DuckDuckGo by name + publication.
  let linkedin = socials.linkedin;
  if (!linkedin) {
    onStep(`searching the web for LinkedIn (${t.name} @ ${t.publication})…`);
    linkedin = (await findLinkedinUrl(t.name, t.publication, undefined, onFail("web search")).catch(() => null)) ?? undefined;
    if (linkedin) onStep(`found LinkedIn: ${linkedin.replace("https://", "")}`);
    else onStep(`no LinkedIn found anywhere`);
  }

  // 4) LinkedIn → Blitz → email (Blitz has unlimited credits and needs exactly this)
  if (linkedin && blitzEnabled()) {
    onStep(`Blitz: resolving email from LinkedIn…`);
    let blitzFailed = false;
    const email = (await linkedinToEmail(linkedin, (m) => { blitzFailed = true; onFail("Blitz")(m); }).catch(() => null))?.toLowerCase();
    if (email && !isRoleEmail(email)) { onStep(`Blitz returned an email`); return { email, source: "blitz-linkedin", score: 90 }; }
    if (!blitzFailed) onStep(email ? `Blitz email was generic — skipping` : `Blitz had no email for that profile`);
  }

  // 5) AI-scan the site for an email ACTUALLY on the page (not constructed) — your Claude key.
  if (aiScrapeEnabled()) {
    onStep(`AI-scanning ${t.host} for a contact email…`);
    const email = await aiScrapeEmail(t.name, t.host, onFail("AI-scan")).catch(() => null);
    if (email) { onStep(`AI found an email`); return { email, source: "ai-scrape", score: 75 }; }
  }

  // 6) Domain email pattern — CONSTRUCTED (a guess), tagged so it's never mistaken for a
  // sourced email. Built at the ORG's registrable mail domain (research.ibm.com →
  // ibm.com), inferred from emails there (or a known-publication fallback), verified once
  // per domain via Reoon; catch-all/unverified stay "guess".
  const mailDomain = registrableDomain(t.host);
  if (!ctx.patternCache.has(mailDomain)) {
    const known = await getKnownEmailsByDomain(t.host).catch(() => []);
    ctx.patternCache.set(mailDomain, resolveDomainPattern(mailDomain, known));
  }
  const pat = ctx.patternCache.get(mailDomain);
  if (pat) {
    const local = pat.format(t.name);
    if (local) {
      const candidate = `${local}@${mailDomain}`;
      onStep(`no source found — building from ${mailDomain} pattern (${pat.key})…`);
      // Verify once per domain (only cache the domain-level truths: safe / catch-all).
      let verdict = ctx.domainVerify.get(mailDomain);
      if (verdict === undefined) {
        onStep(`verifying pattern (Reoon)…`);
        verdict = (await verifyEmail(candidate, onFail("Reoon"))).status;
        if (verdict === "safe" || verdict === "catch_all") ctx.domainVerify.set(mailDomain, verdict);
        onStep(`Reoon: ${verdict === "catch_all" ? "catch-all (accepts anything)" : verdict}`);
      }
      // Always produce the pattern email (tagged as a guess) — like IBM/Fast Company. A
      // per-person "invalid"/"unknown" verdict just means we can't confirm, not that the
      // pattern is wrong, so we still return it (tagged), never a dead end.
      const source = verdict === "safe" ? "pattern-verified" : verdict === "catch_all" ? "pattern-catchall" : "pattern";
      const score = verdict === "safe" ? 95 : verdict === "catch_all" ? 65 : 55;
      return { email: candidate, source, score };
    }
  }

  return null;
}
