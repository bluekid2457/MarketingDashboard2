# Marketing Dashboard — Development Workflow Outline

> **Purpose:** Map the full development lifecycle as it exists in this repo, surface the agent architecture, and identify concrete enhancements to increase context, autonomy, and velocity.

---

## 1. Repository Document Ecosystem

| File / Path | Role |
|---|---|
| `README.md` | Project entry point — tech stack, setup, env vars |
| `architecture.md` | Runtime architecture, endpoint map, data model, security |
| `user_stories.md` | Epics, personas, acceptance criteria for product features |
| `setup_tasks.md` | One-time project scaffolding checklist |
| `specs/backend.md` | Living backend spec — endpoints, env vars, security |
| `specs/frontend.md` | Living frontend spec — screens, routes, components, AI config |
| `specs/database.md` | Data model, schema sources, migration strategy |
| `specs/automation.md` | Platform automation logic (LinkedIn, Facebook) |
| `specs/screens.md` | Screen-by-screen UI reference |
| `create_issues.ps1` | Auto-generated PowerShell script to batch-create GitHub Issues |
| `.github/agents/*.agent.md` | Agent role definitions and tool permissions |
| `.github/agents/README.md` | Agent folder conventions and naming rules |
| `.github/agents/skills/*.md` | Reusable skill modules injected into agents |

---

## 2. Agent Roster and Responsibilities

```
Orchestrator
  └── Feature Loop Manager  (fire-and-forget controller)
        ├── Architect        (Issue → TIP)
        ├── Developer        (TIP → Code + Spec sync)
        └── Tester/Reviewer  (Code → APPROVED | NEEDS WORK)

Planner      (Idea → GitHub Issues + TIPs)
Reviewer     (Codebase audit → Improvement Plan → Planner)
Debugger     (Interactive bug diagnosis)
Analyst      (Data analysis → marketing insights)
Plan Modifyer (Change requests → markdown file updates)
```

### Agent Permissions Summary

| Agent | Can Edit Code | Can Read Code | Can Create Issues | External Logging | Loop Control |
|---|---|---|---|---|---|
| Orchestrator | ❌ | ✅ | ❌ | ❌ | ✅ |
| Feature Loop | ❌ | ✅ | ❌ | ❌ | ✅ |
| Architect | ❌ | ✅ | ❌ | ❌ | ❌ |
| Developer | ✅ | ✅ | ❌ | ❌ | ❌ |
| Tester/Reviewer | ❌ | ✅ | ❌ | ❌ | ❌ |
| Planner | ❌ | ✅ | ✅ | ❌ | ❌ |
| Reviewer | ❌ | ✅ | ❌ | ❌ | ❌ |
| Debugger | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 3. Full Development Workflow (Current State)

### Phase 0 — Discovery & Planning
```
User Idea / Bug Report
      │
      ▼
  [Planner Agent]
  - Reads user_stories.md + specs/ for context
  - Decomposes into focused GitHub Issues
  - Labels each: marketing-dashboard, frontend, backend, etc.
  - Embeds a TIP in each issue body (planner-tip-generation skill)
  - Saves all gh issue create commands → create_issues.ps1
  - Runs create_issues.ps1
      │
      ▼
  GitHub Issues created (ordered implementation plan)
```

### Phase 1 — Architecture (per issue)
```
  [Architect Agent]
  - Reads GitHub Issue (title, body, labels)
  - Searches codebase for relevant files
  - Produces Technical Implementation Plan (TIP):
      1. Issue Summary
      2. Root Cause / Motivation
      3. DB Schema Changes
      4. API Endpoint Changes
      5. Playwright/Automation Changes
      6. Next.js Frontend Changes
      7. Environment & Config
      8. File System Changes
      9. Edge Cases & Risks
     10. Acceptance Criteria
  - Hands off TIP → Developer
```

### Phase 2 — Implementation Loop
```
  [Feature Loop Manager] ← orchestrates the loop
      │
      ▼
  [Developer Agent]
  - Reads TIP acceptance criteria
  - Reads full relevant files before editing
  - Implements changes: backend / frontend / DB / scripts
  - Updates matching spec file in specs/ (MANDATORY)
    - Reports bug/fix summary in agent output and keeps specs in sync
      │
      ▼
  [Tester/Reviewer Agent]
  - Validates implementation against TIP acceptance criteria
  - Checks for regressions in touched files
  - Returns: APPROVED ✅ or NEEDS WORK ❌ (with numbered issues)
      │
      ├── NEEDS WORK → back to Developer (max 5 cycles)
      └── APPROVED   → Feature Loop complete
```

