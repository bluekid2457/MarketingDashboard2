# TIP — Scheduled Posts Calendar Page

> **Branch:** create `scheduled-posts-calendar-page` off the current branch `aws-lambda-eventbridge-scheduler` (the cancel feature at `c13cdc0` is a prerequisite). Do NOT push to remote or open a PR.

---

## 1. Issue Summary

A new `/calendar` page is needed that visualises every scheduled LinkedIn post for the signed-in user on a month-grid. Each post pill shows status (`scheduled` / `publishing` / `published` / `failed`); clicking a pill opens a detail panel with the full post payload (idea topic, angle title, article title, scheduled time, content snapshot, postUrl, failureReason, etc.). From the detail panel the user can **reschedule** (only when `status ∈ {scheduled, failed}`) or **cancel** (only when `status ∈ {scheduled, failed}`). Cancel reuses the already-shipped `DELETE /api/v1/publish/schedule/{id}` + `cancelScheduledPost(id)` wrapper from commit `c13cdc0`; reschedule requires a **new** `PATCH /api/v1/publish/schedule/{id}` endpoint plus a new `rescheduleScheduledPost(...)` client wrapper. Realtime sync uses the same `users/{uid}/scheduledPosts` Firestore listener pattern already used on `/publish`. LinkedIn-only today; the data shape is multi-platform-ready via the existing `platforms: string[]` field. Drag-to-reschedule is out of scope (deferred to Known Gaps).

## 2. Root Cause / Motivation

This is a new feature, not a bug fix. The motivation is to give the user a single visual surface to see every queued / publishing / published / failed scheduled post across the month, and to be able to reschedule or cancel without navigating to `/publish`. Today the `/publish` page only surfaces the **next 6** upcoming scheduled posts, the next 6 failed posts, and the most recent 6 published — there is no overview, no per-day grouping, and no reschedule control.

Layers affected:

- **Backend (FastAPI):** add `PATCH /api/v1/publish/schedule/{id}` for reschedule. Cancel endpoint already exists.
- **Frontend (Next.js):** new page `/calendar`, new sidebar entry, new calendar grid component, new detail panel, new `rescheduleScheduledPost` client wrapper, shared `ScheduledPostRecord` type extracted out of `publish/page.tsx` into a new `frontend/src/lib/scheduledPosts.ts`.
- **EventBridge Scheduler:** no service-code changes — `update_schedule()` already exists and is best-effort delete-then-create.
- **Specs:** update `specs/backend.md`, `specs/frontend.md`, `specs/screens.md`, `specs/automation.md`.

## 3. Database Schema Changes

**None.** The existing `users/{uid}/scheduledPosts/{id}` Firestore documents already carry every field the calendar consumes (`scheduledForMs`, `scheduledForIso`, `status`, `platforms`, `articleTitle`, `ideaTopic`, `angleTitle`, `contentSnapshot.linkedin`, `eventBridgeScheduleName`, `postUrl`, `failureReason`, `publishedAtMs`, `attemptCount`, `createdAt`, `updatedAt`).

The reschedule endpoint **updates** `scheduledForMs`, `scheduledForIso`, `status`, `updatedAt` on the row in place. It **preserves** `attemptCount`, `eventBridgeScheduleName` (the deterministic name `publish-<scheduledPostId>` is reused — `update_schedule()` is delete-then-create using the same name), and keeps `failureReason` for audit. It MUST NOT touch `createdAt`.

## 4. API Endpoint Changes

### 4.1 New endpoint — `PATCH /api/v1/publish/schedule/{scheduled_post_id}`

**File:** `backend/app/routers/publish.py`
**Location in file:** insert IMMEDIATELY after the existing `DELETE /publish/schedule/{scheduled_post_id}` route handler (`cancel_scheduled_post`), i.e. between the existing `cancel_scheduled_post` function (ends ~line 309) and the comment-block header that starts the `/publish/scheduled/run` section (~line 312).

#### 4.1.1 Pydantic request model

Add this class just above the new handler, before the route decorator:

```python
class RescheduleRequest(BaseModel):
    """Request body for PATCH /publish/schedule/{id}."""

    scheduled_for_ms: int = Field(alias="scheduledForMs", gt=0)

    model_config = ConfigDict(populate_by_name=True)
```

#### 4.1.2 Handler signature

```python
@router.patch("/publish/schedule/{scheduled_post_id}")
async def reschedule_scheduled_post(
    scheduled_post_id: str,
    body: RescheduleRequest,
    verified_uid: str = Depends(verify_firebase_id_token),
) -> dict[str, Any]:
```

#### 4.1.3 Validation order (each step short-circuits with the listed `HTTPException`)

