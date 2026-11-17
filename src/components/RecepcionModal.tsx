'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatoFechaHora } from '@/lib/smartflex';

// ── Recepción de órdenes físicas ──
// Se digita el número de orden (o el contrato) y Enter. La orden queda con la fecha de recepción elegida (por defecto, hoy).
// · Cerrada en la app (Efectiva / Cancelada) → "Recepcionada".
// · Todavía abierta (Pendiente / Programada) → se recepciona igual y queda marcada "Sin cerrar".
// · No existe → se muestran órdenes parecidas por si fue un error de digitación; solo se anota en
//   «Por revisar» si el usuario lo decide.
// La lista de la derecha sale de la base de datos (recepciones de la fecha elegida), así que se puede
// corregir la fecha o deshacer una recepción aunque se haya cerrado la ventana.

type Resultado = 'ok' | 'abierta' | 'ya' | 'noencontrada' | 'error';

type Ultimo = {
  resultado: Resultado;
  texto: string;
  orden?: string;
  contrato?: string;
  estado?: string;
  direccion?: string;
  hora: string;
  fechaPrevia?: string;
  fechaMarcada?: string;
  mensaje?: string;
  guardada?: boolean;
  deshecha?: boolean;
  parecidas?: OrdenMin[];
};

type OrdenMin = {
  orden_trabajo: string;
  contrato: string;
  estado: string;
  direccion?: string | null;
  barrio?: string | null;
  fecha_recepcion?: string | null;
};

type NoEncontrada = { id: string; texto_buscado: string; fecha: string; usuario: string | null };

const ESTADOS_CERRADOS = ['Efectiva', 'Cancelada'];
const limpiar = (s: string) => (s ?? '').replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim();
const horaDe = (iso?: string | Date) => new Date(iso ?? Date.now()).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: true });
const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const fechaLarga = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const diaSiguiente = (iso: string) => new Date(new Date(`${iso}T12:00:00-05:00`).getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const etiquetaEstado = (e?: string) => (e === 'Cancelada' ? 'Incumplida' : e ?? '');
const esCerrada = (e?: string) => ESTADOS_CERRADOS.includes(e ?? '');

// Distancia de edición ≤ 1 (una sustitución, una inserción o una omisión).
function cercano(a: string, b: string) {
  if (a === b) return true;
  const dif = a.length - b.length;
  if (Math.abs(dif) > 1) return false;
  let i = 0, j = 0, fallos = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    fallos++;
    if (fallos > 1) return false;
    if (dif > 0) i++; else if (dif < 0) j++; else { i++; j++; }
  }
  return fallos + (a.length - i) + (b.length - j) <= 1;
}

const COLORES: Record<Resultado, { fondo: string; borde: string; texto: string; punto: string; titulo: string }> = {
  ok: { fondo: '#F0FDF4', borde: '#BBF7D0', texto: '#166534', punto: '#15803D', titulo: 'Recepcionada' },
  abierta: { fondo: '#FFFBEB', borde: '#F3D9A4', texto: '#7A3E06', punto: '#B45309', titulo: 'Recibida sin cerrar' },
  ya: { fondo: '#F1F5F9', borde: '#CBD5E1', texto: '#334155', punto: '#64748B', titulo: 'Ya estaba recepcionada' },
  noencontrada: { fondo: '#FEF2F2', borde: '#FECACA', texto: '#991B1B', punto: '#B91C1C', titulo: 'No encontrada' },
  error: { fondo: '#FEF2F2', borde: '#FECACA', texto: '#991B1B', punto: '#B91C1C', titulo: 'No se pudo guardar' },
};

function IconoResultado({ r, color }: { r: Resultado; color: string }) {
  const comun = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (r === 'ok') return <svg {...comun} strokeWidth={2.6}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
  if (r === 'abierta') return <svg {...comun} strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (r === 'ya') return <svg {...comun} strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
  return <svg {...comun} strokeWidth={2.4}><path d="M6 6l12 12M18 6L6 18" /></svg>;
}

