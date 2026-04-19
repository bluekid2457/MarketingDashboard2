'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import { Spinner } from '@/components/Spinner';
import { getActiveAIKey } from '@/lib/aiConfig';
import {
  ADAPT_CLIENT_TIMEOUT_MS,
  buildAdaptGenerationTimeoutMessage,
  isAbortLikeError,
} from '@/lib/adaptTimeout';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';

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

type AdaptDraftContext = {
  ideaId: string;
  angleId: string;
  idea: IdeaRecord;
  selectedAngle: Angle;
  draftContent: string;
};

type PlatformKey = 'linkedin' | 'twitter' | 'medium' | 'newsletter' | 'blog';
type PlatformContent = Record<PlatformKey, string>;

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

type AdaptGenerateApiResponse = {
  generatedContent?: string;
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

type AiCheckResult = {
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
  result?: SeoResult | AiCheckResult | SourcesResult;
  provider?: string;
  error?: string;
};

type PlatformAnalysis = {
  seo?: SeoResult;
  plagiarism?: AiCheckResult;
  sources?: SourcesResult;
};

type TrendsApiResponse = {
  topics?: Array<{ label: string; count: number }>;
  articles?: Array<{ title: string; url: string; source: string; publishedAt: string }>;
  fetchedAt?: string;
  error?: string;
};

const ADAPT_CONTEXT_STORAGE_KEY = 'adapt_draft_context';
const SAVE_DEBOUNCE_MS = 1500;
const ADAPT_GENERATION_TIMEOUT_MS = ADAPT_CLIENT_TIMEOUT_MS;
const ADAPT_GENERATION_TIMEOUT_MESSAGE = buildAdaptGenerationTimeoutMessage();
const PLATFORM_CONFIG: Array<{
  key: PlatformKey;
  label: string;
  shortLabel: string;
  accentClass: string;
  icon: string;
}> = [
  { key: 'linkedin', label: 'LinkedIn', shortLabel: 'in', accentClass: 'bg-blue-700', icon: 'in' },
  { key: 'twitter', label: 'X / Twitter', shortLabel: 'X', accentClass: 'bg-slate-900', icon: 'X' },
  { key: 'medium', label: 'Medium', shortLabel: 'M', accentClass: 'bg-emerald-700', icon: 'M' },
  { key: 'newsletter', label: 'Newsletter', shortLabel: 'NL', accentClass: 'bg-amber-600', icon: '✉' },
  { key: 'blog', label: 'Blog', shortLabel: 'Blog', accentClass: 'bg-violet-700', icon: '✎' },
];

function createSeededPlatforms(seedText: string): PlatformContent {
  return {
    linkedin: seedText,
    twitter: seedText,
    medium: seedText,
    newsletter: seedText,
    blog: seedText,
  };
}

function createEmptyChatRecord(): Record<PlatformKey, ChatMessage[]> {
  return {
    linkedin: [],
    twitter: [],
    medium: [],
    newsletter: [],
    blog: [],
  };
}

function createEmptyPendingRecord(): Record<PlatformKey, string | null> {
  return {
    linkedin: null,
    twitter: null,
    medium: null,
    newsletter: null,
    blog: null,
  };
}

function createEmptyAnalysisRecord(): Record<PlatformKey, PlatformAnalysis> {
  return {
    linkedin: {},
    twitter: {},
    medium: {},
    newsletter: {},
    blog: {},
  };
}

function createEmptyActiveAnalysisRecord(): Record<PlatformKey, AnalyzeType | null> {
  return {
    linkedin: null,
    twitter: null,
    medium: null,
    newsletter: null,
    blog: null,
  };
}

function createEmptyStatusRecord(): Record<PlatformKey, string | null> {
  return {
    linkedin: null,
    twitter: null,
    medium: null,
    newsletter: null,
    blog: null,
  };
}

function isPlatformKey(value: string): value is PlatformKey {
  return PLATFORM_CONFIG.some((platform) => platform.key === value);
}

function serializeAdaptation(platforms: PlatformContent, activePlatform: PlatformKey): string {
  return JSON.stringify({ platforms, activePlatform });
}

export default function AdaptPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ideaId = useMemo(() => (typeof params?.id === 'string' ? params.id : ''), [params]);
  const angleIdFromQuery = useMemo(() => searchParams.get('angleId')?.trim() ?? '', [searchParams]);

  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [adaptContext, setAdaptContext] = useState<AdaptDraftContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  const [platforms, setPlatforms] = useState<PlatformContent>(() => createSeededPlatforms(''));
  const [activePlatform, setActivePlatform] = useState<PlatformKey>('linkedin');

  const [isAdaptationLoading, setIsAdaptationLoading] = useState(false);
  const [isGeneratingPlatform, setIsGeneratingPlatform] = useState<PlatformKey | null>(null);
  const [generateErrorByPlatform, setGenerateErrorByPlatform] =
    useState<Record<PlatformKey, string | null>>(createEmptyStatusRecord);
  const [generateSuccessByPlatform, setGenerateSuccessByPlatform] =
    useState<Record<PlatformKey, string | null>>(createEmptyStatusRecord);
  const [firebaseLoaded, setFirebaseLoaded] = useState(false);
  const [hasExistingAdaptation, setHasExistingAdaptation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [chatHistoryByPlatform, setChatHistoryByPlatform] =
    useState<Record<PlatformKey, ChatMessage[]>>(createEmptyChatRecord);
  const [pendingDraftUpdateByPlatform, setPendingDraftUpdateByPlatform] =
    useState<Record<PlatformKey, string | null>>(createEmptyPendingRecord);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [analysisByPlatform, setAnalysisByPlatform] =
    useState<Record<PlatformKey, PlatformAnalysis>>(createEmptyAnalysisRecord);
  const [activeAnalysisByPlatform, setActiveAnalysisByPlatform] =
    useState<Record<PlatformKey, AnalyzeType | null>>(createEmptyActiveAnalysisRecord);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [trendTopics, setTrendTopics] = useState<Array<{ label: string; count: number }>>([]);
  const [trendArticles, setTrendArticles] = useState<
    Array<{ title: string; url: string; source: string; publishedAt: string }>
  >([]);
  const [isTrendsLoading, setIsTrendsLoading] = useState(true);
  const [trendsError, setTrendsError] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!ideaId) {
      setAdaptContext(null);
      setContextError('No idea was provided for this adaptation workflow.');
      return;
    }

    if (!angleIdFromQuery) {
      setAdaptContext(null);
      setContextError('No angle was provided. Return to the Draft Editor and reopen adaptation.');
      return;
    }

    const rawContext = localStorage.getItem(ADAPT_CONTEXT_STORAGE_KEY);
    if (!rawContext) {
      setAdaptContext(null);
      setContextError('No draft adaptation context was found. Return to the Draft Editor first.');
      return;
    }

    try {
      const parsed = JSON.parse(rawContext) as AdaptDraftContext;
      const draftContent = typeof parsed.draftContent === 'string' ? parsed.draftContent : '';

      if (!parsed.ideaId || !parsed.angleId || !parsed.idea || !parsed.selectedAngle || !draftContent.trim()) {
        setAdaptContext(null);
        setContextError('Adaptation context is incomplete. Return to the Draft Editor and try again.');
        return;
      }

      if (parsed.ideaId !== ideaId || parsed.angleId !== angleIdFromQuery) {
        setAdaptContext(null);
        setContextError('Adaptation context does not match this route. Reopen adaptation from the Draft Editor.');
        return;
      }

      setAdaptContext(parsed);
      setPlatforms(createSeededPlatforms(draftContent));
      setActivePlatform('linkedin');
      setAnalysisByPlatform(createEmptyAnalysisRecord());
      setActiveAnalysisByPlatform(createEmptyActiveAnalysisRecord());
      setContextError(null);
      setFirebaseLoaded(false);
      setHasExistingAdaptation(false);
      setSavedAt(null);
      lastSavedSignatureRef.current = null;
    } catch {
      setAdaptContext(null);
      setContextError('Adaptation context is invalid. Return to the Draft Editor and try again.');
    }
  }, [angleIdFromQuery, ideaId]);

  useEffect(() => {
    if (!currentUid || !adaptContext || firebaseLoaded) return;

    const db = getFirebaseDb();
    if (!db) {
      setFirebaseLoaded(true);
      return;
    }

    const docId = `${adaptContext.ideaId}_${adaptContext.angleId}`;
    const docRef = doc(db, 'users', currentUid, 'adaptations', docId);
    const seededPlatforms = createSeededPlatforms(adaptContext.draftContent);
    setIsAdaptationLoading(true);

    void (async () => {
      try {
        const snapshot = await getDoc(docRef);

        if (snapshot.exists()) {
          const data = snapshot.data();
          const mergedPlatforms = { ...seededPlatforms };
          const savedPlatforms = data.platforms;

          if (savedPlatforms && typeof savedPlatforms === 'object') {
            for (const platform of PLATFORM_CONFIG) {
              const value = (savedPlatforms as Record<string, unknown>)[platform.key];
              if (typeof value === 'string') {
                mergedPlatforms[platform.key] = value;
              }
            }
          }

          const savedPlatformValue =
            typeof data.activePlatform === 'string' && isPlatformKey(data.activePlatform)
              ? data.activePlatform
              : 'linkedin';

          setPlatforms(mergedPlatforms);
          setActivePlatform(savedPlatformValue);
          setHasExistingAdaptation(true);
          const timestamp = data.updatedAt as { toDate?: () => Date } | null;
          setSavedAt(timestamp?.toDate?.() ?? null);
          lastSavedSignatureRef.current = serializeAdaptation(mergedPlatforms, savedPlatformValue);
        }
      } catch (error) {
        console.warn('[Adapt Page] Failed to load adaptation from Firestore:', error);
      } finally {
        setIsAdaptationLoading(false);
        setFirebaseLoaded(true);
      }
    })();
  }, [adaptContext, currentUid, firebaseLoaded]);

  useEffect(() => {
    setChatInput('');
    setChatError(null);
    setAnalyzeError(null);
  }, [activePlatform]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activePlatform, chatHistoryByPlatform]);

  useEffect(() => {
    let cancelled = false;

    const loadTrends = async (): Promise<void> => {
      setIsTrendsLoading(true);
      setTrendsError(null);

      try {
        const response = await fetch('/api/trends');
        const payload = (await response.json()) as TrendsApiResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? 'Unable to load trend data.');
        }

        if (!cancelled) {
          setTrendTopics(payload.topics ?? []);
          setTrendArticles(payload.articles ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setTrendTopics([]);
          setTrendArticles([]);
          setTrendsError(error instanceof Error ? error.message : 'Unable to load trend data.');
        }
      } finally {
        if (!cancelled) {
          setIsTrendsLoading(false);
        }
      }
    };

    void loadTrends();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveAdaptation = useCallback(
    async (nextPlatforms: PlatformContent, nextActivePlatform: PlatformKey): Promise<void> => {
      if (!currentUid || !adaptContext) return;

      const db = getFirebaseDb();
      if (!db) {
        setSaveError('Firebase is unavailable, so adaptation changes cannot be synced right now.');
        return;
      }

      setIsSaving(true);
      setSaveError(null);

      try {
        const docId = `${adaptContext.ideaId}_${adaptContext.angleId}`;
        const docRef = doc(db, 'users', currentUid, 'adaptations', docId);
        const payload: Record<string, unknown> = {
          ideaId: adaptContext.ideaId,
          angleId: adaptContext.angleId,
          ideaTopic: adaptContext.idea.topic,
          angleTitle: adaptContext.selectedAngle.title,
          platforms: nextPlatforms,
          activePlatform: nextActivePlatform,
          updatedAt: serverTimestamp(),
        };

        if (!hasExistingAdaptation) {
          payload.createdAt = serverTimestamp();
        }

        await setDoc(docRef, payload, { merge: true });
        setHasExistingAdaptation(true);
        setSavedAt(new Date());
        lastSavedSignatureRef.current = serializeAdaptation(nextPlatforms, nextActivePlatform);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Unable to save adaptation.');
      } finally {
        setIsSaving(false);
      }
    },
    [adaptContext, currentUid, hasExistingAdaptation],
  );

  const adaptationSignature = useMemo(
    () => serializeAdaptation(platforms, activePlatform),
    [activePlatform, platforms],
  );

  useEffect(() => {
    if (!firebaseLoaded || !adaptContext || !currentUid) return;
    if (adaptationSignature === lastSavedSignatureRef.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      void saveAdaptation(platforms, activePlatform);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [activePlatform, adaptationSignature, adaptContext, currentUid, firebaseLoaded, platforms, saveAdaptation]);

  const currentPlatformText = platforms[activePlatform] ?? '';
  const currentChatHistory = useMemo(
    () => chatHistoryByPlatform[activePlatform] ?? [],
    [activePlatform, chatHistoryByPlatform],
  );
  const pendingDraftUpdate = pendingDraftUpdateByPlatform[activePlatform];
  const activeGenerateError = generateErrorByPlatform[activePlatform];
  const activeGenerateSuccess = generateSuccessByPlatform[activePlatform];
  const currentAnalysis = analysisByPlatform[activePlatform] ?? {};
  const activeAnalysis = activeAnalysisByPlatform[activePlatform];
  const savedAtText = useMemo(
    () => savedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? null,
    [savedAt],
  );
  const activePlatformConfig =
    PLATFORM_CONFIG.find((platform) => platform.key === activePlatform) ?? PLATFORM_CONFIG[0];
  const currentWordCount = useMemo(
    () => (currentPlatformText.trim() ? currentPlatformText.trim().split(/\s+/).length : 0),
    [currentPlatformText],
  );

  const updateActivePlatformText = useCallback(
    (value: string) => {
      setPlatforms((previous) => ({
        ...previous,
        [activePlatform]: value,
      }));
    },
    [activePlatform],
  );

  const sendChatMessage = useCallback(async (): Promise<void> => {
    const userMessage = chatInput.trim();
    if (!userMessage || isChatLoading) return;

    if (!currentPlatformText.trim()) {
      setChatError('Add platform copy before asking the adaptation assistant for edits.');
      return;
    }

    const activeConfig = getActiveAIKey();
    if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
      setChatError('No AI API key found. Add one in Settings before using AI chat.');
      return;
    }

    if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
      setChatError('No Ollama model is configured. Update Settings before using AI chat.');
      return;
    }

    setChatError(null);
    setChatInput('');
    const historySnapshot = [...currentChatHistory];

    setChatHistoryByPlatform((previous) => ({
      ...previous,
      [activePlatform]: [...previous[activePlatform], { role: 'user', content: userMessage }],
    }));
    setIsChatLoading(true);

    try {
      const response = await fetch('/api/drafts/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeConfig.provider,
          apiKey: activeConfig.apiKey,
          ollamaBaseUrl: activeConfig.ollamaBaseUrl,
          ollamaModel: activeConfig.ollamaModel,
          draft: currentPlatformText,
          messages: historySnapshot,
          userMessage,
        }),
      });

      const payload = (await response.json()) as ChatApiResponse;
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error ?? 'Adaptation chat failed.');
      }

      setChatHistoryByPlatform((previous) => ({
        ...previous,
        [activePlatform]: [...previous[activePlatform], { role: 'assistant', content: payload.reply ?? '' }],
      }));

      if (payload.updatedDraft) {
        setPendingDraftUpdateByPlatform((previous) => ({
          ...previous,
          [activePlatform]: payload.updatedDraft ?? null,
        }));
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Adaptation chat failed.');
    } finally {
      setIsChatLoading(false);
    }
  }, [activePlatform, chatInput, currentChatHistory, currentPlatformText, isChatLoading]);

  const generatePlatformContent = useCallback(async (): Promise<void> => {
    if (!adaptContext?.draftContent.trim()) {
      setGenerateErrorByPlatform((previous) => ({
        ...previous,
        [activePlatform]: 'Draft source context is missing. Return to Draft Editor and reopen adaptation.',
      }));
      return;
    }

    if (isGeneratingPlatform) return;

    const activeConfig = getActiveAIKey();
    if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
      setGenerateErrorByPlatform((previous) => ({
        ...previous,
        [activePlatform]: 'No AI API key found. Add one in Settings before generating.',
      }));
      return;
    }

    if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
      setGenerateErrorByPlatform((previous) => ({
        ...previous,
        [activePlatform]: 'No Ollama model is configured. Update Settings before generating.',
      }));
      return;
    }

    setGenerateErrorByPlatform((previous) => ({ ...previous, [activePlatform]: null }));
    setGenerateSuccessByPlatform((previous) => ({ ...previous, [activePlatform]: null }));
    setIsGeneratingPlatform(activePlatform);

    const requestedPlatform = activePlatform;
    const requestedPlatformLabel = activePlatformConfig.label;
    const requestController = new AbortController();
    let requestSettled = false;
    let timeoutGuardId: number | null = null;
    const uiResetTimeoutId = window.setTimeout(() => {
      if (requestSettled) return;

      requestController.abort();
      setGenerateSuccessByPlatform((previous) => ({
        ...previous,
        [requestedPlatform]: null,
      }));
      setGenerateErrorByPlatform((previous) => ({
        ...previous,
        [requestedPlatform]: ADAPT_GENERATION_TIMEOUT_MESSAGE,
      }));
      setIsGeneratingPlatform((current) => (current === requestedPlatform ? null : current));
    }, ADAPT_GENERATION_TIMEOUT_MS + 500);

    try {
      const generationRequest = (async () => {
        const response = await fetch('/api/drafts/adapt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: requestController.signal,
          body: JSON.stringify({
            provider: activeConfig.provider,
            apiKey: activeConfig.apiKey,
            ollamaBaseUrl: activeConfig.ollamaBaseUrl,
            ollamaModel: activeConfig.ollamaModel,
            platform: requestedPlatform,
            sourceDraft: adaptContext.draftContent,
            currentPlatformDraft: currentPlatformText,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as AdaptGenerateApiResponse;
        return { response, payload };
      })();

      const timeoutGuard = new Promise<never>((_, reject) => {
        timeoutGuardId = window.setTimeout(() => {
          requestController.abort();
          reject(new Error(ADAPT_GENERATION_TIMEOUT_MESSAGE));
        }, ADAPT_GENERATION_TIMEOUT_MS);
      });

      const { response, payload } = await Promise.race([generationRequest, timeoutGuard]);

      const nextContent = payload.generatedContent?.trim();
      if (!response.ok || !nextContent) {
        throw new Error(
          payload.error ??
            (response.status === 504 ? ADAPT_GENERATION_TIMEOUT_MESSAGE : 'Platform generation failed.'),
        );
      }

      setPlatforms((previous) => ({
        ...previous,
        [requestedPlatform]: nextContent,
      }));
      setPendingDraftUpdateByPlatform((previous) => ({
        ...previous,
        [requestedPlatform]: null,
      }));
      setGenerateSuccessByPlatform((previous) => ({
        ...previous,
        [requestedPlatform]: `Generated for ${requestedPlatformLabel} at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
      }));
    } catch (error) {
      const message = isAbortLikeError(error)
        ? ADAPT_GENERATION_TIMEOUT_MESSAGE
        : error instanceof Error
          ? error.message
          : 'Platform generation failed.';

      setGenerateSuccessByPlatform((previous) => ({
        ...previous,
        [requestedPlatform]: null,
      }));
      setGenerateErrorByPlatform((previous) => ({
        ...previous,
        [requestedPlatform]: message,
      }));
    } finally {
      requestSettled = true;
      window.clearTimeout(uiResetTimeoutId);
      if (timeoutGuardId) {
        window.clearTimeout(timeoutGuardId);
      }
      setIsGeneratingPlatform((current) => (current === requestedPlatform ? null : current));
    }
  }, [activePlatform, activePlatformConfig.label, adaptContext, currentPlatformText, isGeneratingPlatform]);

  const applyPendingUpdate = useCallback(() => {
    if (!pendingDraftUpdate) return;

    updateActivePlatformText(pendingDraftUpdate);
    setPendingDraftUpdateByPlatform((previous) => ({
      ...previous,
      [activePlatform]: null,
    }));
  }, [activePlatform, pendingDraftUpdate, updateActivePlatformText]);

  const runAnalysis = useCallback(
    async (type: AnalyzeType): Promise<void> => {
      if (!currentPlatformText.trim()) {
        setAnalyzeError('Write platform copy before running optimization tools.');
        return;
      }

      const activeConfig = getActiveAIKey();
      if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
        setAnalyzeError('No Ollama model is configured. Update Settings before running analysis.');
        return;
      }

      setActiveAnalysisByPlatform((previous) => ({
        ...previous,
        [activePlatform]: type,
      }));
      setIsAnalyzing(true);
      setAnalyzeError(null);

      try {
        const response = await fetch('/api/drafts/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: activeConfig.provider,
            apiKey: activeConfig.apiKey,
            ollamaBaseUrl: activeConfig.ollamaBaseUrl,
            ollamaModel: activeConfig.ollamaModel,
            draft: currentPlatformText,
            type,
          }),
        });

        const payload = (await response.json()) as AnalyzeApiResponse;
        if (!response.ok || !payload.result) {
          throw new Error(payload.error ?? 'Analysis failed.');
        }

        setAnalysisByPlatform((previous) => {
          const nextPlatformAnalysis = { ...previous[activePlatform] };

          if (type === 'seo') {
            nextPlatformAnalysis.seo = payload.result as SeoResult;
          } else if (type === 'plagiarism') {
            nextPlatformAnalysis.plagiarism = payload.result as AiCheckResult;
          } else {
            nextPlatformAnalysis.sources = payload.result as SourcesResult;
          }

          return {
            ...previous,
            [activePlatform]: nextPlatformAnalysis,
          };
        });
      } catch (error) {
        setAnalyzeError(error instanceof Error ? error.message : 'Analysis failed.');
      } finally {
        setIsAnalyzing(false);
      }
    },
    [activePlatform, currentPlatformText],
  );

  const backToDraftPath = useMemo(() => {
    if (!ideaId) return '/drafts';
    return angleIdFromQuery ? `/drafts/${ideaId}?angleId=${angleIdFromQuery}` : `/drafts/${ideaId}`;
  }, [angleIdFromQuery, ideaId]);

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1 space-y-5">
        <div className="page-header">
          <h1>Multi-Channel Adaptation</h1>
          <p className="mt-1 text-sm text-slate-500">
            Adapt your saved draft for LinkedIn, X, Medium, Newsletter, and Blog publishing.
          </p>
          <p className="breadcrumb mt-1">
            1. Drafting → Editing → SEO/Readability → Multi-Channel Adaptation (Active) → Review → Schedule
          </p>

          {adaptContext ? (
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm" style={{ color: '#a7c9be' }}>
              <span>
                Idea: <span className="font-semibold text-white">{adaptContext.idea.topic}</span>
              </span>
              <span>
                Angle: <span className="font-semibold text-white">{adaptContext.selectedAngle.title}</span>
              </span>
              <span>
                Platform: <span className="font-semibold text-white">{activePlatformConfig.label}</span>
              </span>
              {isSaving ? (
                <span className="text-yellow-300">
                  <Spinner size="sm" label="Saving..." />
                </span>
              ) : savedAtText ? (
                <span className="text-green-300">✓ Saved at {savedAtText}</span>
              ) : null}
              {saveError ? <span className="text-red-400">{saveError}</span> : null}
            </div>
          ) : null}
        </div>

        {contextError ? (
          <section className="surface-card p-5">
            <p className="text-sm text-red-700">{contextError}</p>
            <button
              type="button"
              className="mt-4 rounded-xl px-5 py-2 text-sm font-bold text-white"
              style={{ background: '#1a7a5e' }}
              onClick={() => router.push(backToDraftPath)}
            >
              Back to Draft Editor
            </button>
          </section>
        ) : (
          <>
            <div className="grid gap-5 xl:grid-cols-[280px_1fr_320px]">
              <section className="surface-card flex flex-col p-4">
                <h2 className="section-title mb-2">AI Chat with Adaptation Assistant</h2>
                <p className="mb-3 text-xs text-slate-500">
                  Ask for channel-specific rewrites. Any AI rewrite applies only to the active platform.
                </p>

                <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm min-h-[320px] max-h-[460px]">
                  {currentChatHistory.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
                      <p className="mb-1 font-semibold text-slate-700">Try prompts like:</p>
                      <ul className="list-inside list-disc space-y-1">
                        <li>Turn this into a concise LinkedIn post with a stronger hook.</li>
                        <li>Rewrite this for an email newsletter with a CTA.</li>
                        <li>Shorten this for X while keeping the main insight.</li>
                      </ul>
                    </div>
                  ) : null}

                  {currentChatHistory.map((message, index) => (
                    <div
                      key={`${activePlatform}-${index}`}
                      className={`rounded-xl p-3 text-sm ${
                        message.role === 'user'
                          ? 'ml-4 bg-emerald-50 text-emerald-900'
                          : 'mr-4 border border-slate-200 bg-white text-slate-800'
                      }`}
                    >
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide opacity-50">
                        {message.role === 'user' ? 'You' : 'AI'}
                      </span>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))}

                  {isChatLoading ? (
                    <div className="mr-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-400">
                      <Spinner size="sm" label="AI is adapting copy…" />
                    </div>
                  ) : null}

                  <div ref={chatEndRef} />
                </div>

                {pendingDraftUpdate ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
                    <p className="mb-2 font-semibold text-emerald-700">
                      AI suggested an updated {activePlatformConfig.label} version.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                        style={{ background: '#1a7a5e' }}
                        onClick={applyPendingUpdate}
                      >
                        Apply Changes
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600"
                        onClick={() =>
                          setPendingDraftUpdateByPlatform((previous) => ({
                            ...previous,
                            [activePlatform]: null,
                          }))
                        }
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ) : null}

                {chatError ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {chatError}
                  </div>
                ) : null}

                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder={`Ask AI to improve the ${activePlatformConfig.label} version...`}
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
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

              <section className="surface-card flex flex-col p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="section-title">Platform Adaptations</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Switch tabs to edit each platform independently. Unsaved changes auto-sync to Firestore.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                      style={{ background: '#0f766e' }}
                      disabled={Boolean(isGeneratingPlatform) || isAdaptationLoading}
                      onClick={() => void generatePlatformContent()}
                    >
                      {isGeneratingPlatform === activePlatform ? <Spinner size="sm" label="Generating..." /> : `Generate ${activePlatformConfig.label}`}
                    </button>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {currentWordCount} words
                    </span>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  {PLATFORM_CONFIG.map((platform) => (
                    <button
                      key={platform.key}
                      type="button"
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                        activePlatform === platform.key
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                      onClick={() => setActivePlatform(platform.key)}
                    >
                      <span
                        className={`flex h-5 min-w-5 items-center justify-center rounded text-[9px] font-bold text-white ${platform.accentClass}`}
                      >
                        {platform.shortLabel}
                      </span>
                      {platform.label}
                    </button>
                  ))}
                </div>

                {isAdaptationLoading ? (
                  <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
                    <Spinner size="sm" />
                    <span>Loading saved platform adaptations...</span>
                  </div>
                ) : null}

                {activeGenerateSuccess ? (
                  <div className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                    {activeGenerateSuccess}
                  </div>
                ) : null}

                {activeGenerateError ? (
                  <div
                    className="mb-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
                    role="alert"
                    aria-live="assertive"
                  >
                    <p className="font-semibold">Generation failed for {activePlatformConfig.label}</p>
                    <p className="mt-1">{activeGenerateError}</p>
                  </div>
                ) : null}

                <textarea
                  className="min-h-[520px] w-full resize-y rounded-xl border border-slate-300 p-4 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  value={currentPlatformText}
                  onChange={(event) => updateActivePlatformText(event.target.value)}
                  placeholder={`Your ${activePlatformConfig.label} adaptation will appear here.`}
                  disabled={isAdaptationLoading}
                />
              </section>

              <div className="space-y-4">
                <section className="surface-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`flex h-7 min-w-7 items-center justify-center rounded text-xs font-bold text-white ${activePlatformConfig.accentClass}`}
                    >
                      {activePlatformConfig.icon}
                    </span>
                    <div>
                      <h2 className="section-title">Adaptation Preview</h2>
                      <p className="text-xs text-slate-500">{activePlatformConfig.label}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
                    {currentPlatformText.trim() ? (
                      <div className="space-y-3">
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {currentPlatformText}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">
                        This platform does not have any adapted copy yet.
                      </p>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    {PLATFORM_CONFIG.map((platform) => {
                      const text = platforms[platform.key] ?? '';
                      const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
                      return (
                        <div key={platform.key} className="rounded-xl bg-slate-50 p-2">
                          <p className="font-semibold text-slate-700">{platform.label}</p>
                          <p className="text-slate-500">{wordCount} words</p>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="surface-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h2 className="section-title">Optimization Tools</h2>
                      <p className="text-xs text-slate-500">
                        Run analysis against the active platform version only.
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      Live
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { type: 'seo' as AnalyzeType, label: '📈 SEO Optimizer' },
                        { type: 'plagiarism' as AnalyzeType, label: '🔍 AI Check' },
                        { type: 'sources' as AnalyzeType, label: '🔗 Source Check' },
                      ] as const
                    ).map(({ type, label }) => (
                      <button
                        key={type}
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
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

                  {analyzeError ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {analyzeError}
                    </div>
                  ) : null}

                  {!isAnalyzing && !activeAnalysis ? (
                    <p className="mt-3 text-sm text-slate-400">
                      Select a tool to inspect the current {activePlatformConfig.label} adaptation.
                    </p>
                  ) : null}

                  {isAnalyzing ? (
                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                      <Spinner size="sm" />
                      <span>Analyzing the active platform copy...</span>
                    </div>
                  ) : null}

                  {!isAnalyzing && activeAnalysis === 'seo' && currentAnalysis.seo ? (
                    <div className="mt-4 space-y-4 text-sm">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-emerald-50 p-3 text-center">
                          <p className="text-2xl font-bold text-emerald-700">{currentAnalysis.seo.readabilityScore}</p>
                          <p className="text-xs text-slate-600">Readability</p>
                          <p className="text-xs font-semibold text-slate-500">{currentAnalysis.seo.readabilityGrade}</p>
                        </div>
                        <div className="rounded-xl bg-blue-50 p-3 text-center">
                          <p className="text-2xl font-bold text-blue-700">{currentAnalysis.seo.keywordDensity}%</p>
                          <p className="text-xs text-slate-600">Keyword Density</p>
                        </div>
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Primary Keyword</p>
                        <p className="rounded-xl bg-slate-50 p-2 text-slate-700">
                          {currentAnalysis.seo.primaryKeyword}
                        </p>
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Meta Description</p>
                        <p className="rounded-xl bg-slate-50 p-2 text-slate-700">
                          {currentAnalysis.seo.metaDescription}
                        </p>
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Title Suggestions</p>
                        <ul className="space-y-1 text-slate-600">
                          {(currentAnalysis.seo.titleSuggestions ?? []).map((title, index) => (
                            <li key={index}>• {title}</li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Optimization Tips</p>
                        <ul className="space-y-1 text-slate-600">
                          {(currentAnalysis.seo.optimizationTips ?? []).map((tip, index) => (
                            <li key={index}>• {tip}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}

                  {!isAnalyzing && activeAnalysis === 'plagiarism' && currentAnalysis.plagiarism ? (
                    <div className="mt-4 space-y-4 text-sm">
                      <div className="rounded-xl bg-amber-50 p-3">
                        <p className="text-lg font-bold text-amber-700">
                          {currentAnalysis.plagiarism.aiLikelihoodScore}% AI likelihood
                        </p>
                        <p className="text-xs font-semibold text-slate-600">
                          {currentAnalysis.plagiarism.aiLikelihoodLabel}
                        </p>
                        <p className="mt-2 text-sm text-slate-700">{currentAnalysis.plagiarism.verdict}</p>
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Originality Summary</p>
                        <p className="rounded-xl bg-slate-50 p-2 text-slate-700">
                          {currentAnalysis.plagiarism.originality}
                        </p>
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Flagged Phrases</p>
                        {(currentAnalysis.plagiarism.flaggedPhrases ?? []).length > 0 ? (
                          <ul className="space-y-1 text-slate-600">
                            {(currentAnalysis.plagiarism.flaggedPhrases ?? []).map((item, index) => (
                              <li key={index}>
                                • <span className="font-semibold">{item.phrase}</span>: {item.reason}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-slate-500">No high-risk phrasing flagged.</p>
                        )}
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Humanization Tips</p>
                        <ul className="space-y-1 text-slate-600">
                          {(currentAnalysis.plagiarism.humanizationTips ?? []).map((tip, index) => (
                            <li key={index}>• {tip}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}

                  {!isAnalyzing && activeAnalysis === 'sources' && currentAnalysis.sources ? (
                    <div className="mt-4 space-y-4 text-sm">
                      <div className="rounded-xl bg-cyan-50 p-3">
                        <p className="text-lg font-bold text-cyan-700">
                          {currentAnalysis.sources.relevanceScore}/100 relevance
                        </p>
                        <p className="mt-1 text-sm text-slate-700">{currentAnalysis.sources.relevanceSummary}</p>
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Claims to Verify</p>
                        {(currentAnalysis.sources.claims ?? []).length > 0 ? (
                          <ul className="space-y-2 text-slate-600">
                            {(currentAnalysis.sources.claims ?? []).map((claim, index) => (
                              <li key={index} className="rounded-xl bg-slate-50 p-2">
                                <p className="font-medium text-slate-700">{claim.claim}</p>
                                <p className="text-xs">
                                  {claim.needsCitation ? 'Needs citation' : 'Citation optional'} · Search:{' '}
                                  {claim.suggestedSearchQuery}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-slate-500">No claims were identified for citation review.</p>
                        )}
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">URLs Found</p>
                        {(currentAnalysis.sources.urlsFound ?? []).length > 0 ? (
                          <ul className="space-y-1 text-slate-600">
                            {(currentAnalysis.sources.urlsFound ?? []).map((url, index) => (
                              <li key={index} className="break-all">
                                • {url}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-slate-500">No URLs were found in this platform version.</p>
                        )}
                      </div>

                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-700">Recommendations</p>
                        <ul className="space-y-1 text-slate-600">
                          {(currentAnalysis.sources.recommendations ?? []).map((item, index) => (
                            <li key={index}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                disabled={isSaving || !firebaseLoaded}
                onClick={() => void saveAdaptation(platforms, activePlatform)}
              >
                {isSaving ? <Spinner size="sm" label="Saving..." /> : 'Save as Draft'}
              </button>
              <button className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Submit for Review
              </button>
              <button
                className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
                style={{ background: '#1a7a5e' }}
              >
                📅 Schedule Post
              </button>
              <button
                className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
                style={{ background: '#0f766e' }}
              >
                Review &amp; Approve Adapted Content
              </button>
            </div>
          </>
        )}
      </div>

      <aside className="trends-panel hidden w-64 shrink-0 xl:block">
        <h2>Real-Time AI &amp; SEO Trends</h2>

        {isTrendsLoading ? (
          <div className="mt-3 text-sm text-slate-500">
            <Spinner size="sm" label="Loading trend signals..." />
          </div>
        ) : trendsError ? (
          <p className="mt-3 text-sm text-red-600">{trendsError}</p>
        ) : trendTopics.length > 0 ? (
          <div className="mt-3 space-y-2">
            {trendTopics.map((topic) => (
              <p key={topic.label} className="trend-item">
                {topic.label} <span className="trend-score">Mentions: {topic.count}</span>
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No live trend topics are available right now.</p>
        )}

        <h2 className="mt-5">Relevant Articles</h2>

        {isTrendsLoading ? null : trendsError ? null : trendArticles.length > 0 ? (
          <div className="mt-3 space-y-3">
            {trendArticles.map((article) => (
              <div key={article.url} className="article-item">
                <a href={article.url} target="_blank" rel="noreferrer">
                  {article.title}
                </a>
                <span className="article-date">
                  {article.source ? `${article.source} · ` : ''}
                  {article.publishedAt}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No related articles are available right now.</p>
        )}
      </aside>
    </div>
  );
}
