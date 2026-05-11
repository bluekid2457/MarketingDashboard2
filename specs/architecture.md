# Architecture Specification

Canonical architecture overview for Marketing Dashboard 2 — what is implemented today, where the code lives, and how the layers fit together. Detailed contracts live in the layer-specific specs (see §10).

---

## 1. Overview

Marketing Dashboard 2 ("Flowrite") is an AI-assisted content marketing platform that takes a user from raw idea → AI-generated angles → long-form storyboard → per-platform adaptations → publish/schedule. The codebase splits into three runtime layers:

1. **Frontend** — Next.js 15 App Router on `localhost:3000`. Hosts every screen plus all AI provider proxy routes.
2. **Backend** — FastAPI on `localhost:8000`. Owns OAuth and encrypted token storage. Does **not** call AI providers.
3. **Data** — Firestore (NoSQL). User-scoped subtrees plus two backend-only top-level collections for OAuth secrets.

All AI generation happens inside the Next.js process. The FastAPI backend exists solely for the OAuth/integration layer that future direct publishing will sit on.

---

## 2. Runtime Layers

```
Browser ──HTTP──▶ Next.js (port 3000)
         │                │
         │                ├─▶ /api/angles, /api/drafts/*, /api/ideas/*,
         │                │   /api/trends, /api/company/autofill
         │                │   (server-side AI provider proxies)
         │                │
         │                └─▶ AI providers (OpenAI, Gemini, Claude, Ollama)
         │                    DuckDuckGo / Bing News (research, trends)
         │
         ├──HTTP──▶ FastAPI (local: port 8000 / prod: Lambda Function URL)
         │            │
         │            ├─▶ /api/v1/auth/linkedin/*    (OAuth)
         │            ├─▶ /api/v1/integrations/*    (status, tokens, disconnect)
         │            ├─▶ /api/v1/publish/linkedin/now    (sync direct publish)
         │            ├─▶ /api/v1/publish/schedule        (Pattern B — provision EventBridge + Firestore row)
         │            └─▶ /api/v1/publish/scheduled/run   (safety-net sweeper)
         │
         └──Firebase SDK──▶ Firestore
                              ├─ users/{uid}/** (client-readable subtree)
                              ├─ integrationSecrets/** (backend-only)
                              └─ integrationAuthStates/** (backend-only)

FastAPI ──Firebase Admin──▶ Firestore (writes secrets, reads/writes connection + schedule docs)

FastAPI ──boto3──▶ AWS EventBridge Scheduler (creates per-post one-shot schedules)
                       │
                       └─ at(scheduledForMs) ──▶ marketing-dashboard-scheduler Lambda
                                                        │
                                                        └─ publish_one(uid, scheduledPostId)
                                                              ├─ Firestore (CAS, finalize)
                                                              └─ LinkedIn UGC API
```

Key rules:
- **AI never runs in FastAPI; OAuth tokens never live outside FastAPI.** The two backends are deliberately disjoint.
- **Scheduled publishes fire via a per-post EventBridge schedule, not a polling cron.** The legacy sweeper at `POST /api/v1/publish/scheduled/run` is retained as a safety net and for local-dev manual ticks.

---

## 3. Frontend — Next.js 15 (App Router)

### 3.1 Stack
- **Framework:** Next.js 15.4.7 (App Router), React 18, TypeScript strict
- **Styling:** Tailwind CSS 3
- **State:** React component state and `localStorage`. Zustand is installed (`^4.5.2`) but no global store is currently in use.
- **Auth client:** Firebase Web SDK (`firebase: ^11.10.0`)
- **Process:** `npm run dev` → `next dev` on port 3000

### 3.2 Route groups
Routes live under `frontend/src/app/`.

