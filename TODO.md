# Website Review — Findings (2026-04-24)

Reviewer: playwright-tester (browser walk-through)
Scope: Full app workflow + all AI tools, no code changes made.
Tester account: qa@example.com (existing test user).

## Summary
- Total findings: 22 (P0: 4 / P1: 7 / P2: 8 / P3: 3)
- Routes tested: /login, /register, /dashboard, /ideas, /angles, /storyboard, /storyboard/[id], /drafts (redirects), /review, /adapt/new, /adapt/[id], /publish, /analytics, /collaboration, /notifications, /settings
- AI tools tested: Idea AI scoring/rationale, Angle generator + Regenerate, Storyboard Regenerate, Storyboard "Send to AI Chat" (sentence-level diff), Adapt "Continue and Generate" platform expansion, Adapt AI Chat, References/citations panel.

## Findings

### [P0] AI Chat in Storyboard fails silently — Send button stays clickable, message is dropped, no chat history rendered
- **Route**: /storyboard/LV1ktHx1We3ZX8VI783g?angleId=fallback-1 (any storyboard with content)
- **What I did**: Typed "Make the introduction more concise." into the AI Chat Assistant textbox, clicked **Send to AI Chat**.
- **Expected**: Either the message + AI reply renders in a chat history (with sentence-level diffs as the description promises), OR the user gets a clear blocking error before they can send.
- **Actual**: The submitted message disappears. No chat bubble is shown, no diff preview appears in the editor, no toast/banner is raised on click. After submission the panel only shows the helper text "No AI API key found. Add a key in Settings before using AI chat." but the Send button is still enabled and behaves as a no-op. No POST hits `/api/*` in the network tab.
- **Evidence**: After click, `document.querySelector('main').innerText` for the chat panel still only contains the static helper text and "Send to AI Chat" button. Zero `localhost:3000/api/...` requests recorded for the action.
- **Notes**: Combined with the lack of any "configure key" CTA in the chat panel, this looks like total blocker UX — the headline AI feature appears functional but does nothing. At minimum the Send button should be disabled when no key is configured, with a "Configure key in Settings →" link.

### [P0] Storyboard "Regenerate Storyboard" silently produces nothing when no AI key is set
- **Route**: /storyboard/aHc3mcxt0L6uO5YoQiWC?angleId=fallback-1 (a storyboard with no saved content)
- **What I did**: Clicked **Regenerate Storyboard** on a brand-new/empty storyboard.
- **Expected**: Either content is generated, or a clear error/CTA is shown that an AI key must be configured first.
- **Actual**: Textarea remains empty (`length: 0`). The only signal is a tiny grey banner at the top that reads "No AI API key found. Add a key in Settings before generating storyboard content." The Regenerate button still looks enabled and clickable, with no spinner/disabled state, no toast, and no link to Settings.
- **Evidence**: Word counter stays at "0 words"; main textarea `value === ''` after click and 3-second wait.
- **Notes**: The whole pipeline (Ideas → Angles → Storyboard → Adapt) breaks here for any new user without an AI key. There is no onboarding nudge before this screen.

### [P0] Adapt "Continue and Generate" silently fails — selected platforms never appear as tabs, no network call, no error
- **Route**: /adapt/LV1ktHx1We3ZX8VI783g?angleId=fallback-1
- **What I did**: Toggled `X / Twitter` in the "Generate Platforms" picker, then clicked **Continue and Generate**.
- **Expected**: A new "X / Twitter" tab appears under "Platform Content" with generated copy, OR a visible failure state.
- **Actual**: After 4 seconds, the only tab is still "LinkedIn". No new platform tab, no spinner, no error toast. Network requests show zero new `localhost:3000/api/*` POSTs after the click — meaning the click handler likely no-ops when no AI key is present (same root cause as above), but there is no UI feedback at all.
- **Evidence**: `Array.from(document.querySelectorAll('button')).filter(b=>b.innerText.match(/LinkedIn|Twitter|Medium/))` returns only `["X / Twitter", "Medium", "L\nLinkedIn"]` — i.e. the picker buttons unchanged plus the existing LinkedIn tab. No new tab created.
- **Notes**: Same disabled/CTA pattern needed as the storyboard Regenerate.

