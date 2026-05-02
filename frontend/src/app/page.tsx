import Link from 'next/link';

const DIAMOND_PATTERN_URI =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'><g fill='none' stroke='rgba(255,255,255,0.06)' stroke-width='1'><path d='M80 0 L160 80 L80 160 L0 80 Z'/><path d='M80 30 L130 80 L80 130 L30 80 Z'/><path d='M80 60 L100 80 L80 100 L60 80 Z'/></g></svg>\")";

export default function Home() {
  return (
    <div style={{ fontFamily: '"Manrope", "Segoe UI", "Helvetica Neue", Arial, sans-serif', background: '#f0f4f2', minHeight: '100vh' }}>

      {/* ── Sticky Navbar ── */}
      <nav style={{ background: '#14302a', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
          <span style={{ color: '#ffffff', fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>
            Flowrite
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <Link href="/login" style={{ color: '#d8f3ef', fontWeight: 500, fontSize: '0.9rem', textDecoration: 'none' }}>
              Sign In
            </Link>
            <Link href="/register" style={{ background: '#0f766e', color: '#ffffff', fontWeight: 600, fontSize: '0.9rem', padding: '0.5rem 1.25rem', borderRadius: '8px', textDecoration: 'none' }}>
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero (with diamond pattern) ── */}
      <section style={{
        background: `${DIAMOND_PATTERN_URI}, linear-gradient(160deg, #0f2a25 0%, #14302a 50%, #0d2622 100%)`,
        backgroundSize: '160px 160px, 100% 100%',
        padding: '5rem 1.5rem 4rem',
        position: 'relative',
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <span style={{ display: 'inline-block', background: 'rgba(216,243,239,0.12)', color: '#a7d8d0', fontSize: '0.75rem', fontWeight: 700, padding: '0.4rem 1.1rem', borderRadius: '999px', letterSpacing: '0.12em', marginBottom: '1.75rem', border: '1px solid rgba(167,216,208,0.3)', textTransform: 'uppercase' }}>
            AI-Powered Content Platform
          </span>
          <h1 style={{ color: '#ffffff', fontSize: 'clamp(2.25rem, 5.5vw, 3.75rem)', fontWeight: 800, lineHeight: 1.12, letterSpacing: '-0.03em', marginBottom: '1.25rem', fontFamily: '"Playfair Display", "Manrope", serif' }}>
            Turn Ideas Into Content<br />That&nbsp;Converts
          </h1>
          <p style={{ color: '#b2d8d0', fontSize: '1.05rem', lineHeight: 1.7, maxWidth: '620px', margin: '0 auto 2.25rem' }}>
            From brainstorm to published post — Flowrite uses AI to generate campaign ideas, craft platform-specific angles, and schedule your content across LinkedIn, X, Medium, and more.
          </p>
          <div style={{ display: 'flex', gap: '0.85rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={{ background: '#ffffff', color: '#10233d', fontWeight: 700, fontSize: '0.95rem', padding: '0.8rem 1.75rem', borderRadius: '10px', textDecoration: 'none', boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}>
              Start Free Trial
            </Link>
            <Link href="/dashboard" style={{ background: 'transparent', color: '#ffffff', fontWeight: 600, fontSize: '0.95rem', padding: '0.8rem 1.75rem', borderRadius: '10px', textDecoration: 'none', border: '1.5px solid rgba(255,255,255,0.5)' }}>
              View Demo
            </Link>
          </div>
        </div>

        {/* ── Three preview cards ── */}
        <div style={{ maxWidth: '1100px', margin: '3.5rem auto 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', position: 'relative', zIndex: 1 }}>

          {/* Card 1: AI-Generated Content */}
          <div style={{ background: 'linear-gradient(165deg, #b8e6d6 0%, #7dc9b0 100%)', borderRadius: '20px', padding: '1.5rem', minHeight: '290px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}>
            <div style={{ background: 'rgba(255,255,255,0.6)', color: '#0d4c3e', fontWeight: 700, fontSize: '0.75rem', padding: '0.35rem 0.85rem', borderRadius: '999px', alignSelf: 'flex-start', letterSpacing: '0.02em' }}>
              AI-Generated Content
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#0d4c3e', letterSpacing: '-0.02em', lineHeight: 1 }}>10x</div>
                <div style={{ fontSize: '0.85rem', color: '#0d4c3e', fontWeight: 500 }}>Faster</div>
              </div>
              {/* Lightbulb + scribble illustration */}
              <svg width="110" height="70" viewBox="0 0 110 70" fill="none">
                <path d="M5 50 Q15 20 30 35 T55 30 Q70 20 80 40" stroke="#0d4c3e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                <path d="M10 55 Q25 45 40 55 T65 50" stroke="#0d4c3e" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.5" />
                <circle cx="92" cy="22" r="10" stroke="#0d4c3e" strokeWidth="1.8" fill="#fff7c2" />
                <path d="M88 30 L88 36 M96 30 L96 36 M86 38 L98 38" stroke="#0d4c3e" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M92 8 L92 4 M82 12 L78 9 M102 12 L106 9" stroke="#0d4c3e" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', borderTop: '1px solid rgba(13,76,62,0.15)', paddingTop: '1rem' }}>
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0d4c3e', letterSpacing: '-0.02em', lineHeight: 1 }}>3000+</div>
                <div style={{ fontSize: '0.8rem', color: '#0d4c3e', fontWeight: 500 }}>words in minutes</div>
              </div>
              {/* Mini chart */}
              <svg width="110" height="44" viewBox="0 0 110 44" fill="none">
                <rect x="0" y="0" width="110" height="44" rx="6" fill="rgba(255,255,255,0.7)" />
                <polyline points="6,34 22,28 38,30 56,18 74,22 92,10 104,14" stroke="#0d4c3e" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="6,34 22,28 38,30 56,18 74,22 92,10 104,14 104,40 6,40" stroke="none" fill="rgba(13,76,62,0.15)" />
              </svg>
            </div>
          </div>

          {/* Card 2: Multichannel Reach */}
          <div style={{ background: 'linear-gradient(165deg, #b8e6d6 0%, #7dc9b0 100%)', borderRadius: '20px', padding: '1.5rem', minHeight: '290px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}>
            <div style={{ background: 'rgba(255,255,255,0.6)', color: '#0d4c3e', fontWeight: 700, fontSize: '0.75rem', padding: '0.35rem 0.85rem', borderRadius: '999px', alignSelf: 'flex-start' }}>
              Multichannel Reach
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#0d4c3e', letterSpacing: '-0.02em', lineHeight: 1 }}>5+</div>
                <div style={{ fontSize: '0.85rem', color: '#0d4c3e', fontWeight: 500 }}>Channels</div>
              </div>
              {/* Hub-spoke channel diagram */}
              <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
                {/* Lines from center to icons */}
                <line x1="70" y1="60" x2="30" y2="20" stroke="#0d4c3e" strokeWidth="1" opacity="0.5" />
                <line x1="70" y1="60" x2="110" y2="20" stroke="#0d4c3e" strokeWidth="1" opacity="0.5" />
                <line x1="70" y1="60" x2="20" y2="60" stroke="#0d4c3e" strokeWidth="1" opacity="0.5" />
                <line x1="70" y1="60" x2="120" y2="60" stroke="#0d4c3e" strokeWidth="1" opacity="0.5" />
                <line x1="70" y1="60" x2="30" y2="100" stroke="#0d4c3e" strokeWidth="1" opacity="0.5" />
                <line x1="70" y1="60" x2="110" y2="100" stroke="#0d4c3e" strokeWidth="1" opacity="0.5" />
                {/* Center dot */}
                <circle cx="70" cy="60" r="14" fill="#ffffff" stroke="#0d4c3e" strokeWidth="1.5" />
                <circle cx="70" cy="60" r="5" fill="#0d4c3e" />
                {/* Channel circles */}
                <circle cx="30" cy="20" r="13" fill="#1da1f2" />
                <text x="30" y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Arial">f</text>
                <circle cx="110" cy="20" r="13" fill="#0a66c2" />
                <text x="110" y="24" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="Arial">in</text>
                <circle cx="20" cy="60" r="13" fill="#ff6b35" />
                <circle cx="20" cy="60" r="4" fill="#fff" />
                <circle cx="120" cy="60" r="13" fill="#000" />
                <text x="120" y="64" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Arial">𝕏</text>
                <circle cx="30" cy="100" r="13" fill="#000" />
                <text x="30" y="104" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Georgia">M</text>
                <circle cx="110" cy="100" r="13" fill="#25d366" />
                <text x="110" y="104" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Arial">w</text>
              </svg>
            </div>
            <div style={{ borderTop: '1px solid rgba(13,76,62,0.15)', paddingTop: '1rem' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0d4c3e', letterSpacing: '-0.02em', lineHeight: 1 }}>5+</div>
              <div style={{ fontSize: '0.8rem', color: '#0d4c3e', fontWeight: 500 }}>Platform Optimized</div>
            </div>
          </div>

          {/* Card 3: Real-Time Performance */}
          <div style={{ background: 'linear-gradient(165deg, #1d6e6e 0%, #155f5f 100%)', borderRadius: '20px', padding: '1.5rem', minHeight: '290px', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 12px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ background: 'rgba(255,255,255,0.18)', color: '#ffffff', fontWeight: 700, fontSize: '0.75rem', padding: '0.35rem 0.85rem', borderRadius: '999px', alignSelf: 'flex-start' }}>
              Real-Time Performance
            </div>
            {/* Mock dashboard chart */}
            <div style={{ background: '#ffffff', borderRadius: '10px', padding: '0.65rem 0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#10233d' }}>Dashboard</span>
                <span style={{ fontSize: '0.55rem', color: '#9aa5b8' }}>Dashboard ▾</span>
              </div>
              <svg width="100%" height="60" viewBox="0 0 220 60" preserveAspectRatio="none">
                <polyline points="0,50 30,42 60,46 90,30 120,34 150,20 180,24 220,8" stroke="#1da1a1" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="0,50 30,42 60,46 90,30 120,34 150,20 180,24 220,8 220,60 0,60" stroke="none" fill="rgba(29,161,161,0.18)" />
              </svg>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              {/* Traffic sources box */}
              <div style={{ background: '#ffffff', borderRadius: '8px', padding: '0.55rem 0.7rem', flex: 1, fontSize: '0.6rem', color: '#10233d' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>Traffic sources</div>
                {[
                  { l: 'Google', c: '#4285f4' },
                  { l: 'Social', c: '#0f766e' },
                  { l: 'Medium', c: '#f4b400' },
                  { l: 'Traffic', c: '#db4437' },
                  { l: 'Other...', c: '#9aa5b8' },
                ].map((s) => (
                  <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'space-between', marginBottom: '0.1rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ width: '6px', height: '6px', background: s.c, borderRadius: '2px', display: 'inline-block' }} />
                      {s.l}
                    </span>
                    <span style={{ width: '24px', height: '2px', background: '#e3e8ee', borderRadius: '2px' }} />
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: '#7ddcd2', fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em', lineHeight: 1 }}>
                  <span>↑</span>
                  <span>+215%</span>
                </div>
                <div style={{ color: '#b2d8d0', fontSize: '0.75rem', fontWeight: 500 }}>Conversion Rate</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature cards ── */}
      <section style={{ background: '#f4f6f8', padding: '5rem 1.5rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2 style={{ color: '#10233d', fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.75rem', fontFamily: '"Playfair Display", "Manrope", serif' }}>
              Everything your content team needs
            </h2>
            <p style={{ color: '#607086', fontSize: '1rem', maxWidth: '520px', margin: '0 auto' }}>
              One workspace to ideate, write, adapt, and publish — powered by AI at every step.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
            {[
              {
                bg: '#fff4cf',
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" stroke="#b07f00" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="M9 19h6M10 21h4" stroke="#b07f00" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                ),
                title: 'Campaign Ideas',
                desc: 'Brainstorm and AI-score content ideas against your brand goals. Surface what will actually resonate.',
              },
              {
                bg: '#fde2ec',
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="#c2185b" strokeWidth="1.6" />
                    <circle cx="12" cy="12" r="5" stroke="#c2185b" strokeWidth="1.6" />
                    <circle cx="12" cy="12" r="1.6" fill="#c2185b" />
                  </svg>
                ),
                title: 'AI-Powered Angles',
                desc: 'Generate multiple creative angles for each idea — emotional, data-driven, contrarian, and more.',
              },
              {
                bg: '#d8f3ef',
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="3" width="14" height="18" rx="2" stroke="#0f766e" strokeWidth="1.6" />
                    <path d="M8 8h8M8 12h8M8 16h5" stroke="#0f766e" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                ),
                title: 'Multi-platform Adapt',
                desc: 'Instantly reformat your draft for LinkedIn, X/Twitter, Medium, or a long-form blog post.',
              },
              {
                bg: '#dde7f5',
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M4 20V8M10 20V4M16 20v-9M22 20H2" stroke="#1e3a8a" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                ),
                title: 'Analytics & Scheduling',
                desc: 'Track post performance and schedule content at optimal times across every connected channel.',
              },
            ].map((f) => (
              <div key={f.title} style={{ background: '#ffffff', borderRadius: '14px', padding: '1.6rem', boxShadow: '0 1px 4px rgba(16,35,61,0.06)', border: '1px solid #eef2f6', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <span style={{ width: '44px', height: '44px', background: f.bg, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {f.icon}
                </span>
                <h3 style={{ color: '#10233d', fontWeight: 700, fontSize: '1.05rem', margin: 0 }}>{f.title}</h3>
                <p style={{ color: '#607086', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow steps ── */}
      <section style={{ background: '#ffffff', padding: '5rem 1.5rem' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2 style={{ color: '#10233d', fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.75rem', fontFamily: '"Playfair Display", "Manrope", serif' }}>
              Your content workflow, simplified
            </h2>
            <p style={{ color: '#607086', fontSize: '1rem' }}>Four steps from idea to published post.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0' }}>
            {[
              { step: '1', label: 'Ideas', desc: 'Generate and score campaign ideas with AI.' },
              { step: '2', label: 'Angles', desc: 'Pick the best angle for your audience.' },
              { step: '3', label: 'Draft & Adapt', desc: 'Write once, adapt for every platform.' },
              { step: '4', label: 'Publish', desc: 'Schedule and publish to all channels.' },
            ].map((s, i, arr) => (
              <div key={s.step} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', padding: '0 0.75rem', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: '40px', height: '40px', background: '#d8f3ef', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#0f766e', fontSize: '0.95rem', flexShrink: 0, border: '1.5px solid #7dc9b0' }}>
                    {s.step}
                  </div>
                  {i < arr.length - 1 && (
                    <svg width="100%" height="14" viewBox="0 0 100 14" preserveAspectRatio="none" style={{ flex: 1, minWidth: '20px' }}>
                      <line x1="0" y1="7" x2="92" y2="7" stroke="#7dc9b0" strokeWidth="1.5" strokeDasharray="0" />
                      <polyline points="86,2 94,7 86,12" stroke="#7dc9b0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <h4 style={{ color: '#10233d', fontWeight: 700, fontSize: '1rem', margin: 0 }}>{s.label}</h4>
                <p style={{ color: '#607086', fontSize: '0.875rem', lineHeight: 1.55, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section style={{
        background: `${DIAMOND_PATTERN_URI}, linear-gradient(120deg, #14302a 0%, #0f5750 100%)`,
        backgroundSize: '160px 160px, 100% 100%',
        padding: '4.5rem 1.5rem',
        textAlign: 'center',
        position: 'relative',
      }}>
        <div style={{ maxWidth: '700px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <h2 style={{ color: '#ffffff', fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '1.5rem', fontFamily: '"Playfair Display", "Manrope", serif', display: 'inline-flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            Ready to transform your content workflow?
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
              <path d="M16 2 L19 13 L30 16 L19 19 L16 30 L13 19 L2 16 L13 13 Z" fill="#a7d8d0" />
            </svg>
          </h2>
          <Link href="/register" style={{ display: 'inline-block', background: '#ffffff', color: '#0f766e', fontWeight: 700, fontSize: '1rem', padding: '0.875rem 2.25rem', borderRadius: '10px', textDecoration: 'none', boxShadow: '0 4px 14px rgba(0,0,0,0.2)' }}>
            Get Started For Free
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: '#14302a', padding: '2.5rem 1.5rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', textAlign: 'center' }}>
          <span style={{ color: '#ffffff', fontWeight: 800, fontSize: '1.1rem' }}>Flowrite</span>
          <p style={{ color: '#607086', fontSize: '0.85rem', margin: 0 }}>
            © {new Date().getFullYear()} Flowrite. All rights reserved.
          </p>
        </div>
      </footer>

    </div>
  );
}
