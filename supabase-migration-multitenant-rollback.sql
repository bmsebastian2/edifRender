-- Rollback de supabase-migration-multitenant.sql.
--
-- Pensado para el caso "corrí la migración y quiero volver atrás ya mismo,
-- todavía no hay un segundo cliente cargado". Si para cuando necesitás esto
-- ya diste de alta un edificio de otro cliente, NO corras este script —
-- restauralo desde el backup de antes de migrar en su lugar (ver el chat /
-- README para el procedimiento de backup): este rollback asume que ROSSO es
-- el único proyecto y borraría cualquier otro dato multi-tenant que exista.
--
-- Por eso el primer bloque aborta solo si detecta más de un proyecto.

do $$
begin
  if (select count(*) from projects) > 1 then
    raise exception 'rollback abortado: hay más de un proyecto — restaurá desde el backup en vez de correr esto';
  end if;
end $$;

-- ============================================================
-- 1. Policies nuevas — se borran antes de tocar estructura.
-- ============================================================
drop policy if exists "orgs_plataforma" on orgs;
drop policy if exists "plataforma_admins_plataforma" on plataforma_admins;
drop policy if exists "memberships_select" on memberships;
drop policy if exists "memberships_insert" on memberships;
drop policy if exists "memberships_update" on memberships;
drop policy if exists "memberships_delete" on memberships;
drop policy if exists "projects_select" on projects;
drop policy if exists "projects_insert" on projects;
drop policy if exists "projects_update" on projects;
drop policy if exists "projects_delete" on projects;
drop policy if exists "units_select" on units;
drop policy if exists "units_update" on units;
drop policy if exists "units_insert" on units;
drop policy if exists "units_delete" on units;
drop policy if exists "settings_select" on settings;
drop policy if exists "settings_insert" on settings;
drop policy if exists "settings_update" on settings;
drop policy if exists "settings_delete" on settings;
drop policy if exists "amenities_admin_escribe" on amenities;
drop policy if exists "amenities_miembro_lee" on amenities;
drop policy if exists "typologies_admin_escribe" on typologies;
drop policy if exists "typologies_miembro_lee" on typologies;
drop policy if exists "media_admin_escribe" on media;
drop policy if exists "media_miembro_lee" on media;
drop policy if exists "events_select" on events;
drop policy if exists "events_insert" on events;
drop policy if exists "leads_insert" on leads;
drop policy if exists "leads_select" on leads;
drop policy if exists "leads_update" on leads;

-- ============================================================
-- 2. Vistas públicas, RPC, triggers, funciones helper.
-- ============================================================
drop view if exists public_projects;
drop view if exists public_units;
drop view if exists public_settings;
drop view if exists public_amenities;
drop view if exists public_typologies;
drop view if exists public_media;

drop function if exists plataforma_actualizar_proyecto(uuid, text, boolean, text, text, jsonb, uuid);

drop trigger if exists units_write_scope on units;
drop function if exists enforce_unit_write_scope();
drop trigger if exists units_audit on units;
drop function if exists set_unit_audit();

drop function if exists miembros_proyecto(uuid);
drop function if exists unidad_pertenece(uuid, integer);
drop function if exists proyecto_publicado(uuid);
drop function if exists es_admin_proyecto(uuid);
drop function if exists es_miembro(uuid);
drop function if exists es_admin_plataforma();

-- ============================================================
-- 3. Deshacer columnas/constraints nuevas en units/events/settings.
-- ============================================================
alter table events drop constraint if exists events_project_unit_fkey;
alter table events drop column if exists project_id;
alter table events drop column if exists sesion;
alter table events drop column if exists origen;
alter table events add constraint events_unit_id_fkey
  foreign key (unit_id) references units(id) on delete cascade;

alter table units drop constraint if exists units_pkey;
alter table units drop column if exists project_id;
alter table units drop column if exists typology_id;
alter table units drop column if exists updated_at;
alter table units drop column if exists updated_by;
alter table units add constraint units_pkey primary key (id);

alter table settings drop constraint if exists settings_pkey;
alter table settings drop column if exists project_id;
alter table settings drop column if exists whatsapp;
alter table settings drop column if exists textos;
alter table settings add column if not exists id integer not null default 1;
update settings set id = 1;
alter table settings add constraint settings_pkey primary key (id);
alter table settings add constraint settings_fila_unica check (id = 1);

-- ============================================================
-- 4. Tablas nuevas — se borran en orden de dependencia.
-- ============================================================
drop table if exists leads;
drop table if exists media;
drop table if exists amenities;
drop table if exists typologies;
drop table if exists memberships;
drop table if exists plataforma_admins;
drop table if exists projects;
drop table if exists orgs;
drop table if exists monedas;
drop table if exists paises;

-- ============================================================
-- 5. Policies y grants originales (single-tenant), tal como
--    quedaron en supabase-schema.sql / supabase-migration-auth.sql.
-- ============================================================
drop policy if exists "units_select_publico" on units;
create policy "units_select_publico" on units
  for select using (true);

drop policy if exists "units_update_estado" on units;
create policy "units_update_estado" on units
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke update on units from anon, authenticated;
grant update (estado, m2_terraza, cochera_precio) on units to authenticated;

drop policy if exists "events_insert_publico" on events;
create policy "events_insert_publico" on events
  for insert with check (true);

drop policy if exists "events_select_publico" on events;
create policy "events_select_publico" on events
  for select using (true);

drop policy if exists "settings_select_publico" on settings;
create policy "settings_select_publico" on settings
  for select using (true);

drop policy if exists "settings_update_auth" on settings;
create policy "settings_update_auth" on settings
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
