# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file, no-build static web page: a navigable 3D visualization of a residential
building's unit availability, built with Three.js. There is no bundler, package.json,
test suite, or linter — everything (HTML, CSS, JS, and the unit/floor data) lives in one
HTML file loaded via a CDN `<script>` tag (`three.js r128`).

The file was briefly renamed to `index.html.html` (which would have broken Vercel's
root-serving) and has been renamed back to `index.html`.

## Data: Supabase, not hardcoded

Unit data (`units` table) and demand tracking (`events` table) live in Supabase now —
see `supabase-schema.sql` for the schema/RLS/seed and `supabase-config.js` for the client
credentials (fill in `SUPABASE_URL` / `SUPABASE_ANON_KEY` after creating the project).
`index.html` fetches `units` on load and only builds the Three.js scene once that
resolves (see `cargarUnidades()` / `iniciar()` in the script). There is still no
automatic sync from any spreadsheet — state changes go through `admin.html`, an
internal prototype where someone on the Cota side toggles a unit's `estado` and can see
which units/typologies/floors get the most clicks (logged via `registrarEvento()` every
time `abrir(u)` runs). `admin.html` now gates on Supabase Auth
(`sb.auth.signInWithPassword` / `getSession`) before showing anything — users are created
manually in the Supabase dashboard (Authentication → Users), there's no self-signup.
Postgres-level grants restrict `UPDATE` on `units.estado` to the `authenticated` role
(see `supabase-schema.sql`; `supabase-migration-auth.sql` has the one-time migration for
an existing project that predates this). `index.html` links to `admin.html` via the small
"Panel interno" link near the Cota logo.

## Running / testing

There is no dev server, build step, or test command. To preview: open the HTML file
directly in a browser, or serve the directory with any static file server
(e.g. `npx serve .`). Deployment is Vercel, serving whatever file is named `index.html`
at the repo root.

## Architecture (single file, four layers)

The script is organized top-to-bottom in numbered comment sections
(`1. DATOS`, `2. ESCENA`, `3. TORRE`, `4. CÁMARA`, `5. INTERACCIÓN`, `6. BUCLE`). The
important thing to understand is the data flow between them:

1. **Data (`DATOS`)** — `cargarUnidades()` fetches the flat `UNIDADES` array (one row per
   real unit, `id`/`piso`/`pos`/`col`/`frente`/`dorms`/`m2`/`orientacion`/`precio`/
   `estimado`/`estado`) from the Supabase `units` table. `id` is `piso*100 + pos` (or
   `1000+pos` for the penthouse floor) — that math lives in the seed data in
   `supabase-schema.sql`, not in this file anymore. Everything from `2. ESCENA` onward is
   wrapped in `iniciar(UNIDADES)`, called only after the fetch resolves.
   **This table is what encodes this specific building's units** — layout, prices, and
   which are "live" (`estado`) all come from Supabase now, editable via `admin.html`
   without redeploying.

2. **Scene/Tower (`ESCENA`, `TORRE`)** — builds the Three.js scene once from constants
   (`ANCHO`/`PROF`/`ALTO` = unit box dimensions, `PASO` = floor-to-floor height, `SEP_X`/
   `SEP_Z` = spacing between units on a floor plate). For each floor it creates a slab
   (losa), a core/shaft block (nucleo), and one box mesh per unit in `UNIDADES` for that
   floor, colored by `ESTADOS[u.estado].color` and stored with `userData.unidad` pointing
   back to the data object — this is how raycasting later maps a clicked mesh back to its
   unit record.

3. **Camera & interaction (`CÁMARA`, `INTERACCIÓN`)** — orbit-style camera driven by
   `theta`/`phi`/`radio` (drag to orbit, wheel to zoom, auto-rotates slowly until the user
   first touches it). Raycasting against `cajas` (the unit meshes) drives hover (tooltip,
   emissive highlight) and click (`abrir(u)` opens the detail panel). Filtering
   (bedroom-count chips, estado chips, per-floor isolation via the floor rail, and the
   "separar pisos" exploded-view toggle) all funnel through `pasa(u)` /
   `aplicar()`, which dims/disables non-matching unit meshes rather than removing them.

