# TODO / Issues — Adapt ↔ Storyboard ↔ Publish Cross-Screen Audit
_Generated: 2026-04-26_

Scope: Cross-screen consistency audit of `/adapt/[id]`, `/storyboard` (+ `/storyboard/[id]`), and `/publish` for the marketing dashboard frontend. Signed in as `qa@example.com` and exercised the existing two seed adaptations (`Cycle2 fresh no-angle probe…` and `Review workflow QA topic`) plus their scheduled posts. Verified delete, edit, status/platform, schedule, unpublish, and variant flows; reloaded each screen between steps; captured screenshots when state diverged.

Top-line result: The three screens read from three different Firestore collections (`drafts` for storyboard, `adaptations` for adapt + publish, `scheduledPosts` for the reminder list) and **none of the user-initiated mutations cascade**. Deleting an adaptation leaves orphaned `drafts` and `scheduledPosts`; deleting a storyboard leaves orphaned `adaptations` and `scheduledPosts`; opening `/adapt/[id]` for any adaptation whose source `ideas/{ideaId}` doc was never written (true for the two existing demo records) hard-fails with "Unable to find the requested idea." On top of that, `/publish` only renders 2 of the 5 platforms supported by `/adapt`, so any Medium/Newsletter/Blog work is invisible downstream. Net effect: the user can produce content that the next screen does not see, and can delete things that leave dangling references everywhere else.

## 1. Cross-Screen Consistency Bugs (P0)

### 1.1 Deleting an adaptation in `/adapt/[id]` leaves an orphaned `scheduledPosts` row visible on `/publish`
- File: `frontend/src/app/(app)/adapt/[id]/page.tsx:901-915` (`deleteAdaptation`)
- Repro:
  1. `/publish` -> on the Cycle2 LinkedIn card, set the datetime input ~24h ahead and click **Schedule**. Notice the new entry under "Upcoming Scheduled Posts".
  2. `/adapt/LV1ktHx1We3ZX8VI783g?angleId=fallback-1` -> click **Delete Adaptation**, accept confirm. Router pushes to `/storyboard`.
  3. Reload `/publish`.
- Observed: "Loaded adaptations: 1" (Cycle2 gone), but the Upcoming Scheduled Posts list still shows `Cycle2 fresh no-angle probe 2026-04-21T05:39Z · 4/27/2026, 4:33:00 PM · LinkedIn`. Screenshot: `audit-orphan-scheduled.png`.
- Expected: deleting the adaptation should also delete (or at least cancel/flag) any `users/{uid}/scheduledPosts` whose `ideaId`+`angleId` point at the deleted record.
- Next step: in `deleteAdaptation`, run `getDocs(query(collection(db,'users',uid,'scheduledPosts'), where('ideaId','==',ideaId), where('angleId','==',angleIdFromQuery)))` and `deleteDoc` the matches in a `writeBatch`. Same for the corresponding `users/{uid}/drafts/{ideaId_angleId}` doc that powers the storyboard list.

### 1.2 Deleting a storyboard in `/storyboard` leaves both the adaptation and its scheduled posts orphaned
- File: `frontend/src/app/(app)/storyboard/page.tsx:92-106` (`deleteRecord`)
- Repro:
  1. `/storyboard` -> click **Delete** on the Cycle2 row, accept confirm.
  2. Reload `/publish` and (separately) `/adapt/LV1ktHx1We3ZX8VI783g?angleId=fallback-1`.
- Observed: storyboard list shrinks correctly, but the Cycle2 scheduled post is still in `Upcoming Scheduled Posts` on `/publish`, and (when the underlying adaptation doc is also still present from a fresh seed) it would still load on `/adapt`. The delete only calls `deleteDoc(doc(db,'users',uid,'drafts',record.id))` — it does not touch `adaptations/{record.id}` or any `scheduledPosts` with the same `ideaId`.
- Expected: deleting a storyboard scene should cascade to its child adaptation doc and any pending scheduled posts (or surface a confirm-with-cascade dialog).
- Next step: in `deleteRecord`, also `deleteDoc(doc(db,'users',uid,'adaptations',record.id))` and batch-delete `scheduledPosts` filtered by `ideaId`/`angleId`.

