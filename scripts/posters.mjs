// Posters de carga del visor: images/poster-<slug>.webp y -movil.webp (ver
// "Poster" en CLAUDE.md y el paso 10 del README).
//
//   node scripts/posters.mjs [slug ...]      (default: todos los publicados)
//
// Abre cada edificio en un Chrome headless con los datos reales de Supabase,
// lleva la cámara a "Vista inicial" (el mismo encuadre del primer cuadro),
// esconde la interfaz y captura solo la escena. Los POST a events/leads se
// contestan acá: no ensucia Demanda. Necesita Chrome (CHROME_PATH, o la ruta
// de siempre en Windows); renderiza por CPU (SwiftShader), más lento que con
// GPU pero con el mismo resultado. El poster refleja los estados del momento:
// volver a correrlo si cambian muchas unidades o la geometría.
//
// Al final reescribe VERSIONES_POSTER en el <head> de index.html (el ?v= de
// cada poster): /images/poster-*.webp tiene caché de un año, así que un
// archivo que cambia tiene que cambiar de URL. Commitear los .webp junto con
// index.html.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFile, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PUERTO_WEB = 8790, PUERTO_CDP = 9340;
// Las mismas medidas que elige el script del poster en el <head> de index.html.
const VARIANTES = [
  { sufijo: '', ancho: 1920, alto: 1080, dpr: 1, movil: false },
  { sufijo: '-movil', ancho: 390, alto: 844, dpr: 2, movil: true },
];
const CALIDAD = 0.82;
// Desde "Vista inicial": 750 ms de recorrido de cámara y el giro automático
// frenado 6 s (INACTIVIDAD_MS). Se captura en el medio.
const MS_ANTES_DE_VISTA = 6000, MS_DESPUES_DE_VISTA = 1800;

const espera = ms => new Promise(r => setTimeout(r, ms));

async function slugsPublicados() {
  const cfg = readFileSync(join(raiz, 'supabase-config.js'), 'utf8');
  const url = cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0], key = cfg.match(/eyJ[\w.-]+/)[0];
  const r = await fetch(url + '/rest/v1/public_projects?select=slug&order=slug', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  return (await r.json()).map(p => p.slug);
}

// El repo tal cual, como lo sirve Vercel.
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.glb': 'model/gltf-binary' };
function servir() {
  const servidor = http.createServer((req, res) => {
    let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (ruta === '/') ruta = '/index.html';
    readFile(join(raiz, ruta), (error, datos) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TIPOS[extname(ruta)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(datos);
    });
  });
  return new Promise(r => servidor.listen(PUERTO_WEB, '127.0.0.1', () => r(servidor)));
}

async function abrirChrome(perfil) {
  const proceso = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${perfil}`,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--no-first-run', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`); return proceso; } catch { await espera(250); }
  }
  throw new Error('Chrome no respondió en ' + CHROME);
}

