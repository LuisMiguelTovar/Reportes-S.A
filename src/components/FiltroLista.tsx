'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

// "octavio CULMA" -> "Octavio Culma"
export const nombreTitulo = (s: string) =>
  s.trim().toLowerCase().split(/\s+/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

// "12137-TRABAJOS POR REPARACIÓN" -> "Trabajos por reparación"
export const etiquetaTrabajo = (s: string) => {
  const t = s.replace(/^\s*\d+\s*-\s*/, '').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const plano = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

type Opcion = { value: string; label: string };

export default function FiltroLista({
  etiqueta,
  value,
  valorVacio,
  textoVacio,
  opciones,
  onChange,
  buscable = false,
}: {
  /** Texto del botón cuando no hay filtro: "Localidad", "Técnico"… */
  etiqueta: string;
  value: string;
  /** Valor que significa "sin filtro" (el que ya usa el estado de la página, p. ej. 'Todas' o 'Todos'). */
  valorVacio: string;
  /** Texto de la primera opción: "Todas las localidades". */
  textoVacio: string;
  opciones: Opcion[];
  onChange: (valor: string) => void;
  buscable?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [alinearDerecha, setAlinearDerecha] = useState(false);
  const [activo, setActivo] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const idLista = useId();

  const todas: Opcion[] = useMemo(
    () => [{ value: valorVacio, label: textoVacio }, ...opciones],
    [valorVacio, textoVacio, opciones]
  );

  const visibles = useMemo(() => {
    const q = plano(consulta.trim());
    if (!q) return todas;
    return opciones.filter(o => plano(o.label).includes(q));
  }, [todas, opciones, consulta]);

  const activoFiltro = value !== valorVacio;
  const elegida = todas.find(o => o.value === value);

  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    setConsulta('');
    if (devolverFoco) boton.current?.focus();
  };

  const elegir = (v: string) => {
    onChange(v);
    cerrar(true);
  };

  const abrir = () => {
    const i = todas.findIndex(o => o.value === value);
    setActivo(i >= 0 ? i : 0);
    // Si no cabe hacia la derecha, la lista se abre alineada al borde derecho del botón.
    const r = raiz.current?.getBoundingClientRect();
    setAlinearDerecha(!!r && r.left + 320 > window.innerWidth - 16);
    setAbierto(true);
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
    if (!abierto) return;
    if (buscable) campo.current?.focus({ preventScroll: true });
    else lista.current?.focus({ preventScroll: true });
  }, [abierto, buscable]);

  useEffect(() => {
    setActivo(0);
  }, [consulta]);

  useEffect(() => {
    if (!abierto) return;
    const el = document.getElementById(`${idLista}-${activo}`);
    const caja = lista.current;
    if (!el || !caja) return;
    if (el.offsetTop < caja.scrollTop) caja.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > caja.scrollTop + caja.clientHeight) {
      caja.scrollTop = el.offsetTop + el.offsetHeight - caja.clientHeight;
    }
  }, [activo, abierto, idLista]);

  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo(i => Math.min(i + 1, visibles.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActivo(0); }
    else if (e.key === 'End') { e.preventDefault(); setActivo(Math.max(visibles.length - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (visibles[activo]) elegir(visibles[activo].value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    else if (e.key === 'Tab') { cerrar(false); }
  };

  const flecha = (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );

  const estiloBase: React.CSSProperties = {
    minHeight: 44, display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 14, fontWeight: 500, color: '#0F2A5C', cursor: 'pointer',
    transition: 'transform 140ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms ease, box-shadow 150ms ease',
  };

  return (
    <div ref={raiz} style={{ position: 'relative' }}>
      {activoFiltro ? (
        <div style={{
          display: 'flex', alignItems: 'center', minHeight: 44,
          border: '1px solid #BFD3F7', borderRadius: 10, background: '#EFF4FF',
        }}>
          <button
            ref={boton}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={abierto}
            onClick={() => (abierto ? cerrar(false) : abrir())}
            style={{ ...estiloBase, border: 0, background: 'none', padding: '0 6px 0 14px', minHeight: 42, maxWidth: 260 }}
          >
            <span style={{ whiteSpace: 'nowrap' }}>{etiqueta}:</span>
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {elegida?.label ?? value}
            </span>
          </button>
          <button
            type="button"
            aria-label={`Quitar filtro de ${etiqueta.toLowerCase()}`}
            onClick={() => onChange(valorVacio)}
            style={{
              width: 36, minHeight: 42, border: 0, background: 'none', color: '#1D4ED8',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          ref={boton}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={abierto}
          onClick={() => (abierto ? cerrar(false) : abrir())}
          className="active:scale-[0.97]"
          style={{
            ...estiloBase, padding: '0 14px', background: '#fff',
            border: `1px solid ${abierto ? '#2563EB' : '#CBD5E1'}`,
            boxShadow: abierto ? '0 0 0 3px #DBE7FF' : 'none',
            borderRadius: 10,
          }}
        >
          {etiqueta}
          {flecha}
        </button>
      )}

      {abierto && (
        <div
          className="menu-pop"
          onKeyDown={alTeclear}
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', ...(alinearDerecha ? { right: 0 } : { left: 0 }),
            width: 'max(100%, 280px)', maxWidth: 'calc(100vw - 32px)', zIndex: 30,
            background: '#fff', border: '1px solid #E3E9F4', borderRadius: 12,
            overflow: 'hidden', transformOrigin: alinearDerecha ? 'top right' : 'top left',
            boxShadow: '0 16px 40px -10px rgba(15,42,92,0.28)',
          }}
        >
          {buscable && (
            <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid #E3E9F4' }}>
              <input
                ref={campo}
                type="text"
                role="combobox"
                aria-label={`Buscar en ${etiqueta.toLowerCase()}`}
                aria-expanded="true"
                aria-controls={idLista}
                aria-activedescendant={visibles[activo] ? `${idLista}-${activo}` : undefined}
                aria-autocomplete="list"
                placeholder={`Buscar en ${etiqueta.toLowerCase()}`}
                value={consulta}
                onChange={e => setConsulta(e.target.value)}
                style={{
                  boxSizing: 'border-box', width: '100%', minHeight: 40, padding: '0 12px',
                  border: '1px solid #2563EB', borderRadius: 8, fontSize: 14, color: '#0F2A5C',
                  outline: 'none', boxShadow: '0 0 0 3px #DBE7FF',
                }}
              />
            </div>
          )}
          <ul
            ref={lista}
            id={idLista}
            role="listbox"
            tabIndex={-1}
            aria-label={etiqueta}
            aria-activedescendant={!buscable && visibles[activo] ? `${idLista}-${activo}` : undefined}
            style={{
              listStyle: 'none', margin: 0, padding: 6, maxHeight: 280, overflowY: 'auto', outline: 'none', position: 'relative',
              scrollbarWidth: 'thin', scrollbarColor: '#CBD5E1 transparent',
            }}
          >
            {visibles.map((o, i) => (
              <li
                key={o.value}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActivo(i)}
                onMouseDown={e => e.preventDefault()}
                onClick={() => elegir(o.value)}
                style={{
                  display: 'flex', alignItems: 'center', minHeight: 40, padding: '0 10px', borderRadius: 8, fontSize: 14,
                  cursor: 'pointer',
                  color: o.value === valorVacio ? '#64748B' : '#0F2A5C',
                  fontWeight: o.value === value ? 600 : 400,
                  background: i === activo ? '#EFF4FF' : 'transparent',
                }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.label}>
                  {o.label}
                </span>
              </li>
            ))}
            {visibles.length === 0 && (
              <li role="status" style={{ padding: '10px', fontSize: 13, color: '#64748B' }}>
                Sin coincidencias.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
