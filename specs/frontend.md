# Frontend Specification

This document defines the requirements, architecture, and key behaviors for the Marketing Dashboard frontend (Next.js 16, TypeScript, Zustand, Tailwind CSS).

## TODO Tracker

This table centralizes the current frontend `(TODO)` items for quick planning and orchestration. The inline `(TODO)` markers throughout the document remain in place for section-level convenience.

| Area | Section | Status |
|---|---|---|
| Login & Authentication | Forgot password link (UI placeholder) | TODO |
| Dashboard | Content Calendar | DONE |
| Dashboard | Idea Backlog Summary | TODO |
| Dashboard | Drafts / Review Queue | TODO |
| Dashboard | Recent Analytics | TODO |
| Dashboard | Quick Links | TODO |
| Multi-Channel Adaptation | Platform Selector | DONE |
| Multi-Channel Adaptation | Generate by Platform (AI) | DONE |
| Multi-Channel Adaptation | Preview Per Format | DONE |
| Multi-Channel Adaptation | AI Chat for Editing | DONE |
| Publishing & Scheduling | Publish Context Loading (workflow/local/Firebase) | DONE |
| Publishing & Scheduling | One-click LinkedIn Handoff (clipboard + open compose) | DONE |
| Publishing & Scheduling | One-click X/Twitter Intent Prefill | DONE |
| Publishing & Scheduling | Missing Content / Error / Status Hints | DONE |
| Publishing & Scheduling | Schedule Picker / Calendar | DONE |
| Publishing & Scheduling | Visual Content Calendar | DONE |
| Publishing & Scheduling | Gap Detection Alerts | DONE |
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
| Error & Notifications | Error Messages | DONE |
| Error & Notifications | Success / Warning Notifications | DONE |
| Error & Notifications | System Alerts | DONE |
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
        ideas/
          rationale/
            route.ts        # Provider-agnostic AI rationale endpoint for idea score explanation + improvement guidance with deterministic fallback
        angles/
          route.ts          # Provider-agnostic AI angle generation/refinement endpoint (OpenAI/Gemini/Claude/Ollama)
          persist/
            route.ts        # Server-side angle persistence endpoint (retained for optional server workflows; Angles UI persists directly from the authenticated client)
          select/
            route.ts        # Server-side angle selection finalization endpoint (retained for optional server workflows; Angles UI persists selection directly from the authenticated client)
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
      DraftChatPanel.tsx      # Reusable AI chat panel with pending sentence-diff status for in-editor Keep/Undo
      Nav.tsx               # Sidebar navigation component (all 11 nav links)
    lib/                    # Utility helpers
      aiConfig.ts           # LocalStorage-backed AI provider config + active provider/key resolver used by angles generation
      analytics.ts          # Safe auth analytics event emitter (no-op when analytics SDK is absent)
      chatSpanDiff.ts       # Sentence/span diff extraction + rebased span-apply helpers for AI chat previews
      firebase.ts           # Browser-only Firebase Web SDK initialization + lazy auth and Firestore getters
      firebaseServer.ts     # Server-safe Firebase app/Firestore initializer for Next.js route handlers
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
- If authenticated, renders `<Nav />`, `<WorkflowStepper />`, and a responsive content column (`lg:ml-56`).
  - Mobile: top padding of `68px` to clear the fixed mobile header before the stepper.
  - Desktop: stepper sits at `top-0` (no extra padding), main content uses `pt-4 lg:px-8`.
- Wraps all authenticated screens.

