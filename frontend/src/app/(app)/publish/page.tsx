'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { Spinner } from '@/components/Spinner';
import DocumentContextHeader from '@/components/DocumentContextHeader';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { getActiveAIKey } from '@/lib/aiConfig';
import { findOrphanAdaptations } from '@/lib/orphans';
import { getWorkflowContext, type WorkflowContext } from '@/lib/workflowContext';

type PlatformKey = 'linkedin' | 'twitter' | 'medium' | 'newsletter' | 'blog';

const PLATFORM_KEYS: readonly PlatformKey[] = ['linkedin', 'twitter', 'medium', 'newsletter', 'blog'] as const;

function isPlatformKey(value: unknown): value is PlatformKey {
  return typeof value === 'string' && (PLATFORM_KEYS as readonly string[]).includes(value);
}

type PlatformContent = Partial<Record<PlatformKey, string>>;

type AdaptationRecord = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  platforms: PlatformContent;
};

type PublishNoticeTone = 'success' | 'error' | 'info';
type PublishNotice = {
  tone: PublishNoticeTone;
  message: string;
};

type ScheduledPostRecord = {
  id: string;
  articleTitle: string;
  scheduledForMs: number;
  platforms: PlatformKey[];
};

type StringMap = Record<string, string>;
type BooleanMap = Record<string, boolean>;

type PlagiarismVerdict = 'clean' | 'review-needed' | 'high-risk';

type PlagiarismFlag = {
  passage: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
  suggestedRewrite?: string;
  likelySource?: string;
};

type PlagiarismResult = {
  flags: PlagiarismFlag[];
  riskScore: number;
  verdict: PlagiarismVerdict;
  webMatches: Array<{ passage: string; matchUrl: string; matchTitle: string; snippet: string }>;
  checkedAt: number;
};

type PlagiarismApiResponse = PlagiarismResult & { provider?: string; error?: string };

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAdaptationRecord(id: string, payload: Record<string, unknown>): AdaptationRecord {
  const rawPlatforms = payload.platforms;
  const platformsObject = rawPlatforms && typeof rawPlatforms === 'object' ? (rawPlatforms as Record<string, unknown>) : {};

  const platforms: PlatformContent = {};
  for (const key of PLATFORM_KEYS) {
    const value = asTrimmedString(platformsObject[key]);
    if (value) {
      platforms[key] = value;
    }
  }

  return {
    id,
    ideaId: asTrimmedString(payload.ideaId),
    angleId: asTrimmedString(payload.angleId),
    ideaTopic: asTrimmedString(payload.ideaTopic),
    angleTitle: asTrimmedString(payload.angleTitle),
    platforms,
  };
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
  if (!value.trim()) {
    return 0;
  }

  const asDate = new Date(value);
  const ms = asDate.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  medium: 'Medium',
  newsletter: 'Newsletter',
  blog: 'Blog',
};

function formatPlatformLabel(platform: PlatformKey): string {
  return PLATFORM_LABELS[platform];
}

// Per-platform UI metadata used to render publish cards. Compose-URL handoff
// only exists for LinkedIn / X — Medium / Newsletter / Blog cards offer
// "Copy text" + "Schedule" because those platforms have no one-click intent URL.
type PlatformCardMeta = {
  badgeClassName: string;
  description: string;
  emptyPlaceholder: string;
  copyButtonLabel: string;
};

const PLATFORM_CARD_META: Record<PlatformKey, PlatformCardMeta> = {
  linkedin: {
    badgeClassName: 'bg-blue-100 text-blue-800',
    description: 'LinkedIn one-click handoff: we copy your content first, then open LinkedIn compose.',
    emptyPlaceholder: 'No LinkedIn-ready content found yet. Generate platform copy in Adapt first.',
    copyButtonLabel: 'Copy LinkedIn Text',
  },
  twitter: {
    badgeClassName: 'bg-slate-900 text-white',
    description: 'Opens X compose intent with your post text prefilled.',
    emptyPlaceholder: 'No X/Twitter-ready content found yet. Generate platform copy in Adapt first.',
    copyButtonLabel: 'Copy X Text',
  },
  medium: {
    badgeClassName: 'bg-emerald-100 text-emerald-800',
    description: 'Copy your Medium draft, then paste it into your Medium editor and schedule a reminder here.',
    emptyPlaceholder: 'No Medium-ready content found yet. Generate platform copy in Adapt first.',
    copyButtonLabel: 'Copy Medium Text',
  },
  newsletter: {
    badgeClassName: 'bg-amber-100 text-amber-900',
    description: 'Copy your newsletter copy, then paste it into your email tool. Schedule a reminder here.',
    emptyPlaceholder: 'No Newsletter-ready content found yet. Generate platform copy in Adapt first.',
    copyButtonLabel: 'Copy Newsletter Text',
  },
  blog: {
    badgeClassName: 'bg-purple-100 text-purple-800',
    description: 'Copy your blog draft, then paste it into your CMS. Schedule a reminder here.',
    emptyPlaceholder: 'No Blog-ready content found yet. Generate platform copy in Adapt first.',
    copyButtonLabel: 'Copy Blog Text',
  },
};

