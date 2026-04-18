/** Right-hand trends panel */
function TrendsPanel() {
  const trends = [
    { label: 'Generative AI in Retail', score: '6/5' },
    { label: 'Zero-Click Search', score: '4/5' },
    { label: 'Click Auto in Time', score: '4/5' },
    { label: 'Invore Nhoating', score: '4/5' },
    { label: 'Generative AI Retail', score: '4/6' },
    { label: 'Zero-Click Search', score: '4/5' },
  ];
  const articles = [
    { title: 'The Future of Content Creation', date: '' },
    { title: "What is the Roor to Content's Ends?", date: 'Apr. 29, 2023' },
    { title: 'The Future of Content Creation Techniques', date: 'Dec. 21, 2023' },
    { title: 'The Future of Content', date: '' },
  ];
  return (
    <aside className="trends-panel hidden w-52 shrink-0 xl:block">
      <h2>Real-Time AI &amp; SEO Trends</h2>
      <div className="space-y-1">
        {trends.map((t) => (
          <p key={t.label} className="trend-item">
            {t.label} <span className="trend-score">Relevance: {t.score}</span>
          </p>
        ))}
      </div>
      <h2 className="mt-5">Relevant Articles</h2>
      <div>
        {articles.map((a) => (
          <div key={a.title} className="article-item">
            <a href="#">{a.title}</a>
            {a.date && <span className="article-date">{a.date}</span>}
          </div>
        ))}
      </div>
    </aside>
  );
}

