# Frontend Specification

This document defines the requirements, architecture, and key behaviors for the Marketing Dashboard frontend (Next.js 16, TypeScript, Zustand, Tailwind CSS). The user-facing product name is **Flowrite** — used uniformly across the public landing page, HTML `<title>`, auth screens (login + register left panel and form heading), the desktop sidebar brand, the mobile top-bar wordmark, and the dashboard hero. "Marketing Dashboard" is reserved for internal/architectural references only and must not appear in user-visible UI copy.

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
| Settings & Compliance | Integration Connectors | PARTIAL |
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
      page.tsx              # Marketing landing page — hero, three preview cards, feature grid, workflow steps, CTA
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
          analyze/
            route.ts        # SEO / plagiarism / source-check analysis endpoint with deterministic fallback per type
          chat/
            route.ts        # Conversational AI chat endpoint that parses <UPDATED_DRAFT> tags
          headlines/
            route.ts        # A/B headline variant generator
          inline-edit/
            route.ts        # Shared inline-edit proposal endpoint for Storyboard and Adapt
          personas/
            route.ts        # Persona-targeted rewrite endpoint (one persona at a time per current UI)
          plagiarism/
            route.ts        # Verbatim-quote web search + AI heuristic AI-likelihood review (no companyContext)
          research/
            route.ts        # DuckDuckGo-grounded research brief synthesizer
          rewrite/
            route.ts        # Tone or readability rewrite endpoint
          similar-posts/
            route.ts        # Similar-post and competitor comparison search endpoint for Adapt AI tooling
        company/
          autofill/
            route.ts        # Scrape a company website and extract a structured CompanyProfile via the configured AI provider
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
        storyboard/
          page.tsx          # Screen 5 — Storyboard Index (replaces legacy /drafts list)
          new/
            page.tsx        # Redirect → /storyboard
          [id]/
            page.tsx        # Screen 5b — Storyboard Editor (dynamic [id])
        drafts/
          page.tsx          # Redirect → /storyboard (legacy)
          new/
            page.tsx        # Redirect → /storyboard (legacy)
          [id]/
            page.tsx        # Legacy Draft Editor (still mounted, behaves as the underlying drafts/{ideaId}_{angleId} editor; new flow points to /storyboard/[id])
        adapt/
          new/
            page.tsx        # Redirect → /storyboard
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
      AIEditTimeline.tsx        # Right-side timeline of applied AI edits with restore-to-snapshot controls
      AIToolbox.tsx             # Shared AI tooling surface (Tone, Readability, Personas, A/B headlines, Research, Plagiarism, Similar posts on Adapt)
      CitationHighlightPreview.tsx  # Citation-aware preview that highlights claims and cited spans before review submission
      DiffAwareEditor.tsx       # Editor wrapper that renders pending in-place sentence-diffs (red strike-through old / green new) with per-diff Keep/Undo
      DocumentContextHeader.tsx # Sticky "Editing: <idea topic> · <angle title>" context header rendered beneath the WorkflowStepper on Storyboard / Adapt / Publish (single-doc) so the user keeps a persistent anchor across the Storyboard → Adapt → Publish jump. Right-aligned step indicator ("Step N of 6") derived from `PIPELINE_STEPS`.
      DraftChatPanel.tsx        # Reusable AI chat panel with pending sentence-diff status for in-editor Keep/Undo
      InlineEditPanel.tsx       # Floating inline edit prompt + proposal queue used by Storyboard and Adapt
      Nav.tsx                   # Sidebar navigation component
      Spinner.tsx               # Shared loading spinner used across pages
      WorkflowStepper.tsx       # Sticky horizontal stepper (Ideas → Angles → Storyboard → Adapt → Review → Publish) — reads step list from `lib/pipeline.ts`
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

### Root marketing page
- `src/app/page.tsx` — public marketing landing page rendered with inline styles (no auth, no Nav). Sections: dark green sticky navbar with Sign In + Get Started, hero on a `linear-gradient(160deg, #0f2a25 → #14302a → #0d2622)` base overlaid with a tiled diamond/rhombus SVG pattern (160×160 tile, `rgba(255,255,255,0.06)` strokes), three preview cards (AI-Generated Content, Multichannel Reach, Real-Time Performance — first two on a mint-green `#b8e6d6→#7dc9b0` gradient, third on a teal `#1d6e6e→#155f5f` gradient with a mock dashboard chart), a four-card feature grid using colored-square SVG icons (yellow lightbulb, pink target, mint document, blue bar chart), a four-step workflow row with arrow connectors between numbered circles, and a dark CTA strip reusing the diamond pattern with a sparkle SVG accent.
- Access control is enforced by the `(app)` layout guard. Unauthenticated visits to `/dashboard` are redirected to `/login`.

### Route groups
- **`(auth)`** — unauthenticated routes (no Nav sidebar). Currently contains `/login`.
- **`(auth)`** login route checks Firebase auth state and redirects authenticated users to `/dashboard`.
- **`(app)`** — authenticated routes wrapped by `AppLayout` which renders `<Nav />` + `<main>` only after Firebase auth verification.

---

## Shared Components

### `src/components/Nav.tsx`
- `'use client'` directive (uses `usePathname`).
- Mobile: fixed top header with horizontal pill navigation and alerts shortcut.
- Desktop: fixed left sidebar (`w-56`) with branded hero panel, three labelled groups, and a weekly target panel.
- Sidebar groups (in order):
  1. **Dashboard** (single link, `/dashboard`).
  2. **Pipeline** — the canonical six pipeline steps in canonical order: **Ideas → Angles → Storyboard → Adapt → Review → Publish**. The labels and order are imported from `src/lib/pipeline.ts` (`PIPELINE_STEPS`) so the sidebar, the WorkflowStepper, and any per-page breadcrumbs always agree. Never re-declare these labels inline.
  3. **More** — `Analytics`, `Collaboration`, `Settings`, `Notifications`. The `/collaboration` link is labeled `Collaboration` (NOT `Audience`); `Campaigns`/`Content`/`Audience` are no longer used as sidebar labels anywhere.
