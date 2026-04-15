#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# setup-screens.sh  — creates all 12 Marketing Dashboard screens
# Run from the project root:  bash frontend/setup-screens.sh
# ---------------------------------------------------------------------------
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)/src/app"

# ── 1. Create all directories ──────────────────────────────────────────────
mkdir -p \
  "$ROOT/(app)/dashboard" \
  "$ROOT/(app)/ideas" \
  "$ROOT/(app)/angles" \
  "$ROOT/(app)/drafts/[id]" \
  "$ROOT/(app)/adapt/[id]" \
  "$ROOT/(app)/publish" \
  "$ROOT/(app)/review" \
  "$ROOT/(app)/analytics" \
  "$ROOT/(app)/collaboration" \
  "$ROOT/(app)/settings" \
  "$ROOT/(app)/notifications" \
  "$ROOT/(auth)/login"

echo "✅  Directories created"

# ── 2. (app)/layout.tsx ────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/layout.tsx"
import Nav from '@/components/Nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Nav />
      <main className="flex-1 ml-64 p-8">{children}</main>
    </div>
  );
}
ENDOFFILE

# ── 3. (auth)/login/page.tsx ───────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(auth)/login/page.tsx"
export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-xl shadow p-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Login &amp; Authentication</h1>

        <section aria-label="Email and password fields">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Sign In</h2>
          <div className="space-y-3">
            <input type="email" placeholder="Email address" className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm" />
            <input type="password" placeholder="Password" className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm" />
            <button className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Sign In</button>
          </div>
        </section>

        <section aria-label="OAuth provider buttons">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Or continue with</h2>
          <div className="space-y-2">
            <button className="w-full border border-gray-300 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Google</button>
            <button className="w-full border border-gray-300 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">GitHub</button>
          </div>
        </section>

        <section aria-label="Forgot password and registration links">
          <div className="flex justify-between text-sm">
            <a href="#" className="text-indigo-600 hover:underline">Forgot password?</a>
            <a href="#" className="text-indigo-600 hover:underline">Create account</a>
          </div>
        </section>

        <section aria-label="Error messages">
          {/* Error messages rendered here */}
        </section>
      </div>
    </div>
  );
}
ENDOFFILE

# ── 4. Dashboard ───────────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/dashboard/page.tsx"
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Content Calendar</h2>
        <p className="text-gray-400 text-sm">Scheduled and published content calendar will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Idea Backlog Summary</h2>
        <p className="text-gray-400 text-sm">Summary of top ideas from the backlog will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Drafts / Review Queue</h2>
        <p className="text-gray-400 text-sm">Pending drafts and review items will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Recent Analytics</h2>
        <p className="text-gray-400 text-sm">Recent performance metrics and analytics will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Quick Links</h2>
        <p className="text-gray-400 text-sm">Quick navigation links to common actions will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 5. Ideas ───────────────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/ideas/page.tsx"
export default function IdeasPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Idea Input &amp; Backlog</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Idea Input Box</h2>
        <textarea className="w-full border border-gray-300 rounded-lg p-3 text-sm" rows={4} placeholder="Enter a new content idea..." />
        <button className="mt-3 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700">Add Idea</button>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Tone / Audience / Format Dropdowns</h2>
        <div className="flex gap-4">
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm"><option>Tone</option></select>
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm"><option>Audience</option></select>
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm"><option>Format</option></select>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Ideas List with Scores</h2>
        <p className="text-gray-400 text-sm">Scored and ranked ideas list will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Sort / Filter Controls</h2>
        <p className="text-gray-400 text-sm">Sort and filter controls for the ideas list will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Trend Detection Panel</h2>
        <p className="text-gray-400 text-sm">Real-time trend detection and topic signals will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Competitor Content Panel</h2>
        <p className="text-gray-400 text-sm">Competitor content analysis will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 6. Angles ──────────────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/angles/page.tsx"
export default function AnglesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">AI Angle Selection &amp; Outline</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">AI-Generated Angles List</h2>
        <p className="text-gray-400 text-sm">AI-generated content angles and headlines will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Inline Editing</h2>
        <p className="text-gray-400 text-sm">Inline editing controls for refining angles will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Selection Controls</h2>
        <p className="text-gray-400 text-sm">Controls to select and proceed with a chosen angle will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Error / Retry Messages</h2>
        <p className="text-gray-400 text-sm">Error handling and retry prompts will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 7. Draft Editor [id] ───────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/drafts/[id]/page.tsx"
export default async function DraftEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Draft Editor — {id}</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Rich Text Editor</h2>
        <div className="border border-gray-300 rounded-lg p-4 min-h-[200px] text-gray-400 text-sm">
          Rich text editor will appear here.
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Mid-Draft Prompt Bar</h2>
        <p className="text-gray-400 text-sm">AI-assisted mid-draft prompts and suggestions will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Tone / Sentiment Controls</h2>
        <p className="text-gray-400 text-sm">Tone and sentiment adjustment controls will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Readability / SEO Scoring</h2>
        <p className="text-gray-400 text-sm">Readability grade and SEO score indicators will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Persona Targeting</h2>
        <p className="text-gray-400 text-sm">Audience persona targeting settings will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">A/B Headline Generator</h2>
        <p className="text-gray-400 text-sm">AI-generated A/B headline variants will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Plagiarism / Citation Checker</h2>
        <p className="text-gray-400 text-sm">Plagiarism detection and citation suggestions will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Action Buttons</h2>
        <div className="flex gap-3">
          <button className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700">
            Save Draft
          </button>
          <button className="bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-700">
            Submit for Review
          </button>
          <button className="border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50">
            Discard
          </button>
        </div>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 8. Adapt [id] ──────────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/adapt/[id]/page.tsx"
