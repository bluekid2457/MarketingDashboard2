export default function PublishPage() {
  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 7</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Publishing and Scheduling</h1>
        <p className="mt-1 muted-copy">Coordinate channel readiness, schedule windows, and distribution cadence.</p>
      </section>

      <section className="surface-card p-6">
        <h2 className="section-title">Platform Connection Status</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['LinkedIn', 'Connected'],
            ['Medium', 'Connected'],
            ['X', 'Needs refresh'],
            ['Newsletter', 'Connected'],
          ].map(([platform, status]) => (
            <article key={platform} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-800">{platform}</p>
              <p className="mt-1 text-xs font-medium text-teal-700">{status}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="surface-card p-6">
          <h2 className="section-title">Schedule Picker / Calendar</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input type="time" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div className="mt-4 min-h-[180px] rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-500">
            Visual Content Calendar
          </div>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Draft Mode Toggle</h2>
          <div className="mt-3 inline-flex rounded-full border border-slate-300 p-1 text-sm">
            <button className="rounded-full bg-teal-700 px-4 py-1.5 font-semibold text-white">Draft</button>
            <button className="rounded-full px-4 py-1.5 font-semibold text-slate-700">Publish</button>
          </div>
          <h3 className="mt-5 text-sm font-semibold text-slate-800">Gap Detection Alerts</h3>
          <p className="mt-2 text-sm text-amber-900">No thought-leadership posts planned for Thursday and Friday.</p>
          <button className="mt-4 w-full rounded-xl bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            Submit to Search Engines
          </button>
        </section>
      </div>
    </div>
  );
}