### `src/components/WorkflowStepper.tsx`
- `'use client'` directive (uses `usePathname`).
- Sticky horizontal progress bar rendered below the mobile nav and at the top of the desktop content column.
- Displays 6 labelled steps: **Ideas → AI Angles → Storyboard → Adapt → Review → Publish**.
- Active step detected via `pathname.startsWith(path)` against each step's `paths` array.
- Past steps show a checkmark badge and emerald text; active step uses filled emerald background; future steps are muted.
- The stepper resolves an active workflow idea from route/query/workflow context and uses that idea for dynamic hrefs (Angles/Storyboard/Adapt).
- Storyboard and Adapt hrefs only attach `angleId` when it belongs to the same active `ideaId`; stale `draft_generation_context` / `adapt_draft_context` from other ideas is ignored.
- When no matching same-idea angle context exists, Storyboard and Adapt links fall back to `/angles?ideaId={ideaId}` (when `ideaId` is known) or `/angles` (when no idea context exists) — never to bare `/storyboard/{id}` or `/adapt/{id}` routes without `angleId`, which would cause those pages to fail.
- Responsive: step labels hidden on mobile (xs screens), shown from `sm` breakpoint up.

### `src/lib/workflowContext.ts` — Workflow Context Persistence
- Provides typed helpers for storing/retrieving the active workflow context in `localStorage` under the key `workflow_context`.
- `WorkflowContext` type: `{ ideaId: string; angleId?: string; ideaTopic?: string }`.
- Exports: `getWorkflowContext()`, `setWorkflowContext(ctx)`, `clearWorkflowContext()`.
- All storage operations are wrapped in try/catch to silently absorb storage errors.
- Used by `WorkflowStepper` to preserve same-idea navigation context (`ideaId` + optional `angleId`), by Ideas when opening an idea workflow, and by Angles as selection changes.

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
1. Content Calendar
2. Idea Backlog Summary (TODO)
3. Drafts / Review Queue (TODO)
4. Recent Analytics (TODO)
5. All Adaptations list renders saved adaptations from `users/{uid}/adaptations` and shows card-level actions:
  - `Edit` routes to `/adapt/{ideaId}?angleId={angleId}` for that specific adaptation.
  - `Delete` removes `users/{uid}/adaptations/{adaptationId}` from Firestore with confirmation.
6. Quick Links (TODO)

---

### Screen 3 — Idea Input & Backlog (`/ideas`)
**Route:** `src/app/(app)/ideas/page.tsx`
**Layout Notes:** Header summary + Firestore-backed form and backlog table on the left, live trends/articles sidebar on the right.
**Sections:**
1. New Idea form with textarea + tone/audience selectors (no format selector at idea-entry time)
2. Client-side validation, submit loading state, and inline save success/error states
3. Firestore list-load and add-doc save waits render spinner indicators
4. Firestore-backed ideas table scoped to the signed-in user
5. Functional sort and filter controls (sort by newest/oldest/topic/rating, filter by tone only); default sort is rating high-to-low
6. User-selected sort preference is persisted in browser session storage and restored when returning to `/ideas` within the same session
7. On sign-out, Ideas sort preference is cleared from session storage and the sort resets to the rating default
8. New ideas persist relevance metadata (`score`, `label`, `reason`, `scoredAtMs`) so rating sort is deterministic for equal scores
9. Rating column shows an explicit `Unscored` status when relevance metadata is missing; unscored entries are sorted last in rating sort
10. Backlog table intentionally omits a `Format` column; content format selection is deferred to later workflow steps
11. New ideas persist `format: 'Unspecified'` for backward-compatible data shape while format input is removed from the UI
12. Idea save flow keeps deterministic score/label calculation, then requests AI rationale through `POST /api/ideas/rationale` and persists AI-generated explanation when available
13. Rationale response includes both score reasoning and concrete improvement guidance; when provider config/API calls are unavailable, deterministic fallback reasoning and tips are persisted instead
14. Personal/company context is included in rationale prompts when available from existing user-profile fields; when absent, rationale still resolves with idea-only context
15. Backlog rows support inline title editing (`Edit Title` -> `Save`/`Cancel`) and persist renamed titles to Firestore (`title` field) without altering the underlying `topic`
16. Legacy idea docs without `title`, `improvements`, or rationale `source` render safely via backward-compatible defaults
17. Live trend snapshot and right-hand articles panel sourced from `/api/trends`

---

