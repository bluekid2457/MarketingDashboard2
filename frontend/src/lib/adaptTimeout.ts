export const ADAPT_PROVIDER_TIMEOUT_MS = 45_000;
export const ADAPT_CLIENT_TIMEOUT_MS = ADAPT_PROVIDER_TIMEOUT_MS + 2_000;

const ABORT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);
const ABORT_ERROR_CODES = new Set(['ABORT_ERR', 'UND_ERR_ABORTED']);
const ABORT_MESSAGE_PATTERN = /\b(abort(?:ed)?|operation was aborted|signal is aborted|request was cancelled|request was canceled)\b/i;

function getNestedErrorValue(error: unknown, key: 'name' | 'message' | 'code' | 'cause'): unknown {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  return (error as Record<'name' | 'message' | 'code' | 'cause', unknown>)[key];
}

export function buildAdaptGenerationTimeoutMessage(timeoutMs: number = ADAPT_PROVIDER_TIMEOUT_MS): string {
  return `AI adaptation timed out after ${Math.round(timeoutMs / 1000)} seconds. Please try again.`;
}

export function isAbortLikeError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);

    const name = getNestedErrorValue(current, 'name');
    if (typeof name === 'string' && ABORT_ERROR_NAMES.has(name)) {
      return true;
    }

    const code = getNestedErrorValue(current, 'code');
    if (typeof code === 'string' && ABORT_ERROR_CODES.has(code)) {
      return true;
    }

    const message = getNestedErrorValue(current, 'message');
    if (typeof message === 'string' && ABORT_MESSAGE_PATTERN.test(message)) {
      return true;
    }

    const cause = getNestedErrorValue(current, 'cause');
    if (cause) {
      queue.push(cause);
    }
  }

  return false;
}