### Phase 3 — Orchestration (full feature set)
```
  [Orchestrator Agent]
  - Pulls all open GitHub Issues
  - Filters by feature labels
  - Calls Feature Loop Manager per issue (sequential)
  - After each issue: syncs specs/ (removes (TODO) markers)
    - Writes completion entry in orchestrator output
    - After all issues: writes rollup summary in orchestrator output
```

### Phase 4 — Ongoing Quality
```
  [Reviewer Agent]  (triggered ad-hoc or periodically)
  - Audits backend, frontend, DB, automation scripts
  - Produces prioritized Review Report (High / Medium / Low)
  - Produces General Improvement Plan
  - Hands off to Planner → new GitHub Issues
```

---

## 4. Context Flow Between Documents

```
user_stories.md
    │  (features & acceptance criteria)
    ▼
Planner → GitHub Issues (with embedded TIPs)
    │
    ▼
Architect → enriched TIP (file-level, endpoint-level detail)
    │
    ▼
Developer → code changes + specs/ update
    │
    ▼
specs/frontend.md  ←→  architecture.md  ←→  specs/backend.md
    │                                               │
    └──────────── Tester reads both ───────────────┘
```

**Key invariant:** `specs/*.md` must always mirror the actual codebase. The Developer is the sole enforcer of this contract on every change.

---

## 5. Tech Stack Context (for agents)

| Layer | Stack | Entry Point |
|---|---|---|
| Frontend | Next.js 16 · TypeScript · Tailwind · Zustand · Firebase Auth | `frontend/src/app/` |
| Backend | FastAPI · Python 3.10+ · Pydantic | `backend/app/main.py` |
| Database | Firebase Firestore (NoSQL) | `backend/app/services/` |
| AI Providers | OpenAI · Gemini · Claude · Ollama | `frontend/src/lib/aiConfig.ts` |
| Automation | Playwright (LinkedIn, Facebook) | `backend/app/routes/` |
| Issue Tracking | GitHub Issues | `create_issues.ps1` |

---

## 6. Workflow Enhancement Recommendations

### 6.1 Context Enhancements

#### A. Add a `AGENTS.md` at Repo Root
Create a single-file agent index at the repo root so any agent starting cold can immediately understand the full agent roster, entry points, and tool rules without reading the full `.github/agents/` directory.

```markdown
# Agent Index
| Agent | File | Trigger | Code Changes |
|---|---|---|---|
| Planner | .github/agents/planner.agent.md | New idea/feature | ❌ |
...
```

#### B. Add a `WORKFLOW.md` Quickref
A one-page cheat sheet showing which command/agent to call for each situation:
- "I have a new feature idea" → `@planner`
- "There's a bug" → `@debugger`
- "Review code quality" → `@reviewer`
- "Implement an issue" → `@orchestrator` or `@feature-loop`

#### C. Enrich `specs/` with a `specs/README.md`
Document which spec file owns which part of the system so agents don't need to guess:
- `specs/backend.md` → FastAPI routes, env vars, auth
- `specs/frontend.md` → all 12 screens + API routes + auth flow
- `specs/database.md` → Firestore collections, migrations, rules
- `specs/automation.md` → Playwright flows, OAuth flows
- `specs/screens.md` → visual screen references only

#### D. Add `(TODO)` Tracking Table to `specs/frontend.md`
Replace scattered inline `(TODO)` markers with a dedicated table at the top of the file:

```markdown
## TODO Tracker
| Screen | Section | Status |
|---|---|---|
| Dashboard | Content Calendar | TODO |
| Review | Approval Chain | TODO |
...
```

This gives the Orchestrator and Planner a single queryable surface for remaining work.

---

### 6.2 Autonomy Enhancements

#### E. Add a `context_snapshot.md` Auto-Generation Step
After each Feature Loop completes, the Orchestrator should write/update a `context_snapshot.md` with:
- Last 5 completed features
- Current open TODO count by spec file
- Last known GitHub Issues board/filter URL
- Active branch (if any)

