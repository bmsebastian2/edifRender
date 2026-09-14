-- Migración: single-tenant (un edificio por proyecto Supabase) → multi-tenant
-- (varios edificios de varios clientes en una sola base).
--
-- Idempotente: se puede correr varias veces sin duplicar filas ni romper si
-- se cortó a mitad de camino. No borra datos existentes.
--
-- ANTES DE CORRER ESTO: hacé un backup (ver instrucciones en el chat / README).
-- Este script NO reemplaza ese paso.
--
-- Orden: 0) extensión  1) tablas de referencia  2) tablas nuevas
-- 3) columnas nuevas en tablas existentes  4) backfill de datos
-- 5) constraints/índices finales  6) funciones helper  7) triggers
-- 8) RPC de plataforma  9) vistas públicas  10) RLS + policies  11) grants.

-- ============================================================
-- 0. Extensión (gen_random_uuid) — normalmente ya está en Supabase.
-- ============================================================
create extension if not exists pgcrypto;

-- ============================================================
-- 1. Tablas de referencia — agregar un país/moneda es un insert,
--    no una migración (pedido explícito: nada de check hardcodeado).
-- ============================================================
create table if not exists paises (
  codigo  text primary key,
  nombre  text not null
);
insert into paises (codigo, nombre) values
  ('UY', 'Uruguay'), ('NI', 'Nicaragua')
on conflict (codigo) do nothing;

create table if not exists monedas (
  codigo      text primary key,
  nombre      text not null,
  decimales   integer not null default 2
);
insert into monedas (codigo, nombre, decimales) values
  ('USD', 'Dólar estadounidense', 2),
  ('UYU', 'Peso uruguayo', 2),
  ('NIO', 'Córdoba nicaragüense', 2)
on conflict (codigo) do nothing;

alter table paises enable row level security;
alter table monedas enable row level security;

-- ============================================================
-- 2. Entidades nuevas del multi-tenant.
-- ============================================================
create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  slug        text not null unique,
  pais        text not null references paises(codigo),
  creado_en   timestamptz not null default now()
);

create table if not exists projects (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id),
  slug              text not null unique,          -- resuelve la URL (?p=<slug>)
  nombre            text not null,
  direccion         text,
  ciudad            text,
  pais              text not null references paises(codigo),
  entrega           text,                          -- copy libre ("marzo 2028"), no una fecha operable
  pisos             integer not null,
  publicado         boolean not null default false,
  muestra_totales   boolean not null default true,
  moneda            text not null references monedas(codigo),
  locale            text not null default 'es-UY',
  geometria         jsonb not null default '{}',   -- forma de la placa (losa/núcleo); vacío = defaults de ROSSO
  creado_en         timestamptz not null default now()
);

create table if not exists memberships (
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  rol          text not null check (rol in ('admin', 'vendedor')),
  primary key (user_id, project_id)
);
create index if not exists memberships_user_idx on memberships (user_id);

create table if not exists plataforma_admins (
  user_id   uuid primary key references auth.users(id) on delete cascade
);

create table if not exists typologies (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id),
  nombre        text not null,
  dorms         integer not null,
  m2            numeric not null,
  orientacion   text,
  precio_base   numeric,
  unique (project_id, nombre)
);

create table if not exists media (
  id            bigserial primary key,
  project_id    uuid references projects(id),
  typology_id   uuid references typologies(id),
  scope         text not null check (scope in ('typology', 'project')),
  tipo          text not null check (tipo in ('planta', 'render')),
  url           text not null,
  orden         integer not null default 0,
  constraint media_scope_ref check (
    (scope = 'typology' and typology_id is not null and project_id is null)
    or
    (scope = 'project'  and project_id  is not null and typology_id is null)
  )
);
create index if not exists media_typology_idx on media (typology_id);
create index if not exists media_project_idx on media (project_id);

create table if not exists amenities (
  id           bigserial primary key,
  project_id   uuid not null references projects(id),
  texto        text not null,
  orden        integer not null default 0,
  activo       boolean not null default true
);
create index if not exists amenities_project_orden_idx on amenities (project_id, orden);