### Screen 4 — AI Angle Selection & Outline (`/angles`)
**Route:** `src/app/(app)/angles/page.tsx`
**Layout Notes:** Query-driven selected-idea header + AI-generated angle carousel + action bar + live trends panel.
**Sections:**
1. Resolves `ideaId` from query string; fast-path: reads `localStorage['angles_idea_context']` (written by Ideas page on navigation) and hydrates idea state immediately if `ideaId` matches, avoiding Firestore-blocked loading states. Firestore `users/{uid}/ideas/{ideaId}` is still fetched in the background to keep data fresh.
2. Guide/empty state when no `ideaId` is present, with CTA back to `/ideas`
3. Auto-generates angles through `POST /api/angles` as soon as valid idea context resolves (including the Ideas-page localStorage handoff), requesting exactly 2 cards using `getActiveAIKey()` (provider + key/config from settings), with a single in-flight run allowed per trigger to prevent overlapping requests. The page does **not** hard-block generation for a missing API key or missing Ollama model — the request is sent regardless and the API provides a deterministic fallback if provider config is incomplete.
4. Functional card carousel with previous/next navigation and radio-based angle selection
5. Angle selection is single-source-of-truth by `selectedAngleId`; generated/restored angle sets are normalized to unique IDs so only one card can ever render as selected at a time
6. Always-visible detailed editor per angle with inline editing for title, summary, and section points (including add/remove point actions); editor fields are immediately editable for all angles
7. "Regenerate" triggers a bounded regenerate flow for the current idea using a synchronous ref-based single-flight click guard (prevents rapid double-click duplicate requests before disabled paint) and, on success, appends exactly 2 newly generated cards to the existing angle set instead of replacing previous results.
7. Generation quality guard validates exactly 2 non-empty, distinct cards per generation run; invalid/duplicate/null payloads are retried up to a capped attempt count inside a strict run-level deadline, and if retries are exhausted or deadline is hit the previous valid angle set remains visible while the UI surfaces an actionable terminal error with next steps.
8. `/api/angles` now applies bounded provider retry attempts per request and accepts an optional generation seed/nonce and returns a seed-influenced fallback set (capped to requested count; default request count is 2) of distinct non-empty angles (derived from idea topic/tone/audience/format) when provider retries/timeouts are exhausted; fallback responses remain schema-compatible and are marked with `source: 'fallback'`. The API also returns a deterministic fallback (HTTP 200, `source: 'fallback'`) when provider configuration is incomplete — specifically when the provider is invalid/missing, when no API key is provided for a non-Ollama provider, or when no Ollama model is set — including a `fallbackReason` field describing the missing config; the idea content missing check still returns HTTP 400.
9. In-flight generation is single-flight (manual rapid clicks and auto/manual overlaps cannot create parallel generation requests), tracked in localStorage for refresh recovery, and stale pending state is auto-cleared on reload/navigation so generation always reaches a deterministic success/failure terminal state (no indefinite loading)
10. "Proceed to Draft Generation" routes to `/drafts/<ideaId>?angleId=<selectedAngleId>` and stores draft handoff context (idea + selected angle) in `localStorage['draft_generation_context']`
11. Live trend snapshot + right panel backed by `/api/trends` with loading/error states
12. Selected-idea Firebase load state displays a spinner + label while Firestore refresh is pending
13. On mount (and whenever `ideaId` changes), if `ideaId` is present in the URL it is persisted to `workflowContext`; if `ideaId` is absent from the URL, `getWorkflowContext()` is used to restore `?ideaId=<stored>` automatically.
14. As the selected angle changes, Angles writes fresh workflow context `{ ideaId, angleId }` so Storyboard/Adapt navigation always uses the current idea session.
15. After angle generation succeeds (initial 2-card generation and subsequent append-on-regenerate runs), the page immediately writes a sanitized payload directly via the authenticated Firebase client SDK to Firestore at `users/{uid}/ideas/{ideaId}/workflow/angles` with merge semantics and `{ ideaId, angles, selectedAngleId, updatedAt, updatedAtMs, cleanup }`.
16. On every revisit to `/angles?ideaId=...`, once the authenticated user's idea document resolves, the page attempts to restore `workflow/angles`; if persisted data contains valid angle cards, it hydrates `angles` + `selectedAngleId` from Firestore before auto-generation is allowed to run.
17. The persistence effect writes directly with `setDoc(..., { merge: true })` whenever `angles` or `selectedAngleId` changes while `currentUser` and `idea` are available, so inline edits to title/summary/sections are persisted under the signed-in user context without requiring server-route authentication.
18. Persistence failures surface as a visible warning banner on Angles (instead of silent console-only failures), while preserving current editable state in the UI.
19. On angle radio selection changes, the page updates local selection immediately and persists selection through the same direct Firestore write path; if this write fails, the UI keeps the local selection and surfaces an inline error so users can retry.
20. Generated angle cards use a wider presentation (desktop-first min width) to reduce cramped text areas and improve readability while preserving horizontal carousel navigation.

