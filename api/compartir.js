// Vista previa al compartir (Open Graph). vercel.json manda acá SOLO a los
// crawlers de vista previa (WhatsApp, Facebook, LinkedIn...) que piden "/" o
// "/index.html"; un visitante recibe el index.html estático de siempre y
// nunca pasa por esta función. Devuelve un HTML mínimo con las etiquetas OG
// de la unidad (?u=) o del proyecto, y un link visible al visor.
//
// Nunca un 500: unidad inexistente → tarjeta del proyecto; Supabase caído o
// cualquier error → tarjeta neutra (sin el proyecto no hay nombre que poner).
// Lo que se comparte con el visor (estados, número, tipología, formatos,
// fachadas) viene de _compartido.js, generado desde index.html.
'use strict';

let C = null;
try { C = require('./_compartido.js'); } catch (e) { console.error('compartir: sin _compartido.js', e); }

const TIMEOUT_MS = 4000;
const CACHE_OK = 's-maxage=600, stale-while-revalidate';
// Una falla de Supabase no se guarda 10 minutos en la CDN.
const CACHE_FALLA = 's-maxage=60, stale-while-revalidate';

module.exports = async (req, res) => {
  const pedido = new URL(req.url, 'http://localhost');
  const origen = (req.headers['x-forwarded-proto'] || 'https') + '://' + (req.headers['x-forwarded-host'] || req.headers.host);
  // Mismo orden que resolverSlug() del visor; acá el path siempre es "/".
  const p = pedido.searchParams.get('p');
  const slug = p || (C && C.DEFAULT_SLUG) || 'rosso';
  const pedida = pedido.searchParams.get('u');

  let tarjeta, cache = CACHE_OK;
  try {
    if (!C) throw new Error('sin _compartido.js');
    tarjeta = await armarTarjeta(origen, slug, pedida);
  } catch (e) {
    console.error('compartir:', slug, pedida, e && e.message);
    tarjeta = tarjetaNeutra(origen, slug, pedida);
    cache = CACHE_FALLA;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(pagina(tarjeta));
};

async function armarTarjeta(origen, slug, pedida) {
  // Un slug con caracteres raros no existe: tarjeta neutra sin consultar.
  if (!/^[a-z0-9-]+$/i.test(slug)) return tarjetaNeutra(origen, slug, null);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const [proyecto] = await leer('public_projects?slug=eq.' + encodeURIComponent(slug) + '&select=*&limit=1', signal);
  if (!proyecto) return tarjetaNeutra(origen, slug, null);
  const unidades = (await leer('public_units?project_id=eq.' + proyecto.id + '&select=*&order=id', signal))
    .map(C.normalizarUnidad);

  // Igual que el visor: ?u= se compara como texto contra el id.
  const u = pedida ? unidades.find(x => String(x.id) === pedida) : null;
  return u ? tarjetaUnidad(origen, proyecto, unidades, u) : tarjetaProyecto(origen, proyecto, unidades);
}

async function leer(consulta, signal) {
  const r = await fetch(C.SUPABASE_URL + '/rest/v1/' + consulta, {
    signal, headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + C.SUPABASE_ANON_KEY },
  });
  if (!r.ok) throw new Error(consulta.split('?')[0] + ': HTTP ' + r.status);
  return r.json();
}

// "2 dormitorios · 78 m² · Orientación norte · US$ 210.000 · Disponible",
// cada dato omitido si falta. Las reglas son las de pintarResumenUnidad(),
// textoOrientacion() y nombreEstado() del visor.
function tarjetaUnidad(origen, proyecto, unidades, u) {
  const hayAlquiler = unidades.some(x => x.estado === 'alquiler');
  const datos = [
    C.tipologiaDe(u) || (u.dorms != null ? C.etiquetaDorms(u.dorms) : null),
    u.m2 != null ? C.formatearM2(u.m2, proyecto.locale) + ' m²' : null,
    orientacionDe(proyecto, unidades, u),
    precioDe(proyecto, u),
    // sin_dato no se nombra: "Sin estado público" en una tarjeta confunde.
    u.estado in C.ESTADOS && u.estado !== 'sin_dato'
      ? (u.estado === 'disponible' && hayAlquiler ? 'En venta' : C.ESTADOS[u.estado].nombre)
      : null,
  ].filter(Boolean);
  const titulo = 'Unidad ' + C.numeroDe(u) + ' · ' + proyecto.nombre;
  return {
    titulo,
    descripcion: datos.join(' · '),
    url: linkVisor(origen, proyecto.slug, u.id),
    imagen: origen + '/api/og?p=' + encodeURIComponent(proyecto.slug) + '&u=' + u.id,
    imagenAlt: titulo + ' resaltada en la fachada del edificio',
    locale: proyecto.locale,
    textoLink: 'Ver la unidad en el visor 3D',
  };
}

