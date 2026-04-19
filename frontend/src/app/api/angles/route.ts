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
  selectedAngle?: Partial<Angle>;
};

type AnglesRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  idea?: string | IdeaInput;
  count?: number;
  selectedAngleId?: string;
  refinementPrompt?: string;
};

const MAX_ANGLES = 8;
const DEFAULT_ANGLES = 4;

function makeFallbackSections(topic: string, audience: string, format: string): string[] {
  return [
    `Define the core ${topic || 'topic'} problem for ${audience || 'the audience'}`,
    `Outline a ${format || 'content'} framework with concrete steps`,
    'Add one tactical example with measurable outcomes',
    'Close with a practical CTA and next-step checklist',
  ];
}

function buildFallbackAngles(
  idea: string | IdeaInput,
  count: number,
  isRefinement: boolean,
  selectedAngleId: string,
): Angle[] {
  const topic = typeof idea === 'string' ? idea.trim() : asString(idea.topic);
  const tone = typeof idea === 'string' ? '' : asString(idea.tone);
  const audience = typeof idea === 'string' ? '' : asString(idea.audience);
  const format = typeof idea === 'string' ? '' : asString(idea.format);
  const sections = makeFallbackSections(topic, audience, format);

  if (isRefinement) {
    return [{
      id: selectedAngleId || crypto.randomUUID(),
      title: `${topic || 'Content'}: Refined Tactical Angle`,
      summary: `A refined ${tone || 'clear'} approach focused on ${audience || 'the target audience'} with executable guidance.`,
      sections,
    }];
  }

  return Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    title: `${topic || 'Content'} Angle ${index + 1}`,
    summary: `A ${tone || 'practical'} strategy for ${audience || 'your audience'} optimized for ${format || 'your channel'}.`,
    sections,
  }));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    return trimmed;
  }

  const fencedText = extractTextFromCodeFence(trimmed);
  if (fencedText) {
    return fencedText;
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    return arrayMatch[0];
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  return objectMatch?.[0] ?? null;
}

function normalizeSections(rawSections: unknown): string[] {
  if (!Array.isArray(rawSections)) {
    return [];
  }

  return rawSections
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }

      if (item && typeof item === 'object') {
        const candidate = item as { title?: unknown; label?: unknown; text?: unknown; value?: unknown };
        return (
          asString(candidate.title)
          || asString(candidate.label)
          || asString(candidate.text)
          || asString(candidate.value)
        );
      }

      return '';
    })
    .filter(Boolean);
}

function validateAndNormalizeAngles(raw: unknown): Angle[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { angles?: unknown[] }).angles)
      ? (raw as { angles: unknown[] }).angles
      : [];

  if (!Array.isArray(source) || source.length === 0) {
    throw new Error('AI response did not include a non-empty angles array.');
  }

  const normalized = source
    .map((item): Angle | null => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const candidate = item as {
        id?: unknown;
        title?: unknown;
        summary?: unknown;
        description?: unknown;
        sections?: unknown;
        outline?: unknown;
      };

      const title = asString(candidate.title);
      const summary = asString(candidate.summary) || asString(candidate.description);
      const sections = normalizeSections(candidate.sections ?? candidate.outline);

      if (!title || !summary || sections.length === 0) {
        return null;
      }

      return {
        id: asString(candidate.id) || crypto.randomUUID(),
        title,
        summary,
        sections,
      };
    })
    .filter((value): value is Angle => Boolean(value));

  if (normalized.length === 0) {
    throw new Error('AI output could not be validated into structured angles.');
  }

  return normalized;
}

