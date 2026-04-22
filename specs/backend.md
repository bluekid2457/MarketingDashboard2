# Backend Specification

This document defines the requirements, architecture, and key behaviors for the Marketing Dashboard backend (Python 3.10+, FastAPI, Firebase NoSQL DB).

---

## Stack

- **Framework**: FastAPI 0.111.0
- **Server**: Uvicorn 0.29.0 (with standard extras)
- **Language**: Python 3.10+
- **Config**: pydantic-settings 2.2.1 (reads from `.env`)
- **Validation**: Pydantic 2.7.1
- **Env loading**: python-dotenv 1.0.1

---

## Folder Structure

```
backend/
  requirements.txt          # pinned dependencies
  .env.example              # template for environment variables
  app/
    __init__.py
    main.py                 # FastAPI app, CORS, /health endpoint
    config.py               # Settings via pydantic-settings
    routers/
      __init__.py           # router registration (empty at init)
```

---

## Environment Variables

| Variable         | Default                   | Description              |
|------------------|---------------------------|--------------------------|
| `SECRET_KEY`     | `changeme`                | App secret key           |
| `ENCRYPTION_KEY` | `changeme`                | Encryption key           |
| `FRONTEND_URL`   | `http://localhost:3000`   | Allowed CORS origin      |
| `DEBUG`          | `false`                   | Debug mode               |

Copy `backend/.env.example` → `backend/.env` before running.

---

## Endpoints

### `POST /api/drafts/inline-edit` (Next.js Route Handler)
- **Location**: `frontend/src/app/api/drafts/inline-edit/route.ts`
- **Purpose**: Shared inline edit proposal endpoint for Storyboard and Adapt.
- **Request schema**:
  - `provider: 'openai' | 'gemini' | 'claude' | 'ollama'`
  - `apiKey?: string`
  - `ollamaBaseUrl?: string`
  - `ollamaModel?: string`
  - `draft: string`
  - `selectedText: string` (required)
  - `selectionStart: number` (required)
  - `selectionEnd: number` (required)
  - `instruction: string` (required)
- **Behavior**:
  - Rejects missing selection/instruction with `400`.
  - Returns a structured `proposal` object for normal provider responses.
  - On provider failure, returns HTTP `200` with a controlled `fallback: true` proposal payload so diff review still renders.
- **Response shape**:
  - `{ proposal: { beforeText, afterText, changeSummary, selectionStart, selectionEnd }, provider, fallback?, error? }`

### `POST /api/drafts`
- **Location**: `frontend/src/app/api/drafts/route.ts`
- **Update**:
  - Adds `citationValidation` metadata in response payload:
    - `hasSourcesSection: boolean`
    - `uncitedClaimCount: number`
  - This allows UI gating before review submission while keeping generation non-blocking.

### `POST /api/drafts/analyze`
- **Location**: `frontend/src/app/api/drafts/analyze/route.ts`
- **Update**:
  - Accepts optional `platform` in request body.
  - SEO prompt includes platform-specific optimization context when provided.
  - Used by Adapt auto-SEO lifecycle after each platform generation.

### `GET /health`
- **Tags**: Health
- **Response**: `{"status": "healthy"}`
- **Auth**: None
- **Purpose**: Service liveness check

### `POST /api/angles/persist` (Next.js Route Handler)
- **Location**: `frontend/src/app/api/angles/persist/route.ts`
- **Purpose**: Persist angle workflow state for a specific user/idea pair with optimistic timestamp version checking to avoid concurrent regeneration overwrites.
- **Auth expectation**: Request body `userId` must be present; when `x-user-id` or `x-firebase-uid` header is provided, it must match `userId`.
- **Request schema**:
  - `userId: string`
  - `ideaId: string`
  - `angles: Array<{ id: string; title: string; summary: string; sections: string[]; status: 'active' | 'selected' | 'archived'; createdAt: number; selectedAt?: number }>`
  - `selectedAngleId: string | null`
  - `baseUpdatedAtMs?: number` (optional optimistic concurrency token)
- **Behavior**:
  - Validates non-empty `angles` and required fields per candidate.
  - Ensures `selectedAngleId` references an angle in the payload when non-null.
  - Uses Firestore `runTransaction` on `users/{userId}/ideas/{ideaId}/workflow/angles`.
  - Retries transient transaction failures (e.g., aborted/unavailable/deadline contention) with a short bounded backoff before returning `500`.
  - Rejects stale writes with HTTP `409` when `baseUpdatedAtMs` is older than persisted `updatedAtMs`.
  - Writes `{ ideaId, angles, selectedAngleId, updatedAt, updatedAtMs, cleanup }`.
- **Success response**:
  - `{ success: true, persistedIds: string[], message: string, updatedAtMs: number }`
- **Failure response**:
  - Validation/identity mismatch: `400`/`403`
  - Version conflict: `409`
  - Persistence failure: `500` with structured message

### `POST /api/angles/select` (Next.js Route Handler)
- **Location**: `frontend/src/app/api/angles/select/route.ts`
- **Purpose**: Finalize selected angle and clean up unselected candidates with idempotent behavior.
- **Auth expectation**: Request body `userId` must be present; when `x-user-id` or `x-firebase-uid` header is provided, it must match `userId`.
- **Request schema**:
  - `userId: string`
  - `ideaId: string`
  - `selectedAngleId: string`
- **Behavior**:
  - Loads persisted angle workflow doc from `users/{userId}/ideas/{ideaId}/workflow/angles`.
  - Marks the selected candidate as `status: 'selected'` and sets `selectedAt` when missing.
  - Hard-cleanup path: rewrites `angles` to contain only the selected candidate.
  - Soft-failure path: when cleanup write fails, archives unselected candidates (`status: 'archived'`) and records retry metadata in `cleanup.pending` + `cleanup.failedIds`.
  - Idempotent: repeated calls with an already-finalized selection return success with zero additional cleanup.
- **Success response**:
  - `{ success: true, cleaned: { deletedCount: number, failedCount: number }, message: string, updatedAtMs: number }`
- **Failure response**:
  - Validation/identity mismatch: `400`/`403`
  - Missing idea/angles/selected candidate: `404`
  - Unexpected failure: `500`

---

## CORS

- Allowed origins: `FRONTEND_URL` env var + `http://localhost:3000`
- Credentials: allowed
- Methods: all
- Headers: all

---

## Running the Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

API available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

---

## Security

- All secrets via environment variables — never hardcoded
- CORS restricted to known frontend origins
- All endpoints return structured JSON
- Future: rate limiting, OAuth/token auth for third-party platforms

