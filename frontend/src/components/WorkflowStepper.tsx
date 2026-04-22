'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { getWorkflowContext } from '@/lib/workflowContext';

type StepDef = {
  step: number;
  label: string;
  href: string;
  paths: string[];
};

const STEPS: StepDef[] = [
  { step: 1, label: 'Ideas', href: '/ideas', paths: ['/ideas'] },
  { step: 2, label: 'AI Angles', href: '/angles', paths: ['/angles'] },
  { step: 3, label: 'Storyboard', href: '/storyboard', paths: ['/drafts', '/storyboard'] },
  { step: 4, label: 'Adapt', href: '/adapt', paths: ['/adapt'] },
  { step: 5, label: 'Review', href: '/review', paths: ['/review'] },
  { step: 6, label: 'Publish', href: '/publish', paths: ['/publish'] },
];

type AngleRouteContext = {
  ideaId?: string;
  angleId?: string;
};

function readAngleRouteContext(key: string): AngleRouteContext | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AngleRouteContext;
    if (typeof parsed.ideaId !== 'string' || typeof parsed.angleId !== 'string') {
      return null;
    }
    const ideaId = parsed.ideaId.trim();
    const angleId = parsed.angleId.trim();
    if (!ideaId || !angleId) {
      return null;
    }
    return { ideaId, angleId };
  } catch {
    return null;
  }
}

function resolveCurrentIdeaId(pathname: string, queryIdeaId: string | null): string | null {
  const queryValue = typeof queryIdeaId === 'string' ? queryIdeaId.trim() : '';
  if (queryValue) {
    return queryValue;
  }

  const pathMatch = pathname.match(/^\/(storyboard|adapt)\/([^/?#]+)/);
  if (pathMatch?.[2]) {
    return decodeURIComponent(pathMatch[2]);
  }

  const workflow = getWorkflowContext();
  if (workflow?.ideaId?.trim()) {
    return workflow.ideaId.trim();
  }

  return null;
}

function resolveStoryboardHref(activeIdeaId: string | null): string {
  const workflow = getWorkflowContext();
  const workflowAngleId =
    workflow?.ideaId === activeIdeaId && typeof workflow.angleId === 'string'
      ? workflow.angleId.trim()
      : '';

  if (activeIdeaId && workflowAngleId) {
    return `/storyboard/${encodeURIComponent(activeIdeaId)}?angleId=${encodeURIComponent(workflowAngleId)}`;
  }

  const draftContext = readAngleRouteContext('draft_generation_context');
  if (activeIdeaId && draftContext?.ideaId === activeIdeaId) {
    return `/storyboard/${encodeURIComponent(activeIdeaId)}?angleId=${encodeURIComponent(draftContext.angleId as string)}`;
  }

  if (activeIdeaId) {
    return `/angles?ideaId=${encodeURIComponent(activeIdeaId)}`;
  }

  return '/angles';
}

function resolveAdaptHref(activeIdeaId: string | null): string {
  const workflow = getWorkflowContext();
  const workflowAngleId =
    workflow?.ideaId === activeIdeaId && typeof workflow.angleId === 'string'
      ? workflow.angleId.trim()
      : '';

  if (activeIdeaId && workflowAngleId) {
    return `/adapt/${encodeURIComponent(activeIdeaId)}?angleId=${encodeURIComponent(workflowAngleId)}`;
  }

  const adaptContext = readAngleRouteContext('adapt_draft_context');
  if (activeIdeaId && adaptContext?.ideaId === activeIdeaId) {
    return `/adapt/${encodeURIComponent(activeIdeaId)}?angleId=${encodeURIComponent(adaptContext.angleId as string)}`;
  }

  const draftContext = readAngleRouteContext('draft_generation_context');
  if (activeIdeaId && draftContext?.ideaId === activeIdeaId) {
    return `/adapt/${encodeURIComponent(activeIdeaId)}?angleId=${encodeURIComponent(draftContext.angleId as string)}`;
  }

  if (activeIdeaId) {
    return `/angles?ideaId=${encodeURIComponent(activeIdeaId)}`;
  }

  return '/angles';
}

export default function WorkflowStepper() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeIdeaId = resolveCurrentIdeaId(pathname, searchParams.get('ideaId'));

  const currentStep = STEPS.find((s) =>
    s.paths.some((p) => pathname.startsWith(p)),
  )?.step ?? 0;

  function resolveHref(s: StepDef): string {
    if (s.step === 2) {
      if (activeIdeaId) return `/angles?ideaId=${encodeURIComponent(activeIdeaId)}`;
    }
    if (s.step === 3) return resolveStoryboardHref(activeIdeaId);
    if (s.step === 4) return resolveAdaptHref(activeIdeaId);
    return s.href;
  }

  return (
    <div className="sticky top-[68px] z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-sm lg:top-0">
      <div className="mx-auto px-4 py-2 lg:px-8">
        <ol className="flex items-center gap-1">
          {STEPS.map((s, i) => {
            const isActive = s.step === currentStep;
            const isPast = currentStep > 0 && s.step < currentStep;
            const isLast = i === STEPS.length - 1;

            return (
              <li key={s.step} className="flex min-w-0 flex-1 items-center">
                <Link
                  href={resolveHref(s)}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-all sm:gap-2 sm:px-3 sm:text-sm ${
                    isActive
                      ? 'bg-emerald-700 text-white shadow-sm'
                      : isPast
                        ? 'text-emerald-700 hover:bg-emerald-50'
                        : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold sm:h-6 sm:w-6 sm:text-xs ${
                      isActive
                        ? 'border-white bg-white text-emerald-700'
                        : isPast
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-300 bg-white text-slate-400'
                    }`}
                  >
                    {isPast ? '✓' : s.step}
                  </span>
                  <span className="hidden truncate sm:inline">{s.label}</span>
                </Link>
                {!isLast && (
                  <span className="mx-0.5 shrink-0 text-slate-300">›</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