### 1.3 Adaptation supports 5 platforms but `/publish` only renders 2 (LinkedIn, X/Twitter)
- File: `frontend/src/app/(app)/publish/page.tsx:11` (`type PlatformKey = 'linkedin' | 'twitter'`); `parseAdaptationRecord` at line 44-59 ignores `medium`, `newsletter`, `blog`.
- Compare with `frontend/src/app/(app)/adapt/[id]/page.tsx:96-102` `PLATFORM_CONFIG` (linkedin, twitter, medium, newsletter, blog).
- Repro: From dashboard "All Adaptations" card the Cycle2 record was tagged `Newsletter · Medium · Blog · LinkedIn · X / Twitter`. Open `/publish` and only LinkedIn + X cards render — Medium/Newsletter/Blog content is invisible and unreachable for scheduling/publishing.
- Expected: every platform a user generated in `/adapt` should appear (or at least be selectable) on `/publish`.
- Next step: widen `PlatformKey` in `publish/page.tsx`, expand `parseAdaptationRecord`, and add render branches/scheduling controls for the three additional platforms (or, if intentional, hide the extra tabs in `/adapt` to match — but the dashboard summary already promises five).

### 1.4 Storyboard list links to `/storyboard/[id]` and `/adapt/[id]` that crash when `users/{uid}/ideas/{ideaId}` is missing
- Files:
  - `frontend/src/app/(app)/adapt/[id]/page.tsx:387-390` (`if (!ideaSnapshot.exists()) setContextError('Unable to find the requested idea. It may have been deleted.')`).
  - Equivalent guard on the storyboard detail page (`/storyboard/[id]?angleId=…`) which produced "Could not find the idea for this storyboard. It may have been deleted." for `review-test-idea`.
- Repro:
  1. `/storyboard` -> click the **Review workflow QA topic** row.
  2. Page resolves to `/storyboard/review-test-idea?angleId=review-test-angle` and shows only "Could not find the idea for this storyboard… Back to Angles". Same dead end at `/adapt/review-test-idea?angleId=review-test-angle`. Screenshot: `audit-adapt-cannot-find-idea.png`.
- Expected: `/storyboard` should not list rows whose source idea no longer exists, OR the adapt/storyboard pages should fall back to the data they already have on the `drafts`/`adaptations` doc (`ideaTopic`, `angleTitle`) instead of hard-failing.
- Next step: either (a) filter `StoryboardIndexPage` records to only those whose idea still exists, or (b) in adapt/storyboard detail pages, treat the `ideas/{id}` doc as optional and synthesize an `IdeaRecord` from the `drafts`/`adaptations` payload (which already carries `ideaTopic`).

### 1.5 `/publish` "Edit" + "Delete" mutate the `adaptations` doc but `/adapt` keeps a stale local snapshot until reload
- Files: `frontend/src/app/(app)/publish/page.tsx:332-381` (`savePlatformEdit`), `383-430` (`deletePlatformContent`); `frontend/src/app/(app)/adapt/[id]/page.tsx:451-501` reads the doc once via `getDoc` and gates re-fetch behind `firebaseLoaded`.
- Repro:
  1. `/publish` -> on Cycle2 LinkedIn card click **Edit**, replace text with `PUBLISH_EDIT_MARKER_2026 — LinkedIn updated FROM publish screen.`, click **Save Edit**.
  2. Open `/adapt/LV1ktHx1We3ZX8VI783g?angleId=fallback-1` in another tab without reloading the publish tab.
- Observed: hard refresh of `/adapt` does pick up the new value (good), but if you had `/adapt` already open it shows the stale prior content — `/adapt` uses a one-shot `getDoc` rather than `onSnapshot`, while `/publish` uses `onSnapshot`. This breaks the stated intent of "test different forms of … changing things and seeing if the changes are applied everywhere they are supposed to be" because two open tabs disagree.
- Expected: both screens should subscribe via `onSnapshot` (or one should explicitly invalidate when window regains focus) so an edit on either side is reflected on the other without a full reload.
- Next step: in adapt's load effect (`adapt/[id]/page.tsx:451`), replace `getDoc` with `onSnapshot` and merge updates that arrive after the user has been idle on the textarea (debounced).

