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
  companyContext?: string[];
};

type CitationValidation = {
  hasSourcesSection: boolean;
  uncitedClaimCount: number;
};

type NormalizedIdea = {
  topic: string;
  tone: string;
  audience: string;
  format: string;
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

function normalizeIdea(idea: IdeaInput): NormalizedIdea {
  return {
    topic: asString(idea.topic),
    tone: asString(idea.tone),
    audience: asString(idea.audience),
    format: asString(idea.format),
  };
}

function buildFallbackDraft(idea: NormalizedIdea, angle: Angle, reason: string): string {
  const title = angle.title || idea.topic || 'Marketing Storyboard';
  const summary = angle.summary || `A practical angle for ${idea.topic || 'your topic'}.`;
  const sectionList = angle.sections.length > 0 ? angle.sections : ['Core Insight', 'Execution Steps', 'Measurement Plan'];

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('## Introduction');
  lines.push(
    `This storyboard was generated with a deterministic fallback because the AI provider request failed (${reason}). It keeps the selected idea and angle structure so work can continue without interruption [1].`,
  );
  lines.push('');
  lines.push(
    `Focus this piece on ${idea.audience || 'your target audience'} with a ${idea.tone || 'clear and practical'} tone, and frame recommendations for ${idea.format || 'a long-form article'} outcomes [2].`,
  );
  lines.push('');

  for (const section of sectionList) {
    lines.push(`## ${section}`);
    lines.push(`${summary}`);
    lines.push('- Explain why this section matters to the reader [1].');
    lines.push('- Add one specific tactic and one concrete example [2].');
    lines.push('- Close with a measurable next step the team can execute this week [1].');
    lines.push('');
  }

  lines.push('## Conclusion');
  lines.push('Summarize the highest-impact actions, confirm ownership, and define what success looks like over the next 30 days [1].');
  lines.push('');
  lines.push('## Sources');
  lines.push('- [1] [Content Marketing Institute - Content Marketing Strategy](https://contentmarketinginstitute.com/articles/content-marketing-strategy/)');
  lines.push('- [2] [Google Search Central - Helpful, Reliable, People-First Content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)');

  return lines.join('\n');
}

function normalizeContextLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function buildDraftPrompt(idea: IdeaInput, angle: Angle, companyContext: string[]): string {
  const sectionLines = angle.sections.map((section, index) => `${index + 1}. ${section}`).join('\n');

  const companyBlock = companyContext.length > 0
    ? [
        '',
        'Company context (ground tone, examples, audience framing, and product references in this):',
        ...companyContext.map((line) => `- ${line}`),
      ]
    : [];

  return [
    'You are a senior content strategist and long-form writer for a marketing team.',
    'Write a robust, publication-ready storyboard draft using the provided idea and selected angle.',
    'Output markdown only. Do not wrap output in code fences.',
    'Structure requirements:',
    '- A compelling H1 title',
    '- An engaging introduction',
    '- A section for each provided outline point (as H2/H3 as needed)',
    '- Tactical examples and actionable takeaways',
    '- A strong conclusion with next steps',
    '- Include citations for all factual claims using numeric markers such as [1], [2], [3]',
    '- End with a "## Sources" section that lists every citation marker with a clickable URL in markdown list format',
    '- If a claim cannot be verified, rewrite it as an opinion or practical recommendation instead of presenting it as fact',
    '',
    'Idea context:',
    `- Topic: ${asString(idea.topic) || 'Not provided'}`,
    `- Tone: ${asString(idea.tone) || 'Not provided'}`,
    `- Audience: ${asString(idea.audience) || 'Not provided'}`,
    `- Format: ${asString(idea.format) || 'Not provided'}`,
    ...companyBlock,
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

function validateCitations(draft: string): CitationValidation {
  const hasSourcesSection = /##\s+sources\b/i.test(draft);
  const sentences = draft
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const uncitedClaimCount = sentences.filter((sentence) => {
    const factualPattern =
      /\d|%|\baccording to\b|\bresearch\b|\breport\b|\bstudy\b|\bdata\b|\bgrowth\b|\bincrease\b|\bdecrease\b/i;
    if (!factualPattern.test(sentence)) {
      return false;
    }
    return !/\[\d+\]/.test(sentence);
  }).length;

  return {
    hasSourcesSection,
    uncitedClaimCount,
  };
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
  const companyContext = normalizeContextLines(body.companyContext);

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
  const normalizedIdea = idea ? normalizeIdea(idea) : null;

  if (!normalizedIdea || !normalizedAngle || !normalizedAngle.title || !normalizedAngle.summary || normalizedAngle.sections.length === 0) {
    return NextResponse.json({ error: 'Idea and selected angle are required to generate a draft.' }, { status: 400 });
  }

  let prompt = '';

  try {
    prompt = buildDraftPrompt(normalizedIdea, normalizedAngle, companyContext);
    console.log(`[API Drafts] Final prompt prepared for ${provider}:\n${prompt}`);

    const draft = await callProvider(provider, apiKey, prompt, {
      ollamaBaseUrl,
      ollamaModel,
    });

    console.log(`[API Drafts] Final draft response from ${provider}:\n${draft}`);

    return NextResponse.json({
      provider,
      draft,
      promptUsed: prompt,
      modelText: draft,
      citationValidation: validateCitations(draft),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate draft.';
    console.error('[API Drafts] Error generating draft', { provider, error: message });
    const fallbackDraft = buildFallbackDraft(normalizedIdea, normalizedAngle, message);

    return NextResponse.json({
      provider,
      draft: fallbackDraft,
      promptUsed: prompt,
      modelText: fallbackDraft,
      citationValidation: validateCitations(fallbackDraft),
      source: 'fallback',
      fallbackReason: message,
    });
  }
}
