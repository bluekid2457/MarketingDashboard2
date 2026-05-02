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
  generationSeed?: string;
  companyContext?: string[];
};

const MAX_ANGLES = 8;
const DEFAULT_ANGLES = 3;
const PROVIDER_TIMEOUT_MS = 300_000; // 5 minutes
const PROVIDER_MAX_ATTEMPTS = 2;

type AngleSource = 'provider' | 'fallback';

type IdeaContext = {
  topic: string;
  tone: string;
  audience: string;
  format: string;
};

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

function areAnglesDistinct(angles: Angle[]): boolean {
  const seen = new Set<string>();
  for (const angle of angles) {
    const dedupeKey = `${angle.title.trim().toLowerCase()}|${angle.summary.trim().toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      return false;
    }
    seen.add(dedupeKey);
  }
  return true;
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

  if (!areAnglesDistinct(normalized)) {
    throw new Error('AI output included duplicate angles.');
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

function normalizeContextLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function buildCompanyContextBlock(companyContext: string[]): string[] {
  if (companyContext.length === 0) {
    return [];
  }
  return [
    '',
    'Company context (use to ground angle relevance, audience framing, and product references):',
    ...companyContext.map((line) => `- ${line}`),
  ];
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

function normalizeIdeaContext(idea: string | IdeaInput): IdeaContext {
  if (typeof idea === 'string') {
    return {
      topic: asString(idea) || 'your topic',
      tone: 'clear and practical',
      audience: 'your audience',
      format: 'article',
    };
  }

  return {
    topic: asString(idea.topic) || 'your topic',
    tone: asString(idea.tone) || 'clear and practical',
    audience: asString(idea.audience) || 'your audience',
    format: asString(idea.format) || 'article',
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function buildDeterministicFallbackAngles(idea: string | IdeaInput, generationSeed?: string): Angle[] {
  const context = normalizeIdeaContext(idea);
  const seedBasis = generationSeed
    || `${context.topic}|${context.tone}|${context.audience}|${context.format}`;
  const seedHash = hashString(seedBasis);

  const painPointLens = ['workflow bottlenecks', 'execution blind spots', 'delivery friction', 'performance stalls'];
  const frameworkLens = ['operating blueprint', 'decision framework', 'execution playbook', 'repeatable system'];
  const caseStudyLens = ['before/after transformation', 'turnaround scenario', 'measured pilot', 'field test'];

  const urgencyQualifiers = ['immediate', 'high-impact', 'practical', 'low-lift'];
  const narrativeStyles = ['stepwise', 'diagnostic', 'results-first', 'hands-on'];

  const painLens = painPointLens[seedHash % painPointLens.length];
  const frameworkName = frameworkLens[(seedHash + 1) % frameworkLens.length];
  const caseLens = caseStudyLens[(seedHash + 2) % caseStudyLens.length];
  const urgency = urgencyQualifiers[(seedHash + 3) % urgencyQualifiers.length];
  const narrativeStyle = narrativeStyles[(seedHash + 4) % narrativeStyles.length];

  return [
    {
      id: 'fallback-1',
      title: `${context.audience} ${painLens} around ${context.topic}`,
      summary: `Map the most ${urgency} blockers ${context.audience} face with ${context.topic} in a ${narrativeStyle} ${context.tone} ${context.format}.`,
      sections: [
        `Current state: how ${context.audience} currently approach ${context.topic}`,
        `Top friction points causing weak outcomes`,
        `Root-cause analysis with practical examples`,
        'Action checklist for immediate wins',
      ],
    },
    {
      id: 'fallback-2',
      title: `${context.topic} ${frameworkName} for ${context.audience}`,
      summary: `Lay out a ${urgency} ${frameworkName} for ${context.topic}, tailored to ${context.audience} in a ${context.tone} voice.`,
      sections: [
        'Framework overview and success criteria',
        `Step-by-step execution model in ${context.format} format`,
        'Common implementation mistakes and fixes',
        'Metrics to track progress over time',
      ],
    },
    {
      id: 'fallback-3',
      title: `${context.topic} ${caseLens} for ${context.audience}`,
      summary: `Walk through a ${narrativeStyle} ${caseLens} showing how ${context.audience} can improve outcomes with ${context.topic}.`,
      sections: [
        'Baseline scenario and constraints',
        'Intervention strategy and decision points',
        'Measured outcomes and lessons learned',
        `Next-step roadmap for sustained improvement in a ${context.tone} tone`,
      ],
    },
  ];
}

function buildSingleAnglePrompt(
  idea: string | IdeaInput,
  angleIndex: number,
  totalCount: number,
  generationSeed?: string,
  previousAngles?: Angle[],
  companyContext: string[] = [],
): string {
  const perspectiveHints = [
    'Focus on the core problem or pain point this idea addresses for the target audience.',
    'Focus on a practical framework, actionable strategy, or step-by-step execution approach.',
    'Focus on a real-world scenario, transformation story, or case-study narrative.',
    'Focus on a data-driven, research-backed, or evidence-led approach.',
    'Focus on contrarian thinking, surprising insights, or an unconventional perspective.',
    'Focus on beginner-friendly fundamentals or an educational deep-dive.',
    'Focus on advanced tactics or expert-level nuance for seasoned practitioners.',
    'Focus on future trends, emerging opportunities, or forward-looking strategy.',
  ];

  const perspective = perspectiveHints[angleIndex % perspectiveHints.length];

  const avoidLines =
    previousAngles && previousAngles.length > 0
      ? [
          '',
          'Already generated — make this angle clearly distinct from these:',
          ...previousAngles.map((a) => `- "${a.title}": ${a.summary}`),
        ]
      : [];

  return [
    'You are an expert content strategist for a marketing team.',
    `Generate exactly 1 content angle for the idea below (angle ${angleIndex + 1} of ${totalCount}).`,
    `Perspective directive: ${perspective}`,
    'Respond with JSON only. No prose, no markdown, no code fences.',
    'Expected schema: [{"id":"string","title":"string","summary":"string","sections":["string", "string"]}]',
    'The angle must contain 4 to 6 sections and each section should be concise and actionable.',
    generationSeed ? `Generation seed: ${generationSeed}-${angleIndex}` : '',
    ...avoidLines,
    '',
    'Idea context:',
    ideaToPromptBlock(idea),
    ...buildCompanyContextBlock(companyContext),
  ]
    .filter(Boolean)
    .join('\n');
}

function buildRefinementPrompt(
  idea: string | IdeaInput,
  selectedAngleId: string,
  refinementPrompt: string,
  companyContext: string[] = [],
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
    ...buildCompanyContextBlock(companyContext),
  ].join('\n');
}

async function callProvider(
  provider: AIProvider,
  apiKey: string,
  prompt: string,
  options?: { ollamaBaseUrl?: string; ollamaModel?: string; signal?: AbortSignal },
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
    signal: options?.signal,
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
  const generationSeed = asString(body.generationSeed);
  const companyContext = normalizeContextLines(body.companyContext);
  const rawCount = typeof body.count === 'number' ? body.count : DEFAULT_ANGLES;
  const count = Math.max(1, Math.min(MAX_ANGLES, Math.floor(rawCount)));

  console.debug('[API Angles] POST request received', {
    provider,
    hasApiKey: !!apiKey,
    ideaType: typeof idea,
    isRefinement: !!refinementPrompt,
    hasGenerationSeed: !!generationSeed,
    requestedCount: rawCount,
    normalizedCount: count,
  });

  if (!idea || (typeof idea === 'string' && !idea.trim())) {
    console.error('[API Angles] Idea content is required');
    return NextResponse.json({ error: 'Idea content is required.' }, { status: 400 });
  }

  const validProviders: AIProvider[] = ['openai', 'gemini', 'claude', 'ollama'];
  const providerValid = provider !== undefined && validProviders.includes(provider);
  const configIncomplete =
    !providerValid ||
    (provider !== 'ollama' && !apiKey) ||
    (provider === 'ollama' && !ollamaModel);

  if (configIncomplete) {
    const fallbackReason = !providerValid
      ? `Invalid or missing provider: '${String(provider)}'.`
      : provider !== 'ollama' && !apiKey
        ? `No API key configured for provider '${String(provider)}'.`
        : `No Ollama model configured for provider 'ollama'.`;

    console.warn('[API Angles] Provider config incomplete, returning deterministic fallback', {
      provider,
      fallbackReason,
    });

    const fallbackAngles = buildDeterministicFallbackAngles(idea, generationSeed);
    return NextResponse.json({
      angles: fallbackAngles.slice(0, count),
      provider: String(provider ?? 'unknown'),
      source: 'fallback' satisfies AngleSource,
      fallbackReason,
    });
  }

  // Structural narrowing guard: configIncomplete already returned above if provider was absent.
  if (!provider) {
    return NextResponse.json({ error: 'Unexpected: provider required.' }, { status: 500 });
  }

  try {
    const isRefinement = Boolean(refinementPrompt);

    // ── Refinement path (single prompt, unchanged) ────────────────────────────
    if (isRefinement) {
      const prompt = buildRefinementPrompt(idea, selectedAngleId || 'selected-angle', refinementPrompt, companyContext);
      console.debug('[API Angles] Built refinement prompt', { promptLength: prompt.length });
      console.log(`[API Angles] Final refinement prompt for ${provider}:\n${prompt}`);

      let lastError = 'Unknown provider error.';

      for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt += 1) {
        const providerAbortController = new AbortController();
        const providerTimeoutId = setTimeout(() => providerAbortController.abort(), PROVIDER_TIMEOUT_MS);
        const requestAbortHandler = (): void => { providerAbortController.abort(); };
        request.signal.addEventListener('abort', requestAbortHandler, { once: true });

        try {
          const modelText = await callProvider(provider, apiKey, prompt, {
            ollamaBaseUrl,
            ollamaModel,
            signal: providerAbortController.signal,
          });

          console.log(`[API Angles] Raw refinement response from ${provider} (attempt ${attempt}):\n${modelText}`);

          const parsedAngles = parseAnglesFromModelText(modelText);
          const normalizedAngles = parsedAngles.slice(0, 1).map((angle) => ({
            ...angle,
            id: selectedAngleId || angle.id,
          }));

          console.debug('[API Angles] Returning refinement response', {
            provider,
            source: 'provider' satisfies AngleSource,
            attempt,
          });

          return NextResponse.json({
            angles: normalizedAngles,
            provider,
            promptUsed: prompt,
            modelText,
            source: 'provider' satisfies AngleSource,
          });
        } catch (error) {
          if (providerAbortController.signal.aborted) {
            lastError = request.signal.aborted
              ? 'Client canceled the request before generation completed.'
              : `Provider call timed out after ${Math.floor(PROVIDER_TIMEOUT_MS / 1000)} seconds.`;
          } else {
            lastError = error instanceof Error ? error.message : 'Unable to refine angle.';
          }

          console.warn('[API Angles] Refinement attempt failed', {
            provider,
            attempt,
            maxAttempts: PROVIDER_MAX_ATTEMPTS,
            error: lastError,
          });

          if (request.signal.aborted) {
            throw new Error(lastError);
          }
        } finally {
          clearTimeout(providerTimeoutId);
          request.signal.removeEventListener('abort', requestAbortHandler);
        }
      }

      throw new Error(lastError);
    }

    // ── Sequential generation path (one angle at a time) ─────────────────────
    const collectedAngles: Angle[] = [];
    let anyFromProvider = false;
    const fallbackPool = buildDeterministicFallbackAngles(idea, generationSeed);

    for (let angleIndex = 0; angleIndex < count; angleIndex += 1) {
      const singlePrompt = buildSingleAnglePrompt(idea, angleIndex, count, generationSeed, collectedAngles, companyContext);
      console.debug('[API Angles] Generating angle', { slot: angleIndex + 1, total: count });
      console.log(`[API Angles] Single-angle prompt for slot ${angleIndex + 1} of ${count}:\n${singlePrompt}`);

      let angleForSlot: Angle | null = null;
      let slotLastError = 'Unknown provider error.';

      for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt += 1) {
        const providerAbortController = new AbortController();
        const providerTimeoutId = setTimeout(() => providerAbortController.abort(), PROVIDER_TIMEOUT_MS);
        const requestAbortHandler = (): void => { providerAbortController.abort(); };
        request.signal.addEventListener('abort', requestAbortHandler, { once: true });

        try {
          const modelText = await callProvider(provider, apiKey, singlePrompt, {
            ollamaBaseUrl,
            ollamaModel,
            signal: providerAbortController.signal,
          });

          console.log(`[API Angles] Raw model response for slot ${angleIndex + 1} (attempt ${attempt}):\n${modelText}`);

          const parsed = parseAnglesFromModelText(modelText);
          if (parsed.length === 0) {
            throw new Error('AI returned no usable angle.');
          }

          angleForSlot = { ...parsed[0], id: parsed[0].id || crypto.randomUUID() };
          anyFromProvider = true;

          console.debug('[API Angles] Angle slot filled', {
            slot: angleIndex + 1,
            attempt,
            title: angleForSlot.title,
          });

          break;
        } catch (error) {
          if (providerAbortController.signal.aborted) {
            slotLastError = request.signal.aborted
              ? 'Client canceled the request before generation completed.'
              : `Provider call timed out after ${Math.floor(PROVIDER_TIMEOUT_MS / 1000)} seconds.`;
          } else {
            slotLastError = error instanceof Error ? error.message : 'Unable to generate angle.';
          }

          console.warn('[API Angles] Angle slot attempt failed', {
            provider,
            slot: angleIndex + 1,
            attempt,
            maxAttempts: PROVIDER_MAX_ATTEMPTS,
            error: slotLastError,
          });

          if (request.signal.aborted) {
            throw new Error(slotLastError);
          }
        } finally {
          clearTimeout(providerTimeoutId);
          request.signal.removeEventListener('abort', requestAbortHandler);
        }
      }

      if (!angleForSlot) {
        angleForSlot = {
          ...fallbackPool[angleIndex % fallbackPool.length],
          id: `fallback-${angleIndex + 1}`,
        };
        console.warn('[API Angles] Using fallback for angle slot', {
          slot: angleIndex + 1,
          reason: slotLastError,
        });
      }

      collectedAngles.push(angleForSlot);
    }

    const source: AngleSource = anyFromProvider ? 'provider' : 'fallback';

    console.debug('[API Angles] Returning sequential generation response', {
      provider,
      source,
      angleCount: collectedAngles.length,
    });

    return NextResponse.json({
      angles: collectedAngles,
      provider,
      promptUsed: `[sequential:${count}] angles generated one at a time`,
      modelText: null,
      source,
      ...(source === 'fallback'
        ? { fallbackReason: 'All provider attempts failed for all angle slots.' }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate angles.';
    console.error('[API Angles] Error generating angles:', { provider, error: message });

    return NextResponse.json(
      {
        angles: [],
        provider,
        error: `AI angle generation failed. Root cause: ${message}`,
        promptUsed: null,
        modelText: null,
      },
      { status: 502 },
    );
  }
}
