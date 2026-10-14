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
"Correr / probar"); el `package.json` existe solo para la dependencia de `api/og.mjs`
y no hay build. Se despliega en Vercel en `https://armadoporcota.vercel.app/`,
sirviendo la raíz del repo tal cual (menos lo que excluye `.vercelignore`), más dos
funciones para la vista previa al compartir (ver "Vista previa al compartir").

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
- `vercel.json` — sin build ni framework (`framework: null`, `buildCommand: ""`,
  `outputDirectory: "."`) + la ruta de los crawlers a `api/compartir`.
- `.vercelignore` — no se publican `CLAUDE.md`, `*.sql`, `scripts/`, `datos/`,
  `.githooks/` ni `node_modules/`.
- `api/compartir.js` — HTML con las etiquetas Open Graph para los crawlers.
  `api/og.mjs` — la imagen de esa tarjeta (PNG 1200×630). Los archivos con prefijo `_`
  no son funciones: `api/_tarjeta.js` (qué datos muestra cada tarjeta, escrito a mano),
  `api/_og-dibujo.mjs` (la elevación y la composición), `api/_fuentes/` (Inter
  subseteada), `api/_marca-cota.png` (imagen de marca, generada por
  `scripts/muestras-og.mjs`) y `api/_compartido.js` — **generado** por
  `scripts/generar-compartido.mjs`, no se edita a mano.
- `package.json` + `package-lock.json` + `.npmrc` — solo `@vercel/og`, versión exacta;
  `.npmrc` (`omit=optional`) deja afuera `sharp` (ver "Vista previa al compartir").

## Correr / probar

No hay dev server ni build. Abrir `index.html` directo o servir la carpeta
(`npx serve .`). Elegir edificio con `?p=<slug>` (por defecto `rosso`). Deploy = push a
`main` (Vercel). Un push a otra rama arma un preview, que tiene Deployment Protection:
para probarlo con curl hace falta el header `x-vercel-protection-bypass` (Settings →
Deployment Protection → Protection Bypass for Automation).

Rollback: Vercel → Deployments → el deploy de producción anterior → ⋯ → **Promote to
Production** (vuelve en segundos, sin rebuild). Ojo: después de un Promote manual Vercel
**deja de promover solo** los pushes siguientes a `main`. Después de arreglar o revertir
en git (`git revert` + push), hay que volver a promover a mano el deploy bueno; recién
ahí los pushes vuelven a ir a producción solos.

El hook `.githooks/pre-commit` corre dos controles sobre las versiones en stage. Se
activa una vez por clon con `git config core.hooksPath .githooks` (ya activo en la
máquina de Sebastian).

- `node scripts/control-seleccion.mjs` revisa que `index.html` siga teniendo armado el
  flujo de selección de unidad (ver "Selección de unidad: comportamiento protegido"). Corre
  en cada commit que toque `index.html`. Controla el código, no cómo se ve: igual hay que
  probar en el navegador.
- `node scripts/generar-compartido.mjs ... --control` revisa que `api/_compartido.js`
  siga siendo lo que se genera desde `index.html` y `supabase-config.js`. Corre en cada
  commit que toque alguno de los tres; si quedó desactualizado lo regenera y frena el
  commit (hay que agregarlo y volver a commitear).

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
`lista-espera` → `pisos` → `precio-opcional` → `accesos` → `autores-unidades` →
`grants-explicitos` (grants de tabla para `authenticated`; no depender de los defaults
de Supabase — una tabla nueva editable desde admin necesita su propio `grant`) →
`alquiler` (estado `'alquiler'` + `units.precio_alquiler`, UYU/mes). Migraciones nuevas: archivo nuevo
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
publicado → mensaje amable sin reintentar. Cada fila de unidad pasa por
`normalizarUnidad(r)` (que también usa la vista previa al compartir). Si sale bien,
`iniciar(proyecto, settings, UNIDADES, mediaTipologias, tzOffsetHoras, hitosObra)` arma
todo.

El script está organizado en secciones numeradas:

1. **DATOS** — mapa `ESTADOS` (`disponible` / `reservado` / `vendido` / `sin_dato`, con
   `color` y `opacidad` del volumen), más `ALQUILER` y `aspectoDe(u)` (ver "Estados de
   presentación" más abajo), resolución del slug, `cargarProyecto()`, formateo (`formatearPrecio`
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
   losa, núcleo, y un mesh por unidad, coloreado con `aspectoDe(u).color`, con
   `userData.unidad` apuntando al objeto de la unidad (así el raycasting mapea un mesh a
   su unidad). Los meshes de unidades viven en `cajas`.
4. **CÁMARA** — cámara orbital (`theta`/`phi`/`radio`), vista inicial desde el frente
   del edificio, radio escalado según la altura del edificio y el aspecto de la
   pantalla; rotación automática lenta (una vuelta cada 80 s) desde el arranque, que se
   corta con cualquier interacción y vuelve tras `INACTIVIDAD_MS` (6 s) sin actividad,
   salvo con un panel, hoja, tarjeta o piso aislado abierto (`puedeGirar()`). Los controles del
   simulador solar también viven acá.
5. **INTERACCIÓN** — hover (tooltip con resumen + emissive) y click (`abrir(u)`). Los
   filtros (chips de dormitorios armados desde los datos, chips de estado, torre, aislar
   piso, "separar pisos") pasan todos por `pasa(u)` / `aplicar()`, que atenúan/desactivan
   los meshes que no coinciden en vez de sacarlos. `aplicar()` no toca el material: fija
   objetivos (`userData.opObj` / `colorObj` / `bordeObj`) y el bucle los interpola (fundido
   al filtrar); el hover hace lo mismo con `userData.emObj`. Toolbar de vista y brújula
   (ver "Interfaz" más abajo) también viven acá.
6. **BUCLE** — loop de render + las interpolaciones de arriba + la brújula.

### Interfaz alrededor del visor

Común a todos los proyectos (no hay tema por proyecto). Tokens en `:root` (`--verde`
`#2B6656` es el color de marca, reservado para lo disponible y acentos).

- **Barra superior** (`#barra-sup`, 64px, 56px en mobile): logo + nombre partido en
  "by" (`"ROSSO by Block"` → `ROSSO` / `by Block`; sin "by" en el nombre usa
  `desarrolla`), ciudad, redes, firma de Cota, y `#brochure` (oculto hasta que exista
  `settings.brochure_url`, columna que todavía no existe). El blur vive en `#barra-sup`
  y no en `#cabezal`: un `backdrop-filter` en `#cabezal` rompería el `position: fixed`
  de `#piso-info`.
- **Ficha** (`#ficha`): dirección, pisos (por torre si hay `geom.torre`, calculado en
  vivo), unidades, entrega y disponibilidad contada en vivo por `aspectoDe(u)`, solo
  estados con unidades y solo si `muestra_totales`. En mobile se pliega a una píldora
  con puntos + cifras y se despliega a pedido (arranca desplegada, salvo con `?u=` o
  `?sol=`). Desplegada, tocar una unidad o su tarjeta, o abrir/usar Filtros o Pisos, no
  la pliega (pedido de Sebastian: los datos del edificio no desaparecen; `enfocar()`
  encuadra debajo de ella, y el riel y Filtros se acomodan debajo vía `--fin-ficha`,
  que mide `medirFinFicha()`); arrastrar el edificio, tocar el vacío, otra capa (sol,
  renders, avance), Escape o abrir el panel sí la pliegan.
- **Barra inferior única** (`#barra-inferior`): en desktop, desplegables Tipología /
  Estado / Torre / Vista que abren `#filtros` como popover con un solo grupo
  (`data-grupo`, `abrirGrupoFiltros()`), Restablecer (`restablecerFiltros()`, reusa los
  sets + `aplicar()` + click en los toggles) y los accesos a renders / avance. En
  mobile: Filtros · Pisos + íconos (renders, avance, sol), cada uno abre su hoja; nunca
  dos hojas abiertas (la ficha desplegada sí convive con Filtros y Pisos).
- **Riel de pisos** (`#pisos`): cifra = unidades **disponibles** del piso; flechas que
  hacen click en la fila vecina (`moverPisoAislado()`); centrado entre "Panel interno" y
  la toolbar para no superponerse; en pantallas bajas compacta filas y un fundido en el
  borde avisa que hay más pisos.
- **Tooltip / tarjeta de unidad**: `pintarResumenUnidad()` (número, estado, torre/piso,
  tipología, m², precio — alquiler en UYU/mes, vendidas sin precio). Desktop: hover =
  tooltip. Click o tap = `seleccionar(caja)`: la cámara va hasta la unidad (`enfocar(u)`,
  vía `moverCamara()`, 750 ms), la unidad queda resaltada como elegida (contorno, ver
  "Selección de unidad", punto 2) y aparece
  `#tarjeta-unidad`. En desktop la tarjeta va `.anclada` a la unidad (aspecto de
  tooltip, la sigue si se gira el edificio; `ubicarTarjeta()` en el bucle) con "Click
  para ver la unidad"; en táctil (`matchMedia('(hover: none)')`) sube sobre la barra
  inferior con "Ver unidad". En los dos casos una línea guía (`#tarjeta-guia`,
  `actualizarGuia()`) une la tarjeta con un punto en el centro de la fachada de la unidad
  que mira a la cámara. Recién el botón de la tarjeta llama a `abrir(u)`, que es lo que registra el
  evento: Demanda cuenta aperturas de ficha, no clicks. Ese botón no esconde la tarjeta:
  `viajarAlPanel()` la lleva hasta el lugar del panel y la convierte en él (`MS_VIAJE` 360 ms,
  `--ease`; el panel aparece al final con `.desde-tarjeta`, sin deslizarse); con
  `prefers-reduced-motion` el panel aparece directo. Con el panel abierto, `#marca-unidad`
  (`actualizarMarca()`) marca la unidad con punto y anillo y una línea al borde del panel o de
  la hoja; si otro volumen la tapa (rayo contra `ocludoresSol`) va punteada. Con el panel ya abierto, un
  click en otra unidad cambia el panel directo; `?u=` también abre el panel directo.
  `enfocar()` encuadra la unidad en lo que dejan libre la tarjeta o el panel. Un
  arrastre que termina sobre una unidad no la selecciona.
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
  = norte arriba. En mobile queda solo la brújula.

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
- **QR** (`#kiosco-qr`, arriba a la izquierda; `actualizarQR()` desde el mismo reloj):
  `linkProyecto(BASE)` (siempre la URL pública, aunque el visor se abra desde localhost o
  una copia local), más `&u=<id>` si hay una unidad destacada (demo, tarjeta o panel),
  siempre sin `kiosco` ni `v=` (un QR fotografiado tiene que seguir sirviendo aunque
  cambie el estado) y con `&src=qr-showroom`. La librería (`qrcode-generator` 1.4.4,
  cdnjs) se carga recién en el modo; el svg se arma a mano (`pintarQR()`). Sin red no
  hay QR y reintenta cada 30 s. Es la única tarjeta blanca del modo: el QR necesita
  fondo y margen para leerse.
- Atribución: usar `&src=showroom` en la URL de la pantalla para separar sus eventos en
  Demanda (todos los visitantes del aparato comparten una sesión).

### Estados de presentación: `aspectoDe(u)` / `ALQUILER`

El color y la opacidad del volumen salen de `aspectoDe(u)` (= `ESTADOS[u.estado]`).
Vendida va en gris casi transparente (no rojo); `sin_dato` en gris neutro legible (en
ROSSO son la mayoría). `'alquiler'` es un estado real (`supabase-migration-alquiler.sql`):
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
- Los links que se comparten llevan `&v=`: `linkDe(u)` (botón copiar del panel y mensaje
  de WhatsApp) y `#red-compartir` (la URL de la barra tal cual + `v` de la unidad de
  `?u=` o del proyecto, vía `conVersion`, que arma `iniciar()`). `v` =
  `versionCompartir(unidades)`: FNV-1a de id, estado, precio, precio de alquiler y
  `estimado`, el mismo cálculo que hace `api/compartir.js` (ver "Vista previa al
  compartir"). Entra el valor, no cómo vino guardado (136673 = "136673.00"; null = '' =
  sin precio; `estimado` solo cuenta si es `true`). El visor ignora `v=` al abrir un
  link; los links sin `v=` andan igual.
- Cada `abrir(u)` registra un click en `events` (`registrarEvento`), que alimenta la
  pestaña Demanda del admin.

### Selección de unidad: comportamiento protegido

Pedido explícito de Sebastian: que no se vuelva a perder. Todo cambio que toque el click
del lienzo, `seleccionar()`, la tarjeta, `abrir()`, `enfocar()`, `moverCamara()`,
`actualizarGuia()` o el bucle de render tiene que dejar esto funcionando igual, y se
verifica en el navegador (desktop y ~390px, en ROSSO y en BRUSCO) antes de darlo por
terminado. Si algo de la lista tiene que cambiar, se acuerda con Sebastian antes, no se
saca de paso. Versión de referencia: commit `8d5c300`. `scripts/control-seleccion.mjs`
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
3. Aparece la tarjeta chica, no el panel: en desktop anclada a la unidad con "Click para
   ver la unidad →"; en táctil, abajo, con "Ver unidad". Una línea guía la une con un
   punto sobre la fachada de la unidad.
4. Recién el botón de la tarjeta abre el panel (`abrir(u, true)`) y registra el evento.
   Con el panel abierto, un click en otra unidad cambia el panel directo.
5. `?u=<id>` abre el panel directo, con la cámara frente a la unidad.
6. El giro automático no corre con tarjeta o panel abiertos y no pelea con la cámara; un
   arrastre que termina sobre una unidad no la selecciona.
7. Encuadre: la unidad queda en lo que dejan libre la tarjeta o el panel; funciona en las
   dos torres de BRUSCO (no asume una torre centrada en el origen); en celular entran al
   menos 40 m de ancho (sin primer plano).

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
- **Accesos** — solo admin de plataforma o de proyecto (`es_admin_proyecto()`): lista
  miembros (`rpc accesos_miembros`), agrega por email a un usuario que ya existe en Auth
  (`rpc accesos_agregar`), cambia rol y quita vía update/delete directo sobre
  `memberships`. Nadie modifica su propio acceso (policy `user_id <> auth.uid()`).
  Crear usuarios no está: necesita service_role (futura Edge Function).

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
`datos/<slug>-fachadas.csv` (usa las funciones de `index.html` tal cual).

## Selector de pisos: `projects.tiene_pb`

El riel de pisos se arma desde `proyecto.pisos`. Los niveles sin unidades se muestran
como una fila deshabilitada "Sin unidades" (p.ej. el piso de amenities de Altamira) en
vez de desaparecer. La fila "PB" aparece si `tiene_pb` es `true` o `NULL`; `false` la
oculta.

## Vista previa al compartir (Open Graph)

Cuando se comparte un link del visor por WhatsApp, Facebook, LinkedIn, etc., el crawler
recibe un HTML con las etiquetas OG de la unidad (`?u=`) o del proyecto. Los visitantes
no pasan por ningún código nuevo: reciben el `index.html` estático de siempre.

- **Ruteo** (`vercel.json`): una sola ruta, `^/(index\.html)?$` con `has` sobre el
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
  falta. Mismas reglas que el visor: tipología de `tipologiaDe()` o dormitorios;
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
- **`api/_compartido.js`** se genera desde `index.html` (`DEFAULT_SLUG`, `ESTADOS`,
  `fmtAlquiler`, `aspectoDe`, `normalizarUnidad`, `versionCompartir`, `numeroDe`,
  `tipologiaDe`, `torreDe`,
  `etiquetaDorms`, `formatoMoneda`, `formatearPrecio`, `formatearM2`, `unirConY`,
  `areaConSigno`, `calcularFachadas` + sus constantes, las medidas por defecto de la
  torre como `dimensionesDe(geo)` y los colores de `:root` como `COLORES`) y
  `supabase-config.js` (URL y anon key). Las funciones de la lista tienen que seguir
  siendo puras y con ese nombre; si cambia alguna, el pre-commit lo avisa.
- Probar: `curl -A "WhatsApp/2.23" "<url>/?p=brusco&u=303"` devuelve el HTML de la
  tarjeta; sin `-A` tiene que devolver el visor. `node scripts/muestras-og.mjs` deja PNG
  de muestra de los casos típicos en `muestras-og/` (ignorada por git) y regenera
  `api/_marca-cota.png`.

## Pendientes (fuera de alcance por ahora)

- En producción `public_projects` no tiene `tiene_pb`: la migración `pisos` parece no
  estar aplicada (el visor no falla porque pide `select('*')`, pero la fila PB nunca se
  puede ocultar).
- `supabase-js` se carga como `@supabase/supabase-js@2` desde jsdelivr, sin versión
  fija.
- El contador de la tarjeta del proyecto se configura con `CONTADOR_EN_TARJETA` en
  `api/_tarjeta.js` (por slug). Pasarlo a una columna de `settings` / `public_settings`
  necesita migración.
- Región: el proyecto de Supabase está en `us-west-2` (Oregón; verificado el
  2026-10-13 por la IP de `db.<ref>.supabase.co` contra los rangos de AWS) y las
  funciones corren en `iad1` (Washington, el default de Vercel). `"regions": ["pdx1"]`
  en `vercel.json` (compatible con `routes`) las pondría al lado de la base.

## Dar de alta un edificio nuevo

Un edificio estándar no necesita cambios de código — es todo datos. Seguir `README.md`
(país/moneda → org → proyecto con `publicado = false` → settings → unidades con un
INSERT generado por script → amenities → usuario de Auth + membership → publicar). Datos
opcionales por edificio: `geometria` (dimensiones, contornos, calle, norte_grados),
lat/lon, tiene_pb, financiacion, tipologías + imágenes, avance de obra.

Lo que sigue hardcodeado en `index.html` y puede necesitar cambios: `DEFAULT_SLUG`,
`BASE`, la marca/colores (variables CSS en `:root`, compartidas por todos los proyectos), y el copy de aviso de demo
(`#aviso`, la última `.nota` del panel).
