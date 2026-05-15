/**
 * Wire-format regression tests for the LinkedIn publish wrappers.
 *
 * These tests guarantee that `publishLinkedInNow` converts markdown bold /
 * italic / etc. into Math-Sans Unicode glyphs BEFORE the POST body leaves
 * the browser. Without these, a future refactor that drops the
 * `markdownToLinkedInUnicode(text)` call inside `publishLinkedInNow` would
 * silently regress to literal `**bold**` showing up on the LinkedIn feed.
 *
 * Coverage:
 *   - `**sdf**` (no spaces inside) -> 𝘀𝗱𝗳
 *   - `** sdf **` (the user-reported regression input) -> ` 𝘀𝗱𝗳 `
 *
 * The test isolates the wire path by mocking `getFirebaseAuth` so we never
 * touch Firebase, and stubs `fetch` to capture the JSON body of the POST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We must mock `@/lib/firebase` BEFORE importing `publishLinkedInNow` so
// the module's `getFirebaseAuth` symbol resolves to our stub.
vi.mock('@/lib/firebase', () => ({
  getFirebaseAuth: () => ({
    currentUser: {
      getIdToken: async () => 'fake-id-token',
    },
  }),
}));

import { publishLinkedInNow } from '@/lib/publish';

describe('publishLinkedInNow — markdown is converted in the wire payload', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () =>
      // The wrapper only reads `success`, `postUrn`, `postUrl`, so a minimal
      // success envelope is enough for these wire-format tests.
      new Response(
        JSON.stringify({
          success: true,
          postUrn: 'urn:li:share:1',
          postUrl: 'https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  async function capturedBodyText(text: string): Promise<string> {
    const result = await publishLinkedInNow('uid-1', text);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(String(init.body)) as { text: string };
    return parsed.text;
  }

  it('converts `**sdf**` to Math-Sans Bold before sending', async () => {
    const sent = await capturedBodyText('**sdf**');
    // Must NOT contain literal markdown asterisks
    expect(sent).not.toContain('**');
    // Must contain the converted Math-Sans Bold glyphs ('𝘀𝗱𝗳')
    expect(sent).toBe('\u{1D600}\u{1D5F1}\u{1D5F3}');
  });

  it('converts `** sdf **` (the user-reported input) to Math-Sans Bold before sending', async () => {
    const sent = await capturedBodyText('** sdf **');
    expect(sent).not.toContain('**');
    // Inner spaces are preserved; surrounding spaces are preserved because
    // the converter only substitutes the asterisks themselves.
    expect(sent).toBe(' \u{1D600}\u{1D5F1}\u{1D5F3} ');
  });

  it('converts mid-sentence bold without disturbing surrounding plain text', async () => {
    const sent = await capturedBodyText('hello **world** ok');
    expect(sent).not.toContain('**');
    expect(sent).toBe('hello \u{1D604}\u{1D5FC}\u{1D5FF}\u{1D5F9}\u{1D5F1} ok');
  });

  it('passes a string with no markdown unchanged', async () => {
    const sent = await capturedBodyText('plain text without markup');
    expect(sent).toBe('plain text without markup');
  });
});
