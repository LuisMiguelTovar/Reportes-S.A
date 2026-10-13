'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useArea } from "@/components/AreaProvider";

const CLAVE_COLAPSADO = 'hlgas_sidebar_colapsado';

type ItemMenu = { href: string; label: string; icon: string; soloSA?: boolean };

const ITEMS: ItemMenu[] = [
  {
    href: '/',
    label: 'Dashboard',
    icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  },
  {
    href: '/despacho',
    label: 'Panel de Despacho',
    icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
  },
  {
    href: '/auditoria',
    label: 'Auditoría y Soportes',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    href: '/nomina',
    label: 'Nómina',
    soloSA: true,
    icon: 'M9 7h6m-6 4h6m-6 4h3m-9 6h12a2 2 0 002-2V7a2 2 0 00-2-2H9a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    href: '/trazabilidad',
    label: 'Mapa de Recorridos',
    icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  },
  {
    href: '/notificaciones',
    label: 'Notificaciones',
    icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { area } = useArea();

  // Plegado / desplegado (se recuerda en el navegador)
  const [colapsado, setColapsado] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(CLAVE_COLAPSADO) === '1') setColapsado(true);
    } catch {
      /* sin almacenamiento: queda desplegado */
    }
  }, []);
  const alternar = () => {
    const nuevo = !colapsado;
    setColapsado(nuevo);
    try {
      localStorage.setItem(CLAVE_COLAPSADO, nuevo ? '1' : '0');
    } catch {
      /* no es crítico */
    }
  };

  // Derive display name and initials from user
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuario';
  const initial = displayName.charAt(0).toUpperCase();

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  const items = ITEMS.filter((i) => !i.soloSA || area === 'SA');

  return (
    <aside
      className={`${
        colapsado ? 'w-[72px]' : 'w-64'
      } bg-[#0F172A] text-slate-300 flex flex-col h-screen flex-shrink-0 overflow-hidden transition-[width] duration-200`}
    >
      <div className={`border-b border-slate-800/60 py-4 ${colapsado ? 'px-2' : 'px-5'}`}>
        <div className={`flex items-center ${colapsado ? 'flex-col gap-3' : 'justify-between gap-3'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.png" alt="Logo HLGAS" className="w-10 h-10 object-contain rounded-xl shrink-0" />
            {!colapsado && (
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-white tracking-wide leading-none">HLGAS</h1>
                <p className="text-xs text-slate-400 mt-1 whitespace-nowrap">Gestión Operativa</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={alternar}
            title={colapsado ? 'Desplegar menú' : 'Plegar menú'}
            aria-label={colapsado ? 'Desplegar menú' : 'Plegar menú'}
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#172554] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={colapsado ? 'M13 5l7 7-7 7M5 5l7 7-7 7' : 'M11 19l-7-7 7-7m8 14l-7-7 7-7'}
              />
            </svg>
          </button>
        </div>
      </div>

      <nav className={`flex-1 py-4 space-y-0.5 ${colapsado ? 'px-2' : 'px-3'}`}>
        {items.map((item) => {
          const activo = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={colapsado ? item.label : undefined}
              className={`flex items-center py-2 rounded-xl text-[14px] font-medium transition-all duration-150 whitespace-nowrap ${
                colapsado ? 'justify-center px-0' : 'gap-3 px-4'
              } ${
                activo
                  ? 'bg-[#2563EB] text-white shadow-none'
                  : 'hover:bg-[#172554] text-slate-400 hover:text-slate-100'
              }`}
            >
              <svg
                className={`w-5 h-5 shrink-0 ${activo ? 'opacity-100' : 'opacity-70'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
              </svg>
              {!colapsado && item.label}
            </Link>
          );
        })}
      </nav>

      <div className={`mt-auto border-t border-slate-800/60 py-4 space-y-3 ${colapsado ? 'px-2' : 'px-3'}`}>
        {colapsado ? (
          <div className="flex justify-center">
            <div
              title={displayName}
              className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium"
            >
              {initial}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 shrink-0 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                <p className="text-xs text-slate-400">Administrador</p>
              </div>
            </div>
            <svg className="w-4 h-4 text-slate-400 cursor-pointer shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        )}
        <button
          onClick={handleLogout}
          title={colapsado ? 'Cerrar sesión' : undefined}
          className={`flex items-center text-slate-400 hover:text-white transition-colors w-full text-sm ${
            colapsado ? 'justify-center' : 'gap-3 px-2'
          }`}
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          {!colapsado && 'Cerrar sesión'}
        </button>
      </div>
    </aside>
  );
}
