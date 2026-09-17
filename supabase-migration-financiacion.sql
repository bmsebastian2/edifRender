-- Migración: simulador de financiación en pozo (entrega + cuotas + saldo
-- contra entrega de llaves). Puramente aditiva — un proyecto sin esta
-- configuración cargada sigue exactamente igual que hoy (ver index.html,
-- tieneFinanciacion()): el simulador ni siquiera aparece, nunca con valores
-- default inventados. ROSSO no tiene nada de esto cargado.

-- Fecha real de ocupación, para calcular la cantidad de cuotas. `projects.entrega`
-- sigue siendo copy libre ("abril 2028"); esto es la fecha operable para la
-- cuenta, mismo criterio que lat/lon en la migración solar (columna propia
-- para lo que hace falta calcular, jsonb para lo que es configuración
-- agrupada sin necesidad de tipado individual).
alter table projects add column if not exists fecha_ocupacion date;

-- Plan de pago del proyecto: porcentajes de entrega (min/max/default para el
-- deslizador) y de saldo contra entrega de llaves, más si las cuotas se
-- ajustan por índice. Va en `settings` (configuración comercial de cómo el
-- proyecto se muestra, mismo lugar que whatsapp/textos), no en
-- `projects.geometria` (forma física de la placa). Forma esperada:
--   { entrega_min, entrega_max, entrega_default,   -- 0-100
--     saldo_pct,                                    -- 0-100, 0/ausente = sin saldo
--     ajuste_indice, mostrar_ajuste }                -- 'UI'|'IPC'|null, boolean
-- Se edita hoy directamente en Supabase (igual que geometria/lat/lon) — no
-- hay UI en admin.html todavía.
alter table settings add column if not exists financiacion jsonb not null default '{}';

-- Registro del uso del simulador: qué porcentaje de entrega elige la gente es
-- información de precio para el desarrollador, igual que los clics por
-- tipología/piso. No es texto libre (numeric), respeta el espíritu de la
-- policy de insert de `events`. `events` no tiene vista pública (solo se lee
-- vía RLS restringida a miembros del proyecto), así que esta columna no
-- necesita exponerse en ninguna vista.
alter table events add column if not exists pct_entrega numeric;

-- El check de `tipo` vive en el `with check` de la policy de insert, no en
-- un constraint de tabla (ver supabase-migration-multitenant.sql) — se
-- reemplaza agregando el valor nuevo sin sacar 'click': aditivo puro,
-- cualquier fila existente con tipo='click' sigue entrando igual.
drop policy if exists "events_insert" on events;
create policy "events_insert" on events
  for insert with check (
    proyecto_publicado(project_id)
    and unidad_pertenece(project_id, unit_id)
    and tipo in ('click', 'simulacion')
    and sesion is not null
    and (origen is null or origen ~ '^[a-z0-9_-]{1,40}$')
  );

-- fecha_ocupacion es del mismo nivel de confianza que lat/lon (no sensible
-- como slug/moneda/geometria/org_id): se suma al grant existente de campos
-- de vitrina en vez de la RPC de plataforma. `settings` no tiene grants de
-- columna (solo el grant de tabla completo a `authenticated` + RLS), así que
-- `financiacion` ya quedó habilitada sin necesidad de un grant nuevo.
grant update (fecha_ocupacion) on projects to authenticated;

-- Vistas públicas: fecha_ocupacion y financiacion se agregan AL FINAL de la
-- lista de columnas — Postgres no deja insertar columnas en el medio de una
-- vista existente (mismo detalle que dejó documentado la migración solar).
create or replace view public_projects as
select p.id, p.slug, p.nombre, p.direccion, p.ciudad, p.pais, p.entrega, p.pisos,
       p.muestra_totales, p.moneda, p.locale, p.geometria, o.nombre as desarrolla, p.lat, p.lon,
       p.fecha_ocupacion
from projects p join orgs o on o.id = p.org_id
where p.publicado;

create or replace view public_settings as
select s.project_id, s.instagram, s.youtube, s.sitio_web, s.whatsapp, s.textos, s.financiacion
from settings s join projects p on p.id = s.project_id
where p.publicado;
