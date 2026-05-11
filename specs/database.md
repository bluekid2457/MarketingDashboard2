# Database Specification

This document defines the schema, relationships, and data requirements for the Marketing Dashboard database (Firebase NoSQL DB).

## Purpose
- Specify collections, fields, constraints, and relationships.
- Document migration strategy and data integrity requirements (Firestore rules, application-level constraints).

## Overview
- The frontend stores ideas directly in Cloud Firestore using the Firebase Web SDK.
- Ideas are user-linked and isolated by path under `users/{uid}/ideas/{ideaId}`.
- Drafts (storyboards) are user-linked and isolated by path under `users/{uid}/drafts/{draftId}`.
- Adaptations are user-linked and isolated by path under `users/{uid}/adaptations/{adaptationId}`.
- Scheduled publish reminders are user-linked under `users/{uid}/scheduledPosts/{scheduledPostId}`.
- The signed-in user's company profile is stored on the user document (`users/{uid}`) under the `companyContext` field, mirrored to `localStorage['company_profile_cache']` for offline/cache reads.
- Backend-only OAuth/integration storage lives under `integrationAuthStates/`, `linkedinLoginStates/`, `users/{uid}/integrationConnections/{provider}`, and `integrationSecrets/{uid__provider}` (see backend.md for write semantics).
- The current ideas page only reads and writes the authenticated user's idea documents. It does not read global shared idea documents.

## Entity Relationship Summary
- `users/{uid}` is the logical user root keyed by Firebase Auth UID. The user doc itself can carry a `companyContext` map representing the saved Company Profile.
- `users/{uid}/ideas/{ideaId}` stores one persisted idea record for that authenticated user.
- `users/{uid}/ideas/{ideaId}/workflow/angles` stores the persisted angle-generation workflow state for that idea.
- `users/{uid}/drafts/{draftId}` stores one persisted draft (storyboard) record for that authenticated user.
- `users/{uid}/adaptations/{adaptationId}` stores one persisted multi-platform adaptation record for a draft/angle pair for that authenticated user.
- `users/{uid}/scheduledPosts/{scheduledPostId}` stores per-platform publish reminders surfaced on the dashboard calendar, publish queue, and notifications page.
- `users/{uid}/integrationConnections/{provider}` stores per-provider browser-safe OAuth/integration connection summaries (written by the FastAPI backend).
- `integrationSecrets/{uid__provider}` (top-level, backend-only) stores the encrypted token blob for that connection. Not readable by `users/{uid}/**` rules.
- `integrationAuthStates/{sha256(state)}` (top-level, backend-only) stores short-lived OAuth state metadata for CSRF-safe LinkedIn *connect-for-publishing* callbacks (already-signed-in user adding LinkedIn to Settings).
- `linkedinLoginStates/{sha256(state)}` (top-level, backend-only) stores short-lived OAuth state metadata for CSRF-safe LinkedIn *sign-in* callbacks (anonymous visitor using "Sign in with LinkedIn"). Kept separate from `integrationAuthStates/` so a sign-in state cannot be replayed against the connect-for-publishing exchange and vice versa.
- The idea document also stores `userId` so the document contents mirror the parent path and can be validated in security rules.

## Collection Definitions

### `users/{uid}/ideas/{ideaId}`
**Purpose:** Persist a single content idea created by the signed-in user.

**Required fields:**
- `topic: string`
  The idea text entered in the ideas form.
- `tone: string`
  Selected tone from the frontend ideas form.
- `audience: string`
  Selected audience from the frontend ideas form.
- `format: string`
  Selected output format from the frontend ideas form.
- `userId: string`
  Must equal the authenticated Firebase UID and the `{uid}` path segment.
- `createdAt: timestamp`
  Server timestamp written at creation time.
- `updatedAt: timestamp`
  Server timestamp updated on mutation. The current implementation writes it on create.
- `createdAtMs: number`
  Client timestamp in milliseconds used for deterministic ordering in the UI query.

**Current query pattern:**
- Read with `orderBy('createdAtMs', 'desc')` inside the authenticated user's ideas subcollection.
- Listen in real time via Firestore snapshots for immediate UI updates after writes.

### `users/{uid}/drafts/{draftId}`
**Purpose:** Persist draft/storyboard content and metadata for the signed-in user. This is the underlying collection for both the legacy `/drafts/[id]` editor and the renamed Storyboard editor (`/storyboard/[id]`); they share the same document shape and document ID convention.

