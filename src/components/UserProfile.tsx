'use client';
import { useEffect, useState } from 'react';
import { supabase, isInvalidRefreshTokenError } from '@/lib/supabase';

export default function UserProfile() {
  const [userName, setUserName] = useState<string>('Miguel (Admin)');
  const [initial, setInitial] = useState<string>('M');

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error && isInvalidRefreshTokenError(error)) {
          await supabase.auth.signOut();
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
            window.location.replace('/login');
          }
          return;
        }
        const session = data?.session;
        if (session?.user) {
          const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Miguel (Admin)';
          setUserName(name);
          setInitial(name.charAt(0).toUpperCase());
        }
      } catch (err) {
        if (isInvalidRefreshTokenError(err)) {
          await supabase.auth.signOut();
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
            window.location.replace('/login');
          }
        }
      }
    };
    fetchUser();
    
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Miguel (Admin)';
        setUserName(name);
        setInitial(name.charAt(0).toUpperCase());
      } else {
        setUserName('Miguel (Admin)');
        setInitial('M');
      }
    });
    
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="flex items-center gap-3 pl-4 border-l border-gray-200 cursor-pointer hover:bg-gray-50 p-1.5 rounded-lg transition-colors">
      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium text-sm shadow-sm">
        {initial}
      </div>
      <div className="hidden md:block text-sm">
        <p className="font-semibold text-gray-700 leading-tight">{userName}</p>
        <p className="text-xs text-gray-500">Admin</p>
      </div>
    </div>
  );
}
