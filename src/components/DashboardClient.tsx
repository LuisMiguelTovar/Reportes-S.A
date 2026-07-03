'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';
import { toast } from 'react-hot-toast';

type Orden = {
  orden_trabajo: string;
  estado: string;
  localidad?: string;
  id_tecnico_asignado?: string;
  contrato?: string;
  fecha_asignacion_ot?: string;
  [key: string]: any;
};

type Perfil = {
  id_usuario: string;
  nombre: string;
};

export default function DashboardClient({
  ordenesActivas: initialActivas,
  completadasHoy,
  perfiles,
  error
}: {
  ordenesActivas: Orden[];
  completadasHoy: number;
  perfiles: Perfil[];
  error: any;
}) {
  const [activas, setActivas] = useState<Orden[]>(initialActivas);
  const [cerradasHoy, setCerradasHoy] = useState<number>(completadasHoy);

  useEffect(() => {
    const channel = supabase
      .channel('realtime_ordenes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ordenes' },
        async (payload) => {
          const newRow = payload.new as Orden;
          const oldRow = payload.old as Orden;

          const esCerrada = newRow.estado === 'Efectiva' || newRow.estado === 'Cancelada';
          const eraCerrada = oldRow.estado === 'Efectiva' || oldRow.estado === 'Cancelada';

          if (esCerrada && !eraCerrada) {
            // Orden pasó de activa a cerrada: removerla de activas, incrementar contador de hoy
            setActivas((prev) => prev.filter((o) => o.orden_trabajo !== newRow.orden_trabajo));
            setCerradasHoy((prev) => prev + 1);

            // Toast de cierre
            let nombreTecnico = 'Un técnico';
            if (newRow.id_tecnico_asignado) {
              const { data: perfil } = await supabase
                .from('perfiles')
                .select('nombre')
                .eq('id_usuario', newRow.id_tecnico_asignado)
                .single();

              if (perfil && perfil.nombre) {
                nombreTecnico = perfil.nombre.replace(/\b\w/g, (l: string) => l.toUpperCase());
              }
            }
            toast.success(`${nombreTecnico} cerró la orden ${newRow.contrato || newRow.orden_trabajo} como ${newRow.estado}.`);
          } else if (!esCerrada && eraCerrada) {
            // Orden reabierta: agregarla de vuelta a activas, decrementar contador
            setActivas((prev) => [newRow, ...prev]);
            setCerradasHoy((prev) => Math.max(0, prev - 1));
          } else if (!esCerrada) {
            // Actualización dentro de activas (ej: cambio de técnico, localidad, etc.)
            setActivas((prev) => prev.map((o) => o.orden_trabajo === newRow.orden_trabajo ? { ...o, ...newRow } : o));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ordenes' },
        (payload) => {
          const newRow = payload.new as Orden;
          const esCerrada = newRow.estado === 'Efectiva' || newRow.estado === 'Cancelada';
          if (!esCerrada) {
            setActivas((prev) => [newRow, ...prev]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ── Tarjeta 1: Órdenes Activas ──
  const totalActivas = activas.length;

  // ── Tarjeta 2: Pendientes (>= 3 días SLA) ──
  const pendientesVencidas = activas.filter(o => {
    if (!o.fecha_asignacion_ot) return false;
    const asignacion = new Date(o.fecha_asignacion_ot);
    const ahora = new Date();
    const diferenciaMs = ahora.getTime() - asignacion.getTime();
    const dias = Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));
    return dias >= 3;
  }).length;

  // ── Tarjeta 3: Completadas Hoy ──
  // cerradasHoy ya viene del servidor y se actualiza en tiempo real

  const pendientesPct = totalActivas ? ((pendientesVencidas / totalActivas) * 100).toFixed(1) : '0.0';

  // Agrupar por Localidad — SOLO órdenes activas
  const locMap = activas.reduce((acc, curr) => {
    const loc = curr.localidad || 'SIN LOCALIDAD';
    acc[loc] = (acc[loc] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const localidades = Object.keys(locMap)
    .map(loc => ({
      loc,
      val: locMap[loc],
      pct: totalActivas ? ((locMap[loc] / totalActivas) * 100).toFixed(1) + '%' : '0%',
      color: 'blue', 
      colorHex: 'bg-blue-600'
    }))
    .sort((a, b) => b.val - a.val);

  const colors = [
    { color: 'blue', colorHex: 'bg-blue-600' },
    { color: 'purple', colorHex: 'bg-purple-600' },
    { color: 'pink', colorHex: 'bg-pink-500' },
    { color: 'rose', colorHex: 'bg-rose-500' },
    { color: 'orange', colorHex: 'bg-orange-500' },
    { color: 'teal', colorHex: 'bg-teal-500' },
  ];
  localidades.forEach((l, i) => {
    l.color = colors[i % colors.length].color;
    l.colorHex = colors[i % colors.length].colorHex;
  });

  // Agrupar por Técnico (Carga por Técnico) — SOLO órdenes activas con estado 'Pendiente'
  const pendingOrders = activas.filter(o => o.estado === 'Pendiente');
  
  const techMap = pendingOrders.reduce((acc, curr) => {
    const techId = curr.id_tecnico_asignado;
    if (techId) {
      acc[techId] = (acc[techId] || 0) + 1;
    } else {
      acc['unassigned'] = (acc['unassigned'] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // Asegurar que todos los técnicos de "perfiles" aparezcan, incluso si tienen 0 pendientes
  const tecnicosCount = perfiles.map(p => {
    return {
      id: p.id_usuario,
      name: p.nombre,
      val: techMap[p.id_usuario] || 0
    };
  });

  const unassignedCount = techMap['unassigned'] || 0;

  const maxCarga = Math.max(...tecnicosCount.map(t => t.val), unassignedCount, 15);

  const tecnicosList: { initials: string; name: string; val: number; bg: string; max: number }[] = [];
  if (unassignedCount > 0) {
    tecnicosList.push({
      initials: 'SA',
      name: 'Sin asignar',
      val: unassignedCount,
      bg: 'bg-gray-400',
      max: maxCarga
    });
  }

  tecnicosCount.forEach(t => {
    const parts = t.name.split(' ');
    const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : t.name.substring(0, 2).toUpperCase();
    tecnicosList.push({
      initials,
      name: t.name,
      val: t.val,
      bg: 'bg-blue-600',
      max: maxCarga
    });
  });

  tecnicosList.sort((a, b) => b.val - a.val);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Visión global del sistema de órdenes</p>
        </div>
        <div className="flex items-center gap-4">
          <NotificationsBell />
          <UserProfile />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200">
          No se pudieron cargar los datos del Dashboard.
        </div>
      )}

      {/* Tarjetas de Conteo Total */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 flex items-center">
          <div className="flex-shrink-0 mr-4 p-3 rounded-full bg-blue-50 text-blue-500">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-500">Órdenes Activas</span>
            <span className="text-4xl font-bold text-gray-900 mt-1">{totalActivas}</span>
            <span className="text-xs text-gray-400 mt-1">En gestión actualmente</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 flex items-center">
          <div className="flex-shrink-0 mr-4 p-3 rounded-full bg-orange-50 text-orange-500">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-500">Pendientes ({'>='} 3 días)</span>
            <span className="text-4xl font-bold text-gray-900 mt-1">{pendientesVencidas}</span>
            <span className="text-xs text-gray-400 mt-1">{pendientesPct}% de las activas</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 flex items-center">
          <div className="flex-shrink-0 mr-4 p-3 rounded-full bg-green-50 text-green-500">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-500">Completadas Hoy</span>
            <span className="text-4xl font-bold text-gray-900 mt-1">{cerradasHoy}</span>
            <span className="text-xs text-gray-400 mt-1">Rendimiento del día</span>
          </div>
        </div>
      </div>

      {/* Tarjetas de Localidad */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-6">
          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          <h2 className="text-lg font-semibold text-slate-800">Órdenes por Localidad</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {localidades.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay datos para mostrar.</p>
          ) : (
            localidades.map((item) => (
              <div key={item.loc} className="p-5 bg-white rounded-xl border border-slate-100 shadow-[0_2px_12px_-4px_rgba(6,81,237,0.08)] relative overflow-hidden">
                <div className="flex justify-between items-start mb-3">
                  <p className="text-xs font-bold text-slate-800 truncate pr-2" title={item.loc}>{item.loc}</p>
                  <div className={`w-8 h-8 rounded-lg bg-${item.color}-50 flex items-center justify-center text-${item.color}-500 shrink-0`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                  </div>
                </div>
                <p className="text-3xl font-bold text-slate-900 mb-0.5">{item.val}</p>
                <p className="text-[11px] text-slate-400 mb-4">órdenes</p>
                <div className="w-full bg-slate-100 rounded-full h-1.5 mb-2">
                  <div className={`${item.colorHex} h-1.5 rounded-full`} style={{ width: item.pct }}></div>
                </div>
                <p className="text-[10px] text-slate-500">{item.pct} del total</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Monitor de Fuerza Laboral */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-6">
          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          <h2 className="text-lg font-semibold text-slate-800">Carga por Técnico</h2>
        </div>
        <div className="space-y-6">
          {tecnicosList.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay técnicos asignados.</p>
          ) : (
            tecnicosList.map((tech) => {
              const pct = tech.max > 0 ? (tech.val / tech.max) * 100 : 0;
              return (
                <div key={tech.name} className="flex items-center gap-4">
                  <div className={`w-8 h-8 rounded-full ${tech.bg} flex items-center justify-center text-white text-xs font-medium shrink-0`}>
                    {tech.initials}
                  </div>
                  <div className="w-40 shrink-0">
                    <span className="text-[13px] font-medium text-slate-700 truncate block" title={tech.name}>{tech.name}</span>
                  </div>
                  <div className="flex-1 max-w-2xl">
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                  <div className="w-24 text-right shrink-0">
                    <span className="text-sm font-bold text-slate-800">{tech.val} </span>
                    <span className="text-xs text-slate-500">órdenes</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
