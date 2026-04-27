import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type PlagiarismRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  draft?: string;
};

type PlagiarismFlag = {
  passage: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  suggestedRewrite?: string;
  likelySource?: string;
};

type PlagiarismApiResponse = {
  flags?: PlagiarismFlag[];
  riskScore?: number;
  webMatches?: Array<{ passage: string; matchUrl: string; matchTitle: string; snippet: string }>;
  verdict?: 'clean' | 'review-needed' | 'high-risk';
  provider?: string;
  error?: string;
};

const SYSTEM_PROMPT = [
  'You are a plagiarism reviewer for an editorial team.',
  'Identify passages that are likely lifted directly from a known source, are generic boilerplate, contain unattributed factual claims, or repeat phrasing that appears verbatim in widely-published material.',
  'Be conservative: only flag passages with reasonable suspicion. Original phrasing is fine.',
  'For each flag, ALWAYS include a "suggestedRewrite" — a fully-rewritten replacement of the flagged passage that preserves the original meaning while clearly being original phrasing. The suggested rewrite must be a drop-in replacement: same approximate length, same factual content, no new claims.',
  'For "likelySource", prefer a real URL when one is provided in the user message under "Web search returned exact-quote matches". Otherwise describe the likely source (e.g. "common stat repeated by Gartner blog posts").',
  'The "passage" field MUST be copied verbatim from the draft — no paraphrasing, no added quotation marks beyond what already exists in the source — so the editor can locate it for one-click replacement.',
  'Return JSON only:',
  '{',
  '  "flags": [',
  '    {',
  '      "passage": "string (verbatim 1-3 sentence excerpt from the draft)",',
  '      "reason": "string (why it looks unoriginal)",',
  '      "severity": "low" | "medium" | "high",',
  '      "suggestedRewrite": "string (REQUIRED — drop-in original rewrite of the passage)",',
  '      "likelySource": "string (optional URL or descriptor)"',
  '    }',
  '  ],',
  '  "riskScore": 0-100,',
  '  "verdict": "clean" | "review-needed" | "high-risk"',
  '}',
  'No code fences, no extra prose.',
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

function pickSeverity(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return 'low';
}

function pickVerdict(value: unknown): 'clean' | 'review-needed' | 'high-risk' {
  if (value === 'clean' || value === 'review-needed' || value === 'high-risk') {
    return value;
  }
  return 'review-needed';
}

function pickWindowSentences(draft: string, maxLength = 220): string[] {
  const sentences = draft
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 60 && sentence.length <= maxLength)
    .filter((sentence) => !/^#{1,6}\s/.test(sentence) && !/^\s*[-*+]/.test(sentence) && !/https?:\/\//.test(sentence));

  // Take a stable, evenly-spaced sample so the search list stays small.
  if (sentences.length <= 4) {
    return sentences;
  }
  const indexes = [0, Math.floor(sentences.length / 3), Math.floor((2 * sentences.length) / 3), sentences.length - 1];
  return [...new Set(indexes.map((index) => sentences[index]).filter(Boolean))];
}

async function searchPassageOnTheWeb(passage: string): Promise<{ matchUrl: string; matchTitle: string; snippet: string } | null> {
  try {
    const trimmed = passage.length > 180 ? passage.slice(0, 180) : passage;
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(`"${trimmed}"`)}&format=json&no_redirect=1&no_html=1&t=marketing-dashboard`;
    const response = await fetch(url, { headers: { 'User-Agent': 'MarketingDashboard/1.0 (+plagiarism-check)' } });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as {
      AbstractURL?: string;
      Heading?: string;
      AbstractText?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    if (data.AbstractURL && data.AbstractText) {
      return { matchUrl: data.AbstractURL, matchTitle: data.Heading || data.AbstractURL, snippet: data.AbstractText };
    }
    const first = (data.RelatedTopics ?? []).find((entry) => entry.FirstURL && entry.Text);
    if (first?.FirstURL && first?.Text) {
      const titleEnd = first.Text.indexOf(' - ');
      const matchTitle = titleEnd > 0 ? first.Text.slice(0, titleEnd) : first.Text;
      const snippet = titleEnd > 0 ? first.Text.slice(titleEnd + 3) : first.Text;
      return { matchUrl: first.FirstURL, matchTitle, snippet };
    }
  } catch {
    return null;
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse<PlagiarismApiResponse>> {
  let body: PlagiarismRequestBody;
  try {
    body = (await request.json()) as PlagiarismRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft.trim() : '';
  const ollamaBaseUrl = typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : DEFAULT_OLLAMA_MODEL;

  if (!draft) {
    return NextResponse.json({ error: 'Draft text is required.' }, { status: 400 });
  }
  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided.' }, { status: 400 });
  }

  const samplePassages = pickWindowSentences(draft);
  const webMatchPromises = samplePassages.map(async (passage) => {
    const match = await searchPassageOnTheWeb(passage);
    if (!match) {
      return null;
    }
    return { passage, ...match };
  });
  const webMatches = (await Promise.all(webMatchPromises)).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const userPrompt = [
    'Draft to review:',
    '---',
    draft.length > 8000 ? `${draft.slice(0, 8000)}\n…(truncated)` : draft,
    '---',
    '',
    webMatches.length > 0
      ? [
          'Web search returned exact-quote matches for the following passages:',
          ...webMatches.map((entry, index) => `(${index + 1}) Passage: "${entry.passage}"\n    Match: ${entry.matchTitle}\n    URL: ${entry.matchUrl}\n    Snippet: ${entry.snippet}`),
          '',
          'Treat each of these passages as high severity unless the source is the user\'s own site.',
        ].join('\n')
      : 'No live exact-quote web matches were found. Continue with heuristic review.',
  ].join('\n');

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
      temperature: 0.2,
      maxTokens: 2000,
      tag: '[API Draft Plagiarism]',
    });

    const parsed = safeJsonParse(raw) as { flags?: unknown; riskScore?: unknown; verdict?: unknown } | null;
    if (!parsed) {
      return NextResponse.json({ error: 'AI returned an unexpected format.' }, { status: 502 });
    }

    const webMatchByPassage = new Map<string, (typeof webMatches)[number]>();
    for (const match of webMatches) {
      webMatchByPassage.set(match.passage, match);
    }

    const flags: PlagiarismFlag[] = Array.isArray(parsed.flags)
      ? (parsed.flags as Array<Record<string, unknown>>)
          .map((entry): PlagiarismFlag | null => {
            const passage = typeof entry.passage === 'string' ? entry.passage.trim() : '';
            if (!passage) return null;
            const next: PlagiarismFlag = {
              passage,
              reason: typeof entry.reason === 'string' ? entry.reason : '',
              severity: pickSeverity(entry.severity),
            };
            if (typeof entry.suggestedRewrite === 'string' && entry.suggestedRewrite.trim()) {
              next.suggestedRewrite = entry.suggestedRewrite.trim();
            }
            if (typeof entry.likelySource === 'string' && entry.likelySource.trim()) {
              next.likelySource = entry.likelySource.trim();
            }
            // If we already have a verified web match for this passage, ensure the URL is in likelySource so the UI can render it as a clickable link.
            const matched = webMatchByPassage.get(passage);
            if (matched && (!next.likelySource || !/https?:\/\//i.test(next.likelySource))) {
              next.likelySource = `${matched.matchTitle} (${matched.matchUrl})`;
            }
            return next;
          })
          .filter((entry): entry is PlagiarismFlag => entry !== null)
      : [];

    // Surface any verified web matches that the AI did not flag itself, so the user still sees them as actionable.
    for (const match of webMatches) {
      const alreadyFlagged = flags.some((flag) => flag.passage === match.passage);
      if (!alreadyFlagged) {
        flags.push({
          passage: match.passage,
          reason: 'Exact-quote match found via live web search.',
          severity: 'high',
          likelySource: `${match.matchTitle} (${match.matchUrl})`,
        });
      }
    }

    const riskScore = (() => {
      if (typeof parsed.riskScore === 'number' && Number.isFinite(parsed.riskScore)) {
        return Math.max(0, Math.min(100, Math.round(parsed.riskScore)));
      }
      return Math.min(100, flags.length * 25 + webMatches.length * 20);
    })();

    let verdict = pickVerdict(parsed.verdict);
    if (webMatches.length > 0) {
      verdict = 'high-risk';
    }
    if (flags.length === 0 && webMatches.length === 0 && verdict !== 'clean') {
      verdict = 'clean';
    }

    return NextResponse.json({
      flags,
      riskScore,
      webMatches,
      verdict,
      provider,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error during plagiarism check.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