- Each link renders an emoji-style icon plus the label; active link uses an emerald background treatment, inactive links use a muted teal foreground that lifts on hover.
- Active detection: exact match on `pathname` or `pathname.startsWith(base)` (strips `/new` suffix for dynamic links like `/drafts/new`).
- Mobile pill row renders the full flattened list (Dashboard + Pipeline + More) using the same labels — no separate mobile-only naming.

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
- Displays the 6 labelled steps from `PIPELINE_STEPS` (see `src/lib/pipeline.ts`): **Ideas → Angles → Storyboard → Adapt → Review → Publish**. Step labels and ordering are imported from that module — the stepper never re-declares the array inline.
- Active step detected via `pathname.startsWith(path)` against each step's `paths` array (also sourced from `PIPELINE_STEPS`, so the Storyboard step still matches the legacy `/drafts` prefix).
- Past steps show a checkmark badge and emerald text; active step uses filled emerald background; future steps are muted.
- The stepper resolves an active workflow idea from route/query/workflow context and uses that idea for dynamic hrefs (Angles/Storyboard/Adapt).
- Storyboard and Adapt hrefs only attach `angleId` when it belongs to the same active `ideaId`; stale `draft_generation_context` / `adapt_draft_context` from other ideas is ignored.
- When no matching same-idea angle context exists, Storyboard and Adapt links fall back to `/angles?ideaId={ideaId}` (when `ideaId` is known) or `/angles` (when no idea context exists) — never to bare `/storyboard/{id}` or `/adapt/{id}` routes without `angleId`, which would cause those pages to fail.
- Responsive: step labels hidden on mobile (xs screens), shown from `sm` breakpoint up.

### `src/lib/pipeline.ts` — Canonical Pipeline Source-of-Truth
- Exports `PIPELINE_STEPS`, a typed `readonly` array of `{ key, label, path, paths }` describing the canonical content pipeline in this exact order: `ideas → angles → storyboard → adapt → review → publish`.
- Exports the `PipelineStepKey` union and `PipelineStep` shape for typed consumers.
- Single import source for `Nav.tsx` (sidebar Pipeline group) and `WorkflowStepper.tsx` (sticky stepper). Per-page breadcrumbs (Storyboard, Adapt) must use the same labels, with `Publish` as the final word — never `Schedule`.
- Adding/removing/renaming a pipeline step is a one-line edit here; nav, stepper, and breadcrumbs all update together.

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

### `src/components/ComingSoonBadge.tsx`
- Tiny inline pill (`bg-amber-100 text-amber-800`) with a small clock icon and the text "Coming soon".
- Accepts an optional `label` prop to override the text (e.g. `Preview`, `In progress`).
- Uses `role="status"` with an `aria-label` so screen readers announce the placeholder state.
- Sized so it can sit next to a section `<h2>`/`<h3>` without breaking the heading layout.
- Used directly on the dashboard KPI tiles ("Engagement rate", "Best post type") and on every `<h3>` inside the Settings → Advanced (preview) group (Compliance Flags, Audit Log Viewer, Security Settings).

### `src/components/PlaceholderCard.tsx`
- Reusable wrapper for non-functional preview sections. Renders a `surface-card` at reduced opacity (`opacity-75`) so placeholders visually recede compared to real cards.
- Header shows the section title with a `<ComingSoonBadge />` inline; an optional `description` prop renders the muted explanatory copy.
- Built-in `previewKind` decoration (`chart` | `editor` | `list` | `form` | `none`) draws an inert silhouette so the user gets a hint of what the feature will look like once it ships. Decoration is wrapped in `pointer-events-none select-none` and the wrapper sets `aria-disabled="true"`.
- Optional `children` slot replaces the default decoration when a consumer wants to drop in custom skeleton content. Optional `className` allows grid-span overrides like `lg:col-span-2`.
- Used by:
  - `/review` for **Inline Editor**, **Version History**, **Approval Chain Controls**, **Comment / Suggestion Layer**, and **Role-Based Access**.
  - `/analytics` for **Engagement Charts**, **Performance History**, **Predictive Scoring**, **Copy Intelligence Insights**, and **AI Visibility Tracking** (replaces the previously hardcoded "Predicted reach" and "outperform generic intros" factoids).
  - `/collaboration` for **Role-Based Access**, **Client Brief Forms**, **Project Calendars**, and **White-Label Toggles**. The Invite / Manage Users card uses the badge inline plus a visibly disabled (`disabled` + `aria-disabled="true"`) Invite teammate button instead of `<PlaceholderCard>`.

### `src/components/AIToolbox.tsx`
- Shared AI tooling surface used by Storyboard and Adapt.
- Core tabs remain Tone, Readability, Personas, A/B headlines, Research, and Plagiarism.
- Adapt can opt into an extra `Similar posts` tab via `enableSimilarPosts`.
- The Similar posts tab accepts a topic/query plus optional competitor terms, calls `/api/drafts/similar-posts`, lists linked matching posts, labels competitor matches, and returns a comparison summary plus recommended differentiation moves for the current draft.

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
**Layout Notes:** Hero with KPI metrics, then responsive grid for calendar, backlog, queue, analytics, and quick links. A first-run "Get started" checklist card renders above the hero and auto-hides once setup is complete.
**Sections:**
0. Get started checklist (first-run onboarding card, rendered as the FIRST card above the hero) — title "Get started with Flowrite", subtitle "A few quick steps before AI features will work.". Three rows, each with a ✅ green check OR ⬜ empty box on the left, the step text in the middle, and a primary "Open" link (or outlined "Review" link when done) on the right. Items and "done" criteria:
   1. "Set your AI provider key" → done when `getActiveAIKey()` returns a non-empty `apiKey`, OR when active provider is `ollama` (no key required). Action link: `/settings#ai-api-keys`.
   2. "Fill in your Company Profile" → done when `loadCompanyProfile(currentUid)` from `frontend/src/lib/companyProfile.ts` returns a profile with non-empty `companyName`. Action link: `/settings#company-profile`.
   3. "Add your first idea" → done when the user has at least one document in `users/{uid}/ideas`. Probed via a one-time Firestore `getDocs(query(collection(db, 'users', uid, 'ideas'), limit(1)))` (existence check only — the full list is not loaded). Action link: `/ideas`.
   - Auto-hide: when all three items are `done`, the entire checklist card renders `null` (no manual dismiss button — completing the steps IS the dismissal).
   - Loading state: while the checklist state is being computed (Firestore probe + company profile load), a small `<Spinner size="sm" />` placeholder card is rendered in place so the layout doesn't shift.
   - Visual style: re-uses `surface-card`, `pill`, `section-title`, `muted-copy` utility classes; emerald/teal palette for completed states.
   - Coexists with the global API-key warning banner in `(app)/layout.tsx` (banner is reactive; checklist is proactive). The checklist does not replace or modify the banner.
