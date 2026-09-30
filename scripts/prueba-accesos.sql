-- Pruebas de supabase-migration-accesos.sql, los tres roles + anon.
--
-- Correr ENTERO en el SQL Editor de Supabase, después de la migración.
-- No deja nada: crea usuarios ficticios (@accesos.test) y membresías
-- dentro de una transacción que termina en ROLLBACK. Para simular a cada
-- usuario hace lo mismo que PostgREST con un JWT: SET ROLE authenticated +
-- request.jwt.claims con el `sub`, que es lo que lee auth.uid(). Así las
-- policies y las RPC se evalúan exactamente como desde el navegador.
--
-- Resultado: si algo falla, se corta con "FALLO: ..." (y el error aborta
-- la transacción, tampoco queda nada). Si todo pasa, la última fila dice
-- "OK: todas las pruebas de accesos pasaron".
--
-- Usa ROSSO como proyecto de prueba y cualquier otro proyecto como "ajeno".

begin;

-- ============================================================
-- Preparación (como postgres)
-- ============================================================
select set_config('prueba.p', (select id::text from projects where slug = 'rosso'), true);
select set_config('prueba.q', (select id::text from projects where slug <> 'rosso' order by slug limit 1), true);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-000000000001', 'prueba-plataforma@accesos.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000002', 'prueba-admin@accesos.test',      'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000003', 'prueba-vendedor@accesos.test',   'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000004', 'prueba-admin2@accesos.test',     'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000005', 'prueba-nuevo@accesos.test',      'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000006', 'prueba-ajeno@accesos.test',      'authenticated', 'authenticated');

insert into plataforma_admins (user_id) values ('00000000-0000-4000-a000-000000000001');

insert into memberships (user_id, project_id, rol) values
  ('00000000-0000-4000-a000-000000000002', current_setting('prueba.p')::uuid, 'admin'),
  ('00000000-0000-4000-a000-000000000003', current_setting('prueba.p')::uuid, 'vendedor'),
  ('00000000-0000-4000-a000-000000000004', current_setting('prueba.p')::uuid, 'admin'),
  ('00000000-0000-4000-a000-000000000006', current_setting('prueba.q')::uuid, 'vendedor');

-- ============================================================
-- ANON (sin sesión): ni siquiera puede ejecutar las RPC
-- ============================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$ begin
  perform accesos_miembros(current_setting('prueba.p')::uuid);
  raise exception 'FALLO anon: pudo llamar a accesos_miembros';
exception when insufficient_privilege then
  if sqlerrm not like 'permission denied for function%' then
    raise exception 'FALLO anon: entró a accesos_miembros (falta el revoke from anon): %', sqlerrm;
  end if;
end $$;

do $$ begin
  perform accesos_agregar(current_setting('prueba.p')::uuid, 'prueba-nuevo@accesos.test', 'admin');
  raise exception 'FALLO anon: pudo llamar a accesos_agregar';
exception when insufficient_privilege then
  if sqlerrm not like 'permission denied for function%' then
    raise exception 'FALLO anon: entró a accesos_agregar (falta el revoke from anon): %', sqlerrm;
  end if;
end $$;

-- ============================================================
-- VENDEDOR: no puede listar, agregar, cambiar ni quitar — tampoco a sí mismo
-- ============================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);

do $$ begin
  perform accesos_miembros(current_setting('prueba.p')::uuid);
  raise exception 'FALLO vendedor: pudo listar miembros';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  perform accesos_agregar(current_setting('prueba.p')::uuid, 'prueba-nuevo@accesos.test', 'vendedor');
  raise exception 'FALLO vendedor: pudo agregar un miembro';
exception when insufficient_privilege then null;
end $$;

do $$ declare n int; begin
  update memberships set rol = 'vendedor'
   where user_id = '00000000-0000-4000-a000-000000000004' and project_id = current_setting('prueba.p')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO vendedor: cambió el rol de otro (% filas)', n; end if;

  update memberships set rol = 'admin'
   where user_id = auth.uid() and project_id = current_setting('prueba.p')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO vendedor: se ascendió a admin a sí mismo'; end if;

  delete from memberships
   where user_id = '00000000-0000-4000-a000-000000000004' and project_id = current_setting('prueba.p')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO vendedor: quitó a otro miembro'; end if;

  delete from memberships where user_id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO vendedor: se quitó a sí mismo'; end if;
end $$;

do $$ begin
  insert into memberships (user_id, project_id, rol)
  values ('00000000-0000-4000-a000-000000000005', current_setting('prueba.p')::uuid, 'admin');
  raise exception 'FALLO vendedor: insertó una membresía directo';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  insert into plataforma_admins (user_id) values (auth.uid());
  raise exception 'FALLO vendedor: se agregó a plataforma_admins';
exception when insufficient_privilege then null;
end $$;

-- ============================================================
-- ADMIN DE PROYECTO: gestiona su proyecto, no el ajeno, no a sí mismo
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);

