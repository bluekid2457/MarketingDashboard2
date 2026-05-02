# Screens Specification for Marketing Dashboard

This document describes the main screens required for the Marketing Dashboard, based on the feature list and user stories. Each screen includes its purpose, key components, and main interactions.

> **Implementation status legend** (used in section headings below):
> - **DONE** — UI is built, persists data, and at least one happy-path interaction runs end-to-end without an external API key.
> - **PARTIAL** — Page exists and renders some real data, but one or more named components / actions are placeholders, dead, or silently fail without an AI provider key configured.
> - **PLACEHOLDER** — Page exists but is mostly hardcoded labels / static markup with no functional behavior.
>
> Last verified end-to-end: 2026-05-01 via Playwright walkthrough with the project's QA test credentials, no AI API key configured, and the FastAPI backend down (missing `httpx`).

---

## 1. Login & Authentication Screen (LoginScreen.jpg) — DONE
**Purpose:** Secure user login, registration, and OAuth provider selection.
**Components:**
- Email/password fields
- Client-side validation (email required + format, password required)
- Inline user-safe error banner for auth failures
- Loading state on submit with duplicate-submit prevention
- OAuth provider buttons (currently visual placeholders)
- Forgot password link
- Registration link
- Firebase Email/Password sign-in integration
**Main Actions:**
- Emit `login_attempt`, `login_success`, `login_failure` auth analytics events
- Redirect authenticated users from `/login` to `/dashboard`
- Redirect to dashboard on successful login

---

## 2. Dashboard (Main Overview) — PARTIAL
**Purpose:** Central hub showing content pipeline, stats, and quick actions.
**Components:**
- Content calendar (visual, clickable) — DONE (`scheduledPosts` + `adaptations` aggregated per day)
- Idea backlog summary (top 3) — DONE
- Storyboards / Review queue — DONE
- Recent analytics — PARTIAL (real Posts-this-week and Ideas-waiting metrics; "Engagement rate" and "Best post type" are explicit `N/A` / `TODO` placeholders pending real platform analytics)
- All Adaptations list — DONE
- Quick links — DONE
**Main Actions:**
- Navigate to other screens
- View high-level stats

---

## 3. Idea Input & Backlog Screen (IdeaScreen.png) — DONE
**Purpose:** Submit new ideas, view and manage idea backlog.
**Layout:** Single-column, no sidebar.
**Components:**
- Header card: breadcrumb `CAMPAIGNS · IDEAS`, `Idea Backlog` title, subtitle, stats row (backlog count · strong-rated count · last scored).
- `WorkflowStepper`.
- Input card: single-line text input, pill selects for Tone / Audience / Format (`Any|Article|Post|Thread|Newsletter|Video Script`), "Score only" outline button (score without AI rationale), "Add & score" primary button (full AI flow).
- Filter tabs row: `All`, `Strong`, `Moderate`, `Weak`, `No angles yet` — each shows count. Sort dropdown: `Score high → low`, `Newest`, `Oldest`, `Topic A-Z`.
- Idea cards (replaces table): rounded-2xl white cards each with a color-coded 56×56 score circle (emerald/amber/rose/slate), tone+audience pills + date + live signals count, bold title, secondary topic line, "Open {N} angles →" button, "..." dropdown (Edit title / Delete).
- Per-card AI rationale section (`AI RATIONALE` pill + reason text) and "HOW TO MAKE IT STRONGER" improvement bullets.
**Main Actions:**
- Submit idea with full AI scoring or score-only path
- Filter by score label or no-angles status
- Sort backlog
- Inline title edit / delete per card
- Open angles workflow from any card

---

## 4. AI Angle Selection & Outline Screen (AngleOutlineScreen.png) — DONE (with AI key); deterministic fallback covers no-key case
**Purpose:** Review AI-generated angles/outlines for an idea, select or edit before drafting.
**Components:**
- Query-based idea handoff via `ideaId`, with Firestore idea loading for signed-in user
- Empty/guide state when no `ideaId` is provided
- Provider-backed angle generation (`/api/angles`) using saved Settings provider/key
- List of AI-generated angles/outlines (card/list view) with prev/next carousel controls
- Inline section editing when "Unlock Detailed Editor" is enabled
- Selection controls (radio/check)
- Refine chat input that updates the selected angle and appends chat history
- Error/retry messages and loading states
**Main Actions:**
- Select or edit an angle
- Refine selected angle with AI
- Retry angle generation for the same idea
- Proceed to draft generation

---

