'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';

import { Spinner } from '@/components/Spinner';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { getWorkflowContext } from '@/lib/workflowContext';

type PlatformKey = 'linkedin' | 'twitter';

type PlatformContent = Partial<Record<PlatformKey, string>>;

type AdaptationRecord = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  platforms: PlatformContent;
};

type AdaptDraftContext = {
  ideaId?: string;
  angleId?: string;
  draftContent?: string;
  idea?: {
    topic?: string;
  };
  selectedAngle?: {
    title?: string;
  };
};

type PublishNoticeTone = 'success' | 'error' | 'info';
type PublishNotice = {
  tone: PublishNoticeTone;
  message: string;
};

const ADAPT_CONTEXT_STORAGE_KEY = 'adapt_draft_context';

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAdaptDraftContext(): AdaptDraftContext | null {
  try {
    const raw = localStorage.getItem(ADAPT_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as AdaptDraftContext;
  } catch {
    return null;
  }
}

function parseAdaptationRecord(id: string, payload: Record<string, unknown>): AdaptationRecord {
  const rawPlatforms = payload.platforms;
  const platformsObject = rawPlatforms && typeof rawPlatforms === 'object' ? (rawPlatforms as Record<string, unknown>) : {};

  return {
    id,
    ideaId: asTrimmedString(payload.ideaId),
    angleId: asTrimmedString(payload.angleId),
    ideaTopic: asTrimmedString(payload.ideaTopic),
    angleTitle: asTrimmedString(payload.angleTitle),
    platforms: {
      linkedin: asTrimmedString(platformsObject.linkedin),
      twitter: asTrimmedString(platformsObject.twitter),
    },
  };
}

export default function PublishPage() {
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isContextLoading, setIsContextLoading] = useState(true);

  const [adaptation, setAdaptation] = useState<AdaptationRecord | null>(null);
  const [fallbackDraft, setFallbackDraft] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<PublishNotice | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoadError('Publish handoff is unavailable until Firebase is configured.');
      setIsAuthLoading(false);
      setIsContextLoading(false);
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
      setLoadError('Sign in to access one-click platform publishing.');
      setIsContextLoading(false);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setLoadError('Publish handoff is unavailable until Firebase is configured.');
      setIsContextLoading(false);
      return;
    }

    setIsContextLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const workflow = getWorkflowContext();
        const localAdaptContext = parseAdaptDraftContext();
        const fallbackText = asTrimmedString(localAdaptContext?.draftContent);
        setFallbackDraft(fallbackText);

        const candidateDocIds: string[] = [];
        const pushCandidate = (ideaId: string, angleId: string): void => {
          if (!ideaId || !angleId) {
            return;
          }

          const docId = `${ideaId}_${angleId}`;
          if (!candidateDocIds.includes(docId)) {
            candidateDocIds.push(docId);
          }
        };

        pushCandidate(asTrimmedString(workflow?.ideaId), asTrimmedString(workflow?.angleId));
        pushCandidate(asTrimmedString(localAdaptContext?.ideaId), asTrimmedString(localAdaptContext?.angleId));

        for (const docId of candidateDocIds) {
          const snapshot = await getDoc(doc(db, 'users', currentUid, 'adaptations', docId));
          if (snapshot.exists()) {
            const record = parseAdaptationRecord(snapshot.id, snapshot.data() as Record<string, unknown>);
            setAdaptation(record);
            setNotice({
              tone: 'info',
              message: 'Loaded publish text from your latest workflow adaptation.',
            });
            setIsContextLoading(false);
            return;
          }
        }

        const latestQuery = query(collection(db, 'users', currentUid, 'adaptations'), orderBy('updatedAt', 'desc'), limit(1));
        const latestSnapshot = await getDocs(latestQuery);

        if (!latestSnapshot.empty) {
          const documentSnapshot = latestSnapshot.docs[0];
          const record = parseAdaptationRecord(documentSnapshot.id, documentSnapshot.data() as Record<string, unknown>);
          setAdaptation(record);
          setNotice({
            tone: 'info',
            message: 'Loaded your most recent adaptation because no exact workflow match was found.',
          });
          setIsContextLoading(false);
          return;
        }

        setAdaptation(null);
        setNotice({
          tone: 'info',
          message: fallbackText
            ? 'No adaptation record found. Publish is using your local draft text fallback.'
            : 'No adaptation content found yet. Open Adapt and generate platform copy first.',
        });
      } catch {
        setAdaptation(null);
        setLoadError('Unable to load adaptation context for publishing. Please return to Adapt and try again.');
      } finally {
        setIsContextLoading(false);
      }
    })();
  }, [currentUid, isAuthLoading]);

  const ideaLabel = useMemo(() => {
    if (adaptation?.ideaTopic) {
      return adaptation.ideaTopic;
    }

    const localAdaptContext = parseAdaptDraftContext();
    return asTrimmedString(localAdaptContext?.idea?.topic);
  }, [adaptation]);

  const angleLabel = useMemo(() => {
    if (adaptation?.angleTitle) {
      return adaptation.angleTitle;
    }

    const localAdaptContext = parseAdaptDraftContext();
    return asTrimmedString(localAdaptContext?.selectedAngle?.title);
  }, [adaptation]);

  const linkedinText = useMemo(() => {
    return asTrimmedString(adaptation?.platforms.linkedin) || fallbackDraft;
  }, [adaptation, fallbackDraft]);

  const twitterText = useMemo(() => {
    return asTrimmedString(adaptation?.platforms.twitter) || fallbackDraft;
  }, [adaptation, fallbackDraft]);

  const hasLinkedInContent = linkedinText.length > 0;
  const hasTwitterContent = twitterText.length > 0;

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

  const openTwitterIntent = useCallback(() => {
    if (!hasTwitterContent) {
      setNotice({ tone: 'error', message: 'No X/Twitter content is ready. Generate or edit content in Adapt first.' });
      return;
    }

    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}`;
    window.open(intentUrl, '_blank', 'noopener,noreferrer');
    setNotice({ tone: 'success', message: 'Opened X/Twitter compose with your text prefilled.' });
  }, [hasTwitterContent, twitterText]);

  const openLinkedInCompose = useCallback(async () => {
    if (!hasLinkedInContent) {
      setNotice({ tone: 'error', message: 'No LinkedIn content is ready. Generate or edit content in Adapt first.' });
      return;
    }

    const copied = await copyText(linkedinText, 'LinkedIn');
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
  }, [copyText, hasLinkedInContent, linkedinText]);

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 7</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Publishing and Scheduling</h1>
        <p className="mt-1 muted-copy">One-click handoff opens each platform compose page with content prefilled as much as each platform allows.</p>

        {ideaLabel || angleLabel ? (
          <p className="mt-3 text-sm text-slate-600">
            {ideaLabel ? (
              <span>
                Idea: <span className="font-semibold text-slate-900">{ideaLabel}</span>
              </span>
            ) : null}
            {ideaLabel && angleLabel ? <span> · </span> : null}
            {angleLabel ? (
              <span>
                Angle: <span className="font-semibold text-slate-900">{angleLabel}</span>
              </span>
            ) : null}
          </p>
        ) : null}

        {notice ? <p className={`mt-4 rounded-xl border px-4 py-3 text-sm ${noticeColorClass}`}>{notice.message}</p> : null}
      </section>

      {isAuthLoading || isContextLoading ? (
        <section className="surface-card p-6 text-sm text-slate-600">
          <Spinner size="sm" label="Loading publish context..." />
        </section>
      ) : null}

      {loadError ? (
        <section className="surface-card p-6">
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>
        </section>
      ) : null}

      {!isAuthLoading && !isContextLoading && !loadError ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="surface-card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="section-title">LinkedIn One-Click Handoff</h2>
                <p className="mt-1 text-xs text-slate-600">
                  LinkedIn does not reliably support full text prefill via URL intents. We copy your content first, then open LinkedIn compose.
                </p>
              </div>
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">LinkedIn</span>
            </div>

            <textarea
              readOnly
              value={linkedinText}
              className="mt-4 min-h-[200px] w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800"
              placeholder="No LinkedIn-ready content found yet. Generate platform copy in Adapt first."
            />

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                onClick={() => {
                  void openLinkedInCompose();
                }}
                disabled={!hasLinkedInContent}
              >
                Publish to LinkedIn
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={() => {
                  void copyText(linkedinText, 'LinkedIn');
                }}
                disabled={!hasLinkedInContent}
              >
                Copy LinkedIn Text
              </button>
            </div>
          </section>

          <section className="surface-card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="section-title">X / Twitter One-Click Handoff</h2>
                <p className="mt-1 text-xs text-slate-600">Opens X compose intent with your post text prefilled.</p>
              </div>
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">X / Twitter</span>
            </div>

            <textarea
              readOnly
              value={twitterText}
              className="mt-4 min-h-[200px] w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800"
              placeholder="No X/Twitter-ready content found yet. Generate platform copy in Adapt first."
            />

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                onClick={openTwitterIntent}
                disabled={!hasTwitterContent}
              >
                Publish to X / Twitter
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={() => {
                  void copyText(twitterText, 'X/Twitter');
                }}
                disabled={!hasTwitterContent}
              >
                Copy X Text
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