async function pestana() {
  const t = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pendientes = new Map(), oyentes = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); }
    else if (m.method) oyentes.forEach(f => f(m));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pendientes.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluar = async expresion => (await send('Runtime.evaluate', { expression: expresion, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const cerrar = async () => { ws.close(); await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${t.id}`); };
  return { send, evaluar, oyentes, cerrar };
}

async function capturar(slug, v) {
  const p = await pestana();
  try {
    await p.send('Network.enable');
    await p.send('Network.setCacheDisabled', { cacheDisabled: true });
    await p.send('Emulation.setDeviceMetricsOverride', { width: v.ancho, height: v.alto, deviceScaleFactor: v.dpr, mobile: v.movil });
    if (v.movil) await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await p.send('Fetch.enable', { patterns: [{ urlPattern: '*/rest/v1/events*' }, { urlPattern: '*/rest/v1/leads*' }] });
    p.oyentes.push(m => {
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      if (request.method === 'POST') p.send('Fetch.fulfillRequest', { requestId, responseCode: 201, body: '' });
      else p.send('Fetch.continueRequest', { requestId });
    });
    await p.send('Page.navigate', { url: `http://127.0.0.1:${PUERTO_WEB}/?p=${encodeURIComponent(slug)}` });
    const t0 = Date.now();
    for (;;) {
      const estado = await p.evaluar(`(() => { const c = document.getElementById('carga');
        return c && c.classList.contains('carga-error-activo') ? 'error: ' + document.getElementById('carga-error-msg').textContent : c && c.hidden ? 'listo' : ''; })()`);
      if (estado === 'listo') break;
      if (estado) throw new Error(estado);
      if (Date.now() - t0 > 120000) throw new Error('no terminó de cargar en 2 min');
      await espera(300);
    }
    // Autos (GLB) y demás cosas que llegan después del primer cuadro.
    await espera(MS_ANTES_DE_VISTA);
    await p.evaluar(`document.getElementById('hr-reset').click()`);
    await espera(MS_DESPUES_DE_VISTA);
    // Solo la escena: la interfaz se esconde sin cambiar de tamaño, así nada
    // vuelve a encuadrar (ver reencuadrar()). Con opacity y no visibility: un
    // hijo con visibility: visible propio (la fila de amenities de la ficha)
    // se volvía a ver.
    await p.evaluar(`(() => { const s = document.createElement('style');
      s.textContent = 'body > :not(canvas) { opacity: 0 !important; }';
      document.head.appendChild(s);
      return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`);
    const png = (await p.send('Page.captureScreenshot', { format: 'png' })).result.data;
    // PNG → WebP en el mismo navegador, con la calidad de acá.
    const webp = await p.evaluar(`new Promise((r, f) => { const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0); r(c.width + 'x' + c.height + ',' + c.toDataURL('image/webp', ${CALIDAD}).split(',')[1]); };
      img.onerror = f; img.src = 'data:image/png;base64,${png}'; })`);
    const [medidas, base64] = webp.split(',');
    const datos = Buffer.from(base64, 'base64');
    const archivo = `poster-${slug}${v.sufijo}.webp`;
    writeFileSync(join(raiz, 'images', archivo), datos);
    // Chrome no toma como LCP una imagen casi lisa (< 0,05 bits por píxel mostrado).
    const bpp = datos.length * 8 / (v.ancho * v.alto);
    console.log(`images/${archivo}  ${medidas}  ${Math.round(datos.length / 1024)} KB  ${bpp.toFixed(2)} bpp${bpp < 0.1 ? '  ⚠ poca entropía para LCP' : ''}`);
  } finally {
    await p.cerrar();
  }
}

// VERSIONES_POSTER de index.html, con todos los posters de images/ (no solo
// los de esta corrida): clave = slug + sufijo, valor = 8 hex del SHA-256.
function escribirVersiones() {
  const ruta = join(raiz, 'index.html');
  const html = readFileSync(ruta, 'utf8');
  const bloque = /var VERSIONES_POSTER = \{[^}]*\};/;
  if (!bloque.test(html)) throw new Error('index.html: no está "var VERSIONES_POSTER = {...};"');
  const fin = html.includes('\r\n') ? '\r\n' : '\n';
  const lineas = readdirSync(join(raiz, 'images'))
    .map(archivo => archivo.match(/^poster-([a-z0-9-]+)\.webp$/))
    .filter(Boolean)
    .sort((a, b) => (a[1] < b[1] ? -1 : 1))
    .map(([archivo, clave]) => {
      const hash = createHash('sha256').update(readFileSync(join(raiz, 'images', archivo))).digest('hex').slice(0, 8);
      return `      "${clave}": "${hash}"`;
    });
  writeFileSync(ruta, html.replace(bloque, `var VERSIONES_POSTER = {${fin}${lineas.join(',' + fin)}${fin}    };`));
  console.log(`index.html: VERSIONES_POSTER con ${lineas.length} posters`);
}

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : await slugsPublicados();
for (const s of slugs) if (!/^[a-z0-9-]+$/.test(s)) throw new Error(`slug "${s}": el visor solo busca poster para [a-z0-9-]`);
mkdirSync(join(raiz, 'images'), { recursive: true });
const perfil = mkdtempSync(join(tmpdir(), 'posters-'));
const servidor = await servir();
const chrome = await abrirChrome(perfil);
let fallas = 0;
try {
  for (const slug of slugs) {
    for (const v of VARIANTES) {
      try { await capturar(slug, v); } catch (e) { fallas++; console.error(`✗ ${slug}${v.sufijo}: ${e.message}`); }
    }
  }
} finally {
  chrome.kill();
  servidor.close();
  await espera(500);
  try { rmSync(perfil, { recursive: true, force: true }); } catch { /* Chrome todavía lo tiene abierto: queda en temp */ }
}
escribirVersiones();
process.exit(fallas ? 1 : 0);
