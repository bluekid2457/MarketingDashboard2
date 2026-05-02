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
- **HTTP client**: httpx 0.27.0
- **Encryption**: cryptography 42.0.8 (Fernet-compatible token encryption)
- **Firebase Admin**: firebase-admin 6.5.0

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
      __init__.py           # router package
      linkedin.py           # LinkedIn OAuth start/callback endpoints
      integrations.py       # Provider registry + status/token/disconnect endpoints
    services/
      encryption.py         # Fernet-compatible token encryption helper
      firebase_service.py   # Firebase Admin / Firestore lazy initialization
      provider_registry.py  # Shared provider capability registry
      integration_connection_service.py  # Firestore-backed connection + secret storage
      linkedin_oauth_service.py          # LinkedIn OAuth exchange + userinfo persistence
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `changeme` | App secret key fallback used when deriving encryption material in development |
| `ENCRYPTION_KEY` | `changeme` | Primary token-encryption secret |
| `FRONTEND_URL` | `http://localhost:3000` | Allowed CORS origin and OAuth redirect base |
| `BACKEND_URL` | `http://localhost:8000` | Backend origin used to derive the default LinkedIn callback URL |
| `DEBUG` | `false` | Debug mode |
| `FIREBASE_PROJECT_ID` | unset | Firebase project id for Admin SDK initialization |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | unset | Full service-account JSON blob for Firebase Admin |
| `FIREBASE_CREDENTIALS_PATH` | unset | Path to a Firebase service-account JSON file |
| `FIREBASE_CLIENT_EMAIL` | unset | Service-account email when composing Firebase credentials from individual fields |
| `FIREBASE_PRIVATE_KEY` | unset | Service-account private key when composing Firebase credentials from individual fields |
| `LINKEDIN_CLIENT_ID` | unset | LinkedIn app client id |
| `LINKEDIN_CLIENT_SECRET` | unset | LinkedIn app client secret |
| `LINKEDIN_REDIRECT_URI` | `BACKEND_URL + /api/v1/auth/linkedin/callback` | Optional explicit LinkedIn callback URL override |
| `LINKEDIN_SCOPES` | `openid profile email w_member_social` | Scopes requested during LinkedIn OAuth |

Copy `backend/.env.example` → `backend/.env` before running.

---

## Endpoint Surfaces

This project mixes two API tiers, both of which are documented below:

- **FastAPI backend** at `http://localhost:8000` — namespaces under `/api/v1/*`, `/health`. Owns OAuth/integration token storage (encrypted) and provider registry. See "FastAPI endpoints" below.
- **Next.js route handlers** under `frontend/src/app/api/*` — namespaces include `/api/angles`, `/api/drafts/*`, `/api/ideas/*`, `/api/trends`, `/api/company/autofill`. These are the AI provider proxies that build prompts, call OpenAI/Gemini/Claude/Ollama, and return parsed structured payloads to the UI. They ARE the public-facing API for the AI features. See "Next.js route handlers" below.

There is currently no `/api/v1/*` proxy that forwards Next.js calls to FastAPI; the two tiers serve disjoint concerns.

---

## FastAPI endpoints

### `GET /health`
- **Tags**: Health
- **Response**: `{"status": "healthy"}`
- **Auth**: None
- **Purpose**: Service liveness check

### `POST /api/v1/auth/linkedin/start`
- **Location**: `backend/app/routers/linkedin.py`
- **Purpose**: Start a publish-capable LinkedIn OAuth flow for a specific app user.
- **Request schema**:
  - `userId: string` (required Firebase app user id)
  - `redirectAfter?: string` (optional frontend-relative path; defaults to `/settings`)
- **Behavior**:
  - Validates LinkedIn client configuration.
  - Generates a CSRF-safe OAuth state token.
  - Stores hashed state metadata in Firestore under `integrationAuthStates/{sha256(state)}`.
  - Returns a LinkedIn authorization URL requesting `LINKEDIN_SCOPES`.
- **Response shape**:
  - `{ provider: 'linkedin', authorizeUrl: string, scopes: string[] }`

### `GET /api/v1/auth/linkedin/callback`
- **Location**: `backend/app/routers/linkedin.py`
- **Purpose**: Complete the LinkedIn OAuth exchange and persist the member connection.
- **Query params**:
  - `code?: string`
  - `state?: string`
  - `error?: string`
  - `error_description?: string`
