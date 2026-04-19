# Workflow Quick Reference

Use this page when you need to decide which agent to invoke for a task in this repository.

## Start Here

1. Read `AGENTS.md` for the full roster and permission model.
2. Read the relevant file in `specs/` and `architecture.md` if the task affects implementation details.
3. Choose the agent based on the kind of work needed, not based on which files you expect to touch.

## Fast Routing

| Situation | Call | Use When | Output |
|---|---|---|---|
| I have a new feature idea | `@planner` | The request is still high level and needs to become ordered GitHub Issues | Planned issue sequence with embedded TIPs |
| I need a technical implementation plan | `@architect` | An issue exists and needs file-level implementation guidance | TIP for the developer |
| I need code changed | `@developer` | A TIP exists and implementation should begin now | Code changes plus required spec updates |
| I want browser-tested gap fixing in a loop | `@Auto_Loop` | You want Playwright to find missing workflow behavior, orchestrator to implement fixes, and Playwright to re-test | Final `APPROVED` or `BLOCKED` verdict with tested evidence |
| I want the whole feature completed without checkpoints | `@feature-loop` | You want architect, developer, and tester run in sequence automatically | Final `APPROVED` or `BLOCKED` verdict |
| I want all open feature issues processed | `@orchestrator` | Multiple planned issues should be run through the full delivery loop | Issue-by-issue execution summary |
| There is a bug | `@debugger` | You need diagnosis and a small targeted fix | Root cause, minimal fix, spec sync, bug log |
| Review code quality | `@reviewer` | You want findings, risks, and an improvement plan instead of edits | Review report and follow-up plan |
| Expand a brief into stories or product analysis | `@analyst` | You need structure, personas, and acceptance criteria before planning | Analysis and story breakdown |
| Update repo planning docs | `@plan_modifyer` | Non-spec markdown needs to be revised consistently | Updated docs outside `specs/` |

## Common Requests

| What you want | Recommended call |
|---|---|
| "I have a new feature idea" | `@planner` |
| "There's a bug" | `@debugger` |
| "Review code quality" | `@reviewer` |
| "Implement an issue" | `@orchestrator` or `@feature-loop` |
| "Test full workflow and implement missing pieces" | `@Auto_Loop` |
| "Turn this issue into a TIP" | `@architect` |
| "Implement this TIP" | `@developer` |

## Execution Paths

### Standard planned workflow

```text
@planner
  -> @architect
  -> @developer
  -> @tester_reviewer
```

Use this path when a request starts as a feature idea and you want deliberate planning before implementation.

### Autonomous single-feature workflow

```text
@feature-loop
  -> @architect
  -> @developer
  -> @tester_reviewer
  -> repeat until APPROVED or BLOCKED
```

Use this path when you want one feature taken from prompt or TIP to completion without manual checkpoints.

### Playwright-driven autonomous completion workflow

```text
@Auto_Loop
  -> @Playwright Tester (baseline workflow test)
  -> @orchestrator (implement Playwright-listed issues)
  -> @Playwright Tester (re-test + regression)
  -> repeat until APPROVED or BLOCKED
```

Use this path when implementation priorities should be driven by real browser-tested failures and re-validation cycles.

### Autonomous multi-issue workflow

```text
@orchestrator
  -> @feature-loop per issue
```

Use this path when the work already exists as a sequence of GitHub Issues and should be processed in order.

## Prompt Templates

### Planning

```text
@planner
Break this feature into ordered GitHub Issues with embedded TIPs: <request>
```

### Architecture

```text
@architect
Create a TIP for issue #<number>.
```

### Direct implementation

```text
@developer
Implement this TIP and update the matching spec files.
```

### Autonomous execution

```text
@feature-loop
Implement this feature end-to-end: <request or TIP>
```

### Playwright-driven autonomous execution

```text
@Auto_Loop
Test this workflow end-to-end, list missing or failing behavior, orchestrate implementation, and keep looping until stable: <workflow scope>
```

### Batch execution

```text
@orchestrator
Process all open feature issues in planner order.
```

### Debugging

```text
@debugger
Diagnose and fix: <bug description>
```

### Review

```text
@reviewer
Audit the codebase and produce a prioritized review report.
```

## Guardrails

- Only `developer` is allowed to make general implementation changes to repository code and specs.
- `debugger` may make small targeted fixes, but still must keep specs in sync.
- `reviewer`, `planner`, `architect`, `analyst`, `feature-loop`, and `orchestrator` are coordination or analysis roles unless their instructions explicitly say otherwise.
- `Auto_Loop` is a coordination role that must route implementation through `orchestrator` and never edit code directly.
- Any implementation change must be reflected in the appropriate file under `specs/`.

## Practical Rule

If you are unsure, choose the earliest agent in the workflow that matches the maturity of the request:

- idea -> `planner`
- issue -> `architect`
- approved TIP -> `developer`
- one-shot end-to-end execution -> `feature-loop`
- browser-tested implementation loop -> `Auto_Loop`
- many issues -> `orchestrator`