### 1.6 Storyboard list reads `drafts` collection but `/adapt` writes `adaptations` — the two are not kept in sync
- Files: `frontend/src/app/(app)/storyboard/page.tsx:59` (queries `drafts`), `frontend/src/app/(app)/adapt/[id]/page.tsx:519-534` (writes `adaptations`, never touches `drafts`).
- Repro: Generate a brand new adaptation via `/adapt/new` -> it auto-saves to `users/{uid}/adaptations/{ideaId_angleId}` but never creates a matching `users/{uid}/drafts/{ideaId_angleId}`. Open `/storyboard` and the new piece is missing from the list while the dashboard's "All Adaptations" card and `/publish` already show it.
- Expected: a single source of truth, or a server-side write that creates both docs atomically.
- Next step: pick one collection (the codebase already uses both inconsistently); the lowest-risk fix is to also `setDoc` a thin `drafts/{ideaId_angleId}` record from `saveAdaptation` (status, ideaTopic, angleTitle, updatedAt) so the storyboard list never falls behind. Long term, drop the `drafts` collection and have storyboard query `adaptations`.

## 2. Broken / Dead UI (P1)

### 2.1 `/storyboard` rows that point at missing idea docs are clickable dead ends
- File: `frontend/src/app/(app)/storyboard/page.tsx:138-154`
- Repro: covered in §1.4. Both `/storyboard/[id]?angleId=…` and `/adapt/[id]?angleId=…` show only an error and a "Back" button. The Delete button on the same row works, but the user has no way to discover that's the only useful action.
- Next step: hide the link affordance and surface a "Source idea missing — delete or recreate" badge on the row when `ideaSnapshot.exists()` is false at write time, or filter such rows out of the index entirely.

### 2.2 `/publish` "Edit Adaptation" button vanishes when `ideaId` or `angleId` are blank, with no fallback
- File: `frontend/src/app/(app)/publish/page.tsx:474-476` (`editAdaptationHref` is `null` when either is empty)
- Repro: any seed/legacy adaptation written without `ideaId`/`angleId` (none in current data, but easy to hit) renders without an Edit button, leaving the user stuck on `/publish` with content they can't fix on `/adapt`.
- Next step: render a disabled button with an explanatory tooltip, or mint a synthetic `/adapt/[id]` URL from the doc id (`id.split('_')`).

## 3. Missing Implementation (P1)

### 3.1 No "unpublish" / status revert on `/publish`
- Repro: `/publish` does not store a `status` on the `adaptations` doc, so deleting platform content (`Delete` button) just clears the platform string. There is no way to mark an adaptation as "draft" again, no `published_at`, and `/adapt` has no view of publish state. The user's scenario "Unpublish/remove from /publish -> adaptation status revert on /adapt?" cannot be exercised because neither side persists the status.
- Files to extend: `frontend/src/app/(app)/publish/page.tsx:383-430`, `frontend/src/app/(app)/adapt/[id]/page.tsx` (no status display today).
- Next step: add a `status` field to the `adaptations` payload (`draft | scheduled | published`), surface it on both screens, and write transitions from `schedulePost`, `deletePlatformContent`, and `deleteAdaptation`.

### 3.2 No cross-screen subscription for `scheduledPosts`
- Files: `frontend/src/app/(app)/adapt/[id]/page.tsx` does not query `scheduledPosts` at all, so the Adapt screen never warns "this adaptation has 1 pending scheduled post" before the user clicks Delete.
- Next step: subscribe to `scheduledPosts` filtered by `ideaId`/`angleId` in adapt and show a banner; pair with the cascade fix in §1.1.

### 3.3 New variants ("Add another adaptation for this scene") cannot be created from `/storyboard`
- Files: `frontend/src/app/(app)/storyboard/page.tsx:108-167` only renders existing rows + a single global `+ New Storyboard` link to `/ideas`. There is no UI to spawn a second adaptation against the same idea+angle (the path requires re-running the whole "ideas -> angles -> storyboard -> adapt" flow). The doc id pattern `ideaId_angleId` also forbids two adaptations per angle, so the only way to produce a "variant" is to fork the angle.
- Next step: explicit product decision needed — either allow multiple adaptations per angle (id pattern `ideaId_angleId_<n>`) and add a "+ New Variant" button per row, or document that variants live as separate angles.

