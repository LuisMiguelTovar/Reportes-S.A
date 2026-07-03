'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from '@/components/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/login');
    }
  }, [session, isLoading, router]);

  // While checking auth, show a loading state
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f9fafb',
      }}>
        <div style={{
          width: 40,
          height: 40,
          border: '4px solid #E0E0E0',
          borderTopColor: '#1A3A9F',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  // If not authenticated, show nothing while redirecting
  if (!session) {
    return null;
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 h-full overflow-y-auto bg-[#F8FAFC] text-slate-800">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
