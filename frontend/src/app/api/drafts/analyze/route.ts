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
  platform?: string;
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

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'we',
  'with',
  'you',
  'your',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitSentences(draft: string): string[] {
  return normalizeWhitespace(draft)
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function tokenizeWords(draft: string): string[] {
  return draft.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
}

function getMeaningfulWords(draft: string): string[] {
  return tokenizeWords(draft).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function getRankedKeywords(draft: string): string[] {
  const counts = new Map<string, { count: number; firstIndex: number }>();
  const words = getMeaningfulWords(draft);

  words.forEach((word, index) => {
    const existing = counts.get(word);
    if (existing) {
      existing.count += 1;
      return;
    }
    counts.set(word, { count: 1, firstIndex: index });
  });

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1].count !== a[1].count) {
        return b[1].count - a[1].count;
      }
      return a[1].firstIndex - b[1].firstIndex;
    })
    .map(([word]) => word);
}

function countOccurrences(words: string[], target: string): number {
  return words.filter((word) => word === target).length;
}

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleaned) return 1;

  const groups = cleaned.match(/[aeiouy]+/g);
  const syllableCount = groups?.length ?? 1;
  return cleaned.endsWith('e') && syllableCount > 1 ? syllableCount - 1 : syllableCount;
}

function getReadabilityGrade(score: number): string {
  if (score >= 90) return 'Grade 5';
  if (score >= 80) return 'Grade 6';
  if (score >= 70) return 'Grade 8';
  if (score >= 60) return 'Grade 10';
  if (score >= 50) return 'Grade 12';
  return 'College Level';
}

function buildMetaDescription(draft: string, primaryKeyword: string): string {
  const cleaned = normalizeWhitespace(draft).replace(/\s+([,.;!?])/g, '$1');
  const base = cleaned || `Practical insights about ${primaryKeyword}.`;
  const withLead = base.toLowerCase().includes(primaryKeyword.toLowerCase())
    ? base
    : `${primaryKeyword}: ${base}`;

  return withLead.length <= 160 ? withLead : `${withLead.slice(0, 157).trimEnd()}...`;
}

function extractUrls(draft: string): string[] {
  const matches = draft.match(/https?:\/\/[^\s)]+/gi) ?? [];
  return [...new Set(matches)];
}

function buildSearchQuery(sentence: string): string {
  const keywords = getRankedKeywords(sentence).slice(0, 6);
  return keywords.join(' ') || sentence.slice(0, 80).trim();
}

function buildSeoFallback(draft: string): SeoResult {
  const normalizedDraft = normalizeWhitespace(draft);
  const words = tokenizeWords(draft);
  const sentences = splitSentences(draft);
  const rankedKeywords = getRankedKeywords(draft);
  const primaryKeyword = rankedKeywords[0] ?? 'content';
  const secondaryKeywords = rankedKeywords.slice(1, 5);
  const wordCount = words.length;
  const avgSentenceLength = wordCount / Math.max(sentences.length, 1);
  const avgSyllables =
    words.reduce((sum, word) => sum + countSyllables(word), 0) / Math.max(wordCount, 1);
  const keywordDensity = Number(
    ((countOccurrences(words, primaryKeyword) / Math.max(wordCount, 1)) * 100).toFixed(1),
  );
  const readabilityScore = clamp(
    Math.round(115 - avgSentenceLength * 1.6 - avgSyllables * 12),
    20,
    95,
  );
  const titleBase = primaryKeyword.replace(/\b\w/g, (char) => char.toUpperCase());
  const supportingKeyword = secondaryKeywords[0] ?? 'strategy';
  const supportingTitle = supportingKeyword.replace(/\b\w/g, (char) => char.toUpperCase());
  const optimizationTips = [
    wordCount < 150
      ? 'Expand the draft with one or two concrete examples so search intent is covered more completely.'
      : 'Break the copy into scannable sections so readers can find the main idea faster.',
    keywordDensity < 0.8
      ? `Repeat "${primaryKeyword}" naturally in one or two additional places to reinforce topic focus.`
      : `Reduce repeated uses of "${primaryKeyword}" slightly to keep the copy sounding natural.`,
    avgSentenceLength > 22
      ? 'Shorten a few long sentences to improve readability for skim readers.'
      : 'Keep the short-sentence rhythm and add one stronger subheading or hook for structure.',
    normalizedDraft.includes('?')
      ? 'Turn the strongest question into a heading so it can double as a search-friendly subtopic.'
      : 'Add one question-led subheading to capture problem-aware search queries.',
    secondaryKeywords.length > 0
      ? `Work in related terms like ${secondaryKeywords.slice(0, 3).join(', ')} to broaden semantic coverage.`
      : 'Introduce two or three closely related terms so the page covers adjacent search phrases.',
  ];

  return {
    primaryKeyword,
    secondaryKeywords,
    keywordDensity,
    readabilityScore,
    readabilityGrade: getReadabilityGrade(readabilityScore),
    metaDescription: buildMetaDescription(draft, primaryKeyword),
    titleSuggestions: [
      `${titleBase}: Practical Takeaways for Marketers`,
      `How ${titleBase} Shapes Better ${supportingTitle} Decisions`,
      `${titleBase} Guide: What to Know Before You Publish`,
    ],
    optimizationTips,
    similarArticleTopics: [
      `${titleBase} best practices`,
      `${titleBase} examples`,
      `${titleBase} checklist`,
      `${supportingTitle} strategy tips`,
      `${titleBase} mistakes to avoid`,
    ],
    wordCount,
  };
}

