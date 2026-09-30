-- Migración: gestión de accesos (memberships) desde admin.html.
--
-- Hasta ahora las membresías se insertaban a mano en el SQL Editor. La
-- pestaña "Accesos" del panel permite a un admin de plataforma (en todos los
-- proyectos) o a un admin de proyecto (en los suyos) asignar a un usuario que
-- YA EXISTE en Supabase Auth, cambiarle el rol o quitarlo. Crear usuarios
-- nuevos no entra acá: necesita la service_role key y va a ir en una Edge
-- Function más adelante.
--
-- Dos problemas que el front no puede resolver solo:
--   1. Pasar de email a user_id: auth.users no es legible desde el cliente.
--      → RPC security definer accesos_agregar().
--   2. Listar miembros con su email: mismo motivo.
--      → RPC security definer accesos_miembros(). No se reutiliza
--        miembros_proyecto() porque esa la puede llamar cualquier miembro
--        (incluidos vendedores, para la columna "modificado por") y esta
--        tiene que ser solo para admins.
--
-- Reglas que se garantizan acá, no en el front:
--   - Solo admin de plataforma o admin de ese proyecto (es_admin_plataforma()
--     / es_admin_proyecto(), los helpers de la migración multitenant).
--   - Nadie modifica su propio acceso (ni quitarse ni cambiarse el rol:
--     bajarse de admin a vendedor es perder el acceso por otra vía).
--   - plataforma_admins no se toca: ni esta migración ni el panel la usan
--     para escribir; sus policies siguen siendo solo de plataforma.
--
-- Aditiva e idempotente: las filas existentes no cambian (creado_en queda
-- null en ellas y el panel muestra "—"). Correr después de
-- supabase-migration-multitenant.sql.

-- ============================================================
-- 1. Fecha de alta
-- ============================================================
-- El default va en un paso aparte a propósito: con "add column ... default
-- now()" todas las filas existentes quedarían con la fecha de esta
-- migración, que sería falsa.
alter table memberships add column if not exists creado_en timestamptz;
alter table memberships alter column creado_en set default now();

-- ============================================================
-- 2. Listar miembros con email (solo admins)
-- ============================================================
-- Lanza error en vez de devolver vacío si el que llama no es admin: así un
-- intento desde la consola falla de forma explícita. `es_yo` le sirve al
-- panel para deshabilitar los controles de la propia fila.
create or replace function accesos_miembros(p_project_id uuid)
returns table(user_id uuid, email text, rol text, creado_en timestamptz, es_yo boolean)
language plpgsql security definer set search_path = public stable as $$
begin
  if not (es_admin_plataforma() or es_admin_proyecto(p_project_id)) then
    raise exception 'No tenés permiso para administrar los accesos de este proyecto'
      using errcode = '42501';
  end if;

  return query
    select m.user_id, u.email::text, m.rol, m.creado_en, m.user_id = auth.uid()
    from memberships m
    join auth.users u on u.id = m.user_id
    where m.project_id = p_project_id
    order by m.creado_en nulls first, u.email;
end;
$$;

-- ============================================================
-- 3. Agregar un miembro por email
-- ============================================================
-- El insert lo hace la función (security definer), así que la policy
-- memberships_insert puede seguir siendo solo de plataforma: un admin de
-- proyecto nunca inserta directo, siempre pasa por acá.
create or replace function accesos_agregar(p_project_id uuid, p_email text, p_rol text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_rol_actual text;
begin
  if not (es_admin_plataforma() or es_admin_proyecto(p_project_id)) then
    raise exception 'No tenés permiso para administrar los accesos de este proyecto'
      using errcode = '42501';
  end if;

  if p_rol is null or p_rol not in ('admin', 'vendedor') then
    raise exception 'Rol inválido: tiene que ser admin o vendedor'
      using errcode = '22023';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email));

  if v_user_id is null then
    raise exception 'Ese usuario todavía no está creado en Supabase'
      using errcode = 'P0002',
            hint = 'Crealo en Authentication → Users y volvé a agregarlo acá.';
  end if;

  if v_user_id = auth.uid() then
    raise exception 'No podés modificar tu propio acceso'
      using errcode = '42501';
  end if;

  select m.rol into v_rol_actual
  from memberships m
  where m.project_id = p_project_id and m.user_id = v_user_id;

  if v_rol_actual is not null then
    raise exception 'Ya tiene acceso a este proyecto como %; cambiale el rol desde la lista', v_rol_actual
      using errcode = '23505';
  end if;

  insert into memberships (user_id, project_id, rol)
  values (v_user_id, p_project_id, p_rol);
end;
$$;

-- "from public" solo no alcanza: Supabase le da execute a anon DIRECTO (por
-- default privileges del schema), no vía public. Sin el revoke explícito a
-- anon, un visitante sin sesión llega a ejecutar la función (la frena el
-- chequeo de adentro, pero no debería ni entrar). Verificado con la anon key.
revoke execute on function accesos_miembros(uuid) from public, anon;
revoke execute on function accesos_agregar(uuid, text, text) from public, anon;
grant execute on function accesos_miembros(uuid) to authenticated;
grant execute on function accesos_agregar(uuid, text, text) to authenticated;

-- ============================================================
-- 4. Policies de update/delete sobre memberships
-- ============================================================
-- Reemplazan las de la migración multitenant (que eran solo plataforma),
-- mismo nombre. user_id <> auth.uid() es la regla de "nadie se toca a sí
-- mismo", del lado del servidor.
--
-- memberships_select también se amplía: un UPDATE/DELETE con WHERE (y con
-- RETURNING, que es lo que pide el panel con .select()) solo alcanza filas
-- que además pasen la policy de SELECT. Sin esto, un admin de proyecto
-- afectaría 0 filas en silencio. Lo que ve de más son user_id + rol de su
-- propio proyecto — lo mismo que ya le da miembros_proyecto().
drop policy if exists "memberships_select" on memberships;
create policy "memberships_select" on memberships
  for select using (
    user_id = auth.uid() or es_admin_plataforma() or es_admin_proyecto(project_id)
  );

drop policy if exists "memberships_update" on memberships;
create policy "memberships_update" on memberships
  for update
  using (user_id <> auth.uid() and (es_admin_plataforma() or es_admin_proyecto(project_id)))
  with check (user_id <> auth.uid() and (es_admin_plataforma() or es_admin_proyecto(project_id)));

drop policy if exists "memberships_delete" on memberships;
create policy "memberships_delete" on memberships
  for delete
  using (user_id <> auth.uid() and (es_admin_plataforma() or es_admin_proyecto(project_id)));

-- Solo se puede cambiar el rol: un update no puede mover una membresía a
-- otro proyecto ni a otro usuario. memberships_insert queda como estaba
-- (solo plataforma inserta directo; el alta desde el panel va por
-- accesos_agregar()).
revoke update on memberships from authenticated;
grant update (rol) on memberships to authenticated;
grant delete on memberships to authenticated;
