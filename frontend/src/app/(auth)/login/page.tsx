'use client';

import { FormEvent, useEffect, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { trackAuthEvent } from '@/lib/analytics';
import { getFirebaseAuth } from '@/lib/firebase';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns null for silent cancellations (popup closed), string for genuine errors. */
function getAuthErrorMessage(error: unknown): string | null {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Invalid email or password. Please try again.';
      case 'auth/invalid-email':
        return 'The email address is not valid.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Please contact support.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Please wait a moment and try again.';
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.';
      case 'auth/popup-blocked':
        return 'Pop-up was blocked by your browser. Please allow pop-ups and try again.';
      case 'auth/operation-not-allowed':
        return 'This sign-in provider is not enabled for the Firebase project.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorized in Firebase Authentication settings.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return null;
      default:
        return 'Unable to sign in right now. Please try again in a moment.';
    }
  }
  return 'Unable to sign in right now. Please try again in a moment.';
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'linkedin' | null>(null);

  useEffect(() => {
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      setErrorMessage(
        'Authentication is not configured. Add NEXT_PUBLIC_FIREBASE_* environment values.',
      );
      setIsCheckingAuth(false);
      return;
    }

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

    setIsSubmitting(true);
    setErrorMessage(null);
    trackAuthEvent('login_attempt', { method: 'email_password' });

    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      setErrorMessage(
        'Authentication is not configured. Add NEXT_PUBLIC_FIREBASE_* environment values.',
      );
      trackAuthEvent('login_failure', { method: 'email_password' });
      setIsSubmitting(false);
      return;
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      trackAuthEvent('login_success', { method: 'email_password' });
      router.replace('/dashboard');
    } catch (error) {
      const message = getAuthErrorMessage(error);
      if (message) setErrorMessage(message);
      trackAuthEvent('login_failure', { method: 'email_password' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    if (socialLoading) return;
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      setErrorMessage(
        'Authentication is not configured. Add NEXT_PUBLIC_FIREBASE_* environment values.',
      );
      return;
    }
    setSocialLoading('google');
    setErrorMessage(null);
    trackAuthEvent('login_attempt', { method: 'google' });
    try {
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
      trackAuthEvent('login_success', { method: 'google' });
      router.replace('/dashboard');
    } catch (error) {
      const message = getAuthErrorMessage(error);
      if (message) setErrorMessage(message);
      trackAuthEvent('login_failure', { method: 'google' });
    } finally {
      setSocialLoading(null);
    }
  }

  async function handleLinkedInSignIn() {
    if (socialLoading) return;
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      setErrorMessage(
        'Authentication is not configured. Add NEXT_PUBLIC_FIREBASE_* environment values.',
      );
      return;
    }

    setSocialLoading('linkedin');
    setErrorMessage(null);
    trackAuthEvent('login_attempt', { method: 'linkedin' });
    try {
      const provider = new OAuthProvider('linkedin.com');
      await signInWithPopup(firebaseAuth, provider);
      trackAuthEvent('login_success', { method: 'linkedin' });
      router.replace('/dashboard');
    } catch (error) {
      const message = getAuthErrorMessage(error);
      if (message) setErrorMessage(message);
      trackAuthEvent('login_failure', { method: 'linkedin' });
    } finally {
      setSocialLoading(null);
    }
  }

  const isAnythingLoading = isSubmitting || socialLoading !== null;

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
            Welcome to your Hub!
          </p>
          <p className="mt-4 text-lg font-bold leading-snug">Sign in to amplify your reach.</p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed" style={{ color: '#a7c9be' }}>
            Access unified performance insights and campaign tools.
          </p>
        </section>

        {/* Right form panel */}
        <section className="bg-white px-8 py-10 sm:px-12" aria-label="Authentication form">
          {errorMessage ? (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="text-base">✕</span>
              <span>{errorMessage}</span>
              <button
                type="button"
                className="ml-auto text-red-400 hover:text-red-600"
                onClick={() => setErrorMessage(null)}
                aria-label="Dismiss sign in error"
              >
                ✕
              </button>
            </div>
          ) : null}

          <h2 className="text-2xl font-extrabold text-slate-900">Marketing Dashboard</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>

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
                disabled={isAnythingLoading}
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500">
              <span className="text-slate-400">🔒</span>
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isAnythingLoading}
              />
            </div>
            <div className="text-right">
              <a href="#" className="text-sm font-medium text-slate-500 hover:underline">
                Forgot Password?
              </a>
            </div>
            <button
              type="submit"
              disabled={isAnythingLoading}
              className="w-full rounded-xl py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: '#1a7a5e' }}
            >
              {isSubmitting ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <span className="flex-1 border-t border-slate-200" />
            or sign in with
            <span className="flex-1 border-t border-slate-200" />
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleLinkedInSignIn}
              disabled={isAnythingLoading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded bg-blue-700 text-[10px] font-bold text-white">
                in
              </span>
              {socialLoading === 'linkedin' ? 'Signing in...' : 'Sign in with LinkedIn'}
            </button>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isAnythingLoading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-bold text-red-500">
                G
              </span>
              {socialLoading === 'google' ? 'Signing in...' : 'Sign in with Google'}
            </button>
          </div>

          <p className="mt-6 text-center text-sm text-slate-500">
            {"Don't have an account? "}
            <Link href="/register" className="font-semibold text-emerald-700 hover:underline">
              Register now
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
