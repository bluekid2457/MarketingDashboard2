'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';

import Nav from '@/components/Nav';
import { getFirebaseAuth } from '@/lib/firebase';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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

      setIsAuthenticated(true);
      setIsCheckingAuth(false);
    });

    return unsubscribe;
  }, [router]);

  if (isCheckingAuth || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f2] px-4 py-10">
        <p className="text-sm font-semibold text-slate-600">Checking your session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      <Nav />
      <main className="flex-1 px-4 pb-10 pt-20 lg:ml-56 lg:px-8 lg:pt-8">{children}</main>
    </div>
  );
}
