// Control del flujo de selección de unidad del visor: que index.html siga
// teniendo armado lo que pide "Selección de unidad: comportamiento protegido"
// en CLAUDE.md (clic → cámara con recorrido + resaltado + panel directo;
// la tarjeta con línea guía queda para la demo del showroom; ?u= directo).
//
//   node scripts/control-seleccion.mjs [archivo]      (default: index.html)
//
// Lo corre el hook .githooks/pre-commit sobre la versión en stage de
// index.html. Revisa el código, no cómo se ve: después de tocar la
// interacción igual hay que probarlo en el navegador. Si un cambio a
// propósito rompe un control, se actualiza este archivo junto con CLAUDE.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(process.argv[2] || join(raiz, 'index.html'), 'utf8');

// Desde la primera llave a partir de `i` hasta la que la cierra.
function bloqueDesde(i) {
  let d = 0;
  for (let k = html.indexOf('{', i); k > -1 && k < html.length; k++) {
    if (html[k] === '{') d++;
    if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
  return '';
}
function cuerpo(nombre) {
  const i = html.indexOf('function ' + nombre + '(');
  return i < 0 ? '' : bloqueDesde(i);
}
// El click del lienzo que resuelve las unidades (hay otros: sol, pisos).
function clickLienzo() {
  const marca = "lienzo.addEventListener('click'";
  for (let i = html.indexOf(marca); i > -1; i = html.indexOf(marca, i + 1)) {
    const b = bloqueDesde(i);
    if (b.includes('abrir(')) return b;
  }
  return '';
}
// abrir() del panel de la unidad (el del lightbox de renders se llama igual).
const iAbrir = html.indexOf('function abrir(u,');
const abrir = iAbrir < 0 ? '' : bloqueDesde(iAbrir);

const enfocar = cuerpo('enfocar'), mover = cuerpo('moverCamara'), seleccionar = cuerpo('seleccionar');
const animar = cuerpo('animar'), click = clickLienzo(), medir = cuerpo('medirArrastre');
const ms = Number((html.match(/const MS_CAMARA_UNIDAD\s*=\s*(\d+)/) || [])[1]);
const umbral = Number((html.match(/const UMBRAL_ARRASTRE\s*=\s*(\d+)/) || [])[1]);
// La lectura de ?u= al cargar (no cualquier get('u') del archivo: el de
// compartir de la barra también lee u, de la URL que copia).
const iU = html.indexOf("URLSearchParams(location.search).get('u')");

const controles = [
  ['El clic en una unidad abre el panel directo con la cámara (abrir(u, true)) y esconde la tarjeta de la demo',
    /abrir\(\w+,\s*true\)/.test(click) && click.includes('ocultarTarjeta()') && !click.includes('seleccionar(')],
  ['Un arrastre que termina sobre una unidad no la abre (recorrido medido entre pointerdown y pointerup, no en el click; UMBRAL_ARRASTRE entre 3 y 8 px; encontrado: ' + (umbral || 'nada') + ')',
    /arrastreClic > UMBRAL_ARRASTRE\) return/.test(click) && medir.includes('Math.hypot(') &&
    /lienzo\.addEventListener\('pointerup', medirArrastre\)/.test(html) && umbral >= 3 && umbral <= 8],
  ['Un clic en el vacío cierra el panel',
    click.includes('cerrar()')],
  ['Con el panel abierto, otra unidad cambia el contenido en el lugar y el scroll vuelve a 0',
    abrir.includes('pintarPanel(') && /panel\.scrollTop\s*=\s*0/.test(abrir)],
  ['La X y Escape cierran el panel',
    /getElementById\('cerrar'\)\.addEventListener\('click', cerrar\)/.test(html) &&
    /e\.key === 'Escape'\) \{[^}]*\bcerrar\(\)/.test(html)],
  ['Showroom: seleccionar() (la demo) lleva la cámara a la unidad y muestra la tarjeta',
    seleccionar.includes('enfocar(') && seleccionar.includes("classList.add('visible')")],
  ['enfocar() mueve la cámara con recorrido (moverCamara), no con un salto (ubicarCamara)',
    enfocar.includes('moverCamara(') && !/\bubicarCamara\(\)/.test(enfocar)],
  ['MS_CAMARA_UNIDAD entre 600 y 900 ms (encontrado: ' + (ms || 'nada') + ')',
    ms >= 600 && ms <= 900],
  ['moverCamara() interpola cuadro a cuadro y respeta prefers-reduced-motion',
    mover.includes('requestAnimationFrame') && mover.includes('REDUCIR_MOVIMIENTO')],
  ['enfocar() encuadra la unidad misma (sirve para Torre B), no el centro del conjunto',
    enfocar.includes('_centro') && !/objetivo\.set\(\s*CENTRO_X/.test(enfocar)],
  ['enfocar() no hace primer plano en celular (al menos 40 m de ancho)',
    /radioAncho\s*=\s*40\s*\//.test(enfocar)],
  ['Showroom: el botón de la tarjeta de la demo abre el panel con la cámara (abrir(u, true))',
    /abrir\(\w+,\s*true\)/.test(cuerpo('verUnidadTarjeta'))],
  ['?u= abre el panel directo con la cámara frente a la unidad',
    iU > -1 && /abrir\(\w+,\s*true\)/.test(html.slice(iU, iU + 300))],
  ['La unidad de la tarjeta o del panel se resalta como elegida en el bucle',
    /cajaTarjeta/.test(cuerpo('esElegidaCaja')) && /elegida/.test(cuerpo('esElegidaCaja')) &&
    animar.includes('esElegidaCaja(')],
  ['La elegida lleva contorno: CONTORNO sigue a la tarjeta y al panel en el bucle y respeta prefers-reduced-motion',
    animar.includes('CONTORNO.actualizar(') && /const CONTORNO =[\s\S]*?cajaTarjeta \|\| cajaElegida\(\)/.test(html) &&
    /REDUCIR_MOVIMIENTO \? 0 : ms/.test(html)],
  ['Showroom, desktop: la tarjeta va anclada a la unidad y la sigue en cada cuadro',
    html.includes("classList.add('anclada')") && animar.includes('ubicarTarjeta(')],
  ['Showroom, desktop: "Click para ver la unidad" es un botón en la tarjeta',
    cuerpo('pintarResumenUnidad').includes("'boton'") && html.includes('.tt-cta')],
  ['La línea guía existe y se actualiza en cada cuadro',
    html.includes('id="tarjeta-guia"') && animar.includes('actualizarGuia(')],
  ['Hover: sin tooltip sobre la unidad abierta en el panel (sobre las demás, sí)',
    animar.includes('!esElegidaCaja(sobre)') && animar.includes('pintarResumenUnidad(tooltip')],
  ['El giro automático se frena con tarjeta o panel abiertos',
    cuerpo('puedeGirar').includes('!cajaTarjeta') && cuerpo('puedeGirar').includes('!elegida')],
];

let fallas = 0;
for (const [texto, ok] of controles) {
  if (!ok) fallas++;
  console.log((ok ? 'OK     ' : 'FALTA  ') + texto);
}
if (fallas) {
  console.log('\n' + fallas + ' control(es) sin cumplir. Ver "Selección de unidad: comportamiento protegido" en CLAUDE.md.');
  process.exit(1);
}
console.log('\nFlujo de selección de unidad completo.');
