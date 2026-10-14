-- ============================================================
-- typologies.nombre_publico: el nombre de la tipología que ve el comprador.
--
-- Por qué dos nombres: typologies.nombre es el rótulo interno con el que el
-- admin distingue plantas. En Altamira "MONO-A" y "MONO-B" son dos plantas
-- distintas que para el comprador son las dos "Monoambiente"; mostrar
-- `nombre` en el visor cambiaba "1 dormitorio" por "1D-frente-A".
-- nombre_publico es lo que se le muestra al comprador, y es opcional.
--
-- Qué hace:
--   1. Columna typologies.nombre_publico text null. Vacío = null (el CHECK
--      no deja guardar un texto en blanco; el admin manda null).
--   2. Recrea public_typologies con nombre_publico al final (create or
--      replace view solo permite agregar columnas al final).
--
-- El visor y la vista previa al compartir muestran, en este orden:
-- nombre_publico de la tipología asignada → geom.tipologia de la unidad →
-- los dormitorios. Puramente aditiva: ninguna fila cambia y, sin
-- nombre_publico cargado, los tres proyectos se ven exactamente igual.
--
-- Escritura: el admin de proyecto la edita desde la pestaña Tipologías con
-- lo que ya existe (grant de tabla de supabase-migration-grants-explicitos.sql
-- + policy typologies_admin_escribe). No hace falta grant nuevo.
--
-- Idempotente. Correr después de supabase-migration-alquiler.sql.
-- ============================================================

alter table typologies add column if not exists nombre_publico text;

comment on column typologies.nombre_publico is
  'Nombre de la tipología que ve el comprador (visor y vista previa al compartir). null = geom.tipologia de la unidad o sus dormitorios. typologies.nombre es el rótulo interno del admin.';

alter table typologies drop constraint if exists typologies_nombre_publico_check;
alter table typologies add constraint typologies_nombre_publico_check
  check (nombre_publico is null or btrim(nombre_publico) <> '');

-- Copia de la versión de supabase-migration-multitenant.sql + nombre_publico al final.
create or replace view public_typologies as
select t.id, t.project_id, t.nombre, t.dorms, t.m2, t.orientacion, t.precio_base, t.nombre_publico
from typologies t join projects p on p.id = t.project_id
where p.publicado;

-- Control:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'public_typologies';
--   → id, project_id, nombre, dorms, m2, orientacion, precio_base, nombre_publico
