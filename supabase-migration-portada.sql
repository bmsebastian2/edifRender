-- ============================================================
-- Portada del header + tipo de proyecto (ver #barra-sup en index.html).
--
-- Por qué: el header del visor muestra una foto del proyecto a la derecha
-- (detrás de las redes, fundida con el fondo hacia la izquierda) y, junto a
-- la dirección, un rótulo con el tipo de proyecto ("Edificio").
--
-- Qué hace:
--   1. projects.portada_url text null: URL de la foto. null = header sin
--      foto, como hasta ahora. Se usa tal cual (no hay transformaciones de
--      Storage): conviene una webp de ~1600–2000 px de ancho; se ve solo una
--      franja de 56–72 px de alto, así que importa más el encuadre que la
--      resolución.
--   2. projects.portada_foco text null: object-position CSS de la foto
--      ("center", "right 30%", "50% 70%"…). null = "center". Un valor que
--      el navegador no entiende se ignora (queda centrada).
--   3. projects.tipo text null: 'edificio' | 'loteo'. null = "Edificio".
--   4. Recrea public_projects con las tres columnas al final (create or
--      replace view solo permite agregar columnas al final).
--
-- tiene_pb (supabase-migration-pisos.sql) se vuelve a agregar acá, con
-- if not exists: la vista de abajo lo incluye y en producción esa migración
-- parece no estar aplicada (ver Pendientes en CLAUDE.md). Así esta corre
-- igual con pisos aplicada o sin aplicar, y después de correrla la fila PB
-- ya se puede ocultar con tiene_pb = false.
--
-- Puramente aditiva: ninguna fila cambia y, sin datos cargados, los tres
-- proyectos se ven igual que antes (header sin foto, rótulo "Edificio").
--
-- Escritura: no hay UI en admin.html todavía; se carga desde el SQL
-- Editor, como lat/lon. Cuando la haya, sumar
-- grant update (portada_url, portada_foco, tipo) on projects to authenticated;
--
-- Idempotente. Correr después de supabase-migration-nombre-publico.sql.
-- ============================================================

alter table projects add column if not exists portada_url text;
alter table projects add column if not exists portada_foco text;
alter table projects add column if not exists tipo text;
alter table projects add column if not exists tiene_pb boolean;

comment on column projects.portada_url is
  'Foto de la portada del header del visor. null = header sin foto.';
comment on column projects.portada_foco is
  'object-position CSS de la portada ("center", "right 30%"). null = center.';
comment on column projects.tipo is
  'Tipo de proyecto para el rótulo del header: edificio | loteo. null = Edificio.';

alter table projects drop constraint if exists projects_tipo_check;
alter table projects add constraint projects_tipo_check
  check (tipo is null or tipo in ('edificio', 'loteo'));

-- Copia de la versión de supabase-migration-pisos.sql + las tres columnas al final.
create or replace view public_projects as
select p.id, p.slug, p.nombre, p.direccion, p.ciudad, p.pais, p.entrega, p.pisos,
       p.muestra_totales, p.moneda, p.locale, p.geometria, o.nombre as desarrolla,
       p.lat, p.lon, p.fecha_ocupacion, p.avance_habilitado, p.tiene_pb,
       p.portada_url, p.portada_foco, p.tipo
from projects p join orgs o on o.id = p.org_id
where p.publicado;

-- Ejemplo (no corre solo): usar de portada el primer render que ya tiene
-- el proyecto en la galería.
-- update projects set portada_url = (
--   select m.url from media m
--   where m.project_id = projects.id and m.scope = 'project' and m.tipo = 'render'
--   order by m.orden limit 1)
-- where slug = 'rosso';
