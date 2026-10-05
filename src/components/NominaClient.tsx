'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { saveAs } from 'file-saver';
import type { Cell, Worksheet } from 'exceljs';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';

// ───────────────────────── Tipos ─────────────────────────

type Tecnico = {
  id_usuario: string;
  nombre: string;
};

type FilaItem = {
  tecnicoId: string | null;
  ordenTrabajo: string;
  contrato: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  totalFactura: number;
  totalTecnico: number;
  fechaCierre: string | null; // YYYY-MM-DD en hora de Colombia
};

type FilaConNombre = FilaItem & { tecnico: string };

type ResumenTecnico = {
  tecnico: string;
  contratos: number;
  items: number;
  totalFactura: number;
  totalTecnico: number;
  participacion: number; // 0–100
};

type Totales = { total: number; ordenes: number; items: number };

type FiltrosAplicados = { start: string; end: string; tecnicoId: string };

// ───────────────────────── Helpers ─────────────────────────

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n: number) => String(n).padStart(2, '0');
const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISODate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};
const diffDays = (a: string, b: string) =>
  Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86400000);

const fechaCorta = (s: string) => {
  const [, m, d] = s.split('-');
  return `${d} ${MESES_CORTOS[Number(m) - 1]}`;
};
const fechaLarga = (s: string) => {
  const [, m, d] = s.split('-');
  return `${d} de ${MESES_LARGOS[Number(m) - 1]}`;
};

const money = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const pct1 = (n: number) =>
  `${n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const num2 = (n: number) =>
  n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactMoney = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`
    : `$${Math.round(n / 1000).toLocaleString('es-CO')} mil`;

const nombreBonito = (n: string) => n.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const iniciales = (n: string) =>
  n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

const hoyColombia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const fechaColombia = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const textoActualizado = (d: Date) => {
  const f = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const hora = d.toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${fechaCorta(f)} ${f.split('-')[0]} · ${hora}`;
};

const variacionPct = (actual: number, previo: number): number | null =>
  previo > 0 ? ((actual - previo) / previo) * 100 : null;

/** Quincena actual (offset 0) o anterior (offset -1), en hora de Colombia. */
const rangoQuincena = (offset: 0 | -1) => {
  const [y, m, d] = hoyColombia().split('-').map(Number);
  const idx = y * 24 + (m - 1) * 2 + (d <= 15 ? 0 : 1) + offset;
  const yy = Math.floor(idx / 24);
  const mm = Math.floor((idx % 24) / 2);
  const segunda = idx % 2 === 1;
  const ultimo = new Date(yy, mm + 1, 0).getDate();
  return segunda
    ? { start: `${yy}-${pad(mm + 1)}-16`, end: `${yy}-${pad(mm + 1)}-${pad(ultimo)}` }
    : { start: `${yy}-${pad(mm + 1)}-01`, end: `${yy}-${pad(mm + 1)}-15` };
};

// ───────────────────────── Iconos ─────────────────────────

const ICONS = {
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  users: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  sliders: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  dollar: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  list: 'M9 5h11M9 12h11M9 19h11M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2',
  trophy: 'M8 21h8m-4-4v4m-5-17h10v5a5 5 0 01-10 0V4zm10 1h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3',
  crown: 'M5 16L3 6l5.5 4L12 4l3.5 6L21 6l-2 10H5zm0 3h14',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  trend: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  columns: 'M9 4v16M15 4v16M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z',
  chevronL: 'M15 19l-7-7 7-7',
  chevronR: 'M9 5l7 7-7 7',
  chevronD: 'M19 9l-7 7-7-7',
};

function Svg({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// ───────────────────────── Subcomponentes ─────────────────────────

function DeltaBadge({ value, kind }: { value: number | null; kind: 'pct' | 'abs' }) {
  if (value === null) return null;
  const up = value > 0;
  const down = value < 0;
  const color = up
    ? 'bg-emerald-50 text-emerald-600'
    : down
      ? 'bg-rose-50 text-rose-600'
      : 'bg-slate-100 text-slate-500';
  const arrow = up ? '\u2191' : down ? '\u2193' : '\u2192';
  const abs = Math.abs(value);
  const label = kind === 'pct' ? pct1(abs) : abs.toLocaleString('es-CO');
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${color}`}
      title="Frente al periodo anterior de igual duraci\u00f3n"
    >
      {arrow} {label}
    </span>
  );
}

