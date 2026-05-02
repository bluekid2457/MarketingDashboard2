'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore';

import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { Spinner } from '@/components/Spinner';
import { getWorkflowContext } from '@/lib/workflowContext';

type StoryboardRecord = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  status: string;
  updatedAtLabel: string;
  updatedAtMs: number;
};

const STALE_REFRESH_DAYS = 60;
const STALE_REPURPOSE_DAYS = 120;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return date.getTime();
  }
  return 0;
}

function formatLabel(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toLocaleString();
  }
  return '-';
}

type RecycleVerdict = { tone: 'fresh' | 'refresh' | 'repurpose'; days: number };

function getRecycleVerdict(updatedAtMs: number): RecycleVerdict {
  if (!updatedAtMs) {
    return { tone: 'fresh', days: 0 };
  }
  const days = Math.max(0, Math.floor((Date.now() - updatedAtMs) / MS_PER_DAY));
  if (days >= STALE_REPURPOSE_DAYS) return { tone: 'repurpose', days };
  if (days >= STALE_REFRESH_DAYS) return { tone: 'refresh', days };
  return { tone: 'fresh', days };
}

export default function StoryboardIndexPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [records, setRecords] = useState<StoryboardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const ctx = getWorkflowContext();

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => setUid(user?.uid ?? null));
    return unsub;
  }, []);

  useEffect(() => {
    if (!uid) {
      setIsLoading(false);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setError('Database unavailable.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const q = query(collection(db, 'users', uid, 'drafts'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRecords(
          snap.docs.map((documentSnapshot) => {
            const data = documentSnapshot.data();
            return {
              id: documentSnapshot.id,
              ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
              angleId: typeof data.angleId === 'string' ? data.angleId : '',
              ideaTopic: typeof data.ideaTopic === 'string' ? data.ideaTopic : 'Untitled',
              angleTitle: typeof data.angleTitle === 'string' ? data.angleTitle : 'Untitled angle',
              status: typeof data.status === 'string' ? data.status : 'storyboard',
              updatedAtLabel: formatLabel(data.updatedAt),
              updatedAtMs: getMillis(data.updatedAt),
            };
          }),
        );
        setIsLoading(false);
      },
      () => {
        setError('Unable to load storyboard items.');
        setIsLoading(false);
      },
    );

    return unsub;
  }, [uid]);

  const newStoryboardHref = ctx?.ideaId
    ? `/angles?ideaId=${encodeURIComponent(ctx.ideaId)}`
    : '/ideas';

  async function deleteRecord(record: StoryboardRecord): Promise<void> {
    if (!uid) return;
    const label = record.ideaTopic || 'this storyboard';
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    const db = getFirebaseDb();
    if (!db) return;
    setDeletingId(record.id);
    try {
      await deleteDoc(doc(db, 'users', uid, 'drafts', record.id));
    } catch {
      setError('Unable to delete this storyboard. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Storyboard</h1>
        <Link
          href={newStoryboardHref}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
        >
          + New Storyboard
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="sm" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : records.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <p className="text-slate-500">No storyboard items yet.</p>
          <Link
            href={newStoryboardHref}
            className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:underline"
          >
            Start from an idea {'->'}
          </Link>
        </div>
      ) : (
        <>
          {(() => {
            const recyclable = records
              .map((record) => ({ record, verdict: getRecycleVerdict(record.updatedAtMs) }))
              .filter((entry) => entry.verdict.tone !== 'fresh');
            if (recyclable.length === 0) return null;
            return (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  Content recycling — {recyclable.length} storyboard{recyclable.length === 1 ? '' : 's'} flagged for refresh
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Items older than {STALE_REFRESH_DAYS} days are suggested for a refresh; items older than {STALE_REPURPOSE_DAYS} days for repurposing into a new angle.
                </p>
                <ul className="mt-3 space-y-1 text-xs text-amber-900">
                  {recyclable.slice(0, 6).map(({ record, verdict }) => (
                    <li key={`recycle-${record.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-white/60 px-2 py-1">
                      <span className="truncate">
                        <span className="font-semibold">{record.ideaTopic}</span> · {verdict.days} days old
                      </span>
                      <Link
                        className="shrink-0 rounded-md bg-amber-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-800"
                        href={`/storyboard/${encodeURIComponent(record.ideaId || record.id)}?angleId=${encodeURIComponent(record.angleId)}`}
                      >
                        {verdict.tone === 'repurpose' ? 'Repurpose' : 'Refresh'}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {records.map((record) => {
              const recycle = getRecycleVerdict(record.updatedAtMs);
              return (
                <li key={record.id} className="flex items-center justify-between gap-2 px-5 py-4 hover:bg-slate-50">
                  <Link
                    href={`/storyboard/${encodeURIComponent(record.ideaId || record.id)}?angleId=${encodeURIComponent(record.angleId)}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{record.ideaTopic}</p>
                      <p className="truncate text-sm text-slate-500">{record.angleTitle}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {record.status}
                      </span>
                      {recycle.tone !== 'fresh' ? (
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            recycle.tone === 'repurpose'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                          title={`${recycle.days} days since the last update`}
                        >
                          {recycle.tone === 'repurpose' ? 'Repurpose' : 'Refresh'}
                        </span>
                      ) : null}
                      <p className="mt-1 text-xs text-slate-400">{record.updatedAtLabel}</p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="ml-2 shrink-0 rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                    onClick={() => { void deleteRecord(record); }}
                    disabled={deletingId === record.id}
                  >
                    {deletingId === record.id ? 'Deleting...' : 'Delete'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
