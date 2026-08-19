'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import UploadExcelButton from '@/components/UploadExcelButton';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';

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

const formatRol = (rol?: string): string => {
  if (!rol) return '';
  const lower = rol.toLowerCase();
  if (lower === 'tecnico' || lower === 'técnico') return 'Técnico';
  if (lower === 'admin' || lower === 'administrador') return 'Administrador';
  return rol;
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

const formatBarrio = (barrio?: string): string => {
  if (!barrio) return '-';
  // Elimina prefijos tipo "5376 - " o "5376-" dejando solo el nombre
  return barrio.replace(/^\s*\d+\s*-\s*/, '').trim() || barrio;
};

export default function DespachoTableClient() {
  const { user } = useAuth();

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
  const [selectedOrdenes, setSelectedOrdenes] = useState<string[]>([]);
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [selectedTecnicoId, setSelectedTecnicoId] = useState('');
  const [lastUpdateDate, setLastUpdateDate] = useState<string | null>(null);

  // ── Menú kebab ──
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Modal Reporte ──
  const [reporteOrden, setReporteOrden] = useState<Orden | null>(null);
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

  // ── Paginación ──
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
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
  const buildFilteredQuery = useCallback((search: string, loc: string, desc: string, fecha: string, tecnico: string, estado: string, withCount: boolean) => {
    const query = supabase
      .from('ordenes')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .not('estado', 'in', '("Efectiva","Cancelada")');

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
    // Orden: SLA descendente = fecha_asignacion_ot ascendente (más vieja primero)
    query.order('fecha_asignacion_ot', { ascending: true });

    return query;
  }, []);

  // ── Fetch órdenes — paginado server-side ──
  const fetchOrdenes = useCallback(async () => {
    setLoadingOrdenes(true);
    setErrorOrdenes(null);

    const query = buildFilteredQuery(debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estadoFilter, true);
    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error al cargar órdenes:', error);
      setErrorOrdenes('No se pudieron cargar las órdenes.');
    } else {
      setOrdenes(data || []);
      setTotalCount(count ?? 0);
    }
    setLoadingOrdenes(false);
    setIsInitialLoad(false);
  }, [buildFilteredQuery, debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estadoFilter, currentPage]);

  // ── Fetch opciones únicas para dropdowns (una vez al montar) ──
  const fetchFilterOptions = useCallback(async () => {
    const { data } = await supabase
      .from('ordenes')
      .select('localidad, descripcion_del_trabajo')
      .not('estado', 'in', '("Efectiva","Cancelada")');

    if (data) {
      const locs = [...new Set(data.map((d: { localidad: string }) => d.localidad).filter(Boolean))].sort() as string[];
      const descs = [...new Set(data.map((d: { descripcion_del_trabajo?: string }) => d.descripcion_del_trabajo).filter(Boolean))].sort() as string[];
      setLocalidadesUnicas(locs);
      setDescripcionesUnicas(descs);
    }
  }, []);

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
    setCurrentPage(1);
    fetchOrdenes();
    fetchFilterOptions(); // refrescar opciones de dropdown
  }, [fetchOrdenes, fetchFilterOptions]);

  // ── Debounce del search term (400ms) ──
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // ── Reset a página 1 cuando cambian los filtros ──
  useEffect(() => {
    setCurrentPage(1);
    setSelectedOrdenes([]);
  }, [debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estadoFilter]);

  // ── Limpiar selección al cambiar de página ──
  useEffect(() => {
    setSelectedOrdenes([]);
  }, [currentPage]);

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

  // Fetch real technicians from perfiles table
  useEffect(() => {
    const fetchTecnicos = async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id_usuario, nombre')
        .eq('rol', 'Técnico')
        .order('nombre', { ascending: true });

      if (!error && data) {
        setTecnicos(data);
      }
    };
    fetchTecnicos();
  }, []);

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
    let perfilesMap: Record<string, { nombre: string; rol: string }> = {};
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
  const openReporte = useCallback((orden: Orden) => {
    setReporteOrden(orden);
    setNuevoComentario('');
    setNuevoEstado(null);
    setNuevaFechaProgramada('');
    setNuevasFotos([]);
    setErrorGuardar(null);
    setExpandedEntries(new Set());
    fetchHistorial(orden.orden_trabajo);
  }, [fetchHistorial]);

  // Cerrar modal de reporte
  const closeReporte = () => {
    setReporteOrden(null);
    setHistorial([]);
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

  // Helper: estado de asignación (usado en CSV, lógica futura — ya NO se usa para pintar la columna Estado)
  const getEstadoAsignacion = (row: Orden): { label: string; bg: string; text: string } => {
    const nombre = getTecnicoNombre(row.id_tecnico_asignado as string);
    if (!nombre) return { label: 'Sin asignar', bg: 'bg-gray-100', text: 'text-gray-600' };
    if (nombre === 'Programado') return { label: 'Programado', bg: 'bg-yellow-100', text: 'text-yellow-800' };
    return { label: 'Asignada', bg: 'bg-blue-100', text: 'text-blue-800' };
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
        alert('Hubo un error al asignar las órdenes.');
      } else {
        alert('Órdenes asignadas exitosamente.');
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
      alert('Hubo un error inesperado al asignar.');
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
        alert('Hubo un error al eliminar las órdenes.');
      } else {
        setSelectedOrdenes(prev => prev.filter(id => !ids.includes(id)));
        fetchOrdenes();
      }
    } catch (err) {
      console.error(err);
      alert('Hubo un error inesperado al eliminar.');
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
      alert('Hubo un error al reasignar el técnico.');
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

  const isAllVisibleSelected = ordenes.length > 0 && ordenes.every(o => selectedOrdenes.includes(o.orden_trabajo));

  // ── Exportar a CSV (todos los filtrados, sin paginación) ──────────────
  const handleExportCSV = async () => {
    // Query con los mismos filtros activos pero SIN .range()
    const query = buildFilteredQuery(debouncedSearch, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter, estadoFilter, false);
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
      const fechaProg = formatearFechaPura(row.fecha_programada);
      return [
        row.orden_trabajo || '',
        row.contrato || '',
        row.direccion || '',
        row.barrio || '',
        row.localidad || '',
        row.descripcion_del_trabajo || '',
        String(diasSLA),
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
      <div className="flex flex-col gap-2">
        <div className="relative w-full">
          <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text"
            placeholder="Buscar por Contrato, Orden, Dirección o Barrio..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-gray-700"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            className="border border-gray-200 rounded-[10px] h-10 px-4 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150 w-[180px]"
            value={localidadFilter}
            onChange={(e) => setLocalidadFilter(e.target.value)}
          >
            <option value="Todas">Todas las Localidades</option>
            {localidadesUnicas.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
          <select
            className="border border-gray-200 rounded-[10px] h-10 px-4 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150 w-[240px] truncate"
            value={descripcionFilter}
            onChange={(e) => setDescripcionFilter(e.target.value)}
          >
            <option value="Todas las Descripciones">Todas las Descripciones</option>
            {descripcionesUnicas.map(desc => (
              <option key={desc} value={desc}>{desc}</option>
            ))}
          </select>
          <select
            className="border border-gray-200 rounded-[10px] h-10 px-4 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150 w-[180px]"
            value={tecnicoFilter}
            onChange={(e) => setTecnicoFilter(e.target.value)}
          >
            <option value="Todos">Todos los Técnicos</option>
            <option value="Sin asignar">Sin asignar</option>
            {tecnicos.map(tech => (
              <option key={tech.id_usuario} value={tech.id_usuario}>{tech.nombre}</option>
            ))}
          </select>
          <select
            className="border border-gray-200 rounded-[10px] h-10 px-4 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150 w-[150px]"
            value={fechaFilter}
            onChange={(e) => setFechaFilter(e.target.value)}
          >
            <option value="Todas">Todas las fechas</option>
            <option value="Hoy">Hoy (0 días)</option>
            <option value="Últimos 3 días">Últimos 3 días</option>
            <option value="Vencidas">Vencidas ({'>='} 3 días)</option>
          </select>
          <select
            className="border border-gray-200 rounded-[10px] h-10 px-4 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-150"
            value={estadoFilter}
            onChange={(e) => setEstadoFilter(e.target.value)}
          >
            <option value="Todos">Todos los Estados</option>
            <option value="Pendiente">Pendiente</option>
            <option value="Programada">Programada</option>
          </select>
          <button
            type="button"
            onClick={() => { setSearchTerm(''); setLocalidadFilter('Todas'); setDescripcionFilter('Todas las Descripciones'); setFechaFilter('Todas'); setTecnicoFilter('Todos'); setEstadoFilter('Todos'); }}
            className="ml-auto flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Tabla de Despacho */}
      <div className={`bg-white rounded-2xl shadow-[0_8px_24px_rgba(15,23,42,0.05)] border border-gray-100 overflow-hidden p-6 mt-4 transition-opacity duration-150 ${loadingOrdenes && !isInitialLoad ? 'opacity-50' : 'opacity-100'}`}>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[12px] font-semibold tracking-[0.05em] uppercase text-[#64748B]">
                <th className="py-2.5 px-2.5 w-10">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={isAllVisibleSelected}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="py-2.5 px-2.5" style={{ width: '150px' }}>Orden / Contrato</th>
                <th className="py-2.5 px-2.5" style={{ width: '420px' }}>Ubicación</th>
                <th className="py-2.5 px-2.5" style={{ width: '220px' }}>Trabajo</th>
                <th className="py-2.5 px-2.5" style={{ width: '110px' }}>Estado</th>
                <th className="py-2.5 px-2.5" style={{ width: '90px' }}>Días / SLA</th>
                <th className="py-2.5 px-2.5" style={{ width: '120px' }}>F. Programada</th>
                <th className="py-2.5 px-2.5" style={{ width: '170px' }}>Técnico</th>
                <th className="py-2.5 px-2.5 text-center" style={{ width: '50px' }}>Acciones</th>
              </tr>
            </thead>
            <tbody className="text-xs text-gray-700">
              {ordenes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-gray-500">
                    No se encontraron órdenes que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                ordenes.map((row) => {
                  const tecNombre = getTecnicoNombre(row.id_tecnico_asignado as string);
                  const tecDisplay = tecNombre === 'Programado' ? '—' : tecNombre;

                  return (
                  <tr key={row.orden_trabajo} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors duration-150" style={{ height: '72px' }}>
                    <td className="py-2.5 px-2.5">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedOrdenes.includes(row.orden_trabajo)}
                        onChange={(e) => handleSelectOne(row.orden_trabajo, e.target.checked)}
                      />
                    </td>
                    <td className="py-2.5 px-2.5" style={{ height: '72px' }}>
                      <div className="flex flex-col justify-center h-full gap-0.5">
                        <p style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>{row.orden_trabajo}</p>
                        <p style={{ fontSize: '12px', color: '#94A3B8' }}>Contrato: {row.contrato}</p>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5" style={{ height: '72px', wordBreak: 'break-word' }}>
                      <div className="flex flex-col justify-center h-full gap-0.5">
                        <p className="flex items-start gap-1" style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                          <span className="text-gray-400">📍</span> {row.direccion}
                        </p>
                        <p style={{ fontSize: '13px', fontWeight: 400, color: '#64748B' }}>{formatBarrio(row.barrio)}</p>
                        <p style={{ fontSize: '12px', fontWeight: 400, color: '#94A3B8' }}>{row.localidad}</p>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-gray-500" style={{ height: '72px' }}>
                      <div className="flex flex-col justify-center h-full">
                        <p style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {row.descripcion_del_trabajo || '-'}
                        </p>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 align-middle">
                      <span
                        className="inline-block px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
                        style={{ background: getEstadoBadge(row.estado).bg, color: getEstadoBadge(row.estado).text }}
                      >
                        {getEstadoBadge(row.estado).label}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5">
                      {(() => {
                        const daysSLA = calcularDiasSLA(row.fecha_asignacion_ot);
                        const slaColor = daysSLA >= 3 ? 'bg-red-100 text-red-800' : daysSLA === 2 ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800';
                        return (
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${slaColor}`}>
                            {daysSLA} {daysSLA === 1 ? 'día' : 'días'}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2.5 px-2.5 whitespace-nowrap">
                      {formatearFechaPura(row.fecha_programada)}
                    </td>
                    <td className="py-2.5 px-2.5">
                      {tecDisplay ? (
                        <p className="text-gray-900 font-medium whitespace-nowrap">{tecDisplay}</p>
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
                          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left }}
                          className="w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1 text-left"
                        >
                          <button
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            onClick={() => { openReporte(row); setOpenMenuId(null); setMenuPosition(null); }}
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Paginación ── */}
        {totalCount > 0 && (() => {
          const totalPages = Math.ceil(totalCount / PAGE_SIZE);
          const from = (currentPage - 1) * PAGE_SIZE + 1;
          const to = Math.min(currentPage * PAGE_SIZE, totalCount);

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
            <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                Mostrando <span className="font-medium text-gray-700">{from}</span> a{' '}
                <span className="font-medium text-gray-700">{to}</span> de{' '}
                <span className="font-medium text-gray-700">{totalCount}</span> órdenes
              </p>
              <div className="flex items-center gap-1">
                {/* Flecha anterior */}
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                          ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                          : 'border-gray-200 text-gray-700 hover:bg-gray-50'
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
                  className="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  →
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Panel flotante de asignación masiva */}
      {selectedOrdenes.length > 0 && (
        <div className="fixed bottom-0 left-64 right-0 bg-white border-t border-gray-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] flex items-center justify-between z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-700 rounded-full font-bold text-sm">
                {selectedOrdenes.length}
              </span>
              <span className="text-sm font-medium text-gray-700">Órdenes seleccionadas</span>
            </div>
            <div className="text-sm text-gray-500 border-l border-gray-300 pl-4 hidden md:block">
              Selección múltiple
            </div>
          </div>
          <div className="flex items-center gap-4">
            <select
              className="border border-gray-300 rounded px-4 py-2 bg-white focus:outline-none focus:border-blue-500 text-sm"
              value={selectedTecnicoId}
              onChange={(e) => setSelectedTecnicoId(e.target.value)}
            >
              <option value="">Seleccionar técnico para bloque...</option>
              {tecnicos.map(tech => (
                <option key={tech.id_usuario} value={tech.id_usuario}>{tech.nombre}</option>
              ))}
            </select>
            <button
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium transition shadow-sm text-sm disabled:opacity-50"
              onClick={handleAsignarBloque}
              disabled={isAssigning || !selectedTecnicoId}
            >
              {isAssigning ? 'Asignando...' : 'Asignar órdenes en bloque'}
            </button>
            <button
              className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-md font-medium transition shadow-sm text-sm disabled:opacity-50 flex items-center gap-2"
              onClick={() => handleDeleteOrdenes(selectedOrdenes)}
              disabled={isDeleting}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              {isDeleting ? 'Eliminando...' : `Eliminar (${selectedOrdenes.length})`}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL — Reporte de la Orden
         ══════════════════════════════════════════════════════════════════ */}
      {reporteOrden && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(17,24,39,0.45)' }}>
          <div
            className="flex flex-col overflow-hidden shadow-2xl"
            style={{
              backgroundColor: '#F7F9FC',
              borderRadius: '12px',
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
              <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#111827', margin: 0 }}>
                Reporte de la Orden #{reporteOrden.orden_trabajo}
              </h2>
              <button
                onClick={closeReporte}
                className="flex items-center justify-center transition-colors"
                style={{ width: 32, height: 32, borderRadius: '8px', border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#6B7280' }}
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

              {/* ── FILA 1: Contrato · Ubicación (unificada) · SLA ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '12px' }}>
                {/* Contrato */}
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', border: '1px solid #E8ECF3' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Contrato</p>
                  <p style={{ fontSize: '15px', fontWeight: 500, color: '#24324A', margin: 0 }}>{reporteOrden.contrato || '—'}</p>
                </div>

                {/* Ubicación — unifica Dirección + Barrio + Localidad */}
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', border: '1px solid #E8ECF3' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    <p style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Dirección</p>
                  </div>
                  <p style={{ fontSize: '15px', fontWeight: 500, color: '#24324A', margin: 0, lineHeight: 1.4 }}>{reporteOrden.direccion || '—'}</p>
                  <p style={{ fontSize: '13px', color: '#6B7280', margin: '2px 0 0' }}>
                    {reporteOrden.barrio ? `Barrio ${reporteOrden.barrio}` : ''}{reporteOrden.barrio && reporteOrden.localidad ? ' · ' : ''}{reporteOrden.localidad || ''}
                  </p>
                </div>

                {/* SLA */}
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', border: '1px solid #E8ECF3' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>SLA (días)</p>
                  {(() => {
                    const dias = calcularDiasSLA(reporteOrden.fecha_asignacion_ot);
                    const slaStyle = dias >= 3
                      ? { background: '#FEE2E2', color: '#991B1B' }
                      : dias === 2
                        ? { background: '#FFEDD5', color: '#9A3412' }
                        : { background: '#DCFCE7', color: '#166534' };
                    return (
                      <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, ...slaStyle }}>
                        {dias} {dias === 1 ? 'día' : 'días'}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* ── FILA 2: Estado · Fecha de creación · Técnico asignado · Fecha programada (condicional) ── */}
              <div style={{ display: 'grid', gridTemplateColumns: reporteOrden.estado === 'Programada' ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: '20px', marginBottom: '12px' }}>
                {/* Estado */}
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', border: '1px solid #E8ECF3' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Estado</p>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700,
                    ...(reporteOrden.estado === 'Programada'
                      ? { background: '#FFF8E1', color: '#B45309' }
                      : reporteOrden.estado === 'Efectiva'
                        ? { background: '#DCFCE7', color: '#166534' }
                        : reporteOrden.estado === 'Cancelada'
                          ? { background: '#FEE2E2', color: '#991B1B' }
                          : { background: '#DBEAFE', color: '#1E40AF' }
                    ),
                  }}>
                    {reporteOrden.estado}
                  </span>
                </div>

                {/* Fecha de creación */}
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', border: '1px solid #E8ECF3' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Fecha de creación</p>
                  <p style={{ fontSize: '15px', fontWeight: 500, color: '#24324A', margin: 0 }}>
                    {reporteOrden.fecha_asignacion_ot
                      ? new Date(reporteOrden.fecha_asignacion_ot).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })
                      : '—'}
                  </p>
                </div>

                {/* Técnico asignado */}
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', border: '1px solid #E8ECF3' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Técnico asignado</p>
                  <p style={{ fontSize: '15px', fontWeight: 500, color: '#24324A', margin: 0 }}>
                    {getTecnicoNombre(reporteOrden.id_tecnico_asignado as string) || 'Sin asignar'}
                  </p>
                </div>

                {/* Fecha programada (condicional) */}
                {reporteOrden.estado === 'Programada' && (
                  <div style={{ background: '#FFFBEB', borderRadius: '14px', padding: '16px', border: '1px solid #F59E0B' }}>
                    <p style={{ fontSize: '12px', fontWeight: 600, color: '#B45309', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Fecha programada</p>
                    <p style={{ fontSize: '15px', fontWeight: 500, color: '#92400E', margin: 0 }}>
                      {formatearFechaPura(reporteOrden.fecha_programada)}
                    </p>
                  </div>
                )}
              </div>

              {/* Descripción del trabajo — ancho completo */}
              <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', border: '1px solid #E8ECF3', marginBottom: '12px' }}>
                <p style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Descripción del trabajo</p>
                <p style={{ fontSize: '15px', color: '#111827', margin: 0, lineHeight: 1.5 }}>{reporteOrden.descripcion_del_trabajo || '—'}</p>
              </div>



              {/* ══════════════════════════════════════════════════════════
                  HISTORIAL DE ATENCIÓN
                 ══════════════════════════════════════════════════════════ */}
              <div style={{ marginTop: '8px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '4px' }}>Historial de Atención</h3>
                <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '16px' }}>
                  Registro cronológico de actualizaciones de la orden.
                </p>

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
                                    padding: '4px 10px', background: '#fff', border: '1px solid #E6EAF2', borderRadius: '8px',
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
                                    padding: '4px', background: 'none', border: 'none',
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

            {/* ── Footer ── */}
            <div style={{
              flexShrink: 0, borderTop: '1px solid #E5E7EB', padding: '14px 24px',
              background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px',
            }}>
              <button
                onClick={closeReporte}
                style={{
                  padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: '#374151',
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
                  padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#fff',
                  background: (isGuardando || !nuevoEstado) ? '#93B3D6' : '#1A4D8F',
                  border: 'none', borderRadius: '10px', cursor: (isGuardando || !nuevoEstado) ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: '8px',
                  opacity: (isGuardando || !nuevoEstado) ? 0.65 : 1,
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
