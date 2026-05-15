'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Persistent boolean toggle backed by ``localStorage``.
 *
 * The hook is SSR-safe: on the first render (server and client both) it
 * returns the supplied ``initial`` value so React hydration matches the
 * server-rendered markup. After mount, an effect reads the persisted value
 * from ``localStorage`` and applies it. Subsequent ``toggle()`` calls update
 * both React state and ``localStorage``. All ``localStorage`` access is
 * wrapped in ``try / catch`` so private-mode browsers and disabled-storage
 * environments degrade gracefully (the toggle still works in-memory).
 *
 * Storage format is intentionally trivial: ``"1"`` means *collapsed / true*
 * and ``"0"`` (or an absent key) means *expanded / false*. This keeps the
 * persisted value easy to inspect from DevTools when debugging.
 *
 * @param storageKey - Unique key used in ``localStorage`` for this toggle.
 *                     Callers should namespace keys per surface, e.g.
 *                     ``mdash:previewCollapse:adapt``.
 * @param initial    - Initial value used during SSR and before the first
 *                     post-mount effect fires.
 * @returns A ``[value, toggle]`` tuple. ``toggle()`` flips the current value;
 *          ``toggle(true)`` / ``toggle(false)`` sets an explicit value.
 */
export function usePersistentToggle(
  storageKey: string,
  initial: boolean,
): [boolean, (next?: boolean) => void] {
  const [value, setValue] = useState<boolean>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === '1') setValue(true);
      else if (raw === '0') setValue(false);
    } catch {
      /* localStorage unavailable (private mode, SecurityError, etc.) */
    }
  }, [storageKey]);

  const toggle = useCallback(
    (next?: boolean) => {
      setValue((previous) => {
        const resolved = typeof next === 'boolean' ? next : !previous;
        try {
          window.localStorage.setItem(storageKey, resolved ? '1' : '0');
        } catch {
          /* localStorage unavailable */
        }
        return resolved;
      });
    },
    [storageKey],
  );

  return [value, toggle];
}
