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
automatic sync from any spreadsheet — state changes go through `admin.html`, a
login-less internal prototype where someone on the Cota side toggles a unit's `estado`
and can see which units/typologies/floors get the most clicks (logged via
`registrarEvento()` every time `abrir(u)` runs). `admin.html` needs Supabase Auth added
before it's shown to a real client — right now anyone with the link can edit state.

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