1. Content Calendar
2. Idea Backlog Summary (TODO)
3. Drafts / Review Queue (TODO)
4. Recent Analytics (TODO)
5. All Adaptations list renders saved adaptations from `users/{uid}/adaptations` and shows card-level actions:
  - `Edit` routes to `/adapt/{ideaId}?angleId={angleId}` for that specific adaptation.
  - `Delete` removes `users/{uid}/adaptations/{adaptationId}` from Firestore with confirmation.
6. Quick Links (TODO)
7. **Clean up orphans** admin card (renders directly under the Get-started checklist when at least one orphan storyboard or orphan adaptation is detected; otherwise the card returns `null` and is fully hidden). An "orphan" is a `users/{uid}/drafts/{id}` or `users/{uid}/adaptations/{id}` document whose `ideaId` no longer points to an existing `users/{uid}/ideas/{ideaId}` document. Detection is debounced and runs off the snapshot data via `findOrphanStoryboards` / `findOrphanAdaptations` from `frontend/src/lib/orphans.ts`, with parent-existence checks cached per `ideaId` so the dashboard never blocks rendering on N parallel `getDoc` calls. The card title is "Clean up orphans"; the body copy is "We found N items pointing to deleted ideas. They've been hidden from your dashboard. Delete them permanently?"; the primary action is a "Delete N orphans" button that calls `deleteOrphans(uid, ...)` (idempotent), then re-runs the detector so the card auto-hides on success. While orphan detection is in flight (post-snapshot), the dashboard optimistically renders ALL drafts/adaptations; once the detector resolves, orphans are dropped from the "Oldest open draft" hero metric, the "Storyboards and Review queue" card, the "All Adaptations" list, the "Total drafts" / "Total adaptations" analytics cards, and the "Posts this week" / "Ideas waiting" derivations.

---

### Screen 3 — Idea Backlog (`/ideas`)
**Route:** `src/app/(app)/ideas/page.tsx`
**Layout Notes:** Full-width single-column layout — no sidebar. Top-to-bottom: header card → WorkflowStepper → input card → filter tabs + sort → idea cards.
**Sections:**
1. Header card: breadcrumb (`CAMPAIGNS · IDEAS`), page title (`Idea Backlog`), subtitle, and stats row showing total backlog count, strong-rated count, and last-scored time label (derived per render from `relevance.scoredAtMs`).
2. `<WorkflowStepper />` unchanged.
3. Input card: single `<input type="text">` (one-sentence topic), three pill-style inline `<select>` dropdowns (Tone, Audience, Format — options `['Any','Article','Post','Thread','Newsletter','Video Script']`, default `'Any'`), "Score only" outline button (runs `submitIdea(true)` — skips `generateIdeaRationale`, uses `scoreIdeaTopic` + `buildFallbackRationale` only), and "Add & score" primary button (existing full AI flow). `format` state value is saved alongside `tone`/`audience` in the Firestore `addDoc` payload.
4. Filter tabs: pill buttons for `All`, `Strong`, `Moderate`, `Weak`, `No angles yet` — each showing a count. `No angles yet` = ideas where `!draftMap.has(idea.id) && !adaptMap.has(idea.id)`. `draftMap` (`Map<string, string>`, ideaId → angleId) is populated from `users/{uid}/drafts`; `adaptMap` (`Map<string, string>`, ideaId → angleId) from `users/{uid}/adaptations` — both fetched on `currentUser` change via `getDocs` with `Promise.all`; empty Maps used on error.
5. Sort dropdown on filter row (right): `Score high → low` (default), `Newest`, `Oldest`, `Topic A-Z`. `ratingFilter` state replaces the old `toneFilter`; `visibleIdeas` memo filters by rating label or no-draft/adapt status.
6. Idea cards (replaces table): each idea is a rounded-2xl white card with a 56×56 px color-coded score circle (emerald=Strong, amber=Moderate, rose=Weak, slate=unscored), tone/audience pills + date + live signals count in the tag row, bold title, secondary topic line when title differs, and a right-column action group consisting of exactly ONE primary CTA button (dark-green filled `#1a7a5e`) plus a "..." overflow dropdown. The primary CTA is selected via the idea's furthest pipeline state: (a) `adaptMap.has(idea.id)` → "Resume in Adapt →" routing to `/adapt/{ideaId}?angleId={angleId}`; (b) `draftMap.has(idea.id) && !adaptMap.has(idea.id)` → "Resume in Storyboard →" routing to `/storyboard/{ideaId}?angleId={angleId}`; (c) neither map has the idea → "Open angles →" routing through `openAnglesForIdea`. `setWorkflowContext({ ideaId, ideaTopic })` is called before navigation. The "..." overflow dropdown always contains "Edit title" and "Delete"; when the idea has an adaptation it also contains "Open angles" and (if a draft also exists) "Open Storyboard"; when only a draft exists it also contains "Go to Adapt". The "..." trigger button uses `aria-haspopup="menu"` and `aria-expanded={isMenuOpen}`; the menu container uses `role="menu"` and each item button uses `role="menuitem"`. `openMenuIdeaId` state continues to gate single-open behavior. Inline title-edit (Save/Cancel) replaces the entire action group while active.
7. Inline title editing: when active for a card, the right column shows the text input + Save/Cancel inline (no separate row).
8. AI Rationale section below the top row (when `idea.relevance` exists): green `AI RATIONALE` pill + reason text.
9. "HOW TO MAKE IT STRONGER" improvement bullets section (when `idea.relevance.improvements.length > 0`).
10. User-selected sort preference persisted in session storage; cleared on sign-out.
11. Legacy idea docs without `title`, `improvements`, or rationale `source` render safely via backward-compatible defaults.
12. Trends data still fetched (`/api/trends`) and used for live signals count shown per card; trends sidebar panel removed.
13. `openMenuIdeaId` state tracks which card's "..." dropdown is open; only one open at a time.

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