## 4. UX Gaps (P2)

### 4.1 `/adapt` shows tabs that look generated but actually contain the raw markdown source
- File: `frontend/src/app/(app)/adapt/[id]/page.tsx:104-112` `createSeededPlatforms` seeds every platform from the source draft until the user runs generation.
- Repro: `/adapt/LV1ktHx1We3ZX8VI783g?angleId=fallback-1` -> click the `X / Twitter` tab. The textarea contains 2284 chars of `# Small Business execution blind spots…\n## Introduction\n…` — i.e., the markdown brief, not Twitter copy. /publish faithfully shows the same content as the X variant.
- Expected: tabs should not appear "ready" until generation has run; until then the X card on /publish should say "Not generated yet" instead of dumping markdown into a tweet textarea.
- Next step: distinguish "seeded-but-untouched" from "generated" (e.g., new boolean `generated[platform]`) and gate `tabVisiblePlatforms` plus the publish `showTwitterCard`/`showLinkedInCard` checks on it.

### 4.2 Confirm dialogs use blocking `window.confirm`
- Files: `adapt/[id]/page.tsx:904`, `storyboard/page.tsx:95`, `publish/page.tsx:390`. All three destructive actions use the native `confirm()`, which is inconsistent with the rest of the app's surface-card styling and forced me to stub `window.confirm = () => true` in tests.
- Next step: replace with a shared `<ConfirmDialog>` component.

### 4.3 No "Saved at" indicator on `/publish` after Edit/Delete
- File: `frontend/src/app/(app)/publish/page.tsx:332-381`. The `notice` ribbon says "LinkedIn content updated." but disappears on next interaction; the user has no persistent timestamp like `/adapt` provides.
- Next step: surface `updatedAt` per platform card.

## 5. Console / Network Issues (P2)

### 5.1 No JS errors observed during the audit
- Verified via `mcp__playwright__browser_console_messages` after each scenario (`Total messages: 12 (Errors: 0, Warnings: 1)` at end). Single warning is the standard Next.js dev-mode hydration notice.

### 5.2 Network: every screen issues independent Firestore subscriptions for the same data
- `/publish` and `/adapt` both subscribe to `adaptations`; `/storyboard` subscribes to `drafts`. Because of §1.6, the `drafts` query never returns the rows you just created on `/adapt`, so users see different "live" data on different tabs.
- Next step: bundled with the §1.6 fix.

## 6. Notes / Observations
- The two existing seed adaptations (`Cycle2 fresh no-angle probe…` ideaId `LV1ktHx1We3ZX8VI783g`, `Review workflow QA topic` ideaId `review-test-idea`) were used for all happy-path tests. Cycle2 was deleted during the audit (both the `adaptations` doc and the `drafts` doc); the `Review` adaptation now has its Twitter platform field cleared and a `PUBLISH_EDIT_MARKER_2026` LinkedIn marker. One orphaned scheduled post for Cycle2 (4/27/2026 4:33 PM LinkedIn) was created and intentionally left behind to demonstrate §1.1 / §1.2.
- Both `Review workflow QA topic` and (originally) Cycle2 were created without the upstream `users/{uid}/ideas/{id}` doc. That is the root of §1.4 — fixing the seed/data-creation path is probably the cheapest mitigation, but the runtime should still degrade gracefully.
- Screenshots saved at repo root: `audit-publish-after-edit.png`, `audit-orphan-scheduled.png`, `audit-storyboard-deleted-but-scheduled-survives.png`, `audit-adapt-cannot-find-idea.png`.
- Edit propagation Adapt -> Publish: PASS (LinkedIn marker round-tripped). Edit propagation Publish -> Adapt: PASS after reload, FAIL for an already-open Adapt tab (§1.5).
- Schedule write succeeded and immediately surfaced under "Upcoming Scheduled Posts"; the failure is the lack of cleanup, not the schedule itself.
