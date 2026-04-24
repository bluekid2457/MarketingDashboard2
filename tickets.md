# AI-Guided Content Pipeline Modernization - Implementation Tickets

## Epic
- Epic ID: EPIC-AI-PIPELINE-001
- Name: AI-Guided Content Pipeline Modernization (Ideas -> Angles -> Storyboard -> Adapt)
- Goal: Streamline ideation and editing into page-native AI actions so users move faster from concept to publish-ready platform content with better relevance and traceability.
- Personas: Content Strategist, Writer/Editor, Marketing Manager, System

---

## Ticket 1: Ideas Relevance Scoring Engine + UI
- Ticket ID: FE-BE-IDEAS-001
- Type: Feature
- Priority: P0
- Pages: Ideas
- Scope:
  - Compute deterministic relevance score from one-sentence topic.
  - Display score, label, and short rationale per idea.
  - Show tooltip/help text for scoring rationale.
  - Validate input before scoring.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given a valid one-sentence topic
    - When ideas are created or loaded
    - Then each idea displays score + label + rationale.
  - Scenario 2 (validation):
    - Given empty/too-short/non-sentence input
    - When scoring is requested
    - Then scoring is blocked and a corrective message is shown.
- Edge Cases:
  - Existing legacy ideas without score metadata must still render (fallback to on-read compute or "Unscored").
  - Special characters and punctuation should not break tokenizer/scoring.
- Technical Notes:
  - Keep algorithm deterministic for consistent sorting.
  - Track score generation errors for observability.
- Dependencies: none
- Estimation: 5 points

---

## Ticket 2: Ideas Sorting Defaults + Rating Filter Behavior
- Ticket ID: FE-IDEAS-002
- Type: Feature
- Priority: P1
- Pages: Ideas
- Scope:
  - Default list sort to highest relevance first.
  - Keep user-selected sort preference per session.
  - Push unscored items to end with explicit status.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given multiple rated ideas
    - When list renders
    - Then default order is highest-to-lowest score.
  - Scenario 2 (mixed scoring):
    - Given some ideas are unscored
    - When list renders
    - Then unscored items appear last with clear indicator.
- Edge Cases:
  - Session preference resets correctly on sign-out.
- Dependencies: FE-BE-IDEAS-001
- Estimation: 3 points

---

## Ticket 3: Ideas Auto-Navigation to Angles on Select
- Ticket ID: FE-IDEAS-003
- Type: Feature
- Priority: P0
- Pages: Ideas -> Angles
- Scope:
  - Remove "Generate Angle" button.
  - Selecting an idea immediately routes to Angles with context preserved.
  - Remove obsolete keyboard focus/shortcut references for removed CTA.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given a user selects an idea card
    - When selection is confirmed
    - Then app navigates to Angles and passes idea context.
  - Scenario 2 (invalid payload):
    - Given idea payload is incomplete
    - When navigation is attempted
    - Then route is blocked and actionable error is shown.
- Edge Cases:
  - Local storage unavailable: fallback to server fetch by idea ID.
- Dependencies: FE-BE-IDEAS-001
- Estimation: 3 points

---

## Ticket 4: Angles Auto-Generate 3 Distinct Angles on Arrival
- Ticket ID: FE-BE-ANGLES-001
- Type: Feature
- Priority: P0
- Pages: Angles
- Scope:
  - Auto-trigger generation when page loads with valid idea context.
  - Return exactly 3 semantically distinct angles.
  - Retry generation on duplicate/null results with capped retries.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given valid selected idea context
    - When Angles initializes
    - Then exactly 3 non-duplicate angles are shown.
  - Scenario 2 (quality guard):
    - Given response contains duplicate/null angles
    - When quality checks run
    - Then auto-retry occurs until valid set or failure state displayed.
- Edge Cases:
  - User refreshes page mid-generation; state must recover safely.
- Technical Notes:
  - Define and document semantic distinctness threshold.
- Dependencies: FE-IDEAS-003
- Estimation: 5 points

---

## Ticket 5: Angles Regenerate + In-Flight UX
- Ticket ID: FE-BE-ANGLES-002
- Type: Feature
- Priority: P0
- Pages: Angles
- Scope:
  - Add Regenerate action to replace current angle set.
  - Disable action while request is in-flight.
  - Preserve previous valid set if regeneration fails.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given angles are displayed
    - When user clicks Regenerate
    - Then new 3-angle set does not replace old set, but is shown on top and the old ones go under.
  - Scenario 2 (failure):
    - Given generation fails beyond retry limit
    - When operation ends
    - Then previous set remains and retry error message appears.