## 5. Storyboard / Draft Editor Screen (DraftEditorScreen.jpg) — PARTIAL
**Purpose:** Full-featured editor for drafting, editing, and iterating content. The new entry route is `/storyboard/[id]` (Screen 5b in `frontend.md`); the legacy `/drafts/[id]` editor is preserved for existing deep links and shares the same `users/{uid}/drafts/{ideaId}_{angleId}` document.
**Components:**
- Textarea editor (DONE)
- Inline AI editor (`InlineEditPanel`) with floating prompt + Keep/Undo proposal review (DONE with key)
- Mid-draft AI chat (`DraftChatPanel`) — **silently fails when no AI provider key is configured** (no error toast; `Send to AI Chat` fires no `POST /api/drafts/chat`). Needs a visible no-key warning.
- Tone tuning, readability dial, persona rewrite, A/B headlines, research, plagiarism — exposed via `AIToolbox`. Quick-action buttons (e.g. `Make it more concise`) **silently fail without an AI key** — needs a no-key warning surface.
- Right-side AI change timeline (`AIEditTimeline`) with restore actions (DONE)
- Citation/references panel (DONE; references parsed via `extractReferences()` from `frontend/src/lib/draftResearch.ts`)
- Workflow breadcrumb that includes the next Multi-Channel Adaptation step (DONE)
- Save Storyboard, **Adapt for Platforms**, Submit for Review, Schedule Post buttons (DONE; Adapt button writes `localStorage['adapt_draft_context']` and routes to `/adapt/<ideaId>?angleId=<angleId>`)
**Main Actions:**
- Edit content
- Tune tone
- Check SEO/readability
- Save/submit/schedule
- Store draft handoff context and route to `/adapt/<ideaId>?angleId=<angleId>` when Adapt for Platforms is clicked

---

## 6. Multi-Channel Adaptation Screen (AdaptationScreen.jpg) — PARTIAL
**Purpose:** Adapt content for different platforms/formats.

> **Known broken:** The `Continue and Generate` action on the platform-selection gate fires no network request when no AI provider key is configured — silent fail. `POST /api/drafts/adapt` does have a deterministic-fallback path but the client guard rejects the call before it reaches the route. Needs a visible no-key warning + a fallback adaptation path.
**Components:**
- Route/context validation against draft handoff data in `localStorage['adapt_draft_context']`
- Firestore-backed per-platform adaptation document at `users/{uid}/adaptations/{ideaId}_{angleId}`
- Platform selector for LinkedIn, X/Twitter, Medium, Newsletter, and Blog
- Explicit Generate action for the active platform (calls AI adaptation endpoint)
- Platform-specific editor where only the active tab's copy is edited
- Persona rewrites apply directly to the active platform editor without creating extra persona tabs
- Right-side AI change timeline for applied AI edits with restore actions
- Prompt-template resolver under `src/lib/prompts/platforms` with concise per-platform rules (LinkedIn, X/Twitter, Medium, Newsletter, Blog)
- Visible autosave/manual-save status for adaptation persistence
- AI chat for editing/adapting the currently active platform version
- AI tooling panel includes a Similar posts tab on Adapt that finds linked comparable posts, highlights competitor matches, and summarizes draft overlap and differentiation opportunities
- Optimization tools for SEO Optimizer, AI Check, and Source Check with on-screen results; each tool analyzes the currently active platform copy, uses the configured AI provider when a valid key exists, and falls back to deterministic per-tool results when a non-Ollama key is missing
- Live preview of the active platform copy plus per-platform word counts
- Live trends and relevant articles panel sourced from `/api/trends`
**Main Actions:**
- Adapt content per platform
- Generate platform-specific copy from the source draft using AI prompt rules
- Save/revisit retained platform adaptations
- Run analysis tools on the active platform copy
- Restore previous AI-applied platform snapshots
- Preview and approve

---

## 7. Publishing & Scheduling Screen — PARTIAL
**Purpose:** Manage publishing and scheduling for each platform.
**Components:**
- Platform connection status (OAuth) — Settings card; **requires the FastAPI backend** (`/api/v1/integrations/status`). Backend currently fails to start without `httpx` installed.
- Schedule picker/calendar — DONE (writes `users/{uid}/scheduledPosts` and surfaces upcoming reminders in-page)
- Draft mode toggle — TODO
- Visual content calendar — DONE (Dashboard `Activity Calendar` aggregates `scheduledPosts` + `adaptations`)
- Gap detection alerts — DONE
- Submit to search engines button (IndexNow) — TODO
- Per-card LinkedIn / X-Twitter publish — DONE as a manual handoff (clipboard + open compose URL); no direct posting to provider APIs
**Main Actions:**
- Schedule or publish content
- Connect/disconnect platforms (LinkedIn only; OAuth scaffold present, post action TODO)
- View calendar gaps

