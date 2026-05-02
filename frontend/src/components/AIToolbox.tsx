'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { Spinner } from '@/components/Spinner';
import {
  COMPLEXITY_TARGETS,
  calculateReadability,
  describeFlesch,
  type ComplexityLabel,
} from '@/lib/readability';
import { getActiveAIKey } from '@/lib/aiConfig';
import { companyProfileToContextLines, loadCompanyProfile } from '@/lib/companyProfile';

type ToolboxNotice = { tone: 'success' | 'error' | 'info'; message: string };

const TONE_PRESETS: Array<{ key: string; label: string; description: string }> = [
  { key: 'confident-expert', label: 'Confident expert', description: 'Authoritative and direct, light on filler.' },
  { key: 'friendly-coach', label: 'Friendly coach', description: 'Warm, encouraging, second-person voice.' },
  { key: 'analytical', label: 'Analytical', description: 'Data-led, hedged, clear cause-and-effect.' },
  { key: 'punchy-marketer', label: 'Punchy marketer', description: 'High-energy, short sentences, strong hooks.' },
  { key: 'enterprise-formal', label: 'Enterprise formal', description: 'Polished, conservative, no slang.' },
  { key: 'casual-storyteller', label: 'Casual storyteller', description: 'Conversational, anecdotal, flowing.' },
];

const SENTIMENT_PRESETS: Array<{ key: string; label: string; description: string }> = [
  { key: 'optimistic', label: 'Optimistic', description: 'Lean into upside and momentum.' },
  { key: 'balanced', label: 'Balanced', description: 'Acknowledge tradeoffs, neutral tone.' },
  { key: 'urgent', label: 'Urgent', description: 'Highlight cost of inaction without hype.' },
  { key: 'reassuring', label: 'Reassuring', description: 'Calm, lower-stakes framing.' },
  { key: 'critical', label: 'Critical', description: 'Honest about gaps and limits.' },
];

const DEFAULT_PERSONAS: Array<{ id: string; name: string; description: string }> = [
  { id: 'persona-cmo', name: 'CMO', description: 'Strategic marketing leader, cares about pipeline impact and team velocity.' },
  { id: 'persona-founder', name: 'Founder', description: 'Time-constrained operator, cares about pragmatic adoption and ROI.' },
  { id: 'persona-individual', name: 'Individual contributor', description: 'Hands-on practitioner, cares about workflow specifics and tools.' },
];

type HeadlineVariant = {
  id: string;
  variant: 'A' | 'B' | 'C' | 'D' | 'E';
  text: string;
  hookType: string;
  rationale: string;
};

export type PersonaVariant = {
  id: string;
  name: string;
  description: string;
  draft: string;
  pitchAdjustment: string;
};

type ResearchSource = { title: string; url: string; snippet: string };
type ResearchFinding = { claim: string; evidence: string; sourceIndex: number };

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
  webMatches: Array<{ passage: string; matchUrl: string; matchTitle: string; snippet: string }>;
  verdict: 'clean' | 'review-needed' | 'high-risk';
};

export type AIToolboxIdeaContext = {
  topic: string;
  audience: string;
  tone: string;
  format: string;
};

type AIToolboxProps = {
  draft: string;
  ideaContext: AIToolboxIdeaContext | null;
  onApplyDraft: (nextDraft: string, summary: string) => void;
  onPlagiarismResult?: (result: PlagiarismResult | null) => void;
  onPersonaVariantsGenerated?: (variants: PersonaVariant[]) => void;
  hasApiKeyConfigured: boolean;
};

type RewriteApiResponse = { updatedDraft?: string; summary?: string; provider?: string; error?: string };
type HeadlinesApiResponse = { variants?: HeadlineVariant[]; provider?: string; error?: string };
type PersonasApiResponse = { variants?: PersonaVariant[]; provider?: string; error?: string };
type ResearchApiResponse = {
  query?: string;
  sources?: ResearchSource[];
  findings?: ResearchFinding[];
  briefMarkdown?: string;
  searchProvider?: string;
  provider?: string;
  error?: string;
};
type PlagiarismApiResponse = PlagiarismResult & { provider?: string; error?: string };

