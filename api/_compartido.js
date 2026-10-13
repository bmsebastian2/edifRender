// GENERADO por scripts/generar-compartido.mjs desde index.html y
// supabase-config.js. No editar a mano: el pre-commit lo regenera y frena
// el commit si quedó desactualizado.
'use strict';

const SUPABASE_URL = "https://qfnmqcdtqilhbjddhcnh.supabase.co";

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbm1xY2R0cWlsaGJqZGRoY25oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNDY0MzEsImV4cCI6MjEwNDYyMjQzMX0.3BcLXtb85AhQ5M-ORLb83ZQfLJTgw-MPJmPb9x_-lBI";

const DEFAULT_SLUG = 'rosso';

const ESTADOS = {
  // opacidad: la del volumen en la escena. El color de marca queda
  // reservado para lo disponible; lo vendido va en gris casi
  // transparente (con media torre vendida, un rojo dominaba la escena y
  // comunicaba lo contrario a lo que se quiere vender). sin_dato NO va
  // tenue: en ROSSO son 64 de 78 unidades y el edificio quedaría
  // fantasma — es un gris neutro que sigue leyéndose como volumen.
  // plural / singular: la etiqueta corta de la píldora de mobile ("13
  // disponibles"); sin singular se usa el nombre en minúscula.
  disponible: { nombre: 'Disponible', plural: 'disponibles', color: '#2B6656', opacidad: 0.94 },
  // En alquiler: oferta vigente igual que disponible, en un verde salvia
  // más claro que el de venta (precio en u.precioAlquiler, UYU por mes).
  alquiler: { nombre: 'En alquiler', plural: 'en alquiler', color: '#86AC9F', opacidad: 0.86 },
  reservado: { nombre: 'Reservada', plural: 'reservadas', color: '#D2A24C', opacidad: 0.86 },
  vendido: { nombre: 'Vendida', plural: 'vendidas', color: '#B9BEBC', opacidad: 0.34 },
  sin_dato: { nombre: 'Sin estado público', plural: 'a consultar', singular: 'a consultar', color: '#9AA19E', opacidad: 0.62 },
};

const fmtAlquiler = new Intl.NumberFormat('es-UY',
  { style: 'currency', currency: 'UYU', currencyDisplay: 'code', maximumFractionDigits: 0 });

function aspectoDe(u) {
  return ESTADOS[u.estado] || ESTADOS.sin_dato;
}

function normalizarUnidad(r) {
  // Transición: antes de supabase-brusco-alquiler.sql las de alquiler
  // venían como estado = 'sin_dato' + geom.operacion = 'alquiler' +
  // geom.precio_alquiler_uyu. Se normalizan acá, en un solo lugar, para
  // que el resto del visor solo conozca estado = 'alquiler'. Se puede
  // sacar cuando ninguna unidad quede con geom.operacion = 'alquiler'
  // y estado 'sin_dato'.
  const alquilerViejo = r.estado === 'sin_dato' && !!r.geom && r.geom.operacion === 'alquiler';
  const precioAlquiler = r.precio_alquiler != null ? r.precio_alquiler
    : alquilerViejo ? r.geom.precio_alquiler_uyu : null;
  return {
    id: r.id, piso: r.piso, pos: r.pos, col: Number(r.col), frente: r.frente,
    // m2/precio null (unidad cargada sin dato todavía, p.ej. BRUSCO) quedan
    // en null — Number(null) daría 0 y se mostraría "0 m²" / "$0".
    dorms: r.dorms, m2: r.m2 != null ? Number(r.m2) : null, orient: r.orientacion,
    precio: r.precio != null ? Number(r.precio) : null,
    // UYU por mes, siempre UYU (no la moneda del proyecto).
    precioAlquiler: precioAlquiler != null ? Number(precioAlquiler) : null,
    estimado: r.estimado, estado: alquilerViejo ? 'alquiler' : r.estado,
    m2Terraza: r.m2_terraza != null ? Number(r.m2_terraza) : null,
    cocheraPrecio: r.cochera_precio != null ? Number(r.cochera_precio) : null,
    geom: r.geom || null,
    typologyId: r.typology_id || null,
  };
}

function versionCompartir(unidades) {
  const numero = x => x == null || x === '' || !isFinite(Number(x)) ? '' : String(Number(x));
  let h = 0x811c9dc5;
  for (const u of unidades) {
    const clave = [u.id, u.estado || '', numero(u.precio), numero(u.precioAlquiler), u.estimado === true ? 1 : 0];
    for (const c of clave.join('|') + ';') h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function numeroDe(u) {
  return u.geom && u.geom.numero ? u.geom.numero : u.id;
}

function tipologiaDe(u) {
  return !u.typologyId && u.geom && u.geom.tipologia ? u.geom.tipologia : null;
}

function torreDe(u) {
  return u.geom && u.geom.torre ? u.geom.torre : null;
}

function etiquetaDorms(d) {
  return d === 0 ? 'Monoambiente' : d === 1 ? '1 dormitorio' : d + ' dormitorios';
}

function formatoMoneda(moneda, locale) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: moneda, maximumFractionDigits: 0 });
}

