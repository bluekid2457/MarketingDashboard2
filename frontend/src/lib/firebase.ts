import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const hasMissingConfig = Object.values(firebaseConfig).some((value) => !value);
let hasWarnedAboutMissingConfig = false;
let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;

function warnMissingConfigOnce(): void {
  if (process.env.NODE_ENV === 'production' || hasWarnedAboutMissingConfig) {
    return;
  }

  hasWarnedAboutMissingConfig = true;
  console.warn('Missing NEXT_PUBLIC_FIREBASE_* environment variables for Firebase client initialization.');
}

export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === 'undefined') {
    console.debug('[Firebase] getFirebaseApp called on server-side, returning null');
    return null;
  }

  if (appInstance) {
    console.debug('[Firebase] Returning cached Firebase app instance');
    return appInstance;
  }

  if (hasMissingConfig) {
    console.warn('[Firebase] Missing Firebase configuration - cannot initialize app');
    warnMissingConfigOnce();
    return null;
  }

  console.debug('[Firebase] Initializing Firebase app');
  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  console.debug('[Firebase] Firebase app initialized successfully');
  return appInstance;
}

export function getFirebaseAuth(): Auth | null {
  if (authInstance) {
    console.debug('[Firebase] Returning cached Auth instance');
    return authInstance;
  }

  console.debug('[Firebase] Initializing Auth instance');
  const app = getFirebaseApp();
  if (!app) {
    console.warn('[Firebase] Firebase app not available, cannot initialize Auth');
    return null;
  }

  authInstance = getAuth(app);
  console.debug('[Firebase] Auth instance initialized');
  return authInstance;
}

export function getFirebaseDb(): Firestore | null {
  if (firestoreInstance) {
    console.debug('[Firebase] Returning cached Firestore instance');
    return firestoreInstance;
  }

  console.debug('[Firebase] Initializing Firestore instance');
  const app = getFirebaseApp();
  if (!app) {
    console.warn('[Firebase] Firebase app not available, cannot initialize Firestore');
    return null;
  }

  firestoreInstance = getFirestore(app);
  console.debug('[Firebase] Firestore instance initialized');
  return firestoreInstance;
}