function buildPlagiarismFallback(draft: string): PlagiarismResult {
  const sentences = splitSentences(draft);
  const words = tokenizeWords(draft);
  const meaningfulWords = getMeaningfulWords(draft);
  const uniqueWords = new Set(meaningfulWords);
  const uniqueRatio = uniqueWords.size / Math.max(meaningfulWords.length, 1);
  const sentenceLengths = sentences.map((sentence) => tokenizeWords(sentence).length);
  const averageSentenceLength =
    sentenceLengths.reduce((sum, count) => sum + count, 0) / Math.max(sentenceLengths.length, 1);
  const variance =
    sentenceLengths.reduce((sum, count) => sum + Math.pow(count - averageSentenceLength, 2), 0) /
    Math.max(sentenceLengths.length, 1);
  const transitionPatterns = [
    'in conclusion',
    'moreover',
    'furthermore',
    'additionally',
    'overall',
    'it is important to note',
    'in today',
    'whether you',
  ];
  const matchedTransitions = transitionPatterns.filter((phrase) =>
    draft.toLowerCase().includes(phrase),
  );
  const repetitionPenalty = Math.round((1 - uniqueRatio) * 45);
  const uniformityPenalty = variance < 20 ? 14 : variance < 45 ? 8 : 3;
  const transitionPenalty = matchedTransitions.length * 6;
  const aiLikelihoodScore = clamp(24 + repetitionPenalty + uniformityPenalty + transitionPenalty, 8, 92);
  const aiLikelihoodLabel =
    aiLikelihoodScore >= 70
      ? 'Heuristic pattern match suggests higher AI-like structure'
      : aiLikelihoodScore >= 45
        ? 'Heuristic review found a mixed human/AI pattern'
        : 'Heuristic review leans more human-written';

  const flaggedPhrases = matchedTransitions.slice(0, 3).map((phrase) => ({
    phrase,
    reason: 'Common transition phrase that often appears in polished, template-like AI copy.',
  }));

  if (flaggedPhrases.length === 0 && sentences[0]) {
    flaggedPhrases.push({
      phrase: sentences[0].split(/\s+/).slice(0, 8).join(' '),
      reason: 'Opening sentence is being highlighted as a heuristic sample for tone and cadence review.',
    });
  }

  return {
    aiLikelihoodScore,
    aiLikelihoodLabel,
    flaggedPhrases,
    humanizationTips: [
      'Add one specific anecdote, internal metric, or lived example that only your team would mention.',
      averageSentenceLength > 22
        ? 'Vary sentence length more aggressively so the rhythm feels less uniform.'
        : 'Keep mixing short and medium-length sentences so the cadence stays natural.',
      words.some((word) => /\d/.test(word))
        ? 'Attribute each number to a named source so factual details sound grounded rather than generic.'
        : 'Include one concrete number or time-bound example to make the copy sound less generalized.',
      matchedTransitions.length > 0
        ? 'Replace polished bridge phrases like "moreover" or "overall" with plainer transitions.'
        : 'Swap one or two polished phrases for language that matches how your audience actually speaks.',
      'Read the draft aloud and rewrite any line that sounds too symmetrical or overly tidy.',
    ],
    originality: `Deterministic fallback review found ${uniqueWords.size} unique meaningful words across ${meaningfulWords.length} keyword-bearing words, which suggests ${
      uniqueRatio >= 0.55 ? 'moderate lexical variety.' : 'heavier repetition than a strongly distinctive draft.'
    }`,
    verdict:
      'This AI Check result is a deterministic heuristic because no external AI key is configured. Review the flagged phrases and humanization tips against the active platform copy before publishing.',
  };
}

