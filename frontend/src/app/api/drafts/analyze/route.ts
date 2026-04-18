import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type AnalyzeType = 'seo' | 'plagiarism' | 'sources';

type AnalyzeRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  draft?: string;
  type?: AnalyzeType;
};

export type SeoResult = {
  primaryKeyword: string;
  secondaryKeywords: string[];
  keywordDensity: number;
  readabilityScore: number;
  readabilityGrade: string;
  metaDescription: string;
  titleSuggestions: string[];
  optimizationTips: string[];
  similarArticleTopics: string[];
  wordCount: number;
};

export type PlagiarismResult = {
  aiLikelihoodScore: number;
  aiLikelihoodLabel: string;
  flaggedPhrases: Array<{ phrase: string; reason: string }>;
  humanizationTips: string[];
  originality: string;
  verdict: string;
};

export type SourcesResult = {
  claims: Array<{ claim: string; needsCitation: boolean; suggestedSearchQuery: string }>;
  relevanceScore: number;
  relevanceSummary: string;
  urlsFound: string[];
  recommendations: string[];
};

type AnalyzeApiResponse = {
  type?: AnalyzeType;
  result?: SeoResult | PlagiarismResult | SourcesResult;
  provider?: string;
  error?: string;
};

function buildSeoPrompt(draft: string): string {
  return [
    'You are an expert SEO analyst and content strategist.',
    'Analyze the following article draft for SEO optimization.',
    'Return ONLY valid JSON with no extra text, code fences, or explanation, matching this exact schema:',
    '{',
    '  "primaryKeyword": string,',
    '  "secondaryKeywords": string[],',
    '  "keywordDensity": number (0-100 percentage of primary keyword usage),',
    '  "readabilityScore": number (0-100, Flesch-Kincaid inspired),',
    '  "readabilityGrade": string (e.g. "Grade 8", "College Level"),',
    '  "metaDescription": string (150-160 characters, SEO optimized),',
    '  "titleSuggestions": string[] (3 SEO-optimized title options),',
    '  "optimizationTips": string[] (5-7 actionable tips),',
    '  "similarArticleTopics": string[] (5 topics similar articles rank for, used to suggest SEO coverage),',
    '  "wordCount": number',
    '}',
    '',
    'Draft to analyze:',
    draft,
  ].join('\n');
}

function buildPlagiarismPrompt(draft: string): string {
  return [
    'You are an expert content authenticity analyst specializing in detecting AI-generated text and potential plagiarism.',
    'Analyze the following content draft and return ONLY valid JSON with no extra text or code fences, matching this exact schema:',
    '{',
    '  "aiLikelihoodScore": number (0-100, where 100 = very likely AI-generated, 0 = definitely human-written),',
    '  "aiLikelihoodLabel": string (e.g. "Likely AI-generated", "Probably Human", "Mixed"),',
    '  "flaggedPhrases": [{ "phrase": string, "reason": string }] (phrases that pattern-match AI writing),',
    '  "humanizationTips": string[] (5 concrete tips to make the content sound more human),',
    '  "originality": string (brief summary of how original and unique the content appears),',
    '  "verdict": string (1-2 sentence overall assessment)',
    '}',
    '',
    'Draft to analyze:',
    draft,
  ].join('\n');
}

function buildSourcesPrompt(draft: string): string {
  return [
    'You are an expert fact-checker and content researcher.',
    'Analyze the following content draft for factual claims that need citations, source relevance, and information accuracy.',
    'Return ONLY valid JSON with no extra text or code fences, matching this exact schema:',
    '{',
    '  "claims": [{ "claim": string, "needsCitation": boolean, "suggestedSearchQuery": string }],',
    '  "relevanceScore": number (0-100, how relevant and on-topic the information is),',
    '  "relevanceSummary": string (brief summary of information quality and relevance),',
    '  "urlsFound": string[] (any URLs or links already present in the draft),',
    '  "recommendations": string[] (4-6 recommendations to improve sourcing and relevance)',
    '}',
    '',
    'Draft to analyze:',
    draft,
  ].join('\n');
}

function extractJsonPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]?.trim()) {
    return fencedMatch[1].trim();
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  return objectMatch?.[0] ?? null;
}

function parseAnalysisResult(raw: string): unknown {
  const jsonStr = extractJsonPayload(raw);
  if (!jsonStr) {
    throw new Error('AI did not return valid JSON for analysis.');
  }
  return JSON.parse(jsonStr);
}

async function runAI(
  provider: AIProvider,
  apiKey: string,
  ollamaBaseUrl: string,
  ollamaModel: string,
  prompt: string,
): Promise<string> {
  const messages: AIMessage[] = [
    { role: 'system', content: 'Return only valid JSON as instructed. No extra text.' },
    { role: 'user', content: prompt },
  ];
  return callAI({
    provider,
    apiKey,
    ollamaBaseUrl,
    ollamaModel,
    messages,
    temperature: 0.2,
    maxTokens: 1500,
    tag: '[API Draft Analyze]',
  });
}

export async function POST(request: NextRequest): Promise<NextResponse<AnalyzeApiResponse>> {
  let body: AnalyzeRequestBody;
  try {
    body = (await request.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  const type = body.type;
  const ollamaBaseUrl =
    typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel =
    typeof body.ollamaModel === 'string' && body.ollamaModel.trim()
      ? body.ollamaModel.trim()
      : DEFAULT_OLLAMA_MODEL;

  if (!draft) {
    return NextResponse.json({ error: 'draft is required.' }, { status: 400 });
  }

  if (!type || !['seo', 'plagiarism', 'sources'].includes(type)) {
    return NextResponse.json(
      { error: 'type must be one of: seo, plagiarism, sources.' },
      { status: 400 },
    );
  }

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided.' }, { status: 400 });
  }

  let prompt: string;
  if (type === 'seo') {
    prompt = buildSeoPrompt(draft);
  } else if (type === 'plagiarism') {
    prompt = buildPlagiarismPrompt(draft);
  } else {
    prompt = buildSourcesPrompt(draft);
  }

  try {
    const raw = await runAI(provider, apiKey, ollamaBaseUrl, ollamaModel, prompt);
    const result = parseAnalysisResult(raw);
    return NextResponse.json({ type, result: result as SeoResult | PlagiarismResult | SourcesResult, provider });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error during analysis.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
