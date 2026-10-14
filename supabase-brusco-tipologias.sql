-- BRUSCO, piso 2 (basamento): tipologías mal asignadas (2026-10-14).
--
-- 1. 201 (B202) y 207 (A201) tenían asignada "Estudio 201", pero según sus
--    datos (los de IXOU: geom.tipologia, dorms, m²) son de 1 dormitorio, de
--    71,9 y 115,1 m²: el visor les mostraba la planta de un estudio. Quedan
--    sin tipología, y por lo tanto sin planta, hasta que IXOU confirme cuál
--    les corresponde. La 208 (A202) conserva "Estudio 202" (ver la nota del
--    final antes de dar eso por bueno).
-- 2. nombre_publico = 'Estudio' en las dos tipologías de BRUSCO ("Estudio 201"
--    y "Estudio 202" llevan el número de unidad en el nombre interno: error
--    de carga). Requiere supabase-migration-nombre-publico.sql; si todavía no
--    se corrió, este paso se saltea con un aviso y el resto se aplica igual.
--
-- Cada update verifica las filas que tocó. Se puede volver a correr: la
-- segunda vez no cambia nada.

begin;

-- units_write_scope decide con auth.uid(), que en el SQL Editor es null y
-- rechaza cualquier update ("sin permiso sobre esta unidad"). Igual que en
-- supabase-brusco-precios.sql: la transacción se identifica como el admin de
-- plataforma (set_config local, dura hasta el commit) en vez de apagar el trigger.
do $$
declare v_uid uuid;
begin
  select pa.user_id into v_uid
  from plataforma_admins pa join auth.users au on au.id = pa.user_id
  where au.email = 'bmsebastian2@gmail.com';
  if v_uid is null then
    raise exception 'No se encontró el admin de plataforma bmsebastian2@gmail.com';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_project uuid := (select id from projects where slug = 'brusco');
  n int;
begin
  if v_project is null then raise exception 'No existe el proyecto brusco'; end if;

  -- 1. Sin tipología: 201 y 207 (solo si todavía tienen "Estudio 201").
  update units set typology_id = null
  where project_id = v_project and id in (201, 207)
    and typology_id = 'cb8727ce-1211-4e81-a4f3-180b5ba3de58';
  get diagnostics n = row_count;
  raise notice '201 y 207 sin tipología: % fila(s) (0 = ya estaban)', n;

  -- 2. nombre_publico = 'Estudio' (si la columna existe).
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'typologies'
               and column_name = 'nombre_publico') then
    execute $q$
      update typologies set nombre_publico = 'Estudio'
      where project_id = $1
        and id in ('cb8727ce-1211-4e81-a4f3-180b5ba3de58', '928e7497-8b22-4c0d-8b30-6d8d3d088996')
        and nombre_publico is distinct from 'Estudio'
    $q$ using v_project;
    get diagnostics n = row_count;
    raise notice 'nombre_publico = Estudio: % tipología(s)', n;
  else
    raise notice 'Falta typologies.nombre_publico: correr supabase-migration-nombre-publico.sql y volver a correr este archivo.';
  end if;
end $$;

commit;

-- Control: cómo queda el piso 2.
select u.id, u.geom->>'numero' as numero, u.geom->>'tipologia' as tipologia_geom,
       u.dorms, u.m2, t.nombre as tipologia_admin
from units u
join projects p on p.id = u.project_id and p.slug = 'brusco'
left join typologies t on t.id = u.typology_id
where u.piso = 2
order by u.id;

-- NOTA sobre la 208. El mini-plano de la planta "Apartamento 202" (la de
-- "Estudio 202") marca la unidad de Aquiles Lanza que sigue a la esquina de
-- San José. En nuestro modelo la 208 (A202) está sobre Soriano; la que ocupa
-- ese lugar es la 202 (B203, estudio de 65,7 m²). Lo mismo con "Apartamento
-- 201": marca la esquina de San José y Aquiles Lanza, que en el modelo es la
-- 201 (B202). Hasta que IXOU lo aclare, la 208 puede estar mostrando la
-- planta de otra unidad. Para sacársela también, descomentar y correr:
--
-- begin;
-- (repetir el bloque de set_config de arriba)
-- update units set typology_id = null
-- where project_id = (select id from projects where slug = 'brusco') and id = 208
--   and typology_id = '928e7497-8b22-4c0d-8b30-6d8d3d088996';
-- commit;
