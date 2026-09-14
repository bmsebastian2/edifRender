-- Migración: bucket de Storage para las imágenes que muestra la galería de
-- "Ver renders" (tabla `media`, scope='project', tipo='render'). La tabla
-- `media` ya existía desde la migración multi-tenant, pero no había dónde
-- alojar los archivos en sí — esto agrega el bucket público y las políticas
-- de escritura. Correr una sola vez en el SQL Editor del proyecto.

-- file_size_limit es el límite REAL del lado del servidor — admin.html ya
-- comprime a ~2000px/JPEG antes de subir (así que en la práctica cada
-- archivo pesa poco), pero esto es lo que protege el bucket si alguien
-- pega el request directo sin pasar por ese paso. allowed_mime_types solo
-- jpeg porque admin.html siempre re-codifica a JPEG al comprimir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('renders', 'renders', true, 8388608, array['image/jpeg'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Cada archivo se sube a "<project_id>/<nombre-random>.<ext>" desde
-- admin.html, así que el primer segmento de la ruta ES el project_id —
-- mismo criterio que ya usan las políticas de `media` para decidir quién
-- administra qué (ver supabase-migration-multitenant.sql, sección 6/10).
-- La lectura es pública porque el bucket es público (Supabase sirve esa
-- URL directo, sin pasar por RLS); estas políticas solo gobiernan quién
-- puede subir/reemplazar/borrar archivos.
drop policy if exists "renders_insert_admin" on storage.objects;
create policy "renders_insert_admin" on storage.objects
  for insert with check (
    bucket_id = 'renders'
    and (es_admin_plataforma() or es_admin_proyecto((storage.foldername(name))[1]::uuid))
  );

drop policy if exists "renders_update_admin" on storage.objects;
create policy "renders_update_admin" on storage.objects
  for update using (
    bucket_id = 'renders'
    and (es_admin_plataforma() or es_admin_proyecto((storage.foldername(name))[1]::uuid))
  );

drop policy if exists "renders_delete_admin" on storage.objects;
create policy "renders_delete_admin" on storage.objects
  for delete using (
    bucket_id = 'renders'
    and (es_admin_plataforma() or es_admin_proyecto((storage.foldername(name))[1]::uuid))
  );

-- Tope de cantidad de imágenes por proyecto. admin.html ya chequea esto
-- antes de subir (para poder avisar sin gastar el upload a Storage), pero
-- el trigger es la garantía real: cubre condiciones de carrera (dos subidas
-- casi al mismo tiempo) y cualquier insert que no pase por admin.html.
create or replace function enforce_media_limite() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max constant integer := 12;
  v_actual integer;
begin
  if new.scope = 'project' and new.tipo = 'render' then
    select count(*) into v_actual from media
      where project_id = new.project_id and scope = 'project' and tipo = 'render';
    if v_actual >= v_max then
      raise exception 'Máximo % imágenes de render por proyecto', v_max;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists media_limite on media;
create trigger media_limite before insert on media
  for each row execute function enforce_media_limite();
