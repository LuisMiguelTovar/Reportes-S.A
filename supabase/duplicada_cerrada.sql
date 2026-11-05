alter table ordenes drop constraint if exists ordenes_alerta_orden_check;
alter table ordenes add constraint ordenes_alerta_orden_check
  check (alerta_orden is null or alerta_orden in ('DOBLE', 'POSIBLE_DUPLICADA', 'DUPLICADA_CERRADA'));

notify pgrst, 'reload schema';

