// PNG de muestra de /api/og para revisar a ojo, con datos reales de Supabase.
//
//   node scripts/muestras-og.mjs
//
// 1. Regenera api/_marca-cota.png (la imagen de marca que sirve api/og.mjs
//    tal cual; se commitea): correrlo cada vez que cambia imagenMarca().
// 2. Llama al handler de api/og.mjs con los casos de abajo y deja cada PNG
//    en muestras-og/ (ignorada por git), con el tiempo de cada uno: el
//    primero incluye la carga de módulos, wasm y fuentes (en frío).
// 3. Al lado, <caso>-cuadrado.png: el recorte central de 630×630 que muestra
//    la miniatura de WhatsApp, con la misma composición.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const carpeta = join(raiz, 'muestras-og');
mkdirSync(carpeta, { recursive: true });

const D = await import('../api/_og-dibujo.mjs');
writeFileSync(join(raiz, 'api', '_marca-cota.png'), await D.png(D.imagenMarca()));
console.log('Escrito api/_marca-cota.png');

const { default: handler } = await import('../api/og.mjs');
const CASOS = [
  ['01-rosso-503', '/api/og?p=rosso&u=503'],
  ['02-rosso-503-sin-p', '/api/og?u=503'],
  ['03-brusco-a301-qr', '/api/og?p=brusco&u=301&src=qr-showroom'],
  ['04-altamira-302-estimado', '/api/og?p=altamira&u=302'],
  ['05-brusco-a302-vendida', '/api/og?p=brusco&u=302'],
  ['06-rosso-102-sin-dato', '/api/og?p=rosso&u=102'],
  ['07-rosso-107-reservada-contrafrente', '/api/og?p=rosso&u=107'],
  ['08-brusco-a303-alquiler', '/api/og?p=brusco&u=303'],
  ['09-altamira-999-inexistente', '/api/og?p=altamira&u=999'],
  ['10-brusco-proyecto', '/api/og?p=brusco'],
  ['11-rosso-proyecto', '/api/og'],
  ['12-altamira-proyecto', '/api/og?p=altamira'],
  ['13-slug-inexistente', '/api/og?p=noexiste&u=1'],
  ['14-marca', '/api/og?marca=1'],
];

async function llamar(url) {
  const headers = {};
  const partes = [];
  const t0 = performance.now();
  await handler({ url, headers: {} }, {
    set statusCode(s) { headers.status = s; },
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    end(b) { partes.push(b); },
  });
  return { ms: Math.round(performance.now() - t0), headers, cuerpo: Buffer.concat(partes.map(b => Buffer.from(b))) };
}

// Para el recorte: la misma composición que arma el handler, a partir de la URL.
const { default: T } = await import('../api/_tarjeta.js');
const { default: C } = await import('../api/_compartido.js');
const datosDe = new Map();
async function composicion(url) {
  const q = new URL(url, 'http://localhost').searchParams;
  if (q.has('marca')) return D.imagenMarca();
  const slug = q.get('p') || C.DEFAULT_SLUG;
  if (!datosDe.has(slug)) datosDe.set(slug, await T.cargar(slug));
  const datos = datosDe.get(slug);
  if (!datos) return D.imagenMarca();
  const u = T.buscarUnidad(datos.unidades, q.get('u'));
  return u ? D.imagenUnidad(datos.proyecto, datos.unidades, u) : D.imagenProyecto(datos.proyecto, datos.unidades);
}

for (const [nombre, url] of CASOS) {
  const { ms, headers, cuerpo } = await llamar(url);
  writeFileSync(join(carpeta, nombre + '.png'), cuerpo);
  const cuadrado = await D.png(D.recorteCentral(await composicion(url)), D.LADO_ZONA, D.LADO_ZONA);
  writeFileSync(join(carpeta, nombre + '-cuadrado.png'), cuadrado);
  console.log(`${nombre.padEnd(38)} ${String(ms).padStart(5)} ms  ${headers.status} ${headers['content-type']}  ${headers['cache-control']}  ${(cuerpo.length / 1024).toFixed(0)} KB (cuadrado ${(cuadrado.length / 1024).toFixed(0)} KB)`);
}

// Falla simulada: Supabase no responde → marca con s-maxage=60.
const fetchReal = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('simulado: Supabase no responde'); };
const falla = await llamar('/api/og?p=brusco&u=303');
globalThis.fetch = fetchReal;
writeFileSync(join(carpeta, '15-falla-supabase.png'), falla.cuerpo);
console.log(`${'15-falla-supabase'.padEnd(38)} ${String(falla.ms).padStart(5)} ms  ${falla.headers.status} ${falla.headers['content-type']}  ${falla.headers['cache-control']}`);
console.log('\nMuestras en ' + carpeta);
