'use client';

import Link from 'next/link';

import { Spinner } from '@/components/Spinner';

export type DraftChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type DraftChatPanelProps = {
  title: string;
  helperText: string;
  providerLabel: string | null;
  messages: DraftChatMessage[];
  inputValue: string;
  onInputChange: (next: string) => void;
  onSend: () => void;
  isSending: boolean;
  error: string | null;
  pendingDiffCount?: number;
  hasApiKeyConfigured?: boolean;
  toneSuggestions?: Array<{ label: string; prompt: string }>;
  onApplyToneSuggestion?: (prompt: string) => void;
};

function formatMessagePreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 260) {
    return normalized;
  }
  return `${normalized.slice(0, 259)}...`;
}

export function DraftChatPanel(props: DraftChatPanelProps) {
  const {
    title,
    helperText,
    providerLabel,
    messages,
    inputValue,
    onInputChange,
    onSend,
    isSending,
    error,
    pendingDiffCount = 0,
    hasApiKeyConfigured = true,
    toneSuggestions = [],
    onApplyToneSuggestion,
  } = props;

  const hasMessages = messages.length > 0;
  const sendDisabled = isSending || !inputValue.trim() || !hasApiKeyConfigured;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{helperText}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {providerLabel ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{providerLabel}</span>
          ) : null}
          {!hasApiKeyConfigured ? (
            <Link
              href="/settings"
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-200"
            >
              Configure key →
            </Link>
          ) : null}
        </div>
      </div>

      {!hasApiKeyConfigured ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">No AI API key configured.</p>
          <p>
            Add a provider key in{' '}
            <Link href="/settings" className="font-semibold underline">
              Settings
            </Link>{' '}
            to enable iterative chat editing. The Send button stays disabled until a key is saved.
          </p>
        </div>
      ) : null}

      {toneSuggestions.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1">
          {toneSuggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
              onClick={() => onApplyToneSuggestion?.(suggestion.prompt)}
              disabled={!onApplyToneSuggestion}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-3 max-h-52 space-y-2 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
        {hasMessages ? (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                message.role === 'assistant' ? 'bg-white text-slate-700' : 'bg-emerald-100 text-emerald-900'
              }`}
            >
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-75">{message.role}</p>
              <p>{formatMessagePreview(message.content)}</p>
            </div>
          ))
        ) : (
          <p className="text-xs text-slate-500">Ask for a rewrite, expansion, tone adjustment, or clarity pass.</p>
        )}
      </div>

      {pendingDiffCount > 0 ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
          <p className="text-xs font-semibold text-emerald-800">
            {pendingDiffCount} pending AI sentence {pendingDiffCount === 1 ? 'change' : 'changes'} in the editor.
          </p>
          <p className="mt-1 text-[11px] text-emerald-700">Use Keep/Undo on each highlighted diff in the editor.</p>
        </div>
      ) : null}

      {error ? <p className="mb-2 text-xs text-red-700">{error}</p> : null}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          type="text"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="Example: make this more concise and add a stronger CTA"
        />
        <button
          type="button"
          className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          style={{ background: '#1a7a5e' }}
          onClick={onSend}
          disabled={sendDisabled}
          title={hasApiKeyConfigured ? undefined : 'Add an AI API key in Settings to enable AI chat.'}
        >
          {isSending ? <Spinner size="sm" label="Sending..." /> : 'Send to AI Chat'}
        </button>
      </div>
    </section>
  );
}