const pill = (fondo: string, texto: string, borde: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: fondo, color: texto, border: `1px solid ${borde}`, whiteSpace: 'nowrap' });
const pillEstado = (estado?: string) => (esCerrada(estado) ? pill('#F0FDF4', '#166534', '#BBF7D0') : pill('#FFFBEB', '#7A3E06', '#F3D9A4'));

export default function RecepcionModal({
  area,
  email,
  onClose,
  onCambio,
}: {
  area: string | null;
  email: string;
  onClose: () => void;
  onCambio?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [ultimo, setUltimo] = useState<Ultimo | null>(null);
  const [elegir, setElegir] = useState<{ texto: string; opciones: OrdenMin[] } | null>(null);
  const [noEncontradas, setNoEncontradas] = useState<NoEncontrada[]>([]);
  const [fecha, setFecha] = useState<string>(() => hoyBogota());
  const [lista, setLista] = useState<OrdenMin[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [editando, setEditando] = useState<string | null>(null);
  const [fechaEdit, setFechaEdit] = useState<string>('');
  const [errorEdit, setErrorEdit] = useState<string | null>(null);

  const esHoy = fecha === hoyBogota();

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Esc: primero cierra lo que esté abierto (edición, elección), luego borra lo digitado y, al final, cierra la ventana.
  useEffect(() => {
    const alTecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editando) { setEditando(null); return; }
      if (elegir) { setElegir(null); return; }
      if (texto) { setTexto(''); return; }
      onClose();
    };
    window.addEventListener('keydown', alTecla);
    return () => window.removeEventListener('keydown', alTecla);
  }, [onClose, editando, elegir, texto]);

  const cargarNoEncontradas = useCallback(async () => {
    if (!area) return;
    const { data } = await supabase
      .from('recepcion_no_encontradas')
      .select('id, texto_buscado, fecha, usuario')
      .eq('area', area)
      .eq('revisada', false)
      .order('fecha', { ascending: false })
      .limit(50);
    setNoEncontradas((data ?? []) as NoEncontrada[]);
  }, [area]);

  useEffect(() => { cargarNoEncontradas(); }, [cargarNoEncontradas]);

  // Recepciones del día elegido (las que están guardadas en la base de datos).
  const cargarLista = useCallback(async () => {
    if (!area) { setCargandoLista(false); return; }
    const { data } = await supabase
      .from('ordenes')
      .select('orden_trabajo, contrato, estado, direccion, fecha_recepcion')
      .eq('area', area)
      .gte('fecha_recepcion', `${fecha}T00:00:00-05:00`)
      .lt('fecha_recepcion', `${diaSiguiente(fecha)}T00:00:00-05:00`)
      .order('fecha_recepcion', { ascending: false })
      .limit(300);
    setLista((data ?? []) as OrdenMin[]);
    setCargandoLista(false);
  }, [area, fecha]);

  useEffect(() => { setEditando(null); cargarLista(); }, [cargarLista]);

  const buscarParecidas = async (t: string): Promise<OrdenMin[]> => {
    if (t.length < 5 || !/^\d+$/.test(t)) return [];
    const cols = 'orden_trabajo, contrato, estado, direccion, barrio, fecha_recepcion';
    const ini = t.slice(0, Math.max(4, t.length - 3));
    const fin = t.slice(-4);
    const [a, b] = await Promise.all([
      supabase.from('ordenes').select(cols).eq('area', area).like('orden_trabajo', `${ini}%`).limit(200),
      supabase.from('ordenes').select(cols).eq('area', area).like('orden_trabajo', `%${fin}`).limit(200),
    ]);
    const vistos = new Set<string>();
    const out: OrdenMin[] = [];
    for (const o of [...((a.data ?? []) as OrdenMin[]), ...((b.data ?? []) as OrdenMin[])]) {
      if (vistos.has(o.orden_trabajo)) continue;
      vistos.add(o.orden_trabajo);
      if (cercano(t, o.orden_trabajo)) out.push(o);
    }
    return out.slice(0, 3);
  };

  const recepcionar = async (o: OrdenMin, buscado: string) => {
    const base = { texto: buscado, orden: o.orden_trabajo, contrato: o.contrato, estado: o.estado, direccion: o.direccion ?? '', hora: horaDe(), fechaMarcada: esHoy ? undefined : fecha };
    if (o.fecha_recepcion) {
      setUltimo({ ...base, resultado: 'ya', fechaPrevia: o.fecha_recepcion });
      return;
    }
    const { data, error } = await supabase
      .from('ordenes')
      .update({ fecha_recepcion: esHoy ? new Date().toISOString() : `${fecha}T12:00:00-05:00`, recibido_por: email })
      .eq('orden_trabajo', o.orden_trabajo)
      .eq('area', area)
      .is('fecha_recepcion', null)
      .select('orden_trabajo');
    if (error || !data || data.length === 0) {
      setUltimo({ ...base, resultado: 'error', mensaje: 'Revisa tu conexión o tus permisos e inténtalo de nuevo.' });
      return;
    }
    setUltimo({ ...base, resultado: esCerrada(o.estado) ? 'ok' : 'abierta' });
    cargarLista();
    onCambio?.();
  };

  const procesar = async () => {
    const t = limpiar(texto);
    if (!t || buscando) return;
    setBuscando(true);
    setElegir(null);
    setEditando(null);
    let conservar = false;
    try {
      const { data, error } = await supabase
        .from('ordenes')
        .select('orden_trabajo, contrato, estado, direccion, barrio, fecha_recepcion')
        .eq('area', area)
        .or(`orden_trabajo.eq.${t},contrato.eq.${t}`)
        .limit(20);
      if (error) {
        setUltimo({ texto: t, resultado: 'error', hora: horaDe(), mensaje: 'No se pudo buscar. Inténtalo de nuevo.' });
        conservar = true;
        return;
      }
      const encontradas = (data ?? []) as OrdenMin[];
      if (encontradas.length === 0) {
        const parecidas = await buscarParecidas(t);
        setUltimo({ texto: t, resultado: 'noencontrada', hora: horaDe(), parecidas });
        conservar = true; // se deja lo digitado, seleccionado, para corregirlo
      } else if (encontradas.length === 1) {
        await recepcionar(encontradas[0], t);
      } else {
        setElegir({ texto: t, opciones: encontradas });
        setUltimo(null);
      }
    } finally {
      if (!conservar) setTexto('');
      setBuscando(false);
      requestAnimationFrame(() => { inputRef.current?.focus(); if (conservar) inputRef.current?.select(); });
    }
  };

  const elegirOrden = async (o: OrdenMin) => {
    if (!elegir || buscando) return;
    setBuscando(true);
    try {
      await recepcionar(o, elegir.texto);
      setElegir(null);
    } finally {
      setBuscando(false);
      inputRef.current?.focus();
    }
  };

  const recepcionarParecida = async (o: OrdenMin) => {
    if (buscando) return;
    setBuscando(true);
    try {
      await recepcionar(o, o.orden_trabajo);
      setTexto('');
    } finally {
      setBuscando(false);
      inputRef.current?.focus();
    }
  };

  const corregirNumero = (t: string) => {
    setTexto(t);
    setUltimo(null);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  };

  const guardarPorRevisar = async (t: string) => {
    const { error } = await supabase.from('recepcion_no_encontradas').insert({ area, texto_buscado: t, usuario: email });
    if (error) { setUltimo(prev => (prev ? { ...prev, mensaje: 'No se pudo guardar en «Por revisar». Inténtalo de nuevo.' } : prev)); return; }
    setUltimo(prev => (prev ? { ...prev, guardada: true, mensaje: undefined } : prev));
    setTexto('');
    cargarNoEncontradas();
    inputRef.current?.focus();
  };

  const quitarRecepcion = async (orden: string) => {
    const { data, error } = await supabase
      .from('ordenes')
      .update({ fecha_recepcion: null, recibido_por: null })
      .eq('orden_trabajo', orden)
      .eq('area', area)
      .select('orden_trabajo');
    if (error || !data || data.length === 0) return false;
    setUltimo(prev => (prev && prev.orden === orden ? { ...prev, deshecha: true } : prev));
    setEditando(null);
    await cargarLista();
    onCambio?.();
    return true;
  };

  const abrirEdicion = (o: OrdenMin) => {
    if (editando === o.orden_trabajo) { setEditando(null); return; }
    setEditando(o.orden_trabajo);
    setErrorEdit(null);
    setFechaEdit(o.fecha_recepcion ? new Date(o.fecha_recepcion).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : hoyBogota());
  };

  const guardarFechaEdit = async (o: OrdenMin) => {
    if (!fechaEdit || fechaEdit > hoyBogota()) { setErrorEdit('Elige una fecha que no sea futura.'); return; }
    const actual = o.fecha_recepcion ? new Date(o.fecha_recepcion).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '';
    if (fechaEdit === actual) { setEditando(null); return; }
    const nueva = fechaEdit === hoyBogota() ? new Date().toISOString() : `${fechaEdit}T12:00:00-05:00`;
    const { data, error } = await supabase
      .from('ordenes')
      .update({ fecha_recepcion: nueva })
      .eq('orden_trabajo', o.orden_trabajo)
      .eq('area', area)
      .select('orden_trabajo');
    if (error || !data || data.length === 0) { setErrorEdit('No se pudo cambiar la fecha. Inténtalo de nuevo.'); return; }
    setEditando(null);
    await cargarLista();
    onCambio?.();
  };

  const marcarRevisada = async (n: NoEncontrada) => {
    const { error } = await supabase
      .from('recepcion_no_encontradas')
      .update({ revisada: true, revisada_en: new Date().toISOString() })
      .eq('id', n.id);
    if (!error) setNoEncontradas(prev => prev.filter(p => p.id !== n.id));
  };

  const cuentas = useMemo(() => ({
    recepcionadas: lista.length,
    sinCerrar: lista.filter(o => !esCerrada(o.estado)).length,
  }), [lista]);

  const puedeEnviar = !buscando && !!limpiar(texto);
  const boton: React.CSSProperties = { minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid #CBD5E1', background: '#fff', color: '#0F2A5C', fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' };
  const botonPri: React.CSSProperties = { ...boton, background: '#0F2A5C', borderColor: '#0F2A5C', color: '#fff', fontWeight: 600 };
  const titulo: React.CSSProperties = { margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#475569' };

  const stat = (valor: number, etiqueta: string, color: string) => (
    <div style={{ border: '1px solid #E3E9F4', borderRadius: 14, padding: '12px 14px', background: '#fff' }}>
      <div style={{ fontSize: 30, lineHeight: 1.05, fontWeight: 700, color: valor > 0 ? color : '#64748B', fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      <div style={{ fontSize: 13, color: '#475569', whiteSpace: 'nowrap' }}>{etiqueta}</div>
    </div>
  );

  const detalle = (it: Ultimo) => {
    if (it.resultado === 'noencontrada') {
      return it.guardada
        ? 'Quedó guardada en «Por revisar».'
        : it.parecidas && it.parecidas.length > 0
          ? '¿Se te fue un dígito? Mira las parecidas aquí abajo o corrige el número.'
          : 'Ese número no existe en el sistema, ni cerrada ni abierta. Revisa el número y corrígelo.';
    }
    const partes: string[] = [];
    if (it.orden) partes.push(`Contrato ${it.contrato} · ${etiquetaEstado(it.estado)}${it.direccion ? ` · ${it.direccion}` : ''}.`);
    if (it.resultado === 'abierta') partes.push('Sigue abierta en Despacho: el técnico aún no la cierra en la app. La fecha quedó guardada y saldrá en el Excel cuando se cierre.');
    if (it.resultado === 'ya' && it.fechaPrevia) partes.push(`Recibida el ${formatoFechaHora(it.fechaPrevia)}. Se conserva esa fecha; si está mal, cámbiala desde la lista.`);
    if (it.mensaje) partes.push(it.mensaje);
    return partes.join(' ');
  };

  const tarjetaUltimo = (it: Ultimo) => {
    const c = COLORES[it.resultado];
    const apagada = !!it.deshecha;
    return (
      <div role="status" aria-live="polite" style={{ borderRadius: 16, padding: '20px 22px', border: `1px solid ${apagada ? '#E3E9F4' : c.borde}`, background: apagada ? '#F8FAFC' : c.fondo, display: 'flex', flexDirection: 'column', gap: 14, opacity: apagada ? 0.8 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <span style={{ width: 48, height: 48, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <IconoResultado r={it.resultado} color={apagada ? '#64748B' : c.punto} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.015em', color: '#0F172A', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{it.orden ?? it.texto}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: apagada ? '#475569' : c.texto, marginTop: 4 }}>
              {apagada ? 'Recepción deshecha' : c.titulo} · {it.hora}
              {it.fechaMarcada && (it.resultado === 'ok' || it.resultado === 'abierta') && !apagada ? ` · fecha ${fechaLarga(it.fechaMarcada)}` : ''}
            </div>
            {!apagada && <div style={{ fontSize: 14, color: '#334155', marginTop: 6, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{detalle(it)}</div>}
          </div>
          {(it.resultado === 'ok' || it.resultado === 'abierta') && !apagada && it.orden && (
            <button type="button" onClick={() => quitarRecepcion(it.orden as string)} style={{ ...boton, flexShrink: 0 }} aria-label={`Deshacer la recepción de la orden ${it.orden}`}>Deshacer</button>
          )}
        </div>
        {it.resultado === 'noencontrada' && !it.guardada && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" onClick={() => corregirNumero(it.texto)} style={botonPri}>Corregir número</button>
            <button type="button" onClick={() => guardarPorRevisar(it.texto)} style={boton}>Guardar para revisar después</button>
          </div>
        )}
        {it.resultado === 'error' && (
          <div><button type="button" onClick={() => corregirNumero(it.texto)} style={botonPri}>Volver a intentar</button></div>
        )}
      </div>
    );
  };

  return (
    <div className="reporte-overlay fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="reporte-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recepcion-titulo"
        style={{ width: '100%', maxWidth: 1080, maxHeight: 'calc(var(--alto-pantalla) * 0.94)', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 20, boxShadow: '0 28px 70px rgba(15,42,92,0.25)', overflow: 'hidden' }}
      >
        {/* Encabezado */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '22px 28px 18px', borderBottom: '1px solid #E3E9F4', flexShrink: 0 }}>
          <span style={{ width: 48, height: 48, borderRadius: 14, background: '#EEF2FF', color: '#0F2A5C', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4" /><rect x="4" y="3" width="16" height="18" rx="3" /></svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 id="recepcion-titulo" style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>Recepción de órdenes</h2>
            <p style={{ margin: '3px 0 0', fontSize: 14, color: '#475569' }}>Registra la fecha en que recibes cada orden en físico.</p>
          </div>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 14px', borderRadius: 999, background: esHoy ? '#F1F5F9' : '#FFFBEB', border: `1px solid ${esHoy ? '#E3E9F4' : '#F3D9A4'}`, fontSize: 13, fontWeight: 600, color: esHoy ? '#0F2A5C' : '#7A3E06', whiteSpace: 'nowrap' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
            {esHoy ? 'Hoy' : 'Fecha'} · {fechaLarga(fecha)}
          </span>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ ...boton, width: 44, padding: 0, flexShrink: 0, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {/* Columna izquierda: captura */}
          <div style={{ flex: '0 1 360px', minWidth: 300, padding: '24px 24px 28px 28px', borderRight: '1px solid #E3E9F4', background: '#FBFCFE', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <form onSubmit={(e) => { e.preventDefault(); procesar(); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label htmlFor="recepcion-input" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0F2A5C', marginBottom: 8 }}>Número de orden</label>
                <div style={{ height: 64, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', border: '2px solid #1D4ED8', borderRadius: 14, boxShadow: '0 0 0 5px rgba(29,78,216,0.12)', background: '#fff' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  <input
                    id="recepcion-input"
                    ref={inputRef}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Digita aquí"
                    disabled={buscando}
                    style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 24, fontWeight: 500, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}
                  />
                  <span style={{ fontSize: 12, color: '#475569', border: '1px solid #CBD5E1', borderRadius: 6, padding: '3px 8px', background: '#F8FAFC' }}>Enter</span>
                </div>
              </div>
              <button type="submit" disabled={!puedeEnviar} style={{ height: 52, border: 0, borderRadius: 14, background: puedeEnviar ? '#0F2A5C' : '#CBD5E1', color: puedeEnviar ? '#fff' : '#475569', fontSize: 16, fontWeight: 600, cursor: puedeEnviar ? 'pointer' : 'default' }}>
                {buscando ? 'Buscando…' : 'Recepcionar'}
              </button>
            </form>
            <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>Si el número de orden no se lee bien, digita el contrato. Con <b>Esc</b> borras lo digitado.</p>

            <div>
              <label htmlFor="recepcion-fecha" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0F2A5C', marginBottom: 8 }}>Fecha de recepción</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px', padding: '10px 14px', borderRadius: 14, border: `1px solid ${esHoy ? '#E3E9F4' : '#F3D9A4'}`, background: esHoy ? '#fff' : '#FFFBEB' }}>
                <input
                  id="recepcion-fecha"
                  type="date"
                  value={fecha}
                  max={hoyBogota()}
                  onChange={(e) => { if (e.target.value) setFecha(e.target.value > hoyBogota() ? hoyBogota() : e.target.value); }}
                  style={{ height: 44, padding: '0 12px', border: '1px solid #CBD5E1', borderRadius: 10, fontSize: 15, fontWeight: 500, color: '#0F172A', background: '#fff', fontVariantNumeric: 'tabular-nums' }}
                />
                {esHoy ? (
                  <span style={{ fontSize: 13, color: '#475569', lineHeight: 1.4, flex: 1, minWidth: 140 }}>Hoy. Cada orden se guarda con la fecha y hora en que la digitas.</span>
                ) : (
                  <>
                    <span style={{ fontSize: 13, color: '#7A3E06', lineHeight: 1.4, flex: 1, minWidth: 140 }}>Lo que recepciones ahora se guarda con fecha <b>{fechaLarga(fecha)}</b>.</span>
                    <button type="button" onClick={() => setFecha(hoyBogota())} style={boton}>Volver a hoy</button>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {stat(cuentas.recepcionadas, 'Recibidas', '#0F2A5C')}
              {stat(cuentas.sinCerrar, 'Sin cerrar', '#B45309')}
              {stat(noEncontradas.length, 'Por revisar', '#B91C1C')}
            </div>
          </div>

          {/* Columna derecha: resultado y lista */}
          <div style={{ flex: '1 1 440px', minWidth: 0, padding: '24px 28px 28px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {elegir && (
              <div style={{ padding: '18px 20px', border: '1px solid #F3D9A4', background: '#FFFBEB', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#7A3E06' }}>
                  El contrato {elegir.texto} tiene {elegir.opciones.length} órdenes. Elige la que tienes en la mano:
                </p>
                {elegir.opciones.map(o => (
                  <button key={o.orden_trabajo} type="button" onClick={() => elegirOrden(o)} disabled={buscando}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '8px 14px', border: '1px solid #CBD5E1', borderRadius: 12, background: '#fff', textAlign: 'left', fontSize: 14, color: '#475569', width: '100%', cursor: 'pointer' }}>
                    <b style={{ fontSize: 16, color: '#0F2A5C', fontVariantNumeric: 'tabular-nums' }}>{o.orden_trabajo}</b>
                    <span style={pillEstado(o.estado)}>{etiquetaEstado(o.estado)}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.direccion ?? ''}>{o.direccion || ''}</span>
                    {o.fecha_recepcion && <span style={{ color: '#15803D', fontWeight: 600, whiteSpace: 'nowrap' }}>ya recepcionada</span>}
                  </button>
                ))}
                <div><button type="button" onClick={() => setElegir(null)} style={boton}>Cancelar</button></div>
              </div>
            )}

            {!ultimo && !elegir && (
              <div style={{ border: '1.5px dashed #CBD5E1', borderRadius: 16, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#0F2A5C' }}>Listo para recibir órdenes</p>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
                  <li>Digita el número de orden de la hoja y pulsa <b>Enter</b>.</li>
                  <li>Si la orden aún está abierta en Despacho, se recepciona igual y queda «sin cerrar».</li>
                  <li>Si te equivocas al digitar, te mostramos órdenes parecidas y puedes corregir el número.</li>
                </ul>
              </div>
            )}

            {ultimo && tarjetaUltimo(ultimo)}

            {ultimo && ultimo.resultado === 'noencontrada' && !ultimo.guardada && ultimo.parecidas && ultimo.parecidas.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <h3 style={titulo}>¿Quisiste decir…?</h3>
                  <span style={pill('#FFFBEB', '#7A3E06', '#F3D9A4')}>{ultimo.parecidas.length} {ultimo.parecidas.length === 1 ? 'parecida' : 'parecidas'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ultimo.parecidas.map(o => (
                    <div key={o.orden_trabajo} style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 64, padding: '8px 8px 8px 16px', border: '1px solid #CBD5E1', borderRadius: 14, background: '#fff' }}>
                      <b style={{ fontSize: 18, color: '#0F2A5C', fontVariantNumeric: 'tabular-nums' }}>{o.orden_trabajo}</b>
                      <span style={pillEstado(o.estado)}>{etiquetaEstado(o.estado)}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.direccion ?? ''}>Contrato {o.contrato}{o.direccion ? ` · ${o.direccion}` : ''}</span>
                      {o.fecha_recepcion
                        ? <span style={{ fontSize: 13, color: '#15803D', fontWeight: 600, whiteSpace: 'nowrap', paddingRight: 8 }}>ya recepcionada</span>
                        : <button type="button" onClick={() => recepcionarParecida(o)} disabled={buscando} style={botonPri}>Recepcionar esta</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lista de la fecha elegida */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h3 style={titulo}>{esHoy ? 'Recepcionadas hoy' : `Recepcionadas el ${fechaLarga(fecha)}`}</h3>
                <span style={pill('#F0FDF4', '#166534', '#BBF7D0')}>{lista.length}</span>
              </div>
              {cargandoLista ? (
                <p style={{ margin: '12px 0 0', fontSize: 14, color: '#475569' }}>Cargando…</p>
              ) : lista.length === 0 ? (
                <p style={{ margin: '12px 0 0', fontSize: 14, color: '#475569' }}>Aún no hay órdenes recepcionadas en esta fecha.</p>
              ) : (
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '100px 76px minmax(0,1fr) 112px 84px 44px', gap: 12, padding: '8px', fontSize: 12, fontWeight: 600, color: '#475569', borderBottom: '1px solid #E3E9F4' }}>
                    <span>Orden</span><span>Contrato</span><span>Dirección</span><span>Estado</span><span style={{ textAlign: 'right' }}>Hora</span><span />
                  </div>
                  {lista.map(o => {
                    const abierto = editando === o.orden_trabajo;
                    return (
                      <div key={o.orden_trabajo}>
                        <div style={{ display: 'grid', gridTemplateColumns: '100px 76px minmax(0,1fr) 112px 84px 44px', gap: 12, alignItems: 'center', minHeight: 52, padding: '0 8px', borderBottom: '1px solid #F1F5F9', fontSize: 14, color: '#334155', background: abierto ? '#F5F8FF' : undefined }}>
                          <span style={{ fontWeight: 600, color: '#0F2A5C', fontVariantNumeric: 'tabular-nums' }}>{o.orden_trabajo}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.contrato}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.direccion ?? ''}>{o.direccion}</span>
                          <span><span style={pillEstado(o.estado)}>{esCerrada(o.estado) ? 'Recepcionada' : 'Sin cerrar'}</span></span>
                          <span style={{ fontSize: 13, color: '#475569', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' }}>{horaDe(o.fecha_recepcion ?? undefined)}</span>
                          <button type="button" onClick={() => abrirEdicion(o)} aria-expanded={abierto} aria-label={`Corregir la recepción de la orden ${o.orden_trabajo}`}
                            style={{ width: 44, height: 44, borderRadius: 10, border: 0, background: abierto ? '#DBE6FF' : 'transparent', color: abierto ? '#1D4ED8' : '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                          </button>
                        </div>
                        {abierto && (
                          <div style={{ margin: '4px 0 10px', padding: '16px 18px', borderRadius: 14, border: '1.5px solid #1D4ED8', background: '#F5F8FF', display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <b style={{ fontSize: 15, color: '#0F2A5C' }}>Corregir la orden {o.orden_trabajo}</b>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                              <label htmlFor="recepcion-fecha-edit" style={{ fontSize: 13, fontWeight: 600, color: '#0F2A5C' }}>Fecha de recepción</label>
                              <input id="recepcion-fecha-edit" type="date" value={fechaEdit} max={hoyBogota()} onChange={(e) => { setFechaEdit(e.target.value); setErrorEdit(null); }}
                                style={{ height: 44, padding: '0 12px', border: '1px solid #CBD5E1', borderRadius: 10, fontSize: 15, color: '#0F172A', background: '#fff' }} />
                              <button type="button" onClick={() => guardarFechaEdit(o)} style={botonPri}>Guardar fecha</button>
                              <button type="button" onClick={() => setEditando(null)} style={boton}>Cancelar</button>
                            </div>
                            {errorEdit && <p role="alert" style={{ margin: 0, fontSize: 13, color: '#991B1B' }}>{errorEdit}</p>}
                            <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>¿Digitaste otra orden por error? Pulsa «Deshacer recepción» y digita la correcta. La orden vuelve a quedar sin fecha de recepción.</p>
                            <div><button type="button" onClick={() => quitarRecepcion(o.orden_trabajo)} style={{ ...boton, color: '#991B1B', borderColor: '#FECACA' }}>Deshacer recepción</button></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {noEncontradas.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <h3 style={titulo}>Por revisar</h3>
                  <span style={pill('#FEF2F2', '#991B1B', '#FECACA')}>{noEncontradas.length}</span>
                </div>
                {noEncontradas.map(n => (
                  <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 56, padding: '0 8px', borderTop: '1px solid #F1F5F9' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#B91C1C', flexShrink: 0 }} aria-hidden="true" />
                    <span style={{ fontWeight: 600, fontSize: 15, color: '#0F2A5C', fontVariantNumeric: 'tabular-nums', minWidth: 110 }}>{n.texto_buscado}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatoFechaHora(n.fecha)}{n.usuario ? ` · ${n.usuario}` : ''}</span>
                    <button type="button" onClick={() => corregirNumero(n.texto_buscado)} style={{ ...boton, flexShrink: 0 }}>Corregir</button>
                    <button type="button" onClick={() => marcarRevisada(n)} style={{ ...boton, flexShrink: 0 }}>Marcar revisada</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
