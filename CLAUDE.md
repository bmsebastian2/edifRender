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
backend. No hay bundler, package.json, tests ni linter. Se despliega en Vercel en
`https://armadoporcota.vercel.app/`, sirviendo la raíz del repo tal cual.

Empezó como un solo edificio (ROSSO) y ahora es una **plataforma multi-tenant**: un
mismo proyecto de Supabase aloja varios edificios (`projects`) de varios clientes
(`orgs`). El frontend decide qué edificio mostrar por slug.

Archivos:

- `index.html` (~5.3k líneas) — el visor público. HTML + CSS + JS en un solo archivo.
- `admin.html` (~1.8k líneas) — panel interno para clientes/vendedores, detrás de
  Supabase Auth.
- `supabase-config.js` — `SUPABASE_URL` + anon key, crea el cliente global `sb`. La anon
  key es pública a propósito; la seguridad real es RLS. Nunca poner acá la service_role
  key.
- `supabase-schema.sql` — el schema original single-tenant + el seed de ROSSO.
- `supabase-migration-*.sql` — cada cambio posterior, corridos a mano en orden (ver más
  abajo).
- `modelos/autos/*.glb` — modelos low-poly de autos (CC0, comprimidos con meshopt vía
  `gltf-transform optimize`) usados como utilería en la calle.
- `README.md` — runbook: alta de edificio paso a paso, acceso de plataforma, revocar
  accesos.

## Correr / probar

No hay dev server ni build. Abrir `index.html` directo o servir la carpeta
(`npx serve .`). Elegir edificio con `?p=<slug>` (por defecto `rosso`). Deploy = push a
`main` (Vercel).

## Modelo de datos en Supabase (multi-tenant)

Definido por `supabase-migration-multitenant.sql` más las migraciones de funcionalidades
posteriores:

- `paises` (incluye `tz_offset_horas`), `monedas` — tablas de referencia; agregar un país
  o moneda es un insert, no una migración.
- `orgs` → `projects` (slug, nombre, direccion, ciudad, pais, entrega, pisos, publicado,
  muestra_totales, moneda, locale, `geometria` jsonb, lat/lon, fecha_ocupacion,
  avance_habilitado, tiene_pb).
- Por proyecto (`project_id`): `units`, `typologies`, `media`, `amenities`, `settings`
  (instagram/youtube/sitio_web/whatsapp, `textos` jsonb, `financiacion` jsonb), `leads`,
  `events`, `obra_hitos`, `obra_fotos`.
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

### Orden de las migraciones

Cada archivo es idempotente o tiene guardas. Orden histórico: `schema` → `auth` →
`estados` → `settings` → `cochera-terraza` → `precios-ingar` → `multitenant` (tiene su
`-rollback`) → `media-storage` → `typology-media` → `altamira-piso5-numeracion` → `solar`
→ `financiacion` → **`avance-obra` (tiene que correr después de `financiacion`)** →
`lista-espera` → `pisos` → `precio-opcional`. Migraciones nuevas: archivo nuevo
`supabase-migration-<tema>.sql`, comentario de cabecera en español explicando el porqué,
idempotente (`if not exists`, `drop policy if exists`, `on conflict`), puramente aditiva
cuando se pueda (un proyecto sin el dato nuevo tiene que verse exactamente igual que
antes), y actualizar `supabase-schema.sql` solo si es para instalaciones nuevas.

## Arquitectura de `index.html`

Secuencia de carga: un overlay `#carga` está visible desde el primer paint →
`resolverSlug()` (path, después `?p=`, después `DEFAULT_SLUG = 'rosso'`) →
`cargarProyecto()` trae el proyecto de `public_projects` y después, en paralelo,
unidades, settings, amenities, renders del proyecto, media de tipologías, el huso
horario del país, e hitos/fotos de obra. Cada consulta tiene un timeout de 15s vía
`abortSignal`. Error de red → el overlay muestra "Reintentar"; slug inexistente o no
publicado → mensaje amable sin reintentar. Si sale bien, `iniciar(proyecto, settings,
UNIDADES, mediaTipologias, tzOffsetHoras, hitosObra)` arma todo.

El script está organizado en secciones numeradas:

1. **DATOS** — mapa `ESTADOS` (`disponible` / `reservado` / `vendido` / `sin_dato`, con
   sus colores), resolución del slug, `cargarProyecto()`, formateo (`formatearPrecio`
   usa `moneda`/`locale` del proyecto), matemática solar, tracking de eventos/leads
   (`obtenerSesion()` = uuid en localStorage, `obtenerOrigen()` = atribución por `?src=`),
   y los que pintan cosas fuera de la escena 3D (redes, amenities, texto legal, lightbox
   de renders, sección de avance de obra).
2. **ESCENA** — renderer, luces, cielo, entorno. Las dimensiones salen de
   `proyecto.geometria` con los valores de ROSSO como fallback (`ancho` 5.4, `prof` 6.4,
   `alto` 3, `losa_espesor`, `sep_x`/`sep_z`, `losa_*`, `nucleo_*`). Entorno: calle
   (`geometria.calle`), cartel con el nombre de la calle anclado al mundo
   (`geometria.calle_nombre` o extraído de `direccion`), árboles con random por semilla
   (estables entre recargas), autos GLB cargados una vez y reutilizados con `.clone()`,
   faroles, bancos.
