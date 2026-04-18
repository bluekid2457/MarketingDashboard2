export default function ReviewPage() {
  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 8</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Review and Approval Workflow</h1>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <section className="surface-card p-6">
          <h2 className="section-title">Draft Queue</h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            <li className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">Draft-121: Security launch article</li>
            <li className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">Draft-122: Product teardown thread</li>
            <li className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">Draft-123: Case study summary</li>
          </ul>

          <h3 className="mt-5 text-sm font-semibold text-slate-800">Inline Editor</h3>
          <div className="mt-2 min-h-[180px] rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-500">
            Inline editor for reviewer changes and tracked suggestions.
          </div>
        </section>

        <div className="space-y-6">
          <section className="surface-card p-6">
            <h2 className="section-title">Version History</h2>
            <p className="mt-2 muted-copy">v8 approved copy, v9 legal edits, v10 final QA in progress.</p>
          </section>

          <section className="surface-card p-6">
            <h2 className="section-title">Approval Chain Controls</h2>
            <p className="mt-2 muted-copy">Author &#8594; Editor &#8594; Legal &#8594; Client approver.</p>
          </section>

          <section className="surface-card p-6">
            <h2 className="section-title">Comment / Suggestion Layer</h2>
            <p className="mt-2 muted-copy">Threaded comments with mention support and resolution state.</p>
          </section>

          <section className="surface-card p-6">
            <h2 className="section-title">Role-Based Access</h2>
            <p className="mt-2 muted-copy">Restrict approval actions by role and workspace policy.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
