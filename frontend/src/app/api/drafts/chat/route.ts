import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';
import { fetchResearchSources, type ResearchSource } from '@/lib/draftResearch';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  exaApiKey?: string;
  draft?: string;
  messages?: ChatMessage[];
  userMessage?: string;
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

type ResearchLog = {
  provider: string;
  query: string;
  sourceCount: number;
};

type ChatApiResponse = {
  reply?: string;
  updatedDraft?: string | null;
  provider?: string;
  researchLog?: ResearchLog | null;
  error?: string;
};

function buildSystemPrompt(
  draft: string,
  companyContext: string[],
  researchSources: ResearchSource[],
  hasLiveSources: boolean,
): string {
  const companyBlock = companyContext.length > 0
    ? [
        '',
        'Company context (use to ground tone, product references, audience framing, and brand voice):',
        ...companyContext.map((line) => `- ${line}`),
      ]
    : [];

  const sourcesBlock: string[] = researchSources.length > 0
    ? [
        '',
        'Live research sources retrieved for this request — use these to ground any factual claims:',
        ...researchSources.flatMap((source, index) => [
          `- [${index + 1}] ${source.title}`,
          `  URL: ${source.url}`,
          `  Key excerpt: ${source.snippet || 'No excerpt available.'}`,
        ]),
      ]
    : [];

  const noSourcesBlock: string[] = !hasLiveSources
    ? [
        '',
        'CRITICAL — NO LIVE SOURCES AVAILABLE: Exa is not configured and no fallback sources were found.',
        'You MUST NOT invent statistics, URLs, studies, or specific data points.',
        'For every sentence that would normally cite an external fact, write an ALL-CAPS placeholder instead.',
        'Placeholder format: FIND [description of what to research] — SUGGESTED SOURCE: [publication or source type].',
        'Example: FIND THE CURRENT AVERAGE TWEET ENGAGEMENT RATE FOR B2B BRANDS — SUGGESTED SOURCE: SPROUT SOCIAL ANNUAL BENCHMARK REPORT.',
      ]
    : [];

  return [
    'You are a senior content editor and AI writing assistant.',
    'The user has a draft article and is asking for help editing or improving it.',
    ...companyBlock,
    ...sourcesBlock,
    ...noSourcesBlock,
    '',
    'Current draft:',
    '---',
    draft,
    '---',
    '',
    'IMPORTANT INSTRUCTIONS:',
    '- If the user asks you to modify, rewrite, shorten, expand, or improve the draft, provide the FULL updated draft wrapped EXACTLY in <UPDATED_DRAFT> and </UPDATED_DRAFT> tags.',
    '- Always include a brief conversational reply (2-4 sentences) explaining what you changed.',
    '- Place your explanation BEFORE the <UPDATED_DRAFT> block.',
    '- If the user is asking a question only (not asking you to edit), reply conversationally without any <UPDATED_DRAFT> tags.',
    '- Keep explanations concise.',
    ...(researchSources.length > 0
      ? [
          '',
          'CITATION RULES — mandatory for every <UPDATED_DRAFT> you produce when live research sources are present:',
          '- When you add or support a sentence using a live research source, embed the URL as an inline markdown link directly in that sentence.',
          '  Format: [descriptive anchor text](exact-url) — place it immediately after the quoted or paraphrased content, before the sentence punctuation.',
          '  Example: President Trump outlined the plan in a White House release ([Great Healthcare Plan](https://www.whitehouse.gov/articles/2026/01/president-trump-unveils...)).',
          '- Use the EXACT URL from the live research sources list above — do NOT shorten, guess, or invent URLs.',
          '- The <UPDATED_DRAFT> MUST include a "## Sources" section at the very end that lists every source you used.',
          '  Format per entry: "- [Source Title](exact-url)"',
          '- If the current draft already has a "## Sources" section, KEEP all existing entries and APPEND any newly cited sources — do not remove existing citations.',
          '- Do NOT omit the Sources section and do NOT leave the URL out of the inline link.',
        ]
      : []),
  ].join('\n');
}

function parseReply(raw: string): { reply: string; updatedDraft: string | null } {
  const match = raw.match(/<UPDATED_DRAFT>([\s\S]*?)<\/UPDATED_DRAFT>/);
  if (match) {
    const updatedDraft = match[1].trim();
    const reply = raw.replace(/<UPDATED_DRAFT>[\s\S]*?<\/UPDATED_DRAFT>/g, '').trim();
    return { reply: reply || 'I have updated your draft with the requested changes.', updatedDraft };
  }
  return { reply: raw.trim(), updatedDraft: null };
}

