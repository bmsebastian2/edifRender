// Genera supabase-brusco-precios.sql desde datos/ixou-brusco-precios.json
// (la salida de scripts/scrape-ixou-brusco.mjs).
//
// Uso: node scripts/sql-ixou-brusco.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const datos = JSON.parse(readFileSync(`${RAIZ}/datos/ixou-brusco-precios.json`, 'utf8'));

// Nivel 2 (basamento, ids 201..214 sin torre): slug IXOU → id en la base.
// Cada torre se queda con su mitad del anillo del podio; en B lo confirman los m²
// (relación pareja 1,56–1,60), en A la tipología (1 dorm = 207, 2 dorm = 212).
const PISO2 = { a201: 207, a202: 208, a203: 209, a204: 210, a205: 211, a206: 212, a207: 213,
  b201: 214, b202: 201, b203: 202, b204: 203, b205: 204, b206: 205, b207: 206 };

const idDe = (x) => x.piso === 2 ? PISO2[x.slug] : (x.torre === 'B' ? 10000 : 0) + x.piso * 100 + x.pos;
const dormsDe = (t) => /studio/i.test(t) ? 0 : Number(t.match(/^(\d+)/)[1]);

const disp = [], vend = [];
for (const x of datos.unidades) {
  const id = idDe(x);
  if (id == null) continue; // piso 2 posiciones 08..14: no existen
  const numero = x.slug.toUpperCase();
  if (x.http_status === 200 && !x.error) {
    disp.push({ id, numero, dorms: dormsDe(x.tipologia), precio: x.precio, m2: x.m2, tip: x.tipologia });
  } else if (x.http_status === 404) {
    vend.push({ id, numero, m2: null, motivo: '404' });
  } else if (x.error && /· UYU /.test(x.crudo)) {
    const m2 = Number(x.crudo.match(/· (\d+(?:,\d+)?) m²/)[1].replace(',', '.'));
    vend.push({ id, numero, m2, motivo: 'solo alquiler (UYU)' });
  } else throw new Error(`sin clasificar: ${x.slug}`);
}
disp.sort((a, b) => a.id - b.id); vend.sort((a, b) => a.id - b.id);
const ids = [...disp, ...vend].map((u) => u.id);
if (new Set(ids).size !== ids.length) throw new Error('id duplicado');

const fecha = datos.fecha.slice(0, 10);
const filas = (lista, f) => lista.map((u, i) => {
  const [tupla, comentario] = f(u);
  return `  ${tupla}${i < lista.length - 1 ? ',' : ''}  -- ${comentario}`;
}).join('\n');
const filasDisp = filas(disp, (u) => [`(${u.id}, '${u.numero}', ${u.dorms}, ${u.precio}, ${u.m2})`, u.tip]);
const filasVend = filas(vend, (u) => [`(${u.id}, '${u.numero}', ${u.m2 ?? 'null::numeric'})`, u.motivo]);