function parseAnglesFromModelText(rawText: string): Angle[] {
  const jsonPayload = extractJsonPayload(rawText);
  if (!jsonPayload) {
    throw new Error('Model response did not contain JSON.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch {
    throw new Error('Model returned malformed JSON.');
  }

  return validateAndNormalizeAngles(parsed);
}

function ideaToPromptBlock(idea: string | IdeaInput): string {
  if (typeof idea === 'string') {
    return idea.trim();
  }

  const parts = [
    `Idea: ${asString(idea.topic) || 'Not provided'}`,
    `Tone: ${asString(idea.tone) || 'Not provided'}`,
    `Audience: ${asString(idea.audience) || 'Not provided'}`,
    `Format: ${asString(idea.format) || 'Not provided'}`,
  ];

  if (idea.selectedAngle) {
    const selectedAngleSections = normalizeSections(idea.selectedAngle.sections);
    parts.push(`Selected angle title: ${asString(idea.selectedAngle.title) || 'Not provided'}`);
    parts.push(`Selected angle summary: ${asString(idea.selectedAngle.summary) || 'Not provided'}`);
    parts.push(
      `Selected angle sections: ${selectedAngleSections.length > 0 ? selectedAngleSections.join(' | ') : 'Not provided'}`,
    );
  }

  return parts.join('\n');
}

function buildGenerationPrompt(idea: string | IdeaInput, count: number): string {
  return [
    'You are an expert content strategist for a marketing team.',
    `Generate exactly ${count} distinct content angles for the idea below.`,
    'Respond with JSON only. No prose, no markdown, no code fences.',
    'Expected schema: [{"id":"string","title":"string","summary":"string","sections":["string", "string"]}]',
    'Each angle must contain 4 to 6 sections and each section should be concise and actionable.',
    '',
    'Idea context:',
    ideaToPromptBlock(idea),
  ].join('\n');
}

function buildRefinementPrompt(
  idea: string | IdeaInput,
  selectedAngleId: string,
  refinementPrompt: string,
): string {
  return [
    'You are an expert content strategist refining an existing angle.',
    `Refine the selected angle identified as id="${selectedAngleId}" using the instruction below.`,
    'Respond with JSON only and return exactly one angle object in an array.',
    'Expected schema: [{"id":"string","title":"string","summary":"string","sections":["string", "string"]}]',
    'Preserve the core idea while applying the refinement request.',
    '',
    `Refinement request: ${refinementPrompt}`,
    '',
    'Idea context and selected angle:',
    ideaToPromptBlock(idea),
  ].join('\n');
}

async function callProvider(
  provider: AIProvider,
  apiKey: string,
  prompt: string,
  options?: { ollamaBaseUrl?: string; ollamaModel?: string },
): Promise<string> {
  const messages: AIMessage[] = [
    { role: 'system', content: 'Return only valid JSON that follows the user schema.' },
    { role: 'user', content: prompt },
  ];
  return callAI({
    provider,
    apiKey,
    ollamaBaseUrl: options?.ollamaBaseUrl,
    ollamaModel: options?.ollamaModel,
    messages,
    temperature: 0.4,
    tag: '[API Angles]',
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: AnglesRequestBody;

  try {
    body = (await request.json()) as AnglesRequestBody;
  } catch {
    console.error('[API Angles] Invalid JSON request body');
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const provider = body.provider;
  const apiKey = asString(body.apiKey);
  const ollamaBaseUrl = asString(body.ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = asString(body.ollamaModel) || DEFAULT_OLLAMA_MODEL;
  const idea = body.idea;
  const selectedAngleId = asString(body.selectedAngleId);
  const refinementPrompt = asString(body.refinementPrompt);
  const rawCount = typeof body.count === 'number' ? body.count : DEFAULT_ANGLES;
  const count = Math.max(1, Math.min(MAX_ANGLES, Math.floor(rawCount)));

  console.debug('[API Angles] POST request received', {
    provider,
    hasApiKey: !!apiKey,
    ideaType: typeof idea,
    isRefinement: !!refinementPrompt,
    requestedCount: rawCount,
    normalizedCount: count,
  });

  if (!provider || !['openai', 'gemini', 'claude', 'ollama'].includes(provider)) {
    console.error('[API Angles] Invalid provider:', provider);
    return NextResponse.json({ error: 'A valid provider is required.' }, { status: 400 });
  }

  if (provider !== 'ollama' && !apiKey) {
    console.error('[API Angles] API key required for provider:', provider);
    return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
  }

  if (provider === 'ollama' && !ollamaModel) {
    console.error('[API Angles] Ollama model is required');
    return NextResponse.json({ error: 'Ollama model is required.' }, { status: 400 });
  }

  if (!idea || (typeof idea === 'string' && !idea.trim())) {
    console.error('[API Angles] Idea content is required');
    return NextResponse.json({ error: 'Idea content is required.' }, { status: 400 });
  }

  try {
    const isRefinement = Boolean(refinementPrompt);
    const prompt = isRefinement
      ? buildRefinementPrompt(idea, selectedAngleId || 'selected-angle', refinementPrompt)
      : buildGenerationPrompt(idea, count);

    console.debug('[API Angles] Built prompt', {
      isRefinement,
      promptLength: prompt.length,
    });
    console.log(`[API Angles] Final prompt prepared for ${provider}:\n${prompt}`);

    const modelText = await callProvider(provider, apiKey, prompt, {
      ollamaBaseUrl,
      ollamaModel,
    });

    console.log(`[API Angles] Raw model response from ${provider}:\n${modelText}`);

    const parsedAngles = parseAnglesFromModelText(modelText);

    console.debug('[API Angles] Parsed angles', {
      count: parsedAngles.length,
      angles: parsedAngles.map((a) => ({ id: a.id, title: a.title })),
    });

    const normalizedAngles = isRefinement
      ? parsedAngles.slice(0, 1).map((angle) => ({
          ...angle,
          id: selectedAngleId || angle.id,
        }))
      : parsedAngles.slice(0, count).map((angle) => ({
          ...angle,
          id: angle.id || crypto.randomUUID(),
        }));

    console.debug('[API Angles] Returning response', {
      provider,
      angleCount: normalizedAngles.length,
    });

    return NextResponse.json({
      angles: normalizedAngles,
      provider,
      promptUsed: prompt,
      modelText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate angles.';
    console.error('[API Angles] Error generating angles:', { provider, error: message });

    const isRefinement = Boolean(refinementPrompt);
    const fallbackAngles = buildFallbackAngles(idea, isRefinement ? 1 : count, isRefinement, selectedAngleId);

    console.warn('[API Angles] Returning fallback angles to avoid hard failure', {
      provider,
      isRefinement,
      count: fallbackAngles.length,
    });

    return NextResponse.json({
      angles: fallbackAngles,
      provider,
      error: `AI provider failed, fallback angles were returned. Root cause: ${message}`,
      promptUsed: null,
      modelText: null,
      fallback: true,
    });
  }
}
