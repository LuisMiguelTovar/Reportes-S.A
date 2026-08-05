'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';
import { supabase } from '@/lib/supabase';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

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
  const [lightbox, setLightbox] = useState<{ fotos: string[]; index: number } | null>(null);
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
        .eq('rol', 'Técnico');
      if (!error && data) {
        setTecnicos(data);
      }
    };
    fetchTecnicos();
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
    // Fecha Cierre, Nº Orden, Contrato, Dirección, Barrio, Estado, Técnico,
    // Causal de Cierre, Comentario = 9 columnas fijas.
    const NUM_COLUMNAS_FIJAS = 9;

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
        comentarioCompleto = `${fechaTexto} · ${badgeLabel}${causalTexto ? ` (${causalTexto})` : ''} · ${cierre.autorNombre || ''}. ${cierre.comentario}`;
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
                                setReporteOrden(row);
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
                  onClick={() => { setReporteOrden(null); setHistorialAuditoria([]); }}
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
              <h4 className="text-base font-bold text-slate-800 mb-1">Bitácora de atención</h4>
              <p className="text-sm text-gray-500 mb-4">Historial de comentarios y evidencias registrados durante la atención de la orden.</p>

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
                                {'. '}
                                {h.comentario}
                              </p>
                            ) : (
                              <p className="text-xs text-gray-400 italic mb-3">No se registró comentario para esta actualización.</p>
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

              {/* También incluir las fotos de Efectiva (urls_fotos) como una entrada final si existen y no vinieron de historial_ordenes */}
              {reporteOrden.urls_fotos && reporteOrden.urls_fotos.length > 0 && (
                <div className="relative pl-6 mt-3">
                  <div className="relative">
                    <div className={`absolute -left-[19px] top-4 w-3 h-3 rounded-full bg-green-500 ring-4 ring-green-100`} />
                    <div className="bg-white rounded-[10px] border border-gray-100 p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold border bg-green-50 text-green-700 border-green-200">
                          Efectiva
                        </span>
                        <span className="text-xs text-gray-400">
                          {reporteOrden.fecha_cierre ? new Date(reporteOrden.fecha_cierre).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : ''}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 italic mb-3">No se registró comentario para esta actualización.</p>
                      <div>
                        <p className="text-xs text-gray-500 font-medium mb-1.5">Evidencias ({reporteOrden.urls_fotos.length})</p>
                        <div className="grid grid-cols-3 gap-2" style={{ maxWidth: '480px' }}>
                          {reporteOrden.urls_fotos.map((url, fotoIdx) => (
                            <div
                              key={fotoIdx}
                              className="relative group cursor-pointer"
                              onClick={() => setLightbox({ fotos: reporteOrden.urls_fotos!, index: fotoIdx })}
                            >
                              <img src={url} alt={`Evidencia ${fotoIdx + 1}`} className="rounded-lg object-cover w-full" style={{ height: '105px' }} />
                              <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5v4m0-4h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Caja informativa */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 mt-4">
                ℹ️ Los comentarios y evidencias fueron registrados desde la aplicación móvil durante la atención de la orden.
              </div>
            </div>

            {/* Footer fijo — solo consulta, sin acciones de edición */}
            <div className="shrink-0 flex justify-end p-4 border-t border-gray-100 bg-white">
              <button
                onClick={() => { setReporteOrden(null); setHistorialAuditoria([]); }}
                className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cerrar
              </button>
            </div>
          </div>

          {/* Visor de fotos (lightbox) con navegación anterior/siguiente */}
          {lightbox && (
            <div
              className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-6"
              onClick={() => setLightbox(null)}
            >
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

              <img
                src={lightbox.fotos[lightbox.index]}
                alt="Evidencia ampliada"
                className="rounded-lg object-contain"
                style={{ width: '85vw', height: '80vh' }}
                onClick={(e) => e.stopPropagation()}
              />

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
