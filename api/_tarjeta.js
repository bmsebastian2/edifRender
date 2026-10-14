// Datos de la vista previa al compartir, comunes a api/compartir.js (las
// etiquetas OG) y api/og.mjs (la imagen): qué proyecto y qué unidad, y qué
// datos se muestran de cada uno. Escrito a mano; lo que viene del visor tal
// cual está en _compartido.js (generado). El prefijo _ hace que Vercel no lo
// publique como función.
'use strict';

const C = require('./_compartido.js');

// Si la tarjeta del proyecto (texto e imagen) cuenta las unidades
// disponibles, por slug: p.ej. { altamira: false }. Sin entrada, true. Además
// tiene que estar projects.muestra_totales: si el visor no muestra totales,
// la tarjeta tampoco. Pendiente: pasarlo a public_settings (necesita migración).
const CONTADOR_EN_TARJETA = {};

const TIMEOUT_MS = 4000;

function slugValido(slug) {
  return typeof slug === 'string' && /^[a-z0-9-]+$/i.test(slug);
}

async function leer(consulta, signal) {
  const r = await fetch(C.SUPABASE_URL + '/rest/v1/' + consulta, {
    signal, headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + C.SUPABASE_ANON_KEY },
  });
  if (!r.ok) throw new Error(consulta.split('?')[0] + ': HTTP ' + r.status);
  return r.json();
}

// Proyecto + todas sus unidades normalizadas como en el visor. null si el
// slug no existe o no está publicado; tira error si falla la red.
// proyecto.nombresTipologia (no es columna): { typology_id: nombre_publico },
// lo que tipologiaDe() necesita. Si falla esa consulta queda vacío y la
// tarjeta sigue con geom.tipologia o los dormitorios, como el visor.
async function cargar(slug) {
  if (!slugValido(slug)) return null;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const [proyecto] = await leer('public_projects?slug=eq.' + encodeURIComponent(slug) + '&select=*&limit=1', signal);
  if (!proyecto) return null;
  // select=* y no nombre_publico: sin la migración la columna no existe.
  const [filas, tipologias] = await Promise.all([
    leer('public_units?project_id=eq.' + proyecto.id + '&select=*&order=id', signal),
    leer('public_typologies?project_id=eq.' + proyecto.id + '&select=*', signal).catch(() => []),
  ]);
  proyecto.nombresTipologia = C.nombresPublicosDe(tipologias);
  return { proyecto, unidades: filas.map(C.normalizarUnidad) };
}

// Igual que el visor: ?u= se compara como texto contra el id.
function buscarUnidad(unidades, pedida) {
  return pedida ? unidades.find(x => String(x.id) === pedida) || null : null;
}

// Lo que muestra la tarjeta de una unidad; cada dato null si falta. Mismas
// reglas que pintarResumenUnidad(), textoOrientacion() y nombreEstado() del
// visor. `estado` null en sin_dato: "Sin estado público" no se nombra.
function datosUnidad(proyecto, unidades, u) {
  const hayAlquiler = unidades.some(x => x.estado === 'alquiler');
  const torre = C.torreDe(u);
  return {
    numero: C.numeroDe(u),
    ubicacion: [torre ? (torre === 'Basamento' ? torre : 'Torre ' + torre) : null,
      u.piso === 0 ? 'PB' : u.piso != null ? 'Piso ' + u.piso : null].filter(Boolean).join(' · ') || null,
    tipologia: C.tipologiaDe(u, proyecto.nombresTipologia) || (u.dorms != null ? C.etiquetaDorms(u.dorms) : null),
    m2: u.m2 != null ? C.formatearM2(u.m2, proyecto.locale) + ' m²' : null,
    orientacion: orientacionDe(proyecto, unidades, u),
    precio: precioDe(proyecto, u),
    // El panel del visor lo marca como "Dato estimado"; la tarjeta, "(estimado)".
    estimado: !!u.estimado,
    estado: u.estado in C.ESTADOS && u.estado !== 'sin_dato'
      ? { clave: u.estado, nombre: u.estado === 'disponible' && hayAlquiler ? 'En venta' : C.ESTADOS[u.estado].nombre,
          color: C.ESTADOS[u.estado].color }
      : null,
  };
}

// units.orientacion (texto libre: "Frente", "Esquina Paullier") tal cual. Si
// no hay, los cardinales de calcularFachadas(), que el visor solo arma con
// lat/lon/norte_grados (tieneNorte()) — hoy solo BRUSCO.
function orientacionDe(proyecto, unidades, u) {
  if (u.orient) return u.orient;
  const geo = proyecto.geometria || {};
  if (proyecto.lat == null || proyecto.lon == null || geo.norte_grados == null) return null;
  const fs = C.calcularFachadas(unidades, geo);
  const f = fs && fs.get(u.id);
  if (!f) return null;
  return f.length ? 'Orientación ' + C.unirConY(f.map(x => x.cardinal)) : 'Interior de manzana';
}

// Alquiler: solo el precio por mes en UYU. Venta: con la moneda y el locale
// del proyecto, nunca en las vendidas.
function precioDe(proyecto, u) {
  if (u.estado === 'alquiler') return u.precioAlquiler != null ? C.fmtAlquiler.format(u.precioAlquiler) + ' / mes' : null;
  if (u.precio == null || u.estado === 'vendido' || !proyecto.moneda) return null;
  return C.formatearPrecio(u.precio, proyecto.moneda, proyecto.locale);
}

// "US$ 136.485 (estimado)": el precio como se escribe en el texto.
function precioConMarca(d) {
  return d.precio ? d.precio + (d.estimado ? ' (estimado)' : '') : null;
}

// Lo que muestra la tarjeta del proyecto: dirección, entrega y el contador
// de oferta con los plurales de la ficha ("13 disponibles"; con alquiler,
// "78 en venta" + "34 en alquiler"). contador = [] si está apagado.
function datosProyecto(proyecto, unidades) {
  const venta = unidades.filter(u => u.estado === 'disponible').length;
  const alquiler = unidades.filter(u => u.estado === 'alquiler').length;
  const contador = [];
  if (proyecto.muestra_totales && CONTADOR_EN_TARJETA[proyecto.slug] !== false) {
    if (venta) contador.push({ texto: venta + ' ' + (alquiler ? 'en venta' : C.ESTADOS.disponible.plural), color: C.ESTADOS.disponible.color });
    if (alquiler) contador.push({ texto: alquiler + ' ' + C.ESTADOS.alquiler.plural, color: C.ESTADOS.alquiler.color });
  }
  // Nombre partido en "by" como la barra del visor ("ROSSO" / "by Block");
  // sin "by", el desarrollador debajo.
  const i = proyecto.nombre.indexOf(' by ');
  return {
    nombre: i > 0 ? proyecto.nombre.slice(0, i) : proyecto.nombre,
    firma: i > 0 ? proyecto.nombre.slice(i + 1) : proyecto.desarrolla || null,
    lugar: [proyecto.direccion, proyecto.ciudad].filter(Boolean).join(', ') || null,
    entrega: proyecto.entrega ? 'Entrega ' + proyecto.entrega : null,
    contador,
  };
}

module.exports = { slugValido, cargar, buscarUnidad, datosUnidad, precioConMarca, datosProyecto };
