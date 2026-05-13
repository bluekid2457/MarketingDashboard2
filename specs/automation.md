# Automation Specification

This document describes the scheduling, publishing handoff, and integration automation behavior of the Marketing Dashboard. Scheduled LinkedIn posts fire via **AWS EventBridge Scheduler one-shot schedules** (Pattern B): when the user clicks Schedule on `/publish`, the FastAPI backend creates a per-post EventBridge entry that fires once at `scheduledForMs` and directly invokes a dedicated scheduler Lambda. A legacy `POST /api/v1/publish/scheduled/run` sweeper still exists as a safety net; other platforms still rely on the reminder + handoff pattern.

## Purpose
- Document how scheduled posts move through the system today (data, UI, reminders, scheduler tick).
- Describe the publishing handoff path used for platforms without a direct-publish integration.
- Capture the integration/OAuth scaffolding (LinkedIn) that backs the direct-publish + scheduler paths.
- Define the gaps that need to be filled to expand automation coverage (more platforms, retry, IndexNow, etc.).

---

## Overview

The current automation surface is split across three layers:

1. **Reminder scheduling (frontend + Firestore).** The Publish page (`/publish`) writes per-platform publish reminders to `users/{uid}/scheduledPosts` with a `scheduledForMs` timestamp. These are read by the Dashboard calendar, the Publish upcoming list, and the Notifications page (`/notifications`). No background process triggers a publish; instead, the Notifications page surfaces reminders that are due now / upcoming / missed based on the user's clock.

2. **Publishing path (frontend → backend → provider, plus handoff).** The Publish page has a connection-gated LinkedIn path and a Twitter handoff:
   - **LinkedIn (connected user):** When `users/{uid}/integrationConnections/linkedin.status === 'connected'`, the "Publish to LinkedIn" button calls `POST /api/v1/publish/linkedin/now` (FastAPI). The backend reads the encrypted access token from `integrationSecrets/{uid}__linkedin`, reads the publish author URN from the connection summary's `metadata.publishAuthorUrn`, and `POST`s a text-only UGC payload to `https://api.linkedin.com/v2/ugcPosts` via the shared `linkedin_publisher.publish_linkedin_text` helper. The frontend renders a clickable permalink on success and a tone-appropriate "Reconnect"/"Try again" toast on failure.
   - **LinkedIn (not connected):** The "Publish to LinkedIn" button is **disabled** with a `Connect LinkedIn in Settings to post directly.` tooltip and an inline `Connect LinkedIn →` CTA linking to `/settings#integrations`. The legacy clipboard-handoff fallback for LinkedIn has been removed; clicking the disabled button does nothing (no clipboard write, no compose tab). The `Copy LinkedIn Text` button still works in this state.
   - **X / Twitter:** Unchanged — `window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text))`.

3. **Integration / OAuth scaffolding (FastAPI backend).** The `backend/app/routers/linkedin.py` and `backend/app/routers/integrations.py` routes implement a per-user LinkedIn OAuth flow that persists encrypted tokens in `integrationSecrets/{uid__provider}` and a public summary in `users/{uid}/integrationConnections/{provider}`. The token material is now consumed by `backend/app/routers/publish.py` (LinkedIn) via `integration_connection_service.get_decrypted_access_token`. Other providers (X / Twitter / Medium / WordPress / Ghost / Substack) still have no direct-publish endpoint.

4. **Repository PR version automation (GitHub Actions).** A GitHub Actions workflow (`.github/workflows/pr-version-bump.yml`) runs on `pull_request` `opened` and `reopened` events. For PRs created from branches in this repository (non-fork), it bumps the frontend package patch version by running `npm --prefix frontend version patch --no-git-tag-version`, then commits and pushes `frontend/package.json` and `frontend/package-lock.json` back to the PR branch.

---

## Automation Flows