**Document ID:**
- `draftId = ${ideaId}_${angleId}` (deterministic) so the same idea/angle pair always maps to the same document.

**Required fields:**
- `content: string`
  Draft body text from the editor.
- `ideaId: string`
  Parent idea identifier used for route and context binding.
- `angleId: string`
  Selected angle identifier used to generate the draft.
- `ideaTopic: string`
  Display/context snapshot for quick rendering.
- `angleTitle: string`
  Display/context snapshot for quick rendering.
- `status: string`
  Current storyboard status (currently `'storyboard'`, with downstream review/publish statuses still allowed).
- `createdAt: timestamp`
  Server timestamp on first save.
- `updatedAt: timestamp`
  Server timestamp on each save.

### `users/{uid}` (root user document fields)
**Purpose:** Persist signed-in user profile data that is not naturally a subcollection.

**Optional fields:**
- `companyContext: map`
  Company Profile object written by `saveCompanyProfile()` in `frontend/src/lib/companyProfile.ts`. Object shape (all fields are strings, all may be empty):
  - `companyName: string`
  - `companyDescription: string`
  - `industry: string`
  - `products: string`
  - `services: string`
  - `valueProposition: string`
  - `targetMarket: string`
  - `keyDifferentiators: string`
  - `brandVoice: string`
  Read by the Settings page and by every AI feature that accepts a `companyContext: string[]` payload (see backend.md). Mirrored to `localStorage['company_profile_cache']`.
- `authProvider: string` — `"linkedin"` when the user was provisioned via the LinkedIn sign-in flow. Written by the FastAPI backend (`linkedin_oauth_service._ensure_firebase_user`). Absent for users who signed up via other Firebase Auth providers.
- `linkedinMemberSub: string` — LinkedIn-provided `sub` (member identifier) for LinkedIn-signed-up users. The Firebase uid for these users is deterministically `linkedin_<linkedinMemberSub>`. Backend-written.
- `email: string` — real email returned by LinkedIn at sign-in time. The Firebase Auth user intentionally has NO email set (to keep LinkedIn accounts isolated from other providers that share the same address), so this field is the canonical place to read the user's email for LinkedIn-signed-up accounts. Backend-written.
- `displayName: string`, `pictureUrl: string` — also mirrored here for parity with the Firebase Auth user's `display_name` / `photo_url`. Backend-written.
- `updatedAtMs: number` — server timestamp (ms) of the last backend write to this doc.

**Notes:**
- The user document is created lazily on first `setDoc(..., { merge: true })` from the Settings, `/api/company/autofill`, or LinkedIn sign-in flows; there is no required-field guarantee.

### `users/{uid}/ideas/{ideaId}/workflow/angles`
**Purpose:** Persist generated/refined angles for a single idea so `/angles?ideaId=...` can restore state on revisit.

**Document ID:**
- `angles` (fixed deterministic ID under the `workflow` subcollection)

**Required fields:**
- `ideaId: string`
  Parent idea identifier; must match `{ideaId}` path segment.
- `angles: array<object>`
  Sanitized angle candidates where each item includes:
  - `id: string`
  - `title: string`
  - `summary: string`
  - `sections: string[]` (non-empty)
  - `status: 'active' | 'selected' | 'archived'`
  - `createdAt: number` (client timestamp ms)
  - `selectedAt?: number` (client timestamp ms when the candidate is finalized)
- `selectedAngleId: string | null`
  Current selected angle ID; when non-null it must reference an entry in `angles`.
- `updatedAt: timestamp`
  Server timestamp on each workflow persistence update.
- `updatedAtMs: number`
  Client milliseconds timestamp used for deterministic last-write ordering/debug visibility and optimistic concurrency checks during persistence.
- `cleanup: map`
  Cleanup metadata for selection finalization reliability:
  - `pending: boolean` (true when hard cleanup failed and retry is required)
  - `failedIds: string[]` (candidate IDs that were not hard-deleted)
  - `lastAttemptedAtMs: number`
  - `reason?: string`

### `users/{uid}/scheduledPosts/{scheduledPostId}`
**Purpose:** Persist per-platform publish reminders for adapted content. Written by the Publish page's per-platform schedule pickers and consumed by the Dashboard calendar, Publish upcoming list, and Notifications page (`/notifications`).

**Document ID:**
- Auto-generated Firestore ID (`doc(collection(db, 'users', uid, 'scheduledPosts'))`).