1. **Lookup doc.** `db = get_firestore_client()`; `ref = db.collection("users").document(verified_uid).collection("scheduledPosts").document(scheduled_post_id)`; `snapshot = ref.get()`; **if `not snapshot.exists` → `HTTPException(status_code=404, detail="not_found")`**. The lookup is implicitly user-scoped, so cross-user reschedule is structurally impossible (mirrors the DELETE handler's contract).
2. **Future-floor check.** `now_ms = _now_ms()`; **if `body.scheduled_for_ms <= now_ms + _MIN_SCHEDULE_LEAD_MS` → `HTTPException(status_code=422, detail="scheduled_too_soon")`**. Reuse the existing `_MIN_SCHEDULE_LEAD_MS = 60_000` constant (already defined at module top).
3. **Status gate.** `row = snapshot.to_dict() or {}`; `current_status = str(row.get("status") or "scheduled")`; **if `current_status in {"publishing", "published"}` → `HTTPException(status_code=409, detail="status_not_reschedulable")`**. (Allows `scheduled`, `failed`, and `cancelled` rows to be rescheduled; `failed` is the most common case — user picks a new time after a `token_expired` failure, status flips back to `scheduled`.)

#### 4.1.4 Side effects (atomic-ish — mirror the POST handler's order)

1. **Provision EventBridge first.** Call `eventbridge_scheduler.update_schedule(scheduled_post_id, verified_uid, body.scheduled_for_ms)` inside `try / except`. Behavior:
   - **AWS env configured (both `SCHEDULER_LAMBDA_ARN` and `EVENTBRIDGE_INVOKER_ROLE_ARN` set).** The helper internally `delete_schedule()` then `create_one_shot_schedule()`. If `create_one_shot_schedule` raises (the underlying boto3 `create_schedule` call), **re-raise as `HTTPException(status_code=502, detail="reschedule_provisioning_failed")`** and DO NOT write Firestore. (A bare `delete_schedule` failure is swallowed by the helper itself — it logs but does not raise — so this branch only fires on a create failure.)
   - **Local-dev no-op mode.** The helper logs and returns `None` silently. No exception fires. Proceed to step 2.
   - Logging on the except branch: `print(f"[publish.reschedule] EventBridge provisioning failed for {scheduled_post_id}: {type(exc).__name__}")`. Do NOT log token material or the body.
2. **Firestore update.** Compute `iso_string = datetime.fromtimestamp(body.scheduled_for_ms / 1000, tz=timezone.utc).isoformat()`. Then:
   ```python
   update_payload = {
       "scheduledForMs": body.scheduled_for_ms,
       "scheduledForIso": iso_string,
       "status": "scheduled",
       "updatedAt": firestore.SERVER_TIMESTAMP,
   }
   try:
       ref.update(update_payload)
   except Exception as exc:
       print(
           f"[publish.reschedule] Firestore write failed for "
           f"{scheduled_post_id}: {type(exc).__name__}",
       )
       raise HTTPException(status_code=500, detail="reschedule_write_failed") from exc
   ```
   Use `ref.update(...)` (NOT `set(..., merge=True)`) so unset fields are not accidentally clobbered. Status is **always** reset to `'scheduled'` — this is how a `failed` row gets re-queued. Do NOT clear `failureReason` (audit trail) but do reset `status` so the UI / Notifications / scheduler treat it as queued. Do NOT touch `attemptCount`, `eventBridgeScheduleName`, `contentSnapshot`, `createdAt`, `platforms`, `ideaId`, `angleId`, `articleTitle`, `ideaTopic`, `angleTitle`, `visibility`, `postUrl`, `postUrn`, or `publishedAtMs`.
3. **Rollback on Firestore failure.** Unlike the POST handler, we do NOT attempt to roll back the EventBridge change on a Firestore failure: the schedule has already been recreated for the new time, the underlying row still exists, and a follow-up retry by the user will simply call `update_schedule` again (delete-then-create on the same deterministic name). This is acceptable because `update_schedule` is idempotent. **Log it but return 500**, do not silently retry.

#### 4.1.5 Success response

```python
return {
    "success": True,
    "scheduledPostId": scheduled_post_id,
    "scheduledForMs": body.scheduled_for_ms,
    "eventBridgeScheduleName": (
        eventbridge_scheduler._schedule_name(scheduled_post_id)
        if eventbridge_scheduler._aws_config_ready()[0] is not None
        else None
    ),
}
```

Rationale: the deterministic schedule name `publish-<id>` is reconstructed via the private `_schedule_name` helper (already exported in the module via Python's flat namespace; no underscore-import concerns here because we're calling it from the same package). In local-dev no-op mode `_aws_config_ready()` returns `(None, None)`, so we return `eventBridgeScheduleName: null` — matching the POST handler's contract.

Alternative if you want to avoid the underscore-prefixed call: re-read the doc after update and surface its persisted `eventBridgeScheduleName` field. **Prefer the deterministic reconstruction** — it's one fewer Firestore read and the value is guaranteed to match what was persisted at POST time (it doesn't change on reschedule).

#### 4.1.6 Error matrix (full surface)

| Status | `detail` slug | When |
|---|---|---|
| 401 | (dependency-raised) | Missing or invalid `Authorization: Bearer ...` |
| 404 | `not_found` | Document does not exist under the verified uid |
| 409 | `status_not_reschedulable` | Row is `publishing` or `published` |
| 422 | `scheduled_too_soon` | New time is not `> now + 60_000` ms |
| 500 | `reschedule_write_failed` | Firestore `update()` raised |
| 502 | `reschedule_provisioning_failed` | AWS env configured AND `create_schedule` (the create half of `update_schedule`) raised |

**Auth:** identical to `/publish/schedule` and `/publish/schedule/{id}` DELETE — `Depends(verify_firebase_id_token)`. The lookup is `users/{verified_uid}/scheduledPosts/{id}` so cross-user PATCH is structurally impossible.

**No body `uid` field.** This differs from the POST handler intentionally — the path id + verified token are sufficient, matching the DELETE handler pattern.

### 4.2 Do NOT touch

- `eventbridge_scheduler.update_schedule()` — already exists, works, is delete-then-create against the deterministic name.
- `eventbridge_scheduler.delete_schedule()` / `create_one_shot_schedule()` — used internally by `update_schedule`, no changes.
- `POST /publish/schedule` — unchanged.
- `DELETE /publish/schedule/{id}` — unchanged.
- `POST /publish/scheduled/run` — unchanged.

## 5. Browser Automation / Platform Targets

LinkedIn only — no other platform changes. The scheduler Lambda + EventBridge fire path is untouched by this work. The reschedule endpoint just moves the existing schedule's fire-time; `publish_one` and `linkedin_publisher.publish_linkedin_text` continue to do the actual publishing.

## 6. Next.js Frontend Changes

### 6.1 Shared module extraction — `frontend/src/lib/scheduledPosts.ts` (NEW FILE)

