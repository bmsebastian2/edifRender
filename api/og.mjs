// /api/og — la imagen de la vista previa al compartir (PNG 1200×630), la que
// apunta og:image en api/compartir.js:
//   ?p=<slug>&u=<id>   la unidad resaltada en la elevación de su lado
//   ?p=<slug>          la fachada del proyecto con cada unidad en su estado
//   ?marca=1           la imagen de marca Cota (tarjeta neutra)
// Slug inexistente → marca. Cualquier falla (Supabase, render, fuentes) →
// marca con s-maxage=60: nunca un 500 ni una imagen rota. Solo node:fs va
// importado arriba; el resto se carga adentro del try por la misma razón.
import { readFileSync } from 'node:fs';

const CACHE_OK = 's-maxage=600, stale-while-revalidate';
const CACHE_FALLA = 's-maxage=60, stale-while-revalidate';
// PNG 1×1 transparente: solo si ni la imagen de marca se pudiera leer.
const PNG_MINIMO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// La imagen de marca es un PNG fijo, generado con el mismo dibujo por
// scripts/muestras-og.mjs: servirla no puede fallar.
function marca() {
  try {
    return readFileSync(new URL('./_marca-cota.png', import.meta.url));
  } catch (e) {
    console.error('og: sin _marca-cota.png', e);
    return PNG_MINIMO;
  }
}

export default async function handler(req, res) {
  const pedido = new URL(req.url, 'http://localhost');
  let imagen, cache = CACHE_OK, falla = null;
  try {
    if (pedido.searchParams.has('marca')) {
      imagen = marca();
    } else {
      const [D, { default: T }, { default: C }] = await Promise.all([
        import('./_og-dibujo.mjs'), import('./_tarjeta.js'), import('./_compartido.js')]);
      // Mismo slug que el visor y api/compartir.js: ?p=, si no ROSSO.
      const datos = await T.cargar(pedido.searchParams.get('p') || C.DEFAULT_SLUG);
      if (!datos) {
        imagen = marca();
      } else {
        const u = T.buscarUnidad(datos.unidades, pedido.searchParams.get('u'));
        imagen = await D.png(u ? D.imagenUnidad(datos.proyecto, datos.unidades, u)
          : D.imagenProyecto(datos.proyecto, datos.unidades));
      }
    }
  } catch (e) {
    console.error('og:', req.url, e);
    imagen = marca();
    cache = CACHE_FALLA;
    falla = String((e && e.message) || e);
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', cache);
  // Para diagnosticar con curl sin abrir los logs de Vercel: qué falló
  // cuando la imagen es la de marca por una falla (sin datos sensibles).
  if (falla) res.setHeader('X-Og-Falla', falla.replace(/[^\x20-\x7e]/g, '?').slice(0, 300));
  res.end(imagen);
}
