'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type PerfilTecnico = { id_usuario: string; nombre: string };

const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const nombreBonito = (n: string) => n.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

export default function EquipoTrabajoEditor({
  ordenTrabajo,
  onSaved,
}: {
  ordenTrabajo: string;
  onSaved?: () => void;
}) {
  const [tecnicos, setTecnicos] = useState<PerfilTecnico[]>([]);
  const [equipo, setEquipo] = useState<string[]>([]); // nombres tal como se guardan en equipo_trabajo
  const [original, setOriginal] = useState<string[]>([]);
  const [seleccion, setSeleccion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [filasEncontradas, setFilasEncontradas] = useState(0);

  useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      const [perf, miembros, hist] = await Promise.all([
        supabase.from('perfiles').select('id_usuario, nombre').eq('rol', 'Técnico'),
        supabase.from('equipos_supervisor').select('nombre_miembro').eq('activo', true),
        supabase
          .from('historial_ordenes')
          .select('equipo_trabajo, fecha')
          .eq('orden_trabajo', ordenTrabajo)
          .eq('estado', 'Efectiva')
          .order('fecha', { ascending: true }),
      ]);
      if (cancelado) return;
      // Pool de personas seleccionables: técnicos con perfil + miembros activos de equipos_supervisor.
      // id_usuario aquí es la clave normalizada del nombre (deduplica a quien esté en ambas fuentes).
      const pool = new Map<string, PerfilTecnico>();
      (perf.data ?? []).forEach((p) => {
        const k = normalizar(p.nombre);
        pool.set(k, { id_usuario: k, nombre: p.nombre });
      });
      (miembros.data ?? []).forEach((m) => {
        const k = normalizar(m.nombre_miembro);
        if (k && !pool.has(k)) pool.set(k, { id_usuario: k, nombre: m.nombre_miembro });
      });
      setTecnicos(Array.from(pool.values()).sort((a, b) => a.nombre.localeCompare(b.nombre)));
      const filas = hist.data ?? [];
      setFilasEncontradas(filas.length);
      let actual: string[] = [];
      filas.forEach((h) => {
        if (Array.isArray(h.equipo_trabajo) && h.equipo_trabajo.length > 0) actual = h.equipo_trabajo as string[];
      });
      setEquipo(actual);
      setOriginal(actual);
    };
    cargar();
    return () => {
      cancelado = true;
    };
  }, [ordenTrabajo]);

  const registrados = useMemo(() => new Set(tecnicos.map((t) => normalizar(t.nombre))), [tecnicos]);
  const yaEnEquipo = useMemo(() => new Set(equipo.map(normalizar)), [equipo]);
  const disponibles = tecnicos.filter((t) => !yaEnEquipo.has(normalizar(t.nombre)));
  const hayCambios = JSON.stringify(equipo) !== JSON.stringify(original);

  const agregar = () => {
    const t = tecnicos.find((x) => x.id_usuario === seleccion);
    if (!t) return;
    setEquipo((prev) => [...prev, t.nombre]);
    setSeleccion('');
    setMensaje(null);
  };

  const quitar = (nombre: string) => {
    setEquipo((prev) => prev.filter((n) => n !== nombre));
    setMensaje(null);
  };

  const guardar = async () => {
    setGuardando(true);
    setMensaje(null);
    const { data, error } = await supabase
      .from('historial_ordenes')
      .update({ equipo_trabajo: equipo })
      .eq('orden_trabajo', ordenTrabajo)
      .eq('estado', 'Efectiva')
      .select('orden_trabajo');
    setGuardando(false);
    if (error) {
      console.error('Error guardando equipo:', error);
      setMensaje({ tipo: 'error', texto: 'No se pudo guardar el equipo (revisa permisos).' });
      return;
    }
    if (!data || data.length === 0) {
      setMensaje({ tipo: 'error', texto: 'No se actualizó ninguna fila (¿falta la política de admin en historial_ordenes?).' });
      return;
    }
    setOriginal(equipo);
    setMensaje({ tipo: 'ok', texto: 'Equipo guardado. La nómina ya lo toma en cuenta.' });
    onSaved?.();
  };

  if (filasEncontradas === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Esta orden no tiene registro de cierre (Efectiva) en el historial; no se puede editar el equipo.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-800">Equipo de trabajo</h4>
        <span className="text-xs text-gray-400">El equipo se paga como una sola unidad</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {equipo.length === 0 && <span className="text-xs text-gray-400">Sin equipo registrado.</span>}
        {equipo.map((n) => {
          const ok = registrados.has(normalizar(n));
          return (
            <span
              key={n}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                ok ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
              }`}
              title={ok ? '' : 'No coincide con ningún técnico registrado'}
            >
              {nombreBonito(n)}
              {!ok && ' (no registrado)'}
              <button type="button" onClick={() => quitar(n)} className="ml-1 hover:text-red-600" aria-label={`Quitar ${n}`}>
                ×
              </button>
            </span>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={seleccion}
          onChange={(e) => setSeleccion(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Agregar integrante…</option>
          {disponibles.map((t) => (
            <option key={t.id_usuario} value={t.id_usuario}>
              {nombreBonito(t.nombre)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={agregar}
          disabled={!seleccion}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Agregar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={!hayCambios || guardando}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {guardando ? 'Guardando…' : 'Guardar equipo'}
        </button>
      </div>

      {mensaje && (
        <p className={`mt-2 text-xs ${mensaje.tipo === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{mensaje.texto}</p>
      )}
    </div>
  );
}
