/**
 * Orphan detection and cleanup utilities.
 *
 * A storyboard doc at `users/{uid}/drafts/{draftId}` is an "orphan storyboard"
 * if its parent idea (`users/{uid}/ideas/{draftDoc.ideaId}`) has been deleted.
 *
 * An adaptation doc at `users/{uid}/adaptations/{adaptationId}` is an
 * "orphan adaptation" if its parent idea has been deleted.
 *
 * Detection is defensive (read-time only) and best-effort: parallel writes that
 * recreate the parent idea will simply cause the orphan to be hidden again on
 * the next list render. Cleanup is user-controlled (no Firestore triggers).
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
} from 'firebase/firestore';

import { getFirebaseDb } from '@/lib/firebase';

export type OrphanRecord = {
  id: string;
  ideaTopic: string;
  angleTitle: string;
};

export type OrphanCleanupSelection = {
  storyboards: string[];
  adaptations: string[];
};

function asTrimmedString(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback;
}

/**
 * Resolve which `ideaId` values point to ideas that no longer exist.
 *
 * Caches existence lookups by `ideaId` so a single call only fetches each
 * parent idea document once even if many drafts share the same parent.
 */
async function resolveMissingIdeaIds(
  uid: string,
  ideaIds: string[],
): Promise<Set<string>> {
  const db = getFirebaseDb();
  const missing = new Set<string>();
  if (!db) {
    return missing;
  }

  const cache = new Map<string, boolean>();
  const uniqueIdeaIds = Array.from(new Set(ideaIds.filter((id) => id.length > 0)));

  await Promise.all(
    uniqueIdeaIds.map(async (ideaId) => {
      if (cache.has(ideaId)) {
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', uid, 'ideas', ideaId));
        const exists = snap.exists();
        cache.set(ideaId, exists);
        if (!exists) {
          missing.add(ideaId);
        }
      } catch {
        // On read errors, treat as "exists" (do NOT mark as orphan) so we
        // never delete based on transient failures.
        cache.set(ideaId, true);
      }
    }),
  );

  return missing;
}

/**
 * Find storyboards (`users/{uid}/drafts`) whose parent idea has been deleted.
 */
export async function findOrphanStoryboards(uid: string): Promise<OrphanRecord[]> {
  if (!uid) return [];
  const db = getFirebaseDb();
  if (!db) return [];

  let snap;
  try {
    snap = await getDocs(collection(db, 'users', uid, 'drafts'));
  } catch {
    return [];
  }

  type Row = {
    id: string;
    ideaId: string;
    ideaTopic: string;
    angleTitle: string;
  };

  const rows: Row[] = snap.docs.map((documentSnapshot) => {
    const data = documentSnapshot.data();
    return {
      id: documentSnapshot.id,
      ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
      ideaTopic: asTrimmedString(data.ideaTopic, 'Untitled idea'),
      angleTitle: asTrimmedString(data.angleTitle, 'Untitled angle'),
    } satisfies Row;
  });

  const ideaIds = rows.map((row) => row.ideaId).filter((value) => value.length > 0);
  const missingIdeaIds = await resolveMissingIdeaIds(uid, ideaIds);

  return rows
    .filter((row) => row.ideaId.length > 0 && missingIdeaIds.has(row.ideaId))
    .map((row) => ({
      id: row.id,
      ideaTopic: row.ideaTopic,
      angleTitle: row.angleTitle,
    }));
}

/**
 * Find adaptations (`users/{uid}/adaptations`) whose parent idea has been deleted.
 */
export async function findOrphanAdaptations(uid: string): Promise<OrphanRecord[]> {
  if (!uid) return [];
  const db = getFirebaseDb();
  if (!db) return [];

  let snap;
  try {
    snap = await getDocs(collection(db, 'users', uid, 'adaptations'));
  } catch {
    return [];
  }

  type Row = {
    id: string;
    ideaId: string;
    ideaTopic: string;
    angleTitle: string;
  };

  const rows: Row[] = snap.docs.map((documentSnapshot) => {
    const data = documentSnapshot.data();
    return {
      id: documentSnapshot.id,
      ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
      ideaTopic: asTrimmedString(data.ideaTopic, 'Untitled idea'),
      angleTitle: asTrimmedString(data.angleTitle, 'Untitled angle'),
    } satisfies Row;
  });

  const ideaIds = rows.map((row) => row.ideaId).filter((value) => value.length > 0);
  const missingIdeaIds = await resolveMissingIdeaIds(uid, ideaIds);

  return rows
    .filter((row) => row.ideaId.length > 0 && missingIdeaIds.has(row.ideaId))
    .map((row) => ({
      id: row.id,
      ideaTopic: row.ideaTopic,
      angleTitle: row.angleTitle,
    }));
}

/**
 * Delete the supplied orphan storyboards and adaptations. Idempotent: failures
 * for already-deleted documents are swallowed so re-running this with a stale
 * selection list is safe.
 */
export async function deleteOrphans(
  uid: string,
  ids: OrphanCleanupSelection,
): Promise<void> {
  if (!uid) return;
  const db = getFirebaseDb();
  if (!db) return;

  const storyboardIds = Array.from(new Set(ids.storyboards.filter((id) => id.length > 0)));
  const adaptationIds = Array.from(new Set(ids.adaptations.filter((id) => id.length > 0)));

  await Promise.all([
    ...storyboardIds.map(async (id) => {
      try {
        await deleteDoc(doc(db, 'users', uid, 'drafts', id));
      } catch {
        // Idempotent: ignore "already deleted" or transient errors.
      }
    }),
    ...adaptationIds.map(async (id) => {
      try {
        await deleteDoc(doc(db, 'users', uid, 'adaptations', id));
      } catch {
        // Idempotent: ignore "already deleted" or transient errors.
      }
    }),
  ]);
}