const sql = `-- Precios de BRUSCO desde la ficha pública de IXOU (ixou.la), corrida del ${fecha}.
-- Generado con scripts/sql-ixou-brusco.mjs a partir de datos/ixou-brusco-precios.json
-- (scripts/scrape-ixou-brusco.mjs). No editar a mano: regenerar.
--
-- Qué hace:
--   · ${disp.length} unidades publicadas en venta (precio en USD): precio, dorms,
--     estado = 'disponible', estimado = false.
--   · ${vend.length} slugs que dieron 404 o que IXOU solo publica en alquiler (UYU):
--     estado = 'vendido'. El precio no se toca. Los que no tienen fila en la base
--     (p.ej. B305/B306: el piso 3 de B tiene 4 unidades) no actualizan nada.
--   · En todas: geom.numero = número real de IXOU ("A207", "B1105", sin guion).
--     Cuando IXOU informa m², va a geom.m2_ixou — NO se pisa units.m2: IXOU publica
--     superficie total (~1,59× la interior de planos que tiene la base).
--   · geom.contorno y el resto de geom quedan intactos (merge con ||).
--
-- Nivel 2 (basamento, ids 201..214 sin torre). Mapeo acordado: cada torre se queda
-- con su mitad del anillo; los m² de Torre B dan una relación pareja (1,56–1,60) y
-- en Torre A la tipología fija el orden (1 dorm = 207, 2 dorm = 212):
--   A201=207 A202=208 A203=209 A204=210(404) A205=211 A206=212 A207=213
--   B201=214 B202=201 B203=202 B204=203 B205=204 B206=205 B207=206
-- B202 (id 201) figuraba como "Estudio" e IXOU la da como 1 dormitorio: se corrige
-- también geom.tipologia.
--
-- Todo en una transacción; se puede volver a correr sin efecto adicional.

begin;

-- units_write_scope decide con auth.uid(), que en el SQL Editor es null y rechaza
-- cualquier update ("sin permiso sobre esta unidad"). En vez de apagar el trigger,
-- esta transacción se identifica como el admin de plataforma (set_config local:
-- dura solo hasta el commit), así el trigger deja pasar por su camino normal.
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

-- Publicadas en venta
update units u set
  dorms = v.dorms,
  precio = v.precio,
  estado = 'disponible',
  estimado = false,
  geom = coalesce(u.geom, '{}'::jsonb) || jsonb_build_object('numero', v.numero, 'm2_ixou', v.m2_ixou)
from (values
${filasDisp}
) as v(id, numero, dorms, precio, m2_ixou)
where u.project_id = (select id from projects where slug = 'brusco')
  and u.id = v.id;

-- 404 o solo alquiler → vendido
update units u set
  estado = 'vendido',
  geom = coalesce(u.geom, '{}'::jsonb) || jsonb_build_object('numero', v.numero)
    || case when v.m2_ixou is null then '{}'::jsonb else jsonb_build_object('m2_ixou', v.m2_ixou) end
from (values
${filasVend}
) as v(id, numero, m2_ixou)
where u.project_id = (select id from projects where slug = 'brusco')
  and u.id = v.id;

-- B202 (id 201): Estudio → 1 dormitorio
update units set geom = geom || '{"tipologia": "1 dormitorio"}'::jsonb
where project_id = (select id from projects where slug = 'brusco') and id = 201;

-- Control: si los conteos no cierran, la excepción aborta la transacción entera.
-- Todas las publicadas en venta tienen que existir; toda la base tiene que quedar
-- disponible o vendido, con numero.
do $$
declare
  n_disp int; n_vend int; n_otros int; n_sin_numero int;
begin
  select count(*) filter (where estado = 'disponible'),
         count(*) filter (where estado = 'vendido'),
         count(*) filter (where estado not in ('disponible', 'vendido')),
         count(*) filter (where not (coalesce(geom, '{}'::jsonb) ? 'numero'))
    into n_disp, n_vend, n_otros, n_sin_numero
  from units where project_id = (select id from projects where slug = 'brusco');
  if n_disp <> ${disp.length} or n_otros <> 0 or n_sin_numero <> 0 then
    raise exception 'BRUSCO no cierra: disponible=% (esperado ${disp.length}), vendido=%, otros=%, sin numero=%',
      n_disp, n_vend, n_otros, n_sin_numero;
  end if;
  raise notice 'BRUSCO: % disponibles, % vendidas', n_disp, n_vend;
end $$;

commit;

-- Resultado (informativo)
select estado, count(*) as unidades,
       count(*) filter (where not (geom ? 'contorno')) as sin_contorno
from units
where project_id = (select id from projects where slug = 'brusco')
group by estado order by estado;
`;
writeFileSync(`${RAIZ}/supabase-brusco-precios.sql`, sql);
console.log(`supabase-brusco-precios.sql: ${disp.length} disponibles + ${vend.length} vendidas = ${ids.length}`);
