import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from 'react';

import { getActiveAIKey } from '@/lib/aiConfig';
import { companyProfileToContextLines, loadCompanyProfile } from '@/lib/companyProfile';

export type InlineSelection = {
  start: number;
  end: number;
  text: string;
};

export type InlineChangeStatus = 'pending' | 'accepted' | 'denied' | 'conflict';

export type InlineChange = {
  id: string;
  start: number;
  end: number;
  beforeText: string;
  afterText: string;
  summary: string;
  status: InlineChangeStatus;
  isFallback: boolean;
  isNoop: boolean;
  message?: string;
};

type InlineEditApiResponse = {
  proposal?: {
    beforeText?: string;
    afterText?: string;
    changeSummary?: string;
    selectionStart?: number;
    selectionEnd?: number;
  };
  proposals?: Array<{
    beforeText?: string;
    afterText?: string;
    changeSummary?: string;
    selectionStart?: number;
    selectionEnd?: number;
  }>;
  provider?: string;
  fallback?: boolean;
  error?: string;
};

type UseInlineEditArgs = {
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  onAcceptChange?: (change: InlineChange, previousText: string, nextText: string) => void;
};

type ProposeArgs = {
  selection: InlineSelection;
  instruction: string;
};

function findDraftRange(draft: string, beforeText: string): { start: number; end: number } | null {
  const trimmed = beforeText.trim();
  if (!trimmed) {
    return null;
  }

  const index = draft.indexOf(trimmed);
  if (index < 0) {
    return null;
  }

  return { start: index, end: index + trimmed.length };
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

export function useInlineEdit({ text, setText, onAcceptChange }: UseInlineEditArgs) {
  const [changes, setChanges] = useState<InlineChange[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastProvider, setLastProvider] = useState<string | null>(null);

  const proposeChange = useCallback(
    async ({ selection, instruction }: ProposeArgs): Promise<void> => {
      const trimmedInstruction = instruction.trim();
      const trimmedSelection = selection.text.trim();

      if (!trimmedInstruction) {
        setError('Add an inline edit instruction.');
        return;
      }

      const activeConfig = getActiveAIKey();
      if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
        setError('No AI API key found. Add a key in Settings before inline editing.');
        return;
      }

      if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
        setError('No Ollama model is configured. Update Settings before inline editing.');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const companyProfile = await loadCompanyProfile(null);
        const companyContext = companyProfileToContextLines(companyProfile);

        const response = await fetch('/api/drafts/inline-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: activeConfig.provider,
            apiKey: activeConfig.apiKey,
            ollamaBaseUrl: activeConfig.ollamaBaseUrl,
            ollamaModel: activeConfig.ollamaModel,
            draft: text,
            selectedText: trimmedSelection || undefined,
            selectionStart: trimmedSelection ? selection.start : undefined,
            selectionEnd: trimmedSelection ? selection.end : undefined,
            instruction: trimmedInstruction,
            companyContext,
          }),
        });

        const payload = (await response.json()) as InlineEditApiResponse;
        const rawProposals = payload.proposals?.length ? payload.proposals : payload.proposal ? [payload.proposal] : [];
        if (!response.ok || rawProposals.length === 0) {
          throw new Error(payload.error ?? 'Inline edit failed.');
        }

        const normalizedChanges = rawProposals
          .map((proposal): InlineChange | null => {
            const afterText = proposal.afterText?.trim();
            const beforeText = proposal.beforeText?.trim() || trimmedSelection;

            if (!beforeText || !afterText) {
              return null;
            }

            const hasValidRange =
              typeof proposal.selectionStart === 'number' &&
              typeof proposal.selectionEnd === 'number' &&
              proposal.selectionStart >= 0 &&
              proposal.selectionEnd > proposal.selectionStart;

            const derivedRange = hasValidRange
              ? { start: proposal.selectionStart as number, end: proposal.selectionEnd as number }
              : findDraftRange(text, beforeText);

            if (!derivedRange) {
              return null;
            }

            return {
              id: crypto.randomUUID(),
              start: derivedRange.start,
              end: derivedRange.end,
              beforeText,
              afterText,
              summary: proposal.changeSummary?.trim() || 'Inline rewrite suggestion',
              status: 'pending',
              isFallback: Boolean(payload.fallback),
              isNoop: beforeText === afterText,
            };
          })
          .filter((entry): entry is InlineChange => Boolean(entry))
          .sort((left, right) => left.start - right.start);

        if (normalizedChanges.length === 0) {
          throw new Error('Unable to locate proposed source text in the current draft.');
        }

        setChanges((previous) => [...normalizedChanges, ...previous]);
        setLastProvider(payload.provider ?? activeConfig.provider);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Inline edit failed.');
      } finally {
        setIsLoading(false);
      }
    },
    [text],
  );

  const acceptChange = useCallback(
    (changeId: string): void => {
      const target = changes.find((entry) => entry.id === changeId);
      if (!target || target.status === 'accepted') {
        return;
      }

      if (target.isNoop) {
        setChanges((previous) =>
          previous.map((entry) =>
            entry.id === target.id
              ? {
                  ...entry,
                  status: 'accepted',
                  message: 'No changes suggested.',
                }
              : entry,
          ),
        );
        return;
      }

      setText((currentText) => {
        let applyStart = target.start;
        let applyEnd = target.end;
        const exactSlice = currentText.slice(applyStart, applyEnd);

        if (exactSlice !== target.beforeText) {
          const rebaseWindowStart = Math.max(0, target.start - 200);
          const rebasedIndex = currentText.indexOf(target.beforeText, rebaseWindowStart);

          if (rebasedIndex < 0) {
            setChanges((previous) =>
              previous.map((entry) =>
                entry.id === target.id
                  ? {
                      ...entry,
                      status: 'conflict',
                      message: 'Original text moved. Re-select this section and regenerate the proposal.',
                    }
                  : entry,
              ),
            );
            return currentText;
          }

          applyStart = rebasedIndex;
          applyEnd = rebasedIndex + target.beforeText.length;
        }

        const nextText = `${currentText.slice(0, applyStart)}${target.afterText}${currentText.slice(applyEnd)}`;
        const delta = target.afterText.length - (applyEnd - applyStart);

        onAcceptChange?.(
          {
            ...target,
            start: applyStart,
            end: applyStart + target.afterText.length,
            status: 'accepted',
            message: undefined,
          },
          currentText,
          nextText,
        );

        setChanges((previous) =>
          previous.map((entry) => {
            if (entry.id === target.id) {
              return { ...entry, start: applyStart, end: applyStart + target.afterText.length, status: 'accepted', message: undefined };
            }

            if (entry.status !== 'pending' && entry.status !== 'conflict') {
              return entry;
            }

            if (rangesOverlap(entry.start, entry.end, applyStart, applyEnd)) {
              return {
                ...entry,
                status: 'conflict',
                message: 'Overlaps with an accepted change. Re-run this proposal on the latest text.',
              };
            }

            if (entry.start >= applyEnd) {
              return {
                ...entry,
                start: entry.start + delta,
                end: entry.end + delta,
              };
            }

            return entry;
          }),
        );

        return nextText;
      });
    },
    [changes, onAcceptChange, setText],
  );

  const denyChange = useCallback((changeId: string): void => {
    setChanges((previous) =>
      previous.map((entry) =>
        entry.id === changeId ? { ...entry, status: 'denied', message: undefined } : entry,
      ),
    );
  }, []);

  const clearResolvedChanges = useCallback((): void => {
    setChanges((previous) => previous.filter((entry) => entry.status === 'pending' || entry.status === 'conflict'));
  }, []);

  const pendingCount = useMemo(
    () => changes.filter((entry) => entry.status === 'pending' || entry.status === 'conflict').length,
    [changes],
  );

  return {
    changes,
    isLoading,
    error,
    lastProvider,
    pendingCount,
    proposeChange,
    acceptChange,
    denyChange,
    clearResolvedChanges,
    setError,
    setChanges,
  };
}
