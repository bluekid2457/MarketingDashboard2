export function Spinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const sizeClasses = size === 'sm' ? 'h-4 w-4 border-2' : size === 'lg' ? 'h-8 w-8 border-[3px]' : 'h-6 w-6 border-2';
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block animate-spin rounded-full border-current border-t-transparent ${sizeClasses}`}
        role="status"
        aria-label={label ?? 'Loading'}
      />
      {label ? <span>{label}</span> : null}
    </span>
  );
}
