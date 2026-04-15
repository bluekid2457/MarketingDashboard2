---
description: Adds TIP (Technical Implementation Plan) generation to the planner agent. When the planner creates an issue, it also generates a TIP using the architect’s TIP template and saves it alongside the issue breakdown. This ensures every issue is implementation-ready without a separate architect handoff.
---

# Planner TIP Generation Skill

## Purpose
Enable the planner agent to generate a detailed TIP for each issue it creates, using the architect agent’s TIP template. This eliminates the need for a separate architect handoff and accelerates implementation.

## How to Use
- For each issue, after writing the Problem, Proposed Solution, and Acceptance Criteria, generate a TIP using the following sections:
  1. Issue Summary
  2. Root Cause / Motivation
  3. Database Schema Changes (if applicable)
  4. API Endpoint Changes (if backend is affected)
  5. Playwright Script Changes (for automation)
  6. Next.js Frontend Changes (UI/UX)
  7. Environment & Configuration
  8. File System Changes
  9. Edge Cases & Risks
  10. Acceptance Criteria
- Only include sections relevant to the issue.
- Save each TIP in a tips/ directory (e.g., tips/issue-<number>-tip.md) or append to the issue body if desired.
- Reference the TIP location in the issue body for developer handoff.

## Example Issue Body with TIP Reference
```markdown
## Problem
...

## Proposed Solution
...

## Acceptance Criteria
- ...

---

See TIP: tips/issue-1-tip.md
```

## Example TIP (tips/issue-1-tip.md)
```markdown
# TIP for Issue #1: Foundation: establish workspace and content lifecycle model

## 1. Issue Summary
...
## 2. Root Cause / Motivation
...
## 3. Database Schema Changes
...
...
## 10. Acceptance Criteria
- ...
```

## Best Practices
- Use the architect’s TIP template for structure and content.
- Only include sections that apply to the issue.
- Keep TIPs concise but implementation-ready.
- Update the planner agent instructions to invoke this skill after each issue is created.
