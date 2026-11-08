'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';
import { supabase } from '@/lib/supabase';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import EquipoTrabajoEditor from '@/components/EquipoTrabajoEditor';
import FiltroLista from '@/components/FiltroLista';
import ExcelColumnFilter, { ColumnTextFilter, ColumnDateFilter } from '@/components/ExcelColumnFilter';
import { useArea } from '@/components/AreaProvider';

interface ItemReporte {
  id: string;
  codigo: string;
  descripcion: string;
  precio_unitario: number;
  cantidad: number;
  subtotal: number;
}

type ItemEditable = {
  id: string | null; // null = ítem nuevo, aún no guardado en items_reporte
  codigo: string;
  descripcion: string;
  precio_unitario: number;
  cantidad: number;
};

type ItemCatalogo = {
  codigo: string;
  descripcion: string;
  precio_unitario: number;
};

type Orden = {
  orden_trabajo: string;
  contrato: string;
  estado: string;
  id_tecnico_asignado?: string;
  fecha_asignacion_ot?: string;
  updated_at?: string;
  fecha_cierre?: string;
  direccion?: string;
  barrio?: string;
  urls_fotos?: string[];
  numero_cuotas?: number | null;
  [key: string]: any;
};

type Tecnico = {
  id_usuario: string;
  nombre: string;
};

const causalLabelPorCodigo: Record<string, string> = {
  '9565': 'Inmueble solo',
  '9584': 'Trabajo ejecutado por tercero',
  '9589': 'Usuario no autoriza',
  '3357': 'Trabajo no ejecutado',
};

