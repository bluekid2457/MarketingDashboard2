import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth';

import { getFirebaseAuth, getFirebaseDb } from './firebase';

const FIRESTORE_BATCH_LIMIT = 400;
const USER_FLAT_SUBCOLLECTIONS = ['drafts', 'adaptations', 'scheduledPosts', 'integrationConnections'] as const;

export class ReauthRequiredError extends Error {
  readonly providerId: string | null;

  constructor(providerId: string | null) {
    super('This action requires recent sign-in. Please re-authenticate.');
    this.name = 'ReauthRequiredError';
    this.providerId = providerId;
  }
}

async function deleteDocsInBatches(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_LIMIT) {
    const slice = refs.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch: WriteBatch = writeBatch(db);
    slice.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function deleteFlatSubcollection(
  db: Firestore,
  uid: string,
  subcollection: string,
): Promise<void> {
  const colRef = collection(db, 'users', uid, subcollection) as CollectionReference;
  const snap = await getDocs(colRef);
  await deleteDocsInBatches(db, snap.docs.map((d) => d.ref));
}

async function deleteIdeasWithWorkflow(db: Firestore, uid: string): Promise<void> {
  const ideasRef = collection(db, 'users', uid, 'ideas');
  const ideasSnap = await getDocs(ideasRef);
  // The only known nested doc is users/{uid}/ideas/{ideaId}/workflow/angles
  // (per specs/database.md). Delete it for every idea before deleting the
  // parent — workflow/angles is a fixed-id doc so we can target it directly.
  const anglesRefs = ideasSnap.docs.map((d) =>
    doc(db, 'users', uid, 'ideas', d.id, 'workflow', 'angles'),
  );
  // deleteDoc on a missing document is a no-op, so this is idempotent even
  // when an idea has no angles workflow yet.
  for (let i = 0; i < anglesRefs.length; i += FIRESTORE_BATCH_LIMIT) {
    const slice = anglesRefs.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = writeBatch(db);
    slice.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  await deleteDocsInBatches(db, ideasSnap.docs.map((d) => d.ref));
}

async function deleteIntegrationSecretsForUser(db: Firestore, uid: string): Promise<void> {
  // Backend writes secrets to integrationSecrets/{uid}__{provider}. We discover
  // which providers the user has connected by reading integrationConnections,
  // then issue a delete per matching secret key. The Firestore rule on
  // integrationSecrets only permits delete when the doc id is prefixed by
  // request.auth.uid + "__", so this is the safe, scoped path.
  const connectionsRef = collection(db, 'users', uid, 'integrationConnections');
  const snap = await getDocs(connectionsRef);
  const refs = snap.docs.map((connDoc) =>
    doc(db, 'integrationSecrets', `${uid}__${connDoc.id}`),
  );
  for (const ref of refs) {
    try {
      await deleteDoc(ref);
    } catch {
      // If the secret never existed (e.g. connection was disconnected and
      // tokens already wiped), the delete will fail. Treat as success — the
      // outcome is the same.
    }
  }
}

async function deleteIntegrationAuthStatesForUser(db: Firestore, uid: string): Promise<void> {
  const statesRef = collection(db, 'integrationAuthStates');
  let snap;
  try {
    snap = await getDocs(query(statesRef, where('userId', '==', uid)));
  } catch {
    // Best-effort: if rules deny the list, skip. These are short-lived OAuth
    // CSRF state docs containing a SHA-256 of the state token, the userId,
    // and timestamps — no PII.
    return;
  }
  await deleteDocsInBatches(db, snap.docs.map((d) => d.ref));
}

function pickProviderId(user: User): string | null {
  return user.providerData[0]?.providerId ?? null;
}

export async function reauthenticateCurrentUser(password?: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error('Firebase is not configured.');
  const user = auth.currentUser;
  if (!user) throw new Error('No signed-in user.');

  const providerId = pickProviderId(user);
  if (providerId === 'password') {
    if (!password) throw new Error('Password is required to re-authenticate.');
    if (!user.email) throw new Error('No email on the current account.');
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    return;
  }
  if (providerId === 'google.com') {
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
    return;
  }
  throw new Error(
    `Re-authentication is not yet supported for ${providerId ?? 'this provider'}. ` +
      'Sign out and sign back in, then try again.',
  );
}

export async function deleteAccount(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error('Firebase is not configured.');
  const db = getFirebaseDb();
  if (!db) throw new Error('Firestore is not configured.');
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before deleting your account.');
  const uid = user.uid;

  // 1. Subcollections under users/{uid}/** that the user can already write to.
  await deleteIdeasWithWorkflow(db, uid);
  for (const sub of USER_FLAT_SUBCOLLECTIONS) {
    await deleteFlatSubcollection(db, uid, sub);
  }

  // 2. Backend-only collections that the relaxed rules now let the user
  //    delete (but never read or write) just for self-cleanup.
  await deleteIntegrationSecretsForUser(db, uid);
  await deleteIntegrationAuthStatesForUser(db, uid);

  // 3. The users/{uid} root document.
  await deleteDoc(doc(db, 'users', uid));

  // 4. Finally, delete the Firebase Auth user. If their last sign-in is too
  //    old, Firebase requires a fresh credential — surface that distinctly so
  //    the modal can prompt for re-auth and retry.
  try {
    await user.delete();
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    if (code === 'auth/requires-recent-login') {
      throw new ReauthRequiredError(pickProviderId(user));
    }
    throw err instanceof Error ? err : new Error('Failed to delete the account user record.');
  }
}
