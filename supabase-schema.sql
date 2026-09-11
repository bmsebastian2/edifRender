-- ROSSO by Block — esquema mínimo para reemplazar los datos hardcodeados
-- del HTML por una tabla editable a mano desde admin.html.
--
-- Cómo usarlo:
--   1. Creá un proyecto nuevo en supabase.com (gratis).
--   2. Project Settings → API: copiá "Project URL" y "anon public key" a
--      supabase-config.js (en este mismo repo).
--   3. SQL Editor → pegá este archivo completo → Run.
--
-- No hay sincronización automática con ninguna planilla: el estado se edita
-- a mano desde admin.html. Es la base para, más adelante, conectar n8n desde
-- Google Sheets sin tocar el front-end del edificio.

create table units (
  id           integer primary key,        -- piso*100 + pos (o 1000+pos en el piso 10)
  piso         integer not null,
  pos          integer not null,
  col          numeric not null,           -- posición en la planta, ver TORRE en index.html
  frente       integer not null,           -- -1 frente, 1 contrafrente
  dorms        integer not null,
  m2           numeric not null,
  orientacion  text not null,
  precio       numeric not null,
  estimado     boolean not null default false,
  estado       text not null default 'sin_dato'
               check (estado in ('disponible', 'reservado', 'vendido', 'sin_dato')),
  m2_terraza      numeric,           -- desglose opcional; m2 sigue siendo la superficie total
  cochera_precio  numeric            -- USD de la cochera opcional, cuando se conoce
);

-- Un evento por cada vez que alguien abre el panel de una unidad.
-- Es la base de "qué tipología / piso / orientación concentra los clics".
create table events (
  id         bigserial primary key,
  unit_id    integer not null references units(id) on delete cascade,
  tipo       text not null default 'click',
  creado_en  timestamptz not null default now()
);
create index events_unit_id_idx on events (unit_id);

-- Fila única de configuración del sitio (redes sociales, etc.), editable
-- desde la pestaña "Redes" de admin.html. Los campos vacíos ('') hacen que
-- index.html oculte ese ícono en vez de mostrar un link roto.
create table settings (
  id         integer primary key default 1,
  instagram  text not null default '',
  youtube    text not null default '',
  sitio_web  text not null default '',
  constraint settings_fila_unica check (id = 1)
);

alter table units enable row level security;
alter table events enable row level security;
alter table settings enable row level security;

-- Lectura pública de unidades: la necesita tanto index.html (el edificio)
-- como admin.html (el panel).
create policy "units_select_publico" on units
  for select using (true);

-- admin.html pide login (Supabase Auth) antes de dejar tocar nada: solo un
-- usuario autenticado (creado a mano en Authentication → Users) puede
-- actualizar `estado`, `m2_terraza` y `cochera_precio`. El público (anon)
-- solo puede leer. Para no dejar la puerta abierta a que alguien reescriba
-- precio/m2/orientación desde la consola del navegador, el permiso de
-- UPDATE se limita además a esas columnas a nivel de Postgres (no alcanza
-- con la policy: hace falta el REVOKE/GRANT de abajo).
create policy "units_update_estado" on units
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
revoke update on units from anon, authenticated;
grant update (estado, m2_terraza, cochera_precio) on units to authenticated;

-- Cualquiera puede loggear que abrió una unidad, y el panel puede leer
-- los eventos para armar las estadísticas. Sin login, esto es visible
-- para cualquiera que tenga el link a admin.html — ver la nota en esa
-- página sobre agregar Supabase Auth antes de un cliente real.
create policy "events_insert_publico" on events
  for insert with check (true);
create policy "events_select_publico" on events
  for select using (true);

-- Igual que units: lectura pública, edición solo para el equipo logueado.
create policy "settings_select_publico" on settings
  for select using (true);
