import type { SeedTool } from "@/lib/types";

export function detectMentions(text: string, tools: SeedTool[]): { tool: string; count: number }[] {
  const lower = text.toLowerCase();
  const results: { tool: string; count: number }[] = [];

  for (const tool of tools) {
    const terms = [tool.name, ...(Array.isArray(tool.aliases) ? tool.aliases : [])];
    let count = 0;

    for (const term of terms) {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = lower.match(re);
      count += matches?.length ?? 0;
    }

    if (count > 0) {
      results.push({ tool: tool.name, count });
    }
  }

  return results.sort((a, b) => b.count - a.count);
}

export function extractOutboundLinks(html: string, baseUrl: string): { url: string; anchor: string }[] {
  const links: { url: string; anchor: string }[] = [];
  const base = new URL(baseUrl);

  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkPattern.exec(html)) !== null) {
    const href = m[1]?.trim();
    const anchor = m[2]?.replace(/<[^>]+>/g, "").trim().slice(0, 100);

    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) {
        links.push({ url: resolved.href, anchor: anchor ?? "" });
      }
    } catch {}
  }

  return links.slice(0, 100);
}

// Same-domain links only — the complement of extractOutboundLinks. Used to harvest an
// author's own archive/page for their other articles (author-watch rechecks, writer-seeded
// discovery) rather than to track who they link out to.
export function extractSameDomainLinks(html: string, baseUrl: string, limit = 100): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();

  const linkPattern = /<a[^>]+href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;

  while ((m = linkPattern.exec(html)) !== null) {
    const href = m[1]?.trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname === base.hostname) {
        resolved.hash = "";
        links.add(resolved.href);
      }
    } catch {}
    if (links.size >= limit) break;
  }

  return [...links];
}
