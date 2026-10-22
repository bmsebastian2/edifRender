-- Migración: eventos de consulta desde el pie del panel de la unidad, y un
-- resumen de demanda para admin.html.
--
-- Hoy `events` solo registra 'click' (abrir el panel de una unidad) y
-- 'simulacion' (soltar el deslizador de financiación). Los botones del pie
-- —WhatsApp, el formulario de consulta_url, "Avisarme si se libera" y
-- "Solicitar plano"— no dejan rastro, así que Demanda no ve las consultas,
-- que son la conversión. Esta migración:
--   1. suma los tipos nuevos a la policy de insert (aditivo: 'click' y
--      'simulacion' entran igual que antes);
--   2. agrega un trigger que descarta en silencio los duplicados de los
--      últimos 60 s (todos los tipos) y pone un tope por sesión a los tipos
--      de consulta;
--   3. agrega la RPC demanda_resumen(), agrupada en el servidor y devuelta
--      como un solo jsonb: hoy admin baja una fila por evento y el tope de
--      filas de la API (1000 por defecto) puede truncar los conteos sin
--      aviso.
-- Desde que se aplica, los clics también se deduplican (60 s): los conteos
-- de antes no son comparables 1:1 con los de después.
--
-- Orden obligatorio: esta migración → deploy del visor que manda los tipos
-- nuevos → admin.html que lee demanda_resumen(). Al revés, los inserts de
-- los tipos nuevos fallan (la policy los rechaza; el visor solo hace
-- console.warn) o admin llama a una función que no existe.
--
-- Corre después de multitenant (helpers proyecto_publicado, unidad_pertenece,
-- es_miembro, es_admin_plataforma; columnas project_id/sesion/origen) y de
-- financiacion (última versión de la policy events_insert). Idempotente:
-- se puede correr dos veces.

-- ============================================================
-- 1. Policy de insert: tipos nuevos
-- ============================================================
-- Igual que la versión de supabase-migration-financiacion.sql salvo la lista
-- de tipos. Los nuevos, uno por canal de consulta:
--   'whatsapp'   — el botón de WhatsApp del pie (dice "Consultar" sin
--                  consulta_url; con ella queda como ícono al lado);
--   'formulario' — el botón "Consultar" que lleva a settings.consulta_url;
--   'espera_ir'  — "Avisarme si se libera" (lleva al formulario; anotarse
--                  ya queda como lead tipo 'espera');
--   'plano'      — "Solicitar plano" (WhatsApp con el mensaje del plano).
-- origen: 'preview' y 'local' (para separar las pruebas en Demanda) ya
-- cumplen la regex de siempre y el check de la columna, así que no cambia.
drop policy if exists "events_insert" on events;
create policy "events_insert" on events
  for insert with check (
    proyecto_publicado(project_id)
    and unidad_pertenece(project_id, unit_id)
    and tipo in ('click', 'simulacion', 'whatsapp', 'formulario', 'espera_ir', 'plano')
    and sesion is not null
    and (origen is null or origen ~ '^[a-z0-9_-]{1,40}$')
  );

-- ============================================================
-- 2. Trigger: duplicados y tope por sesión
-- ============================================================
-- return null en un BEFORE INSERT descarta la fila sin error: el visor no
-- ve una falla (la API contesta 201) y Demanda no cuenta de más. Corre
-- antes del with check de la policy, así que un tipo inválido igual se
-- rechaza con error después.
--   - Duplicado (todos los tipos): el mismo (project_id, unit_id, sesion,
--     tipo, pct_entrega) en los últimos 60 s. Un doble toque, o abrir dos
--     veces la misma unidad en un minuto, cuenta una vez. pct_entrega entra
--     en la clave para que el simulador guarde cada valor distinto que se
--     elige (20 → 30 → 40 son tres eventos); en los demás tipos es null y
--     no cambia nada. Ojo: volver a un valor ya elegido dentro del minuto
--     (20 → 40 → 20) se descarta, y el último que queda es 40.
--   - Tope (solo los tipos de consulta): más de 20 por sesión en la última
--     hora se descartan. 'click' y 'simulacion' sin tope.
-- No es a prueba de balas —`sesion` la genera el cliente— pero es el mismo
-- nivel de confianza que limitar_leads_por_sesion() en leads. security
-- definer: anon no puede leer events (sin grant de select), y el trigger
-- necesita contar.
create or replace function filtrar_eventos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from events e
    where e.project_id = new.project_id
      and e.sesion = new.sesion
      and e.creado_en > now() - interval '60 seconds'
      and e.unit_id = new.unit_id
      and e.tipo = new.tipo
      and e.pct_entrega is not distinct from new.pct_entrega
  ) then
    return null;
  end if;

  if new.tipo in ('whatsapp', 'formulario', 'espera_ir', 'plano') and (
    select count(*) from events e
    where e.project_id = new.project_id
      and e.sesion = new.sesion
      and e.creado_en > now() - interval '1 hour'
      and e.tipo in ('whatsapp', 'formulario', 'espera_ir', 'plano')
  ) >= 20 then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists events_filtrar on events;
create trigger events_filtrar
  before insert on events
  for each row
  execute function filtrar_eventos();

