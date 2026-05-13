'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { Spinner } from '@/components/Spinner';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import {
  cancelScheduledPost as cancelScheduledPostApi,
  rescheduleScheduledPost as rescheduleScheduledPostApi,
} from '@/lib/publish';
import {
  formatPlatformLabel,
  parseScheduledPostRecord,
  type ScheduledPostRecord,
  type ScheduledPostStatus,
} from '@/lib/scheduledPosts';

// ---------------------------------------------------------------------------
// Module-scope helpers
// ---------------------------------------------------------------------------

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1, 0, 0, 0, 0);
}

function formatScheduledAtInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseScheduledAtInputValue(value: string): number {
  if (!value.trim()) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isReschedulable(status: ScheduledPostStatus | undefined): boolean {
  return status === undefined || status === 'scheduled' || status === 'failed';
}

function isCancellable(status: ScheduledPostStatus | undefined): boolean {
  return status === undefined || status === 'scheduled' || status === 'failed';
}

function formatLocalHHMM(ms: number): string {
  const d = new Date(ms);
  const hours = `${d.getHours()}`.padStart(2, '0');
  const minutes = `${d.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

const STATUS_PILL_CLASSNAMES: Record<ScheduledPostStatus, string> = {
  scheduled: 'bg-teal-100 text-teal-900 hover:bg-teal-200',
  publishing: 'bg-amber-100 text-amber-900 hover:bg-amber-200',
  published: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200',
  failed: 'bg-red-100 text-red-900 hover:bg-red-200',
  cancelled: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
};

const STATUS_DOT_CLASSNAMES: Record<ScheduledPostStatus, string> = {
  scheduled: 'bg-teal-500',
  publishing: 'bg-amber-500',
  published: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-slate-400',
};

const STATUS_BADGE_CLASSNAMES: Record<ScheduledPostStatus, string> = {
  scheduled: 'bg-teal-100 text-teal-900',
  publishing: 'bg-amber-100 text-amber-900',
  published: 'bg-emerald-100 text-emerald-900',
  failed: 'bg-red-100 text-red-900',
  cancelled: 'bg-slate-100 text-slate-600',
};

const STATUS_LABELS: Record<ScheduledPostStatus, string> = {
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_FILTERS: ReadonlyArray<'all' | ScheduledPostStatus> = [
  'all',
  'scheduled',
  'publishing',
  'published',
  'failed',
];

// ---------------------------------------------------------------------------
// Calendar grid build
// ---------------------------------------------------------------------------

type CalendarCell =
  | { kind: 'header'; label: string }
  | { kind: 'blank'; key: string }
  | {
      kind: 'day';
      day: number;
      dateMs: number;
      isToday: boolean;
      posts: ScheduledPostRecord[];
    };

function buildMonthCalendar(referenceDate: Date, postsByDay: Map<number, ScheduledPostRecord[]>): CalendarCell[] {
  const headers: CalendarCell[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => ({
    kind: 'header',
    label,
  }));
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlankCount = (firstOfMonth.getDay() + 6) % 7; // Mon-first
  const today = new Date();
  const todayKey =
    today.getFullYear() === year && today.getMonth() === month ? today.getDate() : -1;
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
      isToday: day === todayKey,
      posts: postsByDay.get(day) ?? [],
    });
  }
  while ((cells.length - headers.length) % 7 !== 0) {
    cells.push({ kind: 'blank', key: `tail-${cells.length}` });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

type Notice = {
  tone: 'success' | 'error' | 'info';
  message: string;
  linkHref?: string;
  linkText?: string;
};

export default function CalendarPage() {
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostRecord[]>([]);
  const [isPostsLoading, setIsPostsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [rescheduleInput, setRescheduleInput] = useState<string>(''); // datetime-local string
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ScheduledPostStatus>('all');
  const [notice, setNotice] = useState<Notice | null>(null);

  // Auth listener
  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoadError('Calendar is unavailable until Firebase is configured.');
      setIsAuthLoading(false);
      setIsPostsLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
      setIsAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // Firestore listener
  useEffect(() => {
    if (isAuthLoading) return;
    if (!currentUid) {
      setScheduledPosts([]);
      setLoadError('Sign in to view the scheduled posts calendar.');
      setIsPostsLoading(false);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setLoadError('Calendar is unavailable until Firebase is configured.');
      setIsPostsLoading(false);
      return;
    }
    setIsPostsLoading(true);
    setLoadError(null);
    const q = query(collection(db, 'users', currentUid, 'scheduledPosts'), orderBy('scheduledForMs', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next: ScheduledPostRecord[] = [];
        for (const documentSnapshot of snapshot.docs) {
          const parsed = parseScheduledPostRecord(
            documentSnapshot.id,
            documentSnapshot.data() as Record<string, unknown>,
          );
          if (parsed) next.push(parsed);
        }
        setScheduledPosts(next);
        setIsPostsLoading(false);
      },
      () => {
        setScheduledPosts([]);
        setIsPostsLoading(false);
        setLoadError('Unable to load scheduled posts right now.');
      },
    );
    return unsubscribe;
  }, [currentUid, isAuthLoading]);

  // Filter + group memo
  const filteredPosts = useMemo(() => {
    if (statusFilter === 'all') return scheduledPosts;
    return scheduledPosts.filter((p) => (p.status ?? 'scheduled') === statusFilter);
  }, [scheduledPosts, statusFilter]);

  const postsByDay = useMemo(() => {
    const map = new Map<number, ScheduledPostRecord[]>();
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    for (const post of filteredPosts) {
      const d = new Date(post.scheduledForMs);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const day = d.getDate();
      const arr = map.get(day) ?? [];
      arr.push(post);
      map.set(day, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.scheduledForMs - b.scheduledForMs);
    }
    return map;
  }, [filteredPosts, viewMonth]);

  const calendarCells = useMemo(
    () => buildMonthCalendar(viewMonth, postsByDay),
    [viewMonth, postsByDay],
  );

  const selectedPost = useMemo(
    () => (selectedPostId ? scheduledPosts.find((p) => p.id === selectedPostId) ?? null : null),
    [selectedPostId, scheduledPosts],
  );

  // Prefill the reschedule input whenever the selected post changes.
  useEffect(() => {
    if (selectedPost) {
      setRescheduleInput(formatScheduledAtInputValue(new Date(selectedPost.scheduledForMs)));
      setConfirmingCancelId(null);
    } else {
      setRescheduleInput('');
    }
  }, [selectedPostId, selectedPost]);

  // Esc key closes the modal.
  useEffect(() => {
    if (!selectedPostId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedPostId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPostId]);

  // Handlers
  const handleReschedule = useCallback(async (postId: string) => {
    if (!currentUid) {
      setNotice({ tone: 'error', message: 'Sign in to reschedule a post.' });
      return;
    }
    const newMs = parseScheduledAtInputValue(rescheduleInput);
    if (!newMs) {
      setNotice({ tone: 'error', message: 'Pick a valid date and time.' });
      return;
    }
    if (newMs <= Date.now() + 60_000) {
      setNotice({ tone: 'error', message: 'Pick a time at least one minute in the future.' });
      return;
    }
    setReschedulingId(postId);
    try {
      const result = await rescheduleScheduledPostApi(postId, newMs);
      if (result.success) {
        setNotice({
          tone: 'success',
          message: `Scheduled post moved to ${new Date(result.scheduledForMs).toLocaleString()}.`,
        });
        // Firestore listener will refresh the row; keep the detail panel open so the user sees the new time
      } else if (result.error === 'status_not_reschedulable') {
        setNotice({ tone: 'error', message: 'This post is already publishing or published and can\'t be moved.' });
      } else if (result.error === 'not_found') {
        setNotice({ tone: 'error', message: 'Scheduled post not found (it may have already been cancelled).' });
      } else if (result.error === 'scheduled_too_soon') {
        setNotice({ tone: 'error', message: 'Pick a time at least one minute in the future.' });
      } else if (result.error === 'reschedule_provisioning_failed') {
        setNotice({ tone: 'error', message: 'Scheduling backend is temporarily unavailable. Please retry.' });
      } else if (result.error === 'reschedule_write_failed') {
        setNotice({ tone: 'error', message: 'Could not save the new time. Please retry.' });
      } else if (result.error === 'not_signed_in') {
        setNotice({ tone: 'error', message: 'Sign in to reschedule a post.' });
      } else if (result.error === 'network') {
        setNotice({ tone: 'error', message: 'Network error while rescheduling. Check your connection and try again.' });
      } else {
        setNotice({ tone: 'error', message: `Failed to reschedule: ${result.error}` });
      }
    } finally {
      setReschedulingId(null);
    }
  }, [currentUid, rescheduleInput]);

  const handleCancel = useCallback(async (postId: string) => {
    if (!currentUid) {
      setNotice({ tone: 'error', message: 'Sign in to cancel a scheduled post.' });
      return;
    }
    setCancellingId(postId);
    try {
      const result = await cancelScheduledPostApi(postId);
      if (result.success) {
        setNotice({ tone: 'success', message: 'Scheduled post cancelled.' });
        setSelectedPostId(null); // Firestore listener will remove the row; close the panel
      } else if (result.error === 'status_not_cancellable') {
        setNotice({ tone: 'error', message: 'This post is already publishing or published and can\'t be cancelled.' });
      } else if (result.error === 'not_found') {
        setNotice({ tone: 'error', message: 'Scheduled post not found (it may have already been cancelled).' });
      } else if (result.error === 'not_signed_in') {
        setNotice({ tone: 'error', message: 'Sign in to cancel a scheduled post.' });
      } else if (result.error === 'network') {
        setNotice({ tone: 'error', message: 'Network error while cancelling. Check your connection and try again.' });
      } else {
        setNotice({ tone: 'error', message: `Failed to cancel scheduled post: ${result.error}` });
      }
    } finally {
      setCancellingId(null);
      setConfirmingCancelId(null);
    }
  }, [currentUid]);

  const handlePresetClick = useCallback((deltaMs: number) => {
    if (!selectedPost) return;
    const base = Math.max(Date.now(), selectedPost.scheduledForMs);
    const next = new Date(base + deltaMs);
    setRescheduleInput(formatScheduledAtInputValue(next));
  }, [selectedPost]);

  const noticeColorClass = useMemo(() => {
    if (!notice) return '';
    if (notice.tone === 'success') {
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    }
    if (notice.tone === 'error') {
      return 'border-red-200 bg-red-50 text-red-700';
    }
    return 'border-sky-200 bg-sky-50 text-sky-800';
  }, [notice]);

  const monthLabel = formatMonthLabel(viewMonth);

  // Visibility predicate for reschedule UI in the detail modal.
  const canReschedule = selectedPost
    ? isReschedulable(selectedPost.status) &&
      (selectedPost.status === 'failed' || selectedPost.scheduledForMs > Date.now())
    : false;
  const canCancel = selectedPost ? isCancellable(selectedPost.status) : false;

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 7.5</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Scheduled Posts Calendar</h1>
        <p className="mt-1 muted-copy">
          All your scheduled, queued, published, and failed posts on a month grid.
        </p>

        {notice ? (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${noticeColorClass}`}>
            <p>{notice.message}</p>
            {notice.linkHref ? (
              <p className="mt-1">
                {/^https?:\/\//i.test(notice.linkHref) ? (
                  <a
                    href={notice.linkHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                  >
                    {notice.linkText ?? notice.linkHref}
                  </a>
                ) : (
                  <Link href={notice.linkHref} className="font-semibold underline">
                    {notice.linkText ?? notice.linkHref}
                  </Link>
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {isAuthLoading || isPostsLoading ? (
        <section className="surface-card p-6 text-sm text-slate-600">
          <Spinner size="sm" label="Loading scheduled posts..." />
        </section>
      ) : null}

      {loadError ? (
        <section className="surface-card p-6">
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>
        </section>
      ) : null}

      {!isAuthLoading && !isPostsLoading && !loadError ? (
        <>
          <section className="surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setViewMonth((prev) => addMonths(prev, -1))}
                  aria-label="Previous month"
                  data-testid="calendar-prev-month"
                >
                  ←
                </button>
                <span className="min-w-[10rem] text-center text-sm font-semibold text-slate-900" data-testid="calendar-month-label">
                  {monthLabel}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setViewMonth((prev) => addMonths(prev, 1))}
                  aria-label="Next month"
                  data-testid="calendar-next-month"
                >
                  →
                </button>
                <button
                  type="button"
                  className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setViewMonth(startOfMonth(new Date()))}
                  data-testid="calendar-today"
                >
                  Today
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((filter) => {
                  const isActive = statusFilter === filter;
                  const label = filter === 'all' ? 'All' : STATUS_LABELS[filter];
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setStatusFilter(filter)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        isActive
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                      data-testid={`calendar-filter-${filter}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="grid grid-cols-7 gap-2 text-center text-xs">
              {calendarCells.map((cell, index) => {
                if (cell.kind === 'header') {
                  return (
                    <div
                      key={`h-${cell.label}`}
                      className="py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {cell.label}
                    </div>
                  );
                }
                if (cell.kind === 'blank') {
                  return <div key={cell.key} className="min-h-[100px] rounded-xl" />;
                }

                const visiblePosts = cell.posts.slice(0, 3);
                const hiddenCount = cell.posts.length - visiblePosts.length;

                return (
                  <div
                    key={`d-${cell.day}-${index}`}
                    className={`min-h-[100px] rounded-xl border border-slate-200 bg-white p-2 text-left ${
                      cell.isToday ? 'ring-2 ring-emerald-400' : ''
                    }`}
                    data-testid={`calendar-day-${cell.day}`}
                  >
                    <div className="mb-1 flex items-center justify-end">
                      <span className="text-xs font-semibold text-slate-700">{cell.day}</span>
                    </div>
                    <div className="space-y-1">
                      {visiblePosts.map((post) => {
                        const status = post.status ?? 'scheduled';
                        const pillClass = STATUS_PILL_CLASSNAMES[status];
                        const dotClass = STATUS_DOT_CLASSNAMES[status];
                        const showExternal = status === 'published' && Boolean(post.postUrl);
                        const titleAttr = `${STATUS_LABELS[status]} · ${new Date(post.scheduledForMs).toLocaleString()}${
                          post.failureReason ? ` · ${post.failureReason.replace(/_/g, ' ')}` : ''
                        }`;
                        return (
                          <button
                            key={post.id}
                            type="button"
                            data-testid={`calendar-post-pill-${post.id}`}
                            onClick={() => setSelectedPostId(post.id)}
                            title={titleAttr}
                            className={`flex w-full items-center gap-1 truncate rounded-md px-2 py-1 text-left text-[11px] font-medium ${pillClass}`}
                          >
                            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                            <span className="shrink-0 tabular-nums">{formatLocalHHMM(post.scheduledForMs)}</span>
                            <span className="truncate">{post.articleTitle}</span>
                            {showExternal ? <span aria-hidden="true">↗</span> : null}
                          </button>
                        );
                      })}
                      {hiddenCount > 0 ? (
                        <button
                          type="button"
                          className="w-full rounded-md px-2 py-1 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                          onClick={() => {
                            const firstHidden = cell.posts[visiblePosts.length];
                            if (firstHidden) setSelectedPostId(firstHidden.id);
                          }}
                          data-testid={`calendar-day-more-${cell.day}`}
                        >
                          +{hiddenCount} more
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {filteredPosts.length === 0 && scheduledPosts.length === 0 ? (
            <section className="surface-card p-6 text-center">
              <p className="text-sm text-slate-700">No scheduled posts yet.</p>
              <p className="mt-2 text-sm">
                <Link href="/publish" className="font-semibold text-blue-700 hover:underline">
                  Go to Publish →
                </Link>
              </p>
            </section>
          ) : null}

          {filteredPosts.length === 0 && scheduledPosts.length > 0 ? (
            <section className="surface-card p-4">
              <p className="text-xs text-slate-600">No posts in this month. Use the arrows to navigate.</p>
            </section>
          ) : null}
        </>
      ) : null}

      {/* Detail modal */}
      {selectedPost ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => setSelectedPostId(null)}
          data-testid="calendar-detail-backdrop"
        >
          <div
            className="surface-card mx-4 max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            data-testid="calendar-detail-modal"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                    STATUS_BADGE_CLASSNAMES[selectedPost.status ?? 'scheduled']
                  }`}
                >
                  {STATUS_LABELS[selectedPost.status ?? 'scheduled']}
                </span>
                <h2 className="mt-2 truncate text-xl font-extrabold text-slate-900">{selectedPost.articleTitle}</h2>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setSelectedPostId(null)}
                aria-label="Close detail panel"
                data-testid="calendar-detail-close"
              >
                ×
              </button>
            </div>

            {selectedPost.ideaTopic ? (
              <p className="mt-3 text-sm text-slate-700">
                <span className="font-semibold text-slate-500">Idea topic: </span>
                {selectedPost.ideaTopic}
              </p>
            ) : null}
            {selectedPost.angleTitle ? (
              <p className="mt-1 text-sm text-slate-700">
                <span className="font-semibold text-slate-500">Angle: </span>
                {selectedPost.angleTitle}
              </p>
            ) : null}

            <p
              className="mt-3 text-sm text-slate-800"
              title={new Date(selectedPost.scheduledForMs).toISOString()}
            >
              <span className="font-semibold text-slate-500">Scheduled for: </span>
              {new Date(selectedPost.scheduledForMs).toLocaleString()}
            </p>

            {selectedPost.platforms.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Platforms:</span>
                {selectedPost.platforms.map((platform) => (
                  <span
                    key={platform}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
                  >
                    {formatPlatformLabel(platform)}
                  </span>
                ))}
              </div>
            ) : null}

            {selectedPost.contentSnapshotLinkedin ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Content preview</p>
                <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                  {selectedPost.contentSnapshotLinkedin}
                </pre>
              </div>
            ) : null}

            {selectedPost.status === 'published' ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-semibold">Published successfully.</p>
                {selectedPost.publishedAtMs ? (
                  <p className="mt-1 text-xs">
                    Posted at {new Date(selectedPost.publishedAtMs).toLocaleString()}
                  </p>
                ) : null}
                {selectedPost.postUrl ? (
                  <p className="mt-2 text-sm">
                    <a
                      href={selectedPost.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-700 hover:underline"
                      data-testid="calendar-detail-view-on-linkedin"
                    >
                      View on LinkedIn →
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}

            {selectedPost.status === 'failed' ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <p className="font-semibold">Publishing failed.</p>
                <p className="mt-1 text-xs">
                  Failure reason: {selectedPost.failureReason || 'unknown'}
                </p>
                {selectedPost.failureReason === 'token_expired' ? (
                  <p className="mt-2 text-sm">
                    <Link
                      href="/settings#integrations"
                      className="font-semibold text-blue-700 hover:underline"
                      data-testid="calendar-detail-reconnect-linkedin"
                    >
                      Reconnect LinkedIn →
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}

            {canReschedule ? (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Reschedule</h3>
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                  <label className="text-sm text-slate-700">
                    <span className="mb-1 block font-medium">New publish date &amp; time</span>
                    <input
                      type="datetime-local"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                      value={rescheduleInput}
                      onChange={(event) => setRescheduleInput(event.target.value)}
                      data-testid="calendar-detail-reschedule-input"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => handlePresetClick(60 * 60 * 1000)}
                      data-testid="calendar-detail-preset-1h"
                    >
                      +1h
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => handlePresetClick(24 * 60 * 60 * 1000)}
                      data-testid="calendar-detail-preset-1d"
                    >
                      +1d
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => handlePresetClick(7 * 24 * 60 * 60 * 1000)}
                      data-testid="calendar-detail-preset-1w"
                    >
                      +1w
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  {(() => {
                    const parsedMs = parseScheduledAtInputValue(rescheduleInput);
                    const saveDisabled =
                      parsedMs <= Date.now() + 60_000 ||
                      parsedMs === selectedPost.scheduledForMs ||
                      reschedulingId === selectedPost.id;
                    return (
                      <button
                        type="button"
                        className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                        onClick={() => { void handleReschedule(selectedPost.id); }}
                        disabled={saveDisabled}
                        data-testid="calendar-detail-save-reschedule"
                      >
                        {reschedulingId === selectedPost.id ? 'Rescheduling…' : 'Save reschedule'}
                      </button>
                    );
                  })()}
                </div>
              </div>
            ) : null}

            {canCancel ? (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Cancel</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {confirmingCancelId === selectedPost.id ? (
                    <>
                      <button
                        type="button"
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                        onClick={() => { void handleCancel(selectedPost.id); }}
                        disabled={cancellingId === selectedPost.id}
                        data-testid="calendar-detail-confirm-cancel"
                      >
                        {cancellingId === selectedPost.id ? 'Cancelling…' : 'Confirm cancel'}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        onClick={() => setConfirmingCancelId(null)}
                        disabled={cancellingId === selectedPost.id}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                      onClick={() => setConfirmingCancelId(selectedPost.id)}
                      data-testid="calendar-detail-cancel"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
