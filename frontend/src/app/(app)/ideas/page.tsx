'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore';

import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { setWorkflowContext } from '@/lib/workflowContext';
import { Spinner } from '@/components/Spinner';
import WorkflowStepper from '@/components/WorkflowStepper';

type IdeaRecord = {
  id: string;
  topic: string;
  tone: string;
  audience: string;
  format: string;
  userId: string;
  createdAtMs: number;
  createdAtLabel: string;
  relevance: IdeaRelevanceMetadata | null;
};

type IdeaSort = 'newest' | 'oldest' | 'topic' | 'rating';

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

type IdeaRating = {
  score: number;
  label: 'Strong' | 'Moderate' | 'Weak';
  reason: string;
};

type IdeaRelevanceMetadata = IdeaRating & {
  scoredAtMs: number;
};

const TONE_OPTIONS = ['Professional', 'Casual', 'Storytelling', 'Data-driven', 'Practical'];
const AUDIENCE_OPTIONS = ['Small Business', 'Enterprise', 'B2B', 'Consumer', 'Agencies'];
const DEFAULT_IDEA_FORMAT = 'Unspecified';
const IDEAS_SORT_PREFERENCE_KEY = 'ideas_sort_preference';

const RELEVANCE_KEYWORDS = [
  'ai',
  'automation',
  'content',
  'marketing',
  'growth',
  'pipeline',
  'conversion',
  'lead',
  'seo',
  'campaign',
  'audience',
  'brand',
  'engagement',
  'analytics',
  'retention',
  'strategy',
];

function formatIdeaTimestamp(value: unknown, fallbackTimestamp: number): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate: () => Date };
    return candidate.toDate().toLocaleString();
  }

  return new Date(fallbackTimestamp).toLocaleString();
}

function scoreIdeaTopic(topic: string): IdeaRating {
  const cleaned = topic.trim();
  const words = cleaned.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
  const keywordHits = words.filter((word) => RELEVANCE_KEYWORDS.includes(word)).length;
  const lengthScore = Math.min(30, words.length * 2.5);
  const specificityScore = Math.min(25, keywordHits * 6.5);
  const sentenceBonus = cleaned.length >= 40 ? 10 : 0;
  const questionBonus = cleaned.includes('?') ? 8 : 0;
  const score = Math.max(5, Math.min(100, Math.round(22 + lengthScore + specificityScore + sentenceBonus + questionBonus)));

  if (score >= 75) {
    return {
      score,
      label: 'Strong',
      reason: 'Clear and specific with high relevance for content planning.',
    };
  }

  if (score >= 50) {
    return {
      score,
      label: 'Moderate',
      reason: 'Useful idea, but adding more specificity will improve angle quality.',
    };
  }

  return {
    score,
    label: 'Weak',
    reason: 'Too broad. Add audience, outcome, or specific context to improve relevance.',
  };
}

function normalizeRelevanceMetadata(value: unknown): IdeaRelevanceMetadata | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    score?: unknown;
    label?: unknown;
    reason?: unknown;
    scoredAtMs?: unknown;
  };

  if (typeof candidate.score !== 'number') {
    return null;
  }

  if (candidate.label !== 'Strong' && candidate.label !== 'Moderate' && candidate.label !== 'Weak') {
    return null;
  }

  if (typeof candidate.reason !== 'string') {
    return null;
  }

  if (typeof candidate.scoredAtMs !== 'number') {
    return null;
  }

  return {
    score: candidate.score,
    label: candidate.label,
    reason: candidate.reason,
    scoredAtMs: candidate.scoredAtMs,
  };
}