Ideas page (Screen 3) handoff:
- When "Generate Angles" is clicked, the selected idea's full data (`{ ideaId, topic, tone, audience, format, createdAtMs }`) is written to `localStorage['angles_idea_context']` before `router.push('/angles?ideaId=...')` so the Angles page can render instantly without waiting for Firestore.
- The same click also updates `workflowContext` with the selected `ideaId` (+ `ideaTopic`) before navigation to keep stepper context aligned across Ideas, Angles, Storyboard, and Adapt.

Implementation note:
- `src/lib/aiConfig.ts` exposes `getActiveAIKey()` and returns `{ provider, apiKey, ollamaBaseUrl, ollamaModel }` from persisted user settings; this utility is required by `/angles` generation flows and includes debug logging for provider/key presence.
- `src/app/api/angles/route.ts` enforces bounded provider retries, per-attempt timeout/request-abort handling, and deterministic fallback generation for generation requests so angle regeneration can still succeed when upstream providers repeatedly fail or time out.
- Angles page persistence correctness does not depend on `/api/angles/persist` or `/api/angles/select`; client-side authenticated Firestore writes now provide the primary persistence path for generation, edits, and selection.
- `src/app/(app)/angles/page.tsx` keeps the existing Ideas-page localStorage handoff (`angles_idea_context`) for instant rendering, restores persisted workflow state from Firestore, and persists generation/edits/selection via direct authenticated Firestore `setDoc(..., { merge: true })` writes.
- Route files must contain a single top-level module with exactly one `'use client';` directive (when needed) before imports; duplicated appended modules are invalid and break Turbopack parsing.

---

### Screen 5a — Drafts Index (`/drafts`)
**Route:** `src/app/(app)/drafts/page.tsx`
**Pattern:** Client component; reads auth state then streams all drafts via Firestore `onSnapshot`.
**Sections:**
1. Reads `uid` from `onAuthStateChanged`; queries `users/{uid}/drafts` ordered by `updatedAt` descending via realtime snapshot.
2. Displays a list of draft cards; each card shows `ideaTopic`, `angleTitle`, status badge (emerald = approved, blue = published, slate = draft), and formatted `updatedAt` timestamp.
3. Each card links to `/drafts/{ideaId}?angleId={angleId}`.
4. "**+ New Draft**" button reads `workflowContext` from `localStorage`; if `ideaId` is set, links to `/angles?ideaId={ideaId}`; otherwise falls back to `/ideas`.
5. Empty-state renders a dashed bordered panel with CTA back to `/ideas` (or angles if context present).
6. Loading state shows `<Spinner size="sm" />`; Firestore errors show inline red message.

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

