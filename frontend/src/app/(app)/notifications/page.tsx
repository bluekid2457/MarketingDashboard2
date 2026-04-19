export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 12</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Error and Notifications</h1>
      </section>

      <section className="surface-card border-red-200 bg-red-50 p-6">
        <h2 className="section-title">Error Messages</h2>
        <p className="mt-2 text-sm text-red-800">LinkedIn token expired. Reconnect account to resume scheduled publishing.</p>
      </section>

      <section className="surface-card border-amber-200 bg-amber-50 p-6">
        <h2 className="section-title">Success / Warning Notifications</h2>
        <p className="mt-2 text-sm text-amber-900">3 drafts approved. 1 publish window has low engagement forecast.</p>
      </section>

      <section className="surface-card p-6">
        <h2 className="section-title">System Alerts</h2>
        <p className="mt-2 muted-copy">Scheduled maintenance window: Sunday 02:00 UTC for analytics index refresh.</p>
      </section>
    </div>
  );
}
