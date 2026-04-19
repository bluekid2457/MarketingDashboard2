# Frontend Specification

This document defines the requirements, architecture, and key behaviors for the Marketing Dashboard frontend (Next.js 16, TypeScript, Zustand, Tailwind CSS).

## TODO Tracker

This table centralizes the current frontend `(TODO)` items for quick planning and orchestration. The inline `(TODO)` markers throughout the document remain in place for section-level convenience.

| Area | Section | Status |
|---|---|---|
| Login & Authentication | Forgot password link (UI placeholder) | TODO |
| Dashboard | Content Calendar | TODO |
| Dashboard | Idea Backlog Summary | TODO |
| Dashboard | Drafts / Review Queue | TODO |
| Dashboard | Recent Analytics | TODO |
| Dashboard | Quick Links | TODO |
| Multi-Channel Adaptation | Platform Selector | DONE |
| Multi-Channel Adaptation | Generate by Platform (AI) | DONE |
| Multi-Channel Adaptation | Preview Per Format | DONE |
| Multi-Channel Adaptation | AI Chat for Editing | DONE |
| Publishing & Scheduling | Platform Connection Status | TODO |
| Publishing & Scheduling | Schedule Picker / Calendar | TODO |
| Publishing & Scheduling | Draft Mode Toggle | TODO |
| Publishing & Scheduling | Visual Content Calendar | TODO |
| Publishing & Scheduling | Gap Detection Alerts | TODO |
| Publishing & Scheduling | Submit to Search Engines | TODO |
| Review & Approval Workflow | Draft Queue | DONE |
| Review & Approval Workflow | Inline Editor | TODO |
| Review & Approval Workflow | Version History | TODO |
| Review & Approval Workflow | Approval Chain Controls | TODO |
| Review & Approval Workflow | Comment / Suggestion Layer | TODO |
| Review & Approval Workflow | Role-Based Access | TODO |
| Analytics & Performance | Engagement Charts | TODO |
| Analytics & Performance | Performance History | TODO |
| Analytics & Performance | Predictive Scoring | TODO |
| Analytics & Performance | Copy Intelligence Insights | TODO |
| Analytics & Performance | AI Visibility Tracking | TODO |
| Collaboration & Client Management | Invite / Manage Users | TODO |
| Collaboration & Client Management | Role-Based Access | TODO |
| Collaboration & Client Management | Client Brief Forms | TODO |
| Collaboration & Client Management | Project Calendars | TODO |
| Collaboration & Client Management | White-Label Toggles | TODO |
| Settings & Compliance | Brand Voice Editor | TODO |
| Settings & Compliance | Compliance Flags | TODO |
| Settings & Compliance | Audit Log Viewer | TODO |
| Settings & Compliance | Integration Connectors | TODO |
| Error & Notifications | Error Messages | TODO |
| Error & Notifications | Success / Warning Notifications | TODO |
| Error & Notifications | System Alerts | TODO |
| API Integration | `/api/v1/*` proxy to FastAPI backend | TODO |

---

## Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v3
- **State Management**: Zustand v4
- **Authentication**: Firebase Auth (Email/Password)
- **Linting**: ESLint (`next/core-web-vitals`)
- **Formatting**: Prettier

---

## Folder Structure