### [P0] Step navigator on Storyboard & Adapt routes Storyboard/Adapt tabs back to /angles, breaking the workflow
- **Route**: /storyboard/[id]?angleId=... and /adapt/[id]?angleId=...
- **What I did**: On both pages, hovered/inspected the breadcrumb-style step navigator (1 Ideas → 2 AI Angles → 3 Storyboard → 4 Adapt → 5 Review → 6 Publish).
- **Expected**: Step 3 links to the storyboard for the current idea/angle; Step 4 links to the adapt URL for the current idea/angle.
- **Actual**: On both Storyboard and Adapt pages, Step 3 (Storyboard) and Step 4 (Adapt) link to `/angles?ideaId=<id>`. Clicking them sends the user back to Angles instead of forward to Adapt or staying on Storyboard. The same bug exists on /ideas where Step 3, 4 also point at `/angles`. Only the angle-detail page (/angles?ideaId=...) generates correct deep links to /storyboard/[id] and /adapt/[id].
- **Evidence**: Snapshot of /storyboard/LV1ktHx1We3ZX8VI783g shows: `link "3 Storyboard" -> /angles?ideaId=LV1ktHx1We3ZX8VI783g`, `link "4 Adapt" -> /angles?ideaId=LV1ktHx1We3ZX8VI783g`. Same on /adapt/[id]. Same on /ideas (Steps 3 & 4 also -> /angles).
- **Notes**: Likely a single `getStepLinks(idea)` helper that doesn't pick up the current angleId. Files: `frontend/src/app/(app)/storyboard/[id]/page.tsx`, `frontend/src/app/(app)/adapt/[id]/page.tsx`, `frontend/src/app/(app)/ideas/page.tsx`.

### [P1] References panel is misleading — "Uncited factual claims" lists every section header as a "claim" but actual citations [1] [2] already exist in the Sources block
- **Route**: /storyboard/LV1ktHx1We3ZX8VI783g?angleId=fallback-1
- **What I did**: Loaded an existing storyboard with content that already contains "## Sources" and inline `[1]` / `[2]` references.
- **Expected**: References panel correlates inline citation numbers with their sources and only flags claims that are genuinely unsourced.
- **Actual**: The "Uncited factual claims" list shows section headers and structural sentences (e.g. "## Top friction points causing weak outcomes Map the most immediate blockers Small Business face with..."). These are obviously not factual claims. Meanwhile the existing `[1]`/`[2]` numerical citations are not visually associated with any sentence. The footer reads "Detected links in draft: 2" with no further info.
- **Evidence**: Panel content shows 5 "uncited" entries that are just outline scaffolding text repeated four times, while the doc body literally contains `[1]`, `[2]` callouts on every bullet.
- **Notes**: Confirms the existing `TODO.md` item "References not actually showing citations". Heuristic should at minimum (a) skip lines starting with `#` and (b) treat `[n]` markers in the prior sentence as a citation.

### [P1] Idea AI score is a deterministic fallback — labelled "FALLBACK RATIONALE" — yet UI presents it as if it were AI-generated
- **Route**: /ideas
- **What I did**: Submitted a fresh idea: "Helping early-stage SaaS founders use AI to write higher-converting LinkedIn launch posts."
- **Expected**: Either a real AI relevance score with an explanatory rationale, or a clear "AI not configured" indicator that disables the score column.
- **Actual**: New row appears in <1s with score `69 / Moderate` and explicit text "FALLBACK RATIONALE — Reason: Deterministic fallback: the idea is directionally useful, but still broad for high-confidence planning. (no saved personal/company context found, so rationale used idea text only)". This is hard-coded heuristic output, but the dashboard "Top-scoring ideas" widget treats it as a real ranking signal.
- **Evidence**: `POST /api/ideas/rationale -> 200` returns deterministic copy for every idea; all ideas in the table that have scores all carry "FALLBACK RATIONALE" badges and identical canned rationales.
- **Notes**: At minimum, label the badge "Heuristic score (no AI key)" and grey out the dashboard's "9 ideas waiting / 0 strong-rated" until a real model rates them. Currently misleads the user about what the AI is doing.

