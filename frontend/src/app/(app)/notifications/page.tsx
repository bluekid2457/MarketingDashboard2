'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { Spinner } from '@/components/Spinner';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';

type ScheduledPost = {
  id: string;
  articleTitle: string;
  scheduledForMs: number;
  platforms: string[];
};

function formatRelativeTime(ms: number): string {
  const now = Date.now();
  const deltaMs = ms - now;
  const absMinutes = Math.round(Math.abs(deltaMs) / 60000);

  if (absMinutes < 60) {
    return deltaMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 48) {
    return deltaMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }

  const absDays = Math.round(absHours / 24);
  return deltaMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

export default function NotificationsPage() {
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoadingScheduled, setIsLoadingScheduled] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoadError('Notifications are unavailable until Firebase is configured.');
      setIsAuthLoading(false);
      setIsLoadingScheduled(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
      setIsAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (!currentUid) {
      setScheduledPosts([]);
      setLoadError('Sign in to view scheduled post reminders.');
      setIsLoadingScheduled(false);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setScheduledPosts([]);
      setLoadError('Notifications are unavailable until Firebase is configured.');
      setIsLoadingScheduled(false);
      return;
    }

    setLoadError(null);
    setIsLoadingScheduled(true);

    const scheduledQuery = query(collection(db, 'users', currentUid, 'scheduledPosts'), orderBy('scheduledForMs', 'asc'));
    const unsubscribe = onSnapshot(
      scheduledQuery,
      (snapshot) => {
        setScheduledPosts(
          snapshot.docs
            .map((documentSnapshot) => {
              const data = documentSnapshot.data() as Record<string, unknown>;
              return {
                id: documentSnapshot.id,
                articleTitle: typeof data.articleTitle === 'string' && data.articleTitle.trim().length > 0
                  ? data.articleTitle.trim()
                  : (typeof data.ideaTopic === 'string' && data.ideaTopic.trim().length > 0 ? data.ideaTopic.trim() : 'Untitled article'),
                scheduledForMs: typeof data.scheduledForMs === 'number' ? data.scheduledForMs : 0,
                platforms: Array.isArray(data.platforms)
                  ? data.platforms.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                  : [],
              } satisfies ScheduledPost;
            })
            .filter((item) => item.scheduledForMs > 0),
        );
        setIsLoadingScheduled(false);
      },
      () => {
        setScheduledPosts([]);
        setLoadError('Unable to load scheduled reminders right now.');
        setIsLoadingScheduled(false);
      },
    );

    return unsubscribe;
  }, [currentUid, isAuthLoading]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  const dueNow = useMemo(() => {
    return scheduledPosts.filter((item) => Math.abs(item.scheduledForMs - nowMs) <= 15 * 60 * 1000);
  }, [nowMs, scheduledPosts]);

  const upcomingSoon = useMemo(() => {
    return scheduledPosts
      .filter((item) => item.scheduledForMs > nowMs && item.scheduledForMs <= nowMs + 24 * 60 * 60 * 1000)
      .slice(0, 8);
  }, [nowMs, scheduledPosts]);

  const missed = useMemo(() => {
    return scheduledPosts
      .filter((item) => item.scheduledForMs < nowMs - 15 * 60 * 1000)
      .slice(-8)
      .reverse();
  }, [nowMs, scheduledPosts]);

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 12</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Error and Notifications</h1>
        <p className="mt-1 text-sm text-slate-600">Reminders are generated from your scheduled posts.</p>
      </section>

      {isAuthLoading || isLoadingScheduled ? (
        <section className="surface-card p-6 text-sm text-slate-600">
          <Spinner size="sm" label="Loading notifications..." />
        </section>
      ) : null}

      {loadError ? (
        <section className="surface-card border-red-200 bg-red-50 p-6">
          <h2 className="section-title">Error Messages</h2>
          <p className="mt-2 text-sm text-red-800">{loadError}</p>
        </section>
      ) : null}

      {!isAuthLoading && !isLoadingScheduled && !loadError ? (
        <>
          <section className="surface-card border-amber-200 bg-amber-50 p-6">
            <h2 className="section-title">Success / Warning Notifications</h2>
            {dueNow.length === 0 ? (
              <p className="mt-2 text-sm text-amber-900">No publish reminders are due right now.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-amber-900">
                {dueNow.map((item) => (
                  <li key={item.id} className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2">
                    <p className="font-semibold">Time to publish: {item.articleTitle}</p>
                    <p className="text-xs">
                      Scheduled for {new Date(item.scheduledForMs).toLocaleString()} ({formatRelativeTime(item.scheduledForMs)})
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface-card p-6">
            <h2 className="section-title">System Alerts</h2>
            {upcomingSoon.length === 0 ? (
              <p className="mt-2 muted-copy">No reminders in the next 24 hours.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {upcomingSoon.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-medium">Upcoming: {item.articleTitle}</p>
                    <p className="text-xs text-slate-600">
                      {new Date(item.scheduledForMs).toLocaleString()} ({formatRelativeTime(item.scheduledForMs)})
                      {item.platforms.length > 0 ? ` · ${item.platforms.join(', ')}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {missed.length > 0 ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
                <p className="font-semibold">Missed posting windows detected</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {missed.map((item) => (
                    <li key={item.id}>
                      {item.articleTitle} - {new Date(item.scheduledForMs).toLocaleString()} ({formatRelativeTime(item.scheduledForMs)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4">
              <Link href="/publish" className="text-sm font-semibold text-teal-700 hover:underline">
                Create or update schedule in Publish {'->'}
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
