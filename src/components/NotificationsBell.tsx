'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useArea } from '@/components/AreaProvider';

export default function NotificationsBell() {
  const { area } = useArea();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificaciones, setNotificaciones] = useState<string[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const channel = supabase.channel('realtime-ordenes-bell')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ordenes' }, async (payload) => {
        if (payload.new?.area && payload.new.area !== area) return;
        if (payload.new.estado !== payload.old.estado && (payload.new.estado === 'Efectiva' || payload.new.estado === 'Cancelada')) {
          let nombreTecnico = 'Un técnico';
          if (payload.new.id_tecnico_asignado) {
            const { data: perfil } = await supabase
              .from('perfiles')
              .select('nombre')
              .eq('id_usuario', payload.new.id_tecnico_asignado)
              .single();
              
            if (perfil && perfil.nombre) {
              nombreTecnico = perfil.nombre.replace(/\b\w/g, (l: string) => l.toUpperCase());
            }
          }
          
          setUnreadCount(prev => prev + 1);
          setNotificaciones(prev => [`${nombreTecnico} cerró la orden ${payload.new.contrato || payload.new.orden_trabajo} como ${payload.new.estado}.`, ...prev]);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [area]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleDropdown = () => {
    setShowNotifications(!showNotifications);
    if (!showNotifications && unreadCount > 0) {
      setUnreadCount(0);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={toggleDropdown}
        className="relative p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors focus:outline-none"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-sm">
            {unreadCount > 9 ? '+9' : unreadCount}
          </span>
        )}
      </button>

      {showNotifications && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden z-50">
          <div className="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-semibold text-gray-700">Notificaciones</h3>
            {notificaciones.length > 0 && (
              <button 
                onClick={() => setNotificaciones([])} 
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Limpiar todo
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notificaciones.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">
                No tienes notificaciones nuevas.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {notificaciones.map((notif, idx) => (
                  <li key={idx} className="p-4 hover:bg-gray-50 text-sm text-gray-700 flex items-start gap-3">
                    <div className="mt-0.5 text-blue-500">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <span>{notif}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
