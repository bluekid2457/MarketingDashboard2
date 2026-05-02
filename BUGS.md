# Bugs Log

Local mirror of bug entries that should also be logged to Notion (Marketing Dashboard > Bugs). When the Notion MCP server is connected in a future session, copy these entries into the Notion database and remove them from this file.

---

## BUG-2026-05-01-001 — Publish page shows only LinkedIn + X cards; Medium / Newsletter / Blog adaptations never render

**Status:** Fixed
**Date / time:** 2026-05-01
**Verified by:** Playwright walkthrough on http://localhost:3000

### Summary
The Publish & Scheduling screen (`/publish`) hardcoded its `PlatformKey` union to `'linkedin' | 'twitter'`, dropped Medium / Newsletter / Blog values when reading adaptations from Firestore, and rendered two hand-written JSX card blocks rather than iterating the platform list. Adaptations created with Newsletter / Medium / Blog content (created in `/adapt`) were saved correctly to `users/{uid}/adaptations/{id}.platforms` but invisible on Publish, blocking scheduling for those platforms entirely.

### Steps to reproduce
1. Sign in to the dashboard.
2. Open an existing storyboard (or create one).
3. Navigate to `/adapt/{ideaId}?angleId={angleId}`.
4. Generate or paste content into the Newsletter platform tab and let autosave fire (writes to `users/{uid}/adaptations/{adaptationId}.platforms.newsletter`).
5. Navigate to `/publish`.
6. **Observed (before fix):** the adaptation block renders only LinkedIn and X / Twitter cards. Newsletter / Medium / Blog cards are absent. The dashboard's "All Adaptations" row correctly shows the platform pill list `X / Twitter · Newsletter · LinkedIn · Medium · Blog`, confirming the data is in Firestore.
7. **Expected:** every platform with saved content renders its own publish card with content textarea, Copy / Edit / Delete controls, and a Schedule picker.

### Root cause
In `frontend/src/app/(app)/publish/page.tsx`:
- `type PlatformKey = 'linkedin' | 'twitter';` narrowed the type to two platforms.
- `parseAdaptationRecord` only read `platforms.linkedin` and `platforms.twitter` from the Firestore document, silently dropping the other three.
- The scheduledPosts loader filter `entry === 'linkedin' || entry === 'twitter' ? entry : null` discarded any record whose platforms array referenced Medium / Newsletter / Blog.
- `formatPlatformLabel` only branched between LinkedIn and X / Twitter.
- The JSX hardcoded a LinkedIn `<section>` and a Twitter `<section>` rather than iterating the platforms map.

### Fix summary
Generalized the publish page to drive cards from the canonical 5-platform list (`linkedin | twitter | medium | newsletter | blog`), matching `frontend/src/lib/prompts/platforms/index.ts`:
- Widened `PlatformKey` to all five keys; added `PLATFORM_KEYS` array, `isPlatformKey` type guard, and `PLATFORM_LABELS` / `PLATFORM_CARD_META` lookup tables.
- `parseAdaptationRecord` now iterates `PLATFORM_KEYS` and copies any non-empty platform value into the adaptation's `platforms` map.
- `scheduledPosts` loader uses the new type guard so Newsletter / Medium / Blog scheduled posts also surface.
- The cards are now rendered by mapping over `cardEntries` (one entry per platform that has content or is being edited). LinkedIn keeps its compose-URL handoff button; X / Twitter keeps its intent-URL handoff button; Medium / Newsletter / Blog get a "Copy text + Schedule reminder" pair (no provider compose URL exists for those platforms).
- Dynamic schedule label ("Schedule LinkedIn post" vs. "Schedule Newsletter reminder") clarifies that compose-URL platforms publish one-click, while reminder-only platforms expect the user to paste into their own tool.
- Existing controls (Run plagiarism check, Edit / Save / Cancel, Delete, schedule date picker) all generalize without behavioral changes for LinkedIn / X.

### Files changed
- `frontend/src/app/(app)/publish/page.tsx` — full rewrite of the cards section; type widening; parser fix.
- `specs/frontend.md` — Screen 7 "Sections" list updated to describe the 5-platform card model and renumbered downstream items.
- `specs/database.md` — `users/{uid}/scheduledPosts.platforms` now explicitly lists all 5 valid keys.

### Verification (Playwright)
- Before: `/publish` rendered only `publish-card-linkedin` and `publish-card-twitter`.
- After: `/publish` rendered all five cards (`publish-card-linkedin`, `publish-card-twitter`, `publish-card-medium`, `publish-card-newsletter`, `publish-card-blog`) for the test adaptation.
- Edit toggle on the Newsletter card swapped buttons to `Save Edit` / `Cancel` and re-armed the readonly textarea.
- Triggering the Newsletter Schedule handler (via the React `onClick` prop on the Schedule button, since plagiarism gating disables the button when no AI key is set) wrote a `users/{uid}/scheduledPosts/{auto}` document with `platforms: ['newsletter']` — confirmed by:
  - The success notice on `/publish`: "Scheduled Newsletter post '...' for 5/1/2026, 10:00:00 PM."
  - The "Upcoming Scheduled Posts" list on `/publish` showing the new entry with a `Newsletter` label.
  - `/notifications` listing it under "System Alerts" as "Upcoming: ... (in 53m) · newsletter".
- TypeScript strict mode (`cd frontend && npx tsc --noEmit`) passes with zero errors.
- Orphan filtering (UX Fix #10) preserved — `visibleAdaptations` still applies the `orphanAdaptationIds` filter unchanged.

### Notes
- Backend (port 8000) was down during verification (missing `httpx` dependency) — unrelated to this bug.
- The Notion MCP server was not connected in this session, so this entry is logged here for transfer to the Notion Marketing Dashboard > Bugs page on the next session that has Notion access.