**Required fields:**
- `ideaId: string`
  Parent idea identifier.
- `angleId: string`
  Selected angle identifier paired with the adaptation.
- `ideaTopic: string`
  Snapshot of the idea topic for quick rendering.
- `angleTitle: string`
  Snapshot of the selected angle title for quick rendering.
- `articleTitle: string`
  Display title used by Publish/Notifications panels (defaults to `ideaTopic` when missing).
- `platforms: string[]`
  One-or-more platform keys. Valid keys are `linkedin`, `twitter`, `medium`, `newsletter`, and `blog` (matching the Adapt platform schema in `frontend/src/lib/prompts/platforms/index.ts`). Current Publish UI schedules one platform per record (e.g. `['linkedin']`, `['newsletter']`); the field is an array for future multi-platform expansion.
- `scheduledForMs: number`
  Client timestamp (ms) of the scheduled publish moment. Used for ordering and "due now / upcoming / missed" classification.
- `scheduledForIso: string`
  ISO-8601 mirror of `scheduledForMs` for human-readable rendering.
- `status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'`
  Lifecycle state of the scheduled post. Created with `'scheduled'`. The background scheduler (`POST /api/v1/publish/scheduled/run`) CAS-flips it to `'publishing'` while a tick is running, then to `'published'` (on LinkedIn 2xx) or `'failed'` (on any other outcome). A zombie sweeper rolls `'publishing'` rows older than 10 minutes back to `'scheduled'` so a single zombie write never permanently blocks re-attempts.
- `createdAt: timestamp`
  Server timestamp on first save.
- `updatedAt: timestamp`
  Server timestamp on each save.

**Optional fields (additive; written by the background scheduler):**
- `contentSnapshot: map<string, string>`
  Per-platform copy captured at schedule time so a later edit to the parent adaptation doc cannot change what the background scheduler actually posts. Keys match the platform slugs used in `platforms` (currently only `linkedin` is read by the scheduler). The Publish UI writes this map at schedule time.
- `visibility: 'PUBLIC' | 'CONNECTIONS'`
  LinkedIn UGC visibility; passed through to LinkedIn when the scheduler publishes the row. Defaults to `'PUBLIC'` when absent.
- `attemptCount: number`
  Increments on every publish attempt (success or failure). Initialized to `0` at schedule time.
- `lastAttemptAtMs: number`
  Set when a row is CAS-flipped to `'publishing'`. The zombie sweeper uses this to detect stuck rows (`status == 'publishing' AND lastAttemptAtMs < now - 10min`).
- `postUrn: string`
  LinkedIn ugcPosts URN returned on success.
- `postUrl: string`
  Human-clickable `https://www.linkedin.com/feed/update/<url-encoded-urn>` built from `postUrn`.
- `failureReason: 'token_expired' | 'rate_limited' | 'invalid_payload' | 'provider_unavailable' | 'missing_author_urn' | 'unknown'`
  Canonical slug describing why a scheduled publish failed. Mirrors the error slugs returned by `linkedin_publisher.publish_linkedin_text`.
- `providerError: any`
  Sanitized LinkedIn error payload (dict keys matching `/token|secret|authorization/i` stripped; string bodies capped at 500 chars). Set alongside `failureReason` when LinkedIn returned a non-2xx.
- `publishedAtMs: number`
  Server time (ms) at which the scheduler finalized this row as `'published'`.
- `eventBridgeScheduleName: string | null`
  Deterministic AWS EventBridge schedule name (`publish-<scheduledPostId>`) when the row was written by `POST /api/v1/publish/schedule` in Pattern B (one-shot EventBridge) and the backend AWS env was configured. `null` when the backend ran in local-dev no-op mode (AWS env vars unset) — the row still exists and the legacy sweeper / Pattern B fallback can still publish it. Absent on rows written by the legacy direct-Firestore path (X / Twitter / Medium / Newsletter / Blog) since those platforms do not provision EventBridge schedules. Read-tolerant; consumers must treat both `null` and `undefined` as "no EventBridge schedule attached". Used by the future `delete_schedule` / `update_schedule` helpers and for diagnostic surfacing.

