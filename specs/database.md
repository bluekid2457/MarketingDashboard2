# Database Specification

This document defines the schema, relationships, and data requirements for the Marketing Dashboard database (Firebase NoSQL DB).

## Purpose
- Specify collections, fields, constraints, and relationships.
- Document migration strategy and data integrity requirements (Firestore rules, application-level constraints).

## Overview
- The frontend stores ideas directly in Cloud Firestore using the Firebase Web SDK.
- Ideas are user-linked and isolated by path under `users/{uid}/ideas/{ideaId}`.
- The current ideas page only reads and writes the authenticated user's idea documents. It does not read global shared idea documents.

## Entity Relationship Summary
- `users/{uid}` is the logical user root keyed by Firebase Auth UID.
- `users/{uid}/ideas/{ideaId}` stores one persisted idea record for that authenticated user.
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

## Constraints and Indexes
- `topic` must be non-empty and is validated in the client before create.
- `userId` must match the parent UID path and authenticated user UID.
- `createdAtMs` should always be present so ordering is stable even before server timestamps resolve.
- The current implementation only needs Firestore's default single-field index for `createdAtMs`.

## Migration Strategy
- Enable Cloud Firestore in the Firebase project before using the ideas page.
- Deploy Firestore security rules before production use so user A cannot read or write user B's idea documents.
- No backend migration is required for the current implementation because the ideas page talks directly to Firestore from the frontend.

## Data Integrity and Security
- All idea reads and writes must occur under `users/{request.auth.uid}/ideas/*`.
- Unauthenticated clients must not be able to read or create idea documents.
- Clients must not be able to spoof `userId` for another user.

**Recommended Firestore rules:**
```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/ideas/{ideaId} {
      allow read, delete: if request.auth != null && request.auth.uid == userId;
      allow create, update: if request.auth != null
        && request.auth.uid == userId
        && request.resource.data.userId == userId;
    }
  }
}
```

## Testing Requirements
- Creating an idea while authenticated writes a new document under the current user's `users/{uid}/ideas` subcollection.
- The ideas list only renders documents from the current authenticated user's path.
- Realtime listeners surface newly added ideas without a manual page refresh.
- Security rules must reject cross-user reads and writes.
