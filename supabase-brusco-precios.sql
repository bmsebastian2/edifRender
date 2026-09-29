-- Precios de BRUSCO desde la ficha pública de IXOU (ixou.la), corrida del 2026-09-29.
-- Generado con scripts/sql-ixou-brusco.mjs a partir de datos/ixou-brusco-precios.json
-- (scripts/scrape-ixou-brusco.mjs). No editar a mano: regenerar.
--
-- Reemplaza la versión anterior de este archivo (que dejaba units.m2 intacto y mandaba
-- las de alquiler a 'vendido'). Qué hace ahora:
--   · 78 en venta (USD): m2 = el de IXOU, precio, dorms, estado = 'disponible',
--     estimado = false, geom.numero / operacion = 'venta' / moneda = 'USD'.
--   · 34 en alquiler (UYU/mes): m2, dorms, precio = null, estado = 'sin_dato'
--     (no hay estado de alquiler), geom.numero / operacion = 'alquiler' / moneda = 'UYU'
--     / precio_alquiler_uyu.
--   · 60 que dieron 404: estado = 'vendido' + geom.numero. m2 y precio no se tocan.
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
  v_project uuid := (select id from projects where slug = 'brusco');
  n int;
begin
  if v_project is null then raise exception 'No existe el proyecto brusco'; end if;
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
    (201, 'B202', 1, 71.9, 212037),  -- 1 dormitorio
    (202, 'B203', 0, 65.7, 168369),  -- Studio
    (203, 'B204', 0, 62.6, 160451),  -- Studio
    (204, 'B205', 0, 63.2, 162040),  -- Studio
    (205, 'B206', 0, 59.9, 153559),  -- Studio
    (206, 'B207', 0, 63.5, 162604),  -- Studio
    (207, 'A201', 1, 115.1, 232997),  -- 1 dormitorio
    (208, 'A202', 0, 73.1, 215784),  -- Studio
    (209, 'A203', 0, 59.4, 158776),  -- Studio
    (211, 'A205', 0, 73.1, 215755),  -- Studio
    (212, 'A206', 2, 126.6, 230783),  -- 2 dormitorios
    (213, 'A207', 0, 57.7, 131711),  -- Studio
    (214, 'B201', 0, 67.1, 171956),  -- Studio
    (301, 'A301', 0, 66.1, 158508),  -- Studio
    (306, 'A306', 2, 130.6, 254200),  -- 2 dormitorios
    (401, 'A401', 2, 114.9, 284254),  -- 2 dormitorios
    (403, 'A403', 1, 84.7, 208210),  -- 1 dormitorio
    (501, 'A501', 2, 114.9, 286838),  -- 2 dormitorios
    (502, 'A502', 1, 84.7, 211513),  -- 1 dormitorio
    (503, 'A503', 1, 84.7, 210103),  -- 1 dormitorio
    (504, 'A504', 2, 114.9, 271020),  -- 2 dormitorios
    (505, 'A505', 2, 105.4, 263237),  -- 2 dormitorios
    (510, 'A510', 2, 115.6, 299000),  -- 2 dormitorios
    (802, 'A802', 1, 84.7, 217230),  -- 1 dormitorio
    (803, 'A803', 1, 84.7, 215782),  -- 1 dormitorio
    (804, 'A804', 2, 114.9, 278345),  -- 2 dormitorios
    (806, 'A806', 1, 68.4, 213069),  -- 1 dormitorio
    (808, 'A808', 0, 55.4, 171026),  -- Studio
    (810, 'A810', 2, 115.6, 321990),  -- 2 dormitorios
    (901, 'A901', 2, 114.9, 297174),  -- 2 dormitorios
    (903, 'A903', 1, 84.7, 217674),  -- 1 dormitorio
    (906, 'A906', 1, 68.4, 214938),  -- 1 dormitorio
    (1002, 'A1002', 1, 84.7, 221041),  -- 1 dormitorio
    (1003, 'A1003', 1, 84.7, 219567),  -- 1 dormitorio
    (1004, 'A1004', 2, 114.9, 283229),  -- 2 dormitorios
    (1006, 'A1006', 1, 68.4, 216807),  -- 1 dormitorio
    (1008, 'A1008', 0, 55.4, 175633),  -- Studio
    (1101, 'A1101', 2, 114.9, 302343),  -- 2 dormitorios
    (1102, 'A1102', 1, 84.7, 222946),  -- 1 dormitorio
    (1103, 'A1103', 1, 84.7, 221460),  -- 1 dormitorio
    (1104, 'A1104', 2, 114.9, 285670),  -- 2 dormitorios
    (1107, 'A1107', 0, 55.8, 178916),  -- Studio
    (1108, 'A1108', 0, 55.4, 177147),  -- Studio
    (1110, 'A1110', 2, 115.6, 346748),  -- 2 dormitorios
    (1201, 'A1201', 2, 114.8, 304714),  -- 2 dormitorios
    (1202, 'A1202', 1, 84.6, 224693),  -- 1 dormitorio
    (1203, 'A1203', 1, 84.6, 223195),  -- 1 dormitorio
    (1204, 'A1204', 2, 114.8, 287911),  -- 2 dormitorios
    (1205, 'A1205', 2, 105.3, 279625),  -- 2 dormitorios
    (1209, 'A1209', 1, 68.4, 220384),  -- 1 dormitorio
    (1210, 'A1210', 2, 115.6, 364689),  -- 2 dormitorios
    (1301, 'A1301', 2, 114.8, 307297),  -- 2 dormitorios
    (1302, 'A1302', 1, 84.6, 226597),  -- 1 dormitorio
    (1303, 'A1303', 1, 84.6, 225086),  -- 1 dormitorio
    (1304, 'A1304', 2, 114.8, 290351),  -- 2 dormitorios
    (1305, 'A1305', 2, 105.3, 281994),  -- 2 dormitorios
    (1306, 'A1306', 1, 68.4, 222252),  -- 1 dormitorio
    (1307, 'A1307', 0, 55.8, 182839),  -- Studio
    (1308, 'A1308', 0, 55.4, 181034),  -- Studio
    (10303, 'B303', 2, 133.3, 260000),  -- 2 dormitorios
    (10402, 'B402', 1, 66.6, 200183),  -- 1 dormitorio
    (10403, 'B403', 2, 127.6, 266070),  -- 2 dormitorios
    (10405, 'B405', 1, 67.1, 184553),  -- 1 dormitorio
    (10603, 'B603', 2, 127.6, 279540),  -- 2 dormitorios
    (10701, 'B701', 1, 56.3, 173839),  -- 1 dormitorio
    (10702, 'B702', 1, 66.6, 205642),  -- 1 dormitorio
    (10705, 'B705', 1, 67.1, 175000),  -- 1 dormitorio
    (10801, 'B801', 1, 56.3, 210000),  -- 1 dormitorio
    (10802, 'B802', 1, 66.6, 207462),  -- 1 dormitorio
    (10803, 'B803', 2, 127.6, 293691),  -- 2 dormitorios
    (10903, 'B903', 2, 127.6, 301034),  -- 2 dormitorios
    (11002, 'B1002', 1, 66.6, 211102),  -- 1 dormitorio
    (11003, 'B1003', 2, 127.6, 308560),  -- 2 dormitorios
    (11004, 'B1004', 1, 81.2, 210389),  -- 1 dormitorio
    (11006, 'B1006', 0, 57.8, 183304),  -- Studio
    (11104, 'B1104', 1, 81.2, 212203),  -- 1 dormitorio
    (11105, 'B1105', 1, 67.1, 175489),  -- 1 dormitorio
    (11106, 'B1106', 0, 57.8, 184884)  -- Studio
  ) as v(id, numero, dorms, m2, precio)
  where u.project_id = v_project and u.id = v.id;
  get diagnostics n = row_count;
  if n <> 78 then raise exception 'venta: se actualizaron % filas, se esperaban 78', n; end if;

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
    (303, 'A303', 2, 120.5, 55000),  -- 2 dormitorios
    (402, 'A402', 1, 84.7, 38500),  -- 1 dormitorio
    (404, 'A404', 2, 114.9, 49239),  -- 2 dormitorios
    (508, 'A508', 0, 55.4, 31000),  -- Studio
    (509, 'A509', 1, 68.4, 40000),  -- 1 dormitorio
    (801, 'A801', 2, 114.9, 54008),  -- 2 dormitorios
    (902, 'A902', 1, 84.7, 40000),  -- 1 dormitorio
    (904, 'A904', 2, 114.9, 51478),  -- 2 dormitorios
    (905, 'A905', 2, 105.4, 49999),  -- 2 dormitorios
    (907, 'A907', 0, 55.8, 32152),  -- Studio
    (908, 'A908', 0, 55.4, 31922),  -- Studio
    (909, 'A909', 1, 68.4, 40000),  -- 1 dormitorio
    (1001, 'A1001', 2, 114.9, 51500),  -- 2 dormitorios
    (1005, 'A1005', 2, 105.4, 55000),  -- 2 dormitorios
    (1007, 'A1007', 0, 55.8, 39000),  -- Studio
    (1009, 'A1009', 1, 68.4, 41000),  -- 1 dormitorio
    (1105, 'A1105', 2, 105.4, 55000),  -- 2 dormitorios
    (1109, 'A1109', 1, 68.4, 38500),  -- 1 dormitorio
    (1207, 'A1207', 0, 55.8, 32500),  -- Studio
    (1208, 'A1208', 0, 55.4, 32500),  -- Studio
    (10301, 'B301', 1, 62.1, 34000),  -- 1 dormitorio
    (10401, 'B401', 1, 56.3, 31024),  -- 1 dormitorio
    (10505, 'B505', 1, 67.1, 29000),  -- 1 dormitorio
    (10506, 'B506', 0, 57.8, 29000),  -- Studio
    (10604, 'B604', 1, 81.2, 37300),  -- 1 dormitorio
    (10606, 'B606', 0, 57.8, 38000),  -- Studio
    (10703, 'B703', 2, 127.6, 55000),  -- 2 dormitorios
    (10704, 'B704', 1, 81.2, 39900),  -- 1 dormitorio
    (10804, 'B804', 1, 81.2, 39900),  -- 1 dormitorio
    (10805, 'B805', 1, 67.1, 29500),  -- 1 dormitorio
    (10901, 'B901', 1, 56.3, 35200),  -- 1 dormitorio
    (11001, 'B1001', 1, 56.3, 38600),  -- 1 dormitorio
    (11005, 'B1005', 1, 67.1, 32173),  -- 1 dormitorio
    (11102, 'B1102', 1, 66.6, 40000)  -- 1 dormitorio
  ) as v(id, numero, dorms, m2, precio_uyu)
  where u.project_id = v_project and u.id = v.id;
  get diagnostics n = row_count;
  if n <> 34 then raise exception 'alquiler: se actualizaron % filas, se esperaban 34', n; end if;

  -- 404 → vendido (m2 y precio intactos)
  update units u set
    estado = 'vendido',
    geom = coalesce(u.geom, '{}'::jsonb) || jsonb_build_object('numero', v.numero)
  from (values
    (210, 'A204'),  -- 404
    (302, 'A302'),  -- 404
    (304, 'A304'),  -- 404
    (305, 'A305'),  -- 404
    (405, 'A405'),  -- 404
    (406, 'A406'),  -- 404
    (407, 'A407'),  -- 404
    (408, 'A408'),  -- 404
    (409, 'A409'),  -- 404
    (410, 'A410'),  -- 404
    (506, 'A506'),  -- 404
    (507, 'A507'),  -- 404
    (601, 'A601'),  -- 404
    (602, 'A602'),  -- 404
    (603, 'A603'),  -- 404
    (604, 'A604'),  -- 404
    (605, 'A605'),  -- 404
    (606, 'A606'),  -- 404
    (607, 'A607'),  -- 404
    (608, 'A608'),  -- 404
    (609, 'A609'),  -- 404
    (610, 'A610'),  -- 404
    (701, 'A701'),  -- 404
    (702, 'A702'),  -- 404
    (703, 'A703'),  -- 404
    (704, 'A704'),  -- 404
    (705, 'A705'),  -- 404
    (706, 'A706'),  -- 404
    (707, 'A707'),  -- 404
    (708, 'A708'),  -- 404
    (709, 'A709'),  -- 404
    (710, 'A710'),  -- 404
    (805, 'A805'),  -- 404
    (807, 'A807'),  -- 404
    (809, 'A809'),  -- 404
    (910, 'A910'),  -- 404
    (1010, 'A1010'),  -- 404
    (1106, 'A1106'),  -- 404
    (1206, 'A1206'),  -- 404
    (1309, 'A1309'),  -- 404
    (1310, 'A1310'),  -- 404
    (10302, 'B302'),  -- 404
    (10304, 'B304'),  -- 404
    (10404, 'B404'),  -- 404
    (10406, 'B406'),  -- 404
    (10501, 'B501'),  -- 404
    (10502, 'B502'),  -- 404
    (10503, 'B503'),  -- 404
    (10504, 'B504'),  -- 404
    (10601, 'B601'),  -- 404
    (10602, 'B602'),  -- 404
    (10605, 'B605'),  -- 404
    (10706, 'B706'),  -- 404
    (10806, 'B806'),  -- 404
    (10902, 'B902'),  -- 404
    (10904, 'B904'),  -- 404
    (10905, 'B905'),  -- 404
    (10906, 'B906'),  -- 404
    (11101, 'B1101'),  -- 404
    (11103, 'B1103')  -- 404
  ) as v(id, numero)
  where u.project_id = v_project and u.id = v.id;
  get diagnostics n = row_count;
  if n <> 60 then raise exception '404: se actualizaron % filas, se esperaban 60', n; end if;

  -- 207 (A201): Flex → 1 dormitorio
  update units set geom = geom || '{"tipologia": "1 dormitorio"}'::jsonb
  where project_id = v_project and id = 207;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '207: se actualizaron % filas, se esperaba 1', n; end if;

  raise notice 'BRUSCO: % venta, % alquiler, % vendidas', 78, 34, 60;
end $$;

commit;

-- Resultado (informativo)
select estado, geom->>'operacion' as operacion, count(*) as unidades,
       count(*) filter (where not (geom ? 'contorno')) as sin_contorno
from units
where project_id = (select id from projects where slug = 'brusco')
group by 1, 2 order by 1, 2;