**Current query patterns:**
- `query(collection(db, 'users', uid, 'scheduledPosts'), orderBy('scheduledForMs', 'asc'))` (Dashboard, Publish, Notifications).
- Notifications classifies records as `dueNow` (within ±15 min of now), `upcomingSoon` (next 24 h), and `missed` (older than now − 15 min). Rows with `status` set to `'published'`, `'failed'`, or `'cancelled'` are excluded from those buckets and surfaced in dedicated `failedScheduled` / `recentlyPublished` cards instead.
- Backend scheduler: collection-group query `status == 'scheduled' AND scheduledForMs <= now`, ordered by `scheduledForMs` ascending, limited.

### `users/{uid}/adaptations/{adaptationId}`
**Purpose:** Persist per-platform adaptation content and active-tab state for the signed-in user.

**Document ID:**
- `adaptationId = ${ideaId}_${angleId}`

**Required fields:**
- `ideaId: string`
  Parent idea identifier used for route and context binding.
- `angleId: string`
  Selected angle identifier paired to the draft/adaptation flow.
- `ideaTopic: string`
  Snapshot of the idea topic for quick rendering without fetching the idea document again.
- `angleTitle: string`
  Snapshot of the selected angle title for quick rendering.
- `platforms: map<string, string>`
  Platform-to-copy map. Current keys are `linkedin`, `twitter`, `medium`, `newsletter`, and `blog`.
- `activePlatform: string`
  The platform tab last active in the adaptation editor.
- `selectedPlatforms: string[]`
  Ordered list of platforms selected at Adapt entry gate. Used to restore sequential-generation scope on revisit.
- `createdAt: timestamp`
  Server timestamp on first save.
- `updatedAt: timestamp`
  Server timestamp on each save/autosave.

### `users/{uid}/integrationConnections/{provider}` (backend-written)
**Purpose:** Browser-safe summary of a user's OAuth/manual integration connection. Written by the FastAPI backend (`backend/app/services/integration_connection_service.py`) and read by the frontend Settings page via `GET /api/v1/integrations/status`.

**Document ID:** provider key (e.g. `linkedin`).

**Typical fields (provider-dependent):**
- `provider: string`
- `status: 'connected' | 'disconnected' | 'not_connected'`
- `authType: string` (e.g. `'oauth2'`)
- `displayName?: string`
- `email?: string`
- `pictureUrl?: string`
- `accountId?: string`
- `accountUrn?: string`
- `scopes?: string[]`
- `connectedAtMs?: number`
- `expiresAtMs?: number`
- `metadata?: object`

**Notes:**
- Token material itself is NOT stored here. Encrypted tokens live in the backend-only `integrationSecrets/` collection.

### `integrationSecrets/{uid__provider}` (backend-only, top-level)
**Purpose:** Backend-only encrypted token storage for a user/provider pair. Document ID is `${uid}__${provider}` to keep the secret outside the `users/{uid}/**` Firestore rule path.

**Required fields:**
- `provider: string`
- `userId: string`
- Encrypted token blob fields (Fernet-encrypted access/refresh/id tokens; see `backend/app/services/encryption.py` and `integration_connection_service.py`).
- `updatedAt: timestamp`

**Security:**
- Not readable from the client. Written/read by the FastAPI backend service-account credentials only.

### `integrationAuthStates/{sha256(state)}` (backend-only, top-level)
**Purpose:** Short-lived OAuth state metadata for CSRF-safe LinkedIn *connect-for-publishing* callbacks. Document ID is the SHA-256 of the opaque state token returned by `POST /api/v1/auth/linkedin/start`.

**Typical fields:**
- `userId: string`
- `provider: string`
- `redirectAfter?: string`
- `createdAtMs: number`
- `consumedAtMs?: number`

**Security:**
- Not readable from the client. Single-use; consumed during the OAuth callback exchange.

### `linkedinLoginStates/{sha256(state)}` (backend-only, top-level)
**Purpose:** Short-lived OAuth state metadata for CSRF-safe LinkedIn *sign-in* callbacks. Document ID is the SHA-256 of the opaque state token returned by `POST /api/v1/auth/linkedin/login/start`. Kept separate from `integrationAuthStates/` so a sign-in state cannot be replayed against the connect-for-publishing exchange and vice versa.

**Typical fields:**
- `purpose: 'login'`
- `createdAtMs: number`
- `expiresAtMs: number` (creation time + 15 minutes)

**Security:**
- Not readable from the client. Single-use; consumed during the sign-in callback exchange. No `userId` is stored — the document exists only to prove that a specific LinkedIn `state` parameter was issued by this backend within the last 15 minutes.

