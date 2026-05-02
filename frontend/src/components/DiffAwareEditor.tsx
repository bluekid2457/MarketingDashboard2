'use client';

import { useMemo, type ReactNode, type Ref, type ReactEventHandler, type ChangeEventHandler } from 'react';

import type { ChatSentenceDiff } from '@/lib/chatSpanDiff';

type DiffAwareEditorProps = {
  value: string;
  onChange: (next: string) => void;
  pendingDiffs: ChatSentenceDiff[];
  onKeepDiff: (diffId: string) => void;
  onUndoDiff: (diffId: string) => void;
  onUndoAll?: () => void;

  editorRef?: Ref<HTMLTextAreaElement>;
  onSelect?: ReactEventHandler<HTMLTextAreaElement>;
  onKeyUp?: ReactEventHandler<HTMLTextAreaElement>;
  onMouseUp?: ReactEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
  spellCheck?: boolean;

  /** Rendered as overlay siblings in edit mode (e.g. InlineEditPanel). */
  overlay?: ReactNode;

  /** Min height for both edit mode and review mode containers. */
  minHeightClass?: string;
};

type ResolvedDiff = {
  diff: ChatSentenceDiff;
  resolvedStart: number;
  resolvedEnd: number;
  driftDetected: boolean;
};

type Segment =
  | { kind: 'plain'; text: string; key: string }
  | { kind: 'diff'; entry: ResolvedDiff; key: string };

function resolveDiffPosition(value: string, diff: ChatSentenceDiff): ResolvedDiff {
  const length = value.length;
  const clampedStart = Math.max(0, Math.min(length, diff.start));
  const clampedEnd = Math.max(clampedStart, Math.min(length, diff.end));

  if (diff.beforeText.length === 0) {
    return { diff, resolvedStart: clampedStart, resolvedEnd: clampedStart, driftDetected: false };
  }

  const slice = value.slice(clampedStart, clampedEnd);
  if (slice === diff.beforeText) {
    return { diff, resolvedStart: clampedStart, resolvedEnd: clampedEnd, driftDetected: false };
  }

  const window = 240;
  const localStart = Math.max(0, diff.start - window);
  const localEnd = Math.min(length, diff.end + window);
  const localSlice = value.slice(localStart, localEnd);
  const localIndex = localSlice.indexOf(diff.beforeText);
  if (localIndex >= 0) {
    const rebasedStart = localStart + localIndex;
    return {
      diff,
      resolvedStart: rebasedStart,
      resolvedEnd: rebasedStart + diff.beforeText.length,
      driftDetected: false,
    };
  }

  const globalIndex = value.indexOf(diff.beforeText);
  if (globalIndex >= 0) {
    return {
      diff,
      resolvedStart: globalIndex,
      resolvedEnd: globalIndex + diff.beforeText.length,
      driftDetected: false,
    };
  }

  return { diff, resolvedStart: clampedStart, resolvedEnd: clampedEnd, driftDetected: true };
}

function buildSegments(value: string, visibleDiffs: ChatSentenceDiff[]): Segment[] {
  if (visibleDiffs.length === 0) {
    return [{ kind: 'plain', text: value, key: 'plain-only' }];
  }

  const resolved = visibleDiffs
    .map((diff) => resolveDiffPosition(value, diff))
    .sort((a, b) => a.resolvedStart - b.resolvedStart);

  const segments: Segment[] = [];
  let cursor = 0;

  resolved.forEach((entry, index) => {
    const start = Math.max(cursor, entry.resolvedStart);
    const end = Math.max(start, entry.resolvedEnd);

    if (start > cursor) {
      segments.push({ kind: 'plain', text: value.slice(cursor, start), key: `plain-${cursor}-${start}` });
    } else if (entry.resolvedStart < cursor) {
      // Overlapping — mark it as drift so it can only be undone, and don't double-consume text.
      entry.driftDetected = true;
    }

    segments.push({ kind: 'diff', entry, key: `diff-${entry.diff.id}-${index}` });

    if (end > cursor) {
      cursor = end;
    }
  });

  if (cursor < value.length) {
    segments.push({ kind: 'plain', text: value.slice(cursor), key: `plain-${cursor}-end` });
  }

  return segments;
}

