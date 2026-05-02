import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';
import { searchDuckDuckGo, type ResearchSource } from '@/lib/draftResearch';

type SimilarPostsRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  draft?: string;
  topic?: string;
  audience?: string;
  format?: string;
  query?: string;
  competitors?: string;
  companyContext?: string[];
};

type SimilarPostMatch = {
  title: string;
  url: string;
  snippet: string;
  similarityScore: number;
  overlapTerms: string[];
  sourceType: 'similar-post' | 'competitor';
  comparisonNote: string;
};

type SimilarPostsApiResponse = {
  query?: string;
  matches?: SimilarPostMatch[];
  comparisonMarkdown?: string;
  recommendedActions?: string[];
  provider?: string;
  searchProvider?: string;
  usedFallback?: boolean;
  error?: string;
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'with',
  'you',
  'your',
]);

const SIMILAR_POSTS_SYSTEM_PROMPT = [
  'You are a competitive content strategist.',
  'You are given the current draft plus web search results for similar posts and possible competitor content.',
  'Compare the current draft against the supplied results only.',
  'Do not invent links or external evidence that is not present in the result list.',
  'Return JSON only using this exact schema:',
  '{',
  '  "matches": [',
  '    {',
  '      "url": "string",',
  '      "comparisonNote": "string",',
  '      "similarityScore": 0,',
  '      "overlapTerms": ["string"],',
  '      "sourceType": "similar-post" | "competitor"',
  '    }',
  '  ],',
  '  "comparisonMarkdown": "string",',
  '  "recommendedActions": ["string"]',
  '}',
].join('\n');

function normalizeContextLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function tokenizeWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
}

function getMeaningfulWords(value: string): string[] {
  return tokenizeWords(value).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function countOccurrences(words: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

function topTerms(value: string, limit = 10): string[] {
  const counts = countOccurrences(getMeaningfulWords(value));
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([word]) => word);
}

function uniqueTerms(value: string): Set<string> {
  return new Set(getMeaningfulWords(value));
}

function parseCompetitors(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,;|]/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length >= 2),
    ),
  ).slice(0, 4);
}

function isCompetitorSource(source: ResearchSource, competitors: string[]): boolean {
  if (competitors.length === 0) return false;
  const haystack = `${source.title} ${source.snippet} ${source.url}`.toLowerCase();
  return competitors.some((competitor) => haystack.includes(competitor));
}

function buildComparisonNote(
  sourceType: 'similar-post' | 'competitor',
  overlapTerms: string[],
  uniqueSourceTerms: string[],
): string {
  const overlapText = overlapTerms.length > 0 ? `Shared themes: ${overlapTerms.join(', ')}.` : 'Low direct topical overlap in the snippet.';
  const gapText =
    uniqueSourceTerms.length > 0
      ? `Potential differentiation or coverage gap: ${uniqueSourceTerms.slice(0, 3).join(', ')}.`
      : 'The result mirrors the draft closely without introducing clear new angles.';
  const prefix = sourceType === 'competitor' ? 'Competitor signal.' : 'Similar-post signal.';
  return `${prefix} ${overlapText} ${gapText}`;
}

function buildFallbackMatches(
  draft: string,
  sources: ResearchSource[],
  competitors: string[],
): SimilarPostMatch[] {
  const draftTerms = uniqueTerms(draft);

  return sources
    .map((source) => {
      const sourceText = `${source.title} ${source.snippet}`;
      const sourceTerms = uniqueTerms(sourceText);
      const overlapTerms = [...draftTerms].filter((term) => sourceTerms.has(term)).slice(0, 5);
      const unionSize = new Set([...draftTerms, ...sourceTerms]).size || 1;
      const similarityScore = Math.max(18, Math.min(96, Math.round((overlapTerms.length / unionSize) * 220)));
      const uniqueSourceTerms = [...sourceTerms].filter((term) => !draftTerms.has(term));
      const sourceType = isCompetitorSource(source, competitors) ? 'competitor' : 'similar-post';
      return {
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        similarityScore,
        overlapTerms,
        sourceType,
        comparisonNote: buildComparisonNote(sourceType, overlapTerms, uniqueSourceTerms),
      } satisfies SimilarPostMatch;
    })
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, 8);
}

