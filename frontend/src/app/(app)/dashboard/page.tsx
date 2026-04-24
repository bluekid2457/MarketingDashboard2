export default function DashboardPage() {
  const metrics = [
    { label: 'Posts this week', value: '14', delta: '+3 vs last week' },
    { label: 'Ideas waiting', value: '27', delta: '5 high-priority' },
    { label: 'Review SLA', value: '6h', delta: 'On target' },
    { label: 'Engagement rate', value: '12.8%', delta: '+1.4%' },
  ];

  const calendarDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="space-y-6">
      <section className="surface-card overflow-hidden p-6 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Overview</p>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">Campaign Command Center 2</h1>
            <p className="mt-2 max-w-2xl muted-copy">Monitor momentum across your pipeline from raw ideas to live performance.</p>
          </div>
          <button className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            New Campaign Sprint
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <article key={metric.label} className="hero-metric">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{metric.label}</p>
              <p className="mt-2 text-3xl font-extrabold text-slate-900">{metric.value}</p>
              <p className="mt-1 text-xs font-medium text-teal-700">{metric.delta}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="surface-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">Content Calendar</h2>
            <span className="pill">April schedule</span>
          </div>
          <div className="grid grid-cols-7 gap-2 text-center text-xs">
            {calendarDays.map((day) => (
              <span key={day} className="rounded-lg border border-slate-200 bg-slate-50 py-2 font-semibold text-slate-600">
                {day}
              </span>
            ))}
            {[...Array(21)].map((_, index) => (
              <div
                key={index}
                className={`rounded-lg border py-3 font-medium ${
                  index % 5 === 0
                    ? 'border-teal-200 bg-teal-50 text-teal-800'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                {index + 8}
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Idea Backlog Summary</h2>
          <p className="mt-1 muted-copy">Top-scoring ideas ready for angle generation.</p>
          <ul className="mt-4 space-y-3 text-sm">
            {['AI search visibility playbook', 'Q2 founder narrative', 'Automation ROI benchmark'].map((idea) => (
              <li key={idea} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-800">{idea}</p>
                <p className="text-xs text-slate-500">Score: 8.7 / Timeliness: High</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-card p-6">
          <h2 className="section-title">Storyboards and Review Queue</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {['Storyboard-119 - Needs legal pass', 'Storyboard-120 - Waiting for client comment', 'Storyboard-121 - Ready for publish'].map((item) => (
              <li key={item} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <span className="font-medium text-slate-700">{item}</span>
                <button className="text-xs font-semibold text-teal-700">Open</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Recent Analytics</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Top platform</p>
              <p className="mt-2 text-xl font-bold text-slate-900">LinkedIn</p>
              <p className="text-xs text-teal-700">CTR 4.8%</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Best post type</p>
              <p className="mt-2 text-xl font-bold text-slate-900">Carousel</p>
              <p className="text-xs text-teal-700">+23% saves</p>
            </div>
          </div>
        </section>
      </div>

      <section className="surface-card p-6">
        <h2 className="section-title">Quick Links</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {['Add idea', 'Generate angles', 'Open review queue', 'Plan next week'].map((link) => (
            <button key={link} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {link}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
