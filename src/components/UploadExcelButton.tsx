"use client";
import React, { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase';

// Helper to handle Excel dates
const parseExcelDate = (excelDate: string | number | undefined | null) => {
  if (!excelDate) return null;
  // If it's a number, it's an Excel serial date
  if (typeof excelDate === 'number') {
    // Excel epoch is 1899-12-30
    const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    return date.toISOString();
  }
  // Try to parse string
  const date = new Date(excelDate);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }
  return null;
};

const normalizeLocalidad = (rawLocalidad: string) => {
  if (!rawLocalidad) return '';
  // Extraer el texto dentro del último par de paréntesis
  const match = rawLocalidad.match(/\(([^)]+)\)[^(]*$/);
  let normalized = match ? match[1].trim().toUpperCase() : rawLocalidad.trim().toUpperCase();
  // Unificar variantes conocidas
  if (normalized === 'SANTIAGO DE CALI') normalized = 'CALI';
  return normalized;
};

// Helper to normalize Tecnico nombre
const normalizeTecnicoNombre = (rawTecnico: string) => {
  if (!rawTecnico) return null;
  const trimmed = rawTecnico.trim().toLowerCase();
  
  // Se eliminó 'programado' de las excepciones para que pueda ser asignado
  if (trimmed === '') return null;
  
  const cleaned = trimmed
    .replace(/^spr\.?\s*/g, '') // Elimina prefijos de supervisor
    .trim();
    
  return cleaned;
};

interface UploadExcelButtonProps {
  onUploadSuccess?: () => void;
}