do $$ declare n int; yo int; begin
  select count(*), count(*) filter (where es_yo) into n, yo
    from accesos_miembros(current_setting('prueba.p')::uuid)
   where email like '%@accesos.test';
  if n <> 3 or yo <> 1 then
    raise exception 'FALLO admin: listado esperado 3 miembros de prueba con 1 es_yo, vino % / %', n, yo;
  end if;
end $$;

do $$ begin
  perform accesos_miembros(current_setting('prueba.q')::uuid);
  raise exception 'FALLO admin: listó los miembros de un proyecto ajeno';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  perform accesos_agregar(current_setting('prueba.p')::uuid, 'no-existe@accesos.test', 'vendedor');
  raise exception 'FALLO admin: agregó un email inexistente';
exception when no_data_found then
  if sqlerrm <> 'Ese usuario todavía no está creado en Supabase' then
    raise exception 'FALLO admin: mensaje inesperado para email inexistente: %', sqlerrm;
  end if;
end $$;

do $$ begin
  perform accesos_agregar(current_setting('prueba.p')::uuid, 'prueba-admin@accesos.test', 'vendedor');
  raise exception 'FALLO admin: se agregó a sí mismo';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  perform accesos_agregar(current_setting('prueba.p')::uuid, 'prueba-nuevo@accesos.test', 'superadmin');
  raise exception 'FALLO admin: aceptó un rol inválido';
exception when invalid_parameter_value then null;
end $$;

-- Alta normal, con mayúsculas y espacios en el email.
select accesos_agregar(current_setting('prueba.p')::uuid, '  Prueba-Nuevo@Accesos.TEST ', 'vendedor');

do $$ declare r record; begin
  select rol, creado_en into r from accesos_miembros(current_setting('prueba.p')::uuid)
   where user_id = '00000000-0000-4000-a000-000000000005';
  if r.rol is distinct from 'vendedor' or r.creado_en is null then
    raise exception 'FALLO admin: el alta no quedó bien (rol %, creado_en %)', r.rol, r.creado_en;
  end if;
end $$;

do $$ begin
  perform accesos_agregar(current_setting('prueba.p')::uuid, 'prueba-nuevo@accesos.test', 'admin');
  raise exception 'FALLO admin: agregó dos veces al mismo usuario';
exception when unique_violation then null;
end $$;

do $$ declare n int; begin
  update memberships set rol = 'admin'
   where user_id = '00000000-0000-4000-a000-000000000005' and project_id = current_setting('prueba.p')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO admin: no pudo cambiar el rol de un miembro'; end if;

  update memberships set rol = 'vendedor'
   where user_id = auth.uid() and project_id = current_setting('prueba.p')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO admin: se cambió el rol a sí mismo'; end if;

  delete from memberships where user_id = auth.uid() and project_id = current_setting('prueba.p')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO admin: se quitó a sí mismo'; end if;

  delete from memberships where project_id = current_setting('prueba.q')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO admin: quitó miembros de un proyecto ajeno'; end if;

  delete from memberships
   where user_id = '00000000-0000-4000-a000-000000000004' and project_id = current_setting('prueba.p')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO admin: no pudo quitar a otro admin del proyecto'; end if;
end $$;

-- Solo `rol` es editable: no puede mover una membresía a otro proyecto.
do $$ begin
  update memberships set project_id = current_setting('prueba.q')::uuid
   where user_id = '00000000-0000-4000-a000-000000000005';
  raise exception 'FALLO admin: movió una membresía a otro proyecto';
exception when insufficient_privilege then null;
end $$;

do $$ declare n int; begin
  begin
    insert into plataforma_admins (user_id) values (auth.uid());
    raise exception 'FALLO admin: se agregó a plataforma_admins';
  exception when insufficient_privilege then null;
  end;
  delete from plataforma_admins;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO admin: borró filas de plataforma_admins'; end if;
end $$;

-- ============================================================
-- ADMIN DE PLATAFORMA: cualquier proyecto, pero tampoco se agrega a sí mismo
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

do $$ declare n int; begin
  select count(*) into n from accesos_miembros(current_setting('prueba.q')::uuid)
   where email like '%@accesos.test';
  if n <> 1 then raise exception 'FALLO plataforma: no vio los miembros del otro proyecto (%)', n; end if;
end $$;

select accesos_agregar(current_setting('prueba.q')::uuid, 'prueba-admin@accesos.test', 'vendedor');

do $$ declare n int; begin
  delete from memberships
   where user_id = '00000000-0000-4000-a000-000000000006' and project_id = current_setting('prueba.q')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO plataforma: no pudo quitar un miembro'; end if;
end $$;

do $$ begin
  perform accesos_agregar(current_setting('prueba.p')::uuid, 'prueba-plataforma@accesos.test', 'admin');
  raise exception 'FALLO plataforma: se agregó a sí mismo';
exception when insufficient_privilege then null;
end $$;

reset role;
rollback;

select 'OK: todas las pruebas de accesos pasaron' as resultado;