```
src/app/
  page.tsx                    redirect → /landingPages/index.html
  (auth)/
    login/page.tsx
    register/page.tsx
  (app)/                      auth-guarded by layout.tsx
    dashboard/page.tsx
    ideas/page.tsx
    angles/page.tsx
    storyboard/page.tsx
    storyboard/new/page.tsx
    storyboard/[id]/page.tsx
    drafts/page.tsx           legacy alias for storyboard
    drafts/new/page.tsx
    drafts/[id]/page.tsx
    adapt/new/page.tsx
    adapt/[id]/page.tsx
    publish/page.tsx
    review/page.tsx
    analytics/page.tsx        placeholder surface
    collaboration/page.tsx    placeholder surface
    notifications/page.tsx
    settings/page.tsx
  api/                        Next.js Route Handlers (server-side)
    angles/route.ts
    angles/persist/route.ts
    angles/select/route.ts
    ideas/rationale/route.ts
    drafts/route.ts
    drafts/adapt/route.ts
    drafts/analyze/route.ts
    drafts/chat/route.ts
    drafts/headlines/route.ts
    drafts/inline-edit/route.ts
    drafts/personas/route.ts
    drafts/plagiarism/route.ts
    drafts/research/route.ts
    drafts/rewrite/route.ts
    drafts/similar-posts/route.ts
    trends/route.ts
    company/autofill/route.ts
```

The public landing page is **static HTML** at `frontend/public/landingPages/index.html` (plus `privacy.html`, `terms.html`). The Next.js root route (`/`) and `next.config.js` redirect to it.

### 3.3 Shared components
`frontend/src/components/`:
- `Nav.tsx`, `WorkflowStepper.tsx`, `DocumentContextHeader.tsx`, `Spinner.tsx`, `PlaceholderCard.tsx`, `ComingSoonBadge.tsx` — chrome
- `InlineEditPanel.tsx`, `DiffAwareEditor.tsx`, `AIEditTimeline.tsx`, `AIToolbox.tsx`, `DraftChatPanel.tsx`, `CitationHighlightPreview.tsx` — AI-editing surfaces

### 3.4 lib/
`frontend/src/lib/`:
- **AI provider abstraction:** `aiConfig.ts`, `callAI.ts`, `useInlineEdit.ts`, `adaptTimeout.ts`
- **Per-platform prompts:** `prompts/platforms/{linkedin,twitter,medium,newsletter,blog,index}.ts`
- **Firebase:** `firebase.ts` (client SDK), `firebaseServer.ts` (server-side reads in route handlers)
- **Domain helpers:** `companyProfile.ts`, `pipeline.ts`, `workflowContext.ts`, `orphans.ts`, `analytics.ts`, `sessionExpiry.ts`
- **Content tooling:** `aiEditHistory.ts`, `chatSpanDiff.ts`, `citationCheck.ts`, `draftResearch.ts`, `readability.ts`
- **External services:** `integrations.ts` (FastAPI client), `exaConfig.ts` (research provider key)

See [frontend.md](frontend.md) for per-route behavior and per-component responsibilities.

---

## 4. Backend — FastAPI

### 4.1 Stack
- **Framework:** FastAPI 0.111.0
- **Server:** Uvicorn 0.29.0
- **Language:** Python 3.10+
- **Validation/config:** Pydantic 2.7.1, pydantic-settings 2.2.1
- **HTTP:** httpx 0.27.0
- **Crypto:** cryptography 42.0.8 (Fernet)
- **Firestore:** firebase-admin 6.5.0
- **Process:** `uvicorn app.main:app --reload` on port 8000

### 4.2 Layout
```
backend/
  requirements.txt
  .env.example
  app/
    main.py                  app + CORS + /health + router registration
    config.py                pydantic-settings (Firebase, LinkedIn, encryption)
    routers/
      linkedin.py            POST /auth/linkedin/start, GET /auth/linkedin/callback
      integrations.py        provider registry, status, tokens, disconnect
    services/
      encryption.py          Fernet helper (key derived from ENCRYPTION_KEY)
      firebase_service.py    lazy Firebase Admin / Firestore initialization
      provider_registry.py   provider capability model
      integration_connection_service.py   reads/writes connection + secret docs
      linkedin_oauth_service.py           LinkedIn OAuth state, exchange, userinfo
```

All routers are mounted under `/api/v1`. CORS allows `FRONTEND_URL` plus `http://localhost:3000`.

