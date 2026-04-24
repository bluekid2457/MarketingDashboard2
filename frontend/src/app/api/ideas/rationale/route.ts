import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type RationaleLabel = 'Strong' | 'Moderate' | 'Weak';

type PersonalizationContext = {
  personal?: string[];
  company?: string[];
};

type IdeasRationaleRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  topic?: string;
  tone?: string;
  audience?: string;
  format?: string;
  score?: number;
  label?: RationaleLabel;
  fallbackReason?: string;
  fallbackImprovements?: string[];
  personalizationContext?: PersonalizationContext;
};

const PROVIDER_TIMEOUT_MS = 25_000;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function extractTextFromCodeFence(raw: string): string | null {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fencedMatch?.[1]?.trim() ?? null;
}

function extractJsonPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return trimmed;
  }

  const fencedText = extractTextFromCodeFence(trimmed);
  if (fencedText) {
    return fencedText;
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  return objectMatch?.[0] ?? null;
}

function buildFallbackResponse(body: IdeasRationaleRequestBody): {
  reason: string;
  improvements: string[];
  source: 'fallback';
} {
  const fallbackReason = asString(body.fallbackReason) || 'Deterministic fallback rationale was used.';
  const fallbackImprovements = normalizeStringList(body.fallbackImprovements);

  return {
    reason: fallbackReason,
    improvements: fallbackImprovements,
    source: 'fallback',
  };
}

function contextBlock(context: PersonalizationContext | undefined): string {
  const personal = normalizeStringList(context?.personal);
  const company = normalizeStringList(context?.company);

  return [
    'Personal context:',
    personal.length > 0 ? personal.map((line) => `- ${line}`).join('\n') : '- Not provided',
    'Company context:',
    company.length > 0 ? company.map((line) => `- ${line}`).join('\n') : '- Not provided',
  ].join('\n');
}

function buildPrompt(body: IdeasRationaleRequestBody): string {
  const topic = asString(body.topic);
  const tone = asString(body.tone) || 'Unspecified';
  const audience = asString(body.audience) || 'Unspecified';
  const format = asString(body.format) || 'Unspecified';
  const score = typeof body.score === 'number' ? body.score : 0;
  const label = body.label === 'Strong' || body.label === 'Moderate' || body.label === 'Weak' ? body.label : 'Moderate';

  return [
    'You are an expert content strategist for a marketing dashboard.',
    'Generate score reasoning for a single idea topic.',
    'Use the deterministic score as fixed input. Do not change or critique the score value itself.',
    'Output must be valid JSON only, with this exact schema:',
    '{"reason":"string","improvements":["string","string"]}',
    'Requirements:',
    '- reason must explain why the idea got this score and explicitly reference available context when present.',
    '- improvements must contain 2 to 3 concrete, actionable suggestions to raise relevance quality.',
    '- Keep the reason and improvements as short and concise as possible (max 1 short sentence each).',
    '- Use clear, practical language.',
    '',
    `Topic: ${topic}`,
    `Tone: ${tone}`,
    `Audience: ${audience}`,
    `Format: ${format}`,
    `Deterministic score: ${score}`,
    `Deterministic label: ${label}`,
    '',
    contextBlock(body.personalizationContext),
  ].join('\n');
}

async function callProvider(body: IdeasRationaleRequestBody): Promise<string> {
  const provider = body.provider as AIProvider;
  const apiKey = asString(body.apiKey);
  const ollamaBaseUrl = asString(body.ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = asString(body.ollamaModel) || DEFAULT_OLLAMA_MODEL;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const messages: AIMessage[] = [{ role: 'user', content: buildPrompt(body) }];

    return await callAI({
      provider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      signal: controller.signal,
      messages,
      temperature: 0.2,
      maxTokens: 500,
      tag: '[API Ideas Rationale]',
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseRationaleResponse(raw: string): { reason: string; improvements: string[] } {
  const payload = extractJsonPayload(raw);
  if (!payload) {
    throw new Error('Model response did not contain JSON.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Model returned malformed JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Model returned unexpected response shape.');
  }

  const candidate = parsed as {
    reason?: unknown;
    improvements?: unknown;
  };

  const reason = asString(candidate.reason);
  const improvements = normalizeStringList(candidate.improvements);

  if (!reason) {
    throw new Error('Model response reason is empty.');
  }

  if (improvements.length === 0) {
    throw new Error('Model response improvements are empty.');
  }

  return {
    reason,
    improvements,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: IdeasRationaleRequestBody;

  try {
    body = (await request.json()) as IdeasRationaleRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const topic = asString(body.topic);
  if (!topic) {
    return NextResponse.json({ error: 'topic is required.' }, { status: 400 });
  }

  if (typeof body.score !== 'number') {
    return NextResponse.json({ error: 'score is required.' }, { status: 400 });
  }

  if (body.label !== 'Strong' && body.label !== 'Moderate' && body.label !== 'Weak') {
    return NextResponse.json({ error: 'label is required.' }, { status: 400 });
  }

  const fallback = buildFallbackResponse(body);

  const provider = body.provider;
  if (provider !== 'openai' && provider !== 'gemini' && provider !== 'claude' && provider !== 'ollama') {
    return NextResponse.json({ ...fallback, fallbackReason: 'invalid_provider' });
  }

  if (provider !== 'ollama' && !asString(body.apiKey)) {
    return NextResponse.json({ ...fallback, fallbackReason: 'missing_api_key' });
  }

  if (provider === 'ollama' && !asString(body.ollamaModel)) {
    return NextResponse.json({ ...fallback, fallbackReason: 'missing_ollama_model' });
  }

  try {
    const rawText = await callProvider(body);
    const parsed = parseRationaleResponse(rawText);

    return NextResponse.json({
      reason: parsed.reason,
      improvements: parsed.improvements,
      source: 'ai',
    });
  } catch {
    return NextResponse.json({ ...fallback, fallbackReason: 'provider_error' });
  }
}
