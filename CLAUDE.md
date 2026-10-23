# CLAUDE.md

Guía para Claude (Claude Code o un proyecto de Claude Desktop) al trabajar en este
repositorio. `README.md` es el runbook operativo (dar de alta un edificio nuevo,
administrar accesos); este archivo es la arquitectura.

## Cómo trabajar con Sebastian

- **Responder siempre en español**, en todos los mensajes, incluso confirmaciones cortas.
  Todo el copy de la UI y los comentarios del código también están en español — los
  nuevos también.
- Sebastian lleva el proyecto solo (desarrollador + dueño de producto para Block
  Desarrollos / "Armado por Cota"). Lee SQL, políticas de RLS y triggers sin problema —
  se puede hablar de Postgres directamente, sin abstraerlo.
- Itera mirando: dar una recomendación real con sus trade-offs (no una lista neutral de
  opciones), y mostrar/describir el resultado visual. Esperar una ronda de correcciones
  después de que lo vea.
- **Mobile: el edificio 3D es el protagonista.** Ninguna UI persistente nueva puede
  taparlo. El patrón establecido es la hoja inferior colapsable (botón disparador → hoja
  a pedido), como `#pisos` y `#filtros`. Los elementos chicos inevitables (logo, íconos
  de redes, botón de renders) van solo con ícono y `filter: drop-shadow(...)`, nunca en
  una tarjeta opaca. Verificar a ~390px y en desktop antes de dar un cambio de layout por
  terminado.
- "Fijo" es ambiguo para elementos de la escena 3D: normalmente significa **anclado al
  mundo** (se queda pegado a su lugar mientras el edificio gira; p.ej. el cartel con el
  nombre de la calle queda sobre la calle), no `position: fixed` de CSS. Confirmar antes
  de sacar algo de la escena.
- Las migraciones SQL las corre Sebastian **a mano** en el SQL Editor de Supabase. Nunca
  asumir que una migración recién escrita ya está aplicada — decirlo explícitamente
  cuando una funcionalidad depende de una.

## Qué es esto

Un sitio estático sin build: una visualización 3D navegable de la disponibilidad de
unidades de un edificio residencial (Three.js **r128** desde cdnjs), con Supabase como
backend. No hay bundler, tests ni linter (solo los controles del pre-commit, ver
"Correr / probar"); el `package.json` existe para la dependencia de `api/og.mjs` (y el
atajo `npm run optimize:assets`, ver `scripts/assets/`) y no hay build. Se despliega en Vercel en `https://armadoporcota.vercel.app/`,
sirviendo la raíz del repo tal cual (menos lo que excluye `.vercelignore`), más dos
funciones para la vista previa al compartir (ver "Vista previa al compartir").

Empezó como un solo edificio (ROSSO) y ahora es una **plataforma multi-tenant**: un
mismo proyecto de Supabase aloja varios edificios (`projects`) de varios clientes
(`orgs`). El frontend decide qué edificio mostrar por slug.

Archivos:

- `index.html` (~7k líneas) — el visor público: HTML + CSS (inline, ver "Arquitectura
  de `index.html`") y los dos scripts chicos del poster.
- `app.<hash>.js` (~6.8k líneas) — el script principal del visor (desde 2026-10-20;
  antes iba inline en `index.html`). El nombre lleva los primeros 10 hex del SHA-256 de
  su contenido y se sirve con caché de un año (`immutable`, ver `vercel.json`): **no se
  renombra a mano**. Después de editarlo, `node scripts/app-visor.mjs nombre` le pone
  el nombre nuevo y actualiza el `<script src>` de `index.html`; si no, lo hace el
  pre-commit y frena el commit. Para buscar o editar: `app.*.js` (hay uno solo).
- `admin.html` (~1.8k líneas) — panel interno para clientes/vendedores, detrás de
  Supabase Auth.
- `supabase-config.js` — `SUPABASE_URL` + anon key, crea el cliente global `sb`. La anon
  key es pública a propósito; la seguridad real es RLS. Nunca poner acá la service_role
  key.
- `favicon.svg` + `favicon.ico` — la marca de Cota (triángulo sobre una línea, en blanco
  sobre `--verde`), la misma para todos los edificios; los dos HTML apuntan al SVG con
  `<link rel="icon">`. El `.ico` (PNG de 16/32/48 sacados del SVG con sharp) queda para
  quien pide `/favicon.ico` igual. Sin ícono, Chrome dejaba un 404 en la consola: era lo
  único que marcaba Best Practices (2026-10-20).
- `supabase-schema.sql` — el schema original single-tenant + el seed de ROSSO.
- `supabase-migration-*.sql` — cada cambio posterior, corridos a mano en orden (ver más
  abajo).
- `modelos/autos/*.glb` — modelos low-poly de autos (CC0, comprimidos con meshopt vía
  `gltf-transform optimize`) usados como utilería en la calle. Se sirven con caché de un
  año (`immutable`, ver `vercel.json`): **un modelo que cambia va con nombre nuevo**;
  si se pisa el archivo, quien ya lo tenía en caché sigue viendo el viejo hasta un año.
  No tienen texturas: KTX2 no aplica, y Draco no conviene (su decoder WASM pesa más que
  los tres autos con brotli). Reprocesarlos no gana nada (`optimize:assets`, 2026-10-20).
- `images/poster-<slug>.avif|webp` (1920×1080), `poster-<slug>.1440.avif|webp`
  (laptops) y `poster-<slug>-movil.avif|webp` (780×1688) — la vista inicial de cada
  edificio, que se ve mientras carga y es el LCP (ver "Poster" en "Arquitectura de
  `index.html`"). Opcionales: sin los archivos, el overlay de carga de siempre. Caché
  de un año (`immutable`, ver `vercel.json`): se pisan con el mismo nombre, pero los
  URLs llevan `?v=` con el hash de todos los archivos de la clave (`VERSIONES_POSTER`
  en el `<head>` de `index.html`). Los genera `node scripts/posters.mjs [slug ...]`
  (Chrome headless con los datos reales, "Vista inicial", interfaz escondida con
  `opacity: 0`, captura PNG → sharp con `scripts/assets/posters-codificar.mjs`: AVIF 55,
  WebP 80), que deja el PNG sin pérdida en `datos/posters/` (ignorada por git) y al
  final reescribe `VERSIONES_POSTER` con las claves completas de `images/`: no se edita
  a mano, y un archivo pisado sin pasar por el script lo sigue viendo viejo quien ya lo
  tenía.
- `assets/textures/asfalto-linea.<hash>.webp` (1024×512) y `asfalto-liso.<hash>.webp`
  (512×512) — las texturas de la calzada (ver "Entorno extendido"), WebP calidad 90,
  ~150 KB las dos. Desde 2026-10-21; antes `texturaAsfalto()` las dibujaba en canvas
  en cada carga (70–130 ms antes del primer cuadro). El nombre lleva los primeros 10 hex
  del SHA-256 del archivo y se sirven con caché de un año (`immutable`, ver
  `vercel.json`): una textura nueva va con otro nombre y las dos URL de
  `texturasAsfalto` en `app.<hash>.js` cambian. **No usar una carpeta `public/`** en
  la raíz: Vercel puede tomarla como output directory de un proyecto estático y dejar
  `index.html` afuera (por eso `assets/`).
- `tools/textura-asfalto.js` + `tools/textura-asfalto.html` — el generador de esas
  texturas (el `texturaAsfalto()` del visor, tal cual: PRNG con semilla fija, mismo
  resultado en cada corrida) y una página que las dibuja y las descarga con su hash
  (`npx serve .` → `/tools/textura-asfalto.html`, `?ancho=` para otra calzada). Están
  dibujadas para una calzada de 8 m (`ANCHO_ASFALTO`): con otro
  `geometria.calle.ancho` la línea se ve más gruesa y el visor lo avisa con un
  `console.warn`; regenerarlas con ese ancho.
- `README.md` — runbook: alta de edificio paso a paso, acceso de plataforma, revocar
  accesos.
- `vercel.json` — sin build ni framework (`framework: null`, `buildCommand: ""`,
  `outputDirectory: "."`) + una primera ruta con `continue` que pone a todo
  `X-Content-Type-Options: nosniff` y `Referrer-Policy: strict-origin-when-cross-origin`
  (desde 2026-10-20; HSTS lo pone Vercel solo) + la ruta de los crawlers a
  `api/compartir` + una ruta con
  `continue` que pone caché larga a `modelos/*.glb`, otra a `app.<hash>.js` y otra a
  los posters (`images/poster-*`, `.avif` y `.webp`; versionados, ver arriba) y otra a
  las texturas (`assets/textures/*.<hash>.webp`). El resto de los estáticos (HTML,
  `supabase-config.js`, `amenities-iconos.js`) queda con el default de Vercel
  (`max-age=0, must-revalidate`) a propósito: cambian en cada deploy con la misma URL.
  `"regions": ["pdx1"]`: las funciones corren en Portland, al lado de Supabase
  (`us-west-2`, Oregón; verificado el 2026-10-13 por la IP de `db.<ref>.supabase.co`).
  En producción se ve en el header `x-vercel-id` (`gru1::pdx1::…` = borde en São
  Paulo, función en Portland; verificado el 2026-10-15).
- `.vercelignore` — no se publican `CLAUDE.md`, `*.sql`, `scripts/`, `tools/`, `datos/`,
  `.githooks/`, `node_modules/` ni `optimizado/`.
- `api/compartir.js` — HTML con las etiquetas Open Graph para los crawlers.
  `api/og.mjs` — la imagen de esa tarjeta (PNG 1200×630). Los archivos con prefijo `_`
  no son funciones: `api/_tarjeta.js` (qué datos muestra cada tarjeta, escrito a mano),
  `api/_og-dibujo.mjs` (la elevación y la composición), `api/_fuentes/` (Inter
  subseteada), `api/_marca-cota.png` (imagen de marca, generada por
  `scripts/muestras-og.mjs`) y `api/_compartido.js` — **generado** por
  `scripts/generar-compartido.mjs`, no se edita a mano.
- `package.json` + `package-lock.json` + `.npmrc` — solo `@vercel/og`, versión exacta;
  `.npmrc` (`omit=optional`) deja afuera `sharp` (ver "Vista previa al compartir").
- `scripts/assets/` — `npm run optimize:assets [-- posters | modelos | storage]`: sharp
  y glTF-Transform en **su propio** `package.json` (en el de la raíz, Vercel instalaría
  sharp y `@vercel/og` lo usaría; `posters.mjs` lo instala solo si falta). Ahí vive
  también el codificador de los posters, compartido con `posters.mjs`. Genera
  candidatos optimizados de posters, modelos e imágenes de Storage en `optimizado/`
  (ignorada por git y Vercel) con
  `optimizado/informe.md` (antes/después por archivo). **Nunca pisa un original**:
  reemplazar es un paso aparte, a mano. Mide las mismas variantes de Storage que pide
  `index.html` (ver "Imágenes de Storage"); si cambian allá, cambiarlas en el script.

## Correr / probar

No hay dev server ni build. Servir la carpeta (`npx serve .`): desde `file://` el
script principal no carga (un módulo externo necesita http). Elegir edificio con `?p=<slug>` (por defecto `rosso`). Deploy = push a
`main` (Vercel). Un push a otra rama arma un preview, que tiene Deployment Protection:
para probarlo con curl hace falta el header `x-vercel-protection-bypass` (Settings →
Deployment Protection → Protection Bypass for Automation).

Rollback: Vercel → Deployments → el deploy de producción anterior → ⋯ → **Promote to
Production** (vuelve en segundos, sin rebuild). Ojo: después de un Promote manual Vercel
**deja de promover solo** los pushes siguientes a `main`. Después de arreglar o revertir
en git (`git revert` + push), hay que volver a promover a mano el deploy bueno; recién
ahí los pushes vuelven a ir a producción solos.

El hook `.githooks/pre-commit` corre tres controles sobre las versiones en stage. Se
activa una vez por clon con `git config core.hooksPath .githooks` (ya activo en la
máquina de Sebastian). Los dos últimos leen el visor unido (`index.html` con
`app.<hash>.js` adentro, `scripts/app-visor.mjs unir`): el texto es el mismo que antes
de separarlos, así que lo que controlan y generan no cambió.

- `node scripts/app-visor.mjs control` revisa que `app.<hash>.js` se llame por el hash
  de su contenido y que `index.html` cargue ese. Si no, lo renombra, actualiza
  `index.html` y frena el commit: `git add -A index.html 'app.*.js'` y volver a
  commitear (así entra también el borrado del nombre viejo).
- `node scripts/control-seleccion.mjs` revisa que el visor siga teniendo armado el
  flujo de selección de unidad (ver "Selección de unidad: comportamiento protegido"). Corre
  en cada commit que toque `index.html` o `app.<hash>.js`. Controla el código, no cómo se ve: igual hay que
  probar en el navegador.
- `node scripts/generar-compartido.mjs ... --control` revisa que `api/_compartido.js`
  siga siendo lo que se genera desde el visor y `supabase-config.js`. Corre en cada
  commit que toque alguno de los cuatro archivos; si quedó desactualizado lo regenera y frena el
  commit (hay que agregarlo y volver a commitear).

## Modelo de datos en Supabase (multi-tenant)

Definido por `supabase-migration-multitenant.sql` más las migraciones de funcionalidades
posteriores:

- `paises` (incluye `tz_offset_horas`), `monedas` — tablas de referencia; agregar un país
  o moneda es un insert, no una migración.
- `orgs` → `projects` (slug, nombre, direccion, ciudad, pais, entrega, pisos, publicado,
  muestra_totales, moneda, locale, `geometria` jsonb, lat/lon, fecha_ocupacion,
  avance_habilitado, tiene_pb, portada_url, portada_foco, tipo — las tres últimas de
  `supabase-migration-portada.sql`, ver "Barra superior").
- Por proyecto (`project_id`): `units`, `typologies`, `media`, `amenities`, `settings`
  (instagram/youtube/sitio_web/whatsapp, `textos` jsonb, `financiacion` jsonb), `leads`,
  `events`, `obra_hitos`, `obra_fotos`.
- **`typologies` tiene dos nombres a propósito, no es un duplicado.** `nombre` es el
  rótulo interno con el que el admin distingue plantas: en Altamira "MONO-A" y "MONO-B"
  son dos plantas distintas que para el comprador son las dos "Monoambiente".
  `nombre_publico` (opcional, `supabase-migration-nombre-publico.sql`) es lo que ve el
  comprador en el visor y en la tarjeta de compartir. Vacío → `geom.tipologia` de la
  unidad → dormitorios (`tipologiaDe()`). `nombre` nunca se muestra fuera del admin.
- Accesos: `memberships` (user_id, project_id, rol `admin` | `vendedor`) y
  `plataforma_admins` (acceso global — Sebastian). Los usuarios se crean a mano en el
  dashboard de Supabase; no hay registro propio.
- Helpers security-definer que usan todas las políticas de RLS: `es_admin_plataforma()`,
  `es_admin_proyecto(project_id)`, `es_miembro(project_id)`, `proyecto_publicado()`,
  `unidad_pertenece()`. **Toda funcionalidad nueva editable desde admin tiene que
  reutilizarlos** con scope por `project_id`, en vez de inventar lógica de acceso nueva
  (las políticas de Storage de `supabase-migration-media-storage.sql` son el ejemplo de
  referencia).
- `GRANT update (...)` a nivel de columna controla qué puede editar `authenticated`
  (p.ej. los vendedores solo `units.estado`); los campos sensibles del proyecto (slug,
  moneda, geometria, org_id) solo pasan por la RPC `plataforma_actualizar_proyecto()` o
  por el SQL Editor.
- **Las lecturas públicas pasan por vistas `public_*`** (`public_projects`,
  `public_units`, `public_settings`, `public_amenities`, `public_typologies`,
  `public_media`, `public_obra_hitos`, `public_obra_fotos`), que filtran a proyectos
  `publicado`. `create or replace view` solo permite **agregar** columnas al final — cada
  migración que suma una columna a `public_projects` la recrea desde la última versión y
  la agrega al final.
- Storage: un único bucket público `renders`, rutas `<project_id>/<random>.<ext>`; el
  primer segmento de la ruta es lo que chequean las políticas. Un trigger
  (`enforce_media_limite`) limita del lado del servidor la cantidad de imágenes por
  proyecto/tipología.
- Escrituras anónimas: `events` (tracking de clicks/simulaciones) y `leads` (lista de
  espera), con un trigger de límite por sesión (`limitar_leads_por_sesion`).
- **`events.tipo`** no tiene enum ni check: lo restringe la policy `events_insert`. Desde
  `supabase-migration-eventos-consulta.sql` acepta `'click'` (abrir el panel),
  `'simulacion'` (soltar el deslizador de financiación) y los tipos de consulta del pie:
  `'whatsapp'`, `'formulario'` (`consulta_url`), `'espera_ir'` ("Avisarme si se libera")
  y `'plano'` ("Solicitar plano"). `origen` sigue con su regex; `'preview'` y `'local'`
  ya la cumplen (para separar pruebas). El trigger `filtrar_eventos()` descarta en
  silencio (`return null`), para todos los tipos, un evento igual al **último** de la misma
  `(project_id, unit_id, sesion, tipo)` de los últimos 60 s (mismo `pct_entrega`, `is not
  distinct from`): abrir dos veces la misma unidad en un minuto cuenta una; en el
  simulador cada cambio cuenta (20 → 40 → 20 guarda los tres, 20 → 20 uno). También
  descarta más de 20 consultas por sesión por hora (solo los tipos de consulta).
  `demanda_resumen(p_project_id, p_incluir_pruebas default false)` (RPC, solo `authenticated`, miembro o admin de plataforma) devuelve un
  solo `jsonb` —sin el tope de filas de la API—: un array de `{unit_id, tipo, origen,
  eventos, sesiones}` y, en los de `'simulacion'`, `pct_entrega_final` (la distribución del
  último `pct_entrega` de cada sesión). Sin `p_incluir_pruebas` no cuenta origen
  `'preview'` ni `'local'`. **Orden obligatorio: migración → deploy del visor que manda
  los tipos nuevos → admin.html que usa la RPC.** Al revés, los inserts nuevos fallan (el
  visor solo hace `console.warn`) o admin llama a una función que no existe. Escrita el
  2026-10-22; el visor manda los tipos de consulta desde la fase 8b (ver "Panel de
  detalle de la unidad"), admin todavía no usa la RPC. **Aplicada en producción el:
  2026-10-22** (entre las 14:47 y las 14:50, hora de Uruguay).
  Desde esa fecha los clics se deduplican (la misma unidad, la misma sesión, dentro de 60
  s, cuenta una vez): los conteos de Demanda de antes no son comparables 1:1 con los de
  después.

### Orden de las migraciones

Cada archivo es idempotente o tiene guardas. Orden histórico: `schema` → `auth` →
`estados` → `settings` → `cochera-terraza` → `precios-ingar` → `multitenant` (tiene su
`-rollback`) → `media-storage` → `typology-media` → `altamira-piso5-numeracion` → `solar`
→ `financiacion` → **`avance-obra` (tiene que correr después de `financiacion`)** →
`lista-espera` → `pisos` → `precio-opcional` → `accesos` → `autores-unidades` →
`grants-explicitos` (grants de tabla para `authenticated`; no depender de los defaults
de Supabase — una tabla nueva editable desde admin necesita su propio `grant`) →
`alquiler` (estado `'alquiler'` + `units.precio_alquiler`, UYU/mes) → `nombre-publico`
(`typologies.nombre_publico` + `public_typologies` recreada) → `portada`
(`projects.portada_url` / `portada_foco` / `tipo` + `public_projects` recreada; repite el
`add column if not exists tiene_pb` de `pisos`, así corre con o sin ella) →
`eventos-consulta` (tipos de consulta en `events_insert`, trigger `filtrar_eventos()`,
índice `events_sesion_reciente_idx`, RPC `demanda_resumen()`; después de `multitenant`
y `financiacion`, y antes del deploy del visor que los usa). Solo datos y sin orden:
`calle-cruce-rosso` (`geometria.calle.cruce_x` de ROSSO, esquina Paullier). Migraciones nuevas: archivo nuevo
`supabase-migration-<tema>.sql`, comentario de cabecera en español explicando el porqué,
idempotente (`if not exists`, `drop policy if exists`, `on conflict`), puramente aditiva
cuando se pueda (un proyecto sin el dato nuevo tiene que verse exactamente igual que
antes), y actualizar `supabase-schema.sql` solo si es para instalaciones nuevas.

## Arquitectura de `index.html`

Nada bloquea el primer render (desde 2026-10-20; Lighthouse: FCP de 3,6 a 1,5 s): los
scripts externos (three, líneas, supabase, `supabase-config.js`, `amenities-iconos.js`)
van en el `<head>` con `defer`, y la hoja de Fraunces con `media="print"` +
`onload`. El script principal es `app.<hash>.js`, un `<script type="module" src>` al
final del body: un módulo entra en la misma cola que los `defer`, detrás de ellos. Va
aparte desde 2026-10-20 (eran dos tercios del HTML): queda en caché un año entre
deploys que no lo tocan y V8 guarda su compilación para la próxima visita (con un
script inline no lo hace). Por ser módulo
es modo estricto y lo de primer nivel no es global: desde la consola (o un
`Runtime.evaluate` por CDP) no se llega a `UNIDADES`, `abrir()`, etc. Un `<script>`
nuevo sin `defer`/`async` o una hoja externa bloqueante vuelve a bloquear el primer
render. El CSS queda inline a propósito: el overlay tapa todo, así que partirlo solo
daba ~140 ms y abría una carrera con las mediciones del JS (`rectLibre()`,
`ajustarCabezal()`…).

**Medir sin forzar el layout** (desde 2026-10-20; Lighthouse marcaba "Forced reflow"
en 8 lugares de `iniciar()`): `iniciar()` arma casi todo el DOM de una vez, y cada
lectura de layout en el medio recalculaba la página entera. En Chrome de celular eso
incluye `innerWidth`/`innerHeight` (con viewport, Blink actualiza el layout antes de
contestar). Reglas:
- La medida de la pantalla sale de `pantalla` (`{ ancho, alto }`, de un
  `ResizeObserver` sobre body creado al cargar el módulo; `medirPantalla()` lee de
  `window` una sola vez si todavía no avisó, p. ej. en una pestaña en segundo plano).
  Lo usan cámara, lienzo, fondo, `CIELO_ALTA`, `radioBase()`, `rectLibre()` y el
  encuadre. `enfocar()`, la tarjeta, la guía y la marca siguen con `innerWidth`: leen el
  layout igual (el panel, la tarjeta) y son del flujo protegido.
- Lo que se mide del header y la ficha (rótulo del tipo, leyenda, renglón de datos,
  `--fin-ficha`) va en `ajustarCabezal()`, y `reencuadrar()`, los dos en `obsInterfaz`:
  un solo `ResizeObserver` (body, header, ficha, barra inferior, riel y toolbar) que
  avisa después del layout, primero lo que solo lee y después lo que escribe. El evento
  `resize` llega antes del layout y vería `pantalla` vieja: nada que la use va ahí.
  Contenido nuevo sin cambio de tamaño (`refrescarDatos()`): `pedirAjusteCabezal()`.
- El único layout forzado de la carga es el del encuadre inicial (`encuadreTorre()` →
  `rectLibre()`), a propósito: el primer cuadro sale con ese encuadre. `--fin-ficha` se
  pone ahí mismo (`medirFinFicha()`): va en `:root` y cada cambio recalcula el estilo de
  toda la página.
- Medido con CPU 4× (celular emulado, ROSSO): reflow forzado de ~200 a ~125 ms y la
  tarea de `iniciar()` ~200 ms más corta. En desktop casi no cambia (ahí `innerWidth` no
  fuerza nada).

**Scripts de CDN** (desde 2026-10-20): todos con versión exacta, `integrity` (SRI) y
`crossorigin="anonymous"`, también los que se piden por código (GLTFLoader y meshopt
con `cargarScript()`, el QR con `SRI_QR`). supabase-js va fijo en 2.118.0 en
`index.html` y en `admin.html` (antes `@2`: cualquier 2.x nueva llegaba sola a
producción). Para subir una versión: cambiar la URL y recalcular el hash con
`curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A` (con prefijo
`sha384-`). Con el hash viejo el navegador no ejecuta el archivo y, si es three o
supabase, el visor no arranca.

**Poster** (desde 2026-10-20): el LCP es una imagen fija de la vista inicial, no la
escena. Un script inline en el `<head>` (no pide nada a la red) repite la regla de
`resolverSlug()` —si cambia una, cambiar la otra—, elige el poster del slug (en
≤ 860 px vertical, el `-movil`) con el `?v=` de `VERSIONES_POSTER` (un poster que no
está ahí ni se pide) y arma la precarga del AVIF (`type="image/avif"`; en escritorio
con `imagesrcset` 1440w/1920w e `imagesizes` `(min-aspect-ratio: 16/9) 100vw, 178vh`,
el ancho que cubre el `object-fit: cover`). `#poster` (`<img>` fijo, z-index 99, justo
debajo de `#carga`) va en un `<picture>` con una `<source>` AVIF; otro script inline
les pone los mismos `srcset`, así el navegador elige el archivo precargado. Un
navegador sin AVIF (Safari < 16.4) saltea la precarga y toma el WebP del `<img>`.
Verificado el 2026-10-20: un solo pedido por pantalla (1920 → `.avif`, 1366 →
`.1440.avif`, celular → `-movil.avif`) y el LCP es `#poster`. Tapa toda la interfaz
todavía vacía; `#carga` va transparente encima (`.sobre-poster`, ícono y texto con
halo). La escena espera a `window load` + `requestIdleCallback` (`paginaCargada`, con
`setTimeout` de respaldo) mientras los datos se piden en paralelo; con el primer
cuadro, `quitarPoster()` lo funde en 300 ms y lo saca del DOM. Sin archivo
(`onerror`), con un slug que no sea `[a-z0-9-]` o ante un error de carga,
`sinPoster()` / `mostrarErrorCarga()` lo sacan y vuelve el degradé. Siempre con
`sacarPoster()`, que saca el `<picture>` entero: un `<img>` sacado de su `<picture>`
vuelve a elegir sin la `<source>` y baja el WebP para nada (pasaba). Mide 1 px menos de
alto que la pantalla a propósito: Chrome no cuenta como LCP una imagen que la tapa
entera (probado en Chrome 155: el LCP pasaba a ser un texto). Un poster casi liso o
comprimido de más tampoco cuenta (Chrome descarta las imágenes de baja entropía).

**Imágenes de Storage** (desde 2026-10-20): portada, renders, planos y fotos de obra no
se piden al archivo original sino a `/storage/v1/render/image/` (transformaciones de
imagen de Supabase, plan Pro), en la medida en que se muestran y en WebP (Supabase lo
elige por el `Accept`). `VARIANTES_STORAGE` + `ponerImagenStorage()` arman `srcset` /
`sizes` donde la caja la fija el CSS: la portada pide una franja recortada (8:1, 4:1 en
el header compacto; sin recorte si hay `portada_foco`), la cabecera del panel 5:2, el
plano y las miniaturas de obra. El lightbox no lleva `srcset` (su caja sale de la
medida natural): `urlLightbox()` pide la caja de la pantalla con alto y ancho, y con
zoom la medida original. Antes bajaba el original: la portada de 72 px de alto pesaba
~310 KB (los 299 KiB que marcaba Lighthouse) y un plano PNG hasta 430 KB; ahora
10–47 KB y 7–27 KB. Si una variante falla (400, p. ej. sin plan Pro),
`respaldoOriginal()` vuelve una vez al original. Ojo con la API: con solo `width`, el
resize por defecto (`cover`) **recorta** en vez de achicar (por eso sin proporción va
`resize=contain`), y Supabase no agranda. `dataset.original` guarda la URL de la base:
las comparaciones de "¿cambió la imagen?" van contra él, no contra `src`.

**Compilación de shaders por partes** (desde 2026-10-21, `CALENTAMIENTO` al final de
`iniciar()`; ver "Cambio 2" en "Optimización del arranque"): compilar los ~12
programas de shader era ~85 % del primer cuadro (~400 ms con GPU real), en una sola
tarea. three r128 no tiene `compileAsync` (llegó en r158) y su `compile()` bloquea
igual: `getProgram()` llama enseguida a `getUniforms()`, que espera el enlace de cada
programa. Así que se compila dibujando: `gruposCalentar()` toma un representante por
programa (`firmaPrograma()`: tipo de material, `map`, `side`, `vertexColors`,
`onBeforeCompile` propio —el de `conFundido()`—, instanciado y con `instanceColor`) y,
al final, uno por variante de la pasada de sombra; `calentar()` dibuja solo ese objeto
(y las luces) en un render target de 1×1 fuera de pantalla, sin recorte por cámara, y
deja todo como estaba. Entre grupo y grupo se cede el hilo, y el primer cuadro va en
su propia tarea. Compila lo mismo que compilaba el primer cuadro (también la sombra) y
sube las texturas: el primer cuadro ya no compila nada. El poster sigue tapando todo, y
el aviso de carga se va recién con el primer cuadro (`ocultarCarga()` pasó de
`cargarTodo()` al `.then()` del calentamiento). Tope `TOPE_CALENTAR_MS` (3 s): pasado,
se dibuja igual (el primer cuadro compila lo que falte) y avisa con `console.warn`. Los
autos pasan por `calentar()` al llegar, antes del primer cuadro en que se ven (en
general no compilan nada: usan los programas del mobiliario). Si una firma junta dos
programas distintos (p. ej. un material nuevo con otra opción que cambie el shader), el
segundo se compila en el primer cuadro: más lento, nada roto; agregar esa opción a
`firmaPrograma()`. `render.debug.checkShaderErrors` va apagado en producción y
prendido en localhost o con `?debug=1`. `KHR_parallel_shader_compile` no se usa: con
r128 no serviría, y SwiftShader no la tiene.

Secuencia de carga: un overlay `#carga` (sobre el poster, si hay) está visible desde el
primer paint →
`resolverSlug()` (path, después `?p=`, después `DEFAULT_SLUG = 'rosso'`) →
`cargarProyecto()` trae el proyecto de `public_projects` y después, en paralelo,
unidades, settings, amenities, renders del proyecto, media de tipologías, el huso
horario del país, e hitos/fotos de obra. Cada consulta tiene un timeout de 15s vía
`abortSignal`. Error de red → el overlay muestra "Reintentar"; slug inexistente o no
publicado → mensaje amable sin reintentar. Cada fila de unidad pasa por
`normalizarUnidad(r)` (que también usa la vista previa al compartir). Si sale bien, y
con la página ya cargada (`paginaCargada`) y las texturas de la calzada
(`texturasAsfalto`: pedidas con `fetch` al cargar el módulo, en paralelo con los
datos; con `fetch` y no con un `<img>`, que demoraría el `load`; las que fallan o no
llegan en 5 s quedan afuera y esa calzada va gris lisa),
`iniciar(proyecto, settings, UNIDADES, mediaTipologias, tzOffsetHoras, hitosObra, tipologias)`
arma todo y el primer cuadro sale después de compilar los shaders por partes (ver
arriba). Las respuestas de Supabase no traen encabezados de caché (verificado el
2026-10-14: sin `Cache-Control`/`ETag`, `CF-Cache-Status: DYNAMIC`), así que cada carga
trae datos frescos. Al volver a la pestaña (`visibilitychange`), `refrescarDatos()`
(antes de la sección KIOSCO) vuelve a pedir unidades, tipologías y su media y actualiza
en el lugar estado, precios, m², tipología asignada, su nombre para el comprador y su
planta; unidades nuevas y cambios de `geom` siguen necesitando recarga (detalle en el
comentario del código).

El script está organizado en secciones numeradas:

1. **DATOS** — mapa `ESTADOS` (`disponible` / `reservado` / `vendido` / `sin_dato`, con
   `color` y `opacidad` del volumen), más `ALQUILER` y `aspectoDe(u)` (ver "Estados de
   presentación" más abajo), resolución del slug, `cargarProyecto()`, formateo (`formatearPrecio`
   usa `moneda`/`locale` del proyecto), matemática solar, tracking de eventos/leads
   (`obtenerSesion()` = uuid en localStorage, `obtenerOrigen()` = atribución por `?src=`;
   fuera de producción siempre `'preview'` —otro `*.vercel.app`— o `'local'` —localhost,
   una IP, `file:`, `about:srcdoc`—, aunque haya `?src=`: `origenDePrueba()`. Producción
   es la lista explícita `HOSTS_PRODUCCION` (`['armadoporcota.vercel.app']`). **Si cambia
   el dominio del visor en Vercel, actualizarla junto con `BASE`:** un `*.vercel.app` que
   no esté en la lista se marca `'preview'` y Demanda deja de contar sus visitas. Un
   dominio propio que no sea `*.vercel.app` cuenta como producción aunque falte en ella),
   y los que pintan cosas fuera de la escena 3D (redes, amenities, texto legal, lightbox
   de renders, sección de avance de obra).
2. **ESCENA** — renderer, luces, cielo, entorno. Las dimensiones salen de
   `proyecto.geometria` con los valores de ROSSO como fallback (`ancho` 5.4, `prof` 6.4,
   `alto` 3, `losa_espesor`, `sep_x`/`sep_z`, `losa_*`, `nucleo_*`). Entorno: calle
   (`geometria.calle`, ver "La calle" más abajo) extendida en grilla hasta el horizonte,
   con piso, domo de cielo y fundido propio en vez de niebla (ver "Entorno extendido"
   ahí mismo), cartel con el nombre de la calle anclado al mundo
   (`geometria.calle_nombre` o extraído de `direccion`), árboles con random por semilla
   (estables entre recargas), autos GLB cargados una vez y reutilizados con `.clone()`
   (la malla del pack, con sus materiales reemplazados por dos tonos: carrocería y
   oscuro; sin faros ni luces de color), faroles, bancos. GLTFLoader y el decoder de
   meshopt no son `<script>` del HTML. Nada de los autos está en el camino crítico
   (desde 2026-10-20): `cargarAutos()` arranca después del primer cuadro, con
   `requestIdleCallback` (como mucho 1,5 s; sin él, `setTimeout` de 1,5 s), pide los
   dos scripts (`pedirCargadorGLTF()`, un solo GLTFLoader) y después cada `.glb` de a
   uno, poniendo cada auto en la calle a medida que llega. Antes se pedía todo en
   paralelo en medio de `iniciar()`, antes del primer cuadro. Cada modelo se usa una vez:
   InstancedMesh no aplica (los autos de contexto, que se repiten, ya van instanciados).
   Si algo falla, no hay autos (o falta uno) y el visor sigue igual.
3. **TORRE** — `for (let piso = 1; piso <= PISOS; piso++)` con `PISOS = proyecto.pisos`:
   losa, núcleo, y un mesh por unidad, coloreado con `aspectoDe(u).color`, con
   `userData.unidad` apuntando al objeto de la unidad (así el raycasting mapea un mesh a
   su unidad). Los meshes de unidades viven en `cajas`.
4. **CÁMARA** — cámara orbital (`theta`/`phi`/`radio`), vista inicial desde el frente
   del edificio, radio escalado según la altura del edificio y el aspecto de la
   pantalla (`radioBase()`). **Encuadre general** (`encuadreTorre()`, desde
   2026-10-20; lo usan la vista inicial, "Vista inicial", separar pisos, la vuelta de
   un piso aislado y el showroom): el edificio entero, de la base al techo, centrado en
   lo que deja libre la interfaz (`rectLibre()`: arriba el header y en mobile la ficha
   —`finFicha()`—; abajo la barra inferior y la toolbar; en desktop, a la izquierda el
   borde derecho de la ficha y a la derecha el riel), corriendo el objetivo sobre los
   ejes de la cámara como `enfocar()` (sin `setViewOffset`, así `enfocar()` no cambia).
   Nunca más cerca que `radioBase()`, solo se aleja si no entra. A lo ancho mide la
   planta con el giro en 0; a lo alto, el cilindro que barre al girar (ni techo ni
   base pasan debajo de un overlay en todo el giro automático). `reencuadrar()` lo
   rehace (`obsInterfaz`: pantalla, ficha, header, barra, riel y toolbar)
   solo si la cámara sigue en el último encuadre general (no se acercó ni inclinó,
   no hay unidad ni piso); arrastrando, espera al `pointerup` porque `moverCamara()`
   fija el giro mientras dura. Rotación automática lenta (una vuelta cada 80 s) desde el arranque, que se
   corta con cualquier interacción y vuelve tras `INACTIVIDAD_MS` (6 s) sin actividad,
   salvo con un panel, hoja, tarjeta o piso aislado abierto (`puedeGirar()`). Arrastre con
   un dedo (o el mouse) = giro; en táctil, el pellizco con dos dedos acerca o aleja hacia
   el objetivo con los límites de la rueda (`radio` 34–190, vía `ubicarCamara()`; los
   punteros en `dedos`, el pellizco vuelve a medir cada vez que cambia la cantidad y el
   dedo que queda sigue girando sin salto). Los controles del simulador solar también
   viven acá.
5. **INTERACCIÓN** — hover (tooltip con resumen + emissive) y click (`abrir(u)`). Los
   filtros (chips de dormitorios armados desde los datos, chips de estado, torre, aislar
   piso, "separar pisos") pasan todos por `pasa(u)` / `aplicar()`, que atenúan/desactivan
   los meshes que no coinciden en vez de sacarlos. `aplicar()` no toca el material: fija
   objetivos (`userData.opObj` / `colorObj` / `bordeObj`) y el bucle los interpola (fundido
   al filtrar); el hover hace lo mismo con `userData.emObj`. Toolbar de vista y brújula
   (ver "Interfaz" más abajo) también viven acá.
6. **BUCLE** — loop de render + las interpolaciones de arriba + la brújula. Arranca
   después del calentamiento de shaders (`CALENTAMIENTO`, ver "Compilación de shaders
   por partes").

### Interfaz alrededor del visor

Común a todos los proyectos (no hay tema por proyecto). Tokens en `:root` (`--verde`
`#2B6656` es el color de marca, reservado para lo disponible y acentos).

- **Barra superior** (`#barra-sup`, `--alto-barra`: 72px, 56px en ≤640 — el header
  tiene su propio corte, no el de 860): logo (la inicial del nombre corto sobre
  `--verde`) + nombre partido en "by" en dos renglones (`"ROSSO by Block"` → `ROSSO` /
  `by Block`; sin "by" en el nombre usa `desarrolla`), divisor, bloque de dirección
  (rótulo del tipo, `projects.tipo`, null = "Edificio"; la calle y debajo número,
  barrio y ciudad: `direccion` se parte en el número de puerta o, sin número, en la
  última coma) y a la derecha las redes como chips redondos + la firma de Cota, y
  `#brochure` (oculto hasta que exista `settings.brochure_url`, columna que todavía no
  existe). **Portada** (`projects.portada_url`, encuadre con `portada_foco` =
  object-position, null = center): foto a la derecha (55% del ancho, 60% en mobile)
  con un degradado desde `--superficie` encima; el header pasa a opaco recién cuando la
  foto cargó (`.con-portada`), sin dato o si falla queda translúcido como antes. En
  ≤640: sin divisor ni segundo renglón de la dirección, el rótulo va junto al nombre y
  se va si lo cortaría (`ajustarCabezal()`; en ≤440 no va nunca: el lugar es para la
  calle, que así entra completa hasta 430), y redes + Cota van en un menú `⋯` (`menuRedes()`; círculo de 36 con toque
  de 44, `::after`). El blur vive en `#barra-sup` y no en `#cabezal`: un
  `backdrop-filter` en `#cabezal` rompería el `position: fixed` de `#piso-info`.
  `enfocar()` mide el borde de la barra en vez de suponer su alto.
- **Ficha** (`#ficha`): pisos (por torre si hay `geom.torre`, calculado en vivo),
  unidades, entrega y disponibilidad contada en vivo por `aspectoDe(u)`, solo estados
  con unidades y solo si `muestra_totales`. La dirección no va acá: está en el header.
  Es la misma tarjeta en todos los anchos (desde 2026-10-20; antes, en desktop, una
  tarjeta de 300px siempre abierta con una fila por estado, y en mobile una píldora +
  una tarjeta aparte): en desktop flota arriba a la izquierda, 420px como mucho (la
  capa de amenities, debajo, tiene el mismo ancho); en mobile va a lo ancho debajo del
  header, hasta 400px. `#cb-datos`, `#aviso` y `#cb-extra` (la ficha vieja de desktop)
  siguen en el HTML, ocultos: de `#cb-datos` salen los íconos y el texto para lector
  del renglón de datos. Plegada queda en tres renglones (88px): leyenda en una
  píldora de fondo sutil con divisores y el chevron adentro (si no entra, etiquetas
  abreviadas; si ni así, con el texto agrandado, los estados bajan de renglón enteros:
  número y etiqueta nunca se separan), barra proporcional y "▤ 10 pisos | ▦ 78 u. | ▢ Mar 2028 | 7 amenities ›"
  (`#fc-linea`; "amenities" abre la capa; si no entra se va "Torre" y después los
  íconos, todo en `ajustarCabezal()`). Desplegada (transición de altura, 180 ms) suma
  solo la fila de amenities (`#fc-amenities-fila`: ícono + nombre corto — el texto si
  tiene ≤ 16 letras, si no el nombre del ícono en el catálogo —, sin la cifra; se
  desliza de costado; tocarla abre la capa). Arranca desplegada (pedido de
  Sebastian, 2026-10-20: con un solo renglón más queda compacta), salvo en mobile con
  `?u=` o `?sol=`; el encuadre inicial ya cuenta con ella. Sin amenities no se
  despliega. En mobile, con el
  panel abierto queda solo la leyenda: con los tres renglones la franja libre sobre la
  hoja bajaba de 80px y `enfocar()` dejaba la unidad debajo de la ficha. Ahí la
  píldora es la tarjeta (desde 2026-10-22: 36px, margen 8, sin la tarjeta blanca
  alrededor; el toque sube hasta el header, 44px). Abrir/usar
  Filtros o Pisos no la pliega (pedido de Sebastian: los datos del edificio no
  desaparecen; `enfocar()` encuadra debajo de ella con `finFicha()`, y el riel y
  Filtros van siempre debajo vía `--fin-ficha`, que mide `ajustarCabezal()` en
  `obsInterfaz`); arrastrar el edificio, tocar el vacío, otra capa (sol,
  renders, avance), Escape o abrir el panel sí la pliegan. Tocar una unidad abre el
  panel, así que también la pliega (desde 2026-10-19; antes mostraba la tarjeta y no).
- **Barra inferior única** (`#barra-inferior`): en desktop, desplegables Tipología /
  Estado / Torre / Vista que abren `#filtros` como popover con un solo grupo
  (`data-grupo`, `abrirGrupoFiltros()`), Restablecer (`restablecerFiltros()`, reusa los
  sets + `aplicar()` + click en los toggles) y los accesos a renders / avance. En
  mobile: Filtros · Pisos + íconos (renders, avance, sol), cada uno abre su hoja; nunca
  dos hojas abiertas (la ficha desplegada sí convive con Filtros y Pisos). Con el panel de
  la unidad abierto (desktop) se centra en lo que queda libre; si ni así entra, se esconde
  hasta que se cierre (`.sin-lugar`, `acomodarBarraInferior()`).
- **Riel de pisos** (`#pisos`): cifra = unidades **disponibles** del piso; flechas que
  hacen click en la fila vecina (`moverPisoAislado()`); centrado entre "Panel interno" y
  la toolbar para no superponerse; en pantallas bajas compacta filas y un fundido en el
  borde avisa que hay más pisos.
- **Tooltip / tarjeta de unidad**: `pintarResumenUnidad()` (número, estado, torre/piso,
  tipología, m², precio — alquiler en UYU/mes, vendidas sin precio). Desktop: hover =
  tooltip (nunca sobre la unidad abierta en el panel; sobre las demás sí). Click o tap
  = `abrir(u, true)` directo (desde 2026-10-19; antes pasaba por la tarjeta): la cámara
  va hasta la unidad (`enfocar(u)`, vía `moverCamara()`, 750 ms), la unidad queda
  resaltada como elegida (contorno, ver "Selección de unidad", punto 2), se abre el
  panel y se registra el evento: desde ese día Demanda cuenta clicks en unidades (antes,
  aperturas desde la tarjeta), así que no se compara con lo anterior. Un clic en la
  unidad que ya está abierta solo la vuelve a encuadrar (sin otro evento). Con el panel
  abierto, un click en otra unidad cambia el contenido en el lugar (sin cerrar ni volver a
  deslizarse) y el scroll del panel vuelve a 0. X, Escape o un click en el vacío lo
  cierran. Un arrastre de más de `UMBRAL_ARRASTRE` (5 px) entre `pointerdown` y
  `pointerup` no abre ni cierra nada (se mide en el recorrido: en táctil el click trae
  las coordenadas del comienzo del toque). Un pellizco tampoco: el segundo dedo en el
  lienzo pone `arrastreClic` en `Infinity`.
  `#tarjeta-unidad` (`seleccionar(caja)`) queda solo para la demo del showroom: en
  desktop va `.anclada` a la unidad (aspecto de
  tooltip, la sigue si se gira el edificio; `ubicarTarjeta()` en el bucle) con "Click
  para ver la unidad"; en táctil (`matchMedia('(hover: none)')`) sube sobre la barra
  inferior con "Ver unidad". En los dos casos una línea guía (`#tarjeta-guia`,
  `actualizarGuia()`) une la tarjeta con un punto en el centro de la fachada de la unidad
  que mira a la cámara. El botón de la tarjeta no la esconde:
  `viajarAlPanel()` la lleva hasta el lugar del panel y la convierte en él (`MS_VIAJE` 360 ms,
  `--ease`; el panel aparece al final con `.desde-tarjeta`, sin deslizarse); con
  `prefers-reduced-motion` el panel aparece directo. Con el panel abierto, `#marca-unidad`
  (`actualizarMarca()`) marca la unidad con punto y anillo y una línea al borde del panel o de
  la hoja; si otro volumen la tapa (rayo contra `ocludoresSol`) va punteada. `?u=` también
  abre el panel directo. `enfocar()` encuadra la unidad en lo que dejan libre la tarjeta o
  el panel.
- **Toolbar** (`#herramientas`): brújula + píldora de 48px (misma altura y línea de base
  que `#barra-inferior`) con cuatro grupos separados por `.hr-sep`: vista inicial · zoom ·
  giro automático / sol · pantalla completa (`#hr-pantalla`, último a propósito: en el
  modo showroom queda solo en esa esquina). `#sol-trigger` se muda por JS
  (`ubicarSolTrigger()`, antes de `#hr-sep-pantalla`): en desktop a la píldora, en mobile
  a la barra inferior. No sumar más controles acá. Si la barra inferior centrada chocaría
  con la toolbar (Restablecer + renders/avance la estiran), `acomodarBarraInferior()` la
  corre a la izquierda con `.corrida`, igual que el layout de tablet (861–1180px).
  Giro y zoom (`moverCamara()`
  interpola giro/phi/radio/objetivo con los mismos límites que el arrastre). **Brújula**
  (solo con `norte_grados`): `anguloNorte(giro)` proyecta el norte del modelo
  `(−sin N, −cos N)` girado por `giro` sobre la pantalla con la cámara en `theta`; click
  = norte arriba. En mobile queda solo la brújula (el zoom es el pellizco, ver CÁMARA).

### Modo showroom (kiosco)

Pantalla completa con el edificio solo, girando, para una pantalla o tablet en la sala de
ventas sin nadie que la atienda. Sección `KIOSCO` del script (al final de `iniciar()`).

- Entrada: `#hr-pantalla` en la toolbar (`requestFullscreen`; el modo dura lo que dura la
  pantalla completa y todo sale de `fullscreenchange`), o `?p=<slug>&kiosco=1`, que
  arranca ya limpio y muestra "Iniciar" (el navegador exige un toque para la pantalla
  completa). Con `?kiosco=1`, salir de pantalla completa vuelve a "Iniciar", no a la
  interfaz; `queryProyecto()` conserva `kiosco=1` al reescribir la URL. Sin Fullscreen API
  (iPhone) el modo anda igual, sin botón.
- El modo es `body.kiosco` (el CSS esconde cabezal, ficha, filtros, riel, barra inferior,
  sol, brújula y el resto de la toolbar) + otros tiempos del **mismo** giro automático:
  `VEL_GIRO_KIOSCO` (una vuelta cada 90 s) y `INACTIVIDAD_KIOSCO_MS` (vuelve a los 20 s).
  En el modo `puedeGirar()` ignora riel/filtros/sol/piso aislado (no están a la vista).
  No toca filtros, piso aislado ni separar pisos: al salir quedan como estaban.
- Entrar cierra tarjeta/panel y lleva la cámara a `encuadreGeneral()` (el de "Vista
  inicial", sin el giro en 0); el giro arranca al llegar. Una tarjeta o panel abiertos
  20 s sin actividad se cierran solos (`volverAlGiro()`).
- **Demo**: tras `CADA_DEMO_MS` (45 s) de giro, el reloj del showroom destaca una unidad
  con `seleccionar()` tal cual (cámara, resaltado, tarjeta ampliada, guía; no abre el
  panel ni registra evento), la deja `MS_DEMO` (8 s) y vuelve al giro.
  `proximaUnidadDemo()`: solo `estado = 'disponible'` y `activa` (respeta los filtros),
  sin repetir hasta agotar la lista, saltando ≥ un tercio de `PISOS` respecto de la
  anterior. Sin candidatas no hay demo, solo giro. Un toque la corta igual que al giro:
  la demo guarda el `ultimaActividad` que dejó su propio `moverCamara()`; si cambia, fue
  un toque y la tarjeta queda del visitante. No corre con "Iniciar" a la vista.
- Tarjeta y tooltip de unidad ~1,6× más grandes. Del panel se esconde lo que se llevaría
  la pantalla o no sirve en un aparato compartido (WhatsApp/Consultar, lista de espera
  —una sola sesión para todos—, copiar link); el cartel de calle no abre Maps.
- Marca abajo a la izquierda (`#kiosco-marca`). Wake Lock mientras dure el modo (se
  vuelve a pedir al volver a la pestaña; sin soporte se ignora).
- **Datos al día**: la pantalla nunca se oculta, así que no le llega el
  `visibilitychange`. Mientras dure el modo, `refrescarDatos()` cada
  `MS_CONSULTA_KIOSCO` (60 s; `programarConsultaKiosco()`); se detiene con la pestaña
  oculta y se reanuda al volver. Es la misma consulta de la carga (~10 KB comprimidos
  en BRUSCO), sin conexiones abiertas. El tiempo real de Supabase se descartó
  (2026-10-14): en una campaña, el tope de conexiones simultáneas (200 en Free) es un
  riesgo que esto no tiene.
- **QR** (`#kiosco-qr`, arriba a la izquierda; `actualizarQR()` desde el mismo reloj):
  `linkProyecto(BASE)` (siempre la URL pública, aunque el visor se abra desde localhost o
  una copia local), más `&u=<id>` si hay una unidad destacada (demo, tarjeta o panel),
  siempre sin `kiosco` ni `v=` (un QR fotografiado tiene que seguir sirviendo aunque
  cambie el estado) y con `&src=qr-showroom`. La librería (`qrcode-generator` 1.4.4,
  cdnjs) se carga recién en el modo; el svg se arma a mano (`pintarQR()`). Sin red no
  hay QR y reintenta cada 30 s. Es la única tarjeta blanca del modo: el QR necesita
  fondo y margen para leerse.
- Atribución: usar `&src=showroom` en la URL de la pantalla para separar sus eventos en
  Demanda (todos los visitantes del aparato comparten una sesión). La pantalla tiene que
  abrir la URL de producción (`https://armadoporcota.vercel.app/?p=<slug>&kiosco=1&src=showroom`):
  desde localhost, una IP de la red o un preview, sus eventos salen con origen `'local'` o
  `'preview'` aunque lleven `&src=` (ver `origenDePrueba()`), y Demanda no los cuenta.

### Estados de presentación: `aspectoDe(u)` / `ALQUILER`

El color y la opacidad del volumen salen de `aspectoDe(u)` (= `ESTADOS[u.estado]`).
Vendida va en gris casi transparente (no rojo); `sin_dato` en gris neutro legible (en
ROSSO son la mayoría) y en el visor se llama "A consultar" (píldora del panel, tooltip,
leyenda y chips; desde 2026-10-22, antes "Sin estado público"); admin conserva el rótulo
interno. `'alquiler'` es un estado real (`supabase-migration-alquiler.sql`):
verde salvia, precio en `units.precio_alquiler` (siempre UYU/mes, formato es-UY,
independiente de `moneda`); `precio` sigue siendo el de venta. Si un proyecto tiene
alquiler, "Disponible" se presenta como "En venta" en leyenda y chips. El riel de
pisos cuenta venta + alquiler (`esOfertable`). Transición: `cargarProyecto()` todavía
convierte `sin_dato` + `geom.operacion = 'alquiler'` (+ `geom.precio_alquiler_uyu`) al
estado nuevo; se puede sacar cuando BRUSCO esté migrado. En admin, la columna
Alquiler solo aparece si el proyecto tiene alguna unidad en alquiler o con
`precio_alquiler`; precio y alquiler los edita solo admin de proyecto/plataforma
(el trigger se los bloquea al vendedor).

### Panel de detalle de la unidad (`abrir(u)`)

- **Ancho**: en desktop `--ancho-panel` (`clamp(400px, 37vw, 720px)`: la proporción de la
  referencia aprobada; 505px a 1366, 710 a 1920), a toda altura; en mobile, hoja inferior a
  lo ancho. `enfocar()` encuadra en `W − panel.offsetWidth`, y el sol y la barra inferior se
  corren con la misma variable: nada asume un ancho fijo. El pie y los amenities responden
  al ancho del panel (`@container`), no al de la pantalla. En la hoja (≤860) la
  cabecera, la barra de datos y la intro alinean su contenido a `--p-pad` (20px), como
  el resto; en desktop siguen en 24.
- **Hoja arrastrable** (≤860, desde 2026-10-23; sección "Hoja arrastrable" del script,
  después de `cerrar()`): tres anclajes. **Baja** = foto + pie (`.hoja-baja`,
  `--alto-hero` + `--alto-pie` + 1 del borde, los dos por `ResizeObserver`), **media** =
  74vh (sin clase, la de siempre) y **alta** = hasta 8 px debajo del header
  (`.hoja-alta`). Con contenido corto la alta mide lo que el contenido (ROSSO 801 a
  390: 744). Si un anclaje queda a menos de 48 px de la media se descarta: a 430 px
  ROSSO 801 no tiene alta, y en el celular horizontal queda solo la media. Abre en media;
  al cambiar de unidad conserva el anclaje; al volver a abrir, media (`abrir()` llama a
  `ponerAnclaje()`).
  - Se agarra del tirador (`#p-tirador`, un `<button>` sticky arriba: sigue a mano con
    el contenido scrolleado) o de la foto, con Pointer Events y `touch-action: none`
    solo ahí. La captura del puntero arranca recién a los 8 px, y nunca desde un botón,
    un link o el popover ⓘ.
  - Desde el contenido van eventos touch (`touchmove` no pasivo): la hoja se mueve solo
    si el scroll estaba arriba de todo y el dedo baja. Si no, scrollea como siempre (no
    hay "scroll hacia arriba que agranda la hoja": pedido de Sebastian). Pointer Events
    no sirve ahí: con `pan-y` el navegador manda `pointercancel` apenas empieza su
    scroll. `#p-fin-entrega` y los campos no mueven la hoja.
  - Mecánica: en reposo el alto lo pone el CSS; al arrastrar se anima solo el
    `transform` (la caja se fija en el alto que se ve y crece una vez si el dedo sube
    más) y el pie va al revés para quedar fijo abajo hasta la baja. Al soltar,
    `fijarAnclaje()` vuelve al reposo en el mismo cuadro. El arrastre arranca desde
    donde se apoyó el dedo: con cuadros lentos el navegador entrega un gesto rápido en
    un solo evento, y si no perdía la velocidad.
  - Al soltar: un gesto de más de 0,5 px/ms va al anclaje vecino en ese sentido (nunca
    dos); si no, al más cercano a la posición + 150 ms de velocidad. Cierra al soltar a
    más de ⅓ de la baja por debajo de ella, o con un gesto rápido hacia abajo desde la
    baja (desde la media un gesto rápido va a la baja, nunca cierra). Después de un
    arrastre se descarta el click siguiente, y soltar cuenta como actividad para el
    giro automático.
  - Al asentarse en baja o media llama a `enfocar()`, salvo que la cámara se haya
    movido a mano desde el último encuadre (`camaraManual`: arrastre del lienzo de más
    de `UMBRAL_ARRASTRE`, pellizco o rueda; lo limpia `enfocar()`). En alta no: el
    edificio queda tapado.
  - Tocar el tirador, Enter o Espacio pasa al anclaje siguiente (media → alta → baja →
    media, salteando los descartados); `aria-label` "Expandir detalle" / "Contraer
    detalle" + `aria-expanded`. Con `prefers-reduced-motion`, sin animación.
    `overscroll-behavior: contain` en `#panel` (sin pull-to-refresh). Desactivado
    durante `.desde-tarjeta` (el viaje del showroom). Desktop sin cambios: el tirador va
    con `display: none`.
- **Amenities del edificio**: en el panel, grilla sin tarjetas con líneas entre celdas: 4
  columnas desde 440px de grilla, 3 en un panel angosto (pantallas de ~1300px o menos), 2 en
  ≤ 480px; texto cortado a 3 líneas y a lo sumo `MAX_AMENITIES_PANEL` (8); con más, "Ver
  todos" despliega el resto en el lugar. En celular (≤480, desde 2026-10-22) el ícono va
  a la izquierda (20 px, alineado con el primer renglón) y el texto al lado, a la izquierda. Mismos datos e íconos (`amenities.icono`) que la
  hoja de la ficha (`#ce-amenities`), que conserva sus tarjetas.
- **Descripción + plano** (`#p-intro`, `pintarIntro()`): debajo de la barra de datos, texto
  a la izquierda (eyebrow "Unidad N", título en Fraunces —la única serif, de Google Fonts,
  fallback Georgia—, descripción y "Ver plano") y tarjeta 4:3 del plano a la derecha; en
  ≤ 480 px, una columna. Título: `geom.titulo` > `typologies.titulo` > "{tipología} en
  {barrio}" (barrio = último tramo de `direccion` con coma, si no `ciudad`). Texto:
  `geom.descripcion` > `typologies.descripcion` > uno armado con dormitorios, m² y
  orientación. Las columnas `titulo`/`descripcion` de `typologies` **no existen todavía**
  (se leen si la vista las trae, como `nombre_publico`). El plano es la primera planta de
  la tipología (`media` con `scope='typology'`), con `mix-blend-mode: multiply` para que el
  blanco del dibujo tome el tono de la tarjeta; "Ver plano" o la tarjeta abren el lightbox
  `galeria` (planta y después los renders de la tipología) con zoom (`zoomGaleria`, solo
  abierto así, `{ zoom: true }`): pellizco 1–4x en el punto medio de los dedos, arrastre
  con rebote en los bordes, doble toque/doble clic 1x ↔ 2.5x, rueda en desktop, deslizar
  hacia abajo a 1x cierra, y "Pellizcá para ampliar" la primera vez en táctil
  (`localStorage` `cota_pista_zoom`). "Ver renders" y las fotos de obra siguen sin zoom.
  Sin planta o si no carga:
  estado vacío del mismo tamaño (grilla de plano) con "Solicitar plano", el WhatsApp de
  `settings.whatsapp` con otro mensaje; no va en kiosco, sin WhatsApp ni en
  vendida/reservada (como la consulta del pie). Excepción en celular (≤480, desde
  2026-10-22): sin planta, el estado vacío es una franja de ~64 px (ícono, título, m² y
  "Solicitar plano" con toque de 44) y con planta la tarjeta es 3:2; la hoja mide 74vh
  igual, así que lo de abajo sube pero la hoja no salta. En desktop y tablet sigue el
  "mismo tamaño" 4:3. Con planta, en todos los anchos, el m² de la tarjeta va en una
  franja debajo del dibujo (28 px de padding abajo), nunca encima; la tarjeta no crece.
  Nunca un esquema dibujado desde m²/dorms
  (el viejo `plantaSVG()` / `ambientes()` ya no existe).
- **Tipología** (`tipologiaDe(u, NOMBRES_TIPOLOGIA)`): `nombre_publico` de la tipología
  asignada; si no hay, `geom.tipologia` ("Estudio", "Flex"), aunque la unidad tenga
  `typology_id`; si no, los dormitorios. `typologies.nombre` no se muestra (ver los dos
  nombres en "Modelo de datos").
- **Información del proyecto** (ⓘ en la cabecera, `#p-info`, `pintarLegal()`): popover con
  `settings.textos.legal`, una oración por párrafo, con título "Vivienda Promovida · Ley N"
  solo si el texto la nombra, + la nota de demo (escrita en el HTML). Se cierra con un toque
  afuera, Esc (sin cerrar el panel) o el mismo ⓘ. Sin texto legal ni nota no hay ⓘ.
- **Cabecera** (`.p-hero`, `pintarPanel()`): foto a lo ancho (el primer render de la
  tipología; si no tiene, `renderPortada`, el primero del proyecto; sin ninguno, fondo
  verde) con piso, número, píldora de estado y píldora de orientación encima, y copiar / ⓘ
  / cerrar en círculos blancos (toque de 44 en la hoja). El degradado de la foto es más
  oscuro a la izquierda y arriba, en todos los anchos: con el anterior, el piso (blanco
  al 90 %, 13 px) no llegaba a AA (en la hoja desde 2026-10-22; en desktop desde la
  fase 7, donde ROSSO y BRUSCO también fallaban). En ≤480 el alto sale del
  contenido (~134 px: 16 arriba, 12 entre número y píldoras, 12 abajo; píldoras de 30 en
  el flujo, así un texto más grande la agranda en vez de pisarse) y el piso nunca llega a
  los botones (si no entra, baja de renglón). El color de la píldora de estado va por `data-estado` en
  el CSS, no el de `ESTADOS`: los claros de la leyenda no dejan leer el blanco sobre la
  foto. Debajo, la barra de datos (`.p-datos`): dormitorios o tipología · m² "(área
  propia)" + terraza · orientación, los tres en una sola fila (pedido de Sebastian,
  2026-10-19). Si no entran, se acomodan adentro de su lugar: primero "(área propia)" y
  la terraza pasan debajo del m², después la orientación se parte en dos renglones;
  dormitorios no se parte. Solo si ni así entran la orientación baja de renglón: con el
  panel en su mínimo (400 px, ventanas de menos de ~1080 px) o, hasta ~1280 px de
  ventana, en unidades con terraza y orientación larga (Altamira: "Contrafrente en L").
  En celular (≤480), sin scroll y con la orientación siempre a la vista (desde
  2026-10-22; antes la fila se deslizaba y a 360 px la orientación quedaba fuera de
  pantalla): 16 entre datos (12 en ≤340), íconos de 18, "(área propia)" debajo del m² si no entra y,
  a 320 px, la orientación baja entera de renglón, alineada a la izquierda. En celular
  "(área propia)" va solo si la unidad tiene terraza (es solo presentación: el dato no
  cambia), y con terraza son cuatro datos en una grilla de 2×2 sin líneas (dormitorios |
  m² / orientación | terraza): la terraza va en su propia celda (`#p-terraza-c`, la llena
  `pintarPanel()`; en desktop sigue "+ X m² terraza" al lado del m²).
- m², terraza (`m2_terraza`), precio de cochera opcional (`cochera_precio`), unidades
  similares (`mostrarSimilares`).
- Link de **WhatsApp** armado con `settings.whatsapp` + mensaje con plantilla +
  `linkDe(u)`. Sin `settings.whatsapp` el botón no va (BRUSCO; antes quedaba con
  `href="#"`).
- **Pie** (`.p-pie`, sticky al fondo de la hoja): la consulta. Responde al ancho del panel
  (`@container pie`): más de 480 px, en una fila; hasta 480 (panel de desktop angosto),
  texto arriba y botón abajo. En celular (≤480 de pantalla, desde 2026-10-22) una fila
  compacta: ícono de 24 y título (hasta dos renglones) a la izquierda y el botón de 48 a la
  derecha, sin subtítulo, ~72–80 px (antes 136, 154 a 320). Con `consulta_url` no va el
  título (Consultar a lo ancho + WhatsApp solo ícono); vendida/reservada, "Avisarme si se
  libera" a lo ancho. Sin ningún botón a la vista (formulario de espera en pantalla, o un
  proyecto sin WhatsApp ni `consulta_url`) el pie no va y `--alto-pie` queda en 0. Con el texto agrandado por el sistema se vuelve a apilar: el
  container query mide en `em` del propio pie (`22em`), que crece con el texto. El
  `scroll-padding-bottom` del panel sale del alto real del pie (`--alto-pie`, un
  `ResizeObserver`) + 16, así un foco o un `scrollIntoView` no quedan debajo de él.
- **Simulador de financiación** (`tieneFinanciacion()` / `calcularFinanciacion()`):
  deslizador de entrega + cuotas mensuales hasta `projects.fecha_ocupacion` + saldo
  contra entrega de llaves, configurado en `settings.financiacion` jsonb
  (`entrega_min/max/default`, `saldo_pct`, `ajuste_indice`, `mostrar_ajuste`). Si no está
  configurado se oculta por completo — nunca con valores default inventados. Usarlo
  registra una fila en `events` con `tipo='simulacion'`.
- **Lista de espera** en unidades `reservado`/`vendido`: inserta en `leads` con
  `tipo='espera'`; el admin recibe el aviso en la pestaña Unidades cuando la unidad
  vuelve a estar disponible.
- Compartir: la URL pasa a `?p=<slug>&u=<id>` vía `history.replaceState` (con guarda
  para `about:srcdoc`); `BASE` es la URL canónica para los links compartidos desde
  contextos no-http. Al cargar, `?u=<id>` reabre esa unidad y enfoca la cámara en ella
  (`enfocar(u)`).
- Los links que se comparten llevan `&v=`: `linkDe(u)` (botón copiar del panel y mensaje
  de WhatsApp) y `#red-compartir` (la URL de la barra tal cual + `v` de la unidad de
  `?u=` o del proyecto, vía `conVersion`, que arma `iniciar()`). `v` =
  `versionCompartir(unidades)`: FNV-1a de id, estado, precio, precio de alquiler y
  `estimado`, el mismo cálculo que hace `api/compartir.js` (ver "Vista previa al
  compartir"). Entra el valor, no cómo vino guardado (136673 = "136673.00"; null = '' =
  sin precio; `estimado` solo cuenta si es `true`). El visor ignora `v=` al abrir un
  link; los links sin `v=` andan igual.
- Cada `abrir(u)` registra un click en `events` (`registrarEvento`), que alimenta la
  pestaña Demanda del admin. Con `eventos-consulta` aplicada, volver a abrir la misma
  unidad dentro de 60 s no suma otro (el trigger lo descarta). Los botones de consulta
  registran su canal (desde la fase 8b) con `registrarConsulta()`: `#p-wa` →
  `'whatsapp'`, `#p-consultar` → `'formulario'`, `#p-espera-ir` → `'espera_ir'` y
  `#p-plano-pedir` → `'plano'`. Va con `fetch` + `keepalive` y no con `sb`: el toque abre
  WhatsApp o navega al formulario, y el pedido tiene que salir igual (supabase-js no
  permite `keepalive` por pedido; `sendBeacon` no manda los headers de Supabase). No
  frena el link ni espera la respuesta; los toques repetidos los descarta la base (sin
  dedup en el cliente). En el showroom esos botones no van.

### Selección de unidad: comportamiento protegido

Pedido explícito de Sebastian: que no se vuelva a perder. Todo cambio que toque el click
del lienzo, `seleccionar()`, la tarjeta, `abrir()`, `enfocar()`, `moverCamara()`,
`actualizarGuia()` o el bucle de render tiene que dejar esto funcionando igual, y se
verifica en el navegador (desktop y ~390px, en ROSSO y en BRUSCO) antes de darlo por
terminado. Si algo de la lista tiene que cambiar, se acuerda con Sebastian antes, no se
saca de paso. Versión de referencia: commit `8d5c300`, con los puntos 3 y 4 cambiados
el 2026-10-19 a pedido de Sebastian (el clic abre el panel directo; la tarjeta quedó
para la demo del showroom). `scripts/control-seleccion.mjs`
controla esta lista en cada commit (ver "Correr / probar"); si un cambio acordado la
modifica, se actualizan el script y esta sección en el mismo commit.

1. Click o tap en una unidad → la cámara va hasta quedar frente a ella con recorrido
   suavizado (`moverCamara()`, `MS_CAMARA_UNIDAD` = 750 ms, ease-out cúbico), nunca un
   salto. Con `prefers-reduced-motion`, inmediato.
2. La unidad queda resaltada como elegida, distinta del hover, y vuelve a la normalidad
   al cerrar: **contorno** sobre sus aristas reales (`CONTORNO`: halo oscuro de 5 px +
   núcleo blanco de 2,5 px, líneas gruesas de r128 con ancho fijo en pantalla), opacidad
   ≥ 0,92 y emissive bajo (0,2) en su propio color. El contorno entra desde el clic en
   ~450 ms (fundido + crecimiento del trazo) y después queda quieto, sin pulsos: la
   selección dura lo que dura la lectura del panel. Al cambiar de unidad, fundido cruzado
   de ~200 ms sin crecimiento; al cerrar sale en ~180 ms; con `prefers-reduced-motion`,
   inmediato. Lo tapa solo lo que está adelante (profundidad + un sesgo del ancho del
   trazo): nunca se ve a través de una fachada. Por qué no el emissive 0,6 de antes:
   aclaraba hacia blanco y lavaba el color del estado, así que de costado, de lejos o en
   estados claros (vendida, sin estado) la elegida casi no se distinguía, y un verde de
   disponible aclarado se acercaba al salvia de alquiler. Con 0 las caras a la sombra
   quedaban apagadas (la reservada, barrosa); con 0,2 cada estado queda cerca del color
   de su leyenda (comparado en BRUSCO el 2026-10-14). Si los scripts de las líneas no
   cargan, vuelve el resaltado anterior (emissive 0,6 + borde fino).
3. Se abre el panel directo (`abrir(u, true)`), en desktop y en táctil, y registra el
   evento; si la tarjeta de la demo estaba a la vista, se va. Hover: la ventana chica
   (tooltip) sigue igual, salvo sobre la unidad abierta en el panel.
4. Con el panel abierto, un click en otra unidad cambia el contenido en el lugar, sin
   cerrarlo, y el scroll vuelve a 0; en la misma unidad solo vuelve a encuadrarla. X,
   Escape o un click en el vacío lo cierran y quitan el resaltado; un click dentro del
   panel nunca lo cierra.
5. `?u=<id>` abre el panel directo, con la cámara frente a la unidad.
6. El giro automático no corre con tarjeta o panel abiertos y no pelea con la cámara; un
   arrastre (más de `UMBRAL_ARRASTRE`, 5 px) que termina sobre una unidad no la abre, y un
   pellizco con dos dedos no abre ni cierra nada (desde 2026-10-20).
7. Encuadre: la unidad queda en lo que dejan libre la tarjeta o el panel; funciona en las
   dos torres de BRUSCO (no asume una torre centrada en el origen); en celular entran al
   menos 40 m de ancho (sin primer plano). En mobile, también al asentarse la hoja en
   baja o media, salvo que la cámara se haya movido a mano (`camaraManual`, que
   `enfocar()` limpia; ver "Hoja arrastrable"). Desde 2026-10-23.

## `admin.html`

Login con Supabase Auth (`signInWithPassword` / `getSession`). Después
`elegirProyecto()`: un admin de plataforma (`rpc('es_admin_plataforma')`) ve un selector
con todos los proyectos; un usuario común ve solo sus `memberships` (entra directo si
tiene uno solo). Pestañas:

- **Unidades** — cambiar `estado`, editar m²/terraza/cochera, asignar tipología en lote,
  avisos de lista de espera.
- **Demanda** — clicks por unidad/tipología/piso + leads de lista de espera. Hoy baja
  una fila por evento (`tipo = 'click'`, sin paginar: el tope de filas de la API puede
  truncar los conteos); `demanda_resumen()` (migración `eventos-consulta`) es el
  reemplazo agrupado, todavía sin usar. Las simulaciones se graban pero no se muestran.
- **Amenities** — alta/baja/edición + orden.
- **Tipologías** — alta/baja/edición + imágenes de planta/render por tipología. El
  título de cada tarjeta es el nombre interno; "Nombre para el comprador"
  (`nombre_publico`) aparece recién con la migración `nombre-publico` aplicada.
- **Imágenes** — galería de renders del proyecto (se comprime del lado del cliente a
  ~2000px antes de subir al bucket `renders`; con tope por proyecto).
- **Avance de obra** — toggle `avance_habilitado`, hitos (`obra_hitos`: fechas, peso,
  `categoria`; `'estructura'` + `piso` vincula un hito con los pisos del 3D), fotos con
  fecha (`obra_fotos`, fecha leída del EXIF cuando existe).
- **Redes** — redes sociales / WhatsApp en `settings`.
- **Accesos** — solo admin de plataforma o de proyecto (`es_admin_proyecto()`): lista
  miembros (`rpc accesos_miembros`), agrega por email a un usuario que ya existe en Auth
  (`rpc accesos_agregar`), cambia rol y quita vía update/delete directo sobre
  `memberships`. Nadie modifica su propio acceso (policy `user_id <> auth.uid()`).
  Crear usuarios no está: necesita service_role (futura Edge Function).

Todavía no editable desde el admin (se carga directo en Supabase): `geometria`,
`lat`/`lon`, `tiene_pb`, `settings.financiacion`, `fecha_ocupacion`, `publicado`,
`portada_url` / `portada_foco` / `tipo`.

## Geometría de unidades y placa: el sistema de coordenadas de `geom`

Cada unidad puede tener su propio contorno (`units.geom.contorno`) en vez de la grilla
`col`/`frente` + caja fija de `ANCHO`×`PROF`. La placa puede reemplazar losa y núcleo de
la misma forma (`projects.geometria.losa_contorno` / `.nucleo_contorno`). El contrato
para los datos de cualquier edificio:

- **Formato**: lista de puntos `[x, z]` en **metros**, ≥3 puntos, sin repetir el primer
  punto al final.
- **Origen `(0, 0)`**: centro de la placa; todos los pisos lo comparten, sin offset por
  piso.
- **X / Z**: ejes de three.js vistos **desde arriba con −Z hacia arriba de la
  pantalla: +X queda a la derecha**, como un mapa. Si −Z mira al norte, +X es el este
  (así están los contornos de BRUSCO, `geometria.contorno_ejes = "xz"`). Ojo: parado
  en la calle mirando un frente en −Z, +X queda a la **izquierda**. `col` / `frente`
  usan los mismos ejes (`x = col·SEP_X`, `z = frente·SEP_Z`).
- **Frente**: por default la calle está en −Z. `geometria.frente_eje` (`"-z"`, `"-x"`,
  `"+z"`, `"+x"`) lo cambia: gira la calle, el cartel, los árboles, los autos y la
  cámara inicial (`FRENTE_GIRO`), no el edificio ni el sol. BRUSCO: `"-x"` (Aquiles
  Lanza, al oeste).
- **Y**: no va en `contorno`. Las unidades se extruyen desde la losa hasta `geom.alto`
  (fallback: `ALTO` global).
- **Sentido de giro**: no importa — `formaDesdeContorno()` lo normaliza por área con
  signo.
- **Compatibilidad**: contornos vacíos o ausentes vuelven a la grilla + cajas
  rectangulares. Así están todas las unidades de ROSSO.

El `id` de la unidad es el número de venta: normalmente `piso*100 + pos`, único
**dentro de un proyecto**. No siempre se deduce de `pos` (ver
`supabase-migration-altamira-piso5-numeracion.sql`: en el piso 5 de Altamira se
fusionaron dos posiciones).

### La calle: `geometria.calle`

Objeto opcional con las medidas de la calle, en metros. Hoy solo ROSSO define algo
(`cruce_x`, con `supabase-migration-calle-cruce-rosso.sql`); el resto usa los valores por
defecto. Se arma en coordenadas "de frente" (calle sobre el eje X, en −Z) y después gira
con `frente_eje`.

- **`ancho`** (8) — ancho de la calzada. También el de las calles laterales
  (`geometria.calles`). El cartel con el nombre escala con él.
- **`largo`** (44) — largo del tramo del frente: calzada, guiones, árboles, faroles.
  Las laterales no lo usan (van de esquina a esquina de la manzana). Ojo: autos, bancos,
  cesto, bicicletero y cartel de tránsito tienen `x` fijas (entre −17 y 10), así que con
  `largo` menor que ~36 quedan fuera de la calle.
- **`vereda`** (2) — ancho de la vereda, en el frente y en las laterales. Los árboles van
  a 0,4 m del cordón; el mobiliario, a 0,65 del ancho de la vereda desde el cordón.
- **`vereda_alto`** (0,12) — altura del cordón (la vereda es un escalón real). Árboles y
  mobiliario se apoyan a esa altura y la sombra de contacto del edificio va 1,5 cm arriba.

- **`extension`** (400) — hasta dónde llegan las calles desde el edificio. **`0` la apaga**
  y vuelve la vista de antes, igual píxel a píxel: disco que se desvanece, fondo fijo a la
  pantalla y niebla.
- **`cuadra`** (90) — distancia entre ejes de calles de la grilla (cuadra montevideana).
- **`manzanas`** (`true`) — `false` saca las manzanas vecinas (bloques bajos); el resto del
  entorno extendido queda igual.
- **`cruce_x`** — eje de una calle transversal, en metros sobre el frente desde el centro
  del edificio. Parado en la calle mirando la fachada, negativo = a la derecha (−X). Las
  demás transversales salen cada `cuadra`. Sin el dato, el edificio queda a mitad de cuadra
  (ejes en ±`cuadra`/2). En esquina: −(media losa + `vereda` + `ancho`/2) del lado de la
  esquina; ROSSO = −17,65 (Paullier, del lado de las unidades "Esquina Paullier", `col`
  −1,5). Con `geometria.calles` (BRUSCO) no se usa: las transversales y la calle de atrás
  salen de las calles reales.

La línea del mobiliario se mide desde la vereda, no desde la calzada. Hasta 2026-10-14
era `Z_CALLE + 5,3`: con un `ancho` de 12 m caía sobre el asfalto. Sin contornos (ROSSO) el disco de base
queda fijo en 30 m de radio; con contornos crece para que entren la calle y las esquinas.
`RADIO_DISCO` sigue mandando aunque haya extensión: de él salen la cámara de sombra, el
filtro de árboles y dónde empieza el fundido.

#### Entorno extendido (`extension` > 0)

- **Grilla** (`EJES_X` / `EJES_Z`, en coordenadas de `grupoCalle`): paralelas al frente
  (la del frente y, si existe, la de atrás) y transversales, cada `cuadra` hacia afuera de
  las calles reales, hasta `extension`. Cada pieza es una sola malla por material
  (`geometriaPiezas()`: rectángulos horizontales y caras verticales):
  - **Calzada** con textura (`mapaAsfalto()`, las imágenes de `assets/textures/`:
    grano, manchas suaves y árido, de lejos el `#686F72` de siempre; mipmaps y
    anisotropía máxima; sin la imagen, ese gris liso). La
    **línea central** va en la textura, no como geometría: miles de guiones finos
    titilaban al girar. Se corta 5 m antes de cada esquina (`TOPE`: esos tramos y los
    cruces usan la variante lisa).
  - **Veredas**: un anillo de `vereda` por manzana a `vereda_alto`, con el cordón (cara
    hacia la calle, `#F2F3F4`) y el borde interior. La de la manzana del edificio cae
    donde iban las veredas sueltas de antes.
  - **Cebras** en las cuatro esquinas de la manzana del edificio (la que contiene el
    origen), una por brazo: franja de 3 m (`CEBRA_ANCHO`) a 0,3 m del borde de la calzada
    que cruza, barras de 0,5 m cada 1 m.

  Las veredas, guiones y borde sueltos de cerca del edificio (frente y laterales de
  BRUSCO) solo se arman con `extension` 0. Carteles, árboles, autos y mobiliario siguen
  como antes, salvo lo que cae en una transversal o su cebra (`enCruce()`, hoy solo ROSSO
  por Paullier): faroles, bancos y el bicicletero de ese tramo no se ponen, el auto pasa
  al primer lugar libre y el cartel se corre a la cuadra del edificio. Los carteles
  también esquivan la cebra de su esquina (en BRUSCO el del frente y el de cada lateral se
  corrieron unos metros hacia el medio de la cuadra).
- **Contexto** (al final del entorno, antes de CÁMARA): árboles (cada ~11 m), faroles
  (cada ~32 m) y autos estacionados contra el cordón en toda la grilla, con InstancedMesh
  (`instanciar()`: un InstancedMesh por parte, `frustumCulled = false` porque r128
  recorta con la esfera de la geometría base). Geometría más simple que la de cerca:
  árbol de dos lóbulos y auto de tres cajas en los dos tonos de siempre (un `.glb` tiene
  ~3000 triángulos). La densidad baja con la distancia (`densidadContexto`, la mitad en
  pantallas chicas) y no hay nada más allá de `HASTA_CONTEXTO` (fundido > 93 %). No
  repite lo que ya existe cerca (`yaEsta()`: el tramo de 44 m del frente y, en BRUSCO,
  las veredas de su manzana) y no hay autos de contexto a menos de `RADIO_DISCO` + 6 m.
  Dentro de ~1,5 × `RADIO_DISCO` proyectan sombra (solo `CIELO_ALTA`, como lo de
  siempre); más allá no. Semilla propia: los árboles de siempre no cambian.
- **Manzanas vecinas** (`manzanas`): cada manzana menos la del edificio, retirada 3 m de
  la vereda y partida en cuatro lotes. Las ocho de al lado miden 4–5 m (a ≥ 15 m del
  edificio no le tapan la fachada ni en la vista inicial, 24°, ni al enfocar una
  unidad, 14°, salvo el primer metro de la PB); las demás 6–14 m. Gris claro
  (`#CDD0CD`) con fundido y **sin sombra propia**: el simulador solar no considera
  vecinos, y una sombra suya sobre la fachada contradiría el "recibe sol". A ras del
  piso con el radio grande sí tapan los pisos bajos, como en la calle.
- **Orden de dibujo**: el piso va con `renderOrder` 1 (después de calles, veredas y
  losas: lo tapado ni se sombrea) y el cielo con 2 y profundidad máxima (`z = w`: solo
  pinta lo vacío). Con eso se recupera ~¼ del costo por cuadro que sumó el piso.
- **Fundido** (`conFundido(material)`): mezcla el color final de piso, calzada, veredas y
  pintura con `COLOR_HORIZONTE` según la distancia horizontal al eje de giro, con una
  curva ease-out cúbica entre `RADIO_DISCO` y 0,8 × `extension`. **Nunca va en materiales
  del edificio**: no hay `scene.fog` (teñía el edificio, en celular entre ~20 y ~55 % en
  la vista inicial). Un material nuevo del entorno (árboles, autos, manzanas) tiene que
  pasar por `conFundido()`; con instancing también funciona.
- **Sombra**: en esos mismos materiales la del sol se desvanece entre 0,65 y 0,9 del radio
  de su cámara (`radioSombraSol`, que no cambió) y más allá ni se lee el mapa. Sin esto la
  punta de una sombra larga (sol bajo) se cortaba en una línea recta.
- **Cielo** (`cielo`): domo que sigue a la cámara (`ubicarCamara()`), con degradé por
  altura sobre el horizonte, dibujado último entre lo opaco. Debajo del horizonte es `COLOR_HORIZONTE` parejo, el mismo al
  que se funde el piso: el borde del piso no se ve desde ningún ángulo. `far` pasa de
  600 a 1100.
- **Cámara**: `phi` se limita según el radio para que la cámara quede siempre ≥ 2 m sobre el
  piso (`ALTURA_MIN_CAMARA`; antes, a radio 190 y `phi` máximo, ROSSO quedaba a −14 m).
  Vale también con `extension` 0.

## Simulador solar: `projects.lat`/`lon`, `paises.tz_offset_horas`, `geometria.norte_grados`

`index.html` calcula la posición real del sol dentro del archivo (`posicionSolar` /
`horarioSolar`: declinación + ecuación del tiempo + ángulo horario, sin librería) y
proyecta las sombras. El control **se oculta salvo que estén los tres datos**
(`tieneNorte()`) — un sol equivocado es peor que ningún sol:

- **`projects.lat` / `lon`** — grados decimales con signo (Montevideo `-34.88, -56.16`;
  Managua `12.13, -86.25`).
- **`paises.tz_offset_horas`** — horas enteras respecto de UTC, sin horario de verano
  (UY `-3`, NI `-6`). El reloj del sol siempre usa esto, nunca el huso horario del
  navegador del visitante.
- **`geometria.norte_grados`** — rumbo de brújula (0–360, en sentido horario desde el
  norte verdadero) hacia el que mira el **frente** (lado de la calle, **-Z** del modelo).
  **No** el contrafrente — cargar el rumbo del contrafrente es un giro silencioso de 180°
  (ya pasó una vez: una fachada que debía tener sol de mañana se iluminaba al atardecer).
  Altamira: `45`. Medirlo en Google Maps a lo largo de la calle a la que da el edificio;
  no confiar en rosas de los vientos de planos en PDF. Chequeo: el frente tiene que
  seguir iluminado hasta el mediodía solar siempre que `|azimut - norte_grados| < 90°`.

Funciona en cualquier hemisferio siempre que `lat` tenga el signo correcto. Hoy los
tres proyectos (ROSSO, Altamira, BRUSCO) tienen los tres datos cargados.

`norte_grados` es el rumbo del eje **−Z del modelo**, que coincide con el frente salvo
que haya `frente_eje`. `direccionSolModelo()` pone un rumbo relativo `r` en
`(sin r, −cos r)`. Hasta 2026-09-29 devolvía `(−sin r, −cos r)`: frente y contrafrente
bien, laterales invertidos (el sol de la mañana entraba por el oeste). El chequeo del
frente de arriba no lo detecta. Para verificar los laterales: a media mañana, la
sombra tiene que caer hacia el oeste.

### Fachadas y asoleamiento por unidad (`geometria.calles`)

Solo con `geometria.calles` (`{norte, sur, este, oeste}` → nombre de calle), contornos
y los tres datos del sol (hoy solo BRUSCO). `calcularFachadas()`: un lado de una unidad
da a una calle solo si su normal apunta a ese borde de la manzana (±45°) y está a
≤ 3,5 m de él (la manzana = caja envolvente de todos los contornos). Se suman metros
por calle: la principal es la de más metros, y una segunda calle cuenta desde 2 m.
Sin ningún lado a una calle → "Interior de manzana", sin inventar orientación (no hay
núcleos ni pasillos modelados que permitan distinguir el patio del pasillo).
`franjasSolFachada()` da las horas de sol directo del día elegido en el simulador,
según la orientación geométrica, sin sombras de vecinos, y descarta franjas de menos
de 30 min. Precedencia: `units.orientacion` (texto libre, ROSSO/Altamira) >
`units.geom.fachadas` (override manual, p.ej. `["norte"]`; `[]` = interior) > cálculo.
Tabla de control para revisar a mano: `node scripts/fachadas-control.mjs <slug>` →
`datos/<slug>-fachadas.csv` (usa las funciones del visor tal cual).

## Selector de pisos: `projects.tiene_pb`

El riel de pisos se arma desde `proyecto.pisos`. Los niveles sin unidades se muestran
como una fila deshabilitada "Sin unidades" (p.ej. el piso de amenities de Altamira) en
vez de desaparecer. La fila "PB" aparece si `tiene_pb` es `true` o `NULL`; `false` la
oculta.

## Vista previa al compartir (Open Graph)

Cuando se comparte un link del visor por WhatsApp, Facebook, LinkedIn, etc., el crawler
recibe un HTML con las etiquetas OG de la unidad (`?u=`) o del proyecto. Los visitantes
no pasan por ningún código nuevo: reciben el `index.html` estático de siempre.

- **Ruteo** (`vercel.json`): la ruta de la vista previa es `^/(index\.html)?$` con `has` sobre el
  `user-agent` (WhatsApp/, facebookexternalhit, Facebot, Twitterbot, LinkedInBot,
  TelegramBot, Slackbot, Discordbot, SkypeUriPreview, Pinterestbot, redditbot, Embedly,
  Cardyb, vkShare, Iframely) → `api/compartir`. Solo tokens que no aparecen en el UA de
  un navegador ni de un navegador interno de una app (por eso `Pinterestbot` y no
  `Pinterest`): un visitante confundido con un bot no vería el visor. **vercel.json usa
  routes (formato legacy). No agregar rewrites/redirects/headers/cleanUrls; si hacen
  falta, migrar a routes o pasar a Middleware.** `rewrites` no sirve para esto: el
  filesystem le gana (`/` sirve `index.html` aunque el header coincida; probado en
  preview el 2026-10-13). Un Middleware también anda, pero suma ~100 ms y una invocación
  a cada visita.
- **`api/compartir.js`**: Node sin dependencias. Lee `public_projects` + `public_units`
  por la REST de Supabase (`_tarjeta.js`, timeout de 4 s) y nunca devuelve 500: unidad
  inexistente → tarjeta del proyecto; slug inexistente o falla de red → tarjeta neutra
  ("Cota · Visor 3D de disponibilidad", imagen `/api/og?marca=1`). Pone sus propios
  headers: `Cache-Control: s-maxage=60, stale-while-revalidate=60` (ante una falla,
  `s-maxage=60, stale-while-revalidate`). Es corta y con stale acotado a propósito: con
  `s-maxage=600` + `stale-while-revalidate` sin límite, la CDN devolvía la tarjeta de
  antes de un cambio de estado hasta 10 min, y una vez más al vencer. La imagen
  (`api/og.mjs`) sí va con `s-maxage=600`, porque su URL lleva `v=`. Al cliente le llega
  `public, max-age=0, must-revalidate` porque la CDN de Vercel consume el `s-maxage`.
  Facebook y WhatsApp tienen además su propia caché por URL: para ver un cambio en el
  Facebook Debugger hay que usar "Volver a extraer".
- **Tarjeta de unidad**: `og:title` = "Unidad `numeroDe(u)` · `proyecto.nombre`";
  `og:description` = tipología · m² · orientación · precio · estado, cada dato omitido si
  falta. Mismas reglas que el visor: tipología de `tipologiaDe()` (con
  `proyecto.nombresTipologia`, que arma `cargar()` desde `public_typologies`) o
  dormitorios;
  orientación = `units.orientacion` tal cual, o "Orientación norte y este" /
  "Interior de manzana" solo si sale de `calcularFachadas()` (BRUSCO); precio de
  `formatearPrecio()` ("US$ 210.000"), con "(estimado)" si `units.estimado`, alquiler
  "UYU 55.000 / mes", sin precio en las vendidas; estado con los nombres de `ESTADOS`
  ("En venta" si el proyecto tiene alquiler), y `sin_dato` no se nombra.
- **Tarjeta del proyecto** (sin `?u=` o id inexistente): dirección, ciudad · Entrega ·
  contador (disponibles, o "en venta" + "en alquiler"). El contador sale solo con
  `muestra_totales` y si `CONTADOR_EN_TARJETA` (en `_tarjeta.js`, por slug, default
  `true`) no lo apaga.
- `og:url` y el link visible del HTML van siempre con `?p=` (también ROSSO), sin `src`
  ni `kiosco`, como `linkDe()`. `og:url` y `og:image` llevan el `v=` **vigente**
  (`versionCompartir()` de la unidad, o de todo el proyecto en la tarjeta sin `?u=`),
  aunque el link pedido traiga uno viejo o ninguno. WhatsApp guarda la vista previa por
  URL y Facebook por `og:url`: cuando cambia el estado, el precio o `estimado`, el link
  copiado de nuevo trae otro `v` y una vista previa nueva. `api/og.mjs` ignora `v` (solo
  separa la caché).
- **`api/og.mjs`** (`?p=&u=` / `?p=` / `?marca=1`): con `@vercel/og` en Node, sin JSX.
  - **Zona segura**: la miniatura de WhatsApp recorta el cuadrado central (630×630). Ahí
    va solo el edificio, completo y centrado; el texto va en las dos bandas laterales de
    285 px, centrado en vertical: la esquina superior izquierda la tapan los botones de
    Facebook. `node scripts/muestras-og.mjs` deja cada muestra completa y su recorte
    (`-cuadrado.png`).
  - Unidad: elevación del lado que le queda más cerca (`ladoDe()`: frente o
    contrafrente). La unidad va en el color de su estado con borde oscuro y halo; el resto
    en gris, más claro que vendido / sin_dato para que una resaltada gris también
    destaque, con bordes y losas marcados. A la izquierda: proyecto, rótulo "Vista frente"
    / "Vista contrafrente", número y torre/piso. A la derecha: estado, tipología, m² y
    precio (con "(estimado)"). Proyecto: la fachada del frente con cada unidad en el
    color de su estado (opacidad del 3D, mezclada a opaco); a la izquierda el nombre
    partido en "by" y el rótulo; a la derecha dirección, entrega y contador. Pie "armado
    por Cota" en gris.
  - La elevación (`elevacion()` en `_og-dibujo.mjs`) proyecta cada contorno (o la caja
    `col`/`frente` de ROSSO, con `dimensionesDe()`) sobre el plano de la fachada según
    `frente_eje` (frente en −Z: +X a la izquierda; BRUSCO: B a la izquierda, A a la
    derecha; el contrafrente sale espejado). Por piso dibuja solo el tramo visible de cada
    unidad; los restos de menos de 1,6 m van en gris neutro. PB y niveles sin unidades van
    como volumen neutro.
  - Slug inexistente → marca; cualquier falla → marca con `s-maxage=60`. La marca es
    `api/_marca-cota.png`, un PNG fijo: servirla no puede fallar. Solo `node:fs` se
    importa arriba; `@vercel/og`, fuentes y datos se cargan dentro del `try`.
  - **`@vercel/og` fijo en 0.11.1**: la 1.0.3 revienta al importarse en ESM (harfbuzzjs
    empaquetado usa `require`/`__dirname`). Antes de subir de versión, correr
    `node scripts/muestras-og.mjs`.
  - `.npmrc` con `omit=optional`: sin él se instala `sharp` (dependencia opcional) y
    `@vercel/og` lo usa en lugar de `resvg.wasm`: función mucho más pesada y muestras
    locales distintas de producción.
  - Tamaño: lo nuestro (código + Inter 400/600/700 + marca) ~230 KB; la librería suma
    ~2,4 MB (casi todo `resvg.wasm`).
- **`api/_compartido.js`** se genera desde el visor (`DEFAULT_SLUG`, `ESTADOS`,
  `fmtAlquiler`, `aspectoDe`, `normalizarUnidad`, `versionCompartir`, `numeroDe`,
  `nombresPublicosDe`, `tipologiaDe`, `torreDe`,
  `etiquetaDorms`, `formatoMoneda`, `formatearPrecio`, `formatearM2`, `unirConY`,
  `areaConSigno`, `calcularFachadas` + sus constantes, las medidas por defecto de la
  torre como `dimensionesDe(geo)` y los colores de `:root` como `COLORES`) y
  `supabase-config.js` (URL y anon key). Las funciones de la lista tienen que seguir
  siendo puras y con ese nombre; si cambia alguna, el pre-commit lo avisa.
- Probar: `curl -A "WhatsApp/2.23" "<url>/?p=brusco&u=303"` devuelve el HTML de la
  tarjeta; sin `-A` tiene que devolver el visor. `node scripts/muestras-og.mjs` deja PNG
  de muestra de los casos típicos en `muestras-og/` (ignorada por git) y regenera
  `api/_marca-cota.png`.

## Optimización del arranque (perf/fase11)

Desde 2026-10-21, cambios de a uno en la rama `perf/fase11`, cada uno con diff, tabla
de medición (mediana de 3 en frío, ROSSO, BRUSCO y Altamira, con una copia
instrumentada del visor) y capturas comparativas, y un hard stop hasta el OK de
Sebastian. Las mediciones van con SwiftShader (render por CPU), nunca con la GPU real
de la notebook: el 2026-10-21 una tanda larga con la GPU real la colgó.

- **Cambio 1** — asfalto horneado a WebP (`assets/textures/`, ver "Archivos"). En
  producción desde `9d26d58`.
- **Cambio 2** — compilación de shaders sin bloquear el hilo principal. El pedido
  original, tal cual:

  > Cambio 2 — Compilación de shaders sin bloquear el hilo principal (three.js r128,
  > sin cambiar de versión).
  > Desde perf/fase11 (9d26d58). Reglas: SwiftShader, sin GPU real, sin cambios
  > visuales (materiales, sombras, resolución y configuración del renderer quedan
  > iguales).
  >
  > 1. render.debug.checkShaderErrors = false solo en producción; mantenerlo en true en
  >    localhost o con ?debug=1.
  > 2. Con la escena armada (edificio, unidades, calles; sin autos), llamar a
  >    render.compile(escena, camara) mientras el poster sigue visible.
  > 3. Si existe KHR_parallel_shader_compile, consultar en cada rAF COMPLETION_STATUS_KHR
  >    de los programas (render.info.programs) y dibujar el primer cuadro recién cuando
  >    todos terminaron. Tope: 3 s; si se supera, dibujar igual y registrar un
  >    console.warn.
  > 4. Sin la extensión: comportamiento actual.
  > 5. Autos: al terminar de cargarlos, repetir compile + espera antes de agregarlos a
  >    la escena.
  > 6. Shaders de la pasada de sombra: medir cuánto tardan en el primer cuadro y
  >    reportarlo, sin cambiarlos todavía.
  > 7. Medición, mediana de 3 en frío, en ROSSO, BRUSCO y Altamira: duración del primer
  >    cuadro, tarea más larga del hilo principal y tiempo total de iniciar() → primer
  >    cuadro, antes y después.
  > 8. Capturas comparativas como en el cambio 1.
  >
  > Diff + tabla + capturas. Dejá este prompt guardado en CLAUDE.md como "Cambio 2".
  > HARD STOP.

  Acordado con Sebastian antes de implementarlo (2026-10-21): en r128 `compile()`
  bloquea programa por programa (`getUniforms()` espera cada enlace) y SwiftShader no
  tiene `KHR_parallel_shader_compile`, así que los puntos 2–4 se reemplazaron por la
  **compilación por partes** (ver "Compilación de shaders por partes"). Se mantuvieron:
  `checkShaderErrors` apagado solo en producción, el tope de 3 s con `console.warn`, el
  mismo tratamiento para los autos al cargarlos, la medición y las capturas, más la
  duración de la tarea más larga por grupo (objetivo: < 50 ms; en SwiftShader un solo
  programa ya tarda más que eso, así que el objetivo se verifica en GPU real). La
  sombra (punto 6) quedó medida: son 2 programas (`MeshDepthMaterial` con y sin
  instancing; el color por instancia no la cambia), ~10–20 % del costo de compilar,
  que ahora tienen su propio grupo.

## Pendientes (fuera de alcance por ahora)

- En producción `public_projects` no tiene `tiene_pb`: la migración `pisos` parece no
  estar aplicada (el visor no falla porque pide `select('*')`, pero la fila PB nunca se
  puede ocultar). La migración `portada` también la agrega.
- El contador de la tarjeta del proyecto se configura con `CONTADOR_EN_TARJETA` en
  `api/_tarjeta.js` (por slug). Pasarlo a una columna de `settings` / `public_settings`
  necesita migración.
- **Bug (preexistente, a confirmar en celular real):** en BRUSCO a 390 px, un toque en
  el centro de una unidad abre la vecina, casi siempre la del piso de abajo. Visto el
  2026-10-21 con toques emulados por CDP (5 de 8 toques), igual antes y después del
  cambio 2 de "Optimización del arranque"; en ROSSO a 390 px y en desktop el clic abre
  la unidad tocada. Puede ser de la emulación: primero probarlo en un celular.
- **Hoja arrastrable: falta probarla en celular real** (iPhone y Android). Validada
  el 2026-10-23 con toques emulados por CDP en SwiftShader (320–768 px, horizontal,
  zoom 130 %, ROSSO y BRUSCO). Lo que la emulación no cubre: que iOS respete el
  `preventDefault` del primer `touchmove`, el pull-to-refresh de Chrome Android y la
  sensación del gesto rápido con cuadros reales.
- **Próximo candidato de optimización:** la parte sincrónica de `iniciar()` (DOM,
  escena, calles, torre, interfaz hasta el calentamiento), ~0,4 s en SwiftShader. Desde
  el cambio 2 es la tarea más larga de la carga.

## Dar de alta un edificio nuevo

Un edificio estándar no necesita cambios de código — es todo datos. Seguir `README.md`
(país/moneda → org → proyecto con `publicado = false` → settings → unidades con un
INSERT generado por script → amenities → usuario de Auth + membership → publicar). Datos
opcionales por edificio: `geometria` (dimensiones, contornos, calle, norte_grados),
lat/lon, tiene_pb, portada (`portada_url` / `portada_foco`) y `tipo`, financiacion,
tipologías + imágenes, avance de obra. Y un archivo, no un dato: el poster de carga
(`images/poster-<slug>*.avif|webp`, paso 10 del README).

Lo que sigue hardcodeado y puede necesitar cambios: `DEFAULT_SLUG`, `BASE` y
`HOSTS_PRODUCCION` (en `app.<hash>.js`; `DEFAULT_SLUG` también en el script del poster del
`<head>`; `BASE` y `HOSTS_PRODUCCION` cambian juntos si cambia el dominio), la marca/colores (variables CSS en `:root`, compartidas por todos los proyectos), y el copy de aviso de demo
(`#aviso`, y `#p-info-nota` en el popover ⓘ del panel).
