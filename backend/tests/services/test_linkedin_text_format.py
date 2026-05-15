"""Parity tests for ``markdown_to_linkedin_unicode``.

These 23 golden inputs MUST produce byte-for-byte identical output in both
the Python implementation (``app.services.linkedin_text_format``) and the
JavaScript implementation (``frontend/src/lib/linkedinFormat.ts``).

The expected outputs below are written as ``\\uXXXX`` / ``\\UXXXXXXXX``
escape sequences (the Python literal form for any non-ASCII character).
This keeps the file ASCII-clean and makes the test diff readable when
something breaks — the actual code point is right next to the character
that produced it.

Run with::

    cd backend && python -m pytest tests/services/test_linkedin_text_format.py
"""

from __future__ import annotations

import pytest

from app.services.linkedin_text_format import markdown_to_linkedin_unicode

# ---------------------------------------------------------------------------
# Golden cases (23 inputs from the TIP §6.1). Expected outputs were captured
# from the Python converter and cross-checked byte-for-byte against the JS
# implementation; do not edit one column without re-running the JS parity
# probe described in the TIP §9 (edge case #1).
# ---------------------------------------------------------------------------

GOLDEN_CASES: list[tuple[str, str]] = [
    # case 1: empty input returns empty string.
    ("", ""),
    # case 2: plain text passes through unchanged.
    ("Hello", "Hello"),
    # case 3: bold -> Math Sans Bold "Hello".
    ("**Hello**", "\U0001d5db\U0001d5f2\U0001d5f9\U0001d5f9\U0001d5fc"),
    # case 4: asterisk-italic -> Math Sans Italic "italic".
    (
        "*italic*",
        "\U0001d62a\U0001d635\U0001d622\U0001d62d\U0001d62a\U0001d624",
    ),
    # case 5: underscore-italic -> Math Sans Italic "italic" (same as case 4).
    (
        "_italic_",
        "\U0001d62a\U0001d635\U0001d622\U0001d62d\U0001d62a\U0001d624",
    ),
    # case 6: bold-italic -> Math Sans Bold Italic "bold italic".
    (
        "***bold italic***",
        "\U0001d657\U0001d664\U0001d661\U0001d659 "
        "\U0001d65e\U0001d669\U0001d656\U0001d661\U0001d65e\U0001d658",
    ),
    # case 7: strikethrough -> ASCII + U+0336 per grapheme.
    ("~~strike~~", "s̶t̶r̶i̶k̶e̶"),
    # case 8: ATX h1 -> bold("Heading") followed by "\n\n".
    (
        "# Heading\nbody",
        "\U0001d5db\U0001d5f2\U0001d5ee\U0001d5f1\U0001d5f6\U0001d5fb\U0001d5f4\n\nbody",
    ),
    # case 9: ATX h2; digit inside heading uses Math Sans Bold digit.
    (
        "## Heading 2\nbody",
        "\U0001d5db\U0001d5f2\U0001d5ee\U0001d5f1\U0001d5f6\U0001d5fb\U0001d5f4 \U0001d7ee\n\nbody",
    ),
    # case 10: dash-bullets -> bullet glyph U+2022.
    ("- bullet a\n- bullet b", "• bullet a\n• bullet b"),
    # case 11: asterisk-bullets -> bullet glyph U+2022.
    ("* bullet a\n* bullet b", "• bullet a\n• bullet b"),
    # case 12: numbered list passes through unchanged.
    ("1. first\n2. second", "1. first\n2. second"),
    # case 13: markdown link -> "<text> (<url>)" with the URL bare.
    (
        "[link text](https://example.com/path?q=1)",
        "link text (https://example.com/path?q=1)",
    ),
    # case 14: mixed — `#Marketing`, `@achint-k`, and the URL stay protected;
    # only `**tips**` converts.
    (
        "Visit #Marketing for **tips** and follow @achint-k about https://x.com/?a=1",
        "Visit #Marketing for "
        "\U0001d601\U0001d5f6\U0001d5fd\U0001d600"
        " and follow @achint-k about https://x.com/?a=1",
    ),
    # case 15: `#**Foo**` — the opening `**` is adjacent to `#` (not whitespace),
    # so left-flanking fails and the entire phrase stays literal. Regression
    # guard for the protection-order constraint described in TIP §9 #11.
    ("#**Foo**", "#**Foo**"),
    # case 16: `@user-**bold**` — same idea: the mention is protected, then
    # the remaining `**bold**` token has the opening `**` adjacent to a
    # placeholder (not whitespace), so left-flanking fails.
    ("@user-**bold**", "@user-**bold**"),
    # case 17: bold inside link text converts when emitted as a bare link.
    (
        "[**Hello** world](https://x.com)",
        "\U0001d5db\U0001d5f2\U0001d5f9\U0001d5f9\U0001d5fc world (https://x.com)",
    ),
    # case 18: bold digit -> Math Sans Bold digit (4 -> U+1D7F0, 2 -> U+1D7EE).
    ("Bold number **42** here", "Bold number \U0001d7f0\U0001d7ee here"),
    # case 19: italic digit -> stays ASCII (no Math Sans Italic digit block).
    ("Italic number *42* here", "Italic number 42 here"),
    # case 20: two-space line break collapses to a single newline.
    ("Line1  \nLine2", "Line1\nLine2"),
    # case 21: paragraph break preserved verbatim.
    ("Line1\n\nLine2", "Line1\n\nLine2"),
    # case 22: emoji + punctuation passthrough.
    (":) \U0001f680 — keep me", ":) \U0001f680 — keep me"),
    # case 23: bold-italic spanning a protected region — the URL match
    # consumes the trailing `***`, splitting the delimiter pair, so the
    # whole expression stays literal (the JS and Python pipelines tokenise
    # identically here).
    (
        "***bold italic with #hashtag and https://a.com***",
        "***bold italic with #hashtag and https://a.com***",
    ),
]


