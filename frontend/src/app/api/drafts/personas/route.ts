import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type PersonaTarget = {
  id?: string;
  name: string;
  description?: string;
};

type PersonasRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  draft?: string;
  personas?: PersonaTarget[];
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

type PersonaVariant = {
  id: string;
  name: string;
  description: string;
  draft: string;
  pitchAdjustment: string;
};

type PersonasApiResponse = {
  variants?: PersonaVariant[];
  provider?: string;
  error?: string;
};

const SYSTEM_PROMPT = [
  'You are a senior content editor.',
  'You will produce one rewrite per persona, tailored to that persona\'s motivation, vocabulary, and reading habits.',
  'Preserve all factual claims. Preserve citation markers like [1] [2]. Preserve the Sources / References block at the end of the draft.',
  'Return JSON only, in this exact shape:',
  '{',
  '  "variants": [',
  '    {',
  '      "id": "string",',
  '      "name": "string",',
  '      "description": "string (one sentence on who this is for)",',
  '      "draft": "the full rewritten draft for this persona",',
  '      "pitchAdjustment": "string (one sentence on what changed for this persona)"',
  '    }',
  '  ]',
  '}',
  'Do not include code fences. Do not include any text outside the JSON object.',
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

export async function POST(request: NextRequest): Promise<NextResponse<PersonasApiResponse>> {
  let body: PersonasRequestBody;
  try {
    body = (await request.json()) as PersonasRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  const personas = Array.isArray(body.personas) ? body.personas : [];
  const ollamaBaseUrl = typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : DEFAULT_OLLAMA_MODEL;
  const companyContext = normalizeContextLines(body.companyContext);

  if (!draft) {
    return NextResponse.json({ error: 'Draft text is required.' }, { status: 400 });
  }
  if (personas.length === 0) {
    return NextResponse.json({ error: 'At least one persona is required.' }, { status: 400 });
  }
  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided.' }, { status: 400 });
  }

  const companyBlock = companyContext.length > 0
    ? [
        '',
        'Company context (use to keep product references and brand voice consistent across all persona variants):',
        ...companyContext.map((line) => `- ${line}`),
      ]
    : [];

  const userPrompt = [
    'Original draft:',
    '---',
    draft,
    '---',
    ...companyBlock,
    '',
    'Generate one rewrite per persona below. Match each output object\'s "id" and "name" exactly to the persona it targets.',
    'Personas:',
    JSON.stringify(personas, null, 2),
  ].join('\n');

  try {
    const messages: AIMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const draftTokensEstimate = Math.ceil(draft.length / 4);
    const personasOverhead = 200;
    const requestedMaxTokens = Math.min(
      16000,
      Math.max(4000, draftTokensEstimate * personas.length + personasOverhead * personas.length),
    );

    const raw = await callAI({
      provider: provider as AIProvider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages,
      temperature: 0.5,
      maxTokens: requestedMaxTokens,
      tag: '[API Draft Personas]',
    });

    const parsed = safeJsonParse(raw) as { variants?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.variants)) {
      console.error('[API Draft Personas] Failed to parse AI response. Raw output:', raw.slice(0, 500));
      return NextResponse.json(
        { error: 'AI returned an unexpected format. The output may have been truncated — try fewer personas or a shorter draft.' },
        { status: 502 },
      );
    }

    const variants: PersonaVariant[] = (parsed.variants as Array<Record<string, unknown>>).map((entry, index) => {
      const fallback = personas[index] ?? personas[0];
      const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id : (fallback?.id ?? `persona-${index + 1}`);
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : (fallback?.name ?? `Persona ${index + 1}`);
      const description = typeof entry.description === 'string' ? entry.description : (fallback?.description ?? '');
      const draftText = typeof entry.draft === 'string' ? entry.draft.trim() : '';
      const pitchAdjustment = typeof entry.pitchAdjustment === 'string' ? entry.pitchAdjustment : '';
      return { id, name, description, draft: draftText, pitchAdjustment };
    }).filter((variant) => variant.draft.length > 0);

    if (variants.length === 0) {
      return NextResponse.json({ error: 'AI did not return any persona variants.' }, { status: 502 });
    }

    return NextResponse.json({ variants, provider });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error generating persona variants.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