-- Las dos consultas del trigger filtran por (project_id, sesion) y un rango
-- de creado_en. events_sesion_idx (project_id, sesion) ya las acota a la
-- sesión, pero una sesión larga —el aparato del showroom comparte una sola
-- para todos los visitantes— acumula miles de filas y el trigger las
-- recorrería en cada insert. Con creado_en en el índice lee solo las
-- recientes. No se borra events_sesion_idx (aditivo); queda cubierto por
-- este, y se puede sacar a mano más adelante.
create index if not exists events_sesion_reciente_idx on events (project_id, sesion, creado_en);

-- ============================================================
-- 3. Resumen de demanda para admin.html
-- ============================================================
-- Agrupado en el servidor y devuelto como UN solo jsonb: el tope de filas
-- de la API (1000 por defecto) no lo corta, porque es un valor y no un
-- conjunto de filas. Un array con un elemento por (unidad, tipo, origen):
--   { unit_id, tipo, origen, eventos, sesiones }
-- y en los de 'simulacion', además:
--   pct_entrega_final: [ { pct_entrega, sesiones }, … ]
-- la distribución del ÚLTIMO pct_entrega de cada sesión (el último por
-- creado_en y, a igual hora, por id) en esa unidad y ese origen; su suma de
-- sesiones es la de ese elemento. Para verlo por unidad sola se suman los
-- orígenes. Sin p_incluir_pruebas (false por defecto) no cuenta los
-- eventos de origen 'preview' y 'local'. Error en vez de vacío si el que
-- llama no es del equipo del proyecto (mismo criterio que
-- accesos_miembros()).
-- La versión de un solo parámetro que devolvía filas se saca: nunca se
-- aplicó, y con las dos juntas una llamada con un solo argumento sería
-- ambigua.
drop function if exists demanda_resumen(uuid);

create or replace function demanda_resumen(p_project_id uuid, p_incluir_pruebas boolean default false)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  resultado jsonb;
begin
  if not (es_miembro(p_project_id) or es_admin_plataforma()) then
    raise exception 'No tenés permiso para ver la demanda de este proyecto'
      using errcode = '42501';
  end if;

  with ev as (
    select e.id, e.unit_id, e.tipo, e.origen, e.sesion, e.pct_entrega, e.creado_en
    from events e
    where e.project_id = p_project_id
      and (p_incluir_pruebas or e.origen is null or e.origen not in ('preview', 'local'))
  ),
  grupos as (
    select ev.unit_id, ev.tipo, ev.origen, count(*) as eventos, count(distinct ev.sesion) as sesiones
    from ev
    group by ev.unit_id, ev.tipo, ev.origen
  ),
  ultimos as (
    select distinct on (ev.unit_id, ev.origen, ev.sesion) ev.unit_id, ev.origen, ev.sesion, ev.pct_entrega
    from ev
    where ev.tipo = 'simulacion'
    order by ev.unit_id, ev.origen, ev.sesion, ev.creado_en desc, ev.id desc
  ),
  distribucion as (
    select x.unit_id, x.origen,
           jsonb_agg(jsonb_build_object('pct_entrega', x.pct_entrega, 'sesiones', x.sesiones)
                     order by x.pct_entrega) as pct
    from (
      select u.unit_id, u.origen, u.pct_entrega, count(*) as sesiones
      from ultimos u
      group by u.unit_id, u.origen, u.pct_entrega
    ) x
    group by x.unit_id, x.origen
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('unit_id', g.unit_id, 'tipo', g.tipo, 'origen', g.origen,
                              'eventos', g.eventos, 'sesiones', g.sesiones)
           || case when g.tipo = 'simulacion'
                   then jsonb_build_object('pct_entrega_final', coalesce(d.pct, '[]'::jsonb))
                   else '{}'::jsonb end
           order by g.unit_id, g.tipo, g.origen), '[]'::jsonb)
    into resultado
  from grupos g
  left join distribucion d
    on g.tipo = 'simulacion' and d.unit_id = g.unit_id and d.origen is not distinct from g.origen;

  return resultado;
end;
$$;

revoke execute on function demanda_resumen(uuid, boolean) from public, anon;
grant execute on function demanda_resumen(uuid, boolean) to authenticated;

-- ============================================================
-- Rollback (comentado: correr a mano solo si hace falta deshacer)
-- ============================================================
-- Vuelve a la policy de supabase-migration-financiacion.sql y saca lo que
-- agregó esta migración. Los eventos ya grabados con los tipos nuevos
-- quedan en la tabla (admin solo lee tipo = 'click').
--
-- drop trigger if exists events_filtrar on events;
-- drop function if exists filtrar_eventos();
-- drop function if exists demanda_resumen(uuid, boolean);
-- drop index if exists events_sesion_reciente_idx;
-- drop policy if exists "events_insert" on events;
-- create policy "events_insert" on events
--   for insert with check (
--     proyecto_publicado(project_id)
--     and unidad_pertenece(project_id, unit_id)
--     and tipo in ('click', 'simulacion')
--     and sesion is not null
--     and (origen is null or origen ~ '^[a-z0-9_-]{1,40}$')
--   );
