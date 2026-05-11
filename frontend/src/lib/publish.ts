/**
 * Browser-side wrappers around the FastAPI publish endpoints.
 *
 * Each helper NEVER throws — every failure mode is surfaced as a typed
 * discriminated-union result so callers can branch without `try`/`catch`.
 */

import { getFirebaseAuth } from '@/lib/firebase';
import { getBackendApiBaseUrl } from '@/lib/integrations';

export type PublishVisibility = 'PUBLIC' | 'CONNECTIONS';

export type PublishSuccess = {
  success: true;
  postUrn: string;
  postUrl: string;
};

export type PublishFailure = {
  success: false;
  error: string;
  status: number;
  providerError?: unknown;
};

export type PublishResult = PublishSuccess | PublishFailure;

type RawPublishEnvelope = {
  success?: unknown;
  postUrn?: unknown;
  postUrl?: unknown;
  error?: unknown;
  status?: unknown;
  providerError?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Publish a text-only post to LinkedIn on behalf of `userId`.
 *
 * Behavior:
 * - Requires that the Firebase Web SDK be initialized and the user signed
 *   in. When no current user is available, returns
 *   `{ success: false, error: 'not_signed_in', status: 401 }` without
 *   making any network call.
 * - Always resolves; never rejects/throws.
 */
export async function publishLinkedInNow(
  userId: string,
  text: string,
  opts?: { visibility?: PublishVisibility },
): Promise<PublishResult> {
  const auth = getFirebaseAuth();
  const currentUser = auth?.currentUser ?? null;
  if (!currentUser) {
    return { success: false, error: 'not_signed_in', status: 401 };
  }

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken();
  } catch {
    return { success: false, error: 'not_signed_in', status: 401 };
  }

  const baseUrl = getBackendApiBaseUrl();
  const visibility: PublishVisibility = opts?.visibility ?? 'PUBLIC';

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/publish/linkedin/now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ userId, text, visibility }),
    });
  } catch {
    return { success: false, error: 'network', status: 0 };
  }

  let parsed: RawPublishEnvelope | null = null;
  try {
    parsed = (await response.json()) as RawPublishEnvelope;
  } catch {
    return { success: false, error: 'network', status: 0 };
  }

  if (parsed && parsed.success === true) {
    return {
      success: true,
      postUrn: asString(parsed.postUrn),
      postUrl: asString(parsed.postUrl),
    };
  }

  // Failure body — normalize fields so the caller can rely on them.
  const failureStatus =
    asNumber(parsed?.status) ?? (response.status > 0 ? response.status : 0);

  return {
    success: false,
    error: asString(parsed?.error) || 'unknown',
    status: failureStatus,
    providerError: parsed?.providerError,
  };
}

// ---------------------------------------------------------------------------
// scheduleLinkedInPost — server-side LinkedIn schedule via the new
// POST /api/v1/publish/schedule endpoint (Pattern B: one-shot EventBridge).
// ---------------------------------------------------------------------------

export type ScheduleLinkedInArgs = {
  userId: string;
  scheduledForMs: number;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  articleTitle: string;
  contentSnapshotLinkedIn: string;
  visibility?: PublishVisibility;
};

export type ScheduleSuccess = {
  success: true;
  scheduledPostId: string;
  eventBridgeScheduleName: string | null;
};

export type ScheduleFailure = {
  success: false;
  error: string;
  status: number;
};

export type ScheduleResult = ScheduleSuccess | ScheduleFailure;

/**
 * Server-side schedule a LinkedIn publish via the FastAPI backend. The
 * backend writes the `scheduledPosts` row AND provisions the one-shot
 * EventBridge schedule. Never throws.
 *
 * Returns `eventBridgeScheduleName: null` in local-dev (when the backend
 * AWS env is unset and the EventBridge call no-ops); the Firestore row
 * is still written, so the legacy sweeper picks it up.
 */
export async function scheduleLinkedInPost(
  args: ScheduleLinkedInArgs,
): Promise<ScheduleResult> {
  const auth = getFirebaseAuth();
  const currentUser = auth?.currentUser ?? null;
  if (!currentUser) {
    return { success: false, error: 'not_signed_in', status: 401 };
  }

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken();
  } catch {
    return { success: false, error: 'not_signed_in', status: 401 };
  }

  const baseUrl = getBackendApiBaseUrl();
  const body = {
    userId: args.userId,
    scheduledForMs: args.scheduledForMs,
    platforms: ['linkedin'],
    ideaId: args.ideaId,
    angleId: args.angleId,
    ideaTopic: args.ideaTopic,
    angleTitle: args.angleTitle,
    articleTitle: args.articleTitle,
    contentSnapshot: { linkedin: args.contentSnapshotLinkedIn },
    visibility: args.visibility ?? 'PUBLIC',
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/publish/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { success: false, error: 'network', status: 0 };
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    return { success: false, error: 'network', status: 0 };
  }

  if (response.ok && parsed && parsed.success === true) {
    return {
      success: true,
      scheduledPostId: asString(parsed.scheduledPostId),
      eventBridgeScheduleName:
        typeof parsed.eventBridgeScheduleName === 'string'
          ? parsed.eventBridgeScheduleName
          : null,
    };
  }

  const detail =
    typeof parsed?.detail === 'string'
      ? parsed.detail
      : typeof parsed?.error === 'string'
      ? parsed.error
      : 'unknown';
  return { success: false, error: detail, status: response.status || 0 };
}