- Edge Cases:
  - Rapid repeated clicks do not trigger parallel generation requests.
- Dependencies: FE-BE-ANGLES-001
- Estimation: 3 points

---

## Ticket 6: Angles Candidate Persistence Model
- Ticket ID: BE-DB-ANGLES-003
- Type: Backend/Data
- Priority: P0
- Pages: Angles
- Scope:
  - Persist every generated angle candidate set with status and timestamps.
  - Add transactional writes for angle-set + candidates.
  - Add recovery path for partial write failure.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given generation completes
    - When backend returns candidates
    - Then all candidates are persisted as active.
  - Scenario 2 (partial failure):
    - Given partial database write
    - When persistence validation runs
    - Then operation rolls back or repairs and client receives sync warning.
- Edge Cases:
  - Same user regenerates concurrently in multiple tabs.
- Dependencies: FE-BE-ANGLES-001
- Estimation: 5 points

---

## Ticket 7: Angle Selection Finalization + Unselected Cleanup
- Ticket ID: BE-DB-ANGLES-004
- Type: Backend/Data
- Priority: P0
- Pages: Angles
- Scope:
  - Mark one angle as official selection.
  - Delete unselected active candidates upon selection.
  - Add soft-flag + retry job for cleanup failures.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given multiple active candidates
    - When one is selected
    - Then selected angle remains and unselected are deleted.
  - Scenario 2 (cleanup failure):
    - Given delete operation partially fails
    - When cleanup workflow runs
    - Then stale candidates are flagged and removed via retry without affecting selected angle.
- Edge Cases:
  - Idempotent re-selection request should not duplicate side effects.
- Dependencies: BE-DB-ANGLES-003
- Estimation: 5 points

---

## Ticket 8: Remove Angles General AI Chat + Deprecation Handling
- Ticket ID: FE-BE-ANGLES-005
- Type: Feature/Tech Debt
- Priority: P1
- Pages: Angles
- Scope:
  - Remove generic chat widget and related calls on Angles.
  - Keep Regenerate as only AI action on Angles.
  - Redirect legacy chat deep links to Angles with deprecation notice.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given user opens Angles
    - When UI loads
    - Then no generic chat is visible or callable.
  - Scenario 2 (legacy path):
    - Given old chat route is requested
    - When request resolves
    - Then user lands on Angles with deprecation message.
- Edge Cases:
  - Telemetry dashboards do not break when old chat events stop.
- Dependencies: FE-BE-ANGLES-001
- Estimation: 3 points

---

## Ticket 9: Always-On Angles Detailed Editor (Remove Lock)
- Ticket ID: FE-ANGLES-006
- Type: Feature
- Priority: P1
- Pages: Angles
- Scope:
  - Remove "Lock Detailed Editor" behavior and UI.
  - Keep editor always active and editable.
  - Ensure edits remain responsive during autosave.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given user is on Angles
    - When user interacts with detailed content
    - Then editing is immediately available.
  - Scenario 2 (autosave overlap):
    - Given autosave in progress
    - When user continues typing
    - Then input remains responsive and conflicts are handled.
- Edge Cases:
  - Edit state survives transient network interruptions.
- Dependencies: FE-BE-ANGLES-001
- Estimation: 3 points

---

## Ticket 10: Draft -> Storyboard Rebrand + Route Compatibility
- Ticket ID: FE-ROUTES-STORYBOARD-001
- Type: Feature
- Priority: P0
- Pages: Navigation, Draft/Storyboard, Review
- Scope:
  - Rename Draft references to Storyboard in labels, titles, breadcrumbs, nav.
  - Keep backward-compatible redirects from old draft routes.
  - Ensure context handoff remains intact across redirects.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given user navigates app
    - When pages and menus render
    - Then all user-facing "Draft" terms are replaced by "Storyboard" where intended.
  - Scenario 2 (backward compatibility):
    - Given user opens old bookmarked draft URL
    - When route resolves
    - Then user is redirected to Storyboard without losing context.
- Edge Cases:
  - Analytics/event naming migration avoids broken reports.
- Dependencies: none
- Estimation: 5 points

---

