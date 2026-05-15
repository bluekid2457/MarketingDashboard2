'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type MarkdownPostPreviewProps = {
  /** Raw markdown content the user typed for a long-form platform. */
  markdown: string;
  /** Optional className appended to the preview surface (NOT the caveat). */
  className?: string;
  /**
   * Toggle the caveat copy. Defaults to ``true``. Set to ``false`` for
   * callers that render the caveat once for the whole queue (see
   * ``/review``) so it isn't repeated per row.
   */
  showCaveat?: boolean;
};

/**
 * Renders a markdown preview of ``markdown`` for Bucket-B long-form
 * platforms (Medium, Newsletter, Blog). Uses ``react-markdown`` with
 * GitHub-flavored markdown for tables/strikethrough/autolinks.
 *
 * Raw HTML is intentionally NOT enabled (no ``rehype-raw``) so that
 * embedded ``<script>`` tags render as literal text, preserving the
 * XSS-safe default of ``react-markdown``.
 *
 * The caveat strip is a sibling so that callers using this component per
 * row can clamp the preview surface (e.g. with ``max-h-32 overflow-hidden``)
 * without clipping the caveat copy.
 */
export function MarkdownPostPreview({
  markdown,
  className,
  showCaveat = true,
}: MarkdownPostPreviewProps) {
  const previewClassName = [
    'text-sm leading-relaxed text-slate-800',
    '[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2',
    '[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-2',
    '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1',
    '[&_p]:my-2',
    '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2',
    '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2',
    '[&_li]:my-0.5',
    '[&_a]:text-blue-700 [&_a]:underline',
    '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs',
    '[&_strong]:font-semibold [&_em]:italic [&_del]:line-through',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className={previewClassName} data-testid="markdown-preview">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
      {showCaveat ? <MarkdownPostPreviewCaveat /> : null}
    </>
  );
}

/**
 * Standalone caveat strip — re-export so callers like ``/review`` can render
 * the caveat once at the top of a queue instead of once per row.
 */
export function MarkdownPostPreviewCaveat() {
  return (
    <p className="mt-1 text-xs text-slate-500">
      Preview reflects rendered markdown. The destination platform may apply its own styling on publish.
    </p>
  );
}

export default MarkdownPostPreview;