function DiffSegment({
  entry,
  onKeepDiff,
  onUndoDiff,
}: {
  entry: ResolvedDiff;
  onKeepDiff: (diffId: string) => void;
  onUndoDiff: (diffId: string) => void;
}) {
  const { diff, driftDetected } = entry;
  const isInsert = diff.beforeText.length === 0;
  const isDelete = diff.afterText.length === 0;
  const isConflict = diff.status === 'conflict' || driftDetected;
  const conflictMessage = diff.message ?? null;

  return (
    <span
      data-diff-id={diff.id}
      className={`relative my-2 block rounded-md border shadow-sm ${
        isConflict ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <span className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          className="rounded-md bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"
          onClick={() => onKeepDiff(diff.id)}
          disabled={isConflict}
          title={isConflict ? 'Source moved. Undo and re-run the chat to refresh this diff.' : 'Keep this change'}
          aria-label="Keep change"
        >
          ✓ Keep
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
          onClick={() => onUndoDiff(diff.id)}
          title="Undo this change"
          aria-label="Undo change"
        >
          ↶ Undo
        </button>
      </span>

      {!isInsert ? (
        <span className="block whitespace-pre-wrap rounded-t-md bg-red-50 px-3 py-1 pr-24 font-mono text-xs text-red-900 line-through">
          {diff.beforeText}
        </span>
      ) : null}

      {!isDelete ? (
        <span
          className={`block whitespace-pre-wrap px-3 py-1 pr-24 font-mono text-xs text-emerald-900 ${
            isInsert ? 'rounded-md bg-emerald-50' : 'rounded-b-md bg-emerald-50'
          }`}
        >
          {diff.afterText}
        </span>
      ) : (
        <span className="block px-3 py-1 text-[11px] italic text-slate-500">(this sentence will be removed)</span>
      )}

      {conflictMessage ? (
        <span className="block rounded-b-md border-t border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-800">
          {conflictMessage}
        </span>
      ) : null}
    </span>
  );
}

export function DiffAwareEditor(props: DiffAwareEditorProps) {
  const {
    value,
    onChange,
    pendingDiffs,
    onKeepDiff,
    onUndoDiff,
    onUndoAll,
    editorRef,
    onSelect,
    onKeyUp,
    onMouseUp,
    placeholder,
    spellCheck = true,
    overlay,
    minHeightClass = 'min-h-[480px]',
  } = props;

  const visibleDiffs = useMemo(
    () => pendingDiffs.filter((diff) => diff.status === 'pending' || diff.status === 'conflict'),
    [pendingDiffs],
  );
  const inReviewMode = visibleDiffs.length > 0;

  const segments = useMemo(
    () => (inReviewMode ? buildSegments(value, visibleDiffs) : []),
    [inReviewMode, value, visibleDiffs],
  );

  const handleTextareaChange: ChangeEventHandler<HTMLTextAreaElement> = (event) => {
    onChange(event.target.value);
  };

  return (
    <div className="relative">
      {inReviewMode ? (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-xs">
            <span className="font-medium text-slate-700">
              Reviewing {visibleDiffs.length} AI sentence change{visibleDiffs.length === 1 ? '' : 's'} — Keep or Undo each diff to resume editing.
            </span>
            {onUndoAll ? (
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                onClick={onUndoAll}
              >
                Undo all
              </button>
            ) : null}
          </div>

          <div
            className={`w-full resize-y overflow-auto rounded-xl border border-slate-300 bg-white p-4 text-sm leading-relaxed text-slate-800 ${minHeightClass}`}
            role="region"
            aria-label="AI sentence diff review"
          >
            <div className="whitespace-pre-wrap font-sans text-sm">
              {segments.map((segment) =>
                segment.kind === 'plain' ? (
                  <span key={segment.key}>{segment.text}</span>
                ) : (
                  <DiffSegment
                    key={segment.key}
                    entry={segment.entry}
                    onKeepDiff={onKeepDiff}
                    onUndoDiff={onUndoDiff}
                  />
                ),
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <textarea
            ref={editorRef}
            className={`w-full resize-y rounded-xl border border-slate-300 p-4 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 ${minHeightClass}`}
            value={value}
            onChange={handleTextareaChange}
            onSelect={onSelect}
            onKeyUp={onKeyUp}
            onMouseUp={onMouseUp}
            placeholder={placeholder}
            spellCheck={spellCheck}
          />
          {overlay}
        </>
      )}
    </div>
  );
}
