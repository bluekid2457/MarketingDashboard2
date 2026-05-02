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
- Backend-only OAuth/integration storage lives under `integrationAuthStates/`, `users/{uid}/integrationConnections/{provider}`, and `integrationSecrets/{uid__provider}` (see backend.md for write semantics).
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
- `integrationAuthStates/{sha256(state)}` (top-level, backend-only) stores short-lived OAuth state metadata for CSRF-safe LinkedIn callbacks.
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

**Notes:**
- The user document is created lazily on first `setDoc(..., { merge: true })` from the Settings or `/api/company/autofill` flows; there is no required-field guarantee.

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
  One-or-more platform keys (e.g. `['linkedin']`, `['twitter']`). Current Publish UI schedules one platform per record; the field is an array for multi-platform expansion.
- `scheduledForMs: number`
  Client timestamp (ms) of the scheduled publish moment. Used for ordering and "due now / upcoming / missed" classification.
- `scheduledForIso: string`
  ISO-8601 mirror of `scheduledForMs` for human-readable rendering.
- `status: string`
  Reminder status (currently always `'scheduled'` at creation; future states may include `'published'`, `'cancelled'`).
- `createdAt: timestamp`
  Server timestamp on first save.
- `updatedAt: timestamp`
  Server timestamp on each save.

**Current query patterns:**
- `query(collection(db, 'users', uid, 'scheduledPosts'), orderBy('scheduledForMs', 'asc'))` (Dashboard, Publish, Notifications).
- Notifications classifies records as `dueNow` (within ±15 min of now), `upcomingSoon` (next 24 h), and `missed` (older than now − 15 min).

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
**Purpose:** Short-lived OAuth state metadata for CSRF-safe LinkedIn (and future provider) OAuth callbacks. Document ID is the SHA-256 of the opaque state token returned by `POST /api/v1/auth/linkedin/start`.

**Typical fields:**
- `userId: string`
- `provider: string`
- `redirectAfter?: string`
- `createdAtMs: number`
- `consumedAtMs?: number`

**Security:**
- Not readable from the client. Single-use; consumed during the OAuth callback exchange.

## Constraints and Indexes
- `topic` must be non-empty and is validated in the client before create.
- `userId` must match the parent UID path and authenticated user UID.
- `createdAtMs` should always be present so ordering is stable even before server timestamps resolve.
- The current implementation only needs Firestore's default single-field indexes for `createdAtMs`, `updatedAt`, and `scheduledForMs`.
- The drafts and adaptations flows use deterministic document IDs (`${ideaId}_${angleId}`) so revisiting the same draft/angle pair reopens the same persisted state.
- `scheduledPosts` document IDs are auto-generated; uniqueness comes from Firestore.

## Migration Strategy
- Enable Cloud Firestore in the Firebase project before using the ideas page.
- Deploy Firestore security rules before production use so user A cannot read or write user B's idea documents.
- No backend migration is required for the current implementation because the ideas page talks directly to Firestore from the frontend.

## Data Integrity and Security
- All client reads and writes must occur under `users/{request.auth.uid}/*`.
- Unauthenticated clients must not be able to read or write user documents.
- User A must not be able to read or write user B's subtree.
- Top-level `integrationSecrets/` and `integrationAuthStates/` collections are NOT covered by the `users/{userId}/**` rule and remain unreadable from any authenticated client. They are accessed only via the FastAPI backend running with Firebase Admin credentials.

**Deployed Firestore rules:**
```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    // integrationSecrets/* and integrationAuthStates/* intentionally omitted —
    // backend-only access via Firebase Admin SDK, not reachable from clients.
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
- Saving or autofilling the Company Profile in Settings writes the `companyContext` field on `users/{uid}` (with `setDoc(..., { merge: true })`) and mirrors it to the local cache.
- Security rules must reject cross-user reads and writes for `users/{uid}/**`, and clients must NOT be able to read `integrationSecrets/*` or `integrationAuthStates/*`.