### Screen 5b — Storyboard Editor (`/storyboard/[id]`)
**Route:** `src/app/(app)/storyboard/[id]/page.tsx`
**Pattern:** Client component using `useParams()` and query `angleId`; keeps storyboard generation/save flow while supporting both inline-edit and chat-driven revision flows.
**Layout Notes:** Single editor workspace with one source-of-truth textarea, a floating in-place inline AI editor, and an in-editor sentence-diff stack for AI chat proposals.
**Sections:**
1. Storyboard content is edited in a textarea (`ref={editorRef}`); generation, debounced autosave (2 s), manual save, source extraction, and adaptation handoff behavior remain intact.
2. Selection capture uses textarea selection offsets (`selectionStart`/`selectionEnd`) and also computes an approximate in-editor anchor point so prompt/diff controls float at the current edit location.
3. Inline AI editing keeps the textarea editable at all times; users can continue manual edits while a pending AI proposal is visible.
4. A floating `InlineEditPanel` renders over the editor near the active selection, containing instruction input + propose action and contextual `Keep`/`Undo` controls for pending proposals.
5. Pending proposals render in-place diff snippets with red strike-through (`bg-rose-100 text-rose-700 line-through`) for original text and green highlight (`bg-emerald-100 text-emerald-800`) for suggested text; no separate revision-history/change-log section is displayed.
6. No-op AI proposals are handled explicitly and displayed as `No changes suggested.` in the floating panel.
7. Storyboard AI chat is available again through `DraftChatPanel`; chat requests use `POST /api/drafts/chat` with current draft context and conversation history.
8. When chat returns `<UPDATED_DRAFT>`, the page computes sentence/span diffs between current text and AI output, without replacing the entire document.
9. Pending chat diffs render inside the editor surface with red strike-through old text and green replacement text, each with independent `Keep` and `Undo` controls.
10. `Keep` applies only the targeted sentence/span replacement, rebases nearby spans when possible, and marks overlapping unresolved proposals as conflicts.
11. `Undo` removes only the targeted pending sentence/span proposal and preserves all other pending diffs and manual edits.
12. Reference parsing supports case-insensitive `Sources` / `References` headings (ATX headings like `## Sources` and Setext-style headings), with numbered lists (`1.`/`1)`), bulleted lists (`-`/`*`/`+`), and plain URL lines. Entries support markdown links (`[label](url)`) and bare `http(s)` URLs, tolerate mixed indentation, trailing whitespace, and optional two-space markdown line breaks, deduplicate by canonical URL, and render valid links as clickable entries in the bottom References panel. If a source/reference heading exists but no valid links are extracted from section parsing, the parser falls back to scanning reference-style list lines across the draft so numbered markdown links under `## Sources` are still detected. Malformed URL-like references are surfaced as validation warnings.

---

