# System Design Overview — Marketing Dashboard (Flowrite)

## High-Level Architecture

Three runtime layers communicate as follows:

```
Browser (Next.js) ──→ Next.js API Routes (/api/ai/*, /api/angles/*, etc.)
       │
       └──→ FastAPI Backend (:8000) (/api/v1/*)
                    │
                    └──→ Firebase / Firestore (NoSQL)
```

---

## 1. Frontend — Next.js 16 (App Router)

Runs on `localhost:3000`. Built with TypeScript, Tailwind CSS, and Zustand for state.

**Two route groups:**
- `(auth)/` — Login and Register screens (Firebase Email/Password auth)
- `(app)/` — All authenticated app screens, route-guarded after Firebase sign-in

**The content creation pipeline is a linear workflow across these screens:**

| Screen | Route | Purpose |
|---|---|---|
| Ideas | `/ideas` | User inputs a topic, tone, audience, format. Ideas saved to Firestore. |
| Angles | `/angles` | AI generates multiple content angles for the idea. User selects one. |
| Storyboard | `/storyboard/[id]` | Full-length draft editor. AI chat, inline edits, persona rewrites, timeline rollback. |
| Adapt | `/adapt/[id]` | Multi-channel adaptation — AI rewrites draft per platform (LinkedIn, X, etc.). |
| Publish | `/publish` | One-click LinkedIn/X handoff, clipboard fallback, schedule picker, calendar. |

Supporting screens: Dashboard, Review, Analytics, Collaboration, Settings, Notifications.

**Next.js API routes** (under `src/app/api/`) handle all AI work directly in the frontend process — no FastAPI involved for AI:

| Route | Purpose |
|---|---|
| `/api/drafts/route.ts` | Draft generation |
| `/api/drafts/adapt` | Platform adaptation |
| `/api/drafts/chat` | Conversational AI editing |
| `/api/drafts/inline-edit` | Sentence-level inline proposals |
| `/api/drafts/personas` | Persona rewrites |
| `/api/drafts/rewrite` | Tone/readability rewrites |
| `/api/angles/route.ts` | AI angle generation |
| `/api/ideas/rationale` | Idea scoring rationale |
| `/api/company/autofill` | Scrape and extract company profile |

---

## 2. Backend — FastAPI (Python 3.10+)

Runs on `localhost:8000`. Handles **OAuth, provider credential storage, and integration management only** — not AI generation.

**Responsibilities:**
- LinkedIn OAuth start/callback flow
- Encrypted token storage (Fernet encryption via `encryption.py`)
- Per-provider connection status reads and disconnects
- Multi-provider registry (LinkedIn, X, Instagram, Facebook, WordPress, Ghost, Substack)

**Key routes (`/api/v1/`):**

| Route | Purpose |
|---|---|
| `POST /auth/linkedin/start` | Generate LinkedIn OAuth URL + store hashed state |
| `GET /auth/linkedin/callback` | Validate state, exchange code, persist tokens |
| `GET /integrations/providers` | List all supported providers |
| `GET /integrations/status` | All connection statuses for a user |
| `POST /integrations/{provider}/disconnect` | Disconnect a provider |

---

## 3. Database — Firebase / Firestore (NoSQL)

All data is **user-scoped** under `users/{uid}/`. No shared global collections for content.

**Firestore collection map:**

```
users/{uid}
  ├── companyContext (field on root doc — brand profile)
  ├── ideas/{ideaId}            — topic, tone, audience, format, scores
  │     └── workflow/angles    — angle generation state
  ├── drafts/{draftId}         — draft content, ideaId, angleId, status
  ├── adaptations/{id}         — per-platform adapted content
  ├── scheduledPosts/{id}      — publish reminders for calendar/notifications
  └── integrationConnections/{provider}  — browser-safe OAuth connection summary

integrationSecrets/{uid__provider}    — encrypted tokens (backend-only)
integrationAuthStates/{sha256(state)} — short-lived OAuth CSRF state
```

---

## 4. Authentication & Security

- **Client-side**: Firebase Auth (`signInWithEmailAndPassword`). The Firebase UID is the user identity everywhere.
- **Token encryption**: Fernet symmetric encryption (`ENCRYPTION_KEY` env var) for all OAuth provider secrets at rest.
- **OAuth CSRF safety**: State parameter stored server-side as a hashed document, consumed exactly once.
- **Firestore rules**: All user data is isolated under `users/{uid}/` — users can only read/write their own data.

---

## 5. AI Provider Abstraction

AI generation routes use a provider-agnostic abstraction (`lib/aiConfig.ts`, `lib/callAI.ts`) supporting:

- **Gemini** (Google)
- **OpenAI** (GPT models)
- **Claude** (Anthropic)
- **Ollama** (local)

The active provider is selected by environment config. All generation routes are in Next.js — the FastAPI backend does **not** call any AI APIs.

---

## 6. Data Flow Summary

```
User input (idea + topic)
  → Firestore: ideas/{ideaId}
  → /api/angles → AI generates angles
  → Firestore: ideas/{ideaId}/workflow/angles
  → /api/drafts → AI generates full draft
  → Firestore: drafts/{draftId}
  → /api/drafts/adapt → per-platform rewrite
  → Firestore: adaptations/{id}
  → /publish → clipboard/intent handoff or scheduled post
  → Firestore: scheduledPosts/{id}
```

---

## 7. Deployment

- **Frontend**: Firebase App Hosting / Amplify — CI injects `NEXT_PUBLIC_FIREBASE_*` secrets at build time via `amplify.yml`
- **Backend**: Any Python host (uvicorn)
- **Persistence**: Firestore is the only persistence layer — no SSR database
