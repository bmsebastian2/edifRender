-- Migración: email de quién modificó cada unidad (columna "Modificado" del admin).
--
-- La columna resolvía units.updated_by con miembros_proyecto(), que solo
-- conoce a los usuarios con membership en el proyecto. Un admin de
-- plataforma no tiene membership, así que sus cambios se mostraban como un
-- uuid crudo ("11bca25f-805b-45…"), que no le dice nada a nadie.
--
-- autores_unidades() devuelve el email de cada usuario que figura como
-- updated_by en alguna unidad DEL proyecto — y nada más: no lista
-- plataforma_admins ni expone auth.users entero. Mismo control de acceso que
-- miembros_proyecto() (es_miembro / es_admin_plataforma), porque la columna
-- la ven también los vendedores.
--
-- Aditiva e idempotente. Sin esta migración el panel sigue andando: muestra
-- solo la fecha cuando no puede resolver el email. Correr después de
-- supabase-migration-multitenant.sql.

create or replace function autores_unidades(p_project_id uuid)
returns table(user_id uuid, email text)
language plpgsql security definer set search_path = public stable as $$
begin
  if not (es_miembro(p_project_id) or es_admin_plataforma()) then
    raise exception 'No tenés acceso a este proyecto'
      using errcode = '42501';
  end if;

  return query
    select distinct u.id, u.email::text
    from units un
    join auth.users u on u.id = un.updated_by
    where un.project_id = p_project_id;
end;
$$;

-- Mismo motivo que en supabase-migration-accesos.sql: Supabase le da execute
-- a anon directo, no vía public.
revoke execute on function autores_unidades(uuid) from public, anon;
grant execute on function autores_unidades(uuid) to authenticated;
