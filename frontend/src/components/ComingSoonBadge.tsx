/**
 * ComingSoonBadge — small inline pill that marks a UI section as a non-functional preview.
 *
 * Use this next to a section heading or inside a card header to make it instantly clear that
 * the surrounding controls are placeholders and not yet wired up to real functionality.
 */
export function ComingSoonBadge({ label = 'Coming soon' }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 align-middle"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
      >
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
      <span>{label}</span>
    </span>
  );
}

export default ComingSoonBadge;
