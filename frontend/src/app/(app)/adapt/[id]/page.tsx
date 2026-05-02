'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, deleteDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import { Spinner } from '@/components/Spinner';
import { AIEditTimeline } from '@/components/AIEditTimeline';
import { InlineEditPanel } from '@/components/InlineEditPanel';
import { DraftChatPanel, type DraftChatMessage } from '@/components/DraftChatPanel';
import { AIToolbox, type PlagiarismResult } from '@/components/AIToolbox';
import { CitationHighlightPreview } from '@/components/CitationHighlightPreview';
import { getActiveAIKey } from '@/lib/aiConfig';
import { loadExaKey } from '@/lib/exaConfig';
import { appendAIEditHistory, createEmptyAIEditHistoryState, type AIEditHistoryState } from '@/lib/aiEditHistory';
import { companyProfileToContextLines, loadCompanyProfile } from '@/lib/companyProfile';
import { applyChatSentenceDiff, buildSentenceSpanDiffs, rangesOverlap, type ChatSentenceDiff } from '@/lib/chatSpanDiff';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { useInlineEdit, type InlineSelection } from '@/lib/useInlineEdit';
import { setWorkflowContext } from '@/lib/workflowContext';
import WorkflowStepper from '@/components/WorkflowStepper';
import DocumentContextHeader from '@/components/DocumentContextHeader';

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
type PlatformStateMap = Record<PlatformKey, PlatformState>;
type SeoStateMap = Record<PlatformKey, SeoState>;
type PlatformVersionMap = Record<PlatformKey, number>;
type PlatformAIHistoryMap = Record<PlatformKey, AIEditHistoryState>;

type PlatformState = {
  status: 'idle' | 'queued' | 'running' | 'success' | 'failed';
  error: string | null;
  generatedAt: string | null;
};

type SeoResult = {
  primaryKeyword: string;
  keywordDensity: number;
  readabilityScore: number;
  readabilityGrade: string;
  optimizationTips: string[];
};

type SeoState = {
  status: 'idle' | 'pending' | 'success' | 'failed';
  error: string | null;
  result: SeoResult | null;
  requestVersion: number;
};

type ResearchLog = {
  provider: string;
  query: string;
  sourceCount: number;
};

type AdaptGenerateApiResponse = {
  generatedContent?: string;
  provider?: string;
  searchProvider?: string;
  searchQuery?: string;
  sourceCount?: number;
  error?: string;
};

type AnalyzeApiResponse = {
  result?: SeoResult;
  error?: string;
};

type DraftChatApiResponse = {
  reply?: string;
  updatedDraft?: string | null;
  provider?: string;
  researchLog?: ResearchLog | null;
  error?: string;
};

type FloatingAnchor = {
  top: number;
  left: number;
};

type PlatformChatDiffMap = Record<PlatformKey, ChatSentenceDiff[]>;

const ADAPT_CONTEXT_STORAGE_KEY = 'adapt_draft_context';
const SAVE_DEBOUNCE_MS = 1500;

