// Consulta los precios públicos de BRUSCO en ixou.la y los guarda en
// datos/ixou-brusco-precios.json. Sin dependencias: Node 18+ (fetch nativo).
//
// Uso: node scripts/scrape-ixou-brusco.mjs
//
// Un 404 es información válida (la unidad no existe o no está publicada), no un error.
// Si ya había una corrida anterior, se renombra a .{fecha}.json y se imprime la diferencia.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'datos', 'ixou-brusco-precios.json');
const URL_BASE = 'https://www.ixou.la/apartamentos/brusco/';
const USER_AGENT = 'ArmadoPorCota-precios/1.0 (+https://armadoporcota.vercel.app/)';
const PARALELO = 4;
const PAUSA_MS = 250;
const TIMEOUT_MS = 15000;

// Rango a probar por torre: [piso, cantidad de posiciones]
const RANGOS = {
  A: [[2, 14], [3, 6], ...Array.from({ length: 10 }, (_, i) => [4 + i, 10])],
  B: [[2, 14], [3, 6], ...Array.from({ length: 8 }, (_, i) => [4 + i, 6])],
};

// "Apartamento Studio en Brusco · Studio · 57,7 m² · Piso 2 · Centro · USD 131.711"
// Las de alquiler responden igual en ?mode=venta pero con precio mensual en UYU:
// "... · Piso 3 · Centro · UYU 55.000". La moneda define la operación.
const FORMATO = /^Apartamento .+? en Brusco · (.+?) · (\d+(?:,\d+)?) m² · Piso (\d+) · .+? · (USD|UYU) (\d{1,3}(?:\.\d{3})*)$/;
const OPERACION = { USD: 'venta', UYU: 'alquiler' };

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function generarSlugs() {
  const lista = [];
  for (const [torre, rangos] of Object.entries(RANGOS)) {
    for (const [piso, cant] of rangos) {
      for (let pos = 1; pos <= cant; pos++) {
        lista.push({ slug: `${torre.toLowerCase()}${piso}${String(pos).padStart(2, '0')}`, torre, piso, pos });
      }
    }
  }
  return lista;
}

function decodificar(txt) {
  return txt
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function metaDescription(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (/\bname\s*=\s*["']description["']/i.test(tag)) {
      const m = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i);
      if (m) return decodificar(m[1] ?? m[2]);
    }
  }
  return null;
}

async function pedir(url) {
  let ultimoError;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: res.status, html: res.ok ? await res.text() : '' };
    } catch (e) {
      ultimoError = e;
      if (intento === 0) await esperar(1000);
    }
  }
  throw ultimoError;
}

async function consultar(u) {
  const base = { slug: u.slug, torre: u.torre, piso: u.piso, pos: u.pos, tipologia: null, m2: null, precio: null, moneda: null, operacion: null };
  let r;
  try {
    r = await pedir(`${URL_BASE}${u.slug}?mode=venta`);
  } catch (e) {
    return { ...base, http_status: null, error: true, crudo: `error de red: ${e.message}` };
  }
  if (r.status !== 200) return { ...base, http_status: r.status };

  const crudo = metaDescription(r.html);
  const m = crudo && crudo.match(FORMATO);
  if (!m) return { ...base, http_status: 200, error: true, crudo };
  if (Number(m[3]) !== u.piso) {
    return { ...base, http_status: 200, error: true, crudo: `piso de la ficha (${m[3]}) ≠ piso del slug: ${crudo}` };
  }
  return {
    ...base,
    tipologia: m[1],
    m2: Number(m[2].replace(',', '.')),
    precio: Number(m[5].replace(/\./g, '')),
    moneda: m[4],
    operacion: OPERACION[m[4]],
    http_status: 200,
  };
}

function progreso(hechas, total) {
  const ancho = 30;
  const lleno = Math.round((hechas / total) * ancho);
  process.stdout.write(`\r[${'#'.repeat(lleno)}${'.'.repeat(ancho - lleno)}] ${hechas}/${total}`);
  if (hechas === total) process.stdout.write('\n');
}