## Constraints and Indexes
- `topic` must be non-empty and is validated in the client before create.
- `userId` must match the parent UID path and authenticated user UID.
- `createdAtMs` should always be present so ordering is stable even before server timestamps resolve.
- The current implementation only needs Firestore's default single-field indexes for `createdAtMs`, `updatedAt`, and `scheduledForMs`.
- **Composite index (required by the background scheduler):** a `COLLECTION_GROUP` index on `scheduledPosts` with `(status ASC, scheduledForMs ASC)`. Required by `POST /api/v1/publish/scheduled/run` so it can run a collection-group query for `status == 'scheduled' AND scheduledForMs <= now`. Declared in `firestore.indexes.json`.
- The drafts and adaptations flows use deterministic document IDs (`${ideaId}_${angleId}`) so revisiting the same draft/angle pair reopens the same persisted state.
- `scheduledPosts` document IDs are auto-generated; uniqueness comes from Firestore.

## Defensive orphan filtering
- A storyboard doc at `users/{uid}/drafts/{draftId}` whose `ideaId` no longer points to an existing `users/{uid}/ideas/{ideaId}` document is treated as an "orphan storyboard" and is hidden from list views (`/storyboard`, `/dashboard` Storyboards/Review queue, `/dashboard` Oldest open draft, `/adapt/new`). The same rule applies to "orphan adaptations" under `users/{uid}/adaptations/{adaptationId}`, which are hidden from `/dashboard` All Adaptations, `/publish`, and `/adapt/new`.
- Detection is read-time only and best-effort (no Firestore triggers, no backend job): each list page debounces an existence check via `getDoc(users/{uid}/ideas/{ideaId})` after the realtime snapshot resolves and caches the result per `ideaId` so N storyboards from the same parent only incur one Firestore lookup. Read errors are treated as "exists" so transient failures never hide or delete data.
- Cleanup is user-controlled: when at least one orphan storyboard or adaptation is detected, the dashboard renders an admin card under the Get-started checklist titled "Clean up orphans" with a primary "Delete N orphans" button. Clicking the button calls `deleteOrphans(...)` from `frontend/src/lib/orphans.ts`, which is idempotent (parallel writes that recreate the parent idea simply cause the orphan to reappear on next render) and which deletes only the listed `users/{uid}/drafts/{id}` and `users/{uid}/adaptations/{id}` docs. After deletion, the detector re-runs so the card auto-hides when zero orphans remain.
- A missing angle (no entry in `users/{uid}/ideas/{ideaId}/workflow/angles`) does NOT mark a storyboard or adaptation as an orphan since angle workflow state can be regenerated.

## Account deletion contract

Account deletion is fully client-side. When the user confirms the modal in Settings, `deleteAccount()` in `frontend/src/lib/account.ts` runs in the browser using the Firebase Web SDK and permanently deletes the following, in this order:

1. For each doc under `users/{uid}/ideas/{*}`, delete the per-idea `workflow/angles` doc (idempotent — `deleteDoc` on a missing doc is a no-op).
2. Every doc under `users/{uid}/ideas/{*}`.
3. Every doc under `users/{uid}/drafts/{*}`.
4. Every doc under `users/{uid}/adaptations/{*}`.
5. Every doc under `users/{uid}/scheduledPosts/{*}`.
6. Every doc under `users/{uid}/integrationConnections/{*}`.
7. `integrationSecrets/{uid}__{provider}` for each provider listed in step 6 (the connection summaries are the source of truth for which secrets exist; rules limit delete access to docs whose ID begins with `${uid}__`).
8. Every `integrationAuthStates/*` doc whose `userId == uid` (best-effort; if the rules query fails the call swallows the error since these docs contain only a SHA-256 of the OAuth state plus timestamps and no PII).
9. `users/{uid}` root doc (including the `companyContext` field).
10. The Firebase Auth user itself, via `auth.currentUser.delete()`. If Firebase returns `auth/requires-recent-login`, the modal switches to a re-auth step (password input for email/password accounts, popup for Google) and resumes from this step on retry.

Steps 1–9 are issued in `writeBatch` chunks of up to 400 ops to stay under the Firestore 500-op batch limit. Every step is idempotent so a partial failure is safe to retry.

`linkedinLoginStates/*` docs are intentionally NOT cleaned up by this flow: they are CSRF state created BEFORE any user is authenticated (during a "Sign in with LinkedIn" attempt), carry no `userId` field, and contain only a state hash plus `createdAtMs`/`expiresAtMs`. They contain no PII and expire naturally — out-of-band cleanup (e.g., a future scheduled job) is responsible for them.

