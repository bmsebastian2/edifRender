// Imágenes de vista previa (PNG 1200×630) para api/og.mjs y
// scripts/muestras-og.mjs: la elevación esquemática del edificio en SVG y la
// composición con @vercel/og (Satori, sin JSX: objetos { type, props }).
// Colores y medidas salen de _compartido.js (los del visor); los datos de
// cada tarjeta, de _tarjeta.js (los mismos que el texto de api/compartir.js).
import { ImageResponse } from '@vercel/og';
import { readFileSync } from 'node:fs';
import C from './_compartido.js';
import T from './_tarjeta.js';

export const ANCHO_IMG = 1200, ALTO_IMG = 630;

// Inter subseteada (ASCII + Latin-1 + puntuación tipográfica), bajada de
// Google Fonts. Cada una con readFileSync(new URL('literal', import.meta.url))
// directo: es el patrón que el empaquetado de Vercel reconoce para incluir el
// archivo (con la URL guardada en una variable no la incluye y falla en runtime).
const FUENTES = [
  [400, readFileSync(new URL('./_fuentes/Inter-400.ttf', import.meta.url))],
  [600, readFileSync(new URL('./_fuentes/Inter-600.ttf', import.meta.url))],
  [700, readFileSync(new URL('./_fuentes/Inter-700.ttf', import.meta.url))],
].map(([weight, data]) => ({ name: 'Inter', weight, style: 'normal', data }));

const K = C.COLORES;
// Color de la marca Cota: el del ícono #cota de la barra del visor.
const VERDE_COTA = '#2F7A68';

