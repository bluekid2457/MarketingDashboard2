import { describe, expect, it } from 'vitest';

import { markdownToLinkedInUnicode } from '@/lib/linkedinFormat';

/**
 * Parity tests for the JS converter. The 23 golden inputs MUST produce
 * byte-for-byte identical output to the Python implementation at
 * ``backend/app/services/linkedin_text_format.py``.
 *
 * Expected outputs are written with ``\uXXXX`` / ``\u{XXXXX}`` escape
 * sequences so the test file stays ASCII-clean and the diff is readable
 * when a regression lands.
 */

const GOLDEN_CASES: ReadonlyArray<[label: string, input: string, expected: string]> = [
  // case 1: empty.
  ['empty', '', ''],
  // case 2: plain.
  ['plain', 'Hello', 'Hello'],
  // case 3: bold -> Math Sans Bold "Hello".
  ['bold', '**Hello**', '\u{1d5db}\u{1d5f2}\u{1d5f9}\u{1d5f9}\u{1d5fc}'],
  // case 4: asterisk-italic -> Math Sans Italic "italic".
  [
    'asterisk-italic',
    '*italic*',
    '\u{1d62a}\u{1d635}\u{1d622}\u{1d62d}\u{1d62a}\u{1d624}',
  ],
  // case 5: underscore-italic -> same Math Sans Italic letters.
  [
    'underscore-italic',
    '_italic_',
    '\u{1d62a}\u{1d635}\u{1d622}\u{1d62d}\u{1d62a}\u{1d624}',
  ],
  // case 6: bold-italic -> Math Sans Bold Italic "bold italic".
  [
    'bold-italic',
    '***bold italic***',
    '\u{1d657}\u{1d664}\u{1d661}\u{1d659} \u{1d65e}\u{1d669}\u{1d656}\u{1d661}\u{1d65e}\u{1d658}',
  ],
  // case 7: strikethrough -> ASCII + U+0336 per grapheme.
  ['strike', '~~strike~~', 's̶t̶r̶i̶k̶e̶'],
  // case 8: ATX h1.
  [
    'h1',
    '# Heading\nbody',
    '\u{1d5db}\u{1d5f2}\u{1d5ee}\u{1d5f1}\u{1d5f6}\u{1d5fb}\u{1d5f4}\n\nbody',
  ],
  // case 9: ATX h2 (digit inside heading uses Math Sans Bold digit).
  [
    'h2',
    '## Heading 2\nbody',
    '\u{1d5db}\u{1d5f2}\u{1d5ee}\u{1d5f1}\u{1d5f6}\u{1d5fb}\u{1d5f4} \u{1d7ee}\n\nbody',
  ],
  // case 10: dash-bullets.
  ['dash-bullets', '- bullet a\n- bullet b', '• bullet a\n• bullet b'],
  // case 11: asterisk-bullets.
  ['asterisk-bullets', '* bullet a\n* bullet b', '• bullet a\n• bullet b'],
  // case 12: numbered list passes through.
  ['numbered', '1. first\n2. second', '1. first\n2. second'],
  // case 13: markdown link.
  [
    'link',
    '[link text](https://example.com/path?q=1)',
    'link text (https://example.com/path?q=1)',
  ],
  // case 14: mixed — hashtag/mention/URL stay literal; **tips** converts.
  [
    'mixed',
    'Visit #Marketing for **tips** and follow @achint-k about https://x.com/?a=1',
    'Visit #Marketing for \u{1d601}\u{1d5f6}\u{1d5fd}\u{1d600} and follow @achint-k about https://x.com/?a=1',
  ],
  // case 15: #**Foo** stays literal (regression guard).
  ['hash-stuck-bold', '#**Foo**', '#**Foo**'],
  // case 16: @user-**bold** stays literal (regression guard).
  ['mention-stuck-bold', '@user-**bold**', '@user-**bold**'],
  // case 17: bold inside link text converts.
  [
    'link-bold-inside',
    '[**Hello** world](https://x.com)',
    '\u{1d5db}\u{1d5f2}\u{1d5f9}\u{1d5f9}\u{1d5fc} world (https://x.com)',
  ],
  // case 18: bold digit -> Math Sans Bold digit.
  ['bold-digit', 'Bold number **42** here', 'Bold number \u{1d7f0}\u{1d7ee} here'],
  // case 19: italic digit stays ASCII.
  ['italic-digit', 'Italic number *42* here', 'Italic number 42 here'],
  // case 20: two-space line break collapses to \n.
  ['two-space-break', 'Line1  \nLine2', 'Line1\nLine2'],
  // case 21: paragraph break preserved.
  ['paragraph', 'Line1\n\nLine2', 'Line1\n\nLine2'],
  // case 22: emoji + punctuation passthrough.
  ['emoji-passthrough', ':) \u{1f680} — keep me', ':) \u{1f680} — keep me'],
  // case 23: bold-italic spanning a protected region — whole expression stays literal.
  [
    'bold-italic-with-protected',
    '***bold italic with #hashtag and https://a.com***',
    '***bold italic with #hashtag and https://a.com***',
  ],
];

describe('markdownToLinkedInUnicode', () => {
  for (const [label, input, expected] of GOLDEN_CASES) {
    it(`golden case: ${label}`, () => {
      expect(markdownToLinkedInUnicode(input)).toBe(expected);
    });
  }

  for (const [label, input] of GOLDEN_CASES) {
    it(`idempotent: ${label}`, () => {
      const once = markdownToLinkedInUnicode(input);
      const twice = markdownToLinkedInUnicode(once);
      expect(twice).toBe(once);
    });
  }

  it('strikethrough appends combining mark per grapheme', () => {
    const converted = markdownToLinkedInUnicode('~~ab~~');
    expect(converted).toContain('a̶');
    expect(converted).toContain('b̶');
  });

  it('underscore word inside identifier is not italicised', () => {
    // The underscore-italic regex requires whitespace/start flanking on the
    // left AND whitespace/end/punctuation flanking on the right, so
    // `foo_bar_baz` (an ASCII identifier) passes through unchanged.
    expect(markdownToLinkedInUnicode('foo_bar_baz')).toBe('foo_bar_baz');
  });

  it('hashtag without letters does not trigger bold conversion', () => {
    // `#` alone is not a hashtag (needs `[A-Za-z0-9_]+`). The styleable
    // inline-bold regex requires whitespace-left flanking, so `#**Foo**`
    // does not trigger bold conversion.
    expect(markdownToLinkedInUnicode('#**Foo**')).toBe('#**Foo**');
  });

  it('empty string short-circuits to empty', () => {
    expect(markdownToLinkedInUnicode('')).toBe('');
  });
});
