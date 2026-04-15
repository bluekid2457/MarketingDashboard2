import Link from 'next/link';

const stats = [
  { label: 'Ideas Generated', value: '0', icon: '💡' },
  { label: 'Drafts in Progress', value: '0', icon: '✏️' },
  { label: 'Posts Published', value: '0', icon: '🚀' },
  { label: 'Total Reach', value: '0', icon: '📊' },
];

const navLinks = [
  { href: '/', label: 'Dashboard' },
  { href: '/ideas', label: 'Ideas' },
  { href: '/drafts', label: 'Drafts' },
  { href: '/publish', label: 'Publish' },
];

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header / Nav */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <span className="text-xl font-bold text-indigo-600 tracking-tight">
              Marketing Dashboard
            </span>
            <nav className="flex items-center gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-600 to-purple-700 text-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 tracking-tight">
            Welcome to Your Marketing Dashboard
          </h1>
          <p className="text-lg sm:text-xl text-indigo-100 max-w-2xl mx-auto">
            Generate ideas, craft compelling drafts, and publish across multiple channels — all
            powered by AI.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/ideas"
              className="bg-white text-indigo-600 font-semibold px-6 py-3 rounded-lg hover:bg-indigo-50 transition-colors shadow"
            >
              Generate Ideas
            </Link>
            <Link
              href="/drafts"
              className="border border-white text-white font-semibold px-6 py-3 rounded-lg hover:bg-white/10 transition-colors"
            >
              View Drafts
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-start gap-2 hover:shadow-md transition-shadow"
            >
              <span className="text-3xl">{stat.icon}</span>
              <p className="text-4xl font-extrabold text-indigo-600">{stat.value}</p>
              <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <Link
              href="/ideas"
              className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 hover:bg-indigo-100 transition-colors group"
            >
              <p className="text-2xl mb-2">💡</p>
              <h3 className="font-semibold text-gray-800 group-hover:text-indigo-700">
                New Idea
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Let AI brainstorm your next content piece
              </p>
            </Link>
            <Link
              href="/drafts"
              className="bg-purple-50 border border-purple-100 rounded-xl p-6 hover:bg-purple-100 transition-colors group"
            >
              <p className="text-2xl mb-2">✏️</p>
              <h3 className="font-semibold text-gray-800 group-hover:text-purple-700">
                New Draft
              </h3>
              <p className="text-sm text-gray-500 mt-1">Start writing or continue a saved draft</p>
            </Link>
            <Link
              href="/publish"
              className="bg-green-50 border border-green-100 rounded-xl p-6 hover:bg-green-100 transition-colors group"
            >
              <p className="text-2xl mb-2">🚀</p>
              <h3 className="font-semibold text-gray-800 group-hover:text-green-700">Publish</h3>
              <p className="text-sm text-gray-500 mt-1">
                Schedule and publish to multiple channels
              </p>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-6 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} Marketing Dashboard. All rights reserved.
      </footer>
    </div>
  );
}
