'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  // Derive display name and initials from user
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuario';
  const initial = displayName.charAt(0).toUpperCase();

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <aside className="w-64 bg-[#0F172A] text-slate-300 flex flex-col h-full flex-shrink-0">
      <div className="px-5 py-5 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Logo HLGAS" className="w-10 h-10 object-contain rounded-xl shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide leading-none">HLGAS</h1>
            <p className="text-xs text-slate-400 mt-1">Gestión Operativa</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <Link 
          href="/" 
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150 ${
            pathname === '/' 
              ? 'bg-[#2563EB] text-white shadow-none' 
              : 'hover:bg-[#172554] text-slate-400 hover:text-slate-100'
          }`}
        >
          <svg className={`w-5 h-5 ${pathname === '/' ? 'opacity-100' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
          Dashboard
        </Link>
        <Link 
          href="/despacho" 
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150 ${
            pathname === '/despacho' 
              ? 'bg-[#2563EB] text-white shadow-none' 
              : 'hover:bg-[#172554] text-slate-400 hover:text-slate-100'
          }`}
        >
          <svg className={`w-5 h-5 ${pathname === '/despacho' ? 'opacity-100' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
          Panel de Despacho
        </Link>
        <Link 
          href="/auditoria" 
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150 ${
            pathname === '/auditoria'
              ? 'bg-[#2563EB] text-white shadow-none' 
              : 'hover:bg-[#172554] text-slate-400 hover:text-slate-100'
          }`}
        >
          <svg className={`w-5 h-5 ${pathname === '/auditoria' ? 'opacity-100' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          Auditoría y Soportes
        </Link>
        <Link 
          href="/trazabilidad" 
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150 whitespace-nowrap ${
            pathname === '/trazabilidad' 
              ? 'bg-[#2563EB] text-white shadow-none' 
              : 'hover:bg-[#172554] text-slate-400 hover:text-slate-100'
          }`}
        >
          <svg className={`w-5 h-5 ${pathname === '/trazabilidad' ? 'opacity-100' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
          Mapa de Recorridos
        </Link>
      </nav>
      <div className="border-t border-slate-800/60 px-3 py-4 space-y-3">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">{initial}</div>
            <div>
              <p className="text-sm font-medium text-white">{displayName}</p>
              <p className="text-xs text-slate-400">Administrador</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-slate-400 cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
        <button 
          onClick={handleLogout}
          className="flex items-center gap-3 px-2 text-slate-400 hover:text-white transition-colors w-full text-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
