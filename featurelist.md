
Aju Kuriakose
Thu, Apr 9, 3:07 PM
to me

Here is the full consolidated list across every category.

> Last verified end-to-end: 2026-05-01 via Playwright walkthrough with the project's QA test credentials, no AI provider key configured, and the FastAPI backend down (missing `httpx` dependency in `backend/requirements.txt`).
>
> Legend: ✅ done, ⚠️ partial (UI exists but a key flow is broken / silent / placeholder), ❌ not started.

Idea Development
        ✅ Free-form idea input with optional tone, audience, and format hints
        ✅ AI generates multiple angles and outlines before drafting — note: generation works via /api/angles; only 2 cards per run, no multi-angle comparison UI
        ✅ User selects or edits the angle before full generation begins
        ❌ Interview mode where AI asks questions and builds the piece from your answers
        ❌ Voice input with transcription feeding directly into the drafting workflow
        ⚠️ Idea backlog with relevance and timeliness scoring — note: real AI scoring works when an API key is configured; without a key, /ideas falls back to a deterministic local rationale (visible "Deterministic fallback" rationale)
        ⚠️ Trend detection pulling what is performing in your niche right now — note: /api/trends pulls Bing News RSS and now accepts a companyTerms query string derived from the saved Company Profile to bias topics toward the user's industry/products; still RSS-only, no real "what's performing" engagement signal
        ⚠️ Competitor content tracking to surface gaps — note: Adapt page has a "Similar posts" AI tab backed by /api/drafts/similar-posts (DuckDuckGo + AI synthesis) that flags competitor matches when terms are supplied; no persistent competitor watchlist yet

Content Generation
        ✅ Full draft generation from selected angle — note: /api/drafts grounds citations against live DuckDuckGo results before writing; falls back to a deterministic markdown draft if the provider call fails
        ⚠️ Iterative editing with mid-draft prompts — note: DraftChatPanel exists in Storyboard and Adapt and parses <UPDATED_DRAFT> tags into per-sentence Keep/Undo diffs; "Send to AI Chat" silently fails (no toast, no request) when no AI provider key is configured
        ⚠️ Tone tuning without full rewrites — note: AIToolbox tone presets call /api/drafts/rewrite (mode='tone'); silently fail without an API key — needs a no-key warning surface
        ⚠️ Readability scoring with complexity dial — note: /api/drafts/analyze (type='seo') returns readabilityScore + readabilityGrade; no dedicated complexity dial UI; no-key fallback exists for SEO type only
        ⚠️ Multiple persona targeting, generating different versions of the same piece for different audiences — note: /api/drafts/personas works, but the Storyboard/Adapt UI sends one persona at a time and applies the rewrite directly into the active editor (no side-by-side variants)
        ⚠️ A/B headline variants generated automatically — note: /api/drafts/headlines exists and is wired into AIToolbox; produces variants in-panel, no auto-publish A/B test
        ⚠️ Content recycling, flagging older posts for refresh or repurposing — note: /storyboard index renders an amber "Refresh / Repurpose" banner for records older than 60/120 days respectively, with one-click deep links into the storyboard editor
        ⚠️ Research grounding with live web search before drafting — note: /api/drafts/research synthesizes a brief from DuckDuckGo results; /api/drafts itself runs a DDG grounding pass and rewrites the Sources block to vetted URLs; no Bing/Google fallback
        ⚠️ Citation tracking so every factual claim has a source attached — note: /api/drafts returns citationValidation { hasSourcesSection, uncitedClaimCount } and rewrites trailing ## Sources from grounded URLs; Storyboard renders parsed references as clickable links via extractReferences(); /storyboard submission blocks if claims are missing markers or the references list is empty
        ⚠️ Plagiarism check before publish — note: /api/drafts/plagiarism runs verbatim-quote DDG search + AI heuristic AI-likelihood review; AIToolbox exposes it; deterministic fallback when no key