```
frontend/
  package.json              # dependencies + npm scripts
  tsconfig.json             # strict TypeScript + path aliases (@/*)
  tailwind.config.ts        # content: ./src/**/*.{ts,tsx}
  postcss.config.js         # tailwindcss + autoprefixer
  src/
    app/
      layout.tsx            # Root layout: metadata, globals.css, Manrope-first font stack on <body>
      page.tsx              # Redirects / → /dashboard
      globals.css           # Tailwind + design tokens + shared component utility classes
      api/
        angles/
          route.ts          # Provider-agnostic AI angle generation/refinement endpoint (OpenAI/Gemini/Claude/Ollama)
        drafts/
          route.ts          # Provider-agnostic robust draft generation endpoint from selected idea + angle
          adapt/
            route.ts        # Provider-agnostic platform adaptation endpoint using prompt templates + draft context
        trends/
          route.ts          # Public news feed aggregation for live ideas-page trends/articles
      (auth)/
        login/
          page.tsx          # Screen 1 — Login & Authentication
        register/
          page.tsx          # Account registration (Email/Password)
      (app)/
        layout.tsx          # Responsive app shell: fixed mobile header + desktop sidebar + padded content area
        dashboard/
          page.tsx          # Screen 2 — Dashboard overview
        ideas/
          page.tsx          # Screen 3 — Idea Input & Backlog
        angles/
          page.tsx          # Screen 4 — AI Angle Selection & Outline
        drafts/
          [id]/
            page.tsx        # Screen 5 — Draft Editor (dynamic [id])
        adapt/
          [id]/
            page.tsx        # Screen 6 — Multi-Channel Adaptation (dynamic [id])
        publish/
          page.tsx          # Screen 7 — Publishing & Scheduling
        review/
          page.tsx          # Screen 8 — Review & Approval Workflow
        analytics/
          page.tsx          # Screen 9 — Analytics & Performance
        collaboration/
          page.tsx          # Screen 10 — Collaboration & Client Management
        settings/
          page.tsx          # Screen 11 — Settings & Compliance
        notifications/
          page.tsx          # Screen 12 — Error & Notifications
    components/
      Nav.tsx               # Sidebar navigation component (all 11 nav links)
    lib/                    # Utility helpers
      aiConfig.ts           # LocalStorage-backed AI provider config + active provider/key resolver used by angles generation
      analytics.ts          # Safe auth analytics event emitter (no-op when analytics SDK is absent)
      firebase.ts           # Browser-only Firebase Web SDK initialization + lazy auth and Firestore getters
      prompts/
        platforms/
          index.ts          # Platform prompt resolver + platform key guard
          linkedin.ts       # LinkedIn adaptation prompt rules
          twitter.ts        # X/Twitter adaptation prompt rules
          medium.ts         # Medium adaptation prompt rules
          newsletter.ts     # Newsletter adaptation prompt rules
          blog.ts           # Blog adaptation prompt rules
    store/                  # Zustand stores
```

---

## npm Scripts

| Script           | Command           |
|------------------|-------------------|
| `npm run dev`    | `next dev`        |
| `npm run build`  | `next build`      |
| `npm run start`  | `next start`      |
| `npm run lint`   | `next lint`       |

---

## Routing

### Root redirect
- `src/app/page.tsx` — calls `redirect('/dashboard')` from `next/navigation`; sends all root visits to the dashboard entry route.
- Access control is enforced by the `(app)` layout guard. Unauthenticated visits are redirected from `/dashboard` to `/login`.

### Route groups
- **`(auth)`** — unauthenticated routes (no Nav sidebar). Currently contains `/login`.
- **`(auth)`** login route checks Firebase auth state and redirects authenticated users to `/dashboard`.
- **`(app)`** — authenticated routes wrapped by `AppLayout` which renders `<Nav />` + `<main>` only after Firebase auth verification.

---

## Shared Components

### `src/components/Nav.tsx`
- `'use client'` directive (uses `usePathname`).
- Mobile: fixed top header with horizontal pill navigation and alerts shortcut.
- Desktop: fixed left sidebar (`w-72`) with branded hero panel, nav list, and weekly target panel.
- 11 nav links with emoji icons; active link uses teal treatment (`border-teal-300 bg-teal-50 text-teal-900` desktop, filled pill on mobile).
- Active detection: exact match on `pathname` or `pathname.startsWith(base)` (strips `/new` suffix for dynamic links like `/drafts/new`).

### `src/app/(app)/layout.tsx` — AppLayout
- Client-side auth guard with `onAuthStateChanged`.
- While auth state is resolving, shows a spinner + label loading state (`Checking your session...`).
- If unauthenticated, redirects to `/login`.
- If authenticated, renders `<Nav />` + responsive `<main>` (`pt-20` mobile for fixed header; `lg:ml-72` for desktop sidebar offset).
- Wraps all 11 authenticated screens.

### `src/app/globals.css`
- Defines non-purple design tokens and atmospheric background layers (`radial-gradient` + `linear-gradient`).
- Adds reusable UI utility classes used by all redesigned screens:
  - `.surface-card`
  - `.section-title`
  - `.muted-copy`
  - `.pill`
  - `.hero-metric`

---

## Screens

Note: `(TODO)` marks features that are currently not functional and still need implementation.

