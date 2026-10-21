// Generador de las texturas de asfalto de la calzada
// (assets/textures/asfalto-linea.<hash>.webp y asfalto-liso.<hash>.webp).
// Es el texturaAsfalto() que vivía en el visor hasta 2026-10-21, tal cual:
// el visor ahora carga las dos imágenes (mapaAsfalto() y texturasAsfalto en
// app.<hash>.js) y esto queda para regenerarlas, p. ej. para un edificio con
// otro geometria.calle.ancho. Se usa desde tools/textura-asfalto.html.
//
// No usa Math.random(): el PRNG tiene semilla fija (7 con línea, 11 lisa), así
// que cada corrida da los mismos píxeles en el mismo navegador.

// Lo mismo que en el visor: u de la variante con línea repite cada
// TRAMO_TEXTURA metros; la lisa mide LADO_TEXTURA_LISA de lado.
export const TRAMO_TEXTURA = 2.8 * 4, LADO_TEXTURA_LISA = 8;

// El prngSemilla() del visor.
export function prngSemilla(semilla) {
  return function () {
    semilla |= 0; semilla = (semilla + 0x6D2B79F5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Grano fino, manchas suaves y algo de árido claro, todo muy bajo: de lejos
// (mipmaps) se lee el gris de siempre (#686F72). Dos variantes:
// - con línea central discontinua (guiones de 1,6 m cada 2,8 m): u a lo largo
//   de la calle (repite cada TRAMO_TEXTURA), v a lo ancho de la calzada (0 a
//   1). anchoCalle (geometria.calle.ancho, 8 por defecto) fija el grueso de la
//   línea: 0,2 m sobre una calzada de ese ancho.
// - lisa, para los cruces y los primeros metros de cada cuadra, en metros.
// Devuelve el canvas (el visor lo usaba como THREE.CanvasTexture).
export function texturaAsfalto(conLinea, anchoCalle = 8) {
  const W = conLinea ? 1024 : 512, H = 512;
  const mU = conLinea ? TRAMO_TEXTURA : LADO_TEXTURA_LISA, mV = conLinea ? anchoCalle : LADO_TEXTURA_LISA;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const rnd = prngSemilla(conLinea ? 7 : 11); // fija: misma textura en cada carga
  ctx.fillStyle = '#686F72';
  ctx.fillRect(0, 0, W, H);
  // Manchas (desgaste, bacheo), repetidas del otro lado de cada borde que
  // repite, para que empalme sin costura.
  for (let i = 0; i < 16; i++) {
    const x = rnd() * W, y = rnd() * H, r = (1 + rnd() * 2) * W / mU;
    const c = rnd() < 0.45 ? 'rgba(255,255,255,0.014)' : 'rgba(0,0,0,0.02)';
    for (const dx of [-W, 0, W]) for (const dy of conLinea ? [0] : [-H, 0, H]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  }
  if (conLinea) {
    const pxU = W / mU, pxV = H / mV;
    ctx.fillStyle = '#E4E7E7';
    for (let k = 0; k < TRAMO_TEXTURA / 2.8; k++)
      ctx.fillRect((k * 2.8 + 0.6) * pxU, H / 2 - 0.1 * pxV, 1.6 * pxU, 0.2 * pxV);
  }
  // Grano por píxel (±6) y árido claro suelto; también sobre la pintura,
  // que así no queda como un plano liso.
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 12 + (rnd() < 0.012 ? 22 : 0);
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