export default function UploadExcelButton({ onUploadSuccess }: UploadExcelButtonProps = {}) {
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    toast.loading('Procesando datos...', { id: 'excel-upload' });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const jsonData = XLSX.utils.sheet_to_json<Record<string, string | number>>(worksheet, { defval: '' });

      // Validar que hay datos
      if (jsonData.length === 0) {
        throw new Error('El archivo Excel está vacío.');
      }

      // FETCH DE PERFILES
      const { data: perfilesData, error: perfilesError } = await supabase
        .from('perfiles')
        .select('id_usuario, nombre');
        
      if (perfilesError) throw perfilesError;

      // Mapeo inicial
      const formattedData = jsonData
        .filter(row => !!row['ORDEN TRABAJO']) // Ignorar filas sin orden de trabajo
        .map(row => {
          const rawTecnico = String(row['TECNICO'] || '');
          const normalizedName = normalizeTecnicoNombre(rawTecnico);
          let assignedId = null;
          
          if (normalizedName) {
            const matchedProfile = perfilesData?.find(p => p.nombre?.trim().toLowerCase() === normalizedName);
            if (matchedProfile) {
              assignedId = matchedProfile.id_usuario;
            }
          }

          return {
            orden_trabajo: String(row['ORDEN TRABAJO']).trim(),
            contrato: String(row['CONTRATO'] || '').trim(),
            direccion: String(row['DIRECCION'] || '').trim(),
            barrio: String(row['BARRIO'] || row['SECTOR OPERATIVO'] || '').trim(),
            localidad: normalizeLocalidad(String(row['LOCALIDAD'] || '')),
            descripcion_del_trabajo: String(row['DESCRIPCIÓN DEL TRABAJO'] || row['DESCRIPCION DEL TRABAJO'] || row['DESCRIPCION_DEL_TRABAJO'] || row['TIPO TRABAJO'] || '').trim(),
            fecha_asignacion_ot: parseExcelDate(row['FECHA_ASIGNACION_OT'] || row['FECHA ASIGNACION']),
            observacion_solicitud: String(row['OBSERVACIÓN SOLICITUD'] || row['OBSERVACION SOLICITUD'] || row['OBSERVACION'] || row['OBSERVACION_SOLICITUD'] || '').trim(),
            estado: 'Pendiente',
            id_tecnico_asignado: assignedId,
          };
        });

      if (formattedData.length === 0) {
        throw new Error('No se encontraron órdenes válidas en el archivo.');
      }

      // --- SINCRONIZACIÓN INTELIGENTE ---

      // 1. Extraer todos los números de orden del Excel
      const excelOrdenIds = formattedData.map(o => o.orden_trabajo);

      // 2. Consultar qué órdenes YA existen en la base de datos
      const { data: ordenesExistentes, error: fetchError } = await supabase
        .from('ordenes')
        .select('orden_trabajo, id_tecnico_asignado, estado')
        .in('orden_trabajo', excelOrdenIds);

      if (fetchError) throw fetchError;

      const mapaExistentes = new Map(ordenesExistentes?.map(o => [o.orden_trabajo, o]));

      type TipoOrden = typeof formattedData[0];
      const nuevasOrdenes: TipoOrden[] = [];
      const promesasActualizacion: any[] = [];
      let actualizadasCount = 0;

      // 3. Clasificar entre órdenes nuevas y cambios de asignación
      for (const fila of formattedData) {
        const dbOrder = mapaExistentes.get(fila.orden_trabajo);

        if (!dbOrder) {
          // La orden no existe en la BD, la preparamos para insertar completa
          nuevasOrdenes.push(fila);
        } else {
          // La orden ya existe. Protegemos los datos de campo.
          // Actualizamos si está "Pendiente" o "Programada" y el técnico en Excel es diferente al de la BD.
          // Efectiva y Cancelada quedan siempre protegidas, sin cambios.
          const esReasignable = dbOrder.estado === 'Pendiente' || dbOrder.estado === 'Programada';
          if (esReasignable && dbOrder.id_tecnico_asignado !== fila.id_tecnico_asignado) {
            const updatePayload: Record<string, unknown> = { id_tecnico_asignado: fila.id_tecnico_asignado };
            // Si estaba Programada, reasignar técnico desde el Excel la reactiva a Pendiente
            // para que vuelva a aparecer en la app del técnico.
            if (dbOrder.estado === 'Programada') {
              updatePayload.estado = 'Pendiente';
            }
            promesasActualizacion.push(
              supabase
                .from('ordenes')
                .update(updatePayload)
                .eq('orden_trabajo', fila.orden_trabajo)
            );
            actualizadasCount++;
          }
        }
      }

      // 4. Insertar las nuevas órdenes en bloque
      let insertadasCount = 0;
      if (nuevasOrdenes.length > 0) {
        const { error: insertError } = await supabase
          .from('ordenes')
          .insert(nuevasOrdenes);

        if (insertError) throw insertError;
        insertadasCount = nuevasOrdenes.length;
      }

      // 5. Ejecutar las actualizaciones de técnicos (si hubo cambios)
      if (promesasActualizacion.length > 0) {
        await Promise.all(promesasActualizacion);
      }

      const sinCambiosCount = formattedData.length - insertadasCount - actualizadasCount;
      const message = `${insertadasCount} nuevas, ${actualizadasCount} reasignadas, ${sinCambiosCount} sin cambios.`;
      toast.success(message, { id: 'excel-upload' });

      if (onUploadSuccess) {
        onUploadSuccess();
      } else {
        router.refresh();
      }

    } catch (error: unknown) {
      console.error('Error procesando Excel:', error);
      const errorMessage = error instanceof Error ? error.message : 'No se pudo procesar el archivo';
      toast.error(`Error: ${errorMessage}`, { id: 'excel-upload' });
    } finally {
      setLoading(false);
      if (inputRef.current) {
        inputRef.current.value = ''; // Reset input file
      }
    }
  };

  return (
    <div className="flex items-center gap-3">
      <input
        type="file"
        ref={inputRef}
        accept=".xlsx, .xls, .csv"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg font-medium text-sm transition flex items-center gap-2 shadow-sm whitespace-nowrap"
      >
        {loading ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Procesando...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Subir Excel (Asignación)
          </>
        )}
      </button>
    </div>
  );
}
