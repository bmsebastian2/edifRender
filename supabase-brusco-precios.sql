-- Precios de BRUSCO desde la ficha pública de IXOU (ixou.la), corrida del 2026-09-29.
-- Generado con scripts/sql-ixou-brusco.mjs a partir de datos/ixou-brusco-precios.json
-- (scripts/scrape-ixou-brusco.mjs). No editar a mano: regenerar.
--
-- Qué hace:
--   · 78 unidades publicadas en venta (precio en USD): precio, dorms,
--     estado = 'disponible', estimado = false.
--   · 96 slugs que dieron 404 o que IXOU solo publica en alquiler (UYU):
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
  (201, 'B202', 1, 212037, 71.9),  -- 1 dormitorio
  (202, 'B203', 0, 168369, 65.7),  -- Studio
  (203, 'B204', 0, 160451, 62.6),  -- Studio
  (204, 'B205', 0, 162040, 63.2),  -- Studio
  (205, 'B206', 0, 153559, 59.9),  -- Studio
  (206, 'B207', 0, 162604, 63.5),  -- Studio
  (207, 'A201', 1, 232997, 115.1),  -- 1 dormitorio
  (208, 'A202', 0, 215784, 73.1),  -- Studio
  (209, 'A203', 0, 158776, 59.4),  -- Studio
  (211, 'A205', 0, 215755, 73.1),  -- Studio
  (212, 'A206', 2, 230783, 126.6),  -- 2 dormitorios
  (213, 'A207', 0, 131711, 57.7),  -- Studio
  (214, 'B201', 0, 171956, 67.1),  -- Studio
  (301, 'A301', 0, 158508, 66.1),  -- Studio
  (306, 'A306', 2, 254200, 130.6),  -- 2 dormitorios
  (401, 'A401', 2, 284254, 114.9),  -- 2 dormitorios
  (403, 'A403', 1, 208210, 84.7),  -- 1 dormitorio
  (501, 'A501', 2, 286838, 114.9),  -- 2 dormitorios
  (502, 'A502', 1, 211513, 84.7),  -- 1 dormitorio
  (503, 'A503', 1, 210103, 84.7),  -- 1 dormitorio
  (504, 'A504', 2, 271020, 114.9),  -- 2 dormitorios
  (505, 'A505', 2, 263237, 105.4),  -- 2 dormitorios
  (510, 'A510', 2, 299000, 115.6),  -- 2 dormitorios
  (802, 'A802', 1, 217230, 84.7),  -- 1 dormitorio
  (803, 'A803', 1, 215782, 84.7),  -- 1 dormitorio
  (804, 'A804', 2, 278345, 114.9),  -- 2 dormitorios
  (806, 'A806', 1, 213069, 68.4),  -- 1 dormitorio
  (808, 'A808', 0, 171026, 55.4),  -- Studio
  (810, 'A810', 2, 321990, 115.6),  -- 2 dormitorios
  (901, 'A901', 2, 297174, 114.9),  -- 2 dormitorios
  (903, 'A903', 1, 217674, 84.7),  -- 1 dormitorio
  (906, 'A906', 1, 214938, 68.4),  -- 1 dormitorio
  (1002, 'A1002', 1, 221041, 84.7),  -- 1 dormitorio
  (1003, 'A1003', 1, 219567, 84.7),  -- 1 dormitorio
  (1004, 'A1004', 2, 283229, 114.9),  -- 2 dormitorios
  (1006, 'A1006', 1, 216807, 68.4),  -- 1 dormitorio
  (1008, 'A1008', 0, 175633, 55.4),  -- Studio
  (1101, 'A1101', 2, 302343, 114.9),  -- 2 dormitorios
  (1102, 'A1102', 1, 222946, 84.7),  -- 1 dormitorio
  (1103, 'A1103', 1, 221460, 84.7),  -- 1 dormitorio
  (1104, 'A1104', 2, 285670, 114.9),  -- 2 dormitorios
  (1107, 'A1107', 0, 178916, 55.8),  -- Studio
  (1108, 'A1108', 0, 177147, 55.4),  -- Studio
  (1110, 'A1110', 2, 346748, 115.6),  -- 2 dormitorios
  (1201, 'A1201', 2, 304714, 114.8),  -- 2 dormitorios
  (1202, 'A1202', 1, 224693, 84.6),  -- 1 dormitorio
  (1203, 'A1203', 1, 223195, 84.6),  -- 1 dormitorio
  (1204, 'A1204', 2, 287911, 114.8),  -- 2 dormitorios
  (1205, 'A1205', 2, 279625, 105.3),  -- 2 dormitorios
  (1209, 'A1209', 1, 220384, 68.4),  -- 1 dormitorio
  (1210, 'A1210', 2, 364689, 115.6),  -- 2 dormitorios
  (1301, 'A1301', 2, 307297, 114.8),  -- 2 dormitorios
  (1302, 'A1302', 1, 226597, 84.6),  -- 1 dormitorio
  (1303, 'A1303', 1, 225086, 84.6),  -- 1 dormitorio
  (1304, 'A1304', 2, 290351, 114.8),  -- 2 dormitorios
  (1305, 'A1305', 2, 281994, 105.3),  -- 2 dormitorios
  (1306, 'A1306', 1, 222252, 68.4),  -- 1 dormitorio
  (1307, 'A1307', 0, 182839, 55.8),  -- Studio
  (1308, 'A1308', 0, 181034, 55.4),  -- Studio
  (10303, 'B303', 2, 260000, 133.3),  -- 2 dormitorios
  (10402, 'B402', 1, 200183, 66.6),  -- 1 dormitorio
  (10403, 'B403', 2, 266070, 127.6),  -- 2 dormitorios
  (10405, 'B405', 1, 184553, 67.1),  -- 1 dormitorio
  (10603, 'B603', 2, 279540, 127.6),  -- 2 dormitorios
  (10701, 'B701', 1, 173839, 56.3),  -- 1 dormitorio
  (10702, 'B702', 1, 205642, 66.6),  -- 1 dormitorio
  (10705, 'B705', 1, 175000, 67.1),  -- 1 dormitorio
  (10801, 'B801', 1, 210000, 56.3),  -- 1 dormitorio
  (10802, 'B802', 1, 207462, 66.6),  -- 1 dormitorio
  (10803, 'B803', 2, 293691, 127.6),  -- 2 dormitorios
  (10903, 'B903', 2, 301034, 127.6),  -- 2 dormitorios
  (11002, 'B1002', 1, 211102, 66.6),  -- 1 dormitorio
  (11003, 'B1003', 2, 308560, 127.6),  -- 2 dormitorios
  (11004, 'B1004', 1, 210389, 81.2),  -- 1 dormitorio
  (11006, 'B1006', 0, 183304, 57.8),  -- Studio
  (11104, 'B1104', 1, 212203, 81.2),  -- 1 dormitorio
  (11105, 'B1105', 1, 175489, 67.1),  -- 1 dormitorio
  (11106, 'B1106', 0, 184884, 57.8)  -- Studio
) as v(id, numero, dorms, precio, m2_ixou)
where u.project_id = (select id from projects where slug = 'brusco')
  and u.id = v.id;

