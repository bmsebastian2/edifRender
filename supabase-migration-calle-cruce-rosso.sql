-- ROSSO está en la esquina con Paullier: el visor arma la grilla de calles
-- extendidas (geometria.calle.extension, ver "La calle" en CLAUDE.md) con una
-- transversal cada 90 m, y sin este dato supone el edificio a mitad de cuadra
-- (transversales a ±45 m del centro). cruce_x es el eje de una transversal en
-- metros sobre el frente, desde el centro del edificio; parado en la calle
-- mirando la fachada, negativo = a la derecha.
--
-- Paullier queda del lado de las unidades "Esquina Paullier" (101 a 901:
-- col = -1.5, frente = -1, o sea -X). Con la grilla por defecto de ROSSO:
--   media losa  = (5.7 * 4 + 0.5) / 2 = 11.65 m  (borde de la losa = esquina)
--   + vereda 2 m + media calzada 4 m           = 17.65 m
--
-- Solo datos, idempotente (pisa el valor si ya estaba) y sin orden respecto de
-- las demás migraciones. Conserva las otras claves de geometria y de calle.

update projects
set geometria = jsonb_set(
  coalesce(geometria, '{}'::jsonb),
  '{calle}',
  coalesce(geometria -> 'calle', '{}'::jsonb) || '{"cruce_x": -17.65}'::jsonb
)
where slug = 'rosso';

-- Control: tiene que devolver {"cruce_x": -17.65}
select slug, geometria -> 'calle' as calle from projects where slug = 'rosso';
