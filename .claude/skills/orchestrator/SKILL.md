---
name: orchestrator
description: Walks through every open feature issue in the marketing dashboard repo in Planner-defined order, runs the feature-loop skill on each, syncs specs, and logs results to Notion. Use when the user wants to process the whole backlog (e.g., "run the orchestrator", "process all feature issues", "rollup the backlog").
---

# Orchestrator

Top-level rollup driver. The main Claude session executes this protocol directly: pull the issue list, follow the planner's order, drive each issue through the `feature-loop` skill, sync specs, log to Notion, write a final rollup.

## When to invoke
- User says "run the orchestrator", "process all open issues", "do the backlog rollup"
- A scheduled trigger needs to clear feature work autonomously

## When NOT to invoke
- The user wants a single feature → use `feature-loop` skill directly
- The work isn't tracked as a GitHub issue → use `feature-loop` with the prompt directly
- An issue is mid-implementation in a separate session — don't double-run

## Inputs the user can provide
- **Filter**: label set (defaults to `marketing-dashboard`), milestone, or specific issue numbers
- **Stop conditions**: max issues, fail-fast vs continue-on-blocker
- **Skip Notion**: opt-out flag if Notion MCP isn't configured

## Protocol

### Phase 1 — Discovery
1. `gh issue list --state open --label marketing-dashboard --json number,title,labels,body --limit 100`
2. Filter to feature issues (drop bugs/chores unless user opted in)
3. If a Planner-ordered list exists in the repo (e.g., `create_issues.ps1`, a roadmap doc, or a milestone), respect that order. Otherwise invoke the `planner` agent to produce the order.
4. Print the queue to the user as a numbered list. If the queue is large (>5), confirm before starting.

### Phase 2 — Per-issue loop
For each issue in queue order:
1. Print a banner: `▶ Issue #N — <title>`
2. Invoke the `feature-loop` skill with the issue title + body as the prompt.
3. `feature-loop` will pause at its `AWAITING_USER_TEST` checkpoint — the user tests this issue's feature, replies, and the loop closes with `APPROVED` or `BLOCKED`.
4. On `APPROVED`:
   - **Sync specs**: read `specs/*.md`, find `(TODO)` markers that match this issue's scope, remove them. Edit the spec to reflect what shipped if needed.
   - **Log to Notion** (see Notion section)
   - **Optionally close the GitHub issue** (`gh issue close N --comment "..."`) — confirm with user first time, then remember the choice for the rollup.
5. On `BLOCKED`:
   - Log to Notion with `❌ Failed` status and the blocker reason
   - If fail-fast mode → stop the rollup, report
   - Else → continue to next issue

### Phase 3 — Final rollup
After the queue empties (or stops):
1. Compute totals: completed, blocked, skipped
2. Write a single rollup entry to Notion: **Marketing Dashboard > Issues > Rollup <date>**
3. Print a final summary to the user:
   ```
   📊 Rollup complete
   ✅ Completed: <n>
   ❌ Blocked:   <n>
   ⏭ Skipped:   <n>
   Total time:  <hh:mm>
   Blockers needing follow-up: <list>
   ```

## Notion logging
Page: **Marketing Dashboard > Issues**

Every issue (even ad-hoc, non-issue user prompts driven through this protocol) gets a row with:
- Issue # (or `ad-hoc-<timestamp>` if none)
- Title
- Status: `✅ Completed` / `❌ Failed` / `⏭ Skipped`
- Summary: 1-3 sentences on what shipped or why it failed
- Blockers / follow-up actions
- Timestamp

If the Notion MCP server is not connected, fall back to appending the same record to `.claude/orchestrator-log.md` and surface a warning to the user once.

## Guardrails
- **Never reorder issues away from the Planner's plan** without explicit user confirmation.
- **One issue at a time.** Never bundle multiple issues into one `feature-loop` invocation.
- **Specs are source of truth** — sync them after every successful issue, not at the end.
- **Don't skip Notion logging**, even on failures. The audit trail is the point.
- **Don't write code or TIPs directly** — that's `developer` and `architect` territory. This skill only coordinates.
- **Pause and confirm before destructive actions** (closing issues, force-pushing, etc.) per auto-mode rules.
