'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';

export default function ExcelColumnFilter({
  options,
  selected,
  onApply,
  onCancel,
  panelRef,
  position,
}: {
  options: { value: string; label: string }[];
  selected: Set<string> | null; // null = todas
  onApply: (next: Set<string> | null) => void;
  onCancel: () => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  position: { top: number; left: number };
}) {
  const opcionesNormalizadas = useMemo(
    () =>
      (options || [])
        .filter((o) => o && o.value !== null && o.value !== undefined)
        .map((o) => {
          const raw = (o.label ?? '').toString().trim();
          return {
            value: o.value,
            label: raw === '' || raw === '-' ? '(Vacías)' : (o.label ?? '').toString(),
          };
        }),
    [options]
  );
  const allValues = useMemo(() => opcionesNormalizadas.map(o => o.value), [opcionesNormalizadas]);
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected ?? allValues));
  const [hasInteracted, setHasInteracted] = useState(false);

  const filteredOptions = useMemo(
    () =>
      opcionesNormalizadas.filter((o) => {
        const etiqueta = o.label;
        return (etiqueta ?? '').toLowerCase().includes((search ?? '').toLowerCase());
      }),
    [opcionesNormalizadas, search]
  );

  const allFilteredChecked = filteredOptions.length > 0 && filteredOptions.every(o => checked.has(o.value));

  const toggleAllFiltered = () => {
    setHasInteracted(true);
    setChecked(prev => {
      const next = new Set(prev);
      if (allFilteredChecked) {
        filteredOptions.forEach(o => next.delete(o.value));
      } else {
        filteredOptions.forEach(o => next.add(o.value));
      }
      return next;
    });
  };

  const aplicar = () => {
    if (!hasInteracted && search.trim() !== '') {
      // Solo buscó, no tocó ningún checkbox: aplica exactamente lo visible.
      onApply(new Set(filteredOptions.map((o) => o.value)));
    } else if (checked.size === allValues.length) {
      onApply(null); // Todo marcado = sin filtro
    } else {
      onApply(new Set(checked));
    }
  };

  // Teclado: Esc cancela, Enter aplica, ↑/↓ recorren buscador y casillas, Espacio marca (nativo en la casilla).
  const usoTeclado = useRef(false);
  const elementoPrevio = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
  );
  useEffect(() => {
    const previo = elementoPrevio.current;
    // Al cerrar con el teclado, el foco vuelve a la flechita que abrió el panel.
    return () => { if (usoTeclado.current && previo && previo.isConnected) previo.focus(); };
  }, []);

  const manejarTeclas = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const destino = e.target as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      usoTeclado.current = true;
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      usoTeclado.current = true;
      if (destino.tagName === 'BUTTON') return; // Cancelar / Aceptar hacen su propia acción
      e.preventDefault();
      aplicar();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const campos = Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>('input'));
      const i = campos.indexOf(destino as HTMLInputElement);
      if (i === -1) return;
      const siguiente = campos[e.key === 'ArrowDown' ? Math.min(i + 1, campos.length - 1) : Math.max(i - 1, 0)];
      e.preventDefault();
      siguiente?.focus();
      siguiente?.scrollIntoView({ block: 'nearest' });
    }
  };

  const toggleOne = (value: string) => {
    setHasInteracted(true);
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Filtro de columna"
      onKeyDown={manejarTeclas}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 normal-case font-normal text-gray-700"
      style={{ top: position.top, left: position.left, width: '240px' }}
    >
      <input
        type="text"
        autoFocus
        placeholder="Buscar..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
      />
      <label className="flex items-center gap-2 px-1 py-1 text-xs font-semibold text-gray-700 border-b border-gray-100 mb-1 cursor-pointer focus-within:bg-blue-50 focus-within:ring-1 focus-within:ring-blue-300 rounded">
        <input type="checkbox" checked={allFilteredChecked} onChange={toggleAllFiltered} className="rounded" />
        (Seleccionar todo)
      </label>
      <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
        {filteredOptions.length === 0 ? (
          <p className="text-xs text-gray-400 px-1 py-2">Sin resultados</p>
        ) : (
          filteredOptions.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 px-1 py-1 text-xs text-gray-600 hover:bg-gray-50 focus-within:bg-blue-50 focus-within:ring-1 focus-within:ring-blue-300 rounded cursor-pointer">
              <input type="checkbox" checked={checked.has(opt.value)} onChange={() => toggleOne(opt.value)} className="rounded" />
              <span className="truncate">{opt.label}</span>
            </label>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          Cancelar
        </button>
        <button
          type="button"
          onClick={aplicar}
          className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500"
        >
          Aceptar
        </button>
      </div>
      <p className="px-1 pt-1.5 text-[10px] leading-tight text-gray-400">↑↓ moverse · Espacio marcar · Enter aplicar · Esc cancelar</p>
    </div>
  );
}

export function ColumnTextFilter({
  value,
  onApply,
  onCancel,
  panelRef,
  position,
  placeholder = 'Contiene…',
}: {
  value: string;
  onApply: (next: string) => void;
  onCancel: () => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  position: { top: number; left: number };
  placeholder?: string;
}) {
  const [texto, setTexto] = useState(value ?? '');
  const usoTeclado = useRef(false);
  const elementoPrevio = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
  );

  useEffect(() => {
    const previo = elementoPrevio.current;
    return () => { if (usoTeclado.current && previo && previo.isConnected) previo.focus(); };
  }, []);

  const aplicar = () => {
    onApply(texto.trim());
  };

  const limpiar = () => {
    setTexto('');
    onApply('');
  };

  const manejarTeclas = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      usoTeclado.current = true;
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      const destino = e.target as HTMLElement;
      if (destino.tagName === 'BUTTON') return;
      e.preventDefault();
      usoTeclado.current = true;
      aplicar();
      return;
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Filtro de texto"
      onKeyDown={manejarTeclas}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2.5 normal-case font-normal text-gray-700"
      style={{ top: position.top, left: position.left, width: '240px' }}
    >
      <input
        type="text"
        autoFocus
        placeholder={placeholder}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2.5"
      />
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
        <button
          type="button"
          onClick={limpiar}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Limpiar
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={aplicar}
            className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500"
          >
            Aceptar
          </button>
        </div>
      </div>
      <p className="px-1 pt-1.5 text-[10px] leading-tight text-gray-400">Enter aplicar · Esc cancelar</p>
    </div>
  );
}