### 1. Schedule a publish reminder
- **Trigger:** User on `/publish` selects an adaptation + platform card and submits the date/time picker.
- **Client validation:** `scheduledForMs > Date.now()` (must be in the future). The backend additionally enforces a 60-second minimum lead time and rejects anything sooner with HTTP 422 `scheduled_too_soon`.
- **Write path (LinkedIn — server-side, Pattern B):** the client calls `POST /api/v1/publish/schedule` via `scheduleLinkedInPost()` in `frontend/src/lib/publish.ts` (Firebase ID token in `Authorization`). The FastAPI handler in `backend/app/routers/publish.py::schedule_publish` (a) generates a new `scheduledPosts` doc id, (b) provisions an AWS EventBridge Scheduler one-shot entry via `eventbridge_scheduler.create_one_shot_schedule`, and (c) writes the Firestore doc at `users/{uid}/scheduledPosts/{scheduledPostId}` with the full payload (incl. `contentSnapshot.linkedin`, `visibility`, `attemptCount: 0`, and `eventBridgeScheduleName` — the deterministic schedule name `publish-<id>`, or `null` in local-dev no-op mode). EventBridge is provisioned BEFORE the Firestore write so a boto3 failure surfaces as HTTP 502 `schedule_provisioning_failed` without leaving an orphan row.
- **Write path (other platforms — legacy direct-Firestore):** the Publish page still writes `users/{uid}/scheduledPosts/{auto}` directly via the Firebase Web SDK for X / Twitter / Medium / Newsletter / Blog. These rows have no `eventBridgeScheduleName` and rely on the safety-net sweeper (and the human reminder flow) for fulfillment.
- **Outcome:** Firestore listeners on Dashboard, Publish upcoming list, and Notifications immediately surface the new reminder. For LinkedIn rows the EventBridge entry fires exactly once at `scheduledForMs`, invokes the scheduler Lambda, and is auto-deleted via `ActionAfterCompletion="DELETE"`.