- **Behavior**:
  - Validates and consumes the stored OAuth state.
  - Exchanges the code for access/refresh/id tokens.
  - Calls `https://api.linkedin.com/v2/userinfo` to resolve the member identity.
  - Persists a public connection summary under `users/{uid}/integrationConnections/linkedin`.
  - Persists encrypted token material under backend-only `integrationSecrets/{uid__linkedin}`.
  - Redirects back to the frontend with `integration=linkedin` and a `status` query parameter.

### `GET /api/v1/integrations/providers`
- **Location**: `backend/app/routers/integrations.py`
- **Purpose**: Return the provider registry used by the backend integration layer.
- **Behavior**:
  - Lists current provider definitions for LinkedIn, X/Twitter, Instagram, Facebook, WordPress, Ghost, and Substack.
  - Exposes auth capabilities (`authTypes`), publish capabilities, and content-type support.

### `GET /api/v1/integrations/status`
- **Location**: `backend/app/routers/integrations.py`
- **Purpose**: List connection state for every registered provider for a specific app user.
- **Query params**:
  - `userId: string` (required)
- **Response shape**:
  - `{ connections: Array<ProviderConnectionSummary> }`
- **Behavior**:
  - Merges the static provider registry with any saved Firestore docs.
  - Returns `status: 'not_connected'` for providers without a saved connection.

### `GET /api/v1/integrations/{provider}/status`
- **Location**: `backend/app/routers/integrations.py`
- **Purpose**: Return one provider connection summary for a user.
- **Query params**:
  - `userId: string` (required)

### `POST /api/v1/integrations/{provider}/tokens`
- **Location**: `backend/app/routers/integrations.py`
- **Purpose**: Persist tokens for providers that are not wired to OAuth yet, while reusing the same encrypted-storage model as LinkedIn.
- **Request schema**:
  - `userId: string` (required)
  - `authType: string` (default `oauth2`)
  - `accessToken?: string`
  - `refreshToken?: string`
  - `idToken?: string`
  - `tokenType?: string`
  - `expiresAtMs?: number`
  - `expiresIn?: number`
  - `scopes?: string[]`
  - `accountId?: string`
  - `accountUrn?: string`
  - `displayName?: string`
  - `email?: string`
  - `pictureUrl?: string`
  - `metadata?: object`
- **Behavior**:
  - Rejects requests that provide no token values.
  - Saves a browser-safe summary doc under `users/{uid}/integrationConnections/{provider}`.
  - Saves encrypted token material under `integrationSecrets/{uid__provider}`.

### `POST /api/v1/integrations/{provider}/disconnect`
- **Location**: `backend/app/routers/integrations.py`
- **Purpose**: Remove stored token material while preserving a disconnected status summary.
- **Request schema**:
  - `userId: string` (required)
- **Behavior**:
  - Deletes the backend-only secret document.
  - Marks the public connection summary as `status: 'disconnected'`.

---

## Next.js route handlers

The following endpoints live under `frontend/src/app/api/` and run inside the Next.js process (port 3000). They are the public-facing API for AI features. Each AI route accepts a `provider`/`apiKey`/`ollamaBaseUrl?`/`ollamaModel?` quartet describing which provider to call (OpenAI, Gemini, Claude, or local Ollama) and most accept an optional `companyContext: string[]` to ground prompts in the saved Company Profile.

