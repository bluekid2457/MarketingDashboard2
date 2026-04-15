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
