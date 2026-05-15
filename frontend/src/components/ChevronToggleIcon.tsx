/**
 * Tiny chevron used by the collapse/expand controls on the Adapt live
 * preview, the Review queue preview rows, and the Publish per-card
 * preview. Rendered as inline SVG so the project does not pull in an
 * icon dependency just for one glyph.
 *
 * The chevron points DOWN when ``collapsed`` is ``true`` (the preview is
 * closed and "more content lives below") and rotates 180° to point UP
 * when the preview is expanded. Direction is held consistent across all
 * three surfaces so the visual idiom is the same anywhere a preview is
 * collapsible.
 *
 * The element is marked ``aria-hidden`` because the parent toggle
 * ``<button>`` already carries the accessible label and the
 * ``aria-expanded`` state, so a screen reader announcing the SVG would
 * duplicate that information.
 */
export function ChevronToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`ml-2 shrink-0 text-slate-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
    >
      <polyline points="6 8 10 12 14 8" />
    </svg>
  );
}
