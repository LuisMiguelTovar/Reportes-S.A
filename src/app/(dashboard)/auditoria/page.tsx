import { supabase } from '@/lib/supabase';
import AuditoriaClient from '@/components/AuditoriaClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AuditoriaPage() {
  const { data: ordenes, error } = await supabase
    .from('ordenes')
    .select('*')
    .neq('estado', 'Pendiente')
    .order('fecha_cierre', { ascending: false, nullsFirst: false })
    .limit(5000);

  return <AuditoriaClient initialData={ordenes || []} error={error} />;
}