Multi-Channel Adaptation
        ✅ LinkedIn post
        ✅ Medium long-form article
        ✅ Blog post
        ✅ Twitter/X thread
        ✅ Newsletter snippet
        ❌ Email sequence from a long-form piece
        ❌ Podcast script or talking points
        ❌ Slide deck outline
        ❌ FAQ extraction for SEO or support use
        ⚠️ Each format adapts character limits, heading structure, and tone automatically — note: per-platform prompt rules live in /lib/prompts/platforms/{linkedin,twitter,medium,newsletter,blog}.ts; /api/drafts/adapt aborts after 5 minutes (HTTP 504); the Adapt "Continue and Generate" gate fires NO network request when no AI key is configured (silent fail) — a visible no-key warning + a no-key fallback path are needed
        ❌ Lock specific sections and regenerate only the rest

Personalization at Scale
        ✅ Brand voice profile storing tone preferences, vocabulary rules, and style guidelines — note: Settings Company Profile (9 fields incl. brandVoice) persists to users/{uid}.companyContext via setDoc(merge:true) and a localStorage cache; an "Auto-fill from website" affordance scrapes a homepage via /api/company/autofill and populates the form
        ✅ Voice applied across all output without re-prompting — note: every AI route except /api/drafts/plagiarism, /api/angles/persist, /api/angles/select, and /api/trends accepts companyContext: string[] and injects a "Company context:" block; client wiring is in src/lib/useInlineEdit.ts, AIToolbox.tsx, Storyboard, Adapt, and Angles pages
        ❌ Personalized intros per mailing list segment
        ❌ Multi-brand workspaces each with their own voice profile

Publishing and Scheduling
        ⚠️ OAuth connections to LinkedIn, Medium, WordPress, Ghost, Substack — note: backend has full LinkedIn OAuth flow (POST /api/v1/auth/linkedin/start + GET /api/v1/auth/linkedin/callback) with encrypted token storage in integrationSecrets/; Settings UI surfaces Connect/Disconnect; tokens are stored but NOT yet consumed for direct posting; backend is currently broken in dev because httpx is missing from backend/requirements.txt; X/Medium/WordPress/Ghost/Substack remain informational cards only
        ✅ Schedule posts per platform independently — note: writes users/{uid}/scheduledPosts; surfaced on Dashboard calendar, Publish upcoming list, and Notifications page; no background scheduler fires the publish — see automation.md
        ⚠️ Draft mode with mandatory review before publish — note: /review queue loads from users/{uid}/drafts; inline editing, version history, approval chain, and comments are all placeholder headings only
        ✅ Visual content calendar — note: Dashboard "Activity Calendar" aggregates scheduledPosts + adaptations per day
        ✅ Gap detection flagging weeks with no planned posts — note: rendered alongside the Dashboard calendar
        ❌ Auto-submit to search engines via IndexNow on publish

Media and SEO
        ❌ Auto-suggested image prompts per post
        ❌ Stock image search integration
        ⚠️ Meta description and SEO title generation — note: /api/drafts/analyze (type='seo') returns metaDescription + titleSuggestions; deterministic no-key fallback returns the same schema
        ⚠️ Tag and keyword suggestions per platform — note: /api/drafts/analyze (type='seo') returns primaryKeyword, secondaryKeywords[], and keywordDensity; the prompt accepts an optional `platform` for platform-specific bias and is auto-run on Adapt after each platform generation
        ❌ Real-time SEO scoring against top-ranking competitors — note: /api/drafts/similar-posts gives a manual competitor comparison surface; no automated SERP-rank scoring
        ❌ GEO optimization, structuring content so AI search engines cite your brand

Review and Approval Workflow
        ✅ Draft queue showing everything pending approval
        ❌ Inline editing before approving — note: /review still shows placeholder section headings only; no textarea/contenteditable; clicking a queue row deep-links into /storyboard or /drafts editor instead
        ❌ Version history with rollback
        ❌ Approval chains for teams or agencies
        ❌ Role-based access, separating drafting rights from publish rights
        ❌ Comment and suggestion layer for collaborators

Analytics
        ❌ Engagement data pulled back from each platform into one view — note: /analytics is entirely placeholder (no chart library, no API call)
        ❌ Performance history showing which ideas resonated
        ❌ AI visibility tracking, monitoring how platforms like ChatGPT and Perplexity mention your brand
        ❌ Predictive performance scoring before publish — note: hardcoded "Predicted reach: 42k | confidence 82%" placeholder
        ❌ Copy intelligence showing which messaging themes drive results over time — note: hardcoded factoid placeholder