// Color opaco equivalente a `hex` con opacidad `a` sobre `fondo`: en 2D las
// unidades se tapan entre sí, así que no se dibujan translúcidas como en 3D.
function mezcla(hex, fondo, a) {
  const c = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [c(hex), c(fondo)];
  return '#' + x.map((v, i) => Math.round(v * a + y[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}
// Grises (los del 3D, más oscuros: en una miniatura chica el edificio tiene
// que leerse contra el fondo). Losa, PB / niveles sin unidades y el borde de
// cada unidad, como las aristas del visor. Ningún gris lleva verde.
const COLOR_LOSA = '#BFC6C3';
const COLOR_VACIO = mezcla('#C7CBCC', K.fondo, 0.85);
const COLOR_BORDE = mezcla(K.tinta, K.fondo, 0.4);
// El resto de las unidades cuando hay una resaltada.
const GRIS_TENUE = C.ESTADOS.sin_dato.color;

/* ============================================================
   ELEVACIÓN — cada unidad proyectada sobre el plano de la fachada.
   ============================================================ */

// Del edificio hacia la calle del frente, en el plano (x, z) del modelo.
const DIR_FRENTE = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] };

// Ejes de quien mira la fachada `lado`: `adentro` = hacia dónde mira,
// `derecha` = su mano derecha. Frente en -Z: +X queda a la izquierda (ver
// CLAUDE.md); BRUSCO (frente -X): +Z (sur, Torre A) a la derecha.
function ejes(geo, lado) {
  const d = DIR_FRENTE[geo.frente_eje] || DIR_FRENTE['-z'];
  const adentro = lado === 'contrafrente' ? d : [-d[0], -d[1]];
  return { adentro, derecha: [-adentro[1], adentro[0]] };
}

// Contorno de la unidad (units.geom.contorno) o, sin él, la caja de la
// grilla col/frente como la arma el visor (ROSSO).
function contornoDe(u, D) {
  if (u.geom && Array.isArray(u.geom.contorno) && u.geom.contorno.length >= 3) return u.geom.contorno;
  const x = u.col * D.SEP_X, z = u.frente * D.SEP_Z, a = D.ANCHO / 2, p = D.PROF / 2;
  return [[x - a, z - p], [x + a, z - p], [x + a, z + p], [x - a, z + p]];
}

// De qué lado se ve mejor la unidad: el plano (frente o contrafrente) que le
// queda más cerca. Los laterales no tienen vista propia.
export function ladoDe(proyecto, unidades, u) {
  const geo = proyecto.geometria || {};
  const D = C.dimensionesDe(geo);
  const { adentro } = ejes(geo, 'frente');
  const prof = x => contornoDe(x, D).map(p => p[0] * adentro[0] + p[1] * adentro[1]);
  const todas = unidades.flatMap(prof);
  const pu = prof(u);
  return Math.min(...pu) - Math.min(...todas) <= Math.max(...todas) - Math.max(...pu) ? 'frente' : 'contrafrente';
}

// SVG de ancho×alto px. Sin `resaltada`, cada unidad en el color de su
// estado (con la opacidad del 3D); con `resaltada`, esa en su color con borde
// y el resto en gris tenue (más claro cuanto más lejos del plano).
export function elevacion(proyecto, unidades, { lado = 'frente', resaltada = null, ancho, alto }) {
  const geo = proyecto.geometria || {};
  const D = C.dimensionesDe(geo);
  const { adentro, derecha } = ejes(geo, lado);
  const piezas = unidades.filter(u => u.piso != null).map(u => {
    const pts = contornoDe(u, D);
    const xs = pts.map(p => p[0] * derecha[0] + p[1] * derecha[1]);
    const ps = pts.map(p => p[0] * adentro[0] + p[1] * adentro[1]);
    const tieneGeom = u.geom && Array.isArray(u.geom.contorno) && u.geom.contorno.length >= 3;
    const y0 = u.piso * D.PASO;
    return { u, x0: Math.min(...xs), x1: Math.max(...xs), y0, y1: y0 + (tieneGeom && u.geom.alto ? u.geom.alto : D.ALTO), prof: Math.min(...ps) };
  });
  if (!piezas.length) return null;

  // Tramos de placa por piso: los intervalos de sus unidades, unidos si
  // están a menos de 1,2 m (así salen separadas las dos torres de BRUSCO).
  const porPiso = new Map();
  for (const p of piezas) {
    if (!porPiso.has(p.u.piso)) porPiso.set(p.u.piso, []);
    porPiso.get(p.u.piso).push(p);
  }
  const tramos = lista => lista.map(p => [p.x0, p.x1]).sort((a, b) => a[0] - b[0]).reduce((res, [a, b]) => {
    const ult = res[res.length - 1];
    if (ult && a <= ult[1] + 1.2) ult[1] = Math.max(ult[1], b); else res.push([a, b]);
    return res;
  }, []);
  const conUnidades = [...porPiso.keys()].sort((a, b) => a - b);
  const tramosDe = new Map(conUnidades.map(n => [n, tramos(porPiso.get(n))]));
  const PISOS = Math.max(proyecto.pisos || 0, ...conUnidades);
  // PB y niveles sin unidades (comercial de BRUSCO, amenities de Altamira):
  // un volumen neutro con los tramos del piso con unidades más cercano.
  const vacios = [];
  for (let n = 0; n <= PISOS; n++) {
    if (tramosDe.has(n)) continue;
    const cerca = [...conUnidades].sort((a, b) => Math.abs(a - n) - Math.abs(b - n) || a - b)[0];
    vacios.push({ n, tramos: tramosDe.get(cerca) });
  }

  const todos = [...tramosDe.values(), ...vacios.map(v => v.tramos)].flat();
  const VUELO = 0.4, MARGEN = 2;
  const xMin = Math.min(...todos.map(t => t[0])) - MARGEN, xMax = Math.max(...todos.map(t => t[1])) + MARGEN;
  const yMax = PISOS * D.PASO + D.ALTO + D.LOSA;
  const s = Math.min(ancho / (xMax - xMin), (alto - 4) / yMax);
  // Centrado en los dos ejes: un edificio ancho y bajo (Altamira) no queda
  // apoyado abajo con medio cuadrado vacío encima en la miniatura.
  const ox = (ancho - (xMax - xMin) * s) / 2, oy = (alto - 4 - yMax * s) / 2;
  const r = n => Math.round(n * 10) / 10;
  const suelo = alto - 3 - oy;
  const X = x => ox + (x - xMin) * s, Y = y => suelo - y * s;
  const rect = (x0, y0, x1, y1, fill, extra = '') =>
    `<rect x="${r(X(x0))}" y="${r(Y(y1))}" width="${r((x1 - x0) * s)}" height="${r(Math.max((y1 - y0) * s, 1.5))}" fill="${fill}"${extra}/>`;

  const partes = [];
  // Suelo.
  partes.push(`<rect x="0" y="${r(suelo)}" width="${ancho}" height="2" fill="${COLOR_LOSA}"/>`);
  for (const v of vacios) {
    const y0 = v.n * D.PASO;
    for (const [a, b] of v.tramos) partes.push(rect(a, y0, b, y0 + D.ALTO, COLOR_VACIO));
  }
  // Losas: debajo y encima de cada piso, con un vuelo de 40 cm.
  for (const [n, ts] of [...tramosDe, ...vacios.map(v => [v.n, v.tramos])]) {
    for (const [a, b] of ts) {
      if (n >= 1) partes.push(rect(a - VUELO, n * D.PASO - D.LOSA, b + VUELO, n * D.PASO, COLOR_LOSA));
      partes.push(rect(a - VUELO, n * D.PASO + D.ALTO, b + VUELO, n * D.PASO + D.ALTO + D.LOSA, COLOR_LOSA));
    }
  }
  // Unidades: por piso, de la más cercana a la más lejana, cada una solo en
  // el tramo que no tapa ninguna de adelante. Un resto angosto (una unidad
  // de atrás que asoma por el borde de la torre) no se colorea: en una
  // imagen chica una franja de color de un metro es ruido. Va en gris
  // neutro, como muro, para no dejar un hueco.
  const profs = piezas.map(p => p.prof);
  const pMin = Math.min(...profs), pRango = Math.max(...profs) - pMin || 1;
  const JUNTA = 0.12, RESTO_MIN = 1.6;
  const colorDe = p => {
    if (!resaltada) {
      const e = C.aspectoDe(p.u);
      return mezcla(e.color, K.fondo, e.opacidad);
    }
    // Más claro que vendido (#B9BEBC) y sin_dato (#9AA19E): una resaltada en
    // un estado gris tiene que seguir destacando. El volumen lo dan los bordes.
    return mezcla(GRIS_TENUE, K.fondo, 0.42 - 0.18 * (p.prof - pMin) / pRango);
  };
  const borde = ` stroke="${COLOR_BORDE}" stroke-width="1"`;
  for (const lista of porPiso.values()) {
    let cubierto = [];
    for (const p of [...lista].sort((a, b) => a.prof - b.prof)) {
      const libres = restar(cubierto, p.x0, p.x1);
      cubierto = unir(cubierto, p.x0, p.x1);
      if (p.u === resaltada) continue;
      for (const [a, b] of libres) {
        const angosto = b - a < RESTO_MIN;
        if (b - a > 2 * JUNTA) partes.push(rect(a + JUNTA, p.y0, b - JUNTA, p.y1, angosto && !resaltada ? COLOR_VACIO : colorDe(p), borde));
      }
    }
  }
  // La resaltada al final: si quedara tapada (interior de manzana), se ve igual.
  const res = resaltada && piezas.find(p => p.u === resaltada);
  if (res) {
    // Halo del color del fondo debajo del borde: la separa de las vecinas.
    partes.push(rect(res.x0 + JUNTA, res.y0, res.x1 - JUNTA, res.y1, 'none',
      ` stroke="${K.fondo}" stroke-width="10" stroke-linejoin="round"`));
    partes.push(rect(res.x0 + JUNTA, res.y0, res.x1 - JUNTA, res.y1, C.aspectoDe(res.u).color,
      ` stroke="${K.tinta}" stroke-width="4" stroke-linejoin="round"`));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">${partes.join('')}</svg>`;
}

// Intervalos [a, b] sobre el eje de la fachada; `cubierto` ordenado y sin
// solapes. restar(): lo de [a, b] que queda libre; unir(): agrega [a, b].
function restar(cubierto, a, b) {
  const libres = [];
  let x = a;
  for (const [c0, c1] of cubierto) {
    if (c1 <= x) continue;
    if (c0 >= b) break;
    if (c0 > x) libres.push([x, c0]);
    x = Math.max(x, c1);
  }
  if (x < b) libres.push([x, b]);
  return libres;
}
function unir(cubierto, a, b) {
  const res = [];
  for (const [c0, c1] of [...cubierto, [a, b]].sort((p, q) => p[0] - q[0])) {
    const ult = res[res.length - 1];
    if (ult && c0 <= ult[1]) ult[1] = Math.max(ult[1], c1); else res.push([c0, c1]);
  }
  return res;
}

/* ============================================================
   COMPOSICIÓN — Satori sin JSX. Todo div con display flex.
   ============================================================ */

function h(type, style, ...hijos) {
  const children = hijos.flat().filter(c => c != null && c !== false && c !== '');
  return { type, props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children } };
}
function img(svg, ancho, alto) {
  return { type: 'img', props: { src: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), width: ancho, height: alto } };
}
// La marca de Cota (cota de nivel: triángulo sobre una línea), como el ícono
// de la barra del visor.
function marcaCota(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M4 13h12" stroke="${color}" stroke-width="1.7"/><path d="M10 5l3.4 5.6H6.6L10 5z" fill="${color}"/></svg>`;
}
function punto(color, tam) {
  return h('div', { width: tam, height: tam, borderRadius: tam / 2, background: color, flexShrink: 0 });
}

