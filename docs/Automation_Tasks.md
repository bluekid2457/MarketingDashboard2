# Automation Tasks — Per-Platform Implementation Plan

Ordered task lists to take Marketing Dashboard 2 from "manual handoff" (today) to "true scheduled publishing" for LinkedIn, Facebook, Instagram, and X. Each platform section is sequenced top-to-bottom: do tasks in order. Time estimates assume one full-time developer; "calendar time" includes external waits (App Review, Business Verification) that do not consume developer time.

Legend:
- **Dev** = developer time (hands-on-keyboard hours/days).
- **Wait** = external blocker (review queues, verification queues) that runs in parallel.
- **Calendar** = total wall-clock time including waits.

---

## Cross-Cutting Prerequisites (do these once, before any platform)

These are needed by every platform's review/approval. Knock them out first because they block everything else.

| # | Task | Owner | Dev | Calendar |
|---|------|-------|-----|----------|
| C1 | Publish a Privacy Policy URL on the marketing site (must explain what data is collected, retention, third-party sharing) | Legal/Marketing | 0.5d | 0.5d |
| C2 | Publish a Terms of Service URL | Legal/Marketing | 0.5d | 0.5d |
| C3 | Implement Data Deletion Callback endpoint (`POST /api/v1/integrations/data-deletion`) — receives Meta signed_request, returns `{ url, confirmation_code }`, actually deletes user's `integrationSecrets/*` and connection summary | Backend | 0.5d | 0.5d |
| C4 | Stand up a unified scheduler worker (Cloud Scheduler → `POST /internal/scheduler/tick` HMAC-protected → claims due rows in `scheduledPosts` via Firestore transaction → dispatches to per-provider publisher) | Backend | 2d | 2d |
| C5 | Stand up a token-refresh worker (daily Cloud Scheduler tick, refreshes any token within 10 days of expiry) | Backend | 1d | 1d |
| C6 | Add reschedule/cancel UI for `scheduledPosts` (currently TODO in `specs/automation.md`) | Frontend | 1d | 1d |
| C7 | Pick an IPv4-reachable HTTPS public URL strategy for media (signed Cloud Storage URLs or CDN) — IG/FB fetch media themselves so it must be public, HTTPS, no auth | Backend/DevOps | 1d | 1d |
| C8 | Add `appsecret_proof` HMAC to all Meta Graph calls (Meta-recommended hardening) | Backend | 0.5d | 0.5d |

**Total cross-cutting: ~7 dev-days, ~7 calendar days.** Most of this is reusable across all four platforms.

---

## LinkedIn — Finish what's started

Status: OAuth scaffolding exists (`backend/app/routers/linkedin.py`), tokens stored encrypted in `integrationSecrets/{uid__linkedin}`, but no publish path wired. This is the lowest-friction platform to ship — no App Review queue.

### Phase L0 — Verify existing groundwork (½ day)

1. **L0.1** Verify dev portal access at `linkedin.com/developers` for the existing LinkedIn app (login, confirm app status = Verified, confirm Authorized Redirect URLs include both dev and prod callbacks). [Dev: 0.5h]
2. **L0.2** Confirm the existing app has the **"Sign In with LinkedIn using OpenID Connect"** and **"Share on LinkedIn"** products attached. If not, request them in the Products tab — both are self-service. [Dev: 0.5h, Wait: 0]
3. **L0.3** Manually run through the existing `/settings → Connect LinkedIn` flow end-to-end and verify a record lands at `users/{uid}/integrationConnections/linkedin` and an encrypted secret at `integrationSecrets/{uid__linkedin}`. [Dev: 1h]

### Phase L1 — Wire publish (2 days dev)

4. **L1.1** Decide: personal-profile posting only (Share on LinkedIn → `w_member_social` scope, `/v2/ugcPosts`) or also Company Page posting (requires Marketing Developer Platform access — needs LinkedIn approval, ~2-week wait). **Recommend personal-only for v1.** [Dev: 0.5h]
5. **L1.2** Add `w_member_social` to the OAuth scope list in `backend/app/routers/linkedin.py` start handler. [Dev: 0.5h]
6. **L1.3** Build `linkedin_publisher.py` service with `publish_text(uid, text)` and `publish_with_media(uid, text, media_url)` calling `POST https://api.linkedin.com/v2/ugcPosts`. [Dev: 4h]
7. **L1.4** Add image upload via the LinkedIn Assets API (`POST /v2/assets?action=registerUpload`, then PUT the binary, then reference the asset urn in the ugcPost). [Dev: 4h]
8. **L1.5** Wire the publisher into the unified scheduler worker (C4). [Dev: 2h]
9. **L1.6** Replace the `/publish` page LinkedIn button: when token exists in `users/{uid}/integrationConnections/linkedin`, call backend publish; otherwise fall back to the current clipboard+intent handoff. [Dev: 3h]

