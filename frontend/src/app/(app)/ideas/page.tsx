'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';

import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';

type IdeaRecord = {
  id: string;
  topic: string;
  tone: string;
  audience: string;
  format: string;
  userId: string;
  createdAtMs: number;
  createdAtLabel: string;
};

type TrendTopic = {
  label: string;
  count: number;
};

type TrendArticle = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

type TrendsResponse = {
  topics: TrendTopic[];
  articles: TrendArticle[];
  fetchedAt: string;
};

const TONE_OPTIONS = ['Professional', 'Casual', 'Storytelling', 'Data-driven', 'Practical'];
const AUDIENCE_OPTIONS = ['Small Business', 'Enterprise', 'B2B', 'Consumer', 'Agencies'];
const FORMAT_OPTIONS = ['Blog Post', 'Article', 'Newsletter', 'Report', 'Case Study'];

function formatIdeaTimestamp(value: unknown, fallbackTimestamp: number): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate: () => Date };
    return candidate.toDate().toLocaleString();
  }

  return new Date(fallbackTimestamp).toLocaleString();
}

function TrendsPanel({
  articles,
  isLoading,
  errorMessage,
  topics,
}: {
  articles: TrendArticle[];
  isLoading: boolean;
  errorMessage: string | null;
  topics: TrendTopic[];
}) {
  return (
    <aside className="trends-panel hidden w-72 shrink-0 xl:block">
      <h2>Live Trend Signals</h2>
      {isLoading ? <p className="article-item">Loading trend signals...</p> : null}
      {errorMessage ? <p className="article-item">{errorMessage}</p> : null}
      {!isLoading && !errorMessage && topics.length === 0 ? (
        <p className="article-item">No live trend topics were returned.</p>
      ) : null}
      <div className="space-y-2">
        {topics.map((topic) => (
          <div key={topic.label} className="trend-item rounded-xl border border-white/10 px-3 py-2 no-underline">
            <p>{topic.label}</p>
            <span className="trend-score">Matched articles: {topic.count}</span>
          </div>
        ))}
      </div>

      <h2 className="mt-5">Relevant Articles</h2>
      {!isLoading && !errorMessage && articles.length === 0 ? (
        <p className="article-item">No live articles were returned.</p>
      ) : null}
      <div>
        {articles.map((article) => (
          <div key={article.url} className="article-item">
            <a href={article.url} target="_blank" rel="noreferrer">
              {article.title}
            </a>
            <span className="article-date">
              {article.source} · {article.publishedAt}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

export default function IdeasPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [ideas, setIdeas] = useState<IdeaRecord[]>([]);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [ideaText, setIdeaText] = useState('');
  const [tone, setTone] = useState(TONE_OPTIONS[0]);
  const [audience, setAudience] = useState(AUDIENCE_OPTIONS[0]);
  const [format, setFormat] = useState(FORMAT_OPTIONS[0]);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'topic'>('newest');
  const [toneFilter, setToneFilter] = useState<string>('All');
  const [formatFilter, setFormatFilter] = useState<string>('All');
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [isIdeasLoading, setIsIdeasLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [isTrendsLoading, setIsTrendsLoading] = useState(true);

  useEffect(() => {
    const firebaseAuth = getFirebaseAuth();
    const firestore = getFirebaseDb();

    if (!firebaseAuth || !firestore) {
      console.error('[Ideas Page] Firebase not configured - Auth or Firestore unavailable');
      setIdeasError('Ideas are unavailable until Firebase is configured for this app.');
      setIsIdeasLoading(false);
      return;
    }

    console.debug('[Ideas Page] Firebase is configured, setting up auth listener');
    let unsubscribeIdeas: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
      unsubscribeIdeas?.();
      console.debug('[Ideas Page] Auth state changed', { userId: user?.uid, email: user?.email });
      setCurrentUser(user);
      setIdeasError(null);

      if (!user) {
        console.debug('[Ideas Page] User is signed out');
        setIdeas([]);
        setSelectedIdeaId(null);
        setIsIdeasLoading(false);
        return;
      }

      console.debug('[Ideas Page] User signed in, loading ideas from Firestore', { userId: user.uid });
      setIsIdeasLoading(true);
      const ideasQuery = query(
        collection(firestore, 'users', user.uid, 'ideas'),
        orderBy('createdAtMs', 'desc'),
      );

      unsubscribeIdeas = onSnapshot(
        ideasQuery,
        (snapshot) => {
          const nextIdeas = snapshot.docs.map((documentSnapshot) => {
            const data = documentSnapshot.data();
            const createdAtMs = typeof data.createdAtMs === 'number' ? data.createdAtMs : Date.now();

            return {
              id: documentSnapshot.id,
              topic: typeof data.topic === 'string' ? data.topic : '',
              tone: typeof data.tone === 'string' ? data.tone : 'Unspecified',
              audience: typeof data.audience === 'string' ? data.audience : 'Unspecified',
              format: typeof data.format === 'string' ? data.format : 'Unspecified',
              userId: typeof data.userId === 'string' ? data.userId : user.uid,
              createdAtMs,
              createdAtLabel: formatIdeaTimestamp(data.createdAt, createdAtMs),
            } satisfies IdeaRecord;
          });

          console.debug('[Ideas Page] Ideas loaded from Firestore', {
            count: nextIdeas.length,
            ideas: nextIdeas.map((i) => ({ id: i.id, topic: i.topic })),
          });

          setIdeas(nextIdeas);
          setSelectedIdeaId((previousValue) => {
            if (previousValue && nextIdeas.some((idea) => idea.id === previousValue)) {
              return previousValue;
            }

            return nextIdeas[0]?.id ?? null;
          });
          setIsIdeasLoading(false);
        },
        (error) => {
          console.error('[Ideas Page] Error loading ideas from Firestore:', error);
          setIdeasError('Unable to load your saved ideas right now.');
          setIdeas([]);
          setSelectedIdeaId(null);
          setIsIdeasLoading(false);
        },
      );
    });

    return () => {
      unsubscribeIdeas?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadTrends(): Promise<void> {
      console.debug('[Ideas Page] Loading trends from /api/trends');
      setIsTrendsLoading(true);
      setTrendsError(null);

      try {
        const response = await fetch('/api/trends', {
          signal: controller.signal,
        });

        if (!response.ok) {
          console.error('[Ideas Page] Trends request failed', { status: response.status });
          throw new Error('Trend request failed.');
        }

        const payload = (await response.json()) as TrendsResponse;
        console.debug('[Ideas Page] Trends loaded successfully', {
          topicCount: payload.topics.length,
          articleCount: payload.articles.length,
        });
        setTrends(payload);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : 'Unable to load live trend signals right now.';
        console.error('[Ideas Page] Error loading trends:', errorMessage);
        setTrends(null);
        setTrendsError(errorMessage);
      } finally {
        if (!controller.signal.aborted) {
          setIsTrendsLoading(false);
        }
      }
    }

    void loadTrends();

    return () => controller.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const topic = ideaText.trim();
    if (!topic) {
      console.warn('[Ideas Page] Idea submission blocked - empty topic');
      setSubmitError('Idea text is required.');
      setSubmitSuccess(null);
      return;
    }

    if (topic.length < 8) {
      console.warn('[Ideas Page] Idea submission blocked - topic too short', { length: topic.length });
      setSubmitError('Idea text should be at least 8 characters so it is useful later.');
      setSubmitSuccess(null);
      return;
    }

    const firestore = getFirebaseDb();
    if (!firestore || !currentUser) {
      console.error('[Ideas Page] Cannot save idea - Firebase not configured or user not authenticated');
      setSubmitError('You must be signed in with Firebase configured before saving ideas.');
      setSubmitSuccess(null);
      return;
    }

    console.debug('[Ideas Page] Submitting new idea', {
      userId: currentUser.uid,
      topicLength: topic.length,
      tone,
      audience,
      format,
    });

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const docRef = await addDoc(collection(firestore, 'users', currentUser.uid, 'ideas'), {
        topic,
        tone,
        audience,
        format,
        userId: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdAtMs: Date.now(),
      });

      console.debug('[Ideas Page] Idea saved successfully to Firestore', {
        docId: docRef.id,
        userId: currentUser.uid,
      });

      setIdeaText('');
      setSubmitSuccess('Idea saved to your Firebase backlog.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Ideas Page] Error saving idea to Firestore:', errorMessage, error);
      setSubmitError('Unable to save your idea right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const visibleIdeas = ideas
    .filter((idea) => toneFilter === 'All' || idea.tone === toneFilter)
    .filter((idea) => formatFilter === 'All' || idea.format === formatFilter)
    .sort((left, right) => {
      if (sortBy === 'oldest') {
        return left.createdAtMs - right.createdAtMs;
      }

      if (sortBy === 'topic') {
        return left.topic.localeCompare(right.topic);
      }

      return right.createdAtMs - left.createdAtMs;
    });

  const selectedIdea = visibleIdeas.find((idea) => idea.id === selectedIdeaId)
    ?? ideas.find((idea) => idea.id === selectedIdeaId)
    ?? null;

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1 space-y-5">
        <div className="page-header">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1>Idea Input &amp; Backlog</h1>
              <p className="breadcrumb">
                Capture ideas, save them to Firebase under the signed-in user, and track live market signals.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm" style={{ color: '#a7c9be' }}>
              <span className="rounded-full border border-white/10 px-3 py-1">
                Ideas saved: <span className="font-semibold text-white">{ideas.length}</span>
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1">
                Signed in as <span className="font-semibold text-white">{currentUser?.email ?? 'loading...'}</span>
              </span>
            </div>
          </div>
        </div>

        <section className="surface-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="section-title">New Idea</h2>
            {submitSuccess ? <p className="text-sm font-medium text-emerald-700">{submitSuccess}</p> : null}
          </div>

          {submitError ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          ) : null}

          <form className="space-y-3" onSubmit={handleSubmit}>
            <textarea
              className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
              rows={4}
              placeholder="Enter a new content idea..."
              value={ideaText}
              onChange={(event) => {
                setIdeaText(event.target.value);
                if (submitError) {
                  setSubmitError(null);
                }
                if (submitSuccess) {
                  setSubmitSuccess(null);
                }
              }}
              disabled={isSubmitting}
            />
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={tone}
                onChange={(event) => setTone(event.target.value)}
                disabled={isSubmitting}
              >
                {TONE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
                disabled={isSubmitting}
              >
                {AUDIENCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                value={format}
                onChange={(event) => setFormat(event.target.value)}
                disabled={isSubmitting}
              >
                {FORMAT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="ml-auto rounded-xl px-5 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: '#1a7a5e' }}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving...' : 'Add Idea'}
              </button>
            </div>
          </form>
        </section>

        <section className="surface-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="section-title">Your Ideas</h2>
            <div className="flex flex-wrap gap-2">
              <select
                className="pill bg-white"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as 'newest' | 'oldest' | 'topic')}
              >
                <option value="newest">Sort: Newest</option>
                <option value="oldest">Sort: Oldest</option>
                <option value="topic">Sort: Topic A-Z</option>
              </select>
              <select
                className="pill bg-white"
                value={toneFilter}
                onChange={(event) => setToneFilter(event.target.value)}
              >
                <option value="All">Tone: All</option>
                {TONE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Tone: {option}
                  </option>
                ))}
              </select>
              <select
                className="pill bg-white"
                value={formatFilter}
                onChange={(event) => setFormatFilter(event.target.value)}
              >
                <option value="All">Format: All</option>
                {FORMAT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Format: {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {ideasError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {ideasError}
            </div>
          ) : null}
          {isIdeasLoading ? <p className="text-sm text-slate-500">Loading your saved ideas...</p> : null}
          {!isIdeasLoading && !ideasError && visibleIdeas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
              No ideas match the current filters yet.
            </div>
          ) : null}

          {!isIdeasLoading && !ideasError && visibleIdeas.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    <th className="pb-3 pr-4">Topic</th>
                    <th className="pb-3 pr-4">Tone</th>
                    <th className="pb-3 pr-4">Audience</th>
                    <th className="pb-3 pr-4">Format</th>
                    <th className="pb-3 pr-4">Created</th>
                    <th className="pb-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleIdeas.map((idea) => {
                    const isSelected = idea.id === selectedIdeaId;

                    return (
                      <tr key={idea.id} className={isSelected ? 'bg-emerald-50/60' : ''}>
                        <td className="py-3 pr-4 font-semibold text-slate-800">{idea.topic}</td>
                        <td className="py-3 pr-4 text-slate-600">{idea.tone}</td>
                        <td className="py-3 pr-4 text-slate-600">{idea.audience}</td>
                        <td className="py-3 pr-4 text-slate-600">{idea.format}</td>
                        <td className="py-3 pr-4 text-slate-500">{idea.createdAtLabel}</td>
                        <td className="py-3">
                          <button
                            type="button"
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => setSelectedIdeaId(idea.id)}
                          >
                            {isSelected ? 'Selected' : 'Select'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {selectedIdea ? (
          <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <section className="surface-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-title">Selected Idea</h2>
                <button
                  type="button"
                  className="rounded-xl px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
                  style={{ background: '#1a7a5e' }}
                  onClick={() => router.push(`/angles?ideaId=${encodeURIComponent(selectedIdea.id)}`)}
                >
                  Generate Angles
                </button>
              </div>
              <p className="text-lg font-semibold text-slate-900">{selectedIdea.topic}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-600">
                <span className="pill">Tone: {selectedIdea.tone}</span>
                <span className="pill">Audience: {selectedIdea.audience}</span>
                <span className="pill">Format: {selectedIdea.format}</span>
              </div>
              <p className="mt-4 text-sm text-slate-500">Created {selectedIdea.createdAtLabel}</p>
            </section>

            <section className="surface-card p-5">
              <h2 className="section-title mb-3">Live Trend Snapshot</h2>
              {isTrendsLoading ? <p className="text-sm text-slate-500">Loading live trend topics...</p> : null}
              {trendsError ? <p className="text-sm text-red-700">{trendsError}</p> : null}
              {!isTrendsLoading && !trendsError && trends?.topics.length === 0 ? (
                <p className="text-sm text-slate-500">No live topics were returned.</p>
              ) : null}
              <ul className="space-y-2 text-sm text-slate-700">
                {trends?.topics.slice(0, 4).map((topic) => (
                  <li key={topic.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    {topic.label}
                    <span className="ml-2 text-xs text-slate-500">{topic.count} related articles</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </div>

      <TrendsPanel
        articles={trends?.articles ?? []}
        errorMessage={trendsError}
        isLoading={isTrendsLoading}
        topics={trends?.topics ?? []}
      />
    </div>
  );
}
