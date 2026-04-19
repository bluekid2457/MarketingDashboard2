export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 9</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Analytics and Performance</h1>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-card p-6">
          <h2 className="section-title">Engagement Charts</h2>
          <div className="mt-3 min-h-[180px] rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-500">
            Engagement chart area
          </div>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Performance History</h2>
          <div className="mt-3 min-h-[180px] rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-500">
            Timeline and trend history
          </div>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Predictive Scoring</h2>
          <p className="mt-2 text-sm text-slate-700">Predicted reach: 42k | confidence 82%</p>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Copy Intelligence Insights</h2>
          <p className="mt-2 text-sm text-slate-700">Hooks with direct outcomes outperform generic intros by 19%.</p>
        </section>

        <section className="surface-card p-6 lg:col-span-2">
          <h2 className="section-title">AI Visibility Tracking</h2>
          <p className="mt-2 text-sm text-slate-700">Track mentions and ranking trend across AI answer engines and search assistants.</p>
        </section>
      </div>
    </div>
  );
}
