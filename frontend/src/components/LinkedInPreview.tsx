'use client';

import {
  UnicodePostPreview,
  UnicodePostPreviewCaveat,
} from '@/components/UnicodePostPreview';

export type LinkedInPreviewProps = {
  /** Raw markdown content the user typed in the LinkedIn editor. */
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
 * Thin delegate around ``UnicodePostPreview`` for backwards compatibility.
 * New call sites should prefer ``UnicodePostPreview`` directly so the
 * bucket-routing (LinkedIn / X / Instagram) is explicit in code.
 */
export function LinkedInPreview(props: LinkedInPreviewProps) {
  return <UnicodePostPreview platform="linkedin" {...props} />;
}

export function LinkedInPreviewCaveat() {
  return <UnicodePostPreviewCaveat platform="linkedin" />;
}

export default LinkedInPreview;
