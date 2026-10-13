// Vista previa al compartir (Open Graph). vercel.json manda acá SOLO a los
// crawlers de vista previa (WhatsApp, Facebook, LinkedIn...) que piden "/" o
// "/index.html"; un visitante recibe el index.html estático de siempre y
// nunca pasa por esta función. Devuelve un HTML mínimo con las etiquetas OG
// de la unidad (?u=) o del proyecto, y un link visible al visor.
//
// Nunca un 500: unidad inexistente → tarjeta del proyecto; slug inexistente,
// Supabase caído o cualquier error → tarjeta neutra de Cota. Los datos de
// cada tarjeta salen de _tarjeta.js (los mismos que dibuja api/og.mjs).
'use strict';

let C = null, T = null;
try {
  C = require('./_compartido.js');
  T = require('./_tarjeta.js');
} catch (e) { console.error('compartir: sin _compartido.js / _tarjeta.js', e); }

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
    if (!T) throw new Error('sin _tarjeta.js');
    const datos = await T.cargar(slug);
    const u = datos && T.buscarUnidad(datos.unidades, pedida);
    tarjeta = !datos ? tarjetaNeutra(origen, slug, null)
      : u ? tarjetaUnidad(origen, datos.proyecto, datos.unidades, u)
      : tarjetaProyecto(origen, datos.proyecto, datos.unidades);
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

// "2 dormitorios · 78 m² · Orientación norte · US$ 210.000 (estimado) · Disponible",
// cada dato omitido si falta.
function tarjetaUnidad(origen, proyecto, unidades, u) {
  const d = T.datosUnidad(proyecto, unidades, u);
  const titulo = 'Unidad ' + d.numero + ' · ' + proyecto.nombre;
  return {
    titulo,
    descripcion: [d.tipologia, d.m2, d.orientacion, T.precioConMarca(d), d.estado && d.estado.nombre]
      .filter(Boolean).join(' · '),
    url: linkVisor(origen, proyecto.slug, u.id),
    imagen: origen + '/api/og?p=' + encodeURIComponent(proyecto.slug) + '&u=' + u.id,
    imagenAlt: titulo + ' resaltada en la fachada del edificio',
    locale: proyecto.locale,
    textoLink: 'Ver la unidad en el visor 3D',
  };
}

// Sin ?u= o con un id que no existe: dirección · entrega · contador.
function tarjetaProyecto(origen, proyecto, unidades) {
  const d = T.datosProyecto(proyecto, unidades);
  return {
    titulo: proyecto.nombre,
    descripcion: [d.lugar, d.entrega, ...d.contador.map(c => c.texto)].filter(Boolean).join(' · '),
    url: linkVisor(origen, proyecto.slug, null),
    imagen: origen + '/api/og?p=' + encodeURIComponent(proyecto.slug),
    imagenAlt: 'Fachada de ' + proyecto.nombre,
    locale: proyecto.locale,
    textoLink: 'Ver el edificio en el visor 3D',
  };
}

// Slug inexistente o falla: la tarjeta de Cota, con su imagen de marca.
function tarjetaNeutra(origen, slug, pedida) {
  const valido = /^[a-z0-9-]+$/i.test(slug);
  return {
    titulo: 'Cota · Visor 3D de disponibilidad',
    descripcion: 'Recorré el edificio en 3D y mirá qué unidades están disponibles, piso por piso.',
    url: linkVisor(origen, valido ? slug : null, valido && pedida && /^\d+$/.test(pedida) ? pedida : null),
    imagen: origen + '/api/og?marca=1',
    imagenAlt: 'Cota · Visor 3D de disponibilidad',
    locale: 'es-UY',
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
