# Automation Specification

This document describes the scheduling, publishing handoff, and integration automation behavior of the Marketing Dashboard. There is currently NO server-side scheduler running automated publishes; "scheduling" is implemented as a reminder + handoff pattern, with OAuth groundwork in place for future direct posting.

## Purpose
- Document how scheduled posts move through the system today (data, UI, reminders).
- Describe the publishing handoff path used in lieu of automated direct posting.
- Capture the integration/OAuth scaffolding (LinkedIn) that will eventually back direct publishing.
- Define the gaps that need to be filled before "automation" becomes truly automated (background scheduler, retry, IndexNow, etc.).

---

## Overview

The current automation surface is split across three layers:

1. **Reminder scheduling (frontend + Firestore).** The Publish page (`/publish`) writes per-platform publish reminders to `users/{uid}/scheduledPosts` with a `scheduledForMs` timestamp. These are read by the Dashboard calendar, the Publish upcoming list, and the Notifications page (`/notifications`). No background process triggers a publish; instead, the Notifications page surfaces reminders that are due now / upcoming / missed based on the user's clock.

2. **Publishing handoff (frontend, no server posting).** The Publish page does not call provider APIs to post on the user's behalf. For each platform card it offers a one-click compose handoff:
   - **LinkedIn:** `navigator.clipboard.writeText(text)` then `window.open('https://www.linkedin.com/feed/?shareActive=true')`.
   - **X / Twitter:** `window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text))`.

3. **Integration / OAuth scaffolding (FastAPI backend).** The `backend/app/routers/linkedin.py` and `backend/app/routers/integrations.py` routes implement a per-user LinkedIn OAuth flow that persists encrypted tokens in `integrationSecrets/{uid__provider}` and a public summary in `users/{uid}/integrationConnections/{provider}`. The token material is stored but is NOT yet wired into a publish action — direct API publishing remains TODO.

---

## Automation Flows

### 1. Schedule a publish reminder
- **Trigger:** User on `/publish` selects an adaptation + platform card and submits the date/time picker.
- **Validation:** `scheduledForMs > Date.now()` (must be in the future).
- **Write path:** `setDoc(doc(collection(db, 'users', uid, 'scheduledPosts')), { ideaId, angleId, ideaTopic, angleTitle, articleTitle, platforms: [platform], scheduledForMs, scheduledForIso, status: 'scheduled', createdAt, updatedAt })`.
- **Outcome:** Firestore listeners on Dashboard, Publish upcoming list, and Notifications immediately surface the new reminder.

### 2. Publish via handoff (manual user step)
- **Trigger:** User clicks the LinkedIn or X/Twitter publish button on `/publish` (or follows a Notifications reminder).
- **Behavior:** Frontend copies the platform-adapted text and opens the platform's compose surface in a new tab. The user reviews and posts manually.
- **No server calls** are made. There is no record of whether the post was actually published.

### 3. Connect a LinkedIn account (preparatory; not yet used to publish)
- **Trigger:** User clicks "Connect LinkedIn" in `/settings`.
- **Frontend:** `POST {NEXT_PUBLIC_API_URL}/api/v1/auth/linkedin/start` with `{ userId, redirectAfter: '/settings' }`.
- **Backend:** Generates state, hashes it into `integrationAuthStates/{sha256(state)}`, and returns the LinkedIn authorize URL.
- **Browser:** Redirects to LinkedIn → user approves → LinkedIn redirects to `GET /api/v1/auth/linkedin/callback`.
- **Backend (callback):** Validates state, exchanges code for tokens, calls `https://api.linkedin.com/v2/userinfo`, persists the public summary under `users/{uid}/integrationConnections/linkedin`, persists encrypted tokens under `integrationSecrets/{uid__linkedin}`, then redirects back to `/settings?integration=linkedin&status=...`.
- **Status:** Tokens are stored encrypted but no consumer exists yet — `/publish` does not call LinkedIn's `ugcPosts` or `posts` API.

### 4. Notifications surface (reads scheduledPosts)
- **Frequency:** A `setInterval(60_000)` loop on `/notifications` re-derives the bucket lists from `scheduledPosts`.
- **Buckets:**
  - `dueNow`: `Math.abs(scheduledForMs - now) <= 15 * 60 * 1000`.
  - `upcomingSoon`: `scheduledForMs > now && scheduledForMs <= now + 24h`.
  - `missed`: `scheduledForMs < now - 15 * 60 * 1000`.
- **Outcome:** Reminders that pass `now` without action are flagged as missed. There is no automatic retry or notification push.

---

## Scheduling Logic

