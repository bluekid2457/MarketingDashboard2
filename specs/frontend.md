# Frontend Specification

This document defines the requirements, architecture, and key behaviors for the Marketing Dashboard frontend (Next.js 16, TypeScript, Zustand, Tailwind CSS).

---

## Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v3
- **State Management**: Zustand v4
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
  setup-screens.sh          # one-shot script to scaffold all screen files + build
  src/
    app/
      layout.tsx            # Root layout: metadata, Inter font, globals.css
      page.tsx              # Redirects / → /dashboard
      globals.css           # @tailwind base/components/utilities
      (auth)/
        login/
          page.tsx          # Screen 1 — Login & Authentication
      (app)/
        layout.tsx          # App shell: <Nav /> sidebar + <main> content area
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
- `src/app/page.tsx` — calls `redirect('/dashboard')` from `next/navigation`; sends all root visits to the dashboard.

### Route groups
- **`(auth)`** — unauthenticated routes (no Nav sidebar). Currently contains `/login`.
- **`(app)`** — authenticated routes wrapped by `AppLayout` which renders `<Nav />` + `<main>`.

---

## Shared Components

### `src/components/Nav.tsx`
- `'use client'` directive (uses `usePathname`).
- Fixed left sidebar, 256 px wide (`w-64`), full viewport height.
- Brand heading "Marketing Dashboard" in indigo.
- 11 nav links with emoji icons; active link highlighted with `bg-indigo-100 text-indigo-700`.
- Active detection: exact match on `pathname` or `pathname.startsWith(base)` (strips `/new` suffix for dynamic links like `/drafts/new`).

### `src/app/(app)/layout.tsx` — AppLayout
- Renders `<Nav />` fixed sidebar + `<main className="flex-1 ml-64 p-8">` content area.
- Wraps all 11 authenticated screens.

---

## Screens

### Screen 1 — Login & Authentication (`/login`)
**Route:** `src/app/(auth)/login/page.tsx`
**Sections:**
1. Email + password sign-in form
2. OAuth provider buttons (Google, GitHub)
3. Forgot password / Create account links
4. Error message placeholder

---

### Screen 2 — Dashboard (`/dashboard`)
**Route:** `src/app/(app)/dashboard/page.tsx`
**Sections:**
1. Content Calendar
2. Idea Backlog Summary
3. Drafts / Review Queue
4. Recent Analytics
5. Quick Links

---

### Screen 3 — Idea Input & Backlog (`/ideas`)
**Route:** `src/app/(app)/ideas/page.tsx`
**Sections:**
1. Idea Input Box (textarea + "Add Idea" button)
2. Tone / Audience / Format dropdowns
3. Ideas List with Scores
4. Sort / Filter Controls
5. Trend Detection Panel
6. Competitor Content Panel

---

### Screen 4 — AI Angle Selection & Outline (`/angles`)
**Route:** `src/app/(app)/angles/page.tsx`
**Sections:**
1. AI-Generated Angles List
2. Inline Editing
3. Selection Controls
4. Error / Retry Messages

---

### Screen 5 — Draft Editor (`/drafts/[id]`)
**Route:** `src/app/(app)/drafts/[id]/page.tsx`
**Pattern:** Async server component; `params: Promise<{ id: string }>` (Next.js 15+ / 16 pattern).
**Sections:**
1. Rich Text Editor placeholder
2. Mid-Draft Prompt Bar
3. Tone / Sentiment Controls
4. Readability / SEO Scoring
5. Persona Targeting
6. A/B Headline Generator
7. Plagiarism / Citation Checker
8. Action Buttons (Save Draft, Submit for Review, Discard)

---

### Screen 6 — Multi-Channel Adaptation (`/adapt/[id]`)
**Route:** `src/app/(app)/adapt/[id]/page.tsx`
**Pattern:** Async server component; `params: Promise<{ id: string }>`.
**Sections:**
1. Platform Selector (LinkedIn, Twitter/X, Medium, Newsletter, Instagram pill buttons)
2. Preview Per Format
3. AI Chat for Editing

---

### Screen 7 — Publishing & Scheduling (`/publish`)
**Route:** `src/app/(app)/publish/page.tsx`
**Sections:**
1. Platform Connection Status
2. Schedule Picker / Calendar
3. Draft Mode Toggle
4. Visual Content Calendar
5. Gap Detection Alerts
6. Submit to Search Engines

---

### Screen 8 — Review & Approval Workflow (`/review`)
**Route:** `src/app/(app)/review/page.tsx`
**Sections:**
1. Draft Queue
2. Inline Editor
3. Version History
4. Approval Chain Controls
5. Comment / Suggestion Layer
6. Role-Based Access

---

### Screen 9 — Analytics & Performance (`/analytics`)
**Route:** `src/app/(app)/analytics/page.tsx`
**Sections:**
1. Engagement Charts
2. Performance History
3. Predictive Scoring
4. Copy Intelligence Insights
5. AI Visibility Tracking

---

### Screen 10 — Collaboration & Client Management (`/collaboration`)
**Route:** `src/app/(app)/collaboration/page.tsx`
**Sections:**
1. Invite / Manage Users
2. Role-Based Access
3. Client Brief Forms
4. Project Calendars
5. White-Label Toggles

---

### Screen 11 — Settings & Compliance (`/settings`)
**Route:** `src/app/(app)/settings/page.tsx`
**Sections:**
1. Brand Voice Editor
2. Compliance Flags
3. Audit Log Viewer
4. Integration Connectors
5. Security Settings

---

### Screen 12 — Error & Notifications (`/notifications`)
**Route:** `src/app/(app)/notifications/page.tsx`
**Sections:**
1. Error Messages
2. Success / Warning Notifications
3. System Alerts

---

## Dynamic Routes — Async Params Pattern (Next.js 15+ / 16)

Both `drafts/[id]` and `adapt/[id]` use the **async params** pattern required by Next.js 15+:

```tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ...
}
```

This is required because `params` is now a Promise in Next.js 15+/16 to support async rendering.

---

## Setup Script

`frontend/setup-screens.sh` is a Bash script that:
1. Creates all required directories with `mkdir -p`.
2. Writes every screen file using `cat << 'ENDOFFILE'` heredocs.
3. Runs `npm run build` and reports pass/fail.

**Usage:**
```bash
bash frontend/setup-screens.sh
```

---

## API Integration

- Next.js API routes at `/api/ai/*` for AI generation (to be implemented)
- `/api/v1/*` proxy to FastAPI backend (to be implemented)
- All API base URLs stored in `process.env.NEXT_PUBLIC_API_URL`

---

## Security

- Sensitive `(app)` routes to be protected via authentication middleware (`src/middleware.ts`)
- Secrets kept in server-side env vars or private Next.js env vars
- `(auth)` route group is public (no middleware guard)

