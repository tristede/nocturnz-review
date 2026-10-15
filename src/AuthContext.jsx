import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, signInWithGoogle, signOutUser } from './firebase';

const Ctx = createContext({ user: null, ready: false });

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, ready: false });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, ready: true })), []);
  return <Ctx.Provider value={{ ...state, signIn: signInWithGoogle, signOut: signOutUser }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
