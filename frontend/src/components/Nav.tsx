'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/ideas', label: 'Ideas', icon: '💡' },
  { href: '/angles', label: 'AI Angles', icon: '🎯' },
  { href: '/drafts/new', label: 'Drafts', icon: '✏️' },
  { href: '/adapt/new', label: 'Adapt', icon: '🔄' },
  { href: '/publish', label: 'Publish', icon: '🚀' },
  { href: '/review', label: 'Review', icon: '✅' },
  { href: '/analytics', label: 'Analytics', icon: '📈' },
  { href: '/collaboration', label: 'Collaboration', icon: '👥' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
  { href: '/notifications', label: 'Notifications', icon: '🔔' },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <aside className="fixed top-0 left-0 h-screen w-64 bg-white border-r border-gray-200 flex flex-col z-50">
      <div className="px-6 py-5 border-b border-gray-200">
        <span className="text-xl font-bold text-indigo-700">Marketing Dashboard</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navLinks.map(({ href, label, icon }) => {
            const base = href.replace('/new', '');
            const isActive = pathname === href || (base !== '/' && pathname.startsWith(base));
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <span className="text-lg">{icon}</span>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
