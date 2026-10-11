-- ============================================================
-- Amenities con ícono.
--
-- El visor pasa de una lista de texto a una grilla de ícono + nombre. El
-- ícono lo elige una persona en el admin (pestaña Amenities), no se adivina
-- del texto: amenities.icono guarda la clave del catálogo de
-- amenities-iconos.js. Sin valor, o con una clave que el catálogo no
-- conoce, el visor muestra el ícono genérico — por eso no hay check: sumar
-- un ícono al catálogo no pide otra migración.
--
-- Puramente aditiva: un proyecto sin íconos asignados se ve con el
-- genérico, nunca roto. Correr después de `alquiler`. Idempotente.
-- ============================================================

alter table amenities add column if not exists icono text;

-- create or replace view solo permite agregar columnas al final; los grants
-- de la vista (anon, authenticated) se conservan.
create or replace view public_amenities as
select a.project_id, a.texto, a.orden, a.icono
from amenities a join projects p on p.id = a.project_id
where p.publicado and a.activo
order by a.orden;

-- Asignación de las amenities que ya estaban cargadas al 2026-10-09, una
-- por una (por slug + texto exacto). Solo completa las que siguen sin
-- ícono: no pisa lo que se haya elegido después desde el admin. Las que
-- quedan afuera (vestuarios, microcine, biblioteca de BRUSCO) van con el
-- genérico hasta que el catálogo tenga uno que les corresponda.
update amenities a
set icono = v.icono
from (values
  ('rosso',    'SUM con parrillero y barbacoa abierta',                'parrillero'),
  ('rosso',    'Gimnasio con espacio para yoga',                       'gimnasio'),
  ('rosso',    'Terraza pergolada en el piso 10 con vista al skyline', 'terraza'),
  ('rosso',    'Racks para bicicletas y lavandería con app',           'bicicletero'),
  ('rosso',    'WiFi gratuito en áreas comunes',                       'wifi'),
  ('rosso',    'Infraestructura para vehículos eléctricos',            'carga'),
  ('rosso',    'CCTV y cerradura electrónica',                         'seguridad'),
  ('altamira', 'Parrilleros y fogones en el ultimo nivel',             'parrillero'),
  ('altamira', 'Co-living con kitchenette',                            'estar'),
  ('altamira', 'Gimnasio',                                             'gimnasio'),
  ('altamira', 'Solarium',                                             'solarium'),
  ('altamira', 'Lavadero con tenders',                                 'laundry'),
  ('altamira', 'Espacio de recreacion infantil',                       'infantil'),
  ('altamira', 'Co-work',                                              'coworking'),
  ('altamira', 'Racks para bicicletas',                                'bicicletero'),
  ('altamira', 'Acceso por jardin',                                    'terraza'),
  ('brusco',   'PLAYROOM',                                             'infantil'),
  ('brusco',   'SALA DE ESTAR',                                        'estar'),
  ('brusco',   'SUM PARA EVENTOS CON SALIDA AL AIRE LIBRE',            'eventos'),
  ('brusco',   'JUEGOS PARA NIÑOS EN LA TERRAZA',                      'infantil'),
  ('brusco',   'ESPACIO PÚBLICO',                                      'terraza'),
  ('brusco',   'ESTACIONAMIENTO CON CARGA ELÉCTRICA',                  'carga')
) as v(slug, texto, icono)
join projects p on p.slug = v.slug
where a.project_id = p.id and a.texto = v.texto and a.icono is null;

-- Control: cuántas quedaron con y sin ícono por proyecto.
--   select p.slug, count(*) filter (where a.icono is not null) con_icono,
--          count(*) filter (where a.icono is null) sin_icono
--   from amenities a join projects p on p.id = a.project_id group by p.slug;