### Screen 1 — Login & Authentication (`/login`)
**Route:** `src/app/(auth)/login/page.tsx`
**Layout Notes:** 2-column auth split on desktop (marketing panel + auth form), single-column form on mobile.
**Sections:**
1. Email + password sign-in form
2. Client-side validation: email required, valid email format, password required
3. Submit loading state with spinner labels and duplicate-submit prevention
4. Inline user-safe auth error banner
5. Firebase Email/Password `signInWithEmailAndPassword` authentication
6. Auth-state redirect: already signed-in users are sent to `/dashboard`
7. Analytics events emitted on sign-in lifecycle (`login_attempt`, `login_success`, `login_failure`)
8. OAuth provider buttons (Google + LinkedIn)
9. Forgot password link (UI placeholder) (TODO)
10. Create account link to `/register`

### Registration — Create Account (`/register`)
**Route:** `src/app/(auth)/register/page.tsx`
**Sections:**
1. Email/password registration form with confirm password
2. Client-side validation and submission loading state
3. Auth-check and submit loading states render spinner indicators with labels
4. Firebase Email/Password `createUserWithEmailAndPassword`
5. Auth-state redirect (signed-in users route to `/dashboard`)
6. Inline user-safe error banner

---

## Authentication Flow

- Firebase client config is read from `NEXT_PUBLIC_FIREBASE_*` environment variables in `src/lib/firebase.ts`.
- Firebase auth is initialized lazily in the browser (`getFirebaseAuth`) to avoid server prerender failures.
- Login submit flow:
  1. Validate email/password inputs.
  2. Emit `login_attempt`.
  3. Call Firebase Auth `signInWithEmailAndPassword`.
  4. On success, emit `login_success` and redirect to `/dashboard`.
  5. On failure, emit `login_failure` and display a user-safe inline message.
- LinkedIn sign-in flow:
  1. User clicks "Sign in with LinkedIn" on login.
  2. App uses Firebase `OAuthProvider('linkedin.com')` with `signInWithPopup`.
  3. On success, app redirects to `/dashboard`; on failure, app shows a safe error message.
- Registration submit flow:
  1. Validate email, password, and confirm password.
  2. Emit registration analytics events through `trackAuthEvent`.
  3. Call Firebase Auth `createUserWithEmailAndPassword`.
  4. On success, redirect to `/dashboard`; on failure, show inline error.
- Passwords are only read in-memory by controlled React inputs and never written to local/session storage by this implementation.
- `src/lib/analytics.ts` safely no-ops when no analytics provider is present on `window`.
- If Firebase env vars are missing, login shows an inline configuration error and protected app routes redirect to `/login`.

---

### Screen 2 — Dashboard (`/dashboard`)
**Route:** `src/app/(app)/dashboard/page.tsx`
**Layout Notes:** Hero with KPI metrics, then responsive grid for calendar, backlog, queue, analytics, and quick links.
**Sections:**
1. Content Calendar (TODO)
2. Idea Backlog Summary (TODO)
3. Drafts / Review Queue (TODO)
4. Recent Analytics (TODO)
5. Quick Links (TODO)

---

### Screen 3 — Idea Input & Backlog (`/ideas`)
**Route:** `src/app/(app)/ideas/page.tsx`
**Layout Notes:** Header summary + Firestore-backed form and backlog table on the left, live trends/articles sidebar on the right.
**Sections:**
1. New Idea form with textarea + tone/audience/format selectors
2. Client-side validation, submit loading state, and inline save success/error states
3. Firestore list-load and add-doc save waits render spinner indicators
4. Firestore-backed ideas table scoped to the signed-in user
5. Functional sort and filter controls (sort by newest/oldest/topic, filter by tone and format)
6. Selected-idea summary card derived from persisted Firestore data
7. "Generate Angles" CTA in Selected Idea card routes to `/angles?ideaId=<ideaDocId>`
8. Live trend snapshot and right-hand articles panel sourced from `/api/trends`

---