create policy "settings_update_auth" on settings
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Seed: los mismos 78 registros que hoy están hardcodeados en el HTML
-- (PLANTA + PENTHOUSE + PUBLICADAS), para no perder el estado de la demo.
insert into units (id, piso, pos, col, frente, dorms, m2, orientacion, precio, estimado, estado) values
(101, 1, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(102, 1, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'sin_dato'),
(103, 1, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'sin_dato'),
(104, 1, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'sin_dato'),
(105, 1, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'sin_dato'),
(106, 1, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'sin_dato'),
(107, 1, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'sin_dato'),
(108, 1, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'sin_dato'),
(201, 2, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(202, 2, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'sin_dato'),
(203, 2, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'sin_dato'),
(204, 2, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'disponible'),
(205, 2, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'sin_dato'),
(206, 2, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'sin_dato'),
(207, 2, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'sin_dato'),
(208, 2, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'sin_dato'),
(301, 3, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(302, 3, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'sin_dato'),
(303, 3, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'sin_dato'),
(304, 3, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'sin_dato'),
(305, 3, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'sin_dato'),
(306, 3, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'disponible'),
(307, 3, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'sin_dato'),
(308, 3, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'sin_dato'),
(401, 4, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(402, 4, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'disponible'),
(403, 4, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'sin_dato'),
(404, 4, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'sin_dato'),
(405, 4, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'sin_dato'),
(406, 4, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'sin_dato'),
(407, 4, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'sin_dato'),
(408, 4, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'sin_dato'),
(501, 5, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(502, 5, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'sin_dato'),
(503, 5, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'disponible'),
(504, 5, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'sin_dato'),
(505, 5, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'sin_dato'),
(506, 5, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'sin_dato'),
(507, 5, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'sin_dato'),
(508, 5, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'disponible'),
(601, 6, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(602, 6, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'sin_dato'),
(603, 6, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'sin_dato'),
(604, 6, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'sin_dato'),
(605, 6, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'disponible'),
(606, 6, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'sin_dato'),
(607, 6, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'sin_dato'),
(608, 6, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'sin_dato'),
(701, 7, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(702, 7, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'sin_dato'),
(703, 7, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'disponible'),
(704, 7, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'sin_dato'),
(705, 7, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'sin_dato'),
(706, 7, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'sin_dato'),
(707, 7, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'disponible'),
(708, 7, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'sin_dato'),
(801, 8, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(802, 8, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'sin_dato'),
(803, 8, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'sin_dato'),
(804, 8, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'sin_dato'),
(805, 8, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'sin_dato'),
(806, 8, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'disponible'),
(807, 8, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'sin_dato'),
(808, 8, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'sin_dato'),
(901, 9, 1, -1.5, -1, 2, 92, 'Esquina Paullier', 196500, true, 'sin_dato'),
(902, 9, 2, -0.5, -1, 1, 60, 'Frente', 138904, false, 'disponible'),
(903, 9, 3, 0.5, -1, 1, 64, 'Frente', 139874, false, 'sin_dato'),
(904, 9, 4, 1.5, -1, 2, 88, 'Frente', 188400, true, 'sin_dato'),
(905, 9, 5, -1.5, 1, 1, 78, 'Contrafrente', 155976, false, 'sin_dato'),
(906, 9, 6, -0.5, 1, 1, 47, 'Contrafrente', 136673, false, 'sin_dato'),
(907, 9, 7, 0.5, 1, 1, 48, 'Contrafrente', 136673, false, 'sin_dato'),
(908, 9, 8, 1.5, 1, 1, 51, 'Contrafrente', 128340, false, 'sin_dato'),
(1001, 10, 1, -1.5, -1, 2, 187, 'Esquina, terraza', 227106, false, 'disponible'),
(1002, 10, 2, -0.5, -1, 2, 140, 'Frente, terraza', 214000, true, 'sin_dato'),
(1003, 10, 3, 0.5, -1, 2, 132, 'Frente, terraza', 209000, true, 'sin_dato'),
(1004, 10, 4, -1.5, 1, 2, 126, 'Contrafrente', 198000, true, 'sin_dato'),
(1005, 10, 5, -0.5, 1, 1, 95, 'Contrafrente', 172000, true, 'disponible'),
(1006, 10, 6, 0.5, 1, 1, 88, 'Contrafrente', 166000, true, 'sin_dato');
-- total: 78 filas, 29 en 'disponible' tras las correcciones de abajo
-- (12 originales + 17 nuevas con datos reales de ingar).

-- Dato real encontrado en el aviso público de la 107 (justoaca.com,
-- setiembre 2026): 40,24 m² cubiertos + 7,53 m² de terraza (antes
-- redondeábamos a 48 m² sin desglose), cochera opcional a USD 19.500,
-- y la unidad figura reservada.
update units set m2 = 47.77, m2_terraza = 7.53, cochera_precio = 19500, estado = 'reservado'
  where id = 107;

-- Datos reales de 20 unidades publicadas en ingar.com.uy (setiembre 2026):
-- superficie total, m2_terraza = superficie total - superficie cubierta, y
-- precio del aviso. En 5 de estas 20 (104, 108, 208, 308, 1002) la cantidad
-- de dormitorios que teníamos (sintética) estaba invertida contra el dato
-- real, y en el piso 10 (1001, 1002) la superficie estimada era más del
-- doble de la real — se corrigen acá también, no solo el precio.
update units as u set
  dorms = v.dorms, m2 = v.m2, m2_terraza = v.m2_terraza, precio = v.precio,
  estado = 'disponible', estimado = false
from (values
  (101,  2, 83.3, 17.6, 251600),
  (102,  1, 59.4, 17.1, 160800),
  (103,  1, 50.5, 11.0, 143200),
  (104,  1, 50.5, 11.0, 144200),
  (105,  1, 55.5, 14.7, 140900),
  (106,  1, 55.5, 15.0, 140900),
  (108,  2, 93.4, 26.9, 198300),
  (201,  2, 83.3, 17.6, 167900),
  (208,  2, 91.2, 24.7, 183600),
  (301,  2, 83.3, 17.6, 169000),
  (306,  1, 55.5, 15.0, 150000),
  (308,  2, 91.2, 24.7, 184700),
  (501,  2, 83.3, 17.6, 171200),
  (601,  2, 83.3, 17.6, 172400),
  (701,  2, 83.3, 17.6, 173600),
  (801,  2, 83.3, 17.6, 175100),
  (901,  2, 83.3, 17.6, 175700),
  (902,  1, 59.4, 17.1, 149900),
  (1001, 2, 85.1, 19.4, 176200),
  (1002, 1, 60.5, 18.2, 150900)
) as v(id, dorms, m2, m2_terraza, precio)
where u.id = v.id;

insert into settings (id) values (1);