const PLATFORM_CONFIG: Array<{ key: PlatformKey; label: string; accentClass: string }> = [
  { key: 'linkedin', label: 'LinkedIn', accentClass: 'bg-blue-700' },
  { key: 'twitter', label: 'X / Twitter', accentClass: 'bg-slate-900' },
  { key: 'medium', label: 'Medium', accentClass: 'bg-emerald-700' },
  { key: 'newsletter', label: 'Newsletter', accentClass: 'bg-amber-600' },
  { key: 'blog', label: 'Blog', accentClass: 'bg-violet-700' },
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

function createEmptyPlatformState(): PlatformStateMap {
  return {
    linkedin: { status: 'idle', error: null, generatedAt: null },
    twitter: { status: 'idle', error: null, generatedAt: null },
    medium: { status: 'idle', error: null, generatedAt: null },
    newsletter: { status: 'idle', error: null, generatedAt: null },
    blog: { status: 'idle', error: null, generatedAt: null },
  };
}

function createEmptySeoState(): SeoStateMap {
  return {
    linkedin: { status: 'idle', error: null, result: null, requestVersion: 0 },
    twitter: { status: 'idle', error: null, result: null, requestVersion: 0 },
    medium: { status: 'idle', error: null, result: null, requestVersion: 0 },
    newsletter: { status: 'idle', error: null, result: null, requestVersion: 0 },
    blog: { status: 'idle', error: null, result: null, requestVersion: 0 },
  };
}

function createEmptyVersionState(): PlatformVersionMap {
  return {
    linkedin: 0,
    twitter: 0,
    medium: 0,
    newsletter: 0,
    blog: 0,
  };
}

function createEmptyChatDiffState(): PlatformChatDiffMap {
  return {
    linkedin: [],
    twitter: [],
    medium: [],
    newsletter: [],
    blog: [],
  };
}

function createEmptyAIHistoryMap(): PlatformAIHistoryMap {
  return {
    linkedin: createEmptyAIEditHistoryState(),
    twitter: createEmptyAIEditHistoryState(),
    medium: createEmptyAIEditHistoryState(),
    newsletter: createEmptyAIEditHistoryState(),
    blog: createEmptyAIEditHistoryState(),
  };
}

function serializeAdaptation(platforms: PlatformContent, activePlatform: PlatformKey, selectedPlatforms: PlatformKey[]): string {
  return JSON.stringify({ platforms, activePlatform, selectedPlatforms: [...selectedPlatforms].sort() });
}

function toPlatformArray(value: unknown): PlatformKey[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const keys = value
    .map((item) => (typeof item === 'string' ? item : ''))
    .filter((item): item is PlatformKey => PLATFORM_CONFIG.some((platform) => platform.key === item));

  return [...new Set(keys)];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSections(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((section) => (typeof section === 'string' ? section.trim() : ''))
    .filter(Boolean);
}

function buildDraftScaffold(idea: IdeaRecord, angle: Angle): string {
  const title = angle.title || idea.topic || 'Adaptation Draft';
  const sectionList = angle.sections.length > 0 ? angle.sections : ['Key Insight', 'Execution Plan', 'Expected Outcome'];

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('## Introduction');
  lines.push(`${angle.summary || 'Use this draft scaffold to continue platform adaptation while source content is being recovered.'}`);
  lines.push('');

  for (const section of sectionList) {
    lines.push(`## ${section}`);
    lines.push(`Expand this section for ${idea.audience || 'the target audience'} with a ${idea.tone || 'clear'} tone.`);
    lines.push('');
  }

  lines.push('## Conclusion');
  lines.push('Summarize the strongest next steps and define a practical call to action.');
  lines.push('');
  lines.push('## Sources');
  lines.push('- [1] https://example.com/reference-1');
  lines.push('- [2] https://example.com/reference-2');

  return lines.join('\n');
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
  const [isLoadingContextFromFirebase, setIsLoadingContextFromFirebase] = useState(false);

  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformKey[]>([]);
  const [activePlatform, setActivePlatform] = useState<PlatformKey>('linkedin');
  const [hasStarted, setHasStarted] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const [platforms, setPlatforms] = useState<PlatformContent>(() => createSeededPlatforms(''));
  const [platformStates, setPlatformStates] = useState<PlatformStateMap>(createEmptyPlatformState);
  const [seoByPlatform, setSeoByPlatform] = useState<SeoStateMap>(createEmptySeoState);
  const [contentVersion, setContentVersion] = useState<PlatformVersionMap>(createEmptyVersionState);
  const contentVersionRef = useRef<PlatformVersionMap>(createEmptyVersionState());

  const [isSequenceRunning, setIsSequenceRunning] = useState(false);
  const [generatedPlatforms, setGeneratedPlatforms] = useState<Set<PlatformKey>>(new Set());

  const [firebaseLoaded, setFirebaseLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [hasExistingAdaptation, setHasExistingAdaptation] = useState(false);
  const [isDeletingAdaptation, setIsDeletingAdaptation] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);

  const [selection, setSelection] = useState<InlineSelection>({ start: 0, end: 0, text: '' });
  const [floatingAnchor, setFloatingAnchor] = useState<FloatingAnchor>({ top: 12, left: 12 });
  const [instruction, setInstruction] = useState('');
  const [chatHistoryByPlatform, setChatHistoryByPlatform] = useState<Record<PlatformKey, DraftChatMessage[]>>({
    linkedin: [],
    twitter: [],
    medium: [],
    newsletter: [],
    blog: [],
  });
  const [chatInputByPlatform, setChatInputByPlatform] = useState<Record<PlatformKey, string>>({
    linkedin: '',
    twitter: '',
    medium: '',
    newsletter: '',
    blog: '',
  });
  const [chatDiffsByPlatform, setChatDiffsByPlatform] = useState<PlatformChatDiffMap>(createEmptyChatDiffState);
  const [chatProviderByPlatform, setChatProviderByPlatform] = useState<Record<PlatformKey, string | null>>({
    linkedin: null,
    twitter: null,
    medium: null,
    newsletter: null,
    blog: null,
  });
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatSending, setIsChatSending] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [aiHistoryByPlatform, setAiHistoryByPlatform] = useState<PlatformAIHistoryMap>(createEmptyAIHistoryMap);
  const [toolboxNoticeByPlatform, setToolboxNoticeByPlatform] = useState<Record<PlatformKey, string | null>>({
    linkedin: null,
    twitter: null,
    medium: null,
    newsletter: null,
    blog: null,
  });
  const [plagiarismByPlatform, setPlagiarismByPlatform] = useState<Record<PlatformKey, PlagiarismResult | null>>({
    linkedin: null,
    twitter: null,
    medium: null,
    newsletter: null,
    blog: null,
  });
  const [previewModeByPlatform, setPreviewModeByPlatform] = useState<Record<PlatformKey, boolean>>({
    linkedin: false,
    twitter: false,
    medium: false,
    newsletter: false,
    blog: false,
  });
  const [researchLogByPlatform, setResearchLogByPlatform] = useState<Record<PlatformKey, ResearchLog | null>>({
    linkedin: null,
    twitter: null,
    medium: null,
    newsletter: null,
    blog: null,
  });

  useEffect(() => {
    const refreshKey = (): void => {
      const config = getActiveAIKey();
      setHasApiKey(config.provider === 'ollama' ? Boolean(config.ollamaModel.trim()) : Boolean(config.apiKey));
    };
    refreshKey();
    const handler = (): void => refreshKey();
    window.addEventListener('storage', handler);
    window.addEventListener('focus', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('focus', handler);
    };
  }, []);

  const applyAdaptContext = useCallback((context: AdaptDraftContext) => {
    setAdaptContext(context);
    setPlatforms(createSeededPlatforms(context.draftContent));
    setPlatformStates(createEmptyPlatformState());
    setSeoByPlatform(createEmptySeoState());
    setContentVersion(createEmptyVersionState());
    setSelectedPlatforms([]);
    setActivePlatform('linkedin');
    setHasStarted(false);
    setGeneratedPlatforms(new Set());
    setFirebaseLoaded(false);
    setHasExistingAdaptation(false);
    setSavedAt(null);
    lastSavedSignatureRef.current = null;
    setContextError(null);
    setAiHistoryByPlatform(createEmptyAIHistoryMap());
  }, []);

  useEffect(() => {
    contentVersionRef.current = contentVersion;
  }, [contentVersion]);

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
      setContextError('No idea was provided for this adaptation workflow.');
      setAdaptContext(null);
      return;
    }

    if (!angleIdFromQuery) {
      setContextError('No angle was provided. Return to Storyboard and reopen adaptation.');
      setAdaptContext(null);
      return;
    }

    const rawContext = localStorage.getItem(ADAPT_CONTEXT_STORAGE_KEY);
    if (!rawContext) {
      setAdaptContext(null);
      setContextError(null);
      return;
    }

    try {
      const parsed = JSON.parse(rawContext) as AdaptDraftContext;
      const normalizedContext: AdaptDraftContext = {
        ideaId: asString(parsed.ideaId),
        angleId: asString(parsed.angleId),
        idea: {
          id: asString(parsed.idea?.id),
          topic: asString(parsed.idea?.topic),
          tone: asString(parsed.idea?.tone),
          audience: asString(parsed.idea?.audience),
          format: asString(parsed.idea?.format),
        },
        selectedAngle: {
          id: asString(parsed.selectedAngle?.id),
          title: asString(parsed.selectedAngle?.title),
          summary: asString(parsed.selectedAngle?.summary),
          sections: normalizeSections(parsed.selectedAngle?.sections),
        },
        draftContent: asString(parsed.draftContent),
      };

      const isComplete =
        normalizedContext.ideaId.length > 0 &&
        normalizedContext.angleId.length > 0 &&
        normalizedContext.idea.id.length > 0 &&
        normalizedContext.selectedAngle.id.length > 0 &&
        normalizedContext.selectedAngle.title.length > 0 &&
        normalizedContext.draftContent.length > 0;

      const matchesRoute = normalizedContext.ideaId === ideaId && normalizedContext.angleId === angleIdFromQuery;

      if (isComplete && matchesRoute) {
        applyAdaptContext(normalizedContext);
        return;
      }

      setAdaptContext(null);
      setContextError(null);
    } catch {
      setAdaptContext(null);
      setContextError(null);
    }
  }, [angleIdFromQuery, applyAdaptContext, ideaId]);

  useEffect(() => {
    if (!currentUid || adaptContext || !ideaId || !angleIdFromQuery) return;

    const db = getFirebaseDb();
    if (!db) {
      setContextError('Unable to load adaptation context because Firebase is unavailable.');
      return;
    }

    setIsLoadingContextFromFirebase(true);

    void (async () => {
      try {
        const [ideaSnapshot, anglesSnapshot, draftSnapshot] = await Promise.all([
          getDoc(doc(db, 'users', currentUid, 'ideas', ideaId)),
          getDoc(doc(db, 'users', currentUid, 'ideas', ideaId, 'workflow', 'angles')),
          getDoc(doc(db, 'users', currentUid, 'drafts', `${ideaId}_${angleIdFromQuery}`)),
        ]);

        if (!ideaSnapshot.exists()) {
          setContextError('Unable to find the requested idea. It may have been deleted.');
          setAdaptContext(null);
          return;
        }

        const ideaData = ideaSnapshot.data() as Record<string, unknown>;
        const loadedIdea: IdeaRecord = {
          id: ideaSnapshot.id,
          topic: asString(ideaData.topic),
          tone: asString(ideaData.tone),
          audience: asString(ideaData.audience),
          format: asString(ideaData.format),
        };

        const anglesData = anglesSnapshot.exists() ? (anglesSnapshot.data() as Record<string, unknown>) : null;
        const angleCandidates = Array.isArray(anglesData?.angles) ? (anglesData?.angles as unknown[]) : [];
        const matchedAngleRaw = angleCandidates.find(
          (candidate) =>
            typeof candidate === 'object' &&
            candidate !== null &&
            asString((candidate as Record<string, unknown>).id) === angleIdFromQuery,
        );

        if (!matchedAngleRaw || typeof matchedAngleRaw !== 'object') {
          setContextError('Unable to find the selected angle for this route. Reopen Adapt from Storyboard.');
          setAdaptContext(null);
          return;
        }

        const matchedAngle = matchedAngleRaw as Record<string, unknown>;
        const selectedAngle: Angle = {
          id: asString(matchedAngle.id),
          title: asString(matchedAngle.title),
          summary: asString(matchedAngle.summary),
          sections: normalizeSections(matchedAngle.sections),
        };

        if (!selectedAngle.id || !selectedAngle.title) {
          setContextError('Selected angle data is incomplete. Reopen Adapt from Storyboard.');
          setAdaptContext(null);
          return;
        }

        const draftData = draftSnapshot.exists() ? (draftSnapshot.data() as Record<string, unknown>) : null;
        const savedDraftContent = asString(draftData?.content);
        const draftContent = savedDraftContent || buildDraftScaffold(loadedIdea, selectedAngle);

        applyAdaptContext({
          ideaId,
          angleId: angleIdFromQuery,
          idea: loadedIdea,
          selectedAngle,
          draftContent,
        });
      } catch {
        setContextError('Unable to load adaptation context from Firebase. Please try again.');
        setAdaptContext(null);
      } finally {
        setIsLoadingContextFromFirebase(false);
      }
    })();
  }, [adaptContext, angleIdFromQuery, applyAdaptContext, currentUid, ideaId]);

  useEffect(() => {
    if (!currentUid || !adaptContext || firebaseLoaded) return;

    const db = getFirebaseDb();
    if (!db) {
      setFirebaseLoaded(true);
      return;
    }

    const docId = `${adaptContext.ideaId}_${adaptContext.angleId}`;
    const docRef = doc(db, 'users', currentUid, 'adaptations', docId);

    void (async () => {
      try {
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
          const data = snapshot.data();

          const seeded = createSeededPlatforms(adaptContext.draftContent);
          const savedPlatforms = data.platforms;
          if (savedPlatforms && typeof savedPlatforms === 'object') {
            for (const platform of PLATFORM_CONFIG) {
              const value = (savedPlatforms as Record<string, unknown>)[platform.key];
              if (typeof value === 'string') {
                seeded[platform.key] = value;
              }
            }
          }

          const savedSelected = toPlatformArray((data as Record<string, unknown>).selectedPlatforms);
          const savedActive =
            typeof data.activePlatform === 'string' && PLATFORM_CONFIG.some((entry) => entry.key === data.activePlatform)
              ? (data.activePlatform as PlatformKey)
              : savedSelected[0] ?? 'linkedin';

          setPlatforms(seeded);
          setSelectedPlatforms(savedSelected);
          setHasStarted(savedSelected.length > 0);
          setActivePlatform(savedActive);
          setGeneratedPlatforms(new Set(savedSelected));
          setHasExistingAdaptation(true);

          const timestamp = data.updatedAt as { toDate?: () => Date } | null;
          setSavedAt(timestamp?.toDate?.() ?? null);
          lastSavedSignatureRef.current = serializeAdaptation(seeded, savedActive, savedSelected);
        }
      } finally {
        setFirebaseLoaded(true);
      }
    })();
  }, [adaptContext, currentUid, firebaseLoaded]);

  const saveAdaptation = useCallback(
    async (nextPlatforms: PlatformContent, nextActivePlatform: PlatformKey, nextSelected: PlatformKey[]): Promise<void> => {
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
          selectedPlatforms: nextSelected,
          updatedAt: serverTimestamp(),
        };

        if (!hasExistingAdaptation) {
          payload.createdAt = serverTimestamp();
        }

        await setDoc(docRef, payload, { merge: true });
        setHasExistingAdaptation(true);
        setSavedAt(new Date());
        lastSavedSignatureRef.current = serializeAdaptation(nextPlatforms, nextActivePlatform, nextSelected);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Unable to save adaptation.');
      } finally {
        setIsSaving(false);
      }
    },
    [adaptContext, currentUid, hasExistingAdaptation],
  );

  const adaptationSignature = useMemo(
    () => serializeAdaptation(platforms, activePlatform, selectedPlatforms),
    [activePlatform, platforms, selectedPlatforms],
  );

  useEffect(() => {
    if (!firebaseLoaded || !adaptContext || !currentUid || !hasStarted) return;
    if (adaptationSignature === lastSavedSignatureRef.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      void saveAdaptation(platforms, activePlatform, selectedPlatforms);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [activePlatform, adaptationSignature, adaptContext, currentUid, firebaseLoaded, hasStarted, platforms, saveAdaptation, selectedPlatforms]);

  const setActivePlatformText = useCallback(
    (nextValue: string | ((previous: string) => string)) => {
      setPlatforms((previous) => {
        const currentValue = previous[activePlatform] ?? '';
        const resolvedValue =
          typeof nextValue === 'function'
            ? (nextValue as (previous: string) => string)(currentValue)
            : nextValue;

        if (resolvedValue === currentValue) {
          return previous;
        }

        setContentVersion((previousVersion) => ({
          ...previousVersion,
          [activePlatform]: previousVersion[activePlatform] + 1,
        }));

        return {
          ...previous,
          [activePlatform]: resolvedValue,
        };
      });
    },
    [activePlatform],
  );

  const recordPlatformAIEdit = useCallback(
    (platform: PlatformKey, previousContent: string, nextContent: string, summary: string, label: string): void => {
      setAiHistoryByPlatform((previous) => ({
        ...previous,
        [platform]: appendAIEditHistory(previous[platform], { previousContent, nextContent, summary, label }),
      }));
    },
    [],
  );

  const inlineEditor = useInlineEdit({
    text: platforms[activePlatform] ?? '',
    setText: setActivePlatformText,
    onAcceptChange: (change, previousText, nextText) => {
      recordPlatformAIEdit(activePlatform, previousText, nextText, change.summary, 'Inline edit');
    },
  });
  const activePendingInlineChange = useMemo(
    () => inlineEditor.changes.find((change) => change.status === 'pending') ?? null,
    [inlineEditor.changes],
  );
  const activePlatformChatDiffs = useMemo(
    () => (chatDiffsByPlatform[activePlatform] ?? []).filter((diff) => diff.status === 'pending' || diff.status === 'conflict'),
    [activePlatform, chatDiffsByPlatform],
  );
  const activePlatformPendingDiffCount = useMemo(
    () => (chatDiffsByPlatform[activePlatform] ?? []).filter((diff) => diff.status === 'pending').length,
    [activePlatform, chatDiffsByPlatform],
  );
  const activeAiHistory = aiHistoryByPlatform[activePlatform];

  const captureSelection = useCallback(
    (platform: PlatformKey, target: HTMLTextAreaElement) => {
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? 0;
      setActivePlatform(platform);
      const sourceText = platforms[platform] ?? '';
      setSelection({ start, end, text: sourceText.slice(start, end) });

      const selectionEnd = end >= start ? end : start;
      const textBeforeCaret = sourceText.slice(0, selectionEnd);
      const lines = textBeforeCaret.split('\n');
      const currentLine = lines[lines.length - 1] ?? '';
      const approximateLeft = Math.min(Math.max(12, 12 + currentLine.length * 7), Math.max(12, target.clientWidth - 280));
      const approximateTop = Math.min(Math.max(12, 14 + (lines.length - 1) * 22), Math.max(12, target.clientHeight - 160));
      setFloatingAnchor({ top: approximateTop, left: approximateLeft });
    },
    [platforms],
  );

  const runSeoForPlatform = useCallback(
    async (platform: PlatformKey, draft: string, versionAtRequest: number): Promise<void> => {
      const activeConfig = getActiveAIKey();

      setSeoByPlatform((previous) => ({
        ...previous,
        [platform]: {
          ...previous[platform],
          status: 'pending',
          error: null,
          requestVersion: versionAtRequest,
        },
      }));

      try {
        const companyProfile = await loadCompanyProfile(currentUid);
        const companyContext = companyProfileToContextLines(companyProfile);

        const response = await fetch('/api/drafts/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: activeConfig.provider,
            apiKey: activeConfig.apiKey,
            ollamaBaseUrl: activeConfig.ollamaBaseUrl,
            ollamaModel: activeConfig.ollamaModel,
            draft,
            type: 'seo',
            platform,
            companyContext,
          }),
        });

        const payload = (await response.json()) as AnalyzeApiResponse;
        if (!response.ok || !payload.result) {
          throw new Error(payload.error ?? 'SEO analysis failed.');
        }

        if (contentVersionRef.current[platform] !== versionAtRequest) {
          return;
        }

        setSeoByPlatform((previous) => ({
          ...previous,
          [platform]: {
            status: 'success',
            error: null,
            result: payload.result ?? null,
            requestVersion: versionAtRequest,
          },
        }));
      } catch (error) {
        if (contentVersionRef.current[platform] !== versionAtRequest) {
          return;
        }

        setSeoByPlatform((previous) => ({
          ...previous,
          [platform]: {
            ...previous[platform],
            status: 'failed',
            error: error instanceof Error ? error.message : 'SEO analysis failed.',
            requestVersion: versionAtRequest,
          },
        }));
      }
    },
    [currentUid],
  );

  const generatePlatform = useCallback(
    async (platform: PlatformKey): Promise<void> => {
      if (!adaptContext?.draftContent.trim()) {
        setPlatformStates((previous) => ({
          ...previous,
          [platform]: {
            ...previous[platform],
            status: 'failed',
            error: 'Storyboard source is missing. Return to Storyboard and reopen Adapt.',
          },
        }));
        return;
      }

      const activeConfig = getActiveAIKey();
      if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
        setPlatformStates((previous) => ({
          ...previous,
          [platform]: {
            ...previous[platform],
            status: 'failed',
            error: 'No AI API key found. Add one in Settings before generating.',
          },
        }));
        return;
      }

      if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
        setPlatformStates((previous) => ({
          ...previous,
          [platform]: {
            ...previous[platform],
            status: 'failed',
            error: 'No Ollama model is configured. Update Settings before generating.',
          },
        }));
        return;
      }

      setPlatformStates((previous) => ({
        ...previous,
        [platform]: {
          ...previous[platform],
          status: 'running',
          error: null,
        },
      }));

      try {
        const previousPlatformDraft = platforms[platform] ?? '';
        const companyProfile = await loadCompanyProfile(currentUid);
        const companyContext = companyProfileToContextLines(companyProfile);

        const response = await fetch('/api/drafts/adapt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: activeConfig.provider,
            apiKey: activeConfig.apiKey,
            ollamaBaseUrl: activeConfig.ollamaBaseUrl,
            ollamaModel: activeConfig.ollamaModel,
            exaApiKey: loadExaKey(),
            ideaTopic: adaptContext.idea.topic,
            platform,
            sourceDraft: adaptContext.draftContent,
            currentPlatformDraft: platforms[platform] ?? '',
            companyContext,
          }),
        });

        const payload = (await response.json()) as AdaptGenerateApiResponse;
        const generated = payload.generatedContent?.trim();
        if (!response.ok || !generated) {
          throw new Error(payload.error ?? 'Platform generation failed.');
        }

        if (payload.searchProvider) {
          setResearchLogByPlatform((previous) => ({
            ...previous,
            [platform]: {
              provider: payload.searchProvider ?? 'unavailable',
              query: payload.searchQuery ?? '',
              sourceCount: payload.sourceCount ?? 0,
            },
          }));
        }

        let nextVersion = 0;
        setPlatforms((previous) => ({
          ...previous,
          [platform]: generated,
        }));
        recordPlatformAIEdit(
          platform,
          previousPlatformDraft,
          generated,
          `Generated a fresh ${PLATFORM_CONFIG.find((entry) => entry.key === platform)?.label ?? 'platform'} adaptation.`,
          `${PLATFORM_CONFIG.find((entry) => entry.key === platform)?.label ?? 'Platform'} generation`,
        );
        setContentVersion((previous) => {
          nextVersion = previous[platform] + 1;
          return {
            ...previous,
            [platform]: nextVersion,
          };
        });

        setPlatformStates((previous) => ({
          ...previous,
          [platform]: {
            status: 'success',
            error: null,
            generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        }));
        setGeneratedPlatforms((previous) => {
          const next = new Set(previous);
          next.add(platform);
          return next;
        });
        setActivePlatform(platform);

        const nextSelected = selectedPlatforms.length > 0 ? selectedPlatforms : [platform];
        const nextPlatforms = {
          ...platforms,
          [platform]: generated,
        };
        void saveAdaptation(nextPlatforms, platform, nextSelected);

        await runSeoForPlatform(platform, generated, nextVersion);
      } catch (error) {
        setPlatformStates((previous) => ({
          ...previous,
          [platform]: {
            ...previous[platform],
            status: 'failed',
            error: error instanceof Error ? error.message : 'Platform generation failed.',
          },
        }));
      }
    },
    [adaptContext, currentUid, platforms, recordPlatformAIEdit, runSeoForPlatform, saveAdaptation, selectedPlatforms],
  );

  const startSequentialGeneration = useCallback(async (): Promise<void> => {
    const platformsToGenerate = selectedPlatforms.filter((p) => !generatedPlatforms.has(p));

    if (platformsToGenerate.length === 0) {
      setGateError('Select at least one platform before continuing.');
      return;
    }

    setGateError(null);
    setHasStarted(true);
    setIsSequenceRunning(true);

    setPlatformStates((previous) => {
      const next = { ...previous };
      for (const platform of platformsToGenerate) {
        if (next[platform].status === 'idle' || next[platform].status === 'failed') {
          next[platform] = { ...next[platform], status: 'queued', error: null };
        }
      }
      return next;
    });

    for (const platform of platformsToGenerate) {
      await generatePlatform(platform);
    }

    setIsSequenceRunning(false);
  }, [generatePlatform, generatedPlatforms, selectedPlatforms]);

  const retryPlatform = useCallback(
    async (platform: PlatformKey): Promise<void> => {
      await generatePlatform(platform);
    },
    [generatePlatform],
  );

  const retrySeo = useCallback(
    async (platform: PlatformKey): Promise<void> => {
      const draft = platforms[platform] ?? '';
      if (!draft.trim()) {
        setSeoByPlatform((previous) => ({
          ...previous,
          [platform]: {
            ...previous[platform],
            status: 'failed',
            error: 'Generate or add content before retrying SEO analysis.',
          },
        }));
        return;
      }

      const version = contentVersionRef.current[platform];
      await runSeoForPlatform(platform, draft, version);
    },
    [platforms, runSeoForPlatform],
  );

  const togglePlatformSelection = useCallback((platform: PlatformKey) => {
    setSelectedPlatforms((previous) => {
      if (previous.includes(platform)) {
        const next = previous.filter((entry) => entry !== platform);
        if (next.length > 0 && !next.includes(activePlatform)) {
          setActivePlatform(next[0]);
        }
        return next;
      }

      const next = [...previous, platform];
      if (next.length === 1) {
        setActivePlatform(platform);
      }
      return next;
    });
  }, [activePlatform]);

  const backToStoryboardPath = useMemo(() => {
    if (!ideaId) return '/storyboard';
    return angleIdFromQuery
      ? `/storyboard/${encodeURIComponent(ideaId)}?angleId=${encodeURIComponent(angleIdFromQuery)}`
      : `/storyboard/${encodeURIComponent(ideaId)}`;
  }, [angleIdFromQuery, ideaId]);

  const deleteAdaptation = useCallback(async (): Promise<void> => {
    if (!currentUid || !ideaId || !angleIdFromQuery) return;
    const label = adaptContext?.selectedAngle.title || 'this adaptation';
    if (!window.confirm(`Delete adaptation "${label}"? This cannot be undone.`)) return;
    const db = getFirebaseDb();
    if (!db) return;
    setIsDeletingAdaptation(true);
    try {
      const docId = `${ideaId}_${angleIdFromQuery}`;
      await deleteDoc(doc(db, 'users', currentUid, 'adaptations', docId));
      router.push('/storyboard');
    } catch {
      setIsDeletingAdaptation(false);
    }
  }, [adaptContext?.selectedAngle.title, angleIdFromQuery, currentUid, ideaId, router]);

  const savedAtText = useMemo(
    () => savedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? null,
    [savedAt],
  );

  const tabVisiblePlatforms = useMemo(
    () =>
      PLATFORM_CONFIG.filter(
        (p) =>
          generatedPlatforms.has(p.key) ||
          platformStates[p.key].status === 'running' ||
          platformStates[p.key].status === 'queued',
      ),
    [generatedPlatforms, platformStates],
  );

  const ungeneratedSelectablePlatforms = useMemo(
    () =>
      PLATFORM_CONFIG.filter(
        (p) =>
          !generatedPlatforms.has(p.key) &&
          platformStates[p.key].status !== 'running' &&
          platformStates[p.key].status !== 'queued',
      ),
    [generatedPlatforms, platformStates],
  );

  const handleSendPlatformChat = useCallback(async (): Promise<void> => {
    const activeConfig = getActiveAIKey();
    const platform = activePlatform;
    const nextMessage = (chatInputByPlatform[platform] ?? '').trim();
    const activeDraft = platforms[platform] ?? '';
    const historyForPlatform = chatHistoryByPlatform[platform] ?? [];

    if (!nextMessage) return;

    if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
      setChatError('No AI API key found. Add a key in Settings before using AI chat.');
      return;
    }

    if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
      setChatError('No Ollama model is configured. Update Settings before using AI chat.');
      return;
    }

    setChatError(null);
    setIsChatSending(true);
    setChatInputByPlatform((previous) => ({
      ...previous,
      [platform]: '',
    }));
    setChatHistoryByPlatform((previous) => ({
      ...previous,
      [platform]: [...historyForPlatform, { role: 'user', content: nextMessage }],
    }));

    try {
      const companyProfile = await loadCompanyProfile(currentUid);
      const companyContext = companyProfileToContextLines(companyProfile);

      const response = await fetch('/api/drafts/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeConfig.provider,
          apiKey: activeConfig.apiKey,
          ollamaBaseUrl: activeConfig.ollamaBaseUrl,
          ollamaModel: activeConfig.ollamaModel,
          exaApiKey: loadExaKey(),
          draft: activeDraft,
          messages: historyForPlatform,
          userMessage: nextMessage,
          companyContext,
        }),
      });

      const payload = (await response.json()) as DraftChatApiResponse;
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error ?? 'AI chat failed.');
      }

      const newMessages: DraftChatMessage[] = [];

      if (payload.researchLog) {
        const log = payload.researchLog;
        const providerLabel =
          log.provider === 'exa'
            ? 'Exa'
            : log.provider === 'unavailable'
            ? 'No sources (add an Exa key in Settings)'
            : log.provider === 'duckduckgo' || log.provider === 'duckduckgo-html'
            ? 'DuckDuckGo'
            : log.provider;
        const sourceLine =
          log.provider === 'unavailable'
            ? 'No results — factual claims will use ALL-CAPS placeholders.'
            : `${log.sourceCount} source${log.sourceCount !== 1 ? 's' : ''} retrieved.`;
        newMessages.push({
          role: 'research',
          content: `${providerLabel} · Query: "${log.query}" · ${sourceLine}`,
        });
        setResearchLogByPlatform((previous) => ({
          ...previous,
          [platform]: log,
        }));
      }

      newMessages.push({ role: 'assistant', content: payload.reply ?? '' });

      setChatHistoryByPlatform((previous) => ({
        ...previous,
        [platform]: [...(previous[platform] ?? []), ...newMessages],
      }));
      setChatProviderByPlatform((previous) => ({
        ...previous,
        [platform]: payload.provider ?? activeConfig.provider,
      }));

      const updatedDraft = payload.updatedDraft?.trim();
      if (updatedDraft && updatedDraft !== activeDraft) {
        const proposedDiffs = buildSentenceSpanDiffs(activeDraft, updatedDraft);
        if (proposedDiffs.length === 0) {
          setChatError('AI responded, but no sentence-level diff could be mapped. Try a more specific instruction.');
          return;
        }

        setChatDiffsByPlatform((previous) => ({
          ...previous,
          [platform]: [...proposedDiffs, ...(previous[platform] ?? [])],
        }));
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'AI chat failed.');
    } finally {
      setIsChatSending(false);
    }
  }, [activePlatform, chatHistoryByPlatform, chatInputByPlatform, currentUid, platforms]);

  const handleKeepPlatformChatDiff = useCallback(
    (diffId: string): void => {
      const platform = activePlatform;
      const target = (chatDiffsByPlatform[platform] ?? []).find((entry) => entry.id === diffId);
      if (!target || target.status !== 'pending') {
        return;
      }

      setPlatforms((previous) => {
        const currentText = previous[platform] ?? '';
        const applied = applyChatSentenceDiff(currentText, target);

        if (!applied) {
          setChatDiffsByPlatform((diffState) => ({
            ...diffState,
            [platform]: (diffState[platform] ?? []).map((entry) =>
              entry.id === diffId
                ? {
                    ...entry,
                    status: 'conflict',
                    message: 'Source sentence moved. Undo this diff and request another chat revision.',
                  }
                : entry,
            ),
          }));
          return previous;
        }

        const delta = target.afterText.length - applied.replacedLength;
        const replacedStart = applied.appliedStart;
        const replacedEndBeforeWrite = replacedStart + applied.replacedLength;

        setChatDiffsByPlatform((diffState) => ({
          ...diffState,
          [platform]: (diffState[platform] ?? [])
            .map((entry): ChatSentenceDiff | null => {
              if (entry.id === diffId) {
                return null;
              }

              if (entry.status !== 'pending' && entry.status !== 'conflict') {
                return entry;
              }

              if (rangesOverlap(entry.start, entry.end, replacedStart, replacedEndBeforeWrite)) {
                return {
                  ...entry,
                  status: 'conflict',
                  message: 'Overlaps a kept sentence change. Undo and regenerate to refresh this diff.',
                };
              }

              if (entry.start >= replacedEndBeforeWrite) {
                return {
                  ...entry,
                  start: entry.start + delta,
                  end: entry.end + delta,
                };
              }

              return entry;
            })
            .filter((entry): entry is ChatSentenceDiff => Boolean(entry)),
        }));

        setContentVersion((versions) => ({
          ...versions,
          [platform]: versions[platform] + 1,
        }));
        setChatError(null);
        recordPlatformAIEdit(platform, currentText, applied.nextText, 'Kept one AI chat sentence change.', 'Chat diff');

        return {
          ...previous,
          [platform]: applied.nextText,
        };
      });
    },
    [activePlatform, chatDiffsByPlatform, recordPlatformAIEdit],
  );

  const handleUndoPlatformChatDiff = useCallback(
    (diffId: string): void => {
      const platform = activePlatform;
      setChatDiffsByPlatform((previous) => ({
        ...previous,
        [platform]: (previous[platform] ?? []).filter((entry) => entry.id !== diffId),
      }));
      setChatError(null);
    },
    [activePlatform],
  );

  const handleRestorePlatformAIEdit = useCallback(
    (entryId: string): void => {
      const platform = activePlatform;
      const entry = aiHistoryByPlatform[platform].entries.find((item) => item.id === entryId);
      if (!entry) {
        return;
      }

      setPlatforms((previous) => ({
        ...previous,
        [platform]: entry.content,
      }));
      setContentVersion((previous) => ({
        ...previous,
        [platform]: previous[platform] + 1,
      }));
      setAiHistoryByPlatform((previous) => ({
        ...previous,
        [platform]: {
          ...previous[platform],
          activeEntryId: entryId,
        },
      }));
      setToolboxNoticeByPlatform((previous) => ({
        ...previous,
        [platform]: `Restored ${entry.label.toLowerCase()}.`,
      }));
      setPlagiarismByPlatform((previous) => ({
        ...previous,
        [platform]: null,
      }));
      setChatDiffsByPlatform((previous) => ({
        ...previous,
        [platform]: [],
      }));
      setChatError(null);
      inlineEditor.setChanges([]);
    },
    [activePlatform, aiHistoryByPlatform, inlineEditor],
  );

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1>Platform Adaptation</h1>
        <p className="breadcrumb mt-1">Angles {'->'} Storyboard {'->'} Adapt (Active) {'->'} Review {'->'} Publish</p>

        {adaptContext ? (
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm" style={{ color: '#a7c9be' }}>
            <span>
              Idea: <span className="font-semibold text-white">{adaptContext.idea.topic}</span>
            </span>
            <span>
              Angle: <span className="font-semibold text-white">{adaptContext.selectedAngle.title}</span>
            </span>
            <span>
              Active platform: <span className="font-semibold text-white">{PLATFORM_CONFIG.find((p) => p.key === activePlatform)?.label}</span>
            </span>
            {isSaving ? (
              <span className="text-yellow-300">
                <Spinner size="sm" label="Saving..." />
              </span>
            ) : savedAtText ? (
              <span className="text-green-300">Saved at {savedAtText}</span>
            ) : null}
            {saveError ? <span className="text-red-400">{saveError}</span> : null}
          </div>
        ) : null}

        {adaptContext && hasExistingAdaptation ? (
          <div className="mt-3">
            <button
              type="button"
              className="rounded-lg border border-red-400 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-900/30 disabled:opacity-60"
              onClick={() => { void deleteAdaptation(); }}
              disabled={isDeletingAdaptation}
            >
              {isDeletingAdaptation ? 'Deleting...' : 'Delete Adaptation'}
            </button>
          </div>
        ) : null}
      </div>
      <WorkflowStepper />
      <DocumentContextHeader
        ideaTopic={adaptContext?.idea.topic ?? ''}
        angleTitle={adaptContext?.selectedAngle.title ?? ''}
        activeStep="adapt"
      />

      {contextError ? (
        <section className="surface-card p-5">
          <p className="text-sm text-red-700">{contextError}</p>
          <button
            type="button"
            className="mt-4 rounded-xl px-5 py-2 text-sm font-bold text-white"
            style={{ background: '#1a7a5e' }}
            onClick={() => router.push(backToStoryboardPath)}
          >
            Back to Storyboard
          </button>
        </section>
      ) : null}

      {!contextError && !adaptContext ? (
        <section className="surface-card p-5">
          <Spinner
            size="sm"
            label={
              !currentUid
                ? 'Checking session...'
                : isLoadingContextFromFirebase
                  ? 'Loading adaptation context from Firebase...'
                  : 'Resolving adaptation context...'
            }
          />
        </section>
      ) : null}

      {!contextError && adaptContext ? (
        <>
          {ungeneratedSelectablePlatforms.length > 0 ? (
            <section className="surface-card p-5">
              <h2 className="section-title mb-2">Generate Platforms</h2>
              <p className="mb-3 text-xs text-slate-500">
                Choose platforms to generate. Already-generated platforms appear as tabs below.
              </p>

              <div className="flex flex-wrap gap-2">
                {ungeneratedSelectablePlatforms.map((platform) => {
                  const selected = selectedPlatforms.includes(platform.key);
                  return (
                    <button
                      key={platform.key}
                      type="button"
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                      onClick={() => togglePlatformSelection(platform.key)}
                    >
                      {platform.label}
                    </button>
                  );
                })}
              </div>

              {gateError ? <p className="mt-3 text-sm text-red-700">{gateError}</p> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                  style={{ background: '#1a7a5e' }}
                  onClick={() => {
                    void startSequentialGeneration();
                  }}
                  disabled={isSequenceRunning || selectedPlatforms.filter((p) => !generatedPlatforms.has(p)).length === 0}
                >
                  {isSequenceRunning ? <Spinner size="sm" label="Generating..." /> : 'Continue and Generate'}
                </button>
              </div>
            </section>
          ) : null}

          {tabVisiblePlatforms.length > 0 ? (
            <section className="surface-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="section-title">Platform Content</h2>
                {isSequenceRunning ? (
                  <span className="text-xs text-slate-500">Generating sequence...</span>
                ) : null}
              </div>

              <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 pb-3">
                {tabVisiblePlatforms.map((platformMeta) => {
                  const state = platformStates[platformMeta.key];
                  const isActive = activePlatform === platformMeta.key;
                  const isInProgress = state.status === 'running' || state.status === 'queued';
                  return (
                    <button
                      key={platformMeta.key}
                      type="button"
                      onClick={() => setActivePlatform(platformMeta.key)}
                      className={`flex items-center gap-1.5 rounded-t-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        isActive
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`inline-flex h-4 min-w-4 items-center justify-center rounded text-[9px] font-bold text-white ${platformMeta.accentClass}`}
                      >
                        {platformMeta.label.slice(0, 1)}
                      </span>
                      {platformMeta.label}
                      {isInProgress ? <Spinner size="sm" /> : null}
                    </button>
                  );
                })}
              </div>

              {(() => {
                const platformMeta = PLATFORM_CONFIG.find((p) => p.key === activePlatform) ?? PLATFORM_CONFIG[0];
                const state = platformStates[activePlatform];
                const seo = seoByPlatform[activePlatform];
                const text = platforms[activePlatform] ?? '';
                const words = text.trim() ? text.trim().split(/\s+/).length : 0;
                const hasInlineOverlay = Boolean(
                  selection.text.trim() || instruction.trim() || activePendingInlineChange || inlineEditor.isLoading || inlineEditor.error,
                );

                if (!tabVisiblePlatforms.some((p) => p.key === activePlatform)) {
                  return null;
                }

                return (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-5 min-w-5 items-center justify-center rounded text-[10px] font-bold text-white ${platformMeta.accentClass}`}
                        >
                          {platformMeta.label.slice(0, 1)}
                        </span>
                        <span className="font-semibold text-slate-800">{platformMeta.label}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{words} words</span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-semibold ${
                            state.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700'
                              : state.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : state.status === 'running'
                                  ? 'bg-blue-100 text-blue-700'
                                  : state.status === 'queued'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {state.status}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-semibold ${
                            seo.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700'
                              : seo.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : seo.status === 'pending'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          SEO: {seo.status}
                        </span>
                      </div>
                    </div>

                    {state.error ? <p className="mb-2 text-xs text-red-700">{state.error}</p> : null}
                    {seo.error ? <p className="mb-2 text-xs text-red-700">SEO: {seo.error}</p> : null}

                    {researchLogByPlatform[activePlatform] ? (() => {
                      const log = researchLogByPlatform[activePlatform]!;
                      return (
                        <div className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                          log.provider === 'exa'
                            ? 'border-teal-200 bg-teal-50 text-teal-800'
                            : log.provider === 'unavailable'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`}>
                          <span>{log.provider === 'unavailable' ? '⚠️' : '🔍'}</span>
                          <span>
                            {log.provider === 'exa'
                              ? `Exa · "${log.query}" · ${log.sourceCount} source${log.sourceCount !== 1 ? 's' : ''}`
                              : log.provider === 'unavailable'
                              ? 'No live sources — add an Exa key in Settings. Factual claims appear as ALL-CAPS placeholders.'
                              : `${log.provider === 'duckduckgo' || log.provider === 'duckduckgo-html' ? 'DuckDuckGo' : log.provider} · "${log.query}" · ${log.sourceCount} source${log.sourceCount !== 1 ? 's' : ''}`}
                          </span>
                        </div>
                      );
                    })() : null}

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
                      <div className="relative">
                        <div className="mb-2 flex gap-1">
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${!previewModeByPlatform[activePlatform] ? 'bg-emerald-700 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                            onClick={() => setPreviewModeByPlatform((prev) => ({ ...prev, [activePlatform]: false }))}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${previewModeByPlatform[activePlatform] ? 'bg-emerald-700 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                            onClick={() => setPreviewModeByPlatform((prev) => ({ ...prev, [activePlatform]: true }))}
                          >
                            Preview
                          </button>
                        </div>

                        {previewModeByPlatform[activePlatform] ? (
                          <div className="min-h-[180px] rounded-xl border border-slate-300 bg-white p-4">
                            <CitationHighlightPreview content={text} />
                          </div>
                        ) : (
                          <>
                            <textarea
                              className="min-h-[180px] w-full resize-y rounded-xl border border-slate-300 p-3 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                              value={text}
                              onChange={(event) => {
                                setPlatforms((previous) => ({
                                  ...previous,
                                  [activePlatform]: event.target.value,
                                }));
                                setContentVersion((previous) => ({
                                  ...previous,
                                  [activePlatform]: previous[activePlatform] + 1,
                                }));
                              }}
                              onSelect={(event) => captureSelection(activePlatform, event.currentTarget)}
                              onKeyUp={(event) => captureSelection(activePlatform, event.currentTarget)}
                              onMouseUp={(event) => captureSelection(activePlatform, event.currentTarget)}
                              placeholder={`Adapted ${platformMeta.label} copy appears here.`}
                            />

                            {activePlatformChatDiffs.length > 0 ? (
                              <div className="pointer-events-none absolute inset-x-3 bottom-3 max-h-52 overflow-auto rounded-xl border border-slate-300 bg-white/95 p-2 shadow-sm">
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                  Pending AI sentence diffs in editor
                                </p>
                                <div className="space-y-2">
                                  {activePlatformChatDiffs.map((diff) => (
                                    <div key={diff.id} className="pointer-events-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                                      <p className="mb-1 text-[11px] font-semibold text-slate-600">Sentence change</p>
                                      <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800 line-through">{diff.beforeText || '(insert)'}</p>
                                      <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{diff.afterText || '(remove)'}</p>
                                      {diff.message ? <p className="mt-1 text-[11px] text-amber-700">{diff.message}</p> : null}
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          className="rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                                          onClick={() => handleKeepPlatformChatDiff(diff.id)}
                                          disabled={diff.status !== 'pending'}
                                          aria-label="Keep this sentence diff"
                                        >
                                          Keep
                                        </button>
                                        <button
                                          type="button"
                                          className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                          onClick={() => handleUndoPlatformChatDiff(diff.id)}
                                          aria-label="Undo this sentence diff"
                                        >
                                          Undo
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            <InlineEditPanel
                              isVisible={hasInlineOverlay}
                              anchorTop={floatingAnchor.top}
                              anchorLeft={floatingAnchor.left}
                              selectedText={selection.text}
                              instruction={instruction}
                              onInstructionChange={setInstruction}
                              onPropose={() => {
                                void inlineEditor.proposeChange({ selection, instruction }).then(() => {
                                  setInstruction('');
                                });
                              }}
                              isLoading={inlineEditor.isLoading}
                              error={inlineEditor.error}
                              pendingChange={activePendingInlineChange}
                              onAcceptPending={() => {
                                if (activePendingInlineChange) {
                                  inlineEditor.acceptChange(activePendingInlineChange.id);
                                }
                              }}
                              onDenyPending={() => {
                                if (activePendingInlineChange) {
                                  inlineEditor.denyChange(activePendingInlineChange.id);
                                }
                              }}
                            />
                          </>
                        )}
                      </div>

                      <div className="xl:sticky xl:top-5">
                        <AIEditTimeline
                          entries={activeAiHistory.entries}
                          activeEntryId={activeAiHistory.activeEntryId}
                          onRestore={handleRestorePlatformAIEdit}
                          title={`${platformMeta.label} AI Timeline`}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          void retryPlatform(activePlatform);
                        }}
                        disabled={state.status === 'running'}
                      >
                        {state.status === 'running' ? 'Generating...' : 'Retry Platform'}
                      </button>

                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          void retrySeo(activePlatform);
                        }}
                        disabled={seo.status === 'pending'}
                      >
                        {seo.status === 'pending' ? 'SEO Pending...' : 'Retry SEO'}
                      </button>
                    </div>

                    <div className="mt-4">
                      <DraftChatPanel
                        title="AI Chat Assistant"
                        helperText="Chat returns sentence-level diffs in this editor. Keep or Undo each diff independently."
                        providerLabel={
                          chatProviderByPlatform[activePlatform]
                            ? `Chat provider: ${chatProviderByPlatform[activePlatform]}`
                            : null
                        }
                        messages={chatHistoryByPlatform[activePlatform] ?? []}
                        inputValue={chatInputByPlatform[activePlatform] ?? ''}
                        onInputChange={(next) => {
                          setChatInputByPlatform((previous) => ({
                            ...previous,
                            [activePlatform]: next,
                          }));
                        }}
                        onSend={() => {
                          void handleSendPlatformChat();
                        }}
                        isSending={isChatSending}
                        error={chatError}
                        pendingDiffCount={activePlatformPendingDiffCount}
                      />
                    </div>

                    {seo.result ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-slate-50 p-2 text-xs">
                          <p className="font-semibold text-slate-700">Readability</p>
                          <p className="text-slate-600">
                            {seo.result.readabilityScore} ({seo.result.readabilityGrade})
                          </p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2 text-xs">
                          <p className="font-semibold text-slate-700">Primary keyword</p>
                          <p className="text-slate-600">{seo.result.primaryKeyword}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2 text-xs">
                          <p className="font-semibold text-slate-700">Density</p>
                          <p className="text-slate-600">{seo.result.keywordDensity}%</p>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                      <AIToolbox
                        draft={text}
                        ideaContext={
                          adaptContext
                            ? {
                                topic: adaptContext.idea.topic,
                                audience: adaptContext.idea.audience,
                                tone: adaptContext.idea.tone,
                                format: platformMeta.label,
                              }
                            : null
                        }
                        hasApiKeyConfigured={hasApiKey}
                        enableSimilarPosts
                        onApplyDraft={(nextDraft, summary, label) => {
                          recordPlatformAIEdit(activePlatform, text, nextDraft, summary, label ?? 'AI tool');
                          setPlatforms((previous) => ({
                            ...previous,
                            [activePlatform]: nextDraft,
                          }));
                          setContentVersion((previous) => ({
                            ...previous,
                            [activePlatform]: previous[activePlatform] + 1,
                          }));
                          setToolboxNoticeByPlatform((previous) => ({
                            ...previous,
                            [activePlatform]: summary,
                          }));
                          setPlagiarismByPlatform((previous) => ({
                            ...previous,
                            [activePlatform]: null,
                          }));
                        }}
                        onPlagiarismResult={(result) =>
                          setPlagiarismByPlatform((previous) => ({
                            ...previous,
                            [activePlatform]: result,
                          }))
                        }
                      />
                      {toolboxNoticeByPlatform[activePlatform] ? (
                        <p className="mt-2 text-xs text-emerald-700">{toolboxNoticeByPlatform[activePlatform]}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })()}
            </section>
          ) : null}

          {hasStarted ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                disabled={isSaving || !firebaseLoaded}
                onClick={() => void saveAdaptation(platforms, activePlatform, selectedPlatforms)}
              >
                {isSaving ? <Spinner size="sm" label="Saving..." /> : 'Save Adaptation'}
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  if (!adaptContext) {
                    return;
                  }

                  const publishContext: AdaptDraftContext = {
                    ideaId: adaptContext.ideaId,
                    angleId: adaptContext.angleId,
                    idea: adaptContext.idea,
                    selectedAngle: adaptContext.selectedAngle,
                    draftContent: adaptContext.draftContent,
                  };

                  void (async () => {
                    const nextSelected = selectedPlatforms.length > 0 ? selectedPlatforms : [activePlatform];
                    await saveAdaptation(platforms, activePlatform, nextSelected);

                    localStorage.setItem(ADAPT_CONTEXT_STORAGE_KEY, JSON.stringify(publishContext));
                    setWorkflowContext({
                      ideaId: adaptContext.ideaId,
                      angleId: adaptContext.angleId,
                      ideaTopic: adaptContext.idea.topic,
                    });
                    router.push('/publish');
                  })();
                }}
              >
                Send to Publish & Schedule
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
