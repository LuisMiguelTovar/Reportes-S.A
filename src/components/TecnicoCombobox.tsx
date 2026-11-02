'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

type Tecnico = { id_usuario: string; nombre: string };

// "luis ROJAS" -> "Luis Rojas"
const titulo = (s: string) =>
  s.trim().toLowerCase().split(/\s+/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
// Sin tildes ni mayúsculas, para buscar
const plano = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const soloLector: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap',
};

export default function TecnicoCombobox({
  tecnicos,
  value,
  onChange,
  disabled = false,
  carga,
}: {
  tecnicos: Tecnico[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Órdenes activas por id de técnico. Si no llega, la lista va en orden alfabético y sin cifras. */
  carga?: Record<string, number>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [activo, setActivo] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const idLista = useId();

  const hayCarga = !!carga && Object.keys(carga).length > 0;
  const activas = (id: string) => (carga ? carga[id] || 0 : 0);
  const textoCarga = (id: string) => {
    const n = activas(id);
    return `${n} ${n === 1 ? 'activa' : 'activas'}`;
  };

  const opciones = useMemo(() => {
    const q = plano(consulta.trim());
    return tecnicos
      .map(t => ({ id: t.id_usuario, nombre: titulo(t.nombre), n: carga ? carga[t.id_usuario] || 0 : 0 }))
      .filter(t => !q || plano(t.nombre).includes(q))
      .sort((a, b) => (hayCarga ? a.n - b.n : 0) || a.nombre.localeCompare(b.nombre, 'es'));
  }, [tecnicos, consulta, carga, hayCarga]);

  const elegido = tecnicos.find(t => t.id_usuario === value);

  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    setConsulta('');
    if (devolverFoco) boton.current?.focus();
  };

  const elegir = (id: string) => {
    onChange(id);
    cerrar(true);
  };

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) {
        setAbierto(false);
        setConsulta('');
      }
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  useEffect(() => {
    if (abierto) campo.current?.focus({ preventScroll: true });
  }, [abierto]);

  useEffect(() => {
    setActivo(0);
  }, [consulta]);

  useEffect(() => {
    if (abierto) document.getElementById(`${idLista}-${activo}`)?.scrollIntoView({ block: 'nearest' });
  }, [activo, abierto, idLista]);

  const alTeclear = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(i => Math.min(i + 1, opciones.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActivo(0); }
    else if (e.key === 'End') { e.preventDefault(); setActivo(Math.max(opciones.length - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (opciones[activo]) elegir(opciones[activo].id); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    else if (e.key === 'Tab') { cerrar(false); }
  };

  return (
    <div ref={raiz} style={{ position: 'relative', width: '100%' }}>
      {abierto && (
        <div
          className="combo-pop"
          style={{
            position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, width: 'max(100%, 340px)', zIndex: 20,
            background: '#fff', border: '1px solid #E3E9F4', borderRadius: 12, overflow: 'hidden',
            boxShadow: '0 16px 40px -10px rgba(15,42,92,0.28)',
          }}
        >
          <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid #E3E9F4' }}>
            <input
              ref={campo}
              type="text"
              role="combobox"
              aria-label="Buscar técnico"
              aria-expanded="true"
              aria-controls={idLista}
              aria-activedescendant={opciones[activo] ? `${idLista}-${activo}` : undefined}
              aria-autocomplete="list"
              placeholder="Buscar técnico"
              value={consulta}
              onChange={e => setConsulta(e.target.value)}
              onKeyDown={alTeclear}
              style={{
                boxSizing: 'border-box', width: '100%', minHeight: 40, padding: '0 12px',
                border: '1px solid #2563EB', borderRadius: 8, fontSize: 14, color: '#0F2A5C',
                outline: 'none', boxShadow: '0 0 0 3px #DBE7FF',
              }}
            />
          </div>
          {hayCarga && (
            <p style={{ margin: 0, padding: '8px 14px 0', fontSize: 12, color: '#64748B' }}>Ordenados por menor carga</p>
          )}
          <ul
            id={idLista}
            role="listbox"
            aria-label="Técnicos"
            style={{
              listStyle: 'none', margin: 0, padding: 6, maxHeight: 264, overflowY: 'auto',
              scrollbarWidth: 'thin', scrollbarColor: '#CBD5E1 transparent',
            }}
          >
            {opciones.map((o, i) => (
              <li
                key={o.id}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={o.id === value}
                onMouseEnter={() => setActivo(i)}
                onMouseDown={e => e.preventDefault()}
                onClick={() => elegir(o.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  minHeight: 40, padding: '0 10px', borderRadius: 8, fontSize: 14,
                  cursor: 'pointer', color: '#0F2A5C', fontWeight: o.id === value ? 600 : 400,
                  background: i === activo ? '#EFF4FF' : 'transparent',
                }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.nombre}</span>
                {hayCarga && (
                  <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 400, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
                    {textoCarga(o.id)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {opciones.length === 0 && (
            <p role="status" style={{ margin: 0, padding: '4px 16px 16px', fontSize: 13, color: '#64748B' }}>
              Ningún técnico coincide con la búsqueda.
            </p>
          )}
        </div>
      )}
      <button
        ref={boton}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => (abierto ? cerrar(false) : setAbierto(true))}
        className="active:scale-[0.97]"
        style={{
          boxSizing: 'border-box', width: '100%', minHeight: 44, padding: '0 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          border: `1px solid ${abierto ? '#2563EB' : '#CBD5E1'}`, borderRadius: 10, background: '#fff',
          boxShadow: abierto ? '0 0 0 3px #DBE7FF' : 'none',
          color: elegido ? '#0F2A5C' : '#64748B', fontSize: 14, fontWeight: elegido ? 600 : 400,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'transform 140ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms ease, box-shadow 150ms ease',
        }}
      >
        <span style={soloLector}>Técnico para asignar: </span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={elegido ? titulo(elegido.nombre) : undefined}>
          {elegido ? titulo(elegido.nombre) : 'Elegir técnico…'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {elegido && hayCarga && (
            <span style={{ fontSize: 13, fontWeight: 400, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
              {textoCarga(elegido.id_usuario)}
            </span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={abierto ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
          </svg>
        </span>
      </button>
    </div>
  );
}
