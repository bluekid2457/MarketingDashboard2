const EXA_KEY_STORAGE = 'exa_api_key';

export function loadExaKey(): string {
  try {
    return localStorage.getItem(EXA_KEY_STORAGE)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function saveExaKey(key: string): void {
  try {
    localStorage.setItem(EXA_KEY_STORAGE, key.trim());
  } catch {
    // Ignore storage errors (e.g. private browsing quota)
  }
}
