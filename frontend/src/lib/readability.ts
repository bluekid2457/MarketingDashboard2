// Local readability metrics for the storyboard editor.
// All measures run synchronously in the browser; nothing here calls AI.

export type ReadabilityScore = {
  words: number;
  sentences: number;
  syllables: number;
  averageWordsPerSentence: number;
  averageSyllablesPerWord: number;
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  complexityLabel: ComplexityLabel;
  complexityValue: number;
};

export type ComplexityLabel =
  | 'Very simple'
  | 'Easy'
  | 'Conversational'
  | 'Standard'
  | 'Sophisticated'
  | 'Academic'
  | 'Specialist';

export const COMPLEXITY_TARGETS: Array<{
  value: number;
  label: ComplexityLabel;
  fleschTarget: number;
  description: string;
  audienceHint: string;
}> = [
  { value: 1, label: 'Very simple', fleschTarget: 90, description: 'Clear short sentences, plain words.', audienceHint: 'Grade 5 reader, broad public' },
  { value: 2, label: 'Easy', fleschTarget: 80, description: 'Friendly, easy to skim.', audienceHint: 'Grade 6 reader, casual reader' },
  { value: 3, label: 'Conversational', fleschTarget: 70, description: 'Natural everyday language.', audienceHint: 'Grade 7 reader, social media' },
  { value: 4, label: 'Standard', fleschTarget: 60, description: 'Default business writing.', audienceHint: 'Grade 8 reader, working professional' },
  { value: 5, label: 'Sophisticated', fleschTarget: 50, description: 'Some industry vocabulary, longer sentences.', audienceHint: 'Grade 10 reader, executive' },
  { value: 6, label: 'Academic', fleschTarget: 40, description: 'Dense argument, technical phrasing welcome.', audienceHint: 'College reader, white paper' },
  { value: 7, label: 'Specialist', fleschTarget: 30, description: 'Terminology heavy, complex sentence structure.', audienceHint: 'Domain specialist, peer review' },
];

const VOWEL_GROUP_REGEX = /[aeiouy]+/g;

function countSyllablesInWord(rawWord: string): number {
  const word = rawWord.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) {
    return 0;
  }

  if (word.length <= 3) {
    return 1;
  }

  // Drop trailing silent "es" / "ed" / "e".
  const normalized = word
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/u, '')
    .replace(/^y/u, '');

  const groups = normalized.match(VOWEL_GROUP_REGEX);
  return Math.max(1, groups ? groups.length : 1);
}

function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  const matches = trimmed.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$/g);
  return matches ? matches.length : 1;
}

function listWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_~>#-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z'\-]/g, ''))
    .filter((token) => token.length > 0);
}

export function getComplexityForFlesch(flesch: number): { value: number; label: ComplexityLabel } {
  let best = COMPLEXITY_TARGETS[3];
  let smallestDelta = Infinity;
  for (const entry of COMPLEXITY_TARGETS) {
    const delta = Math.abs(entry.fleschTarget - flesch);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      best = entry;
    }
  }
  return { value: best.value, label: best.label };
}

export function calculateReadability(rawText: string): ReadabilityScore {
  const text = rawText ?? '';
  const words = listWords(text);
  const wordCount = words.length;
  const sentenceCount = countSentences(text);
  const syllableCount = words.reduce((total, word) => total + countSyllablesInWord(word), 0);

  if (wordCount === 0 || sentenceCount === 0) {
    return {
      words: wordCount,
      sentences: sentenceCount,
      syllables: syllableCount,
      averageWordsPerSentence: 0,
      averageSyllablesPerWord: 0,
      fleschReadingEase: 0,
      fleschKincaidGrade: 0,
      complexityLabel: 'Standard',
      complexityValue: 4,
    };
  }

  const averageWordsPerSentence = wordCount / sentenceCount;
  const averageSyllablesPerWord = syllableCount / wordCount;

  const fleschReadingEase =
    206.835 - 1.015 * averageWordsPerSentence - 84.6 * averageSyllablesPerWord;
  const fleschKincaidGrade =
    0.39 * averageWordsPerSentence + 11.8 * averageSyllablesPerWord - 15.59;

  const { value, label } = getComplexityForFlesch(fleschReadingEase);

  return {
    words: wordCount,
    sentences: sentenceCount,
    syllables: syllableCount,
    averageWordsPerSentence,
    averageSyllablesPerWord,
    fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
    fleschKincaidGrade: Math.round(fleschKincaidGrade * 10) / 10,
    complexityLabel: label,
    complexityValue: value,
  };
}

export function describeFlesch(score: number): string {
  if (score >= 90) return 'Very easy (5th grade)';
  if (score >= 80) return 'Easy (6th grade)';
  if (score >= 70) return 'Fairly easy (7th grade)';
  if (score >= 60) return 'Standard (8th–9th grade)';
  if (score >= 50) return 'Fairly hard (10th–12th grade)';
  if (score >= 30) return 'Difficult (college level)';
  return 'Very difficult (specialist)';
}
