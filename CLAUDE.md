# Marketing Dashboard 2 — Claude Code Guide

## Project

AI-powered marketing content dashboard. Stack:
- **Frontend**: Next.js 16 (App Router), TypeScript, Tailwind CSS, Zustand — runs on `localhost:3000`
- **Backend**: FastAPI (Python 3.10+), Firebase/Firestore — runs on `localhost:8000`
- **Auth**: Firebase Auth (client-side), Firebase Admin (server-side)

---

## Agentic Workflow — ALWAYS Follow This

### Feature Requests → `/feature-loop`

**For any new feature, ALWAYS start with the `/feature-loop` skill.**  
This runs an automatic pipeline: Architect → Developer → Playwright Tester → Reviewer.  
Do NOT implement features directly in the main context.

```
User describes feature → /feature-loop → done
```

### Bug Reports → `debugger` subagent

Use the `debugger` subagent. It diagnoses, applies the fix, and logs to Notion.

### New idea that needs scoping → `planner` subagent

Use the `planner` subagent to convert a vague idea into a properly scoped GitHub Issue.

### Code review → `reviewer` subagent

Use the `reviewer` subagent. Produces a prioritized report and hands off to `planner`.

### E2E / UI testing only → `playwright-tester` subagent

When you only need to validate a UI flow without code changes.

---

## Agent Quick Reference

| Task | How to invoke |
|------|--------------|
| New feature | `/feature-loop` skill |
| Bug fix | `Agent(subagent_type="debugger")` |
| Idea → GitHub Issue | `Agent(subagent_type="planner")` |
| Code review | `Agent(subagent_type="reviewer")` |
| Test a specific UI flow | `Agent(subagent_type="playwright-tester")` |
| Architecture plan only | `Agent(subagent_type="architect")` |
| Codebase exploration | `Agent(subagent_type="Explore")` |
| Implement from a TIP | `Agent(subagent_type="developer")` |

---

## Memory — Maintain Every Session

**At the start of every session:** read the memory index at:
`C:\Users\BLUEK\.claude\projects\C--Users-BLUEK-OneDrive-Documents-GitHub-MarketingDashboard2\memory\MEMORY.md`

**During / after the session**, save memories when you learn:
- The user's role, preferences, or expertise → `user` type
- Corrections or confirmed approaches → `feedback` type
- Project decisions, deadlines, goals → `project` type
- Pointers to external resources → `reference` type

Memory directory: `C:\Users\BLUEK\.claude\projects\C--Users-BLUEK-OneDrive-Documents-GitHub-MarketingDashboard2\memory\`

---

## Spec Sync — Required on Every Code Change

Every code change must be reflected in the relevant spec file in `specs/`. See `specs/README.md` for full ownership rules.

| Layer changed | Update this spec |
|--------------|----------------|
| FastAPI routes, backend config | `specs/backend.md` |
| Next.js routes, components, UI | `specs/frontend.md` |
| Firestore collections, data shape | `specs/database.md` |
| Scheduling, publishing automation | `specs/automation.md` |
| Screen layout or UX intent | `specs/screens.md` |

---

## Dev Commands

```bash
# Frontend (Next.js)
cd frontend && npm run dev           # dev server on :3000
cd frontend && npx tsc --noEmit      # type check only

# Backend (FastAPI)
cd backend && uvicorn app.main:app --reload   # dev server on :8000

# Health checks
curl http://localhost:3000
curl http://localhost:8000/health
```

---

## Key Paths

| Path | Purpose |
|------|---------|
| `specs/` | Canonical docs — always sync after code changes |
| `frontend/src/app/` | Next.js App Router pages |
| `frontend/src/components/` | Shared React components |
| `backend/app/` | FastAPI application |
| `backend/app/routers/` | API route handlers |
| `backend/app/services/` | Business logic and integrations |

---

## Security

- Never commit `.env` files
- Token encryption uses Fernet (see `backend/app/services/encryption.py`)
- All Firestore access must respect security rules in `specs/database.md`
- Frontend must never expose Firebase service account credentials
