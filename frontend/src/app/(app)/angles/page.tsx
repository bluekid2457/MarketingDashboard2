'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import { getActiveAIKey } from '@/lib/aiConfig';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';

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
  promptUsed?: string;
  modelText?: string;
  error?: string;
};

const DRAFT_CONTEXT_STORAGE_KEY = 'draft_generation_context';
const CARDS_PER_VIEW = 3;

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
  const ideaId = searchParams.get('ideaId')?.trim() ?? '';

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [idea, setIdea] = useState<IdeaRecord | null>(null);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [isIdeaLoading, setIsIdeaLoading] = useState(false);

  const [angles, setAngles] = useState<Angle[]>([]);
  const [selectedAngleId, setSelectedAngleId] = useState<string | null>(null);
  const [unlockedEditors, setUnlockedEditors] = useState<Record<string, boolean>>({});
  const [carouselStartIndex, setCarouselStartIndex] = useState(0);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);

  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [isTrendsLoading, setIsTrendsLoading] = useState(true);

  const selectedAngle = useMemo(
    () => angles.find((entry) => entry.id === selectedAngleId) ?? null,
    [angles, selectedAngleId],
  );

  const maxCarouselStart = Math.max(angles.length - CARDS_PER_VIEW, 0);
  const visibleAngles = angles.slice(carouselStartIndex, carouselStartIndex + CARDS_PER_VIEW);

  const generateAngles = useCallback(
    async (options?: { refinementPrompt?: string; selectedAngleId?: string; selectedAngle?: Angle | null }): Promise<boolean> => {
      if (!idea) {
        return false;
      }

      const activeConfig = getActiveAIKey();
      if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
        setGenerationError('No AI API key found. Add a key in Settings before generating angles.');
        return false;
      }

      if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
        setGenerationError('No Ollama model set. Add an Ollama model in Settings before generating angles.');
        return false;
      }

      const isRefinementRequest = Boolean(options?.refinementPrompt);
      setGenerationError(null);

      if (isRefinementRequest) {
        setIsRefining(true);
      } else {
        setIsGenerating(true);
      }

      try {
        const response = await fetch('/api/angles', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
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
            count: isRefinementRequest ? 1 : 4,
            selectedAngleId: options?.selectedAngleId,
            refinementPrompt: options?.refinementPrompt,
          }),
        });

        const payload = (await response.json()) as AnglesApiResponse;

        if (payload.promptUsed) {
          console.log(`[Angles Page] Prompt sent to AI (${payload.provider ?? activeConfig.provider}):\n${payload.promptUsed}`);
        }
        if (payload.modelText) {
          console.log(`[Angles Page] Response returned by AI (${payload.provider ?? activeConfig.provider}):\n${payload.modelText}`);
        }

        if (!response.ok) {
          throw new Error(payload.error || 'AI generation failed.');
        }

        if (!payload.angles || payload.angles.length === 0) {
          throw new Error('AI returned no usable angles. Try again.');
        }

        if (isRefinementRequest) {
          const refinedAngle = payload.angles[0];
          const targetId = options?.selectedAngleId;

          setAngles((previousAngles) => {
            if (!targetId) {
              return previousAngles;
            }

            return previousAngles.map((entry) => (entry.id === targetId ? { ...refinedAngle, id: targetId } : entry));
          });

          if (targetId) {
            setSelectedAngleId(targetId);
          }
        } else {
          setAngles(payload.angles);
          setSelectedAngleId(payload.angles[0]?.id ?? null);
          setUnlockedEditors({});
          setCarouselStartIndex(0);
        }

        return true;
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : 'Unable to generate angles right now.');
        return false;
      } finally {
        if (isRefinementRequest) {
          setIsRefining(false);
        } else {
          setIsGenerating(false);
        }
      }
    },
    [idea],
  );

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
      setAngles([]);
      setSelectedAngleId(null);
      setUnlockedEditors({});
      setChatHistory([]);
      return;
    }

    const firebaseAuth = getFirebaseAuth();
    const firestore = getFirebaseDb();

    if (!firebaseAuth || !firestore) {
      setIdeaError('Angles are unavailable until Firebase is configured for this app.');
      setIsIdeaLoading(false);
      return;
    }

    setIsIdeaLoading(true);
    setIdeaError(null);
    setAngles([]);
    setSelectedAngleId(null);
    setUnlockedEditors({});
    setChatHistory([]);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      setCurrentUser(user);

      if (!user) {
        setIdea(null);
        setIdeaError('Sign in first, then choose an idea from the Ideas page.');
        setIsIdeaLoading(false);
        return;
      }

      try {
        const ideaRef = doc(firestore, 'users', user.uid, 'ideas', ideaId);
        const snapshot = await getDoc(ideaRef);

        if (!snapshot.exists()) {
          setIdea(null);
          setIdeaError('That idea could not be found. Pick an idea from the Ideas page and try again.');
          setIsIdeaLoading(false);
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
      } catch {
        setIdea(null);
        setIdeaError('Unable to load the selected idea right now.');
      } finally {
        setIsIdeaLoading(false);
      }
    });

    return () => unsubscribe();
  }, [ideaId]);

  useEffect(() => {
    if (!idea || !ideaId) {
      return;
    }

    void generateAngles();
  }, [idea, ideaId, generateAngles]);

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

  const handleRefineSubmit = useCallback(async (): Promise<void> => {
    const prompt = refinementPrompt.trim();

    if (!selectedAngleId || !selectedAngle) {
      setGenerationError('Select an angle before sending a refinement prompt.');
      return;
    }

    if (!prompt) {
      setGenerationError('Enter a refinement prompt first.');
      return;
    }

    setChatHistory((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        role: 'user',
        message: prompt,
      },
    ]);

    const success = await generateAngles({
      selectedAngleId,
      refinementPrompt: prompt,
      selectedAngle,
    });

    if (success) {
      setChatHistory((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          message: `Updated "${selectedAngle.title}" based on your refinement request.`,
        },
      ]);
      setRefinementPrompt('');
    }
  }, [generateAngles, refinementPrompt, selectedAngle, selectedAngleId]);

  const handleProceedToDraft = useCallback((): void => {
    if (!idea || !selectedAngle) {
      setGenerationError('Generate and select an angle before proceeding to draft generation.');
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

    router.push(`/drafts/${encodeURIComponent(idea.id)}?angleId=${encodeURIComponent(selectedAngle.id)}`);
  }, [idea, router, selectedAngle]);

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

        {isIdeaLoading ? <p className="text-sm text-slate-500">Loading selected idea...</p> : null}
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

              {isGenerating ? <p className="mb-3 text-sm text-slate-500">Generating AI angles...</p> : null}
              {generationError ? (
                <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {generationError}
                </div>
              ) : null}

              {!isGenerating && angles.length === 0 ? (
                <p className="text-sm text-slate-500">No generated angles yet. Retry generation to request new outputs.</p>
              ) : null}

              {angles.length > 0 ? (
                <div className="flex items-start gap-3 overflow-x-auto pb-2">
                  <button
                    type="button"
                    className="mt-8 shrink-0 rounded-full border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => setCarouselStartIndex((value) => Math.max(0, value - 1))}
                    disabled={carouselStartIndex === 0}
                  >
                    ‹
                  </button>

                  {visibleAngles.map((card) => {
                    const isSelected = card.id === selectedAngleId;
                    const isEditorUnlocked = Boolean(unlockedEditors[card.id]);

                    return (
                      <div
                        key={card.id}
                        className={`min-w-[260px] flex-shrink-0 rounded-xl border p-4 text-sm ${
                          isSelected ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          {isEditorUnlocked ? (
                            <input
                              className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-semibold leading-snug text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                              value={card.title}
                              onChange={(event) => handleTitleEdit(card.id, event.target.value)}
                            />
                          ) : (
                            <p className="font-semibold leading-snug text-slate-800">{card.title}</p>
                          )}
                          {isSelected ? <span className="text-emerald-600">✓</span> : null}
                        </div>

                        <div className="mt-2">
                          {isEditorUnlocked ? (
                            <textarea
                              className="w-full resize-y rounded border border-slate-300 p-2 text-xs leading-relaxed text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                              rows={3}
                              value={card.summary}
                              onChange={(event) => handleSummaryEdit(card.id, event.target.value)}
                            />
                          ) : (
                            <p className="text-xs leading-relaxed text-slate-600 whitespace-pre-line">{card.summary}</p>
                          )}
                        </div>

                        <div className="mt-3 space-y-2">
                          {card.sections.map((section, sectionIndex) => (
                            <div key={`${card.id}-section-${sectionIndex}`} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
                              {isEditorUnlocked ? (
                                <div className="space-y-2">
                                  <textarea
                                    className="w-full resize-y rounded border border-slate-300 p-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                                    rows={2}
                                    value={section}
                                    onChange={(event) => handleSectionEdit(card.id, sectionIndex, event.target.value)}
                                  />
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                      onClick={() => handleRemoveSectionPoint(card.id, sectionIndex)}
                                      disabled={card.sections.length <= 1}
                                    >
                                      Remove Point
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-700">{section}</span>
                              )}
                            </div>
                          ))}
                        </div>

                        {isEditorUnlocked ? (
                          <button
                            type="button"
                            className="mt-2 w-full rounded border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => handleAddSectionPoint(card.id)}
                          >
                            Add Point
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="mt-3 w-full rounded-xl py-2 text-xs font-bold text-white"
                          style={{ background: '#1a7a5e' }}
                          onClick={() =>
                            setUnlockedEditors((previous) => ({
                              ...previous,
                              [card.id]: !previous[card.id],
                            }))
                          }
                        >
                          {isEditorUnlocked ? 'Lock Detailed Editor' : 'Unlock Detailed Editor'}
                        </button>

                        <div className="mt-3 flex items-center gap-2 text-xs">
                          <input
                            id={`angle-${card.id}`}
                            type="radio"
                            name="angle"
                            checked={isSelected}
                            onChange={() => setSelectedAngleId(card.id)}
                            className="accent-emerald-600"
                          />
                          <label htmlFor={`angle-${card.id}`} className="text-slate-600">Select This Angle</label>
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    className="mt-8 shrink-0 rounded-full border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => setCarouselStartIndex((value) => Math.min(maxCarouselStart, value + 1))}
                    disabled={carouselStartIndex >= maxCarouselStart}
                  >
                    ›
                  </button>
                </div>
              ) : null}
            </section>

            <section className="surface-card p-5">
              <h2 className="section-title mb-3">Refine with AI Chat</h2>
              <div className="flex flex-col gap-4 xl:flex-row">
                <div className="min-h-[120px] flex-1 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  {chatHistory.length === 0 ? (
                    <p className="text-slate-500">No chat yet. Select an angle and ask AI to refine it.</p>
                  ) : null}
                  {chatHistory.map((entry) => (
                    <div key={entry.id} className="flex gap-2">
                      <span className="shrink-0 font-bold text-slate-400">{entry.role === 'assistant' ? 'AI' : 'You'}</span>
                      <p className="text-slate-700">{entry.message}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-1 flex-col gap-2">
                  <textarea
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    rows={3}
                    value={refinementPrompt}
                    onChange={(event) => setRefinementPrompt(event.target.value)}
                    placeholder='Chat with AI to refine the selected angle... e.g., "Make the tools section more tactical and add a mini case study."'
                    disabled={isRefining}
                  />
                  <p className="text-xs text-slate-500">
                    Selected Outline: {selectedAngle ? selectedAngle.title : 'None selected'}.
                  </p>
                </div>

                <button
                  type="button"
                  className="self-start rounded-xl px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
                  style={{ background: '#1a7a5e' }}
                  onClick={() => {
                    void handleRefineSubmit();
                  }}
                  disabled={isRefining || isGenerating || !selectedAngleId}
                >
                  {isRefining ? 'Refining...' : 'Send Prompt'}
                </button>
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={() => {
                  void generateAngles();
                }}
                disabled={isGenerating || isRefining}
              >
                {isGenerating ? 'Regenerating...' : 'Retry AI Generation'}
              </button>
              <button
                type="button"
                className="rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                style={{ background: '#1a7a5e' }}
                onClick={handleProceedToDraft}
                disabled={!selectedAngle}
              >
                Proceed to Draft Generation
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
