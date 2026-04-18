'use client';

import { FormEvent, useEffect, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { trackAuthEvent } from '@/lib/analytics';
import { getFirebaseAuth } from '@/lib/firebase';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getRegisterErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/email-already-in-use':
        return 'An account with this email already exists. Try signing in.';
      case 'auth/invalid-email':
        return 'The email address is not valid.';
      case 'auth/weak-password':
        return 'Password is too weak. Use at least 6 characters.';
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      default:
        return 'Unable to create account right now. Please try again in a moment.';
    }
  }
  return 'Unable to create account right now. Please try again in a moment.';
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAuthConfigured, setIsAuthConfigured] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      setIsAuthConfigured(false);
      setErrorMessage(
        'Authentication is not configured. Add NEXT_PUBLIC_FIREBASE_* environment values.',
      );
      setIsCheckingAuth(false);
      return;
    }

    setIsAuthConfigured(true);

    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (user) {
        router.replace('/dashboard');
        return;
      }
      setIsCheckingAuth(false);
    });

    return unsubscribe;
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setErrorMessage('Email is required.');
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Password is required.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      setErrorMessage(
        'Authentication is not configured. Add NEXT_PUBLIC_FIREBASE_* environment values.',
      );
      trackAuthEvent('login_failure', { method: 'register_email_password' });
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    trackAuthEvent('login_attempt', { method: 'register_email_password' });

    try {
      await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      trackAuthEvent('login_success', { method: 'register_email_password' });
      router.replace('/dashboard');
    } catch (error) {
      setErrorMessage(getRegisterErrorMessage(error));
      trackAuthEvent('login_failure', { method: 'register_email_password' });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f2] px-4 py-10">
        <p className="text-sm font-semibold text-slate-600">Checking your session...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f0f4f2] px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl shadow-2xl lg:grid-cols-[1fr_1.1fr]">
        {/* Left branding panel */}
        <section
          className="hidden flex-col justify-center p-10 text-white lg:flex"
          style={{ background: 'linear-gradient(160deg, #14302a 0%, #1a4a3a 100%)' }}
        >
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-3xl font-extrabold text-white shadow-lg">
            M
          </div>
          <h1 className="text-3xl font-extrabold leading-tight">Marketing Dashboard</h1>
          <p className="mt-1 text-base font-semibold" style={{ color: '#7db8a8' }}>
            Create your account
          </p>
          <p className="mt-4 text-lg font-bold leading-snug">Start amplifying your reach.</p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed" style={{ color: '#a7c9be' }}>
            Access unified performance insights and campaign tools.
          </p>
        </section>

        {/* Right form panel */}
        <section className="bg-white px-8 py-10 sm:px-12" aria-label="Registration form">
          {errorMessage ? (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="text-base">✕</span>
              <span>{errorMessage}</span>
              <button
                type="button"
                className="ml-auto text-red-400 hover:text-red-600"
                onClick={() => setErrorMessage(null)}
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          ) : null}

          <h2 className="text-2xl font-extrabold text-slate-900">Create Account</h2>
          <p className="mt-1 text-sm text-slate-500">Join Marketing Dashboard</p>

          <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500">
              <span className="text-slate-400">✉</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="Email Address"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500">
              <span className="text-slate-400">🔒</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Password (min. 6 characters)"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500">
              <span className="text-slate-400">🔒</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Confirm Password"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting || !isAuthConfigured}
              className="w-full rounded-xl py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: '#1a7a5e' }}
            >
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-emerald-700 hover:underline">
              Sign in
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