function compareIdeasForRatingSort(left: IdeaRecord, right: IdeaRecord): number {
  const leftRelevance = left.relevance;
  const rightRelevance = right.relevance;

  if (!leftRelevance && !rightRelevance) {
    return right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id);
  }

  if (!leftRelevance) {
    return 1;
  }

  if (!rightRelevance) {
    return -1;
  }

  return (
    rightRelevance.score - leftRelevance.score ||
    rightRelevance.scoredAtMs - leftRelevance.scoredAtMs ||
    right.createdAtMs - left.createdAtMs ||
    left.id.localeCompare(right.id)
  );
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
  const previousAuthUserRef = useRef<User | null>(null);

  const getInitialSortPreference = (): IdeaSort => {
    if (typeof window === 'undefined') {
      return 'rating';
    }

    try {
      const persistedSort = sessionStorage.getItem(IDEAS_SORT_PREFERENCE_KEY);
      if (persistedSort === 'newest' || persistedSort === 'oldest' || persistedSort === 'topic' || persistedSort === 'rating') {
        return persistedSort;
      }
    } catch {
      // sessionStorage unavailable
    }

    return 'rating';
  };

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [ideas, setIdeas] = useState<IdeaRecord[]>([]);
  const [ideaText, setIdeaText] = useState('');
  const [tone, setTone] = useState(TONE_OPTIONS[0]);
  const [audience, setAudience] = useState(AUDIENCE_OPTIONS[0]);
  const [sortBy, setSortBy] = useState<IdeaSort>(getInitialSortPreference);
  const [toneFilter, setToneFilter] = useState<string>('All');
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [isIdeasLoading, setIsIdeasLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [isTrendsLoading, setIsTrendsLoading] = useState(true);

  function updateSortPreference(nextSort: IdeaSort): void {
    try {
      sessionStorage.setItem(IDEAS_SORT_PREFERENCE_KEY, nextSort);
    } catch {
      // sessionStorage unavailable
    }

    setSortBy(nextSort);
  }

  useEffect(() => {
    const firebaseAuth = getFirebaseAuth();
    const firestore = getFirebaseDb();

    if (!firebaseAuth || !firestore) {
      setIdeasError('Ideas are unavailable until Firebase is configured for this app.');
      setIsIdeasLoading(false);
      return;
    }

    let unsubscribeIdeas: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
      unsubscribeIdeas?.();
      const previousUser = previousAuthUserRef.current;
      const didSignOut = Boolean(previousUser && !user);
      previousAuthUserRef.current = user;

      setCurrentUser(user);
      setIdeasError(null);

      if (!user) {
        if (didSignOut) {
          try {
            sessionStorage.removeItem(IDEAS_SORT_PREFERENCE_KEY);
          } catch {
            // sessionStorage unavailable
          }

          setSortBy('rating');
        }

        setIdeas([]);
        setIsIdeasLoading(false);
        return;
      }

      setIsIdeasLoading(true);
      const ideasQuery = query(collection(firestore, 'users', user.uid, 'ideas'), orderBy('createdAtMs', 'desc'));

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
              relevance: normalizeRelevanceMetadata(data.relevance),
            } satisfies IdeaRecord;
          });

          setIdeas(nextIdeas);
          setIsIdeasLoading(false);
        },
        () => {
          setIdeasError('Unable to load your saved ideas right now.');
          setIdeas([]);
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
      setIsTrendsLoading(true);
      setTrendsError(null);

      try {
        const response = await fetch('/api/trends', { signal: controller.signal });

        if (!response.ok) {
          throw new Error('Trend request failed.');
        }

        const payload = (await response.json()) as TrendsResponse;
        setTrends(payload);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : 'Unable to load live trend signals right now.';
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
      setSubmitError('Idea text is required.');
      setSubmitSuccess(null);
      return;
    }

    if (topic.length < 12) {
      setSubmitError('Use one specific sentence so relevance scoring and angle generation are reliable.');
      setSubmitSuccess(null);
      return;
    }

    const firestore = getFirebaseDb();
    if (!firestore || !currentUser) {
      setSubmitError('You must be signed in with Firebase configured before saving ideas.');
      setSubmitSuccess(null);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const scoredAtMs = Date.now();
      const relevance = scoreIdeaTopic(topic);

      await addDoc(collection(firestore, 'users', currentUser.uid, 'ideas'), {
        topic,
        tone,
        audience,
        format: DEFAULT_IDEA_FORMAT,
        userId: currentUser.uid,
        relevance: {
          score: relevance.score,
          label: relevance.label,
          reason: relevance.reason,
          scoredAtMs,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdAtMs: scoredAtMs,
      });

      setIdeaText('');
      setSubmitSuccess('Idea saved to your Firebase backlog.');
    } catch {
      setSubmitError('Unable to save your idea right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openAnglesForIdea(idea: IdeaRecord): Promise<void> {
    setWorkflowContext({ ideaId: idea.id, ideaTopic: idea.topic });

    try {
      localStorage.setItem(
        'angles_idea_context',
        JSON.stringify({
          ideaId: idea.id,
          topic: idea.topic,
          tone: idea.tone,
          audience: idea.audience,
          format: idea.format,
          createdAtMs: idea.createdAtMs,
        }),
      );
    } catch {
      // localStorage unavailable - Firestore fetch on Angles page is the fallback
    }

    const db = getFirebaseDb();
    if (db && currentUser) {
      try {
        // Check adaptations first (furthest completed step)
        const adaptSnap = await getDocs(
          query(
            collection(db, 'users', currentUser.uid, 'adaptations'),
            where('ideaId', '==', idea.id),
            orderBy('updatedAt', 'desc'),
            limit(1),
          ),
        );
        if (!adaptSnap.empty) {
          const adaptation = adaptSnap.docs[0].data();
          const angleId = typeof adaptation.angleId === 'string' ? adaptation.angleId : '';
          if (angleId) {
            router.push(`/adapt/${encodeURIComponent(idea.id)}?angleId=${encodeURIComponent(angleId)}`);
            return;
          }
        }
      } catch {
        // Fall through
      }

      try {
        // Check drafts (storyboard step)
        const draftsQ = query(
          collection(db, 'users', currentUser.uid, 'drafts'),
          where('ideaId', '==', idea.id),
          orderBy('updatedAt', 'desc'),
          limit(1),
        );
        const snap = await getDocs(draftsQ);
        if (!snap.empty) {
          const draft = snap.docs[0].data();
          const angleId = typeof draft.angleId === 'string' ? draft.angleId : '';
          if (angleId) {
            router.push(`/storyboard/${encodeURIComponent(idea.id)}?angleId=${encodeURIComponent(angleId)}`);
            return;
          }
        }
      } catch {
        // Fall through to angles on Firestore error
      }
    }

    router.push(`/angles?ideaId=${encodeURIComponent(idea.id)}`);
  }

  const visibleIdeas = useMemo(() => {
    return ideas
      .filter((idea) => toneFilter === 'All' || idea.tone === toneFilter)
      .sort((left, right) => {
        if (sortBy === 'oldest') {
          return left.createdAtMs - right.createdAtMs;
        }

        if (sortBy === 'topic') {
          return left.topic.localeCompare(right.topic);
        }

        if (sortBy === 'rating') {
          return compareIdeasForRatingSort(left, right);
        }

        return right.createdAtMs - left.createdAtMs;
      });
  }, [ideas, toneFilter, sortBy]);

  const draftRating = ideaText.trim().length > 0 ? scoreIdeaTopic(ideaText) : null;

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1 space-y-5">
        <div className="page-header">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1>Idea Input and Backlog</h1>
              <p className="breadcrumb">
                Enter one-sentence topics, review AI relevance scores, and open Angles by selecting any idea.
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
        <WorkflowStepper />

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
              rows={3}
              placeholder="Write one sentence topic description..."
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
            {draftRating ? (
              <p className="text-xs text-slate-600">
                Relevance rating preview: <span className="font-semibold text-slate-800">{draftRating.score}/100</span> ({draftRating.label})
              </p>
            ) : null}
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
              <button
                type="submit"
                className="ml-auto rounded-xl px-5 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: '#1a7a5e' }}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Spinner size="sm" label="Saving..." /> : 'Add Idea'}
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
                onChange={(event) => updateSortPreference(event.target.value as IdeaSort)}
              >
                <option value="newest">Sort: Newest</option>
                <option value="oldest">Sort: Oldest</option>
                <option value="topic">Sort: Topic A-Z</option>
                <option value="rating">Sort: Rating High-Low</option>
              </select>
              <select className="pill bg-white" value={toneFilter} onChange={(event) => setToneFilter(event.target.value)}>
                <option value="All">Tone: All</option>
                {TONE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Tone: {option}
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
          {isIdeasLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size="sm" />
              <span>Loading your saved ideas...</span>
            </div>
          ) : null}
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
                    <th className="pb-3 pr-4">Rating</th>
                    <th className="pb-3 pr-4">Tone</th>
                    <th className="pb-3 pr-4">Audience</th>
                    <th className="pb-3 pr-4">Created</th>
                    <th className="pb-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleIdeas.map((idea) => {
                    const rating = idea.relevance;

                    return (
                      <tr key={idea.id}>
                        <td className="py-3 pr-4 font-semibold text-slate-800">{idea.topic}</td>
                        <td className="py-3 pr-4">
                          {rating ? (
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">{rating.score}</span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  rating.label === 'Strong'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : rating.label === 'Moderate'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-rose-100 text-rose-700'
                                }`}
                                title={rating.reason}
                              >
                                {rating.label}
                              </span>
                            </div>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600" title="No saved relevance metadata.">
                              Unscored
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">{idea.tone}</td>
                        <td className="py-3 pr-4 text-slate-600">{idea.audience}</td>
                        <td className="py-3 pr-4 text-slate-500">{idea.createdAtLabel}</td>
                        <td className="py-3">
                          <button
                            type="button"
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => { void openAnglesForIdea(idea); }}
                          >
                            Open Angles
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