### [P1] Most pages still show developer placeholder text ("SCREEN 7", "SCREEN 9", "SCREEN 10", "SCREEN 11", "SCREEN 12")
- **Routes affected**: /publish (SCREEN 7), /analytics (SCREEN 9), /collaboration (SCREEN 10), /settings (SCREEN 11), /notifications (SCREEN 12)
- **What I did**: Visited each route.
- **Expected**: No "SCREEN N" debug labels in production-style UI.
- **Actual**: Each of the five pages above renders the literal string "SCREEN N" at the top, before the H1.
- **Evidence**: e.g. /publish `main.innerText` starts "SCREEN 7\n\nPublishing and Scheduling...". Same on Analytics/Collaboration/Settings/Notifications.
- **Notes**: Easy global cleanup — likely a placeholder header component. Files under `frontend/src/app/(app)/<route>/page.tsx`.

### [P1] /analytics is entirely placeholder content — no charts, no real metrics, no controls
- **Route**: /analytics
- **What I did**: Loaded the page; tried to interact.
- **Expected**: At least one real chart bound to draft/adaptation activity that the dashboard already counts, or an explicit "coming soon" empty state.
- **Actual**: Sections "Engagement Charts" / "Performance History" are static text blocks ("Engagement chart area", "Timeline and trend history"). "Predictive Scoring" reads "Predicted reach: 42k | confidence 82%" — fixed string. "Copy Intelligence Insights" reads "Hooks with direct outcomes outperform generic intros by 19%." — fixed string. No interactive elements.
- **Evidence**: Zero `<button>`, zero `<canvas>`, zero `<svg>` chart elements. Total `main` text fits in 400 chars.
- **Notes**: The dashboard widgets ("Engagement rate", "Best post type") already have a "TODO" badge with copy "see notes.md", which is honest — Analytics page should mirror that and not lie about scores.

### [P1] /collaboration is also entirely placeholder — only "Invite teammate" button and no actual flow
- **Route**: /collaboration
- **What I did**: Visited; clicked the only button.
- **Expected**: Modal/form to invite, list of members, role assignment, etc.
- **Actual**: The "Invite teammate" button is the only control on the page. Sections "Role-Based Access", "Client Brief Forms", "Project Calendars", "White-Label Toggles" are all just descriptive paragraphs. The button does not appear to open anything functional.
- **Evidence**: `Array.from(document.querySelectorAll('button')).map(b=>b.innerText)` returns `["Invite teammate"]`.
- **Notes**: Worse — the top nav uses the label "Audience" for this route, which is the wrong label for a Collaboration screen.

### [P1] /review page sections are non-functional placeholders — "Inline Editor", "Version History", "Approval Chain Controls", "Comment / Suggestion Layer", "Role-Based Access"
- **Route**: /review
- **What I did**: Visited; clicked storyboard rows in queue (those work and link out).
- **Expected**: At minimum approve/reject controls, comment thread UI, version diff.
- **Actual**: Inline Editor reads "Open a storyboard item from the queue to edit and review the full content." — i.e. there is no inline editor on /review at all; it just sends the user back to the Storyboard editor. Version History reads "Version snapshots are available in each storyboard's editor flow." (not on this page). Approval Chain shows the static string "Author → Editor → Legal → Client approver." Comments/Role-Based Access also descriptive only.
- **Notes**: The stage exists in the workflow but the UI doesn't actually let a reviewer do anything review-specific.

