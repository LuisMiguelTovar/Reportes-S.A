alter table ordenes add column if not exists alerta_orden text;
alter table ordenes add column if not exists orden_relacionada text;

alter table ordenes drop constraint if exists ordenes_alerta_orden_check;
alter table ordenes add constraint ordenes_alerta_orden_check
  check (alerta_orden is null or alerta_orden in ('DOBLE', 'POSIBLE_DUPLICADA'));

create index if not exists ordenes_contrato_idx on ordenes (contrato);