### Screen 5a — Storyboard Index (`/storyboard`)
**Route:** `src/app/(app)/storyboard/page.tsx`
**Pattern:** Client component; reads auth state then streams all storyboard records (the underlying `users/{uid}/drafts` collection) via Firestore `onSnapshot`.
**Sections:**
1. Reads `uid` from `onAuthStateChanged`; queries `users/{uid}/drafts` ordered by `updatedAt` descending via realtime snapshot.
2. Recycling banner: derives a per-record "fresh / refresh / repurpose" verdict from `updatedAtMs` (≥ 60 days → refresh; ≥ 120 days → repurpose) and surfaces a yellow banner listing the top 6 stale records with one-click `Refresh` / `Repurpose` deep links into `/storyboard/{ideaId}?angleId={angleId}`.
3. Displays a list of storyboard cards; each shows `ideaTopic`, `angleTitle`, status badge (`storyboard` by default), recycle badge when stale, and formatted `updatedAt` timestamp.
4. Each card links to `/storyboard/{ideaId}?angleId={angleId}`.
5. Card-level **Delete** removes the underlying `users/{uid}/drafts/{id}` document with a confirm prompt.
6. "**+ New Storyboard**" button reads `workflowContext` from `localStorage`; if `ideaId` is set, links to `/angles?ideaId={ideaId}`; otherwise falls back to `/ideas`.
7. Empty-state renders a dashed bordered panel with CTA back to `/ideas` (or angles if context present).
8. Loading state shows `<Spinner size="sm" />`; Firestore errors show inline red message.

#### Pipeline-stub landing pages
- `/drafts` (`src/app/(app)/drafts/page.tsx`) — server component that calls `redirect('/storyboard')` (legacy URL).
- `/adapt/new` (`src/app/(app)/adapt/new/page.tsx`) — **Adapt landing page** (client component). No longer a silent redirect. Reads `uid` from `onAuthStateChanged`, then streams two collections in parallel via Firestore `onSnapshot`:
  - `users/{uid}/adaptations` ordered by `updatedAt` desc — used to render the "Resume an existing adaptation" section. Each card shows `ideaTopic`, `angleTitle`, a chip row of platforms that have non-empty saved copy (LinkedIn / X / Twitter / Medium / Newsletter / Blog), and a primary "Resume →" button linking to `/adapt/{ideaId}?angleId={angleId}`. Empty state renders the copy "No adaptations yet."
  - `users/{uid}/drafts` ordered by `updatedAt` desc — used to render the "Start a new adaptation from a storyboard" section. Storyboards whose `{ideaId}_{angleId}` key already appears in the adaptations collection are filtered out so the user only sees storyboards that don't already have an adaptation. Each card shows `ideaTopic`, `angleTitle`, and a primary "Adapt this →" button linking to `/adapt/{ideaId}?angleId={angleId}` (the dynamic Adapt page handles the "no adaptation yet" case via its existing fallback path). Empty state renders "Finish a storyboard first to adapt it."
  - When the user has zero storyboards at all, a third small hint card appears with a link back to `/storyboard` ("Go to Storyboard →").
  - Header copy is "Pick a storyboard to adapt for platforms" + the subtitle "Adapt converts a storyboard into LinkedIn / X / Medium / Newsletter / Blog copy."
  - Loading state renders `<Spinner size="sm" />`; Firestore errors render an inline red message. Uses `surface-card`, `section-title`, `pill`, and `muted-copy` utility classes from `globals.css` for visual consistency with the rest of the app.
- `/storyboard/new` (`src/app/(app)/storyboard/new/page.tsx`) — **Storyboard-new landing page** (client component). Reads `uid` from `onAuthStateChanged`, then probes `users/{uid}/drafts` with `limit(1)`. If the user already has at least one storyboard, calls `router.replace('/storyboard')` so the existing index lists their work; if they have zero, renders an explainer card with the copy "A storyboard is the long-form draft we generate from your selected angle." plus a primary CTA "Pick an idea →" linking to `/ideas`. Loading state renders `<Spinner size="sm" />`.
- `/drafts/new` (`src/app/(app)/drafts/new/page.tsx`) — same shape as `/storyboard/new` (zero-storyboard explainer card + redirect to `/storyboard` when at least one exists). Kept so legacy deep links land on a guided page instead of a silent redirect.

These landing pages replace the previous `redirect('/storyboard')` stubs, ensuring that clicking the Pipeline-nav verb (Adapt, Storyboard, etc.) lands on a page that explains the verb and offers the right next action. The dynamic `/drafts/[id]` route is preserved as the original draft editor (Screen 5) and remains used by deep links from the Review queue and the `/api/drafts/*` flow; new entry points route through `/storyboard/[id]` (Screen 5b). The sidebar Pipeline-group "Adapt" link continues pointing to `/adapt/new`, which is now the Adapt landing page rather than a redirect.

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
**Layout Notes:** Single editor workspace with one source-of-truth textarea, a floating in-place inline AI editor, an in-editor sentence-diff stack for AI chat proposals, and a right-side AI change timeline for rollback. A sticky `<DocumentContextHeader />` ("Editing: <idea topic> · <angle title>" with a right-aligned "Step 3 of 6" pill) renders directly beneath the WorkflowStepper so the user keeps a persistent anchor across the Storyboard → Adapt → Publish jump.
**Breadcrumb:** `Angles → Storyboard (Active) → Adapt → Review → Publish` — labels and final word match the canonical `PIPELINE_STEPS` (never `Schedule`).
**Sections:**
1. Storyboard content is edited in a textarea (`ref={editorRef}`); generation, debounced autosave (2 s), manual save, source extraction, and adaptation handoff behavior remain intact. Initial draft generation now grounds citations against live DuckDuckGo search results derived from the selected idea/angle context and rewrites the final `## Sources` block to those vetted URLs instead of returning model-invented links.
2. Selection capture uses textarea selection offsets (`selectionStart`/`selectionEnd`) and also computes an approximate in-editor anchor point so prompt/diff controls float at the current edit location.
3. Inline AI editing keeps the textarea editable at all times; users can continue manual edits while a pending AI proposal is visible.
4. A floating `InlineEditPanel` renders over the editor near the active selection, containing instruction input + propose action and contextual `Keep`/`Undo` controls for pending proposals.
5. Pending proposals render in-place diff snippets with red strike-through (`bg-rose-100 text-rose-700 line-through`) for original text and green highlight (`bg-emerald-100 text-emerald-800`) for suggested text; separately, a right-side AI change timeline records applied AI mutations (generation, toolbox rewrites, kept chat diffs, accepted inline edits) and lets the user restore any captured snapshot.
6. No-op AI proposals are handled explicitly and displayed as `No changes suggested.` in the floating panel.
7. Storyboard AI chat is available again through `DraftChatPanel`; chat requests use `POST /api/drafts/chat` with current draft context and conversation history.
8. When chat returns `<UPDATED_DRAFT>`, the page computes sentence/span diffs between current text and AI output, without replacing the entire document.
9. Pending chat diffs render inside the editor surface with red strike-through old text and green replacement text, each with independent `Keep` and `Undo` controls.
10. `Keep` applies only the targeted sentence/span replacement, rebases nearby spans when possible, and marks overlapping unresolved proposals as conflicts.
11. `Undo` removes only the targeted pending sentence/span proposal and preserves all other pending diffs and manual edits.
12. Reference parsing supports case-insensitive `Sources` / `References` headings (ATX headings like `## Sources` and Setext-style headings), with numbered lists (`1.`/`1)`), bulleted lists (`-`/`*`/`+`), and plain URL lines. Entries support markdown links (`[label](url)`) and bare `http(s)` URLs, tolerate mixed indentation, trailing whitespace, and optional two-space markdown line breaks, deduplicate by canonical URL, and render valid links as clickable entries in the bottom References panel. If a source/reference heading exists but no valid links are extracted from section parsing, the parser falls back to scanning reference-style list lines across the draft so numbered markdown links under `## Sources` are still detected. Malformed URL-like references are surfaced as validation warnings.
13. **Orphan-idea error path:** when the storyboard's parent idea (`users/{uid}/ideas/{ideaId}`) cannot be found during context resolution, the editor renders the existing red-error card with the copy "This storyboard's idea was deleted. Open the Dashboard to clean it up." plus two buttons: a primary "Open Dashboard" link to `/dashboard` (where the "Clean up orphans" admin card from Screen 2 surfaces the cleanup action) and a secondary outlined "Back to Angles" link. Existing error styling is preserved.