This allows any agent to resume mid-session without re-reading the whole repo.

#### F. Add a Pre-Loop Context Check to Feature Loop Manager
Before handing to the Architect, the Feature Loop Manager should explicitly:
1. Read `specs/` for the affected layer
2. Read `architecture.md` section relevant to the issue
3. Pass a **context bundle** (relevant spec excerpts + architecture notes) directly to the Architect

This eliminates the Architect needing to search the codebase from scratch on every issue.

#### G. TIP Versioning
When the Tester returns `NEEDS WORK`, the Developer should append a `## Revision N` section to the TIP in the issue body (or a local `tips/` file) before starting the next cycle. This creates an audit trail of why loops happened and what was changed.

#### H. Spec Sync Verification Step in Tester
Add an explicit check to `tester_reviewer.agent.md`:
> Verify that the relevant `specs/` file was updated. If not, return `NEEDS WORK` with reason "spec file not updated."

This closes the loop on the Developer's mandatory spec sync rule.

---

### 6.3 Velocity Enhancements

#### I. Parallel Issue Processing in Orchestrator
For issues with no declared dependencies, the Orchestrator should be able to launch two Feature Loop instances in parallel. Add a dependency declaration to the issue body template:

```markdown
## Dependencies
- Depends on: #<issue-number>  (or "none")
```

The Orchestrator reads this and only serializes where there is an actual data or file dependency.

#### J. Planner Pre-Checks Before Creating Issues
Before calling `gh issue create`, the Planner should:
1. Search existing open issues for duplicates
2. Check `specs/` for `(TODO)` markers that already map to the request
3. Output a "duplicate check" note so the user can decide to reuse an existing issue

#### K. Reviewer Scheduling — Add a Trigger Condition
Document in `reviewer.agent.md` when the Reviewer should be automatically triggered:
- After every N completed issues (e.g., every 5)
- Before any release/deployment branch is created
- When the Tester returns `NEEDS WORK` more than 3 times on a single issue

#### L. `create_issues.ps1` Idempotency
Add a check at the top of the generated `create_issues.ps1` so re-running it does not create duplicate issues:

```powershell
# Check for existing issue with same title before creating
$existing = gh issue list --search "$title" --json number,title | ConvertFrom-Json
if ($existing.Count -eq 0) { gh issue create ... }
```

---

### 6.4 Traceability Enhancements

#### M. Issue Entry Template
Standardize the Orchestrator output format so every entry has:
- Issue # and title
- TIP link (GitHub issue URL)
- Agents involved and cycle count
- Final verdict (✅ / ❌)
- Spec files updated
- Follow-up TODOs

#### N. Link `user_stories.md` to GitHub Issues
Add an "Issue #" column to each user story in `user_stories.md` once the Planner creates the issue. This makes it trivial to trace from product intent → technical issue → implementation → spec.

#### O. Add a `CHANGELOG.md` Updated by Developer
After each approved Feature Loop, the Developer appends a one-line entry to `CHANGELOG.md`:

```
## [unreleased]
- feat(angles): AI angle carousel with refinement chat (#12)
- fix(auth): LinkedIn OAuth redirect loop (#14)
```

This provides a human-readable audit trail in-repo and in GitHub.

---

## 7. Priority Summary

| # | Enhancement | Impact | Effort |
|---|---|---|---|
| H | Tester verifies spec sync | High | Low |
| D | TODO tracker table in specs | High | Low |
| F | Pre-loop context bundle for Architect | High | Medium |
| E | context_snapshot.md after each loop | Medium | Medium |
| L | Idempotent create_issues.ps1 | Medium | Low |
| B | WORKFLOW.md quickref | Medium | Low |
| A | AGENTS.md root index | Medium | Low |
| G | TIP revision versioning | Medium | Medium |
| I | Parallel issue processing | High | High |
| J | Planner duplicate check | Medium | Medium |
| C | specs/README.md | Low | Low |
| K | Reviewer trigger conditions | Medium | Medium |
| M | Issue entry template | Low | Low |
| N | user_stories ↔ issue linkage | Medium | Medium |
| O | CHANGELOG.md by Developer | Medium | Low |