function KpiCard({
  label,
  icon,
  iconBg,
  iconColor,
  caption,
  children,
}: {
  label: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  caption: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-slate-500">{label}</p>
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg} ${iconColor}`}>
          <Svg d={icon} className="w-[18px] h-[18px]" />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">{children}</div>
      <p className="mt-2 text-sm text-slate-400">{caption}</p>
    </div>
  );
}

function TooltipDia({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { fecha: string; total: number } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg">
      <p className="text-slate-300">{fechaLarga(p.fecha)}</p>
      <p className="font-semibold">{money(p.total)}</p>
    </div>
  );
}

// ───────────────────────── Componente principal ─────────────────────────

export default function NominaClient() {
  // Filtros en edición (se aplican al pulsar "Aplicar")
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [draftTecnico, setDraftTecnico] = useState(''); // id_usuario; '' = todos
  const [applied, setApplied] = useState<FiltrosAplicados | null>(null);

  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [filas, setFilas] = useState<FilaItem[]>([]);
  const [totalesPrevios, setTotalesPrevios] = useState<Totales | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<Date | null>(null);

  // Tabla de detalle
  const PAGE_SIZE = 10;
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [cols, setCols] = useState({
    contratos: true,
    items: true,
    totalFactura: true,
    totalTecnico: true,
    participacion: true,
  });
  const [menuColsAbierto, setMenuColsAbierto] = useState(false);
  const menuColsRef = useRef<HTMLDivElement>(null);

  // ── Técnicos para el filtro ──
  useEffect(() => {
    const fetchTecnicos = async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id_usuario, nombre')
        .in('rol', ['Técnico', 'Supervisor'])
        .order('nombre', { ascending: true });
      if (!error && data) setTecnicos(data);
    };
    fetchTecnicos();
  }, []);

  // ── Al entrar: quincena actual aplicada ──
  useEffect(() => {
    const r = rangoQuincena(0);
    setDraftStart(r.start);
    setDraftEnd(r.end);
    setApplied({ start: r.start, end: r.end, tecnicoId: '' });
  }, []);

  // ── Cerrar menú de columnas al hacer clic afuera ──
  useEffect(() => {
    if (!menuColsAbierto) return;
    const onDown = (e: MouseEvent) => {
      if (menuColsRef.current && !menuColsRef.current.contains(e.target as Node)) {
        setMenuColsAbierto(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuColsAbierto]);

  // ── Consulta de un periodo: órdenes Efectivas cerradas + sus ítems ──
  const cargarPeriodo = useCallback(
    async (start: string, end: string, tecnicoId: string): Promise<FilaItem[]> => {
      let query = supabase
        .from('ordenes')
        .select('orden_trabajo, contrato, fecha_cierre, id_tecnico_asignado')
        .eq('estado', 'Efectiva')
        .gte('fecha_cierre', `${start}T00:00:00-05:00`)
        .lte('fecha_cierre', `${end}T23:59:59.999-05:00`);
      if (tecnicoId) query = query.eq('id_tecnico_asignado', tecnicoId);

      const { data: ordenesData, error: ordenesError } = await query;
      if (ordenesError) throw ordenesError;
      if (!ordenesData || ordenesData.length === 0) return [];

      const ids: string[] = ordenesData.map((o) => o.orden_trabajo);
      const trozos: string[][] = [];
      for (let i = 0; i < ids.length; i += 150) trozos.push(ids.slice(i, i + 150));

      const respuestas = await Promise.all(
        trozos.map((t) =>
          supabase
            .from('items_reporte')
            .select('orden_trabajo, codigo, descripcion, precio_unitario, cantidad, subtotal')
            .in('orden_trabajo', t)
        )
      );
      const items = respuestas.flatMap((r) => {
        if (r.error) throw r.error;
        return r.data ?? [];
      });

      const ordenesMap = new Map<string, { contrato: string; fecha_cierre: string | null; id_tecnico_asignado: string | null }>();
      ordenesData.forEach((o) => ordenesMap.set(o.orden_trabajo, o));

      return items.map((it): FilaItem => {
        const o = ordenesMap.get(it.orden_trabajo);
        return {
          tecnicoId: o?.id_tecnico_asignado ?? null,
          ordenTrabajo: it.orden_trabajo,
          contrato: o?.contrato ?? '',
          codigo: it.codigo,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          precioUnitario: Number(it.precio_unitario),
          totalFactura: Number(it.subtotal),
          totalTecnico: Number(it.subtotal), // por ahora igual al valor de factura
          fechaCierre: o?.fecha_cierre ? fechaColombia(o.fecha_cierre) : null,
        };
      });
    },
    []
  );

  // ── Carga principal (periodo aplicado + periodo anterior de igual duración) ──
  useEffect(() => {
    if (!applied) return;
    let cancelado = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const hoy = hoyColombia();
        const finEfectivo = applied.end < hoy ? applied.end : hoy;
        const largo = Math.max(diffDays(applied.start, finEfectivo) + 1, 1);
        const prevEnd = addDays(applied.start, -1);
        const prevStart = addDays(prevEnd, -(largo - 1));

        const [actual, previo] = await Promise.all([
          cargarPeriodo(applied.start, applied.end, applied.tecnicoId),
          cargarPeriodo(prevStart, prevEnd, applied.tecnicoId),
        ]);
        if (cancelado) return;

        setFilas(actual);
        setTotalesPrevios({
          total: previo.reduce((s, f) => s + f.totalTecnico, 0),
          ordenes: new Set(previo.map((f) => f.ordenTrabajo)).size,
          items: previo.length,
        });
        setActualizado(new Date());
        setPagina(1);
      } catch (e) {
        console.error('Error al cargar nómina:', e);
        if (!cancelado) setError('No se pudo cargar la información de nómina.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    };

    run();
    return () => {
      cancelado = true;
    };
  }, [applied, cargarPeriodo]);

  // ── Datos derivados ──
  const nombrePorId = useMemo(
    () => Object.fromEntries(tecnicos.map((t) => [t.id_usuario, nombreBonito(t.nombre)])),
    [tecnicos]
  );

  const filasN: FilaConNombre[] = useMemo(
    () =>
      filas.map((f) => ({
        ...f,
        tecnico: f.tecnicoId ? (nombrePorId[f.tecnicoId] ?? f.tecnicoId) : 'Sin asignar',
      })),
    [filas, nombrePorId]
  );

  const totalEjecutado = useMemo(() => filasN.reduce((s, f) => s + f.totalTecnico, 0), [filasN]);
  const totalFacturaGlobal = useMemo(() => filasN.reduce((s, f) => s + f.totalFactura, 0), [filasN]);
  const totalOrdenes = useMemo(() => new Set(filasN.map((f) => f.ordenTrabajo)).size, [filasN]);
  const totalContratos = useMemo(() => new Set(filasN.map((f) => f.contrato)).size, [filasN]);
  const totalItems = filasN.length;

  const resumen: ResumenTecnico[] = useMemo(() => {
    const mapa = new Map<
      string,
      { contratos: Set<string>; items: number; totalFactura: number; totalTecnico: number }
    >();
    filasN.forEach((f) => {
      const actual = mapa.get(f.tecnico) ?? {
        contratos: new Set<string>(),
        items: 0,
        totalFactura: 0,
        totalTecnico: 0,
      };
      actual.contratos.add(f.contrato);
      actual.items += 1;
      actual.totalFactura += f.totalFactura;
      actual.totalTecnico += f.totalTecnico;
      mapa.set(f.tecnico, actual);
    });
    return Array.from(mapa.entries())
      .map(([tecnico, v]) => ({
        tecnico,
        contratos: v.contratos.size,
        items: v.items,
        totalFactura: v.totalFactura,
        totalTecnico: v.totalTecnico,
        participacion: totalEjecutado > 0 ? (v.totalTecnico / totalEjecutado) * 100 : 0,
      }))
      .sort((a, b) => b.totalTecnico - a.totalTecnico);
  }, [filasN, totalEjecutado]);

  const lider = resumen[0];
  const maxTecnico = Math.max(lider?.totalTecnico ?? 0, 1);

  // Días analizados: desde el inicio del rango hasta hoy (o fin del rango si ya pasó)
  const diasAnalizados = useMemo(() => {
    if (!applied) return [];
    const hoy = hoyColombia();
    const fin = applied.end < hoy ? applied.end : hoy;
    const dias: string[] = [];
    for (let d = applied.start; d <= fin && dias.length < 400; d = addDays(d, 1)) dias.push(d);
    return dias;
  }, [applied]);

  const serieDiaria = useMemo(() => {
    const mapa: Record<string, number> = {};
    filasN.forEach((f) => {
      if (f.fechaCierre) mapa[f.fechaCierre] = (mapa[f.fechaCierre] ?? 0) + f.totalTecnico;
    });
    return diasAnalizados.map((d) => ({ fecha: d, label: fechaCorta(d), total: mapa[d] ?? 0 }));
  }, [filasN, diasAnalizados]);

  const promedioDiario = serieDiaria.length > 0 ? totalEjecutado / serieDiaria.length : 0;
  const idxTop = serieDiaria.reduce(
    (best, d, i) => (best === -1 || d.total > serieDiaria[best].total ? i : best),
    -1
  );
  const diaTop = idxTop >= 0 ? serieDiaria[idxTop] : null;
  const ultimoDia = serieDiaria.length > 0 ? serieDiaria[serieDiaria.length - 1] : null;
  const ultimoEsHoy = ultimoDia?.fecha === hoyColombia(); // el día de hoy puede estar incompleto

  const crecimientoSostenido =
    serieDiaria.length >= 2 && serieDiaria.every((d, i) => i === 0 || d.total > serieDiaria[i - 1].total);
  const descensoSostenido =
    serieDiaria.length >= 2 &&
    !ultimoEsHoy &&
    serieDiaria.every((d, i) => i === 0 || d.total < serieDiaria[i - 1].total);
  const tendencia: 'up' | 'down' | 'flat' =
    serieDiaria.length < 2
      ? 'flat'
      : ultimoDia && ultimoDia.total > serieDiaria[0].total
        ? 'up'
        : ultimoDia && ultimoDia.total < serieDiaria[0].total && !ultimoEsHoy
          ? 'down'
          : 'flat';

  const textoDias = useMemo(() => {
    if (serieDiaria.length === 0) return '';
    const primero = serieDiaria[0].fecha;
    const ultimo = serieDiaria[serieDiaria.length - 1].fecha;
    if (serieDiaria.length <= 3 && primero.slice(0, 7) === ultimo.slice(0, 7)) {
      const dias = serieDiaria.map((d) => d.fecha.split('-')[2]);
      const lista =
        dias.length > 1 ? `${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1]}` : dias[0];
      return `${lista} de ${MESES_LARGOS[Number(ultimo.split('-')[1]) - 1]}`;
    }
    return primero === ultimo ? fechaLarga(primero) : `del ${fechaLarga(primero)} al ${fechaLarga(ultimo)}`;
  }, [serieDiaria]);

  // Variaciones frente al periodo anterior de igual duración
  const deltaTotal = totalesPrevios ? variacionPct(totalEjecutado, totalesPrevios.total) : null;
  const deltaOrdenes =
    totalesPrevios && totalesPrevios.ordenes > 0 ? totalOrdenes - totalesPrevios.ordenes : null;
  const deltaItems = totalesPrevios ? variacionPct(totalItems, totalesPrevios.items) : null;

  // Tabla de detalle: búsqueda + paginación
  const resumenFiltrado = useMemo(
    () => resumen.filter((r) => r.tecnico.toLowerCase().includes(busqueda.trim().toLowerCase())),
    [resumen, busqueda]
  );
  const totalPaginas = Math.max(Math.ceil(resumenFiltrado.length / PAGE_SIZE), 1);
  const paginaActual = Math.min(pagina, totalPaginas);
  const filasPagina = resumenFiltrado.slice((paginaActual - 1) * PAGE_SIZE, paginaActual * PAGE_SIZE);

  // ── Acciones ──
  const aplicarFiltros = () => {
    if (!draftStart || !draftEnd || draftStart > draftEnd) return;
    setApplied({ start: draftStart, end: draftEnd, tecnicoId: draftTecnico });
  };

  const aplicarQuincena = (offset: 0 | -1) => {
    const r = rangoQuincena(offset);
    setDraftStart(r.start);
    setDraftEnd(r.end);
    setApplied({ start: r.start, end: r.end, tecnicoId: draftTecnico });
  };

  const exportarExcel = async () => {
    if (!applied) return;

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HLGAS';
    wb.created = new Date();

    // ── Estilos compartidos ──
    const FUENTE = 'Arial';
    const AZUL_ENCABEZADO = 'FF1A4D8F';
    const FORMATO_MONEDA = '"$"#,##0';
    const FORMATO_FECHA = 'dd/mm/yyyy';
    const linea = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
    const bordes = { top: linea, left: linea, bottom: linea, right: linea };
    const zebra = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF8FAFC' } };

    const estiloEncabezado = (c: Cell) => {
      c.font = { name: FUENTE, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_ENCABEZADO } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = bordes;
    };

    const titulo = (ws: Worksheet, rango: string, texto: string) => {
      ws.mergeCells(rango);
      const c = ws.getCell(rango.split(':')[0]);
      c.value = texto;
      c.font = { name: FUENTE, size: 14, bold: true, color: { argb: 'FF1A3A6B' } };
    };

    const metaFila = (ws: Worksheet, fila: number, etiqueta: string, valor: string | Date, esFecha = false) => {
      const a = ws.getCell(fila, 1);
      a.value = etiqueta;
      a.font = { name: FUENTE, size: 10, color: { argb: 'FF6B7280' } };
      const b = ws.getCell(fila, 2);
      b.value = valor;
      b.font = { name: FUENTE, size: 10, bold: true };
      b.alignment = { horizontal: 'left' };
      if (esFecha) b.numFmt = FORMATO_FECHA;
    };

    const dmy = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    };
    const aFechaExcel = (s: string | null) => {
      if (!s) return '';
      const [y, m, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };

    const periodoTexto = `${dmy(applied.start)} al ${dmy(applied.end)}`;
    const tecnicoTexto = applied.tecnicoId
      ? (nombrePorId[applied.tecnicoId] ?? 'Técnico seleccionado')
      : 'Todos los técnicos';

    // ═════════════════ Hoja "Resumen" ═════════════════
    const wsR = wb.addWorksheet('Resumen');
    titulo(wsR, 'A1:E1', 'NÓMINA TÉCNICOS — RESUMEN POR TÉCNICO');
    metaFila(wsR, 2, 'Periodo (quincena):', periodoTexto);
    metaFila(wsR, 3, 'Generado el:', new Date(), true);
    metaFila(wsR, 4, 'Técnico:', tecnicoTexto);

    ['Técnico', '# Contratos', '# Ítems', 'Total Factura', 'Total Técnico'].forEach((h, i) => {
      const c = wsR.getCell(5, i + 1);
      c.value = h;
      estiloEncabezado(c);
    });

    resumen.forEach((r, i) => {
      const fila = 6 + i;
      [r.tecnico, r.contratos, r.items, r.totalFactura, r.totalTecnico].forEach((v, j) => {
        const c = wsR.getCell(fila, j + 1);
        c.value = v;
        c.font = { name: FUENTE, size: 10 };
        c.border = bordes;
        if (j === 1 || j === 2) c.alignment = { horizontal: 'center' };
        if (j >= 3) c.numFmt = FORMATO_MONEDA;
        if (i % 2 === 1) c.fill = zebra;
      });
    });

    const filaTotal = 6 + resumen.length;
    ['TOTAL FINAL', totalContratos, totalItems, totalFacturaGlobal, totalEjecutado].forEach((v, j) => {
      const c = wsR.getCell(filaTotal, j + 1);
      c.value = v;
      c.font = { name: FUENTE, size: 10, bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF59D' } };
      c.border = bordes;
      if (j === 1 || j === 2) c.alignment = { horizontal: 'center' };
      if (j >= 3) c.numFmt = FORMATO_MONEDA;
    });

    [24, 14, 12, 18, 18].forEach((w, i) => {
      wsR.getColumn(i + 1).width = w;
    });
    wsR.views = [{ state: 'frozen', ySplit: 5 }];

    // ═════════════════ Hoja "Detalle" ═════════════════
    const wsD = wb.addWorksheet('Detalle');
    titulo(wsD, 'A1:I1', 'NÓMINA TÉCNICOS — DETALLE DE ÍTEMS EJECUTADOS');
    metaFila(wsD, 2, 'Periodo (quincena):', periodoTexto);

    wsD.mergeCells('A3:I3');
    const nota = wsD.getCell('A3');
    nota.value =
      'Nota: "Total Técnico" hoy es igual a "Total Factura" (valor cliente por código), porque aún no está ' +
      'cargada la tarifa que se le paga al técnico por código. Cuando se defina, solo cambia el cálculo de esa columna.';
    nota.font = { name: FUENTE, size: 9, italic: true, color: { argb: 'FF9CA3AF' } };
    nota.alignment = { wrapText: true, vertical: 'top' };
    wsD.getRow(3).height = 30;

    ['Técnico', 'Contrato', 'Código', 'Descripción', 'Cantidad', 'Precio Unitario', 'Total Factura', 'Total Técnico', 'Fecha Cierre'].forEach((h, i) => {
      const c = wsD.getCell(5, i + 1);
      c.value = h;
      estiloEncabezado(c);
    });

    // Ordenado por técnico, luego contrato, luego fecha (así cada contrato queda junto)
    const detalleOrdenado = [...filasN].sort(
      (a, b) =>
        a.tecnico.localeCompare(b.tecnico) ||
        a.contrato.localeCompare(b.contrato, undefined, { numeric: true }) ||
        (a.fechaCierre ?? '').localeCompare(b.fechaCierre ?? '')
    );

    detalleOrdenado.forEach((f, i) => {
      const fila = 6 + i;
      [
        f.tecnico,
        f.contrato,
        f.codigo,
        f.descripcion,
        f.cantidad,
        f.precioUnitario,
        f.totalFactura,
        f.totalTecnico,
        aFechaExcel(f.fechaCierre),
      ].forEach((v, j) => {
        const c = wsD.getCell(fila, j + 1);
        c.value = v;
        c.font = { name: FUENTE, size: 10 };
        c.border = bordes;
        if (j === 4) c.alignment = { horizontal: 'center' };
        if (j >= 5 && j <= 7) c.numFmt = FORMATO_MONEDA;
        if (j === 8) {
          c.numFmt = FORMATO_FECHA;
          c.alignment = { horizontal: 'center' };
        }
        if (i % 2 === 1) c.fill = zebra;
      });
    });

    [24, 14, 14, 40, 10, 16, 16, 16, 14].forEach((w, i) => {
      wsD.getColumn(i + 1).width = w;
    });
    wsD.views = [{ state: 'frozen', ySplit: 5 }];
    wsD.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5 + Math.max(detalleOrdenado.length, 1), column: 9 },
    };
    wsD.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

    // ── Descargar ──
    const buffer = await wb.xlsx.writeBuffer();
    saveAs(
      new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Nomina_${applied.start}_a_${applied.end}.xlsx`
    );
  };

  // Etiqueta con el valor sobre el punto de mayor producción
  const renderEtiquetaPico = (props: { x?: number | string; y?: number | string; index?: number }) => {
    const { x, y, index } = props;
    if (index !== idxTop || !diaTop || diaTop.total <= 0) return <g />;
    const cx = Number(x);
    const cy = Number(y);
    const texto = money(diaTop.total);
    const w = texto.length * 7.2 + 20;
    return (
      <g>
        <rect x={cx - w / 2} y={cy - 38} width={w} height={24} rx={8} fill="#0F172A" />
        <text x={cx} y={cy - 22} textAnchor="middle" fill="#FFFFFF" fontSize={12} fontWeight={600}>
          {texto}
        </text>
      </g>
    );
  };

  const colorBarra = (valor: number) => {
    const r = valor / maxTecnico;
    if (r >= 0.6) return 'bg-blue-600';
    if (r >= 0.3) return 'bg-sky-500';
    return 'bg-teal-600';
  };

  const columnasConfig: { key: keyof typeof cols; label: string }[] = [
    { key: 'contratos', label: 'Contratos' },
    { key: 'items', label: 'Ítems' },
    { key: 'totalFactura', label: 'Total factura' },
    { key: 'totalTecnico', label: 'Total técnico' },
    { key: 'participacion', label: 'Participación' },
  ];

  const primeraCarga = loading && filas.length === 0 && !actualizado;

  return (
    <div className="space-y-6">
      {/* ── Encabezado ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-medium text-slate-900 tracking-tight">Nómina</h1>
          <p className="text-base text-slate-500 mt-1">
            Producción de técnicos por periodo, con exportación a Excel
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={exportarExcel}
            disabled={filasN.length === 0}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Svg d={ICONS.download} className="w-[18px] h-[18px]" />
            Descargar Excel
          </button>
          <div className="h-8 w-px bg-slate-200" />
          <NotificationsBell />
          <UserProfile />
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1.5">Desde</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <Svg d={ICONS.calendar} className="w-4 h-4" />
            </span>
            <input
              type="date"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              className="h-11 w-[190px] pl-10 pr-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1.5">Hasta</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <Svg d={ICONS.calendar} className="w-4 h-4" />
            </span>
            <input
              type="date"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              className="h-11 w-[190px] pl-10 pr-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1.5">Técnico</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <Svg d={ICONS.users} className="w-4 h-4" />
            </span>
            <select
              value={draftTecnico}
              onChange={(e) => setDraftTecnico(e.target.value)}
              className="h-11 w-[300px] appearance-none pl-10 pr-9 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos los técnicos</option>
              {tecnicos.map((t) => (
                <option key={t.id_usuario} value={t.id_usuario}>
                  {nombreBonito(t.nombre)}
                </option>
              ))}
            </select>
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <Svg d={ICONS.chevronD} className="w-4 h-4" />
            </span>
          </div>
        </div>
        <button
          onClick={aplicarFiltros}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium shadow-sm transition-colors"
        >
          <Svg d={ICONS.sliders} className="w-4 h-4" />
          Aplicar
        </button>
        <div className="flex items-center gap-2 h-11">
          <button
            onClick={() => aplicarQuincena(0)}
            className="px-3 h-9 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50"
          >
            Quincena actual
          </button>
          <button
            onClick={() => aplicarQuincena(-1)}
            className="px-3 h-9 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50"
          >
            Quincena anterior
          </button>
        </div>
        {actualizado && (
          <p className="ml-auto text-xs text-slate-400 pb-3">Actualizado: {textoActualizado(actualizado)}</p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200">{error}</div>
      )}

      {primeraCarga ? (
        <div className="flex items-center justify-center py-24">
          <svg className="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
          {/* ── KPIs ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            <KpiCard
              label="Total ejecutado"
              icon={ICONS.dollar}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
              caption="Total ejecutado en el período"
            >
              <span className="text-3xl font-medium text-slate-900 tracking-tight">{money(totalEjecutado)}</span>
              <DeltaBadge value={deltaTotal} kind="pct" />
            </KpiCard>

            <KpiCard
              label="Órdenes efectivas"
              icon={ICONS.clipboard}
              iconBg="bg-emerald-50"
              iconColor="text-emerald-600"
              caption={`${num2(serieDiaria.length > 0 ? totalOrdenes / serieDiaria.length : 0)} órdenes por día`}
            >
              <span className="text-3xl font-medium text-slate-900 tracking-tight">{totalOrdenes}</span>
              <DeltaBadge value={deltaOrdenes} kind="abs" />
            </KpiCard>

            <KpiCard
              label="Ítems ejecutados"
              icon={ICONS.list}
              iconBg="bg-sky-50"
              iconColor="text-sky-600"
              caption={`${num2(totalOrdenes > 0 ? totalItems / totalOrdenes : 0)} ítems por orden`}
            >
              <span className="text-3xl font-medium text-slate-900 tracking-tight">{totalItems}</span>
              <DeltaBadge value={deltaItems} kind="pct" />
            </KpiCard>

            <KpiCard
              label="Mayor producción"
              icon={ICONS.trophy}
              iconBg="bg-amber-50"
              iconColor="text-amber-600"
              caption={
                lider ? `${money(lider.totalTecnico)} · ${pct1(lider.participacion)} del total` : 'Sin producción en el período'
              }
            >
              <span className="text-3xl font-medium text-slate-900 tracking-tight">{lider?.tecnico ?? '—'}</span>
              {lider && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-600">
                  Líder
                </span>
              )}
            </KpiCard>
          </div>

          {filasN.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-14 text-center text-slate-500">
              No hay ítems ejecutados en el periodo y filtros seleccionados.
            </div>
          ) : (
            <>
              {/* ── Producción por técnico ── */}
              <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">Producción por técnico</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Comparativo de monto ejecutado, participación y volumen operativo
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 text-xs font-medium text-slate-600">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    Total: {money(totalEjecutado)}
                  </span>
                </div>

                <div className="mt-6 grid grid-cols-[200px_1fr_130px_110px] gap-x-4 items-center text-[11px] uppercase tracking-wide text-slate-400">
                  <span>Técnico</span>
                  <div className="flex justify-between normal-case tracking-normal">
                    <span>$0</span>
                    <span>{compactMoney(maxTecnico / 2)}</span>
                    <span>{compactMoney(maxTecnico)}</span>
                  </div>
                  <span />
                  <span className="text-right">Participación</span>
                </div>

                <div className="mt-3 space-y-4">
                  {resumen.map((r, i) => (
                    <div key={r.tecnico} className="grid grid-cols-[200px_1fr_130px_110px] gap-x-4 items-center">
                      <div className="flex items-center gap-3 min-w-0">
                        {i === 0 ? (
                          <span className="w-7 h-7 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center">
                            <Svg d={ICONS.crown} className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <span className="w-7 h-7 shrink-0 rounded-full bg-slate-100 flex items-center justify-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          </span>
                        )}
                        <span className="text-sm font-semibold text-slate-900 truncate" title={r.tecnico}>
                          {r.tecnico}
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${colorBarra(r.totalTecnico)}`}
                          style={{ width: `${(r.totalTecnico / maxTecnico) * 100}%` }}
                        />
                      </div>
                      <span className="text-[13px] text-slate-700 font-mono tabular-nums text-right">
                        {money(r.totalTecnico)}
                      </span>
                      <div className="text-right leading-tight">
                        <p className="text-sm font-semibold text-slate-900">{pct1(r.participacion)}</p>
                        <p className="text-xs text-slate-400">
                          {r.contratos} {r.contratos === 1 ? 'contrato' : 'contratos'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center gap-2 text-sm text-slate-500">
                  <span className="text-blue-600">
                    <Svg d={ICONS.info} className="w-4 h-4" />
                  </span>
                  {resumen.length > 1
                    ? `${lider.tecnico} concentra el ${pct1(lider.participacion)} de la producción. Los ${resumen.length} técnicos suman ${money(totalEjecutado)} en el período.`
                    : `${lider.tecnico} es el único técnico con producción en el período: ${money(totalEjecutado)}.`}
                </div>
              </section>

              {/* ── Producción por día ── */}
              <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">Producción por día</h2>
                    <p className="text-sm text-slate-500 mt-1">Evolución diaria del total ejecutado: {textoDias}</p>
                  </div>
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 text-xs font-medium text-slate-600">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    {serieDiaria.length} {serieDiaria.length === 1 ? 'día analizado' : 'días analizados'}
                  </span>
                </div>

                <div className="mt-6 flex flex-col lg:flex-row gap-6">
                  <div className="flex-1 h-[280px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={serieDiaria} margin={{ top: 40, right: 24, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#E2E8F0" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          minTickGap={16}
                          tick={{ fill: '#94A3B8', fontSize: 12 }}
                        />
                        <YAxis
                          width={60}
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 'auto']}
                          tick={{ fill: '#94A3B8', fontSize: 12 }}
                          tickFormatter={(v: number) =>
                            `$${(v / 1_000_000).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`
                          }
                        />
                        <Tooltip content={<TooltipDia />} cursor={{ stroke: '#CBD5E1' }} />
                        <Line
                          type="monotone"
                          dataKey="total"
                          stroke="#1D4ED8"
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: '#FFFFFF', stroke: '#1D4ED8', strokeWidth: 2 }}
                          activeDot={{ r: 5 }}
                          label={renderEtiquetaPico}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="lg:w-[320px] lg:border-l lg:border-slate-100 lg:pl-6 space-y-5">
                    <div>
                      <p className="text-sm text-slate-500">Promedio diario</p>
                      <p className="text-3xl font-medium text-slate-900 tracking-tight mt-1">{money(promedioDiario)}</p>
                      {tendencia === 'up' && (
                        <p className="text-sm text-emerald-600 mt-1">{'\u2191'} Tendencia al alza en el período</p>
                      )}
                      {tendencia === 'down' && (
                        <p className="text-sm text-rose-600 mt-1">{'\u2193'} Tendencia a la baja en el período</p>
                      )}
                    </div>
                    {diaTop && diaTop.total > 0 && (
                      <div>
                        <p className="text-sm text-slate-500">Día de mayor producción</p>
                        <p className="text-xl font-semibold text-slate-900 mt-1">{fechaLarga(diaTop.fecha)}</p>
                        <p className="text-sm text-slate-400 mt-0.5">
                          {money(diaTop.total)} · {pct1(totalEjecutado > 0 ? (diaTop.total / totalEjecutado) * 100 : 0)} del período
                        </p>
                      </div>
                    )}
                    {crecimientoSostenido && (
                      <div className="flex items-start gap-2 rounded-xl bg-blue-50 text-blue-700 text-sm p-3">
                        <Svg d={ICONS.trend} className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>Crecimiento sostenido: cada día superó al anterior en producción.</span>
                      </div>
                    )}
                    {descensoSostenido && (
                      <div className="flex items-start gap-2 rounded-xl bg-rose-50 text-rose-700 text-sm p-3">
                        <Svg d={ICONS.trend} className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>Producción en descenso: cada día fue menor al anterior.</span>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* ── Detalle por técnico ── */}
              <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="flex items-start justify-between gap-4 p-7 pb-5">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">Detalle por técnico</h2>
                    <p className="text-sm text-slate-500 mt-1">Desglose de contratos, ítems y valores ejecutados</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                        <Svg d={ICONS.search} className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        placeholder="Buscar técnico"
                        value={busqueda}
                        onChange={(e) => {
                          setBusqueda(e.target.value);
                          setPagina(1);
                        }}
                        className="h-10 w-[260px] pl-9 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="relative" ref={menuColsRef}>
                      <button
                        onClick={() => setMenuColsAbierto((v) => !v)}
                        title="Columnas visibles"
                        className="h-10 w-10 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex items-center justify-center"
                      >
                        <Svg d={ICONS.columns} className="w-[18px] h-[18px]" />
                      </button>
                      {menuColsAbierto && (
                        <div className="absolute right-0 top-full mt-2 z-20 w-52 bg-white border border-slate-200 rounded-xl shadow-lg p-2">
                          {columnasConfig.map((c) => (
                            <label
                              key={c.key}
                              className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={cols[c.key]}
                                onChange={() => setCols((prev) => ({ ...prev, [c.key]: !prev[c.key] }))}
                                className="rounded"
                              />
                              {c.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-y border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-3 px-7 font-medium">Técnico</th>
                        {cols.contratos && <th className="py-3 px-4 font-medium text-center">Contratos</th>}
                        {cols.items && <th className="py-3 px-4 font-medium text-center">Ítems</th>}
                        {cols.totalFactura && <th className="py-3 px-4 font-medium text-right">Total factura</th>}
                        {cols.totalTecnico && <th className="py-3 px-4 font-medium text-right">Total técnico</th>}
                        {cols.participacion && <th className="py-3 px-7 font-medium text-right">Participación</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filasPagina.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                            Ningún técnico coincide con la búsqueda.
                          </td>
                        </tr>
                      ) : (
                        filasPagina.map((r, i) => (
                          <tr key={r.tecnico} className={`border-b border-slate-100 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                            <td className="py-3.5 px-7">
                              <div className="flex items-center gap-3">
                                <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 text-[11px] font-semibold flex items-center justify-center">
                                  {iniciales(r.tecnico)}
                                </span>
                                <span className="text-sm text-slate-800">{r.tecnico}</span>
                              </div>
                            </td>
                            {cols.contratos && <td className="py-3.5 px-4 text-sm text-slate-500 text-center">{r.contratos}</td>}
                            {cols.items && <td className="py-3.5 px-4 text-sm text-slate-500 text-center">{r.items}</td>}
                            {cols.totalFactura && (
                              <td className="py-3.5 px-4 text-sm font-mono tabular-nums text-slate-800 text-right">{money(r.totalFactura)}</td>
                            )}
                            {cols.totalTecnico && (
                              <td className="py-3.5 px-4 text-sm font-mono tabular-nums font-semibold text-slate-900 text-right">{money(r.totalTecnico)}</td>
                            )}
                            {cols.participacion && (
                              <td className="py-3.5 px-7 text-sm font-semibold text-emerald-600 text-right">{pct1(r.participacion)}</td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-900 text-white">
                        <td className="py-4 px-7">
                          <p className="text-sm font-medium">Total del período</p>
                          <p className="text-xs text-slate-400">
                            {resumen.length} {resumen.length === 1 ? 'técnico activo' : 'técnicos activos'}
                          </p>
                        </td>
                        {cols.contratos && <td className="py-4 px-4 text-sm text-center">{totalContratos}</td>}
                        {cols.items && <td className="py-4 px-4 text-sm text-center">{totalItems}</td>}
                        {cols.totalFactura && (
                          <td className="py-4 px-4 text-sm font-mono tabular-nums text-right">{money(totalFacturaGlobal)}</td>
                        )}
                        {cols.totalTecnico && (
                          <td className="py-4 px-4 text-sm font-mono tabular-nums font-semibold text-right">{money(totalEjecutado)}</td>
                        )}
                        {cols.participacion && (
                          <td className="py-4 px-7 text-sm font-semibold text-emerald-400 text-right">100%</td>
                        )}
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="flex items-center justify-between px-7 py-4 text-sm text-slate-400">
                  <span>
                    Mostrando {filasPagina.length} de {resumenFiltrado.length} técnicos
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPagina(Math.max(paginaActual - 1, 1))}
                      disabled={paginaActual === 1}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                    >
                      <Svg d={ICONS.chevronL} className="w-4 h-4" />
                    </button>
                    <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 font-semibold flex items-center justify-center">
                      {paginaActual}
                    </span>
                    <button
                      onClick={() => setPagina(Math.min(paginaActual + 1, totalPaginas))}
                      disabled={paginaActual === totalPaginas}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                    >
                      <Svg d={ICONS.chevronR} className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
