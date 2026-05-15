import { describe, expect, it, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';

import { usePersistentToggle } from '@/lib/usePersistentToggle';

/**
 * Unit tests for ``usePersistentToggle``. The hook backs the preview
 * collapse/expand state on /adapt, /review, and /publish, so the three
 * key behaviors covered here are the ones the page code depends on:
 *
 * 1. Initial value matches the supplied default when no key is persisted.
 * 2. Calling ``toggle()`` flips the value and writes ``"0"`` / ``"1"``
 *    to ``localStorage`` under the supplied key.
 * 3. A second mount of the hook against the same key reads the persisted
 *    value back, restoring the previous state across "reloads".
 *
 * Rendering the hook is done through a tiny harness component because
 * vitest + jsdom doesn't ship ``renderHook`` and pulling
 * ``@testing-library/react-hooks`` for one usage is overkill. The
 * harness writes the latest value into a probe div so assertions stay
 * straightforward.
 */

type HarnessProps = {
  storageKey: string;
  initial: boolean;
  onReady?: (toggle: (next?: boolean) => void) => void;
};

function Harness({ storageKey, initial, onReady }: HarnessProps) {
  const [value, toggle] = usePersistentToggle(storageKey, initial);
  // Surface the imperative toggle out to the test so we can call it inside
  // ``act``. We intentionally pass it via a ref-like callback every render —
  // ``act`` blocks ensure we always grab the latest ``toggle``.
  if (onReady) onReady(toggle);
  return <div data-testid="value">{value ? 'collapsed' : 'open'}</div>;
}

describe('usePersistentToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the initial value when localStorage is empty', () => {
    const { getByTestId } = render(<Harness storageKey="mdash:test:a" initial={false} />);
    expect(getByTestId('value').textContent).toBe('open');
  });

  it('returns the initial=true value when localStorage is empty', () => {
    const { getByTestId } = render(<Harness storageKey="mdash:test:b" initial={true} />);
    expect(getByTestId('value').textContent).toBe('collapsed');
  });

  it('flips the value and persists "1" on toggle()', () => {
    let toggleRef: ((next?: boolean) => void) | null = null;
    const { getByTestId } = render(
      <Harness
        storageKey="mdash:test:c"
        initial={false}
        onReady={(t) => {
          toggleRef = t;
        }}
      />,
    );

    expect(getByTestId('value').textContent).toBe('open');
    act(() => {
      toggleRef?.();
    });
    expect(getByTestId('value').textContent).toBe('collapsed');
    expect(window.localStorage.getItem('mdash:test:c')).toBe('1');

    act(() => {
      toggleRef?.();
    });
    expect(getByTestId('value').textContent).toBe('open');
    expect(window.localStorage.getItem('mdash:test:c')).toBe('0');
  });

  it('reads the persisted value on a second mount with the same key', () => {
    window.localStorage.setItem('mdash:test:d', '1');
    const { getByTestId } = render(<Harness storageKey="mdash:test:d" initial={false} />);
    // The hook applies the persisted value in a post-mount effect, so we
    // need to give React a chance to flush the resulting state update.
    // ``render`` already does that synchronously in jsdom, so the testid
    // text should already reflect the persisted "1" -> collapsed value.
    expect(getByTestId('value').textContent).toBe('collapsed');
  });

  it('accepts an explicit boolean override via toggle(next)', () => {
    let toggleRef: ((next?: boolean) => void) | null = null;
    const { getByTestId } = render(
      <Harness
        storageKey="mdash:test:e"
        initial={false}
        onReady={(t) => {
          toggleRef = t;
        }}
      />,
    );

    act(() => {
      toggleRef?.(true);
    });
    expect(getByTestId('value').textContent).toBe('collapsed');
    expect(window.localStorage.getItem('mdash:test:e')).toBe('1');

    act(() => {
      toggleRef?.(true);
    });
    // Idempotent — toggling to ``true`` again leaves the value at collapsed.
    expect(getByTestId('value').textContent).toBe('collapsed');
    expect(window.localStorage.getItem('mdash:test:e')).toBe('1');
  });
});
