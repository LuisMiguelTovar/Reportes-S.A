'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import UploadExcelButton from '@/components/UploadExcelButton';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';
import { useArea } from '@/components/AreaProvider';
import toast from 'react-hot-toast';
import FiltroLista, { nombreTitulo, etiquetaTrabajo } from '@/components/FiltroLista';
import TecnicoCombobox from '@/components/TecnicoCombobox';
import ExcelColumnFilter from '@/components/ExcelColumnFilter';

interface ItemReporte {
  id: string;
  codigo: string;
  descripcion: string;
  precio_unitario: number;
  cantidad: number;
  subtotal: number;
}

type Orden = {
  orden_trabajo: string;
  contrato: string;
  direccion: string;
  barrio?: string;
  localidad: string;
  descripcion_del_trabajo?: string;
  estado: string;
  id_tecnico_asignado?: string;
  fecha_asignacion_ot?: string;
  fecha_programada?: string;
  observacion_programacion?: string;
  observacion_solicitud?: string;
  fecha_cierre?: string;
  numero_cuotas?: number | null;
  alerta_orden?: string | null;
  cobro_hl?: boolean | null;
  [key: string]: unknown;
};

type Tecnico = {
  id_usuario: string;
  nombre: string;
};

type HistorialEntry = {
  orden_trabajo: string;
  estado: string;
  comentario?: string;
  fotos?: string[];
  usuario: string;
  rol?: string;
  atendido_por?: string;
  fecha_programada?: string;
  fecha: string;
  autor_nombre?: string;
  autor_rol?: string;
};

const calcularDiasSLA = (fechaAsignacion?: string) => {
  if (!fechaAsignacion) return 0;
  const asignacion = new Date(fechaAsignacion);
  const ahora = new Date();
  const diferenciaMs = ahora.getTime() - asignacion.getTime();
  const dias = Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));
  return dias > 0 ? dias : 0;
};

const formatRol = (rol?: string | null): string => {
  const t = (rol ?? '').toString();
  if (!t.trim()) return '';
  const lower = t.toLowerCase();
  if (lower === 'tecnico' || lower === 'técnico') return 'Técnico';
  if (lower === 'admin' || lower === 'administrador') return 'Administrador';
  return t;
};

/// Formatea una fecha PURA (sin hora, tipo "2026-08-18") a "DD/MM/AAAA"
/// sin pasar por `Date`/timezone — evita el desfase de -1 día que ocurre
/// al interpretar fechas-sin-hora como UTC y luego convertirlas a hora
/// local de Colombia.
function formatearFechaPura(fecha?: string | null): string {
  if (!fecha) return '—';
  const soloFecha = fecha.split('T')[0]; // por si viniera con hora pegada
  const [year, month, day] = soloFecha.split('-');
  if (!year || !month || !day) return '—';
  return `${day}/${month}/${year}`;
}

const formatBarrio = (s?: string | null): string => {
  const t = (s ?? '').toString();
  if (!t.trim()) return '';
  // Elimina prefijos tipo "5376 - " o "5376-" dejando solo el nombre
  return t.replace(/^\s*\d+\s*-\s*/, '').trim() || t;
};

// Palabras que se escriben sin tilde en la base y deben verse con tilde. Se amplía cuando aparezcan más.
const ACENTOS: Record<string, string> = {
  reparacion: 'reparación', instalacion: 'instalación', revision: 'revisión', inspeccion: 'inspección',
  conexion: 'conexión', reconexion: 'reconexión', suspension: 'suspensión', cotizacion: 'cotización',
  medicion: 'medición', verificacion: 'verificación', adecuacion: 'adecuación', instalaciones: 'instalaciones',
  terron: 'terrón', canaveralejo: 'cañaveralejo', cano: 'caño', republica: 'república', union: 'unión',
  fatima: 'fátima', maria: 'maría', jose: 'josé', martin: 'martín', joaquin: 'joaquín',
};
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en']);
const conTilde = (s?: string | null) => {
  const t = (s ?? '').toString();
  if (!t.trim()) return '';
  return ACENTOS[t] ?? t;
};