4. **Unit detail panel** — `plantaSVG(u)` / `ambientes(u)` procedurally generate a
   schematic (not architectural) floor-plan SVG from just `m2`, `dorms`, and `orient`, so
   no per-unit plan artwork is needed. `abrir(u)` populates the panel DOM, builds a
   prefilled WhatsApp deep link (`WHATSAPP` number + templated message + `linkDe(u)`), and
   updates the URL (`?u=<id>`) via `history.replaceState` (guarded because
   `about:srcdoc` previews have no history). On load, `?u=<id>` in the query string
   reopens that unit with the camera focused on it (`enfocar(u)`), which is how the
   "share this unit" link (`p-copiar` button) works.

## Unit and floor-plate geometry: the `geom` coordinate system

Each unit can carry its own floor-plan outline (`units.geom.contorno`) instead of being
positioned by the `col`/`frente` grid and drawn as a fixed `ANCHO`×`PROF` box. The floor
plate itself (`projects.geometria.losa_contorno` / `.nucleo_contorno`) can override the
slab and core shape the same way. This is the contract every future building's data load
has to follow (see also `README.md`'s alta runbook):

- **Format**: `contorno` (and `losa_contorno`/`nucleo_contorno`) is a list of `[x, z]`
  points in **meters**, at least 3 points, not repeating the first point at the end.
- **Origin `(0, 0)`**: the center of the floor plate — the same point where the slab and
  core (`geoLosa`/`geoNucleo` in `index.html`) are centered today. Every floor shares this
  same X/Z origin; floors stack directly on top of each other with no per-floor offset.
- **X axis**: horizontal, same direction `col` already uses today — positive to the right
  when facing the building's front from the street.
- **Z axis**: horizontal (depth), same direction `frente` already uses today — negative
  toward the street (frente side), positive toward the contrafrente.
- **Y axis (height)**: not part of `contorno`. A unit is extruded from `y=0` (that floor's
  slab level) up to `alto` — an optional field on `units.geom`; if missing, it falls back
  to that floor's global `ALTO`.
- **Winding**: doesn't matter. `index.html` normalizes the polygon's winding by signed
  area before triangulating it (`formaDesdeContorno()`), so nobody loading data by hand
  needs to get the point order right.
- **Compatibility**: an empty/missing `geom.contorno` (or a `geometria` without
  `losa_contorno`/`nucleo_contorno`) falls back to exactly today's rendering — the
  `col`/`frente` grid and rectangular boxes. That's every one of ROSSO's ~70 units right
  now, and stays that way until ROSSO's data is deliberately migrated.

## Solar simulator: `projects.lat`/`lon`, `paises.tz_offset_horas`, `geometria.norte_grados`

`index.html` can move a real sun over the model (declination/equation-of-time/hour-angle
math computed in-file, no library — see the `posicionSolar`/`horarioSolar` functions near
`iniciar()`) and cast the shadows that result. It needs three pieces of data, added by
`supabase-migration-solar.sql`, and **hides the whole control (`tieneNorte()`) unless all
three are present** — never guesses a default, since a wrong sun is worse than no sun:

- **`projects.lat` / `projects.lon`** (numeric, signed decimal degrees) — Montevideo is
  `-34.88, -56.16`; Managua is `12.13, -86.25`. Editable from `admin.html`'s own
  column-level grant (same tier as `direccion`/`ciudad`), but there's no `admin.html` UI
  for it yet — set directly in Supabase, like `geometria` itself.
- **`paises.tz_offset_horas`** (integer hours from UTC, no DST modeled) — a property of
  the country, not the project, matching how `moneda`/`nombre` already work per-country.
  UY is `-3`, NI is `-6`. The sun's clock always reads this value, never the visitor's
  browser timezone.
- **`projects.geometria.norte_grados`** (number, degrees) — inside the same `geometria`
  jsonb that already holds `losa_contorno`/`nucleo_contorno`, not a new column.
  **Convention**: the compass bearing (0–360, clockwise from true north) that the
  building's **frente** faces — the street-facing side, the model's **-Z axis** —
  *not* the contrafrente (+Z). Altamira's is `45` (frente facing northeast). This is
  deliberately the front, not the back: it's the direction anyone will actually read off
  a map or a site plan ("which way does the front face"), never the back — asking for the
  contrafrente's bearing invites someone to enter the front's bearing by mistake, which is
  a silent 180° flip (exactly what happened once already: a facade that should get
  morning sun only lit up near sunset).
  **How to measure it**: open the building's real address in Google Maps and read the
  compass bearing of the street it fronts (e.g. Altamira: sighted along Lorenzo Batlle).
  Do **not** use a rosa de los vientos printed on a PDF floor plan — those are frequently
  drawn schematically/not-to-scale and are not a reliable source for this angle.
  Get this wrong and the shadows will be confidently wrong in a way that's easy to
  miss — always sanity-check a freshly-entered value: at sunrise the sun should read as
  roughly perpendicular to the frente when the frente's bearing is close to the sunrise
  azimuth, and the frente should stay lit through solar noon whenever `|azimut -
  norte_grados| < 90°`.

The math itself (`posicionSolar`) takes signed `lat`/`lon` and works for either
hemisphere with no special-casing — Nicaragua's sun being northward in its summer falls
out of the trig automatically as long as `lat` is entered with the correct sign.

**ROSSO has none of these three set**, so this feature does not change how ROSSO
renders — same as any other building that doesn't opt in.

## Floor selector: `projects.tiene_pb`

`index.html`'s floor panel (`#pisos`) builds its row list from data instead of a
hardcoded range (same idea as the bedroom-count filter chips): `proyecto.pisos` sets
how many levels exist, and each level with zero units loaded
(`UNIDADES.some(u => u.piso === p)`) renders as a disabled "Sin unidades" row instead
of disappearing — an amenities level with no residential units (e.g. Altamira's 6th
floor) still shows up in the list in its real position, just not as a selectable
empty floor. The ground-floor ("PB") row is gated separately: it only renders if
`projects.tiene_pb` is `true` or unset (`NULL` means "yes, same as every project
before this column existed"); `false` means the building has no ground floor to
isolate. Added by `supabase-migration-pisos.sql`, and (like `geometria`/`lat`/`lon`)
edited directly in Supabase — no `admin.html` UI for it yet.

## Adapting this to a different building

Since this file is meant to be copied into a new project for another building, the
building-specific parts to change are:

- **Header text**: `<h1>`, the address/floor-count/unit-count/delivery-date subtitle in
  `.sub`, and the "`X de Y unidades` tienen estado publicado" copy in `#aviso`.
- **The `units` seed data in `supabase-schema.sql`** — one row per unit (position,
  bedrooms, m², orientation, price, `estimado` flag, `estado`). For a new building,
  write a new seed (see the generator approach used to build this one: a small script
  building the flat unit list, then emitting `insert` values) rather than hand-typing 70+
  rows. The `for (let piso = 1; piso <= 10; piso++)` loop and `ALTURA = 10 * PASO` in
  `index.html` still need to match the new building's floor count — that part of the loop
  (iterating floors, picking which units belong to which) stays in the front-end even
  though the unit data itself now comes from Supabase.
- **Which units show as `disponible`** — set per-row in `units.estado`, edited from
  `admin.html`, not hardcoded. Still manually curated from public listings for this demo,
  just no longer redeploy-to-change. The last `<p class="nota">` in the panel and the
  `#aviso` box still describe this as a demo, not a live feed from the client's own
  systems.
- **`WHATSAPP`** and **`BASE`** (the canonical deployed URL used for share links when the
  page is opened from a non-http context like `about:srcdoc`).
- **Unit box proportions** (`ANCHO`, `PROF`, `ALTO`, spacing constants) if the new
  building's floor plate shape differs meaningfully from a ~5.4×6.4m box.
- **`ambientes(u)`** — the room-layout heuristic used to fake a floor plan from `m2` and
  `dorms`. It only distinguishes 1-bedroom vs. other, and hardcodes proportions; a
  building with 3+ bedroom units or very different layouts will need this extended.

Colors (`--fondo`, `--tinta`, etc. CSS variables and the `ESTADOS` map) and copy are in
Spanish and tailored to this brand — check whether the new building needs different
branding, or just a straight data swap.
