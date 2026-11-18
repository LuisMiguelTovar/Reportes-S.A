'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { supabase } from '@/lib/supabase';
import { armarPdfRcConFotos, contratoDelNombre, prepararFoto, type FotoLista } from '@/lib/unirRc';

// ── Unir RC + fotos ──
// Se eligen (o se arrastran) los RC escaneados (nombre = número de contrato). Por cada uno se busca la orden EFECTIVA
// de ese contrato y se usan solo las fotos de esa orden (las mismas que salen en el Excel). Si el contrato tiene varias
// órdenes efectivas hay que elegir cuál. El resultado es un ZIP con «contrato_orden.pdf»: el RC tal cual + una foto por página.

type Cand = { orden: string; cierre: string | null; fotos: string[] };
type EstadoFila = 'lista' | 'sinfotos' | 'sinorden' | 'nocontrato' | 'varias' | 'invalido' | 'procesando' | 'hecha' | 'error';
type Fila = {
  id: string;
  archivo: File;
  contrato: string | null;
  estado: EstadoFila;
  cands: Cand[];
  elegida: string;
  mensaje?: string;
  fotosOk?: number;
  fotosFallo?: number;
  otrosEstados?: string;
  pdf?: string;
};

const LOTE = 100;
const MAX_ZIP = 220 * 1024 * 1024;
const fechaCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'sin fecha');
const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

// Colores por estado: fondo, texto, borde, punto
const COL: Record<EstadoFila, { t: string; f: string; c: string; b: string; d: string }> = {
  lista: { t: 'Lista', f: '#F0FDF4', c: '#166534', b: '#BBF7D0', d: '#15803D' },
  hecha: { t: 'Hecha', f: '#F0FDF4', c: '#166534', b: '#BBF7D0', d: '#15803D' },
  sinfotos: { t: 'Sin fotos', f: '#FFFBEB', c: '#7A3E06', b: '#F3D9A4', d: '#B45309' },
  sinorden: { t: 'Sin orden efectiva', f: '#FEF2F2', c: '#991B1B', b: '#FECACA', d: '#B91C1C' },
  nocontrato: { t: 'Contrato no existe', f: '#FEF2F2', c: '#991B1B', b: '#FECACA', d: '#B91C1C' },
  varias: { t: 'Elige la orden', f: '#EEF2FF', c: '#1E3A8A', b: '#C7D2FE', d: '#1D4ED8' },
  invalido: { t: 'Nombre no válido', f: '#FEF2F2', c: '#991B1B', b: '#FECACA', d: '#B91C1C' },
  procesando: { t: 'Procesando…', f: '#F1F5F9', c: '#334155', b: '#CBD5E1', d: '#64748B' },
  error: { t: 'Error', f: '#FEF2F2', c: '#991B1B', b: '#FECACA', d: '#B91C1C' },
};

// Lee los PDFs de lo que se arrastra (archivos sueltos o carpetas)
async function archivosDeEntrada(entrada: any): Promise<File[]> {
  if (entrada.isFile) return [await new Promise<File>((res, rej) => entrada.file(res, rej))];
  if (!entrada.isDirectory) return [];
  const lector = entrada.createReader();
  const hijos: any[] = [];
  for (;;) {
    const lote: any[] = await new Promise((res, rej) => lector.readEntries(res, rej));
    if (lote.length === 0) break;
    hijos.push(...lote);
  }
  return (await Promise.all(hijos.map(archivosDeEntrada))).flat();
}

