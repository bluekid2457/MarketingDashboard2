/**
 * NOTE: This converter is platform-neutral. It applies identically to
 * LinkedIn, Twitter, and Instagram captions — all three platforms accept
 * plain-text bodies only, and the Math-Sans Unicode substitution is the
 * standard "visual bold/italic" trick used on those feeds. The existing
 * name is preserved for backwards compatibility; new call sites should
 * prefer the `markdownToUnicodePost` alias re-exported below.
 */

/**
 * Pure, zero-dependency markdown → LinkedIn-Unicode converter.
 *
 * LinkedIn's UGC API accepts only plain text — the feed cannot render any
 * markup. To get visible bold / italic / strikethrough on the feed, ASCII
 * letters must be substituted with Math Alphanumeric Symbols (U+1D400 –
 * U+1D7FF). We deliberately use the **sans family** (Math Sans Bold,
 * Math Sans Italic, Math Sans Bold Italic, plus combining strikethrough)
 * because it has no Letterlike-Symbols collisions; do not reintroduce the
 * "regular" (non-sans) blocks here without re-auditing for that hazard.
 *
 * Pipeline:
 *   1. Recursively rewrite ``[text](url)`` link syntax into
 *      ``<styled-text> (<url>)`` so the URL ends up as a standalone
 *      auto-link target. Inner link text is itself converted.
 *   2. Mask each protected region (URL > hashtag > mention priority) with
 *      a single private-use placeholder so style regexes can rely on
 *      whitespace/start/end flanking without being broken by the contents
 *      of a URL or hashtag.
 *   3. Apply block transforms (heading, bullets, two-space line break).
 *   4. Apply inline transforms (bold-italic, bold, italic, strikethrough)
 *      with strict left/right flanking so adjacency-only delimiters such
 *      as ``#**Foo**`` and ``@user-**bold**`` stay literal.
 *   5. Restore the masked protected regions.
 *
 * Idempotent: Math-Sans codepoints are outside the BMP and do not match
 * any markdown regex, so ``f(f(x)) === f(x)``.
 */

// ---------------------------------------------------------------------------
// Protected-region regexes (exported for downstream re-use / debugging).
// ---------------------------------------------------------------------------

export const PROTECTED_HASHTAG_RE: RegExp = /#[A-Za-z0-9_]+/g;
export const PROTECTED_MENTION_RE: RegExp = /@[A-Za-z0-9_-]+/g;
export const PROTECTED_URL_RE: RegExp = /https?:\/\/[^\s)]+/g;

// ---------------------------------------------------------------------------
// Math Alphanumeric Symbols offset tables.
// ---------------------------------------------------------------------------

// "Math Sans Bold" — covers A-Z, a-z, 0-9.
const SANS_BOLD_UPPER_BASE = 0x1d5d4; // A
const SANS_BOLD_LOWER_BASE = 0x1d5ee; // a
const SANS_BOLD_DIGIT_BASE = 0x1d7ec; // 0

// "Math Sans Italic" — letters only (no digit substitution; digits stay ASCII).
const SANS_ITALIC_UPPER_BASE = 0x1d608; // A
const SANS_ITALIC_LOWER_BASE = 0x1d622; // a

// "Math Sans Bold Italic" — letters only.
const SANS_BOLD_ITALIC_UPPER_BASE = 0x1d63c; // A
const SANS_BOLD_ITALIC_LOWER_BASE = 0x1d656; // a

// Combining-strikethrough overlay (U+0336).
const COMBINING_STRIKETHROUGH = '\u0336';

// Placeholder envelope for masked protected regions. Private-use chars are
// safe: they do not appear in real markdown and they are not whitespace, not
// punctuation, and not ASCII letters, so the inline-style flanking rules
// treat a masked region as a non-flanking neighbour.
const PLACEHOLDER_OPEN = '\uE000';
const PLACEHOLDER_CLOSE = '\uE001';

type StyleKind = 'bold' | 'italic' | 'bold-italic' | 'strike';

function isAsciiUpper(code: number): boolean {
  return code >= 0x41 && code <= 0x5a;
}

