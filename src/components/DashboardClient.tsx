'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';
import { toast } from 'react-hot-toast';

// ───────────────────────── Reglas ajustables ─────────────────────────
// Cambia estos valores para afinar cómo se clasifican las cosas, sin tocar el resto.

/** Días desde la asignación a partir de los cuales una orden se considera vencida (igual que el SLA rojo de la tabla). */
const DIAS_VENCIDA = 3;
/** Carga / capacidad a partir de la cual un técnico se considera "equilibrado" (por debajo = "bajo"). Más de 1 = sobrecarga. */
const UMBRAL_EQUILIBRADO = 0.8;
/** Flujo del día: cerradas/creadas por debajo de este valor = "operación atrasada". */
const UMBRAL_FLUJO_ATRASADA = 0.7;
/** Flujo del día: antes de esta hora no se evalúa atraso (por la mañana siempre habrá más creadas que cerradas). */
const HORA_MIN_EVALUACION_FLUJO = 12;
/** Mapa de calor: valor mínimo absoluto para que una celda cuente como "atención" / "crítico". */
const HEAT_ATENCION_MIN = 3;
const HEAT_CRITICO_MIN = 5;

// ───────────────────────── Tipos ─────────────────────────

type OrdenActiva = {
  orden_trabajo: string;
  estado: string;
  localidad?: string | null;
  barrio?: string | null;
  descripcion_del_trabajo?: string | null;
  id_tecnico_asignado?: string | null;
  contrato?: string | null;
  fecha_asignacion_ot?: string | null;
};

type OrdenCerrada = { orden_trabajo: string; estado: string; fecha_cierre: string | null };
type OrdenCreada = { orden_trabajo: string; creado_en: string | null };
type Perfil = { id_usuario: string; nombre: string };

type FilaRealtime = OrdenActiva & { fecha_cierre?: string | null; creado_en?: string | null };

type Tono = 'red' | 'green' | 'amber' | 'blue' | 'slate';

type BarrioItem = { nombre: string; localidad: string; total: number };

type CategoriaKey =
  | 'emergencia'
  | 'reparacion_inmediata'
  | 'reparacion'
  | 'defecto_critico'
  | 'defecto_no_critico'
  | 'cotizacion'
  | 'otros';

// ───────────────────────── Clasificación de trabajos ─────────────────────────

const CATEGORIAS: { key: CategoriaKey; label: string; color: string }[] = [
  { key: 'emergencia', label: 'Emergencia', color: '#DC2626' },
  { key: 'reparacion_inmediata', label: 'Reparación inmediata', color: '#7C3AED' },
  { key: 'reparacion', label: 'Reparación', color: '#2563EB' },
  { key: 'defecto_critico', label: 'Defecto crítico', color: '#D97706' },
  { key: 'defecto_no_critico', label: 'Defecto no crítico', color: '#15803D' },
  { key: 'cotizacion', label: 'Cotización', color: '#8892A6' },
  { key: 'otros', label: 'Otros', color: '#CBD5E1' },
];

const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

/** Agrupa el texto de `descripcion_del_trabajo` en las categorías del dashboard. Lo que no coincida cae en "Otros". */
const clasificarTrabajo = (desc?: string | null): CategoriaKey => {
  const t = sinTildes(desc ?? '');
  if (t.includes('EMERGENCIA')) return 'emergencia';
  if (t.includes('COTIZ')) return 'cotizacion';
  if (t.includes('INMEDIAT')) return 'reparacion_inmediata';
  if (t.includes('DEFECTO')) {
    if (/NO[\s_-]*CRITIC/.test(t)) return 'defecto_no_critico';
    if (t.includes('CRITIC')) return 'defecto_critico';
  }
  if (t.includes('REPARAC')) return 'reparacion';
  return 'otros';
};

// ───────────────────────── Helpers ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nombreBonito = (n: string) => n.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const pct = (n: number) => `${Math.round(n)}%`;

const normalizarLocalidad = (raw?: string | null) =>
  (raw ?? '').replace(/^\s*\d+\s*-\s*/, '').trim().toUpperCase() || 'SIN LOCALIDAD';

/** Fila para las órdenes cuya localidad no coincide con ninguna de la lista fija. */
const OTRAS_LOCALIDADES = 'OTRAS / SIN CLASIFICAR';

const normalizarBarrio = (raw?: string | null) =>
  (raw ?? '').replace(/^\s*\d+\s*-\s*/, '').trim().toUpperCase() || 'SIN BARRIO';

const calcularDias = (fecha: string | null | undefined, ahora: Date) => {
  if (!fecha) return 0;
  const dias = Math.floor((ahora.getTime() - new Date(fecha).getTime()) / 86400000);
  return dias > 0 ? dias : 0;
};

const textoFechaHoy = (d: Date) => {
  const partes = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${cap(get('weekday'))} ${get('day')} de ${get('month')} de ${get('year')}`;
};

const horaMinuto = (d: Date) =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);

const horaColombia = (iso: string): number =>
  parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(iso)
    ),
    10
  );

/** Franjas de 2 horas desde las 06:00 (0 = 06–08 … 6 = 18–20). Lo anterior a las 6 cae en la primera y lo posterior a las 20 en la última. */
const bucketHora = (h: number) => Math.min(Math.max(Math.floor((h - 6) / 2), 0), 6);

// ───────────────────────── Iconos ─────────────────────────

const ICONS = {
  clipboard:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  userX:
    'M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 10l-4 4m0-4l4 4',
  pencil: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z',
  trend: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

function Svg({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// ───────────────────────── Subcomponentes ─────────────────────────

const TONOS_PILL: Record<Tono, string> = {
  red: 'bg-rose-50 text-rose-600',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  blue: 'bg-blue-50 text-blue-700',
  slate: 'bg-slate-100 text-slate-600',
};

function Pill({ tono, children }: { tono: Tono; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${TONOS_PILL[tono]}`}
    >
      {children}
    </span>
  );
}