## Ticket 11: Storyboard Toolbar Cleanup (Remove SEO + AI Check Buttons)
- Ticket ID: FE-STORYBOARD-002
- Type: Feature/Tech Debt
- Priority: P1
- Pages: Storyboard
- Scope:
  - Remove SEO and AI Check toolbar buttons from Storyboard page-level actions.
  - Return controlled "unsupported" response for obsolete automation calls.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given user opens Storyboard
    - When toolbar is shown
    - Then SEO and AI Check buttons are absent.
  - Scenario 2 (legacy automation):
    - Given obsolete action call is made
    - When backend receives request
    - Then response is controlled and non-crashing.
- Dependencies: FE-ROUTES-STORYBOARD-001
- Estimation: 2 points

---

## Ticket 12: Shared Inline AI Edit Engine (Storyboard + Adapt)
- Ticket ID: FE-BE-INLINE-EDIT-001
- Type: Feature
- Priority: P0
- Pages: Storyboard, Adapt
- Scope:
  - Build shared text-selection AI edit endpoint + UI integration.
  - Require user to select text and provide instruction.
  - Preserve cursor anchors and local editor context.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given user highlights text and submits instruction
    - When inline edit runs
    - Then scoped proposed update is returned.
  - Scenario 2 (validation):
    - Given no selection exists
    - When inline edit is requested
    - Then user is prompted to select text first.
- Edge Cases:
  - Selected span exceeds model limits -> prompt user to narrow range.
- Dependencies: FE-ROUTES-STORYBOARD-001
- Estimation: 5 points

---

## Ticket 13: Storyboard Diff Review (Accept/Deny Per Change)
- Ticket ID: FE-STORYBOARD-003
- Type: Feature
- Priority: P0
- Pages: Storyboard
- Scope:
  - Show proposed edits in VS Code-like diff UI.
  - Allow per-change Accept or Deny.
  - Handle overlapping/conflicting edits.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given AI returns edit proposals
    - When diff view opens
    - Then each proposal can be accepted/denied independently.
  - Scenario 2 (conflict):
    - Given overlapping edit ranges
    - When one conflicting change is accepted
    - Then remaining conflicts are rebased or flagged before apply.
- Edge Cases:
  - Repeated Accept action remains idempotent.
- Dependencies: FE-BE-INLINE-EDIT-001
- Estimation: 5 points

---

## Ticket 14: Citation Enforcement + Source References in Storyboard
- Ticket ID: FE-BE-STORYBOARD-004
- Type: Feature
- Priority: P0
- Pages: Storyboard, API Draft Generation
- Scope:
  - Update generation prompts to require citations for factual claims.
  - Validate citation presence.
  - Render references list with clickable links at bottom.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given AI generates factual content
    - When output is returned
    - Then claims include citation markers and source list renders as links.
  - Scenario 2 (uncited claims):
    - Given response has uncited claims
    - When validation runs
    - Then output is flagged and user prompted to regenerate or manually fix.
- Edge Cases:
  - Malformed/unreachable URLs are marked invalid without blocking editor use.
- Dependencies: FE-ROUTES-STORYBOARD-001
- Estimation: 5 points

---

## Ticket 15: Adapt Entry Platform Selection Gate
- Ticket ID: FE-ADAPT-001
- Type: Feature
- Priority: P0
- Pages: Adapt
- Scope:
  - Add platform selection step before generation.
  - Require at least one platform to continue.
  - Support multi-select with clear selected state.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given user opens Adapt
    - When page loads
    - Then platform selector appears before generation starts.
  - Scenario 2 (validation):
    - Given no platform is selected
    - When user clicks continue
    - Then progression is blocked with validation message.
- Dependencies: FE-ROUTES-STORYBOARD-001
- Estimation: 3 points

---

## Ticket 16: Sequential Platform Generation + Progressive Cards
- Ticket ID: FE-BE-ADAPT-002
- Type: Feature
- Priority: P0
- Pages: Adapt
- Scope:
  - Generate one selected platform at a time.
  - Render each platform card as soon as content is ready.
  - Keep generated card immediately editable.
  - Allow per-platform retry on failure while sequence continues.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given multiple selected platforms
    - When generation starts
    - Then cards populate sequentially and each card is editable on completion.
  - Scenario 2 (partial failure):
    - Given one platform generation fails
    - When sequence executes
    - Then failed platform shows retry state and others continue.
- Edge Cases:
  - Cancel generation mid-queue leaves completed cards intact.
- Dependencies: FE-ADAPT-001
- Estimation: 5 points

---

## Ticket 17: Automatic Platform-Specific SEO Analysis
- Ticket ID: FE-BE-ADAPT-003
- Type: Feature
- Priority: P1
- Pages: Adapt
- Scope:
  - Auto-trigger SEO analysis after each platform content generation.
  - Use platform-specific rule sets and reporting.
  - Show retry/pending state if analyzer unavailable.