### 4.3 Endpoint surface
- `GET /health`
- `POST /api/v1/auth/linkedin/start`
- `GET /api/v1/auth/linkedin/callback`
- `GET /api/v1/integrations/providers`
- `GET /api/v1/integrations/status?userId=…`
- `GET /api/v1/integrations/{provider}/status?userId=…`
- `POST /api/v1/integrations/{provider}/tokens`
- `POST /api/v1/integrations/{provider}/disconnect`

LinkedIn is the only provider with a complete OAuth flow today. The provider registry reserves slots for X/Twitter, Instagram, Facebook, WordPress, Ghost, Substack, and any of those can already store tokens via the manual `/tokens` endpoint.

See [backend.md](backend.md) for full request/response schemas.

---

## 5. Database — Firestore

All client-readable data lives under `users/{uid}/…`. Two top-level collections store backend-only secrets and are unreachable from the client.

### 5.1 User-scoped subtree
```
users/{uid}
  ├ companyContext (map field on the user doc — Company Profile)
  ├ ideas/{ideaId}
  │   └ workflow/angles
  ├ drafts/{ideaId_angleId}             storyboard content (deterministic id)
  ├ adaptations/{ideaId_angleId}        per-platform copy (deterministic id)
  ├ scheduledPosts/{auto}               publish reminders
  └ integrationConnections/{provider}   browser-safe OAuth summary (backend-written)
```

### 5.2 Backend-only collections
```
integrationSecrets/{uid__provider}      Fernet-encrypted access/refresh/id tokens
integrationAuthStates/{sha256(state)}   single-use OAuth state, CSRF-safe
```

### 5.3 Security rules
Currently deployed (`firestore.rules`):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

The two backend-only collections are intentionally **omitted** from the rules — there is no client-reachable rule for them, so they default-deny on the client and are accessible only via Firebase Admin (the FastAPI service account).

See [database.md](database.md) for per-collection field shapes, indexes, and orphan-filtering behavior.

---

## 6. AI Provider Abstraction

Every Next.js route handler under `src/app/api/` accepts a provider quartet `{ provider, apiKey, ollamaBaseUrl?, ollamaModel? }` plus an optional `companyContext: string[]`:

- **Providers:** OpenAI, Gemini, Claude, Ollama (local)
- **Selection:** picked per-request from the user's saved Settings (stored in `localStorage['ai_config']`)
- **Grounding:** `companyContext` is built by `companyProfileToContextLines()` in `lib/companyProfile.ts` from the saved Company Profile and is injected into every AI route except `/api/drafts/plagiarism`, `/api/angles/persist`, `/api/angles/select`, and `/api/trends`
- **Fallbacks:** routes return deterministic non-AI payloads when no key is configured (where it makes sense — angles, ideas/rationale, drafts/analyze)
- **Research grounding:** `/api/drafts` and `/api/drafts/research` issue DuckDuckGo searches; `/api/trends` aggregates Bing News RSS
- **External research key:** Exa is supported via `lib/exaConfig.ts` (optional, persisted in Settings)

Per-platform prompt rules live in `frontend/src/lib/prompts/platforms/{linkedin,twitter,medium,newsletter,blog}.ts`.

---

## 7. Auth & Security

- **User identity:** Firebase Email/Password sign-in. The Firebase UID is the user identifier across frontend, backend, and Firestore paths.
- **Route guard:** `frontend/src/app/(app)/layout.tsx` redirects unauthenticated users to `/login`.
- **API auth posture:** Most Next.js route handlers are public from the network's point of view but accept `userId` plus `x-user-id` / `x-firebase-uid` headers (see `/api/angles/persist`, `/api/angles/select`); FastAPI routes require an explicit `userId` body field. Backend-issued auth (verifying Firebase ID tokens server-side) is a documented follow-up hardening task.
- **OAuth CSRF:** `state` is generated server-side, hashed, stored in `integrationAuthStates/{sha256(state)}`, and consumed exactly once on callback.
- **Token-at-rest encryption:** Fernet, key derived from `ENCRYPTION_KEY`. Secrets live in `integrationSecrets/{uid__provider}` outside the user-readable tree.
- **CORS:** allow_origins = `FRONTEND_URL` + `http://localhost:3000`; credentials on; all methods/headers allowed.
- **Firestore isolation:** rules deny cross-user reads and writes of `users/{userId}/**`; backend-only collections have no client-reachable rule.