---

### Screen 6 — Multi-Channel Adaptation (`/adapt/[id]`)
**Route:** `src/app/(app)/adapt/[id]/page.tsx`
**Pattern:** Client component using `useParams()` plus query `angleId` to resolve the draft-to-adapt handoff.
**Layout Notes:** Platform generation + tabbed editor workspace; each platform editor supports floating inline edit controls, an embedded AI chat panel that emits sentence-level in-editor diffs, and a right-side AI timeline that restores prior AI-applied states for the active platform. A sticky `<DocumentContextHeader />` ("Editing: <idea topic> · <angle title>" with a right-aligned "Step 4 of 6" pill) renders directly beneath the WorkflowStepper so the user keeps the same persistent editing anchor used on Storyboard.
**Breadcrumb:** `Angles → Storyboard → Adapt (Active) → Review → Publish` — labels and final word match the canonical `PIPELINE_STEPS` (never `Schedule`).
**Sections:**
1. Uses `localStorage['adapt_draft_context']` as a fast-path when it matches the route (`ideaId` + `angleId`). If local context is missing, invalid, or route-mismatched, the page falls back to Firebase lookups (`users/{uid}/ideas/{ideaId}`, `users/{uid}/ideas/{ideaId}/workflow/angles`, and `users/{uid}/drafts/{ideaId}_{angleId}`) to rebuild a valid adaptation context instead of hard-failing immediately.
2. If the storyboard draft document is missing during Firebase fallback resolution, Adapt builds a deterministic scaffold draft from idea + selected angle summary/sections so platform generation remains usable.
3. Uses Firestore `users/{uid}/adaptations/{ideaId}_{angleId}` to load previously saved adaptation state for the signed-in user and merge saved platform copy over the draft-seeded defaults.
4. Seeds `linkedin`, `twitter`, `medium`, `newsletter`, and `blog` platform editors from the current draft content when no adaptation doc exists yet.
5. Platform tab buttons are fully stateful; clicking a tab changes the active platform and swaps the center editor/preview to that platform only. Only platform tabs are rendered now; persona rewrites apply directly into the active platform editor and do not create extra tabs or side variants.
6. Editing updates only the currently active platform text. The textarea is disabled (`disabled={isAdaptationLoading}`) while the Firestore adaptation document is still being fetched, preventing any user input from being silently overwritten by the async load.
7. Each active platform exposes an explicit `Generate <Platform>` button that calls `POST /api/drafts/adapt` using the original draft source (`adapt_draft_context.draftContent`) plus platform-specific prompt rules; the API route aborts provider calls after 5 minutes (300 seconds) and returns HTTP 504 with a timeout-specific error, while the client keeps a slightly longer local `AbortController` guard (~302 seconds) so the normal slow-provider path still surfaces the server timeout response first. Hung requests still clear the generating spinner, timeout/failure feedback is shown inline near the editor controls, and healthy providers still replace the active platform copy with the returned AI output.
8. Platform text plus `activePlatform` auto-save to Firestore with a 1.5 s debounce; visible save status appears in the page header, and the "Save as Draft" action triggers an immediate Firestore write.
9. AI chat is restored in Adapt via `DraftChatPanel`; it calls `POST /api/drafts/chat` with the active platform text as `draft`, stores conversation history per platform, and tracks provider metadata per platform.
10. Chat `<UPDATED_DRAFT>` output is converted to sentence/span diffs for the active platform instead of replacing the full textarea value.
11. Pending chat diffs render in the active platform editor with red old text and green new text; `Keep`/`Undo` actions are scoped to a single diff entry.
12. Keeping one diff applies only that span, preserves surrounding manual edits, and rebases or conflict-marks remaining pending diffs for that platform.
13. AI Content Tools on Adapt apply directly to the active platform editor. Tone, readability, research, plagiarism rewrites, and persona rewrites all update the current platform copy in place; the persona UI accepts one persona target at a time and behaves like the tone presets rather than generating multiple variants.
14. Adapt also enables a `Similar posts` AI tool tab that searches for linked topic-adjacent posts, optionally biases results toward competitor terms, and summarizes overlap and differentiation opportunities against the current active platform draft.
15. Optimization tools call `POST /api/drafts/analyze` against the active platform text and render visible result panels for:
   - `📈 SEO Optimizer`
   - `🔍 AI Check` (backed by `type='plagiarism'`)
   - `🔗 Source Check`
   When a configured non-Ollama AI key exists, the route keeps using the existing AI-backed prompt/call/parse flow. When the active provider is non-Ollama and no key is configured, the route returns deterministic, schema-compatible fallback outputs per tool based on the currently active platform copy instead of surfacing a shared missing-key failure.
