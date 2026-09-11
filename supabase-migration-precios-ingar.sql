-- Migración: corrige 20 unidades con datos reales publicados en
-- ingar.com.uy (setiembre 2026) — superficie total, m2_terraza (=
-- superficie total - superficie cubierta), precio, y las marca
-- 'disponible' (ingar las lista como disponibles hoy).
--
-- Requiere haber corrido antes supabase-migration-cochera-terraza.sql
-- (agrega la columna m2_terraza que esta migración usa).
--
-- En 5 de estas 20 unidades (104, 108, 208, 308, 1002) la cantidad de
-- dormitorios que teníamos (sintética) estaba invertida contra el dato
-- real, y en el piso 10 (1001, 1002) la superficie estimada era más del
-- doble de la real — se corrigen acá también, no solo el precio.
--
-- Correr una sola vez en el SQL Editor del proyecto que ya está en uso.

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
