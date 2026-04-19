import { NextRequest, NextResponse } from 'next/server';

import type { AIProvider } from '@/lib/aiConfig';
import { callAI, type AIMessage, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '@/lib/callAI';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatRequestBody = {
  provider?: AIProvider;
  apiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  draft?: string;
  messages?: ChatMessage[];
  userMessage?: string;
};

type ChatApiResponse = {
  reply?: string;
  updatedDraft?: string | null;
  provider?: string;
  error?: string;
};

function buildSystemPrompt(draft: string): string {
  return [
    'You are a senior content editor and AI writing assistant.',
    'The user has a draft article and is asking for help editing or improving it.',
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

export async function POST(request: NextRequest): Promise<NextResponse<ChatApiResponse>> {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const provider = body.provider ?? 'openai';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const draft = typeof body.draft === 'string' ? body.draft : '';
  const userMessage = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
  const history = Array.isArray(body.messages) ? body.messages : [];
  const ollamaBaseUrl =
    typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl.trim() : DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel =
    typeof body.ollamaModel === 'string' && body.ollamaModel.trim()
      ? body.ollamaModel.trim()
      : DEFAULT_OLLAMA_MODEL;

  if (!userMessage) {
    return NextResponse.json({ error: 'userMessage is required.' }, { status: 400 });
  }

  if (provider !== 'ollama' && !apiKey) {
    return NextResponse.json({ error: 'No API key provided.' }, { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(draft);

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
    return NextResponse.json({ reply, updatedDraft, provider });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error during chat.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
