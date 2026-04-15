export default function ReviewPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Review &amp; Approval Workflow</h1>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Draft Queue</h2>
        <p className="text-gray-400 text-sm">Queue of drafts pending review will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Inline Editor</h2>
        <p className="text-gray-400 text-sm">Inline editing interface for reviewers will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Version History</h2>
        <p className="text-gray-400 text-sm">Draft version history and diff viewer will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Approval Chain Controls</h2>
        <p className="text-gray-400 text-sm">Multi-step approval chain management will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Comment / Suggestion Layer</h2>
        <p className="text-gray-400 text-sm">Inline comments and tracked suggestions will appear here.</p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Role-Based Access</h2>
        <p className="text-gray-400 text-sm">Role-based access controls for reviewers and approvers will appear here.</p>
      </section>
    </div>
  );
}