export default function PublishPage() {
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAdaptationsLoading, setIsAdaptationsLoading] = useState(true);

  const [adaptations, setAdaptations] = useState<AdaptationRecord[]>([]);
  const [orphanAdaptationIds, setOrphanAdaptationIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<PublishNotice | null>(null);

  const initialScheduleInput = useMemo(() => {
    const base = new Date();
    base.setHours(base.getHours() + 1, 0, 0, 0);
    return formatScheduledAtInputValue(base);
  }, []);

  const [scheduleInputByKey, setScheduleInputByKey] = useState<StringMap>({});
  const [draftByKey, setDraftByKey] = useState<StringMap>({});
  const [editingByKey, setEditingByKey] = useState<BooleanMap>({});
  const [savingEditByKey, setSavingEditByKey] = useState<BooleanMap>({});
  const [deletingByKey, setDeletingByKey] = useState<BooleanMap>({});
  const [schedulingByKey, setSchedulingByKey] = useState<BooleanMap>({});
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostRecord[]>([]);
  const [plagiarismByKey, setPlagiarismByKey] = useState<Record<string, PlagiarismResult>>({});
  const [plagiarismRunningByKey, setPlagiarismRunningByKey] = useState<BooleanMap>({});
  const [workflowContext, setWorkflowContextState] = useState<WorkflowContext | null>(null);

  useEffect(() => {
    setWorkflowContextState(getWorkflowContext());
  }, []);

  const keyFor = useCallback((adaptationId: string, platform: PlatformKey): string => {
    return `${adaptationId}:${platform}`;
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoadError('Publish handoff is unavailable until Firebase is configured.');
      setIsAuthLoading(false);
      setIsAdaptationsLoading(false);
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
      setAdaptations([]);
      setLoadError('Sign in to access publishing and scheduling.');
      setIsAdaptationsLoading(false);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setLoadError('Publish handoff is unavailable until Firebase is configured.');
      setIsAdaptationsLoading(false);
      return;
    }

    setIsAdaptationsLoading(true);
    setLoadError(null);

    const adaptationsQuery = query(collection(db, 'users', currentUid, 'adaptations'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      adaptationsQuery,
      (snapshot) => {
        setAdaptations(
          snapshot.docs.map((documentSnapshot) => parseAdaptationRecord(documentSnapshot.id, documentSnapshot.data() as Record<string, unknown>)),
        );
        setIsAdaptationsLoading(false);
      },
      () => {
        setAdaptations([]);
        setIsAdaptationsLoading(false);
        setLoadError('Unable to load adaptations for publishing right now.');
      },
    );

    return unsubscribe;
  }, [currentUid, isAuthLoading]);

  // Debounced orphan-adaptation detection runs off the snapshot data so the
  // existence checks never block the initial render of the adaptations list.
  useEffect(() => {
    if (!currentUid || adaptations.length === 0) {
      setOrphanAdaptationIds(new Set());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const orphans = await findOrphanAdaptations(currentUid);
        if (cancelled) return;
        setOrphanAdaptationIds(new Set(orphans.map((entry) => entry.id)));
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentUid, adaptations]);

  const visibleAdaptations = useMemo(
    () => adaptations.filter((entry) => !orphanAdaptationIds.has(entry.id)),
    [adaptations, orphanAdaptationIds],
  );

  useEffect(() => {
    if (!currentUid) {
      setScheduledPosts([]);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setScheduledPosts([]);
      return;
    }

    const scheduledQuery = query(collection(db, 'users', currentUid, 'scheduledPosts'), orderBy('scheduledForMs', 'asc'));
    const unsubscribe = onSnapshot(scheduledQuery, (snapshot) => {
      setScheduledPosts(
        snapshot.docs
          .map((documentSnapshot) => {
            const data = documentSnapshot.data() as Record<string, unknown>;
            const rawPlatforms = Array.isArray(data.platforms)
              ? data.platforms
              : [];
            const platforms = rawPlatforms.filter(isPlatformKey);

            return {
              id: documentSnapshot.id,
              articleTitle: asTrimmedString(data.articleTitle) || asTrimmedString(data.ideaTopic) || 'Untitled article',
              scheduledForMs: typeof data.scheduledForMs === 'number' ? data.scheduledForMs : 0,
              platforms,
            } satisfies ScheduledPostRecord;
          })
          .filter((item) => item.scheduledForMs > 0),
      );
    });

    return unsubscribe;
  }, [currentUid]);

  const noticeColorClass = useMemo(() => {
    if (!notice) {
      return '';
    }

    if (notice.tone === 'success') {
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    }

    if (notice.tone === 'error') {
      return 'border-red-200 bg-red-50 text-red-700';
    }

    return 'border-sky-200 bg-sky-50 text-sky-800';
  }, [notice]);

  const copyText = useCallback(async (text: string, platformLabel: string): Promise<boolean> => {
    if (!text.trim()) {
      setNotice({ tone: 'error', message: `No ${platformLabel} content is available to copy.` });
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      setNotice({ tone: 'success', message: `${platformLabel} copy was copied to your clipboard.` });
      return true;
    } catch {
      setNotice({
        tone: 'error',
        message: `Clipboard permission was blocked. Copy the ${platformLabel} text manually from the preview box.`,
      });
      return false;
    }
  }, []);

  const runPlagiarismCheck = useCallback(async (key: string, text: string) => {
    if (!text.trim()) {
      setNotice({ tone: 'error', message: 'No content to check on this card. Generate or edit content in Adapt first.' });
      return;
    }
    const config = getActiveAIKey();
    if (config.provider !== 'ollama' && !config.apiKey) {
      setNotice({ tone: 'error', message: 'No AI API key set. Add a key in Settings before running the plagiarism check.' });
      return;
    }
    setPlagiarismRunningByKey((previous) => ({ ...previous, [key]: true }));
    try {
      const response = await fetch('/api/drafts/plagiarism', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: config.provider,
          apiKey: config.apiKey,
          ollamaBaseUrl: config.ollamaBaseUrl,
          ollamaModel: config.ollamaModel,
          draft: text,
        }),
      });
      const payload = (await response.json()) as PlagiarismApiResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? 'Plagiarism check failed.');
      }
      const result: PlagiarismResult = {
        flags: payload.flags ?? [],
        riskScore: payload.riskScore ?? 0,
        verdict: payload.verdict ?? 'review-needed',
        webMatches: payload.webMatches ?? [],
        checkedAt: Date.now(),
      };
      setPlagiarismByKey((previous) => ({ ...previous, [key]: result }));
      setNotice({
        tone: result.verdict === 'clean' ? 'success' : result.verdict === 'high-risk' ? 'error' : 'info',
        message: `Plagiarism check ${result.verdict.replace('-', ' ')} (risk ${result.riskScore}/100).`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Plagiarism check failed.' });
    } finally {
      setPlagiarismRunningByKey((previous) => ({ ...previous, [key]: false }));
    }
  }, []);

  const isPlagiarismCleared = useCallback(
    (key: string, text: string): boolean => {
      const result = plagiarismByKey[key];
      if (!result) return false;
      if (result.verdict === 'high-risk') return false;
      // Stale results (older than 30 minutes) require a re-check.
      if (Date.now() - result.checkedAt > 30 * 60 * 1000) return false;
      // Length changes invalidate the prior check.
      if (Math.abs(result.flags.reduce((acc, flag) => acc + flag.passage.length, 0)) === 0 && text.length === 0) return false;
      return true;
    },
    [plagiarismByKey],
  );

  const openTwitterIntent = useCallback((text: string) => {
    if (!asTrimmedString(text)) {
      setNotice({ tone: 'error', message: 'No X/Twitter content is ready. Generate or edit content in Adapt first.' });
      return;
    }

    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(intentUrl, '_blank', 'noopener,noreferrer');
    setNotice({ tone: 'success', message: 'Opened X/Twitter compose with your text prefilled.' });
  }, []);

  const openLinkedInCompose = useCallback(async (text: string) => {
    if (!asTrimmedString(text)) {
      setNotice({ tone: 'error', message: 'No LinkedIn content is ready. Generate or edit content in Adapt first.' });
      return;
    }

    const copied = await copyText(text, 'LinkedIn');
    window.open('https://www.linkedin.com/feed/?shareActive=true', '_blank', 'noopener,noreferrer');

    if (copied) {
      setNotice({
        tone: 'success',
        message: 'Opened LinkedIn compose. Your post text is already copied, so you can paste and publish immediately.',
      });
      return;
    }

    setNotice({
      tone: 'info',
      message: 'Opened LinkedIn compose. If clipboard access was blocked, copy from the preview box and paste into LinkedIn.',
    });
  }, [copyText]);

  const schedulePost = useCallback(async (adaptation: AdaptationRecord, platform: PlatformKey, articleTitle: string, angleLabel: string) => {
    if (!currentUid) {
      setNotice({ tone: 'error', message: 'Sign in to schedule publishing reminders.' });
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setNotice({ tone: 'error', message: 'Scheduling is unavailable until Firebase is configured.' });
      return;
    }

    const scheduleKey = keyFor(adaptation.id, platform);
    const inputValue = scheduleInputByKey[scheduleKey] ?? initialScheduleInput;
    const scheduledForMs = parseScheduledAtInputValue(inputValue);
    if (!scheduledForMs) {
      setNotice({ tone: 'error', message: 'Choose a valid date and time for the publish reminder.' });
      return;
    }

    if (scheduledForMs <= Date.now()) {
      setNotice({ tone: 'error', message: 'Schedule must be in the future so the reminder can trigger on time.' });
      return;
    }

    const platformLabel = formatPlatformLabel(platform);
    setSchedulingByKey((previous) => ({ ...previous, [scheduleKey]: true }));
    try {
      const scheduledDocRef = doc(collection(db, 'users', currentUid, 'scheduledPosts'));
      const payload: Record<string, unknown> = {
        ideaId: adaptation.ideaId,
        angleId: adaptation.angleId,
        ideaTopic: articleTitle,
        angleTitle: angleLabel,
        articleTitle,
        platforms: [platform],
        scheduledForMs,
        scheduledForIso: new Date(scheduledForMs).toISOString(),
        status: 'scheduled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(scheduledDocRef, payload, { merge: false });
      setNotice({
        tone: 'success',
        message: `Scheduled ${platformLabel} post "${articleTitle}" for ${new Date(scheduledForMs).toLocaleString()}. It will appear on your dashboard calendar and notifications list.`,
      });
    } catch {
      setNotice({ tone: 'error', message: 'Unable to save the schedule right now. Please try again.' });
    } finally {
      setSchedulingByKey((previous) => ({ ...previous, [scheduleKey]: false }));
    }
  }, [currentUid, initialScheduleInput, keyFor, scheduleInputByKey]);

  const savePlatformEdit = useCallback(async (adaptation: AdaptationRecord, platform: PlatformKey) => {
    if (!currentUid) {
      setNotice({ tone: 'error', message: 'Open an adaptation first before editing publish card content.' });
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setNotice({ tone: 'error', message: 'Editing is unavailable until Firebase is configured.' });
      return;
    }

    const editKey = keyFor(adaptation.id, platform);
    const nextValue = asTrimmedString(draftByKey[editKey]);
    const platformLabel = formatPlatformLabel(platform);

    setSavingEditByKey((previous) => ({ ...previous, [editKey]: true }));
    try {
      await setDoc(
        doc(db, 'users', currentUid, 'adaptations', adaptation.id),
        {
          platforms: {
            [platform]: nextValue,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setAdaptations((previous) =>
        previous.map((entry) =>
          entry.id !== adaptation.id
            ? entry
            : {
                ...entry,
                platforms: {
                  ...entry.platforms,
                  [platform]: nextValue,
                },
              },
        ),
      );
      setEditingByKey((previous) => ({ ...previous, [editKey]: false }));
      setNotice({ tone: 'success', message: `${platformLabel} content updated.` });
    } catch {
      setNotice({ tone: 'error', message: `Unable to save ${platformLabel} edits right now. Please try again.` });
    } finally {
      setSavingEditByKey((previous) => ({ ...previous, [editKey]: false }));
    }
  }, [currentUid, draftByKey, keyFor]);

  const deletePlatformContent = useCallback(async (adaptation: AdaptationRecord, platform: PlatformKey) => {
    if (!currentUid) {
      setNotice({ tone: 'error', message: 'Open an adaptation first before deleting publish card content.' });
      return;
    }

    const platformLabel = formatPlatformLabel(platform);
    if (!window.confirm(`Delete ${platformLabel} content from this adaptation? This cannot be undone.`)) {
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setNotice({ tone: 'error', message: 'Delete is unavailable until Firebase is configured.' });
      return;
    }

    const editKey = keyFor(adaptation.id, platform);

    setDeletingByKey((previous) => ({ ...previous, [editKey]: true }));
    try {
      await updateDoc(doc(db, 'users', currentUid, 'adaptations', adaptation.id), {
        [`platforms.${platform}`]: deleteField(),
        updatedAt: serverTimestamp(),
      });

      setAdaptations((previous) =>
        previous.map((entry) =>
          entry.id !== adaptation.id
            ? entry
            : {
                ...entry,
                platforms: {
                  ...entry.platforms,
                  [platform]: '',
                },
              },
        ),
      );
      setDraftByKey((previous) => ({ ...previous, [editKey]: '' }));
      setEditingByKey((previous) => ({ ...previous, [editKey]: false }));
      setNotice({ tone: 'success', message: `${platformLabel} content deleted.` });
    } catch {
      setNotice({ tone: 'error', message: `Unable to delete ${platformLabel} content right now. Please try again.` });
    } finally {
      setDeletingByKey((previous) => ({ ...previous, [editKey]: false }));
    }
  }, [currentUid, keyFor]);

  const upcomingScheduledPosts = useMemo(() => {
    const nowMs = Date.now();
    return scheduledPosts.filter((item) => item.scheduledForMs >= nowMs).slice(0, 6);
  }, [scheduledPosts]);

  // Show the persistent context header only when the user arrived from a single
  // adaptation jump (Adapt's "Save and continue" CTA seeds workflow_context with
  // an ideaId). Otherwise this page is a multi-adaptation library view.
  const showContextHeader = Boolean(workflowContext?.ideaId);
  const contextHeaderTopic = (() => {
    if (!workflowContext) return '';
    const fromContext = workflowContext.ideaTopic?.trim();
    if (fromContext) return fromContext;
    const match = adaptations.find((a) => a.ideaId === workflowContext.ideaId);
    return match?.ideaTopic ?? '';
  })();
  const contextHeaderAngle = (() => {
    if (!workflowContext) return '';
    const match = adaptations.find(
      (a) => a.ideaId === workflowContext.ideaId && (!workflowContext.angleId || a.angleId === workflowContext.angleId),
    );
    return match?.angleTitle ?? '';
  })();

  return (
    <div className="space-y-6">
      {showContextHeader ? (
        <DocumentContextHeader
          ideaTopic={contextHeaderTopic}
          angleTitle={contextHeaderAngle}
          activeStep="publish"
        />
      ) : null}
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 7</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Publishing and Scheduling</h1>
        <p className="mt-1 muted-copy">
          Schedule and publish any adaptation from your full library.
        </p>

        <p className="mt-2 text-sm text-slate-600">Loaded adaptations: <span className="font-semibold text-slate-900">{visibleAdaptations.length}</span></p>

        {notice ? <p className={`mt-4 rounded-xl border px-4 py-3 text-sm ${noticeColorClass}`}>{notice.message}</p> : null}
      </section>

      {isAuthLoading || isAdaptationsLoading ? (
        <section className="surface-card p-6 text-sm text-slate-600">
          <Spinner size="sm" label="Loading adaptations..." />
        </section>
      ) : null}

      {loadError ? (
        <section className="surface-card p-6">
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>
        </section>
      ) : null}

      {!isAuthLoading && !isAdaptationsLoading && !loadError ? (
        <>
          {visibleAdaptations.length === 0 ? (
            <section className="surface-card p-6">
              <p className="text-sm text-slate-600">No adaptations are available yet. Generate adaptations first, then schedule them here.</p>
            </section>
          ) : (
            <div className="space-y-6">
              {visibleAdaptations.map((adaptation) => {
                const articleTitle = adaptation.ideaTopic || adaptation.angleTitle || 'Untitled article';
                const angleLabel = adaptation.angleTitle || 'Untitled angle';
                const editAdaptationHref = adaptation.ideaId && adaptation.angleId
                  ? `/adapt/${encodeURIComponent(adaptation.ideaId)}?angleId=${encodeURIComponent(adaptation.angleId)}`
                  : null;

                // Build the list of platform cards to render. A card is shown
                // either when there is saved content for that platform OR when
                // the user has clicked Edit (so they can paste fresh content
                // into a previously-empty platform). Iterating the canonical
                // PLATFORM_KEYS list ensures every platform supported by Adapt
                // (linkedin, twitter, medium, newsletter, blog) gets a card.
                const cardEntries = PLATFORM_KEYS.flatMap((platform) => {
                  const text = asTrimmedString(adaptation.platforms[platform]);
                  const cardKey = keyFor(adaptation.id, platform);
                  const isEditingCard = Boolean(editingByKey[cardKey]);
                  if (text.length === 0 && !isEditingCard) {
                    return [];
                  }
                  return [{ platform, text, cardKey, isEditingCard }];
                });

                const visibleCardCount = cardEntries.length;

                return (
                  <section key={adaptation.id} className="surface-card p-6" data-testid={`publish-adaptation-${adaptation.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="section-title">{articleTitle}</h2>
                        <p className="mt-1 text-xs text-slate-600">Angle: {angleLabel}</p>
                      </div>
                      {editAdaptationHref ? (
                        <Link
                          href={editAdaptationHref}
                          className="inline-flex rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Edit Adaptation
                        </Link>
                      ) : null}
                    </div>

                    <div className={`mt-4 grid gap-6 ${visibleCardCount > 1 ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
                      {cardEntries.map(({ platform, text, cardKey, isEditingCard }) => {
                        const meta = PLATFORM_CARD_META[platform];
                        const platformLabel = formatPlatformLabel(platform);
                        const isSaving = Boolean(savingEditByKey[cardKey]);
                        const isDeleting = Boolean(deletingByKey[cardKey]);
                        const isScheduling = Boolean(schedulingByKey[cardKey]);
                        const plagiarism = plagiarismByKey[cardKey];
                        const cleared = isPlagiarismCleared(cardKey, text);
                        const hasPublishHandoff = platform === 'linkedin' || platform === 'twitter';

                        return (
                          <section
                            key={cardKey}
                            className="rounded-xl border border-slate-200 p-4"
                            data-testid={`publish-card-${platform}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="font-semibold text-slate-900">{articleTitle}</h3>
                                <p className="mt-1 text-xs text-slate-600">{meta.description}</p>
                              </div>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badgeClassName}`}>
                                {platformLabel}
                              </span>
                            </div>

                            <textarea
                              readOnly={!isEditingCard}
                              value={isEditingCard ? (draftByKey[cardKey] ?? text) : text}
                              className="mt-4 min-h-[200px] w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800"
                              placeholder={meta.emptyPlaceholder}
                              onChange={(event) => {
                                setDraftByKey((previous) => ({ ...previous, [cardKey]: event.target.value }));
                              }}
                            />

                            {plagiarism ? (
                              <p
                                className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                                  plagiarism.verdict === 'clean'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                    : plagiarism.verdict === 'high-risk'
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-900'
                                }`}
                              >
                                Plagiarism: {plagiarism.verdict.replace('-', ' ')} (risk {plagiarism.riskScore}/100,{' '}
                                {plagiarism.flags.length} flag{plagiarism.flags.length === 1 ? '' : 's'},{' '}
                                {plagiarism.webMatches.length} web match{plagiarism.webMatches.length === 1 ? '' : 'es'}).
                                {plagiarism.verdict === 'high-risk'
                                  ? ' Resolve flagged passages before publishing.'
                                  : ''}
                              </p>
                            ) : (
                              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                Plagiarism check has not been run on this {platformLabel} copy. Click &ldquo;Run plagiarism check&rdquo; before publishing or scheduling.
                              </p>
                            )}

                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                onClick={() => {
                                  void runPlagiarismCheck(cardKey, text);
                                }}
                                disabled={text.length === 0 || Boolean(plagiarismRunningByKey[cardKey])}
                              >
                                {plagiarismRunningByKey[cardKey] ? 'Checking…' : 'Run plagiarism check'}
                              </button>

                              {platform === 'linkedin' ? (
                                <button
                                  type="button"
                                  className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                                  onClick={() => {
                                    void openLinkedInCompose(text);
                                  }}
                                  disabled={text.length === 0 || !cleared}
                                  title={!cleared ? 'Run a passing plagiarism check before publishing.' : undefined}
                                >
                                  Publish to LinkedIn
                                </button>
                              ) : null}

                              {platform === 'twitter' ? (
                                <button
                                  type="button"
                                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                                  onClick={() => {
                                    openTwitterIntent(text);
                                  }}
                                  disabled={text.length === 0 || !cleared}
                                  title={!cleared ? 'Run a passing plagiarism check before publishing.' : undefined}
                                >
                                  Publish to X / Twitter
                                </button>
                              ) : null}

                              <button
                                type="button"
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                onClick={() => {
                                  void copyText(text, platformLabel);
                                }}
                                disabled={text.length === 0}
                              >
                                {meta.copyButtonLabel}
                              </button>

                              {!isEditingCard ? (
                                <button
                                  type="button"
                                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                  onClick={() => {
                                    setEditingByKey((previous) => ({ ...previous, [cardKey]: true }));
                                    setDraftByKey((previous) => ({ ...previous, [cardKey]: text }));
                                  }}
                                  disabled={isDeleting}
                                >
                                  Edit
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                                    onClick={() => {
                                      void savePlatformEdit(adaptation, platform);
                                    }}
                                    disabled={isSaving}
                                  >
                                    {isSaving ? 'Saving...' : 'Save Edit'}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      setEditingByKey((previous) => ({ ...previous, [cardKey]: false }));
                                      setDraftByKey((previous) => ({ ...previous, [cardKey]: text }));
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </>
                              )}

                              <button
                                type="button"
                                className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                                onClick={() => {
                                  void deletePlatformContent(adaptation, platform);
                                }}
                                disabled={text.length === 0 || isDeleting}
                              >
                                {isDeleting ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>

                            <div className="mt-5 border-t border-slate-200 pt-4">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Schedule {platformLabel}{hasPublishHandoff ? ' post' : ' reminder'}
                              </p>
                              <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
                                <label className="text-sm text-slate-700">
                                  <span className="mb-1 block font-medium">Publish date &amp; time</span>
                                  <input
                                    type="datetime-local"
                                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                                    value={scheduleInputByKey[cardKey] ?? initialScheduleInput}
                                    onChange={(event) => {
                                      setScheduleInputByKey((previous) => ({ ...previous, [cardKey]: event.target.value }));
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                                  onClick={() => {
                                    void schedulePost(adaptation, platform, articleTitle, angleLabel);
                                  }}
                                  disabled={isScheduling || text.length === 0 || !cleared}
                                  title={!cleared ? 'Run a passing plagiarism check before scheduling.' : undefined}
                                >
                                  {isScheduling ? 'Scheduling...' : 'Schedule'}
                                </button>
                              </div>
                            </div>
                          </section>
                        );
                      })}

                      {visibleCardCount === 0 ? (
                        <section className="rounded-xl border border-slate-200 p-4 lg:col-span-full">
                          <p className="text-sm text-slate-600">
                            No publish cards are currently available for this adaptation. Return to Adapt to regenerate platform copy.
                          </p>
                        </section>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {!isAuthLoading && !isAdaptationsLoading && !loadError && upcomingScheduledPosts.length > 0 ? (
        <section className="surface-card p-6">
          <h2 className="section-title">Upcoming Scheduled Posts</h2>
          <p className="mt-1 text-xs text-slate-600">These will appear on your dashboard calendar and surface as reminders in notifications when due.</p>
          <ul className="mt-4 space-y-2 text-sm">
            {upcomingScheduledPosts.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-medium text-slate-800">{item.articleTitle}</p>
                <p className="text-xs text-slate-600">
                  {new Date(item.scheduledForMs).toLocaleString()} · {item.platforms.map((platform) => formatPlatformLabel(platform)).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
