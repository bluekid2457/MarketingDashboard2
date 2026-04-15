$body1 = @'
## Problem
The Marketing Dashboard has 12 screens defined in `specs/screens.md` (with reference images in `specs/screens/`), but the Next.js frontend currently only has a single landing `page.tsx` with no routing, no navigation layout, and no screen implementations. Users cannot navigate between any of the core features.

## Proposed Solution
Scaffold all 12 screens as Next.js App Router pages, implement a persistent sidebar/top navigation component that links every screen, and add a root layout wrapper that renders navigation on all authenticated pages. Each screen should render its defined components (even as stubs) so that routing and navigation are fully functional end-to-end.

**Screens to implement (from `specs/screens.md`):**
1. `/login` — Login & Authentication Screen
2. `/dashboard` — Dashboard (Main Overview)
3. `/ideas` — Idea Input & Backlog Screen
4. `/angles` — AI Angle Selection & Outline Screen
5. `/drafts/[id]` — Draft Editor Screen
6. `/adapt/[id]` — Multi-Channel Adaptation Screen
7. `/publish` — Publishing & Scheduling Screen
8. `/review` — Review & Approval Workflow Screen
9. `/analytics` — Analytics & Performance Screen
10. `/collaboration` — Collaboration & Client Management Screen
11. `/settings` — Settings & Compliance Screen
12. `/notifications` — Error & Notification Screen

**Navigation:**
- Shared `<Sidebar>` or `<TopNav>` component listing all screens with active-link highlighting
- Root authenticated layout at `src/app/(app)/layout.tsx` rendering navigation + `{children}`
- `/login` uses a separate unauthenticated layout

## Acceptance Criteria
- All 12 routes exist and return a 200 with the correct page title/heading
- Navigating to any route from any other route works without a full page reload
- Active route is visually highlighted in the navigation component
- `/login` does not render the main navigation layout
- All pages are TypeScript with no type errors (`npm run build` passes)
- Each page renders at minimum its screen name as a heading and stub component placeholders matching the sections listed in `specs/screens.md`
- Navigation component is extracted into `src/components/Nav.tsx` (or equivalent) and reused via layout

---

# TIP for Issue #1: Scaffold All 12 Screens with Navigation

## 1. Issue Summary
Scaffold all 12 Marketing Dashboard screens as Next.js App Router pages and wire them together with a shared navigation component, enabling full client-side routing across the application.

## 2. Root Cause / Motivation
The frontend is a single-page stub. No routing routes, navigation layout, or screen scaffolds exist. Without these, no feature work can begin on any specific screen — every issue that adds UI to a screen is blocked until routes are reachable.

## 3. Database Schema Changes
None required for this issue.

## 4. API Endpoint Changes
None required. Pages render stub content; API integration is handled by future issues.

## 5. Next.js Frontend Changes (UI/UX)

### Route Group: `(app)` — authenticated screens
Create `src/app/(app)/layout.tsx` as the shared authenticated layout:
- Renders `<Sidebar>` (or `<TopNav>`) + `{children}`
- Does NOT wrap `/login`

### Route Group: `(auth)` — unauthenticated screens
Create `src/app/(auth)/login/page.tsx` using a minimal centered layout without navigation.

### Pages to create (all under `src/app/(app)/`):
| Route | File | Screen Name |
|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | Dashboard |
| `/ideas` | `ideas/page.tsx` | Idea Input & Backlog |
| `/angles` | `angles/page.tsx` | AI Angle Selection & Outline |
| `/drafts/[id]` | `drafts/[id]/page.tsx` | Draft Editor |
| `/adapt/[id]` | `adapt/[id]/page.tsx` | Multi-Channel Adaptation |
| `/publish` | `publish/page.tsx` | Publishing & Scheduling |
| `/review` | `review/page.tsx` | Review & Approval Workflow |
| `/analytics` | `analytics/page.tsx` | Analytics & Performance |
| `/collaboration` | `collaboration/page.tsx` | Collaboration & Client Management |
| `/settings` | `settings/page.tsx` | Settings & Compliance |
| `/notifications` | `notifications/page.tsx` | Error & Notifications |

### Navigation Component: `src/components/Nav.tsx`
- List of `{ label, href, icon? }` entries for each route above
- Uses Next.js `<Link>` for client-side navigation
- Uses `usePathname()` to highlight the active route
- Tailwind-styled sidebar (collapsible on mobile preferred but not required for this issue)

### Root redirect
- `src/app/page.tsx` redirects to `/dashboard` for authenticated users, `/login` for unauthenticated (can use a simple `redirect('/dashboard')` stub for now)

### Each page stub must include:
- `<h1>` with the screen name
- Placeholder `<section>` blocks for each top-level component listed in `specs/screens.md` for that screen (empty divs with labelled comments are acceptable)

## 6. Environment & Configuration
No new environment variables needed.

## 7. File System Changes
```
frontend/src/
  app/
    page.tsx                          ← update: redirect to /dashboard
    (auth)/
      login/
        page.tsx                      ← new: Login screen stub
    (app)/
      layout.tsx                      ← new: Authenticated layout with Nav
      dashboard/
        page.tsx                      ← new
      ideas/
        page.tsx                      ← new
      angles/
        page.tsx                      ← new
      drafts/
        [id]/
          page.tsx                    ← new
      adapt/
        [id]/
          page.tsx                    ← new
      publish/
        page.tsx                      ← new
      review/
        page.tsx                      ← new
      analytics/
        page.tsx                      ← new
      collaboration/
        page.tsx                      ← new
      settings/
        page.tsx                      ← new
      notifications/
        page.tsx                      ← new
  components/
    Nav.tsx                           ← new: Shared navigation component
```

## 8. Edge Cases & Risks
- **Dynamic routes** (`/drafts/[id]`, `/adapt/[id]`): stubs should handle a missing `id` param gracefully (show a placeholder message).
- **Root `/` redirect**: until auth middleware is added, redirect unconditionally to `/dashboard`.
- **`npm run build` must pass**: all pages must export a default React component with valid TypeScript.
- **Tailwind purge**: ensure all new files are covered by `tailwind.config.ts` content glob (`./src/**/*.{ts,tsx}`).
- Do not implement actual auth guards in this issue — that is a separate security issue.

## 9. Acceptance Criteria
- All 12 routes exist and return a 200 response
- Navigating between any two routes works without full page reload
- Active route is visually highlighted in `<Nav>`
- `/login` does not show the main navigation layout
- `npm run build` exits with code 0, no TypeScript errors
- Each page renders its screen name as `<h1>` and section placeholders per `specs/screens.md`
- `Nav.tsx` is the single source of navigation and is consumed by `(app)/layout.tsx`
'@

gh issue create --title "Scaffold all 12 screens with navigation (stub pages + App Router layout)" --label "marketing-dashboard" --label "frontend" --body $body1
