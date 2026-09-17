-- Migración: avance de obra — hitos con fecha estimada/real, fotos con
-- fecha agrupadas por mes, y el toggle que decide si el proyecto publica
-- esta sección. Ver el hilo de diseño en el chat (2026-09-16) para el
-- porqué de cada decisión — resumen abajo en cada bloque.
--
-- ORDEN: correr supabase-migration-financiacion.sql ANTES que este archivo
-- (ver el porqué en la sección 3, la vista public_projects). lista-espera
-- no toca public_projects, así que puede ir antes o después de cualquiera
-- de los dos.
--
-- Idempotente: se puede correr varias veces.

-- ============================================================
-- 1. Tablas nuevas.
-- ============================================================

-- `categoria` es un enum chico y estable (no el nombre del hito, que es
-- libre) porque el modelo 3D necesita saber CUÁLES hitos representan "este
-- piso ya existe" sin adivinar por el texto de `nombre`. Un desarrollador
-- que nunca marca ningún hito como 'estructura' simplemente no obtiene la
-- vinculación 3D — el resto de la sección (fechas, fotos, %) funciona igual.
-- `piso` es null para hitos globales (excavación, entrega) y no-null para
-- hitos de un piso puntual (ej. "Estructura piso 4").
-- `peso` pondera el % de avance; default 1 = todos los hitos cuentan igual
-- si el desarrollador no toca nada.
create table if not exists obra_hitos (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id),
  nombre          text not null check (char_length(nombre) between 1 and 200),
  categoria       text not null default 'general' check (categoria in ('general', 'estructura')),
  piso            integer,
  peso            numeric not null default 1 check (peso > 0),
  orden           integer not null default 0,
  fecha_estimada  date,
  fecha_real      date,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references auth.users(id)
);
create index if not exists obra_hitos_project_idx on obra_hitos (project_id, orden);

-- `fecha` es la fecha de la foto (EXIF si admin.html pudo leerlo, si no la
-- fecha de carga) — es lo que agrupa la galería por mes, no `subida_en`.
create table if not exists obra_fotos (
  id          bigserial primary key,
  project_id  uuid not null references projects(id),
  url         text not null,
  fecha       date not null default current_date,
  orden       integer not null default 0,
  subida_en   timestamptz not null default now(),
  subida_por  uuid references auth.users(id)
);
create index if not exists obra_fotos_project_idx on obra_fotos (project_id, fecha);

-- Toggle de proyecto: apagado por default — un desarrollador que no carga
-- nada, o que no quiere mostrar un atraso, no publica nada nuevo sin querer.
-- Mismo nivel que nombre/direccion/ciudad/entrega (campo de "vitrina" que
-- administra el admin de proyecto, no plataforma) — ver grants en 6.
alter table projects add column if not exists avance_habilitado boolean not null default false;

-- ============================================================
-- 2. Auditoría — mismo criterio que units_audit: lo que manda el cliente en
-- actualizado_por/subida_por nunca se respeta, lo pisa el trigger con
-- auth.uid(). obra_hitos audita alta Y edición (fecha_real se completa mes
-- a mes sobre la misma fila); obra_fotos solo alta, porque tocar `fecha` a
-- mano después de subida no es "esta foto es nueva", es una corrección.
-- ============================================================
create or replace function set_hito_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end; $$;

drop trigger if exists obra_hitos_audit on obra_hitos;
create trigger obra_hitos_audit before insert or update on obra_hitos
  for each row execute function set_hito_audit();

create or replace function set_foto_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.subida_en := now();
  new.subida_por := auth.uid();
  return new;
end; $$;

drop trigger if exists obra_fotos_audit on obra_fotos;
create trigger obra_fotos_audit before insert on obra_fotos
  for each row execute function set_foto_audit();