Collaboration
        ❌ Invite editors, co-authors, and ghostwriters — note: /collaboration "Invite teammate" button is a dead no-op (no onClick handler effect, no modal, no network call)
        ❌ Role-based access control
        ❌ Client-facing review portals for agencies
        ❌ Content briefs that clients fill out, feeding directly into the generation queue

Client and Agency Management
        ❌ Multi-brand workspaces
        ❌ White-label output
        ❌ Client brief intake feeding the generation queue
        ❌ Project-level content calendars per client

Monetization Hooks
        ❌ Gated content generation with paywall integration for newsletters
        ❌ Affiliate link insertion with context awareness
        ❌ Sponsored content disclosure templates per platform's requirements

Governance and Compliance
        ❌ AI disclosure tagging where platforms require it
        ❌ Brand safety filters catching conflicts with your guidelines before publish
        ❌ Audit log of every published piece, approver, and version sent
        ❌ Compliance flags for regulated industries — note: Settings shows a "Compliance Flags" heading + descriptive copy only, no checkboxes/inputs/persistence
        ❌ Terminology violation detection

Infrastructure and Integrations
        ❌ API access for embedding generation into external tools
        ❌ CRM integrations such as HubSpot and Salesforce
        ❌ Google Docs and Slack connectors
        ❌ Auto-updated XML sitemap on every publish
        ❌ SSO and enterprise security for larger teams — note: Firebase email/password only

---

## Defects observed during the 2026-05-01 walkthrough

These are NOT new feature requests — they're things that look implemented but don't work end-to-end:

1. **AI Chat in Storyboard editor silently fails** when no AI provider key is set. Files: `frontend/src/components/DraftChatPanel.tsx`, `frontend/src/app/api/drafts/chat/route.ts`. Needs a visible no-key error surface.
2. **AIToolbox quick-action buttons** (Make concise / Add CTA / Sharpen hook / tone presets) silently fail without a key. File: `frontend/src/components/AIToolbox.tsx`.
3. **Adapt "Continue and Generate"** fires no `POST /api/drafts/adapt` request without a key. Files: `frontend/src/app/(app)/adapt/[id]/page.tsx`, `frontend/src/app/api/drafts/adapt/route.ts`.
4. **Backend missing dependency** — `httpx` is imported in `backend/app/services/integration_connection_service.py:5` but is NOT in `backend/requirements.txt`. The FastAPI server fails to start with `ModuleNotFoundError: httpx`, blocking LinkedIn OAuth and the Settings → Integrations card.
5. **Orphaned storyboard for `review-test-idea`** — the storyboard exists but the parent idea doc was deleted, so the editor renders "Could not find the idea for this storyboard". Needs a cascade-delete or hide-orphans pass.
6. **Collaboration "Invite teammate" button is dead** — no onClick handler. File: `frontend/src/app/(app)/collaboration/page.tsx`.

---

## Summary (post-2026-05-01 walkthrough)

- **Done end-to-end (✅): 17** — Login, Idea input, Idea backlog (with key OR fallback), AI angle generation, User edits angle, Full draft generation, all 5 platform adapters (LinkedIn / Medium / Blog / Twitter / Newsletter), Brand voice profile persistence, Voice applied across output, Schedule posts per platform, Visual content calendar, Gap detection, Draft queue, plus the WORKING Settings/Notifications/Dashboard surfaces.
- **Partial (⚠️): 17** — Trend detection, Competitor tracking, Iterative chat editing, Tone tuning, Readability scoring, Persona targeting, A/B headlines, Content recycling, Research grounding, Citation tracking, Plagiarism check, Per-platform adaptation rules (Continue and Generate silent fail), OAuth connections (LinkedIn only, backend down), Draft mode review, Meta/title generation, Tag/keyword suggestions, Idea relevance scoring.
- **Not started (❌): 39** — most of Analytics, Collaboration, Client/Agency Management, Monetization, Governance, and Infrastructure/Integrations.

Core Idea → Angle → Storyboard → Adapt → Schedule → Calendar pipeline is functional with an AI key, plus Brand Voice / Company Profile personalization is now working. The advanced AI Chat / AIToolbox / Adapt-generate paths fail silently without a key (defects 1–3 above), and Review, Analytics, Collaboration, and Compliance remain mostly placeholders.