The `ScheduledPostRecord`, `ScheduledPostStatus`, `ScheduledFailureReason`, `isScheduledStatus`, `isScheduledFailureReason`, and `PlatformKey` (just `'linkedin' | 'twitter' | 'medium' | 'newsletter' | 'blog'` since that's what `platforms: string[]` semantically allows today) currently live at the top of `frontend/src/app/(app)/publish/page.tsx` (lines 17–84). Move them to a new shared module so the calendar page can import them without duplicating the type.

Exact content to place in the new file (verbatim):

```ts
export type PlatformKey = 'linkedin' | 'twitter' | 'medium' | 'newsletter' | 'blog';

export const PLATFORM_KEYS: readonly PlatformKey[] = [
  'linkedin',
  'twitter',
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
```

**Note:** the record gains four new optional fields beyond what `/publish` uses today — `ideaTopic`, `angleTitle`, `contentSnapshotLinkedin`, `eventBridgeScheduleName`. The detail panel needs them. The `/publish` page does not consume them; that's fine because they're optional.

### 6.2 Update `frontend/src/app/(app)/publish/page.tsx` to use the shared module

After creating the shared module:

1. Delete lines 17–84 of `publish/page.tsx` (the `PlatformKey`, `PLATFORM_KEYS`, `isPlatformKey`, `ScheduledPostStatus`, `ScheduledFailureReason`, `ScheduledPostRecord`, `isScheduledStatus`, `isScheduledFailureReason` declarations).
2. Replace with a single import line at the top (after the existing import block):
   ```ts
   import {
     PLATFORM_KEYS,
     formatPlatformLabel,
     isPlatformKey,
     isScheduledFailureReason,
     isScheduledStatus,
     parseScheduledPostRecord,
     type PlatformKey,
     type ScheduledFailureReason,
     type ScheduledPostRecord,
     type ScheduledPostStatus,
   } from '@/lib/scheduledPosts';
   ```
3. **Remove** the local `PLATFORM_LABELS` const (lines 154–161) and the local `formatPlatformLabel` function (lines 162–164) — they're now imported.
4. Inside the `useEffect` that subscribes to `scheduledPosts` (around lines 360–409), replace the inline mapping with `parseScheduledPostRecord(documentSnapshot.id, documentSnapshot.data() as Record<string, unknown>)` and filter out `null` returns. The rest of the file is unchanged.

**Verify after edit:** `cd frontend && npx tsc --noEmit` must pass.

### 6.3 New page — `frontend/src/app/(app)/calendar/page.tsx` (NEW FILE)

**Route:** `/calendar`. The `(app)` group layout (`frontend/src/app/(app)/layout.tsx`) gives sidebar/header/auth-guard automatically — no changes to layout.tsx.

**File header:** start with `'use client';` directive — the page uses Firestore `onSnapshot`, Firebase Auth, `useState`, `useEffect`, `useMemo`, `useCallback`.

**Imports (top of file):**

```ts
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { Spinner } from '@/components/Spinner';
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import {
  cancelScheduledPost as cancelScheduledPostApi,
  rescheduleScheduledPost as rescheduleScheduledPostApi,
} from '@/lib/publish';
import {
  formatPlatformLabel,
  parseScheduledPostRecord,
  type PlatformKey,
  type ScheduledPostRecord,
  type ScheduledPostStatus,
} from '@/lib/scheduledPosts';
```

**State shape (verbatim — these are the names the Developer must use):**

```ts
const [currentUid, setCurrentUid] = useState<string | null>(null);
const [isAuthLoading, setIsAuthLoading] = useState(true);
const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostRecord[]>([]);
const [isPostsLoading, setIsPostsLoading] = useState(true);
const [loadError, setLoadError] = useState<string | null>(null);

const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
const [rescheduleInput, setRescheduleInput] = useState<string>(''); // datetime-local string
const [reschedulingId, setReschedulingId] = useState<string | null>(null);
const [cancellingId, setCancellingId] = useState<string | null>(null);
const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
const [statusFilter, setStatusFilter] = useState<'all' | ScheduledPostStatus>('all');
const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string; linkHref?: string; linkText?: string } | null>(null);
```

**Helper functions to declare at module scope, above the component:**

```ts
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1, 0, 0, 0, 0);
}

function formatScheduledAtInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseScheduledAtInputValue(value: string): number {
  if (!value.trim()) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isReschedulable(status: ScheduledPostStatus | undefined): boolean {
  return status === undefined || status === 'scheduled' || status === 'failed';
}

function isCancellable(status: ScheduledPostStatus | undefined): boolean {
  return status === undefined || status === 'scheduled' || status === 'failed';
}
```

**Auth + Firestore listener (mirror `/publish` lines 240–292 and 360–409):**

```ts
useEffect(() => {
  const auth = getFirebaseAuth();
  if (!auth) {
    setLoadError('Calendar is unavailable until Firebase is configured.');
    setIsAuthLoading(false);
    setIsPostsLoading(false);
    return;
  }
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    setCurrentUid(user?.uid ?? null);
    setIsAuthLoading(false);
  });
  return unsubscribe;
}, []);

useEffect(() => {
  if (isAuthLoading) return;
  if (!currentUid) {
    setScheduledPosts([]);
    setLoadError('Sign in to view the scheduled posts calendar.');
    setIsPostsLoading(false);
    return;
  }
  const db = getFirebaseDb();
  if (!db) {
    setLoadError('Calendar is unavailable until Firebase is configured.');
    setIsPostsLoading(false);
    return;
  }
  setIsPostsLoading(true);
  setLoadError(null);
  const q = query(collection(db, 'users', currentUid, 'scheduledPosts'), orderBy('scheduledForMs', 'asc'));
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const next: ScheduledPostRecord[] = [];
      for (const documentSnapshot of snapshot.docs) {
        const parsed = parseScheduledPostRecord(documentSnapshot.id, documentSnapshot.data() as Record<string, unknown>);
        if (parsed) next.push(parsed);
      }
      setScheduledPosts(next);
      setIsPostsLoading(false);
    },
    () => {
      setScheduledPosts([]);
      setIsPostsLoading(false);
      setLoadError('Unable to load scheduled posts right now.');
    },
  );
  return unsubscribe;
}, [currentUid, isAuthLoading]);
```

**DO NOT extract a shared `useScheduledPosts(uid)` hook** in this PR — the architect's note says it's a judgment call, and keeping it inline keeps the diff narrow. The two pages now share the parser via `scheduledPosts.ts`, which is the dedupe that matters.

**Month grid build (Mon-first, matching the existing Dashboard Activity Calendar convention at `dashboard/page.tsx:127`):**

```ts
type CalendarCell =
  | { kind: 'header'; label: string }
  | { kind: 'blank'; key: string }
  | {
      kind: 'day';
      day: number;
      dateMs: number;
      isToday: boolean;
      posts: ScheduledPostRecord[];
    };

function buildMonthCalendar(referenceDate: Date, postsByDay: Map<number, ScheduledPostRecord[]>): CalendarCell[] {
  const headers: CalendarCell[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => ({
    kind: 'header',
    label,
  }));
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlankCount = (firstOfMonth.getDay() + 6) % 7; // Mon-first
  const today = new Date();
  const todayKey =
    today.getFullYear() === year && today.getMonth() === month ? today.getDate() : -1;
  const cells: CalendarCell[] = [...headers];
  for (let i = 0; i < leadingBlankCount; i += 1) {
    cells.push({ kind: 'blank', key: `lead-${i}` });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateMs = new Date(year, month, day).getTime();
    cells.push({
      kind: 'day',
      day,
      dateMs,
      isToday: day === todayKey,
      posts: postsByDay.get(day) ?? [],
    });
  }
  while ((cells.length - headers.length) % 7 !== 0) {
    cells.push({ kind: 'blank', key: `tail-${cells.length}` });
  }
  return cells;
}
```

**Mon-first** matches `frontend/src/app/(app)/dashboard/page.tsx:128`. The architect prompt said "match the existing dashboard calendar convention if there is one" — there is, so Mon-first it is. Do NOT use Sunday-first.

**Filter + group memo:**

```ts
const filteredPosts = useMemo(() => {
  if (statusFilter === 'all') return scheduledPosts;
  return scheduledPosts.filter((p) => (p.status ?? 'scheduled') === statusFilter);
}, [scheduledPosts, statusFilter]);

const postsByDay = useMemo(() => {
  const map = new Map<number, ScheduledPostRecord[]>();
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  for (const post of filteredPosts) {
    const d = new Date(post.scheduledForMs);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const day = d.getDate();
    const arr = map.get(day) ?? [];
    arr.push(post);
    map.set(day, arr);
  }
  // sort each day's posts ascending by time
  for (const arr of map.values()) {
    arr.sort((a, b) => a.scheduledForMs - b.scheduledForMs);
  }
  return map;
}, [filteredPosts, viewMonth]);

const calendarCells = useMemo(
  () => buildMonthCalendar(viewMonth, postsByDay),
  [viewMonth, postsByDay],
);

const selectedPost = useMemo(
  () => (selectedPostId ? scheduledPosts.find((p) => p.id === selectedPostId) ?? null : null),
  [selectedPostId, scheduledPosts],
);
```

**Reschedule input prefill behavior:** when `selectedPost` changes, prefill `rescheduleInput` with `formatScheduledAtInputValue(new Date(selectedPost.scheduledForMs))` so the Save button starts disabled (unchanged-from-current). Use a `useEffect` keyed on `selectedPostId`.

**Page sections (in render order):**

1. Header card (`surface-card p-6`):
   - Eyebrow `Screen 7.5` (or whatever you settle on in specs — see §12)
   - H1 "Scheduled Posts Calendar"
   - Subtitle "All your scheduled, queued, published, and failed posts on a month grid."
   - Notice banner (success / error / info), identical to `/publish` lines 877–898.
2. Toolbar card:
   - Left: prev month (`<`), `Month Year` label, next month (`>`), `Today` button. `Today` calls `setViewMonth(startOfMonth(new Date()))`.
   - Right: status filter chips `All | Scheduled | Publishing | Published | Failed`. Use a typed `Array<'all' | ScheduledPostStatus>`. Currently-selected chip uses emerald background; inactive chips use slate border. Match `surface-card`/`pill` utility class style used elsewhere.
3. Calendar grid card:
   - `grid grid-cols-7 gap-2 text-center text-xs` — same Tailwind shape as `dashboard/page.tsx:878`.
   - Headers: 7 cells with the day labels.
   - Blank cells: empty `<div />` filler matching grid cell height.
   - Day cells: minimum height `min-h-[100px]`, padding `p-2`, white background, `rounded-xl border border-slate-200`. Date label top-right (`text-xs font-semibold text-slate-700`). Today cell adds a ring (`ring-2 ring-emerald-400`). Below the date, render up to 3 post pills (`max 3`), then if `posts.length > 3` a `+N more` text button that, on click, sets `selectedPostId` to the first hidden post's id (cheap v1 behavior — opens the detail panel directly to that post; the architect prompt's "expand cell or open day-summary modal" is acceptable but not required, so go with the single-open-detail behavior as the simpler implementation).