### Screen 4 — AI Angle Selection & Outline (`/angles`)
**Route:** `src/app/(app)/angles/page.tsx`
**Layout Notes:** Query-driven selected-idea header + AI-generated angle carousel + refinement chat + action bar + live trends panel.
**Sections:**
1. Resolves `ideaId` from query string; fast-path: reads `localStorage['angles_idea_context']` (written by Ideas page on navigation) and hydrates idea state immediately if `ideaId` matches, avoiding Firestore-blocked loading states. Firestore `users/{uid}/ideas/{ideaId}` is still fetched in the background to keep data fresh.
2. Guide/empty state when no `ideaId` is present, with CTA back to `/ideas`
3. Auto-generates multiple real angles through `POST /api/angles` using `getActiveAIKey()` (provider + key/config from settings)
4. Functional card carousel with previous/next navigation and radio-based angle selection
5. Unlockable detailed editor per angle with inline editing for title, summary, and section points (including add/remove point actions)
6. "Refine with AI Chat" sends prompt for selected angle, updates angle content, and appends local chat history
7. "Retry AI Generation" regenerates angles for current idea
8. "Proceed to Draft Generation" routes to `/drafts/<ideaId>?angleId=<selectedAngleId>` and stores draft handoff context (idea + selected angle) in `localStorage['draft_generation_context']`
9. Live trend snapshot + right panel backed by `/api/trends` with loading/error states
10. Selected-idea Firebase load state displays a spinner + label while Firestore refresh is pending

Ideas page (Screen 3) handoff:
- When "Generate Angles" is clicked, the selected idea's full data (`{ ideaId, topic, tone, audience, format, createdAtMs }`) is written to `localStorage['angles_idea_context']` before `router.push('/angles?ideaId=...')` so the Angles page can render instantly without waiting for Firestore.

Implementation note:
- `src/lib/aiConfig.ts` exposes `getActiveAIKey()` and returns `{ provider, apiKey, ollamaBaseUrl, ollamaModel }` from persisted user settings; this utility is required by `/angles` generation/refinement flows and includes debug logging for provider/key presence.

---

### Screen 5 — Draft Editor (`/drafts/[id]`)
**Route:** `src/app/(app)/drafts/[id]/page.tsx`
**Pattern:** Client component using `useParams()` and query `angleId` to resolve draft context generated in Angles.
**Layout Notes:** Two-column layout (editor + collapsible AI chat panel) with a full-width Content Analysis section below.
**Sections:**
1. Loads draft handoff context from `localStorage['draft_generation_context']` and validates `ideaId` / `angleId`
2. On mount checks Firestore `users/{uid}/drafts/{ideaId}_{angleId}` for a saved draft; loads it if found (skips AI generation)
3. If no saved draft exists, auto-calls `POST /api/drafts` to generate one from the selected angle
4. Auto-saves to Firestore 2 s after each keystroke (debounced); save status shown in header ("Saving…" / "✓ Saved at HH:MM")
5. Firestore existing-draft read and save states show spinner indicators in the editor/status controls
6. Manual "Save Draft" button triggers an immediate Firestore write; Firestore doc schema: `{ content, ideaId, angleId, ideaTopic, angleTitle, status: 'draft', createdAt, updatedAt }`
7. Word count pill in the editor toolbar; "↺ Regenerate" and "🤖 AI Chat" toggle buttons
8. **AI Chat Panel** (toggle, `POST /api/drafts/chat`): conversational assistant with full draft context; AI returns edits wrapped in `<UPDATED_DRAFT>` tags; banner offers "Apply Changes" / "Discard"; chat history in component state
9. Action buttons: Save Draft, **🎯 Adapt for Platforms**, Submit for Review, Schedule Post. The Adapt action is disabled until a draft exists, writes `localStorage['adapt_draft_context'] = { ideaId, angleId, idea, selectedAngle, draftContent }`, and routes to `/adapt/<ideaId>?angleId=<angleId>`.
10. **Content Analysis section** — three analysis buttons (each calls `POST /api/drafts/analyze`):
   - **📈 SEO Optimizer** (`type=seo`): primaryKeyword, secondaryKeywords, keywordDensity, readabilityScore, readabilityGrade, metaDescription, titleSuggestions, optimizationTips, similarArticleTopics (SEO coverage gaps), wordCount
   - **🔍 Plagiarism / AI Check** (`type=plagiarism`): aiLikelihoodScore (0–100), aiLikelihoodLabel, flaggedPhrases[], humanizationTips[], originality, verdict
   - **🔗 Source Check** (`type=sources`): claims[] (claim + needsCitation + suggestedSearchQuery), relevanceScore, relevanceSummary, urlsFound[], recommendations[]
11. Breadcrumb sequence includes the next workflow step, `Multi-Channel Adaptation`, between SEO/Readability and Review.
12. AI chat sample prompts and analysis quote callouts render escaped quotation entities in JSX so the visible helper copy stays unchanged while frontend linting remains clean.

---

