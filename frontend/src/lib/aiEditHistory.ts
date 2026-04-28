export type AIEditHistoryEntry = {
  id: string;
  label: string;
  summary: string;
  content: string;
  createdAt: number;
};

export type AIEditHistoryState = {
  entries: AIEditHistoryEntry[];
  activeEntryId: string | null;
};

export function createEmptyAIEditHistoryState(): AIEditHistoryState {
  return {
    entries: [],
    activeEntryId: null,
  };
}

type AppendArgs = {
  previousContent: string;
  nextContent: string;
  label: string;
  summary: string;
};

export function appendAIEditHistory(state: AIEditHistoryState, args: AppendArgs): AIEditHistoryState {
  const { previousContent, nextContent, label, summary } = args;
  if (previousContent === nextContent) {
    return state;
  }

  const anchorIndex = state.activeEntryId
    ? state.entries.findIndex((entry) => entry.id === state.activeEntryId)
    : -1;
  const entries = anchorIndex >= 0 ? state.entries.slice(0, anchorIndex + 1) : [...state.entries];
  const lastEntry = entries[entries.length - 1] ?? null;
  const now = Date.now();

  if (!lastEntry || lastEntry.content !== previousContent) {
    entries.push({
      id: crypto.randomUUID(),
      label: 'Editor snapshot',
      summary: 'Captured before the latest AI change.',
      content: previousContent,
      createdAt: now - 1,
    });
  }

  const nextEntry: AIEditHistoryEntry = {
    id: crypto.randomUUID(),
    label,
    summary,
    content: nextContent,
    createdAt: now,
  };

  entries.push(nextEntry);
  return {
    entries,
    activeEntryId: nextEntry.id,
  };
}
