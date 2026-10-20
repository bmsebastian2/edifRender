// optimize:assets — versiones optimizadas de los assets del visor y un
// informe de antes/después por archivo. No pisa ningún original: todo queda
// en optimizado/ (ignorada por git y por Vercel). Reemplazar es un paso
// aparte, a mano, después de leer el informe.
//
//   npm run optimize:assets                       todo
//   npm run optimize:assets -- posters storage    solo esas partes
//
// Partes:
//   posters  vuelve a codificar los posters (AVIF, WebP y la variante de
//            laptop) desde la captura PNG de scripts/posters.mjs, con el mismo
//            codificador (posters-codificar.mjs): para probar calidades.
//   modelos  modelos/autos/*.glb → glTF-Transform: sin texturas (el visor
//            reemplaza los materiales por dos tonos, ver "ESCENA" en
//            CLAUDE.md), dedup, prune y meshopt nivel alto. Solo deja el
//            archivo si pesa menos. Ni KTX2 ni Draco: los autos no tienen
//            texturas, y el decoder de Draco (~300 KB de WASM) pesa más que
//            los tres autos juntos con brotli (~75 KB).
//   storage  las imágenes de Supabase Storage del visor (public_media +
//            portada_url): el original, lo que baja el visor con las
//            variantes de /render/image/ que pide index.html (ver
//            "variantes de Storage" ahí), y lo que daría recodificar el
//            original con sharp, por si se decide reemplazarlo.
//
// Va en su propio paquete (scripts/assets/package.json): en el de la raíz,
// Vercel instalaría sharp y @vercel/og lo usaría en lugar de resvg.wasm.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { ANCHO_LAPTOP, CALIDAD_POSTER, codificarPoster } from './posters-codificar.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SALIDA = join(raiz, 'optimizado');
const PARTES = ['posters', 'modelos', 'storage'];
const pedidas = process.argv.slice(2).filter(a => PARTES.includes(a));
const correr = parte => !pedidas.length || pedidas.includes(parte);

const informe = [];
const kb = n => n == null ? '—' : (n / 1024).toFixed(1).replace('.', ',') + ' KB';
const pct = (antes, despues) => antes && despues != null ? (despues <= antes ? '−' : '+') + Math.round(Math.abs(1 - despues / antes) * 100) + ' %' : '';
const brotli = b => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
function guardar(rutaRel, datos) {
  const ruta = join(SALIDA, rutaRel);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, datos);
}
function tabla(titulo, nota, cabecera, filas) {
  informe.push(`## ${titulo}\n\n${nota}\n\n| ${cabecera.join(' | ')} |\n|${cabecera.map((_, i) => i ? ' ---: ' : ' --- ').join('|')}|\n` +
    filas.map(f => `| ${f.join(' | ')} |`).join('\n') + '\n');
  console.log(`\n${titulo}`);
  console.table(filas.map(f => Object.fromEntries(cabecera.map((c, i) => [c, f[i]]))));
}

// ---------------------------------------------------------------- posters
// Los posters ya salen codificados de scripts/posters.mjs; esto los vuelve a
// codificar desde la captura PNG (datos/posters/, que deja posters.mjs) con
// CALIDAD_POSTER, para probar otra calidad sin pisar nada. Sin PNG, desde el
// WebP publicado (suma algo de pérdida: sirve para comparar, no para
// reemplazar).
async function posters() {
  const carpeta = join(raiz, 'images');
  const hay = new Set(readdirSync(carpeta));
  const peso = archivo => hay.has(archivo) ? readFileSync(join(carpeta, archivo)).length : null;
  const claves = [...new Set([...hay].map(a => a.match(/^poster-([a-z0-9-]+).(avif|webp)$/)?.[1]).filter(Boolean))].sort();
  const filas = [];
  for (const clave of claves) {
    const base = 'poster-' + clave, laptop = '.' + ANCHO_LAPTOP;
    const png = join(raiz, 'datos', 'posters', base + '.png');
    const fuente = existsSync(png) ? readFileSync(png) : readFileSync(join(carpeta, base + '.webp'));
    const nuevos = Object.fromEntries((await codificarPoster(fuente, base)).map(({ archivo, datos }) => {
      guardar('images/' + archivo, datos);
      return [archivo, datos.length];
    }));
    const par = sufijo => `${kb(peso(base + sufijo + '.avif'))} / ${kb(peso(base + sufijo + '.webp'))}`;
    const parNuevo = sufijo => nuevos[base + sufijo + '.avif'] ? `${kb(nuevos[base + sufijo + '.avif'])} / ${kb(nuevos[base + sufijo + '.webp'])}` : '—';
    const esMovil = clave.endsWith('-movil');
    filas.push([clave, existsSync(png) ? 'PNG' : 'WebP publicado', par(''), parNuevo(''), esMovil ? '—' : par(laptop), parNuevo(laptop)]);
  }
  tabla('Posters (images/)', `El LCP del visor. AVIF / WebP: publicado contra recodificado con CALIDAD_POSTER (AVIF ${CALIDAD_POSTER.avif}, WebP ${CALIDAD_POSTER.webp}). La variante de ${ANCHO_LAPTOP} px es la de laptops.`,
    ['Clave', 'Fuente', 'Publicado', 'Recodificado', `${ANCHO_LAPTOP} px publicado`, `${ANCHO_LAPTOP} px recodificado`], filas);
}