type FiltrosCol = {
  tecnicos: string[];    // ids de perfil
  barrios: string[];
  localidades: string[];
  tipos: string[];       // descripcion_del_trabajo
  orden: string;         // texto "contiene"
  contrato: string;
  direccion: string;
};
const FILTROS_COL_VACIOS: FiltrosCol = { tecnicos: [], barrios: [], localidades: [], tipos: [], orden: '', contrato: '', direccion: '' };
const limpiarTextoFiltro = (s: string) => (s ?? '').replace(/[,()%*\\]/g, ' ').trim();
const fechaCorta = (iso: string) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '…');
const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const sumarDiasISO = (iso: string, dias: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const MINUSCULAS_ES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'al', 'por', 'con']);
// "PORTAL DE JAMUNDI (JAMUNDI)" → "Portal de Jamundi (Jamundi)". Null-safe.
const tituloEs = (s?: string | null) => {
  const t = (s ?? '').toString().trim();
  if (!t) return '';
  return t.toLowerCase().split(/\s+/).map((p, i) => {
    if (/^[ivx]+$/.test(p)) return p.toUpperCase();
    if (i > 0 && MINUSCULAS_ES.has(p)) return p;
    return p.replace(/^([("'¿¡]*)([a-záéíóúñü])/, (_m, pre: string, c: string) => pre + c.toUpperCase());
  }).join(' ');
};
// "12155-COTIZAR TRABAJOS VARIOS" → { codigo: '12155', texto: 'Cotizar trabajos varios' }. Null-safe.
const partirTipo = (s?: string | null) => {
  const t = (s ?? '').toString().trim();
  if (!t) return { codigo: '', texto: '' };
  const m = t.match(/^(\d{3,6})\s*[-–]\s*(.+)$/);
  const cuerpo = (m ? m[2] : t).trim().toLowerCase();
  return { codigo: m ? m[1] : '', texto: cuerpo ? cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1) : '' };
};

export default function AuditoriaClient() {
  const { area } = useArea();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtrosCol, setFiltrosCol] = useState<FiltrosCol>(FILTROS_COL_VACIOS);
  const filtrosColRef = useRef<FiltrosCol>(FILTROS_COL_VACIOS);
  filtrosColRef.current = filtrosCol;
  const [panelAbierto, setPanelAbierto] = useState(false);
  const botonFiltrosRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);   // contenedor con scroll de la tabla
  const pieRef = useRef<HTMLDivElement>(null);     // pie con la paginación
  const [alturaLista, setAlturaLista] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(50);
  const [totalGeneral, setTotalGeneral] = useState<number | null>(null);
  const [conteoEstado, setConteoEstado] = useState<{ Efectiva: number; Cancelada: number } | null>(null);
  const [conteoAtajos, setConteoAtajos] = useState<{ hoy: number; ayer: number; sieteDias: number } | null>(null);
  const [opciones, setOpciones] = useState<{ barrio: string[]; localidad: string[]; tipo: string[] }>({ barrio: [], localidad: [], tipo: [] });
  type ColFilterKey = 'fecha' | 'orden' | 'contrato' | 'direccion' | 'barrio' | 'localidad' | 'tipo' | 'estado' | 'tecnico';
  const [openColFilter, setOpenColFilter] = useState<ColFilterKey | null>(null);
  const [colFilterPos, setColFilterPos] = useState<{ top: number; left: number } | null>(null);
  const colFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openColFilter) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-colfilter-caret]')) return;
      if (colFilterRef.current && !colFilterRef.current.contains(target)) {
        setOpenColFilter(null);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [openColFilter]);

  const toggleColFilter = (col: ColFilterKey, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (openColFilter === col) {
      setOpenColFilter(null);
      setColFilterPos(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setColFilterPos({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 260) });
      setOpenColFilter(col);
    }
  };
  const [estadoFilter, setEstadoFilter] = useState('Todos los Estados');
  const [origenFilter, setOrigenFilter] = useState('Todas');
  const soloDuplicadasRef = useRef(false);
  soloDuplicadasRef.current = origenFilter === 'Duplicadas';
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reporteOrden, setReporteOrden] = useState<Orden | null>(null);
  const [itemsReporte, setItemsReporte] = useState<ItemReporte[]>([]);
  const [cargandoItems, setCargandoItems] = useState(false);
  const [modoEdicionItems, setModoEdicionItems] = useState(false);
  const [itemsEditables, setItemsEditables] = useState<ItemEditable[]>([]);
  const [cuotasEditable, setCuotasEditable] = useState<number | ''>('');
  const [isGuardandoEdicion, setIsGuardandoEdicion] = useState(false);
  const [entradaCopiadaIndex, setEntradaCopiadaIndex] = useState<number | null>(null);

  const [catalogoItems, setCatalogoItems] = useState<ItemCatalogo[]>([]);
  const [busquedaCatalogo, setBusquedaCatalogo] = useState('');
  const [itemCatalogoSeleccionado, setItemCatalogoSeleccionado] = useState<ItemCatalogo | null>(null);
  const [cantidadNuevoItem, setCantidadNuevoItem] = useState(1);
  const [lightbox, setLightbox] = useState<{ fotos: string[]; index: number } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [historialAuditoria, setHistorialAuditoria] = useState<any[]>([]);
  const [loadingHistorialAuditoria, setLoadingHistorialAuditoria] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReopening, setIsReopening] = useState<string | null>(null);
  const [descargandoFotos, setDescargandoFotos] = useState(false);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loadingOrdenes, setLoadingOrdenes] = useState(true);
  const [errorOrdenes, setErrorOrdenes] = useState<any>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // ── Paginación ──
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const tecnicosRef = useRef<Tecnico[]>([]);
  tecnicosRef.current = tecnicos;

  // ── Estado para el menú kebab de acciones ──
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reporteOrden) {
      document.body.style.overflow = 'hidden';
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (lightbox) {
            setLightbox(null);
          } else {
            setReporteOrden(null);
            setHistorialAuditoria([]);
            setItemsReporte([]);
            setCargandoItems(false);
            setModoEdicionItems(false);
            setItemsEditables([]);
            setCuotasEditable('');
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

  useEffect(() => {
    setZoomLevel(1);
  }, [lightbox?.fotos, lightbox?.index]);

  const abrirReporte = async (row: Orden) => {
    setReporteOrden(row);
    setModoEdicionItems(false);
    setCuotasEditable(row.numero_cuotas ?? '');
    setBusquedaCatalogo('');
    setItemCatalogoSeleccionado(null);
    setCantidadNuevoItem(1);
    // Cargar ítems del reporte si la orden es Efectiva
    if (row.estado === 'Efectiva') {
      setCargandoItems(true);
      setItemsReporte([]);
      setItemsEditables([]);
      try {
        const { data, error } = await supabase
          .from('items_reporte')
          .select('id, codigo, descripcion, precio_unitario, cantidad, subtotal')
          .eq('orden_trabajo', row.orden_trabajo)
          .order('creado_en', { ascending: true });
        if (!error && data) {
          setItemsReporte(data as ItemReporte[]);
          setItemsEditables(
            (data as ItemReporte[]).map((it) => ({
              id: it.id,
              codigo: it.codigo,
              descripcion: it.descripcion,
              precio_unitario: it.precio_unitario,
              cantidad: it.cantidad,
            }))
          );
        }
      } catch (e) {
        console.error('Error al cargar ítems del reporte:', e);
      } finally {
        setCargandoItems(false);
      }
    } else {
      setItemsReporte([]);
      setItemsEditables([]);
    }
  };

  const fetchHistorialAuditoria = useCallback(async (ordenTrabajo: string) => {
    setLoadingHistorialAuditoria(true);
    const { data: historialData, error } = await supabase
      .from('historial_ordenes')
      .select('*')
      .eq('orden_trabajo', ordenTrabajo)
      .order('fecha', { ascending: true });

    if (error || !historialData) {
      console.error('Error al cargar historial de auditoría:', error);
      setHistorialAuditoria([]);
      setLoadingHistorialAuditoria(false);
      return;
    }

    // JOIN manual con perfiles para obtener el nombre/rol del autor
    const emails = [...new Set(historialData.map((h: any) => h.usuario).filter(Boolean))];
    let perfilesMap: Record<string, { nombre: string; rol: string }> = {};
    if (emails.length > 0) {
      const { data: perfilesData } = await supabase
        .from('perfiles')
        .select('email, nombre, rol')
        .in('email', emails);
      if (perfilesData) {
        perfilesData.forEach((p: any) => {
          perfilesMap[p.email] = { nombre: p.nombre, rol: p.rol };
        });
      }
    }

    const enriched = historialData.map((h: any) => ({
      ...h,
      autor_nombre: perfilesMap[h.usuario]?.nombre || h.usuario,
      autor_rol: perfilesMap[h.usuario]?.rol || h.rol,
    }));

    setHistorialAuditoria(enriched);
    setLoadingHistorialAuditoria(false);
  }, []);

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
    const fetchTecnicos = async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id_usuario, nombre')
        .in('rol', ['Técnico', 'Supervisor'])
        .contains('areas', [area]);
      if (!error && data) {
        setTecnicos(data);
      }
    };
    fetchTecnicos();
  }, [area]);

  useEffect(() => {
    const fetchCatalogoItems = async () => {
      const { data, error } = await supabase
        .from('codigos_trabajo')
        .select('codigo, descripcion, precio_unitario')
        .eq('activo', true)
        .order('descripcion', { ascending: true });
      if (!error && data) setCatalogoItems(data as ItemCatalogo[]);
    };
    fetchCatalogoItems();
  }, []);
  const construirTextoEntrada = (h: any): string => {
    const fecha = new Date(h.fecha).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
    const tecnico = h.autor_nombre || h.usuario;
    const badgeLabel = h.estado === 'Cancelada' ? 'Incumplida' : h.estado;

    // Motivo de no ejecución (solo órdenes incumplidas): "9565-Inmueble solo"
    const causalEntrada = (h.estado === 'Cancelada' || h.estado === 'Incumplida') && h.causal_codigo
      ? (causalLabelPorCodigo[String(h.causal_codigo)] ? `${h.causal_codigo}-${causalLabelPorCodigo[String(h.causal_codigo)]}` : String(h.causal_codigo))
      : '';

    if (h.comentario) {
      return `${fecha} · ${badgeLabel}${causalEntrada ? ` (${causalEntrada})` : ''} · ${tecnico} / ${h.comentario}`;
    }

    if (h.estado === 'Efectiva') {
      const itemsTexto = itemsReporte
        .map((it) => `Se realizó servicio Cód. ${it.codigo} - ${it.descripcion} (x${it.cantidad})`)
        .join('; ');
      const cuotasTexto = reporteOrden?.numero_cuotas != null ? ` Cuotas: ${reporteOrden.numero_cuotas}` : '';
      return `${fecha} · Técnico: ${tecnico}${itemsTexto ? ` / ${itemsTexto}` : ''}${cuotasTexto}`;
    }

    if (h.estado === 'Cancelada') {
      const causalTexto = h.causal_codigo && causalLabelPorCodigo[h.causal_codigo]
        ? `${h.causal_codigo}-${causalLabelPorCodigo[h.causal_codigo]}`
        : (h.causal_codigo || '');
      return `${fecha} · Técnico: ${tecnico}${causalTexto ? ` / Orden incumplida - Causal: ${causalTexto}` : ' / Orden incumplida'}`;
    }

    return '';
  };

  const getTecnicoNombre = (id?: string) => {
    if (!id) return 'Sin asignar';
    const t = tecnicos.find(t => t.id_usuario === id);
    return t ? (t.nombre?.trim() || 'Sin nombre en perfil') : 'Sin nombre en perfil'; // el id se ve en el tooltip de la celda
  };

  // Abre el reporte de una fila (doble clic, Enter o menú ⋮ → Ver Reporte)
  const abrirFila = (row: Orden) => {
    abrirReporte(row);
    fetchHistorialAuditoria(row.orden_trabajo);
    setOpenMenuId(null);
    setMenuPosition(null);
  };

  // ── Reporte de la orden: ayudas de presentación ──
  const cerrarReporte = () => {
    setReporteOrden(null);
    setHistorialAuditoria([]);
    setItemsReporte([]);
    setCargandoItems(false);
    setModoEdicionItems(false);
    setItemsEditables([]);
    setCuotasEditable('');
  };
  // "5232 - PUENTE DEL COMERCIO" → "Puente del Comercio"
  const nombreBarrio = (b?: string) => {
    const limpio = (b || '').replace(/^\s*\d+\s*-\s*/, '').trim();
    if (!limpio) return '—';
    return limpio
      .toLowerCase()
      .split(/\s+/)
      .map((p, i) => (/^[ivx]+$/.test(p) ? p.toUpperCase() : i > 0 && ['de', 'del', 'y'].includes(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
      .join(' ');
  };
  // "Eduard silgado" → "Eduard Silgado"
  const nombrePersona = (n?: string) =>
    (n || '').toLowerCase().split(/\s+/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  const rpt = {
    etiqueta: { margin: '0 0 3px', fontSize: 12, color: '#64748B' } as React.CSSProperties,
    valor: { margin: 0, fontSize: 15, fontWeight: 600, color: '#0F2A5C', overflowWrap: 'anywhere' } as React.CSSProperties,
    tarjeta: { background: '#fff', border: '1px solid #E3E9F4', borderRadius: 12, flexShrink: 0 } as React.CSSProperties,
    h2: { margin: 0, fontSize: 14, fontWeight: 600, color: '#0F2A5C' } as React.CSSProperties,
    pista: { fontSize: 12, color: '#64748B' } as React.CSSProperties,
    botonSecundario: { minHeight: 44, padding: '0 16px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', color: '#0F2A5C', fontSize: 13, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
    campo: { minHeight: 44, boxSizing: 'border-box', border: '1px solid #CBD5E1', borderRadius: 8, padding: '0 12px', fontSize: 14, color: '#0F2A5C', background: '#fff' } as React.CSSProperties,
  };

  const tecnicosUnicos = useMemo(() => {
    return tecnicos.map(t => t.nombre).filter((n): n is string => !!n && !!n.trim()).sort();
  }, [tecnicos]);

  const buildFilteredQuery = useCallback((search: string, estado: string, desde: string, hasta: string, withCount: boolean, soloContar = false) => {
    const f = filtrosColRef.current;
    const query = supabase
      .from('ordenes')
      .select(soloContar ? 'orden_trabajo' : '*', withCount || soloContar ? { count: 'exact', head: soloContar } : undefined)
      .neq('estado', 'Pendiente')
      .eq('area', area);

    const busqueda = limpiarTextoFiltro(search);
    if (busqueda) {
      query.or(`contrato.ilike.%${busqueda}%,orden_trabajo.ilike.%${busqueda}%,direccion.ilike.%${busqueda}%,barrio.ilike.%${busqueda}%`);
    }
    if (estado !== 'Todos los Estados') query.eq('estado', estado);
    if (soloDuplicadasRef.current) query.eq('alerta_orden', 'DUPLICADA_CERRADA');
    if (f.tecnicos.length) query.in('id_tecnico_asignado', f.tecnicos);
    if (f.barrios.length) query.in('barrio', f.barrios);
    if (f.localidades.length) query.in('localidad', f.localidades);
    if (f.tipos.length) query.in('descripcion_del_trabajo', f.tipos);
    const tOrden = limpiarTextoFiltro(f.orden);
    const tContrato = limpiarTextoFiltro(f.contrato);
    const tDireccion = limpiarTextoFiltro(f.direccion);
    if (tOrden) query.ilike('orden_trabajo', `%${tOrden}%`);
    if (tContrato) query.ilike('contrato', `%${tContrato}%`);
    if (tDireccion) query.ilike('direccion', `%${tDireccion}%`);
    if (desde) query.gte('fecha_cierre', `${desde}T00:00:00-05:00`);
    if (hasta) query.lte('fecha_cierre', `${hasta}T23:59:59.999-05:00`);

    if (!soloContar) {
      query.order('fecha_cierre', { ascending: false, nullsFirst: false });
      query.order('orden_trabajo', { ascending: false }); // desempate al paginar
    }
    return query;
  }, [area]);

  const fetchOrdenes = useCallback(async () => {
    setLoadingOrdenes(true);
    setErrorOrdenes(null);

    const query = buildFilteredQuery(debouncedSearch, estadoFilter, startDate, endDate, true);
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;
    query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error al cargar auditoría:', error);
      setErrorOrdenes('No se pudieron cargar las órdenes.');
    } else {
      setOrdenes(data || []);
      setTotalCount(count ?? 0);
    }
    setLoadingOrdenes(false);
    setIsInitialLoad(false);
  }, [buildFilteredQuery, debouncedSearch, estadoFilter, origenFilter, startDate, endDate, currentPage, pageSize, filtrosCol]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedOrders([]);
  }, [debouncedSearch, filtrosCol, estadoFilter, origenFilter, startDate, endDate, pageSize]);

  useEffect(() => {
    fetchOrdenes();
  }, [fetchOrdenes]);

  // Altura de la tabla = lo que queda de pantalla debajo de su borde superior, menos el pie y un margen
  const medirAlturaLista = useCallback(() => {
    const el = listaRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const pie = pieRef.current?.offsetHeight ?? 0;
    const libre = Math.floor(window.innerHeight - top - pie - 32);
    const nueva = Math.max(320, libre);
    setAlturaLista(prev => (prev === nueva ? prev : nueva));
  }, []);

  // Se re-mide en cada render (la barra puede crecer: chips, panel) y al cambiar el tamaño de la ventana
  useEffect(() => { medirAlturaLista(); });
  useEffect(() => {
    window.addEventListener('resize', medirAlturaLista);
    return () => window.removeEventListener('resize', medirAlturaLista);
  }, [medirAlturaLista]);

  // Total de órdenes cerradas del área (para "N de TOTAL órdenes")
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { count } = await supabase
        .from('ordenes')
        .select('orden_trabajo', { count: 'exact', head: true })
        .neq('estado', 'Pendiente')
        .eq('area', area);
      if (!cancelado) setTotalGeneral(count ?? 0);
    })();
    return () => { cancelado = true; };
  }, [area]);

  // Conteo por estado respetando los demás filtros (para los números de las pestañas)
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [e, c] = await Promise.all([
        buildFilteredQuery(debouncedSearch, 'Efectiva', startDate, endDate, true, true),
        buildFilteredQuery(debouncedSearch, 'Cancelada', startDate, endDate, true, true),
      ]);
      if (!cancelado) setConteoEstado({ Efectiva: e.count ?? 0, Cancelada: c.count ?? 0 });
    })();
    return () => { cancelado = true; };
  }, [buildFilteredQuery, debouncedSearch, startDate, endDate, filtrosCol, origenFilter]);

  // Conteo de los atajos de fecha (respeta búsqueda, estado y filtros de columna; ignora las fechas)
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const hoy = hoyBogota();
      const ayer = sumarDiasISO(hoy, -1);
      const hace6 = sumarDiasISO(hoy, -6);
      const [h, a, s] = await Promise.all([
        buildFilteredQuery(debouncedSearch, estadoFilter, hoy, hoy, true, true),
        buildFilteredQuery(debouncedSearch, estadoFilter, ayer, ayer, true, true),
        buildFilteredQuery(debouncedSearch, estadoFilter, hace6, hoy, true, true),
      ]);
      if (!cancelado) setConteoAtajos({ hoy: h.count ?? 0, ayer: a.count ?? 0, sieteDias: s.count ?? 0 });
    })();
    return () => { cancelado = true; };
  }, [buildFilteredQuery, debouncedSearch, estadoFilter, filtrosCol, origenFilter]);

  // Opciones de los filtros por columna (barrio, localidad, tipo de trabajo)
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase.rpc('auditoria_opciones', { p_area: area });
      if (error || !data) { console.error('Opciones de filtros:', error); return; }
      const toList = (campo: string) =>
        (data as { campo: string; valor: string | null }[])
          .filter(r => r.campo === campo && r.valor && r.valor.trim())
          .map(r => r.valor as string)
          .sort((a, b) => a.localeCompare(b, 'es'));
      if (!cancelado) setOpciones({ barrio: toList('barrio'), localidad: toList('localidad'), tipo: toList('tipo') });
    })();
    return () => { cancelado = true; };
  }, [area]);

  // Panel de filtros: Esc o clic fuera lo cierran y el foco vuelve al botón
  useEffect(() => {
    if (!panelAbierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPanelAbierto(false); botonFiltrosRef.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || botonFiltrosRef.current?.contains(t)) return;
      setPanelAbierto(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [panelAbierto]);

  const filteredData = ordenes;

  const isAllSelected = filteredData.length > 0 && selectedOrders.length === filteredData.length;

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredData.map(row => row.orden_trabajo));
    }
  };

  const handleSelectOne = (orden_trabajo: string) => {
    setSelectedOrders(prev => 
      prev.includes(orden_trabajo) 
        ? prev.filter(id => id !== orden_trabajo)
        : [...prev, orden_trabajo]
    );
  };


  const handleDownloadSingle = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      saveAs(blob, filename);
    } catch (err) {
      console.error("Error downloading file", err);
    }
  };

  const descargarFotosOrden = async () => {
    if (!reporteOrden || fotosOrden.length === 0) return;
    setDescargandoFotos(true);
    try {
      const zip = new JSZip();
      const carpeta = zip.folder(`Contrato_${reporteOrden.contrato}_OT_${reporteOrden.orden_trabajo}`);
      if (!carpeta) return;
      let descargadas = 0;
      for (let i = 0; i < fotosOrden.length; i++) {
        try {
          const resp = await fetch(fotosOrden[i]);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          carpeta.file(`Evidencia_${i + 1}.jpg`, await resp.blob());
          descargadas++;
        } catch (err) {
          console.error(`Error al descargar la foto ${i + 1}:`, err);
        }
      }
      if (descargadas === 0) {
        alert('No se pudo descargar ninguna foto.');
        return;
      }
      const contenido = await zip.generateAsync({ type: 'blob' });
      saveAs(contenido, `Fotos_OT_${reporteOrden.orden_trabajo}.zip`);
    } catch (err) {
      console.error('Error generando ZIP de la orden', err);
      alert('Hubo un error al generar el archivo ZIP.');
    } finally {
      setDescargandoFotos(false);
    }
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

  // ── Reabrir orden ──────────────────────────────────────────────────────
  const handleReabrirOrden = async (ordenTrabajo: string) => {
    const confirmado = window.confirm(
      `¿Estás seguro de reabrir la orden ${ordenTrabajo}? Volverá a aparecer en el panel de despacho y en la app del técnico.`
    );
    if (!confirmado) return;

    setIsReopening(ordenTrabajo);
    try {
      const { error } = await supabase
        .from('ordenes')
        .update({ estado: 'Pendiente', fecha_cierre: null, urls_fotos: null })
        .eq('orden_trabajo', ordenTrabajo);

      if (error) {
        console.error('Error al reabrir orden:', error);
        alert('Hubo un error al reabrir la orden.');
      } else {
        // Quitar la orden de la lista local para que desaparezca de auditoría
        setOrdenes(prev => prev.filter(o => o.orden_trabajo !== ordenTrabajo));
        setSelectedOrders(prev => prev.filter(id => id !== ordenTrabajo));
      }
    } catch (err) {
      console.error(err);
      alert('Hubo un error inesperado al reabrir la orden.');
    } finally {
      setIsReopening(null);
    }
  };

  const catalogoFiltrado = useMemo(() => {
    const texto = busquedaCatalogo.trim().toLowerCase();
    if (!texto) return catalogoItems.slice(0, 30);
    return catalogoItems
      .filter((it) => it.descripcion.toLowerCase().includes(texto) || it.codigo.toLowerCase().includes(texto))
      .slice(0, 30);
  }, [catalogoItems, busquedaCatalogo]);

  const handleAgregarItemEditable = () => {
    if (!itemCatalogoSeleccionado || cantidadNuevoItem <= 0) return;
    setItemsEditables((prev) => [
      ...prev,
      {
        id: null,
        codigo: itemCatalogoSeleccionado.codigo,
        descripcion: itemCatalogoSeleccionado.descripcion,
        precio_unitario: itemCatalogoSeleccionado.precio_unitario,
        cantidad: cantidadNuevoItem,
      },
    ]);
    setItemCatalogoSeleccionado(null);
    setBusquedaCatalogo('');
    setCantidadNuevoItem(1);
  };

  const handleEliminarItemEditable = (index: number) => {
    setItemsEditables((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCambiarCantidadEditable = (index: number, cantidad: number) => {
    setItemsEditables((prev) =>
      prev.map((it, i) => (i === index ? { ...it, cantidad: Math.max(1, cantidad) } : it))
    );
  };

  const totalEjecutadoEditable = useMemo(
    () => itemsEditables.reduce((sum, it) => sum + it.precio_unitario * it.cantidad, 0),
    [itemsEditables]
  );

  // Motivo de no ejecución de la orden abierta: el de la entrada de historial más reciente que lo tenga
  const causalCierre = useMemo(() => {
    const conMotivo = [...historialAuditoria].reverse().find((h: any) => h?.causal_codigo);
    if (!conMotivo) return null;
    const codigo = String(conMotivo.causal_codigo);
    return { codigo, texto: causalLabelPorCodigo[codigo] ?? codigo };
  }, [historialAuditoria]);

  // Todas las fotos de la orden abierta (historial + urls_fotos), sin repetidas
  const fotosOrden = useMemo(() => {
    if (!reporteOrden) return [] as string[];
    const delHistorial = historialAuditoria.flatMap((h: any) => (Array.isArray(h.fotos) ? h.fotos : []));
    const respaldo = Array.isArray(reporteOrden.urls_fotos) ? reporteOrden.urls_fotos : [];
    return Array.from(new Set([...delHistorial, ...respaldo].filter((u: any) => typeof u === 'string' && u)));
  }, [reporteOrden, historialAuditoria]);

  const handleGuardarEdicionItems = async () => {
    if (!reporteOrden) return;
    setIsGuardandoEdicion(true);
    try {
      const idsOriginales = itemsReporte.map((it) => it.id);
      const idsActuales = itemsEditables.filter((it) => it.id).map((it) => it.id as string);
      const idsAEliminar = idsOriginales.filter((id) => !idsActuales.includes(id));

      if (idsAEliminar.length > 0) {
        const { error } = await supabase.from('items_reporte').delete().in('id', idsAEliminar);
        if (error) throw error;
      }

      for (const item of itemsEditables) {
        const subtotal = item.precio_unitario * item.cantidad;
        if (item.id) {
          const original = itemsReporte.find((it) => it.id === item.id);
          if (original && original.cantidad !== item.cantidad) {
            const { error } = await supabase
              .from('items_reporte')
              .update({ cantidad: item.cantidad, subtotal })
              .eq('id', item.id);
            if (error) throw error;
          }
        } else {
          const { error } = await supabase.from('items_reporte').insert({
            orden_trabajo: reporteOrden.orden_trabajo,
            codigo: item.codigo,
            descripcion: item.descripcion,
            precio_unitario: item.precio_unitario,
            cantidad: item.cantidad,
            subtotal,
          });
          if (error) throw error;
        }
      }

      const nuevoNumeroCuotas = cuotasEditable === '' ? null : Number(cuotasEditable);
      if (nuevoNumeroCuotas !== (reporteOrden.numero_cuotas ?? null)) {
        const { error } = await supabase
          .from('ordenes')
          .update({ numero_cuotas: nuevoNumeroCuotas })
          .eq('orden_trabajo', reporteOrden.orden_trabajo);
        if (error) throw error;
      }

      const { data: nuevosItems } = await supabase
        .from('items_reporte')
        .select('id, codigo, descripcion, precio_unitario, cantidad, subtotal')
        .eq('orden_trabajo', reporteOrden.orden_trabajo)
        .order('creado_en', { ascending: true });

      const itemsActualizados = (nuevosItems as ItemReporte[]) || [];
      setItemsReporte(itemsActualizados);
      setItemsEditables(
        itemsActualizados.map((it) => ({
          id: it.id,
          codigo: it.codigo,
          descripcion: it.descripcion,
          precio_unitario: it.precio_unitario,
          cantidad: it.cantidad,
        }))
      );
      setReporteOrden((prev) => (prev ? { ...prev, numero_cuotas: nuevoNumeroCuotas } : prev));
      setOrdenes((prev) =>
        prev.map((o) =>
          o.orden_trabajo === reporteOrden.orden_trabajo ? { ...o, numero_cuotas: nuevoNumeroCuotas } : o
        )
      );
      setModoEdicionItems(false);
    } catch (err) {
      console.error('Error al guardar edición de ítems:', err);
      alert('Hubo un error al guardar los cambios. Intenta de nuevo.');
    } finally {
      setIsGuardandoEdicion(false);
    }
  };

  const downloadZipSoportes = async () => {
    try {
      setIsDownloading(true);
      let allFiltered = filteredData;
      if (selectedOrders.length === 0) {
        const query = buildFilteredQuery(debouncedSearch, estadoFilter, startDate, endDate, false);
        const { data, error } = await query;
        if (error || !data) {
          alert('No se pudo generar el reporte.');
          setIsDownloading(false);
          return;
        }
        allFiltered = data;
      }

      const ordersToProcess = selectedOrders.length > 0 
        ? allFiltered.filter(row => selectedOrders.includes(row.orden_trabajo))
        : allFiltered;

      if (ordersToProcess.length === 0) {
        alert("No hay órdenes para descargar.");
        setIsDownloading(false);
        return;
      }

      const zip = new JSZip();

      for (const order of ordersToProcess) {
        if (!order.urls_fotos || order.urls_fotos.length === 0) continue;

        const folderName = `Contrato_${order.contrato}_OT_${order.orden_trabajo}`;
        const folder = zip.folder(folderName);
        if (!folder) continue;

        for (let i = 0; i < order.urls_fotos.length; i++) {
          const url = order.urls_fotos[i];
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const blob = await response.blob();
            folder.file(`Evidencia_${i + 1}.jpg`, blob);
          } catch (fetchError) {
            console.error(`Error al descargar imagen ${url}:`, fetchError);
          }
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const fecha = new Date().toISOString().split('T')[0];
      saveAs(content, `Evidencias_${fecha}.zip`);
      
    } catch (error) {
      console.error('Error generando ZIP', error);
      alert('Hubo un error al generar el archivo ZIP.');
    } finally {
      setIsDownloading(false);
      setSelectedOrders([]);
    }
  };

  const exportToExcel = async () => {
    // Supabase limita cada consulta a 1000 filas: se lee por bloques hasta traer todo el filtro.
    const BLOQUE_ORDENES = 1000;
    const allFiltered: any[] = [];
    for (let desde = 0; ; desde += BLOQUE_ORDENES) {
      const { data: pagina, error } = await buildFilteredQuery(
        debouncedSearch, estadoFilter, startDate, endDate, false
      ).range(desde, desde + BLOQUE_ORDENES - 1);
      if (error || !pagina) {
        console.error('Error exportando órdenes:', error);
        alert('No se pudo generar el reporte.');
        return;
      }
      allFiltered.push(...pagina);
      if (pagina.length < BLOQUE_ORDENES) break;
    }

    // Traer el historial de todas las órdenes exportadas para extraer
    // el comentario y el causal de cierre de cada una.
    const ordenTrabajos = allFiltered.map((row: any) => row.orden_trabajo);
    const historialData: any[] = [];
    if (ordenTrabajos.length > 0) {
      const BLOQUE_HISTORIAL = 100;
      const trozos: string[][] = [];
      for (let i = 0; i < ordenTrabajos.length; i += BLOQUE_HISTORIAL) {
        trozos.push(ordenTrabajos.slice(i, i + BLOQUE_HISTORIAL));
      }
      const respuestas = await Promise.all(
        trozos.map((t) =>
          supabase
            .from('historial_ordenes')
            .select('orden_trabajo, comentario, causal_codigo, fecha, usuario, fotos')
            .in('orden_trabajo', t)
            .order('fecha', { ascending: false })
        )
      );
      respuestas.forEach((r) => {
        if (r.error) {
          console.error('Error cargando historial para el Excel:', r.error);
          return;
        }
        historialData.push(...(r.data || []));
      });
    }

    // JOIN manual con perfiles para obtener el nombre del autor (usuario = email)
    const emailsHistorial = [...new Set(historialData.map((h: any) => h.usuario).filter(Boolean))];
    let perfilesMap: Record<string, string> = {};
    if (emailsHistorial.length > 0) {
      const { data: perfilesData } = await supabase
        .from('perfiles')
        .select('email, nombre')
        .in('email', emailsHistorial);
      if (perfilesData) {
        perfilesData.forEach((p: any) => { perfilesMap[p.email] = p.nombre; });
      }
    }

    // Para cada orden, se toma la entrada de historial MÁS RECIENTE
    // (como ya viene ordenado descendente por fecha, la primera que
    // aparece por cada orden_trabajo es la más reciente — en la
    // práctica, esa es la entrada de cierre, ya que las órdenes
    // exportadas aquí ya están cerradas).
    const cierrePorOrden: Record<string, { comentario?: string; causal_codigo?: string; fecha?: string; autorNombre?: string; fotos?: string[] }> = {};
    historialData.forEach((h: any) => {
      if (!cierrePorOrden[h.orden_trabajo]) {
        cierrePorOrden[h.orden_trabajo] = {
          comentario: h.comentario,
          causal_codigo: h.causal_codigo,
          fecha: h.fecha,
          autorNombre: perfilesMap[h.usuario] || h.usuario,
          fotos: h.fotos || [],
        };
      }
    });

    // Precalcular las fotos de cada orden y el máximo de fotos en este export
    const fotosPorOrden: string[][] = allFiltered.map((row: any) => {
      const cierre = cierrePorOrden[row.orden_trabajo];
      return (row.urls_fotos && row.urls_fotos.length > 0)
        ? row.urls_fotos
        : (cierre?.fotos || []);
    });
    const maxFotos = fotosPorOrden.reduce((max: number, fotos: string[]) => Math.max(max, fotos.length), 0);

    // Cantidad de columnas fijas ANTES de las columnas de fotos (para calcular
    // en qué columna empiezan "Foto 1", "Foto 2", etc.)
    // Fecha Cierre, Nº Orden, Contrato, Dirección, Barrio, Tipo de Trabajo,
    // Estado, Técnico, Causal de Cierre, Comentario = 10 columnas fijas.
    const NUM_COLUMNAS_FIJAS = 11; // + Localidad

    const exportData = allFiltered.map((row: any, idx: number) => {
      const cierre = cierrePorOrden[row.orden_trabajo];
      const causalTexto = cierre?.causal_codigo && causalLabelPorCodigo[cierre.causal_codigo]
        ? `${cierre.causal_codigo}-${causalLabelPorCodigo[cierre.causal_codigo]}`
        : '';
      const badgeLabel = row.estado === 'Cancelada' ? 'Incumplida' : row.estado;

      let comentarioCompleto = '';
      if (cierre?.comentario) {
        const fechaTexto = cierre.fecha
          ? new Date(cierre.fecha).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })
          : '';
        comentarioCompleto = `${fechaTexto} · ${badgeLabel}${causalTexto ? ` (${causalTexto})` : ''} · ${cierre.autorNombre || ''} / ${cierre.comentario}`;
      }

      const fila: Record<string, string> = {
        'Fecha Cierre': row.fecha_cierre ? new Date(row.fecha_cierre).toLocaleString('es-CO', {
          timeZone: 'America/Bogota',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }) : 'Sin fecha',
        'Nº Orden': row.orden_trabajo,
        'Contrato': row.contrato,
        'Dirección': row.direccion || '',
        'Barrio': row.barrio || '',
        'Localidad': row.localidad || '',
        'Tipo de Trabajo': row.descripcion_del_trabajo || '',
        'Estado': row.estado,
        'Técnico': getTecnicoNombre(row.id_tecnico_asignado),
        'Causal de Cierre': causalTexto,
        'Comentario': comentarioCompleto,
      };

      // Una columna "Foto N" por cada foto, hasta el máximo detectado en el export
      const fotos = fotosPorOrden[idx];
      for (let n = 0; n < maxFotos; n++) {
        fila[`Foto ${n + 1}`] = fotos[n] ? `Ver Foto ${n + 1}` : '';
      }

      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Asignar el hipervínculo real a cada celda "Foto N" que tenga URL
    allFiltered.forEach((_row: any, i: number) => {
      const fotos = fotosPorOrden[i];
      for (let n = 0; n < maxFotos; n++) {
        if (fotos[n]) {
          const colIndex = NUM_COLUMNAS_FIJAS + n; // 0-based
          const colLetter = XLSX.utils.encode_col(colIndex);
          const cellRef = `${colLetter}${i + 2}`; // +2: fila 1 son encabezados
          if (worksheet[cellRef]) {
            worksheet[cellRef].l = { Target: fotos[n], Tooltip: `Ver evidencia ${n + 1}` };
          }
        }
      }
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Auditoría');
    XLSX.writeFile(workbook, 'Reporte_Auditoria.xlsx');
  };

  if (loadingOrdenes && isInitialLoad) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <p className="text-sm text-gray-500">Cargando auditoría...</p>
        </div>
      </div>
    );
  }

  // ── Filtros: lógica de la barra (hora de Colombia) ──
  const hoyISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const ayerISO = sumarDiasISO(hoyISO, -1);
  const hace6ISO = sumarDiasISO(hoyISO, -6);
  const atajos: { id: string; texto: string; desde: string; hasta: string; n: number | null }[] = [
    { id: 'todas', texto: 'Todas', desde: '', hasta: '', n: null },
    { id: 'hoy', texto: 'Hoy', desde: hoyISO, hasta: hoyISO, n: conteoAtajos?.hoy ?? null },
    { id: 'ayer', texto: 'Ayer', desde: ayerISO, hasta: ayerISO, n: conteoAtajos?.ayer ?? null },
    { id: '7d', texto: 'Últimos 7 días', desde: hace6ISO, hasta: hoyISO, n: conteoAtajos?.sieteDias ?? null },
  ];
  // Atajo activo: coincide con las fechas puestas; "Todas" = sin fechas; null = rango personalizado
  const atajoActivo: string | null =
    atajos.find(a => a.id !== 'todas' && startDate === a.desde && endDate === a.hasta)?.id
    ?? (!startDate && !endDate ? 'todas' : null);
  const opcionesBarrio = opciones.barrio.map(b => ({ value: b, label: tituloEs((b ?? '').replace(/^\s*\d+\s*-\s*/, '')) || b }));
  const opcionesLocalidad = opciones.localidad.map(l => ({ value: l, label: tituloEs(l) || l }));
  const opcionesTipo = opciones.tipo.map(t => {
    const p = partirTipo(t);
    return { value: t, label: `${p.codigo ? p.codigo + ' · ' : ''}${p.texto || t}` };
  });
  const nombreTecnico = (id: string) => (tecnicos.find(t => t.id_usuario === id)?.nombre?.trim()) || 'Sin nombre en perfil';
  const opcionesTecnico = tecnicos.map(t => ({ value: t.id_usuario, label: t.nombre?.trim() || 'Sin nombre en perfil' }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));

  const setCol = (parcial: Partial<FiltrosCol>) => setFiltrosCol(prev => ({ ...prev, ...parcial }));

  type ChipFiltro = { id: string; texto: string; quitar: () => void };
  const chipsActivos: ChipFiltro[] = [];
  if ((startDate || endDate) && atajoActivo === null) {
    chipsActivos.push({
      id: 'fecha',
      texto: `Cerradas: ${fechaCorta(startDate)} – ${fechaCorta(endDate)}`,
      quitar: () => { setStartDate(''); setEndDate(''); },
    });
  }
  if (filtrosCol.tecnicos.length) chipsActivos.push({ id: 'tec', texto: filtrosCol.tecnicos.length === 1 ? `Técnico: ${nombreTecnico(filtrosCol.tecnicos[0])}` : `Técnicos: ${filtrosCol.tecnicos.length}`, quitar: () => setCol({ tecnicos: [] }) });
  if (filtrosCol.barrios.length) chipsActivos.push({ id: 'bar', texto: filtrosCol.barrios.length === 1 ? `Barrio: ${filtrosCol.barrios[0]}` : `Barrios: ${filtrosCol.barrios.length}`, quitar: () => setCol({ barrios: [] }) });
  if (filtrosCol.localidades.length) chipsActivos.push({ id: 'loc', texto: filtrosCol.localidades.length === 1 ? `Localidad: ${filtrosCol.localidades[0]}` : `Localidades: ${filtrosCol.localidades.length}`, quitar: () => setCol({ localidades: [] }) });
  if (filtrosCol.tipos.length) chipsActivos.push({ id: 'tip', texto: filtrosCol.tipos.length === 1 ? `Tipo: ${filtrosCol.tipos[0]}` : `Tipos: ${filtrosCol.tipos.length}`, quitar: () => setCol({ tipos: [] }) });
  if (filtrosCol.orden.trim()) chipsActivos.push({ id: 'ord', texto: `Orden: ${filtrosCol.orden.trim()}`, quitar: () => setCol({ orden: '' }) });
  if (filtrosCol.contrato.trim()) chipsActivos.push({ id: 'con', texto: `Contrato: ${filtrosCol.contrato.trim()}`, quitar: () => setCol({ contrato: '' }) });
  if (filtrosCol.direccion.trim()) chipsActivos.push({ id: 'dir', texto: `Dirección: ${filtrosCol.direccion.trim()}`, quitar: () => setCol({ direccion: '' }) });
  if (estadoFilter !== 'Todos los Estados') {
    chipsActivos.push({
      id: 'est',
      texto: `Estado: ${estadoFilter === 'Efectiva' ? 'Efectivas' : 'Canceladas'}`,
      quitar: () => setEstadoFilter('Todos los Estados'),
    });
  }
  if (origenFilter !== 'Todas') chipsActivos.push({ id: 'ori', texto: 'Duplicadas cerradas', quitar: () => setOrigenFilter('Todas') });

  const nFiltros = chipsActivos.length;
  const hayFiltros = nFiltros > 0 || !!searchTerm || estadoFilter !== 'Todos los Estados';
  const limpiarFiltros = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
    setFiltrosCol(FILTROS_COL_VACIOS);
    setEstadoFilter('Todos los Estados');
    setOrigenFilter('Todas');
  };
  const limpiarSoloFiltros = () => {   // botón "Limpiar filtros" de chips/panel: no toca búsqueda ni pestaña
    setStartDate('');
    setEndDate('');
    setFiltrosCol(FILTROS_COL_VACIOS);
    setOrigenFilter('Todas');
  };
  const numEfectivas = conteoEstado?.Efectiva ?? 0;
  const numCanceladas = conteoEstado?.Cancelada ?? 0;
  const numTodas = conteoEstado ? numEfectivas + numCanceladas : totalCount;
  const estiloCampoFiltro: React.CSSProperties = {
    boxSizing: 'border-box', width: '100%', minHeight: 44, padding: '0 12px', border: '1px solid #CBD5E1',
    borderRadius: 10, background: '#fff', fontSize: 14, color: '#0F2A5C',
  };
  const estiloEtiquetaFiltro: React.CSSProperties = { display: 'block', margin: '0 0 6px', fontSize: 12, fontWeight: 500, color: '#64748B' };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Auditoría y Soportes</h1>
          <p className="text-sm text-slate-500 mt-1">Historial de órdenes cerradas y descarga de documentos</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={downloadZipSoportes}
            disabled={isDownloading}
            className={`px-5 py-2.5 rounded-lg shadow-sm font-medium transition-colors flex items-center gap-2 text-sm text-white ${isDownloading ? 'bg-green-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
          >
            {isDownloading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Empaquetando...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Descargar Soportes (ZIP)
              </>
            )}
          </button>

          <button
            onClick={exportToExcel}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-5 py-2.5 rounded-lg shadow-sm font-medium transition-colors flex items-center gap-2 text-sm"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Descargar Reporte (Excel)
          </button>

          <div className="h-8 w-px bg-gray-200"></div>

          <NotificationsBell />
          <UserProfile />
        </div>
      </div>

      {errorOrdenes && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 mb-6">
          {errorOrdenes}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        {/* Barra única: atajos de fecha + búsqueda + Filtros */}
        <section aria-label="Filtros" style={{ background: '#fff', border: '1px solid #E3E9F4', borderRadius: 12 }}>
          <div style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: 28, minHeight: 60, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#64748B', whiteSpace: 'nowrap' }}>Cerradas</span>
              <div role="radiogroup" aria-label="Cerradas" style={{ display: 'inline-flex', gap: 2, padding: 4, background: '#F1F5F9', borderRadius: 10, minHeight: 44, boxSizing: 'border-box', alignItems: 'center' }}>
                {atajos.map(a => {
                  const activo = atajoActivo === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={activo}
                      onClick={() => { setStartDate(a.desde); setEndDate(a.hasta); }}
                      style={{
                        minHeight: 36, padding: '0 14px', border: 0, borderRadius: 7, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
                        fontWeight: activo ? 600 : 500, background: activo ? '#fff' : 'transparent', color: activo ? '#0F2A5C' : '#64748B',
                        boxShadow: activo ? '0 1px 2px rgba(15,42,92,0.14)' : 'none',
                      }}
                    >
                      {a.texto}
                      {a.n != null && (
                        <span style={{ marginLeft: 6, fontWeight: 400, color: activo ? '#475569' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>{a.n.toLocaleString('es-CO')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 240 }}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input
                id="aud-buscar"
                type="search"
                aria-label="Buscar por contrato, orden, dirección o barrio"
                placeholder="Buscar por contrato, orden, dirección o barrio"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ ...estiloCampoFiltro, paddingLeft: 38 }}
              />
            </div>

            <button
              ref={botonFiltrosRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={panelAbierto}
              onClick={() => setPanelAbierto(v => !v)}
              style={{
                minHeight: 44, padding: '0 14px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14,
                fontWeight: nFiltros ? 600 : 500,
                border: nFiltros ? '1px solid #BFDBFE' : '1px solid #CBD5E1',
                background: nFiltros ? '#EFF6FF' : '#fff',
                color: nFiltros ? '#1D4ED8' : '#0F2A5C',
              }}
            >
              {!nFiltros && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>}
              Filtros
              {nFiltros > 0 && <span style={{ fontSize: 12, fontWeight: 600, background: '#1D4ED8', color: '#fff', borderRadius: 999, padding: '1px 8px', fontVariantNumeric: 'tabular-nums' }}>{nFiltros}</span>}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
        </section>

        {/* Panel de Filtros (se aplican al instante) */}
        {panelAbierto && (
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Filtros"
            style={{ position: 'absolute', right: 0, top: 68, width: 'min(620px, 100%)', background: '#fff', border: '1px solid #E3E9F4', borderRadius: 14, boxShadow: '0 16px 40px rgba(15,42,92,0.18)', zIndex: 30 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 4px' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0F2A5C' }}>Filtros</h2>
              <span style={{ fontSize: 13, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}><b style={{ color: '#0F2A5C' }}>{totalCount}</b> de {totalGeneral ?? '…'} órdenes</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '12px 20px 16px' }}>
              <div>
                <label htmlFor="aud-desde" style={estiloEtiquetaFiltro}>Cerradas desde</label>
                <input id="aud-desde" type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} style={{ ...estiloCampoFiltro, fontVariantNumeric: 'tabular-nums' }} />
              </div>
              <div>
                <label htmlFor="aud-hasta" style={estiloEtiquetaFiltro}>Cerradas hasta</label>
                <input id="aud-hasta" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} style={{ ...estiloCampoFiltro, fontVariantNumeric: 'tabular-nums' }} />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <span style={estiloEtiquetaFiltro}>Estado</span>
                <div role="radiogroup" aria-label="Estado" style={{ display: 'flex', gap: 2, padding: 4, background: '#F1F5F9', borderRadius: 10, minHeight: 44, boxSizing: 'border-box', alignItems: 'center' }}>
                  {[
                    { v: 'Todos los Estados', t: 'Todas', n: numTodas },
                    { v: 'Efectiva', t: 'Efectivas', n: numEfectivas },
                    { v: 'Cancelada', t: 'Canceladas', n: numCanceladas },
                  ].map(o => {
                    const a = estadoFilter === o.v;
                    return (
                      <button
                        key={o.v}
                        type="button"
                        role="radio"
                        aria-checked={a}
                        onClick={() => setEstadoFilter(o.v)}
                        style={{ flex: 1, minHeight: 36, borderRadius: 7, border: 0, cursor: 'pointer', fontSize: 13, fontWeight: a ? 600 : 500, background: a ? '#fff' : 'transparent', color: a ? '#0F2A5C' : '#64748B', boxShadow: a ? '0 1px 2px rgba(15,42,92,0.14)' : 'none' }}
                      >
                        {o.t} <span style={{ fontWeight: 400, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>{o.n.toLocaleString('es-CO')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span style={estiloEtiquetaFiltro}>Localidad</span>
                <FiltroLista
                  etiqueta="Localidad"
                  textoBoton="Todas"
                  value={filtrosCol.localidades[0] ?? 'Todas'}
                  ocupaTodo
                  valorVacio="Todas"
                  textoVacio="Todas las localidades"
                  opciones={opcionesLocalidad}
                  onChange={(v) => setCol({ localidades: v === 'Todas' || !v ? [] : [v] })}
                  buscable
                />
              </div>
              <div>
                <span style={estiloEtiquetaFiltro}>Técnico</span>
                <FiltroLista
                  etiqueta="Técnico"
                  textoBoton="Todos"
                  value={filtrosCol.tecnicos[0] ?? 'Todos'}
                  ocupaTodo
                  valorVacio="Todos"
                  textoVacio="Todos los técnicos"
                  opciones={opcionesTecnico}
                  onChange={(v) => setCol({ tecnicos: v === 'Todos' || !v ? [] : [v] })}
                  buscable
                />
              </div>
              <div>
                <span style={estiloEtiquetaFiltro}>Barrio</span>
                <FiltroLista
                  etiqueta="Barrio"
                  textoBoton="Todos"
                  value={filtrosCol.barrios[0] ?? 'Todos'}
                  ocupaTodo
                  valorVacio="Todos"
                  textoVacio="Todos los barrios"
                  opciones={opcionesBarrio}
                  onChange={(v) => setCol({ barrios: v === 'Todos' || !v ? [] : [v] })}
                  buscable
                />
              </div>
              <div>
                <span style={estiloEtiquetaFiltro}>Tipo de trabajo</span>
                <FiltroLista
                  etiqueta="Tipo de trabajo"
                  textoBoton="Todos"
                  value={filtrosCol.tipos[0] ?? 'Todos'}
                  ocupaTodo
                  valorVacio="Todos"
                  textoVacio="Todos los tipos"
                  opciones={opcionesTipo}
                  onChange={(v) => setCol({ tipos: v === 'Todos' || !v ? [] : [v] })}
                  buscable
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <span style={estiloEtiquetaFiltro}>Origen</span>
                <div role="radiogroup" aria-label="Origen" style={{ display: 'flex', gap: 2, padding: 4, background: '#F1F5F9', borderRadius: 10, minHeight: 44, boxSizing: 'border-box', alignItems: 'center' }}>
                  {[{ v: 'Todas', t: 'Todas' }, { v: 'Duplicadas', t: 'Duplicadas cerradas' }].map(o => {
                    const a = origenFilter === o.v;
                    return (
                      <button
                        key={o.v}
                        type="button"
                        role="radio"
                        aria-checked={a}
                        onClick={() => setOrigenFilter(o.v)}
                        style={{ flex: 1, minHeight: 36, borderRadius: 7, border: 0, cursor: 'pointer', fontSize: 13, fontWeight: a ? 600 : 500, background: a ? '#fff' : 'transparent', color: a ? '#0F2A5C' : '#64748B', boxShadow: a ? '0 1px 2px rgba(15,42,92,0.14)' : 'none' }}
                      >
                        {o.t}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 12px 20px', borderTop: '1px solid #EEF2F8', background: '#F8FAFC', borderRadius: '0 0 14px 14px' }}>
              <button type="button" onClick={limpiarSoloFiltros} style={{ minHeight: 44, padding: '0 4px', border: 0, background: 'none', color: '#1D4ED8', fontSize: 14, fontWeight: 500, cursor: 'pointer', marginRight: 'auto' }}>
                Limpiar filtros
              </button>
              <button type="button" onClick={() => { setPanelAbierto(false); botonFiltrosRef.current?.focus(); }} style={{ minHeight: 44, padding: '0 22px', borderRadius: 10, border: 0, background: '#1D4ED8', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Ver {totalCount} {totalCount === 1 ? 'orden' : 'órdenes'}
              </button>
            </div>
          </div>
        )}

        {/* Chips de filtros activos + total */}
        {nFiltros > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {chipsActivos.map(c => (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, boxSizing: 'border-box', padding: '0 4px 0 14px', borderRadius: 999, border: '1px solid #BFDBFE', background: '#EFF6FF', color: '#1D4ED8', fontSize: 13, fontWeight: 500, maxWidth: 360 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.texto}</span>
                <button type="button" onClick={c.quitar} aria-label={`Quitar filtro ${c.texto}`} style={{ width: 28, height: 28, borderRadius: 999, border: 0, background: 'none', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </span>
            ))}
            {nFiltros > 0 && (
              <button type="button" onClick={limpiarSoloFiltros} style={{ minHeight: 44, padding: '0 8px', border: 0, background: 'none', color: '#1D4ED8', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                Limpiar filtros
              </button>
            )}
            <span aria-live="polite" style={{ marginLeft: 'auto', fontSize: 13, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
              <b style={{ color: '#0F2A5C' }}>{totalCount}</b> de {totalGeneral ?? '…'} órdenes
            </span>
          </div>
        )}
      </div>

      <div className={`bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden transition-opacity duration-150 ${loadingOrdenes && !isInitialLoad ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
        <div ref={listaRef} className="w-full overflow-auto" style={{ maxHeight: alturaLista ? `${alturaLista}px` : 'calc(100vh - 300px)', minHeight: 320 }}>
          <table className="w-full text-left border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 w-12 text-center">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Fecha de Cierre</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('fecha', e)}
                      aria-label="Filtrar por Fecha de Cierre"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${startDate || endDate ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {Boolean(startDate || endDate) && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'fecha' && (
                      <ColumnDateFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        startDate={startDate}
                        endDate={endDate}
                        onApply={(desde, hasta) => {
                          setStartDate(desde);
                          setEndDate(hasta);
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Nº Orden</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('orden', e)}
                      aria-label="Filtrar por Nº Orden"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${filtrosCol.orden.trim() ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {Boolean(filtrosCol.orden.trim()) && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'orden' && (
                      <ColumnTextFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        value={filtrosCol.orden}
                        placeholder="Contiene Nº Orden…"
                        onApply={(v) => {
                          setCol({ orden: v });
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Contrato</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('contrato', e)}
                      aria-label="Filtrar por Contrato"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${filtrosCol.contrato.trim() ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {Boolean(filtrosCol.contrato.trim()) && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'contrato' && (
                      <ColumnTextFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        value={filtrosCol.contrato}
                        placeholder="Contiene Contrato…"
                        onApply={(v) => {
                          setCol({ contrato: v });
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Dirección</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('direccion', e)}
                      aria-label="Filtrar por Dirección"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${filtrosCol.direccion.trim() ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {Boolean(filtrosCol.direccion.trim()) && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'direccion' && (
                      <ColumnTextFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        value={filtrosCol.direccion}
                        placeholder="Contiene Dirección…"
                        onApply={(v) => {
                          setCol({ direccion: v });
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Barrio</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('barrio', e)}
                      aria-label="Filtrar por Barrio"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${filtrosCol.barrios.length ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {filtrosCol.barrios.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'barrio' && (
                      <ExcelColumnFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        options={opcionesBarrio}
                        selected={filtrosCol.barrios.length ? new Set(filtrosCol.barrios) : null}
                        onApply={(next) => {
                          setCol({ barrios: next ? Array.from(next) : [] });
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Localidad</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('localidad', e)}
                      aria-label="Filtrar por Localidad"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${filtrosCol.localidades.length ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {filtrosCol.localidades.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'localidad' && (
                      <ExcelColumnFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        options={opcionesLocalidad}
                        selected={filtrosCol.localidades.length ? new Set(filtrosCol.localidades) : null}
                        onApply={(next) => {
                          setCol({ localidades: next ? Array.from(next) : [] });
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Tipo de trabajo</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('tipo', e)}
                      aria-label="Filtrar por Tipo de trabajo"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${filtrosCol.tipos.length ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {filtrosCol.tipos.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'tipo' && (
                      <ExcelColumnFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        options={opcionesTipo}
                        selected={filtrosCol.tipos.length ? new Set(filtrosCol.tipos) : null}
                        onApply={(next) => {
                          setCol({ tipos: next ? Array.from(next) : [] });
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Estado</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('estado', e)}
                      aria-label="Filtrar por Estado"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${estadoFilter !== 'Todos los Estados' ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {estadoFilter !== 'Todos los Estados' && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'estado' && (
                      <ExcelColumnFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        options={[
                          { value: 'Efectiva', label: 'Efectiva' },
                          { value: 'Cancelada', label: 'Cancelada' },
                        ]}
                        selected={estadoFilter === 'Todos los Estados' ? null : new Set([estadoFilter])}
                        onApply={(next) => {
                          if (!next || next.size === 0 || next.size === 2) {
                            setEstadoFilter('Todos los Estados');
                          } else if (next.has('Efectiva')) {
                            setEstadoFilter('Efectiva');
                          } else if (next.has('Cancelada')) {
                            setEstadoFilter('Cancelada');
                          }
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  <div className="flex items-center gap-1">
                    <span>Técnico</span>
                    <button
                      type="button"
                      data-colfilter-caret="true"
                      onClick={(e) => toggleColFilter('tecnico', e)}
                      aria-label="Filtrar por Técnico"
                      className={`p-1 -m-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${filtrosCol.tecnicos.length ? 'text-blue-600' : 'text-gray-400'}`}
                    >
                      {filtrosCol.tecnicos.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {openColFilter === 'tecnico' && (
                      <ExcelColumnFilter
                        panelRef={colFilterRef}
                        position={colFilterPos ?? { top: 0, left: 0 }}
                        options={opcionesTecnico}
                        selected={filtrosCol.tecnicos.length ? new Set(filtrosCol.tecnicos) : null}
                        onApply={(next) => {
                          setCol({ tecnicos: next ? Array.from(next) : [] });
                          setOpenColFilter(null);
                        }}
                        onCancel={() => setOpenColFilter(null)}
                      />
                    )}
                  </div>
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 py-2 px-3 text-center text-xs uppercase text-gray-500 font-semibold tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="text-xs text-gray-700">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 px-6 text-center text-gray-500">
                    No hay órdenes en historial o que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                filteredData.map((row) => {
                  const bordeFila = row.alerta_orden === 'DUPLICADA_CERRADA' ? 'border-b border-red-100' : 'border-b border-gray-100';
                  return (
                    <tr
                      key={row.orden_trabajo}
                      tabIndex={0}
                      title="Doble clic para abrir el reporte · Enter con el teclado"
                      onDoubleClick={(e) => {
                        // No abrir si el doble clic fue sobre la casilla, un botón o el menú
                        if ((e.target as HTMLElement).closest('input, button, a, label')) return;
                        window.getSelection()?.removeAllRanges();
                        abrirFila(row);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.target === e.currentTarget) {
                          e.preventDefault();
                          abrirFila(row);
                        }
                      }}
                      className={`transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 ${row.alerta_orden === 'DUPLICADA_CERRADA' ? 'bg-red-50 hover:bg-red-100/70' : 'hover:bg-gray-50'}`}
                    >
                      <td
                        className={`py-2 px-3 text-center ${bordeFila}`}
                        style={row.alerta_orden === 'DUPLICADA_CERRADA' ? { boxShadow: 'inset 3px 0 0 #DC2626' } : undefined}
                      >
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4"
                          checked={selectedOrders.includes(row.orden_trabajo)}
                          onChange={() => handleSelectOne(row.orden_trabajo)}
                        />
                      </td>
                      <td className={`py-2 px-3 text-gray-900 ${bordeFila}`}>
                        {row.fecha_cierre ? new Date(row.fecha_cierre).toLocaleString('es-CO', {
                          timeZone: 'America/Bogota',
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true
                        }) : 'Sin fecha'}
                      </td>
                      <td className={`py-2 px-3 font-medium text-gray-900 ${bordeFila}`}>{row.orden_trabajo}</td>
                      <td className={`py-2 px-3 text-gray-500 ${bordeFila}`}>{row.contrato}</td>
                      <td className={`py-2 px-3 text-gray-500 max-w-[180px] truncate ${bordeFila}`} title={row.direccion || '-'}>{row.direccion || '-'}</td>
                      <td className={`py-2 px-3 text-gray-500 max-w-[180px] truncate ${bordeFila}`} title={row.barrio || '-'}>{tituloEs((row.barrio ?? '').replace(/^\s*\d+\s*-\s*/, '')) || '-'}</td>
                      <td className={`py-2 px-3 text-gray-500 max-w-[150px] truncate ${bordeFila}`} title={row.localidad || '-'}>{tituloEs(row.localidad) || '-'}</td>
                      <td className={`py-2 px-3 text-gray-600 max-w-[240px] truncate ${bordeFila}`} title={row.descripcion_del_trabajo || '-'}>
                        {(() => {
                          const tp = partirTipo(row.descripcion_del_trabajo);
                          return (
                            <>
                              {tp.codigo && <span className="text-gray-400 tabular-nums mr-1.5">{tp.codigo}</span>}
                              {tp.texto || '-'}
                            </>
                          );
                        })()}
                      </td>
                      <td className={`py-2 px-3 ${bordeFila}`}>
                        <span className="inline-flex items-center gap-2 font-medium text-gray-800">
                          <span aria-hidden="true" className={`w-2 h-2 rounded-full ${row.estado === 'Cancelada' ? 'bg-red-600' : 'bg-green-600'}`} />
                          {row.estado}
                        </span>
                        {row.alerta_orden === 'DUPLICADA_CERRADA' && (
                          <p className="mt-1 text-[12px] font-semibold text-red-700 tabular-nums">
                            Duplicada de #{String(row.orden_relacionada || '')}
                          </p>
                        )}
                      </td>
                      <td
                        className={`py-2 px-3 text-gray-600 ${bordeFila}`}
                        title={getTecnicoNombre(row.id_tecnico_asignado) === 'Sin nombre en perfil' ? `Este técnico no tiene nombre en su perfil (id ${row.id_tecnico_asignado ?? ''})` : undefined}
                      >
                        {(() => {
                          const n = getTecnicoNombre(row.id_tecnico_asignado);
                          return n === 'Sin nombre en perfil' || n === 'Sin asignar'
                            ? <span className="italic text-gray-400">{n}</span>
                            : tituloEs(n);
                        })()}
                      </td>
                      <td className={`py-2 px-3 text-center ${bordeFila}`}>
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
                          className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"
                          title="Acciones"
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
                            onDoubleClick={(e) => e.stopPropagation()}
                            style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left }}
                            className="w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1 text-left"
                          >
                            <button
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-blue-700 hover:bg-blue-50 transition-colors"
                              onClick={() => {
                                abrirReporte(row);
                                fetchHistorialAuditoria(row.orden_trabajo);
                                setOpenMenuId(null);
                                setMenuPosition(null);
                              }}
                            >
                              📄 Ver Reporte
                            </button>
                            <button
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50"
                              onClick={() => { handleReabrirOrden(row.orden_trabajo); setOpenMenuId(null); setMenuPosition(null); }}
                              disabled={isReopening === row.orden_trabajo}
                            >
                              {isReopening === row.orden_trabajo ? (
                                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              )}
                              Reabrir orden
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Paginación ── */}
        {totalCount > 0 && (() => {
          const totalPages = Math.ceil(totalCount / pageSize);
          const from = (currentPage - 1) * pageSize + 1;
          const to = Math.min(currentPage * pageSize, totalCount);

          // Generar números de página visibles
          const pages: (number | '...')[] = [];
          if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
          } else {
            pages.push(1);
            if (currentPage > 3) pages.push('...');
            for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
              pages.push(i);
            }
            if (currentPage < totalPages - 2) pages.push('...');
            pages.push(totalPages);
          }

          return (
            <div ref={pieRef} className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50/50">
              <p className="text-sm text-gray-500">
                Mostrando <span className="font-medium text-gray-700">{from}</span> a{' '}
                <span className="font-medium text-gray-700">{to}</span> de{' '}
                <span className="font-medium text-gray-700">{totalCount}</span> órdenes
              </p>
              <label className="flex items-center gap-2 text-sm text-gray-500">
                Filas por página
                <select
                  value={pageSize}
                  aria-label="Filas por página"
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700"
                  style={{ minHeight: 36 }}
                >
                  {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-1">
                {/* Flecha anterior */}
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ←
                </button>
                {/* Números */}
                {pages.map((p, i) =>
                  p === '...' ? (
                    <span key={`dots-${i}`} className="px-2 py-1 text-sm text-gray-400">...</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p as number)}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        currentPage === p
                          ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-sm'
                          : 'border-gray-200 text-gray-700 bg-white hover:bg-gray-50'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
                {/* Flecha siguiente */}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  →
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {reporteOrden && (
        <div className="reporte-overlay fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reporte-titulo"
            className="reporte-modal flex flex-col overflow-hidden"
            style={{
              width: 'min(1100px, 92vw)', height: 'min(860px, 90vh)', background: '#fff',
              border: '1px solid #E3E9F4', borderRadius: 14, boxShadow: '0 24px 60px -12px rgba(15,42,92,0.28)',
              fontFamily: 'inherit', color: '#0F2A5C',
            }}
          >
            {/* Cabecera fija */}
            <div className="shrink-0" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', background: '#fff', borderBottom: '1px solid #E3E9F4' }}>
              <h2 id="reporte-titulo" style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: '#0F2A5C' }}>
                Reporte de la orden <span style={{ fontVariantNumeric: 'tabular-nums' }}>#{reporteOrden.orden_trabajo}</span>
              </h2>
              <button
                type="button"
                onClick={cerrarReporte}
                aria-label="Cerrar reporte de la orden"
                style={{ width: 44, height: 44, borderRadius: 10, border: '1px solid #E3E9F4', background: '#fff', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Cuerpo con scroll interno + degradado inferior */}
            <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px 36px', background: '#F7F9FC', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Resumen de la orden */}
              <div style={{ ...rpt.tarjeta, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px 24px', padding: '16px 20px' }}>
                  <div>
                    <p style={rpt.etiqueta}>Contrato</p>
                    <p style={{ ...rpt.valor, fontVariantNumeric: 'tabular-nums' }}>{reporteOrden.contrato}</p>
                  </div>
                  <div>
                    <p style={rpt.etiqueta}>Estado</p>
                    <p style={rpt.valor}>
                      <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: reporteOrden.estado === 'Cancelada' ? '#DC2626' : '#16A34A', marginRight: 8 }} />
                      {reporteOrden.estado}
                    </p>
                  </div>
                  <div>
                    <p style={rpt.etiqueta}>Fecha de cierre</p>
                    <p style={{ ...rpt.valor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {reporteOrden.fecha_cierre ? new Date(reporteOrden.fecha_cierre).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
                    </p>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={rpt.etiqueta}>Técnico</p>
                    <p style={rpt.valor}>{nombrePersona(getTecnicoNombre(reporteOrden.id_tecnico_asignado)) || '—'}</p>
                  </div>
                  {reporteOrden.estado === 'Efectiva' && (
                    <div>
                      <p style={rpt.etiqueta}>Cuotas</p>
                      <p style={{ ...rpt.valor, fontVariantNumeric: 'tabular-nums' }}>{reporteOrden.numero_cuotas ?? '—'}</p>
                    </div>
                  )}
                </div>
                <div style={{ padding: '14px 20px', borderTop: '1px solid #E3E9F4' }}>
                  <p style={rpt.etiqueta}>Dirección</p>
                  <p style={rpt.valor}>{reporteOrden.direccion || '—'}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748B' }}>Barrio {nombreBarrio(reporteOrden.barrio)}</p>
                  {reporteOrden.estado === 'Cancelada' && causalCierre && (
                    <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 600, color: '#B91C1C' }}>
                      <span style={{ color: '#64748B', fontWeight: 500 }}>Motivo de no ejecución: </span>
                      {causalCierre.texto} <span style={{ color: '#94A3B8', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>({causalCierre.codigo})</span>
                    </p>
                  )}
                  {reporteOrden.alerta_orden === 'DUPLICADA_CERRADA' && (
                    <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 600, color: '#B91C1C' }}>
                      Cerrada como duplicada de la orden #{String(reporteOrden.orden_relacionada || '')}
                    </p>
                  )}
                </div>
              </div>

              {/* Ítems ejecutados (solo órdenes Efectiva) */}
              {reporteOrden.estado === 'Efectiva' && (
                <section aria-labelledby="reporte-items" style={{ ...rpt.tarjeta, padding: '16px 20px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <h2 id="reporte-items" style={rpt.h2}>Ítems ejecutados</h2>
                      <span style={rpt.pista}>Si el técnico legalizó algo mal desde la app, corrígelo con Editar ítems</span>
                    </div>
                    {!modoEdicionItems ? (
                      <button type="button" onClick={() => setModoEdicionItems(true)} style={rpt.botonSecundario}>
                        Editar ítems
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#B45309' }}>
                        <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#D97706', marginRight: 8 }} />
                        Editando — recuerda dar &quot;Guardar cambios&quot;
                      </span>
                    )}
                  </div>

                  {modoEdicionItems && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 10px' }}>
                      <label htmlFor="reporte-cuotas" style={{ fontSize: 13, color: '#64748B' }}>Cuotas del servicio</label>
                      <input
                        id="reporte-cuotas"
                        type="number"
                        min={0}
                        value={cuotasEditable}
                        onChange={(e) => setCuotasEditable(e.target.value === '' ? '' : Number(e.target.value))}
                        style={{ ...rpt.campo, width: 88, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
                      />
                    </div>
                  )}

                  {cargandoItems ? (
                    <div style={{ textAlign: 'center', padding: 20, color: '#64748B', fontSize: 14 }}>Cargando ítems...</div>
                  ) : (modoEdicionItems ? itemsEditables : itemsReporte).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 16, color: '#64748B', fontSize: 13 }}>Sin ítems registrados.</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 12 }}>
                            <th scope="col" style={{ padding: '8px 0', fontWeight: 500, borderBottom: '1px solid #E3E9F4' }}>Ítem</th>
                            <th scope="col" style={{ padding: '8px 12px', fontWeight: 500, borderBottom: '1px solid #E3E9F4' }}>Código</th>
                            <th scope="col" style={{ padding: '8px 12px', fontWeight: 500, textAlign: 'right', borderBottom: '1px solid #E3E9F4' }}>Cant.</th>
                            <th scope="col" style={{ padding: '8px 12px', fontWeight: 500, textAlign: 'right', borderBottom: '1px solid #E3E9F4' }}>Valor</th>
                            <th scope="col" style={{ padding: '8px 0 8px 12px', fontWeight: 500, textAlign: 'right', borderBottom: '1px solid #E3E9F4' }}>Subtotal</th>
                            {modoEdicionItems && <th scope="col" style={{ width: 52, borderBottom: '1px solid #E3E9F4' }}><span className="sr-only">Quitar</span></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {(modoEdicionItems ? itemsEditables : itemsReporte).map((item, idx) => (
                            <tr key={item.id ?? `nuevo-${idx}`}>
                              <td style={{ padding: '12px 0', fontWeight: 600, borderBottom: '1px solid #EEF2F8', overflowWrap: 'anywhere' }}>{item.descripcion}</td>
                              <td style={{ padding: 12, color: '#475569', borderBottom: '1px solid #EEF2F8' }}>{item.codigo}</td>
                              <td style={{ padding: 12, textAlign: 'right', borderBottom: '1px solid #EEF2F8' }}>
                                {modoEdicionItems ? (
                                  <input
                                    type="number"
                                    min={1}
                                    aria-label={`Cantidad de ${item.descripcion}`}
                                    value={item.cantidad}
                                    onChange={(e) => handleCambiarCantidadEditable(idx, Number(e.target.value))}
                                    style={{ ...rpt.campo, width: 72, textAlign: 'center' }}
                                  />
                                ) : (
                                  item.cantidad
                                )}
                              </td>
                              <td style={{ padding: 12, textAlign: 'right', borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' }}>${item.precio_unitario.toLocaleString('es-CO')}</td>
                              <td style={{ padding: '12px 0 12px 12px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' }}>
                                ${(item.precio_unitario * item.cantidad).toLocaleString('es-CO')}
                              </td>
                              {modoEdicionItems && (
                                <td style={{ padding: '6px 0 6px 8px', borderBottom: '1px solid #EEF2F8' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleEliminarItemEditable(idx)}
                                    aria-label={`Quitar ${item.descripcion}`}
                                    title="Quitar ítem"
                                    style={{ width: 44, height: 44, borderRadius: 8, border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={4} style={{ padding: '14px 12px 14px 0', textAlign: 'right', color: '#64748B', fontSize: 13 }}>Total ejecutado</td>
                            <td style={{ padding: '14px 0 14px 12px', textAlign: 'right', fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap' }}>
                              ${(modoEdicionItems
                                ? totalEjecutadoEditable
                                : itemsReporte.reduce((sum, it) => sum + it.subtotal, 0)
                              ).toLocaleString('es-CO')}
                            </td>
                            {modoEdicionItems && <td />}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* Agregar ítem del catálogo (solo en modo edición) */}
                  {modoEdicionItems && !cargandoItems && (
                    <div style={{ margin: '4px 0 12px', background: '#F7F9FC', border: '1px dashed #CBD5E1', borderRadius: 10, padding: 14 }}>
                      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#0F2A5C' }}>Agregar ítem correcto</p>
                      <div style={{ position: 'relative' }}>
                        <input
                          type="text"
                          aria-label="Buscar ítem por código o descripción"
                          placeholder="Buscar ítem por código o descripción..."
                          value={itemCatalogoSeleccionado ? itemCatalogoSeleccionado.descripcion : busquedaCatalogo}
                          onChange={(e) => { setBusquedaCatalogo(e.target.value); setItemCatalogoSeleccionado(null); }}
                          style={{ ...rpt.campo, width: '100%' }}
                        />
                        {!itemCatalogoSeleccionado && busquedaCatalogo.trim() !== '' && catalogoFiltrado.length > 0 && (
                          <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #E3E9F4', borderRadius: 10, boxShadow: '0 12px 28px -8px rgba(15,42,92,0.22)', maxHeight: 220, overflowY: 'auto' }}>
                            {catalogoFiltrado.map((opt) => (
                              <button
                                key={opt.codigo}
                                type="button"
                                onClick={() => { setItemCatalogoSeleccionado(opt); setBusquedaCatalogo(''); }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 13, border: 'none', background: '#fff', cursor: 'pointer', borderBottom: '1px solid #EEF2F8' }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#F1F5FB'; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; }}
                              >
                                <span style={{ fontWeight: 600, color: '#0F2A5C' }}>{opt.descripcion}</span>
                                <span style={{ color: '#64748B' }}> — Cód. {opt.codigo} • ${opt.precio_unitario.toLocaleString('es-CO')}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                        <label htmlFor="reporte-cant-nuevo" style={{ fontSize: 13, color: '#64748B' }}>Cantidad</label>
                        <input
                          id="reporte-cant-nuevo"
                          type="number"
                          min={1}
                          value={cantidadNuevoItem}
                          onChange={(e) => setCantidadNuevoItem(Math.max(1, Number(e.target.value)))}
                          style={{ ...rpt.campo, width: 80, textAlign: 'center' }}
                        />
                        <button
                          type="button"
                          disabled={!itemCatalogoSeleccionado}
                          onClick={handleAgregarItemEditable}
                          style={{
                            marginLeft: 'auto', minHeight: 44, padding: '0 18px', borderRadius: 8, border: 0,
                            background: itemCatalogoSeleccionado ? '#1D4ED8' : '#CBD5E1',
                            color: itemCatalogoSeleccionado ? '#fff' : '#475569', fontSize: 14, fontWeight: 600,
                            cursor: itemCatalogoSeleccionado ? 'pointer' : 'not-allowed',
                          }}
                        >
                          Añadir ítem
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Historial de la orden */}
              <section aria-labelledby="reporte-historial">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '2px 0 10px' }}>
                  <h2 id="reporte-historial" style={rpt.h2}>Historial de la orden</h2>
                  <span style={rpt.pista}>Comentarios y fotos registrados desde la app móvil</span>
                  <button
                    type="button"
                    onClick={descargarFotosOrden}
                    disabled={descargandoFotos || fotosOrden.length === 0}
                    aria-label={`Descargar las ${fotosOrden.length} fotos de la orden`}
                    style={{
                      ...rpt.botonSecundario, marginLeft: 'auto', alignSelf: 'center',
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      opacity: descargandoFotos || fotosOrden.length === 0 ? 0.5 : 1,
                      cursor: descargandoFotos ? 'wait' : fotosOrden.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    {descargandoFotos ? 'Empaquetando…' : `Descargar fotos (${fotosOrden.length})`}
                  </button>
                </div>

                {loadingHistorialAuditoria ? (
                  <div className="flex justify-center py-10">
                    <svg className="animate-spin h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                  </div>
                ) : historialAuditoria.length === 0 ? (
                  <div style={{ ...rpt.tarjeta, textAlign: 'center', padding: '28px 16px', color: '#64748B', fontSize: 14 }}>
                    No hay actualizaciones registradas para esta orden.
                  </div>
                ) : (
                  <div className="relative pl-6">
                    <div className="absolute left-[7px] top-2 bottom-2" style={{ width: 2, background: '#E3E9F4' }} />
                    <div className="flex flex-col gap-3">
                      {historialAuditoria.map((h: any, i: number) => {
                        const colorPunto = h.estado === 'Efectiva' ? '#16A34A' : h.estado === 'Programada' ? '#F59E0B' : (h.estado === 'Cancelada' || h.estado === 'Incumplida') ? '#DC2626' : '#2563EB';
                        const badgeLabel = h.estado === 'Cancelada' ? 'Incumplida' : h.estado;
                        const fotos: string[] = h.fotos || [];
                        const textoEntrada = construirTextoEntrada(h);

                        return (
                          <div key={i} className="relative">
                            <span aria-hidden="true" className="absolute -left-[19px] top-5" style={{ width: 12, height: 12, borderRadius: '50%', background: colorPunto, display: 'block' }} />

                            <div style={{ ...rpt.tarjeta, padding: '14px 18px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
                                  <span style={{ fontWeight: 600, color: '#0F2A5C' }}>{badgeLabel}</span>
                                  {' · '}
                                  {new Date(h.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                                  {' · '}
                                  {nombrePersona(h.autor_nombre || h.usuario)}
                                  {h.autor_rol && <> ({h.autor_rol})</>}
                                </p>
                                {textoEntrada && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(textoEntrada);
                                      setEntradaCopiadaIndex(i);
                                      setTimeout(() => setEntradaCopiadaIndex((prev) => (prev === i ? null : prev)), 1800);
                                    }}
                                    style={{
                                      ...rpt.botonSecundario, flexShrink: 0, padding: '0 14px',
                                      borderColor: entradaCopiadaIndex === i ? '#16A34A' : '#E3E9F4',
                                      background: entradaCopiadaIndex === i ? '#F0FDF4' : '#fff',
                                      color: entradaCopiadaIndex === i ? '#166534' : '#0F2A5C',
                                    }}
                                  >
                                    {entradaCopiadaIndex === i ? '¡Copiado!' : 'Copiar'}
                                  </button>
                                )}
                              </div>

                              {(h.estado === 'Cancelada' || h.estado === 'Incumplida') && h.causal_codigo && (
                                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#B91C1C' }}>
                                  <span style={{ color: '#64748B', fontWeight: 500 }}>Motivo de no ejecución: </span>
                                  {causalLabelPorCodigo[String(h.causal_codigo)] ?? String(h.causal_codigo)}
                                  <span style={{ marginLeft: 6, color: '#94A3B8', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>({String(h.causal_codigo)})</span>
                                </p>
                              )}
                              {textoEntrada ? (
                                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#24324A', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{textoEntrada}</p>
                              ) : (
                                <p style={{ margin: 0, fontSize: 13, color: '#64748B', fontStyle: 'italic' }}>No se registró comentario para esta actualización.</p>
                              )}

                              {h.equipo_trabajo && h.equipo_trabajo.length > 0 && (
                                <div style={{ marginTop: 12 }}>
                                  <p style={{ margin: '0 0 6px', fontSize: 12, color: '#64748B' }}>Equipo de trabajo</p>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {h.equipo_trabajo.map((miembro: string, idx: number) => (
                                      <span key={idx} style={{ padding: '4px 10px', background: '#F7F9FC', border: '1px solid #E3E9F4', borderRadius: 8, fontSize: 13, fontWeight: 500, color: '#0F2A5C' }}>
                                        {nombrePersona(miembro)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {fotos.length > 0 ? (
                                <div style={{ marginTop: 14 }}>
                                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748B' }}>Fotos ({fotos.length})</p>
                                  <div className="grid grid-cols-3 gap-2" style={{ maxWidth: 480 }}>
                                    {fotos.map((url, fotoIdx) => (
                                      <button
                                        key={fotoIdx}
                                        type="button"
                                        aria-label={`Ampliar foto ${fotoIdx + 1} de ${fotos.length}`}
                                        onClick={() => setLightbox({ fotos, index: fotoIdx })}
                                        style={{ display: 'block', padding: 0, border: '1px solid #E3E9F4', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', background: '#F1F5F9', height: 105 }}
                                      >
                                        <img src={url} alt={`Evidencia ${fotoIdx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p style={{ margin: '12px 0 0', fontSize: 13, color: '#64748B' }}>Sin fotos en esta actualización.</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Fotos desde urls_fotos como respaldo cuando el historial no tiene fotos */}
                {(() => {
                  const historialTieneFotos = historialAuditoria.some((h: any) => h.fotos && h.fotos.length > 0);
                  const urlsFotos: string[] = reporteOrden.urls_fotos || [];
                  if (historialTieneFotos || urlsFotos.length === 0) return null;
                  return (
                    <div style={{ ...rpt.tarjeta, padding: '14px 18px', marginTop: 12 }}>
                      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748B' }}>Fotos ({urlsFotos.length})</p>
                      <div className="grid grid-cols-3 gap-2" style={{ maxWidth: 480 }}>
                        {urlsFotos.map((url: string, fotoIdx: number) => (
                          <button
                            key={fotoIdx}
                            type="button"
                            aria-label={`Ampliar foto ${fotoIdx + 1} de ${urlsFotos.length}`}
                            onClick={() => setLightbox({ fotos: urlsFotos, index: fotoIdx })}
                            style={{ display: 'block', padding: 0, border: '1px solid #E3E9F4', borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', background: '#F1F5F9', height: 105 }}
                          >
                            <img src={url} alt={`Evidencia ${fotoIdx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </section>

              {/* Editor de equipo de trabajo (solo órdenes Efectiva) — sin cambios */}
              {reporteOrden.estado === 'Efectiva' && (
                <EquipoTrabajoEditor
                  ordenTrabajo={reporteOrden.orden_trabajo}
                  onSaved={() => {
                    fetchHistorialAuditoria(reporteOrden.orden_trabajo);
                  }}
                />
              )}
            </div>
            <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 14, bottom: 0, height: 28, background: 'linear-gradient(to bottom, rgba(247,249,252,0), #F7F9FC)', pointerEvents: 'none' }} />
            </div>

            {/* Pie fijo */}
            <div className="shrink-0" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, padding: '14px 24px', background: '#fff', borderTop: '1px solid #E3E9F4' }}>
              {modoEdicionItems && (
                <button
                  type="button"
                  onClick={() => {
                    setModoEdicionItems(false);
                    setItemsEditables(
                      itemsReporte.map((it) => ({
                        id: it.id,
                        codigo: it.codigo,
                        descripcion: it.descripcion,
                        precio_unitario: it.precio_unitario,
                        cantidad: it.cantidad,
                      }))
                    );
                    setCuotasEditable(reporteOrden.numero_cuotas ?? '');
                  }}
                  disabled={isGuardandoEdicion}
                  style={{ ...rpt.botonSecundario, fontSize: 14, borderRadius: 10, opacity: isGuardandoEdicion ? 0.5 : 1 }}
                >
                  Cancelar edición
                </button>
              )}
              <button
                type="button"
                onClick={cerrarReporte}
                disabled={isGuardandoEdicion}
                style={modoEdicionItems
                  ? { ...rpt.botonSecundario, fontSize: 14, borderRadius: 10, opacity: isGuardandoEdicion ? 0.5 : 1 }
                  : { minHeight: 44, padding: '0 22px', borderRadius: 10, border: 0, background: '#1D4ED8', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Cerrar
              </button>
              {modoEdicionItems && (
                <button
                  type="button"
                  onClick={handleGuardarEdicionItems}
                  disabled={isGuardandoEdicion}
                  style={{ minHeight: 44, padding: '0 22px', borderRadius: 10, border: 0, background: '#1D4ED8', color: '#fff', fontSize: 14, fontWeight: 600, cursor: isGuardandoEdicion ? 'wait' : 'pointer', opacity: isGuardandoEdicion ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  {isGuardandoEdicion ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                      Guardando...
                    </>
                  ) : (
                    'Guardar cambios'
                  )}
                </button>
              )}
            </div>

          </div>
        </div>
      )}

          {/* Visor de fotos (lightbox) con navegación anterior/siguiente */}
          {lightbox && (
            <div
              className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-6"
              onClick={() => setLightbox(null)}
            >
              <div
                className="absolute top-5 left-5 flex items-center gap-1 bg-black/50 rounded-full px-2 py-1.5"
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
                onClick={(e) => { e.stopPropagation(); handleDownloadSingle(lightbox.fotos[lightbox.index], `Evidencia_${lightbox.index + 1}.jpg`); }}
                className="absolute top-5 right-16 text-white/80 hover:text-white"
                title="Descargar esta foto"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
                className="absolute top-5 right-5 text-white/80 hover:text-white"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>

              {lightbox.fotos.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index - 1 + lightbox.fotos.length) % lightbox.fotos.length }); }}
                  className="absolute left-5 text-white/80 hover:text-white"
                >
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
              )}

              <div
                className="overflow-auto rounded-lg"
                style={{ width: '85vw', height: '80vh' }}
                onWheel={handleWheelZoom}
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={lightbox.fotos[lightbox.index]}
                  alt="Evidencia ampliada"
                  onClick={handleImageClick}
                  className="rounded-lg object-contain mx-auto"
                  style={{
                    width: `${85 * zoomLevel}vw`,
                    height: `${80 * zoomLevel}vh`,
                    cursor: zoomLevel > 1 ? 'zoom-out' : 'zoom-in',
                    transition: 'width 150ms ease, height 150ms ease',
                  }}
                />
              </div>

              {lightbox.fotos.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index + 1) % lightbox.fotos.length }); }}
                  className="absolute right-5 text-white/80 hover:text-white"
                >
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              )}
            </div>
          )}
    </div>
  );
}
