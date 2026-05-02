import type { ReactNode } from 'react';

import { ComingSoonBadge } from './ComingSoonBadge';

type PreviewKind = 'chart' | 'editor' | 'list' | 'form' | 'none';

type PlaceholderCardProps = {
  title: string;
  description?: string;
  previewKind?: PreviewKind;
  /**
   * Optional override for the badge label (e.g. "Preview", "In progress").
   */
  badgeLabel?: string;
  /**
   * Optional className appended to the wrapper. Useful for grid spans.
   */
  className?: string;
  /**
   * Custom skeleton content. When provided this replaces the built-in preview.
   */
  children?: ReactNode;
};

function ChartSilhouette() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 90"
      className="mt-3 h-32 w-full text-slate-300"
      preserveAspectRatio="none"
    >
      <path
        d="M0 70 L25 55 L50 65 L75 35 L100 45 L125 25 L150 40 L175 20 L200 30 L200 90 L0 90 Z"
        fill="currentColor"
        opacity="0.35"
      />
      <polyline
        points="0,70 25,55 50,65 75,35 100,45 125,25 150,40 175,20 200,30"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.7"
      />
    </svg>
  );
}

function EditorSilhouette() {
  return (
    <div
      aria-hidden="true"
      className="mt-3 min-h-[140px] rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3"
    >
      <div className="space-y-2">
        <div className="h-2 w-3/4 rounded bg-slate-200" />
        <div className="h-2 w-2/3 rounded bg-slate-200" />
        <div className="h-2 w-1/2 rounded bg-slate-200" />
      </div>
    </div>
  );
}

function ListSilhouette() {
  return (
    <div aria-hidden="true" className="mt-3 space-y-2">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3"
        >
          <div className="h-6 w-6 rounded-full bg-slate-200" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2 w-2/3 rounded bg-slate-200" />
            <div className="h-2 w-1/3 rounded bg-slate-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FormSilhouette() {
  return (
    <div aria-hidden="true" className="mt-3 grid gap-2">
      <div className="h-9 rounded-xl border border-dashed border-slate-300 bg-slate-50/60" />
      <div className="h-9 rounded-xl border border-dashed border-slate-300 bg-slate-50/60" />
      <div className="h-9 w-1/2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60" />
    </div>
  );
}

function PreviewDecoration({ kind }: { kind: PreviewKind }) {
  if (kind === 'chart') return <ChartSilhouette />;
  if (kind === 'editor') return <EditorSilhouette />;
  if (kind === 'list') return <ListSilhouette />;
  if (kind === 'form') return <FormSilhouette />;
  return null;
}

/**
 * PlaceholderCard — wraps a non-functional preview section so it visually recedes
 * compared with real, working cards. Renders a "Coming soon" badge next to the title,
 * a muted description, and an inert visual silhouette of the future feature.
 *
 * The card is intentionally non-interactive: aria-disabled is set on the wrapper and
 * the entire surface is dimmed so first-time users can tell at a glance that the
 * controls are not yet wired up.
 */
export function PlaceholderCard({
  title,
  description,
  previewKind = 'none',
  badgeLabel,
  className = '',
  children,
}: PlaceholderCardProps) {
  return (
    <section
      aria-disabled="true"
      className={`surface-card p-6 opacity-75 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title">{title}</h2>
        <ComingSoonBadge label={badgeLabel} />
      </div>
      {description ? <p className="mt-2 muted-copy">{description}</p> : null}
      {children ? (
        <div className="mt-3 pointer-events-none select-none">{children}</div>
      ) : (
        <div className="pointer-events-none select-none">
          <PreviewDecoration kind={previewKind} />
        </div>
      )}
    </section>
  );
}

export default PlaceholderCard;
