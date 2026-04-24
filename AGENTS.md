# Agent Index

This file is the repo-root quick reference for the agent system used in Marketing Dashboard. It is intended to let any agent starting cold understand which agent to invoke, where its instructions live, what it is allowed to do, and what it should hand off next.

## Read First

Start here for overall repo context before diving into a specific agent file:

| Document | Purpose |
|---|---|
| `README.md` | Project entry point, setup, stack, environment variables |
| `architecture.md` | Runtime architecture, API map, data model, security expectations |
| `user_stories.md` | Product intent, personas, acceptance criteria |
| `specs/backend.md` | Backend behavior and API contract |
| `specs/frontend.md` | Frontend routes, screens, and UI behavior |
| `specs/database.md` | Database model, schema, and migration expectations |
| `specs/automation.md` | Automation platform flows and constraints |
| `specs/screens.md` | Screen-by-screen UI reference |

## Shared Rules

- Only the `developer` agent is permitted to edit repository code, scripts, configuration, migrations, or specs.
- All non-developer agents are read/analyze/coordinate roles unless their file explicitly says otherwise.
- Any code change must keep the relevant file in `specs/` in sync with the actual implementation.
- The main execution chain is `planner -> architect -> developer -> tester_reviewer`, coordinated by `feature-loop` and `orchestrator` when autonomous execution is needed.
- Do not write operational logs to Notion; use GitHub Issues and in-repo documentation only.

## Cross-Agent Delegation Contract

Use this contract whenever one agent calls another agent. This is mandatory for all handoffs.

- Any agent may invoke another agent when that target is listed in either `handoffs:` or `agents:` in the caller's `.agent.md` file.
- Every handoff prompt must be explicit and include the required sections below.
- Never use vague delegation prompts such as "please continue" or "handle this".

Required handoff sections:
1. Objective
2. Scope (in-scope and out-of-scope)
3. Inputs (issue/TIP, files, constraints, assumptions)
4. Deliverables (exact output expected)
5. Done Criteria (what counts as complete)
6. Next Handoff (who receives output next)

Handoff prompt template:

```text
Objective:
Scope:
In-Scope:
Out-of-Scope:
Inputs:
Deliverables:
Done Criteria:
Next Handoff:
```

## Agent Roster

| Agent | File | Trigger | Can Edit Repo Files | Primary Output | Default Handoff |
|---|---|---|---|---|---|
| Planner | `.github/agents/planner.agent.md` | New feature idea, bug decomposition, roadmap breakdown | No | Ordered GitHub Issues with embedded TIPs in issue bodies and `create_issues.ps1` updates | `architect` |
| Architect | `.github/agents/architect.agent.md` | A GitHub Issue needs an implementation-ready TIP | No | Technical Implementation Plan covering relevant layers, risks, and acceptance criteria | `developer` |
| Developer | `.github/agents/developer.agent.md` | A TIP is approved for implementation | Yes | Code changes plus mandatory matching updates in `specs/` | `architect` review |
| Tester Reviewer | `.github/agents/tester_reviewer.agent.md` | A developer pass needs validation against the TIP | No | Strict `APPROVED` or `NEEDS WORK` verdict with concrete issues | back to `developer` when needed |
| Auto_Loop | `.github/agents/auto_loop.agent.md` | You want test-driven autonomous completion using Playwright findings | No | Repeating loop: Playwright gap detection -> orchestrator execution -> Playwright re-test until stable | none; returns final verdict |
| Feature Loop Manager | `.github/agents/feature-loop.agent.md` | Fire-and-forget execution of one feature or one TIP | No | Closed-loop orchestration across architect, developer, and tester until approved or blocked | none; returns final verdict |
| Orchestrator | `.github/agents/orchestrator.agent.md` | Batch execution across open feature issues | No | Multi-issue coordination, spec TODO cleanup, and issue-level completion tracking | `feature-loop` |
| Reviewer | `.github/agents/reviewer.agent.md` | Ad-hoc or periodic codebase audit | No | Prioritized review report and general improvement plan | `planner` |
| Debugger | `.github/agents/debugger.agent.md` | Interactive bug diagnosis or small targeted fixes | Yes | Diagnosis, minimal fix, and spec sync | none required |
| Analyst | `.github/agents/analyst.agent.md` | Product/data analysis, story expansion, insight work | No | Structured analysis, story breakdowns, and planning-ready output | `developer` when implementation is requested |
| Plan Modifyer | `.github/agents/plan_modifyer.agent.md` | High-level edits to non-spec markdown plans/docs | No | Updated markdown documentation outside `specs/` | `developer` review |

