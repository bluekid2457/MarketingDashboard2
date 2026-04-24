import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { getServerFirebaseDb } from '@/lib/firebaseServer';

type AngleStatus = 'active' | 'selected' | 'archived';

type PersistedAngle = {
  id: string;
  title: string;
  summary: string;
  sections: string[];
  status: AngleStatus;
  createdAt: number;
  selectedAt?: number;
};

type AngleSelectRequest = {
  userId: string;
  ideaId: string;
  selectedAngleId: string;
};

type AngleSelectResponse = {
  success: boolean;
  cleaned: {
    deletedCount: number;
    failedCount: number;
  };
  message: string;
  updatedAtMs?: number;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizePersistedAngles(value: unknown): PersistedAngle[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const candidate = entry as {
        id?: unknown;
        title?: unknown;
        summary?: unknown;
        sections?: unknown;
        status?: unknown;
        createdAt?: unknown;
        selectedAt?: unknown;
      };

      const id = asString(candidate.id);
      const title = asString(candidate.title);
      const summary = asString(candidate.summary);
      const sections = Array.isArray(candidate.sections)
        ? candidate.sections
            .map((section) => asString(section))
            .filter(Boolean)
        : [];

      if (!id || !title || !summary || sections.length === 0) {
        return null;
      }

      const createdAt = asNumber(candidate.createdAt) ?? Date.now();
      const status: AngleStatus = ['active', 'selected', 'archived'].includes(asString(candidate.status))
        ? (candidate.status as AngleStatus)
        : 'active';
      const selectedAt = asNumber(candidate.selectedAt);

      return {
        id,
        title,
        summary,
        sections,
        status,
        createdAt,
        ...(selectedAt !== null ? { selectedAt } : {}),
      } satisfies PersistedAngle;
    })
    .filter((entry): entry is PersistedAngle => Boolean(entry));
}

export async function POST(request: NextRequest): Promise<NextResponse<AngleSelectResponse | { error: string }>> {
  let body: AngleSelectRequest;

  try {
    body = (await request.json()) as AngleSelectRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const userId = asString(body.userId);
  const ideaId = asString(body.ideaId);
  const selectedAngleId = asString(body.selectedAngleId);
  const headerUserId = asString(request.headers.get('x-user-id') ?? request.headers.get('x-firebase-uid'));

  if (!userId || !ideaId || !selectedAngleId) {
    return NextResponse.json({ error: 'userId, ideaId, and selectedAngleId are required.' }, { status: 400 });
  }

  if (headerUserId && headerUserId !== userId) {
    return NextResponse.json({ error: 'Authenticated user does not match request userId.' }, { status: 403 });
  }

  try {
    const firestore = getServerFirebaseDb();
    const anglesRef = doc(firestore, 'users', userId, 'ideas', ideaId, 'workflow', 'angles');
    const snapshot = await getDoc(anglesRef);

    if (!snapshot.exists()) {
      return NextResponse.json({ error: 'No persisted angles were found for this idea.' }, { status: 404 });
    }

    const data = snapshot.data();
    const persistedAngles = sanitizePersistedAngles(data.angles);

    if (persistedAngles.length === 0) {
      return NextResponse.json({ error: 'No valid angle candidates are available for selection.' }, { status: 404 });
    }

    const selectedCandidate = persistedAngles.find((angle) => angle.id === selectedAngleId);
    if (!selectedCandidate) {
      return NextResponse.json({ error: 'selectedAngleId does not exist in current angle candidates.' }, { status: 404 });
    }

    const cleanupPending = Boolean(data.cleanup?.pending);
    const onlySelectedRemains = persistedAngles.length === 1 && persistedAngles[0]?.id === selectedAngleId;
    const alreadySelected = selectedCandidate.status === 'selected';

    if (onlySelectedRemains && alreadySelected && !cleanupPending) {
      return NextResponse.json({
        success: true,
        cleaned: {
          deletedCount: 0,
          failedCount: 0,
        },
        message: 'Angle selection was already finalized.',
        updatedAtMs: asNumber(data.updatedAtMs) ?? Date.now(),
      });
    }

    const nowMs = Date.now();
    const finalizedSelectedAngle: PersistedAngle = {
      ...selectedCandidate,
      status: 'selected',
      selectedAt: selectedCandidate.selectedAt ?? nowMs,
    };

    const unselectedAngles = persistedAngles.filter((angle) => angle.id !== selectedAngleId);

    try {
      // Hard cleanup path: keep only the selected angle in the canonical angles array.
      await setDoc(
        anglesRef,
        {
          ideaId,
          angles: [finalizedSelectedAngle],
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

      return NextResponse.json({
        success: true,
        cleaned: {
          deletedCount: unselectedAngles.length,
          failedCount: 0,
        },
        message: unselectedAngles.length > 0
          ? 'Angle selected and unselected candidates cleaned up.'
          : 'Angle selected. No unselected candidates needed cleanup.',
        updatedAtMs: nowMs,
      });
    } catch (cleanupError) {
      const archivedAngles = persistedAngles.map((angle) => {
        if (angle.id === selectedAngleId) {
          return finalizedSelectedAngle;
        }

        return {
          ...angle,
          status: 'archived' as const,
        } satisfies PersistedAngle;
      });

      await setDoc(
        anglesRef,
        {
          ideaId,
          angles: archivedAngles,
          selectedAngleId,
          updatedAt: serverTimestamp(),
          updatedAtMs: nowMs,
          cleanup: {
            pending: true,
            failedIds: unselectedAngles.map((angle) => angle.id),
            lastAttemptedAtMs: nowMs,
            reason: cleanupError instanceof Error ? cleanupError.message : 'cleanup_write_failed',
          },
        },
        { merge: true },
      );

      return NextResponse.json({
        success: true,
        cleaned: {
          deletedCount: 0,
          failedCount: unselectedAngles.length,
        },
        message: 'Angle selected. Unselected candidates were soft-flagged as archived for retry cleanup.',
        updatedAtMs: nowMs,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to finalize angle selection.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