### [P1] /notifications shows hard-coded fake notifications with no unread state, no mark-read action, no link-out
- **Route**: /notifications (linked from the header "Alerts" badge)
- **What I did**: Loaded; tried interactions.
- **Expected**: A live list of notifications generated from real events (drafts submitted for review, schedule windows, integration errors).
- **Actual**: Three static strings: "LinkedIn token expired. Reconnect account to resume scheduled publishing.", "3 drafts approved. 1 publish window has low engagement forecast.", "Scheduled maintenance window: Sunday 02:00 UTC for analytics index refresh." — none of these are real, none are dismissable.
- **Notes**: The "Alerts" link at top right always points here, suggesting the user something is waiting — feels deceptive when it's literally a fake.

### [P2] Top navigation has duplicate labels and confusing routing — "Campaigns" + "Ideas" both go to /ideas; "Content" + "AI Angles" both go to /angles; "Audience" goes to /collaboration
- **Route**: every route (sticky header)
- **What I did**: Inspected the header `<nav>` on /dashboard.
- **Expected**: One label per route, with semantically accurate names.
- **Actual**: 13 nav items where:
  - "Campaigns" → /ideas (but "Ideas" also → /ideas)
  - "Content" → /angles (but "AI Angles" also → /angles)
  - "Analytics" → /analytics ✓
  - "Audience" → /collaboration (label mismatch)
  - "Overview", "Settings", "Storyboard", "Adapt", "Publish", "Review", "Notifications" → correct
- **Evidence**: `Array.from(document.querySelectorAll('header nav a')).map(a => a.innerText + ' -> ' + a.getAttribute('href'))`.
- **Notes**: Visually clutters the header and creates two competing IA mental models on top of each other.

### [P2] /drafts and /adapt/new redirect silently to /storyboard (the draft list)
- **Route**: /drafts, /adapt/new
- **What I did**: Navigated directly.
- **Expected**: /drafts to be either a real drafts list or a 404; /adapt/new to start a new adaptation flow.
- **Actual**: Both URLs land on /storyboard which is presented as "Storyboard" (no breadcrumb, no toast explaining the redirect). The page has a "+ New Storyboard" button — but the URL bar says /storyboard, the nav items say "Storyboard" and "Adapt", and the user has no clue why they were sent here.
- **Notes**: Either implement the routes or surface a clear redirect notice.

### [P2] Dashboard Quick Links and step navigator both link "Generate angles", "Open angles" without an ideaId — page silently picks the most recently created idea
- **Route**: /dashboard ("Generate angles" Quick Link), and /angles direct visit
- **What I did**: Clicked /angles with no ideaId in querystring.
- **Expected**: A "pick an idea" empty state.
- **Actual**: The page silently selects FE-IDEAS-002 (presumably whichever idea ranks first) and shows "Select AI Angles & Outlines for: FE-IDEAS-002 ...". Any Regenerate clicks would mutate that idea's angle list. URL gets rewritten to `/angles?ideaId=...` after load.
- **Notes**: Silent state mutation surprises the user; better to require an explicit selection.

### [P2] Storyboard editor has Save / Adapt / Submit-for-Review buttons, but Save & Adapt are disabled while Submit is enabled on a brand-new storyboard
- **Route**: /storyboard/aHc3mcxt0L6uO5YoQiWC?angleId=fallback-1 (no body content)
- **What I did**: Inspected the action bar.
- **Expected**: If you can't save the doc and can't adapt it, you definitely shouldn't be able to submit it for review.
- **Actual**: `Save Storyboard` disabled, `Adapt for Platforms` disabled, `Submit for Review` enabled — letting the user push an empty/non-existent draft into a review queue.
- **Evidence**: snapshot at /storyboard/aHc3mcxt0L6uO5YoQiWC shows `[disabled]` on first two buttons, none on Submit for Review.