function buildSourcesFallback(draft: string): SourcesResult {
  const sentences = splitSentences(draft);
  const urlsFound = extractUrls(draft);
  const claimCandidates = sentences.filter((sentence) =>
    /\d|%|\baccording to\b|\bstudy\b|\breport\b|\bdata\b|\bresearch\b|\bstat\b|\bincrease\b|\bdecrease\b|\bgrowth\b/i.test(
      sentence,
    ),
  );
  const fallbackClaims = claimCandidates.length > 0 ? claimCandidates : sentences.slice(0, 3);
  const claims = fallbackClaims.slice(0, 4).map((sentence) => {
    const trimmedSentence = sentence.trim();
    const needsCitation =
      /\d|%|\baccording to\b|\bstudy\b|\breport\b|\bdata\b|\bresearch\b|\bstat\b/i.test(trimmedSentence);

    return {
      claim: trimmedSentence,
      needsCitation,
      suggestedSearchQuery: buildSearchQuery(trimmedSentence),
    };
  });

  const rankedKeywords = getRankedKeywords(draft);
  const topKeywordCount = rankedKeywords
    .slice(0, 3)
    .reduce((sum, keyword) => sum + countOccurrences(tokenizeWords(draft), keyword), 0);
  const relevanceScore = clamp(
    52 + Math.round((topKeywordCount / Math.max(tokenizeWords(draft).length, 1)) * 220) + Math.min(claims.length * 4, 16),
    35,
    96,
  );

  return {
    claims,
    relevanceScore,
    relevanceSummary:
      urlsFound.length > 0
        ? 'The draft stays on topic and already includes at least one URL, but factual claims should still be checked against primary sources.'
        : 'The draft appears topically focused, but it does not include linked evidence yet, so source support will need to be added manually.',
    urlsFound,
    recommendations: [
      claims.some((claim) => claim.needsCitation)
        ? 'Add citations or links for any statistics, percentages, or named research claims.'
        : 'Add at least one authoritative citation to strengthen trust for readers and reviewers.',
      urlsFound.length === 0
        ? 'Link to a primary source, product page, report, or documentation page directly in the copy.'
        : 'Verify that each included URL points to the original source rather than a secondary summary.',
      'Use author names, publication dates, or organization names when referencing research.',
      'Check whether the strongest claim in the opening section can be backed by a recent source.',
      'If the platform version is short, keep claims narrow so every statement can be verified quickly.',
    ],
  };
}

function buildFallbackResult(type: AnalyzeType, draft: string): SeoResult | PlagiarismResult | SourcesResult {
  if (type === 'seo') {
    return buildSeoFallback(draft);
  }
  if (type === 'plagiarism') {
    return buildPlagiarismFallback(draft);
  }
  return buildSourcesFallback(draft);
}

function buildSeoPrompt(draft: string, platform?: string, companyContext: string[] = []): string {
  const normalizedPlatform = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
  const platformContext = normalizedPlatform
    ? `Prioritize SEO recommendations appropriate for this publishing channel: ${normalizedPlatform}.`
    : 'Use general web-article SEO best practices.';

  const companyBlock = companyContext.length > 0
    ? [
        '',
        'Company context (use to tailor primary/secondary keywords, meta description, and title suggestions to this company\'s product, industry, and audience):',
        ...companyContext.map((line) => `- ${line}`),
      ]
    : [];

  return [
    'You are an expert SEO analyst and content strategist.',
    'Analyze the following article draft for SEO optimization.',
    platformContext,
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
    ...companyBlock,
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
  const platform = typeof body.platform === 'string' ? body.platform.trim() : '';
  const ollamaBaseUrl =
    typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel =
    typeof body.ollamaModel === 'string' && body.ollamaModel.trim()
      ? body.ollamaModel.trim()
      : DEFAULT_OLLAMA_MODEL;
  const companyContext = normalizeContextLines(body.companyContext);

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
    return NextResponse.json({
      type,
      result: buildFallbackResult(type, draft),
      provider,
    });
  }

  let prompt: string;
  if (type === 'seo') {
    prompt = buildSeoPrompt(draft, platform, companyContext);
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
