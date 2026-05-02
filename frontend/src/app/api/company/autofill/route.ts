import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';
import { isValidHttpUrl } from '@/lib/draftResearch';

type AutofillRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  websiteUrl?: string;
};

type AutofillProfile = {
  companyName: string;
  companyDescription: string;
  industry: string;
  products: string;
  services: string;
  valueProposition: string;
  targetMarket: string;
  keyDifferentiators: string;
  brandVoice: string;
};

type AutofillApiResponse = {
  profile?: AutofillProfile;
  fetchedUrls?: string[];
  provider?: string;
  error?: string;
};

const EMPTY_PROFILE: AutofillProfile = {
  companyName: '',
  companyDescription: '',
  industry: '',
  products: '',
  services: '',
  valueProposition: '',
  targetMarket: '',
  keyDifferentiators: '',
  brandVoice: '',
};

const SYSTEM_PROMPT = [
  'You are a research assistant that extracts a company profile from raw website text.',
  'You will be given the homepage text (and optionally an about-page) of a company.',
  'Your job is to fill in every field below using ONLY information you can ground in the provided text.',
  'If the text does not support a field, return an empty string for that field — do NOT invent facts.',
  'Be concise: 1-3 sentences per field is ideal. Do not copy long marketing prose verbatim.',
  '',
  'Return JSON only, with this exact shape (no code fences, no commentary):',
  '{',
  '  "companyName": "string",',
  '  "industry": "string (e.g. \'B2B SaaS for HR teams\', \'Specialty coffee retail\')",',
  '  "companyDescription": "string (1-2 sentences: what the company does and who it serves)",',
  '  "products": "string (comma-separated or short list of main products)",',
  '  "services": "string (comma-separated or short list of main services)",',
  '  "valueProposition": "string (the core promise to customers in 1 sentence)",',
  '  "targetMarket": "string (ideal customer segments, roles, sizes)",',
  '  "keyDifferentiators": "string (what sets them apart from competitors)",',
  '  "brandVoice": "string (tone and style cues observable in the copy: e.g. \'confident, plainspoken, technical\')"',
  '}',
].join('\n');

const FETCH_TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 14_000;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function htmlToText(html: string): string {
  // Drop script/style/noscript blocks and HTML comments before stripping tags.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(cleaned).replace(/\s+/g, ' ').trim();
}

function normalizeBaseUrl(input: string): string | null {
  let candidate = input.trim();
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  if (!isValidHttpUrl(candidate)) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketingDashboardCompanyAutofill/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProfile(value: unknown): AutofillProfile {
  if (!value || typeof value !== 'object') {
    return { ...EMPTY_PROFILE };
  }
  const candidate = value as Partial<Record<keyof AutofillProfile, unknown>>;
  return {
    companyName: asString(candidate.companyName),
    companyDescription: asString(candidate.companyDescription),
    industry: asString(candidate.industry),
    products: asString(candidate.products),
    services: asString(candidate.services),
    valueProposition: asString(candidate.valueProposition),
    targetMarket: asString(candidate.targetMarket),
    keyDifferentiators: asString(candidate.keyDifferentiators),
    brandVoice: asString(candidate.brandVoice),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<AutofillApiResponse>> {
  let body: AutofillRequestBody;
  try {
    body = (await request.json()) as AutofillRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const ollamaBaseUrl = typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = typeof body.ollamaModel === 'string' && body.ollamaModel.trim() ? body.ollamaModel.trim() : DEFAULT_OLLAMA_MODEL;

  const baseUrl = normalizeBaseUrl(typeof body.websiteUrl === 'string' ? body.websiteUrl : '');
  if (!baseUrl) {
    return NextResponse.json({ error: 'Provide a valid website URL (https://example.com).' }, { status: 400 });
  }
  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided. Configure your AI provider in Settings → AI API Keys.' }, { status: 400 });
  }

  // Fetch homepage and a best-effort about page in parallel.
  const aboutCandidate = (() => {
    try {
      return new URL('/about', baseUrl).toString();
    } catch {
      return null;
    }
  })();

  const [homepageHtml, aboutHtml] = await Promise.all([
    fetchPage(baseUrl),
    aboutCandidate ? fetchPage(aboutCandidate) : Promise.resolve(null),
  ]);

  if (!homepageHtml) {
    return NextResponse.json({ error: `Could not load ${baseUrl}. Check the URL and that the site is publicly reachable.` }, { status: 502 });
  }

  const fetchedUrls: string[] = [baseUrl];
  if (aboutHtml) fetchedUrls.push(aboutCandidate as string);

  const homepageText = htmlToText(homepageHtml);
  const aboutText = aboutHtml ? htmlToText(aboutHtml) : '';

  // Allocate roughly two-thirds of the budget to the homepage, the rest to about.
  const homepageBudget = aboutText ? Math.floor(MAX_TEXT_CHARS * 0.6) : MAX_TEXT_CHARS;
  const aboutBudget = MAX_TEXT_CHARS - homepageBudget;

  const homepageSlice = homepageText.slice(0, homepageBudget);
  const aboutSlice = aboutText.slice(0, aboutBudget);

  const userPrompt = [
    `Source URL: ${baseUrl}`,
    '',
    'Homepage text:',
    homepageSlice || '(empty)',
    aboutSlice ? '' : null,
    aboutSlice ? `About-page text (${aboutCandidate}):` : null,
    aboutSlice || null,
  ]
    .filter((line) => line !== null)
    .join('\n');

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
      maxTokens: 1200,
      tag: '[API Company Autofill]',
    });

    const parsed = safeJsonParse(raw);
    if (!parsed) {
      return NextResponse.json({ error: 'AI returned an unexpected format.' }, { status: 502 });
    }

    const profile = normalizeProfile(parsed);
    return NextResponse.json({ profile, fetchedUrls, provider });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error during autofill.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
