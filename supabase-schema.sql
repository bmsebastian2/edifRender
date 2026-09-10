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
  estado       text not null default 'sin_dato' check (estado in ('disponible', 'sin_dato'))
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

alter table units enable row level security;
alter table events enable row level security;

-- Lectura pública de unidades: la necesita tanto index.html (el edificio)
-- como admin.html (el panel).
create policy "units_select_publico" on units
  for select using (true);

-- admin.html pide login (Supabase Auth) antes de dejar tocar nada: solo un
-- usuario autenticado (creado a mano en Authentication → Users) puede
-- actualizar `estado`. El público (anon) solo puede leer. Para no dejar la
-- puerta abierta a que alguien reescriba precios desde la consola del
-- navegador, el permiso de UPDATE se limita además a esa sola columna a
-- nivel de Postgres (no alcanza con la policy: hace falta el REVOKE/GRANT
-- de abajo).
create policy "units_update_estado" on units
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
revoke update on units from anon, authenticated;
grant update (estado) on units to authenticated;

-- Cualquiera puede loggear que abrió una unidad, y el panel puede leer
-- los eventos para armar las estadísticas. Sin login, esto es visible
-- para cualquiera que tenga el link a admin.html — ver la nota en esa
-- página sobre agregar Supabase Auth antes de un cliente real.
create policy "events_insert_publico" on events
  for insert with check (true);
create policy "events_select_publico" on events
  for select using (true);

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
-- total: 78 filas, 12 en 'disponible' (las mismas que PUBLICADAS tenía).
