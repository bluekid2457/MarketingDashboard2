'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import { getActiveAIKey } from '@/lib/aiConfig';
import { companyProfileToTrendTerms, loadCompanyProfileFromCache } from '@/lib/companyProfile';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { setWorkflowContext } from '@/lib/workflowContext';
import { Spinner } from '@/components/Spinner';
import WorkflowStepper from '@/components/WorkflowStepper';

type IdeaRecord = {
  id: string;
  title: string;
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
  improvements: string[];
  source: 'ai' | 'fallback';
};

type IdeaRelevanceMetadata = IdeaRating & {
  scoredAtMs: number;
};

type PersonalizationContext = {
  personal: string[];
  company: string[];
};

type RelevanceRationaleResponse = {
  reason: string;
  improvements: string[];
  source: 'ai' | 'fallback';
};

const TONE_OPTIONS = ['Professional', 'Casual', 'Storytelling', 'Data-driven', 'Practical'];
const AUDIENCE_OPTIONS = ['Small Business', 'Enterprise', 'B2B', 'Consumer', 'Agencies'];
const FORMAT_OPTIONS = ['Any', 'Article', 'Post', 'Thread', 'Newsletter', 'Video Script'];
const DEFAULT_IDEA_FORMAT = 'Unspecified';
const IDEAS_SORT_PREFERENCE_KEY = 'ideas_sort_preference';
const RELEVANCE_REQUEST_TIMEOUT_MS = 18_000;

const PERSONAL_CONTEXT_KEYS = [
  'persona',
  'role',
  'title',
  'bio',
  'aboutMe',
  'expertise',
  'goals',
  'painPoints',
  'brandVoice',
  'voice',
] as const;

const COMPANY_CONTEXT_KEYS = [
  'company',
  'companyName',
  'companyDescription',
  'organization',
  'industry',
  'product',
  'products',
  'service',
  'services',
  'valueProposition',
  'targetMarket',
] as const;

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
      reason: 'Deterministic fallback: the idea is specific, intent-led, and aligned to high-signal marketing terms.',
      improvements: [
        'Add one measurable KPI to strengthen execution clarity.',
        'Name one channel or campaign type to make downstream angles even tighter.',
      ],
      source: 'fallback',
    };
  }

  if (score >= 50) {
    return {
      score,
      label: 'Moderate',
      reason: 'Deterministic fallback: the idea is directionally useful, but still broad for high-confidence planning.',
      improvements: [
        'Specify the target segment more narrowly.',
        'Add an expected outcome and timeline to improve angle quality.',
      ],
      source: 'fallback',
    };
  }

  return {
    score,
    label: 'Weak',
    reason: 'Deterministic fallback: the idea is too broad and lacks enough context for reliable angle generation.',
    improvements: [
      'Include a concrete audience and one urgent pain point.',
      'Frame the idea as a clear problem-to-outcome statement.',
    ],
    source: 'fallback',
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeContextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const list = normalizeStringArray(value);
    return list.length > 0 ? list.join(', ') : '';
  }

  return '';
}

function buildContextLines(candidate: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys
    .map((key) => {
      const normalized = normalizeContextValue(candidate[key]);
      if (!normalized) {
        return '';
      }
      return `${key}: ${normalized}`;
    })
    .filter(Boolean);
}

function extractPersonalizationContext(value: unknown): PersonalizationContext {
  if (!value || typeof value !== 'object') {
    return { personal: [], company: [] };
  }

  const profileCandidate = value as Record<string, unknown>;
  const personal = buildContextLines(profileCandidate, PERSONAL_CONTEXT_KEYS);
  const company = buildContextLines(profileCandidate, COMPANY_CONTEXT_KEYS);

  const nestedPersonal = profileCandidate.personalContext;
  if (nestedPersonal && typeof nestedPersonal === 'object') {
    personal.push(...buildContextLines(nestedPersonal as Record<string, unknown>, PERSONAL_CONTEXT_KEYS));
  }

  const nestedCompany = profileCandidate.companyContext;
  if (nestedCompany && typeof nestedCompany === 'object') {
    company.push(...buildContextLines(nestedCompany as Record<string, unknown>, COMPANY_CONTEXT_KEYS));
  }

  return {
    personal: Array.from(new Set(personal)),
    company: Array.from(new Set(company)),
  };
}