function LocalidadTag({ nombre }: { nombre: string }) {
  return (
    <span
      title={nombre}
      className="shrink-0 max-w-[130px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500"
    >
      {nombre}
    </span>
  );
}

function Insight({ tono, children }: { tono: 'blue' | 'red' | 'green'; children: React.ReactNode }) {
  const estilos = {
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-rose-50 text-rose-600',
    green: 'bg-emerald-50 text-emerald-700',
  };
  return <div className={`rounded-xl px-4 py-3 text-sm ${estilos[tono]}`}>{children}</div>;
}

function Panel({
  titulo,
  subtitulo,
  badge,
  children,
}: {
  titulo: string;
  subtitulo?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
          {subtitulo && <div className="text-sm text-slate-500 mt-0.5">{subtitulo}</div>}
        </div>
        {badge}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function KpiCard({
  label,
  valor,
  nota,
  notaTono,
  icon,
  iconBg,
  iconColor,
}: {
  label: string;
  valor: React.ReactNode;
  nota: React.ReactNode;
  notaTono: 'blue' | 'red' | 'green' | 'amber' | 'slate';
  icon: string;
  iconBg: string;
  iconColor: string;
}) {
  const colores = {
    blue: 'text-blue-600',
    red: 'text-rose-600',
    green: 'text-emerald-700',
    amber: 'text-amber-600',
    slate: 'text-slate-500',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg} ${iconColor}`}>
          <Svg d={icon} className="w-[18px] h-[18px]" />
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <span className="text-4xl font-bold text-slate-900 tracking-tight leading-none">{valor}</span>
        <span className={`text-xs font-medium text-right ${colores[notaTono]}`}>{nota}</span>
      </div>
    </div>
  );
}

// ───────────────────────── Componente principal ─────────────────────────

export default function DashboardClient({
  ordenesActivas,
  cerradasHoy: cerradasIniciales,
  creadasHoy: creadasIniciales,
  perfiles,
  capacidadInicial,
  localidadesConocidas,
  hayError,
}: {
  ordenesActivas: OrdenActiva[];
  cerradasHoy: OrdenCerrada[];
  creadasHoy: OrdenCreada[] | null; // null = la columna creado_en aún no existe
  perfiles: Perfil[];
  capacidadInicial: number;
  localidadesConocidas: string[]; // todas las localidades que han aparecido en el sistema (aunque hoy no tengan órdenes)
  hayError: boolean;
}) {
  const [activas, setActivas] = useState<OrdenActiva[]>(ordenesActivas);
  const [cerradasHoy, setCerradasHoy] = useState<OrdenCerrada[]>(cerradasIniciales);
  const [creadasHoy, setCreadasHoy] = useState<OrdenCreada[] | null>(creadasIniciales);

  const [capacidad, setCapacidad] = useState(capacidadInicial);
  const [editandoCapacidad, setEditandoCapacidad] = useState(false);
  const [capacidadInput, setCapacidadInput] = useState(String(capacidadInicial));
  const [guardandoCapacidad, setGuardandoCapacidad] = useState(false);
  const [verTodosTecnicos, setVerTodosTecnicos] = useState(false);
  const [verTodosBarrios, setVerTodosBarrios] = useState(false);

  const [lastUploadDate, setLastUploadDate] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => new Date());
  const [horaActualizacion, setHoraActualizacion] = useState(() => new Date());
  const [realtimeActivo, setRealtimeActivo] = useState(false);

  const activasRef = useRef(activas);
  const perfilesRef = useRef(perfiles);
  useEffect(() => {
    activasRef.current = activas;
  }, [activas]);
  useEffect(() => {
    perfilesRef.current = perfiles;
  }, [perfiles]);

  // Reloj: refresca antigüedad y franjas horarias cada minuto
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fecha de la última carga de archivo (Excel/HTML)
  useEffect(() => {
    const fetchLastUploadDate = async () => {
      const { data, error } = await supabase
        .from('app_metadata')
        .select('valor')
        .eq('clave', 'ultima_carga_excel')
        .single();
      if (!error && data?.valor) {
        setLastUploadDate(
          new Date(data.valor).toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            dateStyle: 'short',
            timeStyle: 'short',
          })
        );
      }
    };
    fetchLastUploadDate();
  }, []);

  // ── Tiempo real ──
  useEffect(() => {
    const channel = supabase
      .channel('realtime_ordenes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ordenes' }, (payload) => {
        const nueva = payload.new as FilaRealtime;
        const esCerrada = nueva.estado === 'Efectiva' || nueva.estado === 'Cancelada';
        const estabaActiva = activasRef.current.some((o) => o.orden_trabajo === nueva.orden_trabajo);

        if (esCerrada && estabaActiva) {
          // Pasó de activa a cerrada
          setActivas((prev) => prev.filter((o) => o.orden_trabajo !== nueva.orden_trabajo));
          setCerradasHoy((prev) =>
            prev.some((o) => o.orden_trabajo === nueva.orden_trabajo)
              ? prev
              : [
                  ...prev,
                  {
                    orden_trabajo: nueva.orden_trabajo,
                    estado: nueva.estado,
                    fecha_cierre: nueva.fecha_cierre ?? new Date().toISOString(),
                  },
                ]
          );
          const perfil = perfilesRef.current.find((p) => p.id_usuario === nueva.id_tecnico_asignado);
          const nombreTecnico = perfil ? nombreBonito(perfil.nombre) : 'Un técnico';
          const estadoTexto = nueva.estado === 'Cancelada' ? 'Incumplida' : nueva.estado;
          toast.success(`${nombreTecnico} cerró la orden ${nueva.contrato || nueva.orden_trabajo} como ${estadoTexto}.`);
        } else if (!esCerrada && !estabaActiva) {
          // Orden reabierta: vuelve a activas y sale de las cerradas de hoy
          setActivas((prev) => [nueva, ...prev]);
          setCerradasHoy((prev) => prev.filter((o) => o.orden_trabajo !== nueva.orden_trabajo));
        } else if (!esCerrada) {
          // Cambio dentro de activas (técnico, estado, localidad…)
          setActivas((prev) => prev.map((o) => (o.orden_trabajo === nueva.orden_trabajo ? { ...o, ...nueva } : o)));
        }
        setHoraActualizacion(new Date());
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ordenes' }, (payload) => {
        const nueva = payload.new as FilaRealtime;
        const esCerrada = nueva.estado === 'Efectiva' || nueva.estado === 'Cancelada';
        if (!esCerrada) {
          setActivas((prev) => (prev.some((o) => o.orden_trabajo === nueva.orden_trabajo) ? prev : [nueva, ...prev]));
        }
        setCreadasHoy((prev) =>
          prev === null
            ? prev
            : [...prev, { orden_trabajo: nueva.orden_trabajo, creado_en: nueva.creado_en ?? new Date().toISOString() }]
        );
        setHoraActualizacion(new Date());
      })
      .subscribe((status) => setRealtimeActivo(status === 'SUBSCRIBED'));

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ───────────────── Datos derivados ─────────────────

  const localidadesFijas = useMemo(
    () => new Set(localidadesConocidas.map((l) => normalizarLocalidad(l)).filter((l) => l !== 'SIN LOCALIDAD')),
    [localidadesConocidas]
  );

  const activasN = useMemo(
    () =>
      activas.map((o) => ({
        ...o,
        dias: calcularDias(o.fecha_asignacion_ot, ahora),
        categoria: clasificarTrabajo(o.descripcion_del_trabajo),
        localidadN: (() => {
          const l = normalizarLocalidad(o.localidad);
          return localidadesFijas.size > 0 && !localidadesFijas.has(l) ? OTRAS_LOCALIDADES : l;
        })(),
        barrioN: normalizarBarrio(o.barrio),
      })),
    [activas, ahora, localidadesFijas]
  );

  const total = activasN.length;
  const asignadas = activasN.filter((o) => o.id_tecnico_asignado).length;
  const sinTecnico = total - asignadas;
  const sinTecnicoEmergencias = activasN.filter((o) => !o.id_tecnico_asignado && o.categoria === 'emergencia').length;
  const vencidas = activasN.filter((o) => o.dias >= DIAS_VENCIDA).length;
  const pctVencidas = total > 0 ? (vencidas / total) * 100 : 0;

  const cerradas = cerradasHoy.length;
  const efectivas = cerradasHoy.filter((o) => o.estado === 'Efectiva').length;
  const incumplidas = cerradas - efectivas;

  const ciudades = new Set(
    activasN.map((o) => o.localidadN).filter((l) => l !== 'SIN LOCALIDAD' && l !== OTRAS_LOCALIDADES)
  ).size;
  const tecnicosActivos = new Set(activasN.map((o) => o.id_tecnico_asignado).filter(Boolean)).size;

  // Carga por técnico (Pendiente + Programada asignadas)
  const cargaTecnicos = useMemo(
    () =>
      perfiles
        .map((p) => {
          const propias = activas.filter((o) => o.id_tecnico_asignado === p.id_usuario);
          const programadas = propias.filter((o) => o.estado === 'Programada').length;
          const totalPropias = propias.length;
          const ratio = capacidad > 0 ? totalPropias / capacidad : 0;
          const estado: 'sobrecarga' | 'equilibrado' | 'bajo' =
            ratio > 1 ? 'sobrecarga' : ratio >= UMBRAL_EQUILIBRADO ? 'equilibrado' : 'bajo';
          return {
            id: p.id_usuario,
            nombre: nombreBonito(p.nombre),
            total: totalPropias,
            pendientes: totalPropias - programadas,
            programadas,
            ratio,
            estado,
          };
        })
        .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre)),
    [perfiles, activas, capacidad]
  );
  const sobreCapacidad = cargaTecnicos.filter((t) => t.estado === 'sobrecarga').length;
  // Por defecto solo se muestran los técnicos con órdenes; el resto va tras "Ver más técnicos".
  // (El perfil placeholder "Programado" no es una persona, así que no se lista sin órdenes.)
  const tecnicosConCarga = cargaTecnicos.filter((t) => t.total > 0);
  const tecnicosSinCarga = cargaTecnicos.filter(
    (t) => t.total === 0 && t.nombre.trim().toLowerCase() !== 'programado'
  );

  const ESTILO_ESTADO = {
    sobrecarga: { barra: '#DC2626', tono: 'red' as Tono, texto: 'Sobrecarga' },
    equilibrado: { barra: '#15803D', tono: 'green' as Tono, texto: 'Equilibrado' },
    bajo: { barra: '#D97706', tono: 'amber' as Tono, texto: 'Bajo' },
  };

  // Por localidad
  const porLocalidad = useMemo(() => {
    const m = new Map<string, number>();
    // Primero todas las localidades conocidas (con 0), para que se vean aunque no tengan órdenes
    localidadesConocidas.forEach((l) => {
      const nombre = normalizarLocalidad(l);
      if (nombre !== 'SIN LOCALIDAD') m.set(nombre, 0);
    });
    activasN.forEach((o) => m.set(o.localidadN, (m.get(o.localidadN) ?? 0) + 1));
    return Array.from(m, ([nombre, totalLoc]) => ({ nombre, total: totalLoc })).sort(
      (a, b) =>
        Number(a.nombre === OTRAS_LOCALIDADES) - Number(b.nombre === OTRAS_LOCALIDADES) ||
        b.total - a.total ||
        a.nombre.localeCompare(b.nombre)
    );
  }, [activasN, localidadesConocidas]);
  const localidadesConOrdenes = porLocalidad.filter((l) => l.total > 0);
  const zonasConOrdenes = localidadesConOrdenes.filter((l) => l.nombre !== OTRAS_LOCALIDADES);
  const maxLocalidad = Math.max(porLocalidad[0]?.total ?? 0, 1);

  // Por tipo de trabajo
  const porCategoria = useMemo(() => {
    const m: Record<CategoriaKey, number> = {
      emergencia: 0,
      reparacion_inmediata: 0,
      reparacion: 0,
      defecto_critico: 0,
      defecto_no_critico: 0,
      cotizacion: 0,
      otros: 0,
    };
    activasN.forEach((o) => {
      m[o.categoria] += 1;
    });
    return m;
  }, [activasN]);
  const prioritarias = porCategoria.emergencia + porCategoria.defecto_critico;
  const pctPrioritarias = total > 0 ? (prioritarias / total) * 100 : 0;
  const categoriasVisibles = useMemo(() => CATEGORIAS.filter((c) => porCategoria[c.key] > 0), [porCategoria]);
  const maxCategoria = Math.max(...categoriasVisibles.map((c) => porCategoria[c.key]), 1);

  // Por barrio (top 5 + otros)
  const BARRIO_COLORES = ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#E2E8F0'];
  const barrios = useMemo(() => {
    // Se agrupa por barrio + localidad: si un mismo nombre existe en dos localidades, son filas distintas.
    const m = new Map<string, BarrioItem>();
    activasN.forEach((o) => {
      const key = `${o.barrioN}||${o.localidadN}`;
      const actual = m.get(key);
      if (actual) actual.total += 1;
      else m.set(key, { nombre: o.barrioN, localidad: o.localidadN, total: 1 });
    });
    const ordenar = (a: BarrioItem, b: BarrioItem) => b.total - a.total || a.nombre.localeCompare(b.nombre);
    const todos = Array.from(m.values());
    const identificados = todos.filter((b) => b.nombre !== 'SIN BARRIO').sort(ordenar);
    const sinBarrio = todos.filter((b) => b.nombre === 'SIN BARRIO');
    const top = identificados.slice(0, 5);
    const resto = [...identificados.slice(5), ...sinBarrio].sort(ordenar);
    const otros = resto.reduce((acc, b) => acc + b.total, 0);
    return { top, resto, otros };
  }, [activasN]);

  // Antigüedad
  const antiguedad = useMemo(() => {
    const filas = [
      { key: 'reciente', label: '0–1 día', color: '#15803D', track: '#DCFCE7', total: activasN.filter((o) => o.dias <= 1).length },
      {
        key: 'media',
        label: `${DIAS_VENCIDA - 1} días`,
        color: '#D97706',
        track: '#FEF3C7',
        total: activasN.filter((o) => o.dias === DIAS_VENCIDA - 1).length,
      },
      {
        key: 'vencida',
        label: `${DIAS_VENCIDA} días o más`,
        color: '#DC2626',
        track: '#FEE2E2',
        total: activasN.filter((o) => o.dias >= DIAS_VENCIDA).length,
      },
    ];
    return filas;
  }, [activasN]);
  const maxAntiguedad = Math.max(...antiguedad.map((a) => a.total), 1);

  // Flujo del día
  const horaAhoraTexto = horaMinuto(ahora);
  const horaActual = horaColombia(ahora.toISOString());
  const franjas = useMemo(() => {
    const idxActual = bucketHora(horaActual);
    const base = Array.from({ length: idxActual + 1 }, (_, i) => ({ inicio: 6 + i * 2, creadas: 0, cerradas: 0 }));
    cerradasHoy.forEach((o) => {
      if (!o.fecha_cierre) return;
      base[Math.min(bucketHora(horaColombia(o.fecha_cierre)), idxActual)].cerradas += 1;
    });
    creadasHoy?.forEach((o) => {
      if (!o.creado_en) return;
      base[Math.min(bucketHora(horaColombia(o.creado_en)), idxActual)].creadas += 1;
    });
    return base.map((f, i) => ({
      ...f,
      etiqueta: i === idxActual ? `${pad(f.inicio)}–${horaAhoraTexto}` : `${pad(f.inicio)}–${pad(f.inicio + 2)} h`,
    }));
  }, [cerradasHoy, creadasHoy, horaActual, horaAhoraTexto]);
  const maxFranja = Math.max(...franjas.flatMap((f) => [f.creadas, f.cerradas]), 1);
  const altoBarra = (v: number) => (v === 0 ? 2 : Math.max(4, Math.round((v / maxFranja) * 72)));

  const creadas = creadasHoy?.length ?? 0;
  const backlogNeto = creadas - cerradas;
  const estadoFlujo: { tono: Tono; texto: string } | null = (() => {
    if (creadasHoy === null) return null;
    if (horaActual < HORA_MIN_EVALUACION_FLUJO) return { tono: 'slate', texto: 'EN CURSO' };
    if (creadas === 0) return { tono: 'green', texto: 'OPERACIÓN AL DÍA' };
    const ratio = cerradas / creadas;
    if (ratio >= 1) return { tono: 'green', texto: 'OPERACIÓN AL DÍA' };
    if (ratio >= UMBRAL_FLUJO_ATRASADA) return { tono: 'amber', texto: 'EN CURSO' };
    return { tono: 'red', texto: 'OPERACIÓN ATRASADA' };
  })();

  // Mapa de calor: localidad × tipo de trabajo (intensidad relativa a la celda mayor)
  const heat = useMemo(() => {
    const filas = localidadesConOrdenes.map((l) => ({
      nombre: l.nombre,
      total: l.total,
      celdas: categoriasVisibles.map(
        (c) => activasN.filter((o) => o.localidadN === l.nombre && o.categoria === c.key).length
      ),
    }));
    const maxCelda = Math.max(...filas.flatMap((f) => f.celdas), 1);
    return { filas, maxCelda };
  }, [localidadesConOrdenes, categoriasVisibles, activasN]);

  const nivelCelda = (v: number): 'cero' | 'normal' | 'atencion' | 'critico' => {
    if (v === 0) return 'cero';
    const r = v / heat.maxCelda;
    if (r >= 0.66 && v >= HEAT_CRITICO_MIN) return 'critico';
    if (r >= 0.33 && v >= HEAT_ATENCION_MIN) return 'atencion';
    return 'normal';
  };
  const ESTILO_CELDA = {
    cero: { background: '#F8FAFC', color: '#94A3B8' },
    normal: { background: '#E7F5EE', color: '#166534' },
    atencion: { background: '#F6DC9A', color: '#854D0E' },
    critico: { background: '#DC4545', color: '#FFFFFF' },
  };

  const idxEmergencia = categoriasVisibles.findIndex((c) => c.key === 'emergencia');
  const topEmergencias =
    idxEmergencia >= 0
      ? heat.filas.reduce<{ nombre: string; n: number } | null>((best, f) => {
          const n = f.celdas[idxEmergencia];
          return n > 0 && (!best || n > best.n) ? { nombre: f.nombre, n } : best;
        }, null)
      : null;

  // ───────────────── Acciones ─────────────────

  const guardarCapacidad = async () => {
    const n = Math.round(Number(capacidadInput));
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      toast.error('Ingresa un número entre 1 y 200.');
      return;
    }
    setGuardandoCapacidad(true);
    const { error } = await supabase
      .from('app_metadata')
      .upsert({ clave: 'capacidad_tecnico', valor: String(n), updated_at: new Date().toISOString() }, { onConflict: 'clave' });
    setGuardandoCapacidad(false);
    if (error) {
      console.error('Error al guardar capacidad:', error);
      toast.error('No se pudo guardar la capacidad.');
      return;
    }
    setCapacidad(n);
    setEditandoCapacidad(false);
    toast.success(`Capacidad por técnico: ${n} órdenes.`);
  };

  const filaTecnico = (t: (typeof cargaTecnicos)[number]) => {
    const estilo = ESTILO_ESTADO[t.estado];
    return (
      <div key={t.id} className="grid grid-cols-[170px_1fr_70px_115px] gap-x-4 items-center">
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-slate-900 truncate" title={t.nombre}>
            {t.nombre}
          </p>
          <p className="text-xs text-slate-400 truncate">
            {t.pendientes} pend. · {t.programadas} prog.
          </p>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(t.ratio, 1) * 100}%`, background: estilo.barra }}
          />
        </div>
        <span className="text-sm font-semibold text-slate-900 text-right tabular-nums">
          {t.total} / {capacidad}
        </span>
        <span className="justify-self-end">
          <Pill tono={estilo.tono}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: estilo.barra }} />
            {estilo.texto}
          </Pill>
        </span>
      </div>
    );
  };

  // ───────────────── Render ─────────────────

  return (
    <div className="space-y-6">
      {/* Franja superior */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>
            {ciudades} {ciudades === 1 ? 'ciudad' : 'ciudades'} · {tecnicosActivos}{' '}
            {tecnicosActivos === 1 ? 'técnico activo' : 'técnicos activos'}
          </span>
          <span
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
              realtimeActivo ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${realtimeActivo ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {realtimeActivo ? 'Datos en tiempo real' : 'Reconectando…'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <NotificationsBell />
          <UserProfile />
        </div>
      </div>

      {/* Título */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Resumen operativo</h1>
        <p className="text-sm text-slate-500 mt-1">
          {textoFechaHoy(ahora)} · Última actualización {horaMinuto(horaActualizacion)}
          {lastUploadDate ? ` · Última carga de archivo: ${lastUploadDate}` : ''}
        </p>
      </div>

      {hayError ? (
        <div className="bg-red-50 text-red-700 p-3.5 rounded-xl border border-red-200 text-sm">
          No se pudieron cargar algunos datos del Dashboard.
        </div>
      ) : null}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard
          label="Órdenes activas"
          valor={total}
          nota={`${asignadas} asignadas · ${sinTecnico} sin técnico`}
          notaTono="blue"
          icon={ICONS.clipboard}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
        />
        <KpiCard
          label={`Pendientes ${DIAS_VENCIDA}+ días`}
          valor={vencidas}
          nota={`${pct(pctVencidas)} del trabajo activo`}
          notaTono="red"
          icon={ICONS.clock}
          iconBg="bg-rose-50"
          iconColor="text-rose-600"
        />
        <KpiCard
          label="Cerradas hoy"
          valor={cerradas}
          nota={`${efectivas} efectivas · ${incumplidas} incumplidas`}
          notaTono="green"
          icon={ICONS.check}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        <KpiCard
          label="Sin técnico asignado"
          valor={sinTecnico}
          nota={
            sinTecnico === 0
              ? 'Todas asignadas'
              : sinTecnicoEmergencias > 0
                ? `${sinTecnicoEmergencias} ${sinTecnicoEmergencias === 1 ? 'es emergencia' : 'son emergencias'}`
                : 'Ninguna es emergencia'
          }
          notaTono={sinTecnicoEmergencias > 0 ? 'amber' : 'slate'}
          icon={ICONS.userX}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
        />
      </div>

      {/* Fila 1: Carga por técnico | Localidad + Barrio apilados (así no queda hueco) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-5 items-start">
        <Panel
          titulo="Carga por técnico"
          subtitulo={
            editandoCapacidad ? (
              <span className="inline-flex items-center gap-2">
                Capacidad operativa por técnico:
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={capacidadInput}
                  onChange={(e) => setCapacidadInput(e.target.value)}
                  className="w-16 h-7 px-2 border border-slate-300 rounded-md text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={guardarCapacidad}
                  disabled={guardandoCapacidad}
                  className="px-2.5 h-7 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {guardandoCapacidad ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  onClick={() => {
                    setEditandoCapacidad(false);
                    setCapacidadInput(String(capacidad));
                  }}
                  className="px-2 h-7 text-xs text-slate-500 hover:text-slate-700"
                >
                  Cancelar
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                Órdenes asignadas frente a capacidad operativa de{' '}
                <strong className="text-slate-700">{capacidad}</strong>
                <button
                  onClick={() => setEditandoCapacidad(true)}
                  title="Cambiar capacidad"
                  className="text-slate-400 hover:text-blue-600"
                >
                  <Svg d={ICONS.pencil} className="w-3.5 h-3.5" />
                </button>
              </span>
            )
          }
          badge={
            sobreCapacidad > 0 ? (
              <Pill tono="red">
                {sobreCapacidad} {sobreCapacidad === 1 ? 'técnico sobre capacidad' : 'técnicos sobre capacidad'}
              </Pill>
            ) : (
              <Pill tono="green">Sin sobrecarga</Pill>
            )
          }
        >
          <div className="flex items-center gap-4 text-xs text-slate-500 mb-4">
            {(['sobrecarga', 'equilibrado', 'bajo'] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: ESTILO_ESTADO[k].barra }} />
                {ESTILO_ESTADO[k].texto}
              </span>
            ))}
          </div>
          {cargaTecnicos.length === 0 ? (
            <p className="text-sm text-slate-400">No hay técnicos registrados.</p>
          ) : (
            <>
              {tecnicosConCarga.length === 0 ? (
                <p className="text-sm text-slate-400">Ningún técnico tiene órdenes asignadas en este momento.</p>
              ) : (
                <div className="space-y-3.5">{tecnicosConCarga.map((t) => filaTecnico(t))}</div>
              )}
              {verTodosTecnicos && tecnicosSinCarga.length > 0 && (
                <div className="mt-3.5 pt-3.5 border-t border-slate-100 max-h-[280px] overflow-y-auto pr-1 space-y-3.5">
                  {tecnicosSinCarga.map((t) => filaTecnico(t))}
                </div>
              )}
              {tecnicosSinCarga.length > 0 && (
                <button
                  onClick={() => setVerTodosTecnicos((v) => !v)}
                  className="mt-4 w-full py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  {verTodosTecnicos
                    ? 'Ver menos'
                    : `Ver más técnicos (${tecnicosSinCarga.length} sin órdenes)`}
                </button>
              )}
            </>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel titulo="Órdenes por localidad" subtitulo={`${total} órdenes activas · de mayor a menor`}>
            <div className="space-y-4">
              {porLocalidad.length === 0 ? (
                <p className="text-sm text-slate-400">No hay órdenes activas.</p>
              ) : (
                porLocalidad.map((l) => (
                  <div key={l.nombre}>
                    <div className="flex items-center justify-between text-sm">
                      <span className={`font-medium ${l.total === 0 ? 'text-slate-400' : 'text-slate-800'}`}>{l.nombre}</span>
                      <span className={`font-semibold ${l.total === 0 ? 'text-slate-400' : 'text-slate-900'}`}>{l.total}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all duration-500"
                        style={{ width: `${(l.total / maxLocalidad) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
            {zonasConOrdenes.length > 0 && (
              <div className="mt-5">
                <Insight tono="blue">
                  {zonasConOrdenes.length === 1
                    ? `${zonasConOrdenes[0].nombre} concentra el 100% de la carga activa.`
                    : zonasConOrdenes.length === 2
                      ? `${zonasConOrdenes[0].nombre} concentra el ${pct(
                          (zonasConOrdenes[0].total / total) * 100
                        )} de la carga activa.`
                      : `${zonasConOrdenes[0].nombre} y ${zonasConOrdenes[1].nombre} concentran ${pct(
                          ((zonasConOrdenes[0].total + zonasConOrdenes[1].total) / total) * 100
                        )} de la carga activa.`}
                </Insight>
              </div>
            )}
          </Panel>

          <Panel titulo="Distribución por barrio" subtitulo="Top 5 barrios y agrupación del resto">
            {barrios.top.length === 0 ? (
              <p className="text-sm text-slate-400">No hay barrios identificados.</p>
            ) : (
              <>
                <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
                  {barrios.top.map((b, i) => (
                    <div
                      key={`${b.nombre}||${b.localidad}`}
                      title={`${b.nombre} (${b.localidad}): ${b.total}`}
                      style={{ width: `${total > 0 ? (b.total / total) * 100 : 0}%`, background: BARRIO_COLORES[i] }}
                    />
                  ))}
                  {barrios.otros > 0 && (
                    <div
                      title={`Otros: ${barrios.otros}`}
                      style={{ width: `${total > 0 ? (barrios.otros / total) * 100 : 0}%`, background: BARRIO_COLORES[5] }}
                    />
                  )}
                </div>

                <div className="mt-4 space-y-2.5 text-sm">
                  {barrios.top.map((b, i) => (
                    <div key={`${b.nombre}||${b.localidad}`} className="flex items-center justify-between gap-3 min-w-0">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BARRIO_COLORES[i] }} />
                        <span className="truncate text-slate-700" title={b.nombre}>
                          {b.nombre}
                        </span>
                        <LocalidadTag nombre={b.localidad} />
                      </span>
                      <span className="font-semibold text-slate-900">{b.total}</span>
                    </div>
                  ))}
                  {barrios.otros > 0 && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-slate-600">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BARRIO_COLORES[5] }} />
                        Otros
                        <span className="text-xs text-slate-400">
                          ({barrios.resto.length} {barrios.resto.length === 1 ? 'barrio' : 'barrios'})
                        </span>
                      </span>
                      <span className="font-semibold text-slate-900">{barrios.otros}</span>
                    </div>
                  )}
                </div>

                <p className="mt-4 text-sm text-blue-600">
                  {barrios.top[0].nombre} ({barrios.top[0].localidad}) lidera entre los barrios identificados con{' '}
                  {barrios.top[0].total} {barrios.top[0].total === 1 ? 'orden' : 'órdenes'}.
                </p>

                {verTodosBarrios && barrios.resto.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100 max-h-[300px] overflow-y-auto pr-1 space-y-2.5 text-sm">
                    {barrios.resto.map((b) => (
                      <div key={`${b.nombre}||${b.localidad}`} className="flex items-center justify-between gap-3 min-w-0">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-slate-700" title={b.nombre}>
                            {b.nombre === 'SIN BARRIO' ? 'Sin barrio registrado' : b.nombre}
                          </span>
                          <LocalidadTag nombre={b.localidad} />
                        </span>
                        <span className="font-semibold text-slate-900">{b.total}</span>
                      </div>
                    ))}
                  </div>
                )}

                {barrios.resto.length > 0 && (
                  <button
                    onClick={() => setVerTodosBarrios((v) => !v)}
                    className="mt-4 w-full py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    {verTodosBarrios ? 'Ver menos' : `Ver más barrios (${barrios.resto.length})`}
                  </button>
                )}
              </>
            )}
          </Panel>
        </div>
      </div>

      {/* Fila 2: Tipo de trabajo + Antigüedad */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-5 items-start">
        <Panel
          titulo="Distribución por tipo de trabajo"
          subtitulo={`Composición de las ${total} órdenes activas`}
          badge={
            pctPrioritarias > 0 ? <Pill tono="red">{pct(pctPrioritarias)} requiere atención prioritaria</Pill> : undefined
          }
        >
          <div className="space-y-3.5">
            {categoriasVisibles.length === 0 ? (
              <p className="text-sm text-slate-400">No hay órdenes activas.</p>
            ) : (
              categoriasVisibles.map((c) => {
                const n = porCategoria[c.key];
                return (
                  <div key={c.key} className="grid grid-cols-[170px_1fr_40px_50px] gap-x-4 items-center">
                    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                      {c.label}
                    </span>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(n / maxCategoria) * 100}%`, background: c.color }}
                      />
                    </div>
                    <span className="text-sm font-bold text-slate-900 text-right">{n}</span>
                    <span className="text-xs text-slate-400 text-right">{pct(total > 0 ? (n / total) * 100 : 0)}</span>
                  </div>
                );
              })
            )}
          </div>
          {porCategoria.otros > 0 && (
            <p className="mt-4 text-xs text-slate-400">
              &quot;Otros&quot; agrupa trabajos cuyo nombre no coincide con las categorías anteriores.
            </p>
          )}
        </Panel>

        <Panel titulo="Antigüedad de órdenes" subtitulo={`Tiempo abierto de las ${total} órdenes activas`}>
          <div className="space-y-4">
            {antiguedad.map((a) => (
              <div key={a.key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                    <span className="w-2 h-2 rounded-full" style={{ background: a.color }} />
                    {a.label}
                  </span>
                  <span>
                    <strong className="text-slate-900">{a.total}</strong>{' '}
                    <span className="text-xs text-slate-400">{pct(total > 0 ? (a.total / total) * 100 : 0)} del total</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full overflow-hidden" style={{ background: a.track }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(a.total / maxAntiguedad) * 100}%`, background: a.color }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            {vencidas > 0 ? (
              <Insight tono="red">
                {pct(pctVencidas)} de las órdenes activas lleva {DIAS_VENCIDA} días o más.
              </Insight>
            ) : (
              <Insight tono="green">Ninguna orden activa supera los {DIAS_VENCIDA - 1} días.</Insight>
            )}
          </div>
        </Panel>
      </div>

      {/* Fila 3: Flujo del día */}
      <Panel
        titulo="Flujo del día"
        subtitulo={
          creadasHoy !== null
            ? `Órdenes creadas frente a cerradas hasta las ${horaAhoraTexto}`
            : `Órdenes cerradas hasta las ${horaAhoraTexto}`
        }
        badge={estadoFlujo ? <Pill tono={estadoFlujo.tono}>{estadoFlujo.texto}</Pill> : undefined}
      >
        {creadasHoy !== null ? (
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Creadas</p>
              <p className="text-3xl font-bold text-blue-600 leading-tight">{creadas}</p>
            </div>
            <span className="text-slate-400 text-lg">−</span>
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Cerradas</p>
              <p className="text-3xl font-bold text-emerald-700 leading-tight">{cerradas}</p>
            </div>
            <span className="text-slate-400 text-lg">=</span>
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Backlog neto</p>
              <p
                className={`text-3xl font-bold leading-tight ${
                  backlogNeto > 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {backlogNeto > 0 ? `+${backlogNeto}` : backlogNeto}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 px-4 py-3 inline-block min-w-[180px]">
            <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Cerradas hoy</p>
            <p className="text-3xl font-bold text-emerald-700 leading-tight">{cerradas}</p>
          </div>
        )}

        <div className="mt-6 flex items-end gap-6">
          <div className="flex flex-col gap-1.5 text-xs text-slate-500 shrink-0 pb-6">
            {creadasHoy !== null && (
              <span className="inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-sm bg-blue-600" /> Creadas
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-emerald-700" /> Cerradas
            </span>
          </div>
          <div className="flex-1 flex items-end justify-around gap-2">
            {franjas.map((f) => (
              <div key={f.inicio} className="flex flex-col items-center">
                <div className="flex items-end gap-1 h-[76px]">
                  {creadasHoy !== null && (
                    <div
                      title={`${f.creadas} creadas`}
                      className="w-3.5 rounded-t"
                      style={{ height: altoBarra(f.creadas), background: '#2563EB' }}
                    />
                  )}
                  <div
                    title={`${f.cerradas} cerradas`}
                    className="w-3.5 rounded-t"
                    style={{ height: altoBarra(f.cerradas), background: '#15803D' }}
                  />
                </div>
                <span className="mt-2 text-[11px] text-slate-400 whitespace-nowrap">{f.etiqueta}</span>
              </div>
            ))}
          </div>
        </div>
        {creadasHoy === null && (
          <p className="mt-4 text-xs text-slate-400">
            Para ver también las órdenes creadas, falta registrar la hora de entrada de cada orden (columna creado_en).
          </p>
        )}
      </Panel>

      {/* Mapa de calor */}
      <Panel
        titulo="Mapa de calor operativo"
        subtitulo="Concentración de órdenes por localidad y tipo de trabajo"
        badge={
          topEmergencias ? (
            <Pill tono="red">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Más emergencias en {topEmergencias.nombre} ({topEmergencias.n})
            </Pill>
          ) : undefined
        }
      >
        {heat.filas.length === 0 ? (
          <p className="text-sm text-slate-400">No hay órdenes activas.</p>
        ) : (
          <>
            <div
              className="grid gap-2 items-center"
              style={{ gridTemplateColumns: `minmax(150px, 1.1fr) repeat(${categoriasVisibles.length}, minmax(0, 1fr))` }}
            >
              <span className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Localidad</span>
              {categoriasVisibles.map((c) => (
                <span key={c.key} className="text-xs text-slate-500 text-center">
                  {c.label}
                </span>
              ))}
              {heat.filas.map((f) => (
                <React.Fragment key={f.nombre}>
                  <div className="flex items-baseline justify-between gap-2 pr-2">
                    <span className="text-sm font-semibold text-slate-900">{f.nombre}</span>
                    <span className="text-xs text-slate-400">{f.total} total</span>
                  </div>
                  {f.celdas.map((v, i) => (
                    <div
                      key={categoriasVisibles[i].key}
                      className="h-11 rounded-lg flex items-center justify-center text-sm font-bold"
                      style={ESTILO_CELDA[nivelCelda(v)]}
                    >
                      {v}
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Pill tono="green">Normal</Pill>
                <Pill tono="amber">Atención</Pill>
                <Pill tono="red">Crítico</Pill>
                <span className="text-xs text-slate-400">Intensidad relativa a la mayor concentración</span>
              </div>
              <span className="text-xs text-slate-400">
                Totales por columna: {categoriasVisibles.map((c) => porCategoria[c.key]).join(' · ')}
              </span>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
