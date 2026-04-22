'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { Spinner } from '@/components/Spinner';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';

type ReviewStoryboard = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  status: string;
  updatedAtLabel: string;
  contentLength: number;
};

function formatTimestampLabel(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate: () => Date };
    return candidate.toDate().toLocaleString();
  }

  return 'Unknown';
}

export default function ReviewPage() {
  const router = useRouter();
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [storyboards, setStoryboards] = useState<ReviewStoryboard[]>([]);
  const [isLoadingStoryboards, setIsLoadingStoryboards] = useState(true);
  const [storyboardsError, setStoryboardsError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setStoryboardsError('Review queue is unavailable until Firebase is configured.');
      setIsLoadingStoryboards(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
    });

    return unsubscribeAuth;
  }, []);

  useEffect(() => {
    if (!currentUid) {
      setStoryboards([]);
      setIsLoadingStoryboards(false);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setStoryboardsError('Review queue is unavailable until Firebase is configured.');
      setIsLoadingStoryboards(false);
      return;
    }

    setIsLoadingStoryboards(true);
    setStoryboardsError(null);

    const storyboardsQuery = query(collection(db, 'users', currentUid, 'drafts'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      storyboardsQuery,
      (snapshot) => {
        const nextStoryboards = snapshot.docs.map((documentSnapshot) => {
          const data = documentSnapshot.data();

          return {
            id: documentSnapshot.id,
            ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
            angleId: typeof data.angleId === 'string' ? data.angleId : '',
            ideaTopic: typeof data.ideaTopic === 'string' ? data.ideaTopic : 'Untitled idea',
            angleTitle: typeof data.angleTitle === 'string' ? data.angleTitle : 'Untitled angle',
            status: typeof data.status === 'string' ? data.status : 'draft',
            updatedAtLabel: formatTimestampLabel(data.updatedAt),
            contentLength: typeof data.content === 'string' ? data.content.trim().length : 0,
          } satisfies ReviewStoryboard;
        });

        setStoryboards(nextStoryboards);
        setIsLoadingStoryboards(false);
      },
      () => {
        setStoryboardsError('Unable to load your review queue right now.');
        setStoryboards([]);
        setIsLoadingStoryboards(false);
      },
    );

    return unsubscribe;
  }, [currentUid]);

  const hasReviewableStoryboards = useMemo(
    () => storyboards.some((storyboard) => storyboard.ideaId && storyboard.angleId),
    [storyboards],
  );

  function openStoryboard(record: ReviewStoryboard): void {
    if (!record.ideaId || !record.angleId) {
      return;
    }

    const draftContext = {
      ideaId: record.ideaId,
      angleId: record.angleId,
      selectedAngle: {
        id: record.angleId,
        title: record.angleTitle,
        summary: '',
        sections: [],
      },
      idea: {
        id: record.ideaId,
        topic: record.ideaTopic,
        tone: '',
        audience: '',
        format: '',
      },
    };

    localStorage.setItem('draft_generation_context', JSON.stringify(draftContext));
    router.push(`/storyboard/${record.ideaId}?angleId=${record.angleId}`);
  }

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <h1 className="text-3xl font-extrabold text-slate-900">Review and Approval Workflow</h1>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <section className="surface-card p-6">
          <h2 className="section-title">Storyboard Queue</h2>

          {isLoadingStoryboards ? (
            <div className="mt-4 text-sm text-slate-600">
              <Spinner size="sm" label="Loading review queue..." />
            </div>
          ) : null}

          {storyboardsError ? <p className="mt-4 text-sm text-red-700">{storyboardsError}</p> : null}

          {!isLoadingStoryboards && !storyboardsError && !hasReviewableStoryboards ? (
            <p className="mt-4 text-sm text-slate-600">
              No storyboard documents are currently available for review.
            </p>
          ) : null}

          {!isLoadingStoryboards && !storyboardsError && hasReviewableStoryboards ? (
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              {storyboards
                .filter((storyboard) => storyboard.ideaId && storyboard.angleId)
                .map((storyboard) => (
                  <li key={storyboard.id}>
                    <button
                      type="button"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-teal-300 hover:bg-teal-50"
                      onClick={() => openStoryboard(storyboard)}
                    >
                      <p className="font-semibold text-slate-900">{storyboard.ideaTopic}</p>
                      <p className="mt-1 text-xs text-slate-600">{storyboard.angleTitle}</p>
                      <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">
                        Status: {storyboard.status} · Updated: {storyboard.updatedAtLabel} · Characters:{' '}
                        {storyboard.contentLength}
                      </p>
                    </button>
                  </li>
                ))}
            </ul>
          ) : null}

          <h3 className="mt-5 text-sm font-semibold text-slate-800">Inline Editor</h3>
          <div className="mt-2 min-h-[180px] rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-500">
            Open a storyboard item from the queue to edit and review the full content.
          </div>
        </section>

        <div className="space-y-6">
          <section className="surface-card p-6">
            <h2 className="section-title">Version History</h2>
            <p className="mt-2 muted-copy">Version snapshots are available in each storyboard&apos;s editor flow.</p>
          </section>

          <section className="surface-card p-6">
            <h2 className="section-title">Approval Chain Controls</h2>
            <p className="mt-2 muted-copy">Author &#8594; Editor &#8594; Legal &#8594; Client approver.</p>
          </section>

          <section className="surface-card p-6">
            <h2 className="section-title">Comment / Suggestion Layer</h2>
            <p className="mt-2 muted-copy">Threaded comments with mention support and resolution state.</p>
          </section>

          <section className="surface-card p-6">
            <h2 className="section-title">Role-Based Access</h2>
            <p className="mt-2 muted-copy">Restrict approval actions by role and workspace policy.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