async function loadPersonalizationContextForUser(userId: string): Promise<PersonalizationContext> {
  const firestore = getFirebaseDb();
  if (!firestore) {
    return { personal: [], company: [] };
  }

  try {
    const userSnapshot = await getDoc(doc(firestore, 'users', userId));
    if (!userSnapshot.exists()) {
      return { personal: [], company: [] };
    }

    return extractPersonalizationContext(userSnapshot.data());
  } catch {
    return { personal: [], company: [] };
  }
}

function buildFallbackRationale(
  scoreResult: IdeaRating,
  context: PersonalizationContext,
): RelevanceRationaleResponse {
  const contextNotes: string[] = [];

  if (context.personal.length > 0) {
    contextNotes.push('personal context signals were applied when available');
  }

  if (context.company.length > 0) {
    contextNotes.push('company context signals were applied when available');
  }

  const contextSuffix =
    contextNotes.length > 0
      ? ` (${contextNotes.join(' and ')})`
      : ' (no saved personal/company context found, so rationale used idea text only)';

  return {
    reason: `${scoreResult.reason}${contextSuffix}`,
    improvements: scoreResult.improvements,
    source: 'fallback',
  };
}

async function generateIdeaRationale(params: {
  topic: string;
  tone: string;
  audience: string;
  score: number;
  label: 'Strong' | 'Moderate' | 'Weak';
  fallbackReason: string;
  fallbackImprovements: string[];
  context: PersonalizationContext;
}): Promise<RelevanceRationaleResponse> {
  const ai = getActiveAIKey();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), RELEVANCE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('/api/ideas/rationale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        provider: ai.provider,
        apiKey: ai.apiKey,
        ollamaBaseUrl: ai.ollamaBaseUrl,
        ollamaModel: ai.ollamaModel,
        topic: params.topic,
        tone: params.tone,
        audience: params.audience,
        format: DEFAULT_IDEA_FORMAT,
        score: params.score,
        label: params.label,
        fallbackReason: params.fallbackReason,
        fallbackImprovements: params.fallbackImprovements,
        personalizationContext: params.context,
      }),
    });

    if (!response.ok) {
      throw new Error('Rationale request failed.');
    }

    const payload = (await response.json()) as Partial<RelevanceRationaleResponse>;
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    const improvements = normalizeStringArray(payload.improvements);
    const source: RelevanceRationaleResponse['source'] = payload.source === 'ai' ? 'ai' : 'fallback';

    if (!reason) {
      throw new Error('Rationale response missing reason text.');
    }

    return {
      reason,
      improvements,
      source,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function normalizeRelevanceMetadata(value: unknown): IdeaRelevanceMetadata | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    score?: unknown;
    label?: unknown;
    reason?: unknown;
    improvements?: unknown;
    source?: unknown;
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

  const improvements = normalizeStringArray(candidate.improvements);

  return {
    score: candidate.score,
    label: candidate.label,
    reason: candidate.reason,
    improvements,
    source: candidate.source === 'ai' ? 'ai' : 'fallback',
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
  const [ratingFilter, setRatingFilter] = useState<'All' | 'Strong' | 'Moderate' | 'Weak' | 'NoAngles'>('All');
  const [format, setFormat] = useState<string>('Any');
  const [draftMap, setDraftMap] = useState<Map<string, string>>(new Map()); // ideaId → angleId
  const [adaptMap, setAdaptMap] = useState<Map<string, string>>(new Map()); // ideaId → angleId
  const [openMenuIdeaId, setOpenMenuIdeaId] = useState<string | null>(null);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [isIdeasLoading, setIsIdeasLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTitleIdeaId, setEditingTitleIdeaId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [isSavingTitleIdeaId, setIsSavingTitleIdeaId] = useState<string | null>(null);
  const [titleEditError, setTitleEditError] = useState<string | null>(null);
  const [deletingIdeaId, setDeletingIdeaId] = useState<string | null>(null);
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
              title: typeof data.title === 'string' && data.title.trim().length > 0
                ? data.title.trim()
                : (typeof data.topic === 'string' ? data.topic : ''),
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
        const trendTerms = companyProfileToTrendTerms(loadCompanyProfileFromCache());
        const trendsUrl = trendTerms.length > 0
          ? `/api/trends?companyTerms=${encodeURIComponent(trendTerms.join(','))}`
          : '/api/trends';
        const response = await fetch(trendsUrl, { signal: controller.signal });

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

  useEffect(() => {
    if (!currentUser) {
      setDraftMap(new Map());
      setAdaptMap(new Map());
      return;
    }

    const firestore = getFirebaseDb();
    if (!firestore) {
      setDraftMap(new Map());
      setAdaptMap(new Map());
      return;
    }

    void (async () => {
      try {
        const [draftsSnap, adaptSnap] = await Promise.all([
          getDocs(collection(firestore, 'users', currentUser.uid, 'drafts')),
          getDocs(collection(firestore, 'users', currentUser.uid, 'adaptations')),
        ]);

        const nextDraftMap = new Map<string, string>();
        draftsSnap.docs.forEach((d) => {
          const data = d.data();
          const ideaId = typeof data.ideaId === 'string' ? data.ideaId.trim() : '';
          const angleId = typeof data.angleId === 'string' ? data.angleId.trim() : '';
          if (ideaId && angleId) {
            nextDraftMap.set(ideaId, angleId);
          }
        });

        const nextAdaptMap = new Map<string, string>();
        adaptSnap.docs.forEach((d) => {
          const data = d.data();
          const ideaId = typeof data.ideaId === 'string' ? data.ideaId.trim() : '';
          const angleId = typeof data.angleId === 'string' ? data.angleId.trim() : '';
          if (ideaId && angleId) {
            nextAdaptMap.set(ideaId, angleId);
          }
        });

        setDraftMap(nextDraftMap);
        setAdaptMap(nextAdaptMap);
      } catch {
        setDraftMap(new Map());
        setAdaptMap(new Map());
      }
    })();
  }, [currentUser]);

  async function submitIdea(scoreOnly: boolean): Promise<void> {
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
      const deterministicRelevance = scoreIdeaTopic(topic);
      const personalizationContext = await loadPersonalizationContextForUser(currentUser.uid);
      const fallbackRationale = buildFallbackRationale(deterministicRelevance, personalizationContext);

      let rationale = fallbackRationale;
      if (!scoreOnly) {
        try {
          rationale = await generateIdeaRationale({
            topic,
            tone,
            audience,
            score: deterministicRelevance.score,
            label: deterministicRelevance.label,
            fallbackReason: fallbackRationale.reason,
            fallbackImprovements: fallbackRationale.improvements,
            context: personalizationContext,
          });
        } catch {
          rationale = fallbackRationale;
        }
      }

      await addDoc(collection(firestore, 'users', currentUser.uid, 'ideas'), {
        title: topic,
        topic,
        tone,
        audience,
        format: format || DEFAULT_IDEA_FORMAT,
        userId: currentUser.uid,
        relevance: {
          score: deterministicRelevance.score,
          label: deterministicRelevance.label,
          reason: rationale.reason,
          improvements: rationale.improvements,
          source: rationale.source,
          scoredAtMs,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdAtMs: scoredAtMs,
      });

      setIdeaText('');
      setSubmitSuccess(scoreOnly ? 'Idea scored and saved.' : 'Idea saved to your Firebase backlog.');
    } catch {
      setSubmitError('Unable to save your idea right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await submitIdea(false);
  }

  function beginTitleEdit(idea: IdeaRecord): void {
    setTitleEditError(null);
    setEditingTitleIdeaId(idea.id);
    setEditingTitleValue((idea.title || idea.topic).trim());
  }

  function cancelTitleEdit(): void {
    setEditingTitleIdeaId(null);
    setEditingTitleValue('');
    setTitleEditError(null);
  }

  async function deleteIdea(idea: IdeaRecord): Promise<void> {
    if (!window.confirm(`Delete "${(idea.title || idea.topic).trim()}"? This cannot be undone.`)) return;
    const firestore = getFirebaseDb();
    if (!firestore || !currentUser) return;
    setDeletingIdeaId(idea.id);
    try {
      await deleteDoc(doc(firestore, 'users', currentUser.uid, 'ideas', idea.id));
    } catch {
      setIdeasError('Unable to delete this idea right now. Please try again.');
    } finally {
      setDeletingIdeaId(null);
    }
  }

  async function saveTitleEdit(idea: IdeaRecord): Promise<void> {
    const nextTitle = editingTitleValue.trim();
    if (!nextTitle) {
      setTitleEditError('Title cannot be empty.');
      return;
    }

    const firestore = getFirebaseDb();
    if (!firestore || !currentUser) {
      setTitleEditError('You must be signed in with Firebase configured before renaming ideas.');
      return;
    }

    setTitleEditError(null);
    setIsSavingTitleIdeaId(idea.id);

    try {
      await updateDoc(doc(firestore, 'users', currentUser.uid, 'ideas', idea.id), {
        title: nextTitle,
        updatedAt: serverTimestamp(),
      });
      cancelTitleEdit();
    } catch {
      setTitleEditError('Unable to save the new title right now. Please try again.');
    } finally {
      setIsSavingTitleIdeaId(null);
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
      .filter((idea) => {
        if (ratingFilter === 'All') return true;
        if (ratingFilter === 'Strong') return idea.relevance?.label === 'Strong';
        if (ratingFilter === 'Moderate') return idea.relevance?.label === 'Moderate';
        if (ratingFilter === 'Weak') return idea.relevance?.label === 'Weak';
        if (ratingFilter === 'NoAngles') return !draftMap.has(idea.id) && !adaptMap.has(idea.id);
        return true;
      })
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
  }, [ideas, ratingFilter, sortBy, draftMap, adaptMap]);

  const strongCount = ideas.filter((i) => i.relevance?.label === 'Strong').length;
  const moderateCount = ideas.filter((i) => i.relevance?.label === 'Moderate').length;
  const weakCount = ideas.filter((i) => i.relevance?.label === 'Weak').length;
  const noAnglesCount = ideas.filter((i) => !draftMap.has(i.id) && !adaptMap.has(i.id)).length;

  const lastScoredMs = ideas.reduce<number | null>((max, idea) => {
    const scored = idea.relevance?.scoredAtMs;
    if (typeof scored === 'number') {
      return max === null ? scored : Math.max(max, scored);
    }
    return max;
  }, null);

  const lastScoredLabel = (() => {
    if (lastScoredMs === null) return 'never';
    const diffMin = Math.floor((Date.now() - lastScoredMs) / 60_000);
    if (diffMin < 1) return 'just now';
    return `${diffMin} min ago`;
  })();

  const draftRating = ideaText.trim().length > 0 ? scoreIdeaTopic(ideaText) : null;

  return (
    <div className="min-w-0 flex-1 space-y-5">
      <div className="rounded-2xl border bg-white shadow-sm p-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">CAMPAIGNS · IDEAS</p>
        <h1 className="text-2xl font-bold text-slate-900">Idea Backlog</h1>
        <p className="mt-1 text-sm text-slate-500">
          Drop a one-sentence topic. We&apos;ll score relevance against today&apos;s trend signals and surface the strongest angles.
        </p>
        <p className="mt-3 text-sm text-slate-500">
          Backlog:{' '}
          <span className="font-semibold text-slate-700">{ideas.length} ideas</span>
          {' · '}Strong-rated:{' '}
          <span className="font-semibold text-slate-700">{strongCount}</span>
          {' · '}Last scored:{' '}
          <span className="font-semibold text-slate-700">{lastScoredLabel}</span>
        </p>
      </div>
      <WorkflowStepper />

      <div className="rounded-2xl border bg-white shadow-sm p-6">
        {submitSuccess ? (
          <p className="mb-3 text-sm font-medium text-emerald-700">{submitSuccess}</p>
        ) : null}
        {submitError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="One-sentence topic — e.g. 'Why GEO beats SEO for B2B in 2026'"
            value={ideaText}
            onChange={(event) => {
              setIdeaText(event.target.value);
              if (submitError) setSubmitError(null);
              if (submitSuccess) setSubmitSuccess(null);
            }}
            disabled={isSubmitting}
          />
          {draftRating ? (
            <p className="text-xs text-slate-600">
              Relevance preview:{' '}
              <span className="font-semibold text-slate-800">{draftRating.score}/100</span>
              {' '}({draftRating.label})
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400"
              value={tone}
              onChange={(event) => setTone(event.target.value)}
              disabled={isSubmitting}
            >
              {TONE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <select
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              disabled={isSubmitting}
            >
              {AUDIENCE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <select
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              disabled={isSubmitting}
            >
              {FORMAT_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                onClick={() => { void submitIdea(true); }}
              >
                Score only
              </button>
              <button
                type="submit"
                className="rounded-xl px-5 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: '#1a7a5e' }}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Spinner size="sm" label="Saving..." /> : 'Add & score'}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: 'All' as const, label: 'All', count: ideas.length },
              { key: 'Strong' as const, label: 'Strong', count: strongCount },
              { key: 'Moderate' as const, label: 'Moderate', count: moderateCount },
              { key: 'Weak' as const, label: 'Weak', count: weakCount },
              { key: 'NoAngles' as const, label: 'No angles yet', count: noAnglesCount },
            ]
          ).map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                ratingFilter === key
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => setRatingFilter(key)}
            >
              {label} {count}
            </button>
          ))}
        </div>
        <select
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400"
          value={sortBy}
          onChange={(event) => updateSortPreference(event.target.value as IdeaSort)}
        >
          <option value="rating">Score high → low</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="topic">Topic A-Z</option>
        </select>
      </div>

      {titleEditError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {titleEditError}
        </div>
      ) : null}

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
        <div className="space-y-3">
          {visibleIdeas.map((idea) => {
            const rating = idea.relevance;
            const isEditingTitle = editingTitleIdeaId === idea.id;
            const isSavingTitle = isSavingTitleIdeaId === idea.id;
            const isMenuOpen = openMenuIdeaId === idea.id;
            const hasDraft = draftMap.has(idea.id);
            const hasAdapt = adaptMap.has(idea.id);
            const scoreCircleColor = !rating
              ? 'bg-slate-100 text-slate-500'
              : rating.label === 'Strong'
                ? 'bg-emerald-100 text-emerald-700'
                : rating.label === 'Moderate'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-rose-100 text-rose-700';

            return (
              <div key={idea.id} className="rounded-2xl border bg-white shadow-sm p-5">
                <div className="flex items-start gap-4">
                  <div className="flex shrink-0 flex-col items-center gap-0.5">
                    <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-full ${scoreCircleColor}`}>
                      <span className="text-lg font-bold leading-none">{rating ? rating.score : '—'}</span>
                      <span className="mt-0.5 text-[9px] font-semibold uppercase leading-none">
                        {rating ? rating.label : 'Unscored'}
                      </span>
                    </div>
                    <span className="mt-0.5 text-[9px] text-slate-400">AI score</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">{idea.tone}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">{idea.audience}</span>
                      <span>·</span>
                      <span>{idea.createdAtLabel}</span>
                      <span>·</span>
                      <span>{trends?.topics?.length ?? 0} live signals</span>
                    </div>
                    <p className="mt-1 font-bold text-slate-900">{idea.title || idea.topic}</p>
                    {idea.title !== idea.topic && idea.topic ? (
                      <p className="text-sm text-slate-500">{idea.topic}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {isEditingTitle ? (
                      <div className="flex w-56 flex-col gap-1.5">
                        <input
                          type="text"
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                          value={editingTitleValue}
                          onChange={(event) => setEditingTitleValue(event.target.value)}
                          maxLength={180}
                          disabled={isSavingTitle}
                          aria-label="Idea title"
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className="rounded-lg border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                            onClick={() => { void saveTitleEdit(idea); }}
                            disabled={isSavingTitle}
                          >
                            {isSavingTitle ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={cancelTitleEdit}
                            disabled={isSavingTitle}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {hasAdapt ? (
                          <button
                            type="button"
                            className="rounded-xl px-4 py-1.5 text-xs font-bold text-white hover:opacity-90"
                            style={{ background: '#1a7a5e' }}
                            onClick={() => {
                              setWorkflowContext({ ideaId: idea.id, ideaTopic: idea.topic });
                              router.push(`/adapt/${encodeURIComponent(idea.id)}?angleId=${encodeURIComponent(adaptMap.get(idea.id)!)}`);
                            }}
                          >
                            Go to Adapt →
                          </button>
                        ) : null}
                        {hasDraft && !hasAdapt ? (
                          <button
                            type="button"
                            className="rounded-xl px-4 py-1.5 text-xs font-bold text-white hover:opacity-90"
                            style={{ background: '#1a7a5e' }}
                            onClick={() => {
                              setWorkflowContext({ ideaId: idea.id, ideaTopic: idea.topic });
                              router.push(`/storyboard/${encodeURIComponent(idea.id)}?angleId=${encodeURIComponent(draftMap.get(idea.id)!)}`);
                            }}
                          >
                            Open Storyboard →
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`rounded-xl px-4 py-1.5 text-xs font-bold hover:opacity-90 ${hasAdapt || hasDraft ? 'border border-emerald-700 text-emerald-700' : 'text-white'}`}
                          style={hasAdapt || hasDraft ? {} : { background: '#1a7a5e' }}
                          onClick={() => { void openAnglesForIdea(idea); }}
                        >
                          Open angles →
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50"
                            onClick={() => setOpenMenuIdeaId(isMenuOpen ? null : idea.id)}
                          >
                            ...
                          </button>
                          {isMenuOpen ? (
                            <div className="absolute right-0 top-8 z-10 w-36 rounded-xl border border-slate-200 bg-white shadow-lg">
                              <button
                                type="button"
                                className="block w-full px-4 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                                onClick={() => {
                                  setOpenMenuIdeaId(null);
                                  beginTitleEdit(idea);
                                }}
                              >
                                Edit title
                              </button>
                              <button
                                type="button"
                                className="block w-full px-4 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                                onClick={() => {
                                  setOpenMenuIdeaId(null);
                                  void deleteIdea(idea);
                                }}
                                disabled={deletingIdeaId === idea.id}
                              >
                                {deletingIdeaId === idea.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {rating ? (
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                      AI RATIONALE
                    </span>
                    <p className="text-sm text-slate-600">{rating.reason}</p>
                  </div>
                ) : null}
                {rating && rating.improvements.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      HOW TO MAKE IT STRONGER
                    </p>
                    <ul className="list-inside list-disc space-y-0.5">
                      {rating.improvements.map((item) => (
                        <li key={item} className="text-xs text-slate-600">{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
