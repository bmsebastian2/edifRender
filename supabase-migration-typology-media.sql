-- Migración: plantas y renders reales por tipología, cargados por el
-- cliente desde admin.html — reemplaza el esquema dibujado por código
-- (plantaSVG() en index.html) que no representaba la distribución real.
--
-- La tabla `media` y las políticas de RLS para scope='typology' YA existían
-- desde la migración multi-tenant (supabase-migration-multitenant.sql,
-- secciones 2 y 10) — soportan planta/render por tipología sin cambios.
-- Lo que faltaba y agrega este archivo:
--   1) que borrar una tipología no quede bloqueado por sus unidades
--      (las desasigna en vez de fallar)
--   2) el tope de imágenes por tipología (mismo mecanismo que ya limita
--      los renders del proyecto)
--   3) que el bucket "renders" acepte PNG además de JPEG, porque una
--      planta suele ser un dibujo de líneas — a veces con transparencia —
--      y forzarla a JPEG puede verse peor que la foto que sí conviene
--      recomprimir agresivamente.
--
-- Idempotente: se puede correr varias veces.

-- ============================================================
-- 1. `units.typology_id`: borrar una tipología desasigna sus unidades en
--    vez de fallar. `media.typology_id` NO se toca acá a propósito — se
--    deja en NO ACTION (el default) para que borrar una tipología con
--    imágenes todavía cargadas falle con un error de FK en vez de dejar
--    archivos huérfanos en Storage. admin.html borra cada imagen (fila +
--    archivo) antes de borrar la tipología — ver borrarTipologia().
-- ============================================================
alter table units drop constraint if exists units_typology_id_fkey;
alter table units add constraint units_typology_id_fkey
  foreign key (typology_id) references typologies(id) on delete set null;

-- ============================================================
-- 2. Bucket "renders": mismo bucket que ya usa la galería del proyecto
--    (ver supabase-migration-media-storage.sql) — las políticas de Storage
--    ya filtran por `(storage.foldername(name))[1]::uuid` = project_id, y
--    ese primer segmento sigue siendo project_id tanto para
--    "<project_id>/<uuid>.jpg" (renders de proyecto) como para
--    "<project_id>/typology/<typology_id>/<uuid>.<ext>" (media de
--    tipología) — no hace falta ninguna política nueva.
--    Se agrega image/png a los tipos permitidos para las plantas.
-- ============================================================
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png']
where id = 'renders';

-- ============================================================
-- 3. Tope de imágenes: se extiende la misma función/trigger que ya
--    limitaba los renders del proyecto (12) para cubrir también la media
--    de tipología — plantas (3, por si hay variantes del mismo modelo) y
--    renders de tipología (12, igual que los del proyecto).
-- ============================================================
create or replace function enforce_media_limite() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max integer;
  v_actual integer;
begin
  if new.scope = 'project' and new.tipo = 'render' then
    v_max := 12;
    select count(*) into v_actual from media
      where project_id = new.project_id and scope = 'project' and tipo = 'render';
  elsif new.scope = 'typology' and new.tipo = 'planta' then
    v_max := 3;
    select count(*) into v_actual from media
      where typology_id = new.typology_id and scope = 'typology' and tipo = 'planta';
  elsif new.scope = 'typology' and new.tipo = 'render' then
    v_max := 12;
    select count(*) into v_actual from media
      where typology_id = new.typology_id and scope = 'typology' and tipo = 'render';
  else
    return new;
  end if;

  if v_actual >= v_max then
    raise exception 'Máximo % imágenes para este tipo', v_max;
  end if;
  return new;
end; $$;
-- El trigger ya existe (creado en supabase-migration-media-storage.sql) y
-- apunta a esta misma función por nombre — no hace falta recrearlo.
