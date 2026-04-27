'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';

import { Spinner } from '@/components/Spinner';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';

type IdeaDoc = {
  id: string;
  title: string;
  topic: string;
  createdAtMs: number;
  relevanceScore: number | null;
  relevanceLabel: 'Strong' | 'Moderate' | 'Weak' | null;
};

type DraftDoc = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  status: string;
  contentLength: number;
  updatedAtMs: number;
};

type AdaptationDoc = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  platforms: Record<string, string>;
  updatedAtMs: number;
};

type ScheduledPostDoc = {
  id: string;
  articleTitle: string;
  scheduledForMs: number;
};

type CalendarCell =
  | { kind: 'header'; label: string }
  | { kind: 'blank'; key: string }
  | {
      kind: 'day';
      day: number;
      dateMs: number;
      activityCount: number;
      isToday: boolean;
    };

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  medium: 'Medium',
  newsletter: 'Newsletter',
  blog: 'Blog',
};

function timestampToMs(value: unknown): number {
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof value === 'number') {
    return value;
  }
  return 0;
}

function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '0m';
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function startOfWeekMs(now: Date): number {
  const monday = new Date(now);
  const dayOfWeek = monday.getDay();
  const offset = (dayOfWeek + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

function startOfPreviousWeekMs(now: Date): number {
  return startOfWeekMs(now) - 7 * 24 * 60 * 60 * 1000;
}

function buildMonthCalendar(referenceDate: Date, activityByDay: Map<number, number>): CalendarCell[] {
  const headers: CalendarCell[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => ({
    kind: 'header',
    label,
  }));

  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlankCount = (firstOfMonth.getDay() + 6) % 7;

  const today = new Date();
  const todayKey = today.getFullYear() === year && today.getMonth() === month ? today.getDate() : -1;

  const cells: CalendarCell[] = [...headers];

  for (let i = 0; i < leadingBlankCount; i += 1) {
    cells.push({ kind: 'blank', key: `lead-${i}` });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateMs = new Date(year, month, day).getTime();
    cells.push({
      kind: 'day',
      day,
      dateMs,
      activityCount: activityByDay.get(day) ?? 0,
      isToday: day === todayKey,
    });
  }

  while ((cells.length - headers.length) % 7 !== 0) {
    cells.push({ kind: 'blank', key: `tail-${cells.length}` });
  }

  return cells;
}

function MissingDataBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
      {children}
    </span>
  );
}

