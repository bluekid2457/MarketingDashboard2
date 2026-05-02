'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import packageJson from '../../package.json';
import { PIPELINE_STEPS } from '@/lib/pipeline';

const appVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';

type SidebarLink = {
  href: string;
  label: string;
  icon: string;
};

const dashboardLink: SidebarLink = { href: '/dashboard', label: 'Dashboard', icon: '⊞' };

const pipelineIcons: Record<string, string> = {
  ideas: '◈',
  angles: '≡',
  storyboard: '▦',
  adapt: '⇄',
  review: '✓',
  publish: '↗',
};

const pipelineLinks: SidebarLink[] = PIPELINE_STEPS.map((step) => ({
  href: step.path,
  label: step.label,
  icon: pipelineIcons[step.key] ?? '·',
}));

const moreLinks: SidebarLink[] = [
  { href: '/analytics', label: 'Analytics', icon: '↗' },
  { href: '/collaboration', label: 'Collaboration', icon: '⊙' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
  { href: '/notifications', label: 'Notifications', icon: '🔔' },
];

const allLinks: SidebarLink[] = [dashboardLink, ...pipelineLinks, ...moreLinks];

export default function Nav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    const base = href.replace('/new', '');
    return pathname === href || (base !== '/' && pathname.startsWith(base));
  };

  const renderLink = ({ href, label, icon }: SidebarLink, weight: 'semibold' | 'medium' = 'semibold') => (
    <li key={href}>
      <Link
        href={href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-${weight} transition-all ${
          isActive(href)
            ? 'bg-[#1d4a3e] text-white'
            : 'text-[#a7c9be] hover:bg-[#1d4a3e]/60 hover:text-white'
        }`}
      >
        <span className="w-4 text-center text-base">{icon}</span>
        {label}
      </Link>
    </li>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 px-4 py-3 shadow-sm lg:hidden" style={{ background: '#14302a' }}>
        <div className="flex items-center justify-between">
          <span className="text-base font-extrabold uppercase tracking-wide text-white">Flowrite</span>
          <Link href="/notifications" className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/80">
            Alerts
          </Link>
        </div>
        <nav className="mt-3 overflow-x-auto pb-1">
          <ul className="flex min-w-max gap-2">
            {allLinks.map(({ href, label }, index) => (
              <li key={`${href}-${index}`}>
                <Link
                  href={href}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    isActive(href)
                      ? 'border-emerald-400 bg-emerald-600 text-white'
                      : 'border-white/20 text-white/70 hover:border-white/40'
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 hidden h-screen w-56 flex-col lg:flex" style={{ background: '#14302a' }}>
        {/* Brand */}
        <div className="px-5 pb-4 pt-6">
          <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-lg">F</div>
          <p className="mt-2 text-xs font-bold uppercase tracking-widest" style={{ color: '#7db8a8' }}>Workspace</p>
          <p className="text-base font-extrabold text-white leading-tight">Flowrite</p>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3">
          <ul className="space-y-0.5">
            {renderLink(dashboardLink)}
          </ul>

          <div className="mt-5 mb-1 px-3">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#4d8a76' }}>Pipeline</p>
          </div>
          <ul className="space-y-0.5">
            {pipelineLinks.map((link) => renderLink(link, 'medium'))}
          </ul>

          <div className="mt-5 mb-1 px-3">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#4d8a76' }}>More</p>
          </div>
          <ul className="space-y-0.5">
            {moreLinks.map((link) => renderLink(link, 'medium'))}
          </ul>
        </nav>

        {/* Bottom status */}
        <div className="border-t px-4 py-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-xs font-semibold text-white">Weekly target</p>
          <p className="mt-0.5 text-xs" style={{ color: '#7db8a8' }}>6 pieces · 12% engagement</p>
          <p className="mt-2 text-[10px] font-medium tracking-wider" style={{ color: '#4d8a76' }}>
            v{appVersion}
          </p>
        </div>
      </aside>
    </>
  );
}
