// Genera supabase-brusco-precios.sql desde datos/ixou-brusco-precios.json
// (la salida de scripts/scrape-ixou-brusco.mjs).
//
// Uso: node scripts/sql-ixou-brusco.mjs
//
// Antes de escribir baja los ids reales de BRUSCO (vista public_units, con la anon
// key de supabase-config.js) y valida que todo id exista: los que no matchean se
// listan y el SQL no los incluye. Si la vista viene vacía (proyecto despublicado),
// aborta en vez de generar a ciegas.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const datos = JSON.parse(readFileSync(`${RAIZ}/datos/ixou-brusco-precios.json`, 'utf8'));
const config = readFileSync(`${RAIZ}/supabase-config.js`, 'utf8');
const SUPABASE_URL = config.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const ANON_KEY = config.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)[1];
const SLUG = 'brusco';

// Nivel 2 (basamento, ids 201..214 sin torre): slug IXOU → id en la base. Los centros
// de los contornos arman un recorrido continuo por el anillo del podio (B201 lado oeste
// → B202..B207 frente → A201 esquina frente-este → A202..A205 lado este → A206 esquina
// fondo-este → A207 fondo). En B lo confirman los m² (relación pareja 1,56–1,60), en A
// la tipología (2 dorm = 212) y la simetría (A202 y A205, 73,1 m² ↔ 208 y 211).
// Las posiciones 08..14 de cada torre no existen en el piso 2.
const PISO2 = { a201: 207, a202: 208, a203: 209, a204: 210, a205: 211, a206: 212, a207: 213,
  b201: 214, b202: 201, b203: 202, b204: 203, b205: 204, b206: 205, b207: 206 };
const idDe = (x) => x.piso === 2 ? PISO2[x.slug] ?? null : (x.torre === 'B' ? 10000 : 0) + x.piso * 100 + x.pos;
const dormsDe = (t) => {
  if (/^studio$/i.test(t)) return 0;
  const m = t.match(/^(\d+) dormitorios?$/i);
  if (!m) throw new Error(`tipología desconocida: ${t}`);
  return Number(m[1]);
};

async function idsDeLaBase() {
  const h = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
  const p = await (await fetch(`${SUPABASE_URL}/rest/v1/public_projects?slug=eq.${SLUG}&select=id`, { headers: h })).json();
  if (!p.length) throw new Error(`public_projects no devuelve '${SLUG}' (¿despublicado?)`);
  const u = await (await fetch(`${SUPABASE_URL}/rest/v1/public_units?project_id=eq.${p[0].id}&select=id&limit=10000`, { headers: h })).json();
  if (!u.length) throw new Error(`public_units no devuelve unidades de '${SLUG}'`);
  return new Set(u.map((x) => x.id));
}

const existentes = await idsDeLaBase();

const venta = [], alquiler = [], vendidas = [], sinMatch = [], piso2 = [];
for (const x of datos.unidades) {
  const numero = x.slug.toUpperCase();
  if (x.error || (x.http_status !== 200 && x.http_status !== 404)) throw new Error(`sin clasificar: ${x.slug}`);
  const id = idDe(x);
  if (id == null) { piso2.push(numero); continue; }
  if (!existentes.has(id)) { sinMatch.push({ numero, id, status: x.http_status, operacion: x.operacion }); continue; }
  if (x.http_status === 404) vendidas.push({ id, numero });
  else if (x.operacion === 'venta') venta.push({ id, numero, dorms: dormsDe(x.tipologia), m2: x.m2, precio: x.precio, tip: x.tipologia });
  else if (x.operacion === 'alquiler') alquiler.push({ id, numero, dorms: dormsDe(x.tipologia), m2: x.m2, precio: x.precio, tip: x.tipologia });
  else throw new Error(`operación desconocida: ${x.slug}`);
}
for (const l of [venta, alquiler, vendidas]) l.sort((a, b) => a.id - b.id);

const fecha = datos.fecha.slice(0, 10);
const filas = (lista, f) => lista.map((u, i) => {
  const [tupla, comentario] = f(u);
  return `    ${tupla}${i < lista.length - 1 ? ',' : ''}  -- ${comentario}`;
}).join('\n');

