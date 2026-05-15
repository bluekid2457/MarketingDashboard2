/**
 * Shared scheduled-post types and parser.
 *
 * Consumed by both `/publish` (the originating screen for scheduling) and
 * `/calendar` (the month-grid overview). Keeping the parser here is the only
 * dedupe — the two pages still own their own UI state and listeners.
 */

export type PlatformKey =
  | 'linkedin'
  | 'twitter'
  | 'instagram'
  | 'medium'
  | 'newsletter'
  | 'blog';

export const PLATFORM_KEYS: readonly PlatformKey[] = [
  'linkedin',
  'twitter',
  'instagram',
  'medium',
  'newsletter',
  'blog',
] as const;

export function isPlatformKey(value: unknown): value is PlatformKey {
  return typeof value === 'string' && (PLATFORM_KEYS as readonly string[]).includes(value);
}

export type ScheduledPostStatus =
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

export type ScheduledFailureReason =
  | 'token_expired'
  | 'rate_limited'
  | 'invalid_payload'
  | 'provider_unavailable'
  | 'missing_author_urn'
  | 'unknown';

export type ScheduledPostRecord = {
  id: string;
  articleTitle: string;
  ideaTopic?: string;
  angleTitle?: string;
  scheduledForMs: number;
  platforms: PlatformKey[];
  status?: ScheduledPostStatus;
  failureReason?: ScheduledFailureReason;
  postUrl?: string;
  publishedAtMs?: number;
  contentSnapshotLinkedin?: string;
  eventBridgeScheduleName?: string | null;
};

export function isScheduledStatus(value: unknown): value is ScheduledPostStatus {
  return (
    value === 'scheduled' ||
    value === 'publishing' ||
    value === 'published' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

export function isScheduledFailureReason(value: unknown): value is ScheduledFailureReason {
  return (
    value === 'token_expired' ||
    value === 'rate_limited' ||
    value === 'invalid_payload' ||
    value === 'provider_unavailable' ||
    value === 'missing_author_urn' ||
    value === 'unknown'
  );
}

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  medium: 'Medium',
  newsletter: 'Newsletter',
  blog: 'Blog',
};

export function formatPlatformLabel(platform: PlatformKey): string {
  return PLATFORM_LABELS[platform];
}

/** Parses a single Firestore scheduledPosts snapshot into a typed record. Tolerates legacy/missing fields. */
export function parseScheduledPostRecord(
  id: string,
  data: Record<string, unknown>,
): ScheduledPostRecord | null {
  const scheduledForMs = typeof data.scheduledForMs === 'number' ? data.scheduledForMs : 0;
  if (!Number.isFinite(scheduledForMs) || scheduledForMs <= 0) {
    return null;
  }

  const rawPlatforms = Array.isArray(data.platforms) ? data.platforms : [];
  const platforms = rawPlatforms.filter(isPlatformKey);

  const status = isScheduledStatus(data.status) ? data.status : undefined;
  const failureReason = isScheduledFailureReason(data.failureReason)
    ? data.failureReason
    : undefined;

  const trim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  const contentSnapshotRaw = data.contentSnapshot;
  const contentSnapshotLinkedin =
    contentSnapshotRaw && typeof contentSnapshotRaw === 'object'
      ? trim((contentSnapshotRaw as Record<string, unknown>).linkedin)
      : '';

  const publishedAtMs =
    typeof data.publishedAtMs === 'number' && Number.isFinite(data.publishedAtMs)
      ? data.publishedAtMs
      : undefined;

  const articleTitle = trim(data.articleTitle) || trim(data.ideaTopic) || 'Untitled article';

  const eventBridgeScheduleName =
    typeof data.eventBridgeScheduleName === 'string'
      ? data.eventBridgeScheduleName
      : data.eventBridgeScheduleName === null
      ? null
      : undefined;

  return {
    id,
    articleTitle,
    ideaTopic: trim(data.ideaTopic) || undefined,
    angleTitle: trim(data.angleTitle) || undefined,
    scheduledForMs,
    platforms,
    status,
    failureReason,
    postUrl: trim(data.postUrl) || undefined,
    publishedAtMs,
    contentSnapshotLinkedin: contentSnapshotLinkedin || undefined,
    eventBridgeScheduleName,
  };
}
