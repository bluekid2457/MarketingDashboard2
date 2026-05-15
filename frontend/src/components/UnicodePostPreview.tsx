'use client';

import { useMemo } from 'react';

import { markdownToLinkedInUnicode } from '@/lib/linkedinFormat';
import { formatPlatformLabel } from '@/lib/scheduledPosts';

/**
 * Plain-text feed platforms that publish bodies as plain text and accept the
 * Math-Sans Unicode substitution trick for visual bold/italic. LinkedIn,
 * X/Twitter, and Instagram all fall in this bucket. Long-form platforms
 * (Medium, Newsletter, Blog) render markdown natively and must NOT have
 * Unicode substitution applied — see ``MarkdownPostPreview`` instead.
 */
export type UnicodePostPlatform = 'linkedin' | 'twitter' | 'instagram';

export type UnicodePostPreviewProps = {
  /** Which Bucket-A plain-text feed platform this preview represents. */
  platform: UnicodePostPlatform;
  /** Raw markdown content the user typed for this platform. */
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
 * Renders a plain-text Unicode preview of ``markdown`` using the shared
 * platform-neutral converter. The preview is purely visual: it never
 * mutates state and never fires network calls.
 *
 * A caveat strip is rendered as a sibling so that callers using this
 * component per row can clamp the preview surface (e.g. with
 * ``max-h-32 overflow-hidden``) without clipping the caveat copy.
 */
export function UnicodePostPreview({
  platform,
  markdown,
  className,
  showCaveat = true,
}: UnicodePostPreviewProps) {
  const converted = useMemo(() => markdownToLinkedInUnicode(markdown), [markdown]);

  const previewClassName = [
    'whitespace-pre-wrap text-sm leading-relaxed text-slate-800',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const testId = platform === 'linkedin' ? 'linkedin-preview' : `unicode-preview-${platform}`;

  return (
    <>
      <div className={previewClassName} data-testid={testId} data-platform={platform}>
        {converted}
      </div>
      {showCaveat ? <UnicodePostPreviewCaveat platform={platform} /> : null}
    </>
  );
}

/**
 * Standalone caveat strip — re-export so callers like ``/review`` can render
 * the caveat once at the top of a queue instead of once per row.
 */
export function UnicodePostPreviewCaveat({ platform }: { platform: UnicodePostPlatform }) {
  const label = formatPlatformLabel(platform);
  return (
    <p className="mt-1 text-xs text-slate-500">
      Unicode formatting is not searchable on {label} and reduces screen-reader accessibility.
    </p>
  );
}

export default UnicodePostPreview;