16. The active platform editor also shows a right-side AI timeline that records applied AI changes from generation, toolbox actions, chat-diff keeps, and accepted inline edits; selecting a timeline item restores that active-platform snapshot.
17. Preview card renders the active platform copy and a per-platform word-count snapshot, with no hardcoded demo content.
18. Right-hand trends sidebar consumes live `/api/trends` data and shows truthful loading, error, or empty states instead of placeholder topics/articles.
19. Breadcrumb marks `Multi-Channel Adaptation` as the active workflow step; the primary completion CTA saves the current adaptation, preserves exact `ideaId` + `angleId` workflow context, and routes directly to `/publish`.
20. The Adapt editor shares Storyboard inline editing UX: floating in-place prompt/diff controls anchored near current selection, red/green inline diff preview in the floating panel, and direct textarea editability while AI proposals are pending.
21. Adapt inline editing and chat preview avoid duplicate revised-text surfaces by using the same active textarea as the only authoritative editing surface.

---

### Screen 7 — Publishing & Scheduling (`/publish`)
**Route:** `src/app/(app)/publish/page.tsx`
**Layout Notes:** Library-style scheduling workspace that lists every saved adaptation for the signed-in user, with per-adaptation platform cards, edit/delete controls, schedule pickers, and a global upcoming schedule list. When the user arrives via Adapt's "Save and continue" CTA (i.e. `workflow_context` localStorage holds a single `ideaId` + optional `angleId`), a sticky `<DocumentContextHeader />` ("Editing: <idea topic> · <angle title>" with a right-aligned "Step 6 of 6" pill) renders at the top of the page so the editing anchor persists from Storyboard → Adapt → Publish. The header is hidden in the multi-adaptation library view (no workflow context).
**Sections:**
1. Loads all adaptation documents in realtime from `users/{uid}/adaptations` ordered by `updatedAt desc` and renders each adaptation as its own scheduling block.
2. Each adaptation block shows idea + angle labels and an `Edit Adaptation` route action that deep-links to `/adapt/{ideaId}?angleId={angleId}`.
3. Per-adaptation cards render for every platform present in the adaptation's `platforms` map. The canonical platform list is `linkedin | twitter | medium | newsletter | blog` (matching `frontend/src/lib/prompts/platforms/index.ts`); a card renders when there is saved content for that platform OR when the user has clicked Edit on a previously-empty platform.
4. LinkedIn card has a one-click compose handoff:
  - attempts `navigator.clipboard.writeText(linkedinText)`
  - opens `https://www.linkedin.com/feed/?shareActive=true` in a new tab
  - shows explicit status message for copied-success or clipboard-blocked fallback guidance
5. X/Twitter card has a one-click intent handoff: opens `https://twitter.com/intent/tweet?text=...` with URL-encoded prefilled text.
6. Medium / Newsletter / Blog cards have NO provider compose-URL handoff (those platforms do not expose a one-click intent URL) — they offer "Copy text" + "Schedule reminder" instead, so users paste into their own publishing tool (Medium editor, email tool, or CMS).
7. All platform cards include content textareas, explicit `Copy` buttons (label adapts per platform), and card-level `Edit` / `Delete` controls.
8. Card-level `Edit` enables in-card text editing for the selected adaptation + platform and persists to `users/{uid}/adaptations/{adaptationId}`.
9. Card-level `Delete` removes the selected platform field from `users/{uid}/adaptations/{adaptationId}`; once removed, that platform card is hidden from the Publish UI.
10. Platform-specific schedule pickers persist reminders to `users/{uid}/scheduledPosts` with adaptation/article metadata, `scheduledForMs` timestamp, and `platforms: [<platformKey>]` where `<platformKey>` is one of `linkedin | twitter | medium | newsletter | blog`.
11. Publish renders upcoming scheduled posts from Firestore so users can verify queued reminders and dates across all adaptations.
12. Clear UX states are present for loading, signed-out/config errors, empty adaptation library, schedule validation errors, and successful publish/schedule actions.

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
**Layout Notes:** Sticky in-page nav (left rail at `lg:` and up; horizontal scroll-snap pill row on mobile) groups settings into five ordered groups with anchor-link smooth scrolling. Each section keeps its own `surface-card` container and uses an `id` matching the nav anchor. All sections remain reachable by scrolling — the nav does NOT hide content behind a click. Required-setup nav items render an amber "needs attention" dot (and the section header shows a "Needs attention" pill) when the setting is unconfigured: AI API Keys lights up when the active provider has no key (ollama is treated as always-configured, otherwise checks `getActiveAIKey()` from `src/lib/aiConfig.ts` plus the live in-memory key), and Company Profile lights up when `companyName` is empty (using the cached `loadCompanyProfile`).
**Section groups (ordered):**
1. **Required setup** — sections every user must complete for the app to work.
   1. **AI API Keys** (`#ai-keys`) — select active provider (OpenAI / Gemini / Claude / Local Ollama); provider key inputs plus Ollama base URL and model; Save button calls `saveAIConfig` and shows "Saved!" toast; config loaded via `useEffect` from `loadAIConfig()` in `src/lib/aiConfig.ts`. First card under Required setup so a new user does not have to scroll past placeholder cards.
   2. **Company Profile** (`#company-profile`) — full Company Profile form (companyName, industry, description, products, services, valueProposition, targetMarket, keyDifferentiators, brandVoice). Includes the "Auto-fill from website" panel that POSTs to `/api/company/autofill` using the active AI provider key. Save persists via `saveCompanyProfile` to Firestore at `users/{uid}.companyContext` and the local cache.
2. **Brand & voice**
   1. **Brand Voice Editor** (`#brand-voice`) — textarea persisted alongside the brand-voice field. (Currently a non-persisted textarea; the canonical brand voice is the `brandVoice` field on `users/{uid}.companyContext` written by Company Profile.)
3. **Integrations**
   1. **Integration Connectors** (`#integrations`) — LinkedIn connect/disconnect flow plus per-user and app-owner setup guidance (full behavior documented below).
   2. **Research source** (`#research-source`) — optional Exa AI key field; saved via `saveExaKey` (`src/lib/exaConfig.ts`) to localStorage; when present, drafts use Exa instead of DuckDuckGo for source retrieval.
