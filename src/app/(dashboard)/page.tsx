import { supabase } from '@/lib/supabase';
import DashboardClient from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  // ── Consulta 1: Órdenes ACTIVAS (descongelado del límite de 1000) ──
  // Solo traemos las que NO están en estado cerrado.
  const { data: ordenesActivas, error: errActivas } = await supabase
    .from('ordenes')
    .select('*')
    .not('estado', 'in', '("Efectiva","Cancelada")');

  // ── Consulta 2: Rendimiento diario (completadas HOY) ──
  // Usamos head: true para no descargar filas, solo el count.
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const dateObj: Record<string, string> = {};
  parts.forEach(({ type, value }) => { dateObj[type] = value; });

  // Formato ISO forzando el offset de Colombia (-05:00)
  const inicioHoy = `${dateObj.year}-${dateObj.month}-${dateObj.day}T00:00:00-05:00`;
  const finHoy = `${dateObj.year}-${dateObj.month}-${dateObj.day}T23:59:59-05:00`;

  const { count: completadasHoy, error: errCount } = await supabase
    .from('ordenes')
    .select('*', { count: 'exact', head: true })
    .in('estado', ['Efectiva', 'Cancelada'])
    .gte('fecha_cierre', inicioHoy)
    .lte('fecha_cierre', finHoy);

  // ── Consulta 3: Perfiles de técnicos ──
  const { data: perfiles, error: errPerfiles } = await supabase
    .from('perfiles')
    .select('id_usuario, nombre')
    .eq('rol', 'Técnico');

  return (
    <DashboardClient
      ordenesActivas={ordenesActivas || []}
      completadasHoy={completadasHoy ?? 0}
      perfiles={perfiles || []}
      error={errActivas || errCount || errPerfiles}
    />
  );
}
