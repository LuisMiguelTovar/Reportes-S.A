'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
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
  observacion_solicitud?: string;
  [key: string]: unknown; // por si hay más campos
};

type Tecnico = {
  id_usuario: string;
  nombre: string;
};

const calcularDiasSLA = (fechaAsignacion?: string) => {
  if (!fechaAsignacion) return 0;
  const asignacion = new Date(fechaAsignacion);
  const ahora = new Date();
  const diferenciaMs = ahora.getTime() - asignacion.getTime();
  const dias = Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));
  return dias > 0 ? dias : 0;
};

export default function DespachoTableClient() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loadingOrdenes, setLoadingOrdenes] = useState(true);
  const [errorOrdenes, setErrorOrdenes] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [localidadFilter, setLocalidadFilter] = useState('Todas');
  const [descripcionFilter, setDescripcionFilter] = useState('Todas las Descripciones');
  const [fechaFilter, setFechaFilter] = useState('Todas');
  const [tecnicoFilter, setTecnicoFilter] = useState('Todos');
  const [selectedOrdenes, setSelectedOrdenes] = useState<string[]>([]);
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [selectedTecnicoId, setSelectedTecnicoId] = useState('');
  const [lastUpdateDate, setLastUpdateDate] = useState<string | null>(null);

  // ── Estado para el menú kebab de acciones ──
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Estado para el modal de "Marcar Efectiva" ──
  const [ordenEfectivaId, setOrdenEfectivaId] = useState<string | null>(null);
  const [fotosEfectiva, setFotosEfectiva] = useState<File[]>([]);
  const [isSubiendoEfectiva, setIsSubiendoEfectiva] = useState(false);
  const [errorEfectiva, setErrorEfectiva] = useState<string | null>(null);

  // Helper: formatea un Date a string legible en zona horaria de Colombia
  const formatTimestamp = (date: Date): string =>
    date.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'short',
      timeStyle: 'short',
    });

  // Fetch órdenes pendientes desde Supabase
  const fetchOrdenes = useCallback(async () => {
    setLoadingOrdenes(true);
    setErrorOrdenes(null);
    const { data, error } = await supabase
      .from('ordenes')
      .select('*')
      .eq('estado', 'Pendiente')
      .order('fecha_asignacion_ot', { ascending: false });

    if (error) {
      console.error('Error al cargar órdenes:', error);
      setErrorOrdenes('No se pudieron cargar las órdenes.');
    } else {
      setOrdenes(data || []);
    }
    setLoadingOrdenes(false);
  }, []);

  // Lee la fecha de la última carga de Excel desde la tabla app_metadata.
  // Se ejecuta una sola vez al montar el componente.
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

  // Callback para cuando el upload termina exitosamente:
  // 1. Persiste el timestamp exacto en app_metadata (Supabase)
  // 2. Actualiza el estado local inmediatamente
  // 3. Refresca la tabla de órdenes
  const handleUploadSuccess = useCallback(async () => {
    const ahora = new Date();
    const isoTimestamp = ahora.toISOString();

    // Persistir en Supabase para que cualquier sesión/usuario lo vea
    await supabase
      .from('app_metadata')
      .upsert(
        { clave: 'ultima_carga_excel', valor: isoTimestamp, updated_at: isoTimestamp },
        { onConflict: 'clave' }
      );

    // Actualizar estado local inmediatamente
    setLastUpdateDate(formatTimestamp(ahora));
    fetchOrdenes();
  }, [fetchOrdenes]);

  useEffect(() => {
    fetchOrdenes();
    fetchLastUploadDate();
  }, [fetchOrdenes, fetchLastUploadDate]);

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

  // Extraer opciones únicas para los selectores
  const localidadesUnicas = useMemo(() => {
    const locs = ordenes.map(o => o.localidad).filter(Boolean);
    return Array.from(new Set(locs)).sort();
  }, [ordenes]);

  const descripcionesUnicas = useMemo(() => {
    const desc = ordenes.map(o => o.descripcion_del_trabajo).filter(Boolean);
    return Array.from(new Set(desc)).sort();
  }, [ordenes]);

  // Derive unique technician IDs from orders (for display fallback in table)
  const tecnicosEnOrdenes = useMemo(() => {
    const techs = ordenes.map(o => o.id_tecnico_asignado).filter(Boolean);
    return Array.from(new Set(techs)).sort();
  }, [ordenes]);

  // Helper: get technician name by id_usuario
  const getTecnicoNombre = (idUsuario?: string): string | null => {
    if (!idUsuario) return null;
    const found = tecnicos.find(t => t.id_usuario === idUsuario);
    return found ? found.nombre : null;
  };

  // Filtrado reactivo en memoria
  const filteredData = useMemo(() => {
    return ordenes.filter(row => {
      // 1. Filtro por Búsqueda (contrato, orden_trabajo, direccion, barrio)
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        (row.contrato && row.contrato.toLowerCase().includes(term)) ||
        (row.orden_trabajo && row.orden_trabajo.toLowerCase().includes(term)) ||
        (row.direccion && row.direccion.toLowerCase().includes(term)) ||
        (row.barrio && row.barrio.toLowerCase().includes(term));

      // 2. Filtro por Localidad
      const matchesLocalidad = localidadFilter === 'Todas' || row.localidad === localidadFilter;

      // 3. Filtro por Descripción del Trabajo
      const matchesDescripcion = descripcionFilter === 'Todas las Descripciones' || row.descripcion_del_trabajo === descripcionFilter;

      // 4. Filtro por Fecha (SLA)
      const daysSLA = calcularDiasSLA(row.fecha_asignacion_ot);
      let matchesFecha = true;
      if (fechaFilter === 'Hoy') {
        matchesFecha = daysSLA === 0;
      } else if (fechaFilter === 'Últimos 3 días') {
        matchesFecha = daysSLA <= 3;
      } else if (fechaFilter === 'Vencidas') {
        matchesFecha = daysSLA >= 3;
      }

      // 5. Filtro por Técnico
      const matchesTecnico =
        tecnicoFilter === 'Todos' ||
        (tecnicoFilter === 'Sin asignar' && !row.id_tecnico_asignado) ||
        row.id_tecnico_asignado === tecnicoFilter;

      return matchesSearch && matchesLocalidad && matchesDescripcion && matchesFecha && matchesTecnico;
    }).sort((a, b) => {
      const diasA = calcularDiasSLA(a.fecha_asignacion_ot);
      const diasB = calcularDiasSLA(b.fecha_asignacion_ot);
      return diasB - diasA; // descendente (mayor SLA primero)
    });
  }, [ordenes, searchTerm, localidadFilter, descripcionFilter, fechaFilter, tecnicoFilter]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const visibleIds = filteredData.map(o => o.orden_trabajo);
      const newSelected = new Set([...selectedOrdenes, ...visibleIds]);
      setSelectedOrdenes(Array.from(newSelected));
    } else {
      const visibleIds = new Set(filteredData.map(o => o.orden_trabajo));
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

  const [isAssigning, setIsAssigning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleAsignarBloque = async () => {
    if (!selectedTecnicoId || selectedOrdenes.length === 0) return;
    setIsAssigning(true);

    try {
      const { error } = await supabase
        .from('ordenes')
        .update({ id_tecnico_asignado: selectedTecnicoId })
        .in('orden_trabajo', selectedOrdenes);

      if (error) {
        console.error('Error al asignar órdenes:', error);
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

  // ── Marcar orden como Efectiva (con subida de fotos) ─────────────────
  const handleMarcarEfectiva = async (ordenTrabajo: string) => {
    if (fotosEfectiva.length === 0) {
      setErrorEfectiva('Debes subir al menos una foto.');
      return;
    }
    setIsSubiendoEfectiva(true);
    setErrorEfectiva(null);
    try {
      const urlsSubidas: string[] = [];
      for (let index = 0; index < fotosEfectiva.length; index++) {
        const file = fotosEfectiva[index];
        const path = `${ordenTrabajo}/evidencia_${index + 1}_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('evidencias')
          .upload(path, file);
        if (uploadError) {
          setErrorEfectiva(`Error al subir foto ${index + 1}: ${uploadError.message}`);
          setIsSubiendoEfectiva(false);
          return;
        }
        const { data: publicUrlData } = supabase.storage
          .from('evidencias')
          .getPublicUrl(path);
        urlsSubidas.push(publicUrlData.publicUrl);
      }
      const { error } = await supabase
        .from('ordenes')
        .update({
          estado: 'Efectiva',
          urls_fotos: urlsSubidas,
          fecha_cierre: new Date().toISOString(),
        })
        .eq('orden_trabajo', ordenTrabajo);
      if (error) {
        setErrorEfectiva(`Error al actualizar la orden: ${error.message}`);
      } else {
        setOrdenEfectivaId(null);
        setFotosEfectiva([]);
        setErrorEfectiva(null);
        fetchOrdenes();
      }
    } catch (err) {
      console.error(err);
      setErrorEfectiva('Hubo un error inesperado al marcar la orden como efectiva.');
    } finally {
      setIsSubiendoEfectiva(false);
    }
  };

  // ── Cancelar orden ──────────────────────────────────────────────────────
  const handleCancelarOrden = async (ordenTrabajo: string) => {
    if (!window.confirm(`¿Estás seguro de cancelar la orden ${ordenTrabajo}? Se marcará como Cancelada.`)) return;
    try {
      const { error } = await supabase
        .from('ordenes')
        .update({ estado: 'Cancelada', fecha_cierre: new Date().toISOString() })
        .eq('orden_trabajo', ordenTrabajo);
      if (error) {
        console.error('Error al cancelar orden:', error);
        alert('Hubo un error al cancelar la orden.');
      } else {
        fetchOrdenes();
      }
    } catch (err) {
      console.error(err);
      alert('Hubo un error inesperado al cancelar la orden.');
    }
  };

  const isAllVisibleSelected = filteredData.length > 0 && filteredData.every(o => selectedOrdenes.includes(o.orden_trabajo));

  // ── Exportar a CSV ──────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (filteredData.length === 0) return;

    const headers = [
      'Orden',
      'Contrato',
      'Dirección',
      'Barrio',
      'Localidad',
      'Descripción del Trabajo',
      'Días SLA',
      'Técnico Asignado',
    ];

    const escapeCSV = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const rows = filteredData.map((row) => {
      const diasSLA = calcularDiasSLA(row.fecha_asignacion_ot);
      const tecnico = getTecnicoNombre(row.id_tecnico_asignado as string) || 'Sin asignar';
      return [
        row.orden_trabajo || '',
        row.contrato || '',
        row.direccion || '',
        row.barrio || '',
        row.localidad || '',
        row.descripcion_del_trabajo || '',
        String(diasSLA),
        tecnico,
      ].map(escapeCSV).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    // BOM para que Excel interprete correctamente los acentos
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


  if (loadingOrdenes) {
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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Panel de Despacho</h1>
          <p className="text-sm text-slate-500 mt-1">Asignación y gestión de órdenes pendientes</p>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdateDate && <span className="text-sm font-medium text-gray-500 hidden md:block">Última actualización: {lastUpdateDate}</span>}
          <button
            onClick={handleExportCSV}
            disabled={filteredData.length === 0}
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
      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-xl">
          <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text"
            placeholder="Buscar por Contrato, Orden, Dirección o Barrio..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-gray-700"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={localidadFilter}
          onChange={(e) => setLocalidadFilter(e.target.value)}
        >
          <option value="Todas">Todas las Localidades</option>
          {localidadesUnicas.map(loc => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[250px] truncate"
          value={descripcionFilter}
          onChange={(e) => setDescripcionFilter(e.target.value)}
        >
          <option value="Todas las Descripciones">Todas las Descripciones</option>
          {descripcionesUnicas.map(desc => (
            <option key={desc} value={desc}>{desc}</option>
          ))}
        </select>
        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
          value={fechaFilter}
          onChange={(e) => setFechaFilter(e.target.value)}
        >
          <option value="Todas">Todas las fechas</option>
          <option value="Hoy">Hoy (0 días)</option>
          <option value="Últimos 3 días">Últimos 3 días</option>
          <option value="Vencidas">Vencidas ({'>='} 3 días)</option>
        </select>
        <select
          className="border border-gray-200 rounded-lg px-4 py-2.5 bg-white text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
          value={tecnicoFilter}
          onChange={(e) => setTecnicoFilter(e.target.value)}
        >
          <option value="Todos">Todos los Técnicos</option>
          <option value="Sin asignar">Sin asignar</option>
          {tecnicos.map(tech => (
            <option key={tech.id_usuario} value={tech.id_usuario}>{tech.nombre}</option>
          ))}
        </select>
      </div>

      {/* Tabla de Despacho */}
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden p-6 mt-6">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                <th className="py-3 px-4">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={isAllVisibleSelected}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="py-3 px-4 whitespace-nowrap">Orden</th>
                <th className="py-3 px-4 whitespace-nowrap">Contrato</th>
                <th className="py-3 px-4 min-w-[200px]">Dirección</th>
                <th className="py-3 px-4 min-w-[200px]">Barrio</th>
                <th className="py-3 px-4 whitespace-nowrap">Localidad</th>
                <th className="py-3 px-4 min-w-[200px]">Descripción del Trabajo</th>
                <th className="py-3 px-4 whitespace-nowrap">Días / SLA</th>
                <th className="py-3 px-4 whitespace-nowrap">Técnico Asignado</th>
                <th className="py-3 px-4 text-center whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="text-sm text-gray-700">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-gray-500">
                    No se encontraron órdenes que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                filteredData.map((row) => (
                  <tr key={row.orden_trabajo} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedOrdenes.includes(row.orden_trabajo)}
                        onChange={(e) => handleSelectOne(row.orden_trabajo, e.target.checked)}
                      />
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-medium text-gray-900">{row.orden_trabajo}</td>
                    <td className="py-3 px-4 whitespace-nowrap">{row.contrato}</td>
                    <td className="py-3 px-4 min-w-[200px] max-w-[300px] truncate" title={row.direccion}>{row.direccion}</td>
                    <td className="py-3 px-4 min-w-[200px] max-w-[300px] truncate" title={row.barrio || '-'}>{row.barrio || '-'}</td>
                    <td className="py-3 px-4 whitespace-nowrap">{row.localidad}</td>
                    <td className="py-3 px-4 text-sm text-gray-500 truncate min-w-[200px] max-w-[300px]" title={row.descripcion_del_trabajo || ''}>
                      {row.descripcion_del_trabajo || '-'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {(() => {
                        const daysSLA = calcularDiasSLA(row.fecha_asignacion_ot);
                        const slaColor = daysSLA >= 3 ? 'bg-red-100 text-red-800' : daysSLA === 2 ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800';
                        return (
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold whitespace-nowrap ${slaColor}`}>
                            {daysSLA} {daysSLA === 1 ? 'día' : 'días'}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {(() => {
                        const nombre = getTecnicoNombre(row.id_tecnico_asignado as string);
                        return nombre ? (
                          <p className="text-gray-900 font-medium">{nombre}</p>
                        ) : (
                          <p className="text-gray-400 text-sm italic">Sin asignar</p>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <button
                        onClick={(e) => {
                          if (openMenuId === row.orden_trabajo) {
                            setOpenMenuId(null);
                            setMenuPosition(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const alturaMenuEstimada = 140;
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
                          className="w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1"
                        >
                          <button
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            onClick={() => { setOrdenEfectivaId(row.orden_trabajo); setOpenMenuId(null); setMenuPosition(null); }}
                          >
                            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            Marcar Efectiva
                          </button>
                          <button
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            onClick={() => { handleCancelarOrden(row.orden_trabajo); setOpenMenuId(null); setMenuPosition(null); }}
                          >
                            <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            Cancelar orden
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resumen de filtrado */}
      <div className="mt-4 text-sm text-gray-500 px-2">
        Mostrando {filteredData.length} de {ordenes.length} órdenes pendientes
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

      {/* Modal de Marcar Efectiva */}
      {ordenEfectivaId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-4">
              Marcar orden {ordenEfectivaId} como Efectiva
            </h2>

            <label className="block text-sm font-medium text-gray-700 mb-2">Subir evidencia fotográfica</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files) {
                  setFotosEfectiva(Array.from(e.target.files));
                  setErrorEfectiva(null);
                }
              }}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition-colors"
            />

            {fotosEfectiva.length > 0 && (
              <ul className="mt-3 space-y-1">
                {fotosEfectiva.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      className="text-gray-400 hover:text-red-500 ml-2 transition-colors"
                      onClick={() => setFotosEfectiva(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {errorEfectiva && (
              <p className="mt-2 text-sm text-red-600">{errorEfectiva}</p>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                onClick={() => { setOrdenEfectivaId(null); setFotosEfectiva([]); setErrorEfectiva(null); }}
              >
                Cancelar
              </button>
              <button
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                disabled={isSubiendoEfectiva}
                onClick={() => handleMarcarEfectiva(ordenEfectivaId)}
              >
                {isSubiendoEfectiva ? 'Subiendo...' : 'Confirmar y subir fotos'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

