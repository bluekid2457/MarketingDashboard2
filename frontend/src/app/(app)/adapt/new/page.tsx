'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { Spinner } from '@/components/Spinner';
import { findOrphanAdaptations, findOrphanStoryboards } from '@/lib/orphans';

type StoryboardRecord = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
};

type AdaptationRecord = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  platforms: string[];
};

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  medium: 'Medium',
  newsletter: 'Newsletter',
  blog: 'Blog',
};

function buildAdaptHref(ideaId: string, angleId: string): string {
  const idPart = encodeURIComponent(ideaId);
  const anglePart = encodeURIComponent(angleId);
  return `/adapt/${idPart}?angleId=${anglePart}`;
}

export default function AdaptLandingPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [storyboards, setStoryboards] = useState<StoryboardRecord[]>([]);
  const [adaptations, setAdaptations] = useState<AdaptationRecord[]>([]);

  const [orphanStoryboardIds, setOrphanStoryboardIds] = useState<Set<string>>(new Set());
  const [orphanAdaptationIds, setOrphanAdaptationIds] = useState<Set<string>>(new Set());

  const [storyboardsLoading, setStoryboardsLoading] = useState(true);
  const [adaptationsLoading, setAdaptationsLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthReady(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!uid) {
      setStoryboards([]);
      setAdaptations([]);
      setStoryboardsLoading(false);
      setAdaptationsLoading(false);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setError('Database unavailable.');
      setStoryboardsLoading(false);
      setAdaptationsLoading(false);
      return;
    }

    setStoryboardsLoading(true);
    setAdaptationsLoading(true);

    const storyboardsQuery = query(
      collection(db, 'users', uid, 'drafts'),
      orderBy('updatedAt', 'desc'),
    );
    const storyboardsUnsub = onSnapshot(
      storyboardsQuery,
      (snap) => {
        setStoryboards(
          snap.docs.map((documentSnapshot) => {
            const data = documentSnapshot.data();
            return {
              id: documentSnapshot.id,
              ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
              angleId: typeof data.angleId === 'string' ? data.angleId : '',
              ideaTopic: typeof data.ideaTopic === 'string' ? data.ideaTopic : 'Untitled idea',
              angleTitle: typeof data.angleTitle === 'string' ? data.angleTitle : 'Untitled angle',
            };
          }),
        );
        setStoryboardsLoading(false);
      },
      () => {
        setError('Unable to load your storyboards right now.');
        setStoryboardsLoading(false);
      },
    );

    const adaptationsQuery = query(
      collection(db, 'users', uid, 'adaptations'),
      orderBy('updatedAt', 'desc'),
    );
    const adaptationsUnsub = onSnapshot(
      adaptationsQuery,
      (snap) => {
        setAdaptations(
          snap.docs.map((documentSnapshot) => {
            const data = documentSnapshot.data();
            const rawPlatforms =
              data.platforms && typeof data.platforms === 'object'
                ? (data.platforms as Record<string, unknown>)
                : {};
            const platforms: string[] = [];
            for (const [platformKey, platformValue] of Object.entries(rawPlatforms)) {
              if (typeof platformValue === 'string' && platformValue.trim().length > 0) {
                platforms.push(platformKey);
              }
            }
            return {
              id: documentSnapshot.id,
              ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
              angleId: typeof data.angleId === 'string' ? data.angleId : '',
              ideaTopic: typeof data.ideaTopic === 'string' ? data.ideaTopic : 'Untitled idea',
              angleTitle: typeof data.angleTitle === 'string' ? data.angleTitle : 'Untitled angle',
              platforms,
            };
          }),
        );
        setAdaptationsLoading(false);
      },
      () => {
        setError('Unable to load your adaptations right now.');
        setAdaptationsLoading(false);
      },
    );

    return () => {
      storyboardsUnsub();
      adaptationsUnsub();
    };
  }, [authReady, uid]);

  // Debounced orphan detection: filter out drafts/adaptations whose parent
  // idea has been deleted, without blocking the initial list render.
  useEffect(() => {
    if (!uid || (storyboards.length === 0 && adaptations.length === 0)) {
      setOrphanStoryboardIds(new Set());
      setOrphanAdaptationIds(new Set());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const [orphanStoryboards, orphanAdaptations] = await Promise.all([
          findOrphanStoryboards(uid),
          findOrphanAdaptations(uid),
        ]);
        if (cancelled) return;
        setOrphanStoryboardIds(new Set(orphanStoryboards.map((entry) => entry.id)));
        setOrphanAdaptationIds(new Set(orphanAdaptations.map((entry) => entry.id)));
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [uid, storyboards, adaptations]);

  const visibleAdaptations = useMemo(
    () => adaptations.filter((entry) => !orphanAdaptationIds.has(entry.id)),
    [adaptations, orphanAdaptationIds],
  );
  const visibleStoryboards = useMemo(
    () => storyboards.filter((entry) => !orphanStoryboardIds.has(entry.id)),
    [storyboards, orphanStoryboardIds],
  );

  const adaptedKeySet = useMemo(() => {
    const keys = new Set<string>();
    for (const adaptation of visibleAdaptations) {
      if (adaptation.ideaId && adaptation.angleId) {
        keys.add(`${adaptation.ideaId}_${adaptation.angleId}`);
      }
    }
    return keys;
  }, [visibleAdaptations]);

  const unadaptedStoryboards = useMemo(() => {
    return visibleStoryboards.filter((storyboard) => {
      if (!storyboard.ideaId || !storyboard.angleId) return false;
      return !adaptedKeySet.has(`${storyboard.ideaId}_${storyboard.angleId}`);
    });
  }, [visibleStoryboards, adaptedKeySet]);

  const isLoading = !authReady || storyboardsLoading || adaptationsLoading;
  const hasNoStoryboards = !storyboardsLoading && visibleStoryboards.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-800">Adapt</h1>
        <p className="text-sm text-slate-500">
          Pick a storyboard to adapt for platforms.
        </p>
        <p className="muted-copy">
          Adapt converts a storyboard into LinkedIn / X / Medium / Newsletter / Blog copy.
        </p>
      </header>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="sm" />
        </div>
      ) : (
        <>
          <section className="surface-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="section-title">Resume an existing adaptation</h2>
              <span className="pill">{visibleAdaptations.length} saved</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Reopen an adaptation you have already started.
            </p>

            {visibleAdaptations.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No adaptations yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {visibleAdaptations.map((adaptation) => {
                  const platformLabels = adaptation.platforms.map(
                    (platform) => PLATFORM_LABELS[platform] ?? platform,
                  );
                  const canResume =
                    adaptation.ideaId.length > 0 && adaptation.angleId.length > 0;
                  return (
                    <li
                      key={adaptation.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-800">
                            {adaptation.ideaTopic}
                          </p>
                          <p className="truncate text-sm text-slate-500">
                            {adaptation.angleTitle}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {platformLabels.length === 0 ? (
                              <span className="muted-copy text-xs">No platform copy saved yet</span>
                            ) : (
                              platformLabels.map((label) => (
                                <span
                                  key={`${adaptation.id}-${label}`}
                                  className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
                                >
                                  {label}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                        {canResume ? (
                          <Link
                            href={buildAdaptHref(adaptation.ideaId, adaptation.angleId)}
                            className="shrink-0 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
                          >
                            Resume {'->'}
                          </Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="surface-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="section-title">Start a new adaptation from a storyboard</h2>
              <span className="pill">{unadaptedStoryboards.length} ready</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Storyboards that don&apos;t have an adaptation yet.
            </p>

            {unadaptedStoryboards.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Finish a storyboard first to adapt it.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {unadaptedStoryboards.map((storyboard) => (
                  <li
                    key={storyboard.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-800">
                          {storyboard.ideaTopic}
                        </p>
                        <p className="truncate text-sm text-slate-500">
                          {storyboard.angleTitle}
                        </p>
                      </div>
                      <Link
                        href={buildAdaptHref(storyboard.ideaId, storyboard.angleId)}
                        className="shrink-0 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
                      >
                        Adapt this {'->'}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {hasNoStoryboards ? (
            <section className="surface-card p-5">
              <h2 className="section-title">No storyboards yet</h2>
              <p className="mt-1 text-sm text-slate-500">
                Adapt works from finished storyboards. Generate one first, then come back here to
                turn it into platform copy.
              </p>
              <Link
                href="/storyboard"
                className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:underline"
              >
                Go to Storyboard {'->'}
              </Link>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
