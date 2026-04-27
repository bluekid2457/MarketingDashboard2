'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import { getActiveAIKey } from '@/lib/aiConfig';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { Spinner } from '@/components/Spinner';
import { InlineEditPanel } from '@/components/InlineEditPanel';
import { DraftChatPanel, type DraftChatMessage } from '@/components/DraftChatPanel';
import { useInlineEdit, type InlineSelection } from '@/lib/useInlineEdit';
import { applyChatSentenceDiff, buildSentenceSpanDiffs, rangesOverlap, type ChatSentenceDiff } from '@/lib/chatSpanDiff';
import WorkflowStepper from '@/components/WorkflowStepper';
import { runCitationCheck } from '@/lib/citationCheck';
import { AIToolbox, type PlagiarismResult } from '@/components/AIToolbox';

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

type StoryboardContext = {
  ideaId: string;
  angleId: string;
  selectedAngle: Angle;
  idea: IdeaRecord;
};

type AdaptDraftContext = StoryboardContext & {
  draftContent: string;
};

type DraftApiResponse = {
  draft?: string;
  provider?: string;
  error?: string;
};

type DraftChatApiResponse = {
  reply?: string;
  updatedDraft?: string | null;
  provider?: string;
  error?: string;
};

type FloatingAnchor = {
  top: number;
  left: number;
};

const STORYBOARD_CONTEXT_STORAGE_KEY = 'draft_generation_context';
const ADAPT_CONTEXT_STORAGE_KEY = 'adapt_draft_context';
const SAVE_DEBOUNCE_MS = 2000;

function extractSourceUrls(markdown: string): string[] {
  const markdownLinkMatches = [...markdown.matchAll(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/gi)].map((match) => match[1]);
  const directUrlMatches = markdown.match(/https?:\/\/[^\s)]+/gi) ?? [];
  return [...new Set([...markdownLinkMatches, ...directUrlMatches].map((entry) => entry.replace(/[.,;:!?]+$/, '')))].filter(Boolean);
}


