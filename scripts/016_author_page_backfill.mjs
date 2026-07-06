// Run: node scripts/016_author_page_backfill.mjs
// Backfills a `contacts.type='author_page'` link for authors who don't already have one —
// this is the field the notifications watch feature (src/lib/pipeline/watch.ts) needs to
// actively re-check a writer for new posts. Discovery only captures this when a site's page
// happens to expose structured author-URL metadata; most don't, so most existing authors
// are missing it.
//
// Strategy: guess common CMS author-archive URL patterns from the author's name + their
// known domain (WordPress's `/author/<slug>/` being by far the most common), fetch each
// candidate, and only accept it if the page actually links to one of that author's own
// known articles — this is what prevents saving a wrong/unrelated page on a multi-author
// site. No paid APIs involved, just plain HTTP fetches.
import pg from "pg";
import PQueue from "p-queue";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

// Some remote servers slam the socket shut mid-response (HTTP/2 resets etc.) — undici
// surfaces that as an unhandled 'error' event that bypasses try/catch entirely and would
// otherwise crash this whole batch job over one flaky third-party site. Log and continue.
process.on("uncaughtException", (err) => {
  console.error(`  (ignoring socket-level error: ${err.message})`);
});

const CONCURRENCY = 10;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const PATH_PATTERNS = [
  "/author/{slug}/", "/author/{slug}",
  "/authors/{slug}/", "/authors/{slug}",
  "/by/{slug}/", "/by/{slug}",
  "/writer/{slug}/", "/writers/{slug}/",
  "/contributor/{slug}/", "/contributors/{slug}/",
  "/profile/{slug}/", "/people/{slug}/",
  "/@{slug}", // Medium/Substack-style
];

function slugVariants(fullName) {
  const clean = fullName.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s-]/g, "");
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return []; // not a plausible "First Last" name
  const first = tokens[0], last = tokens[tokens.length - 1];
  return [...new Set([`${first}-${last}`, `${first}${last}`, first])];
}

function isPlausibleName(fullName) {
  if (!fullName || fullName === "Unknown") return false;
  if (fullName.length > 40) return false;
  if (/\d/.test(fullName)) return false;
  return true;
}

async function fetchText(url, timeoutMs = 6000) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    // A soft-404 that redirects to the homepage isn't a real author page.
    const finalPath = new URL(res.url).pathname;
    if (finalPath === "/" || finalPath === "") return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString("utf-8").slice(0, 300_000);
  } catch {
    return null;
  }
}

// Confirms the candidate page actually links to one of this author's own known articles —
// the check that prevents saving an unrelated same-slug page on a multi-author site.
function linksToAnyArticle(html, articleUrls) {
  return articleUrls.some((u) => {
    try {
      const path = new URL(u).pathname;
      return path.length > 3 && html.includes(path);
    } catch {
      return false;
    }
  });
}

async function findAuthorPage(host, fullName, articleUrls) {
  for (const slug of slugVariants(fullName)) {
    for (const pattern of PATH_PATTERNS) {
      const url = `https://${host}${pattern.replace("{slug}", slug)}`;
      const html = await fetchText(url);
      if (html && linksToAnyArticle(html, articleUrls)) return url;
    }
  }
  return null;
}

const client = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: CONCURRENCY + 2 });

const { rows: authors } = await client.query(`
  SELECT a.id, a.full_name, d.host,
    (SELECT array_agg(art.url_canonical ORDER BY art.published_at DESC NULLS LAST)
       FROM article_authors aa JOIN articles art ON art.id = aa.article_id
       WHERE aa.author_id = a.id LIMIT 5) AS article_urls
  FROM authors a
  JOIN domains d ON d.id = a.primary_domain_id
  LEFT JOIN contacts ct ON ct.author_id = a.id AND ct.type = 'author_page'
  WHERE ct.id IS NULL
`);

const candidates = authors.filter((a) => isPlausibleName(a.full_name) && a.host && (a.article_urls?.length ?? 0) > 0);
console.log(`${authors.length} authors missing an author_page; ${candidates.length} have a plausible name + known articles to try.`);

let found = 0, checked = 0;
const queue = new PQueue({ concurrency: CONCURRENCY });

for (const author of candidates) {
  queue.add(async () => {
    const page = await findAuthorPage(author.host, author.full_name, author.article_urls.slice(0, 5)).catch(() => null);
    if (page) {
      await client.query(
        `INSERT INTO contacts (author_id, type, value, confidence, source, verified_syntax)
         VALUES ($1, 'author_page', $2, 0.75, 'backfill', true)
         ON CONFLICT (author_id, type, value) DO NOTHING`,
        [author.id, page]
      );
      found++;
    }
    checked++;
    if (checked % 25 === 0 || checked === candidates.length) {
      console.log(`${checked}/${candidates.length} checked, ${found} pages found so far...`);
    }
  });
}
await queue.onIdle();

console.log(`Done. ${checked} authors checked, ${found} author pages found and saved.`);
console.log(`(${authors.length - candidates.length} skipped — junk/missing name or no known articles.)`);
await client.end();
