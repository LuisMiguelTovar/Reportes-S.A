'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase, isInvalidRefreshTokenError } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  signOut: async () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check initial session
    const initSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error && isInvalidRefreshTokenError(error)) {
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
          setIsLoading(false);
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
            window.location.replace('/login');
          }
          return;
        }
        const currentSession = data?.session ?? null;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
      } catch (err) {
        if (isInvalidRefreshTokenError(err)) {
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
            window.location.replace('/login');
          }
        }
      } finally {
        setIsLoading(false);
      }
    };

    initSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setIsLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
