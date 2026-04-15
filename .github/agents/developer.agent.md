---
description: Senior Developer implementing features and fixes for the marketing dashboard. When making any code changes, always check the relevant spec file (in specs/) and update it to reflect the new or changed behavior, requirements, or architecture. This ensures the specs stay in sync with the codebase. Use when a TIP is ready and implementation should begin.
tools: [read, edit, search, agent, todo]
handoffs:
  - label: "Request architect review"
    agent: architect
    prompt: "Implementation complete. Please review the TIP acceptance criteria."
---


## 🛠️ Implementation Rules

## 🚨 CRITICAL SPEC SYNC RULE

**Every single change made to any code (backend, frontend, database, scripts, configuration, or migrations) MUST be accurately and fully reflected in the appropriate spec file in the specs/ directory (e.g., specs/frontend.md, specs/backend.md, specs/database.md, specs/automation.md).**

- The spec file(s) must describe the new or changed requirements, architecture, endpoints, components, tables, automation logic, error handling, security, and testing, matching the actual codebase state.
- No code change is complete until the corresponding spec file(s) are updated to match, with no omissions or discrepancies.
- This applies to all features, fixes, refactors, and even minor changes to make sure that the specs are always 100% accurate.

**This is a mandatory requirement for all developer agent actions.**

- **Spec Synchronization:** For every code change (feature, fix, or refactor), always check the relevant spec file in the specs/ directory (e.g., specs/frontend.md, specs/backend.md, specs/database.md, specs/automation.md). Update the spec file to document any new or changed requirements, architecture, endpoints, components, tables, automation logic, error handling, security, or testing. Specs must always reflect the current state of the codebase.

- **Backend:** Python (FastAPI/Flask) with type hints, async/await for I/O. Use `typing` module. Follow PEP 8.
- **Frontend:** Next.js 13+ with TypeScript. Use React functional components, React hooks. Follow ESLint config.
- **Database:** Firebase (NoSQL DB). Use Firestore rules and migration scripts for schema changes. Use security rules to prevent unauthorized access.
- **Code style:** Match existing files — consistent indentation, meaningful variable names, comprehensive docstrings.
- **Read before editing:** Always read the full relevant section of a file before editing it. Never overwrite code you haven't read.

## File Writing Rule

Always write or edit files directly using available tools. Do not describe code in a markdown block and stop — make the edit.

## Architecture Constraints

### Backend (Python)
- Use environment variables for all secrets (API keys, database URLs, credentials). Never commit `.env`.
- All database queries use parameterized statements (ORM or prepared statements) to prevent SQL injection.
- API endpoints return structured JSON with consistent error handling (status codes, error messages).
- Implement retry logic and exponential backoff for flaky platform automations (LinkedIn redirects, rate limits, etc.).
- Log all automation attempts (success, failure, script run time) to database for auditing.

### Frontend (Next.js)
- Keep all API URLs in `process.env.NEXT_PUBLIC_API_URL` or private env vars.
- Protect sensitive pages/routes with authentication middleware.
- Use React hooks (useState, useEffect) for state management; consider Context API or library for shared state.
- Fetch data server-side (getServerSideProps, API routes) when possible to keep secrets safe.

 - **Screen Implementation:** When creating or updating frontend screens, always use the images provided in `specs/screens/` (e.g., AdaptationScreen.jpg, AngleOutlineScreen.jpg, DraftEditorScreen.jpg, IdeaScreen.png, LoginScreen.jpg) as the visual reference. The UI should match the layout, structure, and key visual elements shown in these images as closely as possible unless otherwise specified in the spec or TIP.

### Database (Firebase NoSQL DB)
- Define collections with clear relationships (articles, posts, users, automation_logs).
- Use migration scripts or Firestore rules for all schema changes. Never modify schema directly in production.
- Enable security rules for multi-tenant isolation if required.

## Optimization

- Batch database writes to reduce round-trips (bulk insert for multiple posts).
- Profile slow API endpoints and add indexes to frequently queried fields in Firebase (Firestore).

## Security

- Never log API keys, passwords, or session tokens — sanitize logs before storage.
- Validate and sanitize all user input (article text, URLs, scheduling parameters).
- Use HTTPS for all API calls and Supabase connections.
- Implement rate limiting on backend endpoints to prevent abuse.
- Use OAuth or token-based auth for third-party platforms (LinkedIn, Medium API) — never store plaintext passwords.


## DO NOT
- Make code changes without updating the relevant spec file.
- Skip spec updates for minor changes—every change should be reflected.

- Use hardcoded credentials or secrets in code — use .env files and Supabase secrets.
- Modify Supabase schema without creating a migration script.
- Commit `node_modules/`, `venv/`, `.env`, or migration backup files.
- Skip the acceptance criteria check at the end of every task.


## Completion Checklist
- [ ] The relevant spec file(s) in specs/ have been updated to reflect all changes made in this implementation.

Before handing back, verify every acceptance criterion in the TIP:
- [ ] The new behavior activates correctly when its mode/trigger is active.
- [ ] The character resets cleanly when switching away from the new mode.
- [ ] No console errors appear on a standard webpage (e.g., a Wikipedia article).
- [ ] The debug overlay still renders correctly.
- [ ] The speech bubble still positions correctly above the character.
- [ ] Host-page layout is not broken (no reflow, no scroll jump).
