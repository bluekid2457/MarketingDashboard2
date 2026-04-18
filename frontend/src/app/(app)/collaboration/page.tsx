export default function CollaborationPage() {
  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 10</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Collaboration and Client Management</h1>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-card p-6">
          <h2 className="section-title">Invite / Manage Users</h2>
          <button className="mt-3 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white">Invite teammate</button>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Role-Based Access</h2>
          <p className="mt-2 muted-copy">Owner, Editor, Reviewer, Client Viewer.</p>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Client Brief Forms</h2>
          <div className="mt-3 min-h-[140px] rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-500">
            Intake form for campaign goals, audience, and constraints.
          </div>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Project Calendars</h2>
          <p className="mt-2 muted-copy">Multi-client timeline with milestone blocks and dependencies.</p>
        </section>

        <section className="surface-card p-6 lg:col-span-2">
          <h2 className="section-title">White-Label Toggles</h2>
          <p className="mt-2 muted-copy">Customize logo, palette, export headers, and client-facing views.</p>
        </section>
      </div>
    </div>
  );
}
