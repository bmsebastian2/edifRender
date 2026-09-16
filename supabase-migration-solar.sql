-- Migración: simulador solar (posición del sol por fecha/hora, sombras
-- reales). Puramente aditiva — un proyecto sin estas columnas cargadas
-- sigue exactamente igual que hoy (ver `index.html`, `tieneNorte()`): el
-- control ni siquiera aparece.

-- Coordenadas del proyecto — obligatorias para calcular la posición del
-- sol; sin latitud/longitud no hay manera correcta de resolver
-- declinación/azimut, así que no se hardcodean.
alter table projects add column if not exists lat numeric;
alter table projects add column if not exists lon numeric;

-- Zona horaria por país (sin horario de verano en ninguno de los dos
-- mercados de hoy). Va en `paises` y no en `projects` por el mismo motivo
-- que moneda/nombre de país: agregar un mercado nuevo es un insert, no una
-- migración de columna.
alter table paises add column if not exists tz_offset_horas integer not null default 0;
update paises set tz_offset_horas = -3 where codigo = 'UY';
update paises set tz_offset_horas = -6 where codigo = 'NI';

-- El GRANT existente (supabase-migration-multitenant.sql) deja editar
-- nombre/dirección/ciudad/entrega desde admin.html sin pasar por la RPC de
-- plataforma. lat/lon son del mismo nivel de confianza — no son un campo
-- sensible (slug/moneda/geometria/org_id), así que se suman ahí.
grant update (lat, lon) on projects to authenticated;

-- `norte_grados` (rumbo de la FACHADA AL FRENTE, en grados horarios desde
-- el norte geográfico — no el contrafrente, ver CLAUDE.md) NO es una
-- columna nueva: vive dentro de `projects.geometria`, el mismo jsonb que ya
-- guarda la forma de la placa. Se edita hoy directamente en Supabase (igual
-- que losa_contorno/nucleo_contorno) — no hay UI en admin.html todavía.
-- Se mide en Google Maps mirando por dónde corre la calle del frente, no
-- con la rosa de los vientos de un plano en PDF (Altamira: 45, mirando
-- cómo corre Lorenzo Batlle).

-- Vista pública: lat/lon se agregan acá porque `public_projects` (no la
-- tabla base) es el único camino de lectura para `anon`. `geometria` ya
-- viaja completa en esa vista, así que norte_grados no necesita este paso.
-- lat/lon van AL FINAL de la lista de columnas a propósito: Postgres no
-- deja que un CREATE OR REPLACE VIEW inserte columnas en el medio de una
-- vista existente (solo agregarlas al final), así que "desarrolla" tiene
-- que seguir siendo la última posición.
create or replace view public_projects as
select p.id, p.slug, p.nombre, p.direccion, p.ciudad, p.pais, p.entrega, p.pisos,
       p.muestra_totales, p.moneda, p.locale, p.geometria, o.nombre as desarrolla, p.lat, p.lon
from projects p join orgs o on o.id = p.org_id
where p.publicado;
