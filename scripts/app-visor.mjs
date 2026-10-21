// El script principal del visor vive en app.<hash>.js (index.html lo carga
// con <script type="module" src>), con los primeros 10 hex del SHA-256 de su
// contenido en el nombre: Vercel lo sirve con caché de un año (immutable,
// ver vercel.json), así que cada cambio tiene que ir con nombre nuevo.
//
//   node scripts/app-visor.mjs nombre
//       le pone a app.*.js el nombre que corresponde a su contenido y
//       actualiza el <script src> de index.html (correrlo antes de commitear
//       un cambio en el script; si no, el pre-commit lo hace y frena)
//   node scripts/app-visor.mjs control <index.html> <app.js> <nombre>
//       sin tocar nada: 0 = al día, 1 = no (lo usa el pre-commit con las
//       versiones en stage)
//   node scripts/app-visor.mjs unir <index.html> <app.js>
//       el HTML con el script adentro, como era antes de separarlo, a stdout
//
// Los controles que leen funciones del visor (control-seleccion,
// generar-compartido, fachadas-control) trabajan sobre ese HTML unido
// (leerVisor()): el texto es el mismo, así que lo que generan no cambia.
// El hash es del texto con finales LF: core.autocrlf no cambia el nombre.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ETIQUETA = /<script type="module" src="(app\.[0-9a-f]{10}\.js)"><\/script>/;
const ARCHIVO = /^app\.[0-9a-f]{10}\.js$/;

export function nombreDe(js) {
  return 'app.' + createHash('sha256').update(js.replace(/\r\n/g, '\n')).digest('hex').slice(0, 10) + '.js';
}

// El script vuelve a su lugar tal cual: el archivo es el contenido que
// estaba entre <script type="module"> y </script>, sin el renglón vacío del
// principio ni la sangría del cierre.
export function unir(html, js) {
  const fin = html.includes('\r\n') ? '\r\n' : '\n';
  if (!ETIQUETA.test(html)) throw new Error('index.html: no está <script type="module" src="app.<hash>.js">');
  return html.replace(ETIQUETA, () => '<script type="module">' + fin + js + '  </script>');
}

export function leerVisor(dir = raiz) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const m = html.match(ETIQUETA);
  if (!m) throw new Error('index.html: no está <script type="module" src="app.<hash>.js">');
  return unir(html, readFileSync(join(dir, m[1]), 'utf8'));
}

function renombrar() {
  const archivos = readdirSync(raiz).filter(a => ARCHIVO.test(a));
  if (archivos.length !== 1) throw new Error(`Tiene que haber un solo app.<hash>.js en la raíz (hay ${archivos.length}).`);
  const actual = archivos[0];
  const nuevo = nombreDe(readFileSync(join(raiz, actual), 'utf8'));
  const rutaHtml = join(raiz, 'index.html');
  const html = readFileSync(rutaHtml, 'utf8');
  if (!ETIQUETA.test(html)) throw new Error('index.html: no está <script type="module" src="app.<hash>.js">');
  const conNuevo = html.replace(ETIQUETA, () => `<script type="module" src="${nuevo}"></script>`);
  if (nuevo !== actual) renameSync(join(raiz, actual), join(raiz, nuevo));
  if (conNuevo !== html) writeFileSync(rutaHtml, conNuevo);
  console.log(nuevo === actual && conNuevo === html ? `${actual}: al día` : `${actual} → ${nuevo} (index.html actualizado)`);
}

function controlar(rutaHtml, rutaJs, nombre) {
  const esperado = nombreDe(readFileSync(rutaJs, 'utf8'));
  const enHtml = (readFileSync(rutaHtml, 'utf8').match(ETIQUETA) || [])[1];
  const fallas = [];
  if (nombre !== esperado) fallas.push(`${nombre} cambió: por su contenido se tiene que llamar ${esperado}`);
  if (enHtml !== nombre) fallas.push(`index.html carga ${enHtml || '(ninguno)'}, no ${nombre}`);
  for (const f of fallas) console.error('✗ ' + f);
  return fallas.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [orden, ...args] = process.argv.slice(2);
  if (orden === 'nombre') renombrar();
  else if (orden === 'control') process.exit(controlar(...args));
  else if (orden === 'unir') process.stdout.write(unir(readFileSync(args[0], 'utf8'), readFileSync(args[1], 'utf8')));
  else {
    console.error('Uso: node scripts/app-visor.mjs nombre | control <index.html> <app.js> <nombre> | unir <index.html> <app.js>');
    process.exit(2);
  }
}
