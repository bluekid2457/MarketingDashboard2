import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type ResearchRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  topic?: string;
  audience?: string;
  draft?: string;
  query?: string;
  companyContext?: string[];
};

function normalizeContextLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

type ResearchSource = {
  title: string;
  url: string;
  snippet: string;
};

type ResearchFinding = {
  claim: string;
  evidence: string;
  sourceIndex: number;
};

type ResearchApiResponse = {
  query?: string;
  sources?: ResearchSource[];
  findings?: ResearchFinding[];
  briefMarkdown?: string;
  provider?: string;
  searchProvider?: string;
  error?: string;
};

const RESEARCH_SYSTEM_PROMPT = [
  'You are a research assistant.',
  'You are given a list of recent web search snippets.',
  'Your job is to extract verifiable factual claims and tie each one back to a specific source from the list.',
  'You MUST NOT invent sources. Only cite sources that appear in the input list.',
  'Return JSON only:',
  '{',
  '  "findings": [',
  '    { "claim": "string", "evidence": "string", "sourceIndex": 0 }',
  '  ],',
  '  "briefMarkdown": "string (1-2 paragraph synthesis with [n] citations matching sourceIndex+1)"',
  '}',
  'No code fences, no prose outside the JSON.',
].join('\n');

function safeJsonParse(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/gim, '').replace(/```\s*$/gim, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isValidHttpUrl(value: string): boolean {
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

async function searchDuckDuckGo(query: string): Promise<{ provider: string; sources: ResearchSource[] }> {
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
        if (sources.length >= 8) break;
        const url = entry.FirstURL?.trim();
        const text = entry.Text?.trim();
        if (!url || !text || !isValidHttpUrl(url)) continue;
        const titleEnd = text.indexOf(' - ');
        const title = titleEnd > 0 ? text.slice(0, titleEnd) : text;
        const snippet = titleEnd > 0 ? text.slice(titleEnd + 3) : text;
        sources.push({ title, url, snippet });
      }

      if (sources.length > 0) {
        return { provider: 'duckduckgo', sources };
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
    while ((match = blockRegex.exec(html)) !== null && sources.length < 8) {
      const rawUrl = match[1] ?? '';
      let url = rawUrl;
      try {
        if (rawUrl.startsWith('//')) {
          url = `https:${rawUrl}`;
        } else if (rawUrl.startsWith('/')) {
          // DuckDuckGo redirector — pull the destination from the uddg query param.
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
    if (sources.length > 0) {
      return { provider: 'duckduckgo-html', sources };
    }
  } catch {
    // Both attempts failed — return empty so the AI step can still degrade gracefully.
  }

  return { provider: 'unavailable', sources: [] };
}

export async function POST(request: NextRequest): Promise<NextResponse<ResearchApiResponse>> {
  let body: ResearchRequestBody;
  try {
    body = (await request.json()) as ResearchRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const audience = typeof body.audience === 'string' ? body.audience.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  const explicitQuery = typeof body.query === 'string' ? body.query.trim() : '';
  const ollamaBaseUrl = typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : DEFAULT_OLLAMA_MODEL;
  const companyContext = normalizeContextLines(body.companyContext);

  const query = explicitQuery || [topic, audience].filter(Boolean).join(' ').trim();
  if (!query) {
    return NextResponse.json({ error: 'Provide a topic or query for research.' }, { status: 400 });
  }
  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided.' }, { status: 400 });
  }

  const { provider: searchProvider, sources } = await searchDuckDuckGo(query);

  const sourcesForPrompt = sources.length > 0
    ? sources
        .map((source, index) => `[${index}] ${source.title}\nURL: ${source.url}\nSnippet: ${source.snippet}`)
        .join('\n\n')
    : '(No live web search results were available. Use draft context to suggest research questions and explicitly mark them as "needs verification".)';

  const companyLines = companyContext.length > 0
    ? [
        '',
        'Company context (use to bias relevance toward findings that fit this company\'s industry, audience, and product):',
        ...companyContext.map((line) => `- ${line}`),
      ]
    : [];

  const userPrompt = [
    `Topic: ${query}`,
    audience ? `Audience: ${audience}` : null,
    ...companyLines,
    '',
    'Search results to ground the brief:',
    sourcesForPrompt,
    '',
    'Existing draft (optional, for relevance):',
    draft ? (draft.length > 4000 ? `${draft.slice(0, 4000)}\n…(truncated)` : draft) : '(no draft yet)',
  ].filter(Boolean).join('\n');

  try {
    const messages: AIMessage[] = [
      { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const raw = await callAI({
      provider: provider as AIProvider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages,
      temperature: 0.3,
      maxTokens: 2000,
      tag: '[API Draft Research]',
    });

    const parsed = safeJsonParse(raw) as { findings?: unknown; briefMarkdown?: unknown } | null;
    if (!parsed) {
      return NextResponse.json({ error: 'AI returned an unexpected format.' }, { status: 502 });
    }

    const findings: ResearchFinding[] = Array.isArray(parsed.findings)
      ? (parsed.findings as Array<Record<string, unknown>>)
          .map((entry) => {
            const sourceIndex = Number(entry.sourceIndex);
            return {
              claim: typeof entry.claim === 'string' ? entry.claim : '',
              evidence: typeof entry.evidence === 'string' ? entry.evidence : '',
              sourceIndex: Number.isFinite(sourceIndex) && sourceIndex >= 0 && sourceIndex < sources.length ? sourceIndex : -1,
            };
          })
          .filter((entry) => entry.claim.length > 0)
      : [];

    const briefMarkdown = typeof parsed.briefMarkdown === 'string' ? parsed.briefMarkdown : '';

    return NextResponse.json({
      query,
      sources,
      findings,
      briefMarkdown,
      provider,
      searchProvider,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error during research.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
