'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useArea } from '@/components/AreaProvider';
import { useAuth } from '@/contexts/AuthContext';
import { avisarCambioSmartflex, marcarSmartflex, pedirAbrirOrden, EVENTO_SMARTFLEX } from '@/lib/smartflex';

type ItemSmartflex = {
  id: string;
  orden_trabajo: string;
  estado: string;            // estado de la entrada del historial: Programada | Incumplida | Cancelada
  comentario: string | null;
  causal_codigo: string | null;
  fecha: string;
  usuario: string | null;
  tecnico: string | null;
  contrato: string | null;
  direccion: string | null;
  estado_orden: string | null; // estado actual de la orden
  visto: boolean;
};

const CAUSALES: Record<string, string> = {
  '9565': 'Inmueble solo',
  '9584': 'Trabajo ejecutado por tercero',
  '9589': 'Usuario no autoriza',
  '3357': 'Trabajo no ejecutado',
};

const nombreBonito = (n?: string | null) =>
  (n ?? '').toString().trim().toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()) || 'Técnico';

const horaCorta = (f: string) =>
  new Date(f).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true });

const claveDia = (f: string) => new Date(f).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const etiquetaDia = (f: string) => {
  const hoy = claveDia(new Date().toISOString());
  const ayer = claveDia(new Date(Date.now() - 86400000).toISOString());
  const k = claveDia(f);
  if (k === hoy) return 'Hoy';
  if (k === ayer) return 'Ayer';
  return new Date(f).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' });
};

const topeContador = (n: number) => (n > 99 ? '99+' : String(n));