const IconoOk = ({ c = '#15803D' }: { c?: string }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

export default function UnirRcModal({ area, onClose }: { area: string | null; onClose: () => void }) {
  const carpetaRef = useRef<HTMLInputElement>(null);
  const archivosRef = useRef<HTMLInputElement>(null);
  const cancelarRef = useRef(false);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [incluirSinFotos, setIncluirSinFotos] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [progreso, setProgreso] = useState({ hecho: 0, total: 0 });
  const [resumen, setResumen] = useState<string | null>(null);
  const [soloProblemas, setSoloProblemas] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [yaGenero, setYaGenero] = useState(false);

  useEffect(() => {
    const alTecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !generando) onClose(); };
    window.addEventListener('keydown', alTecla);
    return () => window.removeEventListener('keydown', alTecla);
  }, [onClose, generando]);

  const cambiar = (id: string, parche: Partial<Fila>) => setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...parche } : f)));

  const cargarArchivos = async (lista: File[]) => {
    const pdfs = lista.filter((f) => /\.pdf$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    if (pdfs.length === 0) { setResumen('No encontré archivos PDF en lo que elegiste.'); return; }
    setResumen(null);
    setYaGenero(false);
    setSoloProblemas(false);
    setBuscando(true);
    try {
      const base: Fila[] = pdfs.map((archivo, i) => {
        const contrato = contratoDelNombre(archivo.name);
        return { id: `${Date.now()}-${i}`, archivo, contrato, estado: contrato ? 'sinorden' : 'invalido', cands: [], elegida: '' };
      });
      const contratos = Array.from(new Set(base.map((f) => f.contrato).filter(Boolean))) as string[];

      // 1) Órdenes de esos contratos (cualquier estado, para distinguir «no existe» de «sin orden efectiva»)
      const ordenes: any[] = [];
      for (let i = 0; i < contratos.length; i += LOTE) {
        const { data, error } = await supabase
          .from('ordenes')
          .select('orden_trabajo, contrato, estado, fecha_cierre, urls_fotos')
          .eq('area', area)
          .in('contrato', contratos.slice(i, i + LOTE));
        if (error) throw error;
        ordenes.push(...(data ?? []));
      }
      const efectivas = ordenes.filter((o) => o.estado === 'Efectiva');
      const estadosPorContrato: Record<string, string[]> = {};
      ordenes.forEach((o) => {
        const e = o.estado === 'Cancelada' ? 'Incumplida' : String(o.estado);
        const lista = (estadosPorContrato[String(o.contrato)] ||= []);
        if (!lista.includes(e)) lista.push(e);
      });

      // 2) Para las efectivas sin urls_fotos, las fotos de su entrada de historial más reciente (igual que el Excel)
      const sinUrls = efectivas.filter((o) => !Array.isArray(o.urls_fotos) || o.urls_fotos.length === 0).map((o) => String(o.orden_trabajo));
      const delHistorial: Record<string, string[]> = {};
      for (let i = 0; i < sinUrls.length; i += LOTE) {
        const { data } = await supabase
          .from('historial_ordenes')
          .select('orden_trabajo, fotos, fecha')
          .in('orden_trabajo', sinUrls.slice(i, i + LOTE))
          .order('fecha', { ascending: false });
        (data ?? []).forEach((h: any) => {
          if (!(h.orden_trabajo in delHistorial)) delHistorial[h.orden_trabajo] = Array.isArray(h.fotos) ? h.fotos : [];
        });
      }

      const porContrato: Record<string, Cand[]> = {};
      efectivas.forEach((o) => {
        const fotos: string[] = (Array.isArray(o.urls_fotos) && o.urls_fotos.length > 0 ? o.urls_fotos : delHistorial[o.orden_trabajo] ?? []).filter((u: any) => typeof u === 'string' && u);
        (porContrato[String(o.contrato)] ||= []).push({ orden: String(o.orden_trabajo), cierre: o.fecha_cierre ?? null, fotos: Array.from(new Set(fotos)) });
      });

      setFilas(base.map((f) => {
        if (!f.contrato) return f;
        const cands = (porContrato[f.contrato] ?? []).sort((a, b) => (b.cierre ?? '').localeCompare(a.cierre ?? ''));
        if (cands.length === 0) {
          const otros = estadosPorContrato[f.contrato];
          return otros && otros.length > 0 ? { ...f, estado: 'sinorden' as const, otrosEstados: otros.join(', ') } : { ...f, estado: 'nocontrato' as const };
        }
        if (cands.length === 1) return { ...f, cands, elegida: cands[0].orden, estado: cands[0].fotos.length > 0 ? ('lista' as const) : ('sinfotos' as const) };
        return { ...f, cands, estado: 'varias' as const };
      }));
    } catch (e) {
      console.error('Unir RC: error buscando órdenes', e);
      setResumen('No se pudieron consultar las órdenes. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setBuscando(false);
    }
  };

  const alSoltar = async (e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    if (buscando || generando) return;
    const items = Array.from(e.dataTransfer.items ?? []);
    const entradas = items.map((i: any) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    const archivos: File[] = entradas.length > 0 ? ((await Promise.all(entradas.map(archivosDeEntrada))).flat() as File[]) : Array.from(e.dataTransfer.files);
    cargarArchivos(archivos);
  };

  const reiniciar = () => { setFilas([]); setResumen(null); setYaGenero(false); setSoloProblemas(false); setProgreso({ hecho: 0, total: 0 }); };

  const elegirOrden = (f: Fila, orden: string) => {
    const c = f.cands.find((x) => x.orden === orden);
    if (!c) { cambiar(f.id, { elegida: '', estado: 'varias' }); return; }
    cambiar(f.id, { elegida: orden, estado: c.fotos.length > 0 ? 'lista' : 'sinfotos' });
  };

  const aProcesar = useMemo(() => filas.filter((f) => f.estado === 'lista' || (incluirSinFotos && f.estado === 'sinfotos')), [filas, incluirSinFotos]);
  const cuenta = (e: EstadoFila) => filas.filter((f) => f.estado === e).length;
  const esProblema = (f: Fila) => !['lista', 'hecha', 'procesando'].includes(f.estado);
  const problemas = filas.filter(esProblema).length;
  const visibles = soloProblemas ? filas.filter(esProblema) : filas;

  const descargarReporte = () => {
    const filasReporte = filas.map((f) => {
      const unica = f.cands.length === 1 ? f.cands[0] : undefined;
      const c = f.cands.find((x) => x.orden === f.elegida) ?? unica;
      let situacion = '';
      let observacion = '';
      if (f.estado === 'invalido') { situacion = 'Nombre de archivo no válido'; observacion = 'El nombre debe empezar por el número de contrato.'; }
      else if (f.estado === 'nocontrato') { situacion = 'El contrato no existe en la app'; observacion = 'No hay ninguna orden con ese contrato en esta área.'; }
      else if (f.estado === 'sinorden') { situacion = 'Sin orden efectiva'; observacion = `El contrato existe, pero ninguna de sus órdenes está Efectiva (${f.otrosEstados ?? 'otros estados'}).`; }
      else if (f.cands.length > 1 && !c) { situacion = 'Varias órdenes efectivas'; observacion = `Tiene ${f.cands.length} órdenes efectivas; falta elegir cuál.`; }
      else if (c && c.fotos.length === 0) { situacion = 'Orden efectiva sin fotos'; observacion = 'La orden no tiene fotos en el sistema.'; }
      else if (c) { situacion = 'Orden efectiva con fotos'; observacion = f.fotosFallo ? `${f.fotosFallo} foto(s) no se pudieron descargar.` : ''; }
      if (f.estado === 'error') observacion = f.mensaje ?? 'No se pudo armar el PDF.';
      const resultado = f.estado === 'hecha' ? (f.fotosOk === 0 ? 'PDF generado (solo RC)' : 'PDF generado') : f.estado === 'error' ? 'Error al generar' : 'No generado';
      return {
        'Contrato': f.contrato ?? '',
        'Archivo RC': f.archivo.name,
        'Orden': c ? c.orden : f.cands.map((x) => x.orden).join(', '),
        'Situación': situacion,
        'Fecha de cierre': c ? fechaCorta(c.cierre) : '',
        'Fotos en el sistema': c ? c.fotos.length : '',
        '¿Encontró fotos?': c ? (c.fotos.length > 0 ? 'Sí' : 'No') : 'No aplica',
        'Fotos incluidas en el PDF': f.estado === 'hecha' ? (f.fotosOk ?? 0) : '',
        'Resultado': resultado,
        'Observación': observacion,
        'PDF generado': f.pdf ?? '',
      };
    });
    const hoja = XLSX.utils.json_to_sheet(filasReporte);
    hoja['!cols'] = [12, 22, 24, 30, 14, 12, 14, 14, 24, 60, 28].map((wch) => ({ wch }));
    hoja['!autofilter'] = { ref: hoja['!ref'] as string };
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'RC y fotos');
    XLSX.writeFile(libro, `Reporte_RC_fotos_${hoyBogota()}.xlsx`);
  };

  const descargarFoto = async (url: string): Promise<FotoLista | null> => {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await prepararFoto(await r.blob());
    } catch {
      return null;
    }
  };

  const generar = async () => {
    if (aProcesar.length === 0 || generando) return;
    cancelarRef.current = false;
    setGenerando(true);
    setResumen(null);
    setProgreso({ hecho: 0, total: aProcesar.length });
    let zip = new JSZip();
    let tam = 0;
    let parte = 1;
    let hechas = 0;
    let falladas = 0;
    let fotosPerdidas = 0;
    const usados = new Set<string>();
    const fecha = hoyBogota();
    const volcar = async (final: boolean) => {
      if (tam === 0) return;
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      saveAs(blob, final && parte === 1 ? `RC_con_fotos_${fecha}.zip` : `RC_con_fotos_${fecha}_parte${parte}.zip`);
      parte += 1;
      zip = new JSZip();
      tam = 0;
    };
    try {
      for (let i = 0; i < aProcesar.length; i++) {
        if (cancelarRef.current) break;
        const f = aProcesar[i];
        cambiar(f.id, { estado: 'procesando' });
        try {
          const cand = f.cands.find((c) => c.orden === f.elegida);
          if (!cand || !f.contrato) throw new Error('Sin orden elegida');
          const rcBytes = new Uint8Array(await f.archivo.arrayBuffer());
          const fotos: FotoLista[] = [];
          for (const url of cand.fotos) {
            const foto = await descargarFoto(url);
            if (foto) fotos.push(foto); else fotosPerdidas += 1;
          }
          if (cand.fotos.length > 0 && fotos.length === 0) throw new Error('No se pudo descargar ninguna foto');
          const pdf = await armarPdfRcConFotos(rcBytes, fotos);
          let nombre = `${f.contrato}_${cand.orden}.pdf`;
          for (let n = 2; usados.has(nombre); n++) nombre = `${f.contrato}_${cand.orden} (${n}).pdf`;
          usados.add(nombre);
          zip.file(nombre, pdf);
          tam += pdf.length;
          hechas += 1;
          cambiar(f.id, { estado: 'hecha', fotosOk: fotos.length, fotosFallo: cand.fotos.length - fotos.length, pdf: nombre });
          if (tam >= MAX_ZIP) await volcar(false);
        } catch (e: any) {
          falladas += 1;
          cambiar(f.id, { estado: 'error', mensaje: e?.message || 'No se pudo armar el PDF' });
        }
        setProgreso({ hecho: i + 1, total: aProcesar.length });
      }
      await volcar(true);
      const partes = [`${hechas} PDF ${hechas === 1 ? 'generado' : 'generados'}`];
      if (falladas) partes.push(`${falladas} con error`);
      if (fotosPerdidas) partes.push(`${fotosPerdidas} fotos no se pudieron descargar`);
      if (cancelarRef.current) partes.push('proceso cancelado');
      setResumen(partes.join(' · ') + '.');
      setYaGenero(true);
    } finally {
      setGenerando(false);
    }
  };

  const paso = filas.length === 0 ? 1 : yaGenero || generando ? 3 : 2;
  const porcentaje = progreso.total > 0 ? Math.round((progreso.hecho / progreso.total) * 100) : 0;

  const boton: React.CSSProperties = { minHeight: 44, padding: '0 18px', borderRadius: 12, border: '1px solid #CBD5E1', background: '#fff', color: '#0F2A5C', fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' };
  const botonPri: React.CSSProperties = { ...boton, background: '#0F2A5C', borderColor: '#0F2A5C', color: '#fff', fontWeight: 600 };

  const pasoUI = (n: number, t: string) => {
    const hecho = paso > n;
    const actual = paso === n;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: actual || hecho ? 1 : 0.7 }} aria-current={actual ? 'step' : undefined}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: hecho ? '#15803D' : actual ? '#0F2A5C' : '#fff', color: hecho || actual ? '#fff' : '#475569', border: hecho || actual ? 'none' : '1.5px solid #CBD5E1' }}>
          {hecho ? <IconoOk c="#fff" /> : n}
        </span>
        <span style={{ fontSize: 14, fontWeight: actual ? 700 : 500, color: actual ? '#0F172A' : '#475569' }}>{t}</span>
      </div>
    );
  };
  const linea = <span style={{ flex: '0 1 64px', minWidth: 16, height: 2, background: '#E3E9F4', borderRadius: 2 }} aria-hidden="true" />;

  // Barra de resumen apilada
  const segmentos = [
    { n: cuenta('lista') + cuenta('hecha'), c: '#15803D', t: 'Listas' },
    { n: cuenta('varias'), c: '#1D4ED8', t: 'Por elegir orden' },
    { n: cuenta('sinfotos'), c: '#B45309', t: 'Sin fotos' },
    { n: cuenta('sinorden'), c: '#DC2626', t: 'Sin orden efectiva' },
    { n: cuenta('nocontrato') + cuenta('invalido'), c: '#7F1D1D', t: 'Contrato no existe' },
    { n: cuenta('error'), c: '#475569', t: 'Con error' },
  ];

  const COLS = '120px minmax(0,1fr) 190px minmax(0,1.3fr)';

  return (
    <div className="reporte-overlay fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !generando) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unir-titulo"
        style={{ width: '100%', maxWidth: 1080, maxHeight: 'calc(var(--alto-pantalla) * 0.94)', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 20, boxShadow: '0 28px 70px rgba(15,42,92,0.25)', overflow: 'hidden' }}
      >
        {/* Encabezado */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 28px 18px', flexShrink: 0 }}>
          <span style={{ width: 48, height: 48, borderRadius: 14, background: '#EEF2FF', color: '#0F2A5C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 id="unir-titulo" style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>Unir RC + fotos</h2>
            <p style={{ margin: '3px 0 0', fontSize: 14, color: '#475569' }}>Un solo PDF por contrato: el RC escaneado y, después, las fotos de la orden efectiva.</p>
          </div>
          <button type="button" onClick={onClose} disabled={generando} aria-label="Cerrar" style={{ ...boton, marginLeft: 'auto', width: 44, padding: 0, flexShrink: 0, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: generando ? 0.5 : 1 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* Pasos */}
        <nav aria-label="Pasos" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 28px', borderTop: '1px solid #E3E9F4', borderBottom: '1px solid #E3E9F4', background: '#FBFCFE', flexShrink: 0, flexWrap: 'wrap' }}>
          {pasoUI(1, 'Elegir los RC')}{linea}{pasoUI(2, 'Revisar')}{linea}{pasoUI(3, 'Generar')}
        </nav>

        <input ref={carpetaRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { cargarArchivos(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <input ref={archivosRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => { cargarArchivos(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

        <div style={{ padding: '22px 28px 24px', overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {filas.length === 0 && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={alSoltar}
                style={{ border: `2px dashed ${arrastrando ? '#1D4ED8' : '#CBD5E1'}`, background: arrastrando ? '#F5F8FF' : '#FBFCFE', borderRadius: 20, padding: '34px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', transition: 'background 150ms, border-color 150ms' }}
              >
                <span style={{ width: 64, height: 64, borderRadius: 18, background: '#EEF2FF', color: '#0F2A5C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M12 11v5M9.5 13.5L12 11l2.5 2.5" /></svg>
                </span>
                <div>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{buscando ? 'Buscando las órdenes de cada contrato…' : 'Arrastra aquí la carpeta de los RC'}</p>
                  <p style={{ margin: '6px 0 0', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>o elígela con el botón. Cada PDF debe llamarse con su número de contrato, por ejemplo <b>3232180.pdf</b>.</p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
                  <button type="button" style={{ ...botonPri, minHeight: 48, padding: '0 24px' }} disabled={buscando} onClick={() => carpetaRef.current?.click()}>Elegir carpeta</button>
                  <button type="button" style={{ ...boton, minHeight: 48 }} disabled={buscando} onClick={() => archivosRef.current?.click()}>Elegir archivos</button>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
                  Los PDFs no se suben a ningún servidor: se leen en tu computador.
                </p>
              </div>

              <div>
                <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#475569' }}>Así queda cada PDF</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '16px 20px', border: '1px solid #E3E9F4', borderRadius: 16, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span aria-hidden="true" style={{ display: 'inline-flex', gap: 4 }}>
                      {[0, 1].map((i) => <span key={i} style={{ width: 34, height: 44, border: '1.5px solid #94A3B8', borderRadius: 4, background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: 4, padding: '7px 5px' }}><i style={{ height: 2, background: '#CBD5E1' }} /><i style={{ height: 2, background: '#CBD5E1' }} /><i style={{ height: 2, background: '#CBD5E1', width: '60%' }} /></span>)}
                    </span>
                    <div><div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>RC escaneado</div><div style={{ fontSize: 13, color: '#475569' }}>tal como viene</div></div>
                  </div>
                  <span style={{ fontSize: 22, color: '#64748B' }} aria-hidden="true">+</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span aria-hidden="true" style={{ display: 'inline-flex', gap: 4 }}>
                      {[0, 1, 2].map((i) => <span key={i} style={{ width: 26, height: 44, borderRadius: 4, background: 'linear-gradient(160deg,#BFD3F2,#7FA3D9)', border: '1.5px solid #5B83C4' }} />)}
                    </span>
                    <div><div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>Fotos de la orden efectiva</div><div style={{ fontSize: 13, color: '#475569' }}>una por página</div></div>
                  </div>
                  <span style={{ fontSize: 22, color: '#64748B' }} aria-hidden="true">=</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1E3A8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></svg>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#1E3A8A', fontVariantNumeric: 'tabular-nums' }}>3232180_457828706.pdf</span>
                  </div>
                </div>
                <p style={{ margin: '8px 2px 0', fontSize: 13, color: '#475569' }}>El nombre es <b>contrato_orden</b>. Todo se entrega en un ZIP, con un reporte en Excel de los casos que no se pudieron unir.</p>
              </div>
            </>
          )}

          {filas.length > 0 && (
            <>
              {/* Resumen */}
              <div style={{ border: '1px solid #E3E9F4', borderRadius: 16, padding: '16px 20px', background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>{filas.length}</span>
                  <span style={{ fontSize: 15, color: '#475569' }}>{filas.length === 1 ? 'RC cargado' : 'RC cargados'}</span>
                  <span style={{ fontSize: 15, color: '#475569' }}>·</span>
                  <span style={{ fontSize: 15, color: '#15803D', fontWeight: 600 }}>{cuenta('lista') + cuenta('hecha')} listos</span>
                  {problemas > 0 && <span style={{ fontSize: 15, color: '#B91C1C', fontWeight: 600 }}>· {problemas} con problemas</span>}
                  <button type="button" style={{ ...boton, marginLeft: 'auto', minHeight: 40 }} onClick={reiniciar} disabled={generando}>Cambiar archivos</button>
                </div>
                <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: '#F1F5F9', margin: '14px 0 12px' }} role="img" aria-label={segmentos.filter((s) => s.n > 0).map((s) => `${s.t}: ${s.n}`).join(', ')}>
                  {segmentos.filter((s) => s.n > 0).map((s) => <span key={s.t} style={{ width: `${(s.n / filas.length) * 100}%`, background: s.c }} />)}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px' }} aria-live="polite">
                  {segmentos.filter((s) => s.n > 0).map((s) => (
                    <span key={s.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#334155' }}>
                      <i style={{ width: 10, height: 10, borderRadius: 3, background: s.c }} aria-hidden="true" />
                      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{s.n}</b> {s.t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Filtro y reporte */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <div role="group" aria-label="Filtrar la lista" style={{ display: 'inline-flex', padding: 3, borderRadius: 12, background: '#F1F5F9', border: '1px solid #E3E9F4' }}>
                  {([[false, `Todas (${filas.length})`], [true, `Solo con problemas (${problemas})`]] as const).map(([v, t]) => (
                    <button key={String(v)} type="button" aria-pressed={soloProblemas === v} onClick={() => setSoloProblemas(v)}
                      style={{ minHeight: 40, padding: '0 14px', borderRadius: 9, border: 0, fontSize: 14, fontWeight: 600, cursor: 'pointer', background: soloProblemas === v ? '#fff' : 'transparent', color: soloProblemas === v ? '#0F2A5C' : '#475569', boxShadow: soloProblemas === v ? '0 1px 3px rgba(15,42,92,0.15)' : 'none' }}>{t}</button>
                  ))}
                </div>
                <button type="button" style={{ ...boton, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={descargarReporte}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 4v12m0 0l-4-4m4 4l4-4" /></svg>
                  Descargar reporte (Excel)
                </button>
              </div>

              {/* Tabla */}
              <div style={{ border: '1px solid #E3E9F4', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#475569', background: '#F8FAFC', borderBottom: '1px solid #E3E9F4' }}>
                  <span>Contrato</span><span>Archivo</span><span>Estado</span><span>Orden y fotos</span>
                </div>
                {visibles.length === 0 && <p style={{ margin: 0, padding: '18px 16px', fontSize: 14, color: '#475569' }}>No hay casos con problemas.</p>}
                {visibles.map((f) => {
                  const e = COL[f.estado];
                  const cand = f.cands.find((c) => c.orden === f.elegida);
                  return (
                    <div key={f.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', minHeight: 58, padding: '4px 16px', borderBottom: '1px solid #F1F5F9', fontSize: 14, color: '#334155', background: f.estado === 'hecha' ? '#FAFFFB' : undefined }}>
                      <span style={{ fontWeight: 700, color: '#0F2A5C', fontVariantNumeric: 'tabular-nums' }}>{f.contrato ?? '—'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569' }} title={f.archivo.name}>{f.archivo.name}</span>
                      <span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 26, padding: '0 11px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: e.f, color: e.c, border: `1px solid ${e.b}`, whiteSpace: 'nowrap' }}>
                          {f.estado === 'hecha' ? <IconoOk c={e.d} /> : <i style={{ width: 7, height: 7, borderRadius: '50%', background: e.d }} aria-hidden="true" />}
                          {e.t}
                        </span>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        {f.cands.length > 1 && !generando && f.estado !== 'hecha' ? (
                          <select
                            aria-label={`Orden efectiva del contrato ${f.contrato}`}
                            value={f.elegida}
                            onChange={(ev) => elegirOrden(f, ev.target.value)}
                            style={{ width: '100%', minHeight: 44, padding: '0 10px', border: `1.5px solid ${f.elegida ? '#CBD5E1' : '#1D4ED8'}`, borderRadius: 10, fontSize: 14, color: '#0F172A', background: '#fff' }}
                          >
                            <option value="">Elige la orden…</option>
                            {f.cands.map((c) => <option key={c.orden} value={c.orden}>{c.orden} · cierre {fechaCorta(c.cierre)} · {c.fotos.length} fotos</option>)}
                          </select>
                        ) : cand ? (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            <b style={{ color: '#0F2A5C' }}>{cand.orden}</b> · {f.estado === 'hecha' ? `${f.fotosOk} fotos${f.fotosFallo ? ` (${f.fotosFallo} no se pudieron descargar)` : ''}` : `${cand.fotos.length} fotos`}
                          </span>
                        ) : f.estado === 'error' ? (
                          <span style={{ color: '#991B1B' }}>{f.mensaje}</span>
                        ) : f.estado === 'invalido' ? (
                          <span style={{ color: '#991B1B' }}>El nombre debe empezar por el número de contrato.</span>
                        ) : f.estado === 'nocontrato' ? (
                          <span style={{ color: '#991B1B' }}>Este contrato no existe en la app.</span>
                        ) : (
                          <span style={{ color: '#475569' }}>Tiene órdenes, pero ninguna Efectiva{f.otrosEstados ? ` (${f.otrosEstados})` : ''}.</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {resumen && <p role="status" style={{ margin: 0, padding: '12px 16px', borderRadius: 12, background: resumen.startsWith('No ') ? '#FEF2F2' : '#F0FDF4', border: `1px solid ${resumen.startsWith('No ') ? '#FECACA' : '#BBF7D0'}`, color: resumen.startsWith('No ') ? '#991B1B' : '#166534', fontSize: 14, fontWeight: 600 }}>{resumen}</p>}
        </div>

        {/* Pie */}
        {filas.length > 0 && (
          <div style={{ padding: '14px 28px', borderTop: '1px solid #E3E9F4', background: '#FBFCFE', flexShrink: 0 }}>
            {generando && (
              <div style={{ marginBottom: 12 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje} aria-label="Progreso">
                <div style={{ height: 8, borderRadius: 999, background: '#E3E9F4', overflow: 'hidden' }}><div style={{ width: `${porcentaje}%`, height: '100%', background: '#1D4ED8', transition: 'width 200ms ease-out' }} /></div>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#334155', cursor: 'pointer' }}>
                <input type="checkbox" checked={incluirSinFotos} disabled={generando} onChange={(e) => setIncluirSinFotos(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#1D4ED8' }} />
                Incluir también los que no tienen fotos (solo el RC)
              </label>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                {generando && <span style={{ fontSize: 14, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{progreso.hecho} de {progreso.total}</span>}
                {generando && <button type="button" style={boton} onClick={() => { cancelarRef.current = true; }}>Cancelar</button>}
                <button type="button" style={{ ...botonPri, minHeight: 48, padding: '0 26px', fontSize: 15, opacity: aProcesar.length === 0 || generando ? 0.55 : 1 }} disabled={aProcesar.length === 0 || generando} onClick={generar}>
                  {generando ? 'Generando…' : `Generar ${aProcesar.length} ${aProcesar.length === 1 ? 'PDF' : 'PDFs'}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
