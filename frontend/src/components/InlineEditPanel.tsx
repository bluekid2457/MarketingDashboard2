'use client';

import { Spinner } from '@/components/Spinner';
import type { InlineChange } from '@/lib/useInlineEdit';

type InlineEditPanelProps = {
  isVisible: boolean;
  anchorTop: number;
  anchorLeft: number;
  selectedText: string;
  instruction: string;
  onInstructionChange: (next: string) => void;
  onPropose: () => void;
  isLoading: boolean;
  error: string | null;
  pendingChange: InlineChange | null;
  onAcceptPending: () => void;
  onDenyPending: () => void;
};

function summarizeSnippet(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function InlineEditPanel(props: InlineEditPanelProps) {
  const {
    isVisible,
    anchorTop,
    anchorLeft,
    selectedText,
    instruction,
    onInstructionChange,
    onPropose,
    isLoading,
    error,
    pendingChange,
    onAcceptPending,
    onDenyPending,
  } = props;

  if (!isVisible) {
    return null;
  }

  const noChangesSuggested = pendingChange?.isNoop || false;

  return (
    <div
      className="absolute z-30 w-[min(520px,calc(100%-1rem))] rounded-xl border border-slate-300 bg-white/95 p-3 shadow-2xl backdrop-blur-sm"
      style={{ top: `${anchorTop}px`, left: `${anchorLeft}px` }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Inline AI Edit</p>
          <p className="mt-1 text-xs text-slate-600">
            {selectedText.trim() || 'No selection. AI will choose a nearby sentence to refine.'}
          </p>
        </div>

        {pendingChange ? (
          <div className="flex overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/90">
            <button
              type="button"
              className="bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
              onClick={onAcceptPending}
            >
              Keep
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800"
              onClick={onDenyPending}
            >
              Undo
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <input
          type="text"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="Example: tighten this claim and reduce certainty"
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value)}
        />
        <button
          type="button"
          className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          style={{ background: '#1a7a5e' }}
          onClick={onPropose}
          disabled={isLoading || !instruction.trim()}
        >
          {isLoading ? <Spinner size="sm" label="Generating..." /> : 'Propose Inline Edit'}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      {pendingChange ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
          <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">{pendingChange.summary}</p>
          {noChangesSuggested ? (
            <p className="text-slate-600">No changes suggested.</p>
          ) : (
            <p>
              <span className="rounded bg-rose-100 px-1 text-rose-700 line-through">
                {summarizeSnippet(pendingChange.beforeText)}
              </span>{' '}
              <span className="rounded bg-emerald-100 px-1 text-emerald-800">
                {summarizeSnippet(pendingChange.afterText)}
              </span>
            </p>
          )}
          {pendingChange.message ? <p className="mt-1 text-amber-700">{pendingChange.message}</p> : null}
          {pendingChange.isFallback ? <p className="mt-1 text-slate-500">Suggestion used a deterministic fallback.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
