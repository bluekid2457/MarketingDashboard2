---
name: feature-loop
description: Autonomous architect → developer → tester-reviewer build loop for a single feature on the marketing dashboard, with a mandatory manual-browser-test checkpoint before closure. Use when the user wants fire-and-forget implementation of one feature with a human-in-the-loop sanity check at the end.
---

# Feature Loop

Drives one feature from prompt or TIP through to user-verified completion. The main Claude session executes this protocol directly — no coordinator subagent in the middle.

## When to invoke
- User says "implement X", "add X", "build X", "use the feature loop for X"
- User hands you a TIP and wants it implemented end-to-end
- A higher-level process (orchestrator skill) is iterating over feature issues and asks you to run one

## When NOT to invoke
- The change is a one-line tweak — just do it directly
- The user is asking a question, not requesting work
- A debugging session is in progress (use `debugger` agent instead)

## Workers you delegate to
| Subagent | When | What you pass |
|---|---|---|
| `architect` | No TIP yet | The user's prompt + relevant repo context |
| `developer` | TIP exists, needs implementation | The TIP verbatim |
| `tester-reviewer` | Code just landed | Diff summary + acceptance criteria |
| `playwright-tester` | UI flow needs an automated browser check (optional, before user test) | The new feature's URL + expected behavior |

## Protocol

### Phase 1 — Intake
- If input is a high-level prompt with no TIP → invoke `architect` to produce a TIP.
- If input is already a TIP → skip to Phase 2.

### Phase 2 — Build/test inner loop
1. Invoke `developer` with the TIP.
2. Invoke `tester-reviewer` with the change summary.
3. If `tester-reviewer` returns `NEEDS WORK` → loop to step 1, passing the findings verbatim.
4. If `tester-reviewer` returns `APPROVED` → proceed to Phase 3.
5. **Hard cap: 5 dev↔tester cycles.** If still not approved, stop and report blocker.

### Phase 3 — Manual-test checkpoint (MANDATORY)
This is the differentiator. Do **not** declare done after `tester-reviewer` approves.

1. Make sure the dev servers are running (frontend at http://localhost:3000 or :3001; backend at :8000 if needed). Start them if not — see "Server commands" below.
2. Print a clear `🛑 AWAITING_USER_TEST` block to the user with:
   - The exact URL(s) to open
   - A numbered checklist of clicks/visual assertions/edge cases tied to the feature
   - Window-size requirements if responsive behavior matters
3. **Stop and wait for the user.** Do not proceed without their reply.

### Phase 4 — Close or iterate
- User replies "passed" / "looks good" / ✅ → declare `APPROVED`, summarize what shipped, list any follow-up TODOs, optionally offer to commit.
- User replies with findings (e.g., "button is misaligned on mobile, X crashes on save") → treat findings as a tester `NEEDS WORK` verdict, loop back to Phase 2 step 1 with the user's words verbatim.

## Output discipline
- **Status logs after each phase, not approval checkpoints.** One concise line: stage, verdict, next step.
- Don't ask the user "should I continue?" between Phase 1/2/3 transitions — only Phase 3 stops for input.
- Never declare `APPROVED` without both tester-reviewer approval AND user manual-test pass.

## Server commands
- Frontend: `cd frontend && npm run dev` (Next.js, hot-reloads — keep it running across iterations)
- Backend: `cd backend && uvicorn app.main:app --reload --port 8000` (FastAPI)
- If `frontend/.env.local` is missing the Firebase config, ask the user to paste it before starting

## Guardrails
- Scope creep is the enemy. Iterations only address tester or user findings — no new requirements mid-loop.
- If a hard blocker prevents safe implementation, stop and ask. Otherwise, no clarifying questions.
- Don't skip Phase 3, even for trivial changes — it's how the user keeps trust in the loop.

## Final report shape
When the loop closes:
```
✅ APPROVED — <feature name>
Changes:
  - <file:line> — <what>
Validated:
  - tester-reviewer: <key checks>
  - manual: <user confirmed X, Y>
Follow-ups:
  - <any deferred TODOs>
```
Or if blocked:
```
🛑 BLOCKED — <feature name>
Iterations: <n>
Blocker: <one sentence>
Proposed next action: <concrete step>
```