function formatearPrecio(valor, moneda, locale) {
  return formatoMoneda(moneda, locale).format(valor);
}

function formatearM2(valor, locale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(valor);
}

function unirConY(lista) {
  return lista.length > 1 ? lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1] : lista[0] || '';
}

function areaConSigno(pts) { // pts: [[u,v], ...] en el plano que se está midiendo
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [u1, v1] = pts[i], [u2, v2] = pts[(i + 1) % pts.length];
    a += u1 * v2 - u2 * v1;
  }
  return a / 2;
}

const FACHADA_MARGEN = 3.5, FACHADA_MIN = 2;
const DIR_LADO = { '-z': [0, -1], '+x': [1, 0], '+z': [0, 1], '-x': [-1, 0] };
const RUMBO_LADO = { '-z': 0, '+x': 90, '+z': 180, '-x': 270 }; // + norte_grados
const CARDINALES = ['norte', 'este', 'sur', 'oeste'];
const RUMBO_CARDINAL = { norte: 0, este: 90, sur: 180, oeste: 270 };
const cardinalDe = rumbo => CARDINALES[Math.round((((rumbo % 360) + 360) % 360) / 90) % 4];

// Devuelve Map id -> [{ cardinal, rumbo, calle, metros }] (principal
// primero; [] = interior de manzana), o null si el proyecto no aplica.
function calcularFachadas(unidades, geometria) {
  const calles = geometria && geometria.calles;
  const norte = geometria && geometria.norte_grados;
  if (!calles || norte == null) return null;
  const conContorno = unidades.filter(u => u.geom && Array.isArray(u.geom.contorno) && u.geom.contorno.length >= 3);
  if (!conContorno.length) return null;
  const pts = conContorno.flatMap(u => u.geom.contorno);
  const borde = {
    '-x': Math.min(...pts.map(p => p[0])), '+x': Math.max(...pts.map(p => p[0])),
    '-z': Math.min(...pts.map(p => p[1])), '+z': Math.max(...pts.map(p => p[1])),
  };
  const distBorde = (lado, [x, z]) => lado[0] === '-'
    ? (lado[1] === 'x' ? x - borde[lado] : z - borde[lado])
    : (lado[1] === 'x' ? borde[lado] - x : borde[lado] - z);
  const fachada = (cardinal, metros) => ({
    cardinal, rumbo: RUMBO_CARDINAL[cardinal], calle: calles[cardinal] || null, metros,
  });

  const res = new Map();
  for (const u of unidades) {
    if (u.geom && Array.isArray(u.geom.fachadas)) {
      res.set(u.id, u.geom.fachadas.filter(c => c in RUMBO_CARDINAL).map(c => fachada(c, null)));
      continue;
    }
    if (!conContorno.includes(u)) continue;
    let p = u.geom.contorno;
    if (areaConSigno(p) < 0) p = [...p].reverse(); // así la normal (dz, -dx) apunta afuera
    const metros = {};
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.3) continue;
      const n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
      const medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      for (const lado in DIR_LADO) {
        const coseno = n[0] * DIR_LADO[lado][0] + n[1] * DIR_LADO[lado][1];
        if (coseno > Math.SQRT1_2 && distBorde(lado, medio) <= FACHADA_MARGEN) {
          metros[lado] = (metros[lado] || 0) + L * coseno;
        }
      }
    }
    res.set(u.id, Object.entries(metros)
      .filter(([, m]) => m >= FACHADA_MIN)
      .sort((x, y) => y[1] - x[1])
      .map(([lado, m]) => fachada(cardinalDe(norte + RUMBO_LADO[lado]), m)));
  }
  return res;
}

function dimensionesDe(geo) {
  const ANCHO = geo.ancho ?? 5.4, PROF = geo.prof ?? 6.4, ALTO = geo.alto ?? 3,
    LOSA = geo.losa_espesor ?? 0.32, PASO = ALTO + LOSA;
  const SEP_X = geo.sep_x ?? (ANCHO + 0.3), SEP_Z = geo.sep_z ?? ((PROF + 2.0) / 2);
  return { ANCHO, PROF, ALTO, LOSA, PASO, SEP_X, SEP_Z };
}

const COLORES = {
  fondo: '#F7F8F7',
  tinta: '#17201E',
  suave: '#6B7471',
  linea: 'rgba(20, 40, 35, .10)',
  verde: '#2B6656',
};

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  DEFAULT_SLUG,
  ESTADOS,
  fmtAlquiler,
  aspectoDe,
  normalizarUnidad,
  versionCompartir,
  numeroDe,
  tipologiaDe,
  torreDe,
  etiquetaDorms,
  formatoMoneda,
  formatearPrecio,
  formatearM2,
  unirConY,
  areaConSigno,
  calcularFachadas,
  dimensionesDe,
  COLORES,
};
