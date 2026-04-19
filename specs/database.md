# Database Specification

This document defines the schema, relationships, and data requirements for the Marketing Dashboard database (Firebase NoSQL DB).

## Purpose
- Specify collections, fields, constraints, and relationships.
- Document migration strategy and data integrity requirements (Firestore rules, application-level constraints).

## Overview
- The frontend stores ideas directly in Cloud Firestore using the Firebase Web SDK.
- Ideas are user-linked and isolated by path under `users/{uid}/ideas/{ideaId}`.
- Drafts are user-linked and isolated by path under `users/{uid}/drafts/{draftId}`.
- Adaptations are user-linked and isolated by path under `users/{uid}/adaptations/{adaptationId}`.
- The current ideas page only reads and writes the authenticated user's idea documents. It does not read global shared idea documents.

## Entity Relationship Summary
- `users/{uid}` is the logical user root keyed by Firebase Auth UID.
- `users/{uid}/ideas/{ideaId}` stores one persisted idea record for that authenticated user.
- `users/{uid}/drafts/{draftId}` stores one persisted draft record for that authenticated user.
- `users/{uid}/adaptations/{adaptationId}` stores one persisted multi-platform adaptation record for a draft/angle pair for that authenticated user.
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
**Purpose:** Persist draft-editor content and metadata for the signed-in user.

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
  Current draft status (currently `'draft'`).
- `createdAt: timestamp`
  Server timestamp on first save.
- `updatedAt: timestamp`
  Server timestamp on each save.

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
- `createdAt: timestamp`
  Server timestamp on first save.
- `updatedAt: timestamp`
  Server timestamp on each save/autosave.

## Constraints and Indexes
- `topic` must be non-empty and is validated in the client before create.
- `userId` must match the parent UID path and authenticated user UID.
- `createdAtMs` should always be present so ordering is stable even before server timestamps resolve.
- The current implementation only needs Firestore's default single-field index for `createdAtMs`.
- The adaptations flow uses deterministic document IDs (`${ideaId}_${angleId}`) so revisiting the same draft/angle pair reopens the same persisted platform state.

## Migration Strategy
- Enable Cloud Firestore in the Firebase project before using the ideas page.
- Deploy Firestore security rules before production use so user A cannot read or write user B's idea documents.
- No backend migration is required for the current implementation because the ideas page talks directly to Firestore from the frontend.

## Data Integrity and Security
- All reads and writes must occur under `users/{request.auth.uid}/*`.
- Unauthenticated clients must not be able to read or write user documents.
- User A must not be able to read or write user B's subtree.

**Deployed Firestore rules:**
```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Testing Requirements
- Creating an idea while authenticated writes a new document under the current user's `users/{uid}/ideas` subcollection.
- The ideas list only renders documents from the current authenticated user's path.
- Realtime listeners surface newly added ideas without a manual page refresh.
- Saving a draft while authenticated writes to the current user's `users/{uid}/drafts` subcollection.
- Saving or autosaving an adaptation while authenticated writes to the current user's `users/{uid}/adaptations` subcollection.
- Revisiting `/adapt/<ideaId>?angleId=<angleId>` reloads the saved platform texts and `activePlatform` from the corresponding adaptation document for the authenticated user.
- Security rules must reject cross-user reads and writes.
