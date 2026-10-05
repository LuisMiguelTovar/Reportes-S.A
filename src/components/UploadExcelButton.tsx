"use client";
import React, { useRef, useState } from 'react';
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

// ─── Helpers para parsear HTML ───────────────────────────────────────

/**
 * Dado el texto HTML completo del archivo, devuelve un array de strings,
 * uno por cada "página" (orden). Las páginas están separadas por
 * <H1 class=SaltoDePagina>.
 */
const splitHtmlPages = (html: string): string[] => {
  // Dividir por el tag H1 con class SaltoDePagina (case-insensitive).
  // El marcador aparece AL FINAL de cada orden, no al inicio — así que
  // el primer segmento (parts[0]) ya contiene la primera orden completa
  // y debe conservarse. Se descartan solo los segmentos vacíos o que no
  // contienen datos de una orden real (ej. el sobrante después del
  // último marcador, que queda casi vacío).
  const parts = html.split(/<H1[^>]*class\s*=\s*["']?SaltoDePagina["']?[^>]*>/i);
  return parts.filter(p => p.trim().length > 0 && p.includes('Número de la Orden'));
};

/**
 * Decodifica las entidades HTML más comunes que aparecen en estos
 * reportes (tildes, ñ, etc.) — el archivo no siempre usa UTF-8 puro.
 */
const decodeHtmlEntities = (s: string): string =>
  s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&Oacute;/gi, 'Ó')
    .replace(/&aacute;/gi, 'á')
    .replace(/&Aacute;/gi, 'Á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&Eacute;/gi, 'É')
    .replace(/&iacute;/gi, 'í')
    .replace(/&Iacute;/gi, 'Í')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&Uacute;/gi, 'Ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Ntilde;/gi, 'Ñ')
    .replace(/&amp;/gi, '&');

const extractFieldsFromPage = (pageHtml: string): Record<string, string> => {
  const fields: Record<string, string> = {};

  // Buscar todas las filas <TR>...</TR>
  const trRegex = /<TR[^>]*>([\s\S]*?)<\/TR>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(pageHtml)) !== null) {
    const rowContent = trMatch[1];
    // Extraer todas las celdas <TD> de la fila
    const tdRegex = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;
    const cells: string[] = [];
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
      const cellText = decodeHtmlEntities(tdMatch[1].replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(cellText);
    }

    // Cada fila de este reporte puede traer UNO o DOS pares label→valor
    // (ej: "Departamento | 5-VALLE DEL CAUCA | Localidad | 18-CALI" son
    // 4 celdas = 2 pares en la misma fila). Se procesan de a pares.
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const label = cells[i].replace(/:$/, '').trim();
      const value = cells[i + 1].trim();
      if (label) {
        fields[label] = value;
      }
    }
  }

  return fields;
};

/** Quita tildes para que la búsqueda de etiquetas no falle por acentos
 * (ej. "Número" vs "numero"). */
const normalizarTexto = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Convierte "26-09-2026 10:19:33" (DD-MM-YYYY HH:MM:SS) a ISO.
 * new Date() de JS no interpreta este formato de forma confiable. */
const parseFechaHtml = (raw: string): string | null => {
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, dd, mm, yyyy, hh, min, ss] = match;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
};

const mapHtmlFieldsToOrden = (fields: Record<string, string>) => {
  const keys = Object.keys(fields);
  const buscar = (...condiciones: ((k: string) => boolean)[]) => {
    for (const cond of condiciones) {
      const found = keys.find(cond);
      if (found) return found;
    }
    return undefined;
  };

  // Buscar el campo de suscripción/contrato
  const suscripcionKey = buscar(k => normalizarTexto(k).includes('suscripci') || normalizarTexto(k).includes('contrato'));
  const suscripcionRaw = suscripcionKey ? fields[suscripcionKey] : '';

  let contrato = '';
  let nombreUsuario = '';
  if (suscripcionRaw) {
    const dashIndex = suscripcionRaw.indexOf('-');
    if (dashIndex !== -1) {
      contrato = suscripcionRaw.substring(0, dashIndex).trim();
      nombreUsuario = suscripcionRaw.substring(dashIndex + 1).trim();
    } else {
      contrato = suscripcionRaw.trim();
    }
  }

  const ordenKey = buscar(
    k => normalizarTexto(k).includes('numero') && normalizarTexto(k).includes('orden'),
    k => normalizarTexto(k) === 'orden'
  );
  const ordenTrabajo = ordenKey ? fields[ordenKey].trim() : '';

  const direccionKey = buscar(k => normalizarTexto(k).includes('direcci'));
  const direccion = direccionKey ? fields[direccionKey].trim() : '';

  const barrioKey = buscar(k => normalizarTexto(k).includes('barrio') || normalizarTexto(k).includes('sector'));
  const barrio = barrioKey ? fields[barrioKey].trim() : '';

  const localidadKey = buscar(k => normalizarTexto(k).includes('localidad') || normalizarTexto(k).includes('municipio'));
  const localidadRaw = localidadKey ? fields[localidadKey].trim() : '';
  const localidad = normalizeLocalidad(localidadRaw);

  const descripcionKey = buscar(
    k => normalizarTexto(k).includes('tipo') && normalizarTexto(k).includes('trabajo'),
    k => normalizarTexto(k).includes('descripci')
  );
  const descripcion = descripcionKey ? fields[descripcionKey].trim() : '';

  const fechaKey = buscar(k => normalizarTexto(k).includes('fecha') && (normalizarTexto(k).includes('asignaci') || normalizarTexto(k).includes('creaci')));
  const fechaRaw = fechaKey ? fields[fechaKey].trim() : '';
  const fechaAsignacion = fechaRaw ? parseFechaHtml(fechaRaw) : null;

  // "Comentario de la orden" trae el texto real de la solicitud del
  // cliente; se prioriza sobre "Solicitud" (que es solo un número+tipo).
  const observacionKey = buscar(
    k => normalizarTexto(k).includes('comentario'),
    k => normalizarTexto(k).includes('observaci')
  );
  const observacion = observacionKey ? fields[observacionKey].trim() : '';

  const medidorKey = buscar(k => normalizarTexto(k).includes('medidor') && !normalizarTexto(k).includes('marca') && !normalizarTexto(k).includes('retirado') && !normalizarTexto(k).includes('instalado'));
  const numeroMedidor = medidorKey ? fields[medidorKey].trim() : '';

  return {
    orden_trabajo: ordenTrabajo,
    contrato,
    direccion,
    barrio,
    localidad,
    descripcion_del_trabajo: descripcion,
    fecha_asignacion_ot: fechaAsignacion,
    observacion_solicitud: observacion,
    estado: 'Pendiente',
    id_tecnico_asignado: null,    // HTML nunca trae técnico
    nombre_usuario: nombreUsuario,
    numero_medidor: numeroMedidor,
  };
};

