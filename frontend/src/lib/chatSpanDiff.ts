export type SentenceToken = {
  text: string;
  start: number;
  end: number;
  normalized: string;
};

export type ChatSentenceDiff = {
  id: string;
  start: number;
  end: number;
  beforeText: string;
  afterText: string;
  status: 'pending' | 'kept' | 'undone' | 'conflict';
  message?: string;
};

function normalizeSentence(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenizeSentences(text: string): SentenceToken[] {
  const tokens: SentenceToken[] = [];
  const sentenceRegex = /[^.!?\n]+(?:[.!?]+|$)|\n+/g;
  let match: RegExpExecArray | null;

  while ((match = sentenceRegex.exec(text)) !== null) {
    const tokenText = match[0] ?? '';
    if (!tokenText) {
      continue;
    }

    const start = match.index;
    const end = start + tokenText.length;
    const normalized = normalizeSentence(tokenText);

    if (!normalized && !/\n+/.test(tokenText)) {
      continue;
    }

    tokens.push({
      text: tokenText,
      start,
      end,
      normalized,
    });
  }

  return tokens;
}

function buildLcsTable(left: SentenceToken[], right: SentenceToken[]): number[][] {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (left[i - 1].normalized === right[j - 1].normalized) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

function buildMatchPairs(left: SentenceToken[], right: SentenceToken[], table: number[][]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let i = left.length;
  let j = right.length;

  while (i > 0 && j > 0) {
    if (left[i - 1].normalized === right[j - 1].normalized) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
      continue;
    }

    if (table[i - 1][j] >= table[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return pairs.reverse();
}

function mergeAdjacentDiffs(diffs: ChatSentenceDiff[]): ChatSentenceDiff[] {
  if (diffs.length <= 1) {
    return diffs;
  }

  const merged: ChatSentenceDiff[] = [];

  for (const diff of diffs) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(diff);
      continue;
    }

    const directlyAdjacent = diff.start <= previous.end + 1;
    if (directlyAdjacent) {
      previous.end = Math.max(previous.end, diff.end);
      previous.beforeText += diff.beforeText;
      previous.afterText += diff.afterText;
      continue;
    }

    merged.push(diff);
  }

  return merged;
}

export function buildSentenceSpanDiffs(beforeText: string, afterText: string): ChatSentenceDiff[] {
  if (!beforeText || !afterText || beforeText === afterText) {
    return [];
  }

  const left = tokenizeSentences(beforeText);
  const right = tokenizeSentences(afterText);

  if (left.length === 0 && right.length === 0) {
    return [];
  }

  const table = buildLcsTable(left, right);
  const pairs = buildMatchPairs(left, right, table);
  const diffs: ChatSentenceDiff[] = [];

  let leftCursor = 0;
  let rightCursor = 0;

  const addDiff = (leftStart: number, leftEndExclusive: number, rightStart: number, rightEndExclusive: number): void => {
    const leftTokens = left.slice(leftStart, leftEndExclusive);
    const rightTokens = right.slice(rightStart, rightEndExclusive);

    const composedBefore = leftTokens.map((token) => token.text).join('');
    const composedAfter = rightTokens.map((token) => token.text).join('');

    const normalizedBefore = normalizeSentence(composedBefore);
    const normalizedAfter = normalizeSentence(composedAfter);

    if (normalizedBefore === normalizedAfter) {
      return;
    }

    const start = leftTokens.length > 0 ? leftTokens[0].start : left[Math.max(0, leftStart - 1)]?.end ?? 0;
    const end = leftTokens.length > 0 ? leftTokens[leftTokens.length - 1].end : start;

    diffs.push({
      id: crypto.randomUUID(),
      start,
      end,
      beforeText: composedBefore,
      afterText: composedAfter,
      status: 'pending',
    });
  };

  for (const [leftIndex, rightIndex] of pairs) {
    if (leftCursor < leftIndex || rightCursor < rightIndex) {
      addDiff(leftCursor, leftIndex, rightCursor, rightIndex);
    }

    leftCursor = leftIndex + 1;
    rightCursor = rightIndex + 1;
  }

  if (leftCursor < left.length || rightCursor < right.length) {
    addDiff(leftCursor, left.length, rightCursor, right.length);
  }

  return mergeAdjacentDiffs(diffs).filter((diff) => normalizeSentence(diff.beforeText) !== normalizeSentence(diff.afterText));
}

export function applyChatSentenceDiff(
  currentText: string,
  diff: Pick<ChatSentenceDiff, 'start' | 'end' | 'beforeText' | 'afterText'>,
): { nextText: string; appliedStart: number; appliedEnd: number; replacedLength: number } | null {
  let applyStart = diff.start;
  let applyEnd = diff.end;

  if (diff.beforeText.length > 0) {
    const exactSlice = currentText.slice(applyStart, applyEnd);
    if (exactSlice !== diff.beforeText) {
      const searchWindowStart = Math.max(0, diff.start - 240);
      const searchWindowEnd = Math.min(currentText.length, diff.end + 240);
      const localWindow = currentText.slice(searchWindowStart, searchWindowEnd);
      const localIndex = localWindow.indexOf(diff.beforeText);
      const rebasedIndex =
        localIndex >= 0
          ? searchWindowStart + localIndex
          : currentText.indexOf(diff.beforeText);

      if (rebasedIndex < 0) {
        return null;
      }

      applyStart = rebasedIndex;
      applyEnd = rebasedIndex + diff.beforeText.length;
    }
  } else {
    const clamped = Math.max(0, Math.min(currentText.length, diff.start));
    applyStart = clamped;
    applyEnd = clamped;
  }

  const nextText = `${currentText.slice(0, applyStart)}${diff.afterText}${currentText.slice(applyEnd)}`;

  return {
    nextText,
    appliedStart: applyStart,
    appliedEnd: applyStart + diff.afterText.length,
    replacedLength: applyEnd - applyStart,
  };
}

export function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}