### Phase L2 — Test and verify (½ day)

10. **L2.1** Manual test: schedule a future post via `/publish`, wait for scheduler tick, verify it appears on LinkedIn feed and the `scheduledPosts/{id}.status` is `published` with `meta.providerPostId` set. [Dev: 1h]
11. **L2.2** Manual test: cancel a scheduled post via the new reschedule/cancel UI; verify it does not fire. [Dev: 0.5h]
12. **L2.3** Manual test: revoke the app on `linkedin.com/psettings/permissions` and verify next publish surfaces a clean "reconnect required" state. [Dev: 0.5h]
13. **L2.4** Update `specs/automation.md` integration table (Direct LinkedIn publish → DONE). [Dev: 0.5h]

**LinkedIn totals: ~3 dev-days, ~3 calendar days. No external review queue.**

---

## Facebook (Pages) — First Meta platform

Pair this with Instagram since they share the same Meta app and review submission. **Start Business Verification on Day 1** — it's the long pole.

### Phase F0 — Pre-dev setup (1 day dev, ~10 days calendar — can run in parallel with development)

1. **F0.1** Create Meta developer account at `developers.facebook.com` if not already, register the dashboard's owning business in **Meta Business Manager** (`business.facebook.com`). [Dev: 1h]
2. **F0.2** Create a new Meta App in the dev portal, type = **Business**, link it to the Business Manager. [Dev: 0.5h]
3. **F0.3** Configure App Settings: app icon (1024×1024), Privacy Policy URL (C1), ToS URL (C2), Data Deletion Callback URL (C3), App Domains, Business Email, App Category = "Business and Pages". [Dev: 1h]
4. **F0.4** Add Facebook Login product to the app, configure Valid OAuth Redirect URIs (dev + prod). [Dev: 0.5h]
5. **F0.5** Add Pages API and Instagram Graph API products. [Dev: 0.5h]
6. **F0.6** **Start Business Verification** — upload incorporation docs, address proof, verify domain ownership. **This is the critical-path long-pole; start it today.** [Dev: 1h, Wait: 3–10 business days]
7. **F0.7** Add yourself + 1–2 teammates as App Roles (Admin / Developer / Tester) so you can test in dev mode without App Review. [Dev: 0.5h]
8. **F0.8** Create a test FB Page on a personal account (or use a real test Page) with the test user as admin. [Dev: 0.5h]

### Phase F1 — OAuth flow (2 days dev)

9. **F1.1** Add a `facebook` provider to `backend/app/services/integrations.py` provider registry. [Dev: 1h]
10. **F1.2** Build `backend/app/routers/facebook.py` with `start` and `callback` endpoints, mirroring `linkedin.py` (state hash → `integrationAuthStates/{sha256(state)}`, code → short-lived user token → long-lived user token via `fb_exchange_token` → `GET /me/accounts` → store per-Page token). [Dev: 1d]
11. **F1.3** Encrypt and persist: `integrationSecrets/{uid__facebook}` = `{ pageId, pageAccessToken (Fernet), pageName, scopes[], obtainedAt }`. Public summary at `users/{uid}/integrationConnections/facebook`. [Dev: 2h]
12. **F1.4** Frontend: add "Connect Facebook" button to `/settings`, post-callback success/error UI, "Disconnect" button. [Dev: 4h]
13. **F1.5** Handle the multi-page case: if `/me/accounts` returns >1 page, surface a Page picker before persisting. [Dev: 3h]

### Phase F2 — Publish path (1.5 days dev)

14. **F2.1** Build `facebook_publisher.py` with `publish_text`, `publish_with_image`, `publish_with_link`, `publish_video`. Endpoints: `POST /{page-id}/feed`, `POST /{page-id}/photos`, `POST /{page-id}/videos`. Use **`appsecret_proof`** (C8). [Dev: 1d]
15. **F2.2** Wire publisher into the unified scheduler worker (C4). [Dev: 2h]
16. **F2.3** Replace the manual handoff on `/publish` with backend publish when connected; keep handoff as fallback. [Dev: 2h]

### Phase F3 — App Review submission (½ day dev, 1–4 weeks calendar)