4. **Advanced (preview)** — placeholder/preview features grouped together so they can be labelled "Coming soon" in a follow-up UX pass.
   1. **Compliance Flags** (`#compliance-flags`) — placeholder.
   2. **Audit Log Viewer** (`#audit-log`) — placeholder.
   3. **Security Settings** (`#security-settings`) — placeholder.
5. **Session**
   1. **Sign out** (`#session`) — Firebase `signOut` with spinner feedback while logout is in progress.

**Integration Connectors behavior:**
- Settings loads provider connection summaries for the signed-in Firebase user from the FastAPI backend via `GET {NEXT_PUBLIC_API_URL}/api/v1/integrations/status?userId={uid}`.
- The section explains that LinkedIn automatic-posting authorization is saved per user, not shared across all dashboard users.
- LinkedIn card behavior:
  - shows a status badge (`Connected`, `Disconnected`, or `Not connected`)
  - shows saved account metadata such as display name/email, scopes, connected timestamp, token-expiry timestamp, and publish identity URN when present
  - shows `Connect LinkedIn` when no active connection exists; clicking it calls `POST {NEXT_PUBLIC_API_URL}/api/v1/auth/linkedin/start` with `{ userId, redirectAfter: '/settings' }` and redirects the browser to the backend-generated LinkedIn OAuth URL
  - shows `Disconnect LinkedIn` when connected; clicking it calls `POST {NEXT_PUBLIC_API_URL}/api/v1/integrations/linkedin/disconnect`
- After LinkedIn OAuth returns to `/settings?integration=linkedin&status=...`, the page shows a success/error notice and then removes the query string with `router.replace('/settings')`.
- The section includes explicit setup guidance for:
  - each end user: sign in, open Settings, click Connect LinkedIn, approve permissions, confirm the Connected badge
  - the app owner: configure the LinkedIn developer app, backend callback URL, backend env vars, and `NEXT_PUBLIC_API_URL`
- Other providers from the backend registry are rendered as informational cards so users can see future provider slots even though their dedicated UI connect flows remain TODO.

**Integration Client Library:** `src/lib/integrations.ts`
- `getBackendApiBaseUrl()` — resolves `NEXT_PUBLIC_API_URL` and falls back to `http://localhost:8000` in development.
- `listIntegrationConnections(userId)` — fetches provider connection summaries from the FastAPI backend.
- `startLinkedInConnection(userId, redirectAfter?)` — requests the backend-generated LinkedIn OAuth URL.
- `disconnectIntegration(provider, userId)` — disconnects a saved provider connection.

**AI Config Library:** `src/lib/aiConfig.ts`
- `AIProvider = 'openai' | 'gemini' | 'claude' | 'ollama'`
- `AIConfig = { provider, openaiKey, geminiKey, claudeKey, ollamaBaseUrl, ollamaModel }`
- `saveAIConfig(config)` — persists to `localStorage['ai_config']`
- `loadAIConfig()` — reads from localStorage, returns defaults on missing/error
- `getActiveAIKey()` — returns `{ provider, apiKey }` for the current active provider

**Company Profile Library:** `src/lib/companyProfile.ts`
- `CompanyProfile` shape: `companyName`, `companyDescription`, `industry`, `products`, `services`, `valueProposition`, `targetMarket`, `keyDifferentiators`, `brandVoice` (all strings).
- Persistence: Firestore at `users/{uid}` doc, field `companyContext`. Mirrored to `localStorage['company_profile_cache']` so unauthenticated/cached reads still resolve a profile.
- API:
  - `loadCompanyProfile(userId | null)` — loads from Firestore when uid provided, else returns the local cache. Falls back to cache if Firestore is unavailable or empty.
  - `saveCompanyProfile(uid, profile)` — writes Firestore doc (merge) + cache.
  - `loadCompanyProfileFromCache()` — synchronous cache-only read.
  - `companyProfileToContextLines(profile)` — returns `string[]` of "Field: value" lines for non-empty fields; suitable to send as `companyContext: string[]` to AI endpoints.
  - `companyProfileToTrendTerms(profile, limit?)` — returns short keyword/phrase tokens (length 2–60) extracted from `industry`, `products`, `services`, `targetMarket`, and `keyDifferentiators`, deduplicated and capped (default `limit = 6`). Used by the Ideas and Angles pages to bias the `/api/trends` search via the `companyTerms` query string.
  - `companyProfileToPromptBlock(profile)` — returns a single multi-line "Company context:" block, or `null` when empty.
- Used by Settings (`/settings`) "Company Profile" section to load/save, and consumed by every AI feature that accepts a `companyContext` field (see API Integration).

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

