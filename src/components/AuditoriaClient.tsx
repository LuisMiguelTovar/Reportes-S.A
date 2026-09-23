'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';
import { supabase } from '@/lib/supabase';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

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

export default function AuditoriaClient() {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tecnicoFilter, setTecnicoFilter] = useState('Todos los Técnicos');
  const [estadoFilter, setEstadoFilter] = useState('Todos los Estados');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reporteOrden, setReporteOrden] = useState<Orden | null>(null);
  const [itemsReporte, setItemsReporte] = useState<ItemReporte[]>([]);
  const [cargandoItems, setCargandoItems] = useState(false);
  const [modoEdicionItems, setModoEdicionItems] = useState(false);
  const [itemsEditables, setItemsEditables] = useState<ItemEditable[]>([]);
  const [cuotasEditable, setCuotasEditable] = useState<number | ''>('');
  const [isGuardandoEdicion, setIsGuardandoEdicion] = useState(false);

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
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loadingOrdenes, setLoadingOrdenes] = useState(true);
  const [errorOrdenes, setErrorOrdenes] = useState<any>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // ── Paginación ──
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);

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

  const fetchHistorialAuditoria = async (ordenTrabajo: string) => {
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
  };

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
        .in('rol', ['Técnico', 'Supervisor']);
      if (!error && data) {
        setTecnicos(data);
      }
    };
    fetchTecnicos();
  }, []);

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

  const getTecnicoNombre = (id?: string) => {
    if (!id) return 'Sin asignar';
    const t = tecnicos.find(t => t.id_usuario === id);
    return t ? t.nombre : id;
  };

  const tecnicosUnicos = useMemo(() => {
    return tecnicos.map(t => t.nombre).sort();
  }, [tecnicos]);

  const buildFilteredQuery = useCallback((search: string, tecnico: string, estado: string, desde: string, hasta: string, withCount: boolean) => {
    const query = supabase
      .from('ordenes')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .neq('estado', 'Pendiente');

    if (search) {
      query.or(`contrato.ilike.%${search}%,orden_trabajo.ilike.%${search}%`);
    }
    if (estado !== 'Todos los Estados') {
      query.eq('estado', estado);
    }
    if (tecnico !== 'Todos los Técnicos') {
      const tecnicoObj = tecnicos.find(t => t.nombre === tecnico);
      if (tecnicoObj) {
        query.eq('id_tecnico_asignado', tecnicoObj.id_usuario);
      }
    }
    if (desde) {
      // fecha_cierre >= inicio del día seleccionado (en hora Colombia, aproximado con el campo tal cual está almacenado)
      query.gte('fecha_cierre', `${desde}T00:00:00`);
    }
    if (hasta) {
      query.lte('fecha_cierre', `${hasta}T23:59:59`);
    }

    query.order('fecha_cierre', { ascending: false, nullsFirst: false });

    return query;
  }, [tecnicos]);

  const fetchOrdenes = useCallback(async () => {
    setLoadingOrdenes(true);
    setErrorOrdenes(null);

    const query = buildFilteredQuery(debouncedSearch, tecnicoFilter, estadoFilter, startDate, endDate, true);
    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
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
  }, [buildFilteredQuery, debouncedSearch, tecnicoFilter, estadoFilter, startDate, endDate, currentPage]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedOrders([]);
  }, [debouncedSearch, tecnicoFilter, estadoFilter, startDate, endDate]);

  useEffect(() => {
    fetchOrdenes();
  }, [fetchOrdenes]);

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
        const query = buildFilteredQuery(debouncedSearch, tecnicoFilter, estadoFilter, startDate, endDate, false);
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
    const query = buildFilteredQuery(debouncedSearch, tecnicoFilter, estadoFilter, startDate, endDate, false);
    const { data: allFiltered, error } = await query;
    if (error || !allFiltered) {
      alert('No se pudo generar el reporte.');
      return;
    }

    // Traer el historial de todas las órdenes exportadas para extraer
    // el comentario y el causal de cierre de cada una.
    const ordenTrabajos = allFiltered.map((row: any) => row.orden_trabajo);
    let historialData: any[] = [];
    if (ordenTrabajos.length > 0) {
      const { data } = await supabase
        .from('historial_ordenes')
        .select('orden_trabajo, comentario, causal_codigo, fecha, usuario, fotos')
        .in('orden_trabajo', ordenTrabajos)
        .order('fecha', { ascending: false });
      historialData = data || [];
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
    const NUM_COLUMNAS_FIJAS = 10;

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

      <div className="flex flex-wrap gap-4 items-center mb-6">
        <div className="relative flex-1 min-w-[280px] max-w-xl">
          <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text"
            placeholder="Buscar por Contrato o Nº Orden..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-gray-700"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="relative">
          <input
            type="date"
            className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-gray-700 w-40"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="relative">
          <input
            type="date"
            className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-gray-700 w-40"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
          value={tecnicoFilter}
          onChange={(e) => setTecnicoFilter(e.target.value)}
        >
          <option value="Todos los Técnicos">Todos los Técnicos</option>
          {tecnicosUnicos.map(tech => (
            <option key={tech} value={tech}>{tech}</option>
          ))}
        </select>
        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
          value={estadoFilter}
          onChange={(e) => setEstadoFilter(e.target.value)}
        >
          <option value="Todos los Estados">Todos los Estados</option>
          <option value="Efectiva">Efectiva</option>
          <option value="Cancelada">Cancelada</option>
        </select>
      </div>

      <div className={`bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden transition-opacity duration-150 ${loadingOrdenes && !isInitialLoad ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
        <div className="w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                <th className="py-2 px-3 w-12 text-center">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="py-2 px-3">Fecha de Cierre</th>
                <th className="py-2 px-3">Nº Orden</th>
                <th className="py-2 px-3">Contrato</th>
                <th className="py-2 px-3">Dirección</th>
                <th className="py-2 px-3">Barrio</th>
                <th className="py-2 px-3">Estado</th>
                <th className="py-2 px-3">Técnico</th>
                <th className="py-2 px-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="text-xs text-gray-700">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 px-6 text-center text-gray-500">
                    No hay órdenes en historial o que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                filteredData.map((row) => (
                    <tr key={row.orden_trabajo} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-2 px-3 text-center">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4"
                          checked={selectedOrders.includes(row.orden_trabajo)}
                          onChange={() => handleSelectOne(row.orden_trabajo)}
                        />
                      </td>
                      <td className="py-2 px-3 text-gray-900">
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
                      <td className="py-2 px-3 font-medium text-gray-900">{row.orden_trabajo}</td>
                      <td className="py-2 px-3 text-gray-500">{row.contrato}</td>
                      <td className="py-2 px-3 text-gray-500 max-w-[180px] truncate" title={row.direccion || '-'}>{row.direccion || '-'}</td>
                      <td className="py-2 px-3 text-gray-500 max-w-[180px] truncate" title={row.barrio || '-'}>{row.barrio || '-'}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${row.estado === 'Cancelada' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                          {row.estado}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-600">{getTecnicoNombre(row.id_tecnico_asignado)}</td>
                      <td className="py-2 px-3 text-center">
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
                ))
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
            <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50/50">
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
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div
            className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ width: 'min(1100px, 92vw)', height: 'min(820px, 88vh)' }}
          >
            {/* Header fijo */}
            <div className="shrink-0 border-b border-gray-100">
              <div className="flex items-center justify-between p-5 pb-3">
                <h3 className="text-xl font-bold text-slate-800">Reporte de la Orden #{reporteOrden.orden_trabajo}</h3>
                <button
                  onClick={() => { setReporteOrden(null); setHistorialAuditoria([]); setItemsReporte([]); setCargandoItems(false); setModoEdicionItems(false); setItemsEditables([]); setCuotasEditable(''); }}
                  className="text-gray-400 hover:bg-gray-100 hover:text-red-500 rounded-full p-1.5 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {/* Franja compacta de información, con separadores verticales */}
              <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 pb-4 text-sm">
                <div>
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Contrato</p>
                  <p className="text-gray-900 font-medium">{reporteOrden.contrato}</p>
                </div>
                <div className="w-px bg-gray-200 self-stretch" />
                <div>
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Dirección</p>
                  <p className="text-gray-900 font-medium">{reporteOrden.direccion || '—'}</p>
                </div>
                <div className="w-px bg-gray-200 self-stretch" />
                <div>
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Barrio</p>
                  <p className="text-gray-900 font-medium">{reporteOrden.barrio || '—'}</p>
                </div>
                <div className="w-px bg-gray-200 self-stretch" />
                <div>
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Técnico</p>
                  <p className="text-gray-900 font-medium">{getTecnicoNombre(reporteOrden.id_tecnico_asignado)}</p>
                </div>
                <div className="w-px bg-gray-200 self-stretch" />
                <div>
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Estado</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${reporteOrden.estado === 'Cancelada' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                    {reporteOrden.estado}
                  </span>
                </div>
                <div className="w-px bg-gray-200 self-stretch" />
                <div>
                  <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Fecha de cierre</p>
                  <p className="text-gray-900 font-medium">
                    {reporteOrden.fecha_cierre ? new Date(reporteOrden.fecha_cierre).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Cuerpo con scroll interno */}
            <div className="flex-1 overflow-y-auto p-5 bg-gray-50">

            {/* ── Ítems ejecutados (solo para órdenes Efectiva) ── */}
            {reporteOrden.estado === 'Efectiva' && (
              <div style={{
                background: '#F8FAFF',
                borderRadius: 12,
                padding: '20px',
                marginBottom: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
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
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#1A1A2E' }}>Ítems ejecutados</p>
                      <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>Servicios realizados por el técnico en la orden.</p>
                    </div>
                  </div>

                  {!modoEdicionItems ? (
                    <button
                      type="button"
                      onClick={() => setModoEdicionItems(true)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '8px 14px', borderRadius: 8, border: '1px solid #1A3A6B',
                        background: 'white', color: '#1A3A6B', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Editar
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '4px 10px', borderRadius: 999 }}>
                      Editando — recuerda dar &quot;Guardar cambios&quot;
                    </span>
                  )}
                </div>

                {/* Cuotas del servicio */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'white', border: '1px solid #E8EDF5', borderRadius: 10,
                  padding: '10px 14px', marginBottom: 14, maxWidth: 260,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A3A6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                  </svg>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}>Cuotas del servicio</p>
                    {modoEdicionItems ? (
                      <input
                        type="number"
                        min={0}
                        value={cuotasEditable}
                        onChange={(e) => setCuotasEditable(e.target.value === '' ? '' : Number(e.target.value))}
                        style={{ width: '100%', fontSize: 16, fontWeight: 800, color: '#1A3A6B', border: '1px solid #D1D5DB', borderRadius: 6, padding: '2px 6px', marginTop: 2 }}
                      />
                    ) : (
                      <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 800, color: '#1A3A6B' }}>
                        {reporteOrden.numero_cuotas ?? '—'}
                      </p>
                    )}
                  </div>
                </div>

                {cargandoItems ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#9CA3AF', fontSize: 14 }}>
                    Cargando ítems...
                  </div>
                ) : (
                  <>
                    {(modoEdicionItems ? itemsEditables : itemsReporte).length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '16px', color: '#9CA3AF', fontSize: 13 }}>
                        Sin ítems registrados.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {(modoEdicionItems ? itemsEditables : itemsReporte).map((item, idx) => (
                          <div key={item.id ?? `nuevo-${idx}`} style={{
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
                              <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#1A1A2E' }}>{item.descripcion}</p>
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
                              <p style={{ margin: 0, fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Cantidad</p>
                              {modoEdicionItems ? (
                                <input
                                  type="number"
                                  min={1}
                                  value={item.cantidad}
                                  onChange={(e) => handleCambiarCantidadEditable(idx, Number(e.target.value))}
                                  style={{ width: 56, textAlign: 'center', fontSize: 18, fontWeight: 800, color: '#1A3A6B', border: '1px solid #D1D5DB', borderRadius: 6, marginTop: 2 }}
                                />
                              ) : (
                                <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800, color: '#1A3A6B' }}>{item.cantidad}</p>
                              )}
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 90 }}>
                              <p style={{ margin: 0, fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>Subtotal</p>
                              <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 800, color: '#1A1A2E' }}>
                                ${(item.precio_unitario * item.cantidad).toLocaleString('es-CO')}
                              </p>
                            </div>
                            {modoEdicionItems && (
                              <button
                                type="button"
                                onClick={() => handleEliminarItemEditable(idx)}
                                title="Eliminar ítem"
                                style={{
                                  flexShrink: 0, width: 32, height: 32, borderRadius: 8,
                                  border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Agregar ítem del catálogo (solo en modo edición) */}
                    {modoEdicionItems && (
                      <div style={{ marginTop: 14, background: 'white', border: '1px dashed #C7D2FE', borderRadius: 10, padding: 14 }}>
                        <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#1A3A6B' }}>Agregar ítem correcto</p>
                        <div style={{ position: 'relative' }}>
                          <input
                            type="text"
                            placeholder="Buscar ítem por código o descripción..."
                            value={itemCatalogoSeleccionado ? itemCatalogoSeleccionado.descripcion : busquedaCatalogo}
                            onChange={(e) => { setBusquedaCatalogo(e.target.value); setItemCatalogoSeleccionado(null); }}
                            style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13 }}
                          />
                          {!itemCatalogoSeleccionado && busquedaCatalogo.trim() !== '' && catalogoFiltrado.length > 0 && (
                            <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 4, background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 220, overflowY: 'auto' }}>
                              {catalogoFiltrado.map((opt) => (
                                <button
                                  key={opt.codigo}
                                  type="button"
                                  onClick={() => { setItemCatalogoSeleccionado(opt); setBusquedaCatalogo(''); }}
                                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12, border: 'none', background: 'white', cursor: 'pointer', borderBottom: '1px solid #F3F4F6' }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFF'; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'white'; }}
                                >
                                  <span style={{ fontWeight: 700, color: '#1A1A2E' }}>{opt.descripcion}</span>
                                  <span style={{ color: '#9CA3AF' }}> — Cód. {opt.codigo} • ${opt.precio_unitario.toLocaleString('es-CO')}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                          <label style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>Cantidad</label>
                          <input
                            type="number"
                            min={1}
                            value={cantidadNuevoItem}
                            onChange={(e) => setCantidadNuevoItem(Math.max(1, Number(e.target.value)))}
                            style={{ width: 64, padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13 }}
                          />
                          <button
                            type="button"
                            disabled={!itemCatalogoSeleccionado}
                            onClick={handleAgregarItemEditable}
                            style={{
                              marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: 'none',
                              background: itemCatalogoSeleccionado ? '#1A4D8F' : '#93B3D6',
                              color: 'white', fontSize: 12, fontWeight: 700,
                              cursor: itemCatalogoSeleccionado ? 'pointer' : 'not-allowed',
                            }}
                          >
                            Añadir ítem
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Total ejecutado — al final de la lista, como subtotal general */}
                    {(modoEdicionItems ? itemsEditables : itemsReporte).length > 0 && (
                      <div style={{
                        marginTop: 14, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10,
                        borderTop: '2px solid #E5E7EB', paddingTop: 12,
                      }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>Total ejecutado</span>
                        <span style={{ fontSize: 20, fontWeight: 800, color: '#1A3A6B' }}>
                          ${(modoEdicionItems
                            ? totalEjecutadoEditable
                            : itemsReporte.reduce((sum, it) => sum + it.subtotal, 0)
                          ).toLocaleString('es-CO')}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

{/* Fotos (sin tarjeta de cuotas al lado) */}
<div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{
        width: 36, height: 36,
        background: '#EEF2FF',
        borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A3A6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
      </div>
      <div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#1A1A2E' }}>Fotos del trabajo</p>
        <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>Evidencias fotográficas registradas en la atención de la orden.</p>
      </div>
    </div>

              {loadingHistorialAuditoria ? (
                <div className="flex justify-center py-10">
                  <svg className="animate-spin h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                </div>
              ) : historialAuditoria.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
                  No hay actualizaciones registradas para esta orden.
                </div>
              ) : (
                <div className="relative pl-6">
                  {/* Línea vertical del timeline */}
                  <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" />

                  <div className="flex flex-col gap-3">
                    {historialAuditoria.map((h: any, i: number) => {
                      const colorPorEstado = (estado: string) => {
                        if (estado === 'Efectiva') return { dot: 'bg-green-500', ring: 'ring-green-100', badgeBg: 'bg-green-50', badgeText: 'text-green-700', badgeBorder: 'border-green-200' };
                        if (estado === 'Programada') return { dot: 'bg-amber-500', ring: 'ring-amber-100', badgeBg: 'bg-amber-50', badgeText: 'text-amber-700', badgeBorder: 'border-amber-200' };
                        if (estado === 'Cancelada' || estado === 'Incumplida') return { dot: 'bg-red-500', ring: 'ring-red-100', badgeBg: 'bg-red-50', badgeText: 'text-red-700', badgeBorder: 'border-red-200' };
                        return { dot: 'bg-blue-500', ring: 'ring-blue-100', badgeBg: 'bg-blue-50', badgeText: 'text-blue-700', badgeBorder: 'border-blue-200' };
                      };
                      const colores = colorPorEstado(h.estado);
                      const badgeLabel = h.estado === 'Cancelada' ? 'Incumplida' : h.estado;
                      const fotos: string[] = h.fotos || [];

                      return (
                        <div key={i} className="relative">
                          {/* Punto del timeline */}
                          <div className={`absolute -left-[19px] top-4 w-3 h-3 rounded-full ${colores.dot} ring-4 ${colores.ring}`} />

                          <div className="bg-white rounded-[10px] border border-gray-100 p-4">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${colores.badgeBg} ${colores.badgeText} ${colores.badgeBorder}`}>
                                {badgeLabel}
                              </span>
                              <span className="text-xs text-gray-400">
                                {new Date(h.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                              <span className="text-xs text-gray-600">
                                {h.autor_nombre || h.usuario}
                                {h.autor_rol && <span className="text-gray-400"> · {h.autor_rol}</span>}
                              </span>
                            </div>

                            {/* Comentario — con prefijo fecha+causal+técnico dentro del mismo párrafo,
                                para que al copiar el texto quede autocontenido. El comentario original
                                NO se modifica, solo se le antepone este encabezado dentro del párrafo. */}
                            {h.comentario ? (
                              <p className="text-sm text-gray-800 mb-3">
                                {new Date(h.fecha).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}
                                {' · '}
                                {badgeLabel}
                                {' · '}
                                {h.autor_nombre || h.usuario}
                                {' / '}
                                {h.comentario}
                              </p>
                            ) : (
                              <p className="text-xs text-gray-400 italic mb-3">No se registró comentario para esta actualización.</p>
                            )}

                            {/* Equipo de trabajo (solo si existe) */}
                            {h.equipo_trabajo && h.equipo_trabajo.length > 0 && (
                              <div style={{
                                marginBottom: '12px',
                                padding: '10px 14px',
                                background: '#EEF2FF',
                                borderRadius: '10px',
                              }}>
                                <p style={{
                                  margin: '0 0 8px',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  color: '#1A3A6B',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.05em',
                                }}>
                                  Equipo de trabajo
                                </p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                  {h.equipo_trabajo.map((miembro: string, idx: number) => (
                                    <span key={idx} style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '3px 10px',
                                      background: 'white',
                                      borderRadius: '9999px',
                                      fontSize: '12px',
                                      fontWeight: 600,
                                      color: '#1A3A6B',
                                      border: '1px solid #C7D7F5',
                                    }}>
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1A3A6B" strokeWidth="2.5">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                        <circle cx="12" cy="7" r="4"/>
                                      </svg>
                                      {miembro}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Fotos de ESTA actualización únicamente */}
                            {fotos.length > 0 ? (
                              <div>
                                <p className="text-xs text-gray-500 font-medium mb-1.5">Evidencias ({fotos.length})</p>
                                <div className="grid grid-cols-3 gap-2" style={{ maxWidth: '480px' }}>
                                  {fotos.map((url, fotoIdx) => (
                                    <div
                                      key={fotoIdx}
                                      className="relative group cursor-pointer"
                                      onClick={() => setLightbox({ fotos, index: fotoIdx })}
                                    >
                                      <img
                                        src={url}
                                        alt={`Evidencia ${fotoIdx + 1}`}
                                        className="rounded-lg object-cover w-full"
                                        style={{ height: '105px' }}
                                      />
                                      <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                        <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5v4m0-4h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400">Sin evidencias fotográficas.</p>
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
                // Verificar si el historial ya tiene alguna entrada con fotos
                const historialTieneFoots = historialAuditoria.some(
                  (h: any) => h.fotos && h.fotos.length > 0
                );
                
                // Solo mostrar este bloque si:
                // 1. El historial NO tiene fotos (app antigua), Y
                // 2. La orden SÍ tiene urls_fotos
                const urlsFotos: string[] = reporteOrden.urls_fotos || [];
                
                if (historialTieneFoots || urlsFotos.length === 0) return null;
                
                return (
                  <div className="mt-4">
                    <p className="text-xs text-gray-500 font-medium mb-2">
                      Evidencias ({urlsFotos.length})
                    </p>
                    <div className="grid grid-cols-3 gap-2" style={{ maxWidth: '480px' }}>
                      {urlsFotos.map((url: string, fotoIdx: number) => (
                        <div
                          key={fotoIdx}
                          className="relative group cursor-pointer"
                          onClick={() => setLightbox({ fotos: urlsFotos, index: fotoIdx })}
                        >
                          <img
                            src={url}
                            alt={`Evidencia ${fotoIdx + 1}`}
                            className="rounded-lg object-cover w-full"
                            style={{ height: '105px' }}
                          />
                          <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5v4m0-4h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Caja informativa */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 mt-4">
                ℹ️ Los comentarios y evidencias fueron registrados desde la aplicación móvil durante la atención de la orden.
              </div>
  </div> {/* Fin columna de fotos */}

            {/* Nota informativa */}
            {reporteOrden.estado === 'Efectiva' && itemsReporte.length > 0 && !modoEdicionItems && (
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
                  Usa el botón &quot;Editar&quot; de la sección de ítems para corregir cuotas, cantidades o ítems si el técnico legalizó algo mal desde la app.
                </p>
              </div>
            )}

            </div>

            {/* Footer fijo */}
            <div className="shrink-0 flex justify-end items-center gap-3 p-4 border-t border-gray-100 bg-white">
              {modoEdicionItems && (
                <button
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
                  className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar edición
                </button>
              )}
              <button
                onClick={() => { setReporteOrden(null); setHistorialAuditoria([]); setItemsReporte([]); setCargandoItems(false); setModoEdicionItems(false); setItemsEditables([]); setCuotasEditable(''); }}
                disabled={isGuardandoEdicion}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cerrar
              </button>
              {modoEdicionItems && (
                <button
                  onClick={handleGuardarEdicionItems}
                  disabled={isGuardandoEdicion}
                  className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 flex items-center gap-2"
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
      )}
    </div>
  );
}
