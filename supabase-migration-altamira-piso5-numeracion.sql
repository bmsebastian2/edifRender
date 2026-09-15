-- Corrección de numeración: en Altamira Tres Cruces, el piso 5 tiene 9
-- unidades, no 10 — las posiciones 5 y 6 (que en los pisos 1-4 son
-- "1D-frente" + "1D-amplio") se fusionaron en una sola unidad grande, la
-- 505 (3D-premium, 119.13 m²). La fórmula `id = piso*100 + pos` que arma
-- el seed no contempla esa fusión, así que hoy la base numera corridas en
-- +1 las 4 unidades siguientes del piso 5 (507/508/509/510) respecto a la
-- numeración real de venta.
--
-- Confirmado contra material oficial del desarrollador (brochure de
-- monoambientes + planos individuales "506-monoambiente.pdf" y
-- "509-monoambiente.pdf"): la unidad que hoy es "507" en la base es en
-- realidad la "506" (37.52 m², coincide exacto), y la que hoy es "510" es
-- en realidad la "509" (38.76 m², coincide exacto). El "510" no existe —
-- el piso 5 va de 501 a 509.
--
-- Esto es puramente una corrección de numeración: no toca tipologías (ya
-- había 2 tipologías de monoambiente, MONO-A y MONO-B, correctas) ni
-- reasigna nada — cada fila conserva su pos/dorms/m2/typology_id/geom,
-- solo cambia el `id` (el número de unidad que se muestra en el sitio).
--
-- Correr una sola vez en el SQL Editor. Es re-ejecutable sin efecto doble:
-- si ya no encuentra 507/508/509/510 en el piso 5, no hace nada.

do $$
declare
  v_project_id uuid;
begin
  select id into v_project_id from projects where slug = 'altamira';
  if v_project_id is null then
    raise exception 'No se encontró el proyecto "altamira"';
  end if;

  if not exists (
    select 1 from units where project_id = v_project_id and piso = 5 and id in (507, 508, 509, 510)
  ) then
    return;
  end if;

  -- La FK de events → units es (project_id, id) sin ON UPDATE CASCADE (ver
  -- supabase-migration-multitenant.sql, sección 5) — hay que soltarla antes
  -- de mover el id de units o la primera fila que se toque revienta con
  -- "violates foreign key constraint".
  alter table events drop constraint if exists events_project_unit_fkey;

  -- units_write_scope (supabase-migration-multitenant.sql, sección 7) mira
  -- auth.uid() para decidir quién puede tocar cada fila — en el SQL Editor
  -- no hay sesión de Supabase Auth, así que auth.uid() da null y el trigger
  -- rechaza CUALQUIER update con "sin permiso sobre esta unidad", incluso
  -- corriendo como el rol del proyecto. No es una regla que aplique acá
  -- (estamos corrigiendo el id, no editando la unidad desde el panel), así
  -- que se desactiva puntualmente y se reactiva apenas termina el shift.
  alter table units disable trigger units_write_scope;

  -- Shift en dos pasos con valores negativos: mover directo (507→506,
  -- 508→507, ...) en una sola pasada puede chocar contra la fila que
  -- todavía no se movió (509→508 pisaría al 508 real, que recién se mueve
  -- después, en la misma sentencia). Ningún id real existente puede ser
  -- negativo, así que pasar todo a negativo primero no choca con nada.
  update units set id = -id where project_id = v_project_id and piso = 5 and id in (507, 508, 509, 510);
  update units set id = -id - 1 where project_id = v_project_id and piso = 5 and id < 0;

  alter table units enable trigger units_write_scope;

  update events set unit_id = -unit_id where project_id = v_project_id and unit_id in (507, 508, 509, 510);
  update events set unit_id = -unit_id - 1 where project_id = v_project_id and unit_id < 0;

  -- leads.unit_id no tiene FK real (es un campo suelto, ver
  -- supabase-migration-multitenant.sql) pero se corrige igual por
  -- consistencia con el resto de los datos.
  update leads set unit_id = -unit_id where project_id = v_project_id and unit_id in (507, 508, 509, 510);
  update leads set unit_id = -unit_id - 1 where project_id = v_project_id and unit_id < 0;

  alter table events add constraint events_project_unit_fkey
    foreign key (project_id, unit_id) references units (project_id, id) on delete cascade;
end $$;