17. **F3.1** Confirm Business Verification (F0.6) is complete. **Do not submit App Review before Business Verification finishes.** [Wait]
18. **F3.2** Record a screencast for **each** permission requested (`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`). Screencast must show: user clicks Connect → consent dialog with the requested scopes visible → user approves → returned to dashboard → user schedules a post → user sees it published on the actual FB Page. No edits, no skips. [Dev: 3h]
19. **F3.3** Write the use-case description for each permission (1–2 paragraphs each, plain English, explaining why the SaaS needs it). [Dev: 1h]
20. **F3.4** Submit App Review. Test credentials = a working dev account on your app + the test FB Page. [Dev: 0.5h, Wait: 1–7 business days nominal, 2–4 weeks if rejected once]
21. **F3.5** Address any rejection feedback — re-record screencast, clarify use case, resubmit. Plan for one rejection cycle. [Dev: 1d (if rejected), Wait: 1–7 days per cycle]

### Phase F4 — Native scheduling (optional, ½ day)

22. **F4.1** Add support for `scheduled_publish_time` + `published=false` payload to `facebook_publisher.py` for posts ≤30 days out (Meta's native FB scheduling). Optional — our own scheduler works for both, but native scheduling is useful as a fallback if our scheduler is down. [Dev: 4h]

### Phase F5 — Production rollout (½ day dev)

23. **F5.1** Switch the Meta app to **Live mode** in the dev portal. [Dev: 0.5h]
24. **F5.2** Enable the Connect Facebook button for staff first; verify end-to-end with a real (non-test) FB Page. [Dev: 1h]
25. **F5.3** Roll out to a beta cohort of 5–10 customers; monitor `scheduledPosts.status='failed'` rate and error codes. [Dev: 2h]
26. **F5.4** GA. Update `specs/automation.md`. [Dev: 1h]

**Facebook totals: ~5 dev-days. Calendar: 2–6 weeks (dominated by Business Verification + App Review).**

---

## Instagram — Same Meta app as Facebook

Plan IG **alongside** Facebook — same Meta app, same Business Verification, ideally same App Review submission. Add ~2 dev-days on top of Facebook for IG-specific work.

### Phase I0 — Decide on auth flow (½ day, parallel with F0)

1. **I0.1** Decide between Instagram-with-Facebook-Login (requires user to have IG connected to a FB Page) vs Instagram-with-Instagram-Login (direct IG OAuth, no FB Page required). **Recommend Instagram Login** as v1 — simpler UX, broader audience. Add FB Login flow in v2 if customers ask. [Dev: 0.5h]
2. **I0.2** In the Meta dev portal, add the **Instagram** product. Configure Instagram-with-Instagram-Login: set OAuth Redirect URI, Deauthorize Callback URL, Data Deletion Request URL. [Dev: 1h]
3. **I0.3** Convert the test IG account to **Business or Creator** (in the IG mobile app: Settings → Account → Switch to Professional). Required for any API publishing. [Dev: 0.5h]

### Phase I1 — OAuth flow (1.5 days dev)

4. **I1.1** Add an `instagram` provider to the registry. Authorize URL = `https://www.instagram.com/oauth/authorize`. Scopes = `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`. [Dev: 1h]
5. **I1.2** Build `backend/app/routers/instagram.py` with `start`/`callback`. Code → short-lived token (1h) via `https://api.instagram.com/oauth/access_token` → long-lived (60d) via `https://graph.instagram.com/access_token?grant_type=ig_exchange_token`. [Dev: 1d]
6. **I1.3** Persist: `integrationSecrets/{uid__instagram}` = `{ igUserId, accessToken (Fernet), tokenExpiresAt, loginType: 'instagram_login', scopes[] }`. Public summary at `users/{uid}/integrationConnections/instagram`. [Dev: 2h]
7. **I1.4** Hook IG into the **token-refresh worker** (C5): for any IG token where `tokenExpiresAt < now + 10 days`, call `GET /refresh_access_token`, persist the new token. **Tokens must be ≥24h old before refresh works.** [Dev: 2h]
8. **I1.5** Frontend: "Connect Instagram" button on `/settings`. [Dev: 2h]

### Phase I2 — Container-based publish (2 days dev)

9. **I2.1** Build `instagram_publisher.py`. Implement the **2-step container then publish** pattern:
   - `POST /{ig-user-id}/media` with `image_url`/`video_url` + `media_type` (`IMAGE`, `VIDEO`, `REELS`, `STORIES`, `CAROUSEL`) → returns `creation_id`.
   - Poll `GET /{ig-container-id}?fields=status_code` once per minute, max 5 minutes, until `FINISHED`.
   - `POST /{ig-user-id}/media_publish` with `creation_id`. [Dev: 1d]
10. **I2.2** Implement carousel support: create one child container per item with `is_carousel_item=true`, then a parent container with `media_type=CAROUSEL` and `children=<comma-separated-ids>`. [Dev: 4h]
11. **I2.3** **Critical: build the publisher to create the container at fire time, not at schedule time.** Containers expire in 24 hours. [Dev: 1h]
12. **I2.4** Validate media before container creation: JPEG only for images, 9:16 for Reels, public HTTPS URL (C7), under size/duration caps. Reject early with a clear error. [Dev: 3h]
13. **I2.5** Wire publisher into the unified scheduler (C4). [Dev: 2h]

### Phase I3 — App Review (combined with Facebook)

14. **I3.1** Add IG-specific screencasts to the F3.2 submission: one screencast per IG permission (`instagram_business_basic`, `instagram_business_content_publish`). Show user connecting → scheduling → IG container → IG media_publish → post visible on the IG account. [Dev: 2h, Wait: shared with F3]
15. **I3.2** Submit IG permissions in the **same** App Review batch as Facebook to avoid two queue waits. [Dev: 0.5h, Wait: shared with F3]

### Phase I4 — Production rollout (½ day, can be combined with F5)

16. **I4.1** Same as F5.1–F5.4, but also verify the token-refresh worker is firing (cron logs + Firestore audit). [Dev: 4h]

**Instagram totals: ~4 dev-days on top of Facebook (or ~6 dev-days standalone). Calendar shared with Facebook.**

---

## X (Twitter) — Pay, click, ship

No App Review queue. The gate is your credit card. Realistic time from zero to live = under 2 weeks calendar, almost all of it dev work.

### Phase X0 — Pre-dev setup (½ day)

1. **X0.1** Create an X account that will own the dev project (a company-owned handle, not a personal one). [Dev: 0.5h]
2. **X0.2** Sign up at `developer.x.com`. Subscribe to the **Pay-Per-Use** tier ($0.01/post written, $0.005/read). Have a credit card ready. [Dev: 0.5h]
3. **X0.3** Create a Project, then create an App inside it. Fill in: name, description, website URL, ToS URL (C2), Privacy Policy URL (C1), use-case description. [Dev: 0.5h]
4. **X0.4** In the App's "User authentication settings" panel, configure:
   - Type of App = **Web App, Confidential client**
   - App permissions = **Read and Write** (the App-level toggle is a hard ceiling — defaults to Read, which silently breaks publish)
   - Callback URI = exact match (including trailing slash) for both dev and prod
   - Website URL [Dev: 0.5h]
5. **X0.5** Save the Client ID + Client Secret to your secrets manager (do not commit). [Dev: 0.5h]
6. **X0.6** Set a billing alert in the X dev portal at e.g. $50/mo for the first month so you don't get surprised. [Dev: 0.5h]

### Phase X1 — OAuth 2.0 PKCE flow (2 days dev)

7. **X1.1** Add an `x` (or `twitter`) provider to the registry. Scopes = `tweet.read tweet.write users.read media.write offline.access`. [Dev: 1h]
8. **X1.2** Build `backend/app/routers/x.py` with `start`/`callback`. PKCE additions vs LinkedIn: generate `code_verifier` + `code_challenge` (S256), persist verifier in `integrationAuthStates/{sha256(state)}` alongside the existing state hash. [Dev: 6h]
9. **X1.3** Authorize URL = `https://x.com/i/oauth2/authorize`. Token endpoint = `POST https://api.x.com/2/oauth2/token` with `grant_type=authorization_code`, Basic auth header `client_id:client_secret`. [Dev: 4h]
10. **X1.4** After token exchange, call `GET /2/users/me` to capture `x_user_id` and `username`. [Dev: 1h]
11. **X1.5** Persist: `integrationSecrets/{uid__x}` = `{ accessToken (Fernet), refreshToken (Fernet), expiresAt, scopes[], xUserId, username }`. [Dev: 2h]
12. **X1.6** Frontend: "Connect X" button on `/settings`. [Dev: 2h]

### Phase X2 — Refresh-on-publish (critical correctness work — ½ day)

13. **X2.1** Implement refresh-on-publish in `x_publisher.py`:
   - Read secret in a Firestore transaction.
   - If `now >= expiresAt - 60s`, call `POST /2/oauth2/token` with `grant_type=refresh_token`.
   - **Persist new access + new refresh token + new expiry inside the same transaction, BEFORE issuing the publish call.** Refresh tokens are single-use rotating; if you crash between refresh and persist, the user is locked out. [Dev: 4h]
14. **X2.2** Add a unit/integration test that simulates rapid back-to-back publishes to verify the refresh flow doesn't double-rotate. [Dev: 2h]

### Phase X3 — Publish path (1.5 days dev)

15. **X3.1** Build `x_publisher.py.publish_text(text)` calling `POST https://api.x.com/2/tweets` with `{ "text": "..." }`. Return the tweet id. [Dev: 2h]
16. **X3.2** Implement v2 chunked media upload at `https://api.x.com/2/media/upload`: INIT → APPEND chunks → FINALIZE → poll STATUS until `succeeded` → reference `media_id` in tweet payload. [Dev: 6h]
17. **X3.3** Implement reply (`reply.in_reply_to_tweet_id`) and threading (post → use returned id as next post's reply target). [Dev: 2h]
18. **X3.4** **Skip** quote-tweet (Enterprise-only) and long-form (>280 chars, requires user-side X Premium). Surface as disabled in UI; handle error 111 gracefully. [Dev: 1h]
19. **X3.5** Wire publisher into unified scheduler (C4). For scheduled posts, **upload media at fire time, not at schedule time** (chunks expire). [Dev: 2h]
20. **X3.6** Replace `/publish` X button: backend publish when connected; intent-URL handoff (`https://twitter.com/intent/tweet`) as fallback for users who haven't authorized. [Dev: 2h]

### Phase X4 — Test and verify (½ day)

21. **X4.1** Manual test: schedule a post in the future, verify it fires correctly via the scheduler. [Dev: 1h]
22. **X4.2** Manual test: kill the FastAPI process mid-scheduler-tick, restart, verify refresh-token rotation didn't lock the user out (this is the highest-risk bug for X). [Dev: 1h]
23. **X4.3** Manual test: revoke the app at `x.com/settings/connected_apps`, verify next publish surfaces a clean "reconnect required". [Dev: 1h]
24. **X4.4** Verify 429 handling: read `x-rate-limit-reset`, back off, retry. [Dev: 1h]

### Phase X5 — Production rollout (½ day)

25. **X5.1** Roll out to staff first; monitor X dev portal billing for unexpected spikes. [Dev: 2h]
26. **X5.2** Beta cohort of 5–10 customers; monitor monthly write spend (target: <$0.50/customer/month at 30 posts/customer/month). [Dev: 2h]
27. **X5.3** GA. Update `specs/automation.md`. [Dev: 1h]

**X totals: ~5 dev-days, ~7 calendar days. No external review queue, no Business Verification, no App Review.**

---

## Recommended Overall Sequence

If shipping all four, the cheapest schedule is:

```
Week 1:           Cross-cutting prereqs (C1–C8) + LinkedIn finishing (L0–L2)
Week 1 (parallel): Start Meta Business Verification (F0.6)
Week 2:           Build FB+IG OAuth + publish (F1–F2, I1–I2)
Week 2 end:       Submit Meta App Review (F3, I3 combined)
Week 3:           Build X (X0–X4) while Meta App Review is in queue
Week 4–6:         Address Meta review feedback if rejected; production rollouts as approvals land
```

### Total budget at a glance

| Platform | Dev days | Wait days | Calendar |
|---|---|---|---|
| Cross-cutting | 7 | 0 | 1 week |
| LinkedIn | 3 | 0 | 3 days |
| X | 5 | 0 | 1 week |
| Facebook | 5 | 7–30 | 2–6 weeks |
| Instagram | 4 (on top of FB) | shared with FB | shared with FB |
| **Total (sequential)** | **~24 dev-days** | — | **4–7 weeks calendar** |
| **Total (with overlap)** | **~24 dev-days** | — | **3–6 weeks calendar** |

### Critical-path callouts

1. **Start Meta Business Verification on Day 1** (F0.6). It's the longest external wait and has zero dependencies on your code.
2. **Submit FB and IG together** in one App Review batch. Two queue waits = bad.
3. **LinkedIn and X have no review gate.** If you need a quick win, ship LinkedIn in week 1 to prove the scheduler infrastructure works end-to-end.
4. **The unified scheduler (C4) and token-refresh worker (C5) are the foundation** — every platform depends on them. Build these once, correctly, before per-platform work.
5. **X's refresh-token rotation (X2.1) is the highest-risk bug.** Test it under restart before going live.
