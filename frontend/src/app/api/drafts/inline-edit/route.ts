import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type InlineEditRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  draft?: string;
  selectedText?: string;
  selectionStart?: number;
  selectionEnd?: number;
  instruction?: string;
};

type InlineEditResponse = {
  proposal?: {
    beforeText: string;
    afterText: string;
    changeSummary: string;
    selectionStart: number;
    selectionEnd: number;
  };
  proposals?: Array<{
    beforeText: string;
    afterText: string;
    changeSummary: string;
    selectionStart: number;
    selectionEnd: number;
  }>;
  provider?: string;
  fallback?: boolean;
  error?: string;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractJsonPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  return objectMatch?.[0] ?? null;
}

function buildSelectedTextPrompt(draft: string, selectedText: string, instruction: string): string {
  return [
    'You are an expert inline editor for a storyboard document.',
    'Rewrite only the selected text based on the user instruction while preserving the surrounding context.',
    'Keep tone and meaning aligned with the full draft.',
    'Do not add markdown code fences.',
    'Return JSON only with this exact schema:',
    '{"updatedText":"string","changeSummary":"string"}',
    '',
    'Draft context:',
    '---',
    draft,
    '---',
    '',
    'Selected text:',
    selectedText,
    '',
    'Instruction:',
    instruction,
  ].join('\n');
}

function buildAutonomousPrompt(draft: string, instruction: string): string {
  return [
    'You are an expert inline editor for a storyboard document.',
    'No text is pre-selected. Choose one specific passage from the draft that best matches the instruction and rewrite only that passage.',
    'Keep tone and meaning aligned with the full draft.',
    'Do not add markdown code fences.',
    'Return JSON only with this exact schema:',
    '{"beforeText":"string","updatedText":"string","changeSummary":"string"}',
    '',
    'Draft context:',
    '---',
    draft,
    '---',
    '',
    'Instruction:',
    instruction,
  ].join('\n');
}

function buildAutonomousMultiPrompt(draft: string, instruction: string): string {
  return [
    'You are an expert inline editor for a storyboard document.',
    'The user is asking for a larger overhaul, not a single micro-edit.',
    'Choose the 2 or 3 most important passages in the draft that should be revised to satisfy the instruction.',
    'For each passage, rewrite only that passage while preserving the surrounding draft context.',
    'Do not overlap passages. Do not rewrite the full draft. Each proposal must target a distinct passage.',
    'Keep tone and meaning aligned with the full draft.',
    'Do not add markdown code fences.',
    'Return JSON only with this exact schema:',
    '{"proposals":[{"beforeText":"string","updatedText":"string","changeSummary":"string"}]}',
    'Return 2 to 3 proposals.',
    '',
    'Draft context:',
    '---',
    draft,
    '---',
    '',
    'Instruction:',
    instruction,
  ].join('\n');
}

type DraftParagraph = {
  text: string;
  start: number;
  end: number;
};

type SuggestedTarget = 'intro' | 'ending';

function getDraftParagraphs(draft: string): DraftParagraph[] {
  const chunks = draft
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    const trimmed = draft.trim();
    if (!trimmed) {
      return [];
    }
    const start = draft.indexOf(trimmed);
    if (start < 0) {
      return [];
    }
    return [{ text: trimmed, start, end: start + trimmed.length }];
  }

  const paragraphs: DraftParagraph[] = [];
  let cursor = 0;

  for (const chunk of chunks) {
    const start = draft.indexOf(chunk, cursor);
    if (start < 0) {
      continue;
    }
    paragraphs.push({ text: chunk, start, end: start + chunk.length });
    cursor = start + chunk.length;
  }

  return paragraphs;
}

function inferInstructionTargets(instruction: string): SuggestedTarget[] {
  const normalized = instruction.toLowerCase();
  const targets: SuggestedTarget[] = [];

  if (/\b(intro|introduction|opening|hook|start)\b/.test(normalized)) {
    targets.push('intro');
  }

  if (/\b(ending|end|conclusion|outro|closing|close|final section)\b/.test(normalized)) {
    targets.push('ending');
  }

  return targets;
}

