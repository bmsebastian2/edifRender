// Íconos de amenities, compartidos por index.html (la grilla del visor) y
// admin.html (el selector de la pestaña Amenities). amenities.icono guarda
// la clave; sin clave, o con una que no está acá, va el genérico: nunca un
// hueco ni un error. Son genéricos a propósito, sirven para cualquier
// edificio. Sumar uno es una entrada nueva acá, sin migración (la columna
// no tiene check, ver supabase-migration-amenities-iconos.sql).
//
// Mismo trazo que el resto de los íconos del visor: 24×24, línea de 1,6,
// puntas redondeadas, color = currentColor.
const ICONOS_AMENITY = {
  piscina: {
    nombre: 'Piscina',
    trazo: '<path d="M7.5 15.5V6a1.8 1.8 0 0 1 1.8-1.8M15 15.5V6a1.8 1.8 0 0 1 1.8-1.8M7.5 8.5H15M7.5 12H15"/>' +
      '<path d="M3 19c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/>'
  },
  gimnasio: {
    nombre: 'Gimnasio',
    trazo: '<rect x="5" y="7" width="3" height="10" rx="1"/><rect x="16" y="7" width="3" height="10" rx="1"/>' +
      '<path d="M8 12h8M3 10v4M21 10v4"/>'
  },
  parrillero: {
    nombre: 'Parrillero',
    trazo: '<path d="M4 10h16a8 8 0 0 1-16 0z"/><path d="M8.2 16.9L6.5 21M15.8 16.9l1.7 4.1M12 18v3"/>' +
      '<path d="M9 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3M15 3.5c-.8 1 .8 2 0 3"/>'
  },
  laundry: {
    nombre: 'Laundry / lavadero',
    trazo: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 7.5h16M7 5.25h.01M9.5 5.25h.01"/>' +
      '<circle cx="12" cy="14" r="4.2"/><path d="M9.6 14.6c.8-.6 1.6-.6 2.4 0s1.6.6 2.4 0"/>'
  },
  bicicletero: {
    nombre: 'Bicicletero',
    trazo: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/>' +
      '<path d="M6 16l3-6.5h7L18 16M6 16h5.5L16 9.5M9 9.5l2.5 6.5M9 9.5V7.5M7.5 7.5h3M16 9.5l-.8-3h2"/>'
  },
  eventos: {
    nombre: 'Sala de eventos / SUM',
    trazo: '<g transform="rotate(8 7.5 19)"><path d="M5.3 4h4.4v3a2.2 2.2 0 0 1-4.4 0zM7.5 9.2V19M5.5 19h4"/></g>' +
      '<g transform="rotate(-8 16.5 19)"><path d="M14.3 4h4.4v3a2.2 2.2 0 0 1-4.4 0zM16.5 9.2V19M14.5 19h4"/></g>'
  },
  solarium: {
    nombre: 'Solárium',
    trazo: '<circle cx="7" cy="7" r="2.4"/>' +
      '<path d="M7 2.6v.9M7 10.5v.9M2.6 7h.9M10.5 7h.9M3.9 3.9l.6.6M9.5 9.5l.6.6M3.9 10.1l.6-.6M9.5 4.5l.6-.6"/>' +
      '<path d="M3 16h11l4.5-6M5 16v3.5M13 16v3.5"/>'
  },
  coworking: {
    nombre: 'Coworking',
    trazo: '<rect x="4.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 19h19M10 15.5l-.5 3.5M14 15.5l.5 3.5"/>'
  },
  seguridad: {
    nombre: 'Seguridad',
    trazo: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>'
  },
  infantil: {
    nombre: 'Juegos infantiles',
    trazo: '<path d="M3 21L6 4h12l3 17M10 4v10M14 4v10M9 14h6"/>'
  },
  carga: {
    nombre: 'Carga eléctrica',
    trazo: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>'
  },
  terraza: {
    nombre: 'Terraza / jardín',
    trazo: '<path d="M7 15h10l-1.2 6H8.2zM12 15V8"/>' +
      '<path d="M12 11c-3 0-5-2-5-5 3 0 5 2 5 5zM12 9c0-3 2-5 5-5 0 3-2 5-5 5z"/>'
  },
  estar: {
    nombre: 'Sala de estar',
    trazo: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/>' +
      '<path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM5 18v2M19 18v2"/>'
  },
  wifi: {
    nombre: 'Wifi',
    trazo: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/>' +
      '<circle cx="12" cy="19.5" r="1.1" fill="currentColor" stroke="none"/>'
  },
};

// Destello de cuatro puntas: "algo que tiene el edificio", sin decir qué.
const ICONO_AMENITY_GENERICO = '<path d="M12 4c.7 4.4 3.6 7.3 8 8-4.4.7-7.3 3.6-8 8-.7-4.4-3.6-7.3-8-8 4.4-.7 7.3-3.6 8-8z"/>';

function tieneIconoAmenity(clave) {
  return typeof clave === 'string' && Object.hasOwn(ICONOS_AMENITY, clave);
}

// Markup del ícono. Seguro para innerHTML: la clave solo elige una entrada
// del catálogo, nunca se escribe en el resultado.
function svgAmenity(clave, tam = 24) {
  const trazo = tieneIconoAmenity(clave) ? ICONOS_AMENITY[clave].trazo : ICONO_AMENITY_GENERICO;
  return '<svg width="' + tam + '" height="' + tam + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + trazo + '</svg>';
}

// Solo para el admin: preselecciona un ícono al dar de alta una amenity a
// partir de su texto. Lo confirma una persona; el visor nunca adivina (sin
// amenities.icono muestra el genérico). El orden importa: lo más específico
// primero ("Juegos para niños en la terraza" es infantil, no terraza).
const PISTAS_AMENITY = [
  ['piscina', /piscina|pileta|natatorio/],
  ['parrillero', /parrill|barbacoa|asador|fogon|quincho/],
  ['gimnasio', /gimnasio|\bgym\b|fitness/],
  ['bicicletero', /bicicl|\bbicis?\b/],
  ['laundry', /lavander|lavadero|laundry/],
  ['infantil', /infantil|ninos|playroom|juegos|kids/],
  ['carga', /vehiculos? electric|carga electric|cargador/],
  ['seguridad', /seguridad|cctv|vigilancia|camaras|porteria|cerradura/],
  ['coworking', /co-?work/],
  ['solarium', /solarium/],
  ['eventos', /\bsum\b|salon|eventos|fiestas|usos multiples/],
  ['estar', /sala de estar|lounge|living/],
  ['wifi', /wi-?fi|internet/],
  ['terraza', /terraza|jardin|patio|deck|espacio publico/],
];
function sugerirIconoAmenity(texto) {
  const t = (texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pista = PISTAS_AMENITY.find(([, re]) => re.test(t));
  return pista ? pista[0] : '';
}
