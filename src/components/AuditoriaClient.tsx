'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

export default function AuditoriaClient({ initialData, error }: { initialData: Orden[], error: any }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [tecnicoFilter, setTecnicoFilter] = useState('Todos los Técnicos');
  const [estadoFilter, setEstadoFilter] = useState('Todos los Estados');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [evidenciasModal, setEvidenciasModal] = useState<string[] | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReopening, setIsReopening] = useState<string | null>(null);
  const [ordenes, setOrdenes] = useState<Orden[]>(initialData);

  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const router = useRouter();

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
    const techs = ordenes.map(o => o.id_tecnico_asignado).filter(Boolean);
    return Array.from(new Set(techs)).sort().map(id => getTecnicoNombre(id));
  }, [ordenes, tecnicos]);

  const filteredData = useMemo(() => {
    return ordenes.filter(row => {
      if (row.estado !== 'Efectiva' && row.estado !== 'Cancelada') return false;

      const matchesEstadoFilter = estadoFilter === 'Todos los Estados' || row.estado === estadoFilter;

      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        (row.contrato && row.contrato.toLowerCase().includes(term)) ||
        (row.orden_trabajo && row.orden_trabajo.toLowerCase().includes(term));

      const techName = getTecnicoNombre(row.id_tecnico_asignado);
      const matchesTecnico = tecnicoFilter === 'Todos los Técnicos' || techName === tecnicoFilter;

      let matchesDate = true;
      if (row.fecha_cierre) {
        // Convertir la fecha UTC a la zona horaria de Colombia antes de comparar
        const fechaUTC = new Date(row.fecha_cierre);
        const formatter = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'America/Bogota',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        // formatter con locale 'sv-SE' produce formato YYYY-MM-DD directamente
        const fechaCierreDay = formatter.format(fechaUTC);
        if (startDate && fechaCierreDay < startDate) matchesDate = false;
        if (endDate && fechaCierreDay > endDate) matchesDate = false;
      } else if (startDate || endDate) {
        // Si no tiene fecha_cierre y hay filtro activo, excluir la fila
        matchesDate = false;
      }

      return matchesEstadoFilter && matchesSearch && matchesTecnico && matchesDate;
    });
  }, [ordenes, searchTerm, tecnicoFilter, estadoFilter, startDate, endDate, tecnicos]);

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
      const ordersToProcess = selectedOrders.length > 0 
        ? filteredData.filter(row => selectedOrders.includes(row.orden_trabajo))
        : filteredData;

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

  const exportToExcel = () => {
    const exportData = filteredData.map(row => ({
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
      'Técnico': getTecnicoNombre(row.id_tecnico_asignado)
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Auditoría');
    XLSX.writeFile(workbook, 'Reporte_Auditoria.xlsx');
  };

  const dataOrdenada = [...filteredData].sort((a, b) => new Date(b.fecha_cierre || 0).getTime() - new Date(a.fecha_cierre || 0).getTime());

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

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 mb-6">
          Error cargando las órdenes de auditoría.
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

      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                <th className="py-3 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="py-3 px-4 whitespace-nowrap">Fecha de Cierre</th>
                <th className="py-3 px-4 whitespace-nowrap">Nº Orden</th>
                <th className="py-3 px-4 whitespace-nowrap">Contrato</th>
                <th className="py-3 px-4 min-w-[200px]">Dirección</th>
                <th className="py-3 px-4 min-w-[200px]">Barrio</th>
                <th className="py-3 px-4 whitespace-nowrap">Estado</th>
                <th className="py-3 px-4 whitespace-nowrap">Técnico</th>
                <th className="py-3 px-4 whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="text-sm text-gray-700">
              {dataOrdenada.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 px-6 text-center text-gray-500">
                    No hay órdenes en historial o que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                dataOrdenada.map((row) => (
                    <tr key={row.orden_trabajo} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4"
                          checked={selectedOrders.includes(row.orden_trabajo)}
                          onChange={() => handleSelectOne(row.orden_trabajo)}
                        />
                      </td>
                      <td className="py-3 px-4 text-gray-900 whitespace-nowrap">
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
                      <td className="py-3 px-4 font-medium text-gray-900 whitespace-nowrap">{row.orden_trabajo}</td>
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{row.contrato}</td>
                      <td className="py-3 px-4 text-gray-500 min-w-[200px] max-w-[300px] truncate" title={row.direccion || '-'}>{row.direccion || '-'}</td>
                      <td className="py-3 px-4 text-gray-500 min-w-[200px] max-w-[300px] truncate" title={row.barrio || '-'}>{row.barrio || '-'}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${row.estado === 'Cancelada' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                          {row.estado}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{getTecnicoNombre(row.id_tecnico_asignado)}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {row.urls_fotos && row.urls_fotos.length > 0 ? (
                            <button
                              onClick={() => setEvidenciasModal(row.urls_fotos!)}
                              className="text-purple-600 hover:text-purple-800 font-semibold flex items-center gap-1 text-sm bg-purple-50 hover:bg-purple-100 px-2 py-1 rounded-md transition-colors w-fit"
                            >
                              📸 Evidencias
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs italic">Sin evidencias</span>
                          )}
                          <button
                            onClick={() => handleReabrirOrden(row.orden_trabajo)}
                            disabled={isReopening === row.orden_trabajo}
                            className="text-amber-600 hover:text-amber-800 font-semibold flex items-center gap-1 text-sm bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-md transition-colors w-fit disabled:opacity-50"
                            title="Reabrir orden (vuelve a Pendiente)"
                          >
                            {isReopening === row.orden_trabajo ? (
                              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            )}
                            Reabrir
                          </button>
                        </div>
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {evidenciasModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-slate-800">Evidencias Fotográficas</h3>
              <button
                onClick={() => setEvidenciasModal(null)}
                className="text-gray-400 hover:bg-gray-100 hover:text-red-500 rounded-full p-1.5 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto max-h-[70vh] flex flex-col gap-6 p-4 bg-gray-50">
              {evidenciasModal.map((url, index) => (
                <div key={index} className="relative group">
                  <img
                    src={url}
                    alt={`Evidencia ${index + 1}`}
                    className="rounded-lg shadow-md w-full max-w-full mx-auto object-cover"
                  />
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownloadSingle(url, `Evidencia_${index + 1}.jpg`)}
                      className="bg-white/90 hover:bg-white text-blue-600 p-2 rounded-full shadow-lg flex items-center gap-2 font-medium text-sm backdrop-blur-sm transition-all border border-blue-100"
                      title="Descargar Foto"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
