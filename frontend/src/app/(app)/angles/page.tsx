'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { getActiveAIKey } from '@/lib/aiConfig';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { getWorkflowContext, setWorkflowContext } from '@/lib/workflowContext';
import { Spinner } from '@/components/Spinner';
import WorkflowStepper from '@/components/WorkflowStepper';

type IdeaRecord = {
  id: string;
  topic: string;
  tone: string;
  audience: string;
  format: string;
  createdAtLabel: string;
};

type Angle = {
  id: string;
  title: string;
  summary: string;
  sections: string[];
  status?: 'active' | 'selected' | 'archived';
  createdAt?: number;
  selectedAt?: number;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  message: string;
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

type AnglesApiResponse = {
  angles: Angle[];
  provider?: string;
  source?: 'provider' | 'fallback';
  fallbackReason?: string;
  promptUsed?: string;
  modelText?: string;
  error?: string;
};

const DRAFT_CONTEXT_STORAGE_KEY = 'draft_generation_context';
const CARDS_PER_VIEW = 2;
const ANGLES_GENERATION_STATE_STORAGE_KEY = 'angles_generation_state';
const REQUIRED_ANGLES = 2;
const MAX_GENERATION_ATTEMPTS = 3;
const PER_ATTEMPT_REQUEST_TIMEOUT_MS = 12_000;
const GENERATION_RUN_DEADLINE_MS = 35_000;
const GENERATION_STATE_TTL_MS = 3 * 60 * 1000;

type GenerationState = {
  ideaId: string;
  status: 'pending' | 'failed';
  startedAt: number;
  errorMessage?: string;
  ownerId?: string;
  runId?: string;
};

const ANGLES_GENERATION_OWNER_ID = crypto.randomUUID();

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function areAnglesDistinct(entries: Angle[]): boolean {
  const dedupe = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.title.trim().toLowerCase()}|${entry.summary.trim().toLowerCase()}`;
    if (dedupe.has(key)) {
      return false;
    }
    dedupe.add(key);
  }
  return true;
}

function isValidGeneratedAngles(entries: Angle[]): boolean {
  if (entries.length !== REQUIRED_ANGLES) {
    return false;
  }

  const everyAngleHasContent = entries.every((entry) =>
    isNonEmpty(entry.id)
    && isNonEmpty(entry.title)
    && isNonEmpty(entry.summary)
    && Array.isArray(entry.sections)
    && entry.sections.length > 0
    && entry.sections.every((section) => isNonEmpty(section)),
  );

  return everyAngleHasContent && areAnglesDistinct(entries);
}

function ensureUniqueAngleIds(entries: Angle[], idSeed: string): Angle[] {
  const seen = new Set<string>();

  return entries.map((entry, index) => {
    const rawId = entry.id.trim();
    const baseId = rawId.length > 0 ? rawId : `${idSeed}-${index + 1}`;
    let nextId = baseId;
    let suffix = 1;

    while (seen.has(nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    seen.add(nextId);
    return nextId === entry.id ? entry : { ...entry, id: nextId };
  });
}

function normalizePersistedAnglesPayload(value: unknown): Angle[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): Angle | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const candidate = entry as {
        id?: unknown;
        title?: unknown;
        summary?: unknown;
        sections?: unknown;
        status?: unknown;
        createdAt?: unknown;
        selectedAt?: unknown;
      };

      if (!isNonEmpty(candidate.id) || !isNonEmpty(candidate.title) || !isNonEmpty(candidate.summary)) {
        return null;
      }

      if (!Array.isArray(candidate.sections)) {
        return null;
      }

      const sanitizedSections = candidate.sections
        .filter((section): section is string => isNonEmpty(section))
        .map((section) => section.trim());

      if (sanitizedSections.length === 0) {
        return null;
      }

      const normalized: Angle = {
        id: candidate.id.trim(),
        title: candidate.title.trim(),
        summary: candidate.summary.trim(),
        sections: sanitizedSections,
        status: candidate.status === 'selected' || candidate.status === 'archived' ? candidate.status : 'active',
        createdAt: typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
          ? candidate.createdAt
          : Date.now(),
      };

      if (typeof candidate.selectedAt === 'number' && Number.isFinite(candidate.selectedAt)) {
        normalized.selectedAt = candidate.selectedAt;
      }

      return normalized;
    })
    .filter((entry): entry is Angle => Boolean(entry));
}

function normalizePersistedSelectedAngleId(value: unknown, entries: Angle[]): string | null {
  if (isNonEmpty(value) && entries.some((entry) => entry.id === value)) {
    return value;
  }

  return entries[0]?.id ?? null;
}

function readGenerationState(): GenerationState | null {
  try {
    const raw = localStorage.getItem(ANGLES_GENERATION_STATE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as GenerationState;
  } catch {
    return null;
  }
}

function writeGenerationState(nextState: GenerationState): void {
  try {
    localStorage.setItem(ANGLES_GENERATION_STATE_STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // Ignore storage errors in private browsing or restricted environments.
  }
}

function clearGenerationState(): void {
  try {
    localStorage.removeItem(ANGLES_GENERATION_STATE_STORAGE_KEY);
  } catch {
    // Ignore storage errors in private browsing or restricted environments.
  }
}

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

export default function AnglesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawIdeaId = searchParams.get('ideaId')?.trim() ?? '';
  const ideaId = rawIdeaId;

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [idea, setIdea] = useState<IdeaRecord | null>(null);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [isIdeaLoading, setIsIdeaLoading] = useState(false);
  const [hasResolvedAnglesRestore, setHasResolvedAnglesRestore] = useState(false);

  const [angles, setAngles] = useState<Angle[]>([]);
  const [selectedAngleId, setSelectedAngleId] = useState<string | null>(null);
  const [carouselStartIndex, setCarouselStartIndex] = useState(0);
  const [dragState, setDragState] = useState<{ angleId: string; sectionIndex: number } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [isTrendsLoading, setIsTrendsLoading] = useState(true);
  const generationInFlightRef = useRef(false);
  const isGeneratingRef = useRef(false);
  const anglesRef = useRef<Angle[]>([]);
  const selectedAngleIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoGenerationRanForIdeaRef = useRef<string | null>(null);
  const manualRegenerateClickGuardRef = useRef(false);
  const isSelectionFinalizationInFlightRef = useRef(false);
  const [latestPersistedUpdatedAtMs, setLatestPersistedUpdatedAtMs] = useState<number | null>(null);

  // Persist ideaId to workflow context whenever it is present in the URL.
  useEffect(() => {
    if (ideaId) {
      setWorkflowContext({ ideaId });
    }
  }, [ideaId]);

  // Restore ideaId from workflow context when URL does not include it.
  useEffect(() => {
    if (!ideaId) {
      const ctx = getWorkflowContext();
      if (ctx?.ideaId) {
        router.replace(`/angles?ideaId=${encodeURIComponent(ctx.ideaId)}`);
      }
    }
  }, [ideaId, router]);

  useEffect(() => {
    if (!ideaId) {
      return;
    }

    setWorkflowContext({
      ideaId,
      ...(selectedAngleId ? { angleId: selectedAngleId } : {}),
    });
  }, [ideaId, selectedAngleId]);

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    anglesRef.current = angles;
  }, [angles]);

  useEffect(() => {
    selectedAngleIdRef.current = selectedAngleId;
  }, [selectedAngleId]);

  const selectedAngle = useMemo(
    () => angles.find((entry) => entry.id === selectedAngleId) ?? null,
    [angles, selectedAngleId],
  );

  const persistAnglesToFirestore = useCallback(
    async (nextAngles: Angle[], nextSelectedAngleId: string | null): Promise<boolean> => {
      if (!currentUser || !idea) {
        return false;
      }

      const firestore = getFirebaseDb();
      if (!firestore) {
        setPersistenceError('Unable to persist angle edits because Firebase is not configured.');
        return false;
      }

      const sanitizedAngles = ensureUniqueAngleIds(normalizePersistedAnglesPayload(nextAngles), `persisted-${idea.id}`);
      const normalizedSelectedAngleId = normalizePersistedSelectedAngleId(nextSelectedAngleId, sanitizedAngles);
      const nowMs = Date.now();

      if (sanitizedAngles.length === 0) {
        return false;
      }

      const payloadAngles = sanitizedAngles.map((angle, index) => {
        const isSelected = normalizedSelectedAngleId !== null && angle.id === normalizedSelectedAngleId;
        const createdAt = typeof angle.createdAt === 'number' && Number.isFinite(angle.createdAt)
          ? angle.createdAt
          : nowMs + index;

        return {
          id: angle.id,
          title: angle.title,
          summary: angle.summary,
          sections: angle.sections,
          status: isSelected ? 'selected' : 'active',
          createdAt,
          ...(isSelected ? { selectedAt: angle.selectedAt ?? nowMs } : {}),
        };
      });

      try {
        await setDoc(
          doc(firestore, 'users', currentUser.uid, 'ideas', idea.id, 'workflow', 'angles'),
          {
            ideaId: idea.id,
            angles: payloadAngles,
            selectedAngleId: normalizedSelectedAngleId,
            updatedAt: serverTimestamp(),
            updatedAtMs: nowMs,
            cleanup: {
              pending: false,
              failedIds: [],
              lastAttemptedAtMs: nowMs,
            },
          },
          { merge: true },
        );

        setLatestPersistedUpdatedAtMs(nowMs);
        setPersistenceError(null);
        return true;
      } catch (error) {
        const lastErrorMessage = error instanceof Error
          ? error.message
          : 'Unable to persist angle edits right now.';
        setPersistenceError(lastErrorMessage);
        console.warn('[Angles Page] Unable to persist angles to Firestore.', lastErrorMessage);
        return false;
      }
    },
    [currentUser, idea],
  );

  const handleAngleSelection = useCallback(async (angleId: string): Promise<void> => {
    if (selectedAngleIdRef.current === angleId || isSelectionFinalizationInFlightRef.current) {
      return;
    }

    setGenerationError(null);
    isSelectionFinalizationInFlightRef.current = true;
    setSelectedAngleId(angleId);

    if (!currentUser || !idea) {
      isSelectionFinalizationInFlightRef.current = false;
      return;
    }

    try {
      const didPersist = await persistAnglesToFirestore(anglesRef.current, angleId);
      if (didPersist) {
        setWorkflowContext({ ideaId: idea.id, angleId });
      } else {
        setGenerationError('Unable to finalize this angle selection. Your selection is kept locally; retry in a moment.');
      }
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Unable to finalize this angle selection.');
    } finally {
      isSelectionFinalizationInFlightRef.current = false;
    }
  }, [currentUser, idea, persistAnglesToFirestore]);

  const maxCarouselStart = Math.max(angles.length - CARDS_PER_VIEW, 0);
  const visibleAngles = angles.slice(carouselStartIndex, carouselStartIndex + CARDS_PER_VIEW);

  const generateAngles = useCallback(
    async (
      options?: {
        refinementPrompt?: string;
        selectedAngleId?: string;
        selectedAngle?: Angle | null;
        trigger?: 'auto' | 'manual';
      },
    ): Promise<boolean> => {
      if (!idea) {
        return false;
      }

      const isRefinementRequest = Boolean(options?.refinementPrompt);
      const generationSeed = !isRefinementRequest ? crypto.randomUUID() : undefined;

      if (!isRefinementRequest && generationInFlightRef.current) {
        return false;
      }

      if (isRefinementRequest && (generationInFlightRef.current || isGeneratingRef.current)) {
        setGenerationError('Wait for angle generation to finish before refining.');
        return false;
      }

      const existingState = readGenerationState();
      if (
        !isRefinementRequest
        && existingState?.status === 'pending'
        && existingState.ideaId === idea.id
      ) {
        const hasActiveRunInMemory = Boolean(generationInFlightRef.current && activeRunIdRef.current);

        if (hasActiveRunInMemory) {
          return false;
        }

        // Recover from stale pending state after refresh/navigation.
        clearGenerationState();
      }

      const activeConfig = getActiveAIKey();
      setGenerationError(null);

      const runId = crypto.randomUUID();
      activeRunIdRef.current = runId;
      generationInFlightRef.current = true;
      writeGenerationState({
        ideaId: idea.id,
        status: 'pending',
        startedAt: Date.now(),
        ownerId: ANGLES_GENERATION_OWNER_ID,
        runId,
      });
      setIsGenerating(true);

      try {
        const runDeadlineAt = Date.now() + GENERATION_RUN_DEADLINE_MS;

        const requestOnce = async (): Promise<AnglesApiResponse> => {
          const remainingRunMs = runDeadlineAt - Date.now();
          if (remainingRunMs <= 0) {
            throw new Error(
              `Generation timed out after ${Math.floor(GENERATION_RUN_DEADLINE_MS / 1000)} seconds.`,
            );
          }

          const requestBody = {
            provider: activeConfig.provider,
            apiKey: activeConfig.apiKey,
            ollamaBaseUrl: activeConfig.ollamaBaseUrl,
            ollamaModel: activeConfig.ollamaModel,
            idea: {
              topic: idea.topic,
              tone: idea.tone,
              audience: idea.audience,
              format: idea.format,
              selectedAngle: options?.selectedAngle ?? undefined,
            },
            count: isRefinementRequest ? 1 : REQUIRED_ANGLES,
            selectedAngleId: options?.selectedAngleId,
            refinementPrompt: options?.refinementPrompt,
            generationSeed,
          };

          console.log('[Angles Page] Sending AI request', {
            provider: requestBody.provider,
            count: requestBody.count,
            selectedAngleId: requestBody.selectedAngleId,
            hasRefinementPrompt: Boolean(requestBody.refinementPrompt),
            generationSeed: requestBody.generationSeed,
            topic: requestBody.idea.topic,
            tone: requestBody.idea.tone,
            audience: requestBody.idea.audience,
            format: requestBody.idea.format,
          });

          const controller = new AbortController();
          activeRequestControllerRef.current = controller;
          const timeoutMs = Math.max(1, Math.min(PER_ATTEMPT_REQUEST_TIMEOUT_MS, remainingRunMs));
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const response = await fetch('/api/angles', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(requestBody),
              signal: controller.signal,
            });

            const payload = (await response.json()) as AnglesApiResponse;

            if (payload.promptUsed) {
              console.log(`[Angles Page] Prompt metadata returned in response payload (${payload.provider ?? activeConfig.provider}):\n${payload.promptUsed}`);
            }
            if (payload.modelText) {
              console.log(`[Angles Page] Response returned by AI (${payload.provider ?? activeConfig.provider}):\n${payload.modelText}`);
            }
            if (payload.source === 'fallback') {
              console.warn('[Angles Page] Using deterministic fallback angles from API route', {
                provider: payload.provider ?? activeConfig.provider,
                reason: payload.fallbackReason ?? 'Provider retries exhausted.',
              });
            }

            if (!response.ok) {
              throw new Error(payload.error || 'AI generation failed.');
            }

            return payload;
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              throw new Error(`Generation request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
            }
            throw error;
          } finally {
            clearTimeout(timeoutId);
            if (activeRequestControllerRef.current === controller) {
              activeRequestControllerRef.current = null;
            }
          }
        };

        const runId = activeRunIdRef.current;
        if (!runId) {
          return false;
        }

        const previousValidAngles = [...anglesRef.current];

        const ensureRunIsActive = (): void => {
          if (activeRunIdRef.current !== runId) {
            throw new Error('Generation was canceled.');
          }
        };

        let terminalError = 'Unable to generate valid angles right now.';
        for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
          const remainingRunMs = runDeadlineAt - Date.now();
          if (remainingRunMs <= 0) {
            terminalError = `Generation timed out after ${Math.floor(GENERATION_RUN_DEADLINE_MS / 1000)} seconds.`;
            break;
          }

          try {
            ensureRunIsActive();
            const payload = await requestOnce();
            ensureRunIsActive();
            const candidateAngles = ensureUniqueAngleIds(payload.angles ?? [], runId);

            if (!isValidGeneratedAngles(candidateAngles)) {
              terminalError = `Attempt ${attempt} returned invalid results. Angles must contain exactly 2 distinct, non-empty cards.`;
              continue;
            }

            const isManualRegeneration = options?.trigger === 'manual' && previousValidAngles.length > 0;
            const mergedAngles = ensureUniqueAngleIds(
              isManualRegeneration
              ? [...previousValidAngles, ...candidateAngles]
              : candidateAngles,
              `${idea.id}-angles`,
            );
            const nextSelectedAngleId = candidateAngles[0]?.id ?? mergedAngles[0]?.id ?? null;

            setAngles(mergedAngles);
            setSelectedAngleId(nextSelectedAngleId);
            setCarouselStartIndex(
              isManualRegeneration
                ? Math.max(0, mergedAngles.length - CARDS_PER_VIEW)
                : 0,
            );
            setGenerationError(null);
            await persistAnglesToFirestore(mergedAngles, nextSelectedAngleId);
            clearGenerationState();
            return true;
          } catch (error) {
            terminalError = error instanceof Error ? error.message : 'Unable to generate angles right now.';
          }

          if (attempt < MAX_GENERATION_ATTEMPTS && Date.now() < runDeadlineAt) {
            await new Promise<void>((resolve) => {
              retryTimerRef.current = setTimeout(() => {
                retryTimerRef.current = null;
                resolve();
              }, 250);
            });
          }
        }

        writeGenerationState({
          ideaId: idea.id,
          status: 'failed',
          startedAt: Date.now(),
          errorMessage: terminalError,
          ownerId: ANGLES_GENERATION_OWNER_ID,
          runId,
        });

        if (previousValidAngles.length > 0) {
          setAngles(previousValidAngles);
          if (!previousValidAngles.some((entry) => entry.id === selectedAngleIdRef.current)) {
            setSelectedAngleId(previousValidAngles[0]?.id ?? null);
          }
        }

        throw new Error(
          `Regeneration failed after ${MAX_GENERATION_ATTEMPTS} attempts. ${terminalError} Previously generated angles are still shown. Check provider settings/network, then click "Regenerate" to try again.`,
        );
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : 'Unable to generate angles right now.');
        return false;
      } finally {
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        activeRunIdRef.current = null;
        generationInFlightRef.current = false;
        setIsGenerating(false);
      }
    },
    [idea, persistAnglesToFirestore],
  );

  useEffect(() => {
    if (!ideaId) {
      clearGenerationState();
      return;
    }

    const state = readGenerationState();
    if (!state || state.ideaId !== ideaId) {
      return;
    }

    if (state.status === 'pending') {
      clearGenerationState();
      setGenerationError(
        'Recovered from an unfinished previous generation run. Start a fresh run with "Regenerate".',
      );
      return;
    }

    if (state.status === 'failed' && state.errorMessage) {
      setGenerationError(
        `Previous generation failed: ${state.errorMessage}. Retry when your AI provider is ready.`,
      );
    }
  }, [ideaId]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadTrends(): Promise<void> {
      setIsTrendsLoading(true);
      setTrendsError(null);

      try {
        const response = await fetch('/api/trends', {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Trend request failed.');
        }

        const payload = (await response.json()) as TrendsResponse;
        setTrends(payload);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setTrends(null);
        setTrendsError(
          error instanceof Error ? error.message : 'Unable to load live trend signals right now.',
        );
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
    if (!ideaId) {
      setIdea(null);
      setIdeaError(null);
      setIsIdeaLoading(false);
      setHasResolvedAnglesRestore(false);
      setAngles([]);
      setSelectedAngleId(null);
      setLatestPersistedUpdatedAtMs(null);
      return;
    }

    const firebaseAuth = getFirebaseAuth();
    const firestore = getFirebaseDb();

    if (!firebaseAuth || !firestore) {
      setIdeaError('Angles are unavailable until Firebase is configured for this app.');
      setIsIdeaLoading(false);
      setHasResolvedAnglesRestore(false);
      return;
    }

    setIsIdeaLoading(true);
    setHasResolvedAnglesRestore(false);
    setIdeaError(null);
    setAngles([]);
    setSelectedAngleId(null);
    setLatestPersistedUpdatedAtMs(null);

    // Fast-path: check localStorage cache written by the Ideas page
    let loadedFromCache = false;
    try {
      const cached = localStorage.getItem('angles_idea_context');
      if (cached) {
        const parsed = JSON.parse(cached) as {
          ideaId: string;
          topic: string;
          tone: string;
          audience: string;
          format: string;
          createdAtMs: number;
        };
        if (parsed.ideaId === ideaId) {
          setIdea({
            id: parsed.ideaId,
            topic: parsed.topic,
            tone: parsed.tone,
            audience: parsed.audience,
            format: parsed.format,
            createdAtLabel: formatIdeaTimestamp(undefined, parsed.createdAtMs),
          });
          setIsIdeaLoading(false);
          loadedFromCache = true;
          // Continue to Firestore in background to keep data fresh (do not block UI)
        }
      }
    } catch {
      // localStorage unavailable — fall through to Firestore
    }

    const timeoutId = setTimeout(() => {
      setIsIdeaLoading((prev) => {
        if (prev) {
          setIdeaError('Loading is taking longer than expected. Please go back to the Ideas page and try again.');
          return false;
        }
        return prev;
      });
    }, 10_000);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      setCurrentUser(user);

      if (!user) {
        if (!loadedFromCache) {
          setIdea(null);
          setIdeaError('Sign in first, then choose an idea from the Ideas page.');
          setIsIdeaLoading(false);
        }
        setHasResolvedAnglesRestore(true);
        return;
      }

      try {
        const ideaRef = doc(firestore, 'users', user.uid, 'ideas', ideaId);
        const snapshot = await getDoc(ideaRef);

        if (!snapshot.exists()) {
          if (!loadedFromCache) {
            setIdea(null);
            setIdeaError('That idea could not be found. Pick an idea from the Ideas page and try again.');
            setIsIdeaLoading(false);
          }
          setHasResolvedAnglesRestore(true);
          return;
        }

        const data = snapshot.data();
        const createdAtMs = typeof data.createdAtMs === 'number' ? data.createdAtMs : Date.now();

        setIdea({
          id: snapshot.id,
          topic: typeof data.topic === 'string' ? data.topic : '',
          tone: typeof data.tone === 'string' ? data.tone : 'Unspecified',
          audience: typeof data.audience === 'string' ? data.audience : 'Unspecified',
          format: typeof data.format === 'string' ? data.format : 'Unspecified',
          createdAtLabel: formatIdeaTimestamp(data.createdAt, createdAtMs),
        });

        try {
          const persistedAnglesRef = doc(
            firestore,
            'users',
            user.uid,
            'ideas',
            ideaId,
            'workflow',
            'angles',
          );
          const persistedAnglesSnapshot = await getDoc(persistedAnglesRef);

          if (persistedAnglesSnapshot.exists()) {
            const persistedData = persistedAnglesSnapshot.data();
            const restoredAngles = ensureUniqueAngleIds(
              normalizePersistedAnglesPayload(persistedData.angles),
              `${ideaId}-restored`,
            );

            if (restoredAngles.length > 0) {
              const restoredSelectedAngleId = normalizePersistedSelectedAngleId(
                persistedData.selectedAngleId,
                restoredAngles,
              );

              setAngles(restoredAngles);
              setSelectedAngleId(restoredSelectedAngleId);
              setCarouselStartIndex(0);
            }

            if (typeof persistedData.updatedAtMs === 'number' && Number.isFinite(persistedData.updatedAtMs)) {
              setLatestPersistedUpdatedAtMs(persistedData.updatedAtMs);
            }
          }
        } catch (error) {
          console.warn('[Angles Page] Unable to restore persisted angles from Firestore.', error);
        } finally {
          setHasResolvedAnglesRestore(true);
        }

        if (!loadedFromCache) {
          setIsIdeaLoading(false);
        }
      } catch {
        if (!loadedFromCache) {
          setIdea(null);
          setIdeaError('Unable to load the selected idea right now.');
          setIsIdeaLoading(false);
        }
        setHasResolvedAnglesRestore(true);
      }
    });

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [ideaId]);

  useEffect(() => {
    autoGenerationRanForIdeaRef.current = null;
    generationInFlightRef.current = false;

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      if (activeRequestControllerRef.current) {
        activeRequestControllerRef.current.abort();
        activeRequestControllerRef.current = null;
      }

      const currentRunId = activeRunIdRef.current;
      if (currentRunId) {
        const pendingState = readGenerationState();
        if (
          pendingState?.status === 'pending'
          && pendingState.ideaId === ideaId
          && pendingState.ownerId === ANGLES_GENERATION_OWNER_ID
          && pendingState.runId === currentRunId
        ) {
          clearGenerationState();
        }
      }

      activeRunIdRef.current = null;
      generationInFlightRef.current = false;
      manualRegenerateClickGuardRef.current = false;
      setIsGenerating(false);
    };
  }, [ideaId]);

  useEffect(() => {
    if (!idea || !ideaId || !hasResolvedAnglesRestore) {
      return;
    }

    if (autoGenerationRanForIdeaRef.current === idea.id) {
      return;
    }

    if (angles.length > 0) {
      autoGenerationRanForIdeaRef.current = idea.id;
      clearGenerationState();
      return;
    }

    const state = readGenerationState();
    const hasStateForIdea = Boolean(state && state.ideaId === idea.id);
    const isPendingState = Boolean(hasStateForIdea && state?.status === 'pending');
    const isPendingStateFresh = Boolean(isPendingState && Date.now() - (state?.startedAt ?? 0) < GENERATION_STATE_TTL_MS);

    if (hasStateForIdea && state?.status === 'failed') {
      autoGenerationRanForIdeaRef.current = idea.id;
      return;
    }

    if (isPendingState) {
      clearGenerationState();
      if (!isPendingStateFresh) {
        setGenerationError(
          'A previous generation session expired before finishing. Starting a fresh run now.',
        );
      }
    }

    autoGenerationRanForIdeaRef.current = idea.id;

    if (isPendingStateFresh) {
      setGenerationError('Recovered pending generation state from a previous session. Starting a fresh run...');
    }

    void generateAngles({ trigger: 'auto' });
  }, [angles.length, hasResolvedAnglesRestore, idea, ideaId, generateAngles]);

  useEffect(() => {
    if (!currentUser || !idea || angles.length === 0) {
      return;
    }

    void persistAnglesToFirestore(angles, selectedAngleId);
  }, [angles, currentUser, idea, persistAnglesToFirestore, selectedAngleId]);

  useEffect(() => {
    if (!selectedAngleId || angles.length === 0) {
      return;
    }

    const selectedIndex = angles.findIndex((entry) => entry.id === selectedAngleId);
    if (selectedIndex < 0) {
      return;
    }

    if (selectedIndex < carouselStartIndex) {
      setCarouselStartIndex(selectedIndex);
      return;
    }

    if (selectedIndex >= carouselStartIndex + CARDS_PER_VIEW) {
      setCarouselStartIndex(Math.max(0, selectedIndex - (CARDS_PER_VIEW - 1)));
    }
  }, [angles, selectedAngleId, carouselStartIndex]);

  const handleSectionEdit = useCallback((angleId: string, sectionIndex: number, value: string): void => {
    setAngles((previousAngles) =>
      previousAngles.map((entry) => {
        if (entry.id !== angleId) {
          return entry;
        }

        const nextSections = [...entry.sections];
        nextSections[sectionIndex] = value;
        return {
          ...entry,
          sections: nextSections,
        };
      }),
    );
  }, []);

  const handleTitleEdit = useCallback((angleId: string, value: string): void => {
    setAngles((previousAngles) =>
      previousAngles.map((entry) => (entry.id === angleId ? { ...entry, title: value } : entry)),
    );
  }, []);

  const handleSummaryEdit = useCallback((angleId: string, value: string): void => {
    setAngles((previousAngles) =>
      previousAngles.map((entry) => (entry.id === angleId ? { ...entry, summary: value } : entry)),
    );
  }, []);

  const handleAddSectionPoint = useCallback((angleId: string): void => {
    setAngles((previousAngles) =>
      previousAngles.map((entry) =>
        entry.id === angleId
          ? {
              ...entry,
              sections: [...entry.sections, 'New point'],
            }
          : entry,
      ),
    );
  }, []);

  const handleReorderSection = useCallback((angleId: string, fromIndex: number, toIndex: number): void => {
    if (fromIndex === toIndex) {
      return;
    }

    setAngles((previousAngles) =>
      previousAngles.map((entry) => {
        if (entry.id !== angleId) {
          return entry;
        }

        const nextSections = [...entry.sections];
        const [moved] = nextSections.splice(fromIndex, 1);
        nextSections.splice(toIndex, 0, moved);
        return { ...entry, sections: nextSections };
      }),
    );
  }, []);

  const handleRemoveSectionPoint = useCallback((angleId: string, sectionIndex: number): void => {
    setAngles((previousAngles) =>
      previousAngles.map((entry) => {
        if (entry.id !== angleId) {
          return entry;
        }

        if (entry.sections.length <= 1) {
          return entry;
        }

        return {
          ...entry,
          sections: entry.sections.filter((_, index) => index !== sectionIndex),
        };
      }),
    );
  }, []);

  const handleProceedToStoryboard = useCallback((): void => {
    if (!idea || !selectedAngle) {
      setGenerationError('Generate and select an angle before proceeding to storyboard generation.');
      return;
    }

    localStorage.setItem(
      DRAFT_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        ideaId: idea.id,
        angleId: selectedAngle.id,
        selectedAngle,
        idea,
      }),
    );

    router.push(`/storyboard/${encodeURIComponent(idea.id)}?angleId=${encodeURIComponent(selectedAngle.id)}`);
  }, [idea, router, selectedAngle]);

  const handleRegenerateClick = useCallback(async (): Promise<void> => {
    if (manualRegenerateClickGuardRef.current) {
      return;
    }

    // Immediate synchronous guard blocks rapid double-click re-entry before disabled state paints.
    manualRegenerateClickGuardRef.current = true;

    try {
      await generateAngles({ trigger: 'manual' });
    } finally {
      manualRegenerateClickGuardRef.current = false;
    }
  }, [generateAngles]);

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1 space-y-5">
        <div className="page-header">
          <h1>
            Select AI Angles &amp; Outlines for: {idea ? idea.topic : 'Your Selected Idea'}
          </h1>
          <div className="mt-2 flex flex-wrap gap-4 text-sm" style={{ color: '#a7c9be' }}>
            <span>Idea: <span className="font-semibold text-white">{idea?.topic ?? 'Not selected yet'}</span></span>
            <span>Tone: <span className="font-semibold text-white">{idea?.tone ?? '—'}</span></span>
            <span>Audience: <span className="font-semibold text-white">{idea?.audience ?? '—'}</span></span>
            <span>Format: <span className="font-semibold text-white">{idea?.format ?? '—'}</span></span>
            {currentUser?.email ? (
              <span>Signed in as <span className="font-semibold text-white">{currentUser.email}</span></span>
            ) : null}
          </div>
        </div>
        <WorkflowStepper />

        {!ideaId ? (
          <section className="surface-card p-6">
            <h2 className="section-title mb-3">Choose an Idea First</h2>
            <p className="text-sm text-slate-600">
              Open the Ideas page, select an idea, and click Generate Angles to populate this screen.
            </p>
            <button
              type="button"
              className="mt-4 rounded-xl px-5 py-2 text-sm font-bold text-white"
              style={{ background: '#1a7a5e' }}
              onClick={() => router.push('/ideas')}
            >
              Go to Ideas
            </button>
          </section>
        ) : null}

        {isIdeaLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner size="sm" />
            <span>Loading selected idea...</span>
          </div>
        ) : null}
        {ideaError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {ideaError}
          </div>
        ) : null}

        {ideaId && idea && !ideaError ? (
          <>
            <section className="surface-card relative p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="section-title">Generated Angles</h2>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{angles.length} generated</span>
                  <span>•</span>
                  <span>Created {idea.createdAtLabel}</span>
                </div>
              </div>

              <p className="mb-4 text-xs text-slate-500">
                Angles are generated in batches of 2. Regenerate adds 2 more without removing previous results.
              </p>

              {isGenerating ? (
                <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
                  <Spinner size="sm" />
                  <span>Generating AI angles...</span>
                </div>
              ) : null}
              {generationError ? (
                <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {generationError}
                </div>
              ) : null}
              {persistenceError ? (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {persistenceError}
                </div>
              ) : null}

              {!isGenerating && angles.length === 0 ? (
                <p className="text-sm text-slate-500">No generated angles yet. Retry generation to request new outputs.</p>
              ) : null}

              {angles.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {angles.map((card, idx) => {
                    const isSelected = card.id === selectedAngleId;
                    return (
                      <div
                        key={card.id}
                        className={`flex flex-col rounded-2xl border p-4 text-sm shadow-sm ${
                          isSelected ? 'border-emerald-400 bg-emerald-50/70' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                            Angle {idx + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            {isSelected ? (
                              <span className="text-xs font-semibold text-emerald-700">Selected</span>
                            ) : null}
                            <button
                              type="button"
                              aria-label={isSelected ? 'Angle selected' : 'Select this angle'}
                              className={`flex h-6 w-6 items-center justify-center rounded-full text-base leading-none transition ${
                                isSelected
                                  ? 'bg-emerald-600 text-white'
                                  : 'border border-slate-300 text-slate-500 hover:bg-slate-50'
                              }`}
                              onClick={() => {
                                void handleAngleSelection(card.id);
                              }}
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <input
                          className="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm font-semibold leading-snug text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                          value={card.title}
                          onChange={(event) => handleTitleEdit(card.id, event.target.value)}
                        />

                        <textarea
                          className="mt-2 w-full resize-y rounded border border-slate-300 bg-white p-2 text-xs leading-relaxed text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                          rows={3}
                          value={card.summary}
                          onChange={(event) => handleSummaryEdit(card.id, event.target.value)}
                        />

                        <div className="mt-3 space-y-2">
                          {card.sections.map((section, sectionIndex) => {
                            const isDragging =
                              dragState?.angleId === card.id && dragState.sectionIndex === sectionIndex;
                            const isDropTarget =
                              dragState?.angleId === card.id
                              && dragOverIndex === sectionIndex
                              && dragState.sectionIndex !== sectionIndex;

                            return (
                              <div
                                key={`${card.id}-section-${sectionIndex}`}
                                className={`flex items-stretch gap-2 rounded-lg border bg-white transition ${
                                  isDropTarget ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-slate-200'
                                } ${isDragging ? 'opacity-40' : ''}`}
                                onDragOver={(event) => {
                                  if (dragState?.angleId !== card.id) {
                                    return;
                                  }
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = 'move';
                                  if (dragOverIndex !== sectionIndex) {
                                    setDragOverIndex(sectionIndex);
                                  }
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  if (dragState?.angleId !== card.id) {
                                    return;
                                  }
                                  handleReorderSection(card.id, dragState.sectionIndex, sectionIndex);
                                  setDragState(null);
                                  setDragOverIndex(null);
                                }}
                              >
                                <span
                                  aria-hidden
                                  draggable
                                  className="flex cursor-grab select-none items-center px-1.5 text-slate-400 active:cursor-grabbing"
                                  title="Drag to reorder"
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', `${card.id}:${sectionIndex}`);
                                    setDragState({ angleId: card.id, sectionIndex });
                                  }}
                                  onDragEnd={() => {
                                    setDragState(null);
                                    setDragOverIndex(null);
                                  }}
                                >
                                  ⋮⋮
                                </span>
                                <textarea
                                  className="flex-1 resize-y rounded border border-transparent bg-transparent p-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                                  rows={2}
                                  value={section}
                                  onChange={(event) => handleSectionEdit(card.id, sectionIndex, event.target.value)}
                                />
                                <button
                                  type="button"
                                  aria-label="Remove content block"
                                  className="flex items-center justify-center rounded-r-lg px-2 text-lg leading-none text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                  onClick={() => handleRemoveSectionPoint(card.id, sectionIndex)}
                                  disabled={card.sections.length <= 1}
                                >
                                  −
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          className="mt-3 flex items-center gap-1.5 self-start text-xs font-semibold text-slate-600 hover:text-emerald-700"
                          onClick={() => handleAddSectionPoint(card.id)}
                        >
                          <span className="text-base leading-none">+</span>
                          <span>Add content block</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={() => {
                  void handleRegenerateClick();
                }}
                disabled={isGenerating}
              >
                {isGenerating ? <Spinner size="sm" label="Regenerating..." /> : 'Regenerate'}
              </button>
              <button
                type="button"
                className="rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                style={{ background: '#1a7a5e' }}
                onClick={handleProceedToStoryboard}
                disabled={!selectedAngle}
              >
                Proceed to Storyboard
              </button>
            </div>
          </>
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
