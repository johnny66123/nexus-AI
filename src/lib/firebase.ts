import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const firebaseDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const firebaseAuth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

// Configure persistent Firebase Auth storage (with safe fallback in strict iframe contexts)
void setPersistence(firebaseAuth, browserLocalPersistence).catch(() =>
  setPersistence(firebaseAuth, inMemoryPersistence).catch(() => undefined),
);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo:
        firebaseAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(firebaseDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export function formatFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code === 'auth/popup-blocked') {
    return 'Google sign-in popup was blocked by your browser. Allow popups for this site or use Email & Password below.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in was cancelled before completing.';
  }
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Domain "${host}" is not authorized in Firebase Console > Authentication > Settings > Authorized domains. Add it or sign in with Email & Password below.`;
  }
  return err instanceof Error ? err.message : 'Google sign-in failed.';
}

export async function signInWithGooglePopup(): Promise<string> {
  try {
    const credential = await signInWithPopup(firebaseAuth, googleAuthProvider);
    return await credential.user.getIdToken();
  } catch (err) {
    throw new Error(formatFirebaseAuthError(err));
  }
}

export async function getCurrentFirebaseIdToken(): Promise<string | null> {
  if (!firebaseAuth.currentUser) return null;
  try {
    return await firebaseAuth.currentUser.getIdToken();
  } catch {
    return null;
  }
}

export function subscribeToFirebaseAuth(
  callback: (user: FirebaseUser | null) => void,
): () => void {
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function signOutFirebase(): Promise<void> {
  await signOut(firebaseAuth).catch(() => {});
}
