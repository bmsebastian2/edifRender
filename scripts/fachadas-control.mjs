// Tabla de control de fachadas y asoleamiento por unidad, para revisar a mano
// antes de publicar. Usa EXACTAMENTE las funciones de index.html (las lee del
// archivo), así la tabla y el visor no pueden divergir.
//
//   node scripts/fachadas-control.mjs [slug]      (default: brusco)
//
// Escribe datos/<slug>-fachadas.csv. Lo que esté mal se corrige cargando
// units.geom.fachadas (p.ej. ["norte"], o [] = interior de manzana) — ver
// calcularFachadas() en index.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2] || 'brusco';

const html = readFileSync(join(raiz, 'index.html'), 'utf8');
function funcion(nombre) {
  const i = html.indexOf('function ' + nombre + '(');
  if (i < 0) throw new Error('No encontré ' + nombre + ' en index.html');
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
}
const ini = html.indexOf('const FACHADA_MARGEN');
// Constantes + calcularFachadas hasta franjasSolFachada (la última del bloque).
const bloque = html.slice(ini, html.indexOf('function franjasSolFachada(')) + funcion('franjasSolFachada');
const codigo = ['diaDelAnio', 'anguloDelDia', 'ecuacionDelTiempo', 'declinacionSolar', 'posicionSolar',
  'horarioSolar', 'areaConSigno'].map(funcion).join('\n') + '\n' + bloque +
  '\nreturn { calcularFachadas, franjasSolFachada };';
const { calcularFachadas, franjasSolFachada } = new Function(codigo)();

const cfg = readFileSync(join(raiz, 'supabase-config.js'), 'utf8');
const url = cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const key = cfg.match(/SUPABASE_ANON_KEY\s*=\s*\n?\s*"([^"]+)"/)[1];
const get = async q => {
  const r = await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(q + ': ' + r.status + ' ' + await r.text());
  return r.json();
};

const [proyecto] = await get(`public_projects?slug=eq.${slug}&select=id,lat,lon,pais,geometria`);
if (!proyecto) throw new Error('No existe (o no está publicado) ' + slug);
const [pais] = await get(`paises?codigo=eq.${proyecto.pais}&select=tz_offset_horas`).catch(() => [null]);
const tz = pais?.tz_offset_horas ?? -3;
const unidades = (await get(`public_units?project_id=eq.${proyecto.id}&select=id,piso,orientacion,geom&order=id`))
  .map(r => ({ id: r.id, piso: r.piso, orient: r.orientacion, geom: r.geom }));

const fachadas = calcularFachadas(unidades, proyecto.geometria);
if (!fachadas) throw new Error('Este proyecto no tiene geometria.calles / norte_grados / contornos');

const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const franjaTxt = (fecha, rumbo) => {
  const { franjas } = franjasSolFachada(proyecto.lat, proyecto.lon, tz, fecha, rumbo);
  return franjas.length ? franjas.map(([a, b]) => hhmm(a) + '-' + hhmm(b)).join(' y ') : 'sin sol';
};
const anio = new Date().getUTCFullYear();
const junio = new Date(Date.UTC(anio, 5, 21)), diciembre = new Date(Date.UTC(anio, 11, 21));

const csv = [['id', 'numero', 'torre', 'piso', 'fuente', 'fachadas', 'metros', 'sol 21 jun', 'sol 21 dic']];
const resumen = {};
for (const u of unidades) {
  const fs = fachadas.get(u.id) || [];
  const clave = fs.map(f => f.calle || f.cardinal).join(' + ') || 'interior de manzana';
  resumen[clave] = (resumen[clave] || 0) + 1;
  csv.push([
    u.id, u.geom?.numero ?? '', u.geom?.torre ?? '', u.piso,
    Array.isArray(u.geom?.fachadas) ? 'manual' : 'calculado',
    fs.map(f => `${f.calle || '-'} (${f.cardinal})`).join(' + ') || 'interior de manzana',
    fs.map(f => f.metros == null ? '' : f.metros.toFixed(1)).join(' + '),
    fs.map(f => franjaTxt(junio, f.rumbo)).join(' | '),
    fs.map(f => franjaTxt(diciembre, f.rumbo)).join(' | '),
  ]);
}
const salida = join(raiz, 'datos', `${slug}-fachadas.csv`);
writeFileSync(salida, '﻿' + csv.map(f => f.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'));
console.log(Object.entries(resumen).sort((a, b) => b[1] - a[1]).map(([k, n]) => String(n).padStart(4) + '  ' + k).join('\n'));
console.log('\n→ ' + salida);
