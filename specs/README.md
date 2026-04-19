# Specs Directory Guide

This file defines which spec in `specs/` owns each part of the system so agents and contributors know where to read first and where to keep documentation in sync after implementation changes.

## How To Use This Folder

1. Read the spec that owns the layer you are about to change.
2. If a change crosses layers, update every affected spec file rather than forcing cross-layer details into one document.
3. Treat these files as the canonical mirror of the implemented system, not as aspirational notes.

## Spec Ownership

| File | Primary Owner For | Current Coverage |
|---|---|---|
| `backend.md` | FastAPI backend behavior, backend environment variables, app startup/config, CORS, API endpoints, backend security expectations | Currently documents the FastAPI stack, folder structure, env vars, `GET /health`, CORS, local run steps, and backend security expectations |
| `frontend.md` | Next.js frontend routes, shared UI structure, auth flow, screen behavior, client/server frontend integrations, frontend env usage, Next.js API routes | Currently the most detailed spec: covers app structure, route groups, shared components, login/register flow, all 12 app screens, AI settings flow, dynamic route pattern, `/api/angles`, `/api/drafts`, `/api/trends`, debugging notes, and frontend security |
| `database.md` | Firestore collections, document shape, relationships, indexes, migration strategy, Firestore rules, and data integrity requirements | Currently focused on `users/{uid}/ideas/{ideaId}`, including required fields, query pattern, security rules, and testing requirements |
| `automation.md` | Browser automation flows, publishing/scheduling logic, OAuth/platform posting flows, automation integration points, retries, anti-bot handling, and automation testing requirements | Currently a high-level placeholder and should be expanded as Playwright or platform automation is implemented |
| `screens.md` | Screen-by-screen UX reference, purpose, components, and primary interactions for the product surfaces | Currently describes all 12 major screens at the product/UI level and complements `frontend.md` rather than replacing it |

## Supporting Screen Assets

The `screens/` subfolder contains visual reference assets used by screen-related implementation work:

- `AdaptationScreen.jpg`
- `AngleOutlineScreen.png`
- `DraftEditorScreen.jpg`
- `IdeaScreen.png`
- `LoginScreen.jpg`

Use `screens.md` together with these images when implementing or reviewing page layout and screen composition.

## Boundary Rules

### Update `backend.md` when

- FastAPI routes, request/response contracts, or auth requirements change.
- Backend environment variables, config loading, or CORS behavior changes.
- Backend startup, runtime dependencies, or security expectations change.

### Update `frontend.md` when

- A Next.js route, layout, screen behavior, or shared component changes.
- Firebase auth flow, frontend environment variable usage, or protected route behavior changes.
- A Next.js route handler under `src/app/api/` changes behavior or contract.

### Update `database.md` when

- Firestore paths, document fields, validation rules, indexes, or security rules change.
- A new collection or subcollection is introduced.
- Query patterns or data integrity constraints change.

### Update `automation.md` when

- Scheduling logic changes.
- Browser automation flows or platform posting steps are added or updated.
- OAuth posting behavior, retries, anti-bot handling, or automation logging changes.

### Update `screens.md` when

- The product-level purpose, components, or major interactions of a screen change.
- The visual reference for a screen changes in a way that should affect design or QA review.

## Which File To Read First

| If you are working on | Read first |
|---|---|
| FastAPI app behavior or backend config | `backend.md` |
| Login, dashboard, ideas, angles, drafts, app layout, or frontend API routes | `frontend.md` |
| Firestore data shape or rules | `database.md` |
| Scheduling, publishing automation, or browser-driven platform flows | `automation.md` |
| UI composition or visual screen intent | `screens.md` |

## Current Reality Notes

- `frontend.md` currently contains the most implementation-specific detail in the repo.
- `backend.md` is accurate for the existing minimal FastAPI backend, but it does not yet describe a broad API surface.
- `database.md` currently documents the ideas data model only; additional collections should be added there as they are implemented.
- `automation.md` is intentionally sparse today and should be treated as the owner for future automation detail once those flows exist in code.