# Agents Folder Structure

This folder is organized by role so each file stays focused.

## Orchestrator
- `feature-loop.agent.md`
  - Owns workflow control only (architect -> developer -> tester loop).
  - Stops at APPROVED or BLOCKED after 5 cycles.
- `auto_loop.agent.md`
  - Owns Playwright-driven workflow control (Playwright Tester -> orchestrator -> Playwright Tester).
  - Converts browser failures into ordered implementation items and loops until stable or blocked.

## Specialists
- `architect.agent.md`
  - Converts request or issue into a TIP.
- `developer.agent.md`
  - Implements TIP changes in repository files.
- `tester_reviewer.agent.md`
  - Validates implementation against TIP and returns strict verdict.
- `planner.agent.md`
  - Breaks high-level ideas into GitHub issues.
- `reviewer.agent.md`
  - Performs broad code quality audit and improvement planning.

## Naming Convention
- Keep one clear responsibility per agent file.
- Put loop control logic in orchestrators.
- Put implementation or validation logic in specialist agents.
- Use `auto_loop.agent.md` when priorities should come from browser-observed workflow gaps.