### Screen 6 — Multi-Channel Adaptation (`/adapt/[id]`)
**Route:** `src/app/(app)/adapt/[id]/page.tsx`
**Pattern:** Client component using `useParams()` plus query `angleId` to resolve the draft-to-adapt handoff.
**Layout Notes:** Platform generation + tabbed editor workspace; each platform editor supports floating inline edit controls and an embedded AI chat panel that emits sentence-level in-editor diffs.
**Sections:**
1. Uses `localStorage['adapt_draft_context']` as a fast-path when it matches the route (`ideaId` + `angleId`). If local context is missing, invalid, or route-mismatched, the page falls back to Firebase lookups (`users/{uid}/ideas/{ideaId}`, `users/{uid}/ideas/{ideaId}/workflow/angles`, and `users/{uid}/drafts/{ideaId}_{angleId}`) to rebuild a valid adaptation context instead of hard-failing immediately.
2. If the storyboard draft document is missing during Firebase fallback resolution, Adapt builds a deterministic scaffold draft from idea + selected angle summary/sections so platform generation remains usable.
3. Uses Firestore `users/{uid}/adaptations/{ideaId}_{angleId}` to load previously saved adaptation state for the signed-in user and merge saved platform copy over the draft-seeded defaults.
4. Seeds `linkedin`, `twitter`, `medium`, `newsletter`, and `blog` platform editors from the current draft content when no adaptation doc exists yet.
5. Platform tab buttons are fully stateful; clicking a tab changes the active platform and swaps the center editor/preview to that platform only. The optimization panel remembers the last selected analysis per platform, so revisiting a platform shows its previously generated result panel again, while platforms with no completed analysis still render the empty/instruction state.
6. Editing updates only the currently active platform text. The textarea is disabled (`disabled={isAdaptationLoading}`) while the Firestore adaptation document is still being fetched, preventing any user input from being silently overwritten by the async load.
7. Each active platform exposes an explicit `Generate <Platform>` button that calls `POST /api/drafts/adapt` using the original draft source (`adapt_draft_context.draftContent`) plus platform-specific prompt rules; the API route aborts provider calls after 5 minutes (300 seconds) and returns HTTP 504 with a timeout-specific error, while the client keeps a slightly longer local `AbortController` guard (~302 seconds) so the normal slow-provider path still surfaces the server timeout response first. Hung requests still clear the generating spinner, timeout/failure feedback is shown inline near the editor controls, and healthy providers still replace the active platform copy with the returned AI output.
8. Platform text plus `activePlatform` auto-save to Firestore with a 1.5 s debounce; visible save status appears in the page header, and the "Save as Draft" action triggers an immediate Firestore write.
9. AI chat is restored in Adapt via `DraftChatPanel`; it calls `POST /api/drafts/chat` with the active platform text as `draft`, stores conversation history per platform, and tracks provider metadata per platform.
10. Chat `<UPDATED_DRAFT>` output is converted to sentence/span diffs for the active platform instead of replacing the full textarea value.
11. Pending chat diffs render in the active platform editor with red old text and green new text; `Keep`/`Undo` actions are scoped to a single diff entry.
12. Keeping one diff applies only that span, preserves surrounding manual edits, and rebases or conflict-marks remaining pending diffs for that platform.
13. Optimization tools call `POST /api/drafts/analyze` against the active platform text and render visible result panels for:
   - `📈 SEO Optimizer`
   - `🔍 AI Check` (backed by `type='plagiarism'`)
   - `🔗 Source Check`
   When a configured non-Ollama AI key exists, the route keeps using the existing AI-backed prompt/call/parse flow. When the active provider is non-Ollama and no key is configured, the route returns deterministic, schema-compatible fallback outputs per tool based on the currently active platform copy instead of surfacing a shared missing-key failure.
14. Preview card renders the active platform copy and a per-platform word-count snapshot, with no hardcoded demo content.
15. Right-hand trends sidebar consumes live `/api/trends` data and shows truthful loading, error, or empty states instead of placeholder topics/articles.
16. Breadcrumb marks `Multi-Channel Adaptation` as the active workflow step; the primary completion CTA saves the current adaptation, preserves exact `ideaId` + `angleId` workflow context, and routes directly to `/publish`.
17. The Adapt editor shares Storyboard inline editing UX: floating in-place prompt/diff controls anchored near current selection, red/green inline diff preview in the floating panel, and direct textarea editability while AI proposals are pending.
18. Adapt inline editing and chat preview avoid duplicate revised-text surfaces by using the same active textarea as the only authoritative editing surface.

---

### Screen 7 — Publishing & Scheduling (`/publish`)
**Route:** `src/app/(app)/publish/page.tsx`
**Layout Notes:** Library-style scheduling workspace that lists every saved adaptation for the signed-in user, with per-adaptation platform cards, edit/delete controls, schedule pickers, and a global upcoming schedule list.
**Sections:**
1. Loads all adaptation documents in realtime from `users/{uid}/adaptations` ordered by `updatedAt desc` and renders each adaptation as its own scheduling block.
2. Each adaptation block shows idea + angle labels and an `Edit Adaptation` route action that deep-links to `/adapt/{ideaId}?angleId={angleId}`.
3. LinkedIn one-click action per adaptation card:
  - attempts `navigator.clipboard.writeText(linkedinText)`
  - opens `https://www.linkedin.com/feed/?shareActive=true` in a new tab
  - shows explicit status message for copied-success or clipboard-blocked fallback guidance
