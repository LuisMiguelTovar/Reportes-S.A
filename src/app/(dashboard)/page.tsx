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
  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0).toISOString();
  const finHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59).toISOString();

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

  // ── Consulta 4: Última actualización de datos (Excel) ──
  const { data: metaUpdate } = await supabase
    .from('app_metadata')
    .select('valor')
    .eq('clave', 'ultima_carga_excel')
    .single();

  return (
    <DashboardClient
      ordenesActivas={ordenesActivas || []}
      completadasHoy={completadasHoy ?? 0}
      perfiles={perfiles || []}
      ultimaActualizacionExcel={metaUpdate?.valor ?? null}
      error={errActivas || errCount || errPerfiles}
    />
  );
}
