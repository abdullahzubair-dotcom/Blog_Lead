// Active per-author recheck for the notifications feature — periodically re-fetches a
// watched author's known page directly and profiles any genuinely new articles by them,
// reusing the exact same extraction/relevance/archetype/safety/scoring path as normal
// discovery (via the shared processHit).
import { fetchPage } from "@/lib/extract/fetch";
import { extractSameDomainLinks } from "@/lib/extract/mentions";
import { getSeeds } from "@/lib/db/queries";
import { processHit } from "@/lib/pipeline/run";
import { supabaseAdmin } from "@/lib/db/supabase";

const MAX_CANDIDATES_PER_AUTHOR = 20;

export interface WatchedAuthor {
  id: string;
  full_name: string;
  contacts?: { type: string; value: string }[];
}

export interface NewArticleFound {
  articleId: string;
  url: string;
  title: string | null;
}

// Checks one author for content we haven't seen yet. Returns [] if they have no known
// page to check (author_page contact), or nothing new was found.
export async function checkAuthorForNewContent(author: WatchedAuthor): Promise<NewArticleFound[]> {
  const authorPage = author.contacts?.find((c) => c.type === "author_page")?.value;
  if (!authorPage) return [];

  const fetched = await fetchPage(authorPage);
  if (!fetched) return [];

  const candidates = extractSameDomainLinks(fetched.html, fetched.finalUrl, MAX_CANDIDATES_PER_AUTHOR);
  if (candidates.length === 0) return [];

  // Drop anything we already have in the articles table before spending an LLM call on it.
  const { data: existing } = await supabaseAdmin.from("articles").select("url_canonical").in("url_canonical", candidates);
  const known = new Set((existing ?? []).map((r) => r.url_canonical));
  const fresh = candidates.filter((u) => !known.has(u));
  if (fresh.length === 0) return [];

  const seeds = await getSeeds();
  const found: NewArticleFound[] = [];

  for (const url of fresh) {
    const authorId = await processHit(`watch:${author.id}`, url, "watch", seeds).catch(() => undefined);
    // Only count it if the article really is by the author we're watching — a multi-author
    // site's page can list other people's bylines too.
    if (authorId !== author.id) continue;
    const { data: art } = await supabaseAdmin.from("articles").select("id, title").eq("url_canonical", url).maybeSingle();
    if (art) found.push({ articleId: art.id, url, title: art.title ?? null });
  }

  return found;
}