// units.orientacion (texto libre: "Frente", "Esquina Paullier") tal cual. Si
// no hay, los cardinales calculados por calcularFachadas(), que el visor solo
// arma con lat/lon/norte_grados (tieneNorte()) — hoy solo BRUSCO.
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

// Sin ?u= o con un id que no existe: dirección · entrega · disponibilidad,
// como la ficha del visor (los totales solo con muestra_totales).
function tarjetaProyecto(origen, proyecto, unidades) {
  const venta = unidades.filter(u => u.estado === 'disponible').length;
  const alquiler = unidades.filter(u => u.estado === 'alquiler').length;
  const datos = [
    [proyecto.direccion, proyecto.ciudad].filter(Boolean).join(', '),
    proyecto.entrega ? 'Entrega ' + proyecto.entrega : null,
  ];
  if (proyecto.muestra_totales) {
    if (venta) datos.push(venta + ' ' + (alquiler ? 'en venta' : C.ESTADOS.disponible.plural));
    if (alquiler) datos.push(alquiler + ' ' + C.ESTADOS.alquiler.plural);
  }
  return {
    titulo: proyecto.nombre,
    descripcion: datos.filter(Boolean).join(' · '),
    url: linkVisor(origen, proyecto.slug, null),
    imagen: origen + '/api/og?p=' + encodeURIComponent(proyecto.slug),
    imagenAlt: 'Fachada de ' + proyecto.nombre,
    locale: proyecto.locale,
    textoLink: 'Ver el edificio en el visor 3D',
  };
}

function tarjetaNeutra(origen, slug, pedida) {
  return {
    titulo: 'Disponibilidad navegable',
    descripcion: null,
    url: linkVisor(origen, /^[a-z0-9-]+$/i.test(slug) ? slug : null, pedida && /^\d+$/.test(pedida) ? pedida : null),
    imagen: null,
    locale: null,
    textoLink: 'Ver en el visor 3D',
  };
}

// Como linkDe() del visor: siempre con ?p= (también ROSSO), sin src ni kiosco.
function linkVisor(origen, slug, id) {
  return origen + '/' + (slug ? '?p=' + encodeURIComponent(slug) + (id != null ? '&u=' + id : '') : '');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function pagina(t) {
  const meta = [
    ['property', 'og:type', 'website'],
    ['property', 'og:url', t.url],
    ['property', 'og:title', t.titulo],
    t.descripcion && ['property', 'og:description', t.descripcion],
    t.imagen && ['property', 'og:image', t.imagen],
    t.imagen && ['property', 'og:image:width', '1200'],
    t.imagen && ['property', 'og:image:height', '630'],
    t.imagen && ['property', 'og:image:alt', t.imagenAlt],
    t.locale && ['property', 'og:locale', t.locale.replace('-', '_')],
    ['name', 'twitter:card', t.imagen ? 'summary_large_image' : 'summary'],
    t.descripcion && ['name', 'description', t.descripcion],
  ].filter(Boolean);
  return [
    '<!DOCTYPE html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>' + esc(t.titulo) + '</title>',
    '<link rel="canonical" href="' + esc(t.url) + '">',
    ...meta.map(([attr, clave, valor]) => '<meta ' + attr + '="' + clave + '" content="' + esc(valor) + '">'),
    '</head>',
    '<body>',
    '<h1>' + esc(t.titulo) + '</h1>',
    t.descripcion ? '<p>' + esc(t.descripcion) + '</p>' : '',
    '<p><a href="' + esc(t.url) + '">' + esc(t.textoLink) + '</a></p>',
    '</body>',
    '</html>',
    '',
  ].filter(s => s !== '').join('\n');
}
