'use client';

import type { AIEditHistoryEntry } from '@/lib/aiEditHistory';

type AIEditTimelineProps = {
  entries: AIEditHistoryEntry[];
  activeEntryId: string | null;
  onRestore: (entryId: string) => void;
  title?: string;
  emptyMessage?: string;
};

function formatEntryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AIEditTimeline(props: AIEditTimelineProps) {
  const {
    entries,
    activeEntryId,
    onRestore,
    title = 'AI Change Timeline',
    emptyMessage = 'AI-applied edits will appear here so you can roll the editor back to any saved point.',
  } = props;

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">Restore a previous AI-applied version without losing the rest of the workflow context.</p>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">{emptyMessage}</p>
      ) : (
        <ol className="relative ml-2 max-h-[480px] overflow-y-auto border-l border-slate-200 pl-5">
          {entries.map((entry) => {
            const isActive = entry.id === activeEntryId;
            return (
              <li key={entry.id} className="relative pb-4 last:pb-0">
                <span
                  className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 ${
                    isActive ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 bg-white'
                  }`}
                />
                <div className={`rounded-lg border px-3 py-3 ${isActive ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{entry.label}</p>
                      <p className="text-[11px] text-slate-500">{formatEntryTime(entry.createdAt)}</p>
                    </div>
                    {isActive ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Current
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                        onClick={() => onRestore(entry.id)}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">{entry.summary}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