function formatCommonAuth(): { provider: string; apiKey: string; ollamaBaseUrl: string; ollamaModel: string } {
  const config = getActiveAIKey();
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
  };
}

async function loadCompanyContextLines(): Promise<string[]> {
  const profile = await loadCompanyProfile(null);
  return companyProfileToContextLines(profile);
}

function chunkPersonaInputs(extra: Array<{ name: string; description: string }>): Array<{ id: string; name: string; description: string }> {
  return extra
    .map((entry, index) => ({ id: `extra-persona-${index}`, name: entry.name.trim(), description: entry.description.trim() }))
    .filter((entry) => entry.name.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applySuggestionToDraft(draft: string, passage: string, replacement: string): string | null {
  if (!passage) return null;
  if (draft.includes(passage)) {
    return draft.replace(passage, replacement);
  }

  const normalizedPassage = passage.replace(/\s+/g, ' ').trim();
  if (!normalizedPassage) return null;

  // Allow flexible whitespace and smart-quote variation when locating the passage in the draft.
  const tokens = normalizedPassage
    .split(' ')
    .filter(Boolean)
    .map(escapeRegExp);
  if (tokens.length === 0) return null;

  const flexiblePattern = tokens.join('\\s+').replace(/['"’“”]/g, "['\"’“”]");
  const flexibleRegex = new RegExp(flexiblePattern);
  if (flexibleRegex.test(draft)) {
    return draft.replace(flexibleRegex, replacement);
  }

  return null;
}

function extractFirstUrl(value: string): string | null {
  if (!value) return null;
  const match = value.match(/(https?:\/\/[^\s)<>"]+)/i);
  if (!match) return null;
  return match[1].replace(/[.,;:!?)\]]+$/, '');
}

function renderLikelySource(value: string): ReactNode {
  const url = extractFirstUrl(value);
  if (!url) {
    return <span>{value}</span>;
  }
  const before = value.slice(0, value.indexOf(url));
  const after = value.slice(value.indexOf(url) + url.length);
  return (
    <>
      {before}
      <a
        className="text-blue-700 hover:underline"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {url}
      </a>
      {after}
    </>
  );
}

export function AIToolbox(props: AIToolboxProps) {
  const { draft, ideaContext, onApplyDraft, onPlagiarismResult, onPersonaVariantsGenerated, hasApiKeyConfigured } = props;

  const readability = useMemo(() => calculateReadability(draft), [draft]);
  const [complexityValue, setComplexityValue] = useState<number>(readability.complexityValue);
  const targetComplexity = useMemo(
    () => COMPLEXITY_TARGETS.find((entry) => entry.value === complexityValue) ?? COMPLEXITY_TARGETS[3],
    [complexityValue],
  );

  const [activeTool, setActiveTool] = useState<'tone' | 'readability' | 'personas' | 'headlines' | 'research' | 'plagiarism'>('tone');
  const [notice, setNotice] = useState<ToolboxNotice | null>(null);

  // Tone & sentiment
  const [toneRunning, setToneRunning] = useState<string | null>(null);
  const [sentimentRunning, setSentimentRunning] = useState<string | null>(null);

  // Readability
  const [readabilityRunning, setReadabilityRunning] = useState(false);

  // Personas
  const [personaRows, setPersonaRows] = useState<Array<{ name: string; description: string }>>([
    { name: '', description: '' },
  ]);
  const [includeDefaults, setIncludeDefaults] = useState(true);
  const [personasRunning, setPersonasRunning] = useState(false);
  const [personaVariants, setPersonaVariants] = useState<PersonaVariant[]>([]);
  const [appliedPersonaId, setAppliedPersonaId] = useState<string | null>(null);

  // Headlines
  const [headlinesRunning, setHeadlinesRunning] = useState(false);
  const [headlines, setHeadlines] = useState<HeadlineVariant[]>([]);

  // Research
  const [researchQuery, setResearchQuery] = useState('');
  const [researchRunning, setResearchRunning] = useState(false);
  const [researchResult, setResearchResult] = useState<ResearchApiResponse | null>(null);

  // Plagiarism
  const [plagiarismRunning, setPlagiarismRunning] = useState(false);
  const [plagiarism, setPlagiarism] = useState<PlagiarismResult | null>(null);
  const [appliedFlagKeys, setAppliedFlagKeys] = useState<Record<string, true>>({});

  const requireApiKey = useCallback((): boolean => {
    if (hasApiKeyConfigured) return true;
    setNotice({ tone: 'error', message: 'No AI API key set. Add a key in Settings before running this tool.' });
    return false;
  }, [hasApiKeyConfigured]);

  const requireDraft = useCallback((): boolean => {
    if (draft.trim().length > 0) return true;
    setNotice({ tone: 'error', message: 'Generate or paste storyboard content before running this tool.' });
    return false;
  }, [draft]);

  const runRewrite = useCallback(
    async (mode: 'tone' | 'sentiment' | 'readability', payloadExtras: Record<string, unknown>): Promise<RewriteApiResponse> => {
      const auth = formatCommonAuth();
      const companyContext = await loadCompanyContextLines();
      const response = await fetch('/api/drafts/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...auth,
          draft,
          mode,
          companyContext,
          ...payloadExtras,
        }),
      });
      const payload = (await response.json()) as RewriteApiResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? 'Rewrite request failed.');
      }
      return payload;
    },
    [draft],
  );

  const handleTonePreset = useCallback(
    async (preset: { key: string; label: string; description: string }) => {
      if (!requireDraft() || !requireApiKey()) return;
      setNotice(null);
      setToneRunning(preset.key);
      try {
        const result = await runRewrite('tone', { tone: `${preset.label} — ${preset.description}` });
        if (result.updatedDraft) {
          onApplyDraft(result.updatedDraft, result.summary ?? `Rewritten in a ${preset.label} tone.`);
          setNotice({ tone: 'success', message: `Applied "${preset.label}" tone.` });
        }
      } catch (error) {
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Tone rewrite failed.' });
      } finally {
        setToneRunning(null);
      }
    },
    [onApplyDraft, requireApiKey, requireDraft, runRewrite],
  );

  const handleSentimentPreset = useCallback(
    async (preset: { key: string; label: string; description: string }) => {
      if (!requireDraft() || !requireApiKey()) return;
      setNotice(null);
      setSentimentRunning(preset.key);
      try {
        const result = await runRewrite('sentiment', { sentiment: `${preset.label} — ${preset.description}` });
        if (result.updatedDraft) {
          onApplyDraft(result.updatedDraft, result.summary ?? `Rewritten with ${preset.label} sentiment.`);
          setNotice({ tone: 'success', message: `Applied "${preset.label}" sentiment.` });
        }
      } catch (error) {
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Sentiment rewrite failed.' });
      } finally {
        setSentimentRunning(null);
      }
    },
    [onApplyDraft, requireApiKey, requireDraft, runRewrite],
  );

  const handleReadabilityRewrite = useCallback(async () => {
    if (!requireDraft() || !requireApiKey()) return;
    setNotice(null);
    setReadabilityRunning(true);
    try {
      const result = await runRewrite('readability', {
        complexityLabel: targetComplexity.label,
        complexityDescription: targetComplexity.description,
        audienceHint: targetComplexity.audienceHint,
        fleschTarget: targetComplexity.fleschTarget,
      });
      if (result.updatedDraft) {
        onApplyDraft(result.updatedDraft, result.summary ?? `Rewritten at ${targetComplexity.label} reading level.`);
        setNotice({ tone: 'success', message: `Rewritten for ${targetComplexity.label} (target Flesch ${targetComplexity.fleschTarget}).` });
      }
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Readability rewrite failed.' });
    } finally {
      setReadabilityRunning(false);
    }
  }, [onApplyDraft, requireApiKey, requireDraft, runRewrite, targetComplexity]);

  const buildPersonaList = useCallback((): Array<{ id: string; name: string; description: string }> => {
    const extras = chunkPersonaInputs(personaRows);
    const base = includeDefaults ? DEFAULT_PERSONAS : [];
    const merged = [...base, ...extras];
    const seen = new Set<string>();
    return merged.filter((entry) => {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [includeDefaults, personaRows]);

  const handlePersonas = useCallback(async () => {
    if (!requireDraft() || !requireApiKey()) return;
    const personas = buildPersonaList();
    if (personas.length === 0) {
      setNotice({ tone: 'error', message: 'Add at least one persona name or enable the default personas.' });
      return;
    }
    setNotice(null);
    setPersonasRunning(true);
    setPersonaVariants([]);
    setAppliedPersonaId(null);
    try {
      const auth = formatCommonAuth();
      const companyContext = await loadCompanyContextLines();
      const response = await fetch('/api/drafts/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...auth, draft, personas, companyContext }),
      });
      const payload = (await response.json()) as PersonasApiResponse;
      if (!response.ok || !payload.variants) {
        throw new Error(payload.error ?? 'Persona generation failed.');
      }
      setPersonaVariants(payload.variants);
      onPersonaVariantsGenerated?.(payload.variants);
      setNotice({ tone: 'success', message: `Generated ${payload.variants.length} persona variants.` });
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Persona generation failed.' });
    } finally {
      setPersonasRunning(false);
    }
  }, [buildPersonaList, draft, onPersonaVariantsGenerated, requireApiKey, requireDraft]);

  const handleApplyPersona = useCallback(
    (variant: PersonaVariant) => {
      onApplyDraft(variant.draft, `Applied ${variant.name} persona variant.`);
      setAppliedPersonaId(variant.id);
      setNotice({ tone: 'success', message: `Loaded the "${variant.name}" persona draft into the editor.` });
    },
    [onApplyDraft],
  );

  const handleHeadlines = useCallback(async () => {
    if (!requireDraft() || !requireApiKey()) return;
    setNotice(null);
    setHeadlinesRunning(true);
    setHeadlines([]);
    try {
      const auth = formatCommonAuth();
      const companyContext = await loadCompanyContextLines();
      const response = await fetch('/api/drafts/headlines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...auth,
          draft,
          topic: ideaContext?.topic ?? '',
          audience: ideaContext?.audience ?? '',
          count: 5,
          companyContext,
        }),
      });
      const payload = (await response.json()) as HeadlinesApiResponse;
      if (!response.ok || !payload.variants) {
        throw new Error(payload.error ?? 'Headline generation failed.');
      }
      setHeadlines(payload.variants);
      setNotice({ tone: 'success', message: `Generated ${payload.variants.length} A/B headline variants.` });
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Headline generation failed.' });
    } finally {
      setHeadlinesRunning(false);
    }
  }, [draft, ideaContext, requireApiKey, requireDraft]);

  const handleApplyHeadline = useCallback(
    (variant: HeadlineVariant) => {
      const lines = draft.split(/\r?\n/);
      let inserted = false;
      const nextLines = lines.map((line) => {
        if (inserted) return line;
        if (/^\s*#\s+/.test(line)) {
          inserted = true;
          return `# ${variant.text}`;
        }
        return line;
      });
      if (!inserted) {
        nextLines.unshift(`# ${variant.text}`, '');
      }
      onApplyDraft(nextLines.join('\n'), `Replaced headline with variant ${variant.variant}.`);
      setNotice({ tone: 'success', message: `Applied headline variant ${variant.variant}.` });
    },
    [draft, onApplyDraft],
  );

  const handleResearch = useCallback(async () => {
    if (!requireApiKey()) return;
    const query = researchQuery.trim() || ideaContext?.topic.trim() || '';
    if (!query) {
      setNotice({ tone: 'error', message: 'Provide a research query or set the idea topic first.' });
      return;
    }
    setNotice(null);
    setResearchRunning(true);
    setResearchResult(null);
    try {
      const auth = formatCommonAuth();
      const companyContext = await loadCompanyContextLines();
      const response = await fetch('/api/drafts/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...auth,
          query,
          topic: ideaContext?.topic ?? '',
          audience: ideaContext?.audience ?? '',
          draft,
          companyContext,
        }),
      });
      const payload = (await response.json()) as ResearchApiResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? 'Research failed.');
      }
      setResearchResult(payload);
      const sources = payload.sources?.length ?? 0;
      setNotice({
        tone: sources === 0 ? 'info' : 'success',
        message:
          sources === 0
            ? 'No live web results were available. Use the brief as starting questions to verify before drafting.'
            : `Pulled ${sources} live source${sources === 1 ? '' : 's'} via ${payload.searchProvider ?? 'web search'}.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Research failed.' });
    } finally {
      setResearchRunning(false);
    }
  }, [draft, ideaContext, requireApiKey, researchQuery]);

  const handleAppendResearch = useCallback(() => {
    if (!researchResult || !researchResult.briefMarkdown) {
      setNotice({ tone: 'error', message: 'Run research first.' });
      return;
    }
    const sourcesBlock = (researchResult.sources ?? []).length
      ? ['', '## Sources', ...(researchResult.sources ?? []).map((entry, index) => `[${index + 1}] [${entry.title}](${entry.url})`)].join('\n')
      : '';
    const next = `${draft.trim()}\n\n## Research brief\n${researchResult.briefMarkdown.trim()}${sourcesBlock}\n`;
    onApplyDraft(next, 'Appended research brief and sources to the draft.');
    setNotice({ tone: 'success', message: 'Research brief appended to the draft.' });
  }, [draft, onApplyDraft, researchResult]);

  const handleApplyPlagiarismSuggestion = useCallback(
    (flagKey: string, flag: PlagiarismFlag) => {
      if (!flag.suggestedRewrite) return;
      const next = applySuggestionToDraft(draft, flag.passage, flag.suggestedRewrite);
      if (next === null) {
        setNotice({
          tone: 'error',
          message: 'Could not locate the flagged passage in the draft. Edit it manually or rerun the plagiarism check.',
        });
        return;
      }
      onApplyDraft(next, `Applied plagiarism rewrite for: "${flag.passage.slice(0, 60)}${flag.passage.length > 60 ? '…' : ''}"`);
      setAppliedFlagKeys((previous) => ({ ...previous, [flagKey]: true }));
      setPlagiarism((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          flags: previous.flags.filter((entry) => entry !== flag),
        };
      });
      onPlagiarismResult?.(null);
      setNotice({ tone: 'success', message: 'Suggestion applied to the draft. Re-run the plagiarism check to refresh the verdict.' });
    },
    [draft, onApplyDraft, onPlagiarismResult],
  );

  const handlePlagiarism = useCallback(async () => {
    if (!requireDraft() || !requireApiKey()) return;
    setNotice(null);
    setPlagiarismRunning(true);
    setPlagiarism(null);
    setAppliedFlagKeys({});
    onPlagiarismResult?.(null);
    try {
      const auth = formatCommonAuth();
      const response = await fetch('/api/drafts/plagiarism', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...auth, draft }),
      });
      const payload = (await response.json()) as PlagiarismApiResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? 'Plagiarism check failed.');
      }
      const result: PlagiarismResult = {
        flags: payload.flags ?? [],
        riskScore: payload.riskScore ?? 0,
        webMatches: payload.webMatches ?? [],
        verdict: payload.verdict ?? 'review-needed',
      };
      setPlagiarism(result);
      onPlagiarismResult?.(result);
      setNotice({
        tone: result.verdict === 'clean' ? 'success' : result.verdict === 'high-risk' ? 'error' : 'info',
        message: `Plagiarism check complete — ${result.verdict.replace('-', ' ')} (risk ${result.riskScore}/100).`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Plagiarism check failed.' });
    } finally {
      setPlagiarismRunning(false);
    }
  }, [draft, onPlagiarismResult, requireApiKey, requireDraft]);

  const noticeClass = useMemo(() => {
    if (!notice) return '';
    if (notice.tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (notice.tone === 'error') return 'border-red-200 bg-red-50 text-red-700';
    return 'border-sky-200 bg-sky-50 text-sky-800';
  }, [notice]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">AI Content Tools</h3>
          <p className="text-xs text-slate-500">Tone, readability, persona variants, A/B headlines, research, plagiarism.</p>
        </div>
        {!hasApiKeyConfigured ? (
          <a href="/settings" className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-200">
            Configure AI key →
          </a>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium">
        {([
          ['tone', 'Tone & sentiment'],
          ['readability', 'Readability'],
          ['personas', 'Personas'],
          ['headlines', 'A/B headlines'],
          ['research', 'Research'],
          ['plagiarism', 'Plagiarism'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`rounded-md px-3 py-1.5 transition-colors ${
              activeTool === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/70'
            }`}
            onClick={() => setActiveTool(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {notice ? <p className={`mb-3 rounded-lg border px-3 py-2 text-xs ${noticeClass}`}>{notice.message}</p> : null}

      {activeTool === 'tone' ? (
        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Tone presets</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {TONE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
                  onClick={() => void handleTonePreset(preset)}
                  disabled={toneRunning !== null || !hasApiKeyConfigured}
                >
                  <p className="text-sm font-semibold text-slate-800">
                    {toneRunning === preset.key ? <Spinner size="sm" label={`Applying ${preset.label}…`} /> : preset.label}
                  </p>
                  <p className="text-[11px] text-slate-500">{preset.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Sentiment shift</h4>
            <div className="flex flex-wrap gap-2">
              {SENTIMENT_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50"
                  onClick={() => void handleSentimentPreset(preset)}
                  disabled={sentimentRunning !== null || !hasApiKeyConfigured}
                  title={preset.description}
                >
                  {sentimentRunning === preset.key ? <Spinner size="sm" label={`Applying ${preset.label}…`} /> : preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {activeTool === 'readability' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Current draft</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{readability.fleschReadingEase}</p>
              <p className="text-xs text-slate-600">Flesch reading ease — {describeFlesch(readability.fleschReadingEase)}</p>
              <p className="mt-2 text-[11px] text-slate-500">
                {readability.words} words · {readability.sentences} sentences · grade {readability.fleschKincaidGrade}
              </p>
              <p className="mt-2 text-[11px] text-slate-500">Detected complexity: <span className="font-semibold text-slate-700">{readability.complexityLabel}</span></p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 text-xs">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Target reading level</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{targetComplexity.label}</p>
              <p className="text-[11px] text-slate-500">{targetComplexity.description}</p>
              <input
                type="range"
                min={1}
                max={COMPLEXITY_TARGETS.length}
                value={complexityValue}
                step={1}
                onChange={(event) => setComplexityValue(Number(event.target.value))}
                className="mt-3 w-full accent-emerald-700"
              />
              <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                <span>Simple</span>
                <span>Specialist</span>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">Audience hint: {targetComplexity.audienceHint}</p>
              <p className="text-[11px] text-slate-500">Aiming for Flesch ≈ {targetComplexity.fleschTarget}</p>
              <button
                type="button"
                className="mt-3 w-full rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                onClick={() => void handleReadabilityRewrite()}
                disabled={readabilityRunning || !hasApiKeyConfigured}
              >
                {readabilityRunning ? <Spinner size="sm" label="Rewriting…" /> : `Rewrite at ${targetComplexity.label}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTool === 'personas' ? (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={includeDefaults}
              onChange={(event) => setIncludeDefaults(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            Include the default CMO / Founder / IC personas
          </label>
          <div className="space-y-2">
            {personaRows.map((row, index) => (
              <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[1fr_2fr_auto]">
                <input
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  placeholder="Persona name"
                  value={row.name}
                  onChange={(event) =>
                    setPersonaRows((previous) =>
                      previous.map((entry, entryIndex) => (entryIndex === index ? { ...entry, name: event.target.value } : entry)),
                    )
                  }
                />
                <input
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  placeholder="Short persona description"
                  value={row.description}
                  onChange={(event) =>
                    setPersonaRows((previous) =>
                      previous.map((entry, entryIndex) => (entryIndex === index ? { ...entry, description: event.target.value } : entry)),
                    )
                  }
                />
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  onClick={() => setPersonaRows((previous) => previous.filter((_, entryIndex) => entryIndex !== index))}
                  disabled={personaRows.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setPersonaRows((previous) => [...previous, { name: '', description: '' }])}
            >
              + Add another persona
            </button>
          </div>
          <button
            type="button"
            className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            onClick={() => void handlePersonas()}
            disabled={personasRunning || !hasApiKeyConfigured}
          >
            {personasRunning ? <Spinner size="sm" label="Generating personas…" /> : 'Generate persona variants'}
          </button>

          {personaVariants.length > 0 ? (
            <div className="space-y-2">
              {personaVariants.map((variant) => (
                <div key={variant.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{variant.name}</p>
                      <p className="text-[11px] text-slate-500">{variant.description}</p>
                    </div>
                    <button
                      type="button"
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                        appliedPersonaId === variant.id ? 'bg-emerald-200 text-emerald-900' : 'bg-emerald-700 text-white hover:bg-emerald-800'
                      }`}
                      onClick={() => handleApplyPersona(variant)}
                    >
                      {appliedPersonaId === variant.id ? 'Applied' : 'Load into editor'}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] italic text-slate-600">Pitch shift: {variant.pitchAdjustment || '—'}</p>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-[11px] text-slate-700">{variant.draft}</pre>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTool === 'headlines' ? (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            onClick={() => void handleHeadlines()}
            disabled={headlinesRunning || !hasApiKeyConfigured}
          >
            {headlinesRunning ? <Spinner size="sm" label="Generating headlines…" /> : 'Generate A/B headline variants'}
          </button>
          {headlines.length > 0 ? (
            <ul className="space-y-2">
              {headlines.map((variant) => (
                <li key={variant.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Variant {variant.variant} · {variant.hookType}</p>
                      <p className="text-sm font-semibold text-slate-900">{variant.text}</p>
                      <p className="text-[11px] text-slate-500">{variant.rationale}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800"
                      onClick={() => handleApplyHeadline(variant)}
                    >
                      Use as title
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {activeTool === 'research' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
              placeholder={`Topic to research (default: ${ideaContext?.topic || 'idea topic'})`}
              value={researchQuery}
              onChange={(event) => setResearchQuery(event.target.value)}
            />
            <button
              type="button"
              className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              onClick={() => void handleResearch()}
              disabled={researchRunning || !hasApiKeyConfigured}
            >
              {researchRunning ? <Spinner size="sm" label="Searching…" /> : 'Search & summarize'}
            </button>
          </div>
          {researchResult ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Research brief</p>
              <p className="mt-2 whitespace-pre-wrap text-xs">{researchResult.briefMarkdown || '(No brief returned.)'}</p>

              {(researchResult.findings ?? []).length > 0 ? (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Findings</p>
                  <ul className="mt-1 space-y-1">
                    {(researchResult.findings ?? []).map((finding, index) => {
                      const sources = researchResult.sources ?? [];
                      const cited = finding.sourceIndex >= 0 && finding.sourceIndex < sources.length ? sources[finding.sourceIndex] : null;
                      return (
                        <li key={`${finding.claim}-${index}`}>
                          <p className="text-xs font-semibold text-slate-800">{finding.claim}</p>
                          <p className="text-[11px] text-slate-500">
                            {finding.evidence}
                            {cited ? (
                              <>
                                {' '}— source{' '}
                                <a
                                  className="text-blue-700 underline hover:text-blue-900"
                                  href={cited.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  [{finding.sourceIndex + 1}] {cited.title}
                                </a>
                              </>
                            ) : null}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {(researchResult.sources ?? []).length > 0 ? (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sources</p>
                  <ol className="mt-1 list-decimal space-y-2 pl-5">
                    {(researchResult.sources ?? []).map((source) => (
                      <li key={source.url}>
                        <a
                          className="text-sm font-semibold text-blue-700 underline hover:text-blue-900"
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.title}
                        </a>
                        <p className="break-all text-[10px] text-slate-400">{source.url}</p>
                        <p className="text-[11px] text-slate-500">{source.snippet}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="mt-3 text-[11px] italic text-slate-500">No live web sources were available — verify findings manually before drafting.</p>
              )}

              <button
                type="button"
                className="mt-3 rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                onClick={handleAppendResearch}
              >
                Append brief + sources to draft
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTool === 'plagiarism' ? (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            onClick={() => void handlePlagiarism()}
            disabled={plagiarismRunning || !hasApiKeyConfigured}
          >
            {plagiarismRunning ? <Spinner size="sm" label="Checking…" /> : 'Run plagiarism check'}
          </button>
          {plagiarism ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                    plagiarism.verdict === 'clean'
                      ? 'bg-emerald-100 text-emerald-800'
                      : plagiarism.verdict === 'high-risk'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {plagiarism.verdict.replace('-', ' ')}
                </span>
                <span className="text-[11px] text-slate-600">Risk score {plagiarism.riskScore}/100</span>
              </div>

              {plagiarism.flags.length === 0 ? (
                <p className="text-[11px] text-slate-500">No suspicious passages flagged.</p>
              ) : (
                <ul className="space-y-2">
                  {plagiarism.flags.map((flag, index) => {
                    const flagKey = `${flag.passage.slice(0, 50)}-${index}`;
                    const isApplied = Boolean(appliedFlagKeys[flagKey]);
                    const passageInDraft = applySuggestionToDraft(draft, flag.passage, flag.suggestedRewrite ?? flag.passage) !== null;
                    return (
                      <li key={flagKey} className="rounded-lg border border-slate-200 bg-white p-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{flag.severity} severity</p>
                        <p className="mt-1 text-xs text-slate-800">&ldquo;{flag.passage}&rdquo;</p>
                        <p className="mt-1 text-[11px] text-slate-500">{flag.reason}</p>
                        {flag.likelySource ? (
                          <p className="text-[11px] text-slate-500">Likely source: {renderLikelySource(flag.likelySource)}</p>
                        ) : null}
                        {flag.suggestedRewrite ? (
                          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Suggested rewrite</p>
                            <p className="mt-1 text-xs italic text-emerald-900">{flag.suggestedRewrite}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                                onClick={() => handleApplyPlagiarismSuggestion(flagKey, flag)}
                                disabled={isApplied || !passageInDraft}
                                title={
                                  !passageInDraft
                                    ? 'Could not locate the flagged passage in the draft (it may have been edited).'
                                    : isApplied
                                    ? 'Suggestion already applied.'
                                    : undefined
                                }
                              >
                                {isApplied ? 'Applied' : 'Apply suggestion'}
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                onClick={() => {
                                  void navigator.clipboard.writeText(flag.suggestedRewrite ?? '').then(
                                    () => setNotice({ tone: 'success', message: 'Copied suggested rewrite to clipboard.' }),
                                    () => setNotice({ tone: 'error', message: 'Clipboard permission was blocked. Copy manually.' }),
                                  );
                                }}
                              >
                                Copy
                              </button>
                            </div>
                            {!passageInDraft ? (
                              <p className="mt-1 text-[11px] text-amber-700">
                                The flagged passage no longer matches the draft text exactly. Edit it manually or re-run the check.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {plagiarism.webMatches.length > 0 ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">Exact-quote web matches</p>
                  <ul className="mt-1 space-y-1">
                    {plagiarism.webMatches.map((match, index) => (
                      <li key={`${match.matchUrl}-${index}`} className="rounded-md border border-red-100 bg-red-50 p-2">
                        <p className="text-[11px] text-slate-800">&ldquo;{match.passage}&rdquo;</p>
                        <a
                          className="text-[11px] font-semibold text-blue-700 underline hover:text-blue-900"
                          href={match.matchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {match.matchTitle}
                        </a>
                        <p className="break-all text-[10px] text-slate-400">{match.matchUrl}</p>
                        <p className="text-[11px] text-slate-500">{match.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export type { PlagiarismResult, PlagiarismFlag };