create table if not exists leads (
  id          bigserial primary key,
  project_id  uuid not null references projects(id),
  unit_id     integer,
  nombre      text not null check (char_length(nombre) between 1 and 200),
  contacto    text not null check (char_length(contacto) between 1 and 200),
  mensaje     text check (mensaje is null or char_length(mensaje) <= 2000),
  origen      text check (origen is null or origen ~ '^[a-z0-9_-]{1,40}$'),
  creado_en   timestamptz not null default now(),
  estado      text not null default 'nuevo' check (estado in ('nuevo', 'contactado', 'descartado'))
);
create index if not exists leads_project_idx on leads (project_id, creado_en desc);

-- ============================================================
-- 3. Columnas nuevas en las tablas que ya existían.
-- ============================================================
alter table units add column if not exists project_id uuid references projects(id);
alter table units add column if not exists typology_id uuid references typologies(id);
alter table units add column if not exists updated_at timestamptz not null default now();
alter table units add column if not exists updated_by uuid references auth.users(id);

alter table events add column if not exists project_id uuid references projects(id);
alter table events add column if not exists sesion uuid;
alter table events add column if not exists origen text
  check (origen is null or origen ~ '^[a-z0-9_-]{1,40}$');

alter table settings add column if not exists project_id uuid references projects(id);
alter table settings add column if not exists whatsapp text not null default '';
alter table settings add column if not exists textos jsonb not null default '{}';

-- ============================================================
-- 4. Backfill: crea ROSSO como el primer org/project y rellena
--    project_id en todas las filas existentes. No hace nada si
--    ya se corrió antes (slugs únicos + filtros "where ... is null").
-- ============================================================
do $$
declare
  v_org_id     uuid;
  v_project_id uuid;
begin
  insert into orgs (nombre, slug, pais)
  values ('Block Desarrollos', 'block', 'UY')
  on conflict (slug) do nothing;

  select id into v_org_id from orgs where slug = 'block';

  insert into projects (
    org_id, slug, nombre, direccion, ciudad, pais, entrega, pisos,
    publicado, muestra_totales, moneda, locale
  ) values (
    v_org_id, 'rosso', 'ROSSO by Block',
    'Ana Monterroso de Lavalleja 2162, Cordón', 'Montevideo', 'UY',
    'marzo 2028', 10, true, true, 'USD', 'es-UY'
  )
  on conflict (slug) do nothing;

  select id into v_project_id from projects where slug = 'rosso';

  update units    set project_id = v_project_id where project_id is null;
  update events   set project_id = v_project_id where project_id is null;
  update settings set project_id = v_project_id where project_id is null and id = 1;

  -- Eventos históricos no tenían sesión de cliente: les asignamos una
  -- sintética (una por fila) para no dejar la columna en null antes del
  -- not null de más abajo. No afecta el conteo de sesiones futuro.
  update events set sesion = gen_random_uuid() where sesion is null;

  update settings set whatsapp = '59891856500'
    where project_id = v_project_id and coalesce(whatsapp, '') = '';

  -- Texto legal que index.html tenía hardcodeado junto a los amenities
  -- (específico de Uruguay — otro país necesita otro texto o ninguno).
  update settings set textos = jsonb_set(textos, '{legal}', to_jsonb(
      'Amparado por la Ley de Vivienda Promovida (18.795): exonera ITP, IVA e Impuesto al ' ||
      'Patrimonio (10 años), y hasta 100% de IRPF/IRAE (10 años). Desarrolla Block Desarrollos · ' ||
      '39 cocheras en el edificio · a pasos de Tres Cruces, Parque Batlle y 18 de Julio.'
    ))
    where project_id = v_project_id and not (textos ? 'legal');

  if not exists (select 1 from amenities where project_id = v_project_id) then
    insert into amenities (project_id, texto, orden, activo) values
      (v_project_id, 'SUM con parrillero y barbacoa abierta', 1, true),
      (v_project_id, 'Gimnasio con espacio para yoga', 2, true),
      (v_project_id, 'Terraza pergolada en el piso 10 con vista al skyline', 3, true),
      (v_project_id, 'Racks para bicicletas y lavandería con app', 4, true),
      (v_project_id, 'WiFi gratuito en áreas comunes', 5, true),
      (v_project_id, 'Infraestructura para vehículos eléctricos', 6, true),
      (v_project_id, 'CCTV y cerradura electrónica', 7, true);
  end if;

  -- Tu membresía de plataforma. Busca por email en auth.users: si todavía
  -- no creaste ese usuario en Authentication → Users, esto no inserta nada
  -- (0 filas, sin error) — creá el usuario y volvé a correr solo este bloque.
  insert into plataforma_admins (user_id)
  select id from auth.users where email = 'bmsebastian2@gmail.com'
  on conflict do nothing;