function isAsciiLower(code: number): boolean {
  return code >= 0x61 && code <= 0x7a;
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function styleChar(ch: string, kind: StyleKind): string {
  if (kind === 'strike') {
    return ch + COMBINING_STRIKETHROUGH;
  }

  const code = ch.codePointAt(0);
  if (code === undefined) {
    return ch;
  }

  if (kind === 'bold') {
    if (isAsciiUpper(code)) return String.fromCodePoint(SANS_BOLD_UPPER_BASE + (code - 0x41));
    if (isAsciiLower(code)) return String.fromCodePoint(SANS_BOLD_LOWER_BASE + (code - 0x61));
    if (isAsciiDigit(code)) return String.fromCodePoint(SANS_BOLD_DIGIT_BASE + (code - 0x30));
    return ch;
  }

  if (kind === 'italic') {
    if (isAsciiUpper(code)) return String.fromCodePoint(SANS_ITALIC_UPPER_BASE + (code - 0x41));
    if (isAsciiLower(code)) return String.fromCodePoint(SANS_ITALIC_LOWER_BASE + (code - 0x61));
    // Digits intentionally pass through (no Math Sans Italic digit block).
    return ch;
  }

  // bold-italic
  if (isAsciiUpper(code)) return String.fromCodePoint(SANS_BOLD_ITALIC_UPPER_BASE + (code - 0x41));
  if (isAsciiLower(code)) return String.fromCodePoint(SANS_BOLD_ITALIC_LOWER_BASE + (code - 0x61));
  // Digits intentionally pass through (no Math Sans Bold Italic digit block).
  return ch;
}

function styleString(text: string, kind: StyleKind): string {
  let out = '';
  // Iterate by code point so any surrogate-pair character (emoji) is copied
  // through intact without splitting into orphan surrogates.
  for (const ch of text) {
    out += styleChar(ch, kind);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 1 — link extraction
// ---------------------------------------------------------------------------

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function extractMarkdownLinks(md: string): string {
  return md.replace(MARKDOWN_LINK_RE, (_match, linkText: string, url: string) => {
    // Recursively convert the inner link text. The recursion terminates
    // immediately because once `[…](…)` is consumed there is no further
    // link syntax for the inner call to match (and even if there were,
    // each pass strictly shrinks the bracket count).
    const styledInner = markdownToLinkedInUnicode(linkText);
    return `${styledInner} (${url})`;
  });
}

// ---------------------------------------------------------------------------
// Stage 2 — masking
// ---------------------------------------------------------------------------

type ProtectedMatch = { index: number; text: string };

function findFirstProtectedMatch(s: string): ProtectedMatch | null {
  // Pick the EARLIEST start across all three patterns, with priority
  // URL > hashtag > mention for tie-breaks (per TIP §5.1).
  const candidates: Array<{ index: number; text: string; priority: number }> = [];

  const urlRe = new RegExp(PROTECTED_URL_RE.source, 'g');
  const urlMatch = urlRe.exec(s);
  if (urlMatch) {
    candidates.push({ index: urlMatch.index, text: urlMatch[0], priority: 0 });
  }

  const hashRe = new RegExp(PROTECTED_HASHTAG_RE.source, 'g');
  const hashMatch = hashRe.exec(s);
  if (hashMatch) {
    candidates.push({ index: hashMatch.index, text: hashMatch[0], priority: 1 });
  }

  const mentionRe = new RegExp(PROTECTED_MENTION_RE.source, 'g');
  const mentionMatch = mentionRe.exec(s);
  if (mentionMatch) {
    candidates.push({ index: mentionMatch.index, text: mentionMatch[0], priority: 2 });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.priority - b.priority;
  });

  return { index: candidates[0].index, text: candidates[0].text };
}

function maskProtected(md: string): { masked: string; protectedTexts: string[] } {
  const protectedTexts: string[] = [];
  let masked = '';
  let cursor = 0;

  while (cursor < md.length) {
    const remainder = md.slice(cursor);
    const next = findFirstProtectedMatch(remainder);

    if (next === null) {
      masked += remainder;
      break;
    }

    if (next.index > 0) {
      masked += remainder.slice(0, next.index);
    }
    const index = protectedTexts.length;
    protectedTexts.push(next.text);
    masked += `${PLACEHOLDER_OPEN}${index}${PLACEHOLDER_CLOSE}`;
    cursor += next.index + next.text.length;
  }

  return { masked, protectedTexts };
}

function restoreProtected(masked: string, protectedTexts: string[]): string {
  if (protectedTexts.length === 0) {
    return masked;
  }
  const restoreRe = new RegExp(`${PLACEHOLDER_OPEN}(\\d+)${PLACEHOLDER_CLOSE}`, 'g');
  return masked.replace(restoreRe, (_m, idx: string) => protectedTexts[Number(idx)] ?? '');
}

// ---------------------------------------------------------------------------
// Stage 3 — block transforms
// ---------------------------------------------------------------------------

function applyBlockTransforms(text: string): string {
  // Heading: `^#+\s+...` line. Render bold(content) followed by a single
  // newline; the subsequent newline-collapse pass squeezes any trailing
  // blank line down to a single double-newline.
  let out = text.replace(/^(#+)[ \t]+(.+?)[ \t]*$/gm, (_m, _hashes: string, content: string) => {
    return `${styleString(content.trim(), 'bold')}\n`;
  });

  // Collapse 2+ consecutive newlines to a single double-newline so a
  // converted heading always renders with one blank line of breathing room
  // instead of stacking. The TIP only mandates this AFTER headings, but
  // collapsing globally is a strict superset and matches the Python mirror.
  out = out.replace(/\n{3,}/g, '\n\n');

  // Bullets: `^[-*][ \t]+...` → `• ...`. Preserve leading indentation. No
  // nested-bullet glyphs.
  out = out.replace(/^([ \t]*)[-*][ \t]+(.+)$/gm, (_m, indent: string, body: string) => {
    return `${indent}• ${body}`;
  });

  // Two-space line break (markdown's `  \n`) collapses to a single newline.
  out = out.replace(/  +\n/g, '\n');

  return out;
}

// ---------------------------------------------------------------------------
// Stage 4 — inline transforms (with strict left/right flanking).
// ---------------------------------------------------------------------------

// Left flanking: char before delimiter is start-of-input or whitespace.
// Right flanking: char after delimiter is end-of-input, whitespace, or a
// terminal-style punctuation mark. This is what makes `#**Foo**` and
// `@user-**bold**` stay literal: the opening `**` is preceded by `#`/`-`/
// placeholder which is neither start-of-input nor whitespace.
const RIGHT_FLANK = `(?=$|\\s|[.,!?:;)])`;
const LEFT_FLANK = `(?:^|(?<=\\s))`;

function applyInlineStyles(text: string): string {
  let out = text;

  // Order: bold-italic (***) before bold (**) before italic (*).
  out = out.replace(
    new RegExp(`${LEFT_FLANK}\\*\\*\\*([^*\\n]+?)\\*\\*\\*${RIGHT_FLANK}`, 'g'),
    (_m, inner: string) => styleString(inner, 'bold-italic'),
  );

  out = out.replace(
    new RegExp(`${LEFT_FLANK}\\*\\*([^*\\n]+?)\\*\\*${RIGHT_FLANK}`, 'g'),
    (_m, inner: string) => styleString(inner, 'bold'),
  );

  out = out.replace(
    new RegExp(`${LEFT_FLANK}\\*([^*\\n]+?)\\*${RIGHT_FLANK}`, 'g'),
    (_m, inner: string) => styleString(inner, 'italic'),
  );

  // Underscore-italic — same flanking discipline so `foo_bar_baz` (an
  // ASCII identifier) is not accidentally italicised.
  out = out.replace(
    new RegExp(`${LEFT_FLANK}_([^_\\n]+?)_${RIGHT_FLANK}`, 'g'),
    (_m, inner: string) => styleString(inner, 'italic'),
  );

  // Strikethrough — same flanking discipline.
  out = out.replace(
    new RegExp(`${LEFT_FLANK}~~([^~\\n]+?)~~${RIGHT_FLANK}`, 'g'),
    (_m, inner: string) => styleString(inner, 'strike'),
  );

  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Convert ``md`` (raw markdown) into the LinkedIn-Unicode form rendered on
 * the feed. Returns ``""`` for empty input. Idempotent.
 */
export function markdownToLinkedInUnicode(md: string): string {
  if (!md) {
    return '';
  }

  // 1. Recursively expand markdown link syntax `[text](url)`.
  const afterLinks = extractMarkdownLinks(md);

  // 2. Mask protected regions so style regexes can't be confused by URLs,
  //    hashtags, or mentions.
  const { masked, protectedTexts } = maskProtected(afterLinks);

  // 3. Block transforms.
  const afterBlock = applyBlockTransforms(masked);

  // 4. Inline transforms.
  const afterInline = applyInlineStyles(afterBlock);

  // 5. Restore masked protected regions.
  return restoreProtected(afterInline, protectedTexts);
}

export { markdownToLinkedInUnicode as markdownToUnicodePost };