4. X/Twitter one-click action per adaptation card opens `https://twitter.com/intent/tweet?text=...` with URL-encoded prefilled text.
5. Platform cards include content textareas, explicit `Copy` buttons, and card-level `Edit` / `Delete` controls.
6. Card-level `Edit` enables in-card text editing for the selected adaptation + platform and persists to `users/{uid}/adaptations/{adaptationId}`.
7. Card-level `Delete` removes the selected platform field from `users/{uid}/adaptations/{adaptationId}`; once removed, that platform card is hidden from the Publish UI.
8. Platform-specific schedule pickers persist reminders to `users/{uid}/scheduledPosts` with adaptation/article metadata and `scheduledForMs` timestamp.
9. Publish renders upcoming scheduled posts from Firestore so users can verify queued reminders and dates across all adaptations.
10. Clear UX states are present for loading, signed-out/config errors, empty adaptation library, schedule validation errors, and successful publish/schedule actions.

Implementation notes:
- Publish page now runs as a client component and uses Firebase Auth + Firestore browser SDK lookups.
- One-click publish behavior is strictly handoff-based (open compose/share surfaces) and does not attempt direct API posting/OAuth account publishing.

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
1. Error Messages
2. Success / Warning Notifications
3. System Alerts

Notifications behavior details:
- Loads scheduled reminders from `users/{uid}/scheduledPosts` for the signed-in user.
- `Success / Warning Notifications` card highlights reminders due now (within +/-15 minutes of scheduled time).
- `System Alerts` card shows upcoming reminders for the next 24 hours and lists missed posting windows from older scheduled reminders.
- Signed-out/Firebase-unavailable/Firestore-load failures surface via the `Error Messages` card.

---
TEST_MARKER

## Dynamic Routes

- `src/app/(app)/drafts/[id]/page.tsx` is a client component that resolves the route segment with `useParams()` and reads `angleId` from `useSearchParams()`.
- `src/app/(app)/storyboard/[id]/page.tsx` is a client component that resolves `ideaId` with `useParams()` and reads `angleId` from `useSearchParams()` to validate storyboard context.
- `src/app/(app)/adapt/[id]/page.tsx` is a client component that also resolves `ideaId` with `useParams()` and validates the paired `angleId` query string before loading adaptation context.

---

## API Integration