### Screen 6 — Multi-Channel Adaptation (`/adapt/[id]`)
**Route:** `src/app/(app)/adapt/[id]/page.tsx`
**Pattern:** Client component using `useParams()` plus query `angleId` to resolve the draft-to-adapt handoff.
**Layout Notes:** Three-column workspace with AI chat on the left, per-platform editor in the center, and preview + optimization tools on the right, plus a live trends sidebar.
**Sections:**
1. Loads and validates `localStorage['adapt_draft_context']` written by the Draft Editor; missing, invalid, or route-mismatched context renders an error state with a CTA back to the Draft Editor route.
2. Uses Firestore `users/{uid}/adaptations/{ideaId}_{angleId}` to load previously saved adaptation state for the signed-in user and merge saved platform copy over the draft-seeded defaults.
3. Seeds `linkedin`, `twitter`, `medium`, `newsletter`, and `blog` platform editors from the current draft content when no adaptation doc exists yet.
4. Platform tab buttons are fully stateful; clicking a tab changes the active platform and swaps the center editor/preview to that platform only. The optimization panel remembers the last selected analysis per platform, so revisiting a platform shows its previously generated result panel again, while platforms with no completed analysis still render the empty/instruction state.
5. Editing updates only the currently active platform text. The textarea is disabled (`disabled={isAdaptationLoading}`) while the Firestore adaptation document is still being fetched, preventing any user input from being silently overwritten by the async load.
6. Each active platform exposes an explicit `Generate <Platform>` button that calls `POST /api/drafts/adapt` using the original draft source (`adapt_draft_context.draftContent`) plus platform-specific prompt rules; the API route aborts provider calls after 45 seconds and returns HTTP 504 with a timeout-specific error, while the client keeps a slightly longer local `AbortController` guard (~47 seconds) so the normal slow-provider path still surfaces the server timeout response first. Hung requests still clear the generating spinner, timeout/failure feedback is shown inline near the editor controls, and healthy providers still replace the active platform copy with the returned AI output.
7. Platform text plus `activePlatform` auto-save to Firestore with a 1.5 s debounce; visible save status appears in the page header, and the "Save as Draft" action triggers an immediate Firestore write.
8. AI chat calls `POST /api/drafts/chat` with the active platform text as `draft`, stores conversation history per platform, and only applies `<UPDATED_DRAFT>` suggestions back into the currently active platform.
9. Optimization tools call `POST /api/drafts/analyze` against the active platform text and render visible result panels for:
   - `📈 SEO Optimizer`
   - `🔍 AI Check` (backed by `type='plagiarism'`)
   - `🔗 Source Check`
   When a configured non-Ollama AI key exists, the route keeps using the existing AI-backed prompt/call/parse flow. When the active provider is non-Ollama and no key is configured, the route returns deterministic, schema-compatible fallback outputs per tool based on the currently active platform copy instead of surfacing a shared missing-key failure.
10. Preview card renders the active platform copy and a per-platform word-count snapshot, with no hardcoded demo content.
11. Right-hand trends sidebar consumes live `/api/trends` data and shows truthful loading, error, or empty states instead of placeholder topics/articles.
12. Breadcrumb marks `Multi-Channel Adaptation` as the active workflow step; review/schedule action placeholders remain present but unchanged.
13. The per-platform chat history slice used by the chat send callback is memoized from `chatHistoryByPlatform[activePlatform]` so hook dependency tracking stays stable without changing chat behavior.

---

### Screen 7 — Publishing & Scheduling (`/publish`)
**Route:** `src/app/(app)/publish/page.tsx`
**Layout Notes:** Platform status cards + schedule/calendar pane + control pane for mode/gaps/submit.
**Sections:**
1. Platform Connection Status (TODO)
2. Schedule Picker / Calendar (TODO)
3. Draft Mode Toggle (TODO)
4. Visual Content Calendar (TODO)
5. Gap Detection Alerts (TODO)
6. Submit to Search Engines (TODO)

---

### Screen 8 — Review & Approval Workflow (`/review`)
**Route:** `src/app/(app)/review/page.tsx`
**Layout Notes:** Queue and editor area with side stack for workflow controls.
**Sections:**
1. Draft Queue (Firestore-backed `users/{uid}/drafts` list, sorted by `updatedAt` desc; each row opens `/drafts/<ideaId>?angleId=<angleId>`)
2. Inline Editor (TODO)
3. Version History (TODO)
4. Approval Chain Controls (TODO)
5. Comment / Suggestion Layer (TODO)
6. Role-Based Access (TODO)

