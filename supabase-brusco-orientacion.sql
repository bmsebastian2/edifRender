-- BRUSCO: corrige la orientación de los contornos y carga los datos del predio.
--
-- Los contornos (units.geom.contorno) se cargaron con los ejes cambiados: el
-- primer número de cada punto salió del eje norte-sur y el segundo del
-- este-oeste. Eso deja el conjunto espejado respecto de la convención del
-- visor (+X este, +Z sur, -Z norte — ver CLAUDE.md). Acá se intercambian los
-- dos valores de cada punto, [a, b] -> [b, a], directo en jsonb. El orden de
-- los puntos se conserva (el sentido de giro no importa: formaDesdeContorno()
-- lo normaliza).
--
-- Resultado esperado (chequeado antes contra los datos de public_units):
--   · Torre A y 207..213 (A201..A207) del lado sur (Soriano, +Z).
--   · Torre B y 214 (B201) del lado norte (San José, -Z).
--
-- Además, en projects:
--   · lat / lon en las COLUMNAS projects.lat / projects.lon (no en geometria):
--     es lo que ya lee el simulador solar (supabase-migration-solar.sql,
--     tieneNorte() en index.html) y lo que expone public_projects.
--   · geometria.norte_grados = 0: con los ejes corregidos, -Z del modelo mira
--     al norte verdadero.
--   · geometria.frente_eje = '-x': el frente (Aquiles Lanza) queda al oeste.
--     index.html gira la calle/cartel/árboles y la cámara inicial según esto;
--     ROSSO y Altamira no lo tienen y siguen con el frente en -Z.
--   · geometria.calles: nombre de la calle de cada lado.
--   · geometria.contorno_ejes = 'xz': marca de que los contornos ya están en
--     ejes reales. Si está, el swap NO se vuelve a aplicar (correrlo dos veces
--     lo desharía); el resto de los datos se reescribe igual, sin efecto.
--
-- Requiere supabase-migration-solar.sql (columnas lat/lon).

begin;

-- units_write_scope decide con auth.uid(), que en el SQL Editor es null y
-- rechaza cualquier update. Igual que en supabase-brusco-precios.sql, la
-- transacción se identifica como el admin de plataforma (set_config local:
-- dura solo hasta el commit).
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
  v_project uuid;
  v_geo jsonb;
  v_total int;
  n int;
begin
  select id, coalesce(geometria, '{}'::jsonb) into v_project, v_geo
  from projects where slug = 'brusco' for update;
  if v_project is null then raise exception 'No existe el proyecto brusco'; end if;

  if v_geo->>'contorno_ejes' = 'xz' then
    raise notice 'BRUSCO: los contornos ya estaban en ejes xz — no se intercambian de nuevo';
  else
    -- Cada punto tiene que ser [número, número]; si no, mejor no tocar nada.
    if exists (
      select 1 from units u, jsonb_array_elements(u.geom->'contorno') p
      where u.project_id = v_project
        and jsonb_typeof(u.geom->'contorno') = 'array'
        and (jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
             or jsonb_typeof(p->0) <> 'number' or jsonb_typeof(p->1) <> 'number')
    ) then
      raise exception 'Hay puntos de contorno que no son [x, z] numéricos — revisar antes de intercambiar';
    end if;

    select count(*) into v_total from units
    where project_id = v_project and jsonb_typeof(geom->'contorno') = 'array';

    update units u set
      geom = jsonb_set(u.geom, '{contorno}', (
        select jsonb_agg(jsonb_build_array(p->1, p->0) order by i)
        from jsonb_array_elements(u.geom->'contorno') with ordinality as t(p, i)
      ))
    where u.project_id = v_project
      and jsonb_typeof(u.geom->'contorno') = 'array';
    get diagnostics n = row_count;
    if n <> v_total then raise exception 'contornos: se actualizaron % filas, se esperaban %', n, v_total; end if;
    if n <> 172 then raise exception 'contornos: % unidades con contorno, se esperaban 172', n; end if;
    raise notice 'BRUSCO: % contornos intercambiados [a,b] -> [b,a]', n;
  end if;

  update projects set
    lat = -34.90703128730037,
    lon = -56.18680265269605,
    geometria = v_geo || jsonb_build_object(
      'contorno_ejes', 'xz',
      'norte_grados', 0,
      'frente_eje', '-x',
      'calles', jsonb_build_object(
        'norte', 'San José',
        'sur', 'Soriano',
        'este', 'Ejido',
        'oeste', 'Aquiles Lanza'
      )
    )
  where id = v_project;
end $$;

commit;

-- Chequeo (informativo): centroide promedio de vértices de las unidades que
-- se piden verificar. Esperado: 207..212 con z > 0 (sur), 214 con z < 0 (norte).
select u.id, u.geom->>'numero' as numero,
       round(avg((p->>0)::numeric), 1) as x,
       round(avg((p->>1)::numeric), 1) as z,
       case when avg((p->>1)::numeric) > 0 then 'sur (Soriano)' else 'norte (San José)' end as lado
from units u, jsonb_array_elements(u.geom->'contorno') p
where u.project_id = (select id from projects where slug = 'brusco')
  and u.id in (207, 208, 209, 210, 211, 212, 214)
group by u.id, u.geom->>'numero'
order by u.id;