// ---------------------------------------------------------------- modelos
async function modelos() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const carpeta = join(raiz, 'modelos', 'autos');
  const filas = [];
  for (const archivo of readdirSync(carpeta).filter(f => f.endsWith('.glb')).sort()) {
    const original = readFileSync(join(carpeta, archivo));
    const doc = await io.readBinary(original);
    const texturas = doc.getRoot().listTextures().length;
    for (const material of doc.getRoot().listMaterials()) {
      material.setBaseColorTexture(null).setMetallicRoughnessTexture(null).setNormalTexture(null)
        .setOcclusionTexture(null).setEmissiveTexture(null);
    }
    await doc.transform(dedup(), prune({ keepAttributes: false }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    const nuevo = await io.writeBinary(doc);
    const gana = nuevo.length < original.length * 0.99;
    // Ojo: modelos/*.glb tiene caché de un año (immutable). Un modelo que
    // cambia va con nombre nuevo, no pisando el archivo.
    if (gana) guardar(`modelos/autos/${archivo}`, nuevo);
    filas.push([archivo, String(texturas), `${kb(original.length)} / ${kb(brotli(original))}`,
      `${kb(nuevo.length)} / ${kb(brotli(nuevo))}`, gana ? 'guardado en optimizado/' : 'sin ganancia: queda el original']);
  }
  tabla('Modelos (modelos/autos/)', 'Tamaño en disco / transferido con brotli (Vercel ya los sirve así). Ya tenían meshopt + cuantización.',
    ['Archivo', 'Texturas', 'Original (disco / br)', 'Reprocesado (disco / br)', 'Resultado'], filas);
}

// ---------------------------------------------------------------- storage
// Lo mismo que piden urlStorage() / srcsetStorage() / urlLightbox() en
// index.html. Si cambian allá, cambiar acá: esto solo mide.
const VARIANTES = {
  portada: { anchos: [640, 960, 1280, 1920], proporcion: 8, calidad: 70 },
  portadaMovil: { anchos: [480, 720, 1080], proporcion: 4, calidad: 70 },
  cabecera: { anchos: [640, 800, 960, 1280, 1600], proporcion: 2.5, calidad: 75 },
  plano: { anchos: [400, 800, 1200], calidad: 85 },
};
const ESCALONES_LIGHTBOX = [720, 1080, 1440, 1920, 2560];
// Pantallas de referencia: escritorio 1920×1080 con DPR 1 y celular 390×844
// con DPR 2. Cada número es el ancho en px de pantalla que pide el `sizes`
// (en el lightbox, la caja de 88vw × 82vh).
const NECESIDAD = {
  portada: { escritorio: 1920 * 0.55, celular: 390 * 0.6 * 2 },
  cabecera: { escritorio: 1920 * 0.37, celular: 390 * 2 },
  plano: { escritorio: 300, celular: (390 - 76) * 2 },
  lightbox: { escritorio: [1920 * 0.88, 1080 * 0.82], celular: [390 * 0.88 * 2, 844 * 0.82 * 2] },
};
const elegir = (anchos, necesidad) => anchos.find(a => a >= necesidad) || anchos[anchos.length - 1];
function urlRender(url, { ancho, alto, proporcion, calidad }) {
  const m = url.match(/^(https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1)\/object\/public\/(.+)$/);
  const p = new URLSearchParams();
  if (ancho) p.set('width', ancho);
  if (ancho && proporcion) { p.set('height', Math.round(ancho / proporcion)); p.set('resize', 'cover'); } else if (ancho) {
    if (alto) p.set('height', alto);
    p.set('resize', 'contain');
  }
  p.set('quality', calidad);
  return `${m[1]}/render/image/public/${m[2]}?${p}`;
}
const urlLightbox = (url, [ancho, alto]) =>
  urlRender(url, { ancho: elegir(ESCALONES_LIGHTBOX, ancho), alto: elegir(ESCALONES_LIGHTBOX, alto), calidad: 80 });
async function bajar(url) {
  // Accept como el de Chrome: con él Supabase devuelve WebP.
  const r = await fetch(url, { headers: { Accept: 'image/avif,image/webp,image/apng,*/*' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
const pesoVariante = async (url, variante, necesidad) =>
  (await bajar(urlRender(url, { ...variante, ancho: elegir(variante.anchos, necesidad) }))).length;

async function storage() {
  const cfg = readFileSync(join(raiz, 'supabase-config.js'), 'utf8');
  const URL_SB = cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0], KEY = cfg.match(/eyJ[\w.-]+/)[0];
  const consultar = async ruta => {
    const r = await fetch(`${URL_SB}/rest/v1/${ruta}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    if (!r.ok) throw new Error(`${r.status} ${ruta}`);
    return r.json();
  };
  const [proyectos, media] = await Promise.all([
    consultar('public_projects?select=id,slug,portada_url'),
    consultar('public_media?select=project_id,tipo,url&order=id'),
  ]);
  const slugDe = Object.fromEntries(proyectos.map(p => [p.id, p.slug]));
  const imagenes = new Map();
  for (const m of media) imagenes.set(m.url, { slug: slugDe[m.project_id], tipo: m.tipo, portada: false });
  for (const p of proyectos) {
    if (!p.portada_url) continue;
    const ya = imagenes.get(p.portada_url);
    if (ya) ya.portada = true; else imagenes.set(p.portada_url, { slug: p.slug, tipo: 'render', portada: true });
  }

  const filas = [];
  let totalOriginal = 0, totalSharp = 0;
  for (const [url, { slug, tipo, portada }] of imagenes) {
    if (!/\/storage\/v1\/object\/public\//.test(url)) continue;
    const original = await bajar(url);
    const meta = await sharp(original).metadata();
    const plano = tipo === 'planta';
    const par = async (variante, n) => `${kb(await pesoVariante(url, variante, n.escritorio))} / ${kb(await pesoVariante(url, variante, n.celular))}`;
    const header = portada ? `${kb(await pesoVariante(url, VARIANTES.portada, NECESIDAD.portada.escritorio))} / ${kb(await pesoVariante(url, VARIANTES.portadaMovil, NECESIDAD.portada.celular))}` : '—';
    const panel = plano ? await par(VARIANTES.plano, NECESIDAD.plano) : await par(VARIANTES.cabecera, NECESIDAD.cabecera);
    const lightbox = plano
      ? kb((await bajar(urlRender(url, { calidad: 90 }))).length)
      : `${kb((await bajar(urlLightbox(url, NECESIDAD.lightbox.escritorio))).length)} / ${kb((await bajar(urlLightbox(url, NECESIDAD.lightbox.celular))).length)}`;

    // Recodificado local, mismas medidas: por si se decide reemplazar el
    // original en Storage (no hace falta para el visor, ver informe).
    const webp = await sharp(original).webp({ quality: plano ? 85 : 78, effort: 6 }).toBuffer();
    const avif = await sharp(original).avif({ quality: plano ? 60 : 55, effort: 6 }).toBuffer();
    const ruta = url.split('/object/public/')[1].replace(/\.[a-z]+$/i, '');
    guardar(`storage/${ruta}.webp`, webp);
    guardar(`storage/${ruta}.avif`, avif);
    totalOriginal += original.length; totalSharp += Math.min(webp.length, avif.length);

    filas.push([`${slug} · ${tipo}${portada ? ' (portada)' : ''} · ${url.split('/').pop().slice(0, 8)}`, `${meta.width}×${meta.height} ${meta.format}`,
      kb(original.length), header, panel, lightbox, `${kb(webp.length)} / ${kb(avif.length)}`]);
  }
  tabla('Imágenes de Supabase Storage', [
    'Lo que baja el visor: escritorio (1920 px, DPR 1) / celular (390 px, DPR 2), WebP de /render/image/. Antes de este cambio, el original en todos los casos.',
    'Header = la portada (se carga de entrada: es lo que medía Lighthouse). Panel = foto de cabecera o tarjeta del plano. Lightbox de planos = medida original con zoom.',
    `Sharp = recodificar el original a la misma medida (WebP / AVIF), en optimizado/storage/. Total originales ${kb(totalOriginal)} → ${kb(totalSharp)} con el menor de los dos.`,
  ].join(' '), ['Imagen', 'Medidas', 'Original', 'Header', 'Panel', 'Lightbox', 'Sharp WebP / AVIF'], filas);
}

if (correr('posters')) await posters();
if (correr('modelos')) await modelos();
if (correr('storage')) await storage();

mkdirSync(SALIDA, { recursive: true });
const archivoInforme = join(SALIDA, 'informe.md');
writeFileSync(archivoInforme, `# Informe de optimize:assets\n\n${new Date().toISOString().slice(0, 10)}. Nada de esto reemplazó un original.\n\n${informe.join('\n')}`);
console.log(`\nInforme: ${relative(raiz, archivoInforme)}. Ningún original fue reemplazado.`);
