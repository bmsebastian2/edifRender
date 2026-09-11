-- Migración: agrega los estados 'reservado' y 'vendido' a units.estado.
-- Antes solo existían 'disponible' / 'sin_dato', lo que obligaba a "dar de
-- baja" una unidad vendida en vez de marcarla como tal.
-- Correr una sola vez en el SQL Editor del proyecto que ya está en uso
-- (supabase-schema.sql ya quedó actualizado para instalaciones nuevas).

alter table units drop constraint units_estado_check;
alter table units add constraint units_estado_check
  check (estado in ('disponible', 'reservado', 'vendido', 'sin_dato'));
