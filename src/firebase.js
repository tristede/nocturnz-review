import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// `npm run dev:emu` : tout tourne sur les émulateurs locaux, rien ne touche la production
export const usingEmulators = !!import.meta.env.VITE_EMULATORS;
if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  // test uniquement : connexion « Google » simulée sans fenêtre (le panneau intégré bloque les fenêtres de connexion)
  window.__devSignIn = (email) =>
    signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));
}

export const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const signOutUser = () => signOut(auth);
