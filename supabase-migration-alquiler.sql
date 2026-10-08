-- ============================================================
-- Estado 'alquiler' y precio de alquiler en units.
--
-- Por qué: en BRUSCO hay ~34 unidades que la inmobiliaria ofrece solo en
-- alquiler (precio mensual en UYU). Hasta ahora se cargaban como
-- estado = 'sin_dato' + geom.operacion = 'alquiler' + geom.precio_alquiler_uyu,
-- y el visor las "disfrazaba" de En alquiler solo al pintarlas: el filtro, el
-- riel de pisos y el admin no sabían que eran de alquiler, y un vendedor no
-- podía marcar una unidad como alquilable.
--
-- Qué hace:
--   1. Agrega 'alquiler' al CHECK de units.estado.
--   2. Columna units.precio_alquiler numeric null: SIEMPRE UYU por mes,
--      independiente de projects.moneda. units.precio sigue siendo el de venta
--      en la moneda del proyecto. Las dos pueden convivir (venta + alquiler).
--   3. Admin de proyecto puede editar precio y precio_alquiler desde admin.html
--      (grant por columna). El vendedor sigue tocando solo estado: el trigger
--      enforce_unit_write_scope() le bloquea las dos columnas de precio.
--   4. Recrea public_units con precio_alquiler al final.
--
-- Puramente aditiva: ninguna fila cambia. ROSSO y Altamira no tienen unidades
-- en 'alquiler' ni precio_alquiler, así que se ven exactamente igual.
-- geom.precio_alquiler_uyu queda en los datos de BRUSCO hasta que
-- supabase-brusco-alquiler.sql pase las unidades al estado nuevo.
--
-- Idempotente: se puede volver a correr sin efecto adicional.
-- Correr DESPUÉS de grants-explicitos (es la última del orden histórico).
-- ============================================================

begin;

-- 1. Estado nuevo -------------------------------------------------------------
alter table units drop constraint if exists units_estado_check;
alter table units add constraint units_estado_check
  check (estado in ('disponible', 'reservado', 'vendido', 'sin_dato', 'alquiler'));

-- 2. Precio de alquiler (UYU por mes) ----------------------------------------
alter table units add column if not exists precio_alquiler numeric;
comment on column units.precio_alquiler is
  'Precio de alquiler mensual en UYU (siempre UYU, sin importar projects.moneda). null = no se alquila o sin dato.';

alter table units drop constraint if exists units_precio_alquiler_check;
alter table units add constraint units_precio_alquiler_check
  check (precio_alquiler is null or precio_alquiler > 0);

-- 3. Permisos de escritura ---------------------------------------------------
-- Mismo esquema que multitenant: el GRANT por columna abre la columna a
-- `authenticated` (incluye plataforma y admin de proyecto) y el trigger
-- recorta lo que puede el vendedor. Se agregan precio y precio_alquiler a la
-- lista de columnas que el vendedor no puede tocar.
create or replace function enforce_unit_write_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if es_admin_plataforma() or es_admin_proyecto(new.project_id) then
    return new;
  elsif es_miembro(new.project_id) then
    if new.m2_terraza is distinct from old.m2_terraza
       or new.cochera_precio is distinct from old.cochera_precio
       or new.typology_id is distinct from old.typology_id
       or new.precio is distinct from old.precio
       or new.precio_alquiler is distinct from old.precio_alquiler then
      raise exception 'vendedor solo puede modificar estado';
    end if;
    return new;
  else
    -- no debería llegar acá: la policy de RLS ya filtró la fila antes.
    raise exception 'sin permiso sobre esta unidad';
  end if;
end; $$;

grant update (precio, precio_alquiler) on units to authenticated;

-- 4. Vista pública -----------------------------------------------------------
-- Copia de la última versión (multitenant) + precio_alquiler al final.
create or replace view public_units as
select u.project_id, u.id, u.piso, u.pos, u.col, u.frente, u.dorms, u.m2, u.orientacion,
       u.precio, u.estimado, u.estado, u.m2_terraza, u.cochera_precio, u.typology_id, u.geom,
       u.precio_alquiler
from units u join projects p on p.id = u.project_id
where p.publicado;

grant select on public_units to anon, authenticated; -- ya estaba, queda explícito tras el replace

commit;

-- Chequeos (correr aparte después):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'units_estado_check';
-- select column_name from information_schema.columns
--   where table_name = 'public_units' order by ordinal_position desc limit 1;   -- precio_alquiler
-- select column_name, privilege_type from information_schema.column_privileges
--   where grantee = 'authenticated' and table_name = 'units' and privilege_type = 'UPDATE';