async function formulateExaQuery(
  draft: string,
  userMessage: string,
  provider: AIProvider,
  apiKey: string,
  ollamaBaseUrl: string,
  ollamaModel: string,
): Promise<string> {
  const draftPreview = draft.slice(0, 400).replace(/\s+/g, ' ').trim();
  const prompt = [
    'Generate a concise Exa search query (max 10 words) to find the best web source for this user request.',
    'Use the draft context to make the query specific, factual, and searchable.',
    '',
    `Draft context: ${draftPreview || '(empty)'}`,
    `User request: ${userMessage}`,
    '',
    'Return ONLY the search query string. No explanation, no quotes, no trailing punctuation.',
  ].join('\n');

  try {
    const raw = await callAI({
      provider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 30,
      tag: '[Query Formulation Chat]',
    });
    const query = raw.trim().replace(/^["']|["']$/g, '');
    return query || userMessage;
  } catch {
    return userMessage;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ChatApiResponse>> {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const exaApiKey = typeof body.exaApiKey === 'string' ? body.exaApiKey.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft : '';
  const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
  // 'research' is a UI-only role (teal Exa bubble) — strip it before sending to any LLM
  const history = Array.isArray(body.messages)
    ? body.messages.filter((m) => m.role === 'user' || m.role === 'assistant')
    : [];
  const ollamaBaseUrl =
    typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel =
    typeof body.ollamaModel === 'string' && body.ollamaModel.trim()
      ? body.ollamaModel.trim()
      : DEFAULT_OLLAMA_MODEL;
  const companyContext = normalizeContextLines(body.companyContext);

  if (!userMessage) {
    return NextResponse.json({ error: 'userMessage is required.' }, { status: 400 });
  }

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided.' }, { status: 400 });
  }

  // Step 1: AI formulates a focused Exa query from draft context + user intent
  // Step 2: fetch sources with that query
  // Step 3: main LLM call with sources injected (below)
  let researchSources: ResearchSource[] = [];
  let researchProvider = 'unavailable';
  let exaQuery = userMessage;

  if (exaApiKey) {
    // Step 1: LLM derives a specific, searchable query — not just the raw user message
    if (draft) {
      exaQuery = await formulateExaQuery(draft, userMessage, provider, apiKey, ollamaBaseUrl, ollamaModel);
      console.log(`[Query Formulation Chat] User intent: "${userMessage}" → Exa query: "${exaQuery}"`);
    }
    // Step 2: fetch Exa sources with the AI-formulated query
    try {
      const result = await fetchResearchSources(exaQuery, exaApiKey, 4);
      researchSources = result.sources;
      researchProvider = result.provider;
      if (researchProvider === 'exa') {
        console.log(`[Exa Chat Search] Query: "${exaQuery}" → ${researchSources.length} source${researchSources.length !== 1 ? 's' : ''} retrieved`);
      } else {
        console.log(`[Research Chat] Provider: ${researchProvider} | Query: "${exaQuery}" | Sources: ${researchSources.length}`);
      }
    } catch {
      console.warn(`[Research Chat] Source fetch failed for query: "${exaQuery}" — proceeding without sources`);
    }
  } else {
    console.log(`[Research Chat] No Exa key configured — skipping source search for: "${userMessage}". Draft will use ALL-CAPS placeholders for factual claims.`);
  }

  const hasLiveSources = researchSources.length > 0;
  const researchLog: ResearchLog = {
    provider: researchProvider,
    query: exaQuery,
    sourceCount: researchSources.length,
  };

  const systemPrompt = buildSystemPrompt(draft, companyContext, researchSources, hasLiveSources);

  try {
    const chatMessages: AIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m): AIMessage => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];
    const raw = await callAI({
      provider: provider as AIProvider,
      apiKey,
      ollamaBaseUrl,
      ollamaModel,
      messages: chatMessages,
      temperature: 0.4,
      maxTokens: 3000,
      tag: '[API Draft Chat]',
    });

    const { reply, updatedDraft } = parseReply(raw);
    return NextResponse.json({ reply, updatedDraft, provider, researchLog });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error during chat.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
