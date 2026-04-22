import { NextRequest, NextResponse } from 'next/server';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';

import { getServerFirebaseDb } from '@/lib/firebaseServer';

type AngleStatus = 'active' | 'selected' | 'archived';

type PersistAngle = {
  id: string;
  title: string;
  summary: string;
  sections: string[];
  status: AngleStatus;
  createdAt: number;
  selectedAt?: number;
};

type AnglePersistRequest = {
  userId: string;
  ideaId: string;
  angles: PersistAngle[];
  selectedAngleId: string | null;
  baseUpdatedAtMs?: number;
};

type AnglePersistResponse = {
  success: boolean;
  persistedIds: string[];
  message: string;
  updatedAtMs?: number;
};

const MAX_TRANSACTION_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryablePersistenceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  return code === 'aborted'
    || code === 'deadline-exceeded'
    || code === 'unavailable'
    || name === 'FirebaseError'
    || /aborted|deadline|unavailable/i.test(message);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validateRequest(body: AnglePersistRequest): { validAngles: PersistAngle[]; selectedAngleId: string | null } {
  const ideaId = asString(body.ideaId);
  if (!ideaId) {
    throw new Error('ideaId is required.');
  }

  if (!Array.isArray(body.angles) || body.angles.length === 0) {
    throw new Error('angles must be a non-empty array.');
  }

  const validAngles = body.angles.map((candidate, index) => {
    const id = asString(candidate.id);
    const title = asString(candidate.title);
    const summary = asString(candidate.summary);
    const sections = Array.isArray(candidate.sections)
      ? candidate.sections
          .map((section) => asString(section))
          .filter(Boolean)
      : [];

    if (!id || !title || !summary || sections.length === 0) {
      throw new Error(`angles[${index}] is missing required fields.`);
    }

    if (!['active', 'selected', 'archived'].includes(candidate.status)) {
      throw new Error(`angles[${index}] has an invalid status.`);
    }

    const createdAt = asNumber(candidate.createdAt);
    if (createdAt === null) {
      throw new Error(`angles[${index}] createdAt must be a timestamp in ms.`);
    }

    const selectedAtCandidate = candidate.selectedAt === undefined ? undefined : asNumber(candidate.selectedAt);
    if (candidate.selectedAt !== undefined && selectedAtCandidate === null) {
      throw new Error(`angles[${index}] selectedAt must be a timestamp in ms when provided.`);
    }
    const selectedAt = selectedAtCandidate ?? undefined;

    return {
      id,
      title,
      summary,
      sections,
      status: candidate.status,
      createdAt,
      ...(selectedAt !== undefined ? { selectedAt } : {}),
    } satisfies PersistAngle;
  });

  const selectedAngleId = body.selectedAngleId === null ? null : asString(body.selectedAngleId);
  if (selectedAngleId && !validAngles.some((angle) => angle.id === selectedAngleId)) {
    throw new Error('selectedAngleId must reference one of the provided angles.');
  }

  return { validAngles, selectedAngleId };
}

export async function POST(request: NextRequest): Promise<NextResponse<AnglePersistResponse | { error: string }>> {
  let body: AnglePersistRequest;

  try {
    body = (await request.json()) as AnglePersistRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const userId = asString(body.userId);
  const ideaId = asString(body.ideaId);
  const headerUserId = asString(request.headers.get('x-user-id') ?? request.headers.get('x-firebase-uid'));

  if (!userId || !ideaId) {
    return NextResponse.json({ error: 'userId and ideaId are required.' }, { status: 400 });
  }

  if (headerUserId && headerUserId !== userId) {
    return NextResponse.json({ error: 'Authenticated user does not match request userId.' }, { status: 403 });
  }

  let validatedAngles: PersistAngle[];
  let selectedAngleId: string | null;
  try {
    ({ validAngles: validatedAngles, selectedAngleId } = validateRequest(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid angle payload.' },
      { status: 400 },
    );
  }

  const baseUpdatedAtMs = asNumber(body.baseUpdatedAtMs);
  const nowMs = Date.now();

  try {
    const firestore = getServerFirebaseDb();
    const anglesRef = doc(firestore, 'users', userId, 'ideas', ideaId, 'workflow', 'angles');

    let transactionCompleted = false;

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        await runTransaction(firestore, async (transaction) => {
          const snapshot = await transaction.get(anglesRef);
          const existingUpdatedAtMs = asNumber(snapshot.data()?.updatedAtMs);

          if (baseUpdatedAtMs !== null && existingUpdatedAtMs !== null && existingUpdatedAtMs > baseUpdatedAtMs) {
            const conflictError = new Error('ANGLE_VERSION_CONFLICT');
            conflictError.name = 'AngleVersionConflictError';
            throw conflictError;
          }

          transaction.set(
            anglesRef,
            {
              ideaId,
              angles: validatedAngles,
              selectedAngleId,
              updatedAt: serverTimestamp(),
              updatedAtMs: nowMs,
              cleanup: {
                pending: false,
                failedIds: [],
                lastAttemptedAtMs: nowMs,
              },
            },
            { merge: true },
          );
        });

        transactionCompleted = true;
        break;
      } catch (error) {
        if (error instanceof Error && (error.name === 'AngleVersionConflictError' || error.message === 'ANGLE_VERSION_CONFLICT')) {
          throw error;
        }

        if (attempt < MAX_TRANSACTION_ATTEMPTS && isRetryablePersistenceError(error)) {
          await delay(100 * attempt);
          continue;
        }

        throw error;
      }
    }

    if (!transactionCompleted) {
      throw new Error('Unable to persist angles right now. Please retry.');
    }

    return NextResponse.json({
      success: true,
      persistedIds: validatedAngles.map((angle) => angle.id),
      message: 'Angles persisted successfully.',
      updatedAtMs: nowMs,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AngleVersionConflictError' || error.message === 'ANGLE_VERSION_CONFLICT')) {
      return NextResponse.json(
        {
          success: false,
          persistedIds: [],
          message: 'A newer angle set already exists. Refresh before persisting to prevent overwriting concurrent regeneration.',
        },
        { status: 409 },
      );
    }

    const message = error instanceof Error ? error.message : 'Unable to persist angles right now.';
    return NextResponse.json(
      {
        success: false,
        persistedIds: [],
        message: `Angle persistence failed: ${message}`,
      },
      { status: 500 },
    );
  }
}
