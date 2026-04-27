---
name: auto-loop
description: Iterate developer ↔ playwright-tester until a user-stated target is met in the running app. Use when the user describes a behavior they want ("when I click X the modal should open with Y", "the angles page should show 3 columns") and wants Claude to keep building and browser-verifying until Playwright sees the target behavior. No architect, no human checkpoint — fast feedback loop.
---

# Auto Loop

Tight build-and-verify loop. The main session iterates `developer` to make changes, then `playwright-tester` to validate them in the real running browser, repeating until the validation matches the user's target — or a guardrail trips.

## When to invoke
- User describes a concrete observable target ("the dashboard should show...", "clicking X should...")
- User wants fast iteration without manual browser-clicking each round
- The change is mostly UI / behavior that Playwright can actually verify

## When NOT to invoke
- The target requires human judgment Playwright can't make (visual aesthetics, copy quality)
  → use `feature-loop` (manual-test checkpoint)
- The work is large enough to warrant a TIP first
  → use `feature-loop` (it routes through architect)
- The target spans multiple GitHub issues
  → use `orchestrator`
- No dev server is running and you can't start one (no env, missing creds)
  → resolve that first, then come back

## Difference vs. `feature-loop`
| | `auto-loop` | `feature-loop` |
|---|---|---|
| Architect (TIP) | skipped | optional |
| Code review (`tester-reviewer`) | skipped | required |
| Validation | Playwright in real browser | tester-reviewer + manual user test |
| Human in the loop | only at the very end | required at AwaitingUserTest |
| Cycle speed | seconds-to-minutes | minutes-to-tens-of-minutes |
| Best for | UI/behavior where "you'll know it when Playwright sees it" | larger features, quality-sensitive changes |

## Workers
- **`developer`** — reads target, edits code
- **`playwright-tester`** — drives a real browser (or uses Playwright MCP), reports PASS/FAIL with screenshots and DOM snapshots
- **`debugger`** — only if a cycle hits a runtime error developer alone can't unblock

## Protocol

### Phase 1 — Capture the target (one pass, not a phase you re-enter)
Restate the target in concrete, Playwright-verifiable terms. Examples:
- ✅ "Sidebar shows 'v0.1.0' below 'Weekly target' on desktop ≥1024px"
- ✅ "Clicking the `+` button on Angle 2 selects it and Angle 1 becomes unselected"
- ❌ "Make it look nicer" (not verifiable — kick back to user or use `feature-loop`)

If you can't write a Playwright assertion for it, ask the user to make the target concrete *once*, then proceed silently.

### Phase 2 — Make sure the app is running
- Frontend dev server must be up. If not, start it (`cd frontend && npm run dev`) and wait for `Ready in`.
- Backend if the target touches API behavior: `cd backend && uvicorn app.main:app --reload --port 8000`.
- Note the actual port (Next.js may shift to 3001/3002 if 3000 is taken).

### Phase 3 — Loop
For cycle in 1..N (N = guardrail below):

1. **Developer pass**
   - Invoke `developer` with: the target restatement + last cycle's Playwright failure report (if any) verbatim.
   - Wait for completion. Note files changed.

2. **Hot-reload settle**
   - For Next.js: 2–5s; for FastAPI: ~1s.
   - If the previous cycle introduced a build error, watch the dev-server log for recovery before testing.

3. **Playwright pass**
   - Invoke `playwright-tester` with: target URL, the assertions to check, expected vs. actual format.
   - Tester returns one of:
     - `PASS` — target met
     - `FAIL: <reason + DOM/screenshot evidence>`
     - `BLOCKED: <env / auth / missing prerequisite>`

4. **Decide**
   - `PASS` → exit loop, go to Phase 4.
   - `FAIL` → loop back to step 1 with the failure report.
   - `BLOCKED` → stop, surface the blocker to the user, exit with `BLOCKED`.

### Phase 4 — Close
Print:
```
✅ AUTO-LOOP DONE — <target restated>
Cycles: <n>/<N>
Files touched:
  - <file>
Final Playwright assertion: PASS
  - <one-line summary of what it checked>
```

Optionally offer to commit.

## Guardrails
- **Hard cap: 5 cycles.** If still failing, stop and ask the user. Looping past 5 means the target is wrong or the strategy is wrong — neither is solved by another iteration.
- **No scope expansion.** Each cycle addresses Playwright's last report only. Don't sneak in unrelated tweaks.
- **Refuse vague targets.** Loop without verifiable assertions burns cycles. Make the user concrete first.
- **Watch for thrash.** If two cycles produce the same FAIL, escalate: bring in `debugger`, or stop and surface to user. Don't loop on the same failure mode.
- **Don't restart dev servers between cycles** unless a hot-reload failure forces it. Hot reload is the whole point.
- **Auto mode rules still apply:** never delete data, never push to main, never commit secrets.

## Status logs (one line per stage)
```
[cycle 1] developer — edited frontend/src/components/Nav.tsx
[cycle 1] playwright — FAIL: badge not visible at 1024px (only at 1280px+)
[cycle 2] developer — adjusted Tailwind breakpoint
[cycle 2] playwright — PASS
```
Keep them terse. The user gets to skim what happened without paging through full reports.

## Edge cases
- **Dev server crashes mid-loop**: developer pass produced a syntax error. Wait for recovery; if it doesn't recover in 15s, ask developer to revert the last edit.
- **Playwright MCP not connected**: surface to user, don't fall back to manual click instructions silently.
- **Target involves auth-gated route**: ensure Playwright session has a logged-in fixture, or instruct playwright-tester to log in as part of its run.
- **Target is responsive behavior**: include the viewport size in every Playwright pass (`--viewport-size=1280,800`).
