import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type HeadlinesRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  draft?: string;
  topic?: string;
  audience?: string;
  count?: number;
};

type HeadlineVariant = {
  id: string;
  variant: 'A' | 'B' | 'C' | 'D' | 'E';
  text: string;
  hookType: string;
  rationale: string;
};

type HeadlinesApiResponse = {
  variants?: HeadlineVariant[];
  provider?: string;
  error?: string;
};

const SYSTEM_PROMPT = [
  'You are a senior content marketer who specializes in headline testing.',
  'Generate distinct headline variants designed to be A/B tested against each other.',
  'Each variant should use a meaningfully different hook (curiosity gap, contrarian, data-led, how-to, listicle, story, urgency, benefit-led, question, prediction).',
  'Headlines must be under 90 characters, scan well at a glance, and stay accurate to the source draft.',
  'Return JSON only:',
  '{',
  '  "variants": [',
  '    { "variant": "A", "text": "string", "hookType": "string", "rationale": "string" }',
  '  ]',
  '}',
  'No code fences, no extra prose.',
].join('\n');

const VARIANT_LETTERS: Array<'A' | 'B' | 'C' | 'D' | 'E'> = ['A', 'B', 'C', 'D', 'E'];

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

export async function POST(request: NextRequest): Promise<NextResponse<HeadlinesApiResponse>> {
  let body: HeadlinesRequestBody;
  try {
    body = (await request.json()) as HeadlinesRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const audience = typeof body.audience === 'string' ? body.audience.trim() : '';
  const requestedCount = Number.isFinite(body.count) ? Math.max(2, Math.min(5, Math.floor(body.count as number))) : 5;
  const ollamaBaseUrl = typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : DEFAULT_OLLAMA_MODEL;

  if (!draft) {
    return NextResponse.json({ error: 'Draft text is required.' }, { status: 400 });
  }
  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided.' }, { status: 400 });
  }

  const userPrompt = [
    `Generate ${requestedCount} distinct A/B headline variants for this draft.`,
    topic ? `Topic: ${topic}` : null,
    audience ? `Audience: ${audience}` : null,
    '',
    'Draft:',
    '---',
    draft.length > 6000 ? `${draft.slice(0, 6000)}\n…(truncated)` : draft,
    '---',
  ].filter(Boolean).join('\n');

  try {
    const messages: AIMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const raw = await callAI({
      provider: provider as AIProvider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages,
      temperature: 0.7,
      maxTokens: 1200,
      tag: '[API Draft Headlines]',
    });

    const parsed = safeJsonParse(raw) as { variants?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.variants)) {
      return NextResponse.json({ error: 'AI returned an unexpected format.' }, { status: 502 });
    }

    const variants: HeadlineVariant[] = (parsed.variants as Array<Record<string, unknown>>)
      .map((entry, index) => {
        const text = typeof entry.text === 'string' ? entry.text.trim() : '';
        if (!text) {
          return null;
        }
        const variantLetter = (typeof entry.variant === 'string' ? entry.variant.toUpperCase().trim() : '') as 'A';
        const variant: 'A' | 'B' | 'C' | 'D' | 'E' = VARIANT_LETTERS.includes(variantLetter) ? variantLetter : VARIANT_LETTERS[index] ?? 'A';
        return {
          id: `variant-${variant}-${index}`,
          variant,
          text,
          hookType: typeof entry.hookType === 'string' ? entry.hookType : 'unspecified',
          rationale: typeof entry.rationale === 'string' ? entry.rationale : '',
        };
      })
      .filter((entry): entry is HeadlineVariant => entry !== null);

    if (variants.length === 0) {
      return NextResponse.json({ error: 'AI did not return any headline variants.' }, { status: 502 });
    }

    return NextResponse.json({ variants, provider });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error generating headlines.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