export default async function AdaptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-5">

        {/* Page header */}
        <div className="page-header">
          <h1>Multi-Channel Adaptation: Adapting: &lt;Original Content Title from [IMAGE 0]&gt;</h1>
          <p className="breadcrumb mt-1">
            1. Drafting → Editing → SEO/Readability → Multi-Channel Adaptation (Active) → Review → Schedule
          </p>
        </div>

        {/* Three-column layout */}
        <div className="grid gap-5 xl:grid-cols-[260px_1fr_200px]">

          {/* Left — AI Chat */}
          <section className="surface-card flex flex-col p-4">
            <h2 className="section-title mb-3">AI Chat with Adaptation Assistant</h2>
            <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm min-h-[260px] max-h-80">
              <div>
                <p className="text-xs font-bold text-slate-400 mb-1">AI</p>
                <p className="text-slate-700 text-xs">
                  Hi, Small Business this adapted content, rennaiting exntent fant ands of you to artect iyreat activitites and strategies.
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-right text-slate-400 mb-1">User</p>
                <p className="text-right text-slate-700 text-xs">A Small Business SEO it&apos;s adapted content... e.g., &ldquo;Make the headline punchier for&rdquo;.</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Chat with AI to refine this adapted content... e.g., 'Make the headline punchier for Twitter'."
              />
              <button
                className="rounded-xl px-3 py-2 text-sm font-bold text-white"
                style={{ background: '#1a7a5e' }}
              >
                ➤
              </button>
            </div>
          </section>

          {/* Center — Editor with platform tabs */}
          <section className="surface-card flex flex-col p-4">
            {/* Platform tabs */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <p className="mr-2 text-xs font-semibold text-slate-500">Adaptation Chat and Editor</p>
              {[
                { label: 'LinkedIn', icon: 'in', color: '#0a66c2' },
                { label: 'Blog Post', icon: '✎', color: '#475569' },
                { label: 'X (Twitter)', icon: 'X', color: '#000' },
                { label: 'Medium', icon: 'M', color: '#333' },
              ].map((p) => (
                <button
                  key={p.label}
                  className="flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-white"
                    style={{ background: p.color }}
                  >{p.icon}</span>
                  {p.label}
                </button>
              ))}
              <button className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">+</button>
            </div>

            {/* Formatting toolbar */}
            <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-200 pb-3">
              <select className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600">
                <option>Styles</option>
              </select>
              {['B', 'I', 'S', 'X₂', 'X²'].map((f) => (
                <button key={f} className="rounded border border-slate-200 px-1.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50">{f}</button>
              ))}
              <span className="mx-1 text-slate-300">|</span>
              <select className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600">
                <option>Fonts</option>
              </select>
              <select className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600">
                <option>Image</option>
              </select>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-[260px] text-sm leading-relaxed text-slate-800">
              <h3 className="mb-2 font-bold">A Small Business SEO Game Changer: AI Power</h3>
              <p className="mb-3 text-slate-600 text-sm">
                The Power of AI in Small Business SEO: A Practical Guide — marketing chasting specific and speciffic examples of starupitos. d you finat post tanticors in business businessors in small business authomials extiates ad small ocheatings for email #crometemarketingideas of #nutfilimoutheas #ASmallBusinessSEOGameChanger: AI #Power#PracticaGuide
              </p>
            </div>

            {/* Version bar */}
            <div className="mt-3 flex items-center gap-3 border-t border-slate-200 pt-3 text-xs text-slate-500">
              <button className="hover:underline">⟵ Previous Version</button>
              <button className="hover:underline">Compare</button>
            </div>
          </section>

          {/* Right — Preview + tools */}
          <div className="space-y-4">
            <section className="surface-card p-4">
              <h2 className="section-title mb-3">Adaptation Previews</h2>
              {/* LinkedIn preview card */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-700 text-[9px] font-bold text-white">in</div>
                  <span className="font-semibold text-slate-700">LinkedIn</span>
                  <span className="ml-auto text-slate-400">⋯</span>
                </div>
                <div className="mb-1 flex items-center gap-1">
                  <div className="h-5 w-5 rounded-full bg-slate-300" />
                  <div className="h-2 w-24 rounded bg-slate-200" />
                </div>
                <div className="space-y-1">
                  <div className="h-2 w-full rounded bg-slate-100" />
                  <div className="h-2 w-5/6 rounded bg-slate-100" />
                  <div className="h-2 w-4/6 rounded bg-slate-100" />
                </div>
                <p className="mt-1 text-[10px] text-blue-600 hover:underline cursor-pointer">Alnindirr Blog Post</p>
                <div className="mt-2 flex gap-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                  <span>👍 like</span><span>💬 comment</span><span>↗ share</span>
                </div>
              </div>
            </section>

            <section className="surface-card p-4">
              <p className="mb-2 text-xs font-semibold text-slate-500">Persona Targeting</p>
              <select className="mb-2 w-full rounded-xl border border-slate-300 px-2 py-1.5 text-xs">
                <option>Small Business Owner</option>
              </select>
              <select className="mb-2 w-full rounded-xl border border-slate-300 px-2 py-1.5 text-xs">
                <option>Startup Founder</option>
              </select>
              <select className="mb-3 w-full rounded-xl border border-slate-300 px-2 py-1.5 text-xs">
                <option>Primary Marketing Objective</option>
              </select>

              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500">Optimization Tools</p>
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">Adapted</span>
              </div>
              <button className="mb-2 w-full rounded-xl py-2 text-xs font-semibold text-white" style={{ background: '#14302a' }}>
                A/B Headline Generator
              </button>
              <p className="mb-2 text-[10px] text-slate-400">Generates alternative titles to the test.</p>
              <button className="w-full rounded-xl py-2 text-xs font-semibold text-white" style={{ background: '#14302a' }}>
                Plagiarism/Citation Checker
              </button>
            </section>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap gap-3">
          <button className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Save as Draft
          </button>
          <button className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Submit for Review
          </button>
          <button
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{ background: '#1a7a5e' }}
          >
            📅 Schedule Post
          </button>
          <button
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{ background: '#0f766e' }}
          >
            Review &amp; Approve Adapted Content
          </button>
        </div>
      </div>

      {/* Right trends panel */}
      <TrendsPanel />
    </div>
  );
}