- `/api/trends` is a Next.js route handler that fetches public Bing News RSS feeds for marketing/AI/SEO queries, extracts direct publisher URLs from the feed redirect links, deduplicates the results, and returns live topics + clickable article links for the ideas page. It also accepts an optional `companyTerms` query string (comma-separated terms derived from the saved Company Profile via `companyProfileToTrendTerms`) and uses it to (a) issue up to four extra Bing News searches built from those terms (e.g. `"<industry> marketing"`, `"<product> content strategy"`), (b) boost ranking of returned articles whose title matches any company term, and (c) prepend topic-rule labels derived from the same terms so the ideas/angles trend panels surface company-relevant clusters first. The response payload includes `companyTermsApplied: string[]` for transparency.
- `/api/angles` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, idea, count, selectedAngleId?, refinementPrompt?, companyContext? }`, calls OpenAI (`gpt-4o-mini`), Gemini (tries `gemini-2.0-flash`, then `gemini-2.0-flash-lite`, then `gemini-1.5-flash-latest`), Claude (`claude-3-5-haiku-latest`), or local Ollama (`/api/generate`), robustly parses JSON output (including fenced JSON fallback), validates angle schema, and returns structured `angles[]` or typed errors.
- `/api/angles` degrades gracefully: when provider calls fail or model output cannot be parsed, the route returns deterministic fallback angles (HTTP 200) with an `error` message describing the provider failure, so the UI does not hard-fail with a 502.
- In `src/app/api/angles/route.ts`, Ollama calls are routed through `fetchOllama(apiKey, prompt, baseUrl, model)`; both `baseUrl` and `model` are required in the helper signature to keep request logging, validation, and request construction type-safe.
- `/api/drafts` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, idea, angle, companyContext? }`, builds a long-form draft prompt from selected idea + angle outline, runs a live DuckDuckGo grounding search using the idea topic + angle title + audience, and only approves citations that map to that retrieved source list. After the provider responds, the route rewrites the trailing `## Sources` section from the approved URLs and strips unsupported citation markers so model-invented links do not reach the client. The response returns `{ draft, provider, promptUsed?, modelText?, citationValidation, searchProvider?, searchQuery? }` on success. If the provider call fails, the route still returns HTTP 200 with a deterministic fallback markdown draft plus observability metadata `{ source: 'fallback', fallbackReason }`, and when live grounding sources are available the fallback sources block also uses those retrieved URLs.
- `/api/drafts/adapt` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, platform, sourceDraft, currentPlatformDraft?, companyContext? }`, resolves platform-specific prompt rules from `src/lib/prompts/platforms/*`, calls the configured AI provider, aborts the provider request after 5 minutes (300 seconds), and normalizes abort-like runtime error shapes back into the timeout response path so client-visible timeouts consistently return a JSON error with HTTP 504 instead of a generic HTTP 502 provider failure. Successful calls still return `{ platform, generatedContent, provider }`, and the route does not emit fallback/dummy adaptation text when AI generation fails.
- `/api/drafts/inline-edit` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, selectedText?, instruction, companyContext? }` and supports two response modes from a single endpoint: selected-text mode returns `{ updatedText, changeSummary, provider }`, while no-selection mode returns `{ suggestions: [{ beforeText, afterText, changeSummary }], provider }` with up to three validated suggestions.
- `/api/drafts/chat` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, messages[], userMessage, companyContext? }`, sends the full draft + chat history as context to the AI, logs the assembled prompt plus raw provider response to the server console, and returns `{ reply, updatedDraft | null, provider }`. The AI wraps full draft rewrites in `<UPDATED_DRAFT>…</UPDATED_DRAFT>` tags which the route parses and returns separately from the conversational reply.
- `/api/drafts/analyze` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, type: 'seo' | 'plagiarism' | 'sources', companyContext? }`, runs type-specific analysis prompts, logs the prompt and raw provider response to the server console, robustly parses the AI's JSON response (code-fence fallback included), and returns `{ type, result, provider }`. For non-Ollama providers without an API key, the route returns deterministic per-tool fallback analysis derived from the submitted draft text while preserving the same response schema expected by the Adapt page UI. The optional `companyContext` is only injected for `type: 'seo'` (it biases primary/secondary keywords, meta description, and title suggestions toward the company's product/industry/audience); `plagiarism` and `sources` ignore it because their pattern matching does not benefit from brand framing.
- `/api/drafts/rewrite` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, mode: 'tone'|'readability', tone?, complexityLabel?, complexityDescription?, audienceHint?, fleschTarget?, companyContext? }`. The system prompt appends a "Company context" block (preserve product references and brand voice) when `companyContext` is non-empty.
- `/api/drafts/personas` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, personas[], companyContext? }`. The user prompt appends a "Company context" block so persona rewrites stay consistent with the company's product references and brand voice. The current Storyboard/Adapt UI sends one persona target at a time and applies the first returned rewrite directly into the active editor.
- `/api/drafts/headlines` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, draft, topic?, audience?, count?, companyContext? }`. The user prompt appends a "Company context" block to ground headline product references and brand voice.
- `/api/drafts/research` accepts `{ provider, apiKey, ollamaBaseUrl?, ollamaModel?, topic?, audience?, draft?, query?, companyContext? }`. The user prompt appends a "Company context" block so the brief biases toward findings that fit the company's industry, audience, and product. The DuckDuckGo web-search query itself is NOT modified by company context — only the synthesis prompt is.
- `/api/drafts/plagiarism` does NOT accept `companyContext`. The route runs a verbatim-quote web search plus an AI heuristic review of the draft text; brand framing has no effect on either pass and would only add prompt noise.
- `/api/ideas/rationale` already receives company info via the existing `personalizationContext.company` field (extracted from the same `users/{uid}.companyContext` Firestore field that `loadCompanyProfile` reads/writes). No additional wiring was required.
- `/api/trends` does not receive `companyContext` (the route never calls an AI provider) but it now consumes a `companyTerms` query string derived from the same Company Profile to bias the underlying Bing News searches and to re-rank/cluster results around company-relevant terms. See the `/api/trends` entry above for details.

**Client wiring for `companyContext`:**
- `src/lib/useInlineEdit.ts` (used by Storyboard and Adapt) loads `companyProfileToContextLines(loadCompanyProfile(null))` (cache-only) and passes `companyContext` on each `/api/drafts/inline-edit` call.
- `src/components/AIToolbox.tsx` (mounted on Storyboard and Adapt) loads the cached profile and passes `companyContext` on `/api/drafts/rewrite`, `/api/drafts/personas`, `/api/drafts/headlines`, and `/api/drafts/research`.
- Storyboard page (`src/app/(app)/storyboard/[id]/page.tsx`) loads the profile via `loadCompanyProfile(currentUid)` and passes `companyContext` on `/api/drafts` (initial generation) and `/api/drafts/chat` (chat assistant).
- Adapt page (`src/app/(app)/adapt/[id]/page.tsx`) loads the profile via `loadCompanyProfile(currentUid)` and passes `companyContext` on `/api/drafts/adapt` (per-platform generation), `/api/drafts/analyze` (SEO), and `/api/drafts/chat` (per-platform chat).
- Angles page (`src/app/(app)/angles/page.tsx`) loads the profile via `loadCompanyProfile(currentUid)` and passes `companyContext` on `/api/angles` for both initial sequential generation and refinement requests.
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
- Legacy routes:
  - `/drafts` -> `/storyboard` (server-side redirect)
  - `/drafts/[id]?angleId=...` -> `/storyboard/[id]?angleId=...`
- `/drafts/new` and `/storyboard/new` are no longer silent redirects; they render explainer landing pages when the user has zero storyboards and only redirect to `/storyboard` when at least one storyboard exists. See the **Pipeline-stub landing pages** subsection under Screen 5a for the full landing-page contract.
- `/adapt/new` is also a real landing page that lists existing adaptations to resume and storyboards available to adapt. See the **Pipeline-stub landing pages** subsection under Screen 5a.
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