---

## 8. Data Flow Examples

### 8.1 Idea → Publish pipeline
```
User → /ideas (form submit)
  → setDoc users/{uid}/ideas/{ideaId}
  → POST /api/ideas/rationale  ── AI score + rationale
  → setDoc users/{uid}/ideas/{ideaId}     (relevance fields)

User → /angles?ideaId=…
  → POST /api/angles            ── 3-card AI generation
  → POST /api/angles/persist    ── transactional write
  → setDoc users/{uid}/ideas/{ideaId}/workflow/angles
  → POST /api/angles/select     ── finalize one, archive rest

User → /storyboard/{ideaId}?angleId=…
  → POST /api/drafts            ── DuckDuckGo-grounded long-form draft
  → setDoc users/{uid}/drafts/{ideaId_angleId}
  → POST /api/drafts/inline-edit, /chat, /rewrite, /personas, … (iterate)

User → /adapt/{ideaId}?angleId=…
  → POST /api/drafts/adapt      ── per-platform copy
  → setDoc users/{uid}/adaptations/{ideaId_angleId}

User → /publish
  → setDoc users/{uid}/scheduledPosts/{auto}        (schedule reminder)
  → clipboard copy + window.open(compose URL)        (manual handoff)
```

### 8.2 LinkedIn OAuth (backend)
```
Browser → POST /api/v1/auth/linkedin/start { userId }
  → backend generates state, hashes → integrationAuthStates/{sha256(state)}
  → returns LinkedIn authorize URL

Browser → LinkedIn → GET /api/v1/auth/linkedin/callback?code=…&state=…
  → backend validates + consumes state
  → exchanges code for tokens
  → calls https://api.linkedin.com/v2/userinfo
  → setDoc users/{uid}/integrationConnections/linkedin   (public summary)
  → setDoc integrationSecrets/{uid__linkedin}           (Fernet-encrypted)
  → 302 → /settings?integration=linkedin&status=connected
```

### 8.3 Schedule + publish loop (Pattern B — one-shot EventBridge)
```
User → /publish (Schedule button, LinkedIn card)
  → scheduleLinkedInPost() in src/lib/publish.ts
  → POST /api/v1/publish/schedule  (Firebase ID token in Authorization)
       ├─ verify_firebase_id_token + uid == body.userId
       ├─ scheduledForMs > now + 60s (422 scheduled_too_soon otherwise)
       ├─ contentSnapshot.linkedin non-empty (422 missing_linkedin_snapshot otherwise)
       ├─ eventbridge_scheduler.create_one_shot_schedule(...) [no-op in local dev]
       └─ setDoc users/{uid}/scheduledPosts/{auto} { …, eventBridgeScheduleName }
  ← { success: true, scheduledPostId, eventBridgeScheduleName }

EventBridge Scheduler (at scheduledForMs UTC)
  → invokes marketing-dashboard-scheduler Lambda with {"scheduledPostId","userId"}
  → app.lambda_scheduler.handler
       → publish_one(uid, scheduledPostId)
             ├─ CAS row scheduled → publishing
             ├─ linkedin_publisher.publish_linkedin_text(...)
             └─ finalize: published / failed (failureReason, attemptCount += 1)
  → ActionAfterCompletion="DELETE" auto-removes the schedule

Safety net: POST /api/v1/publish/scheduled/run (cron / manual via npm run scheduler:tick)
  → sweeps zombie `publishing` rows older than 10 min back to `scheduled`
  → per-row dispatch via the same publish_one worker as the Lambda

Non-LinkedIn platforms still write users/{uid}/scheduledPosts/{auto} directly via the
Firebase Web SDK on /publish and rely on the legacy reminder + handoff path.

/notifications page → setInterval(60s)
  → reads users/{uid}/scheduledPosts ordered by scheduledForMs
  → buckets into dueNow / upcomingSoon / missed using the wall clock
```