export default async function AdaptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Multi-Channel Adaptation — {id}</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Platform Selector</h2>
        <div className="flex gap-3 flex-wrap">
          {['LinkedIn', 'Twitter/X', 'Medium', 'Newsletter', 'Instagram'].map((platform) => (
            <button
              key={platform}
              className="border border-gray-300 rounded-full px-4 py-1 text-sm text-gray-600 hover:bg-indigo-50 hover:border-indigo-400"
            >
              {platform}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Preview Per Format</h2>
        <p className="text-gray-400 text-sm">Platform-specific content previews will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">AI Chat for Editing</h2>
        <p className="text-gray-400 text-sm">AI-powered chat interface for content adjustments will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 9. Publish ─────────────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/publish/page.tsx"
export default function PublishPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Publishing &amp; Scheduling</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Platform Connection Status</h2>
        <p className="text-gray-400 text-sm">Connected platform statuses (LinkedIn, Medium, etc.) will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Schedule Picker / Calendar</h2>
        <p className="text-gray-400 text-sm">Date and time scheduling picker will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Draft Mode Toggle</h2>
        <p className="text-gray-400 text-sm">Toggle to switch between draft and published mode will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Visual Content Calendar</h2>
        <p className="text-gray-400 text-sm">Visual calendar showing scheduled posts will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Gap Detection Alerts</h2>
        <p className="text-gray-400 text-sm">Alerts for content calendar gaps will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Submit to Search Engines</h2>
        <p className="text-gray-400 text-sm">Controls to submit URLs to Google Search Console, Bing, etc. will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 10. Review ─────────────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/review/page.tsx"
export default function ReviewPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Review &amp; Approval Workflow</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Draft Queue</h2>
        <p className="text-gray-400 text-sm">Queue of drafts pending review will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Inline Editor</h2>
        <p className="text-gray-400 text-sm">Inline editing interface for reviewers will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Version History</h2>
        <p className="text-gray-400 text-sm">Draft version history and diff viewer will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Approval Chain Controls</h2>
        <p className="text-gray-400 text-sm">Multi-step approval chain management will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Comment / Suggestion Layer</h2>
        <p className="text-gray-400 text-sm">Inline comments and tracked suggestions will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Role-Based Access</h2>
        <p className="text-gray-400 text-sm">Role-based access controls for reviewers and approvers will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 11. Analytics ──────────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/analytics/page.tsx"
export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Analytics &amp; Performance</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Engagement Charts</h2>
        <p className="text-gray-400 text-sm">Engagement metrics charts (views, clicks, shares) will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Performance History</h2>
        <p className="text-gray-400 text-sm">Historical performance data and trends will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Predictive Scoring</h2>
        <p className="text-gray-400 text-sm">AI-driven predictive content performance scores will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Copy Intelligence Insights</h2>
        <p className="text-gray-400 text-sm">Insights on top-performing copy elements will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">AI Visibility Tracking</h2>
        <p className="text-gray-400 text-sm">AI search engine and LLM visibility metrics will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 12. Collaboration ──────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/collaboration/page.tsx"
export default function CollaborationPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Collaboration &amp; Client Management</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Invite / Manage Users</h2>
        <p className="text-gray-400 text-sm">User invitation and management controls will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Role-Based Access</h2>
        <p className="text-gray-400 text-sm">Role assignment and permission management will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Client Brief Forms</h2>
        <p className="text-gray-400 text-sm">Client onboarding and brief intake forms will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Project Calendars</h2>
        <p className="text-gray-400 text-sm">Shared project and content calendars will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">White-Label Toggles</h2>
        <p className="text-gray-400 text-sm">White-labeling and branding customization options will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 13. Settings ───────────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/settings/page.tsx"
export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Settings &amp; Compliance</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Brand Voice Editor</h2>
        <p className="text-gray-400 text-sm">Brand voice configuration and style guide editor will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Compliance Flags</h2>
        <p className="text-gray-400 text-sm">Content compliance rules and flagging settings will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Audit Log Viewer</h2>
        <p className="text-gray-400 text-sm">System and content audit log viewer will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Integration Connectors</h2>
        <p className="text-gray-400 text-sm">Third-party integration configuration (CRM, CMS, etc.) will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Security Settings</h2>
        <p className="text-gray-400 text-sm">Password, 2FA, and session security settings will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

# ── 14. Notifications ──────────────────────────────────────────────────────
cat << 'ENDOFFILE' > "$ROOT/(app)/notifications/page.tsx"
export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Error &amp; Notifications</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Error Messages</h2>
        <p className="text-gray-400 text-sm">System and automation error messages will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Success / Warning Notifications</h2>
        <p className="text-gray-400 text-sm">Success confirmations and warning alerts will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">System Alerts</h2>
        <p className="text-gray-400 text-sm">System-level alerts and maintenance notices will appear here.</p>
      </section>
    </div>
  );
}
ENDOFFILE

echo "✅  All screen files written"

# ── 15. Build ──────────────────────────────────────────────────────────────
cd "$(dirname "$0")"
echo ""
echo "🔨  Running npm run build..."
npm run build && echo "🎉  Build passed!" || echo "❌  Build failed — check errors above"
