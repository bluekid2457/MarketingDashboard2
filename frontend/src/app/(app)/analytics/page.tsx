import { PlaceholderCard } from '@/components/PlaceholderCard';

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 9</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Analytics and Performance</h1>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <PlaceholderCard
          title="Engagement Charts"
          description="Likes, comments, and reshare trends per post — not yet wired to a real analytics source."
          previewKind="chart"
        />

        <PlaceholderCard
          title="Performance History"
          description="Timeline of engagement and reach across past campaigns."
          previewKind="chart"
        />

        <PlaceholderCard
          title="Predictive Scoring"
          description="Estimated reach and confidence interval for each draft before you publish."
          previewKind="chart"
        />

        <PlaceholderCard
          title="Copy Intelligence Insights"
          description="Pattern detection across high-performing drafts (hook style, length, structure)."
          previewKind="list"
        />

        <PlaceholderCard
          title="AI Visibility Tracking"
          description="Track mentions and ranking trend across AI answer engines and search assistants."
          previewKind="chart"
          className="lg:col-span-2"
        />
      </div>
    </div>
  );
}