Draft Queue behavior details:
- No static/demo queue rows are rendered.
- If there are no draft documents for the current user, the page shows a truthful empty state message.

---

### Screen 9 — Analytics & Performance (`/analytics`)
**Route:** `src/app/(app)/analytics/page.tsx`
**Layout Notes:** Multi-card analytics grid with chart placeholders and insights panels.
**Sections:**
1. Engagement Charts (TODO)
2. Performance History (TODO)
3. Predictive Scoring (TODO)
4. Copy Intelligence Insights (TODO)
5. AI Visibility Tracking (TODO)

---

### Screen 10 — Collaboration & Client Management (`/collaboration`)
**Route:** `src/app/(app)/collaboration/page.tsx`
**Layout Notes:** Two-column responsive card matrix with dedicated white-label section.
**Sections:**
1. Invite / Manage Users (TODO)
2. Role-Based Access (TODO)
3. Client Brief Forms (TODO)
4. Project Calendars (TODO)
5. White-Label Toggles (TODO)

---

### Screen 11 — Settings & Compliance (`/settings`)
**Route:** `src/app/(app)/settings/page.tsx`
**Layout Notes:** Two-column compliance/settings cards with full-width security section.
**Sections:**
1. Brand Voice Editor (TODO)
2. Compliance Flags (TODO)
3. Audit Log Viewer (TODO)
4. Integration Connectors (TODO)
5. Security Settings
6. **AI API Keys** (`lg:col-span-2`) — select active provider (OpenAI / Gemini / Claude / Local Ollama); provider key inputs plus Ollama base URL and model; Save button calls `saveAIConfig` and shows "Saved!" toast; config loaded via `useEffect` from `loadAIConfig()` in `src/lib/aiConfig.ts`
7. Sign out action (Firebase `signOut`) from the Session section with spinner feedback while logout is in progress

**AI Config Library:** `src/lib/aiConfig.ts`
- `AIProvider = 'openai' | 'gemini' | 'claude' | 'ollama'`
- `AIConfig = { provider, openaiKey, geminiKey, claudeKey, ollamaBaseUrl, ollamaModel }`
- `saveAIConfig(config)` — persists to `localStorage['ai_config']`
- `loadAIConfig()` — reads from localStorage, returns defaults on missing/error
- `getActiveAIKey()` — returns `{ provider, apiKey }` for the current active provider

---

### Screen 12 — Error & Notifications (`/notifications`)
**Route:** `src/app/(app)/notifications/page.tsx`
**Layout Notes:** Alert severity cards using color-coded surfaces (error, warning, system).
**Sections:**
1. Error Messages (TODO)
2. Success / Warning Notifications (TODO)
3. System Alerts (TODO)

---
TEST_MARKER

## Dynamic Routes

- `src/app/(app)/drafts/[id]/page.tsx` is a client component that resolves the route segment with `useParams()` and reads `angleId` from `useSearchParams()`.
- `src/app/(app)/adapt/[id]/page.tsx` is a client component that also resolves `ideaId` with `useParams()` and validates the paired `angleId` query string before loading adaptation context.

---

## API Integration

