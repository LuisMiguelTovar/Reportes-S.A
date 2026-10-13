"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export type AreaCodigo = 'SA' | 'RI';
export const NOMBRES_AREA: Record<AreaCodigo, string> = {
  SA: 'Servicios asociados',
  RI: 'Redes internas',
};

const COOKIE = 'hlgas_area';

interface AreaCtx {
  area: AreaCodigo;
  areasPermitidas: AreaCodigo[];
  cambiarArea: (a: AreaCodigo) => void;
}

const Ctx = createContext<AreaCtx>({
  area: 'SA',
  areasPermitidas: ['SA'],
  cambiarArea: () => {},
});

export const useArea = () => useContext(Ctx);

const leerCookie = (): AreaCodigo | null => {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
  const v = m ? decodeURIComponent(m[1]) : null;
  return v === 'SA' || v === 'RI' ? v : null;
};

const escribirCookie = (a: AreaCodigo) => {
  document.cookie = `${COOKIE}=${a}; path=/; max-age=31536000; SameSite=Lax`;
};

export default function AreaProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [areasPermitidas, setAreasPermitidas] = useState<AreaCodigo[]>(['SA']);
  const [area, setArea] = useState<AreaCodigo>('SA');
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let activo = true;
    (async () => {
      let permitidas: AreaCodigo[] = ['SA'];
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('perfiles')
            .select('areas')
            .eq('id_usuario', user.id)
            .maybeSingle();
          const lista = ((data?.areas as string[] | null) || []).filter(
            (a): a is AreaCodigo => a === 'SA' || a === 'RI'
          );
          if (lista.length > 0) permitidas = lista;
        }
      } catch {
        /* si falla, se queda en SA */
      }
      if (!activo) return;

      // Cada cuenta trabaja con UNA sola área fija: la primera de su perfil (perfiles.areas).
      // La cookie solo es una copia para las páginas de servidor; no la decide el usuario.
      const guardada = leerCookie();
      const inicial: AreaCodigo = permitidas[0];
      if (guardada !== inicial) escribirCookie(inicial);
      // Si el servidor pudo haber renderizado con otra área (cookie ausente = SA), refrescar una vez.
      // El servidor pudo haber armado la página con otra área (cookie ausente o vieja = SA).
      // Se hace UNA recarga completa para que todo llegue ya con el área correcta. Solo si la
      // cookie quedó realmente escrita (así nunca puede entrar en bucle de recargas).
      if ((guardada ?? 'SA') !== inicial && leerCookie() === inicial) {
        window.location.reload();
        return;
      }

      setAreasPermitidas(permitidas);
      setArea(inicial);
      setListo(true);
    })();
    return () => {
      activo = false;
    };
  }, [router]);

  const cambiarArea = useCallback(
    (a: AreaCodigo) => {
      if (!areasPermitidas.includes(a) || a === area) return;
      escribirCookie(a);
      setArea(a);
      router.refresh(); // vuelve a renderizar las páginas de servidor con la nueva área
    },
    [areasPermitidas, area, router]
  );

  if (!listo) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Cargando...</div>;
  }

  return (
    <Ctx.Provider value={{ area, areasPermitidas, cambiarArea }}>
      {/* key={area}: al cambiar de área, todas las pantallas se vuelven a montar y consultan con la nueva área */}
      <React.Fragment key={area}>{children}</React.Fragment>
    </Ctx.Provider>
  );
}
