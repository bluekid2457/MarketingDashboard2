# Marketing Dashboard Architecture

## 1. Overview

Marketing Dashboard is a full-stack application with three runtime layers:

1. Frontend: Next.js + React + TypeScript for dashboard UX, workflow state, and local AI API routes.
2. Backend: FastAPI + Python for auth, provider connect orchestration, OAuth, credential storage, and publishing workflows.
3. Data: Firebase (NoSQL) for users, auth records, provider state, encrypted artifacts, and saved-post history.

Project folders:

- `frontend`: UI, client state, and Next.js route handlers for AI flows.
- `backend`: FastAPI routes and service layer for provider auth and future direct publishing.

## 2. High-Level Runtime Flow

There are two primary request paths from the browser:

1. Frontend -> FastAPI backend (`/api/v1/*`) for provider auth start/callback, encrypted token storage, integration status, and future publish operations.
2. Frontend -> Next.js API routes (`/api/ai/*`) for AI generation (outline, draft, posts, image), then provider SDK/HTTP calls.

Backend persistence is centralized in a Firebase Admin-backed service layer that writes browser-safe connection summaries and backend-only encrypted token secrets to Firestore.

## 3. Backend Architecture

### 3.1 Entry, Boot, and Config

- `backend/app/main.py`
  - Registers CORS using configured origins.
  - Mounts all routers under `/api/v1` and exposes `/health`.
- `backend/app/config.py`
  - Loads environment configuration for encryption, Firebase Admin, LinkedIn OAuth, and frontend/backend callback URLs.

### 3.2 Route Modules and Endpoints

- `linkedin.py`
  - `POST /api/v1/auth/linkedin/start`
  - `GET /api/v1/auth/linkedin/callback`

- `integrations.py`
  - `GET /api/v1/integrations/providers`
  - `GET /api/v1/integrations/status`
  - `GET /api/v1/integrations/{provider}/status`
  - `POST /api/v1/integrations/{provider}/tokens`
  - `POST /api/v1/integrations/{provider}/disconnect`

This is the current provider-auth foundation for future direct publishing. The publish job runner and provider-specific posting endpoints are still a later layer on top of these routes.

### 3.3 Service Layer Responsibilities

- `encryption.py`: derives a Fernet-compatible key from `ENCRYPTION_KEY` and encrypts/decrypts provider secrets.
- `firebase_service.py`: lazily initializes Firebase Admin / Firestore using service-account env vars or application default credentials.
- `provider_registry.py`: defines the provider capability model used by LinkedIn, X/Twitter, Instagram, Facebook, WordPress, Ghost, and Substack.
- `integration_connection_service.py`: stores public connection summaries, backend-only encrypted token docs, and OAuth state records.
- `linkedin_oauth_service.py`: generates LinkedIn authorization URLs, exchanges codes for tokens, fetches LinkedIn `userinfo`, and persists the member connection for future posting.

### 3.4 Security Model

- OAuth state is stored server-side and consumed exactly once on callback.
- Provider tokens are encrypted at rest using a Fernet-compatible key derived from `ENCRYPTION_KEY`.
- Browser-safe connection summaries live under `users/{uid}/integrationConnections/{provider}`.
- Encrypted secrets live under backend-only `integrationSecrets/{uid__provider}`.
- The current provider-management endpoints rely on explicit `userId` request fields; backend-issued auth is still a follow-up hardening step.

## 4. Provider Connection Storage

The current backend implements a provider-agnostic auth storage layer that future publish workers can read from.

### 4.1 Public Connection Summaries

`users/{uid}/integrationConnections/{provider}` stores browser-safe metadata such as:

- `status` (`not_connected`, `connected`, `disconnected`)
- `authType`
- `accountId`
- `accountUrn`
- `displayName`
- `email`
- `pictureUrl`
- `scopes`
- `tokenExpiresAtMs`
- `hasRefreshToken`
- provider metadata (for example LinkedIn `publishAuthorUrn`)

### 4.2 Secret Storage

`integrationSecrets/{uid__provider}` stores encrypted secrets such as:

- `accessTokenEnc`
- `refreshTokenEnc`
- `idTokenEnc`
- `tokenType`
- `scope`
- `expiresAtMs`

### 4.3 OAuth State Storage

`integrationAuthStates/{sha256(state)}` stores temporary OAuth state metadata:

- `provider`
- `userId`
- `redirectAfter`
- `createdAtMs`
- `expiresAtMs`

## 5. Integration Workflows

### 5.1 LinkedIn OAuth

1. Frontend or a future backend client calls `POST /api/v1/auth/linkedin/start` with `userId`.
2. Backend stores hashed state in `integrationAuthStates` with expiry and returns a LinkedIn OAuth URL.
3. LinkedIn redirects the browser to `GET /api/v1/auth/linkedin/callback`.
4. Backend validates and consumes the state, exchanges the code for tokens, and calls `https://api.linkedin.com/v2/userinfo`.
5. Backend persists a publish-ready LinkedIn connection summary including `publishAuthorUrn = urn:li:person:{sub}`.
6. Backend stores encrypted LinkedIn access/refresh/id tokens in `integrationSecrets`.
7. Callback redirects to the frontend settings route with `integration=linkedin` and `status=connected|error`.

### 5.2 Multi-Provider Foundation