function resumenDiferencias(anterior, actual) {
  const previo = new Map(anterior.unidades.filter((u) => u.http_status === 200 && !u.error).map((u) => [u.slug, u]));
  const ahora = new Map(actual.unidades.filter((u) => u.http_status === 200 && !u.error).map((u) => [u.slug, u]));
  const cambios = [], nuevas = [], caidas = [];
  for (const [slug, u] of ahora) {
    const p = previo.get(slug);
    if (!p) nuevas.push(u);
    else if (p.precio !== u.precio) cambios.push({ slug, moneda: u.moneda ?? 'USD', antes: p.precio, ahora: u.precio });
  }
  for (const [slug, p] of previo) if (!ahora.has(slug)) caidas.push(p);

  console.log(`\nDiferencias contra la corrida del ${anterior.fecha}:`);
  console.log(`  Precios que cambiaron: ${cambios.length}`);
  for (const c of cambios) {
    const pct = (((c.ahora - c.antes) / c.antes) * 100).toFixed(1);
    console.log(`    ${c.slug.toUpperCase()}: ${c.moneda} ${c.antes} → ${c.ahora} (${pct > 0 ? '+' : ''}${pct}%)`);
  }
  console.log(`  Unidades nuevas: ${nuevas.length}${nuevas.length ? ' — ' + nuevas.map((u) => u.slug.toUpperCase()).join(', ') : ''}`);
  console.log(`  Dejaron de responder (¿vendidas?): ${caidas.length}${caidas.length ? ' — ' + caidas.map((u) => u.slug.toUpperCase()).join(', ') : ''}`);
}

async function main() {
  const slugs = generarSlugs();
  const unidades = [];
  progreso(0, slugs.length);
  for (let i = 0; i < slugs.length; i += PARALELO) {
    const tanda = await Promise.all(slugs.slice(i, i + PARALELO).map(consultar));
    unidades.push(...tanda);
    progreso(unidades.length, slugs.length);
    if (i + PARALELO < slugs.length) await esperar(PAUSA_MS);
  }

  const actual = { fecha: new Date().toISOString(), unidades };

  mkdirSync(dirname(SALIDA), { recursive: true });
  let anterior = null;
  if (existsSync(SALIDA)) {
    anterior = JSON.parse(readFileSync(SALIDA, 'utf8'));
    const fecha = String(anterior.fecha || 'anterior').replace(/[:.]/g, '-');
    renameSync(SALIDA, SALIDA.replace(/\.json$/, `.${fecha}.json`));
  }
  writeFileSync(SALIDA, JSON.stringify(actual, null, 2) + '\n');

  const ok = unidades.filter((u) => u.http_status === 200 && !u.error);
  const errores = unidades.filter((u) => u.error);
  const no404 = unidades.filter((u) => u.http_status === 404);
  const otros = unidades.filter((u) => u.http_status && ![200, 404].includes(u.http_status));
  const venta = ok.filter((u) => u.operacion === 'venta');
  const alquiler = ok.filter((u) => u.operacion === 'alquiler');
  console.log(`\nProbadas: ${unidades.length} · venta: ${venta.length} · alquiler: ${alquiler.length} · 404: ${no404.length} · con error: ${errores.length} · otros HTTP: ${otros.length}`);
  for (const u of errores) console.log(`  ERROR ${u.slug}: ${u.crudo}`);
  for (const u of otros) console.log(`  HTTP ${u.http_status} ${u.slug}`);
  if (venta.length) {
    const precios = venta.map((u) => u.precio);
    console.log(`Venta: USD ${Math.min(...precios)} – ${Math.max(...precios)}`);
  }
  if (alquiler.length) {
    const precios = alquiler.map((u) => u.precio);
    console.log(`Alquiler: UYU ${Math.min(...precios)} – ${Math.max(...precios)} por mes`);
  }
  console.log(`Guardado en ${SALIDA}`);
  if (anterior) resumenDiferencias(anterior, actual);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
