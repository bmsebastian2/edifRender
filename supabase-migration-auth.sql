-- Migración: exigir login (Supabase Auth) para editar `estado`.
-- Correr una sola vez en el SQL Editor del proyecto que ya está en uso
-- (supabase-schema.sql ya quedó actualizado para instalaciones nuevas).
--
-- Antes de correr esto, creá al menos un usuario en
-- Authentication → Users → Add user (email + password) para poder
-- loguearte en admin.html.

drop policy if exists "units_update_estado" on units;
create policy "units_update_estado" on units
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

revoke update on units from anon, authenticated;
grant update (estado) on units to authenticated;
