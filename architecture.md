# Marketing Dashboard Architecture

## 1. Overview

Marketing Dashboard is a full-stack application with three runtime layers:

1. Frontend: Next.js + React + TypeScript for dashboard UX, workflow state, and local AI API routes.
2. Backend: FastAPI + Python for auth, provider connect orchestration, OAuth, credential storage, and publishing workflows.
3. Data: Firebase (NoSQL) for users, auth records, provider state, encrypted artifacts, and saved-post history.

Project folders:

- `frontend`: UI, client state, backend API client wrappers, and `/api/ai/*` provider adapters.
- `backend`: FastAPI routes and service layer.
- `supabase`: bootstrap schema + additive migrations.

## 2. High-Level Runtime Flow

There are two primary request paths from the browser:

1. Frontend -> FastAPI backend (`/api/v1/*`) for auth, connect, credentials, integration status, and publish operations.
2. Frontend -> Next.js API routes (`/api/ai/*`) for AI generation (outline, draft, posts, image), then provider SDK/HTTP calls.

Backend persistence is centralized in `FirebaseService`, which calls Firebase Firestore/Realtime Database endpoints using service credentials.

## 3. Backend Architecture

### 3.1 Entry, Boot, and Config

- `backend/app/main.py`
  - Registers CORS using configured origins.
  - Mounts all routers under `/api/v1` and exposes `/health`.
- `backend/app/config.py`
  - Loads environment configuration for Supabase, JWT, encryption, OAuth, and frontend callback URLs.

### 3.2 Route Modules and Endpoints

- `auth.py` (`/api/v1/auth`)
  - `POST /login`
  - `POST /signup`
  - `GET /me`
  - `POST /logout`

- `connect.py` (`/api/v1/connect`)
  - `POST /start`
  - `POST /close`
  - `GET /status`

- `linkedin.py`
  - `POST /api/v1/auth/linkedin/start`
  - `GET /api/v1/auth/linkedin/callback`
  - `GET /api/v1/integrations/linkedin/status`
  - `POST /api/v1/integrations/linkedin/disconnect`
  - `POST /api/v1/integrations/linkedin/playwright/start`
  - `POST /api/v1/integrations/linkedin/playwright/complete`

- `facebook.py` (`/api/v1/auth`)
  - `POST /facebook/start`
  - `POST /facebook/callback`

- `credentials.py` (`/api/v1/credentials`)
  - `POST /store`
  - `GET /providers`
  - `GET /{provider}`
  - `DELETE /{provider}`

- `content.py` (`/api/v1/content`)
  - `GET /platforms`
  - `GET /platforms/{platform}`
  - `POST /generate-prompt`

- `articles.py` (`/api/v1/articles`)
  - `POST /{article_id}/publish` (approval-first flow; LinkedIn compose prefill in no-submit mode)
  - `GET /saved-posts`
  - `PATCH /saved-posts/{saved_post_id}`
  - `POST /{article_id}/publish-facebook` (approval mode or direct Graph API publish)

### 3.3 Service Layer Responsibilities

- `auth_service.py`: password hashing (PBKDF2), JWT issue/verify, auth context extraction.
- `encryption.py`: Fernet encryption/decryption helper.
- `supabase_service.py`: all database IO and compatibility handling for schema drift.
- `linkedin_oauth_service.py`: LinkedIn OAuth state, token exchange, profile fetch, connection persistence.
- `facebook_oauth_service.py`: Facebook OAuth start/callback orchestration.
- `facebook_api_service.py`: Facebook Graph API posting and managed-pages lookup.
- `credentials_service.py`: encrypted website credential CRUD.
- `prompt_service.py` and `content_generation.py`: platform prompt retrieval/composition for backend prompt endpoints.

### 3.4 Security Model

- Password storage: PBKDF2-SHA256 hash in `app_auth_users.password_hash`.
- Session auth: HS256 JWT with `sub`, `email`, `iat`, `exp`, `jti`.
- Encryption at rest:
  - OAuth tokens (`oauth_tokens.access_token_enc`, `refresh_token_enc`)
  - Website credentials (`website_credentials.username_enc`, `password_enc`)
- Fernet key source: `ENCRYPTION_KEY` with `SECRET_KEY`-based fallback in development paths.

## 4. Connect and Browser Session Subsystem

The `/connect` layer is provider-agnostic (`linkedin`, `facebook`) and uses `app_platform_sessions` as the session source of truth.

### 4.1 Session Model

`app_platform_sessions` stores versioned provider sessions with:

- lifecycle status (`pending`, `connected`, `failed`, `disconnected`)
- active flag (`is_active`)
- close-control telemetry (`close_requested_at`, `closed_at`, `closed_by_user`)
- auth telemetry (`auth_state`, `auth_state_checked_at`, `reusable_session_available`)
- artifact metadata (`capture_mode`, `artifact_type`)

### 4.2 Connect Start Behavior

`POST /api/v1/connect/start` executes:

1. Validate provider and optional stored-credential requirement.
2. Ensure app user exists in `app_users`.
3. Reuse active runtime capture when one is already in progress.
4. Reuse pending session when valid.
5. Reuse persisted authenticated session metadata when available.
6. Create a new session row when reuse does not apply.
7. Launch browser flow:
   - manual login capture (`launch_login_capture`), or
   - credential-based login (`launch_credential_login`) if encrypted credentials were requested.

### 4.3 Close and Status

- `POST /api/v1/connect/close` marks close requested in DB and signals runtime control state.
- `GET /api/v1/connect/status` merges session row + oauth connection + reusable metadata to return:
  - connection state,
  - close controls (`close_available`, `close_requested`),
  - auth/session reuse fields.

### 4.4 Compose Control

For LinkedIn compose prefill (`/articles/{article_id}/publish`), runtime controls prevent duplicate active compose automation. If a compose window is already active, compose launch is skipped and posts are still persisted for approval.

## 5. Integration Workflows

### 5.1 LinkedIn OAuth

1. Authenticated user starts via `POST /api/v1/auth/linkedin/start`.
2. Backend stores hashed state in `oauth_states` with expiry.
3. LinkedIn callback hits `GET /api/v1/auth/linkedin/callback`.
4. Backend validates state, exchanges code, fetches profile.
5. Backend upserts `oauth_connections` and stores encrypted tokens in `oauth_tokens`.
6. Callback redirects to frontend callback URL with status query params.

### 5.2 Facebook OAuth and API Posting

1. Frontend starts with `POST /api/v1/auth/facebook/start`.
2. Frontend callback page calls `POST /api/v1/auth/facebook/callback`.
3. Backend persists connection/token data using OAuth service.
4. Publishing path (`POST /api/v1/articles/{article_id}/publish-facebook`):
   - `dry_run_no_submit=true`: save approval item only.
   - `dry_run_no_submit=false`: publish via Graph API and persist published record metadata.


- launches visible Chromium with anti-detection context options,
- injects stealth script,
- validates authenticated state via URL + cookies,
- captures profile metadata and encrypted storage state,
- updates session rows and integration logs.

LinkedIn additionally supports compose prefill automation with no-submit enforcement for approval-first workflows.

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