---

## 8. Review & Approval Workflow Screen — PLACEHOLDER (queue only)
**Purpose:** Manage draft approvals, version history, and comments.
**Components:**
- Draft queue/list sourced from the signed-in user's Firestore drafts (`users/{uid}/drafts`) — DONE
- Inline editor for review — PLACEHOLDER (heading + one-line copy only; no textarea / contenteditable)
- Version history panel — PLACEHOLDER
- Approval chain controls — PLACEHOLDER
- Comment/suggestion layer — PLACEHOLDER
- Role-based access controls — PLACEHOLDER
**Main Actions:**
- Approve/reject drafts (TODO)
- Edit/comment (TODO)
- View/restore versions (TODO)
- Open any queue item to its corresponding draft detail route (`/drafts/<ideaId>?angleId=<angleId>` or `/storyboard/<ideaId>?angleId=<angleId>`) — DONE

---

## 9. Analytics & Performance Screen — PLACEHOLDER
**Purpose:** Show engagement, performance, and predictive analytics.
**Components:** All placeholder — hardcoded labels, no chart library wired up, no API call.
- Engagement data charts (per platform) — PLACEHOLDER (label only)
- Performance history timeline — PLACEHOLDER
- Predictive scoring widgets — PLACEHOLDER (hardcoded "Predicted reach: 42k | confidence 82%")
- Copy intelligence insights — PLACEHOLDER (hardcoded factoid)
- AI visibility tracking — PLACEHOLDER
**Main Actions:** None functional yet.

---

## 10. Collaboration & Client Management Screen — PLACEHOLDER
**Purpose:** Manage team, clients, and agency workflows.
**Components:** All placeholder; the `Invite teammate` button is a dead no-op (no `onClick` effect, no modal, no network call).
- Invite/manage users (editors, co-authors, clients) — PLACEHOLDER + dead button
- Role-based access controls — PLACEHOLDER
- Client brief intake forms — PLACEHOLDER
- Project-level content calendars — PLACEHOLDER
- White-label output toggles — PLACEHOLDER
**Main Actions:** None functional yet.

---

## 11. Settings & Compliance Screen — PARTIAL
**Purpose:** Configure brand voice, compliance, integrations, and governance.
**Components:**
- Company Profile (9 fields) with **Auto-fill from website** action backed by `POST /api/company/autofill` — DONE; persists to `users/{uid}.companyContext`
- Brand voice profile editor — DONE; persists to the same `companyContext` object on the user doc
- AI API Keys (OpenAI / Gemini / Claude / Ollama) plus optional research-source key (Exa) — DONE; persists to `localStorage['ai_config']`
- Compliance flag settings — PLACEHOLDER (heading + descriptive text only)
- Audit log viewer — PLACEHOLDER
- Integration connectors (LinkedIn OAuth + provider registry display) — DONE *when the FastAPI backend is reachable*; currently broken in dev because `httpx` is missing from `backend/requirements.txt` and the backend will not start. Other providers from the registry (X, Medium, WordPress, Ghost, Substack, Instagram, Facebook) are informational cards only.
- Security settings — PARTIAL (sign-out works; CRM, Google Docs, Slack, SSO connectors are TODO)
**Main Actions:**
- Edit Company Profile + Brand Voice
- Set / save AI provider keys
- Connect / disconnect LinkedIn (when backend is up)
- Sign out

---

## 12. Error & Notification Screens — PARTIAL
**Purpose:** Display errors, alerts, and system notifications. Notifications are derived from `users/{uid}/scheduledPosts` (see `automation.md`), so when no reminders are queued the page renders empty bucket headings.
**Components:**
- Error Messages card — DONE (signed-out / Firebase-unavailable / Firestore-load failure surfaces here)
- Success / Warning Notifications card — DONE (lists scheduled posts due now within ±15 minutes)
- System Alerts card — DONE (lists upcoming reminders for the next 24 hours and missed reminders)
**Main Actions:**
- Dismiss or act on notifications (TODO — no dismiss action wired yet)

---

This list covers the core screens needed to support the described features and user stories. Each screen may have additional sub-components or modals as required by detailed UX/UI design.
