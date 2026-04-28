import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';
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
  platform?: string;
  sourceDraft?: string;
  currentPlatformDraft?: string;
  companyContext?: string[];
};

type AdaptApiResponse = {
  platform?: PlatformPromptKey;
  generatedContent?: string;
  provider?: string;
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
): string {
  const platformRules = getPromptRulesForPlatform(platform);

  const companyBlock = companyContext.length > 0
    ? [
        '',
        'Company context (use to ground product references, audience framing, and brand voice):',
        ...companyContext.map((line) => `- ${line}`),
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

  const prompt = buildAdaptationPrompt(platform, sourceDraft, currentPlatformDraft, companyContext);
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
    });
  } catch (error) {
    if (error instanceof AdaptGenerationTimeoutError) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }

    const message = error instanceof Error ? error.message : 'Unable to generate adapted content.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
