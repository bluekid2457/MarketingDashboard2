'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import { getActiveAIKey } from '@/lib/aiConfig';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { Spinner } from '@/components/Spinner';

// ─── Types ───────────────────────────────────────────────────────────────────

type IdeaRecord = {
  id: string;
  topic: string;
  tone: string;
  audience: string;
  format: string;
};

type Angle = {
  id: string;
  title: string;
  summary: string;
  sections: string[];
};

type DraftContext = {
  ideaId: string;
  angleId: string;
  selectedAngle: Angle;
  idea: IdeaRecord;
};

type AdaptDraftContext = DraftContext & {
  draftContent: string;
};

type DraftApiResponse = {
  draft?: string;
  provider?: string;
  promptUsed?: string;
  modelText?: string;
  error?: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatApiResponse = {
  reply?: string;
  updatedDraft?: string | null;
  provider?: string;
  error?: string;
};

type SeoResult = {
  primaryKeyword: string;
  secondaryKeywords: string[];
  keywordDensity: number;
  readabilityScore: number;
  readabilityGrade: string;
  metaDescription: string;
  titleSuggestions: string[];
  optimizationTips: string[];
  similarArticleTopics: string[];
  wordCount: number;
};

type PlagiarismResult = {
  aiLikelihoodScore: number;
  aiLikelihoodLabel: string;
  flaggedPhrases: Array<{ phrase: string; reason: string }>;
  humanizationTips: string[];
  originality: string;
  verdict: string;
};

type SourcesResult = {
  claims: Array<{ claim: string; needsCitation: boolean; suggestedSearchQuery: string }>;
  relevanceScore: number;
  relevanceSummary: string;
  urlsFound: string[];
  recommendations: string[];
};

type AnalyzeType = 'seo' | 'plagiarism' | 'sources';

type AnalyzeApiResponse = {
  type?: AnalyzeType;
  result?: SeoResult | PlagiarismResult | SourcesResult;
  provider?: string;
  error?: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DRAFT_CONTEXT_STORAGE_KEY = 'draft_generation_context';
const ADAPT_CONTEXT_STORAGE_KEY = 'adapt_draft_context';
const SAVE_DEBOUNCE_MS = 2000;

// ─── Component ───────────────────────────────────────────────────────────────

export default function DraftEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const angleIdFromQuery = useMemo(() => searchParams.get('angleId')?.trim() ?? '', [searchParams]);
  const ideaId = useMemo(() => (typeof params?.id === 'string' ? params.id : ''), [params]);

  // Auth
  const [currentUid, setCurrentUid] = useState<string | null>(null);

  // Draft context (from localStorage)
  const [draftContext, setDraftContext] = useState<DraftContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  // Draft content
  const [draftText, setDraftText] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [lastProvider, setLastProvider] = useState<string | null>(null);

  // Firebase save/load
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [firebaseLoaded, setFirebaseLoaded] = useState(false);
  const [isFirebaseDraftLoading, setIsFirebaseDraftLoading] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSaveRef = useRef(true);

  // AI Chat
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [pendingDraftUpdate, setPendingDraftUpdate] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Analysis
  const [activeAnalysis, setActiveAnalysis] = useState<AnalyzeType | null>(null);
  const [seoResult, setSeoResult] = useState<SeoResult | null>(null);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismResult | null>(null);
  const [sourcesResult, setSourcesResult] = useState<SourcesResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // ── Watch auth state ────────────────────────────────────────────────────────
  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
    });
    return unsub;
  }, []);

  // ── Load draft context from localStorage ───────────────────────────────────
  useEffect(() => {
    const rawContext = localStorage.getItem(DRAFT_CONTEXT_STORAGE_KEY);
    if (!rawContext) {
      setContextError('No draft context was found. Generate and select an angle first.');
      return;
    }

    try {
      const parsed = JSON.parse(rawContext) as DraftContext;
      if (!parsed.ideaId || !parsed.selectedAngle || !parsed.idea) {
        setContextError('Draft context is incomplete. Please return to angles and try again.');
        return;
      }

      if (ideaId && parsed.ideaId !== ideaId) {
        setContextError('Draft context does not match this idea. Please regenerate from Angles.');
        return;
      }

      if (angleIdFromQuery && parsed.angleId !== angleIdFromQuery) {
        setContextError(
          'Draft context does not match the selected angle. Please regenerate from Angles.',
        );
        return;
      }

      setDraftContext(parsed);
      setContextError(null);
    } catch {
      setContextError('Draft context is invalid. Please return to angles and generate again.');
    }
  }, [angleIdFromQuery, ideaId]);

  // ── Load existing draft from Firestore ─────────────────────────────────────
  useEffect(() => {
    if (!currentUid || !draftContext || firebaseLoaded) return;

    const db = getFirebaseDb();
    if (!db) {
      setIsFirebaseDraftLoading(false);
      setFirebaseLoaded(true);
      return;
    }

    const docId = `${draftContext.ideaId}_${draftContext.angleId}`;
    const docRef = doc(db, 'users', currentUid, 'drafts', docId);
    setIsFirebaseDraftLoading(true);

    void (async () => {
      try {
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (typeof data.content === 'string' && data.content.trim()) {
            setDraftText(data.content);
            const ts = data.updatedAt as { toDate?: () => Date } | null;
            setSavedAt(ts?.toDate?.() ?? null);
            isFirstSaveRef.current = false;
          }
        }
      } catch (err) {
        console.warn('[Draft] Failed to load draft from Firestore:', err);
      } finally {
        setIsFirebaseDraftLoading(false);
        setFirebaseLoaded(true);
      }
    })();
  }, [currentUid, draftContext, firebaseLoaded]);

  // ── Save draft to Firestore ─────────────────────────────────────────────────
  const saveDraft = useCallback(
    async (content: string): Promise<void> => {
      if (!currentUid || !draftContext) return;

      const db = getFirebaseDb();
      if (!db) {
        setSaveError('Firebase not available. Draft not saved to cloud.');
        return;
      }

      setIsSaving(true);
      setSaveError(null);

      try {
        const docId = `${draftContext.ideaId}_${draftContext.angleId}`;
        const docRef = doc(db, 'users', currentUid, 'drafts', docId);

        const updateData: Record<string, unknown> = {
          content,
          ideaId: draftContext.ideaId,
          angleId: draftContext.angleId,
          ideaTopic: draftContext.idea.topic,
          angleTitle: draftContext.selectedAngle.title,
          status: 'draft',
          updatedAt: serverTimestamp(),
        };

        if (isFirstSaveRef.current) {
          updateData.createdAt = serverTimestamp();
          isFirstSaveRef.current = false;
        }

        await setDoc(docRef, updateData, { merge: true });
        setSavedAt(new Date());
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save draft.');
      } finally {
        setIsSaving(false);
      }
    },
    [currentUid, draftContext],
  );

  // ── Debounced auto-save ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!draftText || !firebaseLoaded) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveDraft(draftText);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draftText, firebaseLoaded, saveDraft]);

  // ── Generate draft via AI ──────────────────────────────────────────────────
  const generateDraft = useCallback(async (): Promise<void> => {
    if (!draftContext) return;

    const activeConfig = getActiveAIKey();

    if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
      setDraftError('No AI API key found. Add a key in Settings before generating drafts.');
      return;
    }

    if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
      setDraftError('No Ollama model set. Add an Ollama model in Settings before generating drafts.');
      return;
    }

    setDraftError(null);
    setIsGeneratingDraft(true);

    try {
      const requestBody = {
        provider: activeConfig.provider,
        apiKey: activeConfig.apiKey,
        ollamaBaseUrl: activeConfig.ollamaBaseUrl,
        ollamaModel: activeConfig.ollamaModel,
        idea: {
          topic: draftContext.idea.topic,
          tone: draftContext.idea.tone,
          audience: draftContext.idea.audience,
          format: draftContext.idea.format,
        },
        angle: draftContext.selectedAngle,
      };

      console.log('[Draft Editor] Sending AI request to /api/drafts', {
        provider: requestBody.provider,
        topic: requestBody.idea.topic,
        tone: requestBody.idea.tone,
        audience: requestBody.idea.audience,
        format: requestBody.idea.format,
        angleId: requestBody.angle.id,
        angleTitle: requestBody.angle.title,
      });

      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const payload = (await response.json()) as DraftApiResponse;

      if (payload.promptUsed) {
        console.log('[Draft Editor] API response payload prompt metadata (promptUsed):', payload.promptUsed);
      }

      if (payload.modelText) {
        console.log('[Draft Editor] API response payload model response (modelText):', payload.modelText);
      }

      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? 'Draft generation failed.');
      }

      setDraftText(payload.draft);
      setLastProvider(payload.provider ?? activeConfig.provider);
    } catch (error) {
      setDraftError(
        error instanceof Error ? error.message : 'Unable to generate draft right now.',
      );
    } finally {
      setIsGeneratingDraft(false);
    }
  }, [draftContext]);

  // ── Auto-generate when no saved draft ─────────────────────────────────────
  useEffect(() => {
    if (!draftContext || !firebaseLoaded || draftText || isGeneratingDraft) return;
    void generateDraft();
  }, [draftContext, firebaseLoaded, draftText, isGeneratingDraft, generateDraft]);

  // ── Scroll chat to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── AI Chat ────────────────────────────────────────────────────────────────
  const sendChatMessage = useCallback(async (): Promise<void> => {
    const message = chatInput.trim();
    if (!message || isChatLoading) return;

    const activeConfig = getActiveAIKey();

    if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
      setChatError('No AI API key found. Add a key in Settings.');
      return;
    }

    setChatError(null);
    setChatInput('');

    const historySnapshot = [...chatMessages];
    setChatMessages((prev) => [...prev, { role: 'user', content: message }]);
    setIsChatLoading(true);

    try {
      const requestBody = {
        provider: activeConfig.provider,
        apiKey: activeConfig.apiKey,
        ollamaBaseUrl: activeConfig.ollamaBaseUrl,
        ollamaModel: activeConfig.ollamaModel,
        draft: draftText,
        messages: historySnapshot,
        userMessage: message,
      };

      console.log('[Draft Editor] Sending AI request to /api/drafts/chat', {
        provider: requestBody.provider,
        draftLength: requestBody.draft.length,
        historyCount: requestBody.messages.length,
        userMessageLength: requestBody.userMessage.length,
      });

      const response = await fetch('/api/drafts/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const payload = (await response.json()) as ChatApiResponse;

      if (!response.ok || !payload.reply) {
        throw new Error(payload.error ?? 'Chat failed.');
      }

      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: payload.reply as string },
      ]);

      if (payload.updatedDraft) {
        setPendingDraftUpdate(payload.updatedDraft);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Chat request failed.');
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, chatMessages, draftText, isChatLoading]);

  // ── Content Analysis ───────────────────────────────────────────────────────
  const runAnalysis = useCallback(
    async (type: AnalyzeType): Promise<void> => {
      if (!draftText.trim()) {
        setAnalyzeError('Please write or generate a draft before running analysis.');
        return;
      }

      const activeConfig = getActiveAIKey();

      if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
        setAnalyzeError('No AI API key found. Add a key in Settings.');
        return;
      }

      setActiveAnalysis(type);
      setIsAnalyzing(true);
      setAnalyzeError(null);

      try {
        const requestBody = {
          provider: activeConfig.provider,
          apiKey: activeConfig.apiKey,
          ollamaBaseUrl: activeConfig.ollamaBaseUrl,
          ollamaModel: activeConfig.ollamaModel,
          draft: draftText,
          type,
        };

        console.log('[Draft Editor] Sending AI request to /api/drafts/analyze', {
          provider: requestBody.provider,
          type: requestBody.type,
          draftLength: requestBody.draft.length,
        });

        const response = await fetch('/api/drafts/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        const payload = (await response.json()) as AnalyzeApiResponse;

        if (!response.ok || !payload.result) {
          throw new Error(payload.error ?? 'Analysis failed.');
        }

        if (type === 'seo') setSeoResult(payload.result as SeoResult);
        if (type === 'plagiarism') setPlagiarismResult(payload.result as PlagiarismResult);
        if (type === 'sources') setSourcesResult(payload.result as SourcesResult);
      } catch (err) {
        setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed.');
      } finally {
        setIsAnalyzing(false);
      }
    },
    [draftText],
  );

  // ── Derived values ─────────────────────────────────────────────────────────
  const wordCount = useMemo(
    () => (draftText.trim() ? draftText.trim().split(/\s+/).length : 0),
    [draftText],
  );

  const savedAtText = useMemo(
    () => savedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? null,
    [savedAt],
  );

  const canAdaptDraft = Boolean(draftContext && draftText.trim());

  const goToAdaptPage = useCallback(() => {
    if (!draftContext || !draftText.trim()) return;

    const adaptContext: AdaptDraftContext = {
      ideaId: draftContext.ideaId,
      angleId: draftContext.angleId,
      idea: draftContext.idea,
      selectedAngle: draftContext.selectedAngle,
      draftContent: draftText,
    };

    localStorage.setItem(ADAPT_CONTEXT_STORAGE_KEY, JSON.stringify(adaptContext));
    router.push(`/adapt/${draftContext.ideaId}?angleId=${draftContext.angleId}`);
  }, [draftContext, draftText, router]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="page-header">
        <h1>Draft Editor</h1>
        <p className="breadcrumb mt-1">
          1. Drafting → Editing (Active) → SEO/Readability → Multi-Channel Adaptation → Review → Schedule
        </p>

        {draftContext ? (
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm" style={{ color: '#a7c9be' }}>
            <span>
              Idea:{' '}
              <span className="font-semibold text-white">{draftContext.idea.topic}</span>
            </span>
            <span>
              Angle:{' '}
              <span className="font-semibold text-white">{draftContext.selectedAngle.title}</span>
            </span>
            {lastProvider ? (
              <span>
                Generated by:{' '}
                <span className="font-semibold text-white">{lastProvider}</span>
              </span>
            ) : null}
            {isSaving ? (
              <span className="text-yellow-300">
                <Spinner size="sm" label="Saving..." />
              </span>
            ) : savedAt ? (
              <span className="text-green-300">✓ Saved at {savedAtText}</span>
            ) : null}
            {saveError ? <span className="text-red-400">{saveError}</span> : null}
          </div>
        ) : null}
      </div>

      {/* ── Context Error ── */}
      {contextError ? (
        <section className="surface-card p-5">
          <p className="text-sm text-red-700">{contextError}</p>
          <button
            type="button"
            className="mt-4 rounded-xl px-5 py-2 text-sm font-bold text-white"
            style={{ background: '#1a7a5e' }}
            onClick={() => router.push('/angles')}
          >
            Back to Angles
          </button>
        </section>
      ) : null}

      {!contextError ? (
        <>
          {/* ── Editor + Chat Layout ── */}
          <div className={`flex gap-4 ${isChatOpen ? 'flex-col lg:flex-row' : ''}`}>
            {/* Editor column */}
            <div className={`min-w-0 space-y-4 ${isChatOpen ? 'lg:flex-[3]' : 'flex-1'}`}>
              <section className="surface-card p-5">
                {/* Editor toolbar */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="section-title">Draft Content</h2>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs text-slate-600">
                      {wordCount} words
                    </span>

                    <button
                      type="button"
                      className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      disabled={isGeneratingDraft || !draftContext}
                      onClick={() => void generateDraft()}
                    >
                      {isGeneratingDraft ? <Spinner size="sm" label="Generating…" /> : '↺ Regenerate'}
                    </button>

                    <button
                      type="button"
                      className={`rounded-xl border px-4 py-2 text-xs font-semibold transition-colors ${
                        isChatOpen
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                      onClick={() => setIsChatOpen((prev) => !prev)}
                    >
                      {isChatOpen ? '✕ Close Chat' : '🤖 AI Chat'}
                    </button>
                  </div>
                </div>

                {/* Draft error */}
                {draftError ? (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {draftError}
                  </div>
                ) : null}

                {/* Generating placeholder */}
                {isGeneratingDraft && !draftText ? (
                  <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
                    <Spinner size="md" />
                    <span>Generating a robust draft from the selected angle…</span>
                  </div>
                ) : null}

                {isFirebaseDraftLoading ? (
                  <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
                    <Spinner size="sm" />
                    <span>Loading draft from Firebase...</span>
                  </div>
                ) : null}

                {/* Main textarea */}
                <textarea
                  className="min-h-[480px] w-full resize-y rounded-xl border border-slate-300 p-4 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Your generated draft will appear here. You can also type or paste content directly."
                />
              </section>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  disabled={isSaving || !draftText}
                  onClick={() => void saveDraft(draftText)}
                >
                  {isSaving ? <Spinner size="sm" label="Saving..." /> : '💾 Save Draft'}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  disabled={!canAdaptDraft}
                  onClick={goToAdaptPage}
                >
                  🎯 Adapt for Platforms
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Submit for Review
                </button>
                <button
                  type="button"
                  className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
                  style={{ background: '#1a7a5e' }}
                >
                  Schedule Post
                </button>
              </div>
            </div>

            {/* ── AI Chat Panel ── */}
            {isChatOpen ? (
              <div className="lg:w-[380px] lg:flex-shrink-0">
                <section
                  className="surface-card flex flex-col p-5"
                  style={{ minHeight: '560px', maxHeight: '80vh' }}
                >
                  <h2 className="section-title mb-1">AI Writing Assistant</h2>
                  <p className="mb-3 text-xs text-slate-500">
                    Ask the AI to improve, shorten, rewrite, or refine any part of your draft.
                  </p>

                  {/* Message history */}
                  <div
                    className="mb-3 flex-1 space-y-3 overflow-y-auto pr-1"
                    style={{ maxHeight: '360px' }}
                  >
                    {chatMessages.length === 0 ? (
                      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                        <p className="mb-1 font-semibold">Try asking:</p>
                        <ul className="list-inside list-disc space-y-1">
                          <li>&ldquo;Make the intro more engaging&rdquo;</li>
                          <li>&ldquo;Shorten this to 800 words&rdquo;</li>
                          <li>&ldquo;Add a more persuasive CTA&rdquo;</li>
                          <li>&ldquo;Rewrite in a casual tone&rdquo;</li>
                          <li>&ldquo;Add 3 concrete examples&rdquo;</li>
                        </ul>
                      </div>
                    ) : null}

                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`rounded-xl p-3 text-sm ${
                          msg.role === 'user'
                            ? 'ml-4 bg-emerald-50 text-emerald-900'
                            : 'mr-4 border border-slate-200 bg-white text-slate-800'
                        }`}
                      >
                        <span className="mb-1 block text-xs font-bold uppercase tracking-wide opacity-50">
                          {msg.role === 'user' ? 'You' : 'AI'}
                        </span>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))}

                    {isChatLoading ? (
                      <div className="mr-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-400">
                        <Spinner size="sm" label="AI is thinking…" />
                      </div>
                    ) : null}

                    <div ref={chatEndRef} />
                  </div>

                  {/* Pending draft update banner */}
                  {pendingDraftUpdate ? (
                    <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
                      <p className="mb-2 font-semibold text-emerald-700">
                        AI has suggested changes to your draft.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                          style={{ background: '#1a7a5e' }}
                          onClick={() => {
                            setDraftText(pendingDraftUpdate);
                            setPendingDraftUpdate(null);
                          }}
                        >
                          Apply Changes
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600"
                          onClick={() => setPendingDraftUpdate(null)}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Chat error */}
                  {chatError ? (
                    <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {chatError}
                    </div>
                  ) : null}

                  {/* Chat input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                      placeholder="Ask AI to edit your draft…"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void sendChatMessage();
                        }
                      }}
                      disabled={isChatLoading}
                    />
                    <button
                      type="button"
                      className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                      style={{ background: '#1a7a5e' }}
                      disabled={isChatLoading || !chatInput.trim()}
                      onClick={() => void sendChatMessage()}
                    >
                      Send
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </div>

          {/* ── Content Analysis ── */}
          <section className="surface-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Content Analysis</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  SEO scoring, AI/plagiarism detection, and source relevance check.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { type: 'seo' as AnalyzeType, label: '📈 SEO Optimizer' },
                    { type: 'plagiarism' as AnalyzeType, label: '🔍 Plagiarism / AI Check' },
                    { type: 'sources' as AnalyzeType, label: '🔗 Source Check' },
                  ] as const
                ).map(({ type, label }) => (
                  <button
                    key={type}
                    type="button"
                    className={`rounded-xl border px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                      activeAnalysis === type
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                    disabled={isAnalyzing}
                    onClick={() => void runAnalysis(type)}
                  >
                    {isAnalyzing && activeAnalysis === type ? <Spinner size="sm" label="Analyzing…" /> : label}
                  </button>
                ))}
              </div>
            </div>

            {/* Analysis error */}
            {analyzeError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {analyzeError}
              </div>
            ) : null}

            {/* Loading */}
            {isAnalyzing ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Spinner size="sm" />
                <span>Running analysis, this may take a moment…</span>
              </div>
            ) : null}

            {/* Empty state */}
            {!isAnalyzing && !analyzeError && !activeAnalysis ? (
              <p className="text-sm text-slate-400">
                Select an analysis type above to inspect your draft.
              </p>
            ) : null}

            {/* ── SEO Results ── */}
            {!isAnalyzing && activeAnalysis === 'seo' && seoResult ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-emerald-50 p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-700">{seoResult.readabilityScore}</p>
                    <p className="text-xs text-slate-600">Readability</p>
                    <p className="text-xs font-semibold text-slate-500">{seoResult.readabilityGrade}</p>
                  </div>
                  <div className="rounded-xl bg-blue-50 p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">{seoResult.keywordDensity}%</p>
                    <p className="text-xs text-slate-600">Keyword Density</p>
                  </div>
                  <div className="rounded-xl bg-purple-50 p-3 text-center">
                    <p className="text-2xl font-bold text-purple-700">{seoResult.wordCount}</p>
                    <p className="text-xs text-slate-600">Word Count</p>
                  </div>
                  <div className="rounded-xl bg-orange-50 p-3 text-center">
                    <p className="break-words text-sm font-bold text-orange-700">{seoResult.primaryKeyword}</p>
                    <p className="text-xs text-slate-600">Primary Keyword</p>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-slate-700">Suggested Meta Description</p>
                    <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{seoResult.metaDescription}</p>
                  </div>

                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-slate-700">Secondary Keywords</p>
                    <div className="flex flex-wrap gap-1.5">
                      {seoResult.secondaryKeywords.map((kw, i) => (
                        <span key={i} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-slate-700">Title Suggestions</p>
                    <ul className="space-y-1">
                      {seoResult.titleSuggestions.map((t, i) => (
                        <li key={i} className="text-sm text-slate-600">• {t}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-slate-700">
                      Similar Article Topics People Search (Coverage Gaps)
                    </p>
                    <ul className="space-y-1">
                      {seoResult.similarArticleTopics.map((t, i) => (
                        <li key={i} className="text-sm text-slate-600">• {t}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-sm font-semibold text-slate-700">Optimization Tips</p>
                  <ul className="space-y-1.5">
                    {seoResult.optimizationTips.map((tip, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-600">
                        <span className="text-emerald-600">✓</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {/* ── Plagiarism / AI Check Results ── */}
            {!isAnalyzing && activeAnalysis === 'plagiarism' && plagiarismResult ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div
                    className={`rounded-xl p-3 text-center ${
                      plagiarismResult.aiLikelihoodScore > 70
                        ? 'bg-red-50'
                        : plagiarismResult.aiLikelihoodScore > 40
                          ? 'bg-yellow-50'
                          : 'bg-green-50'
                    }`}
                  >
                    <p
                      className={`text-2xl font-bold ${
                        plagiarismResult.aiLikelihoodScore > 70
                          ? 'text-red-700'
                          : plagiarismResult.aiLikelihoodScore > 40
                            ? 'text-yellow-700'
                            : 'text-green-700'
                      }`}
                    >
                      {plagiarismResult.aiLikelihoodScore}%
                    </p>
                    <p className="text-xs text-slate-600">AI Likelihood</p>
                    <p className="text-xs font-semibold text-slate-500">{plagiarismResult.aiLikelihoodLabel}</p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Verdict</p>
                    <p className="text-sm text-slate-700">{plagiarismResult.verdict}</p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Originality</p>
                    <p className="text-sm text-slate-700">{plagiarismResult.originality}</p>
                  </div>
                </div>

                {plagiarismResult.flaggedPhrases.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-slate-700">Flagged Phrases</p>
                    <div className="space-y-2">
                      {plagiarismResult.flaggedPhrases.map((item, i) => (
                        <div key={i} className="rounded-xl border border-yellow-200 bg-yellow-50 p-3">
                          <p className="text-sm font-medium italic text-slate-800">
                            &ldquo;{item.phrase}&rdquo;
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-green-600">✓ No AI-pattern phrases flagged.</p>
                )}

                <div>
                  <p className="mb-1.5 text-sm font-semibold text-slate-700">Humanization Tips</p>
                  <ul className="space-y-1.5">
                    {plagiarismResult.humanizationTips.map((tip, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-600">
                        <span className="text-blue-500">→</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {/* ── Source Check Results ── */}
            {!isAnalyzing && activeAnalysis === 'sources' && sourcesResult ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div
                    className={`rounded-xl p-3 text-center ${
                      sourcesResult.relevanceScore > 70
                        ? 'bg-green-50'
                        : sourcesResult.relevanceScore > 40
                          ? 'bg-yellow-50'
                          : 'bg-red-50'
                    }`}
                  >
                    <p
                      className={`text-2xl font-bold ${
                        sourcesResult.relevanceScore > 70
                          ? 'text-green-700'
                          : sourcesResult.relevanceScore > 40
                            ? 'text-yellow-700'
                            : 'text-red-700'
                      }`}
                    >
                      {sourcesResult.relevanceScore}%
                    </p>
                    <p className="text-xs text-slate-600">Relevance Score</p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</p>
                    <p className="text-sm text-slate-700">{sourcesResult.relevanceSummary}</p>
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-sm font-semibold text-slate-700">Claims Needing Citations</p>
                  {sourcesResult.claims.filter((c) => c.needsCitation).length === 0 ? (
                    <p className="text-sm text-green-600">✓ All claims appear to be well-supported.</p>
                  ) : (
                    <div className="space-y-2">
                      {sourcesResult.claims
                        .filter((c) => c.needsCitation)
                        .map((item, i) => (
                          <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-sm text-slate-800">&ldquo;{item.claim}&rdquo;</p>
                            <p className="mt-1 text-xs text-emerald-600">
                              🔍 Search: {item.suggestedSearchQuery}
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {sourcesResult.urlsFound.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-slate-700">URLs Found in Draft</p>
                    <ul className="space-y-1">
                      {sourcesResult.urlsFound.map((url, i) => (
                        <li key={i} className="break-all text-sm text-blue-600">{url}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <p className="mb-1.5 text-sm font-semibold text-slate-700">Recommendations</p>
                  <ul className="space-y-1.5">
                    {sourcesResult.recommendations.map((rec, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-600">
                        <span className="text-emerald-600">✓</span>
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
