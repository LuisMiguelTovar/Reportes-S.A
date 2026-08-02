import { supabase } from '@/lib/supabase';
import DashboardClient from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  // Calcular el rango de "hoy" (Colombia) ANTES de lanzar las consultas,
  // ya que no depende de ninguna de ellas.
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const dateObj: Record<string, string> = {};
  parts.forEach(({ type, value }) => { dateObj[type] = value; });

  const inicioHoy = `${dateObj.year}-${dateObj.month}-${dateObj.day}T00:00:00-05:00`;
  const finHoy = `${dateObj.year}-${dateObj.month}-${dateObj.day}T23:59:59-05:00`;

  // Las tres consultas son independientes entre sí — se lanzan en paralelo.
  const [
    { data: ordenesActivas, error: errActivas },
    { count: completadasHoy, error: errCount },
    { data: perfiles, error: errPerfiles },
  ] = await Promise.all([
    supabase
      .from('ordenes')
      .select('orden_trabajo, estado, localidad, id_tecnico_asignado, contrato, fecha_asignacion_ot')
      .not('estado', 'in', '("Efectiva","Cancelada")'),
    supabase
      .from('ordenes')
      .select('*', { count: 'exact', head: true })
      .in('estado', ['Efectiva', 'Cancelada'])
      .gte('fecha_cierre', inicioHoy)
      .lte('fecha_cierre', finHoy),
    supabase
      .from('perfiles')
      .select('id_usuario, nombre')
      .eq('rol', 'Técnico'),
  ]);

  return (
    <DashboardClient
      ordenesActivas={ordenesActivas || []}
      completadasHoy={completadasHoy ?? 0}
      perfiles={perfiles || []}
      error={errActivas || errCount || errPerfiles}
    />
  );
}
