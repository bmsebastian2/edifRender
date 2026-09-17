-- Migración: lista de espera sobre unidades vendidas/reservadas. Puramente
-- aditiva sobre `leads` (creada en supabase-migration-multitenant.sql), que
-- hoy no tiene ningún flujo de escritura desde index.html todavía — este es
-- el primero. ROSSO usa 'disponible'/'sin_dato' únicamente, así que nunca
-- dispara este camino (ver `unidad_no_disponible` más abajo): sin cambios
-- de comportamiento para ese proyecto.

-- `tipo` distingue una espera de una consulta común. Ni `origen` (atribución
-- de canal del visitante — instagram/whatsapp/etc., ver obtenerOrigen() en
-- index.html) ni `estado` (nuevo/contactado/descartado: el paso del CRM en
-- el que está el lead, que una espera recorre igual que cualquier otro)
-- sirven para esto — son otra dimensión. Mismo patrón que `events.tipo`
-- (click/simulacion) de la migración de financiación. Default 'consulta'
-- dejando la puerta abierta a un formulario de consulta general el día que
-- exista, sin migración nueva.
alter table leads add column if not exists tipo text not null default 'consulta'
  check (tipo in ('consulta', 'espera'));

-- Sesión anónima del visitante (mismo uuid persistido en localStorage que ya
-- usa `events.sesion`, ver obtenerSesion() en index.html) — sin esto no hay
-- forma de (a) evitar que la misma persona quede anotada dos veces a la
-- misma unidad ni (b) frenar una ráfaga de inserts sin captcha ni servicio
-- externo (ver policy y trigger más abajo).
alter table leads add column if not exists sesion uuid;

-- Dedup: el mismo navegador no puede anotarse dos veces a la misma unidad.
-- Postgres trata cada NULL como distinto en un índice único, así que esto
-- no afecta filas con sesion null (leads 'consulta' de otros orígenes).
create unique index if not exists leads_espera_dedup_idx
  on leads (project_id, unit_id, sesion)
  where tipo = 'espera';

-- Unidad vendida o reservada — lo único sobre lo que puede abrirse una
-- espera. Mismo molde que unidad_pertenece(): security definer porque anon
-- no tiene select sobre units más allá de la vista pública, y la policy de
-- insert de leads necesita poder evaluar esto para cualquier rol.
create or replace function unidad_no_disponible(p_project_id uuid, p_unit_id integer)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from units u
    where u.project_id = p_project_id and u.id = p_unit_id
      and u.estado in ('vendido', 'reservado')
  );
$$;
revoke execute on function unidad_no_disponible(uuid, integer) from public;
grant execute on function unidad_no_disponible(uuid, integer) to anon, authenticated;

-- Freno de velocidad por sesión: sin esto, alguien pegándole directo al
-- endpoint REST (la anon key es pública) puede insertar cientos de filas.
-- No es a prueba de balas —`sesion` la genera y la manda el cliente, así
-- que un script puede rotarla— pero es el mismo nivel de confianza que ya
-- tiene todo lo anónimo de este esquema (regex de origen, sesión de
-- events) y no requiere nada fuera de Postgres. security definer: la
-- policy de select de leads no deja leer a anon, así que el trigger
-- necesita saltarse RLS para poder contar.
create or replace function limitar_leads_por_sesion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recientes integer;
begin
  select count(*) into recientes from leads
  where sesion = new.sesion and creado_en > now() - interval '10 minutes';
  if recientes >= 5 then
    raise exception 'Demasiadas solicitudes, esperá unos minutos.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_limitar_sesion on leads;
create trigger leads_limitar_sesion
  before insert on leads
  for each row
  execute function limitar_leads_por_sesion();

-- leads_insert: se suma tipo/espera sin tocar el camino de 'consulta' que
-- ya existía. Para 'espera' exige unit_id + que esa unidad esté
-- efectivamente no disponible (cierra la puerta a anotarse a una unidad
-- disponible saltando la UI) y sesion no nula (si no, el índice de dedup y
-- el trigger de arriba no aplican — ver comentarios de cada uno).
drop policy if exists "leads_insert" on leads;
create policy "leads_insert" on leads
  for insert with check (
    proyecto_publicado(project_id)
    and (unit_id is null or unidad_pertenece(project_id, unit_id))
    and tipo in ('consulta', 'espera')
    and (
      tipo <> 'espera'
      or (unit_id is not null and unidad_no_disponible(project_id, unit_id) and sesion is not null)
    )
    and (origen is null or origen ~ '^[a-z0-9_-]{1,40}$')
  );