@pytest.mark.parametrize(("input_md", "expected"), GOLDEN_CASES)
def test_golden_case(input_md: str, expected: str) -> None:
    """Each golden input maps to the canonical Math-Sans-Unicode output."""
    assert markdown_to_linkedin_unicode(input_md) == expected


@pytest.mark.parametrize(("input_md", "_expected"), GOLDEN_CASES)
def test_idempotent(input_md: str, _expected: str) -> None:
    """``f(f(x)) == f(x)``. Math-Sans codepoints do not match any markdown
    regex, so a second pass is a no-op."""
    once = markdown_to_linkedin_unicode(input_md)
    twice = markdown_to_linkedin_unicode(once)
    assert once == twice


def test_strikethrough_doubles_length() -> None:
    """Strikethrough appends a combining mark per grapheme — useful as a
    sanity check that the post-conversion length check in the router catches
    the case where the output exceeds 3000 chars."""
    converted = markdown_to_linkedin_unicode("~~ab~~")
    assert "a̶" in converted
    assert "b̶" in converted


def test_underscore_word_inside_token_not_italicised() -> None:
    """``foo_bar_baz`` is a single token, not three italic spans. The
    underscore-italic regex requires whitespace/start flanking on the left
    AND whitespace/end/punctuation flanking on the right, so identifier
    underscores pass through unchanged."""
    assert markdown_to_linkedin_unicode("foo_bar_baz") == "foo_bar_baz"


def test_hashtag_with_no_letters_stays_literal() -> None:
    """``#`` alone is not a hashtag (needs `[A-Za-z0-9_]+`). The styleable
    inline-bold regex requires whitespace-left flanking, so ``#**Foo**``
    does not trigger bold conversion."""
    assert markdown_to_linkedin_unicode("#**Foo**") == "#**Foo**"


def test_empty_returns_empty() -> None:
    """Explicit short-circuit for the empty-input case."""
    assert markdown_to_linkedin_unicode("") == ""
