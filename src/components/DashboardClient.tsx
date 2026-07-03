'use client';

import React, { useEffect, useState, useCallback } from 'react';
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
  const [lastUpdateDate, setLastUpdateDate] = useState<string | null>(null);

  const fetchLastUploadDate = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_metadata')
      .select('valor')
      .eq('clave', 'ultima_carga_excel')
      .single();

    if (!error && data?.valor) {
      const fecha = new Date(data.valor);
      const formatted = fecha.toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'short',
        timeStyle: 'short',
      });
      setLastUpdateDate(formatted);
    }
  }, []);

  useEffect(() => {
    fetchLastUploadDate();
  }, [fetchLastUploadDate]);

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

  // Total pending orders for percentage badges in tech section
  const totalPending = pendingOrders.length;

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 lg:px-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">Dashboard</h1>
          <p className="text-xs text-[#64748B] mt-0.5">Visión global del sistema de órdenes</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdateDate && (
            <span className="text-sm font-medium text-gray-500 hidden md:block mr-4">
              Última actualización: {lastUpdateDate}
            </span>
          )}
          <NotificationsBell />
          <UserProfile />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3.5 rounded-xl border border-red-200 text-sm">
          No se pudieron cargar los datos del Dashboard.
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Órdenes Activas */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E5E7EB] flex items-center gap-6 max-h-[110px]">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-[#64748B] leading-tight">Órdenes Activas</span>
            <span className="text-3xl font-bold text-[#0F172A] leading-none mt-1">{totalActivas}</span>
            <span className="text-[10px] text-[#64748B] mt-1.5 leading-tight">En gestión actualmente</span>
          </div>
        </div>
        {/* Pendientes >= 3 días */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E5E7EB] flex items-center gap-6 max-h-[110px]">
          <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-[#64748B] leading-tight">Pendientes ({'>='} 3 días)</span>
            <span className="text-3xl font-bold text-[#0F172A] leading-none mt-1">{pendientesVencidas}</span>
            <span className="text-[10px] text-orange-500 font-medium mt-1.5 leading-tight">⚠ {pendientesPct}% requieren atención</span>
          </div>
        </div>
        {/* Completadas Hoy */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#E5E7EB] flex items-center gap-6 max-h-[110px]">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 13l4 4L19 7" /></svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-[#64748B] leading-tight">Completadas Hoy</span>
            <span className="text-3xl font-bold text-[#0F172A] leading-none mt-1">{cerradasHoy}</span>
            <span className="text-[10px] text-emerald-600 font-medium mt-1.5 leading-tight">↑ Rendimiento del día</span>
          </div>
        </div>
      </div>

      {/* ── Middle Row: Localidades + Alertas ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Órdenes por Localidad — 60% */}
        <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <h2 className="text-sm font-semibold text-[#0F172A]">Órdenes por Localidad</h2>
          </div>
          <div className="space-y-3">
            {localidades.length === 0 ? (
              <p className="text-[#64748B] text-xs">No hay datos para mostrar.</p>
            ) : (
              localidades.map((item) => (
                <div key={item.loc} className="grid grid-cols-[140px_1fr_60px] gap-3 items-center">
                  <span className="text-xs font-medium text-[#0F172A] whitespace-normal leading-snug" title={item.loc}>{item.loc}</span>
                  <div>
                    <div className="w-full bg-slate-100 rounded-full h-[5px]">
                      <div className="bg-blue-600 h-[5px] rounded-full transition-all duration-500" style={{ width: item.pct }}></div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-[#0F172A] block leading-tight">{item.val}</span>
                    <span className="text-[10px] text-[#64748B] leading-tight">{item.pct}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-[#E5E7EB]">
            <span className="text-xs text-blue-600 font-medium cursor-pointer hover:text-blue-700 transition-colors">{totalActivas} órdenes activas en total →</span>
          </div>
        </div>

        {/* Alertas — 40% */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            </div>
            <h2 className="text-sm font-semibold text-[#0F172A]">Alertas</h2>
          </div>
          <div className="space-y-2.5">
            {/* Alerta Crítica: SLA vencido */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-[#E5E7EB] hover:bg-slate-50/50 transition-colors cursor-pointer">
              <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#0F172A] leading-tight">{pendientesVencidas} órdenes llevan más de 3 días pendientes</p>
                <p className="text-[10px] text-[#64748B] mt-0.5">SLA vencido — requieren atención inmediata</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
            {/* Alerta: Sin asignar */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-[#E5E7EB] hover:bg-slate-50/50 transition-colors cursor-pointer">
              <div className="w-9 h-9 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#0F172A] leading-tight">{unassignedCount} órdenes sin técnico asignado</p>
                <p className="text-[10px] text-[#64748B] mt-0.5">Pendientes de asignación</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
            {/* Info: Completadas hoy */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-[#E5E7EB] hover:bg-slate-50/50 transition-colors cursor-pointer">
              <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#0F172A] leading-tight">{cerradasHoy} órdenes completadas hoy</p>
                <p className="text-[10px] text-[#64748B] mt-0.5">Rendimiento del equipo en el día</p>
              </div>
              <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
          </div>
        </div>
      </div>

      {/* ── Carga por Técnico ── */}
      <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          </div>
          <h2 className="text-sm font-semibold text-[#0F172A]">Carga por Técnico</h2>
          <span className="ml-auto text-[11px] text-[#64748B] bg-slate-50 border border-[#E5E7EB] rounded-md px-2 py-0.5 font-medium">{totalPending} pendientes</span>
        </div>
        <div className="space-y-3">
          {tecnicosList.length === 0 ? (
            <p className="text-[#64748B] text-xs">No hay técnicos asignados.</p>
          ) : (
            tecnicosList.map((tech) => {
              const pct = tech.max > 0 ? (tech.val / tech.max) * 100 : 0;
              const pctLabel = totalPending > 0 ? ((tech.val / totalPending) * 100).toFixed(0) : '0';
              return (
                <div key={tech.name} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full ${tech.bg} flex items-center justify-center text-white text-[10px] font-semibold shrink-0`}>
                    {tech.initials}
                  </div>
                  <div className="w-28 shrink-0">
                    <span className="text-xs font-medium text-[#0F172A] truncate block" title={tech.name}>{tech.name}</span>
                  </div>
                  <div className="flex-1">
                    <div className="w-full bg-slate-100 rounded-full h-[5px]">
                      <div className="bg-blue-600 h-[5px] rounded-full transition-all duration-500" style={{ width: `${pct}%` }}></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-[#0F172A]">{tech.val} <span className="font-normal text-[#64748B]">órdenes</span></span>
                    <span className="text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-1.5 py-0.5">{pctLabel}%</span>
                    <button className="text-slate-300 hover:text-slate-500 transition-colors p-0.5">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" /></svg>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="mt-4 pt-3 border-t border-[#E5E7EB] text-center">
          <span className="text-xs text-[#64748B] font-medium cursor-pointer hover:text-[#0F172A] transition-colors inline-flex items-center gap-1">
            Ver todos los técnicos
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </span>
        </div>
      </div>
    </div>
  );
}