export default function NotificationsBell() {
  const { area } = useArea();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  // Avisos en memoria: cierres Efectiva / Cancelada en vivo (comportamiento anterior)
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificaciones, setNotificaciones] = useState<{ texto: string; orden: string; estado: string; hora: string }[]>([]);
  const [pestana, setPestana] = useState<'pendientes' | 'cierres'>('pendientes');

  // Comentarios de técnicos pendientes de pasar a Open Smartflex (vienen de la base de datos)
  const [pendientes, setPendientes] = useState<ItemSmartflex[]>([]);

  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const noVistas = pendientes.filter((p) => !p.visto).length;
  const totalBadge = unreadCount + noVistas;

  const cargarPendientes = useCallback(async () => {
    const { data, error } = await supabase.rpc('smartflex_bandeja', { p_area: area });
    if (error || !data) {
      console.error('Error al cargar pendientes de Smartflex:', error?.message);
      return;
    }
    setPendientes(
      (data as any[]).map((r) => ({
        id: r.id,
        orden_trabajo: r.orden_trabajo,
        estado: r.estado,
        comentario: r.comentario ?? null,
        causal_codigo: r.causal_codigo ?? null,
        fecha: r.fecha,
        usuario: r.usuario ?? null,
        tecnico: r.tecnico ?? null,
        contrato: r.contrato ?? null,
        direccion: r.direccion ?? null,
        estado_orden: r.estado_orden ?? null,
        visto: r.visto !== false,
      }))
    );
  }, [area]);

  // Carga inicial + en vivo: cualquier cambio en historial_ordenes refresca la lista y las filas de las tablas
  useEffect(() => {
    cargarPendientes();
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    const refrescar = () => {
      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        cargarPendientes();
        avisarCambioSmartflex();
      }, 400);
    };
    const canal = supabase
      .channel('realtime-historial-smartflex')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historial_ordenes' }, refrescar)
      .subscribe();
    // Si otra parte de la pantalla marca algo, solo recargamos la lista (sin volver a avisar)
    const alCambiar = () => {
      cargarPendientes();
    };
    window.addEventListener(EVENTO_SMARTFLEX, alCambiar);
    return () => {
      if (temporizador) clearTimeout(temporizador);
      supabase.removeChannel(canal);
      window.removeEventListener(EVENTO_SMARTFLEX, alCambiar);
    };
  }, [cargarPendientes]);

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
          setNotificaciones(prev => [{ texto: `${nombreTecnico} cerró la orden ${payload.new.contrato || payload.new.orden_trabajo} como ${payload.new.estado}.`, orden: String(payload.new.orden_trabajo), estado: String(payload.new.estado), hora: new Date().toISOString() }, ...prev]);
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
    // Solo se pone en cero el contador de avisos en memoria; los de Smartflex se leen al abrirlos
    if (!showNotifications && unreadCount > 0) {
      setUnreadCount(0);
    }
  };

  // Marca como leídos (visto) uno o varios comentarios
  const marcarVistos = async (ids: string[]) => {
    if (ids.length === 0) return;
    setPendientes((prev) => prev.map((p) => (ids.includes(p.id) ? { ...p, visto: true } : p)));
    await supabase.from('historial_ordenes').update({ smartflex_visto: true }).in('id', ids);
  };

  // Doble clic (o Enter) en un aviso: lo marca leído y abre la orden en su modal
  const abrirAviso = async (item: ItemSmartflex) => {
    marcarVistos([item.id]);
    const destino = item.estado_orden === 'Efectiva' || item.estado_orden === 'Cancelada' ? 'auditoria' : 'despacho';
    setShowNotifications(false);
    pedirAbrirOrden(item.orden_trabajo, destino);
    if (!pathname.startsWith(`/${destino}`)) router.push(`/${destino}`);
  };

  // Doble clic (o Enter) en un cierre reciente: abre la orden (Efectiva / Cancelada → Auditoría)
  const abrirCierre = (n: { orden: string; estado: string }) => {
    const destino = n.estado === 'Efectiva' || n.estado === 'Cancelada' ? 'auditoria' : 'despacho';
    setShowNotifications(false);
    pedirAbrirOrden(n.orden, destino);
    if (!pathname.startsWith(`/${destino}`)) router.push(`/${destino}`);
  };

  // Marcar un comentario como registrado en Open Smartflex sin abrir la orden
  const registrarAviso = async (item: ItemSmartflex) => {
    const ok = await marcarSmartflex(item.id, true, user?.email);
    if (ok) setPendientes((prev) => prev.filter((p) => p.id !== item.id));
  };

  // Comentarios pendientes por orden (para decir "2 comentarios" cuando se reprogramó) y agrupados por día
  const cuentaPorOrden: Record<string, number> = {};
  pendientes.forEach((p) => { cuentaPorOrden[p.orden_trabajo] = (cuentaPorOrden[p.orden_trabajo] ?? 0) + 1; });
  const grupos: { etiqueta: string; items: ItemSmartflex[] }[] = [];
  pendientes.forEach((p) => {
    const et = etiquetaDia(p.fecha);
    const g = grupos[grupos.length - 1];
    if (g && g.etiqueta === et) g.items.push(p);
    else grupos.push({ etiqueta: et, items: [p] });
  });

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        aria-label={totalBadge > 0 ? `Notificaciones, ${totalBadge} sin leer` : 'Notificaciones'}
        className="relative p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors focus:outline-none"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
        {totalBadge > 0 && (
          <span className="absolute top-0 right-0 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-sm tabular-nums">
            {totalBadge > 9 ? '+9' : totalBadge}
          </span>
        )}
      </button>

      {showNotifications && (
        <div className="absolute right-0 mt-2 w-[432px] max-w-[calc(100vw-32px)] bg-white rounded-2xl shadow-2xl border border-[#E3E9F4] overflow-hidden z-50">
          <div className="flex items-center justify-between pl-[18px] pr-2 pt-1.5">
            <h3 className="text-[15px] font-semibold text-[#0F2A5C]">Notificaciones</h3>
            {pestana === 'pendientes' && noVistas > 0 && (
              <button
                type="button"
                onClick={() => marcarVistos(pendientes.filter((p) => !p.visto).map((p) => p.id))}
                className="min-h-[44px] px-2.5 text-[13px] font-medium text-[#1D4ED8] hover:text-[#1E3A8A]"
              >
                Marcar todas leídas
              </button>
            )}
            {pestana === 'cierres' && notificaciones.length > 0 && (
              <button
                type="button"
                onClick={() => setNotificaciones([])}
                className="min-h-[44px] px-2.5 text-[13px] font-medium text-[#1D4ED8] hover:text-[#1E3A8A]"
              >
                Limpiar cierres
              </button>
            )}
          </div>

          <div className="flex gap-1 px-2.5 border-b border-[#E3E9F4]" role="tablist" aria-label="Tipo de notificación">
            <button
              type="button"
              role="tab"
              aria-selected={pestana === 'pendientes'}
              onClick={() => setPestana('pendientes')}
              className={`min-h-[44px] inline-flex items-center gap-2 px-2 -mb-px border-b-2 text-[13px] whitespace-nowrap ${pestana === 'pendientes' ? 'border-[#0F2A5C] text-[#0F2A5C] font-semibold' : 'border-transparent text-slate-600 font-medium hover:text-[#0F2A5C]'}`}
            >
              Por registrar
              <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[12px] font-semibold inline-flex items-center justify-center tabular-nums ${pestana === 'pendientes' && pendientes.length > 0 ? 'bg-[#B45309] text-white' : 'bg-[#E3E9F4] text-[#0F2A5C]'}`}>{topeContador(pendientes.length)}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pestana === 'cierres'}
              onClick={() => setPestana('cierres')}
              className={`min-h-[44px] inline-flex items-center gap-2 px-2 -mb-px border-b-2 text-[13px] whitespace-nowrap ${pestana === 'cierres' ? 'border-[#0F2A5C] text-[#0F2A5C] font-semibold' : 'border-transparent text-slate-600 font-medium hover:text-[#0F2A5C]'}`}
            >
              Cierres
              <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[12px] font-semibold inline-flex items-center justify-center tabular-nums ${pestana === 'cierres' && notificaciones.length > 0 ? 'bg-[#0F2A5C] text-white' : 'bg-[#E3E9F4] text-[#0F2A5C]'}`}>{topeContador(notificaciones.length)}</span>
            </button>
          </div>

          <div className="max-h-[28rem] overflow-y-auto" role="tabpanel">
            {pestana === 'pendientes' && pendientes.length === 0 && (
              <div className="px-6 py-10 text-center">
                <svg className="mx-auto" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>
                <p className="mt-3 text-[15px] font-semibold text-[#0F2A5C]">Todo al día</p>
                <p className="mt-1 text-[13px] text-slate-500">No hay comentarios pendientes de registrar en Open Smartflex.</p>
              </div>
            )}

            {pestana === 'pendientes' && grupos.map((g) => (
              <section key={g.etiqueta} aria-label={g.etiqueta}>
                <h4 className="px-[18px] pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{g.etiqueta}</h4>
                <ul>
                  {g.items.map((p) => {
                    const esIncumplida = p.estado === 'Incumplida' || p.estado === 'Cancelada';
                    const causal = p.causal_codigo ? (CAUSALES[String(p.causal_codigo)] ?? String(p.causal_codigo)) : '';
                    const n = cuentaPorOrden[p.orden_trabajo] ?? 1;
                    return (
                      <li key={p.id} className="group relative border-t border-[#F1F5F9] first:border-t-0">
                        <div
                          role="button"
                          tabIndex={0}
                          title="Doble clic o Enter para abrir la orden"
                          onDoubleClick={() => abrirAviso(p)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target === e.currentTarget) {
                              e.preventDefault();
                              abrirAviso(p);
                            }
                          }}
                          className="flex gap-3 px-[18px] py-3 cursor-pointer select-none hover:bg-[#F7F9FC] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                        >
                          <span aria-hidden="true" className="mt-[7px] w-2 h-2 rounded-full shrink-0" style={{ background: p.visto ? 'transparent' : '#B45309' }} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2 min-w-0">
                              <span className={`shrink-0 text-[14px] tabular-nums ${p.visto ? 'font-medium text-slate-700' : 'font-semibold text-[#0F2A5C]'}`}>Orden {p.orden_trabajo}</span>
                              <span className="text-[12px] whitespace-nowrap" style={{ color: esIncumplida ? '#B91C1C' : '#475569' }}>
                                {esIncumplida ? 'Incumplida' : 'Programada'}{n > 1 ? ` · ${n} comentarios` : ''}
                              </span>
                              <time className="ml-auto text-[12px] text-slate-500 whitespace-nowrap tabular-nums">{horaCorta(p.fecha)}</time>
                            </div>
                            <p className="mt-0.5 text-[12px] text-slate-500 truncate">
                              {nombreBonito(p.tecnico)}{p.contrato ? ` · Contrato ${p.contrato}` : ''}
                            </p>
                            {esIncumplida && causal && <p className="mt-1.5 text-[12px] font-semibold text-red-700">Motivo: {causal}</p>}
                            <p
                              className="mt-1.5 text-[13px] leading-snug text-slate-700"
                              style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
                            >
                              {p.comentario?.trim() ? (esIncumplida ? p.comentario : p.comentario.replace(/\s*\n+\s*/g, ' ').replace(/\s*Atendido por:?\s*/gi, ' atiende ').replace(/\s{2,}/g, ' ').trim()) : <span className="italic text-slate-500">Sin comentario del técnico</span>}
                            </p>
                          </div>
                        </div>
                        {/* Acciones: aparecen al pasar el mouse o al enfocar el aviso */}
                        <div className="absolute right-3 top-2 hidden group-hover:flex group-focus-within:flex items-center gap-2 rounded-xl bg-white p-1 shadow-md border border-[#E3E9F4]">
                          <button
                            type="button"
                            onClick={() => abrirAviso(p)}
                            className="min-h-[44px] px-3.5 rounded-lg border border-[#CBD5E1] bg-white text-[13px] font-medium text-[#0F2A5C] hover:bg-slate-50"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => registrarAviso(p)}
                            className="min-h-[44px] px-3.5 rounded-lg bg-[#B45309] text-[13px] font-semibold text-white hover:bg-[#92400E]"
                          >
                            Marcar registrado
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            {pestana === 'cierres' && notificaciones.length === 0 && (
              <div className="px-6 py-10 text-center">
                <p className="text-[15px] font-semibold text-[#0F2A5C]">Sin cierres recientes</p>
                <p className="mt-1 text-[13px] text-slate-500">Aquí aparecen los cierres que ocurran mientras tienes el panel abierto.</p>
              </div>
            )}

            {pestana === 'cierres' && notificaciones.length > 0 && (
              <ul>
                {notificaciones.map((notif, idx) => (
                  <li
                    key={idx}
                    tabIndex={0}
                    title="Doble clic o Enter para abrir la orden"
                    onDoubleClick={() => abrirCierre(notif)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        abrirCierre(notif);
                      }
                    }}
                    className="flex gap-3 px-[18px] py-3 border-t border-[#F1F5F9] first:border-t-0 cursor-pointer select-none hover:bg-[#F7F9FC] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                  >
                    <span aria-hidden="true" className="mt-[7px] w-2 h-2 rounded-full shrink-0" style={{ background: notif.estado === 'Efectiva' ? '#15803D' : '#B91C1C' }} />
                    <div className="min-w-0">
                      <p className="text-[13px] leading-snug text-slate-700" style={{ overflowWrap: 'anywhere' }}>{notif.texto}</p>
                      <p className="mt-0.5 text-[12px] text-slate-500 tabular-nums">{horaCorta(notif.hora)} · doble clic para abrir</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-[18px] py-2.5 border-t border-[#E3E9F4] bg-[#F8FAFC] text-[12px] text-slate-500">
            {pestana === 'pendientes' ? 'Doble clic en un aviso para abrir la orden · Enter con el teclado' : 'Los cierres se muestran mientras tengas el panel abierto'}
          </div>
        </div>
      )}
    </div>
  );
}