// Zona segura: la miniatura de WhatsApp recorta el cuadrado central
// (630×630) de la imagen de 1200×630. Ahí va solo el edificio, completo; el
// texto va en las dos bandas de los costados (285 px cada una), que en la
// imagen completa se leen y en la miniatura quedan afuera enteras, sin
// cortes a mitad de palabra. Las bandas arrancan centradas en vertical: la
// esquina superior izquierda la tapan los botones de Facebook.
export const LADO_ZONA = ALTO_IMG;
const BANDA = (ANCHO_IMG - LADO_ZONA) / 2;
const DIBUJO = { ancho: LADO_ZONA - 44, alto: LADO_ZONA - 64 };
const LIENZO = { width: ANCHO_IMG, height: ALTO_IMG, background: K.fondo, fontFamily: 'Inter', color: K.tinta, position: 'relative' };
// Ancho fijo: sin él Satori no corta el texto largo en líneas y se sale.
const BANDA_IZQ = { position: 'absolute', left: 0, top: 0, width: BANDA, height: ALTO_IMG, flexDirection: 'column',
  justifyContent: 'center', padding: '40px 22px 24px 40px' };
const BANDA_DER = { ...BANDA_IZQ, left: BANDA + LADO_ZONA, padding: '40px 40px 24px 22px' };
// Texto oscuro pero no negro: el rótulo de la vista tiene que leerse.
const TINTA_MEDIA = mezcla(K.tinta, K.fondo, 0.78);

