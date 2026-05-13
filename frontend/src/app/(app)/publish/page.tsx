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
import { listIntegrationConnections, type IntegrationConnection } from '@/lib/integrations';
import { cancelScheduledPost as cancelScheduledPostApi, publishLinkedInNow, scheduleLinkedInPost } from '@/lib/publish';
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
  linkHref?: string;
  linkText?: string;
};

type ScheduledPostStatus = 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

type ScheduledFailureReason =
  | 'token_expired'
  | 'rate_limited'
  | 'invalid_payload'
  | 'provider_unavailable'
  | 'missing_author_urn'
  | 'unknown';

type ScheduledPostRecord = {
  id: string;
  articleTitle: string;
  scheduledForMs: number;
  platforms: PlatformKey[];
  status?: ScheduledPostStatus;
  failureReason?: ScheduledFailureReason;
  postUrl?: string;
  publishedAtMs?: number;
};

function isScheduledStatus(value: unknown): value is ScheduledPostStatus {
  return (
    value === 'scheduled' ||
    value === 'publishing' ||
    value === 'published' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

function isScheduledFailureReason(value: unknown): value is ScheduledFailureReason {
  return (
    value === 'token_expired' ||
    value === 'rate_limited' ||
    value === 'invalid_payload' ||
    value === 'provider_unavailable' ||
    value === 'missing_author_urn' ||
    value === 'unknown'
  );
}

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
    description: 'LinkedIn one-click publish via your connected LinkedIn account.',
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
  const [publishingByKey, setPublishingByKey] = useState<BooleanMap>({});
  const [cancellingScheduledId, setCancellingScheduledId] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostRecord[]>([]);
  const [plagiarismByKey, setPlagiarismByKey] = useState<Record<string, PlagiarismResult>>({});
  const [plagiarismRunningByKey, setPlagiarismRunningByKey] = useState<BooleanMap>({});
  const [workflowContext, setWorkflowContextState] = useState<WorkflowContext | null>(null);
  const [linkedinConnection, setLinkedinConnection] = useState<IntegrationConnection | null>(null);

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

  // Load LinkedIn connection state for the signed-in user. This drives whether
  // the LinkedIn button calls the direct-publish API or falls back to the
  // clipboard-handoff path. Errors are swallowed (the user keeps the existing
  // handoff flow), and the connection is cleared when the user signs out.
  useEffect(() => {
    if (!currentUid) {
      setLinkedinConnection(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const connections = await listIntegrationConnections(currentUid);
        if (cancelled) return;
        const linkedin = connections.find((entry) => entry.provider === 'linkedin') ?? null;
        setLinkedinConnection(linkedin);
      } catch {
        if (cancelled) return;
        setLinkedinConnection(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUid]);

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

            const status = isScheduledStatus(data.status) ? data.status : undefined;
            const failureReason = isScheduledFailureReason(data.failureReason)
              ? data.failureReason
              : undefined;
            const postUrl = asTrimmedString(data.postUrl);
            const publishedAtMs =
              typeof data.publishedAtMs === 'number' && Number.isFinite(data.publishedAtMs)
                ? data.publishedAtMs
                : undefined;

            return {
              id: documentSnapshot.id,
              articleTitle: asTrimmedString(data.articleTitle) || asTrimmedString(data.ideaTopic) || 'Untitled article',
              scheduledForMs: typeof data.scheduledForMs === 'number' ? data.scheduledForMs : 0,
              platforms,
              status,
              failureReason,
              postUrl: postUrl || undefined,
              publishedAtMs,
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

  const cancelScheduledPost = useCallback(async (postId: string) => {
    if (!currentUid) {
      setNotice({ tone: 'error', message: 'Sign in to cancel a scheduled post.' });
      return;
    }
    setCancellingScheduledId(postId);
    try {
      const result = await cancelScheduledPostApi(postId);
      if (result.success) {
        setNotice({ tone: 'success', message: 'Scheduled post cancelled.' });
        // The Firestore listener will remove the row from the list automatically.
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
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to cancel scheduled post.' });
    } finally {
      setCancellingScheduledId(null);
      setConfirmingCancelId(null);
    }
  }, [currentUid]);

  const openTwitterIntent = useCallback((text: string) => {
    if (!asTrimmedString(text)) {
      setNotice({ tone: 'error', message: 'No X/Twitter content is ready. Generate or edit content in Adapt first.' });
      return;
    }

    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(intentUrl, '_blank', 'noopener,noreferrer');
    setNotice({ tone: 'success', message: 'Opened X/Twitter compose with your text prefilled.' });
  }, []);

  // Direct-publish path. Only invoked when the user has connected their
  // LinkedIn account (status === 'connected') — the button is disabled
  // otherwise (see the disabled-state contract in specs/frontend.md), so
  // the not-connected branch in this handler is purely defensive.
  const publishToLinkedIn = useCallback(
    async (adaptation: AdaptationRecord, text: string) => {
      if (!asTrimmedString(text)) {
        setNotice({ tone: 'error', message: 'No LinkedIn content is ready. Generate or edit content in Adapt first.' });
        return;
      }

      if (!currentUid) {
        setNotice({ tone: 'error', message: 'Sign in to publish to LinkedIn.' });
        return;
      }

      if (linkedinConnection?.status !== 'connected') {
        // Defensive guard — the button should already be disabled in this
        // state. We avoid the legacy clipboard handoff entirely so users
        // never silently post via a fallback path; instead we point them at
        // Settings to complete the connection.
        setNotice({
          tone: 'error',
          message: 'Connect LinkedIn in Settings to publish directly.',
          linkHref: '/settings#integrations',
          linkText: 'Open Settings',
        });
        return;
      }

      const cardKey = keyFor(adaptation.id, 'linkedin');
      setPublishingByKey((previous) => ({ ...previous, [cardKey]: true }));
      try {
        const result = await publishLinkedInNow(currentUid, text);
        if (result.success) {
          setNotice({
            tone: 'success',
            message: 'Published to LinkedIn.',
            linkHref: result.postUrl || undefined,
            linkText: result.postUrl ? 'View on LinkedIn' : undefined,
          });
          return;
        }

        if (result.error === 'not_connected' || result.status === 401) {
          setNotice({
            tone: 'error',
            message: 'LinkedIn connection expired. Reconnect in Settings.',
            linkHref: '/settings#integrations',
            linkText: 'Open Settings',
          });
          return;
        }

        if (result.error === 'missing_author_urn') {
          setNotice({
            tone: 'error',
            message: 'LinkedIn account is missing the publish identity. Disconnect and reconnect in Settings.',
            linkHref: '/settings#integrations',
            linkText: 'Open Settings',
          });
          return;
        }

        setNotice({
          tone: 'error',
          message: `LinkedIn rejected the post (${result.status}). Try again or open Settings to reconnect.`,
          linkHref: '/settings#integrations',
          linkText: 'Open Settings',
        });
      } finally {
        setPublishingByKey((previous) => ({ ...previous, [cardKey]: false }));
      }
    },
    [currentUid, keyFor, linkedinConnection],
  );

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
      // Capture the platform copy AT schedule time so a later edit to the
      // adaptation doc cannot change what the scheduler posts.
      const editingTextForCard = asTrimmedString(draftByKey[scheduleKey]);
      const persistedText = asTrimmedString(adaptation.platforms[platform]);
      const snapshotText = editingByKey[scheduleKey] && editingTextForCard
        ? editingTextForCard
        : persistedText;

      if (!snapshotText) {
        setNotice({ tone: 'error', message: `No ${platformLabel} content captured to schedule.` });
        return;
      }

      // LinkedIn is the only platform currently routed through the server.
      // Non-LinkedIn schedules continue to use the legacy direct-Firestore path
      // until those publishers ship (see specs/automation.md Known Gaps).
      if (platform !== 'linkedin') {
        const scheduledDocRef = doc(collection(db, 'users', currentUid, 'scheduledPosts'));
        await setDoc(scheduledDocRef, {
          ideaId: adaptation.ideaId,
          angleId: adaptation.angleId,
          ideaTopic: articleTitle,
          angleTitle: angleLabel,
          articleTitle,
          platforms: [platform],
          scheduledForMs,
          scheduledForIso: new Date(scheduledForMs).toISOString(),
          status: 'scheduled',
          contentSnapshot: { [platform]: snapshotText },
          visibility: 'PUBLIC',
          attemptCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: false });
        setNotice({
          tone: 'success',
          message: `Scheduled ${platformLabel} reminder "${articleTitle}" for ${new Date(scheduledForMs).toLocaleString()}.`,
        });
        return;
      }

      const result = await scheduleLinkedInPost({
        userId: currentUid,
        scheduledForMs,
        ideaId: adaptation.ideaId,
        angleId: adaptation.angleId,
        ideaTopic: articleTitle,
        angleTitle: angleLabel,
        articleTitle,
        contentSnapshotLinkedIn: snapshotText,
        visibility: 'PUBLIC',
      });

      if (result.success) {
        setNotice({
          tone: 'success',
          message: `Scheduled LinkedIn post "${articleTitle}" for ${new Date(scheduledForMs).toLocaleString()}. It will fire automatically.`,
        });
        return;
      }

      // Error path — map specific backend slugs to actionable copy.
      if (result.error === 'scheduled_too_soon') {
        setNotice({ tone: 'error', message: 'Pick a time at least one minute in the future.' });
      } else if (result.error === 'missing_linkedin_snapshot') {
        setNotice({ tone: 'error', message: 'LinkedIn copy is empty. Add content before scheduling.' });
      } else if (result.error === 'schedule_provisioning_failed') {
        setNotice({ tone: 'error', message: 'Scheduling backend is temporarily unavailable. Please retry.' });
      } else {
        setNotice({ tone: 'error', message: 'Unable to save the schedule right now. Please try again.' });
      }
    } catch {
      setNotice({ tone: 'error', message: 'Unable to save the schedule right now. Please try again.' });
    } finally {
      setSchedulingByKey((previous) => ({ ...previous, [scheduleKey]: false }));
    }
  }, [currentUid, draftByKey, editingByKey, initialScheduleInput, keyFor, scheduleInputByKey]);

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
    return scheduledPosts
      .filter((item) => {
        if (item.status === 'failed' || item.status === 'published' || item.status === 'cancelled') {
          return false;
        }
        return item.scheduledForMs >= nowMs;
      })
      .slice(0, 6);
  }, [scheduledPosts]);

  const failedScheduledPosts = useMemo(() => {
    return scheduledPosts.filter((item) => item.status === 'failed').slice(0, 6);
  }, [scheduledPosts]);

  const recentlyPublishedScheduledPosts = useMemo(() => {
    return scheduledPosts
      .filter((item) => item.status === 'published')
      .sort((a, b) => (b.publishedAtMs ?? 0) - (a.publishedAtMs ?? 0))
      .slice(0, 6);
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
                              <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                Optional: run a plagiarism check on this {platformLabel} copy before publishing.
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

                              {platform === 'linkedin' ? (() => {
                                const liLoading = linkedinConnection === null;
                                const liConnected = linkedinConnection?.status === 'connected';
                                const liDisabled =
                                  text.length === 0 ||
                                  !liConnected ||
                                  Boolean(publishingByKey[cardKey]);
                                const liTitle = liLoading
                                  ? 'Checking LinkedIn connection…'
                                  : !liConnected
                                  ? 'Connect LinkedIn in Settings to post directly.'
                                  : undefined;
                                return (
                                  <>
                                    <button
                                      type="button"
                                      className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                                      onClick={() => {
                                        void publishToLinkedIn(adaptation, text);
                                      }}
                                      disabled={liDisabled}
                                      title={liTitle}
                                      data-testid="publish-linkedin-button"
                                    >
                                      {publishingByKey[cardKey] ? 'Posting…' : 'Publish to LinkedIn'}
                                    </button>
                                    {!liLoading && !liConnected ? (
                                      <Link
                                        href="/settings#integrations"
                                        className="inline-flex items-center self-center text-sm font-semibold text-blue-700 hover:underline"
                                        data-testid="publish-linkedin-connect-cta"
                                      >
                                        Connect LinkedIn →
                                      </Link>
                                    ) : null}
                                  </>
                                );
                              })() : null}

                              {platform === 'twitter' ? (
                                <button
                                  type="button"
                                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                                  onClick={() => {
                                    openTwitterIntent(text);
                                  }}
                                  disabled={text.length === 0}
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
                                  disabled={isScheduling || text.length === 0}
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
            {upcomingScheduledPosts.map((item) => {
              const isCancelling = cancellingScheduledId === item.id;
              const isConfirming = confirmingCancelId === item.id;
              return (
                <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{item.articleTitle}</p>
                    <p className="text-xs text-slate-600">
                      {new Date(item.scheduledForMs).toLocaleString()} · {item.platforms.map((platform) => formatPlatformLabel(platform)).join(', ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                          onClick={() => { void cancelScheduledPost(item.id); }}
                          disabled={isCancelling}
                          data-testid="scheduled-post-confirm-cancel"
                        >
                          {isCancelling ? 'Cancelling…' : 'Confirm cancel'}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          onClick={() => setConfirmingCancelId(null)}
                          disabled={isCancelling}
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                        onClick={() => setConfirmingCancelId(item.id)}
                        data-testid="scheduled-post-cancel"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!isAuthLoading && !isAdaptationsLoading && !loadError && failedScheduledPosts.length > 0 ? (
        <section className="surface-card border-red-200 bg-red-50 p-6" data-testid="failed-scheduled-section">
          <h2 className="section-title text-red-900">Failed Scheduled Posts</h2>
          <p className="mt-1 text-xs text-red-800">These scheduled posts could not be published automatically.</p>
          <ul className="mt-4 space-y-2 text-sm">
            {failedScheduledPosts.map((item) => {
              const isCancelling = cancellingScheduledId === item.id;
              const isConfirming = confirmingCancelId === item.id;
              return (
                <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-red-300 bg-white px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-red-900">{item.articleTitle}</p>
                    <p className="text-xs text-red-800">
                      {new Date(item.scheduledForMs).toLocaleString()} · {item.platforms.map((platform) => formatPlatformLabel(platform)).join(', ')}
                      {item.failureReason ? ` · ${item.failureReason.replace(/_/g, ' ')}` : ''}
                    </p>
                    {item.failureReason === 'token_expired' ? (
                      <p className="mt-1 text-xs">
                        <Link href="/settings#integrations" className="font-semibold text-blue-700 hover:underline">
                          Reconnect LinkedIn →
                        </Link>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="rounded-lg bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                          onClick={() => { void cancelScheduledPost(item.id); }}
                          disabled={isCancelling}
                          data-testid="failed-post-confirm-cancel"
                        >
                          {isCancelling ? 'Removing…' : 'Confirm remove'}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                          onClick={() => setConfirmingCancelId(null)}
                          disabled={isCancelling}
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-red-400 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                        onClick={() => setConfirmingCancelId(item.id)}
                        data-testid="failed-post-remove"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!isAuthLoading && !isAdaptationsLoading && !loadError && recentlyPublishedScheduledPosts.length > 0 ? (
        <section className="surface-card border-emerald-200 bg-emerald-50 p-6" data-testid="recently-published-section">
          <h2 className="section-title text-emerald-900">Recently Published</h2>
          <p className="mt-1 text-xs text-emerald-800">Posts the scheduler published automatically.</p>
          <ul className="mt-4 space-y-2 text-sm">
            {recentlyPublishedScheduledPosts.map((item) => (
              <li key={item.id} className="rounded-xl border border-emerald-300 bg-white px-3 py-2">
                <p className="font-medium text-emerald-900">{item.articleTitle}</p>
                <p className="text-xs text-emerald-800">
                  {item.publishedAtMs ? new Date(item.publishedAtMs).toLocaleString() : new Date(item.scheduledForMs).toLocaleString()} · {item.platforms.map((platform) => formatPlatformLabel(platform)).join(', ')}
                </p>
                {item.postUrl ? (
                  <p className="mt-1 text-xs">
                    <a
                      href={item.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-700 hover:underline"
                    >
                      View on LinkedIn →
                    </a>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
