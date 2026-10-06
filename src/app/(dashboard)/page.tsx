import { supabase } from '@/lib/supabase';
import DashboardClient from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CAPACIDAD_POR_DEFECTO = 12;

export default async function DashboardPage() {
  // Rango de "hoy" en hora de Colombia, calculado antes de lanzar las consultas.
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const dateObj: Record<string, string> = {};
  parts.forEach(({ type, value }) => {
    dateObj[type] = value;
  });

  const inicioHoy = `${dateObj.year}-${dateObj.month}-${dateObj.day}T00:00:00-05:00`;
  const finHoy = `${dateObj.year}-${dateObj.month}-${dateObj.day}T23:59:59-05:00`;

  // Las consultas son independientes entre sí: se lanzan en paralelo.
  const [activasRes, cerradasRes, perfilesRes, creadasRes, capacidadRes, localidadesRes] = await Promise.all([
    // Órdenes activas (todo lo que no está cerrado)
    supabase
      .from('ordenes')
      .select('orden_trabajo, estado, localidad, barrio, descripcion_del_trabajo, id_tecnico_asignado, contrato, fecha_asignacion_ot')
      .not('estado', 'in', '("Efectiva","Cancelada")'),

    // Órdenes cerradas hoy (filas, no solo el conteo: se usan para efectivas/incumplidas y para el flujo por hora)
    supabase
      .from('ordenes')
      .select('orden_trabajo, estado, fecha_cierre')
      .in('estado', ['Efectiva', 'Cancelada'])
      .gte('fecha_cierre', inicioHoy)
      .lte('fecha_cierre', finHoy),

    // Técnicos y supervisores (a ambos se les pueden asignar órdenes desde Despacho)
    supabase.from('perfiles').select('id_usuario, nombre').in('rol', ['Técnico', 'Supervisor']),

    // Órdenes creadas hoy. Si la columna creado_en aún no existe, esta consulta
    // devuelve error y el dashboard simplemente oculta la parte de "creadas".
    supabase
      .from('ordenes')
      .select('orden_trabajo, creado_en')
      .gte('creado_en', inicioHoy)
      .lte('creado_en', finHoy),

    // Capacidad operativa por técnico (configurable desde el dashboard)
    supabase.from('app_metadata').select('valor').eq('clave', 'capacidad_tecnico').maybeSingle(),

    // Todas las localidades que han aparecido alguna vez en el sistema (vista creada en Supabase).
    // Si la vista aún no existe, devuelve error y el panel solo muestra las que tienen órdenes activas.
    supabase.from('localidades_conocidas').select('localidad'),
  ]);

  const capacidadNum = Math.round(Number(capacidadRes.data?.valor));
  const capacidadInicial =
    Number.isFinite(capacidadNum) && capacidadNum > 0 ? capacidadNum : CAPACIDAD_POR_DEFECTO;

  return (
    <DashboardClient
      ordenesActivas={activasRes.data ?? []}
      cerradasHoy={cerradasRes.data ?? []}
      creadasHoy={creadasRes.error ? null : (creadasRes.data ?? [])}
      perfiles={perfilesRes.data ?? []}
      capacidadInicial={capacidadInicial}
      localidadesConocidas={(localidadesRes.data ?? []).map((r: { localidad: string | null }) => r.localidad ?? '')}
      hayError={Boolean(activasRes.error || cerradasRes.error || perfilesRes.error)}
    />
  );
}