// Pie de las imágenes de clientes: chico y discreto, sin verde.
function pie() {
  return h('div', { position: 'absolute', right: 40, bottom: 22, alignItems: 'center', gap: 5, fontSize: 15, color: K.suave, opacity: 0.85 },
    img(marcaCota(K.suave), 16, 16), 'armado por Cota');
}
function rotuloVista(lado) {
  return h('div', { fontSize: 13, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: TINTA_MEDIA, marginTop: 8 },
    lado === 'frente' ? 'Vista frente' : 'Vista contrafrente');
}
// El dibujo, centrado en la zona segura y apoyado abajo.
function zonaDibujo(svg) {
  return h('div', { position: 'absolute', left: BANDA + 22, top: 34, width: DIBUJO.ancho, height: DIBUJO.alto },
    svg ? img(svg, DIBUJO.ancho, DIBUJO.alto) : null);
}
// "UYU 55.000 / mes" → cifra grande y "/ mes" chico.
function partirPrecio(precio) {
  const i = precio.indexOf(' / ');
  return i > 0 ? [precio.slice(0, i), precio.slice(i + 1)] : [precio, null];
}

export function imagenUnidad(proyecto, unidades, u) {
  const d = T.datosUnidad(proyecto, unidades, u);
  const lado = ladoDe(proyecto, unidades, u);
  const svg = elevacion(proyecto, unidades, { lado, resaltada: u, ...DIBUJO });
  const n = String(d.numero).length;
  const [cifra, porMes] = d.precio ? partirPrecio(d.precio) : [null, null];
  return h('div', LIENZO,
    zonaDibujo(svg),
    h('div', BANDA_IZQ,
      h('div', { fontSize: 20, fontWeight: 600, color: K.suave, lineHeight: 1.25 }, proyecto.nombre),
      rotuloVista(lado),
      h('div', { fontSize: 15, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: K.suave, marginTop: 34 }, 'Unidad'),
      // "503" grande; "A1105" un poco menos, para que entre en la banda.
      h('div', { fontSize: n <= 3 ? 92 : n === 4 ? 78 : 64, fontWeight: 700, letterSpacing: -2, lineHeight: 1 }, String(d.numero)),
      d.ubicacion ? h('div', { fontSize: 20, color: K.suave, marginTop: 8 }, d.ubicacion) : null),
    h('div', BANDA_DER,
      d.estado ? h('div', { alignSelf: 'flex-start', alignItems: 'center', gap: 8, padding: '6px 14px 6px 11px', borderRadius: 999,
        background: mezcla(d.estado.color, K.fondo, 0.18), fontSize: 20, fontWeight: 600 },
      punto(d.estado.color, 12), d.estado.nombre) : null,
      d.tipologia ? h('div', { fontSize: 22, marginTop: 24 }, d.tipologia) : null,
      d.m2 ? h('div', { fontSize: 22, marginTop: 2 }, d.m2) : null,
      cifra ? h('div', { fontSize: cifra.length <= 11 ? 34 : 28, fontWeight: 700, letterSpacing: -0.5, marginTop: 18, lineHeight: 1.1 }, cifra) : null,
      porMes ? h('div', { fontSize: 18, color: K.suave }, porMes) : null,
      d.precio && d.estimado ? h('div', { fontSize: 18, color: K.suave, marginTop: 2 }, '(estimado)') : null),
    pie());
}