// ─── Componente principal ────────────────────────────────────────────

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

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const isHtml = extension === 'html' || extension === 'htm';
    const isExcel = extension === 'xlsx' || extension === 'xls' || extension === 'csv';

    if (!isHtml && !isExcel) {
      toast.error('Formato no soportado. Use archivos Excel (.xlsx, .xls, .csv) o HTML (.html, .htm).');
      return;
    }

    setLoading(true);
    toast.loading('Procesando datos...', { id: 'excel-upload' });

    try {
      let formattedData: Record<string, unknown>[];

      if (isHtml) {
        // ─── Flujo HTML ────────────────────────────────────────
        const text = await file.text();
        const pages = splitHtmlPages(text);

        if (pages.length === 0) {
          throw new Error('No se encontraron órdenes en el archivo HTML.');
        }

        formattedData = pages
          .map(page => {
            const fields = extractFieldsFromPage(page);
            return mapHtmlFieldsToOrden(fields);
          })
          .filter(orden => !!orden.orden_trabajo); // Solo órdenes con número válido

        if (formattedData.length === 0) {
          throw new Error('No se encontraron órdenes válidas en el archivo HTML.');
        }

        // ─── Sincronización HTML: solo insertar nuevas ─────────
        const htmlOrdenIds = formattedData.map(o => String(o.orden_trabajo));

        const { data: ordenesExistentes, error: fetchError } = await supabase
          .from('ordenes')
          .select('orden_trabajo')
          .in('orden_trabajo', htmlOrdenIds);

        if (fetchError) throw fetchError;

        const existentesSet = new Set(ordenesExistentes?.map(o => o.orden_trabajo));

        // Filtrar: solo órdenes que NO existen en la BD
        const nuevasOrdenes = formattedData.filter(
          o => !existentesSet.has(String(o.orden_trabajo))
        );

        let insertadasCount = 0;
        if (nuevasOrdenes.length > 0) {
          const { error: insertError } = await supabase
            .from('ordenes')
            .insert(nuevasOrdenes);

          if (insertError) throw insertError;
          insertadasCount = nuevasOrdenes.length;
        }

        const protegidasCount = formattedData.length - insertadasCount;
        const message = `HTML: ${insertadasCount} nuevas insertadas, ${protegidasCount} ya existían (protegidas).`;
        toast.success(message, { id: 'excel-upload' });

      } else {
        // ─── Flujo Excel (lógica original) ─────────────────────
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
        formattedData = jsonData
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
              nombre_usuario: '',
              numero_medidor: '',
            };
          });

        if (formattedData.length === 0) {
          throw new Error('No se encontraron órdenes válidas en el archivo.');
        }

        // --- SINCRONIZACIÓN INTELIGENTE ---

        // 1. Extraer todos los números de orden del Excel
        const excelOrdenIds = formattedData.map(o => String(o.orden_trabajo));

        // 2. Consultar qué órdenes YA existen en la base de datos
        const { data: ordenesExistentes, error: fetchError } = await supabase
          .from('ordenes')
          .select('orden_trabajo, id_tecnico_asignado, estado')
          .in('orden_trabajo', excelOrdenIds);

        if (fetchError) throw fetchError;

        const mapaExistentes = new Map(ordenesExistentes?.map(o => [o.orden_trabajo, o]));

        type TipoOrden = (typeof formattedData)[0];
        const nuevasOrdenes: TipoOrden[] = [];
        const promesasActualizacion: ReturnType<ReturnType<typeof supabase.from>['update']>[] = [];
        let actualizadasCount = 0;

        // 3. Clasificar entre órdenes nuevas y cambios de asignación
        for (const fila of formattedData) {
          const dbOrder = mapaExistentes.get(String(fila.orden_trabajo));

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
                  .eq('orden_trabajo', String(fila.orden_trabajo))
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
      }

      if (onUploadSuccess) {
        onUploadSuccess();
      } else {
        router.refresh();
      }

    } catch (error: unknown) {
      console.error('Error procesando archivo:', error);
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
        accept=".xlsx, .xls, .csv, .html, .htm"
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
            Subir Archivo (Asignación)
          </>
        )}
      </button>
    </div>
  );
}
