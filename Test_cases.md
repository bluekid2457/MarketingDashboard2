# Test Cases Report

Date: 2026-04-18
Environment: Local app at http://localhost:3000, Windows, browser automation session
Tester account: qa@example.com

## Scope and Method
- Ran iterative UI sweeps across auth pages and all primary in-app routes.
- For each page, captured at least one positive behavior and one negative or edge behavior.
- Recorded working and non-working outcomes based on visible UI state, route transitions, inline validation messages, and console/runtime/network signals.

## Global Findings
### Working
- Auth guard behavior works (protected pages redirect to auth when logged out).
- Logged-in shell/navigation renders consistently across pages.
- Most static screen sections and route transitions render as expected.

### Not Working / Risky
- Repeated Firestore long-poll request failures were observed during many flows (`net::ERR_ABORTED`).
- `/angles?ideaId=<id>` repeatedly stalls on `Loading selected idea...` and does not progress.
- `/ideas` can enter persistent `Saving...` state after successful row insertion signal.
- `/adapt/new` logs a React duplicate key error (`Zero-Click Search`).

## Page-by-Page Test Cases

## 1) Login (`/login`)
### Positive
- Sign-in with valid credentials (`qa@example.com` / `Sample!`) transitions to `/dashboard`.
- Sign-in button enters disabled `Signing In...` state during auth.

### Negative / Edge
- Invalid credentials show inline error: `Invalid email or password. Please try again.`

Status: PASS with expected validation behavior.

## 2) Register (`/register`)
### Positive
- Registration form renders for logged-out users with email/password/confirm fields.
- `Sign in` link routes to `/login`.

### Negative / Edge
- Mismatched passwords show inline error: `Passwords do not match.`

Status: PASS for rendered flow and validation.

## 3) Dashboard (`/dashboard`)
### Positive
- Main sections render: Campaign Command Center, cards, calendar, queue, quick links.
- Route loads after successful auth.

### Negative / Edge
- Quick link `Open review queue` showed active/focus state but no observable route/state change in this run.

Status: PARTIAL (core render works; one quick link interaction appears non-functional).

## 4) Ideas (`/ideas`)
### Positive
- Idea page renders with form, filters, and selected idea panel.
- Valid idea submission displays a new row and increments `Ideas saved` count.

### Negative / Edge
- Empty submission blocked with `Idea text is required.`
- Too-short submission blocked with `Idea text should be at least 8 characters so it is useful later.`
- Multiple runs showed persistent `Saving...` button state with Firestore write-channel failures.

Status: PARTIAL (validation works; persistence flow appears unstable).

## 5) Angles (`/angles` and `/angles?ideaId=...`)
### Positive
- Base route `/angles` correctly shows fallback: `Choose an Idea First` with `Go to Ideas` button.
- `Back to Angles` from draft fallback returns to `/angles` fallback state.

### Negative / Edge
- From Ideas, `Generate Angles` navigates to `/angles?ideaId=<id>` but page stays on:
  - `Idea: Not selected yet`
  - `Loading selected idea...`
- Reproduced repeatedly with multiple fresh idea IDs.

Status: FAIL (blocking defect on selected-idea flow).

## 6) Analytics (`/analytics`)
### Positive
- Page renders expected sections: Engagement Charts, Performance History, Predictive Scoring, Copy Intelligence, AI Visibility Tracking.

### Negative / Edge
- No interactive controls with observable state change were available in this screen during test.

Status: PASS (render-only coverage).

## 7) Collaboration (`/collaboration`)
### Positive
- Page renders expected modules: Invite/Manage Users, Role Access, Briefs, Calendars, White-label controls.

### Negative / Edge
- `Invite teammate` button click did not produce visible modal/state transition in this run.

Status: PARTIAL (render works; interaction outcome unclear/non-observable).

## 8) Publish (`/publish`)
### Positive
- Page renders platform status, schedule area, mode toggle, and submit controls.
- `Publish` mode button toggles active state.

### Negative / Edge
- `Submit to Search Engines` click did not produce visible confirmation/error feedback.

Status: PARTIAL (core UI works; action feedback missing).

## 9) Review (`/review`)
### Positive
- Review screen renders draft queue, version history, approval chain, comments, role-access notes.

### Negative / Edge
- No direct mutation controls with observable output were available in this static review layout run.

Status: PASS (render-only coverage).

## 10) Notifications (`/notifications`)
### Positive
- Screen renders error/success/system alert sections with expected content.

### Negative / Edge
- No actionable controls available to validate acknowledgment/clear behavior.

Status: PASS (render-only coverage).

## 11) Settings (`/settings`)
### Positive
- Settings screen renders all key groups including AI provider/key settings.
- `Save` button shows visible success feedback (`Saved!`).
- `Log out` successfully returns to `/login`.

### Negative / Edge
- No explicit validation/error surfaced when saving existing values (cannot verify invalid-key handling from UI-only run).

Status: PASS (core save/logout confirmed).

## 12) Drafts (`/drafts/new`)
### Positive
- Draft editor route loads and shows workflow header.

### Negative / Edge
- Missing draft context fallback shown: `No draft context was found. Generate and select an angle first.`
- `Back to Angles` returns to `/angles` fallback page.

Status: PASS (fallback behavior works).

## 13) Adapt (`/adapt/new`)
### Positive
- Adaptation page renders complex editor/chat/preview/tooling layout.

### Negative / Edge
- Console runtime error observed:
  - Duplicate React key warning (`Encountered two children with the same key ... Zero-Click Search`).
- Empty chat send action showed no validation/feedback in this run.

Status: PARTIAL (page renders, but runtime warning indicates defect risk).

## Access-Control / Route Guard Checks
### Positive
- Visiting `/login` and `/register` while authenticated redirected to `/dashboard`.
- Protected app routes required authenticated session after logout.

Status: PASS

## Defect List (Actionable)
1. Angles selected-idea flow blocks forever.
- Repro: `/ideas` -> select/create idea -> `Generate Angles`.
- Observed: `/angles?ideaId=...` stuck on `Loading selected idea...`.
- Expected: Idea details and generated angles should load or show explicit error.

2. Ideas submission can hang in `Saving...` despite row appearing.
- Observed with repeated Firestore write-channel abort errors.
- Expected: Save should complete, clear input, and restore button state.

3. Adapt page duplicate React key warning.
- Observed console error about duplicate child key (`Zero-Click Search`).
- Expected: Stable unique keys for deterministic rendering.

4. Several action buttons lack user feedback after click.
- Examples: Dashboard `Open review queue`, Publish `Submit to Search Engines`, Collaboration `Invite teammate`.
- Expected: Route change, modal, toast, or explicit action response.

## Overall Verdict
- Core navigation shell and many page renders are working.
- Critical content pipeline path is not fully functional due to the blocking Angles selected-idea defect.
- Additional reliability concerns exist around Firestore channel aborts and action feedback consistency.
