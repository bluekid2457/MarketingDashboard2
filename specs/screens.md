# Screens Specification for Marketing Dashboard

This document describes the main screens required for the Marketing Dashboard, based on the feature list and user stories. Each screen includes its purpose, key components, and main interactions.

---

## 1. Login & Authentication Screen (LoginScreen.jpg)
**Purpose:** Secure user login, registration, and OAuth provider selection.
**Components:**
- Email/password fields
- Client-side validation (email required + format, password required)
- Inline user-safe error banner for auth failures
- Loading state on submit with duplicate-submit prevention
- OAuth provider buttons (currently visual placeholders)
- Forgot password link
- Registration link
- Firebase Email/Password sign-in integration
**Main Actions:**
- Emit `login_attempt`, `login_success`, `login_failure` auth analytics events
- Redirect authenticated users from `/login` to `/dashboard`
- Redirect to dashboard on successful login

---

## 2. Dashboard (Main Overview)
**Purpose:** Central hub showing content pipeline, stats, and quick actions.
**Components:**
- Content calendar (visual, clickable)
- Idea backlog summary
- Drafts/review queue
- Recent analytics (engagement, performance)
- Quick links to main features
**Main Actions:**
- Navigate to other screens
- View high-level stats

---

## 3. Idea Input & Backlog Screen (IdeaScreen.png)
**Purpose:** Submit new ideas, view and manage idea backlog.
**Components:**
- Free-form idea input box
- Optional dropdowns: tone, audience, format
- List/table of ideas with relevance/timeliness scores. 
- Sort/filter controls
- Trend detection panel (shows trending topics) As well as ability to click into the articles that are relevant.
- Competitor content panel (shows tracked competitor posts/gaps)
- Selected-idea card with a Generate Angles button that routes to `/angles?ideaId=<ideaDocId>`
**Main Actions:**
- Submit/edit/delete ideas
- Sort/filter backlog
- View trends and competitor analysis
- Trigger angles generation flow for the selected idea

---

## 4. AI Angle Selection & Outline Screen (AngleOutlineScreen.png)
**Purpose:** Review AI-generated angles/outlines for an idea, select or edit before drafting.
**Components:**
- Query-based idea handoff via `ideaId`, with Firestore idea loading for signed-in user
- Empty/guide state when no `ideaId` is provided
- Provider-backed angle generation (`/api/angles`) using saved Settings provider/key
- List of AI-generated angles/outlines (card/list view) with prev/next carousel controls
- Inline section editing when "Unlock Detailed Editor" is enabled
- Selection controls (radio/check)
- Refine chat input that updates the selected angle and appends chat history
- Error/retry messages and loading states
**Main Actions:**
- Select or edit an angle
- Refine selected angle with AI
- Retry angle generation for the same idea
- Proceed to draft generation

---

## 5. Draft Editor Screen (DraftEditorScreen.jpg)
**Purpose:** Full-featured editor for drafting, editing, and iterating content.
**Components:**
- Rich text editor
- Mid-draft prompt bar (for iterative editing)
- Tone/sentiment tuning controls
- Readability/SEO scoring panel
- Persona targeting options
- A/B headline generator
- Plagiarism/citation checker
- Save, submit for review, or schedule buttons
**Main Actions:**
- Edit content
- Tune tone/sentiment
- Check SEO/readability
- Save/submit/schedule

---

## 6. Multi-Channel Adaptation Screen (AdaptationScreen.jpg)
**Purpose:** Adapt content for different platforms/formats.
**Components:**
- Platform selector (LinkedIn, Medium, Blog, Twitter, etc.)
- Preview for each format
- AI chat for editing/adapting content per platform
**Main Actions:**
- Adapt content per platform
- Preview and approve

---

## 7. Publishing & Scheduling Screen
**Purpose:** Manage publishing and scheduling for each platform.
**Components:**
- Platform connection status (OAuth)
- Schedule picker/calendar
- Draft mode toggle
- Visual content calendar
- Gap detection alerts
- Submit to search engines button
**Main Actions:**
- Schedule or publish content
- Connect/disconnect platforms
- View calendar gaps

---

## 8. Review & Approval Workflow Screen
**Purpose:** Manage draft approvals, version history, and comments.
**Components:**
- Draft queue/list
- Inline editor for review
- Version history panel
- Approval chain controls
- Comment/suggestion layer
- Role-based access controls
**Main Actions:**
- Approve/reject drafts
- Edit/comment
- View/restore versions

---

## 9. Analytics & Performance Screen
**Purpose:** Show engagement, performance, and predictive analytics.
**Components:**
- Engagement data charts (per platform)
- Performance history timeline
- Predictive scoring widgets
- Copy intelligence insights
- AI visibility tracking
**Main Actions:**
- View/filter analytics
- Drill down by content, platform, or time

---

## 10. Collaboration & Client Management Screen
**Purpose:** Manage team, clients, and agency workflows.
**Components:**
- Invite/manage users (editors, co-authors, clients)
- Role-based access controls
- Client brief intake forms
- Project-level content calendars
- White-label output toggles
**Main Actions:**
- Add/remove users
- Fill out briefs
- Switch between brands/clients

---

## 11. Settings & Compliance Screen
**Purpose:** Configure brand voice, compliance, integrations, and governance.
**Components:**
- Brand voice profile editor
- Compliance flag settings
- Audit log viewer
- Integration connectors (API, CRM, Google Docs, Slack, SSO)
- Security settings
**Main Actions:**
- Edit brand voice
- Set compliance rules
- Manage integrations
- View audit logs

---

## 12. Error & Notification Screens
**Purpose:** Display errors, alerts, and system notifications.
**Components:**
- Error messages
- Success/warning notifications
- System alerts (e.g., compliance, scheduling, integration failures)
**Main Actions:**
- Dismiss or act on notifications

---

This list covers the core screens needed to support the described features and user stories. Each screen may have additional sub-components or modals as required by detailed UX/UI design.