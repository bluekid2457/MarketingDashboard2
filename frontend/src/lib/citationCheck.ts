// Citation analysis primitives for the storyboard editor.
// Extracted into its own module so the heading/citation heuristics are unit-testable
// and shared between the editor, the publish gate, and any future API route.

export type ReferenceLink = {
  marker: string;
  url: string;
  label?: string;
};

export type CitationCheck = {
  uncitedClaims: string[];
  references: ReferenceLink[];
  missingReferenceMarkers: string[];
  invalidReferences: string[];
};

const FACTUAL_SIGNAL_REGEX =
  /\d|%|\baccording to\b|\bresearch\b|\breport\b|\bstudy\b|\bsurvey\b|\bdata\b|\bgrowth\b|\bincrease\b|\bdecrease\b|\bbillion\b|\bmillion\b|\baverage\b|\bmajority\b|\bquarter\b|\bsource\b/i;

function sanitizeUrlCandidate(value: string): string {
  return value.trim().replace(/[)>.,;:!?]+$/, '').replace(/^<+/, '').replace(/>+$/, '');
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isReferenceHeadingLabel(label: string): boolean {
  const normalized = label
    .trim()
    .replace(/[:：]\s*$/, '')
    .replace(/[*_`~]/g, '')
    .trim();

  return /^(sources?|references?|citations?|bibliography|works\s+cited)$/i.test(normalized);
}

function parseAtxHeadingLabel(line: string): string | null {
  const match = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
  return match ? match[1].trim() : null;
}

function isSetextUnderline(line: string): boolean {
  return /^\s*(?:=|-){3,}\s*$/.test(line);
}

function extractReferenceSections(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const sections: string[] = [];
  let collectingStart: number | null = null;

  const pushSection = (endExclusive: number): void => {
    if (collectingStart === null) {
      return;
    }

    const sectionText = lines
      .slice(collectingStart, endExclusive)
      .map((line) => line.replace(/\s{2,}$/, ''))
      .join('\n')
      .trim();

    if (sectionText) {
      sections.push(sectionText);
    }

    collectingStart = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const nextLine = lines[index + 1] ?? '';
    const atxHeadingLabel = parseAtxHeadingLabel(line);

    const isReferenceHeading =
      (atxHeadingLabel !== null && isReferenceHeadingLabel(atxHeadingLabel)) ||
      (isSetextUnderline(nextLine) && isReferenceHeadingLabel(line));

    const isAnyHeading =
      atxHeadingLabel !== null ||
      (line.trim().length > 0 && isSetextUnderline(nextLine) && !/^\s*[-*+]\s+/.test(line));

    if (isReferenceHeading) {
      pushSection(index);
      collectingStart = index + (isSetextUnderline(nextLine) ? 2 : 1);
      if (isSetextUnderline(nextLine)) {
        index += 1;
      }
      continue;
    }

    if (collectingStart !== null && isAnyHeading) {
      pushSection(index);
      if (isSetextUnderline(nextLine)) {
        index += 1;
      }
    }
  }

  pushSection(lines.length);

  return sections.filter((section) => section.trim().length > 0);
}

function parseReferenceLinePrefix(line: string): { markerHint: string | null; content: string } {
  let content = line.trim().replace(/\s{2,}$/, '');
  let markerHint: string | null = null;

  const listPrefixMatch = content.match(/^(?:[-*+]|(\d+)[.)])\s+(.*)$/);
  if (listPrefixMatch) {
    content = listPrefixMatch[2].trim();
    if (listPrefixMatch[1]) {
      markerHint = `[${listPrefixMatch[1]}]`;
    }
  }

  const explicitMarkerMatch = content.match(/^\[(\d+)\]\s*(.*)$/);
  if (explicitMarkerMatch) {
    markerHint = `[${explicitMarkerMatch[1]}]`;
    content = explicitMarkerMatch[2].trim();
  }

  return { markerHint, content };
}

export function extractReferences(markdown: string): ReferenceLink[] {
  const candidates: Array<{ markerHint: string | null; url: string; explicitMarker: boolean; label?: string }> = [];
  const byUrl = new Map<string, number>();

  const addCandidate = (
    urlCandidate: string,
    markerHint: string | null,
    explicitMarker: boolean,
    label?: string,
  ): void => {
    const url = sanitizeUrlCandidate(urlCandidate);
    if (!isValidHttpUrl(url)) {
      return;
    }

    const dedupeKey = (() => {
      try {
        return new URL(url).toString();
      } catch {
        return url.toLowerCase();
      }
    })();

    const existingIndex = byUrl.get(dedupeKey);
    if (typeof existingIndex === 'number') {
      const existing = candidates[existingIndex];
      if (!existing.explicitMarker && explicitMarker && markerHint) {
        existing.markerHint = markerHint;
        existing.explicitMarker = true;
      }
      if (!existing.label && label) {
        existing.label = label;
      }
      return;
    }

    byUrl.set(dedupeKey, candidates.length);
    candidates.push({ markerHint, url, explicitMarker, label });
  };

  const parseReferenceLine = (line: string): void => {
    if (!line.trim()) {
      return;
    }

    const { markerHint, content } = parseReferenceLinePrefix(line);
    if (!content) {
      return;
    }

    let usedMarkerHint = false;
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    for (const match of content.matchAll(markdownLinkRegex)) {
      const label = match[1]?.trim();
      const urlCandidate = match[2] ?? '';
      addCandidate(urlCandidate, markerHint && !usedMarkerHint ? markerHint : null, Boolean(markerHint) && !usedMarkerHint, label);
      usedMarkerHint = true;
    }

    const contentWithoutMarkdownLinks = content.replace(markdownLinkRegex, ' ');
    const bareUrlMatches = contentWithoutMarkdownLinks.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
    for (const urlCandidate of bareUrlMatches) {
      addCandidate(urlCandidate, markerHint && !usedMarkerHint ? markerHint : null, Boolean(markerHint) && !usedMarkerHint);
      usedMarkerHint = true;
    }
  };

  const parseReferenceSectionText = (section: string): void => {
    const lines = section.split(/\r?\n/);
    for (const line of lines) {
      parseReferenceLine(line);
    }
  };

  const referenceSections = extractReferenceSections(markdown);
  if (referenceSections.length > 0) {
    for (const section of referenceSections) {
      parseReferenceSectionText(section);
    }
  }

  if (candidates.length === 0 && /\b(?:sources?|references?)\b/i.test(markdown)) {
    const referenceStyleLines = markdown.match(/^\s*(?:[-*+]|\d+[.)])\s+.+$/gim) ?? [];
    for (const line of referenceStyleLines) {
      parseReferenceLine(line);
    }
  }

  const inlineListMatches = markdown.matchAll(/^[\t ]*[-*][\t ]*\[(\d+)\][^\n]*?\(([^)]+)\)/gim);
  for (const match of inlineListMatches) {
    addCandidate(match[2], `[${match[1]}]`, true);
  }

  const footnoteMatches = markdown.matchAll(/^[\t ]*\[(\d+)\]:[\t ]*(\S+)/gim);
  for (const match of footnoteMatches) {
    addCandidate(match[2], `[${match[1]}]`, true);
  }

  const sourceLineMatches = markdown.matchAll(/^[\t ]*(?:[-*]|\d+[.)])[\t ]*(?:\[(\d+)\][\t ]*)?(https?:\/\/\S+)/gim);
  for (const match of sourceLineMatches) {
    addCandidate(match[2], match[1] ? `[${match[1]}]` : null, Boolean(match[1]));
  }

  const explicitMarkerNumbers = candidates
    .map((candidate) => candidate.markerHint)
    .filter((marker): marker is string => Boolean(marker))
    .map((marker) => {
      const match = marker.match(/^\[(\d+)\]$/);
      return match ? Number(match[1]) : null;
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  let nextAutoMarker = explicitMarkerNumbers.length > 0 ? Math.max(...explicitMarkerNumbers) + 1 : 1;

  return candidates.map((candidate) => {
    const marker = candidate.markerHint ?? `[${nextAutoMarker++}]`;
    return {
      marker,
      url: candidate.url,
      label: candidate.label,
    };
  });
}

export function extractInvalidReferenceCandidates(markdown: string): string[] {
  const candidates: string[] = [];

  const collectInvalidCandidatesFromText = (text: string): void => {
    const markdownLinkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
    for (const match of text.matchAll(markdownLinkRegex)) {
      candidates.push(sanitizeUrlCandidate(match[1] ?? ''));
    }

    const stripped = text.replace(markdownLinkRegex, ' ');
    const bareMatches = stripped.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) ?? [];
    for (const match of bareMatches) {
      candidates.push(sanitizeUrlCandidate(match));
    }
  };

  const referenceSections = extractReferenceSections(markdown);
  if (referenceSections.length > 0) {
    for (const section of referenceSections) {
      const lines = section.split(/\r?\n/);
      for (const line of lines) {
        const { content } = parseReferenceLinePrefix(line);
        if (content) {
          collectInvalidCandidatesFromText(content);
        }
      }
    }
  } else {
    collectInvalidCandidatesFromText(markdown);
  }

  return [...new Set(candidates)]
    .filter((candidate) => /^(?:https?:\/\/|www\.)/i.test(candidate))
    .filter((candidate) => !isValidHttpUrl(candidate))
    .slice(0, 5);
}

function isHeadingOrStructure(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (/^#{1,6}\s/.test(trimmed)) {
    return true;
  }
  if (/^>+\s/.test(trimmed)) {
    return true;
  }
  if (/^\|/.test(trimmed)) {
    return true;
  }
  // Setext underline by itself
  if (/^[=\-]{3,}$/.test(trimmed)) {
    return true;
  }
  return false;
}

function stripMarkdownArtifacts(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

export function findUncitedClaims(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const referenceSections = new Set(extractReferenceSections(markdown));
  const isInReferenceSection = (line: string): boolean => {
    for (const section of referenceSections) {
      if (section.includes(line)) {
        return true;
      }
    }
    return false;
  };

  const sentences: string[] = [];
  const sentenceWasCited: boolean[] = [];

  for (const rawLine of lines) {
    if (isHeadingOrStructure(rawLine)) {
      continue;
    }
    if (isInReferenceSection(rawLine)) {
      continue;
    }

    const cleaned = stripMarkdownArtifacts(rawLine);
    if (!cleaned) {
      continue;
    }

    const lineSentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    let lastCarriedCitation = false;
    for (const sentence of lineSentences) {
      const hasCitation = /\[\d+\]/.test(sentence);
      const inheritedCitation = lastCarriedCitation && /[,;:]\s*$/.test(sentence);
      sentences.push(sentence);
      sentenceWasCited.push(hasCitation || inheritedCitation);
      lastCarriedCitation = hasCitation;
    }
  }

  const flagged: string[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (sentenceWasCited[index]) {
      continue;
    }

    if (!FACTUAL_SIGNAL_REGEX.test(sentence)) {
      continue;
    }

    if (sentence.length < 25) {
      continue;
    }

    const previousSentence = sentences[index - 1] ?? '';
    if (previousSentence && /\[\d+\]/.test(previousSentence)) {
      const overlapWords = previousSentence
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length > 4);
      const sentenceLower = sentence.toLowerCase();
      let overlap = 0;
      for (const word of overlapWords) {
        if (sentenceLower.includes(word)) {
          overlap += 1;
        }
      }
      if (overlap >= 3) {
        continue;
      }
    }

    flagged.push(sentence);
    if (flagged.length >= 5) {
      break;
    }
  }

  return flagged;
}

export function runCitationCheck(markdown: string): CitationCheck {
  const references = extractReferences(markdown);
  const referencedMarkers = new Set(references.map((ref) => ref.marker));
  const citedMarkers = [...markdown.matchAll(/\[(\d+)\]/g)].map((match) => `[${match[1]}]`);
  const missingReferenceMarkers = [...new Set(citedMarkers.filter((marker) => !referencedMarkers.has(marker)))];
  const invalidReferenceCandidates = extractInvalidReferenceCandidates(markdown);

  return {
    uncitedClaims: findUncitedClaims(markdown),
    references,
    missingReferenceMarkers,
    invalidReferences: invalidReferenceCandidates,
  };
}