end $$;

-- ============================================================
-- 5. Constraints y PKs finales — recién ahora que todo tiene
--    project_id relleno.
-- ============================================================
alter table units    alter column project_id set not null;
alter table events   alter column project_id set not null;
alter table events   alter column sesion set not null;
alter table settings alter column project_id set not null;

-- La FK vieja de events depende del índice de units_pkey, así que hay que
-- soltarla ANTES de poder tocar la PK de units (si no, Postgres tira
-- "cannot drop constraint ... because other objects depend on it").
alter table events drop constraint if exists events_unit_id_fkey;
alter table events drop constraint if exists events_project_unit_fkey;

alter table units drop constraint if exists units_pkey;
alter table units add constraint units_pkey primary key (project_id, id);

alter table events add constraint events_project_unit_fkey
  foreign key (project_id, unit_id) references units (project_id, id) on delete cascade;
create index if not exists events_sesion_idx on events (project_id, sesion);

alter table settings drop constraint if exists settings_pkey;
alter table settings drop constraint if exists settings_fila_unica;
alter table settings add constraint settings_pkey primary key (project_id);
alter table settings drop column if exists id;

-- ============================================================
-- 6. Funciones helper (security definer, search_path fijo) —
--    evitan que las policies consulten memberships/projects
--    directamente y disparen su propia RLS de forma recursiva.
-- ============================================================
create or replace function es_admin_plataforma()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from plataforma_admins pa where pa.user_id = auth.uid());
$$;

create or replace function es_miembro(p_project_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from memberships m
    where m.project_id = p_project_id and m.user_id = auth.uid()
  );
$$;

create or replace function es_admin_proyecto(p_project_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from memberships m
    where m.project_id = p_project_id and m.user_id = auth.uid() and m.rol = 'admin'
  );
$$;

create or replace function proyecto_publicado(p_project_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from projects p where p.id = p_project_id and p.publicado);
$$;

create or replace function unidad_pertenece(p_project_id uuid, p_unit_id integer)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from units u where u.project_id = p_project_id and u.id = p_unit_id);
$$;

-- admin.html necesita mostrar quién modificó cada unidad (updated_by es un
-- uuid de auth.users, que el cliente no puede leer directo). Esta función
-- resuelve email solo para las membresías DEL proyecto que el que llama
-- puede ver — nunca expone auth.users entero.
create or replace function miembros_proyecto(p_project_id uuid)
returns table(user_id uuid, email text, rol text)
language sql security definer set search_path = public stable as $$
  select m.user_id, u.email, m.rol
  from memberships m
  join auth.users u on u.id = m.user_id
  where m.project_id = p_project_id
    and (es_miembro(p_project_id) or es_admin_plataforma());
$$;

revoke execute on function es_admin_plataforma() from public;
revoke execute on function es_miembro(uuid) from public;
revoke execute on function es_admin_proyecto(uuid) from public;
revoke execute on function proyecto_publicado(uuid) from public;
revoke execute on function unidad_pertenece(uuid, integer) from public;
revoke execute on function miembros_proyecto(uuid) from public;