4. Post pill (button element, NOT anchor — opens the detail panel via `setSelectedPostId(post.id)`):
   - `<button type="button" data-testid={`calendar-post-pill-${post.id}`} ...>`.
   - Width `w-full`, padding `px-2 py-1`, text-left, truncate.
   - Status-driven className map (define at module scope):
     ```ts
     const STATUS_PILL_CLASSNAMES: Record<ScheduledPostStatus, string> = {
       scheduled: 'bg-teal-100 text-teal-900 hover:bg-teal-200',
       publishing: 'bg-amber-100 text-amber-900 hover:bg-amber-200',
       published: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200',
       failed: 'bg-red-100 text-red-900 hover:bg-red-200',
       cancelled: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
     };
     ```
     Resolve via `STATUS_PILL_CLASSNAMES[post.status ?? 'scheduled']`.
   - Content: small status dot (a `<span className="inline-block h-2 w-2 rounded-full ${dotColor}" />`), `formatLocalTime(post.scheduledForMs)` (HH:MM), then a truncated `post.articleTitle`. Add a small external-link glyph `↗` at the end when `status === 'published' && post.postUrl` — but the pill itself still opens the detail panel (don't open the URL on pill click; the detail panel renders the "View on LinkedIn" link).
   - `title` attribute for hover-tooltip with status + scheduled time + `failureReason` when present.
5. Empty state for the month:
   - When `filteredPosts.length === 0` and `scheduledPosts.length === 0` overall: small empty card "No scheduled posts yet." with a "Go to Publish →" link to `/publish`.
   - When `filteredPosts.length === 0` for the current month but `scheduledPosts.length > 0`: muted "No posts in this month. Use the arrows to navigate." line.
6. Detail panel: render conditionally when `selectedPost !== null`. Use a centered modal (`fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center` outer; inner `surface-card max-w-2xl w-full mx-4 p-6 max-h-[85vh] overflow-y-auto`) — modal is simpler than a side-slide-out and matches the existing modal patterns (e.g. delete-account modal in Settings). Architect prompt allowed either; pick modal.
   - Click outside (the dimmed backdrop) closes the panel via `setSelectedPostId(null)`. The inner card has its own `onClick={(e) => e.stopPropagation()}` so backdrop clicks don't bubble.
   - Esc key also closes — add a `useEffect` that subscribes to `keydown` while `selectedPostId !== null`.
   - Inside:
     1. Header row: status badge + article title + close `×` button.
     2. Idea topic + angle title (read-only `<p>` lines).
     3. Scheduled time row: `new Date(post.scheduledForMs).toLocaleString()` (local) with a `title` tooltip showing the UTC ISO via `new Date(post.scheduledForMs).toISOString()`.
     4. Platforms: chip row from `post.platforms.map(formatPlatformLabel)`.
     5. Content preview: `<pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 max-h-60 overflow-y-auto">{post.contentSnapshotLinkedin}</pre>` — read-only.
     6. **Published path** — when `post.status === 'published'`: emerald "Published" badge + when `post.postUrl` present: `<a href={post.postUrl} target="_blank" rel="noopener noreferrer" ...>View on LinkedIn →</a>` and a `publishedAtMs` line.
     7. **Failed path** — when `post.status === 'failed'`: red "Failed" badge + `Failure reason: {post.failureReason || 'unknown'}` line + when `failureReason === 'token_expired'`: `<Link href="/settings#integrations">Reconnect LinkedIn →</Link>`.
     8. **Reschedule section** — render ONLY when `isReschedulable(post.status) && post.scheduledForMs >= Date.now() || post.status === 'failed'` (a failed row can always be rescheduled to a new future time; a `scheduled` row in the past shouldn't show reschedule, just cancel). Concretely the visibility predicate is:
        ```ts
        const canReschedule =
          isReschedulable(post.status) &&
          // for currently-scheduled rows, only show reschedule if not already in the past
          (post.status === 'failed' || post.scheduledForMs > Date.now());
        ```
        Contents:
        - Section heading "Reschedule"
        - `<input type="datetime-local" value={rescheduleInput} onChange={...} />`
        - Quick-preset buttons row: `+1h`, `+1d`, `+1w` — each computes a new Date from `Math.max(Date.now(), post.scheduledForMs) + delta`, then writes via `setRescheduleInput(formatScheduledAtInputValue(...))`. (Use the max so a `failed` row whose original time is now in the past still gets a future preset.)
        - Save button: disabled when `parseScheduledAtInputValue(rescheduleInput) <= Date.now() + 60_000` OR `parseScheduledAtInputValue(rescheduleInput) === post.scheduledForMs` OR `reschedulingId === post.id`.
        - Save button copy: `reschedulingId === post.id ? 'Rescheduling…' : 'Save reschedule'`.
        - On click, call `handleReschedule(post.id)` (see §6.5 below).
     9. **Cancel section** — render when `isCancellable(post.status)`. Identical inline two-step confirm to the existing `/publish` page's Cancel pattern (`publish/page.tsx` lines 1210–1244):
        - Initial: red outlined `Cancel` button.
        - On click: `setConfirmingCancelId(post.id)`. The button row swaps to `Confirm cancel` (red filled) + `Keep` (neutral).
        - On `Confirm cancel`: call `handleCancel(post.id)` (see §6.5).
        - `data-testid="calendar-detail-cancel"` and `data-testid="calendar-detail-confirm-cancel"`.

### 6.4 New client wrapper — `rescheduleScheduledPost` in `frontend/src/lib/publish.ts`

**Location in file:** insert at the END of the file, after the existing `cancelScheduledPost` function (after line 306). Match the structure of `cancelScheduledPost` exactly.

**Type declarations to add (immediately above the function):**

```ts
// ---------------------------------------------------------------------------
// rescheduleScheduledPost — PATCH /api/v1/publish/schedule/{id}
// Updates the EventBridge schedule (best-effort delete+create) AND the
// Firestore row's scheduledForMs/scheduledForIso/status/updatedAt.
// ---------------------------------------------------------------------------

export type RescheduleSuccess = {
  success: true;
  scheduledPostId: string;
  scheduledForMs: number;
  eventBridgeScheduleName: string | null;
};

export type RescheduleFailure = {
  success: false;
  error: string;
  status: number;
};

export type RescheduleResult = RescheduleSuccess | RescheduleFailure;
```

**Function body:**

```ts
/**
 * Reschedule a scheduled post to a new future time. Never throws.
 *
 * Backend refuses when the row is mid-publish or already published
 * (409 status_not_reschedulable), when the doc doesn't exist (404 not_found),
 * when the new time is too soon (422 scheduled_too_soon), when EventBridge
 * provisioning fails (502 reschedule_provisioning_failed), or when the
 * Firestore write fails (500 reschedule_write_failed). All are surfaced as
 * typed failure outcomes the caller can branch on.
 */
export async function rescheduleScheduledPost(
  scheduledPostId: string,
  newScheduledForMs: number,
): Promise<RescheduleResult> {
  const auth = getFirebaseAuth();
  const currentUser = auth?.currentUser ?? null;
  if (!currentUser) {
    return { success: false, error: 'not_signed_in', status: 401 };
  }

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken();
  } catch {
    return { success: false, error: 'not_signed_in', status: 401 };
  }

  const baseUrl = getBackendApiBaseUrl();
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/api/v1/publish/schedule/${encodeURIComponent(scheduledPostId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ scheduledForMs: newScheduledForMs }),
      },
    );
  } catch {
    return { success: false, error: 'network', status: 0 };
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (response.ok && parsed && parsed.success === true) {
    const returnedMs =
      typeof parsed.scheduledForMs === 'number' && Number.isFinite(parsed.scheduledForMs)
        ? (parsed.scheduledForMs as number)
        : newScheduledForMs;
    return {
      success: true,
      scheduledPostId: asString(parsed.scheduledPostId) || scheduledPostId,
      scheduledForMs: returnedMs,
      eventBridgeScheduleName:
        typeof parsed.eventBridgeScheduleName === 'string'
          ? parsed.eventBridgeScheduleName
          : null,
    };
  }

  const detail =
    typeof parsed?.detail === 'string'
      ? parsed.detail
      : typeof parsed?.error === 'string'
      ? parsed.error
      : 'unknown';
  return { success: false, error: detail, status: response.status || 0 };
}
```

This mirrors `cancelScheduledPost` line-for-line; reuse the existing `asString` helper already in the file.

### 6.5 Handler functions on the calendar page

```ts
const handleReschedule = useCallback(async (postId: string) => {
  if (!currentUid) {
    setNotice({ tone: 'error', message: 'Sign in to reschedule a post.' });
    return;
  }
  const newMs = parseScheduledAtInputValue(rescheduleInput);
  if (!newMs) {
    setNotice({ tone: 'error', message: 'Pick a valid date and time.' });
    return;
  }
  if (newMs <= Date.now() + 60_000) {
    setNotice({ tone: 'error', message: 'Pick a time at least one minute in the future.' });
    return;
  }
  setReschedulingId(postId);
  try {
    const result = await rescheduleScheduledPostApi(postId, newMs);
    if (result.success) {
      setNotice({
        tone: 'success',
        message: `Scheduled post moved to ${new Date(result.scheduledForMs).toLocaleString()}.`,
      });
      // Firestore listener will refresh the row; keep the detail panel open so the user sees the new time
    } else if (result.error === 'status_not_reschedulable') {
      setNotice({ tone: 'error', message: 'This post is already publishing or published and can\'t be moved.' });
    } else if (result.error === 'not_found') {
      setNotice({ tone: 'error', message: 'Scheduled post not found (it may have already been cancelled).' });
    } else if (result.error === 'scheduled_too_soon') {
      setNotice({ tone: 'error', message: 'Pick a time at least one minute in the future.' });
    } else if (result.error === 'reschedule_provisioning_failed') {
      setNotice({ tone: 'error', message: 'Scheduling backend is temporarily unavailable. Please retry.' });
    } else if (result.error === 'reschedule_write_failed') {
      setNotice({ tone: 'error', message: 'Could not save the new time. Please retry.' });
    } else if (result.error === 'not_signed_in') {
      setNotice({ tone: 'error', message: 'Sign in to reschedule a post.' });
    } else if (result.error === 'network') {
      setNotice({ tone: 'error', message: 'Network error while rescheduling. Check your connection and try again.' });
    } else {
      setNotice({ tone: 'error', message: `Failed to reschedule: ${result.error}` });
    }
  } finally {
    setReschedulingId(null);
  }
}, [currentUid, rescheduleInput]);

const handleCancel = useCallback(async (postId: string) => {
  if (!currentUid) {
    setNotice({ tone: 'error', message: 'Sign in to cancel a scheduled post.' });
    return;
  }
  setCancellingId(postId);
  try {
    const result = await cancelScheduledPostApi(postId);
    if (result.success) {
      setNotice({ tone: 'success', message: 'Scheduled post cancelled.' });
      setSelectedPostId(null); // Firestore listener will remove the row; close the panel
    } else if (result.error === 'status_not_cancellable') {
      setNotice({ tone: 'error', message: 'This post is already publishing or published and can\'t be cancelled.' });
    } else if (result.error === 'not_found') {
      setNotice({ tone: 'error', message: 'Scheduled post not found (it may have already been cancelled).' });
    } else if (result.error === 'not_signed_in') {
      setNotice({ tone: 'error', message: 'Sign in to cancel a scheduled post.' });
    } else if (result.error === 'network') {
      setNotice({ tone: 'error', message: 'Network error while cancelling. Check your connection and try again.' });
    } else {
      setNotice({ tone: 'error', message: `Failed to cancel scheduled post: ${result.error}` });
    }
  } finally {
    setCancellingId(null);
    setConfirmingCancelId(null);
  }
}, [currentUid]);
```

### 6.6 Sidebar nav entry

**File:** `frontend/src/components/Nav.tsx`
**Edit:** add `Calendar` to the `moreLinks` array. The array currently has Analytics → Collaboration → Settings → Notifications (lines 33–38). Insert `Calendar` immediately before `Notifications` so the order becomes Analytics → Collaboration → Settings → Calendar → Notifications. (The architect prompt said "place it adjacent to Notifications since they're both schedule-related" — adjacent and just-above keeps Notifications visually last as the catch-all, which matches the existing alerts shortcut.)

Exact edit:

```ts
const moreLinks: SidebarLink[] = [
  { href: '/analytics', label: 'Analytics', icon: '↗' },
  { href: '/collaboration', label: 'Collaboration', icon: '⊙' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
  { href: '/calendar', label: 'Calendar', icon: '🗓' },
  { href: '/notifications', label: 'Notifications', icon: '🔔' },
];
```

The icon `🗓` is the existing convention (single-character emoji glyph, same as the other entries). The mobile pill row picks this up automatically because `allLinks = [dashboardLink, ...pipelineLinks, ...moreLinks]`.

### 6.7 Component extraction policy

**Do NOT** extract a `<ScheduledPostsCalendar />` component upfront. The architect prompt allows it "if it'd otherwise bloat the page file past ~400 lines." The recommendation: write everything inline in `calendar/page.tsx` first; if the final file exceeds 450 lines (count after typecheck passes), refactor the grid-only block (sections 3 + 4 + helper functions) into `frontend/src/components/ScheduledPostsCalendar.tsx`, accepting props `{ posts, viewMonth, onSelectPost, statusFilter }`. Keep the detail panel inside `calendar/page.tsx` either way — it owns mutable state that the grid doesn't need.

## 7. Environment & Configuration

**None.** No new env vars. The endpoint uses the same `verify_firebase_id_token` dependency, the same `get_firestore_client`, and the same `eventbridge_scheduler` module that are already wired up. Local-dev no-op mode (`SCHEDULER_LAMBDA_ARN` unset) continues to work — `update_schedule` just calls the no-op `delete_schedule` then the no-op `create_one_shot_schedule`, returning silently. Firestore write still happens. The frontend wrapper uses the same `getBackendApiBaseUrl()` resolver that all the other wrappers use.

## 8. File System Changes

```
backend/app/routers/publish.py
  — add PATCH /publish/schedule/{scheduled_post_id} endpoint + RescheduleRequest Pydantic model

frontend/src/lib/scheduledPosts.ts                                — NEW: shared types + parser
frontend/src/lib/publish.ts                                        — add rescheduleScheduledPost + RescheduleResult types
frontend/src/app/(app)/calendar/page.tsx                           — NEW: the calendar page
frontend/src/app/(app)/publish/page.tsx                            — refactor to import from @/lib/scheduledPosts
frontend/src/components/Nav.tsx                                    — add Calendar entry to moreLinks

specs/backend.md                                                   — document PATCH endpoint
specs/frontend.md                                                  — add Screen 7.5; document rescheduleScheduledPost wrapper
specs/screens.md                                                   — add new top-level screen entry
specs/automation.md                                                — update Scheduling Logic Edit/reschedule line; Integration Points table row; Known Gaps
```

**Optional (only if calendar/page.tsx exceeds ~450 lines after typecheck):**
```
frontend/src/components/ScheduledPostsCalendar.tsx                 — extracted grid component
```

**No new tests** — out of scope for this slice (the architect prompt does not require tests). The `playwright-tester` subagent can be invoked separately by the feature-loop after merge.

## 9. Edge Cases & Risks

1. **Reschedule a `failed` row.** Status flips back to `'scheduled'`. `failureReason` stays on the row for audit — this is intentional. The UI must still hide the failure-reason badge in the calendar pill once `status === 'scheduled'` (the calendar reads `post.status`, not `failureReason`, so this works automatically).
2. **Reschedule a row whose original time is now in the past (failed row).** The Save button's lower-bound check uses `Date.now() + 60_000`, NOT `post.scheduledForMs`. Quick-preset buttons use `Math.max(Date.now(), post.scheduledForMs) + delta` so `+1h` always lands in the future.
3. **EventBridge eventual consistency.** `update_schedule` is delete-then-create. There is a tiny window (typically <1s) between the delete and the create where no schedule exists. If the user reschedules a post whose original fire-time is in the next minute, the racing fire might be lost. The 60-second `_MIN_SCHEDULE_LEAD_MS` floor protects against this — the new schedule is at least 60s in the future, and the delete-create completes well within that.
4. **Two browser tabs open on `/calendar`.** Both subscribe to the same Firestore listener and re-render on every update. PATCH from tab A → Firestore listener fires on both A and B → both re-render with the new time. Safe.
5. **User cancels via `/publish` while detail panel is open on `/calendar`.** The Firestore listener removes the row → `scheduledPosts` excludes it → `selectedPost = useMemo(() => scheduledPosts.find(...)) ` returns `null` → the detail panel renders nothing. Add `if (!selectedPost) return null;` guard before rendering the modal body so this is a clean fall-through.
6. **Reschedule fails midway (EventBridge succeeded, Firestore failed).** Backend returns 500 `reschedule_write_failed`. The schedule fires at the **new** time but the row still has the old `scheduledForMs`. `publish_one` reads `scheduledForMs` from the row only to compute `scheduledForIso` for finalizing — the actual publish happens regardless. This is acceptable; the planned safety-net sweeper would catch any drift, and the user can simply re-press Save (idempotent on the EventBridge side because the schedule name is deterministic).
7. **Account deletion mid-reschedule.** The frontend `account.ts` deletion purges `scheduledPosts` rows but does not call `delete_schedule`. EventBridge will fire against a deleted doc; `publish_one` returns `skipped: missing_doc` and the schedule auto-deletes via `ActionAfterCompletion="DELETE"`. Pre-existing v1 limitation, documented in `automation.md` Known Gaps. No new risk.
8. **Status check race.** Between the `snapshot.exists` check and the `update()` call, a parallel writer could flip the row to `publishing`. The status gate is a read-time check, not a CAS. Acceptable for v1 — the worst case is the user reschedules a row that is microseconds into `publishing`, which then immediately finalizes; the next EventBridge fire would no-op via the `postUrn` idempotency short-circuit in `publish_one`.
9. **DST transitions.** The reschedule input is `datetime-local` (local-time wall-clock). `new Date(value).getTime()` already handles DST correctly. No special-case needed.
10. **Token expiry while detail panel is open.** `rescheduleScheduledPost` returns `not_signed_in` (401) on `getIdToken` failure. The notice surfaces "Sign in to reschedule a post." Acceptable; the user re-authenticates via the existing auth guard in `(app)/layout.tsx` on next route change.

## 10. Acceptance Criteria

A new chat invocation of the `playwright-tester` subagent should be able to verify ALL of these, signed in as the QA account, with the FastAPI backend running. The Developer must verify the Backend criteria via `pytest` / `curl` and the Frontend criteria via `cd frontend && npx tsc --noEmit` plus a manual browser smoke.

### Backend (`backend/app/routers/publish.py`)

1. `PATCH /api/v1/publish/schedule/{id}` exists at the documented path.
2. With no `Authorization` header → HTTP 401 from the `verify_firebase_id_token` dependency.
3. With a valid token but an `id` that doesn't exist under the verified user → HTTP 404 `not_found`.
4. With a valid token + existing doc + `scheduledForMs <= now + 60_000` → HTTP 422 `scheduled_too_soon`. The Firestore row is NOT modified.
5. With a valid token + existing doc whose `status ∈ {publishing, published}` → HTTP 409 `status_not_reschedulable`. The Firestore row is NOT modified.
6. With a valid token + existing doc whose `status === 'failed'` + `scheduledForMs > now + 60_000`:
   - Returns HTTP 200 `{ success: true, scheduledPostId, scheduledForMs: <new ms>, eventBridgeScheduleName: <name|null> }`.
   - The Firestore row has been updated: `scheduledForMs`, `scheduledForIso`, `status === 'scheduled'`, `updatedAt` is a fresh server timestamp.
   - `attemptCount`, `failureReason`, `eventBridgeScheduleName`, `createdAt`, `platforms`, and `contentSnapshot.linkedin` are unchanged.
7. With AWS env configured AND boto3's `create_schedule` raising (mocked) → HTTP 502 `reschedule_provisioning_failed`. The Firestore row is NOT modified.
8. With AWS env configured AND boto3 succeeding AND Firestore `update()` raising (mocked) → HTTP 500 `reschedule_write_failed`. (EventBridge state may be drifted — acceptable per §9.6.)
9. Two PATCH calls in sequence against the same row both succeed (idempotent: `update_schedule` is delete-then-create against the same name).

### Frontend

10. Navigating to `/calendar` while signed in renders the page; the desktop sidebar shows the new `Calendar` entry between `Settings` and `Notifications` and highlights it as active.
11. Scheduling a LinkedIn post on `/publish` (with `scheduledForMs` in the current month) shows that post on the corresponding day cell within ~1 second (Firestore listener), styled with the teal `scheduled` pill.
12. Clicking the pill opens the detail panel/modal. The modal shows: article title, idea topic, angle title, scheduled time (local, with UTC tooltip), platforms = `LinkedIn`, the LinkedIn content snapshot, and reschedule + cancel sections.
13. Selecting a new future datetime in the reschedule input and clicking Save → success notice "Scheduled post moved to ..." → the pill moves to the new day in the grid (Firestore listener) → modal still open and now shows the new scheduled time.
14. Clicking `+1h` quick-preset advances the datetime input by 1 hour from `max(now, post.scheduledForMs)`; `+1d` by 1 day; `+1w` by 7 days. Save remains disabled until the input is different from the current scheduled time AND `>= now + 60_000`.
15. Clicking Cancel → red `Cancel` reveals inline `Confirm cancel` + `Keep` two-step. Confirming calls `cancelScheduledPostApi` → success notice → row vanishes from the grid → modal closes.
16. Status filter chip "Failed" hides everything except `status === 'failed'` rows. Chip "All" restores.
17. Month nav: `<` decrements `viewMonth`, `>` increments, `Today` resets to current month. Today's date cell has an emerald ring.
18. A published row shows the emerald `published` pill; clicking it opens the detail panel with `View on LinkedIn →` link rendered. The pill click itself does NOT open the LinkedIn URL — only the detail-panel link does.
19. A failed row with `failureReason === 'token_expired'` shows the red `failed` pill; the detail panel surfaces the `Reconnect LinkedIn →` link to `/settings#integrations`.
20. `cd frontend && npx tsc --noEmit` passes after all edits.
21. `/publish` page still works end-to-end after the shared-module refactor: scheduling, cancelling, and the upcoming/failed/recently-published lists all render correctly.

### Spec sync

22. `specs/backend.md` documents the new `PATCH /api/v1/publish/schedule/{id}` endpoint with the same structure as the POST/DELETE entries (location, auth, purpose, validation order, side effects, success/error responses).
23. `specs/frontend.md` adds a Screen 7.5 entry between Screen 7 and Screen 8, plus documents the `rescheduleScheduledPost` wrapper, plus a new TODO Tracker row.
24. `specs/screens.md` adds a `7.5 — Scheduled Posts Calendar` entry between Section 7 and Section 8.
25. `specs/automation.md`:
    - `Scheduling Logic` `Edit/reschedule:` line says DONE with a one-sentence summary of the calendar flow.
    - Integration Points table has a new row `Reschedule scheduled post | PATCH /api/v1/publish/schedule/{id} | rescheduleScheduledPost(id, newMs) | DONE`.
    - Known Gaps: remove "reschedule UI is still TODO"; add a new bullet noting drag-to-reschedule on the calendar grid is planned future work.

---

## 11. Branch + commit policy

- Create the feature branch with `git checkout -b scheduled-posts-calendar-page` from the current `aws-lambda-eventbridge-scheduler` branch.
- One coherent commit per logical unit is fine; do NOT amend or force-push.
- Do NOT push to remote.
- Do NOT open a PR.

## 12. Spec section numbering

For `specs/screens.md` and `specs/frontend.md`, use the heading `## 7.5 — Scheduled Posts Calendar (/calendar)` and `### Screen 7.5 — Scheduled Posts Calendar (/calendar)` respectively. Place each entry between the existing `Screen 7 — Publishing & Scheduling` and `Screen 8 — Review & Approval Workflow` blocks.

In `specs/frontend.md`, also add a new row to the `TODO Tracker` table (under the `Publishing & Scheduling` block):

```
| Scheduled Posts Calendar | Month grid + detail panel | DONE |
| Scheduled Posts Calendar | Reschedule (move) | DONE |
| Scheduled Posts Calendar | Cancel from calendar | DONE |
| Scheduled Posts Calendar | Drag-to-reschedule | TODO |
```

In `specs/automation.md`, the Scheduling Logic `Edit/reschedule:` rewrite should read:
> **Edit/reschedule:** DONE. The new `/calendar` page surfaces every scheduled / publishing / published / failed row on a month grid and exposes a Reschedule control (datetime-local + quick presets `+1h`/`+1d`/`+1w`) in the per-post detail panel. Confirming calls `PATCH /api/v1/publish/schedule/{id}` which atomically updates Firestore + recreates the EventBridge schedule via `eventbridge_scheduler.update_schedule` (delete-then-create on the deterministic name `publish-<id>`). Only rows with `status ∈ {scheduled, failed}` are reschedulable; `publishing` and `published` return HTTP 409 `status_not_reschedulable`.

---

## 13. Final notes for the Developer

- **Do NOT push to remote.** The user explicitly requested this.
- **Do NOT open a PR.** Same.
- **Do NOT modify `eventbridge_scheduler.update_schedule`.** It already works.
- **Do NOT reimplement cancel.** It already works.
- **Do NOT add drag-to-reschedule, recurring schedules, iCal export, multi-platform publishing, or empty-day "schedule new post" flows.** All out of scope.
- The `<>=` direction matters: backend uses `<=` for the floor (`scheduled_for_ms <= now + 60_000` triggers `scheduled_too_soon`). Mirror that on the frontend Save-disable predicate.
- Status-driven pill colors: scheduled=teal, publishing=amber, published=emerald, failed=red. Match the existing per-section card colors on `/publish` (`bg-emerald-50` for published, `bg-red-50` for failed, etc.) so the visual language is consistent.
- Mon-first calendar header order — NOT Sun-first. Confirmed against `dashboard/page.tsx:128`.
- The detail panel is a centered modal, not a side slide-out. Esc key + backdrop click close.
- Verify with `cd frontend && npx tsc --noEmit` before considering the frontend portion done.
- Verify the backend with whatever pytest fixtures exist in `backend/tests/` (or curl smoke-tests in local-dev no-op mode) before considering the backend portion done.

TIP complete. Hand off to Developer.
