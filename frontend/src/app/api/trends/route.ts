import { NextResponse } from 'next/server';

type TrendArticle = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

type TrendArticleRecord = TrendArticle & {
  publishedAtMs: number;
};

type TrendTopic = {
  label: string;
  count: number;
};

type TopicRule = {
  label: string;
  pattern: RegExp;
};

const SEARCH_QUERIES = [
  'marketing AI SEO',
  'generative engine optimization',
  'content marketing AI search',
];

const TOPIC_RULES: TopicRule[] = [
  { label: 'AI Search', pattern: /ai search|llm optimization|generative ai/i },
  { label: 'AI-powered SEO', pattern: /ai[- ]powered seo|ai driven seo|ai seo|seo with ai/i },
  { label: 'Generative Engine Optimization', pattern: /\bgeo\b|generative engine optimization/i },
  { label: 'Answer Engine Optimization', pattern: /\baeo\b|answer engine optimization/i },
  { label: 'Content Marketing', pattern: /content marketing|content workflow/i },
  { label: 'Brand Visibility', pattern: /brand visibility|search visibility|visibility/i },
  { label: 'Zero-click Search', pattern: /zero-click/i },
  { label: 'Marketing Automation', pattern: /marketing automation|automation/i },
];

const MAX_ARTICLES = 8;
const MAX_TOPICS = 6;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hexValue: string) =>
      String.fromCodePoint(Number.parseInt(hexValue, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimalValue: string) =>
      String.fromCodePoint(Number.parseInt(decimalValue, 10)),
    );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeTagName(tagName: string): string {
  return tagName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function extractTagValue(block: string, tagName: string): string {
  const escapedTagName = escapeTagName(tagName);
  const match = block.match(new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\/${escapedTagName}>`, 'i'));
  return match ? decodeXmlEntities(stripHtml(match[1])) : '';
}

function extractBingArticleUrl(link: string): string {
  try {
    const parsedLink = new URL(link);
    const targetUrl = parsedLink.searchParams.get('url');
    return targetUrl ? decodeURIComponent(targetUrl) : link;
  } catch {
    return link;
  }
}

function parsePublishedAt(value: string): number {
  const parsedValue = Date.parse(value);
  return Number.isNaN(parsedValue) ? 0 : parsedValue;
}

function formatPublishedAt(value: string): string {
  const parsedValue = parsePublishedAt(value);
  if (!parsedValue) {
    return 'Unknown date';
  }

  return new Date(parsedValue).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function parseRss(xml: string): TrendArticleRecord[] {
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];

  return itemMatches
    .map((itemBlock) => {
      const title = extractTagValue(itemBlock, 'title');
      const source = extractTagValue(itemBlock, 'News:Source') || extractTagValue(itemBlock, 'source');
      const link = extractTagValue(itemBlock, 'link');
      const publishedAt = extractTagValue(itemBlock, 'pubDate');

      return {
        title,
        url: extractBingArticleUrl(link),
        source,
        publishedAt: formatPublishedAt(publishedAt),
        publishedAtMs: parsePublishedAt(publishedAt),
      } satisfies TrendArticleRecord;
    })
    .filter((article) => article.title && article.url);
}

async function fetchTrendFeed(query: string): Promise<TrendArticleRecord[]> {
  const response = await fetch(
    `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
    {
      headers: {
        'User-Agent': 'MarketingDashboard2/0.1',
      },
      next: { revalidate: 1800 },
    },
  );

  if (!response.ok) {
    throw new Error(`Unable to fetch trend feed for query: ${query}`);
  }

  const xml = await response.text();
  return parseRss(xml);
}

function deduplicateArticles(articles: TrendArticleRecord[]): TrendArticle[] {
  const articleMap = new Map<string, TrendArticleRecord>();

  for (const article of articles) {
    const key = article.url || article.title;
    const existingArticle = articleMap.get(key);

    if (!existingArticle || article.publishedAtMs > existingArticle.publishedAtMs) {
      articleMap.set(key, article);
    }
  }

  return Array.from(articleMap.values())
    .sort((left, right) => right.publishedAtMs - left.publishedAtMs)
    .slice(0, MAX_ARTICLES)
    .map(({ publishedAtMs, ...article }) => article);
}

function deriveTopics(articles: TrendArticle[]): TrendTopic[] {
  const tallies = new Map<string, number>();

  for (const article of articles) {
    const matchedLabels = new Set<string>();

    for (const rule of TOPIC_RULES) {
      if (rule.pattern.test(article.title)) {
        matchedLabels.add(rule.label);
      }
    }

    if (matchedLabels.size === 0) {
      const fallbackLabel = article.title
        .replace(/[:|,-].*$/, '')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(' ');

      if (fallbackLabel) {
        matchedLabels.add(fallbackLabel);
      }
    }

    for (const label of matchedLabels) {
      tallies.set(label, (tallies.get(label) ?? 0) + 1);
    }
  }

  return Array.from(tallies.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_TOPICS)
    .map(([label, count]) => ({ label, count }));
}

export async function GET(): Promise<NextResponse> {
  try {
    const feedResults = await Promise.all(SEARCH_QUERIES.map((query) => fetchTrendFeed(query)));
    const articles = deduplicateArticles(feedResults.flat());
    const topics = deriveTopics(articles);

    return NextResponse.json({
      topics,
      articles,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load live trend signals from the public news feeds.' },
      { status: 502 },
    );
  }
}
