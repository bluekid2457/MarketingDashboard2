export default async function DraftEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Draft Editor — {id}</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Rich Text Editor</h2>
        <div className="border border-gray-300 rounded-lg p-4 min-h-[200px] text-gray-400 text-sm">
          Rich text editor will appear here.
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Mid-Draft Prompt Bar</h2>
        <p className="text-gray-400 text-sm">AI-assisted mid-draft prompts and suggestions will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Tone / Sentiment Controls</h2>
        <p className="text-gray-400 text-sm">Tone and sentiment adjustment controls will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Readability / SEO Scoring</h2>
        <p className="text-gray-400 text-sm">Readability grade and SEO score indicators will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Persona Targeting</h2>
        <p className="text-gray-400 text-sm">Audience persona targeting settings will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">A/B Headline Generator</h2>
        <p className="text-gray-400 text-sm">AI-generated A/B headline variants will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Plagiarism / Citation Checker</h2>
        <p className="text-gray-400 text-sm">Plagiarism detection and citation suggestions will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Action Buttons</h2>
        <div className="flex gap-3">
          <button className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700">
            Save Draft
          </button>
          <button className="bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-700">
            Submit for Review
          </button>
          <button className="border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50">
            Discard
          </button>
        </div>
      </section>
    </div>
  );
}