## Migration Strategy
- Enable Cloud Firestore in the Firebase project before using the ideas page.
- Deploy Firestore security rules before production use so user A cannot read or write user B's idea documents.
- No backend migration is required for the current implementation because the ideas page talks directly to Firestore from the frontend.

## Data Integrity and Security
- All client reads and writes must occur under `users/{request.auth.uid}/*`.
- Unauthenticated clients must not be able to read or write user documents.
- User A must not be able to read or write user B's subtree.
- Top-level `integrationSecrets/` token contents are NEVER readable from the client — the encrypted blob can only be written by the FastAPI backend (running with Firebase Admin credentials). The signed-in user can `list` and `delete` their own secret docs (those whose ID is prefixed by `${request.auth.uid}__`) for self-service account deletion. **`read` / `get` access is denied by default and is NOT granted by any rule**, even for the row owner — the only way to read the decrypted access token is through the backend's `integration_connection_service.get_decrypted_tokens` helper, which runs under service-account credentials.
- Top-level `integrationAuthStates/` are written/consumed only by the backend OAuth flow. The signed-in user can `list` (the query-as-a-whole rule) and `delete` rows whose `userId` field equals their `auth.uid`, for self-service account deletion. They cannot create or update these docs.

**Deployed Firestore rules:**
```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Account-deletion self-cleanup: signed-in users can list and delete the
    // backend-only docs that belong to them, but cannot read contents (tokens
    // are encrypted at rest by the backend) or write new entries.
    match /integrationSecrets/{key} {
      allow list, delete: if request.auth != null
        && key.matches('^' + request.auth.uid + '__.*');
    }

    match /integrationAuthStates/{stateHash} {
      allow list: if request.auth != null;
      allow delete: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }
  }
}
```

## Testing Requirements
- Creating an idea while authenticated writes a new document under the current user's `users/{uid}/ideas` subcollection.
- The ideas list only renders documents from the current authenticated user's path.
- Realtime listeners surface newly added ideas without a manual page refresh.
- Saving a draft while authenticated writes to the current user's `users/{uid}/drafts` subcollection.
- Generating angles (initial 3-card run) while authenticated writes the sanitized payload to `users/{uid}/ideas/{ideaId}/workflow/angles` immediately.
- Refining a selected angle while authenticated writes the updated sanitized payload to the same workflow document immediately.
- Revisiting `/angles?ideaId=<ideaId>` restores `angles` + `selectedAngleId` from `users/{uid}/ideas/{ideaId}/workflow/angles` when valid persisted data exists.
- Calling `POST /api/angles/select` for a valid candidate finalizes the selected candidate (`status: 'selected'`, `selectedAt`) and hard-cleans unselected candidates from the canonical `angles` array when possible.
- If hard cleanup fails during selection finalization, unselected candidates are soft-flagged as `status: 'archived'` and `cleanup.pending` is set to `true` for retry workflows.
- Repeating `POST /api/angles/select` with the already-finalized `selectedAngleId` is idempotent and does not create duplicate cleanup side effects.
- Saving or autosaving an adaptation while authenticated writes to the current user's `users/{uid}/adaptations` subcollection.
- Adaptation persistence includes `selectedPlatforms` so the selected gate scope is restored on revisit.
- Revisiting `/adapt/<ideaId>?angleId=<angleId>` reloads the saved platform texts and `activePlatform` from the corresponding adaptation document for the authenticated user.
- Scheduling a publish reminder writes a new doc under `users/{uid}/scheduledPosts/{auto}` with `scheduledForMs > Date.now()`; the Dashboard, Publish upcoming list, and Notifications page all read from this collection.
- For LinkedIn schedules created via `POST /api/v1/publish/schedule` (Pattern B), the new doc additionally carries `eventBridgeScheduleName: 'publish-<scheduledPostId>'` when the backend AWS env is configured, or `null` in local-dev no-op mode. Non-LinkedIn schedules written by the legacy direct-Firestore path do not carry this field.
- Saving or autofilling the Company Profile in Settings writes the `companyContext` field on `users/{uid}` (with `setDoc(..., { merge: true })`) and mirrors it to the local cache.
- Security rules must reject cross-user reads and writes for `users/{uid}/**`, and clients must NOT be able to read `integrationSecrets/*` or `integrationAuthStates/*`.