function stripMetadataLeakage(value: string): string {
  return value
    .replace(/\s*\(\s*edited\s+intent\s*:[^)]+\)/gi, '')
    .replace(/^\s*edited\s+intent\s*:[^\n]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createDefaultRefinement(beforeText: string): string {
  const normalized = beforeText.replace(/\s+/g, ' ').trim();
  const softened = normalized
    .replace(/\b(very|really|just|basically|actually)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return softened || normalized;
}

function createTargetedFallbackProposals(
  draft: string,
  instruction: string,
): Array<{ beforeText: string; updatedText: string; changeSummary: string }> {
  const paragraphs = getDraftParagraphs(draft);
  if (paragraphs.length === 0) {
    return [];
  }

  const targets = inferInstructionTargets(instruction);
  const usedStarts = new Set<number>();
  const proposals: Array<{ beforeText: string; updatedText: string; changeSummary: string }> = [];

  const addProposal = (paragraph: DraftParagraph, summary: string) => {
    if (usedStarts.has(paragraph.start)) {
      return;
    }

    usedStarts.add(paragraph.start);
    proposals.push({
      beforeText: paragraph.text,
      updatedText: createDefaultRefinement(paragraph.text),
      changeSummary: summary,
    });
  };

  if (targets.includes('intro')) {
    addProposal(paragraphs[0], 'Refined intro passage to align with your instruction.');
  }

  if (targets.includes('ending')) {
    addProposal(paragraphs[paragraphs.length - 1], 'Refined ending passage to align with your instruction.');
  }

  if (proposals.length < 2 && paragraphs.length > 1) {
    addProposal(paragraphs[0], 'Refined opening passage from your instruction.');
    addProposal(paragraphs[paragraphs.length - 1], 'Refined closing passage from your instruction.');
  }

  return proposals.slice(0, 3);
}

function isMultiSuggestionInstruction(instruction: string): boolean {
  const normalized = instruction.toLowerCase();
  if (
    [
    'overhaul',
    'major rewrite',
    'major edit',
    'larger edit',
    'substantial',
    'restructure',
    'rework',
    'rewrite this section',
    'rewrite this draft',
    'refactor',
    'multiple edits',
    'several edits',
    ].some((term) => normalized.includes(term))
  ) {
    return true;
  }

  if (inferInstructionTargets(normalized).length >= 2) {
    return true;
  }

  return /(\band\b|,|\bplus\b|\bas well as\b)/.test(normalized) && /\b(change|edit|rewrite|update|revise|improve)\b/.test(normalized);
}

function normalizeProposalCandidate(raw: unknown): { beforeText: string; updatedText: string; changeSummary: string } | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as { beforeText?: unknown; updatedText?: unknown; changeSummary?: unknown };
  const beforeText = asString(candidate.beforeText);
  const updatedText = asString(candidate.updatedText);
  const changeSummary = asString(candidate.changeSummary);

  if (!beforeText || !updatedText) {
    return null;
  }

  return {
    beforeText,
    updatedText,
    changeSummary,
  };
}

function findDraftRange(draft: string, beforeText: string): { start: number; end: number } | null {
  const candidate = beforeText.trim();
  if (!candidate) {
    return null;
  }

  const start = draft.indexOf(candidate);
  if (start < 0) {
    return null;
  }

  return { start, end: start + candidate.length };
}

function getFallbackTarget(draft: string): string {
  const paragraphs = draft
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length > 0) {
    return paragraphs[0];
  }

  return draft.trim();
}