- **Source of truth:** `users/{uid}/scheduledPosts` ordered by `scheduledForMs` ascending.
- **Resolution:** Per-minute clock tick on the Notifications page; per-render on Publish/Dashboard.
- **Time zone handling:** All stored times are absolute (`scheduledForMs` is a UNIX millisecond timestamp). The UI renders via `toLocaleString()` and the date/time picker writes through `parseScheduledAtInputValue`.
- **Cancellation/edit:** Currently TODO — there is no UI to cancel or reschedule a `scheduledPost` once written. Users would have to delete the document directly.
- **Background firing:** TODO — no Cloud Function, cron, or queue worker triggers an automated publish when `scheduledForMs` passes.

---

## Integration Points

| Surface | Backend route | Client wrapper | Status |
|---|---|---|---|
| LinkedIn OAuth start | `POST /api/v1/auth/linkedin/start` | `startLinkedInConnection()` (`src/lib/integrations.ts`) | DONE |
| LinkedIn OAuth callback | `GET /api/v1/auth/linkedin/callback` | (browser redirect; no client wrapper) | DONE |
| Provider registry | `GET /api/v1/integrations/providers` | (read by Settings) | DONE |
| Per-user connection status | `GET /api/v1/integrations/status` | `listIntegrationConnections(userId)` | DONE |
| Manual token persistence (non-OAuth providers) | `POST /api/v1/integrations/{provider}/tokens` | TODO (no UI consumer yet) | BACKEND-ONLY |
| Disconnect provider | `POST /api/v1/integrations/{provider}/disconnect` | `disconnectIntegration(provider, userId)` | DONE |
| Direct LinkedIn publish | TODO | TODO | TODO |
| X / Twitter / Medium / WordPress / Ghost / Substack OAuth | TODO | TODO | TODO |
| Search engine submission (IndexNow) | TODO | TODO | TODO |

---

## Error Handling and Recovery

- **Schedule write failures:** Publish page surfaces a toast (`tone: 'error'`); the user retries manually. No queue retry.
- **OAuth state mismatch:** Backend returns an error redirect to `/settings?integration=linkedin&status=state_invalid`; the Settings page renders an inline error notice.
- **Token exchange / userinfo failures:** Backend redirects to `/settings?integration=linkedin&status=token_exchange_failed` (or similar). No automatic retry.
- **Missed reminders:** Notifications page lists them in the `System Alerts` bucket; the user must take action manually.
- **Publish handoff:** No error path on the server side because no server publish is performed. Clipboard failures fall back to a status message on the Publish card guiding the user to copy text manually.

---

## Anti-Bot and Rate Limiting

- **Browser-driven publish:** Because publishing is a manual handoff (the user is in their own browser tab on linkedin.com / twitter.com), there is no automated traffic that would trigger anti-bot measures. The Marketing Dashboard server never impersonates the user against a third-party UI.
- **Backend rate limiting:** Not yet implemented on `/api/v1/auth/*` or `/api/v1/integrations/*` routes. Future work: per-user rate limit and abuse detection on the OAuth start endpoint.
- **AI provider calls:** All AI provider traffic is keyed off the user's own provider credentials configured in Settings; see backend.md for retry/timeout behavior on each `/api/drafts/*` and `/api/angles` route.

---

## Testing Requirements

- Scheduling a future post writes a doc under `users/{uid}/scheduledPosts` with `scheduledForMs > now`, and immediately appears in the Dashboard calendar and Publish upcoming list.
- Scheduling a past time is blocked at the client with a validation error and no Firestore write.
- The Notifications `dueNow` bucket only includes reminders within ±15 minutes of the wall clock.
- The Notifications `upcomingSoon` bucket only includes reminders strictly in the future and within 24 hours.
- The Notifications `missed` bucket only includes reminders older than 15 minutes ago.
- LinkedIn `Connect LinkedIn` flow: clicking the button calls `POST /api/v1/auth/linkedin/start`, navigates to LinkedIn, and after approval the callback persists the connection summary at `users/{uid}/integrationConnections/linkedin` and an encrypted secret at `integrationSecrets/{uid__linkedin}`.
- LinkedIn `Disconnect` deletes the encrypted secret and updates the public summary to `status: 'disconnected'`.
- Publish handoff (LinkedIn): clicking the publish button copies text to clipboard and opens `https://www.linkedin.com/feed/?shareActive=true` in a new tab; no `fetch` is made to LinkedIn from the dashboard.
- Publish handoff (X / Twitter): clicking the publish button opens `https://twitter.com/intent/tweet?text=...` with URL-encoded text; no `fetch` is made to twitter.com from the dashboard.

---

## Known Gaps (TODO)

- No background scheduler/queue/cron picks up `scheduledForMs` and triggers a publish.
- No direct API publish for any platform (LinkedIn tokens are stored but unused).
- No retry policy for missed reminders.
- No multi-platform single schedule (current schedule writes one platform per record even though the field is an array).
- No reschedule/cancel UI for an existing `scheduledPost`.
- No IndexNow / search engine submission on publish.
- No audit log entry on publish or connection events (database.md does not yet define an audit collection).