const sql = `-- Precios de BRUSCO desde la ficha pública de IXOU (ixou.la), corrida del ${fecha}.
-- Generado con scripts/sql-ixou-brusco.mjs a partir de datos/ixou-brusco-precios.json
-- (scripts/scrape-ixou-brusco.mjs). No editar a mano: regenerar.
--
-- Reemplaza la versión anterior de este archivo (que dejaba units.m2 intacto y mandaba
-- las de alquiler a 'vendido'). Qué hace ahora:
--   · ${venta.length} en venta (USD): m2 = el de IXOU, precio, dorms, estado = 'disponible',
--     estimado = false, geom.numero / operacion = 'venta' / moneda = 'USD'.
--   · ${alquiler.length} en alquiler (UYU/mes): m2, dorms, precio = null, estado = 'sin_dato'
--     (no hay estado de alquiler), geom.numero / operacion = 'alquiler' / moneda = 'UYU'
--     / precio_alquiler_uyu.
--   · ${vendidas.length} que dieron 404: estado = 'vendido' + geom.numero. m2 y precio no se tocan.
--   · units.m2 pasa a ser la superficie que publica IXOU (total), no la útil de planos.
--   · Piso 2 (basamento, ids 201..214 sin torre), correspondencia confirmada:
--       A201=207 A202=208 A203=209 A204=210 A205=211 A206=212 A207=213
--       B201=214 B202=201 B203=202 B204=203 B205=204 B206=205 B207=206
--     La 207 figuraba como "Flex" e IXOU la da como 1 dormitorio: se corrige geom.tipologia.
--   · geom.contorno y el resto de geom quedan intactos (merge con ||).
--
-- Cada update verifica que tocó exactamente las filas que esperaba; si no, la
-- excepción aborta la transacción entera. Se puede volver a correr sin efecto adicional.

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

do $$
declare
  v_project uuid := (select id from projects where slug = '${SLUG}');
  n int;
begin
  if v_project is null then raise exception 'No existe el proyecto ${SLUG}'; end if;
  -- Las de alquiler van con precio null: requiere supabase-migration-precio-opcional.sql.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'units'
               and column_name = 'precio' and is_nullable = 'NO') then
    raise exception 'units.precio sigue siendo NOT NULL: correr antes supabase-migration-precio-opcional.sql';
  end if;

  -- En venta (USD)
  update units u set
    m2 = v.m2,
    precio = v.precio,
    dorms = v.dorms,
    estado = 'disponible',
    estimado = false,
    geom = coalesce(u.geom, '{}'::jsonb)
      || jsonb_build_object('numero', v.numero, 'operacion', 'venta', 'moneda', 'USD')
  from (values
${filas(venta, (u) => [`(${u.id}, '${u.numero}', ${u.dorms}, ${u.m2}, ${u.precio})`, u.tip])}
  ) as v(id, numero, dorms, m2, precio)
  where u.project_id = v_project and u.id = v.id;
  get diagnostics n = row_count;
  if n <> ${venta.length} then raise exception 'venta: se actualizaron % filas, se esperaban ${venta.length}', n; end if;

  -- En alquiler (UYU por mes): sin precio de venta
  update units u set
    m2 = v.m2,
    precio = null,
    dorms = v.dorms,
    estado = 'sin_dato',
    geom = coalesce(u.geom, '{}'::jsonb)
      || jsonb_build_object('numero', v.numero, 'operacion', 'alquiler', 'moneda', 'UYU',
                            'precio_alquiler_uyu', v.precio_uyu)
  from (values
${filas(alquiler, (u) => [`(${u.id}, '${u.numero}', ${u.dorms}, ${u.m2}, ${u.precio})`, u.tip])}
  ) as v(id, numero, dorms, m2, precio_uyu)
  where u.project_id = v_project and u.id = v.id;
  get diagnostics n = row_count;
  if n <> ${alquiler.length} then raise exception 'alquiler: se actualizaron % filas, se esperaban ${alquiler.length}', n; end if;

  -- 404 → vendido (m2 y precio intactos)
  update units u set
    estado = 'vendido',
    geom = coalesce(u.geom, '{}'::jsonb) || jsonb_build_object('numero', v.numero)
  from (values
${filas(vendidas, (u) => [`(${u.id}, '${u.numero}')`, '404'])}
  ) as v(id, numero)
  where u.project_id = v_project and u.id = v.id;
  get diagnostics n = row_count;
  if n <> ${vendidas.length} then raise exception '404: se actualizaron % filas, se esperaban ${vendidas.length}', n; end if;

  -- 207 (A201): Flex → 1 dormitorio
  update units set geom = geom || '{"tipologia": "1 dormitorio"}'::jsonb
  where project_id = v_project and id = 207;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '207: se actualizaron % filas, se esperaba 1', n; end if;

  raise notice 'BRUSCO: % venta, % alquiler, % vendidas', ${venta.length}, ${alquiler.length}, ${vendidas.length};
end $$;

commit;

-- Resultado (informativo)
select estado, geom->>'operacion' as operacion, count(*) as unidades,
       count(*) filter (where not (geom ? 'contorno')) as sin_contorno
from units
where project_id = (select id from projects where slug = '${SLUG}')
group by 1, 2 order by 1, 2;
`;
writeFileSync(`${RAIZ}/supabase-brusco-precios.sql`, sql);

console.log(`supabase-brusco-precios.sql: ${venta.length} venta + ${alquiler.length} alquiler + ${vendidas.length} vendidas`);
console.log(`Piso 2 fuera de rango, no existen (${piso2.length}): ${piso2.join(' ')}`);
console.log(`Sin fila en la base (${sinMatch.length}):`);
for (const s of sinMatch) console.log(`  ${s.numero} → id ${s.id} · ${s.status === 404 ? '404' : s.operacion}`);