- The provider registry already reserves connection slots for LinkedIn, X/Twitter, Instagram, Facebook, WordPress, Ghost, and Substack.
- Providers without OAuth wiring yet can still store tokens through `POST /api/v1/integrations/{provider}/tokens`.
- This keeps the connection schema stable before direct publishing endpoints and scheduled workers are added.

## 6. Frontend Architecture

### 6.1 UI and Pages

- `pages/index.tsx`: primary dashboard workflow orchestration.
- `pages/saved-posts.tsx`: grouped approval queue with edit/review/publish controls.
- `pages/auth/login.tsx`: login/signup UI.
- `pages/auth/linkedin.tsx`: LinkedIn callback status handling.
- `pages/auth/facebook.tsx`: Facebook callback exchange + user refresh.
- `components/*`: modular dashboard UI components.

### 6.2 State Management

`lib/store.ts` (Zustand) stores:

- auth user/session state,
- article/workflow data,
- stage progression,
- platform generation states,
- provider and API key preferences.

Primary stages:

1. `initial_prompt`
2. `generating_outline`
3. `editing_draft`
4. `creating_posts`
5. `review`
6. `published`

### 6.3 Frontend API Layers

- `lib/api.ts`
  - backend client (`apiClient`) for `/api/v1/*` routes with JWT interceptor.
  - local client (`aiApi`) for `/api/ai/*` generation routes.

- local AI routes (`pages/api/ai`)
  - `outline.ts`
  - `draft.ts`
  - `posts.ts`
  - `image.ts`

### 6.4 AI Provider Abstraction

AI routes use `createAIProvider` (`frontend/lib/ai/index.ts`) and currently support:

- `GeminiProvider`
- `OpenAIProvider`

Current runtime behavior includes:

- model discovery/fallback behavior in Gemini provider,
- retry/backoff for transient provider failures,
- structured error mapping in image generation route,
- provider/model resolution via `model-registry.ts`.

## 7. Content, Approval, and Publishing Workflow

### 7.1 AI Content Flow

1. User enters prompt + platforms.
2. Frontend calls `/api/ai/outline` for outline + initial draft.
3. Draft revisions go through `/api/ai/draft`.
4. Platform post generation goes through `/api/ai/posts`.
5. Optional image generation goes through `/api/ai/image`.

### 7.2 Approval-First Persistence

Backend persists review-stage output in `saved_posts`:

- `approval_pending` when queued for review,
- `editing` after user edits,
- `published` after successful publish,
- `archived` for retired items.

`GET /api/v1/articles/saved-posts` returns grouped records by article. `PATCH /api/v1/articles/saved-posts/{id}` supports post-level edits and article-level field synchronization.

### 7.3 Platform Publish Behavior

- LinkedIn: `POST /api/v1/articles/{article_id}/publish`
  - saves approval records,
  - optionally opens compose prefill with submission disabled.

- Facebook: `POST /api/v1/articles/{article_id}/publish-facebook`
  - approval-only save mode or direct publish mode depending on `dry_run_no_submit`.

## 8. Supabase Data Architecture

### 8.1 Primary Runtime Tables

- `app_users`
- `app_auth_users`
- `oauth_connections`
- `oauth_tokens`
- `oauth_states`
- `app_platform_sessions`
- `website_credentials`
- `saved_posts`
- `integration_audit_logs`
- `playwright_profiles` (still present and used by helper methods)

### 8.2 Schema Sources

- `supabase/setup_all_tables.sql`: older bootstrap schema (legacy naming set such as `users`, `platform_connections`, `capture_sessions`, `posts`).
- `supabase/migrations/*.sql`: additive app-focused schema (`app_*`, `oauth_*`, `saved_posts`, `website_credentials`).

Current backend code operates against the app-focused tables via `SupabaseService`.

### 8.3 Backward Compatibility Strategy

`SupabaseService` includes guarded fallbacks for environments missing enhancement columns (notably session telemetry fields), reducing hard failures during partial migration states.

## 9. Operational Boundaries and Notes

- LinkedIn compose flow intentionally enforces no-submit behavior in this backend path.
- Facebook supports both OAuth linkage and optional direct publishing via Graph API.
- Frontend and backend still contain some legacy compatibility endpoints/helpers, but core active architecture follows the flows documented above.

## 10. Directory Map

- `backend`
  - `app/main.py`: FastAPI bootstrap and router registration.
  - `app/routes/*`: HTTP API modules.
  - `app/models.py`: request/response schemas.
- `frontend`
  - `pages/*`: Next.js pages and local API handlers.
  - `components/*`: UI building blocks.
  - `lib/store.ts`: Zustand store.
  - `lib/api.ts`: backend and local API clients.
  - `lib/ai/*`: provider implementations and model registry.
- `supabase`
  - `setup_all_tables.sql`: legacy bootstrap schema.
  - `migrations/*.sql`: schema evolution.

## 11. Recommended Next Improvements

2. Add startup-time migration validation for required tables/columns.
3. Consolidate or remove legacy frontend API helper methods that no longer map to active backend routes.
4. Add explicit metrics/tracing around connect lifecycle and AI generation latencies.
5. Formalize multi-provider abstraction so LinkedIn and Facebook share a unified provider adapter contract across OAuth, browser capture, and publish operations.
