'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

import Nav from '@/components/Nav';
import { Spinner } from '@/components/Spinner';
import { getFirebaseAuth } from '@/lib/firebase';
import { getActiveAIKey } from '@/lib/aiConfig';
import { isSessionExpired, clearSessionMark } from '@/lib/sessionExpiry';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showApiKeyBanner, setShowApiKeyBanner] = useState(false);

  useEffect(() => {
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      setIsAuthenticated(false);
      setIsCheckingAuth(false);
      router.replace('/login');
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) {
        setIsAuthenticated(false);
        setIsCheckingAuth(false);
        router.replace('/login');
        return;
      }

      if (isSessionExpired()) {
        clearSessionMark();
        void signOut(firebaseAuth).finally(() => {
          setIsAuthenticated(false);
          setIsCheckingAuth(false);
          router.replace('/login');
        });
        return;
      }

      setIsAuthenticated(true);
      setIsCheckingAuth(false);
    });

    return unsubscribe;
  }, [router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const { provider, apiKey } = getActiveAIKey();
    const needsKey = provider !== 'ollama' && !apiKey;
    setShowApiKeyBanner(needsKey);
  }, [isAuthenticated, pathname]);

  if (isCheckingAuth || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f2] px-4 py-10">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <Spinner size="sm" />
          <span>Checking your session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      <Nav />
      <div className="flex flex-1 flex-col lg:ml-56">
        {showApiKeyBanner && pathname !== '/settings' && (
          <div className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>No AI API key configured. AI features will not work until you add a key.</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href="/settings"
                className="rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600 transition"
              >
                Go to Settings
              </Link>
              <button
                onClick={() => setShowApiKeyBanner(false)}
                className="text-amber-600 hover:text-amber-800 text-lg leading-none font-bold"
                aria-label="Dismiss"
              >
                &times;
              </button>
            </div>
          </div>
        )}
        <main className="flex-1 px-4 pb-10 pt-[72px] lg:pt-4 lg:px-8">{children}</main>
      </div>
    </div>
  );
}