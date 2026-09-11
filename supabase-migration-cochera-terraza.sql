-- Migración: agrega desglose de terraza y precio de cochera opcional a
-- `units`, y corrige la unidad 107 con datos reales del aviso público
-- (justoaca.com, setiembre 2026). Correr una sola vez en el SQL Editor del
-- proyecto que ya está en uso (supabase-schema.sql ya quedó actualizado
-- para instalaciones nuevas).

alter table units add column if not exists m2_terraza numeric;
alter table units add column if not exists cochera_precio numeric;

-- El GRANT anterior (supabase-migration-auth.sql) solo dejaba actualizar
-- `estado` desde admin.html. Estas dos columnas se editan ahora también
-- desde ahí (pestaña Unidades), así que necesitan su propio permiso.
grant update (m2_terraza, cochera_precio) on units to authenticated;

-- 40,24 m² cubiertos + 7,53 m² de terraza (antes redondeábamos a 48 m² sin
-- desglose), cochera opcional a USD 19.500, y la unidad figura reservada.
update units set m2 = 47.77, m2_terraza = 7.53, cochera_precio = 19500, estado = 'reservado'
  where id = 107;
