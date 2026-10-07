-- ============================================================
-- Grants explícitos para `authenticated` sobre las tablas que usa admin.html.
--
-- Por qué: hasta ahora ninguna migración daba SELECT/INSERT/DELETE sobre
-- amenities, typologies, media, settings, obra_hitos, obra_fotos, units ni
-- projects a `authenticated` — dependíamos de los privilegios por defecto
-- que Supabase pone en el schema public. Cuando esos defaults no están, el
-- panel falla con "permission denied for table amenities" / "typologies"
-- (error de GRANT, no de RLS: RLS devolvería cero filas sin error).
--
-- Esto NO abre nada nuevo: todas estas tablas tienen RLS activo y sus
-- policies (supabase-migration-multitenant.sql y siguientes, con
-- es_miembro / es_admin_proyecto / es_admin_plataforma) siguen decidiendo
-- qué filas ve y toca cada usuario. Solo se devuelve el acceso a nivel
-- tabla que la app ya asumía.
--
-- Lo que se deja como está a propósito:
--   * units y projects: solo SELECT a nivel tabla. Los UPDATE siguen siendo
--     por columna (grants de multitenant / avance-obra / solar / pisos /
--     financiacion); un UPDATE de tabla completa expondría `precio`, `slug`,
--     `publicado`, etc.
--   * memberships: solo SELECT acá; update(rol) y delete ya los da accesos.
--   * anon no se toca: sigue leyendo solo las vistas public_*.
--
-- Idempotente: GRANT sobre un privilegio ya otorgado no hace nada.
-- ============================================================

-- Pestañas con alta/baja/edición completa (Amenities, Tipologías, Imágenes,
-- Avance de obra).
grant select, insert, update, delete on amenities, typologies, media, obra_hitos, obra_fotos to authenticated;

-- Redes: lee y actualiza la fila de settings del proyecto.
grant select, update on settings to authenticated;

-- Lectura: unidades (tabla, Demanda), proyectos (selector), membresías
-- (proyectos del usuario), eventos y leads (Demanda / lista de espera).
grant select on units, projects, memberships, events to authenticated;
grant select, update on leads to authenticated;

-- Chequeo (debería listar los privilegios de arriba):
-- select table_name, string_agg(privilege_type, ', ' order by privilege_type)
-- from information_schema.role_table_grants
-- where grantee = 'authenticated'
--   and table_name in ('amenities','typologies','media','obra_hitos','obra_fotos',
--                      'settings','units','projects','memberships','events','leads')
-- group by table_name order by table_name;