## When To Use Which Agent

| Situation | Best Agent | Why |
|---|---|---|
| "I have a new feature idea" | `planner` | Breaks the request into ordered GitHub Issues and embeds TIPs |
| "Turn this issue into an implementation blueprint" | `architect` | Produces the TIP the developer will execute |
| "Implement this TIP" | `developer` | Only agent allowed to make implementation changes |
| "Build this feature end-to-end without checkpoints" | `feature-loop` | Runs architect/developer/tester in an autonomous loop |
| "Test workflow gaps and auto-implement fixes" | `Auto_Loop` | Uses Playwright to find missing behavior, calls orchestrator to implement, then re-tests |
| "Process all open feature issues" | `orchestrator` | Coordinates issue-by-issue execution across the backlog |
| "Review the codebase and propose improvements" | `reviewer` | Produces a prioritized audit and improvement plan |
| "There is a bug, diagnose and fix it" | `debugger` | Handles interactive troubleshooting and small fixes |
| "Expand a thin brief into user stories or analysis" | `analyst` | Produces planning-grade analysis and acceptance criteria |
| "Update planning markdown across the repo" | `plan_modifyer` | Applies documentation changes outside `specs/` |

## Workflow Map

```text
Idea / Request
  -> planner
  -> architect
  -> developer
  -> tester_reviewer

Single-feature autonomous path
  -> feature-loop
     -> architect
     -> developer
     -> tester_reviewer
     -> repeat until APPROVED or BLOCKED

Playwright-driven autonomous completion path
  -> Auto_Loop
     -> Playwright Tester (discover failures)
     -> orchestrator (implement issue list)
     -> Playwright Tester (verify and discover remaining)
     -> repeat until APPROVED or BLOCKED

Multi-issue autonomous path
  -> orchestrator
     -> feature-loop per issue
```

## Tool and Responsibility Notes

| Agent | Key Responsibility Notes |
|---|---|
| `planner` | Must create focused issues, apply repo labels, embed full TIP content in issue bodies, save commands to `create_issues.ps1`, and run the script from repo root |
| `architect` | Must not write implementation code; only produce implementation-ready TIP sections relevant to the issue |
| `developer` | Must read before editing, implement directly in files, and update the matching `specs/` file for every code change |
| `tester_reviewer` | Must validate only against the TIP and return a strict verdict, not new requirements |
| `Auto_Loop` | Must begin with Playwright validation, create test-derived issue list only, call orchestrator for implementation, then re-test until stable or blocked |
| `feature-loop` | Must keep looping without asking for approval until tester approves or loop guardrails stop execution |
| `orchestrator` | Must preserve Planner ordering, keep `specs/*.md` TODO markers accurate, and log feature outcomes |
| `reviewer` | Must produce evidence-based findings only, grouped into a review report and general improvement plan |
| `debugger` | Must keep fixes minimal and sync specs |
| `analyst` | Produces structured analysis and story output, not implementation changes |
| `plan_modifyer` | Limited to markdown documentation changes outside `specs/` |

## Skills and Supporting Files

| File | Role |
|---|---|
| `.github/agents/README.md` | Folder structure and responsibility split for agent files |
| `.github/agents/skills/planner-tip-generation.SKILL.md` | TIP generation guidance used by the planner |
| `.github/agents/skills/github-issue.md` | GitHub issue creation support material |
| `.github/agents/skills/user_story_rollout_tip.md` | Additional rollout/user story guidance |

## Quick Rules For Cold Starts

1. Read this file first.
2. Read the specific `.agent.md` file for the role you are about to use.
3. Read the relevant `specs/` file and `architecture.md` before proposing implementation details.
4. If code must change, route through `developer` unless you are explicitly using `debugger` for a small bug fix.
5. Treat `specs/` as the canonical mirror of implemented behavior and keep it current.