grant execute on function es_admin_plataforma() to authenticated;
grant execute on function es_miembro(uuid) to authenticated;
grant execute on function es_admin_proyecto(uuid) to authenticated;
grant execute on function proyecto_publicado(uuid) to anon, authenticated;
grant execute on function unidad_pertenece(uuid, integer) to anon, authenticated;
grant execute on function miembros_proyecto(uuid) to authenticated;

-- ============================================================
-- 7. Triggers sobre `units`:
--    - auditoría real: updated_at/updated_by los pisa el trigger,
--      nunca lo que mande el cliente en el payload.
--    - separación admin/vendedor: un vendedor (miembro sin rol
--      'admin') solo puede tocar `estado`; precio, m2_terraza,
--      cochera_precio y typology_id quedan para admin de proyecto
--      o de plataforma. Esto no se puede resolver con GRANT de
--      columnas porque ambos roles son el mismo rol de Postgres
--      (`authenticated`) — el trigger compara OLD vs NEW por fila.
-- ============================================================
create or replace function set_unit_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;

drop trigger if exists units_audit on units;
create trigger units_audit before update on units
  for each row execute function set_unit_audit();

create or replace function enforce_unit_write_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if es_admin_plataforma() or es_admin_proyecto(new.project_id) then
    return new;
  elsif es_miembro(new.project_id) then
    if new.m2_terraza is distinct from old.m2_terraza
       or new.cochera_precio is distinct from old.cochera_precio
       or new.typology_id is distinct from old.typology_id then
      raise exception 'vendedor solo puede modificar estado';
    end if;
    return new;
  else
    -- no debería llegar acá: la policy de RLS ya filtró la fila antes.
    raise exception 'sin permiso sobre esta unidad';
  end if;
end; $$;

drop trigger if exists units_write_scope on units;
create trigger units_write_scope before update on units
  for each row execute function enforce_unit_write_scope();

