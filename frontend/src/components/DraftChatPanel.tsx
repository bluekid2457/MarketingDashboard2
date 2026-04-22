'use client';

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
  } = props;

  const hasMessages = messages.length > 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{helperText}</p>
        </div>
        {providerLabel ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{providerLabel}</span>
        ) : null}
      </div>

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
          disabled={isSending || !inputValue.trim()}
        >
          {isSending ? <Spinner size="sm" label="Sending..." /> : 'Send to AI Chat'}
        </button>
      </div>
    </section>
  );
}