Direct publish (`POST /api/v1/publish/linkedin/now`) is the synchronous LinkedIn path — distinct from the schedule path — and is unchanged by Pattern B.

---

## 9. Deployment

- **Frontend:** AWS Amplify (`amplify.yml`). The build step injects the six required `NEXT_PUBLIC_FIREBASE_*` env vars into a generated `.env.local` before `npm run build` runs.
- **Backend (local dev):** uvicorn on port 8000 — `cd backend && uvicorn app.main:app --reload`.
- **Backend (deployed):** **two AWS Lambda functions** from one container image (`backend/Dockerfile.lambda`, `public.ecr.aws/lambda/python:3.11`, arm64):
  - `marketing-dashboard-http` — `CMD: ["app.main.handler"]`. The FastAPI app wrapped by `mangum.Mangum(app, lifespan="off")` and exported as `handler`. Fronted by a **Lambda Function URL** (auth: `NONE`; CORS still enforced by FastAPI). `NEXT_PUBLIC_API_URL` in the Amplify build env points at this URL.
  - `marketing-dashboard-scheduler` — `CMD: ["app.lambda_scheduler.handler"]`. Triggered directly by EventBridge Scheduler (no HTTP wrapper). Invoked once per scheduled post with `{"scheduledPostId","userId"}`.
- **Schedule provisioning:** AWS EventBridge Scheduler. One schedule per scheduled LinkedIn post (`publish-<scheduledPostId>`), `ScheduleExpression=at(<UTC>)`, `ActionAfterCompletion="DELETE"`, `MaximumRetryAttempts=0`. Schedule group defaults to `default` (override via `EVENTBRIDGE_SCHEDULE_GROUP_NAME`). An IAM role (`EVENTBRIDGE_INVOKER_ROLE_ARN`) grants EventBridge `lambda:InvokeFunction` on the scheduler Lambda.
- **Secrets management:** **AWS Secrets Manager**. One JSON secret holds `FIREBASE_SERVICE_ACCOUNT_JSON`, `ENCRYPTION_KEY`, `LINKEDIN_CLIENT_SECRET`, `SCHEDULER_SECRET`, etc. Both Lambdas read `SECRETS_MANAGER_SECRET_ID` at cold start; `secrets_loader.load_secrets_into_env()` hydrates the secret's keys into `os.environ` BEFORE `Settings()` is instantiated. Explicit env vars win over Secrets Manager.
- **No IaC committed.** EventBridge / Lambda / IAM / Secrets Manager provisioning is done manually via the AWS console + CLI today. Terraform / CDK / SAM is a documented follow-up.
- **Local-dev fallback:** `SCHEDULER_LAMBDA_ARN` and `EVENTBRIDGE_INVOKER_ROLE_ARN` unset → `eventbridge_scheduler` no-ops with a log line. `POST /api/v1/publish/schedule` still 200s and writes the Firestore row with `eventBridgeScheduleName: null`. The legacy sweeper / `npm run scheduler:tick` continues to fire the row.
- **Persistence:** Firestore is the only persistence layer. There is no SSR database or relational store.
- **GitHub Actions:** `.github/workflows/pr-version-bump.yml` runs on PR open/reopen for non-fork branches and bumps `frontend/package.json` patch version on the PR branch (see [automation.md](automation.md) §3.4).

---

## 10. Cross-References

| Layer | Spec |
|---|---|
| FastAPI behavior, env vars, security | [backend.md](backend.md) |
| Next.js routes, screens, components, AI route contracts | [frontend.md](frontend.md) |
| Firestore collections, rules, integrity | [database.md](database.md) |
| Scheduling, publishing handoff, OAuth scaffolding | [automation.md](automation.md) |
| Screen-by-screen UX reference and DONE/PARTIAL/PLACEHOLDER status | [screens.md](screens.md) |

For the agent and workflow system, see `AGENTS.md` at the repo root.