export function imagenProyecto(proyecto, unidades) {
  const d = T.datosProyecto(proyecto, unidades);
  const svg = elevacion(proyecto, unidades, { lado: 'frente', ...DIBUJO });
  const n = d.nombre.length;
  return h('div', LIENZO,
    zonaDibujo(svg),
    h('div', BANDA_IZQ,
      // "ROSSO" entra a 56 px; "BRUSCO" a 48; "Altamira Tres Cruces" va en dos líneas.
      h('div', { fontSize: n <= 5 ? 56 : n <= 8 ? 48 : 34, fontWeight: 700, letterSpacing: -1, lineHeight: 1.08 }, d.nombre),
      d.firma ? h('div', { fontSize: 20, color: K.suave, marginTop: 6 }, d.firma) : null,
      rotuloVista('frente')),
    h('div', BANDA_DER,
      d.lugar ? h('div', { fontSize: 17, color: K.suave, lineHeight: 1.35 }, d.lugar) : null,
      d.entrega ? h('div', { fontSize: 17, marginTop: 6 }, d.entrega) : null,
      d.contador.length ? h('div', { flexDirection: 'column', gap: 8, marginTop: 22 },
        d.contador.map(c => h('div', { alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 600 }, punto(c.color, 13), c.texto))) : null),
    pie());
}

// El recorte central que muestra la miniatura de WhatsApp, para revisarlo:
// la misma composición corrida 285 px, en un lienzo de 630×630.
export function recorteCentral(elemento) {
  return h('div', { width: LADO_ZONA, height: LADO_ZONA, position: 'relative', overflow: 'hidden', background: K.fondo },
    h('div', { position: 'absolute', left: -BANDA, top: 0, width: ANCHO_IMG, height: ALTO_IMG }, elemento));
}

export function imagenMarca() {
  return h('div', { ...LIENZO, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
    img(marcaCota(VERDE_COTA), 132, 132),
    h('div', { fontSize: 120, fontWeight: 700, letterSpacing: -4, lineHeight: 1, marginTop: 4 }, 'Cota'),
    h('div', { fontSize: 36, color: K.suave, marginTop: 18 }, 'Visor 3D de disponibilidad'));
}

export async function png(elemento, ancho = ANCHO_IMG, alto = ALTO_IMG) {
  const r = new ImageResponse(elemento, { width: ancho, height: alto, fonts: FUENTES });
  return Buffer.from(await r.arrayBuffer());
}