3. **TORRE** — `for (let piso = 1; piso <= PISOS; piso++)` con `PISOS = proyecto.pisos`:
   losa, núcleo, y un mesh por unidad, coloreado con `ESTADOS[u.estado].color`, con
   `userData.unidad` apuntando al objeto de la unidad (así el raycasting mapea un mesh a
   su unidad). Los meshes de unidades viven en `cajas`.
4. **CÁMARA** — cámara orbital (`theta`/`phi`/`radio`), vista inicial desde el frente
   del edificio, radio escalado según la altura del edificio y el aspecto de la
   pantalla; rotación automática lenta hasta el primer toque. Los controles del
   simulador solar también viven acá.
5. **INTERACCIÓN** — hover (tooltip + emissive) y click (`abrir(u)`). Los filtros (chips
   de dormitorios armados desde los datos, chips de estado, aislar piso, "separar pisos")
   pasan todos por `pasa(u)` / `aplicar()`, que atenúan/desactivan los meshes que no
   coinciden en vez de sacarlos. El riel de pisos (`#pisos`) y los filtros (`#filtros`)
   son hojas inferiores en mobile.
6. **BUCLE** — loop de render.

### Panel de detalle de la unidad (`abrir(u)`)

- **Planta / renders**: imágenes reales subidas por tipología (`media` con
  `scope='typology'`, vía `mediaDeUnidad(u)` / `pintarPlantaUnidad(u)`). El viejo esquema
  procedural `plantaSVG()` / `ambientes()` ya no existe.
- Precio, m², terraza (`m2_terraza`), precio de cochera opcional (`cochera_precio`),
  unidades similares (`mostrarSimilares`), tira de pisos.
- Link de **WhatsApp** armado con `settings.whatsapp` + mensaje con plantilla +
  `linkDe(u)`.
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
- Cada `abrir(u)` registra un click en `events` (`registrarEvento`), que alimenta la
  pestaña Demanda del admin.

## `admin.html`

Login con Supabase Auth (`signInWithPassword` / `getSession`). Después
`elegirProyecto()`: un admin de plataforma (`rpc('es_admin_plataforma')`) ve un selector
con todos los proyectos; un usuario común ve solo sus `memberships` (entra directo si
tiene uno solo). Pestañas:

- **Unidades** — cambiar `estado`, editar m²/terraza/cochera, asignar tipología en lote,
  avisos de lista de espera.
- **Demanda** — clicks por unidad/tipología/piso + leads de lista de espera.
- **Amenities** — alta/baja/edición + orden.
- **Tipologías** — alta/baja/edición + imágenes de planta/render por tipología.
- **Imágenes** — galería de renders del proyecto (se comprime del lado del cliente a
  ~2000px antes de subir al bucket `renders`; con tope por proyecto).
- **Avance de obra** — toggle `avance_habilitado`, hitos (`obra_hitos`: fechas, peso,
  `categoria`; `'estructura'` + `piso` vincula un hito con los pisos del 3D), fotos con
  fecha (`obra_fotos`, fecha leída del EXIF cuando existe).
- **Redes** — redes sociales / WhatsApp en `settings`.

Todavía no editable desde el admin (se carga directo en Supabase): `geometria`,
`lat`/`lon`, `tiene_pb`, `settings.financiacion`, `fecha_ocupacion`, `publicado`.

## Geometría de unidades y placa: el sistema de coordenadas de `geom`

Cada unidad puede tener su propio contorno (`units.geom.contorno`) en vez de la grilla
`col`/`frente` + caja fija de `ANCHO`×`PROF`. La placa puede reemplazar losa y núcleo de
la misma forma (`projects.geometria.losa_contorno` / `.nucleo_contorno`). El contrato
para los datos de cualquier edificio:

- **Formato**: lista de puntos `[x, z]` en **metros**, ≥3 puntos, sin repetir el primer
  punto al final.
- **Origen `(0, 0)`**: centro de la placa; todos los pisos lo comparten, sin offset por
  piso.
- **X**: positivo hacia la derecha mirando el frente desde la calle (igual que `col`).
- **Z**: negativo hacia la calle (frente), positivo hacia el contrafrente (igual que
  `frente`).
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

Funciona en cualquier hemisferio siempre que `lat` tenga el signo correcto. ROSSO no
tiene ninguno de los tres cargado.

## Selector de pisos: `projects.tiene_pb`

El riel de pisos se arma desde `proyecto.pisos`. Los niveles sin unidades se muestran
como una fila deshabilitada "Sin unidades" (p.ej. el piso de amenities de Altamira) en
vez de desaparecer. La fila "PB" aparece si `tiene_pb` es `true` o `NULL`; `false` la
oculta.

## Dar de alta un edificio nuevo

Un edificio estándar no necesita cambios de código — es todo datos. Seguir `README.md`
(país/moneda → org → proyecto con `publicado = false` → settings → unidades con un
INSERT generado por script → amenities → usuario de Auth + membership → publicar). Datos
opcionales por edificio: `geometria` (dimensiones, contornos, calle, norte_grados),
lat/lon, tiene_pb, financiacion, tipologías + imágenes, avance de obra.

Lo que sigue hardcodeado en `index.html` y puede necesitar cambios: `DEFAULT_SLUG`,
`BASE`, la marca/colores de Cota (variables CSS en `:root`), y el copy de aviso de demo
(`#aviso`, la última `.nota` del panel).
