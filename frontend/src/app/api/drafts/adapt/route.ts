import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';
import { fetchResearchSources, type ResearchSource } from '@/lib/draftResearch';
import {
  ADAPT_PROVIDER_TIMEOUT_MS,
  buildAdaptGenerationTimeoutMessage,
  isAbortLikeError,
} from '@/lib/adaptTimeout';
import {
  getPromptRulesForPlatform,
  isPlatformPromptKey,
  type PlatformPromptKey,
} from '@/lib/prompts/platforms';

type AdaptRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  exaApiKey?: string;
  ideaTopic?: string;
  platform?: string;
  sourceDraft?: string;
  currentPlatformDraft?: string;
  companyContext?: string[];
};

type AdaptApiResponse = {
  platform?: PlatformPromptKey;
  generatedContent?: string;
  provider?: string;
  searchProvider?: string;
  searchQuery?: string;
  sourceCount?: number;
  error?: string;
};

class AdaptGenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(buildAdaptGenerationTimeoutMessage(timeoutMs));
    this.name = 'AdaptGenerationTimeoutError';
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function callAdaptProviderWithTimeout(
  payload: Parameters<typeof callAI>[0],
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new AdaptGenerationTimeoutError(timeoutMs)), timeoutMs);

  try {
    return await callAI({
      ...payload,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      controller.signal.aborted &&
      (controller.signal.reason instanceof AdaptGenerationTimeoutError || isAbortLikeError(error))
    ) {
      throw controller.signal.reason instanceof AdaptGenerationTimeoutError
        ? controller.signal.reason
        : new AdaptGenerationTimeoutError(timeoutMs);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeContextLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function buildAdaptationPrompt(
  platform: PlatformPromptKey,
  sourceDraft: string,
  currentPlatformDraft: string,
  companyContext: string[],
  researchSources: ResearchSource[],
  hasLiveSources: boolean,
): string {
  const platformRules = getPromptRulesForPlatform(platform);

  const companyBlock = companyContext.length > 0
    ? [
        '',
        'Company context (use to ground product references, audience framing, and brand voice):',
        ...companyContext.map((line) => `- ${line}`),
      ]
    : [];

  const sourcesBlock: string[] = researchSources.length > 0
    ? [
        '',
        'Live research sources — use these to add or support factual claims in the adapted content:',
        ...researchSources.flatMap((source, index) => [
          `- [${index + 1}] ${source.title}`,
          `  URL: ${source.url}`,
          `  Key excerpt: ${source.snippet || 'No excerpt available.'}`,
        ]),
        '',
        'CITATION RULES — mandatory when live research sources are present:',
        '- When you draw a factual claim from a source, embed its URL as an inline markdown link.',
        '  Format: [descriptive anchor text](exact-url) — placed immediately after the claim, before punctuation.',
        '- Use the EXACT URL from the sources list above — do NOT shorten, guess, or invent URLs.',
        '- Add a "## Sources" section at the very end listing every source you cited.',
        '  Format per entry: "- [Source Title](exact-url)"',
        '- If the source draft already has a "## Sources" section, keep its entries and append any new ones.',
      ]
    : [];

  const noSourcesBlock: string[] = !hasLiveSources
    ? [
        '',
        'CRITICAL — NO LIVE SOURCES AVAILABLE: Exa is not configured and no fallback sources were found.',
        'Do NOT invent statistics, URLs, studies, or specific data points.',
        'For any sentence that would cite an external fact, write an ALL-CAPS placeholder instead.',
        'Format: FIND [description of what to research] — SUGGESTED SOURCE: [publication or source type].',
      ]
    : [];

  return [
    'Adapt the source draft for the requested platform using the platform prompt rules.',
    'Preserve the core meaning and factual claims from the source draft.',
    'Return only the final adapted content. Do not return commentary and do not use code fences.',
    '',
    `Platform: ${platform}`,
    '',
    'Platform prompt rules:',
    platformRules,
    ...companyBlock,
    ...sourcesBlock,
    ...noSourcesBlock,
    '',
    'Source draft:',
    '---',
    sourceDraft,
    '---',
    '',
    'Current platform draft (optional context):',
    '---',
    currentPlatformDraft || '(none)',
    '---',
  ].join('\n');
}

async function formulateAdaptQuery(
  platform: string,
  ideaTopic: string,
  sourceDraft: string,
  provider: AIProvider,
  apiKey: string,
  ollamaBaseUrl: string,
  ollamaModel: string,
): Promise<string> {
  const draftPreview = sourceDraft.slice(0, 300).replace(/\s+/g, ' ').trim();
  const fallback = [platform, ideaTopic].filter(Boolean).join(' ');
  const prompt = [
    `Generate a concise Exa search query (max 10 words) to find current, credible sources for content being adapted for ${platform}.`,
    '',
    `Topic: ${ideaTopic || '(not specified)'}`,
    `Draft preview: ${draftPreview || '(empty)'}`,
    '',
    'Return ONLY the search query string. No explanation, no quotes, no trailing punctuation.',
  ].join('\n');

  try {
    const raw = await callAI({
      provider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 30,
      tag: '[Query Formulation Adapt]',
    });
    const query = raw.trim().replace(/^["']|["']$/g, '');
    return query || fallback;
  } catch {
    return fallback;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<AdaptApiResponse>> {
  let body: AdaptRequestBody;

  try {
    body = (await request.json()) as AdaptRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider;
  const apiKey = asString(body.apiKey);
  const ollamaBaseUrl = asString(body.ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = asString(body.ollamaModel) || DEFAULT_OLLAMA_MODEL;
  const exaApiKey = asString(body.exaApiKey);
  const ideaTopic = asString(body.ideaTopic);
  const platform = asString(body.platform);
  const sourceDraft = typeof body.sourceDraft === 'string' ? body.sourceDraft : '';
  const currentPlatformDraft = typeof body.currentPlatformDraft === 'string' ? body.currentPlatformDraft : '';
  const companyContext = normalizeContextLines(body.companyContext);

  if (!provider || !['openai', 'gemini', 'claude', 'ollama'].includes(provider)) {
    return NextResponse.json({ error: 'A valid provider is required.' }, { status: 400 });
  }

  if (!isPlatformPromptKey(platform)) {
    return NextResponse.json({ error: 'A valid platform is required.' }, { status: 400 });
  }

  if (!sourceDraft.trim()) {
    return NextResponse.json({ error: 'sourceDraft is required.' }, { status: 400 });
  }

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
  }

  if (provider === 'ollama' && !ollamaModel.trim()) {
    return NextResponse.json({ error: 'Ollama model is required.' }, { status: 400 });
  }

  // Step 1: AI formulates a focused Exa query from platform + topic + draft content
  // Step 2: fetch sources with that query
  // Step 3: generate adaptation with sources injected (below)
  let researchSources: ResearchSource[] = [];
  let searchProvider = 'unavailable';
  let searchQuery = [platform, ideaTopic].filter(Boolean).join(' ');

  if (exaApiKey) {
    // Step 1: LLM derives a specific, searchable query from platform context and draft
    searchQuery = await formulateAdaptQuery(platform, ideaTopic, sourceDraft, provider as AIProvider, apiKey, ollamaBaseUrl, ollamaModel);
    console.log(`[Query Formulation Adapt] Platform: "${platform}" | Topic: "${ideaTopic}" → Exa query: "${searchQuery}"`);

    // Step 2: fetch Exa sources with the AI-formulated query
    try {
      const result = await fetchResearchSources(searchQuery, exaApiKey, 4);
      researchSources = result.sources;
      searchProvider = result.provider;
      if (searchProvider === 'exa') {
        console.log(`[Exa Adapt Search] Query: "${searchQuery}" → ${researchSources.length} source${researchSources.length !== 1 ? 's' : ''} retrieved`);
      } else {
        console.log(`[Research Adapt] Provider: ${searchProvider} | Query: "${searchQuery}" | Sources: ${researchSources.length}`);
      }
    } catch {
      console.warn(`[Research Adapt] Source fetch failed for query: "${searchQuery}" — proceeding without sources`);
    }
  } else {
    console.log(`[Research Adapt] No Exa key — skipping source search. Adapted content will use ALL-CAPS placeholders for factual claims.`);
  }

  const hasLiveSources = researchSources.length > 0;
  const prompt = buildAdaptationPrompt(platform, sourceDraft, currentPlatformDraft, companyContext, researchSources, hasLiveSources);
  const messages: AIMessage[] = [
    {
      role: 'system',
      content: 'You are a platform adaptation assistant for marketing content. Output only the adapted copy.',
    },
    { role: 'user', content: prompt },
  ];

  try {
    const generatedContent = await callAdaptProviderWithTimeout({
      provider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages,
      temperature: 0.3,
      maxTokens: 2200,
      tag: '[API Draft Adapt]',
    }, ADAPT_PROVIDER_TIMEOUT_MS);

    if (!generatedContent.trim()) {
      throw new Error('AI returned empty adapted content.');
    }

    return NextResponse.json({
      platform,
      generatedContent: generatedContent.trim(),
      provider,
      searchProvider,
      searchQuery,
      sourceCount: researchSources.length,
    });
  } catch (error) {
    if (error instanceof AdaptGenerationTimeoutError) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }

    const message = error instanceof Error ? error.message : 'Unable to generate adapted content.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