export default function StoryboardEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const angleIdFromQuery = useMemo(() => searchParams.get('angleId')?.trim() ?? '', [searchParams]);
  const ideaId = useMemo(() => (typeof params?.id === 'string' ? params.id : ''), [params]);

  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [storyboardContext, setStoryboardContext] = useState<StoryboardContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  const [storyboardText, setStoryboardText] = useState('');
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
  const [lastProvider, setLastProvider] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [firebaseLoaded, setFirebaseLoaded] = useState(false);
  const [isFirebaseDraftLoading, setIsFirebaseDraftLoading] = useState(false);
  const [isLoadingContextFromFirebase, setIsLoadingContextFromFirebase] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSaveRef = useRef(true);

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [selection, setSelection] = useState<InlineSelection>({ start: 0, end: 0, text: '' });
  const [floatingAnchor, setFloatingAnchor] = useState<FloatingAnchor>({ top: 12, left: 12 });
  const [instruction, setInstruction] = useState('');
  const [chatMessages, setChatMessages] = useState<DraftChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatSending, setIsChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatProvider, setChatProvider] = useState<string | null>(null);
  const [chatPendingDiffs, setChatPendingDiffs] = useState<ChatSentenceDiff[]>([]);
  const inlineEditor = useInlineEdit({ text: storyboardText, setText: setStoryboardText });

  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [plagiarismResult, setPlagiarismResult] = useState<PlagiarismResult | null>(null);
  const [toolboxNotice, setToolboxNotice] = useState<string | null>(null);

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

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!ideaId || !angleIdFromQuery) {
      setContextError('Missing idea or angle in URL. Please open a storyboard from the list.');
      setStoryboardContext(null);
      return;
    }

    // Try localStorage first — fast path when navigating from Angles page
    const rawContext = localStorage.getItem(STORYBOARD_CONTEXT_STORAGE_KEY);
    if (rawContext) {
      try {
        const parsed = JSON.parse(rawContext) as StoryboardContext;
        if (
          parsed.ideaId === ideaId &&
          parsed.angleId === angleIdFromQuery &&
          parsed.selectedAngle &&
          parsed.idea
        ) {
          setStoryboardContext(parsed);
          setContextError(null);
          return;
        }
      } catch {
        // Invalid localStorage — fall through to Firestore load
      }
    }

    // localStorage didn't match — will load from Firestore in the Firebase useEffect below
    setStoryboardContext(null);
    setContextError(null);
  }, [angleIdFromQuery, ideaId]);

  useEffect(() => {
    if (!currentUid || firebaseLoaded) return;
    if (!storyboardContext && (!ideaId || !angleIdFromQuery)) return;

    const db = getFirebaseDb();
    if (!db) {
      setFirebaseLoaded(true);
      return;
    }

    const resolvedIdeaId = storyboardContext?.ideaId ?? ideaId;
    const resolvedAngleId = storyboardContext?.angleId ?? angleIdFromQuery;

    if (!resolvedIdeaId || !resolvedAngleId) {
      setFirebaseLoaded(true);
      return;
    }

    const docId = `${resolvedIdeaId}_${resolvedAngleId}`;
    const docRef = doc(db, 'users', currentUid, 'drafts', docId);
    setIsFirebaseDraftLoading(true);

    void (async () => {
      try {
        // If context is missing, load idea + angle from Firestore to build it
        if (!storyboardContext) {
          setIsLoadingContextFromFirebase(true);
          try {
            const [ideaSnap, anglesSnap] = await Promise.all([
              getDoc(doc(db, 'users', currentUid, 'ideas', resolvedIdeaId)),
              getDoc(doc(db, 'users', currentUid, 'ideas', resolvedIdeaId, 'workflow', 'angles')),
            ]);

            if (!ideaSnap.exists()) {
              setContextError('Could not find the idea for this storyboard. It may have been deleted.');
              setFirebaseLoaded(true);
              return;
            }

            const ideaData = ideaSnap.data();
            const loadedIdea = {
              id: ideaSnap.id,
              topic: typeof ideaData.topic === 'string' ? ideaData.topic : '',
              tone: typeof ideaData.tone === 'string' ? ideaData.tone : '',
              audience: typeof ideaData.audience === 'string' ? ideaData.audience : '',
              format: typeof ideaData.format === 'string' ? ideaData.format : '',
            };

            let loadedAngle: { id: string; title: string; summary: string; sections: string[] } | null = null;

            if (anglesSnap.exists()) {
              const anglesData = anglesSnap.data();
              const anglesArray = Array.isArray(anglesData.angles) ? anglesData.angles : [];
              const matched = anglesArray.find(
                (a: { id?: unknown }) => typeof a.id === 'string' && a.id === resolvedAngleId,
              );
              if (matched && typeof matched.title === 'string') {
                loadedAngle = {
                  id: matched.id as string,
                  title: matched.title as string,
                  summary: typeof matched.summary === 'string' ? matched.summary : '',
                  sections: Array.isArray(matched.sections)
                    ? (matched.sections as unknown[]).filter((s): s is string => typeof s === 'string')
                    : [],
                };
              }
            }

            if (!loadedAngle) {
              // Angle not found in workflow — create a minimal placeholder so the editor still opens
              loadedAngle = {
                id: resolvedAngleId,
                title: 'Storyboard',
                summary: '',
                sections: [],
              };
            }

            const builtContext: StoryboardContext = {
              ideaId: resolvedIdeaId,
              angleId: resolvedAngleId,
              idea: loadedIdea,
              selectedAngle: loadedAngle,
            };

            setStoryboardContext(builtContext);
            setContextError(null);
          } catch {
            setContextError('Unable to load storyboard context from the database. Please try again.');
            setFirebaseLoaded(true);
            return;
          } finally {
            setIsLoadingContextFromFirebase(false);
          }
        }

        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (typeof data.content === 'string' && data.content.trim()) {
            setStoryboardText(data.content);
            const ts = data.updatedAt as { toDate?: () => Date } | null;
            setSavedAt(ts?.toDate?.() ?? null);
            isFirstSaveRef.current = false;
          }
        }
      } finally {
        setIsFirebaseDraftLoading(false);
        setFirebaseLoaded(true);
      }
    })();
  }, [angleIdFromQuery, currentUid, firebaseLoaded, ideaId, storyboardContext]);

  const saveStoryboard = useCallback(
    async (content: string): Promise<void> => {
      if (!currentUid || !storyboardContext) return;

      const db = getFirebaseDb();
      if (!db) {
        setSaveError('Firebase not available. Storyboard not saved to cloud.');
        return;
      }

      setIsSaving(true);
      setSaveError(null);

      try {
        const docId = `${storyboardContext.ideaId}_${storyboardContext.angleId}`;
        const docRef = doc(db, 'users', currentUid, 'drafts', docId);

        const payload: Record<string, unknown> = {
          content,
          ideaId: storyboardContext.ideaId,
          angleId: storyboardContext.angleId,
          ideaTopic: storyboardContext.idea.topic,
          angleTitle: storyboardContext.selectedAngle.title,
          status: 'storyboard',
          updatedAt: serverTimestamp(),
        };

        if (isFirstSaveRef.current) {
          payload.createdAt = serverTimestamp();
          isFirstSaveRef.current = false;
        }

        await setDoc(docRef, payload, { merge: true });
        setSavedAt(new Date());
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Failed to save storyboard.');
      } finally {
        setIsSaving(false);
      }
    },
    [currentUid, storyboardContext],
  );

  useEffect(() => {
    if (!storyboardText || !firebaseLoaded) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveStoryboard(storyboardText);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [firebaseLoaded, saveStoryboard, storyboardText]);

  const generateStoryboard = useCallback(async (): Promise<void> => {
    if (!storyboardContext) return;

    const activeConfig = getActiveAIKey();
    if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
      setStoryboardError('No AI API key found. Add a key in Settings before generating storyboard content.');
      return;
    }

    if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
      setStoryboardError('No Ollama model set. Add an Ollama model in Settings before generating storyboard content.');
      return;
    }

    setStoryboardError(null);
    setIsGeneratingStoryboard(true);

    try {
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeConfig.provider,
          apiKey: activeConfig.apiKey,
          ollamaBaseUrl: activeConfig.ollamaBaseUrl,
          ollamaModel: activeConfig.ollamaModel,
          idea: {
            topic: storyboardContext.idea.topic,
            tone: storyboardContext.idea.tone,
            audience: storyboardContext.idea.audience,
            format: storyboardContext.idea.format,
          },
          angle: storyboardContext.selectedAngle,
        }),
      });

      const payload = (await response.json()) as DraftApiResponse;
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? 'Storyboard generation failed.');
      }

      setStoryboardText(payload.draft);
      setLastProvider(payload.provider ?? activeConfig.provider);
    } catch (error) {
      setStoryboardError(error instanceof Error ? error.message : 'Unable to generate storyboard right now.');
    } finally {
      setIsGeneratingStoryboard(false);
    }
  }, [storyboardContext]);

  useEffect(() => {
    if (!storyboardContext || !firebaseLoaded || storyboardText || isGeneratingStoryboard) return;
    void generateStoryboard();
  }, [firebaseLoaded, generateStoryboard, isGeneratingStoryboard, storyboardContext, storyboardText]);

  const captureSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    setSelection({ start, end, text: storyboardText.slice(start, end) });

    const selectionEnd = end >= start ? end : start;
    const textBeforeCaret = storyboardText.slice(0, selectionEnd);
    const lines = textBeforeCaret.split('\n');
    const currentLine = lines[lines.length - 1] ?? '';
    const approximateLeft = Math.min(Math.max(12, 12 + currentLine.length * 7), Math.max(12, el.clientWidth - 280));
    const approximateTop = Math.min(Math.max(12, 14 + (lines.length - 1) * 22), Math.max(12, el.clientHeight - 160));
    setFloatingAnchor({ top: approximateTop, left: approximateLeft });
  }, [storyboardText]);

  const handleProposeInlineEdit = useCallback(async (): Promise<void> => {
    await inlineEditor.proposeChange({
      selection,
      instruction,
    });
    setInstruction('');
  }, [inlineEditor, instruction, selection]);

  const citationCheck = useMemo(() => runCitationCheck(storyboardText), [storyboardText]);
  const wordCount = useMemo(() => (storyboardText.trim() ? storyboardText.trim().split(/\s+/).length : 0), [storyboardText]);
  const sourceUrls = useMemo(() => extractSourceUrls(storyboardText), [storyboardText]);
  const savedAtText = useMemo(() => savedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? null, [savedAt]);
  const activePendingInlineChange = useMemo(
    () => inlineEditor.changes.find((change) => change.status === 'pending') ?? null,
    [inlineEditor.changes],
  );
  const visibleChatDiffs = useMemo(
    () => chatPendingDiffs.filter((diff) => diff.status === 'pending' || diff.status === 'conflict'),
    [chatPendingDiffs],
  );
  const pendingChatDiffCount = useMemo(
    () => chatPendingDiffs.filter((diff) => diff.status === 'pending').length,
    [chatPendingDiffs],
  );
  const hasInlineOverlay = Boolean(selection.text.trim() || instruction.trim() || activePendingInlineChange || inlineEditor.isLoading || inlineEditor.error);

  const handleKeepChatDiff = useCallback(
    (diffId: string): void => {
      const target = chatPendingDiffs.find((entry) => entry.id === diffId);
      if (!target || target.status !== 'pending') {
        return;
      }

      setStoryboardText((currentText) => {
        const applied = applyChatSentenceDiff(currentText, target);
        if (!applied) {
          setChatPendingDiffs((previous) =>
            previous.map((entry) =>
              entry.id === diffId
                ? {
                    ...entry,
                    status: 'conflict',
                    message: 'Source sentence moved. Undo this diff and request another chat revision.',
                  }
                : entry,
            ),
          );
          return currentText;
        }

        const delta = target.afterText.length - applied.replacedLength;
        const replacedStart = applied.appliedStart;
        const replacedEndBeforeWrite = replacedStart + applied.replacedLength;

        setChatPendingDiffs((previous) =>
          previous.flatMap((entry) => {
            if (entry.id === diffId) {
              return [];
            }

            if (entry.status !== 'pending' && entry.status !== 'conflict') {
              return [entry];
            }

            if (rangesOverlap(entry.start, entry.end, replacedStart, replacedEndBeforeWrite)) {
              return [
                {
                  ...entry,
                  status: 'conflict',
                  message: 'Overlaps a kept sentence change. Undo and regenerate to refresh this diff.',
                },
              ];
            }

            if (entry.start >= replacedEndBeforeWrite) {
              return [
                {
                  ...entry,
                  start: entry.start + delta,
                  end: entry.end + delta,
                },
              ];
            }

            return [entry];
          }),
        );

        setChatError(null);
        return applied.nextText;
      });
    },
    [chatPendingDiffs],
  );

  const handleUndoChatDiff = useCallback((diffId: string): void => {
    setChatPendingDiffs((previous) => previous.filter((entry) => entry.id !== diffId));
    setChatError(null);
  }, []);

  const handleSendChat = useCallback(async (): Promise<void> => {
    const nextMessage = chatInput.trim();
    if (!nextMessage) return;

    const activeConfig = getActiveAIKey();
    if (activeConfig.provider !== 'ollama' && !activeConfig.apiKey) {
      setChatError('No AI API key found. Add a key in Settings before using AI chat.');
      return;
    }

    if (activeConfig.provider === 'ollama' && !activeConfig.ollamaModel.trim()) {
      setChatError('No Ollama model is configured. Update Settings before using AI chat.');
      return;
    }

    const userEntry: DraftChatMessage = { role: 'user', content: nextMessage };
    const messageHistory = [...chatMessages, userEntry];
    setChatMessages(messageHistory);
    setChatInput('');
    setIsChatSending(true);
    setChatError(null);

    try {
      const response = await fetch('/api/drafts/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeConfig.provider,
          apiKey: activeConfig.apiKey,
          ollamaBaseUrl: activeConfig.ollamaBaseUrl,
          ollamaModel: activeConfig.ollamaModel,
          draft: storyboardText,
          messages: chatMessages,
          userMessage: nextMessage,
        }),
      });

      const payload = (await response.json()) as DraftChatApiResponse;
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error ?? 'AI chat failed.');
      }

      setChatMessages((previous) => [...previous, { role: 'assistant', content: payload.reply ?? '' }]);
      setChatProvider(payload.provider ?? activeConfig.provider);

      const updatedDraft = payload.updatedDraft?.trim();
      if (updatedDraft && updatedDraft !== storyboardText) {
        const proposedDiffs = buildSentenceSpanDiffs(storyboardText, updatedDraft);
        if (proposedDiffs.length === 0) {
          setChatError('AI responded, but no sentence-level diff could be mapped. Try a more specific instruction.');
          return;
        }
        setChatPendingDiffs((previous) => [...proposedDiffs, ...previous]);
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'AI chat failed.');
    } finally {
      setIsChatSending(false);
    }
  }, [chatInput, chatMessages, storyboardText]);

  const canAdaptStoryboard = Boolean(storyboardContext && storyboardText.trim());

  const goToAdaptPage = useCallback(() => {
    if (!storyboardContext || !storyboardText.trim()) return;

    const adaptContext: AdaptDraftContext = {
      ideaId: storyboardContext.ideaId,
      angleId: storyboardContext.angleId,
      idea: storyboardContext.idea,
      selectedAngle: storyboardContext.selectedAngle,
      draftContent: storyboardText,
    };

    localStorage.setItem(ADAPT_CONTEXT_STORAGE_KEY, JSON.stringify(adaptContext));
    router.push(`/adapt/${storyboardContext.ideaId}?angleId=${storyboardContext.angleId}`);
  }, [router, storyboardContext, storyboardText]);

  const handleSubmitForReview = useCallback(() => {
    router.push('/review');
  }, [router]);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1>Storyboard Editor</h1>
        <p className="breadcrumb mt-1">Angles {'->'} Storyboard (Active) {'->'} Adapt {'->'} Review {'->'} Schedule</p>

        {storyboardContext ? (
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm" style={{ color: '#a7c9be' }}>
            <span>
              Idea: <span className="font-semibold text-white">{storyboardContext.idea.topic}</span>
            </span>
            <span>
              Angle: <span className="font-semibold text-white">{storyboardContext.selectedAngle.title}</span>
            </span>
            {lastProvider ? (
              <span>
                Generated by: <span className="font-semibold text-white">{lastProvider}</span>
              </span>
            ) : null}
            {inlineEditor.lastProvider ? (
              <span>
                Inline editor: <span className="font-semibold text-white">{inlineEditor.lastProvider}</span>
              </span>
            ) : null}
            {isSaving ? (
              <span className="text-yellow-300">
                <Spinner size="sm" label="Saving..." />
              </span>
            ) : savedAt ? (
              <span className="text-green-300">Saved at {savedAtText}</span>
            ) : null}
            {saveError ? <span className="text-red-400">{saveError}</span> : null}
          </div>
        ) : null}
      </div>
      <WorkflowStepper />

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
          <section className="surface-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="section-title">Storyboard Content</h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs text-slate-600">{wordCount} words</span>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  disabled={isGeneratingStoryboard || !storyboardContext}
                  onClick={() => void generateStoryboard()}
                >
                  {isGeneratingStoryboard ? <Spinner size="sm" label="Generating..." /> : 'Regenerate Storyboard'}
                </button>
              </div>
            </div>

            {storyboardError ? (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {storyboardError}
              </div>
            ) : null}

            {isLoadingContextFromFirebase ? (
              <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
                <Spinner size="sm" />
                <span>Loading storyboard context...</span>
              </div>
            ) : isFirebaseDraftLoading ? (
              <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
                <Spinner size="sm" />
                <span>Loading storyboard from Firebase...</span>
              </div>
            ) : null}

            <div className="relative">
              <textarea
                ref={editorRef}
                className="min-h-[480px] w-full resize-y rounded-xl border border-slate-300 p-4 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                value={storyboardText}
                onChange={(event) => {
                  setStoryboardText(event.target.value);
                }}
                onSelect={captureSelection}
                onKeyUp={captureSelection}
                onMouseUp={captureSelection}
                placeholder="Your storyboard draft appears here."
                spellCheck
              />

              {visibleChatDiffs.length > 0 ? (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 max-h-56 overflow-auto rounded-xl border border-slate-300 bg-white/95 p-2 shadow-sm">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Pending AI sentence diffs in editor
                  </p>
                  <div className="space-y-2">
                    {visibleChatDiffs.map((diff) => (
                      <div key={diff.id} className="pointer-events-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="mb-1 text-[11px] font-semibold text-slate-600">Sentence change</p>
                        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800 line-through">{diff.beforeText || '(insert)'}</p>
                        <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{diff.afterText || '(remove)'}</p>
                        {diff.message ? <p className="mt-1 text-[11px] text-amber-700">{diff.message}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                            onClick={() => handleKeepChatDiff(diff.id)}
                            disabled={diff.status !== 'pending'}
                            aria-label="Keep this sentence diff"
                          >
                            Keep
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                            onClick={() => handleUndoChatDiff(diff.id)}
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
                  void handleProposeInlineEdit();
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
            </div>
          </section>

          <section className="surface-card p-5">
            <AIToolbox
              draft={storyboardText}
              ideaContext={
                storyboardContext
                  ? {
                      topic: storyboardContext.idea.topic,
                      audience: storyboardContext.idea.audience,
                      tone: storyboardContext.idea.tone,
                      format: storyboardContext.idea.format,
                    }
                  : null
              }
              hasApiKeyConfigured={hasApiKey}
              onApplyDraft={(nextDraft, summary) => {
                setStoryboardText(nextDraft);
                setToolboxNotice(summary);
                setPlagiarismResult(null);
                setChatPendingDiffs([]);
              }}
              onPlagiarismResult={(result) => setPlagiarismResult(result)}
            />
            {toolboxNotice ? (
              <p className="mt-2 text-xs text-emerald-700">{toolboxNotice}</p>
            ) : null}
          </section>

          <section className="surface-card p-5">
            <DraftChatPanel
              title="AI Chat Assistant"
              helperText="Ask for rewrites. AI returns sentence-level diffs that render in the editor with per-change Keep/Undo."
              providerLabel={chatProvider ? `Chat provider: ${chatProvider}` : null}
              messages={chatMessages}
              inputValue={chatInput}
              onInputChange={setChatInput}
              onSend={() => {
                void handleSendChat();
              }}
              isSending={isChatSending}
              error={chatError}
              pendingDiffCount={pendingChatDiffCount}
              hasApiKeyConfigured={hasApiKey}
              toneSuggestions={[
                { label: 'Make it more concise', prompt: 'Tighten the prose. Remove filler words and combine related sentences. Keep the same structure.' },
                { label: 'Add concrete examples', prompt: 'Add 2-3 short concrete examples that illustrate the main points. Keep the existing flow.' },
                { label: 'Sharpen the hook', prompt: 'Rewrite the opening so it grabs attention in the first sentence with a specific stakes-led hook.' },
                { label: 'Cut hype language', prompt: 'Rewrite to remove hype words ("revolutionary", "game-changing", etc.) and replace them with specific evidence.' },
                { label: 'Add a CTA', prompt: 'Add a single clear call to action at the end. Keep the rest of the draft unchanged.' },
              ]}
              onApplyToneSuggestion={(prompt) => setChatInput(prompt)}
            />
          </section>

          <section className="surface-card p-5">
            <h2 className="section-title mb-2">References</h2>
            <p className="mb-2 text-xs text-slate-500">
              Suggestions below are informational only and do not block submission.
            </p>

            {citationCheck.uncitedClaims.length > 0 ? (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-semibold">Uncited factual claims</p>
                <ul className="mt-1 space-y-1">
                  {citationCheck.uncitedClaims.map((claim) => (
                    <li key={claim}>- {claim}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {citationCheck.references.length === 0 ? (
              <p className="text-sm text-slate-500">No references detected yet. Add a Sources section with citation links.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {citationCheck.references.map((entry) => (
                  <li key={`${entry.marker}-${entry.url}`}>
                    <span className="mr-2 font-semibold text-slate-600">{entry.marker}</span>
                    <a
                      className="text-blue-700 underline hover:text-blue-900"
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {entry.label || entry.url}
                    </a>
                    {entry.label ? (
                      <p className="ml-6 break-all text-[11px] text-slate-400">{entry.url}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {citationCheck.missingReferenceMarkers.length > 0 ? (
              <p className="mt-3 text-xs text-red-700">
                Missing references for citation markers: {citationCheck.missingReferenceMarkers.join(', ')}
              </p>
            ) : null}

            {citationCheck.invalidReferences.length > 0 ? (
              <p className="mt-2 text-xs text-red-700">
                Invalid reference URL format: {citationCheck.invalidReferences.join(', ')}
              </p>
            ) : null}

            {sourceUrls.length > 0 ? (
              <p className="mt-3 text-xs text-slate-500">Detected links in draft: {sourceUrls.length}</p>
            ) : null}
          </section>

          {plagiarismResult ? (
            <section
              className={`surface-card p-4 ${
                plagiarismResult.verdict === 'high-risk'
                  ? 'border border-red-200'
                  : plagiarismResult.verdict === 'review-needed'
                  ? 'border border-amber-200'
                  : 'border border-emerald-200'
              }`}
            >
              <p className="text-sm font-semibold text-slate-900">
                Plagiarism check: {plagiarismResult.verdict.replace('-', ' ')} (risk {plagiarismResult.riskScore}/100)
              </p>
              {plagiarismResult.verdict === 'high-risk' ? (
                <p className="mt-1 text-xs text-red-700">
                  Resolve flagged passages before submitting for review or publishing. The Submit for Review button is disabled until this is no longer high-risk.
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={isSaving || !storyboardText}
              onClick={() => void saveStoryboard(storyboardText)}
            >
              {isSaving ? <Spinner size="sm" label="Saving..." /> : 'Save Storyboard'}
            </button>

            <button
              type="button"
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={!canAdaptStoryboard}
              onClick={goToAdaptPage}
            >
              Adapt for Platforms
            </button>

            <button
              type="button"
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              onClick={handleSubmitForReview}
              disabled={
                !storyboardText.trim() ||
                plagiarismResult?.verdict === 'high-risk'
              }
              title={
                plagiarismResult?.verdict === 'high-risk'
                  ? 'Plagiarism check returned high risk. Resolve flagged passages first.'
                  : !plagiarismResult
                  ? 'Tip: run the plagiarism check in AI Content Tools before submitting.'
                  : undefined
              }
            >
              Submit for Review
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
