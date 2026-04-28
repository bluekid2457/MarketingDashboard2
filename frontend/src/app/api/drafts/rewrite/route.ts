import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type RewriteMode = 'tone' | 'sentiment' | 'readability';

type RewriteRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  draft?: string;
  mode?: RewriteMode;
  tone?: string;
  sentiment?: string;
  complexityLabel?: string;
  complexityDescription?: string;
  audienceHint?: string;
  fleschTarget?: number;
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

type RewriteApiResponse = {
  updatedDraft?: string;
  summary?: string;
  provider?: string;
  error?: string;
};

function buildSystemPrompt(body: RewriteRequestBody, companyContext: string[]): string {
  const lines: string[] = [
    'You are a senior content editor.',
    'You will rewrite the user\'s draft and return the FULL updated draft only.',
    'Do not add commentary, headings, or markdown fences around the result.',
    'Preserve the existing markdown structure (headings, lists, citation markers like [1]).',
    'Preserve any existing Sources / References block at the end exactly as-is.',
    'Keep the same factual content; only change phrasing, vocabulary, sentence length, and tone.',
  ];

  if (body.mode === 'tone' && body.tone) {
    lines.push(`Target tone: ${body.tone}.`);
  }

  if (body.mode === 'sentiment' && body.sentiment) {
    lines.push(`Target sentiment: ${body.sentiment}. Keep claims accurate; do not invent positives or negatives.`);
  }

  if (body.mode === 'readability') {
    if (body.complexityLabel) {
      lines.push(`Target reading level: ${body.complexityLabel}.`);
    }
    if (body.complexityDescription) {
      lines.push(`Reading guidance: ${body.complexityDescription}.`);
    }
    if (body.audienceHint) {
      lines.push(`Audience: ${body.audienceHint}.`);
    }
    if (typeof body.fleschTarget === 'number' && Number.isFinite(body.fleschTarget)) {
      lines.push(`Aim for Flesch Reading Ease near ${Math.round(body.fleschTarget)}.`);
    }
  }

  if (companyContext.length > 0) {
    lines.push('');
    lines.push('Company context (preserve product references and brand voice when rewriting):');
    for (const entry of companyContext) {
      lines.push(`- ${entry}`);
    }
  }

  lines.push('Output only the rewritten draft text.');
  return lines.join('\n');
}

export async function POST(request: NextRequest): Promise<NextResponse<RewriteApiResponse>> {
  let body: RewriteRequestBody;
  try {
    body = (await request.json()) as RewriteRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  const ollamaBaseUrl = typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : DEFAULT_OLLAMA_MODEL;
  const companyContext = normalizeContextLines(body.companyContext);

  if (!draft) {
    return NextResponse.json({ error: 'Draft text is required.' }, { status: 400 });
  }

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided.' }, { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(body, companyContext);

  try {
    const messages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Rewrite this draft:\n\n${draft}` },
    ];

    const raw = await callAI({
      provider: provider as AIProvider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages,
      temperature: 0.4,
      maxTokens: 3500,
      tag: '[API Draft Rewrite]',
    });

    const cleaned = raw.replace(/^```[a-z]*\s*/gim, '').replace(/```\s*$/gim, '').trim();
    if (!cleaned) {
      return NextResponse.json({ error: 'AI returned no content.' }, { status: 502 });
    }

    let summary = 'Draft rewritten.';
    if (body.mode === 'tone' && body.tone) summary = `Rewritten in a ${body.tone} tone.`;
    if (body.mode === 'sentiment' && body.sentiment) summary = `Rewritten with ${body.sentiment} sentiment.`;
    if (body.mode === 'readability' && body.complexityLabel) summary = `Rewritten at ${body.complexityLabel} reading level.`;

    return NextResponse.json({ updatedDraft: cleaned, summary, provider });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error during rewrite.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