### 2. Publish (LinkedIn direct API; or X/Twitter handoff)
- **Trigger:** User clicks the LinkedIn or X/Twitter publish button on `/publish` (or follows a Notifications reminder).
- **LinkedIn (connected user) behavior:**
  - Frontend (`frontend/src/lib/publish.ts::publishLinkedInNow`) reads the Firebase ID token via `getFirebaseAuth().currentUser.getIdToken()`.
  - Calls `POST {NEXT_PUBLIC_API_URL}/api/v1/publish/linkedin/now` with `Authorization: Bearer <idToken>` and `{ userId, text, visibility: 'PUBLIC' }`.
  - Backend verifies the ID token, delegates to `linkedin_publisher.publish_linkedin_text` (which decrypts the access token, reads `publishAuthorUrn`, posts to LinkedIn's `v2/ugcPosts` API), and returns `{ success, postUrn, postUrl }` (or a `{ success: false, error, status, providerError }` envelope per the backend error matrix).
  - Publish notice renders an anchor to `postUrl` on success; on error it renders a remediation link to `/settings#integrations` and a tone-appropriate message ("Reconnect", "Try again", etc.).
- **LinkedIn (NOT connected) behavior:** The "Publish to LinkedIn" button is rendered **disabled** with `title="Connect LinkedIn in Settings to post directly."` and an inline `Connect LinkedIn →` link to `/settings#integrations`. Clicking the disabled button does nothing — no clipboard write, no compose tab. The separate `Copy LinkedIn Text` button continues to work for both states.
- **X / Twitter behavior:** Unchanged — `window.open('https://twitter.com/intent/tweet?text=...')`. No server call.
- **Recording:** No audit log is written when a direct LinkedIn publish succeeds via "Publish now" (TODO — see Known Gaps). The scheduler path DOES record outcome on the `scheduledPosts` row (see §5).

### 3. Connect a LinkedIn account (preparatory; not yet used to publish)
- **Trigger:** User clicks "Connect LinkedIn" in `/settings`.
- **Frontend:** `POST {NEXT_PUBLIC_API_URL}/api/v1/auth/linkedin/start` with `{ userId, redirectAfter: '/settings' }`.
- **Backend:** Generates state, hashes it into `integrationAuthStates/{sha256(state)}`, and returns the LinkedIn authorize URL.
- **Browser:** Redirects to LinkedIn → user approves → LinkedIn redirects to `GET /api/v1/auth/linkedin/callback`.
- **Backend (callback):** Validates state, exchanges code for tokens, calls `https://api.linkedin.com/v2/userinfo`, persists the public summary under `users/{uid}/integrationConnections/linkedin`, persists encrypted tokens under `integrationSecrets/{uid__linkedin}`, then redirects back to `/settings?integration=linkedin&status=...`.
- **Status:** Tokens are stored encrypted but no consumer exists yet — `/publish` does not call LinkedIn's `ugcPosts` or `posts` API.

### 4. Notifications surface (reads scheduledPosts)
- **Frequency:** A `setInterval(60_000)` loop on `/notifications` re-derives the bucket lists from `scheduledPosts`.
- **Buckets** (now derived only from `status` ∈ `{undefined, 'scheduled', 'publishing'}` rows — rows the scheduler has already finalized are excluded so they do not stay in the reminder lanes):
  - `dueNow`: `Math.abs(scheduledForMs - now) <= 15 * 60 * 1000`.
  - `upcomingSoon`: `scheduledForMs > now && scheduledForMs <= now + 24h`.
  - `missed`: `scheduledForMs < now - 15 * 60 * 1000`.
  - `failedScheduled`: `status === 'failed'`. Rows where `failureReason === 'token_expired'` render a `Reconnect LinkedIn →` CTA linking to `/settings#integrations`.
  - `recentlyPublished`: `status === 'published'`, ordered by `publishedAtMs` desc. Renders a `View on LinkedIn` anchor when `postUrl` is present.
- **Outcome:** Reminders that pass `now` without action stay in `missed` until the scheduler picks them up; the scheduler then moves them into `recentlyPublished` or `failedScheduled` depending on outcome. There is no automatic retry — a failed row remains failed until the user reschedules.

### 5. Background publish — AWS EventBridge Scheduler one-shot (Pattern B)

The primary fire path for scheduled LinkedIn posts is now a **one-shot AWS EventBridge schedule per row**, replacing the polling-sweeper-only design. The legacy `POST /api/v1/publish/scheduled/run` route still exists as a safety net and for local-dev manual ticks; the planned safety-net sweeper is described in the subsection below.

#### 5.1 Components

- **HTTP Lambda (`marketing-dashboard-http`).** The FastAPI app wrapped by `mangum.Mangum(app, lifespan="off")` and exported as `app.main.handler`. Fronted by a Lambda Function URL. Serves the same routes as local-dev uvicorn (LinkedIn OAuth, integrations, `/publish/linkedin/now`, `/publish/schedule`, `/publish/scheduled/run`).
- **Scheduler Lambda (`marketing-dashboard-scheduler`).** Entry point `app.lambda_scheduler.handler`. Triggered directly by EventBridge Scheduler with input `{"scheduledPostId": "...", "userId": "..."}`. Calls the pure `scheduler_worker.publish_one` worker and returns the outcome dict.
- **EventBridge Scheduler.** One schedule per scheduled LinkedIn post, named deterministically `publish-<scheduledPostId>`. `ScheduleExpression=at(<UTC>)`, `ScheduleExpressionTimezone="UTC"`, `FlexibleTimeWindow={"Mode": "OFF"}`, `ActionAfterCompletion="DELETE"`, `Target.RetryPolicy.MaximumRetryAttempts=0`. Schedule group defaults to `default` (override via `EVENTBRIDGE_SCHEDULE_GROUP_NAME`).
- **AWS Secrets Manager (optional).** Hydrates `FIREBASE_SERVICE_ACCOUNT_JSON`, `ENCRYPTION_KEY`, `LINKEDIN_CLIENT_SECRET`, `SCHEDULER_SECRET`, etc. into `os.environ` at Lambda cold start via `secrets_loader.load_secrets_into_env()`, called from `app.config` before `Settings()` is constructed. Existing env vars win — explicit env overrides Secrets Manager.

Two Lambdas share **one container image** built from `backend/Dockerfile.lambda` (`public.ecr.aws/lambda/python:3.11`, arm64). The `CMD` is set per-function in Lambda configuration, not inside the Dockerfile.

#### 5.2 Schedule provisioning flow (`POST /api/v1/publish/schedule`)

1. Verify Firebase ID token → `verified_uid` must equal `body.user_id` else HTTP 403 `uid_mismatch`.
2. Validate `body.scheduled_for_ms > now_ms + 60_000` else HTTP 422 `scheduled_too_soon`.
3. Validate `body.content_snapshot.linkedin` is non-empty when `linkedin` is in `body.platforms` else HTTP 422 `missing_linkedin_snapshot`. Non-LinkedIn platforms in `body.platforms` return HTTP 422 `unsupported_platform` (Pattern B only ships LinkedIn today).
4. Generate a Firestore doc reference at `users/{uid}/scheduledPosts/{auto}` → `scheduled_post_id = ref.id`.
5. Call `eventbridge_scheduler.create_one_shot_schedule(scheduled_post_id, uid, fire_at_ms)`.
   * **Local-dev no-op mode.** If `SCHEDULER_LAMBDA_ARN` or `EVENTBRIDGE_INVOKER_ROLE_ARN` is unset, the helper logs a warning and returns `None`. The route proceeds to step 6 and writes the Firestore row with `eventBridgeScheduleName: null`. The legacy sweeper / `npm run scheduler:tick` can still pick the row up.
   * **Prod mode.** If both env vars are set and the boto3 call raises, the route returns HTTP 502 `schedule_provisioning_failed` and DOES NOT write the Firestore row (atomic-ish guarantee).
6. Write the Firestore doc with the full payload (see database.md §`scheduledPosts` for the schema; key fields: `status: 'scheduled'`, `contentSnapshot.linkedin`, `visibility`, `attemptCount: 0`, `eventBridgeScheduleName`, `createdAt`, `updatedAt`).
7. Return `{"success": true, "scheduledPostId": ..., "eventBridgeScheduleName": ...}`. On a Firestore-write failure after EventBridge succeeded, the route best-effort calls `delete_schedule(scheduled_post_id)` before returning HTTP 500 `schedule_write_failed`, so a zombie schedule never fires against a non-existent row.

#### 5.3 Schedule fire flow

EventBridge fires the schedule once at `scheduledForMs` (UTC) and invokes the scheduler Lambda with the configured `Input` payload. The Lambda handler:

1. Normalizes the event into `{"scheduledPostId": str, "userId": str}` (handles a defensive `detail` envelope; rejects empty payloads as `skipped:invalid_input`).
2. Calls `await scheduler_worker.publish_one(user_id, scheduled_post_id)` and returns the outcome dict.
3. The dict shape mirrors the existing scheduler-route per-row result: one of `published`, `idempotent`, `failed`, or `skipped` (`missing_doc` / `lost_race` / `non_linkedin`).

`publish_one` is **framework-agnostic and never raises**. It performs the CAS to `publishing`, the `postUrn` idempotency short-circuit, the platform gate (`linkedin` only today), the call to `linkedin_publisher.publish_linkedin_text`, and the finalize update on the row (success or failure). The same function is invoked from the legacy `/publish/scheduled/run` route per-row loop so both paths share identical semantics.

After a successful invocation, EventBridge deletes the schedule via `ActionAfterCompletion="DELETE"`. The Lambda never retries on its own; recovery for missed fires belongs to the planned safety-net sweeper described below.

#### 5.4 Legacy sweeper — `POST /api/v1/publish/scheduled/run` (safety net)

- **Trigger:** Cloud Scheduler (or any cron) `POST {BACKEND_URL}/api/v1/publish/scheduled/run` with header `X-Scheduler-Secret: <SCHEDULER_SECRET>`.
- **Auth:** Shared-secret only — NOT a Firebase-authenticated route. `SCHEDULER_SECRET` unset → HTTP 503 `scheduler_disabled`. Header missing/mismatch → HTTP 401 `unauthorized_scheduler`.
- **Behavior** (single tick, idempotent):
  1. **Sweep zombies.** Any `status: 'publishing'` row with `lastAttemptAtMs < now - 10min` is rolled back to `'scheduled'` via a collection-group query.
  2. **Find due rows.** Collection-group query for `status == 'scheduled' AND scheduledForMs <= now` ordered by `scheduledForMs` ascending, limited to the request's `limit` (default 50, max 500).
  3. **Delegate per-row work to `scheduler_worker.publish_one`.** The route accumulates `published` / `failed` / skipped outcomes from the shared worker — identical CAS, idempotency, and finalize logic as the Lambda path.
  4. Returns the same `{processed, published, failed, results[]}` envelope contract historic callers depended on.
- **Idempotency:** CAS + the `postUrn` short-circuit in `publish_one` guarantee a single row is published at most once even if the EventBridge schedule and the sweeper both attempt the same row.
- **Logging:** Only `scheduledPostId + userId + outcome` is logged. Token material and post text are NEVER logged.
- **Local dev:** `npm run scheduler:tick` (root `package.json`) curls the local endpoint with the local secret.

#### 5.5 Planned: safety-net sweeper

Pattern B's `ActionAfterCompletion="DELETE"` removes the schedule entry after the Lambda fires, regardless of return value. If the scheduler Lambda fails to publish (e.g., transient LinkedIn 5xx, Firestore unavailable), the row stays in `status: 'publishing'` or flips to `status: 'failed'` and `attemptCount` is bumped — there is no automatic retry. The existing zombie-publishing sweeper in `/publish/scheduled/run` handles the first case (rolls stuck `publishing` rows back to `scheduled` after 10 minutes). A planned safety-net job will:

- Run on a low-frequency cadence (e.g., every 5–15 minutes via a separate EventBridge Schedule).
- Query `scheduledPosts` for rows where `status == 'scheduled' AND scheduledForMs <= now - 60s AND attemptCount < retryCap`.
- For each candidate, call `eventbridge_scheduler.create_one_shot_schedule` (or trigger the scheduler Lambda directly) to retry publication, with backoff.

This sweeper is **not implemented in this slice**. It is documented here so downstream agents (and the user) know where the resilience layer will go.

---

## Scheduling Logic

- **Source of truth:** `users/{uid}/scheduledPosts` ordered by `scheduledForMs` ascending.
- **Resolution:** Per-minute clock tick on the Notifications page; per-render on Publish/Dashboard.
- **Time zone handling:** All stored times are absolute (`scheduledForMs` is a UNIX millisecond timestamp). The UI renders via `toLocaleString()` and the date/time picker writes through `parseScheduledAtInputValue`.
- **Cancellation:** DONE for `scheduled` and `failed` rows. The Publish page surfaces a per-row `Cancel` (upcoming) / `Remove` (failed) button with an inline two-step confirm. Confirming fires `DELETE /api/v1/publish/schedule/{id}` which (a) best-effort deletes the EventBridge schedule and (b) deletes the Firestore document. Rows in `publishing` or `published` state return HTTP 409 `status_not_cancellable`. `eventbridge_scheduler.delete_schedule` swallows `ResourceNotFoundException`, so cancelling a row whose schedule has already auto-deleted (after firing, or because `ActionAfterCompletion=DELETE` already ran) still cleanly removes the Firestore row.
- **Edit/reschedule:** Currently TODO — `eventbridge_scheduler.update_schedule` exists (delete-then-create) but has no UI caller yet. Users today cancel + re-create.
- **Background firing:** DONE for LinkedIn. `POST /api/v1/publish/scheduled/run` (server-to-server, shared-secret authed) drains due LinkedIn rows on every Cloud Scheduler tick (see §5). Other platforms still rely on the reminder + handoff path.

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
| Self-service account deletion | (client-side only — Firebase Web SDK) | `deleteAccount()` (`src/lib/account.ts`) | DONE |
| Direct LinkedIn publish | `POST /api/v1/publish/linkedin/now` | `publishLinkedInNow()` (`src/lib/publish.ts`) | DONE |
| Scheduled LinkedIn publish (Pattern B — primary) | `POST /api/v1/publish/schedule` | `scheduleLinkedInPost()` (`src/lib/publish.ts`) | DONE |
| Scheduled LinkedIn publish (safety net / local dev) | `POST /api/v1/publish/scheduled/run` | (server-to-server; no client wrapper) | DONE |
| Cancel scheduled post | `DELETE /api/v1/publish/schedule/{id}` | `cancelScheduledPost(id)` (`src/lib/publish.ts`) | DONE |
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
- **Account deletion:** Settings contains a "Danger zone" group below Session with a Delete account button that opens a type-to-confirm modal. Confirming runs `deleteAccount()` in `frontend/src/lib/account.ts` entirely client-side via the Firebase Web SDK: it purges every `users/{uid}/**` subcollection, deletes the matching `integrationSecrets/{uid}__*` rows (rules grant the user delete access to docs whose ID is prefixed by their `uid`), best-effort deletes `integrationAuthStates` rows whose `userId` matches, deletes the `users/{uid}` root doc, then calls `auth.currentUser.delete()`. If Firebase requires recent re-authentication, the modal pivots to a re-auth step (password input for email/password, popup for Google) and resumes from `auth.currentUser.delete()`.

---

## Testing Requirements

- Scheduling a future post writes a doc under `users/{uid}/scheduledPosts` with `scheduledForMs > now`, and immediately appears in the Dashboard calendar and Publish upcoming list.
- Scheduling a past time is blocked at the client with a validation error and no Firestore write.
- The Notifications `dueNow` bucket only includes reminders within ±15 minutes of the wall clock.
- The Notifications `upcomingSoon` bucket only includes reminders strictly in the future and within 24 hours.
- The Notifications `missed` bucket only includes reminders older than 15 minutes ago.
- LinkedIn `Connect LinkedIn` flow: clicking the button calls `POST /api/v1/auth/linkedin/start`, navigates to LinkedIn, and after approval the callback persists the connection summary at `users/{uid}/integrationConnections/linkedin` and an encrypted secret at `integrationSecrets/{uid__linkedin}`.
- LinkedIn `Disconnect` deletes the encrypted secret and updates the public summary to `status: 'disconnected'`.
- Publish disabled state (LinkedIn, NOT connected): when `integrationConnections/linkedin.status !== 'connected'` the "Publish to LinkedIn" button is rendered disabled with `title="Connect LinkedIn in Settings to post directly."`. An inline `Connect LinkedIn →` CTA links to `/settings#integrations`. Clicking the disabled button does NOT write to the clipboard or open a compose tab.
- Publish direct API (LinkedIn, connected): clicking the publish button when `integrationConnections/linkedin.status === 'connected'` calls `POST /api/v1/publish/linkedin/now` with the user's Firebase ID token in `Authorization`. On success the publish notice shows "Published to LinkedIn." with a `View on LinkedIn` anchor pointing to `https://www.linkedin.com/feed/update/<urn>`. On a 401 from LinkedIn the notice instead says "LinkedIn connection expired. Reconnect in Settings." with a link to `/settings#integrations`.
- Backend `/api/v1/publish/linkedin/now` returns HTTP 401 when the `Authorization` header is missing/malformed or the token fails Firebase verification, and HTTP 403 when the decoded `uid` does not match `body.userId`.
- Backend `/api/v1/integrations/status` and `/api/v1/integrations/{provider}/disconnect` return HTTP 401 without a valid `Authorization` bearer, and HTTP 403 when the verified `uid` does not match `userId`.
- Scheduling a LinkedIn post writes a `scheduledPosts` row with `status: 'scheduled'`, `platforms: ['linkedin']`, `visibility: 'PUBLIC'`, `attemptCount: 0`, `eventBridgeScheduleName: 'publish-<scheduledPostId>'` (or `null` in local-dev no-op mode), and `contentSnapshot.linkedin` set to the textarea content at schedule time.
- Backend `POST /api/v1/publish/schedule`:
  - With a valid Firebase ID token and `scheduledForMs > now + 60s`, returns HTTP 200 `{ success: true, scheduledPostId, eventBridgeScheduleName }` and writes the `scheduledPosts` row with the field shape above.
  - With `scheduledForMs <= now + 60s`, returns HTTP 422 `scheduled_too_soon` and does NOT write to Firestore.
  - With an empty `contentSnapshot.linkedin` for a LinkedIn schedule, returns HTTP 422 `missing_linkedin_snapshot` and does NOT write to Firestore.
  - With a non-LinkedIn platform in the request, returns HTTP 422 `unsupported_platform`.
  - With no `Authorization` header, returns HTTP 401 from the Firebase ID-token dependency.
  - With `body.userId` not matching the decoded `uid`, returns HTTP 403 `uid_mismatch`.
  - With both AWS env vars set AND boto3's `create_schedule` raising, returns HTTP 502 `schedule_provisioning_failed` and does NOT write to Firestore.
- Scheduler Lambda (`backend/app/lambda_scheduler.py`):
  - `handler({"scheduledPostId": "x", "userId": "y"}, None)` returns the outcome dict from `publish_one(...)` (smoke-test with a mocked `publish_linkedin_text`).
  - `handler({}, None)` returns `{"status": "skipped", "reason": "invalid_input"}` without raising.
- `eventbridge_scheduler.create_one_shot_schedule(...)` with no AWS env returns `None` and logs the no-op line; `delete_schedule(...)` against a non-existent schedule swallows `ResourceNotFoundException` (verifiable via a mocked boto3 `scheduler` client).
- `secrets_loader.load_secrets_into_env()` with `SECRETS_MANAGER_SECRET_ID` unset returns immediately without touching boto3. When set, it never overwrites an env var that is already present (explicit-env-wins).
- `backend/app/main.py` exports `handler = Mangum(app, lifespan="off")` so the HTTP Lambda can use `app.main.handler` as its entry point.
- Backend `/api/v1/publish/scheduled/run`:
  - Returns 503 `scheduler_disabled` when `SCHEDULER_SECRET` is unset.
  - Returns 401 `unauthorized_scheduler` when the `X-Scheduler-Secret` header is missing or mismatched.
  - Picks up only `status: 'scheduled'` rows with `scheduledForMs <= now` ordered ascending.
  - On LinkedIn 2xx, updates the row to `status: 'published'`, `postUrn`, `postUrl`, `publishedAtMs` and increments `attemptCount`.
  - On LinkedIn 401, updates the row to `status: 'failed'`, `failureReason: 'token_expired'` (no automatic retry).
  - Two ticks against the same row never produce two LinkedIn posts (CAS + `postUrn` short-circuit).
- Publish handoff (X / Twitter): clicking the publish button opens `https://twitter.com/intent/tweet?text=...` with URL-encoded text; no `fetch` is made to twitter.com from the dashboard.

---

## Known Gaps (TODO)

- Background scheduler for non-LinkedIn platforms — X / Twitter / Medium / WordPress / Ghost / Substack. LinkedIn is DONE via Pattern B (EventBridge one-shot) and the safety-net sweeper; non-LinkedIn rows are still written directly to Firestore by the Publish page and rely on the reminder + handoff path.
- **Safety-net sweeper for Pattern B** — planned but not yet implemented (see §5.5). Today, an EventBridge fire that fails or never delivers leaves the row in `status: 'scheduled'` or `'publishing'` with `attemptCount` bumped, and the user must manually reschedule. The planned sweeper will requeue stuck rows after a backoff.
- No retry policy for failed scheduled rows — a `status: 'failed'` row stays failed until the user reschedules. `attemptCount` is recorded for future use.
- No multi-platform single schedule (current schedule writes one platform per record even though the field is an array).
- Cancel UI is DONE (see Scheduling Logic). Reschedule UI is still TODO — `eventbridge_scheduler.update_schedule` (delete + recreate) is exported but unused by the frontend.
- No IndexNow / search engine submission on publish.
- No audit log entry on the synchronous "Publish now" success path (database.md does not yet define an audit collection). The scheduler path DOES persist `postUrn`, `postUrl`, and `publishedAtMs` on the originating `scheduledPosts` row.
- No automatic refresh of expired LinkedIn access tokens; on a 401 from LinkedIn the user is prompted to reconnect via `/settings#integrations` (and any scheduled row that hit 401 is flagged with `failureReason: 'token_expired'`).
- No automatic cleanup of EventBridge schedules at account-deletion time. The user's `users/{uid}/scheduledPosts/{*}` rows are deleted by `frontend/src/lib/account.ts`, but corresponding EventBridge entries are left to fire and `publish_one` returns `skipped: missing_doc` (the schedule then auto-deletes). Acceptable for v1; a follow-up could enumerate the user's `eventBridgeScheduleName` values and call `delete_schedule` during account deletion.
- **Race between "Post now" and a scheduled fire of the same draft** — known v1 limitation. The synchronous path does not touch the `scheduledPosts` row, so a future scheduler tick / EventBridge fire could publish the same content again. Users should manually delete the scheduled row after using "Post now".
- No IaC (Terraform / CDK / SAM) for the AWS resources (HTTP Lambda, scheduler Lambda, EventBridge invoker IAM role, Secrets Manager secret). Manual AWS console + CLI setup is required at deploy time. See `backend/Dockerfile.lambda` for the image build command.