---

## UX & Coherence Improvements (high-level, not new features)

These are issues you find by walking the app as a first-time user. They're not new features to build — they're things about *the experience of what already exists* that would make a new user bounce, get lost, or doubt the product. Verified 2026-05-01 via a dedicated UX-walkthrough pass.

### 1. The product has two different names
- The public landing page (`/`) and footer brand the product as **Flowrite**, but the moment you sign in the sidebar, page titles, and dashboard hero all switch to **Marketing Dashboard / Campaign Command Center**.
- A first-time user finishes onboarding wondering if they signed up for the wrong product.
- Where it shows up: [page.tsx](frontend/src/app/page.tsx) (landing) vs [(app)/layout.tsx](frontend/src/app/(app)/layout.tsx) and every authenticated page header.
- **Fix shape:** Pick one name and apply it everywhere — landing page, login, sidebar, page titles, footer.

### 2. The sidebar uses a different vocabulary than every page heading
- The sidebar's primary nav reads "Campaigns / Content / Audience," but the WorkflowStepper, page titles, and submenu use "Ideas / AI Angles / Storyboard / Adapt / Review / Publish."
- "Campaigns" actually opens `/ideas`. "Content" actually opens `/angles`. "Audience" actually opens the Collaboration screen.
- The user has to mentally translate three different labels for the same five destinations.
- Where it shows up: [(app)/layout.tsx](frontend/src/app/(app)/layout.tsx) sidebar vs every page heading.
- **Fix shape:** Drop the abstract category names. Use the same labels as the WorkflowStepper everywhere — Ideas, Angles, Storyboard, Adapt, Review, Publish, Notifications.

### 3. The WorkflowStepper, sidebar, and per-page breadcrumbs all disagree about the pipeline
- The stepper on `/ideas` and `/angles` shows 6 steps: Ideas → AI Angles → Storyboard → Adapt → Review → Publish.
- The sidebar's Content Pipeline lists 7 entries and orders Review *after* Publish.
- The Storyboard editor breadcrumb uses a fourth wording: "Angles → Storyboard (Active) → Adapt → Review → Schedule" — note "Schedule" instead of "Publish."
- Three incompatible mental models for the same pipeline, on the same product.
- Where it shows up: [WorkflowStepper.tsx](frontend/src/components/WorkflowStepper.tsx), [(app)/layout.tsx](frontend/src/app/(app)/layout.tsx), [storyboard/[id]/page.tsx](frontend/src/app/(app)/storyboard/[id]/page.tsx), [adapt/[id]/page.tsx](frontend/src/app/(app)/adapt/[id]/page.tsx).
- **Fix shape:** Single source of truth for step labels and order. Render the same array everywhere.

### 4. The sidebar "Adapt" link is a dead end
- Clicking "Adapt" in the sidebar navigates to `/adapt/new`, which silently `redirect()`s to `/storyboard` with no toast, no banner, no "Pick a storyboard first." The user clicks the verb they want and lands on a *different* surface with no explanation.
- Same problem affects `/storyboard/new` and `/drafts/new` redirects.
- **Fix shape:** Either remove "Adapt" from the sidebar entirely (Adapt is per-document, not a global destination) or render an actual landing page at `/adapt/new` that says "Pick a storyboard to adapt" and lists candidates.

### 5. Placeholder pages are indistinguishable from real ones
- `/review`, `/analytics`, `/collaboration`, and chunks of `/settings` render section headings ("Approval Chain Controls", "Engagement Charts", "Compliance Flags", "Audit Log Viewer", "White-Label Toggles") with descriptive paragraphs but no inputs, no data, no "coming soon" badge.
- A first-time user keeps clicking around expecting interactivity. Even the dashboard openly prints "TODO" next to "Engagement rate" and "Best post type" in production.
- Where it shows up: [review/page.tsx](frontend/src/app/(app)/review/page.tsx), [analytics/page.tsx](frontend/src/app/(app)/analytics/page.tsx), [collaboration/page.tsx](frontend/src/app/(app)/collaboration/page.tsx), [settings/page.tsx](frontend/src/app/(app)/settings/page.tsx), [dashboard/page.tsx](frontend/src/app/(app)/dashboard/page.tsx).
- **Fix shape:** Either gate placeholders behind a "Coming soon" badge / disabled state, hide them entirely until they ship, or move them off the primary nav into a "preview" area.

