/**
 * Canonical pipeline-step definition — single source of truth for the
 * sidebar nav, the WorkflowStepper, and any per-page breadcrumbs.
 *
 * The pipeline is locked to the order:
 *   Ideas -> Angles -> Storyboard -> Adapt -> Review -> Publish
 *
 * Both `Nav.tsx` and `WorkflowStepper.tsx` import `PIPELINE_STEPS` from
 * this module — do NOT re-declare the array elsewhere.
 *
 * Constraints:
 * - `path` is the canonical href (the route the user lands on when they
 *   click the step in the sidebar).
 * - `paths` is the list of route prefixes that should mark this step as
 *   "active" in the WorkflowStepper (matched via `pathname.startsWith`).
 * - Labels here are the user-facing strings — never invent alternates
 *   ("AI Angles", "Schedule", "Audience", etc.) elsewhere in the UI.
 */
export type PipelineStepKey =
  | 'ideas'
  | 'angles'
  | 'storyboard'
  | 'adapt'
  | 'review'
  | 'publish';

export type PipelineStep = {
  key: PipelineStepKey;
  /** User-facing label. Identical in sidebar, stepper, and breadcrumbs. */
  label: string;
  /** Default href when the user clicks the step. */
  path: string;
  /**
   * Route prefixes that should highlight this step as active in the
   * WorkflowStepper. Matched with `pathname.startsWith`. The `path`
   * is included implicitly — list extras only (e.g. legacy `/drafts`
   * for the Storyboard step).
   */
  paths: readonly string[];
};

export const PIPELINE_STEPS: readonly PipelineStep[] = [
  { key: 'ideas',      label: 'Ideas',      path: '/ideas',      paths: ['/ideas'] },
  { key: 'angles',     label: 'Angles',     path: '/angles',     paths: ['/angles'] },
  { key: 'storyboard', label: 'Storyboard', path: '/storyboard', paths: ['/storyboard', '/drafts'] },
  { key: 'adapt',      label: 'Adapt',      path: '/adapt/new',  paths: ['/adapt'] },
  { key: 'review',     label: 'Review',     path: '/review',     paths: ['/review'] },
  { key: 'publish',    label: 'Publish',    path: '/publish',    paths: ['/publish'] },
] as const;
