// Genera api/_compartido.js: lo que las funciones de api/ (la vista previa
// al compartir) comparten con el visor, copiado TAL CUAL de index.html y
// supabase-config.js. Así la tarjeta que muestra WhatsApp y el visor no
// pueden divergir, y las funciones no leen index.html en runtime: usan este
// archivo, que se commitea.
//
//   node scripts/generar-compartido.mjs [index.html] [supabase-config.js]
//        escribe api/_compartido.js
//   node scripts/generar-compartido.mjs <index.html> <supabase-config.js> --control <_compartido.js>
//        sale con 1 si <_compartido.js> no es lo que se generaría
//
// El hook .githooks/pre-commit corre el control sobre las versiones en
// stage; si quedó desactualizado, lo regenera y frena el commit. Si se
// renombra o mueve algo de la lista de abajo en index.html, este script
// falla diciendo qué no encontró.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(raiz, 'api', '_compartido.js');

// Funciones puras del visor (sin THREE, DOM ni variables de iniciar()).
const FUNCIONES = ['aspectoDe', 'normalizarUnidad', 'numeroDe', 'tipologiaDe', 'torreDe', 'etiquetaDorms',
  'formatoMoneda', 'formatearPrecio', 'formatearM2', 'unirConY', 'areaConSigno'];

export function generar(html, cfg) {
  // CRLF/LF no cuenta (core.autocrlf en Windows): todo se compara en LF.
  html = html.replace(/\r\n/g, '\n');
  cfg = cfg.replace(/\r\n/g, '\n');
  const posicion = marca => {
    const i = html.indexOf(marca);
    if (i < 0) throw new Error('No encontré "' + marca + '" en index.html');
    return i;
  };
  // Desde `i` hasta el cierre del primer `abre` que aparezca a partir de ahí.
  const hastaCierre = (i, abre, cierra) => {
    let d = 0;
    for (let k = html.indexOf(abre, i); k > -1 && k < html.length; k++) {
      if (html[k] === abre) d++;
      if (html[k] === cierra && --d === 0) return k + 1;
    }
    throw new Error('Sin cerrar desde la posición ' + i);
  };
  // Le saca a cada línea la sangría que tenía en index.html.
  const sinSangria = (i, texto) => {
    const col = i - (html.lastIndexOf('\n', i) + 1);
    return texto.split('\n').map(l => l.replace(new RegExp('^ {0,' + col + '}'), '')).join('\n');
  };
  const trozo = (i, fin) => sinSangria(i, html.slice(i, fin));
  const funcion = nombre => {
    const i = posicion('function ' + nombre + '(');
    return trozo(i, hastaCierre(i, '{', '}'));
  };

  const iSlug = posicion("const DEFAULT_SLUG = '");
  const iEstados = posicion('const ESTADOS = {');
  const iAlquiler = posicion('const fmtAlquiler = new Intl.NumberFormat(');
  // Constantes de fachadas + calcularFachadas (sin el sol: no hace falta acá).
  const iFachadas = posicion('const FACHADA_MARGEN');
  const finFachadas = hastaCierre(posicion('function calcularFachadas('), '{', '}');

  const url = cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/);
  const key = cfg.match(/SUPABASE_ANON_KEY\s*=\s*\n?\s*"([^"]+)"/);
  if (!url || !key) throw new Error('No encontré SUPABASE_URL / SUPABASE_ANON_KEY en supabase-config.js');

  const piezas = [
    `const SUPABASE_URL = "${url[1]}";`,
    `const SUPABASE_ANON_KEY = "${key[1]}";`,
    trozo(iSlug, html.indexOf(';', iSlug) + 1),
    trozo(iEstados, hastaCierre(iEstados, '{', '}')) + ';',
    trozo(iAlquiler, hastaCierre(iAlquiler, '(', ')')) + ';',
    ...FUNCIONES.map(funcion),
    trozo(iFachadas, finFachadas),
  ];
  const nombres = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DEFAULT_SLUG', 'ESTADOS', 'fmtAlquiler', ...FUNCIONES,
    'calcularFachadas'];
  return [
    '// GENERADO por scripts/generar-compartido.mjs desde index.html y',
    '// supabase-config.js. No editar a mano: el pre-commit lo regenera y frena',
    '// el commit si quedó desactualizado.',
    "'use strict';",
    '',
    piezas.join('\n\n'),
    '',
    'module.exports = {',
    ...nombres.map(n => '  ' + n + ','),
    '};',
    '',
  ].join('\n');
}

const args = process.argv.slice(2);
const iControl = args.indexOf('--control');
const fuentes = iControl < 0 ? args : args.slice(0, iControl);
const html = readFileSync(fuentes[0] || join(raiz, 'index.html'), 'utf8');
const cfg = readFileSync(fuentes[1] || join(raiz, 'supabase-config.js'), 'utf8');
let generado;
try {
  generado = generar(html, cfg);
} catch (e) {
  // 2 = no se puede generar (falta algo en index.html); 1 = desactualizado.
  console.error('generar-compartido: ' + e.message);
  process.exit(2);
}

if (iControl < 0) {
  writeFileSync(SALIDA, generado);
  console.log('Escrito api/_compartido.js');
} else {
  let actual = '';
  try { actual = readFileSync(args[iControl + 1], 'utf8'); } catch { /* todavía no existe */ }
  if (actual.replace(/\r\n/g, '\n') !== generado) {
    console.error('api/_compartido.js no coincide con lo que se genera desde index.html / supabase-config.js.');
    process.exit(1);
  }
}