-- ============================================================
-- 8. RPC de plataforma para los campos sensibles de `projects`
--    (slug, publicado, moneda, locale, geometria, org_id).
--    No se puede resolver con GRANT de columnas por la misma
--    razón que en `units`: admin de plataforma también es el rol
--    `authenticated`, así que un GRANT UPDATE (columnas de vitrina)
--    para ese rol le bloquearía a plataforma esas mismas columnas.
--    La función corre con privilegios propios (security definer)
--    y valida el permiso adentro, no vía GRANT de la tabla.
-- ============================================================
create or replace function plataforma_actualizar_proyecto(
  p_id          uuid,
  p_slug        text default null,
  p_publicado   boolean default null,
  p_moneda      text default null,
  p_locale      text default null,
  p_geometria   jsonb default null,
  p_org_id      uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin_plataforma() then
    raise exception 'solo plataforma puede modificar estos campos';
  end if;
  update projects set
    slug      = coalesce(p_slug, slug),
    publicado = coalesce(p_publicado, publicado),
    moneda    = coalesce(p_moneda, moneda),
    locale    = coalesce(p_locale, locale),
    geometria = coalesce(p_geometria, geometria),
    org_id    = coalesce(p_org_id, org_id)
  where id = p_id;
end; $$;

revoke execute on function plataforma_actualizar_proyecto(uuid, text, boolean, text, text, jsonb, uuid) from public;
grant execute on function plataforma_actualizar_proyecto(uuid, text, boolean, text, text, jsonb, uuid) to authenticated;

-- ============================================================
-- 9. Vistas públicas — único camino de lectura para `anon`.
--    Corren con privilegios del dueño de la vista, así que
--    pueden leer las tablas base aunque a `anon` se le revoquen
--    todos los permisos sobre ellas (sección 11). El filtro real
--    de seguridad es el `where p.publicado` de cada vista, no un
--    permiso heredado. Curan también qué columnas son públicas.
-- ============================================================
create or replace view public_projects as
select p.id, p.slug, p.nombre, p.direccion, p.ciudad, p.pais, p.entrega, p.pisos,
       p.muestra_totales, p.moneda, p.locale, p.geometria, o.nombre as desarrolla
from projects p join orgs o on o.id = p.org_id
where p.publicado;

create or replace view public_units as
select u.project_id, u.id, u.piso, u.pos, u.col, u.frente, u.dorms, u.m2, u.orientacion,
       u.precio, u.estimado, u.estado, u.m2_terraza, u.cochera_precio, u.typology_id
from units u join projects p on p.id = u.project_id
where p.publicado;

create or replace view public_settings as
select s.project_id, s.instagram, s.youtube, s.sitio_web, s.whatsapp, s.textos
from settings s join projects p on p.id = s.project_id
where p.publicado;

create or replace view public_amenities as
select a.project_id, a.texto, a.orden
from amenities a join projects p on p.id = a.project_id
where p.publicado and a.activo
order by a.orden;

create or replace view public_typologies as
select t.id, t.project_id, t.nombre, t.dorms, t.m2, t.orientacion, t.precio_base
from typologies t join projects p on p.id = t.project_id
where p.publicado;

create or replace view public_media as
select m.id, coalesce(m.project_id, t.project_id) as project_id, m.typology_id, m.scope, m.tipo, m.url, m.orden
from media m
left join typologies t on t.id = m.typology_id
join projects p on p.id = coalesce(m.project_id, t.project_id)
where p.publicado;
-- (sin public_leads a propósito: leads nunca es legible por anon)

-- ============================================================
-- 10. RLS + policies.
-- ============================================================
alter table orgs             enable row level security;
alter table projects         enable row level security;
alter table memberships      enable row level security;
alter table plataforma_admins enable row level security;
alter table units            enable row level security;
alter table events           enable row level security;
alter table settings         enable row level security;
alter table amenities        enable row level security;
alter table typologies       enable row level security;
alter table media            enable row level security;
alter table leads            enable row level security;

-- Policies single-tenant que quedan reemplazadas por las de abajo.
drop policy if exists "units_select_publico" on units;
drop policy if exists "units_update_estado" on units;
drop policy if exists "events_insert_publico" on events;
drop policy if exists "events_select_publico" on events;
drop policy if exists "settings_select_publico" on settings;
drop policy if exists "settings_update_auth" on settings;

-- paises / monedas: referencia sin datos sensibles — lectura para cualquiera
-- (incluido anon, para listas del panel más adelante), escritura solo plataforma.
drop policy if exists "paises_lee_todos" on paises;
create policy "paises_lee_todos" on paises for select using (true);
drop policy if exists "paises_escribe_plataforma" on paises;
create policy "paises_escribe_plataforma" on paises
  for all using (es_admin_plataforma()) with check (es_admin_plataforma());

drop policy if exists "monedas_lee_todos" on monedas;
create policy "monedas_lee_todos" on monedas for select using (true);
drop policy if exists "monedas_escribe_plataforma" on monedas;
create policy "monedas_escribe_plataforma" on monedas
  for all using (es_admin_plataforma()) with check (es_admin_plataforma());

-- orgs / plataforma_admins: solo plataforma, nunca el cliente ni anon.
drop policy if exists "orgs_plataforma" on orgs;
create policy "orgs_plataforma" on orgs
  for all using (es_admin_plataforma()) with check (es_admin_plataforma());

drop policy if exists "plataforma_admins_plataforma" on plataforma_admins;
create policy "plataforma_admins_plataforma" on plataforma_admins
  for all using (es_admin_plataforma()) with check (es_admin_plataforma());

-- memberships: cada usuario ve su propia fila; solo plataforma escribe.
drop policy if exists "memberships_select" on memberships;
create policy "memberships_select" on memberships
  for select using (user_id = auth.uid() or es_admin_plataforma());

drop policy if exists "memberships_insert" on memberships;
create policy "memberships_insert" on memberships
  for insert with check (es_admin_plataforma());

drop policy if exists "memberships_update" on memberships;
create policy "memberships_update" on memberships
  for update using (es_admin_plataforma()) with check (es_admin_plataforma());

drop policy if exists "memberships_delete" on memberships;
create policy "memberships_delete" on memberships
  for delete using (es_admin_plataforma());

-- projects: alta/baja y campos sensibles son de plataforma; el admin de
-- proyecto solo edita los campos de vitrina (grant de columnas, sección 11).
drop policy if exists "projects_select" on projects;
create policy "projects_select" on projects
  for select using (es_miembro(id) or es_admin_plataforma());

drop policy if exists "projects_insert" on projects;
create policy "projects_insert" on projects
  for insert with check (es_admin_plataforma());

drop policy if exists "projects_update" on projects;
create policy "projects_update" on projects
  for update using (es_admin_proyecto(id) or es_admin_plataforma())
  with check (es_admin_proyecto(id) or es_admin_plataforma());

drop policy if exists "projects_delete" on projects;
create policy "projects_delete" on projects
  for delete using (es_admin_plataforma());

-- units: cualquier miembro (admin o vendedor) puede actualizar su unidad;
-- QUÉ columna exactamente puede tocar lo decide el trigger de la sección 7,
-- no esta policy (la policy solo filtra filas, no columnas por rol).
drop policy if exists "units_select" on units;
create policy "units_select" on units
  for select using (es_miembro(project_id) or es_admin_plataforma());

drop policy if exists "units_update" on units;
create policy "units_update" on units
  for update using (es_miembro(project_id) or es_admin_plataforma())
  with check (es_miembro(project_id) or es_admin_plataforma());

drop policy if exists "units_insert" on units;
create policy "units_insert" on units
  for insert with check (es_admin_plataforma());

drop policy if exists "units_delete" on units;
create policy "units_delete" on units
  for delete using (es_admin_plataforma());

-- settings: alta de la fila es de plataforma (pasa al dar de alta el
-- proyecto); la edición de contenido es de admin de proyecto.
drop policy if exists "settings_select" on settings;
create policy "settings_select" on settings
  for select using (es_miembro(project_id) or es_admin_plataforma());

drop policy if exists "settings_insert" on settings;
create policy "settings_insert" on settings
  for insert with check (es_admin_plataforma());

drop policy if exists "settings_update" on settings;
create policy "settings_update" on settings
  for update using (es_admin_proyecto(project_id) or es_admin_plataforma())
  with check (es_admin_proyecto(project_id) or es_admin_plataforma());

drop policy if exists "settings_delete" on settings;
create policy "settings_delete" on settings
  for delete using (es_admin_plataforma());

-- amenities / typologies: el admin de proyecto las administra completas
-- (alta, baja, reorden, activar/desactivar); cualquier miembro las lee.
drop policy if exists "amenities_admin_escribe" on amenities;
create policy "amenities_admin_escribe" on amenities
  for all using (es_admin_proyecto(project_id) or es_admin_plataforma())
  with check (es_admin_proyecto(project_id) or es_admin_plataforma());

drop policy if exists "amenities_miembro_lee" on amenities;
create policy "amenities_miembro_lee" on amenities
  for select using (es_miembro(project_id) or es_admin_plataforma());

drop policy if exists "typologies_admin_escribe" on typologies;
create policy "typologies_admin_escribe" on typologies
  for all using (es_admin_proyecto(project_id) or es_admin_plataforma())
  with check (es_admin_proyecto(project_id) or es_admin_plataforma());

drop policy if exists "typologies_miembro_lee" on typologies;
create policy "typologies_miembro_lee" on typologies
  for select using (es_miembro(project_id) or es_admin_plataforma());

-- media: el proyecto de la fila depende del scope (typology vs project).
drop policy if exists "media_admin_escribe" on media;
create policy "media_admin_escribe" on media
  for all using (
    es_admin_plataforma()
    or (scope = 'project'  and es_admin_proyecto(project_id))
    or (scope = 'typology' and es_admin_proyecto((select t.project_id from typologies t where t.id = media.typology_id)))
  )
  with check (
    es_admin_plataforma()
    or (scope = 'project'  and es_admin_proyecto(project_id))
    or (scope = 'typology' and es_admin_proyecto((select t.project_id from typologies t where t.id = media.typology_id)))
  );

drop policy if exists "media_miembro_lee" on media;
create policy "media_miembro_lee" on media
  for select using (
    es_admin_plataforma()
    or (scope = 'project'  and es_miembro(project_id))
    or (scope = 'typology' and es_miembro((select t.project_id from typologies t where t.id = media.typology_id)))
  );

-- events: log inmutable. Lectura solo para el equipo del proyecto (hoy es
-- pública sin login — se cierra acá). Insert anónimo validado sin texto libre.
drop policy if exists "events_select" on events;
create policy "events_select" on events
  for select using (es_miembro(project_id) or es_admin_plataforma());

drop policy if exists "events_insert" on events;
create policy "events_insert" on events
  for insert with check (
    proyecto_publicado(project_id)
    and unidad_pertenece(project_id, unit_id)
    and tipo in ('click')
    and sesion is not null
    and (origen is null or origen ~ '^[a-z0-9_-]{1,40}$')
  );
-- sin policy de update/delete: nadie modifica el log, ni plataforma.

-- leads: mismo patrón de insert anónimo que events; lectura y edición
-- solo para el equipo del proyecto o plataforma; sin vista pública.
drop policy if exists "leads_insert" on leads;
create policy "leads_insert" on leads
  for insert with check (
    proyecto_publicado(project_id)
    and (unit_id is null or unidad_pertenece(project_id, unit_id))
    and (origen is null or origen ~ '^[a-z0-9_-]{1,40}$')
  );

drop policy if exists "leads_select" on leads;
create policy "leads_select" on leads
  for select using (es_miembro(project_id) or es_admin_plataforma());

drop policy if exists "leads_update" on leads;
create policy "leads_update" on leads
  for update using (es_miembro(project_id) or es_admin_plataforma())
  with check (es_miembro(project_id) or es_admin_plataforma());
-- sin policy de delete por ahora (no pedido; agregarla es una línea el día
-- que haga falta limpiar spam).

-- ============================================================
-- 11. Grants. anon solo lee vistas + inserta events/leads; el resto
--     se gatea con RLS + estos grants de columna donde corresponde.
-- ============================================================
revoke all on projects, units, settings, amenities, typologies, media, orgs,
  memberships, plataforma_admins, leads from anon;

grant select on public_projects, public_units, public_settings, public_amenities,
  public_typologies, public_media to anon;

-- paises/monedas no son sensibles: lectura directa (no por vista) para todos.
grant select on paises, monedas to anon, authenticated;

grant insert on events to anon, authenticated;
revoke select, update, delete on events from anon;
grant select on events to authenticated;

grant insert on leads to anon, authenticated;
revoke select, update, delete on leads from anon;
grant select, update on leads to authenticated;

-- units: m2_terraza/cochera_precio/typology_id quedan detrás del trigger de
-- la sección 7 (solo admin de proyecto o plataforma pueden cambiarlos de
-- verdad); `estado` queda abierto a cualquier miembro. `precio` NO está en
-- este grant a propósito: ni admin de proyecto ni vendedor pueden tocarlo,
-- ni siquiera vía RLS/trigger — un cambio de precio hoy se hace a mano desde
-- el SQL Editor (rol plataforma/postgres) hasta que exista un flujo con
-- confirmación e historial. Si en el futuro se habilita desde el panel, va
-- a necesitar su propia función security definer (como
-- plataforma_actualizar_proyecto), no un grant de columna sobre `authenticated`.
revoke update on units from anon, authenticated;
grant update (estado, m2_terraza, cochera_precio, typology_id) on units to authenticated;

-- projects: admin de proyecto solo toca los campos de vitrina. Los campos
-- sensibles (slug, publicado, moneda, locale, geometria, org_id) solo se
-- tocan vía plataforma_actualizar_proyecto() (sección 8), nunca por UPDATE
-- directo — por eso no están en este grant ni aunque el usuario sea plataforma.
revoke update on projects from anon, authenticated;
grant update (nombre, direccion, ciudad, entrega) on projects to authenticated;
