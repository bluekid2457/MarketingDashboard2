export default async function AdaptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Multi-Channel Adaptation — {id}</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Platform Selector</h2>
        <div className="flex gap-3 flex-wrap">
          {['LinkedIn', 'Twitter/X', 'Medium', 'Newsletter', 'Instagram'].map((platform) => (
            <button
              key={platform}
              className="border border-gray-300 rounded-full px-4 py-1 text-sm text-gray-600 hover:bg-indigo-50 hover:border-indigo-400"
            >
              {platform}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Preview Per Format</h2>
        <p className="text-gray-400 text-sm">Platform-specific content previews will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">AI Chat for Editing</h2>
        <p className="text-gray-400 text-sm">AI-powered chat interface for content adjustments will appear here.</p>
      </section>
    </div>
  );
}
