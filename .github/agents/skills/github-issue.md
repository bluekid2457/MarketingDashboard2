---
mode: skill
description: Reads GitHub issues, sub-issues, and task lists to extract complete requirements
tools:
  - github
---

# GitHub Issue Integration Skill

## Purpose
Read and parse GitHub issues, including all sub-issues, task lists, and linked references, to extract complete requirements for implementation.

## MCP Server Dependency
This skill requires the **GitHub MCP Server** (`@modelcontextprotocol/server-github`).
Ensure the `GITHUB_TOKEN` environment variable is set with a personal access token that has `repo` scope.

## Repository
- **Repository**: `figma-demo`

## Capabilities

### 1. Read Issue Details
- Fetch issue by number from the repository
- Extract title, description, labels, assignees, and milestone
- Parse the issue body for structured requirements
- Identify acceptance criteria sections

### 2. Resolve Sub-Issues and Task Lists
- Detect task list items (`- [ ]` / `- [x]`) in issue body
- Identify linked sub-issues referenced by `#<number>` patterns
- Recursively fetch and parse all sub-issues
- Track completion status of each task/sub-issue
- Build a hierarchical requirements tree

### 3. Extract Linked References
- Detect cross-references to other issues and PRs
- Identify "depends on", "blocks", "related to" relationships
- Fetch linked issue details for full context
- Map dependencies between issues

### 4. Parse Requirements
- Extract user stories (As a... I want... So that...)
- Identify acceptance criteria (Given/When/Then or bullet lists)
- Detect technical requirements and constraints
- Identify design references (Figma links, mockup URLs)
- Extract mentioned file paths or component names

## Output Format
When invoked, produce a structured requirements summary:

```markdown
## Issue #<number>: <title>

### Description
<parsed description>

### Requirements
1. <requirement 1>
2. <requirement 2>
...

### Acceptance Criteria
- [ ] <criterion 1>
- [ ] <criterion 2>
...

### Sub-Issues
- #<number>: <title> [status]
  - <sub-issue requirements summary>

### Task List
- [ ] <task 1>
- [x] <task 2> (completed)

### Dependencies
- Depends on: #<number>
- Related to: #<number>

### Design References
- Figma: <extracted figma links>

### Technical Notes
- <any technical constraints or notes from the issue>
```

## Usage Instructions
1. Use GitHub MCP tools to fetch the issue: `get_issue` with owner, repo, and issue number
2. Parse the response body for task lists and sub-issue references
3. For each sub-issue reference (`#<number>`), recursively fetch and parse
4. Compile all information into the structured output format above
5. Highlight any ambiguous or missing requirements that need clarification

## Error Handling
- If an issue is not found, report the error clearly with the issue number
- If sub-issues fail to load, note them as "unable to fetch" and continue
- If the token lacks permissions, guide the user to update the `GITHUB_TOKEN`
