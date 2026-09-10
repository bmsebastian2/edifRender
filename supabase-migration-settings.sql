-- Migración: agrega la tabla `settings` (redes sociales del sitio, editables
-- desde la pestaña "Redes" de admin.html). Correr una sola vez en el SQL
-- Editor del proyecto que ya está en uso (supabase-schema.sql ya quedó
-- actualizado para instalaciones nuevas).

create table if not exists settings (
  id         integer primary key default 1,
  instagram  text not null default '',
  youtube    text not null default '',
  sitio_web  text not null default '',
  constraint settings_fila_unica check (id = 1)
);

alter table settings enable row level security;

drop policy if exists "settings_select_publico" on settings;
create policy "settings_select_publico" on settings
  for select using (true);

drop policy if exists "settings_update_auth" on settings;
create policy "settings_update_auth" on settings
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into settings (id) values (1) on conflict (id) do nothing;
