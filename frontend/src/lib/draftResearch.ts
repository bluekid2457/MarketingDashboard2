export type ResearchSource = {
  title: string;
  url: string;
  snippet: string;
};

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function canonicalizeUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function dedupeSources(sources: ResearchSource[], limit: number): ResearchSource[] {
  const seen = new Set<string>();
  const deduped: ResearchSource[] = [];

  for (const source of sources) {
    const normalizedUrl = canonicalizeUrl(source.url);
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    deduped.push({
      title: source.title.trim() || normalizedUrl,
      url: normalizedUrl,
      snippet: source.snippet.trim(),
    });
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

export async function searchDuckDuckGo(query: string, limit = 8): Promise<{ provider: string; sources: ResearchSource[] }> {
  // Try the DuckDuckGo Instant Answer JSON endpoint first — it has CORS-free JSON output and no key.
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&t=marketing-dashboard`;
    const response = await fetch(ddgUrl, { headers: { 'User-Agent': 'MarketingDashboard/1.0 (+research)' } });
    if (response.ok) {
      const data = (await response.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
      };

      const sources: ResearchSource[] = [];
      if (data.AbstractURL && data.AbstractText && isValidHttpUrl(data.AbstractURL)) {
        sources.push({
          title: data.Heading || data.AbstractURL,
          url: data.AbstractURL,
          snippet: data.AbstractText,
        });
      }

      const flat: Array<{ Text?: string; FirstURL?: string }> = [];
      for (const entry of data.RelatedTopics ?? []) {
        if (Array.isArray(entry.Topics)) {
          flat.push(...entry.Topics);
        } else {
          flat.push(entry);
        }
      }

      for (const entry of flat) {
        if (sources.length >= limit) break;
        const url = entry.FirstURL?.trim();
        const text = entry.Text?.trim();
        if (!url || !text || !isValidHttpUrl(url)) continue;
        const titleEnd = text.indexOf(' - ');
        const title = titleEnd > 0 ? text.slice(0, titleEnd) : text;
        const snippet = titleEnd > 0 ? text.slice(titleEnd + 3) : text;
        sources.push({ title, url, snippet });
      }

      const deduped = dedupeSources(sources, limit);
      if (deduped.length > 0) {
        return { provider: 'duckduckgo', sources: deduped };
      }
    }
  } catch {
    // fall through to HTML fallback
  }

  // HTML fallback parses duckduckgo.com/html search results.
  try {
    const htmlUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(htmlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketingDashboardResearchBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) {
      throw new Error(`Search returned ${response.status}`);
    }
    const html = await response.text();
    const blockRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    const sources: ResearchSource[] = [];
    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(html)) !== null && sources.length < limit) {
      const rawUrl = match[1] ?? '';
      let url = rawUrl;
      try {
        if (rawUrl.startsWith('//')) {
          url = `https:${rawUrl}`;
        } else if (rawUrl.startsWith('/')) {
          const parsed = new URL(`https://duckduckgo.com${rawUrl}`);
          url = parsed.searchParams.get('uddg') ?? rawUrl;
        }
      } catch {
        url = rawUrl;
      }
      const title = stripHtmlTags(match[2] ?? '');
      const snippet = stripHtmlTags(match[3] ?? '');
      if (url && title && isValidHttpUrl(url)) {
        sources.push({ title, url, snippet });
      }
    }
    const deduped = dedupeSources(sources, limit);
    if (deduped.length > 0) {
      return { provider: 'duckduckgo-html', sources: deduped };
    }
  } catch {
    // Both attempts failed — return empty so the AI step can still degrade gracefully.
  }

  return { provider: 'unavailable', sources: [] };
}