- Acceptance Criteria:
  - Scenario 1 (happy path):
    - Given platform draft generation completes
    - When post-processing runs
    - Then platform-specific SEO stats and recommendations are shown.
  - Scenario 2 (service unavailable):
    - Given analyzer is unavailable
    - When auto-analysis triggers
    - Then draft remains editable and analysis status shows pending/retry.
- Edge Cases:
  - Late analyzer response does not overwrite newer user edits.
- Dependencies: FE-BE-ADAPT-002
- Estimation: 5 points

---

## Ticket 18: Security Hardening for AI Generation/Editing Endpoints
- Ticket ID: NFR-SEC-001
- Type: NFR
- Priority: P0
- Scope:
  - Enforce auth on generation/regeneration/edit/selection endpoints.
  - Validate and sanitize prompts/instructions.
  - Add rate limiting for generation/regeneration.
  - Restrict source links to safe protocols.
  - Add audit logging for angle selection, diff decisions, and deletions.
- Acceptance Criteria:
  - Unauthorized requests return 401/403 for protected endpoints.
  - Prompt payloads are validated and sanitized server-side.
  - Excessive request bursts are throttled with clear API responses.
  - Unsafe protocols are blocked from rendered sources.
  - Audit events emitted for all critical content decisions.
- Dependencies: all AI/data tickets
- Estimation: 8 points

---

## Ticket 19: Performance Budgets + Instrumentation
- Ticket ID: NFR-PERF-001
- Type: NFR
- Priority: P1
- Scope:
  - Enforce and monitor performance budgets:
    - Ideas/Angles first meaningful render under 2.0s with cached session data.
    - First angle-generation status feedback under 1.5s.
    - Diff accept/deny interactions under 200ms for normal doc size.
    - Sequential generation emits progressive updates (not batch-only).
  - Add telemetry dashboards/alerts for regressions.
- Acceptance Criteria:
  - Performance probes and telemetry are implemented and visible.
  - CI/perf checks fail on significant threshold regressions (where feasible).
- Dependencies: FE-BE-IDEAS-001, FE-BE-ANGLES-001, FE-STORYBOARD-003, FE-BE-ADAPT-002
- Estimation: 5 points

---

## Ticket 20: Product Analytics Event Coverage
- Ticket ID: NFR-ANALYTICS-001
- Type: NFR
- Priority: P1
- Scope:
  - Track:
    - Idea selection rate by relevance band.
    - Regenerate frequency and selected angle lineage.
    - Inline AI usage (selection length, instruction type, accept/deny ratio).
    - Citation compliance and invalid-source incidence.
    - Per-platform generation time, SEO score distribution, retry rates.
- Acceptance Criteria:
  - Event schema documented and emitted from frontend/backend touchpoints.
  - Data quality checks validate required fields.
  - Dashboards include all required KPI slices.
- Dependencies: FE-BE-IDEAS-001, FE-BE-ANGLES-002, FE-BE-INLINE-EDIT-001, FE-BE-STORYBOARD-004, FE-BE-ADAPT-003
- Estimation: 5 points

---

## Delivery Plan (Suggested)
- Phase 1 (Core Flow):
  - FE-BE-IDEAS-001
  - FE-IDEAS-003
  - FE-BE-ANGLES-001
  - FE-BE-ANGLES-002
  - BE-DB-ANGLES-003
  - BE-DB-ANGLES-004
  - FE-ROUTES-STORYBOARD-001
  - FE-BE-INLINE-EDIT-001
  - FE-STORYBOARD-003
  - FE-BE-STORYBOARD-004
  - FE-ADAPT-001
  - FE-BE-ADAPT-002
- Phase 2 (Hardening + Optimization):
  - FE-IDEAS-002
  - FE-BE-ANGLES-005
  - FE-ANGLES-006
  - FE-STORYBOARD-002
  - FE-BE-ADAPT-003
  - NFR-SEC-001
  - NFR-PERF-001
  - NFR-ANALYTICS-001

---

## Definition of Done (applies to all tickets)
- Implementation merged with unit/integration tests where applicable.
- E2E checks updated for changed workflows.
- Feature flags removed or documented.
- Specs updated in `specs/frontend.md`, `specs/backend.md`, and `specs/database.md` where impacted.
- Telemetry and error handling verified.
- Accessibility checks performed for new/changed UI interactions.