export function ColumnDateFilter({
  startDate,
  endDate,
  onApply,
  onCancel,
  panelRef,
  position,
}: {
  startDate: string;
  endDate: string;
  onApply: (desde: string, hasta: string) => void;
  onCancel: () => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  position: { top: number; left: number };
}) {
  const [desde, setDesde] = useState(startDate ?? '');
  const [hasta, setHasta] = useState(endDate ?? '');
  const usoTeclado = useRef(false);
  const elementoPrevio = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
  );

  useEffect(() => {
    const previo = elementoPrevio.current;
    return () => { if (usoTeclado.current && previo && previo.isConnected) previo.focus(); };
  }, []);

  const aplicar = () => {
    onApply(desde, hasta);
  };

  const limpiar = () => {
    setDesde('');
    setHasta('');
    onApply('', '');
  };

  const manejarTeclas = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      usoTeclado.current = true;
      onCancel();
      return;
    }
    if (e.key === 'Enter') {
      const destino = e.target as HTMLElement;
      if (destino.tagName === 'BUTTON') return;
      e.preventDefault();
      usoTeclado.current = true;
      aplicar();
      return;
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Filtro de fecha"
      onKeyDown={manejarTeclas}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2.5 normal-case font-normal text-gray-700"
      style={{ top: position.top, left: position.left, width: '250px' }}
    >
      <div className="flex flex-col gap-2 mb-2.5">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Desde</label>
          <input
            type="date"
            autoFocus
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
            className="w-full border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Hasta</label>
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
            className="w-full border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
        <button
          type="button"
          onClick={limpiar}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Limpiar
        </button>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={aplicar}
            className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500"
          >
            Aceptar
          </button>
        </div>
      </div>
      <p className="px-1 pt-1.5 text-[10px] leading-tight text-gray-400">Enter aplicar · Esc cancelar</p>
    </div>
  );
}

