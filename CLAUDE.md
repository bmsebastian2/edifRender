# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file, no-build static web page: a navigable 3D visualization of a residential
building's unit availability, built with Three.js. There is no bundler, package.json,
test suite, or linter — everything (HTML, CSS, JS, and the unit/floor data) lives in one
HTML file loaded via a CDN `<script>` tag (`three.js r128`).

**Current file: `index.html.html`.** This is very likely a mistake, not intentional — the
project's own git history (`5952e5b Rename rosso-by-block.html to index.html so Vercel
serves it at root`) shows it was deliberately named `index.html` so Vercel serves it at
the site root, and the most recent commit (`1661bef Change every things`) renamed it to
`index.html.html` and deleted `README.md`. Renamed like this, Vercel will not serve it at
`/`. Flag this to the user / rename it back to `index.html` before deploying, unless they
say the double extension is intentional.

## Running / testing

There is no dev server, build step, or test command. To preview: open the HTML file
directly in a browser, or serve the directory with any static file server
(e.g. `npx serve .`). Deployment is Vercel, serving whatever file is named `index.html`
at the repo root.

## Architecture (single file, four layers)

The script is organized top-to-bottom in numbered comment sections
(`1. DATOS`, `2. ESCENA`, `3. TORRE`, `4. CÁMARA`, `5. INTERACCIÓN`, `6. BUCLE`). The
important thing to understand is the data flow between them:

1. **Data (`DATOS`)** — `PLANTA` and `PENTHOUSE` are per-floor unit *templates*
   (8 units for typical floors, 6 for the top/penthouse floor), each describing position
   on the floor plate (`col`, `frente`), bedroom count, m², orientation, and price.
   `PUBLICADAS` is the hardcoded list of unit IDs that have a public listing today. A
   loop builds the flat `UNIDADES` array (one entry per real unit across all floors) by
   stamping out the templates per floor and computing each unit's `id` as
   `piso*100 + pos` (or `1000+pos` for the penthouse floor), then setting
   `estado: 'disponible' | 'sin_dato'` based on whether the id is in `PUBLICADAS`.
   **This is the one section that encodes this specific building** — floor count, units
   per floor, layout, prices, and which units are "live" all come from here.

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
- **`PLANTA` / `PENTHOUSE`** — the per-floor unit templates (count, position, bedrooms,
  m², orientation, price, `estimado` flag). If the new building doesn't have a distinct
  penthouse floor, the `piso === 10 ? PENTHOUSE : PLANTA` conditional and the `for` loop's
  floor count (`piso <= 10`) both need to change together.
  Note the id math (`piso*100 + pos`, `1000 + pos`) is coupled to `pos` being 1-8 for
  regular floors — don't let template `pos` collide across floors.
  Update `MAX floor count` (`piso <= 10`) and `ALTURA = 10 * PASO` if the floor count
  changes.
- **`PUBLICADAS`** — which unit IDs currently show as available; this is manually curated
  from public listings, not fetched live.
  This is documented for the reader in the last `<p class="nota">` in the panel and in
  the `#aviso` box — both mention this is a static demo, not a live feed.
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