// "TERRON COLORADO" -> "Terrón Colorado"; "BARRIO DE LA PAZ" -> "Barrio de la Paz"
const tituloEs = (s?: string | null): string => {
  const t = (s ?? '').toString();
  if (!t.trim()) return '';
  return t.trim().toLowerCase().split(/\s+/).filter(Boolean)
    .map((p, i) => {
      const w = conTilde(p);
      return i > 0 && CONECTORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
};

// "12137-TRABAJOS POR REPARACION" -> "Trabajos por reparación"
const oracionEs = (s?: string | null): string => {
  const t = (s ?? '').toString();
  if (!t.trim()) return '';
  const et = etiquetaTrabajo(t).split(' ').map(conTilde).join(' ');
  return et ? et.charAt(0).toUpperCase() + et.slice(1) : '';
};

const plano = (s?: string | null): string => {
  const t = (s ?? '').toString();
  if (!t.trim()) return '';
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
};

// Control de opciones cortas (un clic): Fecha y Alerta en el panel de filtros.
function SegmentosFiltro({
  etiqueta, opciones, activo, onElegir,
}: {
  etiqueta: string;
  opciones: { id: string; texto: string }[];
  activo: string | null;
  onElegir: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={etiqueta} style={{ display: 'flex', gap: 2, padding: 4, background: '#F1F5F9', borderRadius: 10, minHeight: 44, boxSizing: 'border-box', alignItems: 'center' }}>
      {opciones.map(o => {
        const on = o.id === activo;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onElegir(o.id)}
            style={{
              flex: 1, minHeight: 36, border: 0, borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
              fontSize: 13, fontWeight: on ? 600 : 500,
              background: on ? '#fff' : 'transparent', color: on ? '#0F2A5C' : '#64748B',
              boxShadow: on ? '0 1px 2px rgba(15,42,92,0.14)' : 'none',
            }}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

// Aplica el filtro de la columna "Alerta" a una consulta de Supabase.
// sel === null → sin filtro. Valores: 'POSIBLE_DUPLICADA', 'DOBLE', 'SIN_ALERTA'.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aplicarFiltroAlerta(q: any, sel: Set<string> | null) {
  if (!sel) return;
  const partes: string[] = [];
  sel.forEach(v => {
    if (v === 'SIN_ALERTA') partes.push('and(alerta_orden.is.null,cobro_hl.eq.false)');
    else if (v === 'COBRO_HL') partes.push('cobro_hl.eq.true');
    else partes.push(`alerta_orden.eq.${v}`);
  });
  if (partes.length > 0) q.or(partes.join(','));
}

export default function DespachoTableClient() {
  const { user } = useAuth();
  const { area } = useArea();

  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loadingOrdenes, setLoadingOrdenes] = useState(true);
  const [errorOrdenes, setErrorOrdenes] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [localidadFilter, setLocalidadFilter] = useState('Todas');
  const [descripcionFilter, setDescripcionFilter] = useState('Todas las Descripciones');
  const [fechaFilter, setFechaFilter] = useState('Todas');
  const [tecnicoFilter, setTecnicoFilter] = useState('Todos');
  const [estadoFilter, setEstadoFilter] = useState('Todos');
  const [alertaSelected, setAlertaSelected] = useState<Set<string> | null>(null);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const panelFiltrosRef = useRef<HTMLDivElement>(null);
  const botonFiltrosRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!filtrosAbiertos) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (panelFiltrosRef.current?.contains(t) || botonFiltrosRef.current?.contains(t)) return;
      // Las listas desplegables de los filtros pueden pintarse fuera del panel: no cerrar por ellas.
      if (t.closest('[role="listbox"], [role="menu"], .menu-pop')) return;
      setFiltrosAbiertos(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFiltrosAbiertos(false);
        botonFiltrosRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtrosAbiertos]);
  const [conteoDuplicadas, setConteoDuplicadas] = useState(0);
  const [confirmDup, setConfirmDup] = useState<{ ordenes: Orden[] } | null>(null);
  const [cerrandoDup, setCerrandoDup] = useState(false);

  // ── Filtros tipo Excel en encabezados de columna (selección múltiple) ──
  // Cada uno: null = "todas las opciones" (sin filtro). Set<string> = solo esos valores están incluidos.
  type ExcelFilterKey = 'orden' | 'contrato' | 'ubicacion' | 'trabajo' | 'estado' | 'sla' | 'fechaProg' | 'fechaAsig' | 'tecnico' | 'alerta';

  const [openColumnFilter, setOpenColumnFilter] = useState<ExcelFilterKey | null>(null);
  const [columnFilterPosition, setColumnFilterPosition] = useState<{ top: number; left: number } | null>(null);
  const columnFilterRef = useRef<HTMLDivElement>(null);

  const [ordenSelected, setOrdenSelected] = useState<Set<string> | null>(null);
  const [contratoSelected, setContratoSelected] = useState<Set<string> | null>(null);
  const [ubicacionSelected, setUbicacionSelected] = useState<Set<string> | null>(null);
  const [trabajoSelected, setTrabajoSelected] = useState<Set<string> | null>(null);
  const [estadoColSelected, setEstadoColSelected] = useState<Set<string> | null>(null);
  const [slaSelected, setSlaSelected] = useState<Set<string> | null>(null);
  const [fechaProgSelected, setFechaProgSelected] = useState<Set<string> | null>(null);
  const [fechaAsigSelected, setFechaAsigSelected] = useState<Set<string> | null>(null);
  const [tecnicoColSelected, setTecnicoColSelected] = useState<Set<string> | null>(null);

  // Opciones únicas para cada checklist (se cargan junto con localidadesUnicas/descripcionesUnicas)
  const [ordenesUnicas, setOrdenesUnicas] = useState<string[]>([]);
  const [contratosUnicos, setContratosUnicos] = useState<string[]>([]);
  const [slaDiasUnicos, setSlaDiasUnicos] = useState<string[]>([]);
  const [fechasProgUnicas, setFechasProgUnicas] = useState<string[]>([]); // 'DD/MM/AAAA' o '__VACIO__'
  const [fechasAsigUnicas, setFechasAsigUnicas] = useState<string[]>([]);
  const [selectedOrdenes, setSelectedOrdenes] = useState<string[]>([]);
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [selectedTecnicoId, setSelectedTecnicoId] = useState('');

  // Órdenes activas por técnico (mismo criterio del Despacho: no Efectiva ni Cancelada, del área actual).
  // Se consulta solo mientras la barra de asignación está visible.
  const [cargaPorTecnico, setCargaPorTecnico] = useState<Record<string, number>>({});
  const hayOrdenesSeleccionadas = selectedOrdenes.length > 0;
  useEffect(() => {
    if (!hayOrdenesSeleccionadas) return;
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from('ordenes')
        .select('id_tecnico_asignado')
        .not('estado', 'in', '("Efectiva","Cancelada")')
        .eq('area', area)
        .not('id_tecnico_asignado', 'is', null);
      if (cancelado || error || !data) return;
      const conteo: Record<string, number> = {};
      for (const fila of data as { id_tecnico_asignado: string }[]) {
        conteo[fila.id_tecnico_asignado] = (conteo[fila.id_tecnico_asignado] || 0) + 1;
      }
      setCargaPorTecnico(conteo);
    })();
    return () => { cancelado = true; };
  }, [hayOrdenesSeleccionadas, area]);
  const [lastUpdateDate, setLastUpdateDate] = useState<string | null>(null);

  // ── Menú kebab ──
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Modal Reporte ──
  const [reporteOrden, setReporteOrden] = useState<Orden | null>(null);
  const [itemsReporte, setItemsReporte] = useState<ItemReporte[]>([]);
  const [cargandoItems, setCargandoItems] = useState(false);
  const [historial, setHistorial] = useState<HistorialEntry[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [nuevoComentario, setNuevoComentario] = useState('');
  const [nuevoEstado, setNuevoEstado] = useState<'Programada' | 'Efectiva' | 'Cancelada' | null>(null);
  const [nuevaFechaProgramada, setNuevaFechaProgramada] = useState('');
  const [nuevasFotos, setNuevasFotos] = useState<File[]>([]);
  const [isGuardando, setIsGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ fotos: string[]; index: number } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());

  // ── Lista continua (carga por lotes) ──
  const LOTE = 50;
  const MAX_FILAS = 200;
  const [limite, setLimite] = useState(LOTE);
  const [totalCount, setTotalCount] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);
  const peticionRef = useRef(0); // número de la última consulta de lista; las anteriores se descartan
  const volverArriba = useCallback(() => {
    listaRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [localidadesUnicas, setLocalidadesUnicas] = useState<string[]>([]);
  const [descripcionesUnicas, setDescripcionesUnicas] = useState<string[]>([]);

  const [isAssigning, setIsAssigning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setZoomLevel(1);
  }, [lightbox?.fotos, lightbox?.index]);

  useEffect(() => {
    if (reporteOrden) {
      document.body.style.overflow = 'hidden';
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (lightbox) {
            setLightbox(null);
          } else {
            setReporteOrden(null);
            setHistorial([]);
            setItemsReporte([]);
            setCargandoItems(false);
            setNuevoComentario('');
            setNuevoEstado(null);
            setNuevaFechaProgramada('');
            setNuevasFotos([]);
            setErrorGuardar(null);
          }
        } else if (lightbox && e.key === 'ArrowLeft' && lightbox.fotos.length > 1) {
          setLightbox({ ...lightbox, index: (lightbox.index - 1 + lightbox.fotos.length) % lightbox.fotos.length });
        } else if (lightbox && e.key === 'ArrowRight' && lightbox.fotos.length > 1) {
          setLightbox({ ...lightbox, index: (lightbox.index + 1) % lightbox.fotos.length });
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = '';
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [reporteOrden, lightbox]);

  // Helper: formatea un Date a string legible en zona horaria de Colombia
  const formatTimestamp = (date: Date): string =>
    date.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'short',
      timeStyle: 'short',
    });

  // ── Helper: construir query filtrada (compartido entre fetchOrdenes y CSV export) ──
  const buildFilteredQuery = useCallback((
    search: string,
    loc: string,
    desc: string,
    fecha: string,
    tecnico: string,
    estado: string,
    ordenSel: Set<string> | null,
    contratoSel: Set<string> | null,
    ubicacionSel: Set<string> | null,
    trabajoSel: Set<string> | null,
    estadoColSel: Set<string> | null,
    slaSel: Set<string> | null,
    fechaProgSel: Set<string> | null,
    fechaAsigSel: Set<string> | null,
    tecnicoColSel: Set<string> | null,
    withCount: boolean
  ) => {
    const query = supabase
      .from('ordenes')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .not('estado', 'in', '("Efectiva","Cancelada")')
      .eq('area', area);

    // Búsqueda
    if (search) {
      query.or(`contrato.ilike.%${search}%,orden_trabajo.ilike.%${search}%,direccion.ilike.%${search}%,barrio.ilike.%${search}%`);
    }
    // Estado real
    if (estado !== 'Todos') {
      query.eq('estado', estado);
    }
    // Localidad
    if (loc !== 'Todas') {
      query.eq('localidad', loc);
    }
    // Descripción
    if (desc !== 'Todas las Descripciones') {
      query.eq('descripcion_del_trabajo', desc);
    }
    // SLA / Fecha
    if (fecha !== 'Todas') {
      const now = new Date();
      const oneDayMs = 1000 * 60 * 60 * 24;
      if (fecha === 'Hoy') {
        query.gte('fecha_asignacion_ot', new Date(now.getTime() - oneDayMs).toISOString());
      } else if (fecha === 'Últimos 3 días') {
        query.gte('fecha_asignacion_ot', new Date(now.getTime() - 4 * oneDayMs).toISOString());
      } else if (fecha === 'Vencidas') {
        query.lte('fecha_asignacion_ot', new Date(now.getTime() - 3 * oneDayMs).toISOString());
      }
    }
    // Técnico
    if (tecnico !== 'Todos') {
      if (tecnico === 'Sin asignar') {
        query.is('id_tecnico_asignado', null);
      } else {
        query.eq('id_tecnico_asignado', tecnico);
      }
    }

    // ── Filtros tipo Excel de columna (selección múltiple) ──
    if (ordenSel) query.in('orden_trabajo', Array.from(ordenSel));
    if (contratoSel) query.in('contrato', Array.from(contratoSel));
    if (ubicacionSel) query.in('localidad', Array.from(ubicacionSel));
    if (trabajoSel) query.in('descripcion_del_trabajo', Array.from(trabajoSel));
    if (estadoColSel) query.in('estado', Array.from(estadoColSel));
    
    if (tecnicoColSel) {
      const ids = Array.from(tecnicoColSel);
      const wantsSinAsignar = ids.includes('SIN_ASIGNAR');
      const realIds = ids.filter(id => id !== 'SIN_ASIGNAR');
      if (wantsSinAsignar && realIds.length > 0) {
        query.or(`id_tecnico_asignado.is.null,id_tecnico_asignado.in.(${realIds.join(',')})`);
      } else if (wantsSinAsignar) {
        query.is('id_tecnico_asignado', null);
      } else if (realIds.length > 0) {
        query.in('id_tecnico_asignado', realIds);
      }
    }
    
    // Días/SLA es un valor CALCULADO (hoy - fecha_asignacion_ot), no una columna.
    // Cada día seleccionado se convierte en un rango de fecha y se combinan con OR.
    if (slaSel && slaSel.size > 0) {
      const now = new Date();
      const oneDayMs = 1000 * 60 * 60 * 24;
      const orParts = Array.from(slaSel).map((diasStr) => {
        const dias = Number(diasStr);
        const to = new Date(now.getTime() - dias * oneDayMs);
        const from = new Date(now.getTime() - (dias + 1) * oneDayMs);
        return `and(fecha_asignacion_ot.gt.${from.toISOString()},fecha_asignacion_ot.lte.${to.toISOString()})`;
      });
      if (orParts.length > 0) query.or(orParts.join(','));
    }
    
    // F. Programada: cada fecha seleccionada se compara por RANGO DE DÍA COMPLETO
    // (00:00 del día hasta 00:00 del día siguiente), no por igualdad exacta,
    // porque fecha_programada puede traer hora/zona horaria pegada en algunos
    // registros y una comparación de igualdad no los encontraría.
    if (fechaProgSel && fechaProgSel.size > 0) {
      const wantsVacio = fechaProgSel.has('__VACIO__');
      const fechasSeleccionadas = Array.from(fechaProgSel).filter((f) => f !== '__VACIO__');

      const orParts: string[] = [];
      fechasSeleccionadas.forEach((f) => {
        const [d, m, y] = f.split('/');
        const inicio = `${y}-${m}-${d}`;

        const siguiente = new Date(Number(y), Number(m) - 1, Number(d) + 1);
        const yyyy = siguiente.getFullYear();
        const mm = String(siguiente.getMonth() + 1).padStart(2, '0');
        const dd = String(siguiente.getDate()).padStart(2, '0');
        const fin = `${yyyy}-${mm}-${dd}`;

        orParts.push(`and(fecha_programada.gte.${inicio},fecha_programada.lt.${fin})`);
      });

      if (wantsVacio) orParts.push('fecha_programada.is.null');
      if (orParts.length > 0) query.or(orParts.join(','));
    }

    // Fecha Asignación: mismo criterio de rango de día completo que F. Programada
    if (fechaAsigSel && fechaAsigSel.size > 0) {
      const wantsVacioAsig = fechaAsigSel.has('__VACIO__');
      const fechasAsigSeleccionadas = Array.from(fechaAsigSel).filter((f) => f !== '__VACIO__');

      const orPartsAsig: string[] = [];
      fechasAsigSeleccionadas.forEach((f) => {
        const [d, m, y] = f.split('/');
        const inicio = `${y}-${m}-${d}`;

        const siguiente = new Date(Number(y), Number(m) - 1, Number(d) + 1);
        const yyyy = siguiente.getFullYear();
        const mm = String(siguiente.getMonth() + 1).padStart(2, '0');
        const dd = String(siguiente.getDate()).padStart(2, '0');
        const fin = `${yyyy}-${mm}-${dd}`;

        orPartsAsig.push(`and(fecha_asignacion_ot.gte.${inicio},fecha_asignacion_ot.lt.${fin})`);
      });

      if (wantsVacioAsig) orPartsAsig.push('fecha_asignacion_ot.is.null');
      if (orPartsAsig.length > 0) query.or(orPartsAsig.join(','));
    }

    // Orden: SLA descendente = fecha_asignacion_ot ascendente (más vieja primero)
    query.order('fecha_asignacion_ot', { ascending: true });

    return query;
  }, [area]);

  // ── Fetch órdenes — paginado server-side ──
  const fetchOrdenes = useCallback(async () => {
    const miPeticion = ++peticionRef.current;
    setLoadingOrdenes(true);
    setErrorOrdenes(null);

    const query = buildFilteredQuery(
      debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estadoFilter,
      ordenSelected, contratoSelected, ubicacionSelected, trabajoSelected, estadoColSelected, slaSelected, fechaProgSelected, fechaAsigSelected, tecnicoColSelected, true
    );
    aplicarFiltroAlerta(query, alertaSelected);
    query.range(0, limite - 1);

    const { data, error, count } = await query;
    if (miPeticion !== peticionRef.current) return; // llegó una consulta más nueva; esta se ignora

    if (error) {
      console.error('Error al cargar órdenes:', error);
      setErrorOrdenes('No se pudieron cargar las órdenes.');
    } else {
      setOrdenes(data || []);
      setTotalCount(count ?? 0);
    }
    setLoadingOrdenes(false);
    setIsInitialLoad(false);
  }, [buildFilteredQuery, debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estadoFilter, ordenSelected, contratoSelected, ubicacionSelected, trabajoSelected, estadoColSelected, slaSelected, fechaProgSelected, fechaAsigSelected, tecnicoColSelected, alertaSelected, limite]);

  // ── Cantidades para los botones de estado (respetan los demás filtros activos) ──
  const [conteoEstados, setConteoEstados] = useState<{ todos: number; pendiente: number; programada: number } | null>(null);
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const contar = async (estado: string) => {
        const q = buildFilteredQuery(
          debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estado,
          ordenSelected, contratoSelected, ubicacionSelected, trabajoSelected, estadoColSelected, slaSelected, fechaProgSelected, fechaAsigSelected, tecnicoColSelected, true
        );
        aplicarFiltroAlerta(q, alertaSelected);
        q.range(0, 0);
        const { count, error } = await q;
        return error ? null : (count ?? 0);
      };
      const [todos, pendiente, programada] = await Promise.all([contar('Todos'), contar('Pendiente'), contar('Programada')]);
      if (cancelado || todos === null || pendiente === null || programada === null) return;
      setConteoEstados({ todos, pendiente, programada });
    })();
    return () => { cancelado = true; };
  // Se recalculan cuando llega una lista nueva (los filtros ya disparan esa lista); así no se duplican las consultas.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenes]);

  type FilaFiltroOpciones = {
    orden_trabajo: string;
    contrato: string;
    localidad: string;
    descripcion_del_trabajo?: string;
    fecha_asignacion_ot?: string;
    fecha_programada?: string;
  };

  // ── Fetch opciones únicas para dropdowns (una vez al montar) ──
  const fetchFilterOptions = useCallback(async () => {
    const { data } = await supabase
      .from('ordenes')
      .select('orden_trabajo, contrato, localidad, descripcion_del_trabajo, fecha_asignacion_ot, fecha_programada')
      .not('estado', 'in', '("Efectiva","Cancelada")')
      .eq('area', area)
      .returns<FilaFiltroOpciones[]>();

    if (!data) return;

    const locs = [...new Set(data.map((d) => (d.localidad ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const descs = [...new Set(data.map((d) => (d.descripcion_del_trabajo ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')) as string[];
    const ordenes = [...new Set(data.map((d) => (d.orden_trabajo ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const contratos = [...new Set(data.map((d) => (d.contrato ?? '').trim()).filter(Boolean))].sort((a, b) => (a ?? '').localeCompare(b ?? '', 'es'));

    const dias = [...new Set(data.map((d) => String(calcularDiasSLA(d.fecha_asignacion_ot))))]
      .sort((a, b) => Number(a) - Number(b));

    const fechas = [...new Set(
      data.map((d) => (d.fecha_programada ? formatearFechaPura(d.fecha_programada) : '__VACIO__'))
    )].sort((a, b) => {
      if (a === '__VACIO__') return 1;
      if (b === '__VACIO__') return -1;
      const [da, ma, ya] = a.split('/').map(Number);
      const [db, mb, yb] = b.split('/').map(Number);
      return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
    });

    const fechasAsig = [...new Set(
      data.map((d) => (d.fecha_asignacion_ot ? formatearFechaPura(d.fecha_asignacion_ot) : '__VACIO__'))
    )].sort((a, b) => {
      if (a === '__VACIO__') return 1;
      if (b === '__VACIO__') return -1;
      const [da, ma, ya] = a.split('/').map(Number);
      const [db, mb, yb] = b.split('/').map(Number);
      return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
    });

    setLocalidadesUnicas(locs);
    setDescripcionesUnicas(descs);
    setOrdenesUnicas(ordenes);
    setContratosUnicos(contratos);
    setSlaDiasUnicos(dias);
    setFechasProgUnicas(fechas);
    setFechasAsigUnicas(fechasAsig);
  }, [area]);

  // Lee la fecha de la última carga de Excel desde la tabla app_metadata.
  const fetchLastUploadDate = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_metadata')
      .select('valor')
      .eq('clave', 'ultima_carga_excel')
      .single();

    if (!error && data?.valor) {
      const fecha = new Date(data.valor);
      setLastUpdateDate(formatTimestamp(fecha));
    }
  }, []);

  // Callback para cuando el upload termina exitosamente
  const handleUploadSuccess = useCallback(async () => {
    const ahora = new Date();
    const isoTimestamp = ahora.toISOString();

    await supabase
      .from('app_metadata')
      .upsert(
        { clave: 'ultima_carga_excel', valor: isoTimestamp, updated_at: isoTimestamp },
        { onConflict: 'clave' }
      );

    setLastUpdateDate(formatTimestamp(ahora));
    setLimite(LOTE);
    listaRef.current?.scrollTo({ top: 0 });
    fetchOrdenes();
    fetchFilterOptions(); // refrescar opciones de dropdown
  }, [fetchOrdenes, fetchFilterOptions]);

  // ── Debounce del search term (400ms) ──
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // ── Volver arriba y a 50 filas cuando cambian los filtros ──
  useEffect(() => {
    setLimite(LOTE);
    setSelectedOrdenes([]);
    listaRef.current?.scrollTo({ top: 0 });
  }, [debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estadoFilter, ordenSelected, contratoSelected, ubicacionSelected, trabajoSelected, estadoColSelected, slaSelected, fechaProgSelected, fechaAsigSelected, tecnicoColSelected, alertaSelected]);


  // ── Fetch reactivo: cada vez que cambian filtros o página ──
  useEffect(() => {
    fetchOrdenes();
  }, [fetchOrdenes]);

  // ── Fetch inicial: opciones de dropdown + última fecha de carga ──
  useEffect(() => {
    fetchFilterOptions();
    fetchLastUploadDate();
  }, [fetchFilterOptions, fetchLastUploadDate]);

  // Cerrar el menú kebab al hacer clic fuera de él
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
        setMenuPosition(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!openColumnFilter) return;
    const handleClickOutsideFilter = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-colfilter-caret]')) return;
      if (columnFilterRef.current && !columnFilterRef.current.contains(target)) {
        setOpenColumnFilter(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutsideFilter);
    return () => document.removeEventListener('mousedown', handleClickOutsideFilter);
  }, [openColumnFilter]);

  // Fetch real technicians from perfiles table
  useEffect(() => {
    const fetchTecnicos = async () => {
      let consulta = supabase
        .from('perfiles')
        .select('id_usuario, nombre')
        .in('rol', ['Técnico', 'Supervisor']);
      // SA: solo los de su área (igual que antes). RI: todos los técnicos y supervisores.
      if (area !== 'RI') {
        consulta = consulta.contains('areas', [area]);
      }
      const { data, error } = await consulta.order('nombre', { ascending: true });

      if (!error && data) {
        setTecnicos(data);
      }
    };
    fetchTecnicos();
  }, [area]);

  // ── Fetch historial de la orden (con JOIN manual a perfiles) ──
  const fetchHistorial = useCallback(async (ordenTrabajo: string) => {
    setLoadingHistorial(true);
    const { data: historialData, error } = await supabase
      .from('historial_ordenes')
      .select('*')
      .eq('orden_trabajo', ordenTrabajo)
      .order('fecha', { ascending: true });

    if (error || !historialData) {
      console.error('Error al cargar historial:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
      });
      setHistorial([]);
      setLoadingHistorial(false);
      return;
    }

    // Obtener emails únicos del historial
    const emails = [...new Set(historialData.map((h: HistorialEntry) => h.usuario).filter(Boolean))];

    // JOIN manual: buscar nombre y rol de cada autor en perfiles
    const perfilesMap: Record<string, { nombre: string; rol: string }> = {};
    if (emails.length > 0) {
      const { data: perfilesData } = await supabase
        .from('perfiles')
        .select('email, nombre, rol')
        .in('email', emails);

      if (perfilesData) {
        perfilesData.forEach((p: { email: string; nombre: string; rol: string }) => {
          perfilesMap[p.email] = { nombre: p.nombre, rol: p.rol };
        });
      }
    }

    // Enriquecer cada fila con el nombre del autor
    const enriched: HistorialEntry[] = historialData.map((h: HistorialEntry) => ({
      ...h,
      autor_nombre: perfilesMap[h.usuario]?.nombre || h.usuario,
      autor_rol: perfilesMap[h.usuario]?.rol || h.rol,
    }));

    setHistorial(enriched);
    setLoadingHistorial(false);
  }, []);

  // Abrir modal de reporte
  const abrirReporte = async (orden: Orden) => {
    setReporteOrden(orden);
    setNuevoComentario('');
    setNuevoEstado(null);
    setNuevaFechaProgramada('');
    setNuevasFotos([]);
    setErrorGuardar(null);
    setExpandedEntries(new Set());
    fetchHistorial(orden.orden_trabajo);
    
    // Cargar ítems del reporte si la orden es Efectiva
    if (orden.estado === 'Efectiva') {
      setCargandoItems(true);
      setItemsReporte([]);
      try {
        const { data, error } = await supabase
          .from('items_reporte')
          .select('id, codigo, descripcion, precio_unitario, cantidad, subtotal')
          .eq('orden_trabajo', orden.orden_trabajo)
          .order('creado_en', { ascending: true });
        if (!error && data) setItemsReporte(data as ItemReporte[]);
      } catch (e) {
        console.error('Error al cargar ítems del reporte:', e);
      } finally {
        setCargandoItems(false);
      }
    } else {
      setItemsReporte([]);
    }
  };

  // Cerrar modal de reporte
  const closeReporte = () => {
    setReporteOrden(null);
    setHistorial([]);
    setItemsReporte([]);
    setCargandoItems(false);
    setNuevoComentario('');
    setNuevoEstado(null);
    setNuevaFechaProgramada('');
    setNuevasFotos([]);
    setErrorGuardar(null);
  };

  const handleWheelZoom = (e: React.WheelEvent) => {
    e.stopPropagation();
    setZoomLevel((z) => {
      const next = e.deltaY < 0 ? z + 0.25 : z - 0.25;
      return Math.min(3, Math.max(1, next));
    });
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomLevel((z) => (z === 1 ? 2 : 1));
  };

  const copiarTextoHistorial = (entry: HistorialEntry) => {
    const partes = [
      new Date(entry.fecha).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }),
      `Técnico: ${entry.autor_nombre || entry.usuario}`,
    ];
    if (entry.comentario) partes.push(`Comentario: ${entry.comentario}`);
    if (entry.atendido_por) partes.push(`Atendido por: ${entry.atendido_por}`);
    if (entry.estado === 'Programada' && entry.fecha_programada) {
      partes.push(`Fecha estimada de atención: ${formatearFechaPura(entry.fecha_programada)}`);
    }
    const texto = partes.join('\n');
    navigator.clipboard.writeText(texto);
  };

  // Helper: get technician name by id_usuario
  const getTecnicoNombre = (idUsuario?: string): string | null => {
    if (!idUsuario) return null;
    const found = tecnicos.find(t => t.id_usuario === idUsuario);
    return found ? found.nombre : null;
  };


  // Helper: badge del ESTADO REAL de la orden (independiente de la asignación)
  const getEstadoBadge = (estado: string): { label: string; bg: string; text: string } => {
    if (estado === 'Programada') {
      return { label: 'Programada', bg: '#FFF3CD', text: '#A16207' };
    }
    // Por defecto (Pendiente) — la tabla solo trae Pendiente/Programada,
    // ya que Efectiva/Cancelada se filtran en buildFilteredQuery.
    return { label: 'Pendiente', bg: '#DBEAFE', text: '#1E40AF' };
  };

 

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const visibleIds = ordenes.map(o => o.orden_trabajo);
      const newSelected = new Set([...selectedOrdenes, ...visibleIds]);
      setSelectedOrdenes(Array.from(newSelected));
    } else {
      const visibleIds = new Set(ordenes.map(o => o.orden_trabajo));
      setSelectedOrdenes(selectedOrdenes.filter(id => !visibleIds.has(id)));
    }
  };

  const handleSelectOne = (orden_trabajo: string, checked: boolean) => {
    if (checked) {
      setSelectedOrdenes([...selectedOrdenes, orden_trabajo]);
    } else {
      setSelectedOrdenes(selectedOrdenes.filter(id => id !== orden_trabajo));
    }
  };

  const handleAsignarBloque = async () => {
    if (!selectedTecnicoId || selectedOrdenes.length === 0) return;
    setIsAssigning(true);

    try {
      // 1. Órdenes seleccionadas que estén en 'Programada': se reasigna Y se
      //    reactiva a 'Pendiente' en la misma operación, para que vuelvan a
      //    aparecer en la app del técnico.
      const { error: errorProgramadas } = await supabase
        .from('ordenes')
        .update({ id_tecnico_asignado: selectedTecnicoId, estado: 'Pendiente' })
        .in('orden_trabajo', selectedOrdenes)
        .eq('estado', 'Programada');

      // 2. El resto de las órdenes seleccionadas (no Programada): solo se
      //    reasigna el técnico, sin tocar su estado actual.
      const { error: errorResto } = await supabase
        .from('ordenes')
        .update({ id_tecnico_asignado: selectedTecnicoId })
        .in('orden_trabajo', selectedOrdenes)
        .neq('estado', 'Programada');

      if (errorProgramadas || errorResto) {
        console.error('Error al asignar órdenes:', errorProgramadas || errorResto);
        toast.error('Hubo un error al asignar las órdenes.');
      } else {
        toast.success('Órdenes asignadas exitosamente.');
        setSelectedOrdenes([]);
        setSelectedTecnicoId('');
        fetchOrdenes();
      }
    } catch (err) {
      console.error(err);
      toast.error('Hubo un error inesperado al asignar.');
    } finally {
      setIsAssigning(false);
    }
  };

  // ── Eliminar órdenes ────────────────────────────────────────────────────
  const handleDeleteOrdenes = async (ids: string[]) => {
    if (ids.length === 0) return;

    const mensaje = ids.length === 1
      ? `¿Estás seguro de eliminar la orden ${ids[0]}? Esta acción es IRREVERSIBLE.`
      : `¿Estás seguro de eliminar ${ids.length} órdenes? Esta acción es IRREVERSIBLE.`;

    if (!window.confirm(mensaje)) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('ordenes')
        .delete()
        .in('orden_trabajo', ids);

      if (error) {
        console.error('Error al eliminar órdenes:', error);
        toast.error('Hubo un error al eliminar las órdenes.');
      } else {
        setSelectedOrdenes(prev => prev.filter(id => !ids.includes(id)));
        fetchOrdenes();
      }
    } catch (err) {
      console.error(err);
      toast.error('Hubo un error inesperado al eliminar.');
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Reasignar técnico desde el modal ────────────────────────────────────
  const handleReasignarTecnicoModal = async (nuevoTecnicoId: string) => {
    if (!reporteOrden || !nuevoTecnicoId) return;

    const updateData: Record<string, unknown> = { id_tecnico_asignado: nuevoTecnicoId };
    if (reporteOrden.estado === 'Programada') {
      updateData.estado = 'Pendiente';
    }

    const { error } = await supabase
      .from('ordenes')
      .update(updateData)
      .eq('orden_trabajo', reporteOrden.orden_trabajo);

    if (!error) {
      setReporteOrden(prev => prev ? { ...prev, ...(updateData as Partial<Orden>) } : null);
      setOrdenes(prev => prev.map(o =>
        o.orden_trabajo === reporteOrden.orden_trabajo
          ? { ...o, ...updateData }
          : o
      ));
    } else {
      console.error('Error al reasignar técnico:', error);
      toast.error('Hubo un error al reasignar el técnico.');
    }
  };

  // ── Guardar nueva actualización ─────────────────────────────────────────
  const handleGuardarActualizacion = async () => {
    if (!reporteOrden || !nuevoEstado) return;

    if (nuevoEstado === 'Programada' && !nuevaFechaProgramada) {
      setErrorGuardar('Debe seleccionar una fecha de programación.');
      return;
    }

    setIsGuardando(true);
    setErrorGuardar(null);

    try {
      // 1. Subir fotos a Supabase Storage
      const urlsSubidas: string[] = [];
      const subcarpeta = nuevoEstado === 'Programada' ? 'programada'
        : nuevoEstado === 'Efectiva' ? 'efectiva' : 'cancelada';
      const timestamp = Date.now();

      for (let i = 0; i < nuevasFotos.length; i++) {
        const file = nuevasFotos[i];
        const path = `${reporteOrden.orden_trabajo}/${subcarpeta}/${timestamp}_${i}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('evidencias')
          .upload(path, file);
        if (uploadError) {
          setErrorGuardar(`Error al subir foto ${i + 1}: ${uploadError.message}`);
          setIsGuardando(false);
          return;
        }
        const { data: publicUrlData } = supabase.storage
          .from('evidencias')
          .getPublicUrl(path);
        urlsSubidas.push(publicUrlData.publicUrl);
      }

      // 2. Insertar fila en historial_ordenes
      const userEmail = user?.email || '';
      const historialRow: Record<string, unknown> = {
        orden_trabajo: reporteOrden.orden_trabajo,
        estado: nuevoEstado,
        comentario: nuevoComentario || null,
        fotos: urlsSubidas.length > 0 ? urlsSubidas : null,
        usuario: userEmail,
        rol: 'admin',
      };
      if (nuevoEstado === 'Programada' && nuevaFechaProgramada) {
        historialRow.fecha_programada = nuevaFechaProgramada;
      }

      const { error: insertError } = await supabase
        .from('historial_ordenes')
        .insert(historialRow);

      if (insertError) {
        setErrorGuardar(`Error al guardar historial: ${insertError.message}`);
        setIsGuardando(false);
        return;
      }

      // 3. Actualizar la orden principal
      const updateData: Record<string, unknown> = { estado: nuevoEstado };
      if (nuevoEstado === 'Programada') {
        updateData.fecha_programada = nuevaFechaProgramada;
      }
      if (nuevoEstado === 'Efectiva' || nuevoEstado === 'Cancelada') {
        updateData.fecha_cierre = new Date().toISOString();
      }

      const { error: updateError } = await supabase
        .from('ordenes')
        .update(updateData)
        .eq('orden_trabajo', reporteOrden.orden_trabajo);

      if (updateError) {
        setErrorGuardar(`Error al actualizar la orden: ${updateError.message}`);
        setIsGuardando(false);
        return;
      }

      // 4. Limpiar formulario
      setNuevoComentario('');
      setNuevoEstado(null);
      setNuevaFechaProgramada('');
      setNuevasFotos([]);
      setErrorGuardar(null);

      // 5. Si la orden se cerró, sale del panel de despacho
      if (nuevoEstado === 'Efectiva' || nuevoEstado === 'Cancelada') {
        setReporteOrden(null);
        setHistorial([]);
        fetchOrdenes();
      } else {
        // Programada: refrescar historial y datos locales
        await fetchHistorial(reporteOrden.orden_trabajo);
        setOrdenes(prev => prev.map(o =>
          o.orden_trabajo === reporteOrden.orden_trabajo
            ? { ...o, ...updateData }
            : o
        ));
        setReporteOrden(prev => prev ? { ...prev, ...(updateData as Partial<Orden>) } : null);
      }
    } catch (err) {
      console.error(err);
      setErrorGuardar('Error inesperado al guardar la actualización.');
    } finally {
      setIsGuardando(false);
    }
  };

  // ── Cerrar una "posible duplicada" con la orden ya cerrada del mismo contrato ──
  const handleCerrarConOrdenRelacionada = async () => {
    if (!reporteOrden) return;
    const relacionada = String(reporteOrden.orden_relacionada || '');
    if (!relacionada) return;

    if (!window.confirm(
      `¿Cerrar la orden ${reporteOrden.orden_trabajo} como Efectiva con la orden ${relacionada} (mismo contrato, ya cerrada)? ` +
      `Se cerrará con la fecha de hoy y se copiarán las fotos de la orden ${relacionada}.`
    )) return;

    setIsGuardando(true);
    setErrorGuardar(null);
    try {
      // 1. Datos de cierre de la orden relacionada
      const { data: rel, error: errRel } = await supabase
        .from('ordenes')
        .select('estado, fecha_cierre')
        .eq('orden_trabajo', relacionada)
        .single();
      if (errRel || !rel) {
        setErrorGuardar(`No se encontró la orden ${relacionada}.`);
        return;
      }
      if (rel.estado !== 'Efectiva') {
        setErrorGuardar(`La orden ${relacionada} ya no está Efectiva (estado: ${rel.estado}). No se puede cerrar con ella.`);
        return;
      }

      // 2. Fotos del último cierre Efectivo de esa orden
      const { data: hist } = await supabase
        .from('historial_ordenes')
        .select('fotos')
        .eq('orden_trabajo', relacionada)
        .eq('estado', 'Efectiva')
        .order('fecha', { ascending: false })
        .limit(1);
      const fotosCopiadas = (hist && hist[0]?.fotos) || null;

      // 3. Historial de esta orden
      const { error: errHist } = await supabase.from('historial_ordenes').insert({
        orden_trabajo: reporteOrden.orden_trabajo,
        estado: 'Efectiva',
        comentario: `Cerrada con la orden ${relacionada} (mismo contrato, ya ejecutada).`,
        fotos: fotosCopiadas,
        usuario: user?.email || '',
        rol: 'admin',
      });
      if (errHist) {
        setErrorGuardar(`Error al guardar historial: ${errHist.message}`);
        return;
      }

      // 4. Cerrar la orden con la fecha de cierre de la relacionada
      const { error: errUpd } = await supabase
        .from('ordenes')
        .update({ estado: 'Efectiva', fecha_cierre: new Date().toISOString(), alerta_orden: 'DUPLICADA_CERRADA' })
        .eq('orden_trabajo', reporteOrden.orden_trabajo);
      if (errUpd) {
        setErrorGuardar(`Error al actualizar la orden: ${errUpd.message}`);
        return;
      }

      // 5. La orden cerrada sale del panel de despacho
      setReporteOrden(null);
      setHistorial([]);
      fetchOrdenes();
    } catch (err) {
      console.error(err);
      setErrorGuardar('Error inesperado al cerrar con la orden relacionada.');
    } finally {
      setIsGuardando(false);
    }
  };

  // Altura de la lista = lo que queda de pantalla desde donde empieza hasta el borde inferior,
  // menos el pie y 48 px (relleno de la tarjeta + aire). Se recalcula al redimensionar y al cambiar el contenido.
  const footerRef = useRef<HTMLDivElement>(null);
  const [alturaLista, setAlturaLista] = useState<number | null>(null);
  useEffect(() => {
    const calcular = () => {
      const el = listaRef.current;
      if (!el) return;
      const arriba = el.getBoundingClientRect().top + window.scrollY;
      const pie = footerRef.current ? footerRef.current.offsetHeight + 16 : 0;
      setAlturaLista(Math.max(320, Math.floor(window.innerHeight - arriba - pie - 48)));
    };
    const id = requestAnimationFrame(calcular);
    window.addEventListener('resize', calcular);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', calcular); };
  }, [ordenes.length, totalCount, conteoDuplicadas, alertaSelected, loadingOrdenes]);

  // La columna "Alerta" solo se muestra si hay alguna alerta (cargada o contada) o si el filtro está activo.
  const mostrarAlerta = alertaSelected !== null || conteoDuplicadas > 0 || ordenes.some(o => !!o.alerta_orden || !!o.cobro_hl);

  // ── Posibles duplicadas ──
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { count, error } = await supabase
        .from('ordenes')
        .select('orden_trabajo', { count: 'exact', head: true })
        .eq('area', area)
        .eq('alerta_orden', 'POSIBLE_DUPLICADA')
        .in('estado', ['Pendiente', 'Programada']);
      if (!cancelado && !error) setConteoDuplicadas(count ?? 0);
    })();
    return () => { cancelado = true; };
  }, [area, ordenes]);

  // Cierra UNA orden como Efectiva con los datos de la orden relacionada. Devuelve null si salió bien o el mensaje de error.
  const cerrarConRelacionada = async (ordenTrabajo: string, relacionada: string): Promise<string | null> => {
    if (!relacionada) return 'no tiene orden relacionada';
    const { data: rel, error: errRel } = await supabase
      .from('ordenes').select('estado, fecha_cierre').eq('orden_trabajo', relacionada).single();
    if (errRel || !rel) return `no se encontró la orden ${relacionada}`;
    if (rel.estado !== 'Efectiva') return `la orden ${relacionada} ya no está Efectiva (${rel.estado})`;

    const { data: hist } = await supabase
      .from('historial_ordenes').select('fotos')
      .eq('orden_trabajo', relacionada).eq('estado', 'Efectiva')
      .order('fecha', { ascending: false }).limit(1);
    const fotosCopiadas = (hist && hist[0]?.fotos) || null;

    const { error: errHist } = await supabase.from('historial_ordenes').insert({
      orden_trabajo: ordenTrabajo,
      estado: 'Efectiva',
      comentario: `Cerrada como duplicada con la orden ${relacionada} (mismo contrato, ya ejecutada).`,
      fotos: fotosCopiadas,
      usuario: user?.email || '',
      rol: 'admin',
    });
    if (errHist) return `error al guardar historial: ${errHist.message}`;

    const { error: errUpd } = await supabase
      .from('ordenes')
      .update({ estado: 'Efectiva', fecha_cierre: new Date().toISOString(), alerta_orden: 'DUPLICADA_CERRADA' })
      .eq('orden_trabajo', ordenTrabajo);
    if (errUpd) return `error al actualizar la orden: ${errUpd.message}`;
    return null;
  };

  const confirmarCierreDuplicadas = async () => {
    if (!confirmDup) return;
    setCerrandoDup(true);
    let ok = 0;
    const fallos: string[] = [];
    for (const o of confirmDup.ordenes) {
      const err = await cerrarConRelacionada(o.orden_trabajo, String(o.orden_relacionada || ''));
      if (err) fallos.push(`${o.orden_trabajo}: ${err}`); else ok++;
    }
    setCerrandoDup(false);
    setConfirmDup(null);
    setSelectedOrdenes([]);
    if (ok > 0) toast.success(ok === 1 ? '1 orden cerrada como duplicada' : `${ok} órdenes cerradas como duplicadas`);
    if (fallos.length > 0) toast.error(fallos.join('\n'));
    fetchOrdenes();
  };

  const abrirCierreTodasDuplicadas = async () => {
    const { data, error } = await supabase
      .from('ordenes').select('*')
      .eq('area', area).eq('alerta_orden', 'POSIBLE_DUPLICADA').in('estado', ['Pendiente', 'Programada'])
      .order('fecha_asignacion_ot', { ascending: true });
    if (error || !data || data.length === 0) { toast.error('No se pudieron cargar las duplicadas.'); return; }
    setConfirmDup({ ordenes: data as Orden[] });
  };

  const marcarNoDuplicada = async (o: Orden) => {
    const { error } = await supabase
      .from('ordenes').update({ alerta_orden: null, orden_relacionada: null }).eq('orden_trabajo', o.orden_trabajo);
    if (error) { toast.error(`No se pudo actualizar la orden ${o.orden_trabajo}.`); return; }
    await supabase.from('historial_ordenes').insert({
      orden_trabajo: o.orden_trabajo,
      estado: o.estado,
      comentario: `Marcada como NO duplicada (se había alertado por la orden ${String(o.orden_relacionada || '')}).`,
      usuario: user?.email || '',
      rol: 'admin',
    });
    toast.success(`Orden ${o.orden_trabajo}: alerta retirada`);
    fetchOrdenes();
  };

  const isAllVisibleSelected = ordenes.length > 0 && ordenes.every(o => selectedOrdenes.includes(o.orden_trabajo));

  // ── Exportar a CSV (todos los filtrados, sin paginación) ──────────────
  const handleExportCSV = async () => {
    // Query con los mismos filtros activos pero SIN .range()
    const query = buildFilteredQuery(
      debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estadoFilter,
      ordenSelected, contratoSelected, ubicacionSelected, trabajoSelected, estadoColSelected, slaSelected, fechaProgSelected, fechaAsigSelected, tecnicoColSelected, false
    );
    aplicarFiltroAlerta(query, alertaSelected);
    const { data: allFiltered, error } = await query;

    if (error || !allFiltered || allFiltered.length === 0) return;

    const headers = [
      'Orden',
      'Contrato',
      'Dirección',
      'Barrio',
      'Localidad',
      'Descripción del Trabajo',
      'Días SLA',
      'Fecha Asignación',
      'Estado Asignación',
      'Técnico Asignado',
      'Fecha Programada',
    ];

    const escapeCSV = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const rows = allFiltered.map((row: Orden) => {
      const diasSLA = calcularDiasSLA(row.fecha_asignacion_ot);
      const nombre = getTecnicoNombre(row.id_tecnico_asignado as string);
      const estadoAsig = !nombre ? 'Sin asignar' : nombre === 'Programado' ? 'Programado' : 'Asignada';
      const tecnicoDisplay = nombre === 'Programado' ? '—' : (nombre || 'Sin asignar');
      const fechaAsig = formatearFechaPura(row.fecha_asignacion_ot);
      const fechaProg = formatearFechaPura(row.fecha_programada);
      return [
        row.orden_trabajo || '',
        row.contrato || '',
        row.direccion || '',
        row.barrio || '',
        row.localidad || '',
        row.descripcion_del_trabajo || '',
        String(diasSLA),
        fechaAsig,
        estadoAsig,
        tecnicoDisplay,
        fechaProg,
      ].map(escapeCSV).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const fileName = `Reporte_Despacho_${yyyy}${mm}${dd}.csv`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  if (loadingOrdenes && isInitialLoad) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <p className="text-sm text-gray-500">Cargando órdenes...</p>
        </div>
      </div>
    );
  }

  if (errorOrdenes) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200">
        {errorOrdenes}
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Panel de Despacho</h1>
          <p className="text-sm text-slate-500 mt-1">Asignación y gestión de órdenes pendientes</p>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdateDate && <span className="text-sm font-medium text-gray-500 hidden md:block">Última actualización: {lastUpdateDate}</span>}
          <button
            onClick={handleExportCSV}
            disabled={totalCount === 0}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Descargar CSV
          </button>
          <UploadExcelButton onUploadSuccess={handleUploadSuccess} />
          <NotificationsBell />
          <UserProfile />
        </div>
      </div>
      {/* Controles de Filtros */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-[0_8px_24px_rgba(15,23,42,0.05)]" style={{ position: 'relative' }}>
        {(() => {
          const modoAlerta: string | null =
            alertaSelected === null ? 'todas'
            : alertaSelected.size === 2 && alertaSelected.has('POSIBLE_DUPLICADA') && alertaSelected.has('DOBLE') ? 'con'
            : alertaSelected.size === 1 && alertaSelected.has('POSIBLE_DUPLICADA') ? 'dup'
            : alertaSelected.size === 1 && alertaSelected.has('DOBLE') ? 'dob'
            : alertaSelected.size === 1 && alertaSelected.has('COBRO_HL') ? 'cob'
            : null;
          const textoAlerta =
            modoAlerta === 'con' ? 'Con alerta'
            : modoAlerta === 'dup' ? 'Duplicada'
            : modoAlerta === 'dob' ? 'Doble'
            : modoAlerta === 'cob' ? 'Cobro HL'
            : `${alertaSelected?.size ?? 0} tipos`;
          const nombreTecnico = tecnicoFilter === 'Sin asignar'
            ? 'Sin asignar'
            : nombreTitulo(tecnicos.find(t => t.id_usuario === tecnicoFilter)?.nombre || '');

          const chips: { id: string; texto: string; quitar: () => void }[] = [];
          if (localidadFilter !== 'Todas') chips.push({ id: 'loc', texto: `Localidad: ${localidadFilter}`, quitar: () => setLocalidadFilter('Todas') });
          if (descripcionFilter !== 'Todas las Descripciones') chips.push({ id: 'tipo', texto: `Tipo: ${etiquetaTrabajo(descripcionFilter)}`, quitar: () => setDescripcionFilter('Todas las Descripciones') });
          if (tecnicoFilter !== 'Todos') chips.push({ id: 'tec', texto: `Técnico: ${nombreTecnico}`, quitar: () => setTecnicoFilter('Todos') });
          if (fechaFilter !== 'Todas') chips.push({ id: 'fecha', texto: `Fecha: ${fechaFilter}`, quitar: () => setFechaFilter('Todas') });
          if (alertaSelected !== null) chips.push({ id: 'alerta', texto: `Alerta: ${textoAlerta}`, quitar: () => setAlertaSelected(null) });

          const nPanel = chips.length;
          const hayFiltros =
            searchTerm !== '' || nPanel > 0 || estadoFilter !== 'Todos' ||
            [ordenSelected, contratoSelected, ubicacionSelected, trabajoSelected, estadoColSelected, slaSelected, fechaProgSelected, fechaAsigSelected, tecnicoColSelected].some(s => s !== null);
          const limpiarTodo = () => {
            setSearchTerm(''); setLocalidadFilter('Todas'); setDescripcionFilter('Todas las Descripciones'); setFechaFilter('Todas'); setTecnicoFilter('Todos'); setEstadoFilter('Todos'); setAlertaSelected(null);
            setOrdenSelected(null);
            setContratoSelected(null);
            setUbicacionSelected(null);
            setTrabajoSelected(null);
            setEstadoColSelected(null);
            setSlaSelected(null);
            setFechaProgSelected(null);
            setFechaAsigSelected(null);
            setTecnicoColSelected(null);
          };
          const etiquetaCampo: React.CSSProperties = { display: 'block', margin: '0 0 6px', fontSize: 12, fontWeight: 500, color: '#64748B' };

          return (
            <>
              {/* Fila única: pestañas + buscador + botón Filtros */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 28px', padding: '0 24px', minHeight: 64 }}>
                <div role="group" aria-label="Estado de las órdenes" style={{ display: 'flex', gap: 28 }}>
                  {([
                    ['Todos', 'Todas', conteoEstados?.todos],
                    ['Pendiente', 'Pendientes', conteoEstados?.pendiente],
                    ['Programada', 'Programadas', conteoEstados?.programada],
                  ] as const).map(([valor, etiqueta, n]) => {
                    const activa = estadoFilter === valor;
                    return (
                      <button
                        key={valor}
                        type="button"
                        aria-pressed={activa}
                        onClick={() => setEstadoFilter(valor)}
                        style={{
                          minHeight: 64, padding: 0, border: 0, background: 'none', cursor: 'pointer',
                          borderBottom: `2px solid ${activa ? '#0F2A5C' : 'transparent'}`,
                          color: activa ? '#0F2A5C' : '#64748B', fontSize: 14, fontWeight: activa ? 600 : 500,
                          transition: 'color 150ms ease, border-color 150ms ease',
                        }}
                      >
                        {etiqueta}
                        {n !== undefined && (
                          <span style={{ marginLeft: 6, fontWeight: 500, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div style={{ position: 'relative', flex: '1 1 320px', minWidth: 260 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ position: 'absolute', left: 14, top: 14 }}>
                    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Buscar por contrato, orden, dirección o barrio"
                    aria-label="Buscar por contrato, orden, dirección o barrio"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ boxSizing: 'border-box', width: '100%', minHeight: 44, padding: '0 14px 0 40px', border: '1px solid #CBD5E1', borderRadius: 10, background: '#fff', fontSize: 14, color: '#0F2A5C' }}
                  />
                </div>

                <button
                  ref={botonFiltrosRef}
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={filtrosAbiertos}
                  onClick={() => setFiltrosAbiertos(v => !v)}
                  style={{
                    minHeight: 44, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8,
                    border: `1px solid ${nPanel > 0 ? '#BFDBFE' : '#CBD5E1'}`,
                    background: nPanel > 0 ? '#EFF6FF' : '#fff',
                    color: nPanel > 0 ? '#1D4ED8' : '#0F2A5C',
                    fontWeight: nPanel > 0 ? 600 : 500,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                  Filtros
                  {nPanel > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, background: '#1D4ED8', color: '#fff', borderRadius: 999, padding: '1px 8px' }}>{nPanel}</span>
                  )}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              </div>

              {/* Pastillas de filtros activos */}
              {hayFiltros && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '4px 24px 14px' }}>
                  {chips.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={c.quitar}
                      aria-label={`Quitar filtro ${c.texto}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 10px 0 12px', borderRadius: 999, border: '1px solid #BFDBFE', background: '#EFF6FF', color: '#1D4ED8', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                    >
                      {c.texto}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  ))}
                  <button type="button" onClick={limpiarTodo} style={{ minHeight: 44, padding: '0 10px', border: 0, background: 'none', color: '#1D4ED8', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                    Limpiar filtros
                  </button>
                  <span aria-live="polite" style={{ marginLeft: 'auto', fontSize: 13, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
                    <b style={{ color: '#0F2A5C' }}>{totalCount}</b> {totalCount === 1 ? 'orden' : 'órdenes'}
                  </span>
                </div>
              )}

              {/* Panel de filtros */}
              {filtrosAbiertos && (
                <div
                  ref={panelFiltrosRef}
                  role="dialog"
                  aria-label="Filtros"
                  style={{ position: 'absolute', right: 16, top: 70, width: 620, maxWidth: 'calc(100vw - 48px)', background: '#fff', border: '1px solid #E3E9F4', borderRadius: 14, boxShadow: '0 16px 40px rgba(15,42,92,0.18)', zIndex: 40 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 4px' }}>
                    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0F2A5C' }}>Filtros</h2>
                    <span aria-live="polite" style={{ fontSize: 13, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
                      <b style={{ color: '#0F2A5C' }}>{totalCount}</b> {totalCount === 1 ? 'orden' : 'órdenes'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '12px 20px 16px' }}>
                    <div>
                      <span style={etiquetaCampo}>Localidad</span>
                      <FiltroLista
                        etiqueta="Localidad"
                        textoBoton="Todas"
                        value={localidadFilter}
                        ocupaTodo
                        valorVacio="Todas"
                        textoVacio="Todas las localidades"
                        opciones={localidadesUnicas.filter(Boolean).map(loc => ({ value: loc, label: loc }))}
                        onChange={setLocalidadFilter}
                      />
                    </div>
                    <div>
                      <span style={etiquetaCampo}>Tipo de trabajo</span>
                      <FiltroLista
                        etiqueta="Tipo de trabajo"
                        textoBoton="Todos"
                        value={descripcionFilter}
                        ocupaTodo
                        valorVacio="Todas las Descripciones"
                        textoVacio="Todos los tipos de trabajo"
                        opciones={descripcionesUnicas.filter(Boolean).map(desc => ({ value: desc, label: etiquetaTrabajo(desc) || '(Vacías)' }))}
                        onChange={setDescripcionFilter}
                      />
                    </div>
                    <div>
                      <span style={etiquetaCampo}>Técnico</span>
                      <FiltroLista
                        etiqueta="Técnico"
                        textoBoton="Todos"
                        value={tecnicoFilter}
                        ocupaTodo
                        valorVacio="Todos"
                        textoVacio="Todos los técnicos"
                        buscable
                        opciones={[
                          { value: 'Sin asignar', label: 'Sin asignar' },
                          ...tecnicos
                            .filter(t => t && t.id_usuario)
                            .map(t => ({ value: t.id_usuario, label: nombreTitulo(t.nombre) || '(Vacías)' }))
                            .sort((a, b) => a.label.localeCompare(b.label, 'es')),
                        ]}
                        onChange={setTecnicoFilter}
                      />
                    </div>
                    <div>
                      <span style={etiquetaCampo}>Fecha</span>
                      <SegmentosFiltro
                        etiqueta="Fecha"
                        activo={fechaFilter}
                        onElegir={setFechaFilter}
                        opciones={[
                          { id: 'Todas', texto: 'Todas' },
                          { id: 'Hoy', texto: 'Hoy' },
                          { id: 'Últimos 3 días', texto: '3 días' },
                          { id: 'Vencidas', texto: 'Vencidas' },
                        ]}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={etiquetaCampo}>Alerta</span>
                      <SegmentosFiltro
                        etiqueta="Alerta"
                        activo={modoAlerta}
                        onElegir={(id) =>
                          setAlertaSelected(
                            id === 'todas' ? null
                            : id === 'con' ? new Set(['POSIBLE_DUPLICADA', 'DOBLE'])
                            : id === 'dup' ? new Set(['POSIBLE_DUPLICADA'])
                            : id === 'dob' ? new Set(['DOBLE'])
                            : new Set(['COBRO_HL'])
                          )
                        }
                        opciones={[
                          { id: 'todas', texto: 'Todas' },
                          { id: 'con', texto: 'Con alerta' },
                          { id: 'dup', texto: 'Duplicada' },
                          { id: 'dob', texto: 'Doble' },
                          { id: 'cob', texto: 'Cobro HL' },
                        ]}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 12px 20px', borderTop: '1px solid #EEF2F8', background: '#F8FAFC', borderRadius: '0 0 14px 14px' }}>
                    <button
                      type="button"
                      onClick={limpiarTodo}
                      disabled={!hayFiltros}
                      style={{ marginRight: 'auto', minHeight: 44, padding: '0 4px', border: 0, background: 'none', color: hayFiltros ? '#1D4ED8' : '#94A3B8', fontSize: 14, fontWeight: 500, cursor: hayFiltros ? 'pointer' : 'default' }}
                    >
                      Limpiar filtros
                    </button>
                    <button
                      type="button"
                      onClick={() => { setFiltrosAbiertos(false); botonFiltrosRef.current?.focus(); }}
                      style={{ minHeight: 44, padding: '0 22px', borderRadius: 10, border: 0, background: '#1D4ED8', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {`Ver ${totalCount} ${totalCount === 1 ? 'orden' : 'órdenes'}`}
                    </button>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {(conteoDuplicadas > 0 || alertaSelected !== null) && (
        <div
          role="status"
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '14px 20px', marginTop: 16 }}
        >
          <div style={{ marginRight: 'auto' }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#7F1D1D' }}>
              {conteoDuplicadas === 1 ? '1 orden posible duplicada' : `${conteoDuplicadas} órdenes posibles duplicadas`}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#7F1D1D' }}>
              Tipo 12137, «enmallamiento» y contrato gestionado hace 14 a 21 días. No se cierran solas: tú decides.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAlertaSelected(prev => (prev ? null : new Set(['POSIBLE_DUPLICADA', 'DOBLE'])))}
            style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, background: '#fff', color: '#0F2A5C', border: '1px solid #CBD5E1', fontWeight: 500, fontSize: 14, cursor: 'pointer' }}
          >
            {alertaSelected ? 'Ver todas las órdenes' : 'Ver solo con alerta'}
          </button>
          {conteoDuplicadas > 0 && (
            <button
              type="button"
              onClick={abrirCierreTodasDuplicadas}
              style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, background: '#B91C1C', color: '#fff', border: 0, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
            >
              Cerrar todas como duplicadas
            </button>
          )}
        </div>
      )}

      {/* Tabla de Despacho */}
      <div className={`bg-white rounded-2xl shadow-[0_8px_24px_rgba(15,23,42,0.05)] border border-gray-100 overflow-hidden p-6 mt-4 transition-opacity duration-150 ${loadingOrdenes && !isInitialLoad ? 'opacity-50' : 'opacity-100'}`}>
        <div
          ref={listaRef}
          className="w-full overflow-auto"
          style={{ maxHeight: alturaLista ? `${alturaLista}px` : 'calc(100vh - 330px)', minHeight: 320 }}
        >
          <table className={`w-full ${mostrarAlerta ? 'min-w-[1320px]' : 'min-w-[1160px]'} text-left border-separate border-spacing-0 [&_tbody_td]:border-b [&_tbody_td]:border-[#EEF2F8]`}>
            <thead className="sticky top-0 z-20 bg-gray-50 shadow-[0_1px_0_#E2E8F0]">
              <tr className="bg-gray-50 text-[12px] font-medium text-[#64748B]">
                <th className="py-2.5 px-2.5 w-10">
                  <input
                    type="checkbox"
                    className="rounded"
                    style={{ width: 20, height: 20, cursor: 'pointer', accentColor: '#1D4ED8' }}
                    aria-label="Seleccionar todas las órdenes visibles"
                    checked={isAllVisibleSelected}
                    onChange={handleSelectAll}
                  />
                </th>
                {/* Orden */}
                <th className="py-2.5 px-2.5 relative" style={{ width: '120px' }}>
                  <div className="flex items-center gap-1">
                    <span>Orden</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'orden' ? null : 'orden');
                      }}
                      aria-label="Filtrar columna Orden"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${ordenSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'orden' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={ordenesUnicas.map(o => ({ value: o, label: o }))}
                      selected={ordenSelected}
                      onApply={(next) => { setOrdenSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>

                {/* Contrato */}
                <th className="py-2.5 px-2.5 relative" style={{ width: '100px' }}>
                  <div className="flex items-center gap-1">
                    <span>Contrato</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'contrato' ? null : 'contrato');
                      }}
                      aria-label="Filtrar columna Contrato"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${contratoSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'contrato' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={contratosUnicos.map(c => ({ value: c, label: c }))}
                      selected={contratoSelected}
                      onApply={(next) => { setContratoSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>

                {/* Ubicación */}
                <th className="py-2.5 px-2.5 relative" style={{ width: '400px' }}>
                  <div className="flex items-center gap-1">
                    <span>Ubicación</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'ubicacion' ? null : 'ubicacion');
                      }}
                      aria-label="Filtrar columna Ubicación"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${ubicacionSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'ubicacion' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={localidadesUnicas.map(l => ({ value: l, label: l }))}
                      selected={ubicacionSelected}
                      onApply={(next) => { setUbicacionSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>

                {/* Trabajo */}
                <th className="py-2.5 px-2.5 relative" style={{ width: '200px' }}>
                  <div className="flex items-center gap-1">
                    <span>Trabajo</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'trabajo' ? null : 'trabajo');
                      }}
                      aria-label="Filtrar columna Trabajo"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${trabajoSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'trabajo' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={descripcionesUnicas.map(d => ({ value: d, label: d }))}
                      selected={trabajoSelected}
                      onApply={(next) => { setTrabajoSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>

                {/* Estado */}
                <th className="py-2.5 px-2.5 relative" style={{ width: '124px' }}>
                  <div className="flex items-center gap-1">
                    <span>Estado</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'estado' ? null : 'estado');
                      }}
                      aria-label="Filtrar columna Estado"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${estadoColSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'estado' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={[{ value: 'Pendiente', label: 'Pendiente' }, { value: 'Programada', label: 'Programada' }]}
                      selected={estadoColSelected}
                      onApply={(next) => { setEstadoColSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>

                {/* Días / SLA */}
                {mostrarAlerta && (
                <th className="py-2.5 px-2.5 relative" style={{ width: '160px' }}>
                  <div className="flex items-center gap-1">
                    <span>Alerta</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'alerta' ? null : 'alerta');
                      }}
                      aria-label="Filtrar columna Alerta"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${alertaSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {alertaSelected !== null && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                  </div>
                  {openColumnFilter === 'alerta' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={[
                        { value: 'POSIBLE_DUPLICADA', label: 'Posible duplicada' },
                        { value: 'DOBLE', label: 'Orden doble' },
                        { value: 'COBRO_HL', label: 'Cobro HL' },
                        { value: 'SIN_ALERTA', label: 'Sin alerta' },
                      ]}
                      selected={alertaSelected}
                      onApply={(next) => { setAlertaSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>
                )}
                <th className="py-2.5 px-2.5 relative" style={{ width: '90px' }}>
                  <div className="flex items-center gap-1">
                    <span className="whitespace-nowrap">Días</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'sla' ? null : 'sla');
                      }}
                      aria-label="Filtrar columna Días / SLA"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${slaSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'sla' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={slaDiasUnicos.map(d => ({ value: d, label: `${d} ${d === '1' ? 'día' : 'días'}` }))}
                      selected={slaSelected}
                      onApply={(next) => { setSlaSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>

                {/* Fecha Asignación */}
                <th className="py-2.5 px-2.5 relative" style={{ width: '120px' }}>
                  <div className="flex items-center gap-1">
                    <span className="whitespace-nowrap">Asignación</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'fechaAsig' ? null : 'fechaAsig');
                      }}
                      aria-label="Filtrar columna Fecha de asignación"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${fechaAsigSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'fechaAsig' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={fechasAsigUnicas.map(f => ({ value: f, label: f === '__VACIO__' ? '(Vacías)' : f }))}
                      selected={fechaAsigSelected}
                      onApply={(next) => { setFechaAsigSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>

                {/* F. Programada */}
                <th className="py-2.5 px-2.5 relative" style={{ width: '120px' }}>
                  <div className="flex items-center gap-1">
                    <span className="whitespace-nowrap">Programada</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'fechaProg' ? null : 'fechaProg');
                      }}
                      aria-label="Filtrar columna Fecha programada"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${fechaProgSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'fechaProg' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={fechasProgUnicas.map(f => ({ value: f, label: f === '__VACIO__' ? '(Vacías)' : f }))}
                      selected={fechaProgSelected}
                      onApply={(next) => { setFechaProgSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>

                {/* Técnico */}
                <th className="py-2.5 px-2.5 relative" style={{ width: '170px' }}>
                  <div className="flex items-center gap-1">
                    <span>Técnico</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColumnFilterPosition({ top: rect.bottom + 4, left: rect.left });
                        setOpenColumnFilter(p => p === 'tecnico' ? null : 'tecnico');
                      }}
                      aria-label="Filtrar columna Técnico"
                      className={`p-1.5 -m-1 rounded hover:bg-gray-200 ${tecnicoColSelected !== null ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>
                  {openColumnFilter === 'tecnico' && (
                    <ExcelColumnFilter
                      panelRef={columnFilterRef}
                      position={columnFilterPosition ?? { top: 0, left: 0 }}
                      options={[{ value: 'SIN_ASIGNAR', label: 'Sin asignar' }, ...tecnicos.map(t => ({ value: t.id_usuario, label: t.nombre }))]}
                      selected={tecnicoColSelected}
                      onApply={(next) => { setTecnicoColSelected(next); setOpenColumnFilter(null); }}
                      onCancel={() => setOpenColumnFilter(null)}
                    />
                  )}
                </th>
                <th className="py-2.5 px-2.5 text-center" style={{ width: '50px' }}><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody className="text-xs text-gray-700">
              {ordenes.length === 0 ? (
                <tr>
                  <td colSpan={mostrarAlerta ? 12 : 11} className="p-8 text-center text-gray-500">
                    No se encontraron órdenes que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                ordenes.map((row) => {
                  const tecNombre = getTecnicoNombre(row.id_tecnico_asignado as string);
                  const tecDisplay = tecNombre === 'Programado' ? '—' : tecNombre;

                  const esPosibleDup = row.alerta_orden === 'POSIBLE_DUPLICADA' && (row.estado === 'Pendiente' || row.estado === 'Programada');
                  const relDup = String(row.orden_relacionada || '');

                  return (
                  <React.Fragment key={row.orden_trabajo}>
                  <tr
                    className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors duration-150"
                    style={
                      esPosibleDup
                        ? { height: '72px', background: '#FFF5F5', boxShadow: 'inset 3px 0 0 #DC2626' }
                        : selectedOrdenes.includes(row.orden_trabajo)
                          ? { height: '72px', background: '#F0F6FF' }
                          : { height: '72px' }
                    }
                  >
                    <td className="py-2.5 px-2.5">
                      <input
                        type="checkbox"
                        className="rounded"
                        style={{ width: 20, height: 20, cursor: 'pointer', accentColor: '#1D4ED8' }}
                        aria-label={`Seleccionar orden ${row.orden_trabajo}`}
                        checked={selectedOrdenes.includes(row.orden_trabajo)}
                        onChange={(e) => handleSelectOne(row.orden_trabajo, e.target.checked)}
                      />
                    </td>
                    <td className="py-2.5 px-2.5" style={{ height: '72px' }}>
                      <div className="flex flex-col justify-center h-full">
                        <p className="tabular-nums" style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>{row.orden_trabajo}</p>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5" style={{ height: '72px' }}>
                      <div className="flex flex-col justify-center h-full">
                        <p style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>{row.contrato}</p>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5" style={{ height: '72px', wordBreak: 'break-word' }}>
                      <div className="flex flex-col justify-center h-full gap-0.5">
                        <p className="flex items-start gap-1" style={{ fontSize: '14px', fontWeight: 600, color: '#0F2A5C' }}>
                          {row.direccion}
                        </p>
                        <p style={{ fontSize: '13px', fontWeight: 400, color: '#64748B' }}>
                          {[tituloEs(formatBarrio(row.barrio)), tituloEs(String(row.localidad || ''))].filter(t => t && t !== '-').join(' · ')}
                        </p>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5" style={{ height: '72px', color: '#334155' }}>
                      <div className="flex flex-col justify-center h-full">
                        <p title={row.descripcion_del_trabajo || undefined} style={{ fontSize: 13, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {row.descripcion_del_trabajo ? oracionEs(String(row.descripcion_del_trabajo)) : '-'}
                        </p>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 align-middle">
                      <span className="inline-flex items-center gap-2 whitespace-nowrap" style={{ fontSize: 14, fontWeight: 500, color: '#0F2A5C' }}>
                        <span
                          aria-hidden="true"
                          style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: row.estado === 'Programada' ? '#D97706' : '#2563EB' }}
                        />
                        {getEstadoBadge(row.estado).label}
                      </span>
                    </td>
                    {mostrarAlerta && (
                    <td className="py-2.5 px-2.5 align-middle">
                      {row.alerta_orden ? (
                        <div>
                          <span
                            className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full border text-[12px] font-semibold whitespace-nowrap"
                            style={
                              row.alerta_orden === 'POSIBLE_DUPLICADA'
                                ? { background: '#FEE2E2', borderColor: '#FECACA', color: '#B91C1C' }
                                : { background: '#FFF7ED', borderColor: '#FED7AA', color: '#9A3412' }
                            }
                          >
                            {row.alerta_orden === 'POSIBLE_DUPLICADA' ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18.5v.01" /></svg>
                            )}
                            {row.alerta_orden === 'POSIBLE_DUPLICADA' ? 'Duplicada' : 'Doble'}
                          </span>
                          <p className="mt-1 text-[12px] text-[#64748B] tabular-nums">
                            {row.alerta_orden === 'POSIBLE_DUPLICADA' ? 'de' : 'con'} #{relDup}
                          </p>
                        </div>
                      ) : (
                        !row.cobro_hl ? <span className="text-[#CBD5E1]" aria-label="Sin alerta">–</span> : null
                      )}
                      {row.cobro_hl && (
                        <div className={row.alerta_orden ? 'mt-1.5' : ''}>
                          <span
                            className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 rounded-full border text-[12px] font-semibold whitespace-nowrap"
                            style={{ background: '#EEF2FF', borderColor: '#C7D2FE', color: '#3730A3' }}
                            title="La observación dice «OT para cobro HL»"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
                            Cobro HL
                          </span>
                        </div>
                      )}
                    </td>
                    )}
                    <td className="py-2.5 px-2.5">
                      {(() => {
                        const daysSLA = calcularDiasSLA(row.fecha_asignacion_ot);
                        const slaColor = daysSLA >= 3 ? '#B91C1C' : '#475569';
                        return (
                          <span className="inline-flex items-center gap-2 whitespace-nowrap tabular-nums" style={{ fontSize: 14, fontWeight: 600, color: slaColor }}>
                            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: slaColor }} />
                            {daysSLA} {daysSLA === 1 ? 'día' : 'días'}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2.5 px-2.5 whitespace-nowrap tabular-nums" style={{ fontSize: 13, color: '#475569' }}>
                      {formatearFechaPura(row.fecha_asignacion_ot)}
                    </td>
                    <td className="py-2.5 px-2.5 whitespace-nowrap tabular-nums" style={{ fontSize: 13, color: '#475569' }}>
                      {formatearFechaPura(row.fecha_programada)}
                    </td>
                    <td className="py-2.5 px-2.5">
                      {tecDisplay ? (
                        <p className="whitespace-nowrap" style={{ fontSize: 13, color: '#334155' }}>{tecDisplay === '—' ? '—' : nombreTitulo(tecDisplay)}</p>
                      ) : (
                        <p className="text-gray-400 italic">Sin asignar</p>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-center">
                      <button
                        onClick={(e) => {
                          if (openMenuId === row.orden_trabajo) {
                            setOpenMenuId(null);
                            setMenuPosition(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const alturaMenuEstimada = 100;
                            const espacioAbajo = window.innerHeight - rect.bottom;
                            const top = espacioAbajo < alturaMenuEstimada
                              ? rect.top + window.scrollY - alturaMenuEstimada - 4
                              : rect.bottom + window.scrollY + 4;
                            setMenuPosition({
                              top,
                              left: rect.right + window.scrollX - 224,
                            });
                            setOpenMenuId(row.orden_trabajo);
                          }
                        }}
                        className="inline-flex items-center justify-center w-11 h-11 text-[#64748B] hover:text-[#0F2A5C] hover:bg-gray-100 rounded-lg transition-colors"
                        title="Acciones"
                        aria-label={`Acciones de la orden ${row.orden_trabajo}`}
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <circle cx="10" cy="4" r="1.5" />
                          <circle cx="10" cy="10" r="1.5" />
                          <circle cx="10" cy="16" r="1.5" />
                        </svg>
                      </button>
                      {openMenuId === row.orden_trabajo && menuPosition && (
                        <div
                          ref={menuRef}
                          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left }}
                          className="menu-pop w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1 text-left"
                        >
                          <button
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            onClick={() => { abrirReporte(row); setOpenMenuId(null); setMenuPosition(null); }}
                          >
                            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Ver Reporte
                          </button>
                          <div className="border-t border-gray-100 my-1" />
                          <button
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                            onClick={() => { handleDeleteOrdenes([row.orden_trabajo]); setOpenMenuId(null); setMenuPosition(null); }}
                            disabled={isDeleting}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            Eliminar de la base de datos
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {esPosibleDup && (
                    <tr className="border-b border-[#F1F5F9]" style={{ background: '#FFF5F5', boxShadow: 'inset 3px 0 0 #DC2626' }}>
                      <td colSpan={mostrarAlerta ? 12 : 11} style={{ padding: '0 20px 14px 56px' }}>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="mr-auto text-[13px] leading-relaxed text-[#7F1D1D]" style={{ maxWidth: 760 }}>
                            Parece repetir la orden <b>#{relDup}</b>, gestionada hace 2 a 3 semanas en el mismo contrato. Tipo 12137 y la observación dice «enmallamiento».
                          </p>
                          <button
                            type="button"
                            onClick={() => marcarNoDuplicada(row)}
                            className="min-h-[44px] px-4 rounded-lg border border-[#CBD5E1] bg-white text-sm font-medium text-[#0F2A5C] hover:bg-gray-50"
                          >
                            No es duplicada
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDup({ ordenes: [row] })}
                            className="min-h-[44px] px-4 rounded-lg bg-[#B91C1C] text-sm font-semibold text-white hover:bg-[#991B1B]"
                          >
                            Cerrar como duplicada
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pie de la lista ── */}
        {totalCount > 0 && (
          <div ref={footerRef} className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 border-t border-gray-100">
            <p className="text-sm text-gray-500" aria-live="polite">
              Mostrando <span className="font-medium tabular-nums text-gray-700">{ordenes.length}</span> de{' '}
              <span className="font-medium tabular-nums text-gray-700">{totalCount}</span> órdenes
              {selectedOrdenes.length > 0 && (
                <>
                  {' · '}
                  <span className="font-medium tabular-nums text-[#1D4ED8]">{selectedOrdenes.length}</span> seleccionadas
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {ordenes.length < totalCount && limite < MAX_FILAS && (
                <button
                  type="button"
                  onClick={() => setLimite(l => Math.min(l + LOTE, MAX_FILAS))}
                  disabled={loadingOrdenes}
                  className="min-h-[44px] px-4 rounded-lg border border-[#CBD5E1] bg-white text-sm font-medium text-[#0F2A5C] hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingOrdenes ? 'Cargando…' : `Cargar ${Math.min(LOTE, totalCount - ordenes.length)} más`}
                </button>
              )}
              {ordenes.length >= 20 && (
                <button
                  type="button"
                  onClick={volverArriba}
                  className="min-h-[44px] px-4 rounded-lg border border-transparent bg-transparent text-sm font-medium text-[#64748B] hover:text-[#0F2A5C]"
                >
                  ↑ Volver arriba
                </button>
              )}
            </div>
            {ordenes.length >= MAX_FILAS && totalCount > MAX_FILAS && (
              <p className="w-full text-sm text-[#64748B]">
                Hay {totalCount - MAX_FILAS} órdenes más. Usa los filtros de las columnas (técnico, localidad, estado, SLA…) para acotar la lista.
              </p>
            )}
          </div>
        )}
      </div>

      {confirmDup && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(15,42,92,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!cerrandoDup) setConfirmDup(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dup-titulo"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 14, boxShadow: '0 24px 60px rgba(15,42,92,0.25)', overflow: 'hidden' }}
          >
            <div style={{ padding: '20px 24px 12px' }}>
              <h2 id="confirm-dup-titulo" style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#0F2A5C' }}>
                {confirmDup.ordenes.length === 1 ? '¿Cerrar 1 orden como duplicada?' : `¿Cerrar ${confirmDup.ordenes.length} órdenes como duplicadas?`}
              </h2>
              <p style={{ margin: '8px 0 0', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
                Cada una se cierra como <b>Efectiva</b> con la fecha de hoy y las fotos de la orden que ya se gestionó. Queda registrada en su historial y en rojo en Auditoría.
              </p>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: '0 24px', overflowY: 'auto', flex: '1 1 auto' }}>
              {confirmDup.ordenes.map(o => (
                <li key={o.orden_trabajo} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid #EEF2F8', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span><b>{o.orden_trabajo}</b> <span style={{ color: '#64748B' }}>· contrato {o.contrato}</span></span>
                  <span style={{ color: '#B91C1C', fontWeight: 600 }}>de #{String(o.orden_relacionada || '')}</span>
                </li>
              ))}
            </ul>
            <p style={{ margin: 0, padding: '12px 24px 0', fontSize: 13, color: '#64748B' }}>
              Estas órdenes cuentan como «cerradas» en el Dashboard aunque no las atienda un técnico.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 24px 20px' }}>
              <button
                type="button"
                disabled={cerrandoDup}
                onClick={() => setConfirmDup(null)}
                style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, border: '1px solid #CBD5E1', background: '#fff', color: '#0F2A5C', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={cerrandoDup}
                onClick={confirmarCierreDuplicadas}
                style={{ minHeight: 44, padding: '0 20px', borderRadius: 10, border: 0, background: '#B91C1C', color: '#fff', fontSize: 14, fontWeight: 600, cursor: cerrandoDup ? 'wait' : 'pointer', opacity: cerrandoDup ? 0.7 : 1 }}
              >
                {cerrandoDup ? 'Cerrando…' : confirmDup.ordenes.length === 1 ? 'Cerrar la orden' : `Cerrar las ${confirmDup.ordenes.length} órdenes`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panel flotante de asignación masiva */}
      {selectedOrdenes.length > 0 && <div style={{ height: 96 }} aria-hidden="true" />}
      {selectedOrdenes.length > 0 && (
        <div className="fixed bottom-0 left-64 right-0 z-10 px-6 pb-4 pointer-events-none">
          <div
            role="region"
            aria-label="Acciones sobre las órdenes seleccionadas"
            className="barra-asignacion pointer-events-auto"
            style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px 18px',
              background: '#fff', border: '1px solid #E3E9F4', borderRadius: 14, padding: '14px 18px',
              boxShadow: '0 8px 24px -8px rgba(15,42,92,0.18)',
            }}
          >
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0F2A5C', fontVariantNumeric: 'tabular-nums' }}>
                {selectedOrdenes.length} {selectedOrdenes.length === 1 ? 'orden seleccionada' : 'órdenes seleccionadas'}
              </p>
              <button
                type="button"
                onClick={() => { setSelectedOrdenes([]); setSelectedTecnicoId(''); }}
                style={{ minHeight: 32, padding: 0, border: 0, background: 'none', color: '#1D4ED8', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                Limpiar selección
              </button>
            </div>

            <div style={{ width: 300, maxWidth: '100%' }}>
              <TecnicoCombobox
                tecnicos={tecnicos}
                value={selectedTecnicoId}
                onChange={setSelectedTecnicoId}
                disabled={isAssigning}
                carga={cargaPorTecnico}
              />
              {selectedTecnicoId && (() => {
                // Las órdenes marcadas que ya son de ese técnico no suman carga nueva.
                const yaSuyas = ordenes.filter(o => selectedOrdenes.includes(o.orden_trabajo) && o.id_tecnico_asignado === selectedTecnicoId).length;
                const quedara = (cargaPorTecnico[selectedTecnicoId] || 0) + selectedOrdenes.length - yaSuyas;
                return (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
                    Quedará con {quedara} {quedara === 1 ? 'orden activa' : 'órdenes activas'}
                  </p>
                );
              })()}
            </div>

            <button
              type="button"
              className="active:scale-[0.97]"
              onClick={handleAsignarBloque}
              disabled={isAssigning || !selectedTecnicoId}
              style={{
                minHeight: 44, padding: '0 22px', border: 0, borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: (isAssigning || !selectedTecnicoId) ? '#CBD5E1' : '#2563EB',
                color: (isAssigning || !selectedTecnicoId) ? '#475569' : '#fff',
                cursor: (isAssigning || !selectedTecnicoId) ? 'not-allowed' : 'pointer',
                transition: 'transform 140ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease',
              }}
            >
              {isAssigning
                ? 'Asignando...'
                : `Asignar ${selectedOrdenes.length} ${selectedOrdenes.length === 1 ? 'orden' : 'órdenes'}`}
            </button>

            <span aria-hidden="true" style={{ width: 1, height: 28, background: '#E3E9F4' }} />

            <button
              type="button"
              className="active:scale-[0.97]"
              onClick={() => handleDeleteOrdenes(selectedOrdenes)}
              disabled={isDeleting}
              style={{
                minHeight: 44, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8,
                border: '1px solid #FECACA', borderRadius: 10, background: '#fff', color: '#B91C1C',
                fontSize: 14, fontWeight: 500, cursor: isDeleting ? 'not-allowed' : 'pointer', opacity: isDeleting ? 0.6 : 1,
                transition: 'transform 140ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {isDeleting ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL — Reporte de la Orden
         ══════════════════════════════════════════════════════════════════ */}
      {reporteOrden && (
        <div className="reporte-overlay fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(17,24,39,0.45)' }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Reporte de la orden ${reporteOrden.orden_trabajo}`}
            className="reporte-modal flex flex-col overflow-hidden"
            style={{
              backgroundColor: '#F7F9FC',
              borderRadius: '14px',
              boxShadow: '0 24px 60px -12px rgba(15,42,92,0.28)',
              width: 'min(70vw, 1200px)',
              maxHeight: '90vh',
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            }}
          >

            {/* ── Header ── */}
            <div
              className="flex items-center justify-between shrink-0"
              style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#fff' }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px 14px', flexWrap: 'wrap', minWidth: 0 }}>
                <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#0F2A5C', margin: 0, letterSpacing: '-0.01em' }}>
                  Reporte de la orden <span style={{ fontVariantNumeric: 'tabular-nums' }}>#{reporteOrden.orden_trabajo}</span>
                </h2>
                {String(reporteOrden.solicitud ?? '').trim() !== '' && (
                  <span style={{ fontSize: '13px', color: '#64748B', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    Solicitud <span style={{ fontWeight: 600, color: '#0F2A5C' }}>{String(reporteOrden.solicitud).trim()}</span>
                  </span>
                )}
              </div>
              <button
                onClick={closeReporte}
                aria-label="Cerrar reporte de la orden"
                className="flex items-center justify-center transition-colors"
                style={{ width: 44, height: 44, borderRadius: '10px', border: '1px solid #E3E9F4', background: '#fff', cursor: 'pointer', color: '#64748B' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#EF4444'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#EF4444'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6B7280'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#E5E7EB'; }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* ── Cuerpo scrollable ── */}
            <div className="flex-1 overflow-y-auto" style={{ padding: '20px 24px' }}>
              {/* ── Resumen de la orden (una sola superficie) ── */}
              {(() => {
                const dias = calcularDiasSLA(reporteOrden.fecha_asignacion_ot);
                const colorSla = dias >= 3 ? '#DC2626' : dias === 2 ? '#EA580C' : '#16A34A';
                const colorEstado =
                  reporteOrden.estado === 'Programada' ? '#D97706'
                  : reporteOrden.estado === 'Efectiva' ? '#16A34A'
                  : reporteOrden.estado === 'Cancelada' ? '#DC2626'
                  : '#2563EB';
                const esProgramada = reporteOrden.estado === 'Programada';
                const nombreUsuario = String(reporteOrden.nombre_usuario ?? '').trim();
                const tecnico = getTecnicoNombre(reporteOrden.id_tecnico_asignado as string) || 'Sin asignar';

                const etiqueta: React.CSSProperties = { fontSize: '12px', color: '#64748B', margin: '0 0 3px' };
                const valor: React.CSSProperties = { fontSize: '15px', fontWeight: 600, color: '#0F2A5C', margin: 0, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' };
                const fila: React.CSSProperties = { padding: '14px 20px', borderTop: '1px solid #E3E9F4' };
                const punto = (c: string) => (
                  <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c, marginRight: 8 }} />
                );

                return (
                  <div style={{ background: '#fff', border: '1px solid #E3E9F4', borderRadius: '12px', marginBottom: '14px', overflow: 'hidden' }}>
                    {/* Fila 1: datos cortos (nunca se parten) */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px 24px', padding: '16px 20px' }}>
                      <div>
                        <p style={etiqueta}>Contrato</p>
                        <p style={valor}>{reporteOrden.contrato || '—'}</p>
                      </div>
                      <div>
                        <p style={etiqueta}>SLA</p>
                        <p style={valor}>{punto(colorSla)}{dias} {dias === 1 ? 'día' : 'días'}</p>
                      </div>
                      <div>
                        <p style={etiqueta}>Fecha de creación</p>
                        <p style={{ ...valor, whiteSpace: 'nowrap' }}>
                          {reporteOrden.fecha_asignacion_ot
                            ? new Date(reporteOrden.fecha_asignacion_ot).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })
                            : '—'}
                        </p>
                      </div>
                      <div>
                        <p style={etiqueta}>Estado</p>
                        <p style={valor}>{punto(colorEstado)}{reporteOrden.estado}</p>
                      </div>
                      {esProgramada && (
                        <div>
                          <p style={etiqueta}>Fecha programada</p>
                          <p style={{ ...valor, color: '#B45309', whiteSpace: 'nowrap' }}>{formatearFechaPura(reporteOrden.fecha_programada)}</p>
                        </div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <p style={etiqueta}>Técnico asignado</p>
                        <p style={{ ...valor, overflowWrap: 'anywhere' }}>{tecnico}</p>
                      </div>
                    </div>

                    {/* Fila 2: Dirección a todo el ancho (la única que puede crecer) */}
                    <div style={fila}>
                      <p style={etiqueta}>Dirección</p>
                      <p style={{ ...valor, overflowWrap: 'anywhere' }}>{reporteOrden.direccion || '—'}</p>
                      {(reporteOrden.barrio || reporteOrden.localidad) && (
                        <p style={{ fontSize: '13px', color: '#64748B', margin: '2px 0 0', overflowWrap: 'anywhere' }}>
                          {reporteOrden.barrio ? `Barrio ${formatBarrio(reporteOrden.barrio)}` : ''}{reporteOrden.barrio && reporteOrden.localidad ? ' · ' : ''}{reporteOrden.localidad || ''}
                        </p>
                      )}
                    </div>

                    {/* Fila 3: Nombre de usuario (solo si existe) */}
                    {nombreUsuario && (
                      <div style={fila}>
                        <p style={etiqueta}>Nombre de usuario</p>
                        <p style={{ ...valor, overflowWrap: 'anywhere' }}>{nombreUsuario}</p>
                      </div>
                    )}

                    {/* Fila 4: Descripción del trabajo */}
                    <div style={fila}>
                      <p style={etiqueta}>Descripción del trabajo</p>
                      <p style={{ fontSize: '14px', fontWeight: 500, color: '#24324A', margin: 0, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                        {String(reporteOrden.descripcion_del_trabajo || '—')}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* ── Aviso de orden doble / posible duplicada ── */}
              {reporteOrden.alerta_orden ? (
                <div
                  style={{
                    marginBottom: '12px', padding: '14px 16px', borderRadius: '14px',
                    border: reporteOrden.alerta_orden === 'POSIBLE_DUPLICADA' ? '1px solid #FECACA' : '1px solid #FED7AA',
                    background: reporteOrden.alerta_orden === 'POSIBLE_DUPLICADA' ? '#FEF2F2' : '#FFF7ED',
                    color: reporteOrden.alerta_orden === 'POSIBLE_DUPLICADA' ? '#991B1B' : '#9A3412',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, lineHeight: 1.5 }}>
                    {reporteOrden.alerta_orden === 'POSIBLE_DUPLICADA'
                      ? `Posible duplicada: el contrato ${reporteOrden.contrato} tuvo la orden ${String(reporteOrden.orden_relacionada || '')} cerrada hace 2-3 semanas (tipo 12137, enmallamiento). Probablemente ya se atendió.`
                      : `Orden doble: el contrato ${reporteOrden.contrato} ya tiene la orden ${String(reporteOrden.orden_relacionada || '')}.`}
                  </p>
                  {reporteOrden.alerta_orden === 'POSIBLE_DUPLICADA' && (reporteOrden.estado === 'Pendiente' || reporteOrden.estado === 'Programada') && (
                    <button
                      type="button"
                      onClick={handleCerrarConOrdenRelacionada}
                      disabled={isGuardando}
                      style={{
                        padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: isGuardando ? 'not-allowed' : 'pointer',
                        background: '#16A34A', color: '#fff', fontSize: '13px', fontWeight: 700, opacity: isGuardando ? 0.6 : 1,
                      }}
                    >
                      {`Cerrar con la orden ${String(reporteOrden.orden_relacionada || '')}`}
                    </button>
                  )}
                </div>
              ) : null}

              {/* ── Datos de la solicitud (solo los que tienen valor) ── */}
              {(() => {
                const campos = [
                  { label: 'Actividad', valor: reporteOrden.actividad },
                  { label: 'Teléfono', valor: reporteOrden.telefono },
                  { label: 'Categoría', valor: reporteOrden.categoria },
                  { label: 'Tipo de inmueble', valor: reporteOrden.tipo_inmueble },
                  { label: 'Estado del producto', valor: reporteOrden.estado_producto },
                  { label: 'Medidor', valor: reporteOrden.numero_medidor },
                  { label: 'Marca del medidor', valor: reporteOrden.marca_medidor },
                  { label: 'Hora acordada', valor: reporteOrden.hora_acordada },
                  { label: 'Unidad operativa', valor: reporteOrden.unidad_operativa },
                  { label: 'Plan comercial', valor: reporteOrden.plan_comercial },
                ].filter(c => String(c.valor ?? '').trim() !== '');
                const observacion = String(reporteOrden.observacion_solicitud ?? '').trim();
                if (campos.length === 0 && !observacion) return null;
                return (
                  <div style={{ background: '#fff', border: '1px solid #E3E9F4', borderRadius: '12px', padding: '16px 20px', marginBottom: '14px' }}>
                    <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#0F2A5C', margin: '0 0 12px' }}>Datos de la solicitud</h2>
                    {campos.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px 28px', marginBottom: observacion ? '16px' : 0 }}>
                        {campos.map(c => (
                          <div key={c.label} style={{ minWidth: 0 }}>
                            <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 2px' }}>{c.label}</p>
                            <p style={{ fontSize: '14px', fontWeight: 500, color: '#0F2A5C', margin: 0, lineHeight: 1.4, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{String(c.valor)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {observacion && (
                      <div>
                        <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 6px' }}>Observación de la solicitud</p>
                        <p style={{ fontSize: '14px', color: '#24324A', margin: 0, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderLeft: '2px solid #CBD5E1', paddingLeft: '12px' }}>{observacion}</p>
                      </div>
                    )}
                  </div>
                );
              })()}


              {/* ── Ítems ejecutados (solo para órdenes Efectiva con ítems) ── */}
              {reporteOrden.estado === 'Efectiva' && (cargandoItems || itemsReporte.length > 0) && (
                <div style={{
                  background: '#F8FAFF',
                  borderRadius: 12,
                  padding: '20px',
                  marginBottom: 20,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    {/* Título izquierda */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36,
                        background: '#EEF2FF',
                        borderRadius: 10,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A3A6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                        </svg>
                      </div>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#1A1A2E' }}>
                          Ítems ejecutados
                        </p>
                        <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>
                          Servicios realizados por el técnico en la orden.
                        </p>
                      </div>
                    </div>

                    {/* Stats derecha: total ítems + cuotas */}
                    <div style={{ display: 'flex', gap: 10 }}>
                      {/* Total de ítems */}
                      {!cargandoItems && itemsReporte.length > 0 && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background: 'white',
                          border: '1px solid #E8EDF5',
                          borderRadius: 10,
                          padding: '8px 14px',
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1A3A6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                          </svg>
                          <div>
                            <p style={{ margin: 0, fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}>Total de ítems ejecutados</p>
                            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1A3A6B', lineHeight: 1.2 }}>
                              {itemsReporte.length}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Cuotas del servicio */}
                      {reporteOrden.numero_cuotas != null && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background: 'white',
                          border: '1px solid #E8EDF5',
                          borderRadius: 10,
                          padding: '8px 14px',
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1A3A6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                          </svg>
                          <div>
                            <p style={{ margin: 0, fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}>Cuotas del servicio</p>
                            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1A3A6B', lineHeight: 1.2 }}>
                              {reporteOrden.numero_cuotas}
                            </p>
                            <p style={{ margin: 0, fontSize: 10, color: '#9CA3AF' }}>(Solo visualización)</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {cargandoItems ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: '#9CA3AF', fontSize: 14 }}>
                      Cargando ítems...
                    </div>
                  ) : itemsReporte.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px', color: '#9CA3AF', fontSize: 13 }}>
                      Sin ítems registrados.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {itemsReporte.map((item) => (
                        <div key={item.id} style={{
                          background: 'white',
                          borderRadius: 10,
                          padding: '14px 16px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          border: '1px solid #E8EDF5',
                        }}>
                          <div style={{
                            width: 36, height: 36,
                            background: '#EEF2FF',
                            borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A3A6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                            </svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#1A1A2E' }}>
                              {item.descripcion}
                            </p>
                            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#1A3A6B', fontWeight: 500 }}>
                              Cód. {item.codigo} • ${item.precio_unitario.toLocaleString('es-CO')}
                            </p>
                          </div>
                          <div style={{
                            background: '#F0F4FF',
                            borderRadius: 8,
                            padding: '8px 16px',
                            textAlign: 'center',
                            flexShrink: 0,
                          }}>
                            <p style={{ margin: 0, fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>
                              Cantidad
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800, color: '#1A3A6B' }}>
                              {item.cantidad}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

{/* Fotos (sin tarjeta de cuotas al lado) */}
<div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '6px 0 10px' }}>
      <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#0F2A5C' }}>Historial de la orden</h2>
      <span style={{ fontSize: '12px', color: '#64748B' }}>Actualizaciones con sus observaciones y fotos</span>
    </div>

              {/* ══════════════════════════════════════════════════════════
                  HISTORIAL DE ATENCIÓN
                 ══════════════════════════════════════════════════════════ */}
              <div style={{ marginTop: '8px' }}>
                {loadingHistorial ? (
                  <div className="flex items-center justify-center py-10">
                    <svg className="animate-spin h-6 w-6" style={{ color: '#1A4D8F' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </div>
                ) : historial.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 16px', background: '#fff', borderRadius: '12px', border: '1px solid #E5E7EB' }}>
                    <svg className="mx-auto" style={{ width: 36, height: 36, color: '#D1D5DB', marginBottom: 8 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p style={{ fontSize: '14px', color: '#6B7280' }}>Aún no hay actualizaciones registradas.</p>
                  </div>
                ) : (
                  /* Timeline vertical compacto */
                  <div style={{ position: 'relative', paddingLeft: '28px' }}>
                    {/* Línea vertical */}
                    <div style={{ position: 'absolute', left: '7px', top: '8px', bottom: '8px', width: '2px', background: '#E5E7EB', borderRadius: '1px' }} />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {historial.map((entry, idx) => {
                        const dotBg = entry.estado === 'Programada' ? '#F59E0B'
                          : entry.estado === 'Cancelada' ? '#EF4444' : '#22C55E';
                        const dotRing = entry.estado === 'Programada' ? '#FEF3C7'
                          : entry.estado === 'Cancelada' ? '#FEE2E2' : '#DCFCE7';
                        const badgeBg = entry.estado === 'Programada' ? '#FEF3C7'
                          : entry.estado === 'Cancelada' ? '#FEE2E2' : '#DCFCE7';
                        const badgeText = entry.estado === 'Programada' ? '#92400E'
                          : entry.estado === 'Cancelada' ? '#991B1B' : '#166534';
                        const badgeBorder = entry.estado === 'Programada' ? '#F59E0B'
                          : entry.estado === 'Cancelada' ? '#EF4444' : '#22C55E';

                        const badgeLabel = entry.estado === 'Cancelada' ? 'Incumplida' : entry.estado;

                        const fotos = entry.fotos || [];
                        const fotosVisibles = fotos.slice(0, 4);
                        const fotosRestantes = fotos.length - 4;

                        const isLastEntry = idx === historial.length - 1;
                        const isExpanded = expandedEntries.has(idx) || (isLastEntry && !expandedEntries.has(-1));

                        const toggleExpand = () => {
                          setExpandedEntries(prev => {
                            const next = new Set(prev);
                            if (isLastEntry && !prev.has(idx) && !prev.has(-1)) {
                              next.add(-1);
                            } else if (next.has(idx)) {
                              next.delete(idx);
                            } else {
                              next.add(idx);
                            }
                            return next;
                          });
                        };

                        return (
                          <div key={idx} style={{ position: 'relative' }}>
                            {/* Dot */}
                            <div style={{
                              position: 'absolute', left: '-28px', top: '12px',
                              width: '14px', height: '14px', borderRadius: '50%',
                              background: dotBg, boxShadow: `0 0 0 4px ${dotRing}`,
                            }} />

                            <div
                              style={{
                                background: '#fff', borderRadius: '12px', border: '1px solid #E5E7EB',
                                overflow: 'hidden', cursor: isExpanded ? 'default' : 'pointer',
                                transition: 'box-shadow 0.15s',
                              }}
                              className={isExpanded ? 'hover:shadow-md' : 'hover:shadow-sm'}
                            >
                              {/* Header row — siempre visible */}
                              <div
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                                  padding: isExpanded ? '12px 16px 8px' : '10px 16px',
                                }}
                                onClick={!isExpanded ? toggleExpand : undefined}
                              >
                                <span style={{
                                  display: 'inline-block', padding: '2px 10px', borderRadius: '9999px',
                                  fontSize: '11px', fontWeight: 700, border: `1px solid ${badgeBorder}`,
                                  background: badgeBg, color: badgeText,
                                }}>
                                  {badgeLabel}
                                </span>
                                <span style={{ fontSize: '12px', color: '#6B7280' }}>
                                  {new Date(entry.fecha).toLocaleString('es-CO', {
                                    timeZone: 'America/Bogota',
                                    day: '2-digit', month: '2-digit', year: 'numeric',
                                    hour: '2-digit', minute: '2-digit', hour12: true,
                                  })}
                                </span>
                                <span style={{ fontSize: '13px', color: '#374151' }}>
                                  {entry.autor_nombre || entry.usuario}
                                  {entry.autor_rol && (
                                    <span style={{ color: '#9CA3AF', fontWeight: 400 }}> ({formatRol(entry.autor_rol)})</span>
                                  )}
                                </span>

                                <button
                                  onClick={(e) => { e.stopPropagation(); copiarTextoHistorial(entry); }}
                                  style={{
                                    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px',
                                    minHeight: 44, padding: '0 14px', background: '#fff', border: '1px solid #E3E9F4', borderRadius: '8px',
                                    cursor: 'pointer', fontSize: '12px', color: '#374151', fontWeight: 500,
                                  }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                  </svg>
                                  Copiar
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleExpand(); }}
                                  style={{
                                    minWidth: 44, minHeight: 44, justifyContent: 'center', padding: '4px', background: 'none', border: 'none',
                                    cursor: 'pointer', color: '#9CA3AF', display: 'flex', alignItems: 'center',
                                    transition: 'color 0.15s',
                                  }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#374151'; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9CA3AF'; }}
                                  title={isExpanded ? 'Colapsar' : 'Expandir'}
                                >
                                  <svg
                                    style={{ width: 16, height: 16, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              </div>

                              {/* Expandable content */}
                              <div style={{
                                maxHeight: isExpanded ? '600px' : '0px',
                                opacity: isExpanded ? 1 : 0,
                                overflow: 'hidden',
                                transition: 'max-height 0.25s ease-in-out, opacity 0.2s ease-in-out',
                              }}>
                                <div style={{ padding: '0 16px 14px' }}>
                                    {/* Texto plano — fecha, causal y técnico ya están en el encabezado de la tarjeta */}
                                    {entry.comentario ? (
                                      <p style={{ fontSize: '14px', color: '#24324A', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
                                        {entry.comentario}
                                      </p>
                                    ) : (
                                      <p style={{ fontSize: '13px', color: '#9CA3AF', fontStyle: 'italic', margin: 0 }}>
                                        No se registró comentario para esta actualización.
                                      </p>
                                    )}

                                    {fotos.length === 0 && (
                                      <p style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '8px' }}>
                                        Sin evidencias fotográficas.
                                      </p>
                                    )}

                                    {/* Fotos (solo si hay) */}
                                    {fotos.length > 0 && (
                                    <div style={{ marginTop: '10px' }}>
                                      <p style={{ fontSize: '11px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Evidencias</p>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {fotosVisibles.map((url, i) => (
                                          <div
                                            key={i}
                                            onClick={() => setLightbox({ fotos, index: i })}
                                            style={{
                                              width: 64, height: 64, borderRadius: '8px', overflow: 'hidden',
                                              cursor: 'pointer', border: '1px solid #E5E7EB',
                                              transition: 'border-color 0.15s, transform 0.15s',
                                            }}
                                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1A4D8F'; (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.05)'; }}
                                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#E5E7EB'; (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'; }}
                                          >
                                            <img src={url} alt={`Foto ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                          </div>
                                        ))}
                                        {fotosRestantes > 0 && (
                                          <div
                                            onClick={() => setLightbox({ fotos, index: 4 })}
                                            style={{
                                              width: 64, height: 64, borderRadius: '8px', background: '#F3F4F6',
                                              border: '1px solid #E5E7EB', display: 'flex', alignItems: 'center',
                                              justifyContent: 'center', fontSize: '13px', color: '#6B7280',
                                              fontWeight: 600, cursor: 'pointer',
                                            }}
                                          >
                                            +{fotosRestantes}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
  </div> {/* Fin columna de fotos */}

              {/* ══════════════════════════════════════════════════════════
                  AGREGAR NUEVA ACTUALIZACIÓN
                 ══════════════════════════════════════════════════════════ */}
              <div style={{ marginTop: '24px' }}>
                <div style={{ borderTop: '2px solid #E5E7EB', marginBottom: '20px' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '16px' }}>Agregar nueva actualización</h3>

                {/* ── 3 botones de estado ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                  {/* Efectiva */}
                  <button
                    type="button"
                    onClick={() => { setNuevoEstado('Efectiva'); setNuevaFechaProgramada(''); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px',
                      borderRadius: '14px', cursor: 'pointer', transition: 'all 0.2s ease',
                      border: nuevoEstado === 'Efectiva' ? '2px solid #22C55E' : '2px solid #E5E7EB',
                      background: nuevoEstado === 'Efectiva' ? '#F0FDF4' : '#fff',
                      boxShadow: nuevoEstado === 'Efectiva' ? '0 0 0 3px rgba(34,197,94,0.15)' : 'none',
                      transform: nuevoEstado === 'Efectiva' ? 'scale(1.02)' : 'scale(1)',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: nuevoEstado === 'Efectiva' ? '#22C55E' : '#F3F4F6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.15s',
                    }}>
                      <svg style={{ width: 14, height: 14, color: nuevoEstado === 'Efectiva' ? '#fff' : '#9CA3AF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#166534', margin: 0 }}>Marcar como Efectiva</p>
                      <p style={{ fontSize: '11px', color: '#6B7280', margin: 0 }}>Orden ejecutada correctamente</p>
                    </div>
                  </button>

                  {/* Programar */}
                  <button
                    type="button"
                    onClick={() => setNuevoEstado('Programada')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px',
                      borderRadius: '14px', cursor: 'pointer', transition: 'all 0.2s ease',
                      border: nuevoEstado === 'Programada' ? '2px solid #F59E0B' : '2px solid #E5E7EB',
                      background: nuevoEstado === 'Programada' ? '#FFFBEB' : '#fff',
                      boxShadow: nuevoEstado === 'Programada' ? '0 0 0 3px rgba(245,158,11,0.15)' : 'none',
                      transform: nuevoEstado === 'Programada' ? 'scale(1.02)' : 'scale(1)',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: nuevoEstado === 'Programada' ? '#F59E0B' : '#F3F4F6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.15s',
                    }}>
                      <svg style={{ width: 14, height: 14, color: nuevoEstado === 'Programada' ? '#fff' : '#9CA3AF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400E', margin: 0 }}>Programar</p>
                      <p style={{ fontSize: '11px', color: '#6B7280', margin: 0 }}>Registrar visita futura</p>
                    </div>
                  </button>

                  {/* Incumplida */}
                  <button
                    type="button"
                    onClick={() => { setNuevoEstado('Cancelada'); setNuevaFechaProgramada(''); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px',
                      borderRadius: '14px', cursor: 'pointer', transition: 'all 0.2s ease',
                      border: nuevoEstado === 'Cancelada' ? '2px solid #EF4444' : '2px solid #E5E7EB',
                      background: nuevoEstado === 'Cancelada' ? '#FEF2F2' : '#fff',
                      boxShadow: nuevoEstado === 'Cancelada' ? '0 0 0 3px rgba(239,68,68,0.15)' : 'none',
                      transform: nuevoEstado === 'Cancelada' ? 'scale(1.02)' : 'scale(1)',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: nuevoEstado === 'Cancelada' ? '#EF4444' : '#F3F4F6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.15s',
                    }}>
                      <svg style={{ width: 14, height: 14, color: nuevoEstado === 'Cancelada' ? '#fff' : '#9CA3AF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#991B1B', margin: 0 }}>Marcar como Incumplida</p>
                      <p style={{ fontSize: '11px', color: '#6B7280', margin: 0 }}>No fue posible ejecutar</p>
                    </div>
                  </button>
                </div>

                {/* ── Campos condicionales (aparecen solo al elegir estado) ── */}
                {!nuevoEstado ? (
                  <div style={{
                    textAlign: 'center', padding: '24px 16px', background: '#fff',
                    borderRadius: '12px', border: '1px dashed #D1D5DB',
                  }}>
                    <p style={{ fontSize: '14px', color: '#9CA3AF', margin: 0 }}>
                      Seleccione un estado para mostrar los campos correspondientes
                    </p>
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#fff', borderRadius: '12px', border: '1px solid #E5E7EB',
                      padding: '20px', animation: 'fadeSlideDown 0.25s ease-out',
                    }}
                  >
                    <style>{`@keyframes fadeSlideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>

                    {/* Fecha programada (solo Programada) */}
                    {nuevoEstado === 'Programada' && (
                      <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Fecha de programación</label>
                        <input
                          type="date"
                          value={nuevaFechaProgramada}
                          onChange={(e) => setNuevaFechaProgramada(e.target.value)}
                          style={{
                            width: '100%', padding: '10px 12px', borderRadius: '10px',
                            border: '1px solid #E5E7EB', fontSize: '14px', color: '#111827',
                            outline: 'none', boxSizing: 'border-box',
                          }}
                          onFocus={e => { (e.currentTarget as HTMLInputElement).style.borderColor = '#F59E0B'; (e.currentTarget as HTMLInputElement).style.boxShadow = '0 0 0 3px rgba(245,158,11,0.1)'; }}
                          onBlur={e => { (e.currentTarget as HTMLInputElement).style.borderColor = '#E5E7EB'; (e.currentTarget as HTMLInputElement).style.boxShadow = 'none'; }}
                        />
                      </div>
                    )}

                    {/* Comentario */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                        {nuevoEstado === 'Programada' ? 'Observación / Comentario' : 'Comentario'}
                      </label>
                      <textarea
                        rows={1}
                        placeholder="Agregar comentario..."
                        value={nuevoComentario}
                        onChange={(e) => {
                          setNuevoComentario(e.target.value);
                          const el = e.currentTarget;
                          el.style.height = 'auto';
                          const maxHeight = 5 * 15 * 1.5; // ≈ 5 líneas a 15px con line-height 1.5
                          el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
                          el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
                        }}
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: '14px',
                          border: '1px solid #E8ECF3', fontSize: '15px', color: '#24324A',
                          resize: 'none', outline: 'none', boxSizing: 'border-box',
                          lineHeight: 1.5, overflow: 'hidden', minHeight: '42px', maxHeight: '112px',
                        }}
                        onFocus={e => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = '#1A4D8F'; (e.currentTarget as HTMLTextAreaElement).style.boxShadow = '0 0 0 3px rgba(26,77,143,0.08)'; }}
                        onBlur={e => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = '#E8ECF3'; (e.currentTarget as HTMLTextAreaElement).style.boxShadow = 'none'; }}
                      />
                    </div>

                    {/* Selector de fotos */}
                    <div style={{ marginBottom: '4px' }}>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Fotografías</label>
                      <div
                        style={{
                          border: '2px dashed #D1D5DB', borderRadius: '10px', padding: '20px',
                          textAlign: 'center', background: '#FAFAFA', cursor: 'pointer',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1A4D8F'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#D1D5DB'; }}
                      >
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => {
                            if (e.target.files) {
                              const archivos = Array.from(e.target.files);
                              setNuevasFotos(prev => [...prev, ...archivos]);
                              e.target.value = '';
                            }
                          }}
                          className="hidden"
                          id="reporte-foto-upload"
                        />
                        <label htmlFor="reporte-foto-upload" style={{ cursor: 'pointer' }}>
                          <svg style={{ width: 28, height: 28, color: '#9CA3AF', margin: '0 auto 6px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>Click para seleccionar fotografías</p>
                          <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>JPG, PNG — múltiples archivos</p>
                        </label>
                      </div>

                      {/* Miniaturas */}
                      {nuevasFotos.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                          {nuevasFotos.map((file, i) => (
                            <div key={i} className="group" style={{ position: 'relative', width: 64, height: 64, borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                              <img
                                src={URL.createObjectURL(file)}
                                alt={`Preview ${i + 1}`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                              <button
                                type="button"
                                onClick={() => setNuevasFotos(prev => prev.filter((_, idx) => idx !== i))}
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{
                                  position: 'absolute', top: 2, right: 2,
                                  width: 18, height: 18, borderRadius: '50%',
                                  background: '#EF4444', color: '#fff', border: 'none',
                                  fontSize: '11px', cursor: 'pointer', display: 'flex',
                                  alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Error */}
                {errorGuardar && (
                  <div style={{
                    marginTop: '12px', padding: '10px 16px', borderRadius: '10px',
                    background: '#FEF2F2', border: '1px solid #FECACA', fontSize: '13px', color: '#991B1B',
                  }}>
                    {errorGuardar}
                  </div>
                )}
              </div>
            </div>

            {/* Nota informativa */}
            {reporteOrden.estado === 'Efectiva' && itemsReporte.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 16px',
                background: '#F0F4FF',
                borderRadius: 10,
                marginTop: 16,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A3A6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p style={{ margin: 0, fontSize: 12, color: '#1A3A6B' }}>
                  La información de ítems y cuotas es solo de referencia y no puede ser editada desde este panel.
                </p>
              </div>
            )}

            {/* ── Footer ── */}
            <div style={{
              flexShrink: 0, borderTop: '1px solid #E5E7EB', padding: '14px 24px',
              background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px',
            }}>
              {!nuevoEstado && !isGuardando && (
                <p style={{ margin: '0 auto 0 0', fontSize: '13px', color: '#64748B' }}>
                  Selecciona un estado para poder guardar la actualización.
                </p>
              )}
              <button
                onClick={closeReporte}
                style={{
                  minHeight: 44, padding: '0 22px', fontSize: '14px', fontWeight: 500, color: '#0F2A5C',
                  background: '#fff', border: '1px solid #D1D5DB', borderRadius: '10px',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F9FAFB'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; }}
              >
                Cerrar
              </button>
              <button
                onClick={handleGuardarActualizacion}
                disabled={isGuardando || !nuevoEstado}
                style={{
                  minHeight: 44, padding: '0 24px', fontSize: '14px', fontWeight: 600, color: (isGuardando || !nuevoEstado) ? '#475569' : '#fff',
                  background: (isGuardando || !nuevoEstado) ? '#CBD5E1' : '#1A4D8F',
                  border: 'none', borderRadius: '10px', cursor: (isGuardando || !nuevoEstado) ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: '8px',
                  opacity: 1,
                }}
                onMouseEnter={e => { if (!isGuardando && nuevoEstado) (e.currentTarget as HTMLButtonElement).style.background = '#153D72'; }}
                onMouseLeave={e => { if (!isGuardando && nuevoEstado) (e.currentTarget as HTMLButtonElement).style.background = '#1A4D8F'; }}
              >
                {isGuardando ? (
                  <>
                    <svg className="animate-spin" style={{ width: 16, height: 16 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Guardando...
                  </>
                ) : (
                  'Guardar actualización'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          LIGHTBOX — Foto ampliada
         ══════════════════════════════════════════════════════════════════ */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="absolute top-4 left-4 flex items-center gap-1 bg-black/50 rounded-full px-2 py-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setZoomLevel((z) => Math.max(1, z - 0.25))}
              className="text-white/90 hover:text-white w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10"
              title="Alejar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11h6" /></svg>
            </button>
            <span className="text-white/90 text-xs font-medium w-10 text-center select-none">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
              className="text-white/90 hover:text-white w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10"
              title="Acercar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 8v6M8 11h6" /></svg>
            </button>
          </div>
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {lightbox.fotos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index - 1 + lightbox.fotos.length) % lightbox.fotos.length }); }}
              className="absolute left-4 text-white/80 hover:text-white transition-colors"
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
          )}

          <div
            className="overflow-auto rounded-lg"
            style={{ width: 'min(900px, 85vw)', height: '75vh' }}
            onWheel={handleWheelZoom}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.fotos[lightbox.index]}
              alt="Evidencia ampliada"
              onClick={handleImageClick}
              className="rounded-lg object-contain mx-auto"
              style={{
                width: `${100 * zoomLevel}%`,
                height: `${100 * zoomLevel}%`,
                cursor: zoomLevel > 1 ? 'zoom-out' : 'zoom-in',
                transition: 'width 150ms ease, height 150ms ease',
              }}
            />
          </div>

          {lightbox.fotos.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index + 1) % lightbox.fotos.length }); }}
              className="absolute right-4 text-white/80 hover:text-white transition-colors"
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          )}
        </div>
      )}
    </>
  );
}
