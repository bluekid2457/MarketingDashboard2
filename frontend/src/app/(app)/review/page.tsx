'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { MarkdownPostPreview } from '@/components/MarkdownPostPreview';
import { UnicodePostPreview } from '@/components/UnicodePostPreview';
import { ChevronToggleIcon } from '@/components/ChevronToggleIcon';
import { PlaceholderCard } from '@/components/PlaceholderCard';
import { Spinner } from '@/components/Spinner';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { usePersistentToggle } from '@/lib/usePersistentToggle';
import {
  PLATFORM_KEYS,
  formatPlatformLabel,
  type PlatformKey,
} from '@/lib/scheduledPosts';

type ReviewStoryboard = {
  id: string;
  ideaId: string;
  angleId: string;
  ideaTopic: string;
  angleTitle: string;
  status: string;
  updatedAtLabel: string;
  contentLength: number;
  /** Map of raw markdown keyed by platform; populated from the draft's
   *  ``platforms`` map. Missing or empty values are omitted so callers can
   *  iterate ``PLATFORM_KEYS`` and skip keys absent from this map. */
  platformContent: Partial<Record<PlatformKey, string>>;
};

// Bucket A — plain-text feed platforms get a Unicode-substitution preview.
const UNICODE_PLATFORMS: ReadonlySet<PlatformKey> = new Set(['linkedin', 'twitter', 'instagram']);

function formatTimestampLabel(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = value as { toDate: () => Date };
    return candidate.toDate().toLocaleString();
  }

  return 'Unknown';
}

