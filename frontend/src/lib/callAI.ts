import type { AIProvider } from './aiConfig';

// ─── Public types ─────────────────────────────────────────────────────────────

export type AIMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type CallAIParams = {
  provider: AIProvider;
  apiKey: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  /** All messages, including an optional system message as the first item. */
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Label shown in every console.debug line, e.g. '[API Angles]'.
   * Defaults to '[callAI]' when omitted.
   */
  tag?: string;
};

// ─── Shared constants ─────────────────────────────────────────────────────────

export const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-latest',
] as const;

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'gemma4';

// ─── Debug logging ────────────────────────────────────────────────────────────

/**
 * Logs the full message array to the server console BEFORE the AI call.
 * Visible in the Next.js dev-server terminal (and in `next start` output).
 */
function debugPrompt(
  tag: string,
  provider: AIProvider,
  model: string,
  messages: AIMessage[],
): void {
  console.debug(`${tag} ▶ callAI PROMPT → ${provider}/${model} (${messages.length} msg)`);
  for (const msg of messages) {
    const preview = msg.content.length > 2000
      ? `${msg.content.slice(0, 2000)}… [truncated ${msg.content.length - 2000} chars]`
      : msg.content;
    console.debug(`${tag}   [${msg.role.toUpperCase()}]\n${preview}`);
  }
}

/**
 * Logs the raw provider response to the server console AFTER the AI call.
 */
function debugResponse(
  tag: string,
  provider: AIProvider,
  model: string,
  text: string,
): void {
  console.debug(`${tag} ◀ callAI RESPONSE ← ${provider}/${model} (${text.length} chars)`);
  const preview = text.length > 3000
    ? `${text.slice(0, 3000)}… [truncated ${text.length - 3000} chars]`
    : text;
  console.debug(`${tag}   ${preview}`);
}

// ─── Provider implementations ─────────────────────────────────────────────────

async function callOpenAI(params: CallAIParams): Promise<string> {
  const model = 'gpt-4o-mini';
  const tag = params.tag ?? '[callAI]';
  debugPrompt(tag, 'openai', model, params.messages);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.4,
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const result = payload.choices?.[0]?.message?.content?.trim() ?? '';
  debugResponse(tag, 'openai', model, result);
  return result;
}

async function callGemini(params: CallAIParams): Promise<string> {
  const tag = params.tag ?? '[callAI]';
  const systemMsg = params.messages.find((m) => m.role === 'system');
  const conversationMsgs = params.messages.filter((m) => m.role !== 'system');
  let lastError = 'Unknown Gemini error.';

  for (const model of GEMINI_MODELS) {
    debugPrompt(tag, 'gemini', model, params.messages);

    const requestBody: Record<string, unknown> = {
      contents: conversationMsgs.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: params.temperature ?? 0.4 },
    };

    if (systemMsg) {
      requestBody.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(params.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    );

    if (response.ok) {
      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      const result = parts.map((p) => p.text ?? '').join('\n').trim();
      debugResponse(tag, 'gemini', model, result);
      return result;
    }

    const details = await response.text();
    lastError = `Gemini request failed for model ${model} (${response.status}): ${details}`;
    if (response.status !== 404) {
      throw new Error(lastError);
    }
  }

  throw new Error(`Gemini request failed for all configured models: ${lastError}`);
}

async function callClaude(params: CallAIParams): Promise<string> {
  const model = 'claude-3-5-haiku-latest';
  const tag = params.tag ?? '[callAI]';
  debugPrompt(tag, 'claude', model, params.messages);

  const systemMsg = params.messages.find((m) => m.role === 'system');
  const conversationMsgs = params.messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    model,
    max_tokens: params.maxTokens ?? 2400,
    temperature: params.temperature ?? 0.4,
    messages: conversationMsgs.map((m) => ({ role: m.role, content: m.content })),
  };

  if (systemMsg) {
    body.system = systemMsg.content;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Claude request failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const result = payload.content?.find((b) => b.type === 'text')?.text?.trim() ?? '';
  debugResponse(tag, 'claude', model, result);
  return result;
}

async function callOllama(params: CallAIParams): Promise<string> {
  const baseUrl = (params.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, '');
  const model = params.ollamaModel ?? DEFAULT_OLLAMA_MODEL;
  const tag = params.tag ?? '[callAI]';
  debugPrompt(tag, 'ollama', model, params.messages);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as {
    message?: { content?: string };
    error?: string;
  };

  if (payload.error) {
    throw new Error(`Ollama request failed: ${payload.error}`);
  }

  const result = payload.message?.content?.trim() ?? '';
  debugResponse(tag, 'ollama', model, result);
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Unified AI caller — the ONLY place that should talk directly to provider APIs.
 *
 * Every call automatically:
 *  1. console.debug logs the full messages array (prompt) before sending
 *  2. console.debug logs the full raw response after receiving
 *
 * Usage in any API route:
 *
 *   import { callAI, type AIMessage } from '@/lib/callAI';
 *
 *   const raw = await callAI({
 *     provider, apiKey, ollamaBaseUrl, ollamaModel,
 *     messages: [
 *       { role: 'system', content: 'You are ...' },
 *       { role: 'user',   content: userPrompt },
 *     ],
 *     temperature: 0.4,
 *     tag: '[API MyRoute]',
 *   });
 *
 * Logs appear in the Next.js dev-server terminal (not in the browser console,
 * since API routes run server-side).
 */
export async function callAI(params: CallAIParams): Promise<string> {
  switch (params.provider) {
    case 'openai':  return callOpenAI(params);
    case 'gemini':  return callGemini(params);
    case 'claude':  return callClaude(params);
    case 'ollama':  return callOllama(params);
    default: throw new Error(`Unknown AI provider: ${String(params.provider)}`);
  }
}