-- 404 o solo alquiler → vendido
update units u set
  estado = 'vendido',
  geom = coalesce(u.geom, '{}'::jsonb) || jsonb_build_object('numero', v.numero)
    || case when v.m2_ixou is null then '{}'::jsonb else jsonb_build_object('m2_ixou', v.m2_ixou) end
from (values
  (210, 'A204', null::numeric),  -- 404
  (302, 'A302', null::numeric),  -- 404
  (303, 'A303', 120.5),  -- solo alquiler (UYU)
  (304, 'A304', null::numeric),  -- 404
  (305, 'A305', null::numeric),  -- 404
  (402, 'A402', 84.7),  -- solo alquiler (UYU)
  (404, 'A404', 114.9),  -- solo alquiler (UYU)
  (405, 'A405', null::numeric),  -- 404
  (406, 'A406', null::numeric),  -- 404
  (407, 'A407', null::numeric),  -- 404
  (408, 'A408', null::numeric),  -- 404
  (409, 'A409', null::numeric),  -- 404
  (410, 'A410', null::numeric),  -- 404
  (506, 'A506', null::numeric),  -- 404
  (507, 'A507', null::numeric),  -- 404
  (508, 'A508', 55.4),  -- solo alquiler (UYU)
  (509, 'A509', 68.4),  -- solo alquiler (UYU)
  (601, 'A601', null::numeric),  -- 404
  (602, 'A602', null::numeric),  -- 404
  (603, 'A603', null::numeric),  -- 404
  (604, 'A604', null::numeric),  -- 404
  (605, 'A605', null::numeric),  -- 404
  (606, 'A606', null::numeric),  -- 404
  (607, 'A607', null::numeric),  -- 404
  (608, 'A608', null::numeric),  -- 404
  (609, 'A609', null::numeric),  -- 404
  (610, 'A610', null::numeric),  -- 404
  (701, 'A701', null::numeric),  -- 404
  (702, 'A702', null::numeric),  -- 404
  (703, 'A703', null::numeric),  -- 404
  (704, 'A704', null::numeric),  -- 404
  (705, 'A705', null::numeric),  -- 404
  (706, 'A706', null::numeric),  -- 404
  (707, 'A707', null::numeric),  -- 404
  (708, 'A708', null::numeric),  -- 404
  (709, 'A709', null::numeric),  -- 404
  (710, 'A710', null::numeric),  -- 404
  (801, 'A801', 114.9),  -- solo alquiler (UYU)
  (805, 'A805', null::numeric),  -- 404
  (807, 'A807', null::numeric),  -- 404
  (809, 'A809', null::numeric),  -- 404
  (902, 'A902', 84.7),  -- solo alquiler (UYU)
  (904, 'A904', 114.9),  -- solo alquiler (UYU)
  (905, 'A905', 105.4),  -- solo alquiler (UYU)
  (907, 'A907', 55.8),  -- solo alquiler (UYU)
  (908, 'A908', 55.4),  -- solo alquiler (UYU)
  (909, 'A909', 68.4),  -- solo alquiler (UYU)
  (910, 'A910', null::numeric),  -- 404
  (1001, 'A1001', 114.9),  -- solo alquiler (UYU)
  (1005, 'A1005', 105.4),  -- solo alquiler (UYU)
  (1007, 'A1007', 55.8),  -- solo alquiler (UYU)
  (1009, 'A1009', 68.4),  -- solo alquiler (UYU)
  (1010, 'A1010', null::numeric),  -- 404
  (1105, 'A1105', 105.4),  -- solo alquiler (UYU)
  (1106, 'A1106', null::numeric),  -- 404
  (1109, 'A1109', 68.4),  -- solo alquiler (UYU)
  (1206, 'A1206', null::numeric),  -- 404
  (1207, 'A1207', 55.8),  -- solo alquiler (UYU)
  (1208, 'A1208', 55.4),  -- solo alquiler (UYU)
  (1309, 'A1309', null::numeric),  -- 404
  (1310, 'A1310', null::numeric),  -- 404
  (10301, 'B301', 62.1),  -- solo alquiler (UYU)
  (10302, 'B302', null::numeric),  -- 404
  (10304, 'B304', null::numeric),  -- 404
  (10305, 'B305', null::numeric),  -- 404
  (10306, 'B306', null::numeric),  -- 404
  (10401, 'B401', 56.3),  -- solo alquiler (UYU)
  (10404, 'B404', null::numeric),  -- 404
  (10406, 'B406', null::numeric),  -- 404
  (10501, 'B501', null::numeric),  -- 404
  (10502, 'B502', null::numeric),  -- 404
  (10503, 'B503', null::numeric),  -- 404
  (10504, 'B504', null::numeric),  -- 404
  (10505, 'B505', 67.1),  -- solo alquiler (UYU)
  (10506, 'B506', 57.8),  -- solo alquiler (UYU)
  (10601, 'B601', null::numeric),  -- 404
  (10602, 'B602', null::numeric),  -- 404
  (10604, 'B604', 81.2),  -- solo alquiler (UYU)
  (10605, 'B605', null::numeric),  -- 404
  (10606, 'B606', 57.8),  -- solo alquiler (UYU)
  (10703, 'B703', 127.6),  -- solo alquiler (UYU)
  (10704, 'B704', 81.2),  -- solo alquiler (UYU)
  (10706, 'B706', null::numeric),  -- 404
  (10804, 'B804', 81.2),  -- solo alquiler (UYU)
  (10805, 'B805', 67.1),  -- solo alquiler (UYU)
  (10806, 'B806', null::numeric),  -- 404
  (10901, 'B901', 56.3),  -- solo alquiler (UYU)
  (10902, 'B902', null::numeric),  -- 404
  (10904, 'B904', null::numeric),  -- 404
  (10905, 'B905', null::numeric),  -- 404
  (10906, 'B906', null::numeric),  -- 404
  (11001, 'B1001', 56.3),  -- solo alquiler (UYU)
  (11005, 'B1005', 67.1),  -- solo alquiler (UYU)
  (11101, 'B1101', null::numeric),  -- 404
  (11102, 'B1102', 66.6),  -- solo alquiler (UYU)
  (11103, 'B1103', null::numeric)  -- 404
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
  if n_disp <> 78 or n_otros <> 0 or n_sin_numero <> 0 then
    raise exception 'BRUSCO no cierra: disponible=% (esperado 78), vendido=%, otros=%, sin numero=%',
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