### [P2] Step navigator hides the Storyboard/Adapt deep-link until you visit Angles first — but Angles page link from Adapt nav is broken
- **Route**: /storyboard/[id], /adapt/[id]
- **What I did**: Clicked Step "✓ AI Angles" from a Storyboard or Adapt detail page.
- **Expected**: Returns to the AI Angles page filtered to that idea.
- **Actual**: Works only because the URL embeds ideaId. But Steps 3/4/5 from the same nav (Storyboard/Adapt/Review) are inconsistent — Storyboard/Adapt links go back to Angles, Review goes to /review (not the queued item). The mental model is broken.

### [P2] /publish only supports LinkedIn + X / Twitter, even though /adapt advertises X, Medium, Newsletter, Blog
- **Route**: /publish
- **What I did**: Loaded the page.
- **Expected**: Handoff or copy buttons for every platform that Adapt can produce.
- **Actual**: Only "Publish to LinkedIn" and "Publish to X / Twitter" exist. If the user adapted for Medium/Newsletter/Blog, there is no way to push those from the publish stage.
- **Notes**: Combined with the fact that the stage label is "Publishing and Scheduling", and there is no scheduling UI at all (just two intent links), this stage is half-built.

### [P2] Settings → "Brand Voice Editor" has no labels, no help text — just an unlabelled textarea + select
- **Route**: /settings → "Brand Voice Editor" section
- **What I did**: Inspected the form.
- **Expected**: Field labels (e.g. "Tone description", "Default voice"), placeholder examples, and a save confirmation.
- **Actual**: Two unlabelled controls (textarea, select). The shared "Save" button at the bottom of the page is presumably what saves them, but there's no association.
- **Evidence**: `inputs[0]` = textarea with `name=''`, `ph=''`; `inputs[1]` = select with `name=''`.

### [P3] favicon.ico returns 404 on every page load
- **Route**: every route
- **What I did**: Inspected console.
- **Expected**: A favicon.
- **Actual**: `Failed to load resource: the server responded with a status of 404 (Not Found) @ http://localhost:3000/favicon.ico:0` on every navigation.
- **Notes**: Cosmetic but pollutes console error count.

### [P3] Idea row "Created" timestamp uses verbose locale format that wraps awkwardly in narrow columns
- **Route**: /ideas
- **What I did**: Looked at the table.
- **Expected**: A compact relative or short-date format (e.g. "Apr 19" or "5d ago" — already used on dashboard).
- **Actual**: Each row shows "4/19/2026, 9:37:51 PM" — full local timestamp. Combined with very long topic strings, the table is wide and visually busy.

### [P3] "Open Angles" button label collides with the column header "Action" and the chevron-style step nav — same action appears in three places per row context
- **Route**: /ideas
- **What I did**: Counted CTAs per idea.
- **Expected**: One primary action per row.
- **Actual**: Each row offers `Edit Title` + `Open Angles`. Above the table the step nav also has a Step 2 "AI Angles" link. The Quick Links sidebar (when on dashboard) duplicates "Generate angles". Pile-up of redundant entry points.

## Cross-cutting observations (not numbered)
- The whole pipeline assumes the user has already configured an AI key in Settings. With no key, every AI surface (Storyboard generate, Storyboard chat, Adapt platform expansion, Adapt chat) silently no-ops with at most a small static helper line. There is no first-run wizard or in-flow CTA to take the user to /settings.
- The "fallback" patterns (deterministic rationales, fallback-1 angleId, fallback Sources block) leak through to user-facing labels. These are useful for dev but should be labelled "Heuristic mode" or hidden once a key is present.
- Existing `TODO.md` items are confirmed:
  - "References not actually showing citations" — see P1 finding above.
  - "change inline editor wording and just make it like an ai chat that has inline changing capability" — the Storyboard "AI Chat Assistant" already advertises "sentence-level diffs that render in the editor with per-change Keep/Undo", but the feature does not work end-to-end (P0 above), so the TODO is essentially unfulfilled.