function buildFallbackSummary(draft: string, matches: SimilarPostMatch[], competitors: string[]): { comparisonMarkdown: string; recommendedActions: string[] } {
  const draftTopTerms = topTerms(draft, 8);
  const recurringExternalTerms = topTerms(matches.map((match) => `${match.title} ${match.snippet}`).join(' '), 12).filter(
    (term) => !draftTopTerms.includes(term),
  );
  const competitorMatches = matches.filter((match) => match.sourceType === 'competitor');
  const strongestMatches = matches.slice(0, 3);

  const summaryLines = [
    strongestMatches.length > 0
      ? `The closest external matches reinforce ${strongestMatches
          .flatMap((match) => match.overlapTerms)
          .filter((term, index, list) => list.indexOf(term) === index)
          .slice(0, 5)
          .join(', ') || 'the same core topic'}, which means the current post is aligned with the active market conversation.`
      : 'No strong similar-post matches were found, so the current draft may be targeting a narrower angle than the web results.',
    recurringExternalTerms.length > 0
      ? `Similar posts add adjacent themes such as ${recurringExternalTerms.slice(0, 4).join(', ')} that are not prominent in the current draft.`
      : 'The top results mostly overlap with the current draft and do not introduce major adjacent themes.',
    competitorMatches.length > 0
      ? `Competitor-linked results were found${competitors.length > 0 ? ` for ${competitors.join(', ')}` : ''}, which can be used to sharpen differentiation.`
      : 'No competitor-specific matches surfaced in the top results, so comparison is based mainly on topic-adjacent posts.',
  ];

  const recommendedActions = [
    strongestMatches[0]
      ? `Keep the shared theme around ${strongestMatches[0].overlapTerms[0] ?? 'the core topic'}, but make the opening claim more specific than ${strongestMatches[0].title}.`
      : 'Refine the topic query to match the exact angle you want to compare against.',
    recurringExternalTerms[0]
      ? `Consider whether ${recurringExternalTerms.slice(0, 2).join(' and ')} should be added as supporting proof points or subheads.`
      : 'Double down on the current angle since the search results do not reveal an obvious missing theme.',
    competitorMatches[0]
      ? `Add one line that explicitly differentiates your take from ${competitorMatches[0].title}.`
      : 'If competitor comparison matters, add one or two competitor names to narrow the search.',
  ];

  return {
    comparisonMarkdown: summaryLines.join('\n\n'),
    recommendedActions,
  };
}

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

function normalizeAiMatches(
  parsedMatches: unknown,
  fallbackMatches: SimilarPostMatch[],
): SimilarPostMatch[] {
  if (!Array.isArray(parsedMatches)) {
    return fallbackMatches;
  }

  const fallbackByUrl = new Map(fallbackMatches.map((match) => [match.url, match]));

  return (parsedMatches as Array<Record<string, unknown>>)
    .map((entry) => {
      const url = typeof entry.url === 'string' ? entry.url : '';
      const fallback = fallbackByUrl.get(url);
      if (!fallback) return null;
      const similarityScore = Number(entry.similarityScore);
      const overlapTerms = Array.isArray(entry.overlapTerms)
        ? entry.overlapTerms.filter((term): term is string => typeof term === 'string' && term.trim().length > 0).slice(0, 5)
        : fallback.overlapTerms;
      const sourceType = entry.sourceType === 'competitor' ? 'competitor' : 'similar-post';
      return {
        ...fallback,
        similarityScore: Number.isFinite(similarityScore) ? Math.max(0, Math.min(100, Math.round(similarityScore))) : fallback.similarityScore,
        overlapTerms,
        sourceType,
        comparisonNote:
          typeof entry.comparisonNote === 'string' && entry.comparisonNote.trim().length > 0
            ? entry.comparisonNote.trim()
            : fallback.comparisonNote,
      } satisfies SimilarPostMatch;
    })
    .filter((entry): entry is SimilarPostMatch => entry !== null)
    .sort((a, b) => b.similarityScore - a.similarityScore);
}

