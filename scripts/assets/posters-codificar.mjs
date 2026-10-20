// Codificación de los posters de carga, desde la captura PNG sin pérdida. La
// usan scripts/posters.mjs (al generarlos) y optimizar.mjs (para probar
// calidades sin pisar nada). Ver "Poster" en CLAUDE.md.
//
// Por clave (poster-<slug> o poster-<slug>-movil): .avif y .webp a la medida
// de la captura, y en las de escritorio además .1440.avif y .1440.webp. El
// visor elige con <picture>: AVIF, y WebP solo en navegadores sin AVIF.
import sharp from 'sharp';

// Elegidas mirando recortes al 100 % contra los WebP anteriores (2026-10-20):
// AVIF 55 no se distingue y pesa ~40 % menos; más bajo empieza a alisar el
// grano del asfalto. WebP 80 ≈ la calidad 0,82 que usaba el canvas de Chrome.
export const CALIDAD_POSTER = { avif: 55, webp: 80 };
// Variante para laptops: el navegador elige la menor que cubra el ancho, y
// una de 1366 o 1440 px con DPR 1 necesita más de 1280 (bajaba la de 1920).
export const ANCHO_LAPTOP = 1440;

// fuente: Buffer de la imagen; base: 'poster-rosso' o 'poster-rosso-movil'.
// Devuelve [{ archivo, datos }].
export async function codificarPoster(fuente, base) {
  const { width } = await sharp(fuente).metadata();
  const medidas = [{ sufijo: '', imagen: sharp(fuente) }];
  if (!base.endsWith('-movil') && width > ANCHO_LAPTOP) {
    medidas.push({ sufijo: '.' + ANCHO_LAPTOP, imagen: sharp(fuente).resize(ANCHO_LAPTOP) });
  }
  const archivos = [];
  for (const { sufijo, imagen } of medidas) {
    archivos.push({ archivo: `${base}${sufijo}.avif`, datos: await imagen.clone().avif({ quality: CALIDAD_POSTER.avif, effort: 6 }).toBuffer() });
    archivos.push({ archivo: `${base}${sufijo}.webp`, datos: await imagen.clone().webp({ quality: CALIDAD_POSTER.webp, effort: 6 }).toBuffer() });
  }
  return archivos;
}
