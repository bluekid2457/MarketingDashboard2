'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, limit, query } from 'firebase/firestore';

import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase';
import { Spinner } from '@/components/Spinner';

export default function StoryboardNewLandingPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [hasStoryboards, setHasStoryboards] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setIsChecking(false);
      setHasStoryboards(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setHasStoryboards(false);
        setIsChecking(false);
        return;
      }

      const db = getFirebaseDb();
      if (!db) {
        setError('Database unavailable.');
        setIsChecking(false);
        return;
      }

      try {
        const probe = query(collection(db, 'users', user.uid, 'drafts'), limit(1));
        const snap = await getDocs(probe);
        if (!snap.empty) {
          router.replace('/storyboard');
          return;
        }
        setHasStoryboards(false);
        setIsChecking(false);
      } catch {
        setError('Unable to check your storyboards right now.');
        setIsChecking(false);
      }
    });

    return unsub;
  }, [router]);

  if (isChecking) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-4">
        <div className="flex justify-center py-12">
          <Spinner size="sm" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (hasStoryboards) {
    // Router is redirecting; render nothing meaningful.
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-800">Storyboard</h1>
        <p className="muted-copy">
          A storyboard is the long-form draft we generate from your selected angle.
        </p>
      </header>

      <section className="surface-card p-6">
        <h2 className="section-title">Start a storyboard</h2>
        <p className="mt-2 text-sm text-slate-500">
          Pick an idea and then choose an angle. Once an angle is selected, we generate a
          storyboard you can edit and adapt for platforms.
        </p>
        <Link
          href="/ideas"
          className="mt-4 inline-flex items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
        >
          Pick an idea {'->'}
        </Link>
      </section>
    </div>
  );
}