export default function ReviewPage() {
  const router = useRouter();
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [storyboards, setStoryboards] = useState<ReviewStoryboard[]>([]);
  const [isLoadingStoryboards, setIsLoadingStoryboards] = useState(true);
  const [storyboardsError, setStoryboardsError] = useState<string | null>(null);
  const [selectedPreviewPlatformByRow, setSelectedPreviewPlatformByRow] = useState<
    Record<string, PlatformKey>
  >({});
  // Persistent collapse state for the per-row clamped preview. One state for
  // the whole queue — collapsing on any row hides the clamped preview block
  // on every row. The pill row stays visible even when collapsed so the
  // user can still pre-select a platform to render when the preview is
  // re-opened. Stored at ``mdash:previewCollapse:review`` in localStorage.
  const [rowPreviewCollapsed, setRowPreviewCollapsed] = usePersistentToggle(
    'mdash:previewCollapse:review',
    false,
  );

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setStoryboardsError('Review queue is unavailable until Firebase is configured.');
      setIsLoadingStoryboards(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
    });

    return unsubscribeAuth;
  }, []);

  useEffect(() => {
    if (!currentUid) {
      setStoryboards([]);
      setIsLoadingStoryboards(false);
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setStoryboardsError('Review queue is unavailable until Firebase is configured.');
      setIsLoadingStoryboards(false);
      return;
    }

    setIsLoadingStoryboards(true);
    setStoryboardsError(null);

    const storyboardsQuery = query(collection(db, 'users', currentUid, 'drafts'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      storyboardsQuery,
      (snapshot) => {
        const nextStoryboards = snapshot.docs.map((documentSnapshot) => {
          const data = documentSnapshot.data();

          // ``data.platforms`` is a map of raw markdown keyed by platform. We
          // iterate the canonical ``PLATFORM_KEYS`` list so that adding a new
          // platform (e.g. Instagram) downstream automatically light it up
          // here once the user generates copy for it. Legacy drafts without
          // a ``platforms`` map render with no preview pills.
          const platformsRaw = data.platforms;
          const platformContent: Partial<Record<PlatformKey, string>> = {};
          if (platformsRaw && typeof platformsRaw === 'object') {
            const rawMap = platformsRaw as Record<string, unknown>;
            for (const key of PLATFORM_KEYS) {
              const value = rawMap[key];
              if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.length > 0) {
                  platformContent[key] = trimmed;
                }
              }
            }
          }

          return {
            id: documentSnapshot.id,
            ideaId: typeof data.ideaId === 'string' ? data.ideaId : '',
            angleId: typeof data.angleId === 'string' ? data.angleId : '',
            ideaTopic: typeof data.ideaTopic === 'string' ? data.ideaTopic : 'Untitled idea',
            angleTitle: typeof data.angleTitle === 'string' ? data.angleTitle : 'Untitled angle',
            status: typeof data.status === 'string' ? data.status : 'draft',
            updatedAtLabel: formatTimestampLabel(data.updatedAt),
            contentLength: typeof data.content === 'string' ? data.content.trim().length : 0,
            platformContent,
          } satisfies ReviewStoryboard;
        });

        setStoryboards(nextStoryboards);
        setIsLoadingStoryboards(false);
      },
      () => {
        setStoryboardsError('Unable to load your review queue right now.');
        setStoryboards([]);
        setIsLoadingStoryboards(false);
      },
    );

    return unsubscribe;
  }, [currentUid]);

  const hasReviewableStoryboards = useMemo(
    () => storyboards.some((storyboard) => storyboard.ideaId && storyboard.angleId),
    [storyboards],
  );

  function openStoryboard(record: ReviewStoryboard): void {
    if (!record.ideaId || !record.angleId) {
      return;
    }

    const draftContext = {
      ideaId: record.ideaId,
      angleId: record.angleId,
      selectedAngle: {
        id: record.angleId,
        title: record.angleTitle,
        summary: '',
        sections: [],
      },
      idea: {
        id: record.ideaId,
        topic: record.ideaTopic,
        tone: '',
        audience: '',
        format: '',
      },
    };

    localStorage.setItem('draft_generation_context', JSON.stringify(draftContext));
    router.push(`/storyboard/${record.ideaId}?angleId=${record.angleId}`);
  }

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <h1 className="text-3xl font-extrabold text-slate-900">Review and Approval Workflow</h1>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <section className="surface-card p-6">
          <h2 className="section-title">Storyboard Queue</h2>

          {isLoadingStoryboards ? (
            <div className="mt-4 text-sm text-slate-600">
              <Spinner size="sm" label="Loading review queue..." />
            </div>
          ) : null}

          {storyboardsError ? <p className="mt-4 text-sm text-red-700">{storyboardsError}</p> : null}

          {!isLoadingStoryboards && !storyboardsError && !hasReviewableStoryboards ? (
            <p className="mt-4 text-sm text-slate-600">
              No storyboard documents are currently available for review.
            </p>
          ) : null}

          {!isLoadingStoryboards && !storyboardsError && hasReviewableStoryboards ? (
            <>
              <div className="mt-4 space-y-1" data-testid="review-preview-caveat">
                <p className="text-xs text-slate-600">
                  Preview reflects how this post will render on the selected platform.
                </p>
                <p className="text-xs text-slate-500">
                  Plain-text platforms (LinkedIn, X/Twitter, Instagram) substitute Unicode for visual bold/italic — not searchable and reduces screen-reader accessibility. Long-form platforms (Medium, Newsletter, Blog) render the markdown directly; destination styling may differ on publish.
                </p>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {storyboards
                  .filter((storyboard) => storyboard.ideaId && storyboard.angleId)
                  .map((storyboard) => {
                    const availablePlatforms = PLATFORM_KEYS.filter(
                      (key) => storyboard.platformContent[key],
                    );
                    const fallbackPlatform = availablePlatforms[0];
                    const selectedPlatform =
                      selectedPreviewPlatformByRow[storyboard.id] ?? fallbackPlatform;
                    const previewMarkdown = selectedPlatform
                      ? storyboard.platformContent[selectedPlatform] ?? ''
                      : '';

                    return (
                      <li key={storyboard.id}>
                        <button
                          type="button"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-teal-300 hover:bg-teal-50"
                          onClick={() => openStoryboard(storyboard)}
                        >
                          <p className="font-semibold text-slate-900">{storyboard.ideaTopic}</p>
                          <p className="mt-1 text-xs text-slate-600">{storyboard.angleTitle}</p>
                          <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">
                            Status: {storyboard.status} · Updated: {storyboard.updatedAtLabel} · Characters:{' '}
                            {storyboard.contentLength}
                          </p>

                          {availablePlatforms.length > 0 ? (
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <div
                                className="flex flex-wrap gap-1"
                                data-testid={`review-platform-pills-${storyboard.id}`}
                              >
                                {availablePlatforms.map((platformKey) => {
                                  const isActive = platformKey === selectedPlatform;
                                  return (
                                    <button
                                      type="button"
                                      key={platformKey}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setSelectedPreviewPlatformByRow((previous) => ({
                                          ...previous,
                                          [storyboard.id]: platformKey,
                                        }));
                                      }}
                                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                        isActive
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                      }`}
                                      data-active={isActive ? 'true' : 'false'}
                                    >
                                      {formatPlatformLabel(platformKey)}
                                    </button>
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRowPreviewCollapsed();
                                }}
                                aria-expanded={!rowPreviewCollapsed}
                                aria-controls={`review-row-preview-${storyboard.id}`}
                                className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                                data-testid={`review-preview-toggle-${storyboard.id}`}
                              >
                                <span>{rowPreviewCollapsed ? 'Show preview' : 'Hide preview'}</span>
                                <ChevronToggleIcon collapsed={rowPreviewCollapsed} />
                              </button>
                            </div>
                          ) : null}

                          {!rowPreviewCollapsed &&
                          availablePlatforms.length > 0 &&
                          previewMarkdown &&
                          selectedPlatform ? (
                            <div
                              id={`review-row-preview-${storyboard.id}`}
                              className="mt-2 max-h-32 overflow-hidden rounded-lg border border-slate-200 bg-white p-2"
                            >
                              {UNICODE_PLATFORMS.has(selectedPlatform) ? (
                                <UnicodePostPreview
                                  platform={
                                    selectedPlatform as 'linkedin' | 'twitter' | 'instagram'
                                  }
                                  markdown={previewMarkdown}
                                  showCaveat={false}
                                />
                              ) : (
                                <MarkdownPostPreview
                                  markdown={previewMarkdown}
                                  showCaveat={false}
                                />
                              )}
                            </div>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </>
          ) : null}

        </section>

        <div className="space-y-6">
          <PlaceholderCard
            title="Inline Editor"
            description="Edit drafts inline before approving — currently you can open the storyboard editor from the queue."
            previewKind="editor"
          />
          <PlaceholderCard
            title="Version History"
            description="Side-by-side diff of saved revisions with one-click restore."
            previewKind="list"
          />
          <PlaceholderCard
            title="Approval Chain Controls"
            description="Multi-step approver routing for teams or agencies."
            previewKind="list"
          />
          <PlaceholderCard
            title="Comment / Suggestion Layer"
            description="Drop comments and suggestion edits anchored to specific paragraphs."
            previewKind="list"
          />
          <PlaceholderCard
            title="Role-Based Access"
            description="Separate drafting, approving, and publishing rights per workspace member."
            previewKind="form"
          />
        </div>
      </div>
    </div>
  );
}
