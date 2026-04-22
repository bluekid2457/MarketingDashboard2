import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Firestore, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let appInstance: FirebaseApp | null = null;
let firestoreInstance: Firestore | null = null;

export function getServerFirebaseDb(): Firestore {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  const missingKey = Object.entries(firebaseConfig).find(([, value]) => !value)?.[0];
  if (missingKey) {
    throw new Error(`Missing Firebase configuration for ${missingKey}.`);
  }

  appInstance = appInstance ?? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig));
  firestoreInstance = getFirestore(appInstance);
  return firestoreInstance;
}
