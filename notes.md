# Implementation Notes — Overview Page

This file tracks data gaps surfaced while wiring the Overview (`/dashboard`) page
to live Firestore data. Items listed here render with a **red badge / red card**
on the dashboard so they remain visible until a real data source exists.

---

## 1. Engagement rate — no analytics source

**Where it shows on dashboard:** Hero metric card 4 — currently rendered red
("N/A") with a TODO badge.

**What's missing:** No publication telemetry is captured anywhere in the app.
The `/publish` page hands content off to LinkedIn/X via clipboard or intent URLs
and does not record what was actually posted, when, or with what reach.

**Proposed Firestore change** (please confirm before I add):

```
users/{uid}/publications/{publicationId}
  ideaId:        string
  angleId:       string
  draftId:       string
  platform:      "linkedin" | "twitter" | "medium" | "newsletter" | "blog"
  publishedAtMs: number        // when user clicked "Publish to ..."
  externalUrl:   string | null // optional, user can paste back the live URL
  metrics: {                   // optional, manually entered or imported later
    impressions: number
    engagements: number
    clicks: number
    fetchedAtMs: number
  }
```

**Step 1 (no API needed):** When the user clicks "Publish to LinkedIn" / "Publish
to X" in `/publish`, write a publication doc with `publishedAtMs = Date.now()`.
That alone unlocks "Posts this week (published)" and "Last published".

**Step 2 (manual, no API needed):** Add a small form on `/analytics` letting the
user paste the live post URL and impressions/engagements numbers. Engagement
rate = `engagements / impressions` averaged across recent publications.

**Step 3 (API, future):** LinkedIn/X organic post analytics need a paid LinkedIn
Marketing Developer Platform app and X Premium API. Out of scope until the user
explicitly wants it; until then Step 2 is the path.

---

## 2. Scheduled publish dates — no schedule field

**Where it shows on dashboard:** Activity Calendar — currently shows actual edit
activity instead of scheduled posts, with an amber callout explaining this.

**What's missing:** Drafts/adaptations have no `scheduledFor` timestamp.

**Proposed Firestore change** (please confirm before I add):

Add an optional field to `users/{uid}/drafts/{draftId}`:

```
scheduledFor: number | null   // ms timestamp the user plans to publish
```

Then add a "Schedule for…" date picker on the storyboard editor page. Once that
exists, the dashboard calendar can switch from showing edit activity to showing
upcoming scheduled posts, color-coded by status.

---

## 3. Best post type / Format performance — no format tracking

**Where it shows on dashboard:** Recent Analytics tile 2 — rendered red with TODO
badge.

**What's missing:** "Format" exists on ideas (`format: "Unspecified"` in current
schema) but is never set, never read, and isn't tied to performance because (1)
there's no performance data anyway and (2) the format field is hardcoded to
`"Unspecified"` in `frontend/src/app/(app)/ideas/page.tsx` (`DEFAULT_IDEA_FORMAT`).

**Proposed change:**
- Add a Format dropdown to the New Idea form (Carousel / Single image / Video /
  Long-form / Thread / etc.).
- Once publication telemetry from item #1 lands, group engagement by format.

---

## 4. Review SLA — partially live but missing approval state

**Where it shows on dashboard:** Hero metric card 3 ("Oldest open draft").

**Currently:** Reads the oldest `users/{uid}/drafts/{draftId}` by `updatedAt`
that has any content. This is a reasonable proxy but is not a true SLA.

**Proposed Firestore change** (low priority — current proxy is acceptable):

Extend draft `status` to a controlled vocabulary so the dashboard can compute
real review-stage SLA:

```
status: "storyboard" | "draft" | "in_review" | "approved" | "scheduled" | "published"
```

Right now `status` is free-form text; the storyboard page defaults to
`"storyboard"`. Standardising this also unblocks better filtering in `/review`.

---

## 5. Quick Links — implemented (no change needed)

Quick Links on the dashboard now link to real routes (`/ideas`, `/angles`,
`/review`, `/publish`). Previously they were inert buttons.

---

## What the dashboard renders today (real data)

| Tile / section | Data source |
|---|---|
| Posts this week | Count of `users/{uid}/drafts` updated since Monday 00:00 |
| Posts delta vs last week | Diff against drafts updated in the prior 7-day window |
| Ideas waiting | Count of `users/{uid}/ideas` that have no matching draft yet |
| Strong-rated count | Filter of waiting ideas where `relevance.label === "Strong"` |
| Oldest open draft | Min `updatedAt` of drafts with non-empty `content` |
| Activity Calendar | Per-day count of draft + adaptation updates this month |
| Idea Backlog Summary | Top 3 ideas by `relevance.score` |
| Storyboards & Review Queue | First 5 drafts ordered by `updatedAt` desc |
| Top adapted platform | Counts of non-empty `platforms.{key}` on adaptations |
| Total adaptations / drafts | Direct counts |
| Quick Links | Static navigation — now Next.js `<Link>` |
