const SESSION_TS_KEY = 'session_started_at';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day

export function markSessionStart(): void {
  try {
    localStorage.setItem(SESSION_TS_KEY, String(Date.now()));
  } catch {
    // ignore quota / private-browsing errors
  }
}

export function isSessionExpired(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_TS_KEY);
    if (!raw) return true; // no timestamp → treat as expired so a fresh login is required
    const startedAt = Number(raw);
    if (!Number.isFinite(startedAt)) return true;
    return Date.now() - startedAt > SESSION_DURATION_MS;
  } catch {
    return true;
  }
}

export function clearSessionMark(): void {
  try {
    localStorage.removeItem(SESSION_TS_KEY);
  } catch {
    // ignore
  }
}
