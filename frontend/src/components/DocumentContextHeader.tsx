'use client';

import { PIPELINE_STEPS, type PipelineStepKey } from '@/lib/pipeline';

type DocumentContextHeaderProps = {
  ideaTopic: string;
  angleTitle?: string;
  activeStep: PipelineStepKey;
};

/**
 * Sticky context header rendered above the editor content on
 * `/storyboard/[id]`, `/adapt/[id]`, and `/publish` (single-doc context only).
 *
 * Provides a persistent anchor across the Storyboard -> Adapt -> Publish jump
 * so the user always knows which idea + angle they are editing. The step
 * indicator on the right is derived from `PIPELINE_STEPS` so labels stay in
 * sync with the WorkflowStepper and sidebar.
 */
export default function DocumentContextHeader({
  ideaTopic,
  angleTitle,
  activeStep,
}: DocumentContextHeaderProps) {
  const stepIndex = PIPELINE_STEPS.findIndex((s) => s.key === activeStep);
  const totalSteps = PIPELINE_STEPS.length;
  const stepLabel =
    stepIndex >= 0 ? `Step ${stepIndex + 1} of ${totalSteps}` : '';

  const displayTopic = ideaTopic && ideaTopic.trim() ? ideaTopic.trim() : 'Untitled idea';
  const displayAngle = angleTitle && angleTitle.trim() ? angleTitle.trim() : '';

  return (
    <header
      role="region"
      aria-label="Document context"
      className="sticky top-[108px] z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm lg:top-[44px]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
          Editing
        </span>
        <span
          className="truncate max-w-[60%] font-bold text-slate-900"
          title={displayTopic}
        >
          {displayTopic}
        </span>
        {displayAngle ? (
          <>
            <span className="shrink-0 text-slate-400" aria-hidden="true">
              {' · '}
            </span>
            <span
              className="truncate font-semibold text-slate-500"
              title={displayAngle}
            >
              {displayAngle}
            </span>
          </>
        ) : null}
      </div>
      {stepLabel ? <span className="pill shrink-0">{stepLabel}</span> : null}
    </header>
  );
}