export default function DashboardPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [ideas, setIdeas] = useState<IdeaDoc[]>([]);
  const [drafts, setDrafts] = useState<DraftDoc[]>([]);
  const [adaptations, setAdaptations] = useState<AdaptationDoc[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostDoc[]>([]);

  const [ideasLoading, setIdeasLoading] = useState(true);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [adaptationsLoading, setAdaptationsLoading] = useState(true);
  const [scheduledPostsLoading, setScheduledPostsLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [adaptationActionError, setAdaptationActionError] = useState<string | null>(null);
  const [deletingAdaptationId, setDeletingAdaptationId] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoadError('Overview is unavailable until Firebase is configured.');
      setAuthReady(true);
      setIdeasLoading(false);
      setDraftsLoading(false);
      setAdaptationsLoading(false);
      setScheduledPostsLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (!currentUser) {
      setIdeas([]);
      setDrafts([]);
      setAdaptations([]);
      setScheduledPosts([]);
      setIdeasLoading(false);
      setDraftsLoading(false);
      setAdaptationsLoading(false);
      setScheduledPostsLoading(false);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setLoadError('Overview is unavailable until Firebase is configured.');
      setIdeasLoading(false);
      setDraftsLoading(false);
      setAdaptationsLoading(false);
      setScheduledPostsLoading(false);
      return;
    }

    setIdeasLoading(true);
    setDraftsLoading(true);
    setAdaptationsLoading(true);
    setScheduledPostsLoading(true);
    setLoadError(null);

    const uid = currentUser.uid;

    const ideasUnsub = onSnapshot(
      query(collection(db, 'users', uid, 'ideas'), orderBy('createdAtMs', 'desc')),
      (snap) => {
        setIdeas(
          snap.docs.map((document) => {
            const data = document.data();
            const relevance = data.relevance && typeof data.relevance === 'object' ? data.relevance : null;
            const score = relevance && typeof (relevance as { score?: unknown }).score === 'number'
              ? (relevance as { score: number }).score
              : null;
            const labelRaw = relevance ? (relevance as { label?: unknown }).label : null;
            const label = labelRaw === 'Strong' || labelRaw === 'Moderate' || labelRaw === 'Weak' ? labelRaw : null;

            return {
              id: document.id,
              title: typeof data.title === 'string' && data.title.trim().length > 0
                ? data.title.trim()
                : (typeof data.topic === 'string' ? data.topic : 'Untitled idea'),
              topic: typeof data.topic === 'string' ? data.topic : '',
              createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : timestampToMs(data.createdAt),
              relevanceScore: score,
              relevanceLabel: label,
            } satisfies IdeaDoc;
          }),
        );
        setIdeasLoading(false);
      },
      () => {
        setIdeas([]);
        setIdeasLoading(false);
        setLoadError('Unable to load ideas right now.');
      },
    );

    const draftsUnsub = onSnapshot(
      query(collection(db, 'users', uid, 'drafts'), orderBy('updatedAt', 'desc')),
      (snap) => {
        setDrafts(
          snap.docs.map((document) => {
            const data = document.data();
            return {
              id: document.id,
              ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
              angleId: typeof data.angleId === 'string' ? data.angleId : '',
              ideaTopic: typeof data.ideaTopic === 'string' ? data.ideaTopic : 'Untitled idea',
              angleTitle: typeof data.angleTitle === 'string' ? data.angleTitle : 'Untitled angle',
              status: typeof data.status === 'string' ? data.status : 'storyboard',
              contentLength: typeof data.content === 'string' ? data.content.trim().length : 0,
              updatedAtMs: timestampToMs(data.updatedAt),
            } satisfies DraftDoc;
          }),
        );
        setDraftsLoading(false);
      },
      () => {
        setDrafts([]);
        setDraftsLoading(false);
        setLoadError('Unable to load storyboards right now.');
      },
    );

    const adaptationsUnsub = onSnapshot(
      query(collection(db, 'users', uid, 'adaptations'), orderBy('updatedAt', 'desc')),
      (snap) => {
        setAdaptations(
          snap.docs.map((document) => {
            const data = document.data();
            const rawPlatforms = data.platforms && typeof data.platforms === 'object'
              ? (data.platforms as Record<string, unknown>)
              : {};
            const platforms: Record<string, string> = {};
            for (const [key, value] of Object.entries(rawPlatforms)) {
              if (typeof value === 'string') {
                platforms[key] = value;
              }
            }

            return {
              id: document.id,
              ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
              angleId: typeof data.angleId === 'string' ? data.angleId : '',
              ideaTopic: typeof data.ideaTopic === 'string' ? data.ideaTopic : 'Untitled idea',
              angleTitle: typeof data.angleTitle === 'string' ? data.angleTitle : 'Untitled angle',
              platforms,
              updatedAtMs: timestampToMs(data.updatedAt),
            } satisfies AdaptationDoc;
          }),
        );
        setAdaptationsLoading(false);
      },
      () => {
        setAdaptations([]);
        setAdaptationsLoading(false);
        setLoadError('Unable to load adaptations right now.');
      },
    );

    const scheduledPostsUnsub = onSnapshot(
      query(collection(db, 'users', uid, 'scheduledPosts'), orderBy('scheduledForMs', 'asc')),
      (snap) => {
        setScheduledPosts(
          snap.docs
            .map((document) => {
              const data = document.data();
              return {
                id: document.id,
                articleTitle: typeof data.articleTitle === 'string' && data.articleTitle.trim().length > 0
                  ? data.articleTitle.trim()
                  : (typeof data.ideaTopic === 'string' && data.ideaTopic.trim().length > 0 ? data.ideaTopic.trim() : 'Untitled article'),
                scheduledForMs: typeof data.scheduledForMs === 'number' ? data.scheduledForMs : 0,
              } satisfies ScheduledPostDoc;
            })
            .filter((item) => item.scheduledForMs > 0),
        );
        setScheduledPostsLoading(false);
      },
      () => {
        setScheduledPosts([]);
        setScheduledPostsLoading(false);
        setLoadError('Unable to load scheduled posts right now.');
      },
    );

    return () => {
      ideasUnsub();
      draftsUnsub();
      adaptationsUnsub();
      scheduledPostsUnsub();
    };
  }, [authReady, currentUser]);

  const now = useMemo(() => new Date(), []);
  const weekStartMs = useMemo(() => startOfWeekMs(now), [now]);
  const previousWeekStartMs = useMemo(() => startOfPreviousWeekMs(now), [now]);

  const draftsThisWeek = useMemo(
    () => drafts.filter((draft) => draft.updatedAtMs >= weekStartMs),
    [drafts, weekStartMs],
  );

  const draftsLastWeek = useMemo(
    () =>
      drafts.filter(
        (draft) => draft.updatedAtMs >= previousWeekStartMs && draft.updatedAtMs < weekStartMs,
      ),
    [drafts, previousWeekStartMs, weekStartMs],
  );

  const ideasWaiting = useMemo(() => {
    const draftIdeaIds = new Set(drafts.map((draft) => draft.ideaId).filter(Boolean));
    return ideas.filter((idea) => !draftIdeaIds.has(idea.id));
  }, [ideas, drafts]);

  const highPriorityWaiting = useMemo(
    () => ideasWaiting.filter((idea) => idea.relevanceLabel === 'Strong').length,
    [ideasWaiting],
  );

  const oldestPendingDraft = useMemo(() => {
    const reviewable = drafts.filter((draft) => draft.contentLength > 0);
    if (reviewable.length === 0) {
      return null;
    }
    return reviewable.reduce((oldest, current) =>
      current.updatedAtMs < oldest.updatedAtMs ? current : oldest,
    );
  }, [drafts]);

  const reviewSlaLabel = useMemo(() => {
    if (!oldestPendingDraft) {
      return null;
    }
    return formatDuration(now.getTime() - oldestPendingDraft.updatedAtMs);
  }, [oldestPendingDraft, now]);

  const platformCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const adaptation of adaptations) {
      for (const [platform, content] of Object.entries(adaptation.platforms)) {
        if (typeof content === 'string' && content.trim().length > 0) {
          counts.set(platform, (counts.get(platform) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [adaptations]);

  const topPlatform = useMemo(() => {
    let bestKey: string | null = null;
    let bestCount = 0;
    for (const [key, count] of platformCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    return bestKey ? { key: bestKey, count: bestCount } : null;
  }, [platformCounts]);

  const topIdeas = useMemo(() => {
    return [...ideas]
      .filter((idea) => idea.relevanceScore !== null)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, 3);
  }, [ideas]);

  const reviewQueue = useMemo(() => {
    return drafts
      .filter((draft) => draft.ideaId && draft.angleId)
      .slice(0, 5);
  }, [drafts]);

  const activityByDay = useMemo(() => {
    const map = new Map<number, number>();
    const year = now.getFullYear();
    const month = now.getMonth();
    const tally = (ms: number) => {
      if (ms <= 0) return;
      const date = new Date(ms);
      if (date.getFullYear() !== year || date.getMonth() !== month) return;
      const day = date.getDate();
      map.set(day, (map.get(day) ?? 0) + 1);
    };
    scheduledPosts.forEach((scheduledPost) => tally(scheduledPost.scheduledForMs));
    return map;
  }, [now, scheduledPosts]);

  const scheduledThisMonthCount = useMemo(() => {
    let count = 0;
    const year = now.getFullYear();
    const month = now.getMonth();
    for (const item of scheduledPosts) {
      const date = new Date(item.scheduledForMs);
      if (date.getFullYear() === year && date.getMonth() === month) {
        count += 1;
      }
    }
    return count;
  }, [now, scheduledPosts]);

  const calendarCells = useMemo(() => buildMonthCalendar(now, activityByDay), [now, activityByDay]);

  const monthLabel = useMemo(
    () => now.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [now],
  );

  const isLoading = !authReady || ideasLoading || draftsLoading || adaptationsLoading || scheduledPostsLoading;
  const dataReady = authReady && currentUser && !loadError;

  const deleteAdaptation = useCallback(
    async (adaptation: AdaptationDoc): Promise<void> => {
      if (!currentUser) {
        setAdaptationActionError('Sign in to delete adaptations.');
        return;
      }

      const label = adaptation.angleTitle || adaptation.ideaTopic || adaptation.id;
      if (!window.confirm(`Delete adaptation "${label}"? This cannot be undone.`)) {
        return;
      }

      const db = getFirebaseDb();
      if (!db) {
        setAdaptationActionError('Firebase is unavailable, so this adaptation cannot be deleted right now.');
        return;
      }

      setAdaptationActionError(null);
      setDeletingAdaptationId(adaptation.id);

      try {
        await deleteDoc(doc(db, 'users', currentUser.uid, 'adaptations', adaptation.id));
        setAdaptations((previous) => previous.filter((entry) => entry.id !== adaptation.id));
      } catch {
        setAdaptationActionError('Unable to delete this adaptation right now. Please try again.');
      } finally {
        setDeletingAdaptationId(null);
      }
    },
    [currentUser],
  );

  const postsDelta = draftsThisWeek.length - draftsLastWeek.length;
  const postsDeltaLabel = draftsLastWeek.length === 0 && draftsThisWeek.length === 0
    ? 'No activity yet'
    : `${postsDelta >= 0 ? '+' : ''}${postsDelta} vs last week`;

  return (
    <div className="space-y-6">
      <section className="surface-card overflow-hidden p-6 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Overview</p>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">Campaign Command Center</h1>
            <p className="mt-2 max-w-2xl muted-copy">
              Monitor momentum across your pipeline from raw ideas to live performance.
              {currentUser?.email ? <> Signed in as <span className="font-semibold text-slate-700">{currentUser.email}</span>.</> : null}
            </p>
          </div>
          <Link
            href="/ideas"
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
          >
            New Campaign Sprint
          </Link>
        </div>

        {loadError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        ) : null}

        {isLoading && !loadError ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Spinner size="sm" />
            <span>Loading your live workspace data...</span>
          </div>
        ) : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="hero-metric">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Posts this week</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{draftsThisWeek.length}</p>
            <p className="mt-1 text-xs font-medium text-teal-700">{postsDeltaLabel}</p>
          </article>

          <article className="hero-metric">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Ideas waiting</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{ideasWaiting.length}</p>
            <p className="mt-1 text-xs font-medium text-teal-700">
              {highPriorityWaiting} strong-rated
            </p>
          </article>

          <article className="hero-metric">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Oldest open draft</p>
            {reviewSlaLabel ? (
              <>
                <p className="mt-2 text-3xl font-extrabold text-slate-900">{reviewSlaLabel}</p>
                <p className="mt-1 text-xs font-medium text-teal-700 truncate" title={oldestPendingDraft?.ideaTopic}>
                  {oldestPendingDraft?.ideaTopic}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-3xl font-extrabold text-slate-400">—</p>
                <p className="mt-1 text-xs font-medium text-slate-500">No drafts in flight</p>
              </>
            )}
          </article>

          <article className="hero-metric border-red-300 bg-red-50">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Engagement rate</p>
              <MissingDataBadge>TODO</MissingDataBadge>
            </div>
            <p className="mt-2 text-3xl font-extrabold text-red-700">N/A</p>
            <p className="mt-1 text-xs font-medium text-red-700">No analytics source connected yet (see notes.md)</p>
          </article>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="surface-card p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="section-title">Activity Calendar</h2>
              <p className="mt-1 text-xs text-slate-500">Days with scheduled publish reminders this month.</p>
            </div>
            <span className="pill">{monthLabel}</span>
          </div>

          <div className="grid grid-cols-7 gap-2 text-center text-xs">
            {calendarCells.map((cell, index) => {
              if (cell.kind === 'header') {
                return (
                  <span
                    key={`h-${cell.label}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 py-2 font-semibold text-slate-600"
                  >
                    {cell.label}
                  </span>
                );
              }

              if (cell.kind === 'blank') {
                return <span key={cell.key} className="py-3" />;
              }

              const hasActivity = cell.activityCount > 0;
              return (
                <div
                  key={`d-${cell.day}-${index}`}
                  className={`rounded-lg border py-3 font-medium ${
                    cell.isToday
                      ? 'border-teal-500 bg-teal-100 text-teal-900 ring-2 ring-teal-300'
                      : hasActivity
                        ? 'border-teal-200 bg-teal-50 text-teal-800'
                        : 'border-slate-200 bg-white text-slate-500'
                  }`}
                  title={hasActivity ? `${cell.activityCount} scheduled post${cell.activityCount === 1 ? '' : 's'}` : undefined}
                >
                  <div>{cell.day}</div>
                  {hasActivity ? (
                    <div className="mt-0.5 text-[10px] font-bold text-teal-700">{cell.activityCount}</div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
            {scheduledThisMonthCount > 0
              ? `${scheduledThisMonthCount} publish reminder${scheduledThisMonthCount === 1 ? '' : 's'} scheduled this month.`
              : 'No publish reminders scheduled for this month yet.'}
          </div>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Idea Backlog Summary</h2>
          <p className="mt-1 muted-copy">Top-scoring ideas ready for angle generation.</p>

          {!dataReady ? null : topIdeas.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No scored ideas yet.{' '}
              <Link href="/ideas" className="font-semibold text-teal-700 hover:underline">
                Add your first idea →
              </Link>
            </p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {topIdeas.map((idea) => (
                <li key={idea.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <Link
                    href={`/angles?ideaId=${encodeURIComponent(idea.id)}`}
                    className="block hover:underline"
                  >
                    <p className="font-semibold text-slate-800">{idea.title}</p>
                    <p className="text-xs text-slate-500">
                      Score: {idea.relevanceScore}/100 · {idea.relevanceLabel ?? 'Unrated'}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Storyboards and Review Queue</h2>
            <Link href="/review" className="text-xs font-semibold text-teal-700 hover:underline">
              Open queue →
            </Link>
          </div>

          {!dataReady ? null : reviewQueue.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No storyboards yet.{' '}
              <Link href="/storyboard" className="font-semibold text-teal-700 hover:underline">
                Start a storyboard →
              </Link>
            </p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {reviewQueue.map((draft) => (
                <li
                  key={draft.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700">{draft.ideaTopic}</p>
                    <p className="truncate text-xs text-slate-500">
                      {draft.angleTitle} · {draft.status} · {formatDuration(now.getTime() - draft.updatedAtMs)} ago
                    </p>
                  </div>
                  <Link
                    href={`/storyboard/${encodeURIComponent(draft.ideaId)}?angleId=${encodeURIComponent(draft.angleId)}`}
                    className="shrink-0 text-xs font-semibold text-teal-700 hover:underline"
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Recent Analytics</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Top adapted platform</p>
              {topPlatform ? (
                <>
                  <p className="mt-2 text-xl font-bold text-slate-900">
                    {PLATFORM_LABELS[topPlatform.key] ?? topPlatform.key}
                  </p>
                  <p className="text-xs text-teal-700">
                    {topPlatform.count} adaptation{topPlatform.count === 1 ? '' : 's'}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-xl font-bold text-slate-400">—</p>
                  <p className="text-xs text-slate-500">No adaptations generated yet</p>
                </>
              )}
            </div>

            <div className="rounded-xl border border-red-300 bg-red-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">Best post type</p>
                <MissingDataBadge>TODO</MissingDataBadge>
              </div>
              <p className="mt-2 text-xl font-bold text-red-700">N/A</p>
              <p className="text-xs text-red-700">Format performance not tracked (see notes.md)</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total adaptations</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{adaptations.length}</p>
              <p className="text-xs text-teal-700">Across {platformCounts.size} platform{platformCounts.size === 1 ? '' : 's'}</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total drafts</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{drafts.length}</p>
              <p className="text-xs text-teal-700">{draftsThisWeek.length} updated this week</p>
            </div>
          </div>
        </section>
      </div>

      <section className="surface-card p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">All Adaptations</h2>
          <span className="pill">{adaptations.length} total</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Manage saved adaptations and reopen a specific one for editing.</p>

        {adaptationActionError ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{adaptationActionError}</p>
        ) : null}

        {!dataReady ? null : adaptations.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No adaptations yet.{' '}
            <Link href="/storyboard" className="font-semibold text-teal-700 hover:underline">
              Open a storyboard to start adapting →
            </Link>
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {adaptations.map((adaptation) => {
              const platformSummary = Object.entries(adaptation.platforms)
                .filter(([, value]) => value.trim().length > 0)
                .map(([platform]) => PLATFORM_LABELS[platform] ?? platform)
                .join(' · ');

              const hasRouteContext = adaptation.ideaId.trim().length > 0 && adaptation.angleId.trim().length > 0;
              const editHref = hasRouteContext
                ? `/adapt/${encodeURIComponent(adaptation.ideaId)}?angleId=${encodeURIComponent(adaptation.angleId)}`
                : '';

              return (
                <li key={adaptation.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="truncate text-sm font-semibold text-slate-900">{adaptation.ideaTopic || 'Untitled idea'}</p>
                  <p className="truncate text-xs text-slate-500">{adaptation.angleTitle || 'Untitled angle'}</p>
                  <p className="mt-2 text-xs text-slate-600">
                    {platformSummary || 'No platform copy generated yet'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Updated {adaptation.updatedAtMs > 0 ? new Date(adaptation.updatedAtMs).toLocaleString() : 'unknown'}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {hasRouteContext ? (
                      <Link
                        href={editHref}
                        className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </Link>
                    ) : (
                      <span className="inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400">
                        Edit unavailable
                      </span>
                    )}

                    <button
                      type="button"
                      className="inline-flex rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        void deleteAdaptation(adaptation);
                      }}
                      disabled={deletingAdaptationId === adaptation.id}
                    >
                      {deletingAdaptationId === adaptation.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="surface-card p-6">
        <h2 className="section-title">Quick Links</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { href: '/ideas', label: 'Add idea' },
            { href: '/angles', label: 'Generate angles' },
            { href: '/review', label: 'Open review queue' },
            { href: '/publish', label: 'Publish next post' },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