- `/api/trends` is a Next.js route handler that fetches public Bing News RSS feeds for marketing/AI/SEO queries, extracts direct publisher URLs from the feed redirect links, deduplicates the results, and returns live topics + clickable article links for the ideas page.
- `/api/angles` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, idea, count, selectedAngleId?, refinementPrompt? }`, calls OpenAI (`gpt-4o-mini`), Gemini (tries `gemini-2.0-flash`, then `gemini-2.0-flash-lite`, then `gemini-1.5-flash-latest`), Claude (`claude-3-5-haiku-latest`), or local Ollama (`/api/generate`), robustly parses JSON output (including fenced JSON fallback), validates angle schema, and returns structured `angles[]` or typed errors.
- `/api/angles` degrades gracefully: when provider calls fail or model output cannot be parsed, the route returns deterministic fallback angles (HTTP 200) with an `error` message describing the provider failure, so the UI does not hard-fail with a 502.
- In `src/app/api/angles/route.ts`, Ollama calls are routed through `fetchOllama(apiKey, prompt, baseUrl, model)`; both `baseUrl` and `model` are required in the helper signature to keep request logging, validation, and request construction type-safe.
- `/api/drafts` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, idea, angle }`, builds a long-form draft prompt from selected idea + angle outline, calls the configured AI provider, and returns `{ draft, provider, promptUsed?, modelText? }` where optional debug fields mirror the final prompt and model output for client-side visibility.
- `/api/drafts/adapt` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, platform, sourceDraft, currentPlatformDraft? }`, resolves platform-specific prompt rules from `src/lib/prompts/platforms/*`, calls the configured AI provider, aborts the provider request after 45 seconds, and normalizes abort-like runtime error shapes back into the timeout response path so client-visible timeouts consistently return a JSON error with HTTP 504 instead of a generic HTTP 502 provider failure. Successful calls still return `{ platform, generatedContent, provider }`, and the route does not emit fallback/dummy adaptation text when AI generation fails.
- `/api/drafts/chat` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, messages[], userMessage }`, sends the full draft + chat history as context to the AI, logs the assembled prompt plus raw provider response to the server console, and returns `{ reply, updatedDraft | null, provider }`. The AI wraps full draft rewrites in `<UPDATED_DRAFT>…</UPDATED_DRAFT>` tags which the route parses and returns separately from the conversational reply.
- `/api/drafts/analyze` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, type: 'seo' | 'plagiarism' | 'sources' }`, runs type-specific analysis prompts, logs the prompt and raw provider response to the server console, robustly parses the AI's JSON response (code-fence fallback included), and returns `{ type, result, provider }`. For non-Ollama providers without an API key, the route returns deterministic per-tool fallback analysis derived from the submitted draft text while preserving the same response schema expected by the Adapt page UI.
- `/api/v1/*` proxy to FastAPI backend (to be implemented) (TODO)
- All API base URLs stored in `process.env.NEXT_PUBLIC_API_URL`

### Debugging & Monitoring

**Console Debugging Statements:**
All modules include comprehensive logging (`console.log()`, `console.debug()`, and `console.error()`) to track execution flow:

- **Firebase (`src/lib/firebase.ts`)**: Logs app/auth/Firestore initialization, caching, and configuration status
- **AI Config (`src/lib/aiConfig.ts`)**: Logs configuration load/save operations and active provider selection
- **Angles API (`src/app/api/angles/route.ts`)**: 
  - Logs POST request validation and parameters (provider, model, idea content, count)
  - Logs the fully built prompt with `console.log()` before dispatching the provider request
  - Logs model selection (OpenAI/Gemini/Claude/Ollama) and API call attempts
  - Logs Ollama call context (`baseUrl`, `model`, `promptLength`) before issuing `/api/generate`
  - Logs the full raw provider response text with `console.log()` in the server console after each AI call returns
  - Returns `promptUsed` and `modelText` in the response payload for client-side debugging visibility
  - Logs parsed angles count and titles
  - Logs final response preparation
- **Angles Page (`src/app/(app)/angles/page.tsx`)**:
  - Logs returned `promptUsed` and `modelText` in browser DevTools console when Generate/Refine actions complete, so prompt/response are visible without switching to server terminal
- **Drafts API (`src/app/api/drafts/route.ts`)**:
  - Logs draft prompt dispatch with provider + model metadata
  - Logs full prompt sent to the provider with `console.log()`
  - Logs full raw draft response returned by the provider with `console.log()`
  - Returns optional debug payload fields `promptUsed` (prompt text) and `modelText` (model output) to support client-side inspection
  - Logs generation failure details for provider-level debugging
- **Draft Page (`src/app/(app)/drafts/[id]/page.tsx`)**:
  - Logs returned API payload debug fields (`promptUsed`, `modelText`) in browser DevTools during generation flow when present
- **Ideas Page (`src/app/(app)/ideas/page.tsx`)**:
  - Logs Firebase initialization and auth state changes
  - Logs Firestore query setup and idea loading (count and list)
  - Logs idea submission attempts and validation failures
  - Logs Firestore write operations with document IDs
  - Logs trends API calls and responses

All debug logs use a `[Module Name]` prefix for easy filtering in browser DevTools (e.g., filter by `[Ideas Page]`, `[API Angles]`).

---

## Security

- Sensitive `(app)` routes are protected by a Firebase auth guard in `src/app/(app)/layout.tsx`
- The ideas page reads and writes only the authenticated user's Firestore documents under `users/{uid}/ideas`; Firestore security rules must enforce the same user-to-UID match.
- Secrets kept in server-side env vars or private Next.js env vars
- `(auth)` route group is public (no middleware guard)