async function runAiComparison(
  provider: AIProvider,
  apiKey: string,
  ollamaBaseUrl: string,
  ollamaModel: string,
  draft: string,
  query: string,
  topic: string,
  audience: string,
  format: string,
  competitors: string[],
  companyContext: string[],
  fallbackMatches: SimilarPostMatch[],
  fallbackSummary: { comparisonMarkdown: string; recommendedActions: string[] },
): Promise<{ matches: SimilarPostMatch[]; comparisonMarkdown: string; recommendedActions: string[] }> {
  const companyBlock =
    companyContext.length > 0
      ? ['Company context:', ...companyContext.map((line) => `- ${line}`)].join('\n')
      : 'Company context: none provided.';
  const resultBlock = fallbackMatches
    .map(
      (match, index) =>
        `[${index + 1}] ${match.title}\nURL: ${match.url}\nType: ${match.sourceType}\nSnippet: ${match.snippet}\nFallback overlap: ${match.overlapTerms.join(', ') || 'none'}\nFallback note: ${match.comparisonNote}`,
    )
    .join('\n\n');

  const userPrompt = [
    `Query: ${query}`,
    topic ? `Topic: ${topic}` : null,
    audience ? `Audience: ${audience}` : null,
    format ? `Format: ${format}` : null,
    competitors.length > 0 ? `Competitors or comparison terms: ${competitors.join(', ')}` : 'Competitors or comparison terms: none provided.',
    companyBlock,
    '',
    'Current draft:',
    draft.length > 5000 ? `${draft.slice(0, 5000)}\n…(truncated)` : draft,
    '',
    'Candidate similar posts:',
    resultBlock || '(No results found)',
  ]
    .filter(Boolean)
    .join('\n');

  const messages: AIMessage[] = [
    { role: 'system', content: SIMILAR_POSTS_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const raw = await callAI({
    provider,
    apiKey,
    ollamaBaseUrl,
    ollamaModel,
    messages,
    temperature: 0.2,
    maxTokens: 1800,
    tag: '[API Similar Posts]',
  });

  const parsed = safeJsonParse(raw) as {
    matches?: unknown;
    comparisonMarkdown?: unknown;
    recommendedActions?: unknown;
  } | null;

  if (!parsed) {
    throw new Error('AI returned an unexpected format.');
  }

  return {
    matches: normalizeAiMatches(parsed.matches, fallbackMatches),
    comparisonMarkdown:
      typeof parsed.comparisonMarkdown === 'string' && parsed.comparisonMarkdown.trim().length > 0
        ? parsed.comparisonMarkdown.trim()
        : fallbackSummary.comparisonMarkdown,
    recommendedActions: Array.isArray(parsed.recommendedActions)
      ? parsed.recommendedActions.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 6)
      : fallbackSummary.recommendedActions,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<SimilarPostsApiResponse>> {
  let body: SimilarPostsRequestBody;
  try {
    body = (await request.json()) as SimilarPostsRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const audience = typeof body.audience === 'string' ? body.audience.trim() : '';
  const format = typeof body.format === 'string' ? body.format.trim() : '';
  const explicitQuery = typeof body.query === 'string' ? body.query.trim() : '';
  const competitors = parseCompetitors(typeof body.competitors === 'string' ? body.competitors : '');
  const companyContext = normalizeContextLines(body.companyContext);
  const ollamaBaseUrl = typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : DEFAULT_OLLAMA_MODEL;

  if (!draft) {
    return NextResponse.json({ error: 'Draft content is required.' }, { status: 400 });
  }

  const query = explicitQuery || [topic, format, 'post'].filter(Boolean).join(' ').trim();
  if (!query) {
    return NextResponse.json({ error: 'Provide a query or topic to search for similar posts.' }, { status: 400 });
  }

  const baseSearchPromise = searchDuckDuckGo(query, 5);
  const competitorSearchPromises = competitors.slice(0, 2).map((competitor) =>
    searchDuckDuckGo([competitor, topic || query, format].filter(Boolean).join(' '), 3),
  );
  const [baseSearch, ...competitorSearches] = await Promise.all([baseSearchPromise, ...competitorSearchPromises]);
  const sourceMap = new Map<string, ResearchSource>();
  [...baseSearch.sources, ...competitorSearches.flatMap((result) => result.sources)].forEach((source) => {
    if (!sourceMap.has(source.url)) {
      sourceMap.set(source.url, source);
    }
  });
  const sources = [...sourceMap.values()];
  const searchProvider = [baseSearch.provider, ...competitorSearches.map((result) => result.provider)]
    .filter((value) => value && value !== 'unavailable')
    .join(', ') || 'unavailable';

  const fallbackMatches = buildFallbackMatches(draft, sources, competitors);
  const fallbackSummary = buildFallbackSummary(draft, fallbackMatches, competitors);

  const canUseAi = provider === 'ollama' ? Boolean(ollamaModel) : Boolean(apiKey);
  if (!canUseAi) {
    return NextResponse.json({
      query,
      matches: fallbackMatches,
      comparisonMarkdown: fallbackSummary.comparisonMarkdown,
      recommendedActions: fallbackSummary.recommendedActions,
      provider: 'deterministic',
      searchProvider,
      usedFallback: true,
    });
  }

  try {
    const aiResult = await runAiComparison(
      provider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      draft,
      query,
      topic,
      audience,
      format,
      competitors,
      companyContext,
      fallbackMatches,
      fallbackSummary,
    );

    return NextResponse.json({
      query,
      matches: aiResult.matches,
      comparisonMarkdown: aiResult.comparisonMarkdown,
      recommendedActions: aiResult.recommendedActions,
      provider,
      searchProvider,
      usedFallback: false,
    });
  } catch {
    return NextResponse.json({
      query,
      matches: fallbackMatches,
      comparisonMarkdown: fallbackSummary.comparisonMarkdown,
      recommendedActions: fallbackSummary.recommendedActions,
      provider: 'deterministic',
      searchProvider,
      usedFallback: true,
    });
  }
}