- `/api/trends` is a Next.js route handler that fetches public Bing News RSS feeds for marketing/AI/SEO queries, extracts direct publisher URLs from the feed redirect links, deduplicates the results, and returns live topics + clickable article links for the ideas page.
- `/api/angles` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, idea, count, selectedAngleId?, refinementPrompt? }`, calls OpenAI (`gpt-4o-mini`), Gemini (tries `gemini-2.0-flash`, then `gemini-2.0-flash-lite`, then `gemini-1.5-flash-latest`), Claude (`claude-3-5-haiku-latest`), or local Ollama (`/api/generate`), robustly parses JSON output (including fenced JSON fallback), validates angle schema, and returns structured `angles[]` or typed errors.
- `/api/angles` degrades gracefully: when provider calls fail or model output cannot be parsed, the route returns deterministic fallback angles (HTTP 200) with an `error` message describing the provider failure, so the UI does not hard-fail with a 502.
- In `src/app/api/angles/route.ts`, Ollama calls are routed through `fetchOllama(apiKey, prompt, baseUrl, model)`; both `baseUrl` and `model` are required in the helper signature to keep request logging, validation, and request construction type-safe.
- `/api/drafts` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, idea, angle }`, builds a long-form draft prompt from selected idea + angle outline, calls the configured AI provider, and returns `{ draft, provider, promptUsed?, modelText?, citationValidation }` on success. If the provider call fails, the route now returns HTTP 200 with a deterministic fallback markdown draft (intro + section scaffold + conclusion + sources) and observability metadata `{ source: 'fallback', fallbackReason }` while preserving the same client-facing `draft` and `provider` fields.
- `/api/drafts/adapt` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, platform, sourceDraft, currentPlatformDraft? }`, resolves platform-specific prompt rules from `src/lib/prompts/platforms/*`, calls the configured AI provider, aborts the provider request after 5 minutes (300 seconds), and normalizes abort-like runtime error shapes back into the timeout response path so client-visible timeouts consistently return a JSON error with HTTP 504 instead of a generic HTTP 502 provider failure. Successful calls still return `{ platform, generatedContent, provider }`, and the route does not emit fallback/dummy adaptation text when AI generation fails.
- `/api/drafts/inline-edit` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, selectedText?, instruction }` and supports two response modes from a single endpoint: selected-text mode returns `{ updatedText, changeSummary, provider }`, while no-selection mode returns `{ suggestions: [{ beforeText, afterText, changeSummary }], provider }` with up to three validated suggestions.
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

---

## Ticket 10-17 Implementation Update (2026-04-20)

### Ticket 10: FE-ROUTES-STORYBOARD-001
- `/storyboard` now exists as the primary index route for storyboard records.
- Legacy routes are preserved through redirects:
  - `/drafts` -> `/storyboard`
  - `/drafts/new` -> `/storyboard`
  - `/drafts/[id]?angleId=...` -> `/storyboard/[id]?angleId=...`
- Navigation and stepper now label stage 3 as **Storyboard** and point to `/storyboard`.
- Angles handoff now routes directly to `/storyboard/<ideaId>?angleId=<angleId>`.

### Ticket 11: FE-STORYBOARD-002
- Storyboard UI contains no SEO or AI Check toolbar actions.
- Storyboard focuses on editor + inline edit + citation/reference validation and adaptation handoff.

### Ticket 12 and 13: FE-BE-INLINE-EDIT-001, FE-STORYBOARD-003
- Shared inline edit logic is implemented via:
  - `src/lib/useInlineEdit.ts`
  - `src/components/InlineEditPanel.tsx`
- Shared behavior in both Storyboard and Adapt:
  - Requires an instruction before proposing. Selected text is optional.
  - When no text is selected, inline-edit API chooses a best-fit passage from the draft based on the user instruction and returns a standard proposal.
  - When no text is selected and the instruction indicates a larger rewrite/overhaul or a multi-target request (for example, intro + ending), the inline-edit API returns 2 to 3 distinct passage-level proposals so users can review each targeted change separately.
  - Inline-edit proposal text is sanitized before rendering so user-facing suggestions do not expose internal metadata strings such as "Edited intent:".
  - Surfaces the latest pending proposal inline in the active editor card with old/new snippet preview and **Keep** / **Undo** controls near the editable textarea.
  - The **Keep** / **Undo** controls render as a floating top-right pill overlay inside the editor surface to mirror in-editor suggestion UX.
  - Keeps the Inline AI panel focused on selection + instruction + propose actions while the decision UI is shown in-editor.
  - Produces proposal queue with per-change resolution status handling behind the inline decision controls.
  - Handles overlap conflicts by flagging conflicting proposals after accepted edits.
  - Rebase fallback attempts snippet relocation; unresolved range drift is flagged as conflict.
  - Storyboard exposes the proposal queue directly in the Inline AI panel so multi-suggestion overhaul requests remain reviewable and actionable.

### Ticket 14: FE-BE-STORYBOARD-004
- Storyboard submission enforces citation requirements before navigating to review.
- Validation blocks submit when:
  - factual claims are missing citation markers,
  - no references list is detected,
  - citation markers do not resolve to reference entries.
- References are rendered as clickable links in the Storyboard references panel.

### Ticket 15, 16, and 17: FE-ADAPT-001, FE-BE-ADAPT-002, FE-BE-ADAPT-003
- Adapt now starts with a required platform multi-select gate (must select >= 1 platform).
- Generation runs sequentially over selected platforms and keeps progressing after failures.
- Each selected platform renders as a progressive editable card with:
  - generation status (`idle|queued|running|success|failed`),
  - explicit per-platform retry action,
  - editable textarea regardless of generation outcome.
- SEO analysis auto-runs after each successful platform generation.
- SEO status lifecycle per platform: `idle|pending|success|failed` with explicit retry action.
- Late SEO responses are ignored when content version has changed, preventing stale overwrite of newer edits.
- Shared inline edit panel is available in Adapt and operates against the currently active platform card.

### Data Flow Notes
- Storyboard remains persisted under `users/{uid}/drafts/{ideaId}_{angleId}` with status `storyboard`.
- Adaptation save payload now includes selected platform list and active platform alongside per-platform content.

