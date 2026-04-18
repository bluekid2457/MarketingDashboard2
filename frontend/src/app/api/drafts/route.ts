import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type Angle = {
  id: string;
  title: string;
  summary: string;
  sections: string[];
};

type IdeaInput = {
  topic?: string;
  tone?: string;
  audience?: string;
  format?: string;
};

type DraftRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  idea?: IdeaInput;
  angle?: Angle;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSections(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function buildDraftPrompt(idea: IdeaInput, angle: Angle): string {
  const sectionLines = angle.sections.map((section, index) => `${index + 1}. ${section}`).join('\n');

  return [
    'You are a senior content strategist and long-form writer for a marketing team.',
    'Write a robust, publication-ready draft article using the provided idea and selected angle.',
    'Output markdown only. Do not wrap output in code fences.',
    'Structure requirements:',
    '- A compelling H1 title',
    '- An engaging introduction',
    '- A section for each provided outline point (as H2/H3 as needed)',
    '- Tactical examples and actionable takeaways',
    '- A strong conclusion with next steps',
    '',
    'Idea context:',
    `- Topic: ${asString(idea.topic) || 'Not provided'}`,
    `- Tone: ${asString(idea.tone) || 'Not provided'}`,
    `- Audience: ${asString(idea.audience) || 'Not provided'}`,
    `- Format: ${asString(idea.format) || 'Not provided'}`,
    '',
    'Selected angle:',
    `- Title: ${angle.title}`,
    `- Summary: ${angle.summary}`,
    '- Outline points:',
    sectionLines || '- Not provided',
  ].join('\n');
}

async function callProvider(
  provider: AIProvider,
  apiKey: string,
  prompt: string,
  options?: { ollamaBaseUrl?: string; ollamaModel?: string },
): Promise<string> {
  const messages: AIMessage[] = [
    { role: 'system', content: 'Return only markdown content for the draft.' },
    { role: 'user', content: prompt },
  ];
  return callAI({
    provider,
    apiKey,
    ollamaBaseUrl: options?.ollamaBaseUrl,
    ollamaModel: options?.ollamaModel,
    messages,
    temperature: 0.5,
    maxTokens: 2400,
    tag: '[API Drafts]',
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: DraftRequestBody;

  try {
    body = (await request.json()) as DraftRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const provider = body.provider;
  const apiKey = asString(body.apiKey);
  const ollamaBaseUrl = asString(body.ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = asString(body.ollamaModel) || DEFAULT_OLLAMA_MODEL;
  const idea = body.idea;
  const angle = body.angle;

  if (!provider || !['openai', 'gemini', 'claude', 'ollama'].includes(provider)) {
    return NextResponse.json({ error: 'A valid provider is required.' }, { status: 400 });
  }

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
  }

  const normalizedAngle: Angle | null = angle
    ? {
        id: asString(angle.id),
        title: asString(angle.title),
        summary: asString(angle.summary),
        sections: normalizeSections(angle.sections),
      }
    : null;

  if (!idea || !normalizedAngle || !normalizedAngle.title || !normalizedAngle.summary || normalizedAngle.sections.length === 0) {
    return NextResponse.json({ error: 'Idea and selected angle are required to generate a draft.' }, { status: 400 });
  }

  try {
    const prompt = buildDraftPrompt(idea, normalizedAngle);
    console.log(`[API Drafts] Final prompt prepared for ${provider}:\n${prompt}`);

    const draft = await callProvider(provider, apiKey, prompt, {
      ollamaBaseUrl,
      ollamaModel,
    });

    console.log(`[API Drafts] Final draft response from ${provider}:\n${draft}`);

    return NextResponse.json({
      provider,
      draft,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate draft.';
    console.error('[API Drafts] Error generating draft', { provider, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
