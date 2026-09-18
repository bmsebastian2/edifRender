-- Migración: selector de pisos rediseñado (riel de pisos, ver index.html).
-- Puramente aditiva — un proyecto sin `tiene_pb` cargado sigue mostrando la
-- fila PB exactamente como hoy.

-- `tiene_pb`: si el edificio tiene planta baja para mostrar como fila en el
-- selector. NULL o true = se muestra (comportamiento de siempre, ningún
-- proyecto existente cambia con solo correr esta migración); false = la
-- fila PB directamente no existe. Se carga a mano en Supabase, como
-- geometria/lat/lon/norte_grados — no hay UI en admin.html todavía.
alter table projects add column if not exists tiene_pb boolean;

-- Va al final de la lista de columnas de la vista a propósito: Postgres no
-- deja insertar una columna en el medio de un CREATE OR REPLACE VIEW
-- existente, solo agregarla al final (mismo motivo que lat/lon en
-- supabase-migration-solar.sql). Recreada a partir de la versión vigente
-- (supabase-migration-avance-obra.sql, la última que tocó esta vista).
create or replace view public_projects as
select p.id, p.slug, p.nombre, p.direccion, p.ciudad, p.pais, p.entrega, p.pisos,
       p.muestra_totales, p.moneda, p.locale, p.geometria, o.nombre as desarrolla,
       p.lat, p.lon, p.fecha_ocupacion, p.avance_habilitado, p.tiene_pb
from projects p join orgs o on o.id = p.org_id
where p.publicado;

-- Mismo nivel de confianza que lat/lon (ver supabase-migration-solar.sql):
-- no es un campo sensible (slug/moneda/geometria/org_id), así que se puede
-- editar sin pasar por la RPC de plataforma.
grant update (tiene_pb) on projects to authenticated;
