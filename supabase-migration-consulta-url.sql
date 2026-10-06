-- Botón "Consultar" del panel de la unidad: lleva al formulario de contacto
-- que el cliente ya usa, en vez de gestionar el lead en el visor.
--
-- settings.consulta_url es una URL plantilla con los marcadores {unidad},
-- {torre}, {piso}, {tipologia} y {proyecto}; el visor los reemplaza con los
-- datos de la unidad (codificados con encodeURIComponent). Va en settings
-- (por proyecto, junto a whatsapp/sitio_web) y no en projects.
--
-- Puramente aditiva: NULL = sin botón, así que los proyectos que no la
-- cargan se ven exactamente igual que antes.
--
-- Idempotente: se puede correr más de una vez.

alter table settings add column if not exists consulta_url text;

-- Vista pública: consulta_url se agrega AL FINAL, sobre la última versión
-- de public_settings (supabase-migration-financiacion.sql). Postgres no deja
-- insertar columnas en el medio de una vista existente.
create or replace view public_settings as
select s.project_id, s.instagram, s.youtube, s.sitio_web, s.whatsapp, s.textos, s.financiacion,
       s.consulta_url
from settings s join projects p on p.id = s.project_id
where p.publicado;

-- BRUSCO: valor provisorio hasta tener la URL real del formulario.
update settings
set consulta_url = 'https://www.brusco.com.uy/contacto?mensaje=Me%20interesa%20la%20unidad%20{unidad}%20-%20Torre%20{torre}%2C%20piso%20{piso}'
where project_id = (select id from projects where slug = 'brusco');