| Route | Method | Purpose |
|---|---|---|
| `/api/angles` | POST | Generate or refine angle candidates from an idea. Provider-agnostic. Returns deterministic fallback when provider config is incomplete. |
| `/api/angles/persist` | POST | Server-side persistence of the angle workflow doc (retained alongside the Angles page's direct Firestore writes). |
| `/api/angles/select` | POST | Server-side angle selection finalization with hard/soft cleanup. |
| `/api/ideas/rationale` | POST | AI rationale + improvement bullets for an idea score; deterministic fallback when no key. |
| `/api/trends` | GET | Bing News RSS aggregator for the live trends panel. Accepts optional `companyTerms` query string. |
| `/api/drafts` | POST | Long-form draft generation grounded in DuckDuckGo search results; returns `citationValidation` metadata. |
| `/api/drafts/adapt` | POST | Per-platform adaptation using `src/lib/prompts/platforms/*` rules. 5-minute provider timeout → HTTP 504. |
| `/api/drafts/chat` | POST | Conversational AI chat against the current draft; parses `<UPDATED_DRAFT>...</UPDATED_DRAFT>` tags. |
| `/api/drafts/analyze` | POST | SEO / plagiarism / source-check analysis; deterministic fallback per type when no key. |
| `/api/drafts/rewrite` | POST | Tone or readability rewrite of an existing draft. |
| `/api/drafts/personas` | POST | Persona-targeted rewrite (current UI sends one persona at a time). |
| `/api/drafts/headlines` | POST | A/B headline variant generator. |
| `/api/drafts/research` | POST | DuckDuckGo-grounded research brief synthesizer. |
| `/api/drafts/plagiarism` | POST | Verbatim-quote web search + AI heuristic AI-likelihood review. Does NOT accept `companyContext`. |
| `/api/drafts/inline-edit` | POST | Shared inline-edit proposal endpoint for Storyboard and Adapt. |
| `/api/drafts/similar-posts` | POST | Find linked similar posts and competitor matches; produces a comparison summary and recommended actions. |
| `/api/company/autofill` | POST | Scrape a company website (homepage + optional about page) and extract a structured `CompanyProfile` via the configured AI provider. |

Detailed request/response shapes for each route follow.

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
  - `companyContext?: string[]` (optional company profile lines from `companyProfileToContextLines`; injected into all three prompt variants — selected-text, autonomous-single, autonomous-multi — so rewrites preserve product references and brand voice)
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
  - Accepts optional `companyContext: string[]` and renders a "Company context" block inside the draft prompt to ground tone, examples, audience framing, and product references.

### `POST /api/drafts/analyze`
- **Location**: `frontend/src/app/api/drafts/analyze/route.ts`
- **Update**:
  - Accepts optional `platform` in request body.
  - SEO prompt includes platform-specific optimization context when provided.
  - Used by Adapt auto-SEO lifecycle after each platform generation.
  - Accepts optional `companyContext: string[]`. Injected ONLY for `type: 'seo'` (biases primary/secondary keywords, meta description, and title suggestions toward the configured company). Ignored for `type: 'plagiarism'` and `type: 'sources'`.

### Other Next.js Route Handlers receiving `companyContext`
- `POST /api/drafts/adapt` — appends a "Company context" block to the platform adaptation prompt so adapted copy preserves product references and brand voice.
- `POST /api/drafts/chat` — appends a "Company context" block to the system prompt before the current draft so chat rewrites stay on-brand.
- `POST /api/drafts/rewrite` — appends a "Company context" block to the system prompt for tone and readability rewrites.
- `POST /api/drafts/personas` — appends a "Company context" block to the user prompt so each persona variant stays consistent with the company's product/brand voice.
- `POST /api/drafts/headlines` — appends a "Company context" block to the user prompt so headline variants ground product references and brand voice.
- `POST /api/drafts/research` — appends a "Company context" block to the synthesis prompt so the brief biases toward findings relevant to the company's industry/audience/product. The DuckDuckGo search query itself is unchanged.
- `POST /api/angles` — appends a "Company context" block to both the per-slot single-angle prompt and the refinement prompt so generated angles are grounded in the company's audience and product references.
- `POST /api/ideas/rationale` — already accepts `personalizationContext.company` (string lines) and renders it in the rationale prompt. The Ideas page extractor reads from `users/{uid}.companyContext` (the same Firestore field that `saveCompanyProfile` writes).
- `POST /api/drafts/similar-posts` — appends a "Company context" block to the synthesis prompt so the comparison summary and recommended actions reflect the company's positioning.

### Endpoints intentionally NOT receiving `companyContext`
- `POST /api/drafts/plagiarism` — pure verbatim-quote web search + AI heuristic review of submitted text. Brand framing does not change exact-quote matching or AI-pattern detection and would only add prompt noise.
- `GET /api/trends` — RSS-only Bing News fetcher; no AI provider call, so the request body never carries `companyContext`. The route DOES, however, accept an optional `companyTerms` query string (comma-separated keyword list, normalized to entries of length 2–60). When present it (a) issues up to four extra Bing News queries built from those terms (`"<term> marketing"`, `"<term> content strategy"`), (b) boosts ranking of articles whose title contains any term, and (c) prepends per-term topic-rule labels so the trend cluster panel surfaces company-relevant clusters first. The response payload includes `companyTermsApplied: string[]` for transparency.
- `POST /api/angles/persist` and `POST /api/angles/select` — pure persistence/state-cleanup endpoints; no prompt construction.

### `POST /api/drafts/similar-posts`
- **Location**: `frontend/src/app/api/drafts/similar-posts/route.ts`
- **Purpose**: Power the Adapt page's `Similar posts` AI Toolbox tab — search for topic-adjacent published content, optionally biasing toward provided competitor terms, and produce a comparison summary plus recommended differentiation moves against the current draft.
- **Request schema**:
  - `provider`/`apiKey`/`ollamaBaseUrl?`/`ollamaModel?` (standard provider quartet)
  - `draft?: string`
  - `topic?: string`
  - `audience?: string`
  - `format?: string`
  - `query?: string` (explicit search query override; otherwise derived from topic/draft)
  - `competitors?: string` (comma-separated terms used to label competitor matches)
  - `companyContext?: string[]`
- **Behavior**:
  - Runs a DuckDuckGo search (`searchDuckDuckGo()`) for the resolved query.
  - Scores each result against the draft via lexical overlap (stop-word-filtered token sets).
  - Calls the configured AI provider to synthesize a `comparisonMarkdown` summary and `recommendedActions[]` for differentiation.
  - When the AI provider is unavailable, returns a deterministic fallback summary while preserving `matches[]`.
- **Response shape**:
  - `{ query, matches: SimilarPostMatch[], comparisonMarkdown, recommendedActions: string[], provider, searchProvider, usedFallback?: boolean }`
  - `SimilarPostMatch = { title, url, snippet, similarityScore, overlapTerms[], sourceType: 'similar-post' | 'competitor', comparisonNote }`

### `POST /api/company/autofill`
- **Location**: `frontend/src/app/api/company/autofill/route.ts`
- **Purpose**: Scrape a company website (homepage + optional about page) and extract a structured `CompanyProfile` payload that Settings can drop into the Company Profile form. Used by the "Autofill from website" affordance in `/settings`.
- **Request schema**:
  - `provider`/`apiKey`/`ollamaBaseUrl?`/`ollamaModel?` (standard provider quartet)
  - `websiteUrl: string` (required; must pass `isValidHttpUrl`)
- **Behavior**:
  - Fetches the homepage HTML (and best-effort about page when discoverable), strips to plain text.
  - Sends the text to the configured AI provider with a strict system prompt that demands JSON-only output matching the `AutofillProfile` shape.
  - Refuses to invent fields: missing-information slots are returned as empty strings.
  - Returns `fetchedUrls[]` for transparency and `provider` metadata.
- **Response shape**:
  - `{ profile: AutofillProfile, fetchedUrls: string[], provider: string }`
  - `AutofillProfile` mirrors the `CompanyProfile` shape: `companyName, companyDescription, industry, products, services, valueProposition, targetMarket, keyDifferentiators, brandVoice` (all strings).
- **Failure mode**:
  - Validation errors (missing/invalid URL, unreachable site) return HTTP `400` or `502` with an `error` message.
  - Provider failures return an empty profile + `error` field rather than throwing, so the Settings UI can offer a retry without losing form state.
- **Note**: This endpoint does NOT accept `companyContext` (the user is filling in their own company profile, so there is no existing profile to ground against).

### `companyContext` shape contract
- Always optional `string[]` in the request body.
- Each entry is a pre-formatted `"Field label: value"` line produced by `companyProfileToContextLines(profile)` in `frontend/src/lib/companyProfile.ts`.
- Server routes normalize the array (drop non-strings, trim, drop empties) and skip injection when the resulting list is empty, so the prompt is unchanged for users who have not filled in a Company Profile.

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
- LinkedIn and manual provider tokens are encrypted before being stored in Firestore.
- Browser-safe connection summaries live under `users/{uid}/integrationConnections/{provider}`.
- Encrypted secrets live under backend-only `integrationSecrets/{uid__provider}` so they are not readable through the existing `/users/{uid}/**` Firestore rule.
- Future: rate limiting and backend-issued auth for provider-management endpoints