-- ============================================================
-- 3. Vistas públicas — único camino de lectura para `anon`, igual que el
-- resto de las tablas de projects (ver supabase-migration-multitenant.sql).
-- Filtran por `p.publicado and p.avance_habilitado`: si el desarrollador
-- apaga el toggle, estas vistas quedan vacías sin tocar RLS ni borrar nada.
--
-- REQUIERE correr supabase-migration-financiacion.sql ANTES que este
-- archivo: Postgres no deja sacar columnas de una vista con `create or
-- replace view` (error 42P16), solo agregar al final — así que esta
-- redefinición de public_projects tiene que incluir TODAS las columnas que
-- ya le sumaron las migraciones anteriores (lat/lon de -solar, fecha_ocupacion
-- de -financiacion), en el mismo orden en que se agregaron, y recién
-- después appendear avance_habilitado. Si esto vuelve a explotar con
-- "cannot drop columns from view", es que se corrió fuera de orden o falta
-- correr alguna migración previa.
-- ============================================================
create or replace view public_projects as
select p.id, p.slug, p.nombre, p.direccion, p.ciudad, p.pais, p.entrega, p.pisos,
       p.muestra_totales, p.moneda, p.locale, p.geometria, o.nombre as desarrolla,
       p.lat, p.lon, p.fecha_ocupacion, p.avance_habilitado
from projects p join orgs o on o.id = p.org_id
where p.publicado;

create or replace view public_obra_hitos as
select h.id, h.project_id, h.nombre, h.categoria, h.piso, h.peso, h.orden,
       h.fecha_estimada, h.fecha_real, h.actualizado_en
from obra_hitos h join projects p on p.id = h.project_id
where p.publicado and p.avance_habilitado;

create or replace view public_obra_fotos as
select f.id, f.project_id, f.url, f.fecha, f.orden, f.subida_en
from obra_fotos f join projects p on p.id = f.project_id
where p.publicado and p.avance_habilitado;

-- ============================================================
-- 4. RLS.
-- ============================================================
alter table obra_hitos enable row level security;
alter table obra_fotos enable row level security;

-- Cualquier miembro (vendedor o admin) carga hitos y fotos — es trabajo de
-- rutina desde el celular en la obra, no una decisión de admin (a diferencia
-- de `media`, que sí es solo admin de proyecto porque son plantas/renders
-- curados). Lo que SÍ es de admin es el toggle `avance_habilitado` (sección
-- 6): decidir si esto se publica es una decisión de negocio, cargar el
-- avance del mes no.
drop policy if exists "obra_hitos_miembro" on obra_hitos;
create policy "obra_hitos_miembro" on obra_hitos
  for all using (es_miembro(project_id) or es_admin_plataforma())
  with check (es_miembro(project_id) or es_admin_plataforma());

drop policy if exists "obra_fotos_miembro" on obra_fotos;
create policy "obra_fotos_miembro" on obra_fotos
  for all using (es_miembro(project_id) or es_admin_plataforma())
  with check (es_miembro(project_id) or es_admin_plataforma());

-- ============================================================
-- 5. Storage: mismo bucket "renders" que ya usan proyecto y tipologías
-- (ver supabase-migration-media-storage.sql / -typology-media.sql), prefijo
-- nuevo "<project_id>/obra/<uuid>.<ext>". Las políticas de Storage ya
-- existentes solo miran el primer segmento de la ruta (= project_id), así
-- que cubren este prefijo sin cambios — no hace falta bucket ni política
-- nueva. Mismo tope de mime types que ya tiene el bucket (jpeg/png).
-- ============================================================

-- ============================================================
-- 6. Grants. anon solo lee las vistas; obra_hitos/obra_fotos nunca directo.
-- avance_habilitado se suma al mismo grant de columnas "de vitrina" de
-- projects que ya usa nombre/direccion/ciudad/entrega — la RLS de
-- projects_update (es_admin_proyecto or es_admin_plataforma) es la que de
-- verdad decide quién puede prenderlo, esto solo habilita la columna.
-- ============================================================
revoke all on obra_hitos, obra_fotos from anon;
grant select on public_obra_hitos, public_obra_fotos to anon;
grant select on public_projects to anon; -- ya estaba, queda explícito tras el replace de la vista

revoke update on projects from anon, authenticated;
grant update (nombre, direccion, ciudad, entrega, avance_habilitado) on projects to authenticated;
