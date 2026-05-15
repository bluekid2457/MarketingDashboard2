"""Python mirror of the markdown -> LinkedIn-Unicode converter.

This module MUST produce byte-for-byte identical output to the JavaScript
implementation at ``frontend/src/lib/linkedinFormat.ts`` for the golden
inputs documented in the feature TIP. The scheduler worker
(``scheduler_worker.publish_one``) calls this function before handing the
text to ``publish_linkedin_text``, and the ``POST /publish/linkedin/now``
router also calls it as defense-in-depth (the converter is idempotent so
the double-conversion path is a safe no-op).

Pipeline:

  1. Recursively rewrite ``[text](url)`` link syntax into
     ``<styled-text> (<url>)`` so the URL ends up as a standalone
     auto-link target. Inner link text is itself converted.
  2. Mask each protected region (URL > hashtag > mention priority) with a
     single private-use placeholder so style regexes can rely on
     whitespace/start/end flanking without being broken by the contents
     of a URL or hashtag.
  3. Apply block transforms (heading, bullets, two-space line break).
  4. Apply inline transforms (bold-italic, bold, italic, strikethrough)
     with strict left/right flanking so adjacency-only delimiters such
     as ``#**Foo**`` and ``@user-**bold**`` stay literal.
  5. Restore the masked protected regions.

Math Alphanumeric Symbols: we deliberately use the **sans family** (Math
Sans Bold, Math Sans Italic, Math Sans Bold Italic, plus combining
strikethrough) because it has no Letterlike-Symbols collisions; do not
reintroduce the "regular" (non-sans) blocks here without re-auditing for
that hazard.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Protected-region regexes (exported for downstream re-use / debugging).
# ---------------------------------------------------------------------------

PROTECTED_HASHTAG_RE = re.compile(r"#[A-Za-z0-9_]+")
PROTECTED_MENTION_RE = re.compile(r"@[A-Za-z0-9_\-]+")
PROTECTED_URL_RE = re.compile(r"https?://[^\s)]+")

# ---------------------------------------------------------------------------
# Math Alphanumeric Symbols offset tables.
# ---------------------------------------------------------------------------

# "Math Sans Bold" — covers A-Z, a-z, 0-9.
_SANS_BOLD_UPPER_BASE = 0x1D5D4  # A
_SANS_BOLD_LOWER_BASE = 0x1D5EE  # a
_SANS_BOLD_DIGIT_BASE = 0x1D7EC  # 0

# "Math Sans Italic" — letters only (no digit substitution; digits stay ASCII).
_SANS_ITALIC_UPPER_BASE = 0x1D608  # A
_SANS_ITALIC_LOWER_BASE = 0x1D622  # a

# "Math Sans Bold Italic" — letters only.
_SANS_BOLD_ITALIC_UPPER_BASE = 0x1D63C  # A
_SANS_BOLD_ITALIC_LOWER_BASE = 0x1D656  # a

# Combining-strikethrough overlay (U+0336).
_COMBINING_STRIKETHROUGH = "\u0336"

# Placeholder envelope for masked protected regions. Private-use codepoints
# (U+E000/U+E001) are safe: they do not appear in real markdown and they
# are not whitespace, not punctuation, and not ASCII letters, so the
# inline-style flanking rules treat a masked region as a non-flanking
# neighbour — that is what makes ``@user-**bold**`` stay literal even
# after ``@user-`` is masked.
_PLACEHOLDER_OPEN = "\uE000"
_PLACEHOLDER_CLOSE = "\uE001"


def _style_char(ch: str, kind: str) -> str:
    if kind == "strike":
        return ch + _COMBINING_STRIKETHROUGH

    code = ord(ch)

    if kind == "bold":
        if 0x41 <= code <= 0x5A:
            return chr(_SANS_BOLD_UPPER_BASE + (code - 0x41))
        if 0x61 <= code <= 0x7A:
            return chr(_SANS_BOLD_LOWER_BASE + (code - 0x61))
        if 0x30 <= code <= 0x39:
            return chr(_SANS_BOLD_DIGIT_BASE + (code - 0x30))
        return ch

    if kind == "italic":
        if 0x41 <= code <= 0x5A:
            return chr(_SANS_ITALIC_UPPER_BASE + (code - 0x41))
        if 0x61 <= code <= 0x7A:
            return chr(_SANS_ITALIC_LOWER_BASE + (code - 0x61))
        # Digits intentionally pass through (no Math Sans Italic digit block).
        return ch

    # bold-italic
    if 0x41 <= code <= 0x5A:
        return chr(_SANS_BOLD_ITALIC_UPPER_BASE + (code - 0x41))
    if 0x61 <= code <= 0x7A:
        return chr(_SANS_BOLD_ITALIC_LOWER_BASE + (code - 0x61))
    # Digits intentionally pass through (no Math Sans Bold Italic digit block).
    return ch


def _style_string(text: str, kind: str) -> str:
    return "".join(_style_char(ch, kind) for ch in text)


# ---------------------------------------------------------------------------
# Stage 1 — link extraction
# ---------------------------------------------------------------------------

_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")


def _extract_markdown_links(md: str) -> str:
    def _sub(match: re.Match[str]) -> str:
        link_text = match.group(1)
        url = match.group(2)
        # Recursively convert the inner link text. The recursion terminates
        # immediately because once `[…](…)` is consumed there is no further
        # link syntax for the inner call to match.
        styled_inner = markdown_to_linkedin_unicode(link_text)
        return f"{styled_inner} ({url})"

    return _MARKDOWN_LINK_RE.sub(_sub, md)


# ---------------------------------------------------------------------------
# Stage 2 — masking
# ---------------------------------------------------------------------------


def _find_first_protected_match(s: str) -> tuple[int, str] | None:
    """Return ``(index, text)`` of the earliest protected match, with priority
    URL > hashtag > mention for tie-breaks (per TIP §5.1)."""
    candidates: list[tuple[int, int, str]] = []

    url_match = PROTECTED_URL_RE.search(s)
    if url_match is not None:
        candidates.append((url_match.start(), 0, url_match.group(0)))

    hashtag_match = PROTECTED_HASHTAG_RE.search(s)
    if hashtag_match is not None:
        candidates.append((hashtag_match.start(), 1, hashtag_match.group(0)))

    mention_match = PROTECTED_MENTION_RE.search(s)
    if mention_match is not None:
        candidates.append((mention_match.start(), 2, mention_match.group(0)))

    if not candidates:
        return None

    # Earliest index wins; on ties, lower priority value wins (URL = 0).
    candidates.sort(key=lambda c: (c[0], c[1]))
    index, _priority, text = candidates[0]
    return index, text


def _mask_protected(md: str) -> tuple[str, list[str]]:
    protected_texts: list[str] = []
    masked_chunks: list[str] = []
    cursor = 0

    while cursor < len(md):
        remainder = md[cursor:]
        next_match = _find_first_protected_match(remainder)
        if next_match is None:
            masked_chunks.append(remainder)
            break
        index, text = next_match
        if index > 0:
            masked_chunks.append(remainder[:index])
        idx = len(protected_texts)
        protected_texts.append(text)
        masked_chunks.append(f"{_PLACEHOLDER_OPEN}{idx}{_PLACEHOLDER_CLOSE}")
        cursor += index + len(text)

    return "".join(masked_chunks), protected_texts


def _restore_protected(masked: str, protected_texts: list[str]) -> str:
    if not protected_texts:
        return masked
    pattern = re.compile(f"{_PLACEHOLDER_OPEN}(\\d+){_PLACEHOLDER_CLOSE}")

    def _sub(match: re.Match[str]) -> str:
        idx = int(match.group(1))
        return protected_texts[idx] if 0 <= idx < len(protected_texts) else ""

    return pattern.sub(_sub, masked)


# ---------------------------------------------------------------------------
# Stage 3 — block transforms
# ---------------------------------------------------------------------------

_HEADING_RE = re.compile(r"^(#+)[ \t]+(.+?)[ \t]*$", re.MULTILINE)
_NEWLINE_COLLAPSE_RE = re.compile(r"\n{3,}")
_BULLET_RE = re.compile(r"^([ \t]*)[-*][ \t]+(.+)$", re.MULTILINE)
_TWO_SPACE_BREAK_RE = re.compile(r"  +\n")


def _apply_block_transforms(text: str) -> str:
    # Heading: render bold(content) followed by a single newline. The
    # subsequent newline-collapse pass squeezes any trailing blank line
    # down to a single double-newline.
    def _heading_sub(match: re.Match[str]) -> str:
        content = match.group(2).strip()
        return f"{_style_string(content, 'bold')}\n"

    out = _HEADING_RE.sub(_heading_sub, text)

    # Collapse 3+ consecutive newlines to a single double-newline so a
    # converted heading always renders with one blank line of breathing
    # room instead of stacking.
    out = _NEWLINE_COLLAPSE_RE.sub("\n\n", out)

    # Bullets: `^[-*][ \t]+...` -> `• ...`. Preserve leading indentation.
    def _bullet_sub(match: re.Match[str]) -> str:
        indent = match.group(1)
        body = match.group(2)
        return f"{indent}• {body}"

    out = _BULLET_RE.sub(_bullet_sub, out)

    # Two-space line break collapses to a single newline.
    out = _TWO_SPACE_BREAK_RE.sub("\n", out)

    return out


# ---------------------------------------------------------------------------
# Stage 4 — inline transforms (with strict left/right flanking).
# ---------------------------------------------------------------------------

# Left flanking: char before delimiter is start-of-input or whitespace.
# Right flanking: char after delimiter is end-of-input, whitespace, or a
# terminal-style punctuation mark. This is what makes `#**Foo**` and
# `@user-**bold**` stay literal: the opening `**` is preceded by `#`/`-`/
# placeholder which is neither start-of-input nor whitespace.
_LEFT_FLANK = r"(?:^|(?<=\s))"
_RIGHT_FLANK = r"(?=$|\s|[.,!?:;)])"

_BOLD_ITALIC_RE = re.compile(rf"{_LEFT_FLANK}\*\*\*([^*\n]+?)\*\*\*{_RIGHT_FLANK}")
_BOLD_RE = re.compile(rf"{_LEFT_FLANK}\*\*([^*\n]+?)\*\*{_RIGHT_FLANK}")
_ITALIC_AST_RE = re.compile(rf"{_LEFT_FLANK}\*([^*\n]+?)\*{_RIGHT_FLANK}")
_ITALIC_UND_RE = re.compile(rf"{_LEFT_FLANK}_([^_\n]+?)_{_RIGHT_FLANK}")
_STRIKE_RE = re.compile(rf"{_LEFT_FLANK}~~([^~\n]+?)~~{_RIGHT_FLANK}")


def _apply_inline_styles(text: str) -> str:
    out = text

    # Order: bold-italic (***) before bold (**) before italic (*).
    out = _BOLD_ITALIC_RE.sub(lambda m: _style_string(m.group(1), "bold-italic"), out)
    out = _BOLD_RE.sub(lambda m: _style_string(m.group(1), "bold"), out)
    out = _ITALIC_AST_RE.sub(lambda m: _style_string(m.group(1), "italic"), out)
    out = _ITALIC_UND_RE.sub(lambda m: _style_string(m.group(1), "italic"), out)
    out = _STRIKE_RE.sub(lambda m: _style_string(m.group(1), "strike"), out)

    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def markdown_to_linkedin_unicode(md: str) -> str:
    """Convert ``md`` (raw markdown) into the LinkedIn-Unicode form rendered
    on the feed. Returns ``""`` for empty input. Idempotent."""
    if not md:
        return ""

    # 1. Recursively expand markdown link syntax `[text](url)`.
    after_links = _extract_markdown_links(md)

    # 2. Mask protected regions so style regexes can't be confused by URLs,
    #    hashtags, or mentions.
    masked, protected_texts = _mask_protected(after_links)

    # 3. Block transforms.
    after_block = _apply_block_transforms(masked)

    # 4. Inline transforms.
    after_inline = _apply_inline_styles(after_block)

    # 5. Restore masked protected regions.
    return _restore_protected(after_inline, protected_texts)
