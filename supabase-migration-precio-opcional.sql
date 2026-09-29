-- Precio de venta opcional en units.
--
-- units.precio nació "not null" porque ROSSO tenía precio en todas las unidades.
-- Con más edificios eso ya no alcanza: en BRUSCO hay unidades que la inmobiliaria
-- ofrece solo en alquiler (precio mensual en UYU, que va a geom.precio_alquiler_uyu),
-- y cargarles un precio de venta inventado es peor que no mostrar ninguno.
--
-- index.html ya trata precio null (oculta el precio y el simulador de financiación);
-- admin.html muestra "—". Puramente aditiva: las filas existentes no cambian.
-- Idempotente: "drop not null" sobre una columna que ya acepta null no hace nada.
--
-- Correr ANTES de supabase-brusco-precios.sql.

alter table units alter column precio drop not null;