### 6. No first-run guidance — the AI key is required but invisible
- A brand-new account lands on `/dashboard` and sees a hero banner plus four empty metric tiles ("—" / "No activity yet"). A single small underlined link ("Add your first idea →") is buried in the Idea Backlog Summary card.
- There is **no signal** that the app needs an AI provider key to do anything meaningful. Without that key, AI Chat, AIToolbox quick-actions, and Adapt's "Continue and Generate" all silently fail (see defects 1–3).
- **Fix shape:** First-run checklist on the dashboard, e.g. *"1. Add an AI provider key in Settings → 2. Fill in your Company Profile → 3. Capture your first idea."* Hide the checklist after all three are done. Block AI-required CTAs with a visible "Set your AI key first" banner instead of letting them no-op.

### 7. Settings is a long unsegmented scroll, with the only critical setting near the bottom
- The order today: Company Profile (functional) → Brand Voice (functional) → Compliance Flags (placeholder) → Audit Log Viewer (placeholder) → Security Settings (placeholder) → AI API Keys (functional, **required for the app to work**) → Exa key → Sign out.
- A new user has to scroll past three placeholder cards to find the one setting that determines whether the product works at all.
- **Fix shape:** Tab Settings into ["Required setup", "Profile", "Integrations", "Advanced"] and put AI API Keys + Company Profile in "Required setup" at the top. Hide placeholder cards behind an "Advanced (coming soon)" tab.

### 8. Ideas page CTA hierarchy contradicts the workflow
- Each idea card on `/ideas` shows two same-weight buttons: "Go to Adapt →" *and* "Open angles →".
- "Go to Adapt" skips Angles and Storyboard — the two steps the WorkflowStepper just above the card insists are mandatory. The user can't tell which is the "next" action and the shortcut contradicts the rest of the app's flow.
- Where it shows up: [ideas/page.tsx](frontend/src/app/(app)/ideas/page.tsx).
- **Fix shape:** One primary action per card based on state — if no draft exists, "Open angles →" is primary and "Go to Adapt" is hidden or demoted to an overflow menu. If a draft exists, surface "Resume in Storyboard →" as primary instead.

### 9. Cross-page handoff loses the user's mental thread
- Moving from `/storyboard/<id>` to `/adapt/<id>?angleId=...` renames the page ("Storyboard Editor" → "Platform Adaptation"), changes the breadcrumb wording, and the sidebar still says "Adapt" goes to a list — so the user can't tell whether they're inside a single-document workflow or switching to a different tool.
- There's no persistent "Editing: <draft title>" pill or sticky context bar that anchors them across the storyboard → adapt → publish jump.
- **Fix shape:** Sticky context header that shows `<idea topic> · <angle title>` across Storyboard, Adapt, and Publish, with a clear "Step 3 of 6" badge. Same idea/angle stays visible the whole way.

### 10. The dashboard surfaces zombie / test data as if it were real
- The Dashboard's "Oldest open draft (1h ago — Review workflow QA topic)" and `/publish`'s adaptations list show test artifacts ("Review workflow QA topic," "FE-IDEAS-002 E2E test idea alpha for rating sort verification") to a first-time user.
- One adaptation in the queue points to a deleted parent idea and renders "Could not find the idea for this storyboard."
- The empty-state messaging on the same page ("No activity yet") then feels contradictory.
- **Fix shape:** Cascade-delete or hide-orphan pass for storyboards/adaptations whose parent idea is gone. Separate test/seed data from the real account ledger. Add a "Clean up orphans" admin action surfaced when at least one orphan exists.

---

**Pattern across the 10 issues:** the app has been built screen-by-screen and feature-by-feature, but no pass has been done to make sure those screens *agree with each other*. The fastest UX win isn't more features — it's a coherence pass that picks one product name, one set of step labels, one canonical pipeline order, and one rule for placeholder vs functional surfaces.