function createFallbackRewrite(
  draft: string,
  selectedText: string,
  instruction: string,
): { beforeText: string; afterText: string; summary: string } {
  const beforeText = (selectedText || getFallbackTarget(draft)).trim();
  const normalized = beforeText.replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ').filter(Boolean);
  const lowerInstruction = instruction.toLowerCase();

  if (lowerInstruction.includes('short') || lowerInstruction.includes('concise') || lowerInstruction.includes('trim')) {
    const shortened = words.slice(0, Math.max(8, Math.floor(words.length * 0.7))).join(' ');
    return {
      beforeText,
      afterText: shortened || normalized,
      summary: 'Fallback proposal: shortened selection for concision.',
    };
  }

  if (lowerInstruction.includes('bullet') || lowerInstruction.includes('list')) {
    const bulletized = normalized
      .split(/[.;!?]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 4)
      .map((part) => `- ${part}`)
      .join('\n');

    return {
      beforeText,
      afterText: bulletized || `- ${normalized}`,
      summary: 'Fallback proposal: converted selection into scannable bullet points.',
    };
  }

  return {
    beforeText,
    afterText: createDefaultRefinement(normalized),
    summary: 'Fallback proposal: provider unavailable, added an intent-preserving edit candidate.',
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<InlineEditResponse>> {
  let body: InlineEditRequestBody;

  try {
    body = (await request.json()) as InlineEditRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider;
  const apiKey = asString(body.apiKey);
  const ollamaBaseUrl = asString(body.ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = asString(body.ollamaModel) || DEFAULT_OLLAMA_MODEL;
  const draft = asString(body.draft);
  const selectedText = asString(body.selectedText);
  const selectionStart = typeof body.selectionStart === 'number' ? body.selectionStart : -1;
  const selectionEnd = typeof body.selectionEnd === 'number' ? body.selectionEnd : -1;
  const instruction = asString(body.instruction);

  if (!provider || !['openai', 'gemini', 'claude', 'ollama'].includes(provider)) {
    return NextResponse.json({ error: 'A valid provider is required.' }, { status: 400 });
  }

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
  }

  if (provider === 'ollama' && !ollamaModel.trim()) {
    return NextResponse.json({ error: 'Ollama model is required.' }, { status: 400 });
  }

  if (!draft) {
    return NextResponse.json({ error: 'Draft is required.' }, { status: 400 });
  }

  if (!instruction) {
    return NextResponse.json({ error: 'instruction is required.' }, { status: 400 });
  }

  const hasSelectedRange = Boolean(selectedText && selectionStart >= 0 && selectionEnd > selectionStart);
  const shouldReturnMultipleSuggestions = !hasSelectedRange && isMultiSuggestionInstruction(instruction);
  const prompt = hasSelectedRange
    ? buildSelectedTextPrompt(draft, selectedText, instruction)
    : shouldReturnMultipleSuggestions
      ? buildAutonomousMultiPrompt(draft, instruction)
      : buildAutonomousPrompt(draft, instruction);

  try {
    const messages: AIMessage[] = [
      { role: 'system', content: 'Return only valid JSON.' },
      { role: 'user', content: prompt },
    ];

    const raw = await callAI({
      provider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages,
      temperature: 0.2,
      maxTokens: 1200,
      tag: '[API Draft Inline Edit]',
    });

    const payloadText = extractJsonPayload(raw);
    if (!payloadText) {
      throw new Error('Model response did not contain JSON.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      throw new Error('Model returned malformed JSON.');
    }

    const normalizedProposals = hasSelectedRange
      ? [
          {
            beforeText: selectedText,
            updatedText: stripMetadataLeakage(asString((parsed as { updatedText?: unknown }).updatedText)),
            changeSummary: asString((parsed as { changeSummary?: unknown }).changeSummary),
          },
        ]
      : Array.isArray((parsed as { proposals?: unknown[] }).proposals)
        ? ((parsed as { proposals: unknown[] }).proposals)
            .map((entry) => normalizeProposalCandidate(entry))
            .map((entry) =>
              entry
                ? {
                    ...entry,
                    updatedText: stripMetadataLeakage(entry.updatedText),
                  }
                : null,
            )
            .filter((entry): entry is { beforeText: string; updatedText: string; changeSummary: string } => Boolean(entry))
        : [normalizeProposalCandidate(parsed)]
            .map((entry) =>
              entry
                ? {
                    ...entry,
                    updatedText: stripMetadataLeakage(entry.updatedText),
                  }
                : null,
            )
            .filter((entry): entry is { beforeText: string; updatedText: string; changeSummary: string } => Boolean(entry));

    const proposalsWithFallback =
      shouldReturnMultipleSuggestions && normalizedProposals.length < 2
        ? createTargetedFallbackProposals(draft, instruction)
        : normalizedProposals;

    if (proposalsWithFallback.length === 0 || proposalsWithFallback.some((entry) => !entry.updatedText)) {
      throw new Error('Inline edit response did not include updatedText.');
    }

    const resolvedProposals = proposalsWithFallback
      .map((entry) => {
        const resolvedRange = hasSelectedRange
          ? { start: selectionStart, end: selectionEnd }
          : findDraftRange(draft, entry.beforeText);

        if (!resolvedRange) {
          return null;
        }

        return {
          beforeText: entry.beforeText,
          afterText: entry.updatedText,
          changeSummary: entry.changeSummary || (hasSelectedRange ? 'Updated selected text.' : 'Refined a draft passage from your instruction.'),
          selectionStart: resolvedRange.start,
          selectionEnd: resolvedRange.end,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((left, right) => left.selectionStart - right.selectionStart);

    if (resolvedProposals.length === 0) {
      throw new Error('Unable to locate beforeText in draft for autonomous refinement.');
    }

    if (resolvedProposals.length === 1) {
      return NextResponse.json({
        proposal: resolvedProposals[0],
        provider,
      });
    }

    return NextResponse.json({
      proposals: resolvedProposals,
      provider,
    });
  } catch (error) {
    const fallback = createFallbackRewrite(draft, selectedText, instruction);
    const fallbackRange = findDraftRange(draft, fallback.beforeText);

    if (!fallbackRange) {
      return NextResponse.json(
        {
          error: 'Inline edit request failed and fallback could not locate a draft passage.',
          provider,
          fallback: true,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      proposal: {
        beforeText: fallback.beforeText,
        afterText: stripMetadataLeakage(fallback.afterText),
        changeSummary: fallback.summary,
        selectionStart: fallbackRange.start,
        selectionEnd: fallbackRange.end,
      },
      provider,
      fallback: true,
      error: error instanceof Error ? error.message : 'Inline edit request failed.',
    });
  }
}
