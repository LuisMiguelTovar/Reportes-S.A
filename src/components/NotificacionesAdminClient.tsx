'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import UserProfile from '@/components/UserProfile';
import NotificationsBell from '@/components/NotificationsBell';

type Tecnico = {
  id_usuario: string;
  nombre: string;
};

export default function NotificacionesAdminClient() {
  // ── Cierre de nómina ──
  const [fechaNomina, setFechaNomina] = useState('');
  const [loadingFecha, setLoadingFecha] = useState(true);
  const [savingFecha, setSavingFecha] = useState(false);
  const [fechaGuardadaOk, setFechaGuardadaOk] = useState(false);

  // ── Enviar notificación ──
  const [titulo, setTitulo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  const [envioOk, setEnvioOk] = useState(false);

  useEffect(() => {
    const fetchFechaNomina = async () => {
      const { data, error } = await supabase
        .from('app_metadata')
        .select('valor')
        .eq('clave', 'fecha_cierre_nomina')
        .maybeSingle();

      if (!error && data?.valor) {
        setFechaNomina(String(data.valor).slice(0, 10)); // formato yyyy-MM-dd para el <input type="date">
      }
      setLoadingFecha(false);
    };

    const fetchTecnicos = async () => {
      const { data } = await supabase
        .from('perfiles')
        .select('id_usuario, nombre')
        .eq('rol', 'Técnico');
      if (data) setTecnicos(data);
    };

    fetchFechaNomina();
    fetchTecnicos();
  }, []);

  const handleGuardarFecha = async () => {
    if (!fechaNomina) return;
    setSavingFecha(true);
    setFechaGuardadaOk(false);

    const { error } = await supabase
      .from('app_metadata')
      .upsert(
        { clave: 'fecha_cierre_nomina', valor: fechaNomina, updated_at: new Date().toISOString() },
        { onConflict: 'clave' }
      );

    setSavingFecha(false);
    if (!error) {
      setFechaGuardadaOk(true);
      setTimeout(() => setFechaGuardadaOk(false), 3000);
    } else {
      alert('Hubo un error al guardar la fecha.');
    }
  };

  const handleEnviarNotificacion = async () => {
    if (!titulo.trim() || !mensaje.trim()) return;
    if (tecnicos.length === 0) {
      alert('No se encontraron técnicos para notificar.');
      return;
    }

    const confirmado = window.confirm(
      `¿Enviar esta notificación a los ${tecnicos.length} técnicos registrados?`
    );
    if (!confirmado) return;

    setEnviando(true);
    setEnvioOk(false);

    const filas = tecnicos.map((t) => ({
      id_tecnico: t.id_usuario,
      titulo: titulo.trim(),
      mensaje: mensaje.trim(),
      tipo: 'admin',
    }));

    const { error } = await supabase.from('notificaciones').insert(filas);

    setEnviando(false);
    if (!error) {
      setTitulo('');
      setMensaje('');
      setEnvioOk(true);
      setTimeout(() => setEnvioOk(false), 4000);
    } else {
      console.error('Error al enviar notificación:', error);
      alert('Hubo un error al enviar la notificación.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Notificaciones</h1>
          <p className="text-sm text-slate-500 mt-1">Cierre de nómina y mensajes a los técnicos</p>
        </div>
        <div className="flex items-center gap-4">
          <NotificationsBell />
          <UserProfile />
        </div>
      </div>

      {/* ── Cierre de nómina ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-xl">
        <h2 className="text-base font-bold text-slate-800 mb-1">Cierre de nómina</h2>
        <p className="text-sm text-gray-500 mb-4">
          Esta fecha se muestra en el encabezado de la aplicación de todos los técnicos.
        </p>
        {loadingFecha ? (
          <p className="text-sm text-gray-400">Cargando...</p>
        ) : (
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={fechaNomina}
              onChange={(e) => setFechaNomina(e.target.value)}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleGuardarFecha}
              disabled={savingFecha || !fechaNomina}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {savingFecha ? 'Guardando...' : 'Guardar fecha'}
            </button>
            {fechaGuardadaOk && (
              <span className="text-sm text-green-600 font-medium">✓ Guardada correctamente</span>
            )}
          </div>
        )}
      </div>

      {/* ── Enviar notificación a todos ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-xl">
        <h2 className="text-base font-bold text-slate-800 mb-1">Enviar notificación a todos los técnicos</h2>
        <p className="text-sm text-gray-500 mb-4">
          Se enviará a los {tecnicos.length} técnicos registrados actualmente. Aparecerá en la campana de notificaciones de su app.
        </p>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Título (ej. Aviso importante)"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={80}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            placeholder="Escribe el mensaje..."
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            rows={3}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <button
            onClick={handleEnviarNotificacion}
            disabled={enviando || !titulo.trim() || !mensaje.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {enviando ? 'Enviando...' : 'Enviar a todos'}
          </button>
          {envioOk && (
            <p className="text-sm text-green-600 font-medium">✓ Notificación enviada correctamente.</p>
          )}
        </div>
      </div>
    </div>
  );
}
