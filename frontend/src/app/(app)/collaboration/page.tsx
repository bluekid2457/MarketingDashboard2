import { ComingSoonBadge } from '@/components/ComingSoonBadge';
import { PlaceholderCard } from '@/components/PlaceholderCard';

export default function CollaborationPage() {
  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 10</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Collaboration and Client Management</h1>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-disabled="true" className="surface-card p-6 opacity-75">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="section-title">Invite / Manage Users</h2>
            <ComingSoonBadge />
          </div>
          <p className="mt-2 muted-copy">
            Invite teammates, assign roles, and revoke access from a single workspace roster.
          </p>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="mt-3 cursor-not-allowed rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500"
          >
            Invite teammate
          </button>
        </section>

        <PlaceholderCard
          title="Role-Based Access"
          description="Owner, Editor, Reviewer, Client Viewer — separate drafting, approving, and publishing rights per workspace member."
          previewKind="list"
        />

        <PlaceholderCard
          title="Client Brief Forms"
          description="Intake form for campaign goals, audience, and constraints."
          previewKind="form"
        />

        <PlaceholderCard
          title="Project Calendars"
          description="Multi-client timeline with milestone blocks and dependencies."
          previewKind="chart"
        />

        <PlaceholderCard
          title="White-Label Toggles"
          description="Customize logo, palette, export headers, and client-facing views."
          previewKind="form"
          className="lg:col-span-2"
        />
      </div>
    </div>
  );
}
