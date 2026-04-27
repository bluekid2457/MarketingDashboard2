---
name: plan-modifyer
description: Bulk-edit documentation markdown files (architecture, plans, user stories, READMEs) outside the specs/ directory. Use when the user asks to rename a term, remove mentions, or update phrasing across docs — e.g. "change all references to Supabase to Firebase in docs", "remove all mentions of legacy workflow from plans".
---

# Plan Modifier

Procedural skill for safe, repository-wide documentation edits. The main session executes the find-and-edit directly using `Grep` + `Edit`/`Write` tools. No subagent involved.

## When to invoke
- "Rename X to Y in all the docs"
- "Remove all mentions of X from user stories"
- "Update the project name everywhere except specs"
- Any documentation-consistency sweep

## When NOT to invoke
- The change touches code (`.ts`, `.py`, `.json`, etc.) → use `developer` agent
- The change touches `specs/*.md` → those are formal specs, edit deliberately, not in bulk
- The change is ambiguous and affects only one file — just edit it directly
- The user wants a refactor, not a rename → use `developer` or `reviewer`

## Hard constraints
- **Never edit anything inside `specs/`.** Specs are the formal source of truth and changes there must go through architect/developer flow.
- **Never edit code, configuration, migrations, or scripts.** Markdown only.
- **Never alter acceptance criteria or TIPs**, even outside `specs/`.

## Protocol

### 1. Parse the request
Extract:
- The search pattern (literal string, regex, or concept)
- The replacement (or "remove")
- Any explicit scope hints ("only in user stories", "everywhere except README")

If the request is ambiguous (e.g., "change x" with no scope), ask one clarifying question before proceeding.

### 2. Discover candidate files
```
Grep pattern=<search> --glob "*.md" --glob "!specs/**" output_mode=files_with_matches
```
Always exclude `specs/**`. Common search dirs: repo root, `docs/`, `plans/`, anything matching `*.md` outside `specs/` and `node_modules/`.

### 3. Inspect each match before editing
For each candidate file:
1. Read enough surrounding context to confirm the match isn't a false positive (e.g., "Firebase" in a code block describing the old "Supabase" architecture should still be edited; "Supabase" in a quoted historical note maybe shouldn't).
2. Decide per-file: edit, skip, or flag for review.

### 4. Apply edits
- Use `Edit` for single occurrences with surrounding context.
- Use `Edit` with `replace_all: true` for bulk identical replacements within a file.
- Preserve formatting, indentation, headings, link targets.

### 5. Report
Print a summary:
```
Plan-modifier sweep: "<old>" → "<new>"
Edited (<n>):
  - <file> — <m> occurrences
Skipped (<k>):
  - <file> — <reason>
Flagged for review (<j>):
  - <file>:<line> — <why ambiguous>
```

If anything was flagged, ask the user before applying or skipping those.

## Best practices
- Prefer minimal edits when intent is unclear.
- If the rename is one-way (e.g., new term replaces old everywhere), set `replace_all: true` per file. If contextual nuance matters, do per-occurrence edits with extra surrounding context to make `old_string` unique.
- Surface anything that looks like it might break a doc's meaning — links, code samples, version references.
- Never run `git commit` automatically after a sweep. Hand off to the user to review the diff first.
