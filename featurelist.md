
Aju Kuriakose
Thu, Apr 9, 3:07 PM
to me

Here is the full consolidated list across every category.

Idea Development
        ✅ Free-form idea input with optional tone, audience, and format hints
        ✅ AI generates multiple angles and outlines before drafting — note: generation works via /api/angles, but no multi-angle comparison UI
        ✅ User selects or edits the angle before full generation begins
        ❌ Interview mode where AI asks questions and builds the piece from your answers
        ❌ Voice input with transcription feeding directly into the drafting workflow
        ❌ Idea backlog with relevance and timeliness scoring — note: PARTIAL; deterministic fallback scoring shown on /ideas, real AI scoring not wired
        ❌ Trend detection pulling what is performing in your niche right now — note: PARTIAL; /api/trends pulls Bing RSS for hardcoded topics, not user niche
        ❌ Competitor content tracking to surface gaps

Content Generation
        ✅ Full draft generation from selected angle
        ❌ Iterative editing with mid-draft prompts — note: PARTIAL; DraftChatPanel exists but AI chat fails silently when no API key set (TODO.md P0)
        ❌ Tone and sentiment tuning without full rewrites — note: depends on broken chat panel
        ❌ Readability scoring with complexity dial
        ❌ Multiple persona targeting, generating different versions of the same piece for different audiences
        ❌ A/B headline variants generated automatically
        ❌ Content recycling, flagging older posts for refresh or repurposing
        ❌ Research grounding with live web search before drafting
        ❌ Citation tracking so every factual claim has a source attached — note: PARTIAL; extractReferences() parses citations but references panel broken and uncited-claims mislabeled (TODO.md P1)
        ❌ Plagiarism check before publish

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
        ❌ Each format adapts character limits, heading structure, and tone automatically — note: PARTIAL; per-platform prompts exist in /lib/prompts/platforms/ but Adapt "Continue and Generate" silently fails without API key (TODO.md P0)
        ❌ Lock specific sections and regenerate only the rest

Personalization at Scale
        ❌ Brand voice profile storing tone preferences, vocabulary rules, and style guidelines — note: PARTIAL; Settings has a textarea placeholder, no persistence
        ❌ Voice applied across all output without re-prompting
        ❌ Personalized intros per mailing list segment
        ❌ Multi-brand workspaces each with their own voice profile

Publishing and Scheduling
        ❌ OAuth connections to LinkedIn, Medium, WordPress, Ghost, Substack — note: PARTIAL; LinkedIn OAuth endpoints exist in backend, no UI or wired publish flow; other platforms missing
        ✅ Schedule posts per platform independently
        ❌ Draft mode with mandatory review before publish — note: PARTIAL; /review queue loads but inline edit/approval controls are placeholders (TODO.md P1)
        ✅ Visual content calendar
        ❌ Gap detection flagging weeks with no planned posts
        ❌ Auto-submit to search engines via IndexNow on publish

Media and SEO
        ❌ Auto-suggested image prompts per post
        ❌ Stock image search integration
        ❌ Meta description and SEO title generation
        ❌ Tag and keyword suggestions per platform
        ❌ Real-time SEO scoring against top-ranking competitors
        ❌ GEO optimization, structuring content so AI search engines cite your brand

Review and Approval Workflow
        ✅ Draft queue showing everything pending approval
        ❌ Inline editing before approving — note: /review shows "Open a storyboard item from the queue to edit…" placeholder (TODO.md P1)
        ❌ Version history with rollback
        ❌ Approval chains for teams or agencies
        ❌ Role-based access, separating drafting rights from publish rights
        ❌ Comment and suggestion layer for collaborators

Analytics
        ❌ Engagement data pulled back from each platform into one view — note: /analytics is entirely placeholder
        ❌ Performance history showing which ideas resonated
        ❌ AI visibility tracking, monitoring how platforms like ChatGPT and Perplexity mention your brand
        ❌ Predictive performance scoring before publish — note: hardcoded "Predicted reach: 42k" placeholder
        ❌ Copy intelligence showing which messaging themes drive results over time

Collaboration
        ❌ Invite editors, co-authors, and ghostwriters — note: /collaboration "Invite teammate" button is a no-op (TODO.md P1)
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
        ❌ Compliance flags for regulated industries — note: Settings mentions "Compliance Flags" but is placeholder text only
        ❌ Terminology violation detection

Infrastructure and Integrations
        ❌ API access for embedding generation into external tools
        ❌ CRM integrations such as HubSpot and Salesforce
        ❌ Google Docs and Slack connectors
        ❌ Auto-updated XML sitemap on every publish
        ❌ SSO and enterprise security for larger teams — note: Firebase email/password only

---

Summary: 13 done, 13 partial (marked ❌ with note), 47 not started. Core Idea → Angle → Storyboard → Adapt → Schedule → Calendar pipeline is functional; advanced AI features, OAuth wiring, analytics, collaboration, governance, and integrations are not.
