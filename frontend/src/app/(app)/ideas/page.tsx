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
