    /* ============================================================
       1. DATOS — vienen de Supabase (tablas `public_units`/`public_projects`/
       `public_settings`/`public_amenities`, filtradas por proyecto). El estado
       se edita desde admin.html; acá solo se lee.
       ============================================================ */

    const ESTADOS = {
      // opacidad: la del volumen en la escena. El color de marca queda
      // reservado para lo disponible; lo vendido va en gris casi
      // transparente (con media torre vendida, un rojo dominaba la escena y
      // comunicaba lo contrario a lo que se quiere vender). sin_dato NO va
      // tenue: en ROSSO son 64 de 78 unidades y el edificio quedaría
      // fantasma — es un gris neutro que sigue leyéndose como volumen.
      // plural / singular: la etiqueta corta de la píldora de mobile ("13
      // disponibles"); sin singular se usa el nombre en minúscula.
      disponible: { nombre: 'Disponible', plural: 'disponibles', color: '#2B6656', opacidad: 0.94 },
      // En alquiler: oferta vigente igual que disponible, en un verde salvia
      // más claro que el de venta (precio en u.precioAlquiler, UYU por mes).
      alquiler: { nombre: 'En alquiler', plural: 'en alquiler', color: '#86AC9F', opacidad: 0.86 },
      reservado: { nombre: 'Reservada', plural: 'reservadas', color: '#D2A24C', opacidad: 0.86 },
      vendido: { nombre: 'Vendida', plural: 'vendidas', color: '#B9BEBC', opacidad: 0.34 },
      sin_dato: { nombre: 'Sin estado público', plural: 'a consultar', singular: 'a consultar', color: '#9AA19E', opacidad: 0.62 },
    };
    function esAlquiler(u) {
      return u.estado === 'alquiler';
    }
    // Lo que se puede tomar hoy, por venta o por alquiler (cifra del riel de pisos).
    function esOfertable(u) {
      return u.estado === 'disponible' || u.estado === 'alquiler';
    }
    function aspectoDe(u) {
      return ESTADOS[u.estado] || ESTADOS.sin_dato;
    }

    // Qué edificio mostrar: primero un path bonito (/rosso, vía un rewrite de
    // Vercel que todavía no existe pero deja la puerta abierta), después
    // ?p=<slug>, y si no hay ninguno de los dos, ROSSO — así el link que ya
    // está en manos del cliente (sin querystring) no se rompe.
    // El script del poster (en el <head>) repite esta regla para elegir la
    // imagen antes de que corra este script: si cambia acá, cambiarla ahí.
    const DEFAULT_SLUG = 'rosso';
    function resolverSlug() {
      const porPath = location.pathname.replace(/^\/|\/$/g, '');
      if (porPath && porPath.toLowerCase() !== 'index.html') return porPath;
      const porQuery = new URLSearchParams(location.search).get('p');
      return porQuery || DEFAULT_SLUG;
    }
    const SLUG = resolverSlug();
    document.getElementById('admin-link').href = 'admin.html?p=' + encodeURIComponent(SLUG);

    // fetch() no tiene timeout propio: una conexión que cuelga en vez de
    // fallar (wifi caído, Supabase sin responder) deja al visitante mirando
    // el ícono de carga para siempre. abortSignal corta cada consulta a los
    // TIMEOUT_MS y eso se propaga como error, así el overlay pasa a mostrar
    // "error de red + reintentar" en vez de girar sin fin.
    const TIMEOUT_MS = 15000;
    function timeoutSignal() {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), TIMEOUT_MS);
      return controller.signal;
    }

    // Unidades, tipologías y su media: las pide cargarProyecto() y las vuelve
    // a pedir refrescarDatos() (en iniciar).
    function consultaUnidades(projectId) {
      return sb.from('public_units').select('*').eq('project_id', projectId).order('id').abortSignal(timeoutSignal());
    }
    function consultaMediaTipologias(projectId) {
      return sb.from('public_media').select('*').eq('project_id', projectId).eq('scope', 'typology').order('orden').abortSignal(timeoutSignal());
    }
    // select('*') y no ('id, nombre_publico'): sin supabase-migration-nombre-publico.sql
    // la columna no existe y pedirla por nombre haría fallar la consulta.
    function consultaTipologias(projectId) {
      return sb.from('public_typologies').select('*').eq('project_id', projectId).order('id').abortSignal(timeoutSignal());
    }

    async function cargarProyecto() {
      let proyecto, eProyecto;
      try {
        ({ data: proyecto, error: eProyecto } = await sb
          .from('public_projects').select('*').eq('slug', SLUG).abortSignal(timeoutSignal()).maybeSingle());
      } catch (e) { eProyecto = e; }
      // Dos causas muy distintas de "no hay proyecto": eProyecto es un error
      // real (red caída, Supabase no responde) — mensaje con reintentar. Sin
      // error pero proyecto null es un slug que genuinamente no existe o no
      // está publicado — mensaje amable, sin reintentar (reintentar no va a
      // cambiar nada).
      if (eProyecto) return { error: 'red' };
      if (!proyecto) return { error: 'no-encontrado' };

      let unidades, eUnidades, settings, amenities, renders, mediaTipologias, tipologias, pais, hitosObra, fotosObra;
      try {
        ([{ data: unidades, error: eUnidades }, { data: settings }, { data: amenities }, { data: renders }, { data: mediaTipologias }, { data: tipologias }, { data: pais }, { data: hitosObra }, { data: fotosObra }] = await Promise.all([
          consultaUnidades(proyecto.id),
          sb.from('public_settings').select('*').eq('project_id', proyecto.id).abortSignal(timeoutSignal()).maybeSingle(),
          sb.from('public_amenities').select('*').eq('project_id', proyecto.id).order('orden').abortSignal(timeoutSignal()),
          sb.from('public_media').select('*').eq('project_id', proyecto.id).eq('scope', 'project').eq('tipo', 'render').order('orden').abortSignal(timeoutSignal()),
          consultaMediaTipologias(proyecto.id),
          // Solo por nombre_publico (tipologiaDe()); si falla, el visor sigue
          // con geom.tipologia o los dormitorios.
          consultaTipologias(proyecto.id),
          // La hora del simulador solar sale de acá, nunca del navegador del
          // visitante (ver CLAUDE.md). `paises` es de lectura pública directa.
          sb.from('paises').select('tz_offset_horas').eq('codigo', proyecto.pais).abortSignal(timeoutSignal()).maybeSingle(),
          // Vacío si avance_habilitado está apagado (la vista pública ya filtra
          // por eso) — no hace falta pedir proyecto.avance_habilitado aparte.
          sb.from('public_obra_hitos').select('*').eq('project_id', proyecto.id).order('orden').abortSignal(timeoutSignal()),
          sb.from('public_obra_fotos').select('*').eq('project_id', proyecto.id).order('fecha', { ascending: false }).abortSignal(timeoutSignal()),
        ]));
      } catch (e) { eUnidades = e; }
      if (eUnidades || !unidades) return { error: 'red' };

      return {
        proyecto,
        tzOffsetHoras: pais ? pais.tz_offset_horas : 0,
        settings: settings || { instagram: '', youtube: '', sitio_web: '', whatsapp: '', textos: {}, financiacion: {} },
        amenities: amenities || [],
        renders: renders || [],
        mediaTipologias: mediaTipologias || [],
        tipologias: tipologias || [],
        hitosObra: hitosObra || [],
        fotosObra: fotosObra || [],
        unidades: unidades.map(normalizarUnidad),
      };
    }

    // Una fila de public_units → la unidad que usa el visor. Función con
    // nombre a propósito: scripts/generar-compartido.mjs la copia a
    // api/_compartido.js para que la vista previa al compartir lea los
    // estados igual que el visor.
    function normalizarUnidad(r) {
      // Transición: antes de supabase-brusco-alquiler.sql las de alquiler
      // venían como estado = 'sin_dato' + geom.operacion = 'alquiler' +
      // geom.precio_alquiler_uyu. Se normalizan acá, en un solo lugar, para
      // que el resto del visor solo conozca estado = 'alquiler'. Se puede
      // sacar cuando ninguna unidad quede con geom.operacion = 'alquiler'
      // y estado 'sin_dato'.
      const alquilerViejo = r.estado === 'sin_dato' && !!r.geom && r.geom.operacion === 'alquiler';
      const precioAlquiler = r.precio_alquiler != null ? r.precio_alquiler
        : alquilerViejo ? r.geom.precio_alquiler_uyu : null;
      return {
        id: r.id, piso: r.piso, pos: r.pos, col: Number(r.col), frente: r.frente,
        // m2/precio null (unidad cargada sin dato todavía, p.ej. BRUSCO) quedan
        // en null — Number(null) daría 0 y se mostraría "0 m²" / "$0".
        dorms: r.dorms, m2: r.m2 != null ? Number(r.m2) : null, orient: r.orientacion,
        precio: r.precio != null ? Number(r.precio) : null,
        // UYU por mes, siempre UYU (no la moneda del proyecto).
        precioAlquiler: precioAlquiler != null ? Number(precioAlquiler) : null,
        estimado: r.estimado, estado: alquilerViejo ? 'alquiler' : r.estado,
        m2Terraza: r.m2_terraza != null ? Number(r.m2_terraza) : null,
        cocheraPrecio: r.cochera_precio != null ? Number(r.cochera_precio) : null,
        geom: r.geom || null,
        typologyId: r.typology_id || null,
      };
    }

    // Versión corta de lo que muestra la vista previa al compartir (estado,
    // precios y si son estimados) de una lista de unidades — la unidad, o el
    // proyecto entero. Va como &v= en los links que se comparten: WhatsApp y
    // Facebook guardan la vista previa por URL, así que si algo cambia el link
    // nuevo trae una vista previa nueva. El visor ignora v= al abrir un link.
    // FNV-1a de 32 bits en base 36. scripts/generar-compartido.mjs la copia a
    // api/_compartido.js: el visor y la tarjeta calculan exactamente lo mismo.
    // Entra el valor, no cómo vino guardado: 136673, "136673" y "136673.00" son
    // el mismo precio; null, '' y undefined son "sin precio"; estimado cuenta
    // solo si es true (null, false y '' son lo mismo: no se muestra).
    function versionCompartir(unidades) {
      const numero = x => x == null || x === '' || !isFinite(Number(x)) ? '' : String(Number(x));
      let h = 0x811c9dc5;
      for (const u of unidades) {
        const clave = [u.id, u.estado || '', numero(u.precio), numero(u.precioAlquiler), u.estimado === true ? 1 : 0];
        for (const c of clave.join('|') + ';') h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
      }
      return h.toString(36);
    }

    function formatoMoneda(moneda, locale) {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: moneda, maximumFractionDigits: 0 });
    }
    function formatearPrecio(valor, moneda, locale) {
      return formatoMoneda(moneda, locale).format(valor);
    }
    // m² con el separador decimal del locale ("56,3" en es-UY, no "56.3").
    function formatearM2(valor, locale) {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(valor);
    }

    // Número de venta que ve el visitante. u.id sigue siendo la clave (?u=,
    // leads, events); geom.numero existe cuando el id no es presentable —
    // p.ej. BRUSCO, donde Torre B repite números y su id es 10000 + número.
    function numeroDe(u) {
      return u.geom && u.geom.numero ? u.geom.numero : u.id;
    }

    // public_typologies → { typology_id: nombre_publico }, solo las que tienen
    // uno cargado. Sin supabase-migration-nombre-publico.sql la columna no
    // viene y queda vacío. Lo usa tipologiaDe().
    function nombresPublicosDe(tipologias) {
      const nombres = {};
      (tipologias || []).forEach(t => {
        const n = typeof t.nombre_publico === 'string' ? t.nombre_publico.trim() : '';
        if (n) nombres[t.id] = n;
      });
      return nombres;
    }

    // Nombre de tipología que ve el comprador, en este orden:
    // 1. typologies.nombre_publico de la tipología asignada (nombresPublicos,
    //    de nombresPublicosDe()). typologies.nombre NO: es el rótulo interno
    //    del admin ("MONO-A", "1D-frente-A").
    // 2. geom.tipologia de la unidad ("Estudio", "Flex"...), también con
    //    typology_id: asignar una tipología por su planta no puede cambiar
    //    "Estudio", la palabra con la que se vende, por "Monoambiente".
    // 3. null = mostrar los dormitorios.
    function tipologiaDe(u, nombresPublicos) {
      const publico = u.typologyId && nombresPublicos ? nombresPublicos[u.typologyId] : null;
      return publico || (u.geom && u.geom.tipologia ? u.geom.tipologia : null);
    }

    // Torre de la unidad en proyectos con geometria.torres (null si no tiene).
    function torreDe(u) {
      return u.geom && u.geom.torre ? u.geom.torre : null;
    }

    // Envolvente convexa (cadena monótona de Andrew) de una lista de puntos
    // [x, z]. La usa la losa por torre: la unión exacta de los contornos
    // deja huecos de pasillo entre unidades; la envolvente se lee como placa.
    function envolventeConvexa(pts) {
      const p = pts.map(([x, z]) => [x, z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (p.length < 3) return p;
      const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const abajo = [], arriba = [];
      p.forEach(q => {
        while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], q) <= 0) abajo.pop();
        abajo.push(q);
      });
      for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], q) <= 0) arriba.pop();
        arriba.push(q);
      }
      return abajo.slice(0, -1).concat(arriba.slice(0, -1));
    }

    // Agranda un polígono convexo `d` metros hacia afuera (cada vértice se
    // corre por la bisectriz de sus dos aristas) — la losa asoma un poco
    // más allá de las unidades, como en las placas de ROSSO/Altamira.
    function expandirConvexo(pts, d) {
      const n = pts.length;
      const sentido = areaConSigno(pts) > 0 ? 1 : -1;
      const normal = (a, b) => {
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        return [sentido * dz / l, -sentido * dx / l];
      };
      return pts.map((q, i) => {
        const n1 = normal(pts[(i - 1 + n) % n], q), n2 = normal(q, pts[(i + 1) % n]);
        const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
        return [q[0] + (n1[0] + n2[0]) * k, q[1] + (n1[1] + n2[1]) * k];
      });
    }

    /* ============================================================
       SOL — posición solar por trigonometría esférica estándar (Spencer/
       Cooper: ángulo del día, ecuación del tiempo, declinación, ángulo
       horario). Sin librería nueva (CDN solo permite cdnjs/jsdelivr/
       tailwind/jquery). Funciones puras, sin THREE ni DOM, para poder
       validarlas sueltas contra tablas de amanecer/atardecer publicadas
       antes de conectarlas a la escena — ver CLAUDE.md.
       No hay rama especial para el hemisferio norte: el signo de `lat` y
       de la declinación ya resuelven Managua solo. `fecha` siempre en UTC
       (Date.UTC / string ISO de <input type=date>) y `minutosLocales`/
       `tzOffsetHoras` en la hora de reloj del PROYECTO, nunca la del
       navegador de quien mira la página.
       ============================================================ */
    function diaDelAnio(fecha) {
      const inicioAnio = Date.UTC(fecha.getUTCFullYear(), 0, 1);
      const hoyUTC = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
      return Math.round((hoyUTC - inicioAnio) / 86400000) + 1;
    }

    function anguloDelDia(fecha) {
      const anio = fecha.getUTCFullYear();
      const bisiesto = (anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0));
      return 2 * Math.PI * (diaDelAnio(fecha) - 1) / (bisiesto ? 366 : 365);
    }

    function ecuacionDelTiempo(g) { // minutos
      return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
        - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    }

    function declinacionSolar(g) { // radianes
      return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
        - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
        - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    }

    // Azimut (grados, 0-360 en sentido horario desde el norte geográfico) y
    // altura (grados, negativa = bajo el horizonte) del sol para una
    // latitud/longitud/fecha/hora dadas.
    function posicionSolar(lat, lon, tzOffsetHoras, fecha, minutosLocales) {
      const g = anguloDelDia(fecha);
      const eqt = ecuacionDelTiempo(g);
      const decl = declinacionSolar(g);
      const latRad = lat * Math.PI / 180;

      const offsetMin = eqt + 4 * lon - 60 * tzOffsetHoras;
      const horaSolarVerdadera = ((minutosLocales + offsetMin) % 1440 + 1440) % 1440;
      const haRad = (horaSolarVerdadera / 4 - 180) * Math.PI / 180;

      const sinAlt = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(haRad);
      const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
      const altitud = altRad * 180 / Math.PI;

      let cosAz = (Math.sin(decl) - Math.sin(latRad) * sinAlt) / (Math.cos(latRad) * Math.cos(altRad));
      cosAz = Math.max(-1, Math.min(1, cosAz));
      let azimut = Math.acos(cosAz) * 180 / Math.PI;
      if (haRad > 0) azimut = 360 - azimut;

      return { altitud, azimut };
    }

    // Amanecer/atardecer del día (minutos de hora local, reloj del
    // proyecto) — acota el slider a "del amanecer al atardecer", como pide
    // el brief. Devuelve null si ese día no amanece o no anochece en esa
    // latitud (no pasa en UY/NI, pero mejor no dividir por un NaN si algún
    // día se carga un proyecto cerca de un polo).
    function horarioSolar(lat, lon, tzOffsetHoras, fecha) {
      const g = anguloDelDia(fecha);
      const eqt = ecuacionDelTiempo(g);
      const decl = declinacionSolar(g);
      const latRad = lat * Math.PI / 180;
      const cosHa0 = -Math.tan(latRad) * Math.tan(decl);
      if (cosHa0 <= -1 || cosHa0 >= 1) return null;
      const ha0Deg = Math.acos(cosHa0) * 180 / Math.PI;
      const medioDiaSolar = 720 - 4 * lon - eqt + 60 * tzOffsetHoras;
      return {
        amanecer: Math.round(medioDiaSolar - ha0Deg * 4),
        atardecer: Math.round(medioDiaSolar + ha0Deg * 4),
      };
    }

    // Dirección unitaria (en el sistema de coordenadas del modelo, ver
    // CLAUDE.md) desde el edificio HACIA el sol. norteGrados es el rumbo
    // (0-360, horario desde el norte real) de la FACHADA AL FRENTE — el
    // lado que da a la calle (eje -Z) — no el contrafrente: es el dato que
    // cualquiera lee de un mapa mirando hacia dónde da la calle, nadie mide
    // "hacia dónde mira la parte de atrás". El contrafrente (+Z) mira
    // entonces a norteGrados+180.
    //
    // Visto desde arriba con -Z hacia arriba de la pantalla, three.js deja +X
    // a la DERECHA: si -Z mira al rumbo N, +X mira a N+90 (horario). Un rumbo
    // relativo r = azimut - N cae entonces en (sin r, -cos r). Antes esto
    // devolvía (-sin r, -cos r): frente y contrafrente bien, pero los
    // laterales invertidos — el sol de la mañana entraba por la fachada del
    // oeste. calcularFachadas() usa esta misma convención (RUMBO_LADO).
    function direccionSolModelo(altitud, azimut, norteGrados) {
      const altRad = altitud * Math.PI / 180;
      const r = (azimut - norteGrados) * Math.PI / 180;
      return new THREE.Vector3(
        Math.cos(altRad) * Math.sin(r),
        Math.sin(altRad),
        -Math.cos(altRad) * Math.cos(r)
      );
    }

    // ---- Fachadas y asoleamiento por unidad -------------------------------
    // Solo para proyectos con geometria.calles (hoy BRUSCO) y contornos
    // reales: con eso se puede decir a qué calle da cada unidad sin
    // adivinar. Criterio (ver chat del 2026-09-29, validado a mano contra
    // los 172 contornos):
    //   · La "manzana" es la caja envolvente de todos los contornos del
    //     proyecto. Un lado de una unidad da a una calle solo si su normal
    //     hacia afuera apunta a ese borde (±45°) y está a <= FACHADA_MARGEN
    //     de él (los retiros/balcones medidos van de 1 a 3 m).
    //   · Se suman los metros por calle (los contornos tienen quiebres de
    //     menos de 1 m que partirían una misma fachada); la principal es la
    //     de más metros, y una segunda calle cuenta desde FACHADA_MIN metros
    //     (esquinas reales sí, quiebres chicos no).
    //   · Sin ningún lado a una calle → "interior de manzana", sin inventar
    //     orientación: sin núcleos/pasillos cargados no hay forma confiable
    //     de distinguir el lado al patio del lado al pasillo.
    //   · units.geom.fachadas (p.ej. ["norte"] o [] = interior) pisa el
    //     cálculo — para corregir a mano lo que la tabla de control marque.
    //   · units.orientacion (texto libre, ROSSO) gana sobre todo lo anterior.
    const FACHADA_MARGEN = 3.5, FACHADA_MIN = 2;
    const DIR_LADO = { '-z': [0, -1], '+x': [1, 0], '+z': [0, 1], '-x': [-1, 0] };
    const RUMBO_LADO = { '-z': 0, '+x': 90, '+z': 180, '-x': 270 }; // + norte_grados
    const CARDINALES = ['norte', 'este', 'sur', 'oeste'];
    const RUMBO_CARDINAL = { norte: 0, este: 90, sur: 180, oeste: 270 };
    const cardinalDe = rumbo => CARDINALES[Math.round((((rumbo % 360) + 360) % 360) / 90) % 4];

    // Devuelve Map id -> [{ cardinal, rumbo, calle, metros }] (principal
    // primero; [] = interior de manzana), o null si el proyecto no aplica.
    function calcularFachadas(unidades, geometria) {
      const calles = geometria && geometria.calles;
      const norte = geometria && geometria.norte_grados;
      if (!calles || norte == null) return null;
      const conContorno = unidades.filter(u => u.geom && Array.isArray(u.geom.contorno) && u.geom.contorno.length >= 3);
      if (!conContorno.length) return null;
      const pts = conContorno.flatMap(u => u.geom.contorno);
      const borde = {
        '-x': Math.min(...pts.map(p => p[0])), '+x': Math.max(...pts.map(p => p[0])),
        '-z': Math.min(...pts.map(p => p[1])), '+z': Math.max(...pts.map(p => p[1])),
      };
      const distBorde = (lado, [x, z]) => lado[0] === '-'
        ? (lado[1] === 'x' ? x - borde[lado] : z - borde[lado])
        : (lado[1] === 'x' ? borde[lado] - x : borde[lado] - z);
      const fachada = (cardinal, metros) => ({
        cardinal, rumbo: RUMBO_CARDINAL[cardinal], calle: calles[cardinal] || null, metros,
      });

      const res = new Map();
      for (const u of unidades) {
        if (u.geom && Array.isArray(u.geom.fachadas)) {
          res.set(u.id, u.geom.fachadas.filter(c => c in RUMBO_CARDINAL).map(c => fachada(c, null)));
          continue;
        }
        if (!conContorno.includes(u)) continue;
        let p = u.geom.contorno;
        if (areaConSigno(p) < 0) p = [...p].reverse(); // así la normal (dz, -dx) apunta afuera
        const metros = {};
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (L < 0.3) continue;
          const n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
          const medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          for (const lado in DIR_LADO) {
            const coseno = n[0] * DIR_LADO[lado][0] + n[1] * DIR_LADO[lado][1];
            if (coseno > Math.SQRT1_2 && distBorde(lado, medio) <= FACHADA_MARGEN) {
              metros[lado] = (metros[lado] || 0) + L * coseno;
            }
          }
        }
        res.set(u.id, Object.entries(metros)
          .filter(([, m]) => m >= FACHADA_MIN)
          .sort((x, y) => y[1] - x[1])
          .map(([lado, m]) => fachada(cardinalDe(norte + RUMBO_LADO[lado]), m)));
      }
      return res;
    }

    // Franjas (minutos locales, reloj del proyecto) en que el sol está sobre
    // el horizonte y del lado de la fachada (a menos de 90° de su normal).
    // Geométrico: no sabe de edificios vecinos ni de la otra torre. Las
    // franjas de menos de FRANJA_MIN_MINUTOS se descartan: cerca de los
    // equinoccios una fachada sur "recibe" 15 minutos de sol rasante al
    // amanecer, que en la práctica tapa cualquier cosa y leído en el panel
    // parece un error.
    const FRANJA_MIN_MINUTOS = 30;
    function franjasSolFachada(lat, lon, tzOffsetHoras, fecha, rumbo) {
      const h = horarioSolar(lat, lon, tzOffsetHoras, fecha);
      if (!h) return { horario: null, franjas: [] };
      const franjas = [];
      let inicio = null;
      for (let m = h.amanecer; m <= h.atardecer; m++) {
        const { altitud, azimut } = posicionSolar(lat, lon, tzOffsetHoras, fecha, m);
        const da = altitud > 0 && Math.cos((azimut - rumbo) * Math.PI / 180) > 0;
        if (da && inicio == null) inicio = m;
        if (!da && inicio != null) { franjas.push([inicio, m]); inicio = null; }
      }
      if (inicio != null) franjas.push([inicio, h.atardecer]);
      return { horario: h, franjas: franjas.filter(([a, b]) => b - a >= FRANJA_MIN_MINUTOS) };
    }

    // Sesión anónima persistida en este navegador — sin esto no se puede
    // distinguir un visitante de treinta clics de treinta visitantes distintos.
    // origen (?src=) queda pegado a la sesión desde el primer touch (atribución
    // de la primera visita, no de la última).
    function obtenerSesion() {
      try {
        let s = localStorage.getItem('cota_sesion');
        if (!s) { s = crypto.randomUUID(); localStorage.setItem('cota_sesion', s); }
        return s;
      } catch { return crypto.randomUUID(); }
    }
    function obtenerOrigen() {
      try {
        const porURL = new URLSearchParams(location.search).get('src');
        if (porURL) {
          const limpio = porURL.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
          if (limpio) localStorage.setItem('cota_origen', limpio);
        }
        return localStorage.getItem('cota_origen') || null;
      } catch { return null; }
    }

    // Deja constancia de que alguien abrió esta unidad — alimenta las
    // estadísticas de demanda del panel interno. No bloquea la demo si falla.
    function registrarEvento(projectId, unitId) {
      sb.from('events').insert({
        project_id: projectId, unit_id: unitId, tipo: 'click',
        sesion: obtenerSesion(), origen: obtenerOrigen(),
      }).then(({ error }) => {
        if (error) console.warn('No se pudo registrar el evento', error);
      });
    }

    // Qué porcentaje de entrega elige la gente en el simulador de
    // financiación — misma base de demanda que registrarEvento(), separada
    // por tipo para no mezclarse con los clics simples (ver admin.html).
    function registrarEventoSimulacion(projectId, unitId, pctEntrega) {
      sb.from('events').insert({
        project_id: projectId, unit_id: unitId, tipo: 'simulacion', pct_entrega: pctEntrega,
        sesion: obtenerSesion(), origen: obtenerOrigen(),
      }).then(({ error }) => {
        if (error) console.warn('No se pudo registrar la simulación', error);
      });
    }

    // URL pública de la demo. Se usa como fallback para compartir y en los
    // links por unidad, para cuando la página se sirve desde about:srcdoc.
    const BASE = 'https://armadoporcota.vercel.app/';

    function pintarRedes(settings) {
      for (const [id, url] of [['red-instagram', settings.instagram], ['red-youtube', settings.youtube], ['red-web', settings.sitio_web]]) {
        if (!url) continue;
        const a = document.getElementById(id);
        a.href = url;
        a.hidden = false;
      }
    }

    // Mobile (≤640): las redes, compartir y la firma de Cota van en un menú
    // (⋯) que cuelga del header. Se cierra al elegir algo, con un toque
    // afuera o con Escape; en desktop la clase no tiene efecto.
    const bsDer = document.querySelector('.bs-der');
    const btnMas = document.getElementById('bs-mas');
    function menuRedes(abierto) {
      bsDer.classList.toggle('menu-abierto', abierto);
      btnMas.setAttribute('aria-expanded', String(abierto));
    }
    btnMas.addEventListener('click', () => menuRedes(!bsDer.classList.contains('menu-abierto')));
    document.getElementById('cabezal-utilidades').addEventListener('click', e => {
      if (e.target.closest('a, button')) menuRedes(false);
    });
    document.addEventListener('pointerdown', e => {
      if (bsDer.classList.contains('menu-abierto') && !bsDer.contains(e.target)) menuRedes(false);
    }, true);
    // En captura, como el ⓘ del panel: Esc cierra el menú y nada más.
    addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !bsDer.classList.contains('menu-abierto')) return;
      e.stopPropagation();
      menuRedes(false);
      btnMas.focus({ preventScroll: true });
    }, true);

    // Amenities: grilla de ícono + nombre, la misma en la hoja de la ficha y
    // en el panel de la unidad (quien entra por un link ?u= cae directo en
    // el panel, con la ficha plegada). El ícono sale de amenities.icono (ver
    // amenities-iconos.js); sin ícono asignado va el genérico. Sin amenities
    // no aparece nada: ni la fila de la ficha ni el bloque del panel. El
    // texto lo carga el cliente en el admin: va como texto, nunca como HTML.
    // En el panel van a lo sumo MAX_AMENITIES_PANEL (dos filas); con más,
    // "Ver todos" despliega el resto en el lugar.
    const MAX_AMENITIES_PANEL = 8;
    const verTodasAmenities = document.getElementById('p-amenities-todos');
    function desplegarAmenities(abiertas) {
      document.getElementById('p-amenities').classList.toggle('plegada', !abiertas);
      verTodasAmenities.setAttribute('aria-expanded', String(abiertas));
      verTodasAmenities.innerHTML = abiertas ? 'Ver menos' : 'Ver todos <span aria-hidden="true">→</span>';
    }
    verTodasAmenities.addEventListener('click', () =>
      desplegarAmenities(verTodasAmenities.getAttribute('aria-expanded') !== 'true'));

    function pintarAmenities(lista) {
      const hay = lista.length > 0;
      document.getElementById('cb-extra').hidden = !hay;
      document.getElementById('fc-amenities').hidden = !hay;
      document.getElementById('p-amenities-bloque').hidden = !hay;
      if (!hay) return;
      const grilla = () => lista.map(a => {
        const li = document.createElement('li');
        li.className = 'amenity';
        li.innerHTML = svgAmenity(a.icono);
        const nombre = document.createElement('span');
        nombre.textContent = a.texto;
        li.append(nombre);
        return li;
      });
      document.getElementById('ce-amenities').replaceChildren(...grilla());
      document.getElementById('p-amenities').replaceChildren(...grilla());
      const sobran = lista.length > MAX_AMENITIES_PANEL;
      verTodasAmenities.hidden = !sobran;
      desplegarAmenities(!sobran);
      // Fila de la ficha: hasta cuatro íconos distintos de muestra (el
      // genérico solo si no hay ninguno asignado) + cuántas son.
      const muestra = [...new Set(lista.map(a => a.icono).filter(tieneIconoAmenity))].slice(0, 4);
      document.getElementById('cb-amenities-iconos').innerHTML =
        (muestra.length ? muestra : [null]).map(k => svgAmenity(k, 16)).join('');
      for (const id of ['cb', 'fc']) {
        document.getElementById(id + '-amenities-n').textContent = lista.length;
        document.getElementById(id + '-amenities-pal').textContent = lista.length === 1 ? 'amenity' : 'amenities';
      }
      // Fila de la ficha desplegada (mobile): ícono + nombre corto. El texto
      // de cada amenity es libre y suele ser largo ("SUM con parrillero y
      // barbacoa abierta"): si pasa de 16 letras va el nombre del ícono en
      // el catálogo ("Parrillero", "Terraza / jardín" → "Terraza"); sin
      // ícono, el texto, cortado con "…" por CSS. Un texto todo en mayúsculas
      // (BRUSCO) pasa a mayúscula inicial. Sin repetir nombres.
      const etiquetaCorta = a => {
        const t = (a.texto || '').trim();
        const propia = t && t === t.toUpperCase() ? t[0] + t.slice(1).toLowerCase() : t;
        if (propia.length <= 16 || !tieneIconoAmenity(a.icono)) return propia;
        return ICONOS_AMENITY[a.icono].nombre.split(' / ')[0];
      };
      const vistas = new Set();
      document.getElementById('fc-amenities-fila').replaceChildren(...lista.flatMap(a => {
        const etiqueta = etiquetaCorta(a);
        if (!etiqueta || vistas.has(etiqueta.toLowerCase())) return [];
        vistas.add(etiqueta.toLowerCase());
        const li = document.createElement('li');
        li.innerHTML = svgAmenity(a.icono, 16);
        const nombre = document.createElement('span');
        nombre.textContent = etiqueta;
        li.append(nombre);
        return [li];
      }));
      document.getElementById('fc-amenities-fila').hidden = false;
    }
    // Tocar la fila abre la capa de amenities, como "N amenities" (el botón
    // de verdad, el que lee el lector de pantalla).
    document.getElementById('fc-amenities-fila').addEventListener('click', () =>
      document.getElementById('fc-amenities').click());

    // Varios eventos seguidos (resize, scroll) en una sola llamada por
    // cuadro, dentro del rAF: lo que mide lo hace una vez por cuadro, no una
    // por evento.
    function porCuadro(fn) {
      let pedido = 0;
      return () => {
        if (!pedido) pedido = requestAnimationFrame(() => { pedido = 0; fn(); });
      };
    }

    // Medida de la pantalla sin preguntársela a window: en Chrome de celular
    // leer innerWidth/innerHeight recalcula el layout si el DOM cambió, y en
    // iniciar() eran reflows forzados de la página entera (Lighthouse,
    // 2026-10-20: la cámara, CIELO_ALTA, rectLibre(), el contorno, el lienzo).
    // La anota un ResizeObserver sobre body (html y body van al 100 % con
    // overflow hidden: body mide la pantalla, y es lo que mide el lienzo),
    // que avisa después del layout, con la medida ya calculada. Cuando
    // arranca iniciar() ya avisó (antes hubo datos por red y el load); si no
    // (pestaña en segundo plano: sin cuadros no hay aviso), medirPantalla()
    // la lee de window una vez. El evento resize llega antes del layout y la
    // vería vieja: lo que la use al cambiar de tamaño va en un ResizeObserver
    // creado después de este (avisan en el orden en que se crearon), como
    // obsInterfaz.
    const pantalla = { ancho: 0, alto: 0 };
    new ResizeObserver(([e]) => {
      pantalla.ancho = Math.round(e.contentRect.width);
      pantalla.alto = Math.round(e.contentRect.height);
    }).observe(document.body);
    function medirPantalla() {
      if (!pantalla.ancho || !pantalla.alto) {
        pantalla.ancho = innerWidth;
        pantalla.alto = innerHeight;
      }
      return pantalla;
    }

    // Capa del edificio (#capa-edificio): las amenities a pedido desde la
    // ficha. Desktop: tarjeta debajo de la ficha. Mobile: hoja inferior.
    // Se cierra con ×, Escape o tocando cualquier cosa afuera (el edificio,
    // los botones de las otras hojas): así nunca quedan dos abiertas, sin
    // tener que tocar cada una. Tocar el edificio la cierra y sigue de
    // largo, como en el riel y Filtros: si era una unidad, la selecciona.
    const capaEdificio = document.getElementById('capa-edificio');
    const capaEsHoja = matchMedia('(max-width:860px)');
    let disparadorCapa = null;

    function capaAbierta() {
      return capaEdificio.classList.contains('abierta');
    }
    function ubicarCapaEdificio() {
      if (capaEsHoja.matches) {
        capaEdificio.style.top = capaEdificio.style.maxHeight = '';
        return;
      }
      // Primero todas las lecturas, después las escrituras: el borde derecho
      // de la capa no depende de su top, y medirlo después de cambiarlo
      // forzaba un segundo layout.
      const fichaR = document.getElementById('ficha').getBoundingClientRect();
      const barra = document.getElementById('barra-inferior').getBoundingClientRect();
      const derechaCapa = capaEdificio.getBoundingClientRect().right;
      const top = Math.round(fichaR.bottom + 10);
      // Hasta el borde de abajo; si la barra inferior pasa por esta columna
      // (tablet, o corrida a la izquierda), hasta ella.
      const piso = barra.left < derechaCapa ? barra.top - 10 : innerHeight - 20;
      capaEdificio.style.top = top + 'px';
      capaEdificio.style.maxHeight = Math.max(160, piso - top) + 'px';
    }
    function abrirCapaEdificio(seccion, disparador) {
      capaEdificio.dataset.seccion = seccion;
      disparadorCapa = disparador;
      ubicarCapaEdificio();
      capaEdificio.scrollTop = 0;
      capaEdificio.classList.add('abierta');
      disparador.setAttribute('aria-expanded', 'true');
      document.getElementById('ce-cerrar').focus({ preventScroll: true });
    }
    function cerrarCapaEdificio() {
      if (!capaAbierta()) return;
      capaEdificio.classList.remove('abierta');
      disparadorCapa.setAttribute('aria-expanded', 'false');
      if (capaEdificio.contains(document.activeElement)) disparadorCapa.focus({ preventScroll: true });
    }
    // Dos puertas: la fila de íconos (desktop, y la ficha desplegada en
    // mobile) y "N amenities" en el resumen plegado de mobile.
    for (const id of ['cb-amenities', 'fc-amenities']) {
      document.getElementById(id).addEventListener('click', e => {
        capaAbierta() && capaEdificio.dataset.seccion === 'amenities'
          ? cerrarCapaEdificio() : abrirCapaEdificio('amenities', e.currentTarget);
      });
    }
    document.getElementById('ce-cerrar').addEventListener('click', cerrarCapaEdificio);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarCapaEdificio(); });
    // En captura, como el cierre de la ficha: ningún stopPropagation lo frena.
    document.addEventListener('pointerdown', e => {
      if (!capaAbierta() || capaEdificio.contains(e.target) || disparadorCapa.contains(e.target)) return;
      cerrarCapaEdificio();
    }, true);
    addEventListener('resize', porCuadro(() => { if (capaAbierta()) ubicarCapaEdificio(); }));

    /* ------------------------------------------------------------
       Información del proyecto (ⓘ en la cabecera del panel): popover con el
       texto legal (settings.textos.legal) y la nota de demo. Se cierra con
       un toque afuera, con Esc o con el mismo ⓘ.
       ------------------------------------------------------------ */
    const infoBtn = document.getElementById('p-info-btn');
    const infoPop = document.getElementById('p-info');

    function pintarLegal(textos) {
      const legal = ((textos && textos.legal) || '').trim();
      const cont = document.getElementById('p-info-legal');
      cont.textContent = '';
      // Una oración por renglón: en ROSSO "Amparado por… (10 años)." y
      // "Desarrolla Block Desarrollos · …" son dos datos en un mismo texto.
      // Corta solo en punto + espacio + mayúscula: "(18.795)" y "S.A. ·
      // Proyecta" quedan enteros.
      legal.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/).filter(Boolean).forEach(oracion => {
        const p = document.createElement('p');
        p.textContent = oracion;
        cont.appendChild(p);
      });
      cont.hidden = !legal;
      // Título solo si el texto nombra la ley (no se inventa para un
      // proyecto que no es Vivienda Promovida).
      const ley = legal.match(/Vivienda Promovida\s*\((\d[\d.]*)\)/i);
      const tit = document.getElementById('p-info-tit');
      tit.textContent = ley ? 'Vivienda Promovida · Ley ' + ley[1] : '';
      tit.hidden = !ley;
      infoBtn.hidden = !legal && !document.getElementById('p-info-nota').textContent.trim();
    }

    function abrirInfo() {
      infoPop.hidden = false;
      infoBtn.setAttribute('aria-expanded', 'true');
      infoPop.focus({ preventScroll: true });
    }

    function cerrarInfo(devolverFoco) {
      if (infoPop.hidden) return;
      infoPop.hidden = true;
      infoBtn.setAttribute('aria-expanded', 'false');
      if (devolverFoco) infoBtn.focus({ preventScroll: true });
    }

    infoBtn.addEventListener('click', () => infoPop.hidden ? abrirInfo() : cerrarInfo());
    // En captura sobre window: con el popover abierto, Esc lo cierra a él y
    // no llega a los demás Esc (el de la unidad cerraría el panel entero).
    addEventListener('keydown', e => {
      if (e.key !== 'Escape' || infoPop.hidden) return;
      e.stopPropagation();
      cerrarInfo(true);
    }, true);
    document.addEventListener('pointerdown', e => {
      if (infoPop.hidden || infoPop.contains(e.target) || infoBtn.contains(e.target)) return;
      cerrarInfo();
    }, true);
    // El panel también se cierra solo (kiosco, ?u=…): el popover, con él.
    new MutationObserver(() => {
      if (!document.getElementById('panel').classList.contains('abierto')) cerrarInfo();
    }).observe(document.getElementById('panel'), { attributes: true, attributeFilter: ['class'] });

    // Reemplaza el overlay #carga (que ya está tapando toda la pantalla,
    // ver el div al principio del <body>) por un mensaje de error en vez de
    // desvanecerlo — nunca llega a mostrarse el edificio ni el header de
    // ningún proyecto. `conReintentar` prende el botón solo para fallas de
    // red/Supabase, donde reintentar tiene sentido; un slug inexistente no
    // lo necesita.
    function mostrarErrorCarga(msg, conReintentar) {
      const carga = document.getElementById('carga');
      carga.classList.remove('carga-oculta');
      carga.classList.add('carga-error-activo');
      // El error va sobre el degradé, no sobre la foto de un edificio.
      sinPoster();
      document.getElementById('carga-error-msg').textContent = msg;
      document.getElementById('carga-reintentar').hidden = !conReintentar;
    }

    // Variantes de Storage: las imágenes de Supabase Storage (portada, renders,
    // planos, fotos de obra) se piden por /render/image/ en la medida en que se
    // muestran, en WebP (Supabase lo elige por el Accept del navegador). Antes
    // bajaba el original: la portada, una franja de 72 px de alto, pesaba
    // ~310 KB y era lo que marcaba Lighthouse; un plano PNG, hasta 430 KB.
    // Usa las transformaciones de imagen de Supabase (plan Pro): si fallan
    // (400), respaldoOriginal() vuelve una vez al archivo tal cual. Ojo: con
    // solo `width`, el resize por defecto (cover) recorta en vez de achicar,
    // así que sin proporción va siempre resize=contain. Supabase no agranda:
    // pedir más que el original devuelve el original recodificado. Las mismas
    // medidas las mide scripts/assets/optimizar.mjs (npm run optimize:assets).
    const RE_STORAGE = /^(https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1)\/object\/public\/(.+)$/;
    const VARIANTES_STORAGE = {
      // Franja del header: 8:1, y 4:1 en el header compacto (≤640). Recorte
      // centrado, como el object-fit: cover de siempre.
      portada: { anchos: [640, 960, 1280, 1920], proporcion: 8, calidad: 70, sizes: '55vw' },
      portadaMovil: { anchos: [480, 720, 1080], proporcion: 4, calidad: 70, sizes: '60vw' },
      // Con portada_foco no se recorta: el encuadre lo da object-position.
      portadaFoco: { anchos: [640, 960, 1280, 1920], calidad: 70, sizes: '(max-width: 640px) 60vw, 55vw' },
      // Cabecera del panel: 180 px de alto por el ancho del panel
      // (--ancho-panel, clamp(400px, 37vw, 720px), escrito como media queries).
      cabecera: {
        anchos: [640, 800, 960, 1280, 1600], proporcion: 2.5, calidad: 75,
        sizes: '(max-width: 860px) 100vw, (max-width: 1081px) 400px, (max-width: 1946px) 37vw, 720px',
      },
      // Tarjeta del plano (columna derecha de #p-intro, contain).
      plano: {
        anchos: [400, 800, 1200], calidad: 85,
        sizes: '(max-width: 480px) calc(100vw - 76px), (max-width: 860px) calc(45vw - 60px), 300px',
      },
      // Fotos de obra: grilla de cuadrados de 120 px o más.
      miniatura: { anchos: [240, 480], proporcion: 1, calidad: 70, sizes: '(max-width: 480px) 33vw, 160px' },
    };
    function urlStorage(url, { ancho, alto, proporcion, calidad }) {
      const m = RE_STORAGE.exec(url);
      if (!m) return url;
      const p = new URLSearchParams();
      if (ancho) p.set('width', ancho);
      if (ancho && proporcion) {
        p.set('height', Math.round(ancho / proporcion));
        p.set('resize', 'cover');
      } else if (ancho) {
        if (alto) p.set('height', alto);
        p.set('resize', 'contain');
      }
      p.set('quality', calidad);
      return m[1] + '/render/image/public/' + m[2] + '?' + p;
    }
    // srcset + sizes de una variante; una URL que no es de Storage va tal cual.
    // dataset.original es la URL de la base: con ella se compara si cambió.
    function ponerImagenStorage(img, url, variante) {
      img.dataset.original = url;
      if (!RE_STORAGE.test(url)) {
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
        img.src = url;
        return;
      }
      img.sizes = variante.sizes;
      img.srcset = variante.anchos.map(a => urlStorage(url, { ...variante, ancho: a }) + ' ' + a + 'w').join(', ');
      img.src = urlStorage(url, { ...variante, ancho: variante.anchos[1] || variante.anchos[0] });
    }
    function sacarImagenStorage(img) {
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.removeAttribute('src');
      delete img.dataset.original;
    }
    // Para el 'error' de cada imagen: si falló una variante, vuelve una sola
    // vez al original (true); si ya era el original, false.
    function respaldoOriginal(img) {
      const original = img.dataset.original;
      if (!original || img.getAttribute('src') === original) return false;
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.src = original;
      return true;
    }
    // Lightbox: una sola URL, sin srcset. La imagen no tiene medida fija (su
    // caja es la medida natural topeada a 88vw × 82vh) y con srcset el
    // navegador la mostraría a otra escala. Se pide esa caja en px de
    // pantalla con resize=contain, en escalones (más aciertos de caché): una
    // foto vertical viene a la altura que se ve. Con zoom (el plano y los
    // renders de su tipología), la medida original; el plano, con más calidad.
    const ESCALONES_LIGHTBOX = [720, 1080, 1440, 1920, 2560];
    function urlLightbox(url, zoom, esPlano) {
      if (zoom) return urlStorage(url, { calidad: esPlano ? 90 : 80 });
      const dpr = window.devicePixelRatio || 1;
      const escalon = n => ESCALONES_LIGHTBOX.find(e => e >= n) || ESCALONES_LIGHTBOX[ESCALONES_LIGHTBOX.length - 1];
      return urlStorage(url, { ancho: escalon(innerWidth * 0.88 * dpr), alto: escalon(innerHeight * 0.82 * dpr), calidad: 80 });
    }

    // Lightbox genérico (una imagen a la vez, con flechas/teclado/contador):
    // lo usan tanto "Ver renders" (galería fija del edificio) como el click
    // sobre la planta/renders de la unidad en el panel (galería que cambia
    // cada vez que se abre una unidad distinta) — mismo modal, misma UI,
    // cada quien le pasa su propia lista al abrirla.
    const galeria = (() => {
      const modal = document.getElementById('renders-modal');
      const imgEl = document.getElementById('renders-img');
      const contador = document.getElementById('renders-contador');
      const btnPrev = document.getElementById('renders-prev');
      const btnNext = document.getElementById('renders-next');
      let lista = [], indice = 0, conZoom = false;
      imgEl.addEventListener('error', () => respaldoOriginal(imgEl));

      /* Zoom del plano: pellizco, arrastre, doble toque/doble click, rueda y
         deslizar hacia abajo para cerrar. Solo si lo pide quien abre (el
         plano del panel, ver ampliarPlano()): los renders del edificio y las
         fotos de obra siguen siendo el carrusel de siempre. Un único
         transform, translate(x, y) scale(s) con origen en la esquina de la
         imagen, escrito en requestAnimationFrame. Coordenadas en px del
         modal, que con inset 0 son las de la pantalla (clientX/Y). */
      const zoomGaleria = (() => {
        const ZOOM_MAX = 4, ZOOM_DOBLE = 2.5;
        const MS_VOLVER = 200;      // soltar debajo de 1x, o fuera de los bordes
        const MS_DOBLE = 250;       // doble toque / doble click
        const MS_SALIDA = 180;      // la imagen sigue bajando al cerrar deslizando
        const MS_ENTRE_TOQUES = 300, DIST_TOQUE = 10, DIST_DOBLE = 30;
        const ELASTICO = .35;       // cuánto sigue al dedo pasado el borde
        const reducir = matchMedia('(prefers-reduced-motion: reduce)');
        const tactil = matchMedia('(hover: none)');
        const pista = document.getElementById('renders-pista');
        let activo = false;
        // Estado mostrado: escala, traslación, opacidad del fondo y de la imagen.
        let s = 1, x = 0, y = 0, velo = 1, op = 1;
        let cuadro = 0, anim = null, cerrando = false;
        const punteros = new Map();   // pointerId → { x, y }
        let gesto = null, toqueLimpio = false, ultimoToque = null;
        let pistaReloj = 0, pistaVista = false;

        const ampliada = () => s > 1.001;
        const elastico = (v, a, b) => v < a ? a - (a - v) * ELASTICO : v > b ? b + (v - b) * ELASTICO : v;
        // La inversa: para seguir arrastrando desde una imagen que ya quedó
        // pasada del borde (un pellizco contra el costado) sin que salte.
        const desElastico = (v, a, b) => v < a ? a - (a - v) / ELASTICO : v > b ? b + (v - b) / ELASTICO : v;

        // La caja de la imagen sin transformar (offset* ignora el transform).
        function medir() {
          return {
            L: imgEl.offsetLeft, T: imgEl.offsetTop, W: imgEl.offsetWidth, H: imgEl.offsetHeight,
            VW: modal.clientWidth, VH: modal.clientHeight
          };
        }
        // Traslación permitida en un eje: más grande que la pantalla, sin
        // dejar ver fondo de ese lado; más chica, centrada.
        function rango(L, tam, V) {
          if (tam >= V) return [V - L - tam, -L];
          const c = (V - tam) / 2 - L;
          return [c, c];
        }
        function limites(sc, m) {
          return { x: rango(m.L, m.W * sc, m.VW), y: rango(m.T, m.H * sc, m.VH) };
        }
        function dentro(sc, tx, ty, m) {
          const l = limites(sc, m);
          return {
            x: Math.min(l.x[1], Math.max(l.x[0], tx)),
            y: Math.min(l.y[1], Math.max(l.y[0], ty))
          };
        }
        // Traslación que deja quieto bajo (fx, fy) el punto de la imagen que
        // hoy está ahí, al pasar de la escala actual a `sc`.
        function fijandoPunto(sc, fx, fy, m) {
          const k = sc / s;
          return { x: fx - m.L - k * (fx - m.L - x), y: fy - m.T - k * (fy - m.T - y) };
        }

        function escribir() {
          imgEl.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + s + ')';
          imgEl.style.opacity = op < 1 ? op : '';
          modal.style.backgroundColor = velo < 1 ? 'rgba(15, 19, 21, ' + (.92 * velo).toFixed(3) + ')' : '';
          imgEl.classList.toggle('ampliada', ampliada());
        }
        function pintar(ahora) {
          cuadro = 0;
          let fin = null;
          if (anim) {
            const k = Math.min(1, Math.max(0, (ahora - anim.t0) / anim.ms));
            const e = 1 - Math.pow(1 - k, 3);
            s = anim.de.s + (anim.a.s - anim.de.s) * e;
            x = anim.de.x + (anim.a.x - anim.de.x) * e;
            y = anim.de.y + (anim.a.y - anim.de.y) * e;
            velo = anim.de.velo + (anim.a.velo - anim.de.velo) * e;
            op = anim.de.op + (anim.a.op - anim.de.op) * e;
            if (k < 1) pedirCuadro();
            else { fin = anim.fin; anim = null; }
          }
          escribir();
          if (fin) fin();
        }
        function pedirCuadro() { if (!cuadro) cuadro = requestAnimationFrame(pintar); }
        // Ease-out cúbico hacia `a`; con movimiento reducido, directo.
        function animarZoom(a, ms, fin) {
          const destino = { s, x, y, velo: 1, op: 1, ...a };
          if (reducir.matches) {
            anim = null;
            ({ s, x, y, velo, op } = destino);
            escribir();
            if (fin) fin();
            return;
          }
          anim = { t0: performance.now(), ms, de: { s, x, y, velo, op }, a: destino, fin };
          pedirCuadro();
        }
        // Al soltar: debajo de 1x vuelve a 1x; fuera de los bordes, rebota.
        function asentar() {
          if (s < 1) { animarZoom({ s: 1, x: 0, y: 0 }, MS_VOLVER); return; }
          const d = dentro(s, x, y, medir());
          if (Math.abs(d.x - x) > .5 || Math.abs(d.y - y) > .5 || velo < 1 || op < 1) animarZoom(d, MS_VOLVER);
        }

        function reiniciar() {
          if (cuadro) cancelAnimationFrame(cuadro);
          cuadro = 0; anim = null; cerrando = false;
          punteros.clear(); gesto = null; ultimoToque = null;
          s = 1; x = 0; y = 0; velo = 1; op = 1;
          modal.classList.remove('arrastrando');
          if (activo) escribir();
          else {
            imgEl.style.transform = imgEl.style.opacity = modal.style.backgroundColor = '';
            imgEl.classList.remove('ampliada');
          }
        }
        // Al abrir y al cerrar: siempre a 1x, sin pan.
        function activar(conZoom) {
          activo = conZoom;
          modal.classList.toggle('con-zoom', conZoom);
          reiniciar();
          if (!conZoom) ocultarPista();
        }

        // Una vez por aparato (y, sin localStorage, una vez por visita).
        function mostrarPista() {
          if (!activo || !tactil.matches || pistaVista) return;
          pistaVista = true;
          try {
            if (localStorage.getItem('cota_pista_zoom')) return;
            localStorage.setItem('cota_pista_zoom', '1');
          } catch { /* sin localStorage alcanza con la de esta visita */ }
          pista.classList.add('visible');
          pistaReloj = setTimeout(ocultarPista, 2000);
        }
        function ocultarPista() {
          clearTimeout(pistaReloj);
          pista.classList.remove('visible');
        }

        // Un dedo (o el mouse): arrastre si está ampliada; a 1x, en táctil,
        // deslizar hacia abajo cierra. Se decide al pasar DIST_TOQUE.
        function empezarUno(id, p, tipo, enFondo) {
          gesto = { modo: null, id, x0: p.x, y0: p.y, sx: x, sy: y, t0: performance.now(), tipo, enFondo, m: medir() };
        }
        function empezarArrastre(g) {
          g.modo = 'mover';
          const l = limites(s, g.m);
          g.sx = desElastico(x, l.x[0], l.x[1]);
          g.sy = desElastico(y, l.y[0], l.y[1]);
          if (g.tipo === 'mouse') modal.classList.add('arrastrando');
        }
        function empezarPellizco() {
          const [a, b] = [...punteros.values()];
          velo = 1; op = 1;
          gesto = {
            modo: 'pellizco', d0: Math.hypot(b.x - a.x, b.y - a.y) || 1,
            mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, s0: s, x0: x, y0: y, m: medir()
          };
          toqueLimpio = false;
        }

        modal.addEventListener('pointerdown', e => {
          if (!activo || cerrando || e.target.closest('button')) return;
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          // Imagen sin cargar todavía, o un tercer dedo: nada que hacer.
          if (!imgEl.offsetWidth || punteros.size >= 2) return;
          e.preventDefault();   // sin el arrastre nativo de la imagen ni selección
          try { modal.setPointerCapture(e.pointerId); } catch { /* ya no está */ }
          ocultarPista();
          anim = null;          // un toque frena la animación donde esté
          punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (punteros.size === 1) {
            toqueLimpio = true;
            empezarUno(e.pointerId, punteros.get(e.pointerId), e.pointerType, e.target === modal);
          } else empezarPellizco();
        });

        modal.addEventListener('pointermove', e => {
          const p = punteros.get(e.pointerId);
          if (!p || !gesto) return;
          p.x = e.clientX; p.y = e.clientY;
          const g = gesto, m = g.m;

          if (g.modo === 'pellizco') {
            const [a, b] = [...punteros.values()];
            let sc = g.s0 * Math.hypot(b.x - a.x, b.y - a.y) / g.d0;
            // Hasta 4x firme; debajo de 1x se deja achicar con resistencia y
            // vuelve al soltar.
            sc = Math.min(ZOOM_MAX, sc < 1 ? Math.max(.5, 1 - (1 - sc) * .6) : sc);
            // El punto que estaba entre los dedos al empezar sigue entre los
            // dedos: zoom centrado ahí y pan si los dos se mueven juntos.
            const k = sc / g.s0, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            s = sc;
            x = mx - m.L - k * (g.mx - m.L - g.x0);
            y = my - m.T - k * (g.my - m.T - g.y0);
            pedirCuadro();
            return;
          }

          const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
          if (!g.modo) {
            if (Math.hypot(dx, dy) < DIST_TOQUE) return;
            toqueLimpio = false;
            if (ampliada()) empezarArrastre(g);
            else if (g.tipo !== 'mouse' && dy > Math.abs(dx)) {
              g.modo = 'bajar';
              g.vy = 0; g.ty = e.clientY; g.tt = performance.now();
            } else g.modo = 'nada';
          }
          if (g.modo === 'mover') {
            const l = limites(s, m);
            x = elastico(g.sx + dx, l.x[0], l.x[1]);
            y = elastico(g.sy + dy, l.y[0], l.y[1]);
            pedirCuadro();
          } else if (g.modo === 'bajar') {
            const ahora = performance.now();
            if (ahora > g.tt) g.vy = .8 * (e.clientY - g.ty) / (ahora - g.tt) + .2 * g.vy;
            g.ty = e.clientY; g.tt = ahora;
            // La imagen sigue al dedo y se achica apenas, desde su centro;
            // el fondo se va aclarando. Hacia arriba casi no se mueve.
            const avance = Math.min(1, Math.max(0, dy) / (m.VH * .45));
            s = 1 - .12 * avance;
            x = dx + m.W * (1 - s) / 2;
            y = (dy > 0 ? dy : dy * .2) + m.H * (1 - s) / 2;
            velo = 1 - .85 * avance;
            pedirCuadro();
          }
        });

        function soltar(e) {
          if (!punteros.delete(e.pointerId) || !gesto) return;
          if (gesto.modo === 'pellizco') {
            if (punteros.size === 1) {
              // Queda un dedo: sigue arrastrando desde donde quedó.
              const [[id, p]] = punteros;
              empezarUno(id, p, e.pointerType, false);
              if (ampliada()) empezarArrastre(gesto); else gesto.modo = 'nada';
              return;
            }
          }
          if (punteros.size) return;
          const g = gesto;
          gesto = null;
          modal.classList.remove('arrastrando');
          if (e.type === 'pointercancel') { asentar(); return; }

          if (g.modo === 'bajar') {
            const dy = e.clientY - g.y0;
            if (dy > Math.min(140, g.m.VH * .2) || (g.vy > .6 && dy > 40)) {
              cerrando = true;
              animarZoom({ s, x, y: y + g.m.VH * .25, velo: 0, op: 0 }, MS_SALIDA, cerrar);
            } else animarZoom({ s: 1, x: 0, y: 0 }, MS_VOLVER);
            return;
          }
          if (toqueLimpio && performance.now() - g.t0 < 400) tocar(e.clientX, e.clientY, g.enFondo);
          else asentar();
        }
        modal.addEventListener('pointerup', soltar);
        modal.addEventListener('pointercancel', soltar);

        // Doble toque (o doble click): 1x ↔ 2.5x en el punto tocado. Un toque
        // suelto en el fondo oscuro cierra, como siempre; con la imagen
        // ampliada no (lo que queda de fondo es el costado de la imagen).
        function tocar(fx, fy, enFondo) {
          const ahora = performance.now();
          const doble = ultimoToque && ahora - ultimoToque.t < MS_ENTRE_TOQUES &&
            Math.hypot(fx - ultimoToque.x, fy - ultimoToque.y) < DIST_DOBLE;
          if (doble) {
            ultimoToque = null;
            if (ampliada()) { animarZoom({ s: 1, x: 0, y: 0 }, MS_DOBLE); return; }
            const m = medir(), t = fijandoPunto(ZOOM_DOBLE, fx, fy, m);
            animarZoom({ s: ZOOM_DOBLE, ...dentro(ZOOM_DOBLE, t.x, t.y, m) }, MS_DOBLE);
            return;
          }
          ultimoToque = { t: ahora, x: fx, y: fy };
          if (enFondo && !ampliada()) cerrar();
        }

        // Rueda (y el pellizco del trackpad, que llega como rueda con
        // ctrlKey): centrado en el cursor, entre 1x y 4x.
        modal.addEventListener('wheel', e => {
          if (!activo) return;
          e.preventDefault();   // ctrl + rueda tampoco amplía la página
          if (cerrando || gesto || !imgEl.offsetWidth) return;
          ocultarPista();
          anim = null;
          const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? modal.clientHeight : 1;
          const sc = Math.min(ZOOM_MAX, Math.max(1, s * Math.exp(-e.deltaY * px * (e.ctrlKey ? .01 : .0015))));
          if (sc === s) return;
          const m = medir(), t = fijandoPunto(sc, e.clientX, e.clientY, m);
          s = sc;
          ({ x, y } = dentro(sc, t.x, t.y, m));
          pedirCuadro();
        }, { passive: false });
        // Safari (iOS y el trackpad de macOS) amplía la página con sus propios
        // eventos de gesto, aparte de los pointer events.
        modal.addEventListener('gesturestart', e => { if (activo) e.preventDefault(); });

        // Girar el teléfono cambia la caja de la imagen: vuelve a 1x.
        addEventListener('resize', () => { if (activo && !modal.hidden) reiniciar(); });

        return { activar, reiniciar, mostrarPista };
      })();

      function mostrarIndice(i) {
        indice = i;
        const item = lista[indice];
        imgEl.dataset.original = item.url;
        imgEl.src = urlLightbox(item.url, conZoom, item.tipo === 'planta');
        contador.textContent = (indice + 1) + ' / ' + lista.length;
        btnPrev.disabled = indice === 0;
        btnNext.disabled = indice === lista.length - 1;
        zoomGaleria.reiniciar();
      }
      // { zoom: true }: pellizco y demás (ver zoomGaleria). Hoy, solo el plano.
      function abrir(nuevaLista, indiceInicial, opciones) {
        if (!nuevaLista.length) return;
        lista = nuevaLista;
        conZoom = !!(opciones && opciones.zoom);
        zoomGaleria.activar(conZoom);
        mostrarIndice(indiceInicial || 0);
        modal.hidden = false;
        document.addEventListener('keydown', alTeclado);
        zoomGaleria.mostrarPista();
      }
      function cerrar() {
        modal.hidden = true;
        document.removeEventListener('keydown', alTeclado);
        zoomGaleria.activar(false);
      }
      function alTeclado(e) {
        // Esc cierra solo el lightbox: que no llegue al de la unidad (en
        // window), que cerraría también el panel de abajo.
        if (e.key === 'Escape') { e.stopPropagation(); cerrar(); }
        else if (e.key === 'ArrowLeft' && indice > 0) mostrarIndice(indice - 1);
        else if (e.key === 'ArrowRight' && indice < lista.length - 1) mostrarIndice(indice + 1);
      }

      document.getElementById('renders-cerrar').addEventListener('click', cerrar);
      // Con zoom el toque en el fondo lo resuelve zoomGaleria: el click llega
      // también después de un arrastre que termina afuera de la imagen.
      modal.addEventListener('click', e => { if (e.target === modal && !modal.classList.contains('con-zoom')) cerrar(); });
      btnPrev.addEventListener('click', () => { if (indice > 0) mostrarIndice(indice - 1); });
      btnNext.addEventListener('click', () => { if (indice < lista.length - 1) mostrarIndice(indice + 1); });

      return { abrir };
    })();

    // Galería de renders del edificio: el trigger queda oculto (ver HTML)
    // hasta que haya al menos una imagen — la mayoría de los proyectos
    // todavía no van a tener renders cargados desde admin.html.
    // El primer render del proyecto: la foto de la cabecera del panel cuando
    // la tipología de la unidad no tiene uno propio (ver pintarPanel()).
    let renderPortada = null;
    // Si la foto no carga (ni la variante ni el original), queda el fondo
    // verde de la cabecera.
    document.getElementById('p-hero-img').addEventListener('error', ev => {
      if (!respaldoOriginal(ev.target)) ev.target.hidden = true;
    });
    function pintarRenders(lista) {
      if (!lista.length) return;
      renderPortada = lista[0].url;
      const trigger = document.getElementById('renders-trigger');
      trigger.hidden = false;
      trigger.addEventListener('click', () => galeria.abrir(lista, 0));
    }

    // Avance de obra: trigger + pantalla propia, ocultos hasta que el
    // proyecto tenga avance_habilitado Y haya al menos un hito o una foto —
    // mismo criterio que renders-trigger, nunca se abre la puerta a una
    // sección vacía (y la vista pública ya deja hitos/fotos vacíos si el
    // desarrollador apaga el toggle, así que esta condición alcanza sola).
    function pintarAvance(proyecto, hitos, fotos) {
      if (!hitos.length && !fotos.length) return;
      const locale = proyecto.locale || 'es-UY';

      const pesoTotal = hitos.reduce((acc, h) => acc + Number(h.peso), 0);
      const pesoCumplido = hitos.filter(h => h.fecha_real).reduce((acc, h) => acc + Number(h.peso), 0);
      const pct = pesoTotal > 0 ? Math.round((pesoCumplido / pesoTotal) * 100) : 0;
      document.getElementById('avance-pct').textContent = pct + '%';
      document.getElementById('avance-barra-relleno').style.width = pct + '%';

      // "Última actualización" es el máximo entre cuándo se tocó un hito y
      // cuándo se subió una foto — nunca una columna aparte que pueda
      // desincronizarse de los datos reales.
      const fechas = [...hitos.map(h => h.actualizado_en), ...fotos.map(f => f.subida_en)]
        .filter(Boolean).map(f => new Date(f).getTime());
      const ultima = fechas.length ? new Date(Math.max(...fechas)) : null;
      document.getElementById('avance-actualizado').textContent = ultima
        ? 'Última actualización: ' + ultima.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
        : 'Todavía sin actualizaciones.';
      const DIAS_DESACTUALIZADO = 45;
      const diasSinTocar = ultima ? (Date.now() - ultima.getTime()) / 86400000 : Infinity;
      const elStale = document.getElementById('avance-stale');
      elStale.hidden = diasSinTocar < DIAS_DESACTUALIZADO;
      elStale.textContent = 'Hace más de ' + DIAS_DESACTUALIZADO +
        ' días que no se carga novedades acá — puede no reflejar el estado actual de la obra.';

      const timeline = document.getElementById('avance-timeline');
      timeline.innerHTML = hitos.map(h => {
        const cumplido = !!h.fecha_real;
        const fechaTxt = cumplido
          ? 'Cumplido · ' + new Date(h.fecha_real).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
          : h.fecha_estimada
            ? 'Estimado · ' + new Date(h.fecha_estimada).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Sin fecha estimada';
        return '<li class="' + (cumplido ? 'hito-cumplido' : 'hito-pendiente') + '">' +
          '<span class="hito-nombre">' + h.nombre + (h.piso != null ? ' · Piso ' + h.piso : '') + '</span>' +
          '<span class="hito-fecha">' + fechaTxt + '</span></li>';
      }).join('') || '<li class="hito-pendiente"><span class="hito-nombre">Todavía no hay hitos cargados.</span></li>';

      // Agrupadas por mes a partir de `fecha` (la de la foto, no la de
      // carga) — vienen ordenadas de más nueva a más vieja desde cargarProyecto().
      const cont = document.getElementById('avance-fotos');
      cont.innerHTML = '';
      document.getElementById('avance-sin-fotos').hidden = fotos.length > 0;
      const grupos = new Map();
      fotos.forEach(f => {
        const d = new Date(f.fecha);
        const clave = d.getFullYear() + '-' + d.getMonth();
        if (!grupos.has(clave)) grupos.set(clave, { fecha: d, items: [] });
        grupos.get(clave).items.push(f);
      });
      [...grupos.values()].forEach(grupo => {
        const bloque = document.createElement('div');
        bloque.className = 'avance-fotos-mes';
        const tit = document.createElement('p');
        tit.className = 'avance-mes-tit';
        tit.textContent = grupo.fecha.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
        bloque.appendChild(tit);
        const grid = document.createElement('div');
        grid.className = 'avance-mes-grid';
        grupo.items.forEach((f, i) => {
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.alt = 'Avance de obra, ' + tit.textContent;
          img.addEventListener('error', () => respaldoOriginal(img));
          ponerImagenStorage(img, f.url, VARIANTES_STORAGE.miniatura);
          img.addEventListener('click', () => galeria.abrir(grupo.items, i));
          grid.appendChild(img);
        });
        bloque.appendChild(grid);
        cont.appendChild(bloque);
      });

      const trigger = document.getElementById('avance-trigger');
      const modal = document.getElementById('avance-modal');
      function cerrar() {
        modal.hidden = true;
        document.removeEventListener('keydown', alTeclado);
      }
      function alTeclado(e) { if (e.key === 'Escape') cerrar(); }
      trigger.hidden = false;
      trigger.addEventListener('click', () => {
        modal.hidden = false;
        document.addEventListener('keydown', alTeclado);
      });
      document.getElementById('avance-cerrar').addEventListener('click', cerrar);
    }

    const btnCompartir = document.getElementById('red-compartir');
    const avisoCompartir = document.getElementById('compartir-aviso');
    let avisoCompartirTimeout;
    function mostrarAvisoCompartir(texto) {
      avisoCompartir.textContent = texto;
      avisoCompartir.classList.add('visible');
      clearTimeout(avisoCompartirTimeout);
      avisoCompartirTimeout = setTimeout(() => avisoCompartir.classList.remove('visible'), 1800);
    }
    // La arma iniciar() cuando ya hay unidades: le suma a la URL el v= de lo
    // que se está viendo (ver versionCompartir()). Antes de eso, la URL tal cual.
    let conVersion = url => url;
    btnCompartir.addEventListener('click', async () => {
      const url = conVersion(location.protocol.startsWith('http') ? location.href : BASE);
      // El share nativo del SO (navigator.share) es poco confiable en desktop
      // (en Windows la hoja de "Compartir" puede fallar sin apps registradas),
      // así que copiamos el link directamente en vez de depender de él.
      try {
        await navigator.clipboard.writeText(url);
        mostrarAvisoCompartir('Link copiado');
      } catch {
        mostrarAvisoCompartir('No se pudo copiar el link');
      }
    });

    // Geometría por polígono (unidades con contorno propio, y losa/núcleo de
    // geometria.losa_contorno / .nucleo_contorno). Sistema de coordenadas
    // documentado en CLAUDE.md — resumen: x/z en metros, origen en el centro
    // de la placa, mismo sentido que ya usan col/frente.

    function areaConSigno(pts) { // pts: [[u,v], ...] en el plano que se está midiendo
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [u1, v1] = pts[i], [u2, v2] = pts[(i + 1) % pts.length];
        a += u1 * v2 - u2 * v1;
      }
      return a / 2;
    }

    // Centroide simple (promedio de vértices): alcanza para ubicar la unidad y
    // para orientar la cámara en enfocar() — no hace falta el centroide exacto
    // ponderado por área para eso.
    function centroideContorno(pts) {
      const s = pts.reduce((acc, [x, z]) => ({ x: acc.x + x, z: acc.z + z }), { x: 0, z: 0 });
      return { x: s.x / pts.length, z: s.z / pts.length };
    }

    // Arma el Shape de three.js centrado en su propio centroide (mismo criterio
    // que BoxGeometry: geometría centrada en el origen local, la posición del
    // mesh es lo que la ubica en el mundo — ver geometriaExtruida). El Shape
    // vive en su plano XY local; acá lo armamos como (x, -z) del contorno
    // porque ExtrudeGeometry + la rotación de -90° en X que aplica
    // geometriaExtruida mandan ese eje Y del Shape al Z mundial invertido. El
    // sentido se normaliza en ESE espacio (x, -z), no en el (x, z) del dato
    // crudo, para que la extrusión salga con las normales hacia afuera sin
    // depender de cómo vino cargado el contorno.
    function formaDesdeContorno(pts, centro) {
      let enShape = pts.map(([x, z]) => [x - centro.x, -(z - centro.z)]);
      if (areaConSigno(enShape) < 0) enShape = enShape.reverse();
      const forma = new THREE.Shape();
      enShape.forEach(([u, v], i) => { if (i === 0) forma.moveTo(u, v); else forma.lineTo(u, v); });
      forma.closePath();
      return forma;
    }

    // ExtrudeGeometry extruye a lo largo de +Z local; rotar -90° en X manda ese
    // +Z local a +Y mundial (arriba) y el plano XY del shape al plano XZ del
    // piso. depth = altura del volumen (piso a techo, o espesor para la losa).
    // El resultado queda centrado en su propio origen local en los tres ejes
    // (X/Z en el centroide del contorno, Y en depth/2) — igual que
    // BoxGeometry — así que se posiciona con mesh.position exactamente como
    // las cajas rectangulares de hoy.
    function geometriaExtruida(pts, depth, centro) {
      const geo = new THREE.ExtrudeGeometry(formaDesdeContorno(pts, centro), { depth, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -depth / 2, 0);
      return geo;
    }

    // Todo lo que sigue (escena, torre, cámara, interacción, bucle) queda
    // adentro de iniciar() porque necesita esperar a que lleguen el proyecto y
    // las unidades desde Supabase antes de construir nada.
    function iniciar(proyecto, settingsRow, UNIDADES, mediaTipologias, tzOffsetHoras, hitosObra, tipologias) {

      // Media real por tipología (planta/renders subidos desde admin.html),
      // agrupada por typology_id y tipo — así abrir(u) resuelve en O(1) qué
      // mostrarle a cada unidad según su u.typologyId. Ver pintarIntro().
      // refrescarDatos() lo vuelve a armar con la media nueva.
      const MEDIA_POR_TIPOLOGIA = {};
      function agruparMediaTipologias(lista) {
        for (const k in MEDIA_POR_TIPOLOGIA) delete MEDIA_POR_TIPOLOGIA[k];
        (lista || []).forEach(m => {
          const grupo = MEDIA_POR_TIPOLOGIA[m.typology_id] || (MEDIA_POR_TIPOLOGIA[m.typology_id] = { planta: [], render: [] });
          (grupo[m.tipo] || (grupo[m.tipo] = [])).push(m);
        });
      }
      agruparMediaTipologias(mediaTipologias);
      // typology_id → nombre para el comprador (ver tipologiaDe()). Lo
      // reemplaza refrescarDatos().
      let NOMBRES_TIPOLOGIA = nombresPublicosDe(tipologias);
      // typology_id → { titulo, descripcion } del bloque de descripción del
      // panel (ver pintarIntro()), solo los cargados. Hoy public_typologies
      // no trae esas columnas y queda vacío. Lo reemplaza refrescarDatos().
      function textosTipologiaDe(lista) {
        const textos = {};
        (lista || []).forEach(t => {
          const titulo = typeof t.titulo === 'string' ? t.titulo.trim() : '';
          const descripcion = typeof t.descripcion === 'string' ? t.descripcion.trim() : '';
          if (titulo || descripcion) textos[t.id] = { titulo, descripcion };
        });
        return textos;
      }
      let TEXTOS_TIPOLOGIA = textosTipologiaDe(tipologias);

      // Barra superior: "BRUSCO" + "by IXOU". Varios nombres ya traen el
      // "by X" adentro ("ROSSO by Block"); se parte ahí para no duplicarlo
      // con desarrolla ("ROSSO by Block by Block Desarrollos").
      const partesNombre = /^(.+?)\s+by\s+(.+)$/i.exec(proyecto.nombre || '');
      const h1Proyecto = document.getElementById('h1-proyecto');
      h1Proyecto.textContent = partesNombre ? partesNombre[1] : proyecto.nombre;
      const firma = partesNombre ? partesNombre[2] : proyecto.desarrolla;
      const cbDev = document.getElementById('cb-dev');
      cbDev.hidden = !firma;
      if (firma) cbDev.textContent = 'by ' + firma;
      // La misma marca, abajo, en el modo showroom (ver KIOSCO).
      document.getElementById('kiosco-nombre').textContent = partesNombre ? partesNombre[1] : proyecto.nombre;
      document.getElementById('kiosco-firma').textContent = firma ? 'by ' + firma : '';
      // Logo: la inicial del nombre corto sobre el verde de marca (no hay
      // logo propio por proyecto). Sin nombre queda el ícono del HTML.
      const inicial = Array.from(h1Proyecto.textContent.trim())[0];
      if (inicial) document.getElementById('cb-logo').textContent = inicial.toUpperCase();

      // Rótulo del tipo de proyecto (projects.tipo, ver
      // supabase-migration-portada.sql); sin el dato, "Edificio". Nombres e
      // íconos son constantes del código, no datos: innerHTML es seguro.
      const TIPOS_PROYECTO = {
        edificio: {
          nombre: 'Edificio',
          icono: '<rect x="5" y="3" width="11" height="18"></rect><path d="M16 10l4 2v9h-4"></path>' +
            '<path d="M8 7h1M11 7h1M8 11h1M11 11h1M8 15h1M11 15h1"></path>'
        },
        loteo: {
          nombre: 'Loteo',
          icono: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"></rect><path d="M3.5 12h17M12 3.5v17"></path>'
        },
      };
      const tipoProyecto = TIPOS_PROYECTO[proyecto.tipo] || TIPOS_PROYECTO.edificio;
      for (const id of ['cb-tipo', 'cb-tipo-nombre']) {
        document.getElementById(id).innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" ' +
          'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          tipoProyecto.icono + '</svg>' + tipoProyecto.nombre;
      }

      // Dirección en dos renglones: la calle y, debajo, número, barrio y
      // ciudad ("Ana Monterroso de Lavalleja" / "2162, Cordón, Montevideo").
      // direccion es texto libre: sin número de puerta (BRUSCO: "San José,
      // Ejido, Soriano y Aquiles Lanza, Centro") se corta en la última coma.
      // La ciudad no se repite si la dirección ya termina con ella.
      const dirTxt = (proyecto.direccion || '').trim();
      const conNumero = /^(.+?)\s+(\d[\w/-]*)\s*(?:,\s*(.+))?$/.exec(dirTxt);
      const coma = dirTxt.lastIndexOf(',');
      const calle = conNumero ? conNumero[1] : coma > 0 ? dirTxt.slice(0, coma).trim() : dirTxt;
      const zona = conNumero ? [conNumero[2], conNumero[3]] : [coma > 0 ? dirTxt.slice(coma + 1).trim() : ''];
      const ciudad = (proyecto.ciudad || '').trim();
      if (ciudad && !dirTxt.toLowerCase().endsWith(ciudad.toLowerCase())) zona.push(ciudad);
      const zonaTxt = zona.filter(Boolean).join(', ');
      const cbCalle = document.getElementById('cb-calle'), cbZona = document.getElementById('cb-zona');
      cbCalle.textContent = calle;
      cbCalle.hidden = !calle;
      cbZona.textContent = zonaTxt;
      cbZona.hidden = !zonaTxt;
      cbCalle.title = cbZona.title = [calle, zonaTxt].filter(Boolean).join(', ');

      // Portada (projects.portada_url / portada_foco): se prende recién al
      // cargar la foto; si no carga, el header queda como siempre. Se pide la
      // franja que se ve (ver VARIANTES_STORAGE), que cambia de proporción
      // con el header compacto; con portada_foco, la foto entera.
      const barraSup = document.getElementById('barra-sup');
      const portadaUrl = typeof proyecto.portada_url === 'string' ? proyecto.portada_url.trim() : '';
      if (/^https?:\/\//i.test(portadaUrl)) {
        const img = document.getElementById('bs-portada-img');
        const foco = (proyecto.portada_foco || '').trim();
        img.style.objectPosition = foco || 'center';
        img.addEventListener('load', () => {
          img.hidden = false;
          barraSup.classList.add('con-portada');
        }, { once: true });
        img.addEventListener('error', () => respaldoOriginal(img));
        const centrada = !foco || /^(center|center center|50% 50%)$/i.test(foco);
        const compacto = matchMedia('(max-width: 640px)');
        const pintarPortada = () => ponerImagenStorage(img, portadaUrl, !centrada ? VARIANTES_STORAGE.portadaFoco
          : compacto.matches ? VARIANTES_STORAGE.portadaMovil : VARIANTES_STORAGE.portada);
        pintarPortada();
        if (centrada) compacto.addEventListener('change', pintarPortada);
      }

      // Mobile: el rótulo del tipo va junto al nombre solo si entra sin
      // cortarlo; si no, se va (el nombre y la calle mandan). Lo mide
      // ajustarCabezal(), después del layout.

      // settings.brochure_url todavía no existe (haría falta la columna y
      // sumarla a public_settings): mientras falte, el botón queda oculto.
      const brochure = document.getElementById('brochure');
      if (settingsRow && settingsRow.brochure_url) {
        brochure.href = settingsRow.brochure_url;
        brochure.hidden = false;
      }

      // Ficha en mobile: plegada al resumen; se despliega a pedido. Se
      // cierra tocando el resumen de nuevo, tocando fuera o con Escape.
      const ficha = document.getElementById('ficha');
      const fichaToggle = document.getElementById('ficha-toggle');
      function cerrarFicha() {
        ficha.classList.remove('abierta');
        fichaToggle.setAttribute('aria-expanded', 'false');
      }
      fichaToggle.addEventListener('click', () => {
        const abierta = !ficha.classList.contains('abierta');
        ficha.classList.toggle('abierta', abierta);
        fichaToggle.setAttribute('aria-expanded', abierta);
      });
      // En fase de captura: ningún stopPropagation del lienzo o de las hojas
      // puede impedir que se cierre. Excepciones: el lienzo, la tarjeta de
      // unidad, Filtros/Pisos (botón y hoja) y la hoja de amenities (se abre
      // desde la ficha). Usar los
      // filtros y el riel no la pliega (los datos del edificio se siguen
      // viendo; el riel y Filtros se acomodan debajo, ver --fin-ficha); en el
      // lienzo se decide al moverse o al soltar: arrastrar o tocar el vacío
      // la siguen plegando (ver el click del lienzo). Abrir el panel también
      // la pliega (ver abrir()), y tocar una unidad lo abre.
      document.addEventListener('pointerdown', e => {
        if (!ficha.classList.contains('abierta') || ficha.contains(e.target)) return;
        if (e.target === lienzo ||
          e.target.closest('#tarjeta-unidad, #filtros-trigger, #pisos-trigger, #filtros, #pisos, #capa-edificio')) return;
        cerrarFicha();
      }, true);
      // Amenities (ver abrirCapaEdificio()): en mobile nunca dos hojas
      // abiertas. Los botones están dentro de la ficha, así que el cierre por
      // toque afuera de las otras hojas no los cubre.
      for (const id of ['cb-amenities', 'fc-amenities']) {
        document.getElementById(id).addEventListener('click', () => {
          cerrarHoja();
          cerrarFiltros();
          if (solActivo && solEsHoja.matches) activarSol(false);
        });
      }
      // Borde inferior de la ficha (mobile) como queda al terminar de
      // plegarse o desplegarse, sin esperar la transición de altura: la parte
      // fija (el resumen) + lo que despliega, si está abierta. Lo usan el riel
      // de pisos y Filtros (--fin-ficha, para ir debajo en vez de taparla,
      // plegada o no) y enfocar(). La ficha cambia de alto al plegarse, al
      // abrir o cerrar el panel (ver el CSS) y con refrescarDatos(): el
      // ResizeObserver mantiene --fin-ficha al día en todos los casos.
      const fichaCuerpo = document.getElementById('ficha-cuerpo');
      const fichaMas = document.getElementById('ficha-mas');
      function finFicha() {
        const fija = ficha.offsetHeight - fichaCuerpo.offsetHeight;
        return ficha.getBoundingClientRect().top + fija + (ficha.classList.contains('abierta') ? fichaMas.scrollHeight : 0);
      }
      // Solo si cambió: va en :root, así que cada escritura recalcula el
      // estilo de toda la página.
      let finFichaPuesto = null;
      function ponerFinFicha(px) {
        if (px === finFichaPuesto) return;
        finFichaPuesto = px;
        document.documentElement.style.setProperty('--fin-ficha', px + 'px');
      }
      function medirFinFicha() {
        ponerFinFicha(Math.round(finFicha()));
      }
      // Un solo ResizeObserver para lo que se mide de la interfaz: avisa
      // después del layout, así medir no fuerza otro. Observa la pantalla
      // (body: también al cambiar de tamaño la ventana, con pantalla ya al
      // día), el header y la ficha; el encuadre inicial le suma la barra
      // inferior, el riel y la toolbar. Primero reencuadrar(), que solo lee,
      // y después ajustarCabezal(), que lee y recién después escribe: ninguna
      // lectura queda detrás de una escritura.
      const obsInterfaz = new ResizeObserver(() => {
        reencuadrar();
        ajustarCabezal();
      });
      for (const el of [document.body, barraSup, ficha]) obsInterfaz.observe(el);
      // Medir después del próximo layout aunque nada cambie de tamaño (la
      // leyenda nueva de refrescarDatos()): un observe() nuevo avisa siempre
      // una vez. Nunca desde el callback del observer (sería un ciclo).
      function pedirAjusteCabezal() {
        obsInterfaz.unobserve(ficha);
        obsInterfaz.observe(ficha);
      }
      document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarFicha(); });

      // Cada celda depende solo de su propio dato — si falta, se saca junto
      // con el divisor de al lado, nunca queda un guion ni una línea
      // colgando entre dos celdas (ver CLAUDE.md/brief del cabezal).
      const hayPisos = !!proyecto.pisos, hayUnidades = !!UNIDADES.length, hayEntrega = !!proyecto.entrega;
      document.getElementById('cb-dato-pisos').hidden = !hayPisos;
      document.getElementById('cb-pisos-valor').textContent = proyecto.pisos;
      // Conjuntos de varias torres (geom.torre en las unidades): un solo
      // proyecto.pisos no describe el edificio. Los pisos de cada torre salen
      // en vivo de las unidades cargadas (el piso más alto de cada una), sin
      // contar el basamento.
      const pisosPorTorre = {};
      UNIDADES.forEach(u => {
        const t = torreDe(u);
        if (t && t !== 'Basamento') pisosPorTorre[t] = Math.max(pisosPorTorre[t] || 0, u.piso);
      });
      const torresFicha = Object.keys(pisosPorTorre).sort();
      if (torresFicha.length > 1) {
        const txt = document.getElementById('cb-pisos-txt');
        txt.textContent = '';
        torresFicha.forEach((t, i) => {
          const b = document.createElement('b');
          b.textContent = pisosPorTorre[t];
          txt.append((i ? ' · ' : '') + 'Torre ' + t + ' ', b);
        });
        txt.append(' pisos');
      }
      document.getElementById('cb-dato-unidades').hidden = !hayUnidades;
      document.getElementById('cb-unidades-valor').textContent = UNIDADES.length;
      document.getElementById('cb-dato-entrega').hidden = !hayEntrega;
      document.getElementById('cb-entrega-valor').textContent = proyecto.entrega || '';
      document.getElementById('cb-div-1').hidden = !(hayPisos && (hayUnidades || hayEntrega));
      document.getElementById('cb-div-2').hidden = !(hayUnidades && hayEntrega);
      document.getElementById('cb-datos').hidden = !(hayPisos || hayUnidades || hayEntrega);
      // Mobile: los mismos datos en un renglón del resumen plegado ("10 pisos
      // | 78 u. | Mar 2028", cada uno con el ícono de #cb-datos), con la
      // versión entera para el lector de pantalla. La entrega es texto libre:
      // solo se acorta el mes si es "<mes> <año>" ("marzo 2028" → "Mar
      // 2028"); si no, va tal cual.
      const negrita = t => Object.assign(document.createElement('b'), { textContent: t });
      const entregaCorta = t => {
        const m = /^\s*([a-záéíóú]+)\s+(?:de\s+)?(\d{4})\s*$/i.exec(t);
        const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre',
          'octubre', 'noviembre', 'diciembre'];
        return m && meses.includes(m[1].toLowerCase())
          ? m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase() + ' ' + m[2] : t.trim();
      };
      const datoLinea = (celda, ...partes) => {
        const s = document.createElement('span');
        s.className = 'fc-dato';
        const icono = document.querySelector('#' + celda + ' svg').cloneNode(true);
        icono.setAttribute('width', 13);
        icono.setAttribute('height', 13);
        s.append(icono, ...partes);
        return s;
      };
      const piezasLinea = [], lectorLinea = [];
      if (hayPisos) {
        // "Torre" es lo primero que se va si el renglón no entra ("A 13 · B
        // 11 pisos", ver ajustarCabezal()).
        const torre = () => Object.assign(document.createElement('span'), { className: 'fc-largo', textContent: 'Torre ' });
        piezasLinea.push(torresFicha.length > 1
          ? datoLinea('cb-dato-pisos', ...torresFicha.flatMap((t, i) =>
            [i ? ' · ' : '', torre(), t + ' ', negrita(pisosPorTorre[t])]), ' pisos')
          : datoLinea('cb-dato-pisos', negrita(proyecto.pisos), ' pisos'));
        lectorLinea.push(document.getElementById('cb-pisos-txt').textContent.trim());
      }
      if (hayUnidades) {
        piezasLinea.push(datoLinea('cb-dato-unidades', negrita(UNIDADES.length), ' u.'));
        lectorLinea.push(UNIDADES.length + ' unidades');
      }
      if (hayEntrega) {
        piezasLinea.push(datoLinea('cb-dato-entrega', negrita(entregaCorta(proyecto.entrega))));
        lectorLinea.push('entrega ' + proyecto.entrega.trim());
      }
      document.getElementById('fc-datos').replaceChildren(...piezasLinea);
      document.getElementById('fc-datos-lector').textContent = lectorLinea.join(', ');
      document.getElementById('fc-linea').hidden = !piezasLinea.length && document.getElementById('fc-amenities').hidden;
      // Desplegada, la ficha suma solo la fila de amenities (la leyenda y los
      // datos ya están en el resumen, la dirección en el header). Sin
      // amenities no hay qué desplegar.
      if (document.getElementById('fc-amenities-fila').hidden) {
        fichaToggle.disabled = true;
        fichaToggle.querySelector('.chev').style.display = 'none';
      }
      // Arranca desplegada (es un renglón más): quien entra ve las amenities
      // sin tocar nada; se pliega sola al primer toque fuera, al arrastrar el
      // edificio o al abrir una unidad. En mobile, con ?u= no (abrir() la
      // pliega igual) ni con ?sol= (la hoja del sol ya ocupa la pantalla).
      // Va antes de la ESCENA: el encuadre inicial ya cuenta con ella.
      const paramsFicha = new URLSearchParams(location.search);
      if (!fichaToggle.disabled && !(matchMedia('(max-width: 860px)').matches &&
        (paramsFicha.has('u') || paramsFicha.has('sol')))) {
        ficha.classList.add('abierta');
        fichaToggle.setAttribute('aria-expanded', 'true');
      }

      // Disponibilidad: contada en vivo por aspectoDe(u) (así "En alquiler"
      // aparece como tal en BRUSCO). Solo los estados con unidades: un
      // "Vendida 0" en un edificio que no publica vendidas es ruido. Los
      // nombres y colores son constantes del código, no datos — por eso
      // innerHTML es seguro acá. Si conviven venta y alquiler, "Disponible"
      // al lado de "En alquiler" se lee como si lo alquilable no estuviera
      // disponible: se nombra por operación ("En venta") — solo en la
      // leyenda; ROSSO y Altamira, sin alquiler, siguen diciendo "Disponible".
      // En el resumen de mobile cada cifra lleva su etiqueta corta en vez de
      // un punto solo: quien entra por primera vez entiende sin tocar nada.
      // Si no entran en un renglón, pasan a la abreviada (ajustarCabezal()).
      // El mismo nombre por operación va en los chips, la tarjeta y el panel
      // (nombreEstado()).
      const hayAlquiler = UNIDADES.some(esAlquiler);
      function nombreEstado(u) {
        return u.estado === 'disponible' && hayAlquiler ? 'En venta' : aspectoDe(u).nombre;
      }
      const ABREV_ESTADO = new Map([[ESTADOS.disponible, 'disp'], [ESTADOS.alquiler, 'alquiler'],
        [ESTADOS.reservado, 'res'], [ESTADOS.vendido, 'vend'], [ESTADOS.sin_dato, 'consultar']]);
      // El renglón de datos en dos pasos: sin "Torre" (.sin-torre) y, si
      // igual no entra, sin los íconos (.compacta).
      const fichaResumen = document.getElementById('ficha-resumen');
      const fcDatos = document.getElementById('fc-datos');
      // Lo que se mide del header y la ficha: el rótulo del tipo junto al
      // nombre, la leyenda (si no entra, la abreviada), el renglón de datos y
      // --fin-ficha. Corre en obsInterfaz, después del layout. Hasta
      // 2026-10-20 cada medición iba en medio de iniciar(), detrás de una
      // tanda de escrituras: eran reflows forzados de la página entera. Cada
      // texto se mide en su versión completa, así que primero se sacan las
      // clases que estén puestas (solo al agrandar la pantalla: en la carga
      // no hay ninguna), después se lee todo y al final se escribe. Solo el
      // segundo paso del renglón de datos (sin "Torre" sigue sin entrar →
      // sin íconos) vuelve a medir después de escribir: ese layout es el de
      // la ficha sola. Los renglones no dependen uno del otro: la ficha
      // tiene ancho fijo y el header, alto fijo.
      const sobra = el => el.scrollWidth > el.clientWidth;
      function ajustarCabezal() {
        if (barraSup.classList.contains('sin-tipo')) barraSup.classList.remove('sin-tipo');
        if (fichaResumen.classList.contains('compacta')) fichaResumen.classList.remove('compacta');
        if (fcDatos.classList.contains('sin-torre') || fcDatos.classList.contains('compacta')) {
          fcDatos.classList.remove('sin-torre', 'compacta');
        }
        const tipoSobra = sobra(h1Proyecto), leyendaSobra = sobra(fichaResumen), datosSobran = sobra(fcDatos);
        const fin = Math.round(finFicha());
        barraSup.classList.toggle('sin-tipo', tipoSobra);
        fichaResumen.classList.toggle('compacta', leyendaSobra);
        ponerFinFicha(fin);
        if (!datosSobran) return;
        fcDatos.classList.add('sin-torre');
        if (sobra(fcDatos)) fcDatos.classList.add('compacta');
      }
      // refrescarDatos() la vuelve a llamar si cambió algún estado.
      function pintarDisponibilidad() {
        if (proyecto.muestra_totales) {
          const conteos = [ESTADOS.disponible, ESTADOS.alquiler, ESTADOS.reservado, ESTADOS.vendido, ESTADOS.sin_dato]
            .map(e => {
              const venta = e === ESTADOS.disponible && hayAlquiler;
              const cantidad = UNIDADES.filter(u => aspectoDe(u) === e).length;
              return {
                nombre: venta ? 'En venta' : e.nombre,
                corto: venta ? 'en venta' : cantidad === 1 ? (e.singular || e.nombre.toLowerCase()) : e.plural,
                abrev: venta ? 'venta' : ABREV_ESTADO.get(e),
                color: e.color,
                cantidad
              };
            })
            .filter(e => e.cantidad > 0);
          document.getElementById('aviso').innerHTML =
            '<div class="aviso-barra">' + conteos.map(e =>
              '<span style="flex:' + e.cantidad + ';background:' + e.color + '"></span>'
            ).join('') + '</div>' +
            '<div class="aviso-lista">' + conteos.map(e =>
              '<div class="aviso-fila"><span class="punto" style="background:' + e.color + '"></span>' +
              '<span class="aviso-label">' + e.nombre + '</span><span class="aviso-cant">' + e.cantidad + '</span></div>'
            ).join('') + '</div>';
          fichaResumen.innerHTML = conteos.map(e =>
            '<span class="aviso-item" aria-label="' + e.nombre + ': ' + e.cantidad + ' unidades">' +
            '<span class="punto" style="background:' + e.color + '"></span>' + e.cantidad +
            '<span class="aviso-item-txt"><span class="ai-largo">' + e.corto + '</span>' +
            '<span class="ai-abrev">' + e.abrev + '</span></span></span>'
          ).join('');
          // La misma barra que #aviso, en el resumen de mobile.
          document.getElementById('ficha-barra').innerHTML = conteos.map(e =>
            '<span style="flex:' + e.cantidad + ';background:' + e.color + '"></span>'
          ).join('');
        } else {
          document.getElementById('aviso').hidden = true;
          fichaResumen.textContent = 'Ver ficha';
        }
        // Ficha ya pintada: leyenda abreviada o no, y el riel y Filtros
        // debajo, después del próximo layout.
        pedirAjusteCabezal();
      }
      pintarDisponibilidad();

      /* ============================================================
         2. ESCENA
         ============================================================ */

      // La forma de la placa es dato del proyecto (projects.geometria); si viene
      // vacío (edificio sin geometría propia cargada todavía) se usan los valores
      // de ROSSO como default, para no romper nada.
      const PISOS = proyecto.pisos;
      const geo = proyecto.geometria || {};
      const ANCHO = geo.ancho ?? 5.4, PROF = geo.prof ?? 6.4, ALTO = geo.alto ?? 3,
        LOSA = geo.losa_espesor ?? 0.32, PASO = ALTO + LOSA;
      const SEP_X = geo.sep_x ?? (ANCHO + 0.3), SEP_Z = geo.sep_z ?? ((PROF + 2.0) / 2);
      const LOSA_ANCHO = geo.losa_ancho ?? (SEP_X * 4 + 0.5), LOSA_LARGO = geo.losa_largo ?? (SEP_Z * 2 + PROF + 0.5);
      const NUCLEO_ANCHO = geo.nucleo_ancho ?? (SEP_X * 2), NUCLEO_LARGO = geo.nucleo_largo ?? 1.7;
      const calleCfg = geo.calle || {};
      // Entorno extendido (ver ENTORNO EXTENDIDO más abajo): calles en grilla
      // hasta EXTENSION metros del edificio, que se funden con el horizonte.
      // geometria.calle.extension = 0 lo apaga y vuelve la vista de siempre
      // (disco que se desvanece, fondo fijo y niebla). CUADRA = distancia
      // entre ejes de calles (cuadra montevideana).
      const EXTENSION = Math.max(0, calleCfg.extension ?? 400);
      const CUADRA = calleCfg.cuadra ?? 90;

      // Placas con forma propia (edificios que no son una losa rectangular
      // simétrica) — mismo sistema de coordenadas que units.geom, ver CLAUDE.md.
      // Si faltan, la losa/núcleo siguen siendo el rectángulo de arriba.
      const LOSA_CONTORNO = Array.isArray(geo.losa_contorno) && geo.losa_contorno.length >= 3 ? geo.losa_contorno : null;
      const NUCLEO_CONTORNO = Array.isArray(geo.nucleo_contorno) && geo.nucleo_contorno.length >= 3 ? geo.nucleo_contorno : null;
      const ORIGEN_PLACA = { x: 0, z: 0 };

      // Conjuntos de varias torres sobre un basamento (geometria.torres, p.ej.
      // BRUSCO). Todo lo que depende de esto — losa por torre, calle al frente
      // real, disco, encuadre, filtro por torre — queda apagado cuando falta,
      // así ROSSO/Altamira siguen exactamente por el camino de siempre.
      const TORRES = Array.isArray(geo.torres) && geo.torres.length ? geo.torres : null;
      // Caja envolvente real del conjunto, desde los contornos de las unidades
      // (no desde ANCHO/PROF, que son los de una unidad de grilla).
      const CONJUNTO = (() => {
        if (!TORRES) return null;
        const pts = UNIDADES.flatMap(u => u.geom && Array.isArray(u.geom.contorno) ? u.geom.contorno : []);
        if (!pts.length) return null;
        const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
        return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
      })();
      // Hacia qué eje del modelo da el frente (la calle de la dirección).
      // Por default -Z (ROSSO, Altamira). Cuando los contornos se cargan en
      // ejes reales (+X este, -Z norte, ver CLAUDE.md) el frente puede caer en
      // otro lado — BRUSCO da a Aquiles Lanza = oeste = -X. Todo el entorno de
      // calle (calle, vereda, cartel, árboles, autos, faroles, bancos) se arma
      // igual que siempre en coordenadas "de frente" (calle sobre el eje X, en
      // -Z) y vive en grupoCalle, que gira FRENTE_GIRO para quedar sobre el
      // eje real. La cámara gira lo mismo (ver theta en CÁMARA). El sol NO:
      // se orienta con norte_grados sobre los ejes del modelo, no del frente.
      const FRENTE_GIRO = { '-z': 0, '-x': Math.PI / 2, '+z': Math.PI, '+x': -Math.PI / 2 }[geo.frente_eje] ?? 0;
      // Dirección del frente en el mundo: lo que en grupoCalle es (0, -1).
      const FRENTE_DIR = { x: -Math.sin(FRENTE_GIRO), z: -Math.cos(FRENTE_GIRO) };
      // Barrido lateral de la vista inicial — ver theta en CÁMARA.
      const ANGULO_LATERAL = 0.7;
      const GIRO_LADO = { '-z': 0, '-x': Math.PI / 2, '+z': Math.PI, '+x': -Math.PI / 2 };
      const LADO_FRENTE = geo.frente_eje in GIRO_LADO ? geo.frente_eje : '-z';
      // Cada lado de la manzana en coordenadas "de frente" de ese lado (como
      // grupoCalle, pero girado GIRO_LADO[lado]): borde = -Z local del borde
      // de las unidades + franja de losa; x0/x1 = extensión de la manzana a lo
      // largo de la calle. Rotar no cambia distancias al origen, así que
      // RADIO_DISCO se puede calcular directo en estas coordenadas.
      const LADOS_MANZANA = (() => {
        if (!CONJUNTO) return null;
        const pts = UNIDADES.flatMap(u => u.geom && Array.isArray(u.geom.contorno) ? u.geom.contorno : []);
        const res = {};
        for (const lado in GIRO_LADO) {
          const g = GIRO_LADO[lado];
          const dir = [-Math.sin(g), -Math.cos(g)], ejeX = [Math.cos(g), -Math.sin(g)];
          const px = pts.map(([x, z]) => x * ejeX[0] + z * ejeX[1]);
          // Lados vecinos: el que queda en +X local y el que queda en -X local.
          const ladoDe = (dx, dz) => Object.keys(DIR_LADO).find(l =>
            Math.abs(DIR_LADO[l][0] - dx) < 0.5 && Math.abs(DIR_LADO[l][1] - dz) < 0.5);
          res[lado] = {
            lado, giro: g,
            borde: -Math.max(...pts.map(([x, z]) => x * dir[0] + z * dir[1])) - 0.5,
            x0: Math.min(...px) - 0.5, x1: Math.max(...px) + 0.5,
            ladoMenosX: ladoDe(-ejeX[0], -ejeX[1]), ladoMasX: ladoDe(ejeX[0], ejeX[1]),
          };
        }
        return res;
      })();
      // Calles de los otros lados de la manzana (geometria.calles, hoy solo
      // BRUSCO): el lado del frente ya tiene su calle completa (grupoCalle);
      // los demás lados con nombre cargado suman calzada + vereda + líneas +
      // cartel, sin árboles/autos/mobiliario. Necesita norte_grados para
      // saber qué cardinal es cada lado — sin eso, nada (no se adivina).
      const CALLES_LATERALES = (!LADOS_MANZANA || !geo.calles || geo.norte_grados == null) ? [] :
        Object.keys(GIRO_LADO).filter(l => l !== LADO_FRENTE).map(lado => {
          const nombre = geo.calles[cardinalDe(geo.norte_grados + RUMBO_LADO[lado])];
          return nombre ? { ...LADOS_MANZANA[lado], nombre } : null;
        }).filter(Boolean);
      const hayCalleEn = lado => lado === LADO_FRENTE || CALLES_LATERALES.some(c => c.lado === lado);
      // Frente del edificio (lado calle): con CONJUNTO, el borde real de las
      // unidades más una franja de losa, medido sobre FRENTE_DIR y expresado
      // como -Z local de grupoCalle (con FRENTE_GIRO = 0 es minZ - 0.5, igual
      // que siempre); si no, el de la grilla de siempre.
      const BORDE_FRENTE = CONJUNTO
        ? -Math.max(...UNIDADES.flatMap(u => u.geom && Array.isArray(u.geom.contorno) ? u.geom.contorno : [])
            .map(([x, z]) => x * FRENTE_DIR.x + z * FRENTE_DIR.z)) - 0.5
        : -(SEP_Z + PROF / 2);
      // Radio del disco de base: 30 de siempre, salvo que el conjunto + la
      // calle al frente no entren (BRUSCO, ~42m de lado) — ahí crece hasta
      // que los 44m de calle y la esquina más lejana quepan adentro.
      const RADIO_DISCO = (() => {
        if (!CONJUNTO) return 30;
        const zLejana = BORDE_FRENTE - (calleCfg.vereda ?? 2) - (calleCfg.ancho ?? 8);
        const esquina = Math.max(...[CONJUNTO.minX, CONJUNTO.maxX].flatMap(x =>
          [CONJUNTO.minZ, CONJUNTO.maxZ].map(z => Math.hypot(x, z))));
        // Calles laterales: calzada hasta el cruce con las vecinas (ver
        // tramoCalzada más abajo), y el frente estirado hasta esos cruces.
        const anchoTotal = (calleCfg.vereda ?? 2) + (calleCfg.ancho ?? 8);
        const lejos = [LADOS_MANZANA[LADO_FRENTE], ...CALLES_LATERALES].map(c => {
          const zl = c.borde - anchoTotal;
          const xa = hayCalleEn(c.ladoMenosX) ? c.x0 - anchoTotal : c.x0;
          const xb = hayCalleEn(c.ladoMasX) ? c.x1 + anchoTotal : c.x1;
          return Math.hypot(Math.max(Math.abs(xa), Math.abs(xb)), zl) + 1;
        });
        return Math.max(30, Math.hypot((calleCfg.largo ?? 44) / 2, zLejana) + 1, esquina + 3,
          ...(CALLES_LATERALES.length ? lejos : []));
      })();

      // La medida de la pantalla para la escena (fondo, cámara, lienzo,
      // encuadre) sale de pantalla, no de innerWidth/innerHeight: leerlos acá,
      // con el header y la ficha recién armados, forzaba el layout.
      medirPantalla();
      const escena = new THREE.Scene();
      // FONDO: luz ambiente detrás de la maqueta — más clara donde está la
      // torre y apenas verdosa hacia las esquinas. Es una textura de canvas
      // como scene.background (three la dibuja a pantalla completa, fija,
      // sin seguir a la cámara), rehecha en cada resize para que el círculo
      // no se deforme. Probado primero como radial-gradient de CSS detrás de
      // un canvas transparente: se veía igual, pero el navegador tenía que
      // componer las dos capas en cada frame y los FPS se desplomaban. Con
      // el fondo adentro de WebGL el canvas es opaco (alpha: false) y cuesta
      // un solo quad. La niebla (NIEBLA_COLOR) usa el tono de las esquinas,
      // que es donde llega a notarse.
      // Solo con EXTENSION = 0. Con el entorno extendido el fondo es el domo
      // de cielo (ver cielo) y no hay niebla: teñía también el edificio — en
      // celular, con radio 190, entre ~20 y ~55 % en la vista inicial.
      function pintarFondo() {
        const w = Math.max(2, Math.round(pantalla.ancho / 2)), h = Math.max(2, Math.round(pantalla.alto / 2));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        // = radial-gradient(circle at 55% 45%, ...) de CSS: radio hasta la
        // esquina más lejana.
        const cx = w * 0.55, cy = h * 0.45;
        const r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, '#FFFFFF');
        grad.addColorStop(0.42, '#F7F9F7');
        grad.addColorStop(1, '#EEF2EF');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        if (escena.background) escena.background.dispose();
        escena.background = new THREE.CanvasTexture(cv);
      }
      if (!EXTENSION) {
        pintarFondo();
        escena.fog = new THREE.Fog(0xF1F4F2, 130, 280);
      }

      // Grupo que gira en el lugar (ver GIRO en CÁMARA): el edificio + su
      // terreno + calle/vereda/árboles/autos/cartel + el sol — todo el sitio
      // original, como un conjunto rígido. Probado al revés primero (solo
      // el edificio+disco adentro, calle/vereda/árboles afuera) y quedó mal:
      // una calle recta fija con la torre girando en diagonal sobre ella se
      // ve rota — la calle tiene que seguir pegada al frente del edificio
      // sea cual sea el giro. El sol viaja adentro del grupo a propósito: si
      // solo rotara la geometría y la luz se quedara fija en el mundo, la
      // sombra se correría por la fachada cada vez que el conjunto gira —
      // así, la relación luz↔edificio es siempre la misma (la sombra no se
      // "desalinea"), y lo que cambia con la rotación es de qué lado del
      // mundo real viene el sol, no cómo cae sobre el edificio.
      const grupoEdificio = new THREE.Group();
      escena.add(grupoEdificio);
      // Entorno de calle, en coordenadas "de frente" — ver FRENTE_GIRO.
      const grupoCalle = new THREE.Group();
      grupoCalle.rotation.y = FRENTE_GIRO;
      grupoEdificio.add(grupoCalle);

      // near = 1 (no 0.1): la precisión de profundidad escala con near, y con
      // 0.1 a radio 190 el error rondaba los 3 cm — más que el centímetro
      // entre asfalto, líneas y veredas, que parpadeaban al girar. La cámara
      // nunca queda a menos de unos metros de nada (radio mínimo 34).
      // far: con el entorno extendido tiene que alcanzar el piso hasta donde
      // termina de fundirse (EXTENSION) desde el radio máximo (190) con el
      // objetivo corrido, y dejar adentro el domo de cielo. Subirlo casi no
      // cambia la precisión (la manda near): a 300 m el paso es ~5 mm, y más
      // lejos todo ya tiene el mismo color.
      const LEJOS = EXTENSION ? Math.max(1100, EXTENSION + 700) : 600;
      const camara = new THREE.PerspectiveCamera(38, pantalla.ancho / pantalla.alto, 1, LEJOS);
      const render = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      render.setPixelRatio(Math.min(devicePixelRatio, 2));
      render.setSize(pantalla.ancho, pantalla.alto);
      render.setClearColor(0xF7F9F7, 1);
      render.shadowMap.enabled = true;
      render.shadowMap.type = THREE.PCFSoftShadowMap;
      // Sin tone mapping (default NoToneMapping): se probó ACESFilmicToneMapping
      // en su momento para el resplandor del sol del shader de cielo que
      // había antes (ya no existe) y apagaba el blanco de la losa/núcleo/
      // base — sin ese shader no hay motivo para tocarlo.
      document.body.appendChild(render.domElement);

      // ENTORNO EXTENDIDO (EXTENSION > 0): piso, calles y veredas siguen hasta
      // EXTENSION metros y se funden con el horizonte. Tres piezas:
      // - cielo: domo que acompaña a la cámara, color según la altura de cada
      //   dirección sobre el horizonte. Debajo del horizonte es
      //   COLOR_HORIZONTE parejo, el mismo al que se funde el piso: el borde
      //   del piso no se ve desde ninguna altura ni ángulo.
      // - conFundido(material): mezcla el color final de un material del
      //   entorno con COLOR_HORIZONTE según la distancia horizontal al eje de
      //   giro (el origen de grupoEdificio: no cambia al girar). Nunca va en
      //   los materiales del edificio, que no se tiñen a ninguna distancia.
      // - la grilla de calles (ver EJES_X / EJES_Z).
      const COLOR_HORIZONTE = new THREE.Color(0xEBEFEC), COLOR_CENIT = new THREE.Color(0xF9FBFA);
      // Empieza donde termina el entorno de siempre (RADIO_DISCO: calle de 44 m,
      // árboles, autos) y se completa antes del final de las calles, así su
      // punta nunca se ve.
      const FUNDIDO_DESDE = Math.min(RADIO_DISCO, EXTENSION * 0.5), FUNDIDO_HASTA = EXTENSION * 0.8;
      let cielo = null;
      if (EXTENSION) {
        // Pocos segmentos alcanzan: el domo está centrado en la cámara, así que
        // cada punto de una cara cae sobre el rayo de su píxel y el degradé sale
        // exacto igual.
        cielo = new THREE.Mesh(
          new THREE.SphereGeometry(LEJOS - 100, 16, 8),
          new THREE.ShaderMaterial({
            uniforms: { uHorizonte: { value: COLOR_HORIZONTE }, uCenit: { value: COLOR_CENIT } },
            // z = w: profundidad máxima (como el fondo de three), así se pinta
            // solo donde no hay nada adelante.
            vertexShader: `varying vec3 vDir;
              void main() {
                vDir = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                gl_Position.z = gl_Position.w;
              }`,
            fragmentShader: `uniform vec3 uHorizonte, uCenit;
              varying vec3 vDir;
              void main() {
                gl_FragColor = vec4( mix( uHorizonte, uCenit, smoothstep( 0.0, 0.5, normalize( vDir ).y ) ), 1.0 );
              }`,
            side: THREE.BackSide, depthWrite: false,
          })
        );
        // Último de lo opaco (antes de las unidades, que son transparentes y se
        // mezclan con lo de atrás): con el test de profundidad solo pinta los
        // píxeles vacíos, no la pantalla entera debajo del piso. Sigue a la
        // cámara en ubicarCamara().
        cielo.renderOrder = 2;
        cielo.frustumCulled = false;
        escena.add(cielo);
      }

      // Uniforms compartidos por todos los materiales con fundido: se fijan una
      // vez y valen para todos. uRangoSombra se completa en SOL, cuando se
      // conoce el radio de la cámara de sombra.
      const FUNDIDO = {
        uColorFundido: { value: COLOR_HORIZONTE },
        uRangoFundido: { value: new THREE.Vector2(FUNDIDO_DESDE, FUNDIDO_HASTA) },
        uRangoSombra: { value: new THREE.Vector2(1e5, 1e5) },
      };
      // La sombra del sol también se desvanece con la distancia, antes de que
      // termine su cámara: con el piso extendido, la punta de una sombra larga
      // (sol bajo) se cortaba en una línea recta. Se reemplaza getShadow() en
      // las luces de este material por una versión que la mezcla hacia "sin
      // sombra" y que, ya fuera del rango, ni lee el mapa (ahorra las lecturas
      // de PCF en celular, donde el piso cubre casi toda la pantalla).
      const LUCES_CON_FUNDIDO = THREE.ShaderChunk.lights_fragment_begin.replace(/\bgetShadow\(/g, 'getShadowFundido(');
      function conFundido(mat) {
        if (!EXTENSION) return mat;
        mat.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, FUNDIDO);
          shader.vertexShader = 'varying vec2 vPosFundido;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
            vec4 posFundido = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
              posFundido = instanceMatrix * posFundido;
            #endif
            vPosFundido = ( modelMatrix * posFundido ).xz;`);
          shader.fragmentShader = 'varying vec2 vPosFundido;\nuniform vec3 uColorFundido;\nuniform vec2 uRangoFundido, uRangoSombra;\n' +
            shader.fragmentShader
              .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
                #ifdef USE_SHADOWMAP
                float getShadowFundido( sampler2D mapa, vec2 tam, float sesgo, float radio, vec4 coord ) {
                  float k = 1.0 - smoothstep( uRangoSombra.x, uRangoSombra.y, length( vPosFundido ) );
                  if ( k <= 0.0 ) return 1.0;
                  return mix( 1.0, getShadow( mapa, tam, sesgo, radio, coord ), k );
                }
                #endif`)
              .replace('#include <lights_fragment_begin>', LUCES_CON_FUNDIDO)
              // Curva ease-out cúbica (no smoothstep): pierde contraste rápido
              // en las primeras cuadras (~50 % a una cuadra del entorno de
              // siempre, ~90 % a dos) y se apaga suave al final. Con smoothstep
              // las calles a una o dos cuadras seguían casi oscuras y
              // competían con el edificio, también a través de las unidades.
              .replace('#include <fog_fragment>', `#include <fog_fragment>
                float tFundido = 1.0 - clamp( ( length( vPosFundido ) - uRangoFundido.x ) / ( uRangoFundido.y - uRangoFundido.x ), 0.0, 1.0 );
                gl_FragColor.rgb = mix( gl_FragColor.rgb, uColorFundido, 1.0 - tFundido * tFundido * tFundido );`);
        };
        return mat;
      }

      // Piezas del entorno en una sola malla por material: toda la grilla de un
      // material es un draw call, no un Mesh por tramo.
      // - rects: rectángulos horizontales [x0, x1, z0, z1, uv?] a altura y;
      //   uv(x, z) → [u, v] (por defecto, en metros).
      // - caras: verticales [ax, az, bx, bz], de 0 a `alto`, con la normal
      //   (bz − az, 0, −(bx − ax)): para una normal n, ir de A a B en (−nz, nx).
      function geometriaPiezas({ rects = [], y = 0, caras = [], alto = 0 }) {
        const pos = [], nor = [], uv = [], idx = [];
        for (const [x0, x1, z0, z1, f = (x, z) => [x, z]] of rects) {
          const b = pos.length / 3;
          for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
            pos.push(x, y, z); nor.push(0, 1, 0); uv.push(...f(x, z));
          }
          idx.push(b, b + 2, b + 1, b, b + 3, b + 2); // cara hacia +Y
        }
        for (const [ax, az, bx, bz] of caras) {
          const b = pos.length / 3, l = Math.hypot(bx - ax, bz - az);
          pos.push(ax, 0, az, bx, 0, bz, bx, alto, bz, ax, alto, az);
          for (let i = 0; i < 4; i++) nor.push((bz - az) / l, 0, -(bx - ax) / l);
          uv.push(0, 0, l, 0, l, alto, 0, alto);
          idx.push(b, b + 3, b + 2, b, b + 2, b + 1); // (A, A', B') y (A, B', B)
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        return g;
      }
      // Cajas [x0, x1, y0, y1, z0, z1] en una malla: tapa y cuatro lados (la base
      // nunca se ve). Cada cara, con sus esquinas antihorarias vistas desde afuera.
      function geometriaCajas(cajas) {
        const pos = [], nor = [], idx = [];
        const cara = (n, ...esquinas) => {
          const b = pos.length / 3;
          for (const p of esquinas) { pos.push(...p); nor.push(...n); }
          idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        };
        for (const [x0, x1, y0, y1, z0, z1] of cajas) {
          cara([0, 1, 0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
          cara([0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
          cara([0, 0, -1], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
          cara([1, 0, 0], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
          cara([-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setIndex(idx);
        return g;
      }

      // Iluminación de maqueta: UNA sola luz principal (sol, direccional, la
      // que proyecta sombras) + una hemisférica de ambiente. El simulador
      // solar (aplicarSol) mueve y tiñe esa misma luz — no hay una "luz de
      // estudio" aparte que después haya que apagar. Sin tone mapping, lo
      // que llega a una cara es albedo × (ambiente + sol·cosθ): con 0.9 + 1.0
      // de antes las caras al sol pasaban de 1 y se recortaban a blanco (se
      // perdía el volumen); con estos valores una cara de arriba llega a
      // ~1.2, una fachada al sol a ~1 y una a la sombra a ~0.65 — lectura de
      // volumen sin sombras negras. El suelo de la hemisférica es claro a
      // propósito: la cara de abajo de losas y balcones rebota luz del
      // terreno en vez de quedar en gris sucio.
      const hemi = new THREE.HemisphereLight(0xFFFFFF, 0xCDD3CF, 0.74);
      escena.add(hemi);
      const sol = new THREE.DirectionalLight(0xFFF6E8, 0.62);
      sol.position.set(-34, 58, 30);
      sol.castShadow = true;
      sol.shadow.mapSize.set(2048, 2048);
      const sc = sol.shadow.camera;
      grupoEdificio.add(sol);

      // Calidad de sombra de árboles en pantallas chicas.
      const CIELO_ALTA = pantalla.ancho >= 760;

      // Terreno: un disco plano (sin canto) que se desvanece contra el fondo.
      // Opaco hasta ~0.8 del radio de siempre y transparente del todo a 1.3 —
      // así no se lee como un plato flotando. El fundido es alpha (no color):
      // donde llega a 0 se ve el degradado de fondo (pintarFondo) tal cual,
      // sin tener que adivinar su tono. Recibe la sombra del sol, que se desvanece con él
      // (antes caía sobre un plano aparte y se cortaba fuera del disco).
      // renderOrder negativo: es transparente, pero tiene que dibujarse antes
      // que las unidades (también transparentes) para que se vea a través de
      // ellas; sin depthWrite no tapa nada de lo que viene después. La calle
      // y la vereda son opacas y están apenas por encima: le ganan en z.
      const RADIO_TERRENO = RADIO_DISCO * 1.3;
      function crearTexturaTerreno() {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 512;
        const ctx = cv.getContext('2d');
        const r = cv.width / 2;
        const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
        const opaco = 0.8 / 1.3;
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(opaco, 'rgba(255,255,255,1)');
        grad.addColorStop(opaco + (1 - opaco) * 0.45, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cv.width, cv.height);
        return new THREE.CanvasTexture(cv);
      }
      // Albedo más bajo que el tono buscado (#E7E6DC): con ambiente + sol
      // encima una cara horizontal recibe ~1.2 y el sol es cálido, así que
      // este gris neutro llega a beige gris claro sin amarillear.
      // Con EXTENSION: el mismo color, pero opaco y hasta donde llegan las
      // calles; el fundido es de color (conFundido), no de alpha. Al ser
      // opaco se dibuja antes que las unidades sin renderOrder.
      const matTerreno = EXTENSION
        ? conFundido(new THREE.MeshStandardMaterial({
          color: 0xB5B7B3, roughness: 0.95,
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        }))
        : new THREE.MeshStandardMaterial({
          color: 0xB5B7B3, map: crearTexturaTerreno(), roughness: 0.95,
          transparent: true, depthWrite: false,
          // Empujado hacia atrás en profundidad: se dibuja después de la calle
          // (pasada transparente) y a 2 cm debajo, así que sin esto le ganaba
          // al asfalto en parches claros al girar.
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        });
      const terreno = new THREE.Mesh(EXTENSION
        ? new THREE.CircleGeometry(EXTENSION + 10, 128)
        : new THREE.CircleGeometry(RADIO_TERRENO, 96), matTerreno);
      terreno.rotation.x = -Math.PI / 2;
      terreno.receiveShadow = true;
      // Con EXTENSION, después del resto de lo opaco (calles, veredas, losas):
      // lo que lo tapa ya escribió la profundidad y esos píxeles del piso ni se
      // sombrean. Cubre casi toda la pantalla, así que es lo que más pesa.
      terreno.renderOrder = EXTENSION ? 1 : -2;
      grupoEdificio.add(terreno);

      // Calle: franja de asfalto frente al edificio (lado "frente", ver NOMBRE_CALLE
      // más abajo), vereda elevada con cordón (escalón real, no pintado) y línea de
      // carril discontinua + bordes, para que quede claro a simple vista que ese
      // lado da a una vía vehicular y no es un lado cualquiera.
      const ANCHO_CALLE = calleCfg.ancho ?? 8, LARGO_CALLE = calleCfg.largo ?? 44, VEREDA = calleCfg.vereda ?? 2;
      const VEREDA_ALTO = calleCfg.vereda_alto ?? 0.12;
      const Z_CALLE = BORDE_FRENTE - VEREDA - ANCHO_CALLE / 2;

      // Grilla de calles (con EXTENSION), en coordenadas de grupoCalle: así
      // queda alineada con los ejes de cada proyecto. Transversales (corren en
      // Z) en EJES_X, paralelas al frente (corren en X) en EJES_Z, una cada
      // CUADRA hacia afuera de las calles reales:
      // - paralelas: la del frente (Z_CALLE) y, si existe, la de atrás
      //   (geometria.calles, BRUSCO);
      // - transversales: las laterales reales (BRUSCO) o, sin ellas,
      //   geometria.calle.cruce_x: el eje de una transversal, en metros sobre
      //   el frente desde el centro del edificio (parado en la calle mirando
      //   la fachada, negativo = a la derecha). Sin el dato, el edificio queda
      //   a mitad de cuadra (ejes en ±CUADRA/2).
      // La calzada del frente y las laterales quedan dentro de la grilla
      // (mismos ejes), así que con EXTENSION no se arman aparte; veredas,
      // líneas, carteles y todo lo demás de cerca del edificio, sí.
      const EJES_X = [], EJES_Z = [];
      if (EXTENSION) {
        const anclasX = [], anclasZ = [Z_CALLE];
        for (const c of CALLES_LATERALES) {
          // Eje de la lateral en coordenadas de su lado (ver el bucle de
          // calles laterales), girado a las de grupoCalle.
          const a = c.giro - FRENTE_GIRO, zc = c.borde - VEREDA - ANCHO_CALLE / 2;
          if (Math.abs(Math.sin(a)) > 0.5) anclasX.push(zc * Math.sin(a));
          else anclasZ.push(zc * Math.cos(a));
        }
        if (!anclasX.length) anclasX.push(calleCfg.cruce_x ?? CUADRA / 2);
        const lim = EXTENSION + 10;
        for (const [anclas, ejes] of [[anclasX, EJES_X], [anclasZ, EJES_Z]]) {
          anclas.sort((a, b) => a - b);
          for (let v = anclas[0] - CUADRA; v > -lim; v -= CUADRA) ejes.push(v);
          ejes.push(...anclas);
          for (let v = anclas[anclas.length - 1] + CUADRA; v < lim; v += CUADRA) ejes.push(v);
          ejes.sort((a, b) => a - b);
        }
      }
      // ¿Algo de ±medio a lo largo del frente, en x, cae en una transversal?
      // Hoy solo ROSSO (esquina Paullier) tiene una dentro del tramo de 44 m:
      // lo de la calle del frente que cae ahí se corta o se saca.
      // Intervalos libres entre las calzadas de unos ejes: a lo largo de una
      // paralela, los tramos entre transversales (y al revés). También son los
      // lados de las manzanas; MANZANA_EDIFICIO, la que contiene el origen.
      const L_GRILLA = EXTENSION + 10;
      const libresEntre = ejes => {
        const cortes = [-L_GRILLA, ...ejes.flatMap(e => [e - ANCHO_CALLE / 2, e + ANCHO_CALLE / 2]), L_GRILLA], r = [];
        for (let i = 0; i < cortes.length; i += 2) if (cortes[i + 1] > cortes[i]) r.push([cortes[i], cortes[i + 1]]);
        return r;
      };
      const TRAMOS_X = EXTENSION ? libresEntre(EJES_X) : [], TRAMOS_Z = EXTENSION ? libresEntre(EJES_Z) : [];
      const MANZANA_EDIFICIO = EXTENSION
        ? { x: TRAMOS_X.find(([a, b]) => a < 0 && b > 0), z: TRAMOS_Z.find(([a, b]) => a < 0 && b > 0) } : null;
      const enCruce = (x, medio) => EJES_X.some(e => Math.abs(x - e) < ANCHO_CALLE / 2 + medio);
      // Sendas peatonales (cebras): franja de CEBRA_ANCHO que arranca a
      // CEBRA_DESDE del borde de la calzada que cruza. Lo que se corre por un
      // cruce (cartel, autos) deja libre también esta franja.
      const CEBRA_DESDE = 0.3, CEBRA_ANCHO = 3, ZONA_CEBRA = EXTENSION ? CEBRA_DESDE + CEBRA_ANCHO : 0;

      const matCalle = conFundido(new THREE.MeshStandardMaterial({ color: 0x686F72, roughness: 0.95 }));
      // Vereda + cordón: el escalón es volumen real (cara de arriba = vereda,
      // cara que mira a la calzada = cordón), así la diferencia de altura
      // proyecta sombra real, no un color plano fingiéndola.
      const matVereda = conFundido(new THREE.MeshStandardMaterial({ color: 0xCBCFCF, roughness: 0.9 }));
      const matCordonCara = conFundido(new THREE.MeshStandardMaterial({ color: 0xF2F3F4, roughness: 0.8 }));
      const geoGuion = new THREE.PlaneGeometry(1.6, 0.2);
      // polygonOffset: la pintura está a 1 cm del asfalto — le gana en
      // profundidad aunque la cámara esté lejos o rasante.
      const matGuion = conFundido(new THREE.MeshStandardMaterial({
        color: 0xEDEFEF, roughness: 0.6,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }));

      // Textura de asfalto: un canvas generado una vez, sin archivos. Grano
      // fino, manchas suaves y algo de árido claro, todo muy bajo: de lejos
      // (mipmaps) se lee el mismo gris de siempre (#686F72). Dos variantes:
      // - con línea central discontinua (guiones de 1,6 m cada 2,8 m, como
      //   los de siempre): u a lo largo de la calle (repite cada
      //   TRAMO_TEXTURA), v a lo ancho de la calzada (0 a 1). La línea va en
      //   la textura y no como geometría: miles de guiones finos titilaban al
      //   girar el edificio; filtrada (mipmaps + anisotropía) no, y no suma
      //   draw calls.
      // - lisa, para los cruces y los primeros metros de cada cuadra (la
      //   línea se corta antes de la esquina y de la cebra), en metros.
      const TRAMO_TEXTURA = 2.8 * 4, LADO_TEXTURA_LISA = 8;
      function texturaAsfalto(conLinea) {
        const W = conLinea ? 1024 : 512, H = 512;
        const mU = conLinea ? TRAMO_TEXTURA : LADO_TEXTURA_LISA, mV = conLinea ? ANCHO_CALLE : LADO_TEXTURA_LISA;
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
        const t = new THREE.CanvasTexture(cv); // potencia de 2: mipmaps por defecto
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = conLinea ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        t.anisotropy = render.capabilities.getMaxAnisotropy();
        return t;
      }

      if (EXTENSION) {
        const m = ANCHO_CALLE / 2, V = VEREDA, tramosX = TRAMOS_X, tramosZ = TRAMOS_Z;

        // Calzada: cada cuadra con línea central salvo sus primeros y últimos
        // TOPE metros, que van lisos como los cruces.
        const TOPE = 5;
        const uvLinea = (enX, centro) => (x, z) => enX
          ? [x / TRAMO_TEXTURA, (z - centro + m) / ANCHO_CALLE]
          : [z / TRAMO_TEXTURA, (x - centro + m) / ANCHO_CALLE];
        const uvLiso = (x, z) => [x / LADO_TEXTURA_LISA, z / LADO_TEXTURA_LISA];
        const conLinea = [], lisos = [];
        const cuadra = (a, b, rect) => {
          if (b - a > 2 * TOPE + 1) {
            lisos.push(rect(a, a + TOPE), rect(b - TOPE, b));
            conLinea.push(rect(a + TOPE, b - TOPE, true));
          } else lisos.push(rect(a, b));
        };
        for (const z of EJES_Z) for (const [a, b] of tramosX)
          cuadra(a, b, (p, q, linea) => [p, q, z - m, z + m, linea ? uvLinea(true, z) : uvLiso]);
        for (const x of EJES_X) for (const [a, b] of tramosZ)
          cuadra(a, b, (p, q, linea) => [x - m, x + m, p, q, linea ? uvLinea(false, x) : uvLiso]);
        for (const x of EJES_X) for (const z of EJES_Z) lisos.push([x - m, x + m, z - m, z + m, uvLiso]);
        for (const [rects, conTextura] of [[conLinea, true], [lisos, false]]) {
          const malla = new THREE.Mesh(geometriaPiezas({ rects, y: 0.02 }),
            conFundido(new THREE.MeshStandardMaterial({ map: texturaAsfalto(conTextura), roughness: 0.95 })));
          malla.receiveShadow = true;
          grupoCalle.add(malla);
        }

        // Veredas: un anillo de VEREDA por manzana, a VEREDA_ALTO, con el cordón
        // hacia la calle y el borde de adentro (hacia el interior de la
        // manzana) del color de la vereda. La de la manzana del edificio cae
        // justo donde iban las veredas sueltas de antes (BORDE_FRENTE y, en
        // BRUSCO, el borde de cada lateral).
        const veredas = [], bordesInternos = [], cordones = [];
        for (const [xa, xb] of tramosX) for (const [za, zb] of tramosZ) {
          veredas.push([xa, xb, za, za + V], [xa, xb, zb - V, zb], [xa, xa + V, za + V, zb - V], [xb - V, xb, za + V, zb - V]);
          cordones.push([xa, za, xb, za], [xb, zb, xa, zb], [xa, zb, xa, za], [xb, za, xb, zb]);
          const ia = xa + V, ib = xb - V, ja = za + V, jb = zb - V;
          bordesInternos.push([ib, ja, ia, ja], [ia, jb, ib, jb], [ia, ja, ia, jb], [ib, jb, ib, ja]);
        }
        const mallaVereda = new THREE.Mesh(
          geometriaPiezas({ rects: veredas, y: VEREDA_ALTO, caras: bordesInternos, alto: VEREDA_ALTO }), matVereda);
        const mallaCordon = new THREE.Mesh(geometriaPiezas({ caras: cordones, alto: VEREDA_ALTO }), matCordonCara);
        for (const malla of [mallaVereda, mallaCordon]) {
          malla.castShadow = malla.receiveShadow = true;
          grupoCalle.add(malla);
        }

        // Cebras en las cuatro esquinas de la manzana del edificio (la que
        // contiene el origen): en cada cruce, una por brazo, de cordón a
        // cordón — barras de 0,5 m a lo largo de la calle, cada 1 m.
        const i = EJES_X.findIndex(e => e > 0), j = EJES_Z.findIndex(e => e > 0);
        const BARRA = 0.5, MARGEN = 0.4;
        const nBarras = Math.floor((ANCHO_CALLE - 2 * MARGEN + BARRA) / (2 * BARRA));
        const inicio = -(2 * nBarras - 1) * BARRA / 2;
        const barras = [];
        if (i > 0 && j > 0) for (const x of [EJES_X[i - 1], EJES_X[i]]) for (const z of [EJES_Z[j - 1], EJES_Z[j]]) {
          for (const s of [-1, 1]) {
            const xa = s > 0 ? x + m + CEBRA_DESDE : x - m - CEBRA_DESDE - CEBRA_ANCHO;
            const za = s > 0 ? z + m + CEBRA_DESDE : z - m - CEBRA_DESDE - CEBRA_ANCHO;
            for (let k = 0; k < nBarras; k++) {
              const t = inicio + 2 * k * BARRA;
              barras.push([xa, xa + CEBRA_ANCHO, z + t, z + t + BARRA]); // brazo de la paralela
              barras.push([x + t, x + t + BARRA, za, za + CEBRA_ANCHO]); // brazo de la transversal
            }
          }
        }
        if (barras.length) {
          const cebras = new THREE.Mesh(geometriaPiezas({ rects: barras, y: 0.03 }), matGuion);
          cebras.receiveShadow = true;
          grupoCalle.add(cebras);
        }
      } else {
        const calle = new THREE.Mesh(new THREE.PlaneGeometry(LARGO_CALLE, ANCHO_CALLE), matCalle);
        calle.rotation.x = -Math.PI / 2;
        calle.position.set(0, 0.02, Z_CALLE);
        calle.receiveShadow = true;
        grupoCalle.add(calle);
      }

      // Tramo de calzada (asfalto solo) de xa a xb, centrado en zc, en el grupo
      // dado. Los tramos se pisan en los cruces: mismo material y color, así
      // que el z-fighting entre planos casi coplanares no se ve.
      function tramoCalzada(grupo, xa, xb, zc, y) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, ANCHO_CALLE), matCalle);
        m.rotation.x = -Math.PI / 2;
        m.position.set((xa + xb) / 2, y, zc);
        m.receiveShadow = true;
        grupo.add(m);
      }
      // Con calles laterales, la calzada del frente sigue hasta cruzarlas
      // (debajo de la de siempre, que conserva largo, líneas, autos y árboles).
      // Con EXTENSION ya lo cubre la grilla.
      if (CALLES_LATERALES.length && !EXTENSION) {
        const f = LADOS_MANZANA[LADO_FRENTE], ext = VEREDA + ANCHO_CALLE;
        tramoCalzada(grupoCalle,
          Math.min(-LARGO_CALLE / 2, hayCalleEn(f.ladoMenosX) ? f.x0 - ext : -LARGO_CALLE / 2),
          Math.max(LARGO_CALLE / 2, hayCalleEn(f.ladoMasX) ? f.x1 + ext : LARGO_CALLE / 2),
          Z_CALLE, 0.018);
      }

      // Sin EXTENSION, las piezas de siempre: vereda del frente (una sola malla:
      // el box ES el escalón, material por cara), guiones y borde. Con
      // EXTENSION las pone la grilla (veredas en anillo, línea en la textura);
      // el borde continuo marcaba el lado sin vereda y ya no hay ninguno.
      if (!EXTENSION) {
        const vereda = new THREE.Mesh(
          new THREE.BoxGeometry(LARGO_CALLE, VEREDA_ALTO, VEREDA),
          [matVereda, matVereda, matVereda, matVereda, matVereda, matCordonCara]
        );
        vereda.position.set(0, VEREDA_ALTO / 2, BORDE_FRENTE - VEREDA / 2);
        vereda.castShadow = vereda.receiveShadow = true;
        grupoCalle.add(vereda);

        for (let x = -LARGO_CALLE / 2 + 2; x < LARGO_CALLE / 2 - 2; x += 2.8) {
          const guion = new THREE.Mesh(geoGuion, matGuion);
          guion.rotation.x = -Math.PI / 2;
          guion.position.set(x, 0.03, Z_CALLE);
          grupoCalle.add(guion);
        }

        // Línea de borde del lado opuesto a la vereda (el que no tiene cordón) —
        // continua, no discontinua, como el borde real de una calzada.
        const bordeCalzada = new THREE.Mesh(new THREE.PlaneGeometry(LARGO_CALLE, 0.12), matGuion);
        bordeCalzada.rotation.x = -Math.PI / 2;
        bordeCalzada.position.set(0, 0.03, Z_CALLE - ANCHO_CALLE / 2 + 0.15);
        grupoCalle.add(bordeCalzada);
      }

      /* ============================================================
         3. TORRE
         ============================================================ */

      const torre = new THREE.Group();
      grupoEdificio.add(torre);

      const geoUnidad = new THREE.BoxGeometry(ANCHO, ALTO, PROF);
      const bordesGeo = new THREE.EdgesGeometry(geoUnidad);
      const geoLosa = LOSA_CONTORNO ? geometriaExtruida(LOSA_CONTORNO, LOSA, ORIGEN_PLACA) : new THREE.BoxGeometry(LOSA_ANCHO, LOSA, LOSA_LARGO);
      const geoNucleo = NUCLEO_CONTORNO ? geometriaExtruida(NUCLEO_CONTORNO, ALTO, ORIGEN_PLACA) : new THREE.BoxGeometry(NUCLEO_ANCHO, ALTO, NUCLEO_LARGO);
      // Losas claras: su canto es la línea que separa un piso del siguiente,
      // y con la luz nueva (sin recorte a blanco) un gris medio se perdía
      // contra las unidades grises.
      const matLosa = new THREE.MeshStandardMaterial({ color: 0xE1E5E3, roughness: 0.9 });
      const matNucleo = new THREE.MeshStandardMaterial({ color: 0xC9CFCD, roughness: 0.9 });
      // Aristas de las unidades (también el objetivo de aplicar()).
      const BORDE_OPACIDAD = 0.32;

      // Todo lo que puede taparle el sol a una unidad — losas, núcleo, PB, y
      // (agregadas más abajo) el resto de las cajas — para el chequeo "¿esta
      // unidad tiene sol ahora?" del panel (ver actualizarSolUnidad()).
      const pisosGrupo = [], cajas = [], ocludoresSol = [];

      // Planta baja: nivel de ingreso, debajo del piso 1. Todavía no está
      // definido cómo se divide (local, hall, cocheras...), así que por ahora
      // es solo un volumen — pero el edificio no puede arrancar directo en el
      // piso 1 como si no hubiera PB.
      const geoPB = new THREE.BoxGeometry(LOSA_ANCHO, ALTO, LOSA_LARGO);
      const matPB = new THREE.MeshStandardMaterial({ color: 0xC7CBCC, roughness: 0.9, transparent: true, opacity: 0.55 });

      // Placas de un conjunto con varias torres (solo con TORRES): no hay una
      // losa única del edificio, así que cada piso arma la suya desde los
      // contornos reales de las unidades que tiene — una envolvente por torre,
      // agrandada 0.5m. El basamento da la huella de PB, de los niveles
      // comerciales sin unidades (nivel 1 de BRUSCO) y del techo del podio
      // (el primer nivel de torres). Sin nucleo_contorno no se dibuja núcleo:
      // uno genérico quedaría flotando entre las dos torres.
      const puntosDe = lista => lista.flatMap(u => u.geom && Array.isArray(u.geom.contorno) ? u.geom.contorno : []);
      const placaDe = pts => pts.length >= 3 ? expandirConvexo(envolventeConvexa(pts), 0.5) : null;
      const NIVELES_BASAMENTO = TORRES
        ? new Set((geo.basamento && geo.basamento.niveles) || UNIDADES.filter(u => torreDe(u) === 'Basamento').map(u => u.piso))
        : null;
      const TECHO_BASAMENTO = TORRES && NIVELES_BASAMENTO.size ? Math.max(...NIVELES_BASAMENTO) : 0;
      const PLACA_BASAMENTO = TORRES
        ? placaDe(puntosDe(UNIDADES.filter(u => NIVELES_BASAMENTO.has(u.piso)))) || placaDe(puntosDe(UNIDADES))
        : null;
      const geoPlacaBasamento = PLACA_BASAMENTO ? geometriaExtruida(PLACA_BASAMENTO, LOSA, ORIGEN_PLACA) : null;
      const geoVolumenBasamento = PLACA_BASAMENTO ? geometriaExtruida(PLACA_BASAMENTO, ALTO, ORIGEN_PLACA) : null;

      // Niveles sin unidades por debajo del basamento (PB, locales del nivel
      // 1): mismo volumen translúcido que la PB, con la huella del basamento.
      function esNivelComercial(piso) {
        return !!PLACA_BASAMENTO && piso < Math.min(...UNIDADES.map(u => u.piso)) && !UNIDADES.some(u => u.piso === piso);
      }

      // Geometrías de losa de un piso con TORRES: el techo del podio usa una
      // sola envolvente (basamento + lo que arranque encima) para no apilar
      // dos losas en el mismo plano; el resto, una por torre.
      function losasPorTorre(piso) {
        const enPiso = UNIDADES.filter(u => u.piso === piso);
        if (!enPiso.length) return esNivelComercial(piso) ? [geoPlacaBasamento] : [];
        if (piso === TECHO_BASAMENTO + 1) {
          const techo = placaDe(puntosDe(UNIDADES.filter(u => NIVELES_BASAMENTO.has(u.piso))).concat(puntosDe(enPiso)));
          return techo ? [geometriaExtruida(techo, LOSA, ORIGEN_PLACA)] : [];
        }
        const porTorre = {};
        enPiso.forEach(u => (porTorre[torreDe(u) || ''] || (porTorre[torreDe(u) || ''] = [])).push(u));
        return Object.values(porTorre)
          .map(lista => placaDe(puntosDe(lista)))
          .filter(Boolean)
          .map(placa => geometriaExtruida(placa, LOSA, ORIGEN_PLACA));
      }

      const pb = new THREE.Group();
      pb.position.y = 0;
      pb.userData = { offset: 0, objetivo: 0 };

      const losaPB = new THREE.Mesh(geoPlacaBasamento || geoLosa, matLosa);
      losaPB.position.y = -LOSA / 2;
      losaPB.castShadow = losaPB.receiveShadow = true;
      pb.add(losaPB);

      const volumenPB = new THREE.Mesh(geoVolumenBasamento || geoPB, matPB);
      volumenPB.position.y = ALTO / 2;
      volumenPB.receiveShadow = true;
      pb.add(volumenPB);

      torre.add(pb);
      pisosGrupo.push(pb);
      ocludoresSol.push(losaPB, volumenPB);

      // Sombra de contacto: franja oscura y angosta pegada al pie de la PB,
      // para que el edificio se apoye en el terreno sea cual sea la posición
      // del sol. Es oclusión ambiente (el cielo que tapa el propio edificio
      // oscurece el pie de cualquier fachada a cualquier hora), no sombra del
      // sol: por eso no se mueve con el simulador. Hasta 2026-10-14 tenía
      // además un halo ancho (3 m de difuminado) que sí se leía como sombra
      // del sol y la contradecía: con el sol de mediodía sobre una fachada,
      // su vereda quedaba con una franja gris. La sombra del sol la pone el
      // shadow map. Una textura hecha una vez en canvas (sin pasada de
      // render extra ni shadow map más grande): la huella se dibuja con los
      // triángulos reales de la losa de PB (sirve igual para la caja de ROSSO
      // que para contornos), se desenfoca con shadowBlur (andan en todos los
      // navegadores, a diferencia de ctx.filter) y después se recorta la
      // propia huella — así no oscurece el piso de la PB, que es translúcida.
      (function crearSombraContacto() {
        const geoHuella = losaPB.geometry;
        geoHuella.computeBoundingBox();
        // Margen de la textura alrededor de la huella: la franja llega a ~1,2 m.
        const bb = geoHuella.boundingBox, MARGEN = 2;
        const x0 = bb.min.x - MARGEN, z0 = bb.min.z - MARGEN;
        const anchoM = bb.max.x - bb.min.x + MARGEN * 2, largoM = bb.max.z - bb.min.z + MARGEN * 2;
        const PX = 512 / Math.max(anchoM, largoM); // px por metro
        const W = Math.ceil(anchoM * PX), H = Math.ceil(largoM * PX);
        const pos = geoHuella.attributes.position, idx = geoHuella.index;
        const nTri = (idx ? idx.count : pos.count) / 3;
        const v = i => idx ? idx.getX(i) : i;
        // Huella en blanco, agrandada expM metros con un trazo redondeado
        // alrededor de cada triángulo (0 = la huella exacta).
        function huellaCanvas(expM) {
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          const hc = c.getContext('2d');
          hc.fillStyle = hc.strokeStyle = '#fff';
          hc.lineJoin = 'round';
          hc.lineWidth = Math.max(1, expM * 2 * PX); // 1px mínimo: cierra las costuras entre triángulos
          for (let t = 0; t < nTri; t++) {
            hc.beginPath();
            for (let k = 0; k < 3; k++) {
              const i = v(t * 3 + k);
              const px = (pos.getX(i) - x0) * PX, pz = (pos.getZ(i) - z0) * PX;
              k ? hc.lineTo(px, pz) : hc.moveTo(px, pz);
            }
            hc.closePath();
            hc.fill();
            hc.stroke();
          }
          return c;
        }
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        // Se desenfoca una huella agrandada 0,35 m (0,8 m de difuminado), para
        // que la franja arranque densa justo en el borde real y no a la mitad
        // como pasaría desenfocando la huella exacta. La imagen se dibuja
        // fuera del canvas y solo su sombra cae adentro.
        ctx.save();
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 0.8 * PX;
        ctx.shadowOffsetX = W;
        ctx.drawImage(huellaCanvas(0.35), -W, 0);
        ctx.restore();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(huellaCanvas(0), 0, 0);
        const tex = new THREE.CanvasTexture(cv);
        const sombra = new THREE.Mesh(
          new THREE.PlaneGeometry(W / PX, H / PX),
          new THREE.MeshBasicMaterial({
            // 0,5 y no el 0,38 de cuando había halo ancho: sola, con 0,38 la
            // franja quedaba floja y el lateral casi no se apoyaba; con 0,62,
            // sobre una vereda al sol del mediodía, volvía a leerse como sombra.
            color: 0x22302B, map: tex, transparent: true, opacity: 0.5, depthWrite: false,
            // 1,5 cm sobre la vereda: sin offset parpadeaba contra ella.
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
          })
        );
        sombra.rotation.x = -Math.PI / 2;
        // Apenas por encima de la vereda (que rodea la PB y la taparía); sobre
        // la calzada queda a 10 cm del piso, imperceptible desde la cámara.
        sombra.position.set(x0 + W / PX / 2, VEREDA_ALTO + 0.015, z0 + H / PX / 2);
        sombra.renderOrder = -1;
        grupoEdificio.add(sombra);
      })();

      for (let piso = 1; piso <= PISOS; piso++) {
        const g = new THREE.Group();
        g.position.y = piso * PASO;
        g.userData = { offset: 0, objetivo: 0 };

        if (TORRES) {
          losasPorTorre(piso).forEach(geoL => {
            const losa = new THREE.Mesh(geoL, matLosa);
            losa.position.y = -LOSA / 2;
            losa.castShadow = losa.receiveShadow = true;
            g.add(losa);
            ocludoresSol.push(losa);
          });
          if (esNivelComercial(piso)) {
            const volumen = new THREE.Mesh(geoVolumenBasamento, matPB);
            volumen.position.y = ALTO / 2;
            volumen.receiveShadow = true;
            g.add(volumen);
            ocludoresSol.push(volumen);
          }
          if (NUCLEO_CONTORNO) {
            const nucleo = new THREE.Mesh(geoNucleo, matNucleo);
            nucleo.position.y = ALTO / 2;
            nucleo.castShadow = true;
            g.add(nucleo);
            ocludoresSol.push(nucleo);
          }
        } else {
          const losa = new THREE.Mesh(geoLosa, matLosa);
          losa.position.y = -LOSA / 2;
          losa.castShadow = losa.receiveShadow = true;
          g.add(losa);

          const nucleo = new THREE.Mesh(geoNucleo, matNucleo);
          nucleo.position.y = ALTO / 2;
          nucleo.castShadow = true;
          g.add(nucleo);
          ocludoresSol.push(losa, nucleo);
        }

        UNIDADES.filter(u => u.piso === piso).forEach(u => {
          // Unidad con contorno propio (units.geom.contorno, ver CLAUDE.md) en vez
          // de la grilla col/frente + caja ANCHO×PROF. Si falta, cae exactamente
          // en el camino de siempre — así ROSSO no cambia.
          const tieneGeom = u.geom && Array.isArray(u.geom.contorno) && u.geom.contorno.length >= 3;
          const altoUnidad = tieneGeom && u.geom.alto ? u.geom.alto : ALTO;
          let geoU = geoUnidad, bordesU = bordesGeo, posX = u.col * SEP_X, posZ = u.frente * SEP_Z;
          if (tieneGeom) {
            const centro = centroideContorno(u.geom.contorno);
            geoU = geometriaExtruida(u.geom.contorno, altoUnidad, centro);
            bordesU = new THREE.EdgesGeometry(geoU);
            posX = centro.x; posZ = centro.z;
            u._centro = centro; // enfocar() lo usa para orientar la cámara sin col/frente
          }

          const color = new THREE.Color(aspectoDe(u).color);
          const caja = new THREE.Mesh(geoU, new THREE.MeshStandardMaterial({
            color, roughness: 0.45, metalness: 0.05, transparent: true,
            opacity: aspectoDe(u).opacidad,
          }));
          caja.position.set(posX, altoUnidad / 2, posZ);
          caja.castShadow = caja.receiveShadow = true;
          caja.userData = { unidad: u, colorBase: color.clone(), activa: true };
          g.add(caja);
          cajas.push(caja);

          const borde = new THREE.LineSegments(bordesU,
            new THREE.LineBasicMaterial({ color: 0x1A2124, transparent: true, opacity: BORDE_OPACIDAD }));
          borde.position.copy(caja.position);
          caja.userData.borde = borde;
          g.add(borde);
        });

        torre.add(g);
        pisosGrupo.push(g);
      }
      ocludoresSol.push(...cajas);
      const ALTURA = (PISOS + 1) * PASO; // pisos + PB

      // Cartel de calle: objeto de la propia maqueta, apoyado sobre la
      // calzada — no una superposición HTML. Un plano con una textura de
      // canvas 2D (pill + pin + texto, sin sombra),
      // rotado como cualquier otra cosa de la escena. Geometría fija, no se
      // actualiza en el BUCLE: gira con la cámara si alguien orbita del
      // todo alrededor del edificio (es, en los hechos, texto pintado sobre
      // el piso), pero se diseñó para leerse bien desde el ángulo con el
      // que arranca la página. No participa del raycasting de clics (nunca
      // se agrega a `cajas`).
      //
      // geometria.calle_nombre permite fijar el nombre a mano. Si no está, se
      // extrae de projects.direccion: se corta en la primera coma (separa el
      // barrio), se saca un número que venga adelante o atrás, y si lo que
      // queda tiene pinta de esquina ("Calle A esquina Calle B", ambiguo sobre
      // cuál lado es el frente) o quedó vacío, no se muestra nada — preferible
      // ningún cartel a uno mal recortado.
      function extraerNombreCalle(direccion) {
        if (!direccion) return null;
        let s = direccion.trim();
        const coma = s.indexOf(',');
        if (coma !== -1) s = s.slice(0, coma);
        s = s.replace(/^\s*\d+\s*/, '').replace(/\s*\d.*$/, '').trim();
        if (/\besq\.?\b|\besquina\b/i.test(s)) return null;
        return s.length >= 3 ? s : null;
      }
      const NOMBRE_CALLE = geo.calle_nombre || extraerNombreCalle(proyecto.direccion);
      // Del otro lado de la calzada respecto del edificio, sobre el pasto,
      // cerca del borde del disco — no pegado al cordón de la vereda del
      // edificio. Así queda en primer plano respecto de la torre desde la
      // cámara por defecto, y su cara (mirando hacia afuera, lejos del
      // edificio) encara hacia el punto de vista en vez de hacia la fachada.
      // Declarado acá (y no adentro del if de abajo) porque el árbol más
      // cercano tiene que esquivarlo aunque el cálculo del cartel en sí sea
      // condicional a NOMBRE_CALLE. `let`: si cae en un cruce se corre (ver
      // abajo, al armar el cartel).
      let CARTEL_X = -(LARGO_CALLE / 2 - 4);
      // Sobre la calzada misma (no cruzando al pasto del otro lado) — más
      // cerca del borde lejano que del cordón de la vereda, para no quedar
      // pegado a la línea de auto/vereda del lado del edificio.
      const CARTEL_Z = Z_CALLE - ANCHO_CALLE * 0.22;
      // Declarado acá (no con `const` adentro del if de abajo) porque
      // INTERACCIÓN/BUCLE más abajo necesitan poder chequear "¿hay cartel?"
      // (sigue siendo null si no hay NOMBRE_CALLE — nunca truena, solo no
      // hace nada clickeable).
      let cartelCalle = null;

      // Arma el cartel (plano + textura) para un nombre de calle, ya inclinado;
      // falta posicionarlo y agregarlo al grupo de su calle.
      function crearCartelCalle(NOMBRE_CALLE) {
        // Canvas bien sobreescalado (px por metro final, no un tamaño fijo)
        // para que el texto se vea nítido en escorzo — el ángulo en que
        // siempre se lo va a mirar, nunca de frente.
        const PX_POR_METRO = 340;
        const ALTO_CARTEL_M = ANCHO_CALLE * 0.28;

        function trazarPildora(c, x, y, w, h, r) {
          c.beginPath();
          c.moveTo(x + r, y);
          c.arcTo(x + w, y, x + w, y + r, r);
          c.arcTo(x + w, y + h, x + w - r, y + h, r);
          c.arcTo(x, y + h, x, y + h - r, r);
          c.arcTo(x, y, x + r, y, r);
          c.closePath();
        }

        const cv = document.createElement('canvas');
        const ctx = cv.getContext('2d');
        const alto = Math.round(ALTO_CARTEL_M * PX_POR_METRO);
        const padH = alto * 0.62;
        const iconoR = alto * 0.19, iconoHueco = alto * 0.28;
        ctx.font = '500 ' + Math.round(alto * 0.4) + 'px Inter, "Helvetica Neue", Arial, sans-serif';
        const anchoTexto = ctx.measureText(NOMBRE_CALLE).width;
        const ancho = Math.round(padH * 2 + iconoR * 2 + iconoHueco + anchoTexto);
        cv.width = ancho;
        cv.height = alto;
        ctx.font = '500 ' + Math.round(alto * 0.4) + 'px Inter, "Helvetica Neue", Arial, sans-serif';
        ctx.textBaseline = 'middle';

        // Todo el dibujo de acá para abajo queda boca abajo a pedido (pin y
        // texto invertidos) — se hace acá, en el canvas 2D, en vez de con
        // un giro de 180° en 3D (rotateOnWorldAxis) como se probó antes,
        // porque ese giro en 3D también invertía de qué lado se levanta la
        // inclinación (ver INCLINACION_CARTEL más abajo): quedaba siempre
        // levantado del lado contrario al edificio, sin forma de separar
        // "para dónde lee" de "para dónde se levanta" usando una sola
        // rotación. Achicando el problema al 2D, la orientación 3D del
        // cartel queda intacta (se levanta del lado del edificio) y esto
        // solo cambia los píxeles impresos en la píldora.
        ctx.translate(ancho, alto);
        ctx.rotate(Math.PI);

        // Sin sombra propia: hasta 2026-10-14 llevaba un óvalo difuso pintado
        // en la textura, corrido siempre hacia el mismo lado, que no seguía
        // al simulador solar. Es una etiqueta gráfica, no un objeto de la
        // maqueta: no proyecta sombra ninguna.
        trazarPildora(ctx, 0, 0, ancho, alto, alto / 2);
        ctx.fillStyle = 'rgba(41,44,46,.92)';
        ctx.fill();

        // Pin de ubicación: mismo trazo que el ícono del panel (círculo +
        // punta + agujero recortado), en blanco. Va del lado izquierdo de
        // la píldora y el texto lo sigue hacia la derecha — orden natural
        // (ícono, después el nombre), como en la referencia que pasó el
        // cliente vista desde arriba.
        const cx = padH * 0.55 + iconoR, cy = alto / 2;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy - iconoR * 0.15, iconoR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - iconoR * 0.75, cy + iconoR * 0.55);
        ctx.quadraticCurveTo(cx, cy + iconoR * 1.9, cx + iconoR * 0.75, cy + iconoR * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx, cy - iconoR * 0.15, iconoR * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#f7f7f7';
        ctx.fillText(NOMBRE_CALLE, cx + iconoR + iconoHueco, cy + alto * 0.02);

        const texCartelCalle = new THREE.CanvasTexture(cv);
        texCartelCalle.anisotropy = render.capabilities.getMaxAnisotropy();

        // Geometría con el borde de apoyo en y=0 (en vez de centrada, que es
        // el default de PlaneGeometry) para que el `rotation.x` de abajo
        // haga bisagra sobre ese borde — el que toca la calzada.
        const anchoCartelM = ALTO_CARTEL_M * (ancho / alto);
        const geoCartelCalle = new THREE.PlaneGeometry(anchoCartelM, ALTO_CARTEL_M);
        geoCartelCalle.translate(0, -ALTO_CARTEL_M / 2, 0);

        // Inclinado, no acostado — subido de 12° a 25° a pedido, y siempre
        // levantado del lado del edificio (el signo de abajo). Este es el
        // techo real: se probó 26°/27°/28° y en los tres ya se ve de canto
        // desde la cámara inicial y no se lee nada — 25° es lo más alto que
        // se sostiene legible. El
        // "girado 180°" que se ve en pantalla (pin y texto invertidos)
        // queda resuelto arriba, en el canvas 2D — no acá — así esta
        // rotación no tiene que pelear con esa otra a la vez. `side:
        // FrontSide` explícito — con DoubleSide se vería el dorso (texto en
        // espejo) mirando hacia el edificio, que es justo el lado que
        // tiene que quedar vacío.
        const INCLINACION_CARTEL = THREE.MathUtils.degToRad(25);
        const cartel = new THREE.Mesh(
          geoCartelCalle,
          new THREE.MeshBasicMaterial({
            map: texCartelCalle, transparent: true, side: THREE.FrontSide,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
          })
        );
        cartel.rotation.x = -INCLINACION_CARTEL - Math.PI / 2;
        return cartel;
      }

      if (NOMBRE_CALLE) {
        cartelCalle = crearCartelCalle(NOMBRE_CALLE);
        // Si una transversal o su cebra caen donde iría (ROSSO: Paullier;
        // BRUSCO: la cebra de la esquina), pasa a la cuadra del edificio, 1 m
        // después de la cebra.
        const medioCartel = cartelCalle.geometry.parameters.width / 2;
        const despejeCartel = ANCHO_CALLE / 2 + ZONA_CEBRA + medioCartel + 1;
        const cruceCartel = EJES_X.find(e => Math.abs(CARTEL_X - e) < despejeCartel);
        if (cruceCartel != null) CARTEL_X = cruceCartel + (cruceCartel < 0 ? 1 : -1) * despejeCartel;
        // Corrido hacia el borde del disco (mismo costado que ya despejaba el
        // rayo cámara→cartel de la propia torre, ver debajo) y apoyado unos
        // milímetros sobre la calzada — el polygonOffset de arriba hace el
        // resto del trabajo anti-parpadeo a cámara rasante.
        cartelCalle.position.set(CARTEL_X, 0.035, CARTEL_Z);
        // Clickeable — abre Google Maps con la dirección del proyecto (no
        // solo el nombre de la calle, para no ambigüar con otra ciudad).
        // El hover/click en sí vive en INTERACCIÓN/BUCLE más abajo
        // (sobreCalle), este objeto solo lleva el dato que usan.
        const consultaMapaCalle = [proyecto.direccion, proyecto.ciudad, proyecto.pais].filter(Boolean).join(', ') || NOMBRE_CALLE;
        cartelCalle.userData.mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(consultaMapaCalle);
        grupoCalle.add(cartelCalle);
      }

      // Calles de los otros lados de la manzana (ver CALLES_LATERALES): mismo
      // armado que la del frente — calzada, vereda con cordón, línea
      // discontinua, borde continuo y cartel con el nombre — cada una en su
      // grupo girado GIRO_LADO[lado], en coordenadas "de frente" de ese lado.
      // La calzada sigue hasta el cruce con la calle vecina si la hay; la
      // vereda cubre también la esquina. Los carteles laterales no son
      // clickeables (el link a Maps es de la dirección, que da al frente).
      for (const c of CALLES_LATERALES) {
        const g = new THREE.Group();
        g.rotation.y = c.giro;
        grupoEdificio.add(g);
        const zc = c.borde - VEREDA - ANCHO_CALLE / 2, ext = VEREDA + ANCHO_CALLE;
        // Con EXTENSION, calzada, vereda y línea son de la grilla: acá queda
        // solo el cartel.
        if (!EXTENSION) {
          tramoCalzada(g,
            hayCalleEn(c.ladoMenosX) ? c.x0 - ext : c.x0,
            hayCalleEn(c.ladoMasX) ? c.x1 + ext : c.x1,
            zc, 0.019);

          const va = c.x0 - VEREDA, vb = c.x1 + VEREDA;
          const vereda = new THREE.Mesh(
            new THREE.BoxGeometry(vb - va, VEREDA_ALTO, VEREDA),
            [matVereda, matVereda, matVereda, matVereda, matVereda, matCordonCara]
          );
          vereda.position.set((va + vb) / 2, VEREDA_ALTO / 2, c.borde - VEREDA / 2);
          vereda.castShadow = vereda.receiveShadow = true;
          g.add(vereda);

          for (let x = c.x0 + 2; x < c.x1 - 2; x += 2.8) {
            const guion = new THREE.Mesh(geoGuion, matGuion);
            guion.rotation.x = -Math.PI / 2;
            guion.position.set(x, 0.03, zc);
            g.add(guion);
          }
          const borde = new THREE.Mesh(new THREE.PlaneGeometry(c.x1 - c.x0, 0.12), matGuion);
          borde.rotation.x = -Math.PI / 2;
          borde.position.set((c.x0 + c.x1) / 2, 0.03, zc - ANCHO_CALLE / 2 + 0.15);
          g.add(borde);
        }

        // Cartel en la punta de la cuadra más cercana a la cámara inicial
        // (a 4m de la esquina, como CARTEL_X en el frente), no en el medio:
        // así queda en primer plano y se lee desde la vista con que arranca.
        // Con cebras, nunca encima de la de esa esquina (la calzada que cruza
        // empieza en x0 − VEREDA).
        const thetaIni = ANGULO_LATERAL - Math.PI + FRENTE_GIRO;
        const haciaCam = x => (x * Math.cos(c.giro) + zc * Math.sin(c.giro)) * Math.sin(thetaIni)
          + (-x * Math.sin(c.giro) + zc * Math.cos(c.giro)) * Math.cos(thetaIni);
        const cartel = crearCartelCalle(c.nombre);
        const despeje = ZONA_CEBRA ? ZONA_CEBRA + 1 + cartel.geometry.parameters.width / 2 - VEREDA : 4;
        c.xCartel = haciaCam(c.x0) > haciaCam(c.x1) ? c.x0 + Math.max(4, despeje) : c.x1 - Math.max(4, despeje);
        cartel.position.set(c.xCartel, 0.035, zc - ANCHO_CALLE * 0.22);
        g.add(cartel);
      }
      // Arbolado y autos: contexto urbano, deliberadamente apagado para no
      // competir con los colores de estado de las unidades. Semilla
      // determinística (hash del nombre del proyecto) para que la disposición
      // no cambie entre recargas — árboles que "saltan" en cada visita se leen
      // como un bug, no como variedad.
      function hashTexto(t) {
        let h = 2166136261;
        for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
      }
      function prngSemilla(semilla) {
        return function () {
          semilla |= 0; semilla = (semilla + 0x6D2B79F5) | 0;
          let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      const azar = prngSemilla(hashTexto(proyecto.nombre || 'rosso'));

      // Posiciones de árbol: una fila pegada al cordón (sobre la vereda, y0 =
      // VEREDA_ALTO) y una segunda, más salteada, sobre el pasto del otro lado
      // de la calzada (y0 = 0) — separación regular con jitter para que no se
      // vea una grilla, y un filtro final por radio para no salirse del disco.
      // Altura de copa acotada (ver más abajo) para que ningún árbol tape una
      // unidad de piso 1 (~3.3m de altura de piso).
      let posicionesArbol = [];
      const margenX = 2.5;
      for (let x = -LARGO_CALLE / 2 + margenX; x < LARGO_CALLE / 2 - margenX; x += 3.2 + azar() * 1.4) {
        posicionesArbol.push({
          x: x + (azar() - 0.5) * 0.6,
          z: BORDE_FRENTE - VEREDA + 0.4 + (azar() - 0.5) * 0.3,
          y0: VEREDA_ALTO,
          s: 0.8 + azar() * 0.25,
          frente: true,
        });
      }
      const zPasto = Z_CALLE - ANCHO_CALLE / 2;
      for (let x = -LARGO_CALLE / 2 + margenX * 1.6; x < LARGO_CALLE / 2 - margenX * 1.6; x += 5 + azar() * 2.5) {
        if (azar() < 0.5) continue; // salteado, no una segunda fila completa
        posicionesArbol.push({
          x: x + (azar() - 0.5) * 1.2,
          z: zPasto - 1.5 - azar() * 3,
          y0: 0,
          s: 0.8 + azar() * 0.25,
          frente: true,
        });
      }
      // Calles laterales: solo la fila pegada al cordón, a lo largo de la
      // cuadra, dejando libre el cartel (c.xCartel). Se arma en coordenadas del
      // lado y se pasa a las de grupoCalle (girar c.giro - FRENTE_GIRO), así
      // todos los árboles siguen siendo un único InstancedMesh.
      for (const c of CALLES_LATERALES) {
        const a = c.giro - FRENTE_GIRO, cos = Math.cos(a), sin = Math.sin(a);
        for (let x = c.x0 + margenX; x < c.x1 - margenX; x += 3.2 + azar() * 1.4) {
          const xl = x + (azar() - 0.5) * 0.6;
          const zl = c.borde - VEREDA + 0.4 + (azar() - 0.5) * 0.3;
          const s = 0.8 + azar() * 0.25;
          if (Math.abs(xl - c.xCartel) < 3.2) continue;
          posicionesArbol.push({ x: xl * cos + zl * sin, z: -xl * sin + zl * cos, y0: VEREDA_ALTO, s });
        }
      }
      posicionesArbol = posicionesArbol.filter(p => p.x * p.x + p.z * p.z <= (RADIO_DISCO - 3) ** 2);
      // Las dos filas del frente no van en una transversal ni pegadas a ella
      // (se filtra después de armarlas: las demás no cambian de lugar).
      posicionesArbol = posicionesArbol.filter(p => !p.frente || !enCruce(p.x, 1.5));
      // El cartel, inclinado, ocupa más espacio real que un punto — un árbol
      // pegado a la fila del cordón caía justo delante y lo tapaba a media
      // altura. 3.2m de radio de exclusión (el cartel mide ~2m de alto ya
      // inclinado) alcanza para despejarlo sin abrir un hueco notorio en la
      // hilera de árboles.
      if (NOMBRE_CALLE) {
        posicionesArbol = posicionesArbol.filter(p =>
          (p.x - CARTEL_X) ** 2 + (p.z - CARTEL_Z) ** 2 > 3.2 * 3.2);
      }
      // Pantallas chicas: la mitad de los árboles y sin sombra propia (más
      // abajo, castShadow = CIELO_ALTA) — el edificio ya es el grueso del costo
      // de sombra, esto es para no sumarle nada en celular.
      if (!CIELO_ALTA) posicionesArbol = posicionesArbol.filter((_, i) => i % 2 === 0);

      if (posicionesArbol.length) {
        const geoTronco = new THREE.CylinderGeometry(0.08, 0.12, 1.6, 6);
        const matTronco = new THREE.MeshStandardMaterial({ color: 0x8A7B6C, roughness: 0.9 });
        const meshTroncos = new THREE.InstancedMesh(geoTronco, matTronco, posicionesArbol.length);
        meshTroncos.castShadow = CIELO_ALTA;
        meshTroncos.receiveShadow = true;

        // Copa = 2-3 lóbulos irregulares superpuestos en vez de una esfera
        // única — sin librerías de merge de geometría (three.js r128 nomás,
        // sin examples/jsm), cada lóbulo es su propio InstancedMesh con un
        // offset local fijo, combinado con la matriz del árbol en el loop de
        // abajo. 3-4 draw calls en total para todos los árboles del proyecto.
        const lobulos = [
          { geo: new THREE.IcosahedronGeometry(0.75, 0), color: 0x8FA083, dx: 0, dy: 2.0, dz: 0 },
          { geo: new THREE.IcosahedronGeometry(0.6, 0), color: 0x7C9070, dx: 0.45, dy: 1.85, dz: 0.25 },
          { geo: new THREE.IcosahedronGeometry(0.55, 0), color: 0x9BAE8E, dx: -0.4, dy: 1.9, dz: -0.3 },
        ];
        const meshesCopa = lobulos.map(l => {
          const m = new THREE.InstancedMesh(l.geo,
            new THREE.MeshStandardMaterial({ color: l.color, roughness: 0.85 }), posicionesArbol.length);
          m.castShadow = CIELO_ALTA;
          return m;
        });

        const dummy = new THREE.Object3D();
        posicionesArbol.forEach((p, i) => {
          dummy.position.set(p.x, p.y0 + 0.8 * p.s, p.z);
          dummy.rotation.y = azar() * Math.PI * 2;
          dummy.scale.setScalar(p.s);
          dummy.updateMatrix();
          meshTroncos.setMatrixAt(i, dummy.matrix);

          lobulos.forEach((l, li) => {
            dummy.position.set(p.x + l.dx * p.s, p.y0 + l.dy * p.s, p.z + l.dz * p.s);
            dummy.rotation.y = azar() * Math.PI * 2;
            dummy.scale.setScalar(p.s);
            dummy.updateMatrix();
            meshesCopa[li].setMatrixAt(i, dummy.matrix);
          });
        });
        meshTroncos.instanceMatrix.needsUpdate = true;
        meshesCopa.forEach(m => m.instanceMatrix.needsUpdate = true);
        grupoCalle.add(meshTroncos, ...meshesCopa);
      }

      // Autos: modelos GLB low-poly (Kenney/Quaternius, CC0) cargados una
      // sola vez con GLTFLoader y reutilizados con .clone() por instancia —
      // sin animación, quietos. Solo 3 y cada modelo una vez: InstancedMesh
      // no ahorra nada (sería una instancia por geometría). Los autos de
      // contexto, que sí se repiten, ya van instanciados (instanciar()).
      const LARGO_AUTO_OBJETIVO = 4.5; // metros — mismo target que tenía la geometría procedural que reemplaza

      // GLTFLoader y el decoder de meshopt se piden recién acá y no como
      // <script> en el HTML: solo sirven para los autos y eran 28 KB
      // (Brotli) bloqueantes antes del primer cuadro (~0,3 s en 3G). Todo
      // esto arranca después del primer cuadro (cargarAutos(), al final de
      // iniciar()): primero los dos scripts y después cada .glb de a uno.
      // Si algo falla no hay autos y el resto sigue igual, como con las
      // líneas gruesas del contorno.
      // GLTFLoader: build "clásica" (no ES module) de r128, como three.min.js
      // — sin importmap ni <script type="module"> el paquete three/addons no
      // serviría. Meshopt: los .glb salen de `gltf-transform optimize` con
      // --compress meshopt; sin comprimir pesaban ~160-175 KB cada uno, con
      // meshopt ~45 KB, y el decoder es JS puro (sin WASM aparte).
      // Con integrity, como los <script> del <head>.
      function cargarScript(src, integridad) {
        return new Promise((ok, mal) => {
          const s = document.createElement('script');
          s.integrity = integridad;
          s.crossOrigin = 'anonymous';
          s.src = src;
          s.onload = ok;
          s.onerror = () => mal(new Error('No cargó ' + src));
          document.head.appendChild(s);
        });
      }
      let cargadorGLTF = null; // se pide con el primer auto; un solo GLTFLoader para los tres
      function pedirCargadorGLTF() {
        return cargadorGLTF ||= Promise.all([
          cargarScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
            'sha384-fljlqkjWlmSFjkESkQvm77heIZpoWmXEOzlCA7kOpGUH+95Zk0yGfQieWM2q136E'),
          cargarScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/meshopt_decoder.js',
            'sha384-Ua4+miEfAhtQpWvzgEohUG5UfbDPgyuYVVT+sgb2QvRC3fjACMsy7LV3Zoxnv2xf'),
        ]).then(() => new THREE.GLTFLoader().setMeshoptDecoder(MeshoptDecoder));
      }
      const modelosAutoCache = {}; // ruta -> promesa del Group ya escalado/centrado (fuente para .clone())

      // Dos tonos por auto, carrocería y oscuro, como el resto del contexto
      // (primitivas de uno o dos colores). El pack trae 6-7 materiales por
      // modelo, con faros naranjas, luces traseras rojas y vidrios casi
      // negros: el auto quedaba mucho más detallado que árboles y faroles.
      // Se reemplazan todos; la malla del GLB queda tal cual. Al oscuro van
      // vidrios, gomas y paragolpes, llantas y bajos (nombres de material de
      // los tres .glb); el resto, faros y luces incluidos, a la carrocería.
      const MATERIALES_OSCUROS_AUTO = new Set(['Windows', 'Black', 'Grey']);
      const matOscuroAuto = new THREE.MeshStandardMaterial({ color: 0x24292C, roughness: 0.6 });

      function cargarModeloAuto(ruta, colorCarroceria) {
        return modelosAutoCache[ruta] ||= pedirCargadorGLTF()
          .then(cargador => fetch(ruta)
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
            .then(datos => new Promise((ok, mal) => cargador.parse(datos, '', ok, mal))))
          .then(gltf => {
            const bruto = gltf.scene;

            // Escala uniforme: la dimensión más larga del bounding box (se
            // asume el largo del auto, siempre la mayor de las tres en
            // cualquier vehículo) pasa a medir LARGO_AUTO_OBJETIVO. No
            // asumimos un tamaño fijo de antemano: no sabemos qué pack ni
            // qué modelo puntual termine en modelos/autos/.
            const tam = new THREE.Box3().setFromObject(bruto).getSize(new THREE.Vector3());
            bruto.scale.setScalar(LARGO_AUTO_OBJETIVO / Math.max(tam.x, tam.y, tam.z));
            bruto.updateMatrixWorld(true);

            // Recentrar en X/Z y apoyar en y=0 — no todos los packs
            // exportan con el pivote centrado en el piso del auto. Este
            // offset va en `bruto` (hijo), no en el envoltorio: el
            // envoltorio es lo que se clona y reposiciona por instancia
            // más abajo (auto.position.set(...) pisaría este offset si
            // estuviera en el mismo nodo).
            const caja = new THREE.Box3().setFromObject(bruto);
            const centro = caja.getCenter(new THREE.Vector3());
            bruto.position.x -= centro.x;
            bruto.position.z -= centro.z;
            bruto.position.y -= caja.min.y;

            const matCarroceria = new THREE.MeshStandardMaterial({ color: colorCarroceria, roughness: 0.7 });
            bruto.traverse(n => {
              if (!n.isMesh) return;
              n.castShadow = CIELO_ALTA; // mismo criterio que ya usaban árboles/autos: se recorta en celular
              n.receiveShadow = true;
              n.material = MATERIALES_OSCUROS_AUTO.has(n.material.name) ? matOscuroAuto : matCarroceria;
            });

            const envoltorio = new THREE.Group();
            envoltorio.add(bruto);
            return envoltorio;
          })
          .catch(error => {
            console.warn(`No se pudo cargar el modelo de auto "${ruta}":`, error);
            return null; // la escena sigue sin este auto, no se rompe nada
          });
      }

      const AUTOS = [
        // Posiciones pasadas a mano por la maqueta (captura con 3 puntos
        // rojos marcados sobre la escena real): los 3 en el carril más
        // cercano al edificio (el de arriba de la línea punteada en esa
        // captura, zOff positivo), en fila a lo largo de toda la calle
        // visible — no agrupados como en el intento anterior. Se abandona
        // la restricción de "visible sin rotar la cámara desde el ángulo
        // por defecto": la propia captura de referencia está tomada con la
        // cámara girada/acercada y ese carril se ve bien ahí, que es el
        // ángulo real que se está usando para mirar la maqueta.
        //
        // colorCarroceria: grises + un azul apagado, ninguno repetido,
        // ninguno compite con disponible/reservada/vendida. El sedán era
        // 0x3F4245 y con el vidrio oscuro quedaba un bulto sin ventanas; más
        // claro que 0x5D6367 se confunde con el asfalto (0x686F72).
        { modelo: 'modelos/autos/sedan.glb', x: -2, colorCarroceria: 0x5D6367 },
        { modelo: 'modelos/autos/suv.glb', x: -8, colorCarroceria: 0x9BA1A4 },
        { modelo: 'modelos/autos/hatchback.glb', x: -14, colorCarroceria: 0x5A6B78 },
      ];
      AUTOS.forEach(c => {
        // Un auto que caería en un cruce o su cebra (ROSSO: Paullier) pasa al
        // primer lugar libre, de a 6 m hacia +X.
        let x = c.x;
        while (enCruce(x, LARGO_AUTO_OBJETIVO / 2 + 1 + ZONA_CEBRA) || AUTOS.some(o => o !== c && o.xFinal === x)) x += 6;
        c.xFinal = x;
      });
      // En secuencia: cada .glb se pide cuando el anterior ya está en la
      // calle, así no le disputan la red a las imágenes del panel ni el hilo
      // al giro. Lo llama iniciar() después del primer cuadro.
      async function cargarAutos() {
        for (const c of AUTOS) {
          const modelo = await cargarModeloAuto(c.modelo, c.colorCarroceria);
          if (!modelo) continue; // ver el warn de cargarModeloAuto()
          const auto = modelo.clone();
          auto.position.set(c.xFinal, 0.02, Z_CALLE + 2.5);
          // El "adelante" de estos modelos (Quaternius) mira +Z local —
          // confirmado midiendo la posición real de la malla de faros/luces
          // traseras de cada .glb, no a ojo. La calle corre en el eje X del
          // mundo (LARGO_CALLE), así que hace falta rotar 90°, no 0/180°
          // como en un auto que ya mirara por X — los 3 en el mismo
          // sentido, en fila sobre el mismo carril.
          auto.rotation.y = Math.PI / 2;
          grupoCalle.add(auto);
        }
      }

      // Mobiliario urbano: farolas, bancos + cesto + bicicletero, y un
      // cartel de tránsito genérico — mismo criterio que los árboles
      // (geometría esquemática, pocos objetos por tipo, sin InstancedMesh
      // salvo las farolas que si se vuelven muchas). Todo sobre la vereda,
      // más adentro que la fila de árboles pegada al cordón para no
      // pisarla. Las farolas y los bancos van de punta a punta de
      // la calle (LARGO_CALLE completo); el cesto/bicicletero/cartel se
      // quedaron en el tramo donde están los autos (x entre -1 y -14.5),
      // el que se confirmó visible desde el ángulo que se está usando para
      // mirar la maqueta.
      // Apoyado en VEREDA_ALTO, como los árboles: hasta 2026-10-14 iba en
      // y = 0,02 fijo y quedaba 10 cm hundido en la vereda. La Z se mide
      // desde la vereda (a 0,65 de su ancho desde el cordón) y no desde la
      // calzada: con las medidas por defecto da lo mismo que antes
      // (Z_CALLE + 5,3), pero con geometria.calle.ancho mayor no se sale
      // de la vereda y queda flotando sobre el asfalto.
      const Z_VEREDA_MOBILIARIO = BORDE_FRENTE - VEREDA * 0.35;

      const geoPosteFarol = new THREE.CylinderGeometry(0.06, 0.08, 4.2, 8);
      const geoBrazoFarol = new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6);
      const geoFocoFarol = new THREE.SphereGeometry(0.14, 8, 8);
      const matPosteFarol = new THREE.MeshStandardMaterial({ color: 0x2E3235, roughness: 0.6, metalness: 0.3 });
      const matFocoFarol = new THREE.MeshStandardMaterial({ color: 0xE8E4D8, roughness: 0.4 });
      function crearFarol() {
        const grupo = new THREE.Group();
        const poste = new THREE.Mesh(geoPosteFarol, matPosteFarol);
        poste.position.y = 2.1;
        poste.castShadow = CIELO_ALTA;
        grupo.add(poste);
        const brazo = new THREE.Mesh(geoBrazoFarol, matPosteFarol);
        brazo.rotation.z = Math.PI / 2;
        brazo.position.set(0.35, 4.15, 0);
        grupo.add(brazo);
        const foco = new THREE.Mesh(geoFocoFarol, matFocoFarol);
        foco.position.set(0.68, 4.05, 0);
        grupo.add(foco);
        return grupo;
      }
      // Farolas de punta a punta de la calle (mismo margen que usan los
      // árboles, MARGEN_FAROL, para no salirse del tramo real de vereda),
      // cada 8m — ya no solo en el tramo donde están los autos.
      const MARGEN_FAROL = 2.5;
      // Nada del mobiliario va en una transversal (hoy solo pasa en ROSSO).
      for (let x = -LARGO_CALLE / 2 + MARGEN_FAROL; x <= LARGO_CALLE / 2 - MARGEN_FAROL; x += 8) {
        if (enCruce(x, 0.5)) continue;
        const farol = crearFarol();
        farol.position.set(x, VEREDA_ALTO, Z_VEREDA_MOBILIARIO);
        grupoCalle.add(farol);
      }

      // Bancos (3: el original + 2 más, repartidos lejos entre sí y del
      // resto del mobiliario para no amontonarlos)
      const matBanco = new THREE.MeshStandardMaterial({ color: 0x6B6B68, roughness: 0.8 });
      function crearBanco() {
        const banco = new THREE.Group();
        const asiento = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.4), matBanco);
        asiento.position.y = 0.42;
        asiento.castShadow = CIELO_ALTA; asiento.receiveShadow = true;
        banco.add(asiento);
        const respaldo = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.05), matBanco);
        respaldo.position.set(0, 0.62, -0.17);
        banco.add(respaldo);
        [-0.6, 0.6].forEach(x => {
          const pata = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.4), matBanco);
          pata.position.set(x, 0.2, 0);
          banco.add(pata);
        });
        return banco;
      }
      [-17, -5.5, 10].filter(x => !enCruce(x, 1.2)).forEach(x => {
        const banco = crearBanco();
        banco.position.set(x, VEREDA_ALTO, Z_VEREDA_MOBILIARIO);
        grupoCalle.add(banco);
      });

      // Cesto de basura
      if (!enCruce(-10.5, 0.7)) {
        const cesto = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.18, 0.55, 10),
          new THREE.MeshStandardMaterial({ color: 0x3C4044, roughness: 0.7 })
        );
        cesto.position.set(-10.5, VEREDA_ALTO + 0.275, Z_VEREDA_MOBILIARIO);
        cesto.castShadow = CIELO_ALTA; cesto.receiveShadow = true;
        grupoCalle.add(cesto);
      }

      // Bicicletero (soporte tipo U invertida, uno solo)
      if (!enCruce(-14.5, 0.8)) {
        const matBici = new THREE.MeshStandardMaterial({ color: 0x33383B, roughness: 0.5, metalness: 0.4 });
        const bici = new THREE.Group();
        [-0.25, 0.25].forEach(x => {
          const pata = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), matBici);
          pata.position.set(x, 0.35, 0);
          bici.add(pata);
        });
        const arco = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), matBici);
        arco.rotation.z = Math.PI / 2;
        arco.position.set(0, 0.7, 0);
        bici.add(arco);
        bici.position.set(-14.5, VEREDA_ALTO, Z_VEREDA_MOBILIARIO);
        grupoCalle.add(bici);
      }

      // Cartel de tránsito genérico (disco en poste) — la maqueta no tiene
      // una segunda calle/cruce modelado, así que un semáforo no tendría
      // con qué cruzarse; se optó por un cartel puntual en su lugar.
      if (!enCruce(-1, 0.8)) {
        const cartel = new THREE.Group();
        const poste = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8),
          new THREE.MeshStandardMaterial({ color: 0x4A4E52, roughness: 0.6 })
        );
        poste.position.y = 1.1;
        poste.castShadow = CIELO_ALTA;
        cartel.add(poste);
        const panel = new THREE.Mesh(
          new THREE.CircleGeometry(0.28, 16),
          new THREE.MeshStandardMaterial({ color: 0xEDEFEF, roughness: 0.4, side: THREE.DoubleSide })
        );
        panel.position.y = 2.15;
        cartel.add(panel);
        cartel.position.set(-1, VEREDA_ALTO, Z_VEREDA_MOBILIARIO);
        grupoCalle.add(cartel);
      }

      // CONTEXTO EXTENDIDO (con EXTENSION): árboles, faroles y autos a lo largo
      // de las calles de la grilla, y manzanas vecinas como bloques bajos.
      // - Cada pieza es un InstancedMesh por parte (tronco, copa…): unos pocos
      //   draw calls para cientos de instancias. Geometría más simple que la de
      //   cerca del edificio (de lejos no se distingue): árbol de dos lóbulos,
      //   y autos de tres cajas en los dos tonos de siempre — un .glb tiene
      //   ~3000 triángulos y 150 autos eran ~450 000.
      // - Densidad que baja con la distancia (densidadContexto) y nada más allá
      //   de HASTA_CONTEXTO, donde el fundido ya pasó el 93 %.
      // - No se repite lo que ya tiene su versión de siempre: el tramo de 44 m
      //   de la calle del frente y, en BRUSCO, las veredas de su manzana. Autos
      //   tampoco cerca del edificio (ahí están los tres .glb y los carteles).
      // - Lo que queda dentro del radio de sombra la proyecta (como lo de
      //   siempre, solo en pantallas grandes); lo de más allá no, porque ahí
      //   la sombra ya está apagada (ver conFundido).
      // - Semilla propia: no cambia la secuencia de los árboles de siempre.
      if (EXTENSION) {
        const rndCtx = prngSemilla(hashTexto((proyecto.nombre || 'rosso') + ' contexto'));
        const HASTA_CONTEXTO = FUNDIDO_DESDE + 0.6 * (FUNDIDO_HASTA - FUNDIDO_DESDE);
        const DENSO_HASTA = RADIO_DISCO + CUADRA / 2;
        const densidadContexto = d => (d >= HASTA_CONTEXTO ? 0
          : d <= DENSO_HASTA ? 1 : 1 - 0.75 * (d - DENSO_HASTA) / (HASTA_CONTEXTO - DENSO_HASTA)) * (CIELO_ALTA ? 1 : 0.5);
        const RADIO_SOMBRA_CONTEXTO = RADIO_DISCO * 1.5; // ≈ 0,9 del radio de la cámara de sombra
        const MZ = MANZANA_EDIFICIO;
        const yaEsta = (x, z) =>
          (Math.abs(x) < LARGO_CALLE / 2 + 3 && Math.abs(z - Z_CALLE) < ANCHO_CALLE / 2 + VEREDA + 1) ||
          (CALLES_LATERALES.length > 0 && MZ.x && MZ.z && x > MZ.x[0] - 1 && x < MZ.x[1] + 1 && z > MZ.z[0] - 1 && z < MZ.z[1] + 1);

        // Recorre las veredas de todas las manzanas: f(x, z, dx, dz) cada ~paso
        // metros, a `adentro` del cordón, sin los `tope` metros de cada esquina;
        // (dx, dz) = dirección de la cuadra.
        function porVeredas(paso, adentro, tope, f) {
          for (const [xa, xb] of TRAMOS_X) for (const [za, zb] of TRAMOS_Z) {
            for (const [x0, z0, dx, dz, largo] of [
              [xa, za + adentro, 1, 0, xb - xa], [xa, zb - adentro, 1, 0, xb - xa],
              [xa + adentro, za, 0, 1, zb - za], [xb - adentro, za, 0, 1, zb - za],
            ]) {
              for (let t = tope + rndCtx() * paso * 0.5; t < largo - tope; t += paso * (0.8 + rndCtx() * 0.4))
                f(x0 + dx * t, z0 + dz * t, dx, dz);
            }
          }
        }

        // Partes de una pieza: { geo, mat, local (Matrix4), color?(item) }.
        // Items: { x, y, z, rot, s }.
        const dummy = new THREE.Object3D(), mInstancia = new THREE.Matrix4();
        function instanciar(partes, items) {
          const cerca = items.filter(p => Math.hypot(p.x, p.z) < RADIO_SOMBRA_CONTEXTO);
          const lejos = items.filter(p => Math.hypot(p.x, p.z) >= RADIO_SOMBRA_CONTEXTO);
          for (const [lista, sombra] of [[cerca, CIELO_ALTA], [lejos, false]]) {
            if (!lista.length) continue;
            for (const parte of partes) {
              const im = new THREE.InstancedMesh(parte.geo, parte.mat, lista.length);
              im.castShadow = sombra;
              im.receiveShadow = true;
              // r128 recorta un InstancedMesh con la esfera de su geometría base
              // (en el origen), no con la de sus instancias.
              im.frustumCulled = false;
              lista.forEach((p, i) => {
                dummy.position.set(p.x, p.y, p.z);
                dummy.rotation.set(0, p.rot, 0);
                dummy.scale.setScalar(p.s ?? 1);
                dummy.updateMatrix();
                im.setMatrixAt(i, mInstancia.multiplyMatrices(dummy.matrix, parte.local));
                if (parte.color) im.setColorAt(i, parte.color(p));
              });
              grupoCalle.add(im);
            }
          }
        }
        const en = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
        const estandar = (color, extra = {}) => conFundido(new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }));

        // Árboles: cada ~11 m sobre la vereda, a 0,4 m del cordón (como la fila
        // de siempre). Mismos colores, dos lóbulos en vez de tres.
        const arboles = [];
        porVeredas(11, 0.4, 4, (x, z) => {
          if (yaEsta(x, z) || rndCtx() > densidadContexto(Math.hypot(x, z))) return;
          arboles.push({ x, z, y: VEREDA_ALTO, rot: rndCtx() * Math.PI * 2, s: 0.8 + rndCtx() * 0.25 });
        });
        instanciar([
          { geo: new THREE.CylinderGeometry(0.08, 0.12, 1.6, 5, 1, true), mat: estandar(0x8A7B6C, { roughness: 0.9 }), local: en(0, 0.8, 0) },
          { geo: new THREE.IcosahedronGeometry(0.75, 0), mat: estandar(0x8FA083), local: en(0, 2.0, 0) },
          { geo: new THREE.IcosahedronGeometry(0.6, 0), mat: estandar(0x7C9070), local: en(0.45, 1.85, 0.25) },
        ], arboles);

        // Faroles: cada ~32 m, en la línea del mobiliario (0,65 del ancho de la
        // vereda desde el cordón), con el brazo a lo largo de la cuadra como
        // los de siempre.
        const faroles = [];
        porVeredas(32, VEREDA * 0.65, 6, (x, z, dx, dz) => {
          if (yaEsta(x, z) || rndCtx() > densidadContexto(Math.hypot(x, z))) return;
          faroles.push({ x, z, y: VEREDA_ALTO, rot: Math.atan2(-dz, dx) });
        });
        const matPoste = estandar(0x2E3235, { roughness: 0.6, metalness: 0.3 });
        instanciar([
          { geo: new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6, 1, true), mat: matPoste, local: en(0, 2.1, 0) },
          { geo: new THREE.CylinderGeometry(0.04, 0.04, 0.7, 4, 1, true), mat: matPoste,
            local: new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.35, 4.15, 0) },
          { geo: new THREE.IcosahedronGeometry(0.14, 0), mat: estandar(0xE8E4D8, { roughness: 0.4 }), local: en(0.68, 4.05, 0) },
        ], faroles);

        // Autos estacionados contra el cordón (a 1,2 m), de las dos manos, con
        // huecos al azar y sin los TOPE de cada esquina (cebras, cruces).
        // Carrocería en grises y un azul apagado, como los tres de siempre
        // (color por instancia); vidrios y bajos en el oscuro de siempre.
        const COLORES_AUTO = [0x5D6367, 0x9BA1A4, 0x5A6B78, 0xB4B8BA, 0x45494C, 0x7A8085].map(c => new THREE.Color(c));
        const autos = [], TOPE_AUTO = 9, m = ANCHO_CALLE / 2;
        const estacionar = (x, z, rot) => {
          const d = Math.hypot(x, z);
          if (d < RADIO_DISCO + 6 || yaEsta(x, z) || rndCtx() > 0.4 * densidadContexto(d)) return;
          autos.push({ x, z, y: 0.02, rot, color: COLORES_AUTO[Math.floor(rndCtx() * COLORES_AUTO.length)] });
        };
        for (const z of EJES_Z) for (const [a, b] of TRAMOS_X) for (const s of [-1, 1])
          for (let x = a + TOPE_AUTO; x < b - TOPE_AUTO; x += 6 + rndCtx() * 1.5) estacionar(x, z + s * (m - 1.2), s > 0 ? Math.PI : 0);
        for (const x of EJES_X) for (const [a, b] of TRAMOS_Z) for (const s of [-1, 1])
          for (let z = a + TOPE_AUTO; z < b - TOPE_AUTO; z += 6 + rndCtx() * 1.5) estacionar(x + s * (m - 1.2), z, s > 0 ? Math.PI / 2 : -Math.PI / 2);
        // Cajas [x0, x1, y0, y1, z0, z1], largo en X local.
        instanciar([
          { geo: geometriaCajas([[-2.2, 2.2, 0.28, 0.95, -0.88, 0.88]]), mat: estandar(0xFFFFFF, { roughness: 0.7 }),
            local: new THREE.Matrix4(), color: p => p.color },
          { geo: geometriaCajas([[-1.25, 0.9, 0.95, 1.45, -0.78, 0.78], [-1.9, 1.9, 0, 0.28, -0.8, 0.8]]),
            mat: estandar(0x24292C, { roughness: 0.6 }), local: new THREE.Matrix4() },
        ], autos);

        // Manzanas vecinas (geometria.calle.manzanas = false las apaga): cada
        // manzana menos la del edificio, retirada 3 m de la vereda (así no
        // pisa árboles ni faroles) y partida en cuatro lotes de alturas
        // distintas. Gris claro, con el fundido; sin sombra propia (el
        // simulador solar no considera vecinos: una sombra suya sobre la
        // fachada contradiría el "recibe sol"). Las de al lado de la manzana
        // del edificio, bajas (4 a 5 m): a 15 m o más del edificio no tapan
        // su fachada desde la vista inicial (24° de elevación) ni al enfocar
        // una unidad (14°) más que el primer metro de la PB.
        if (calleCfg.manzanas !== false && MZ.x && MZ.z) {
          const RETIRO = VEREDA + 3, lotes = [];
          const iX = TRAMOS_X.indexOf(MZ.x), iZ = TRAMOS_Z.indexOf(MZ.z);
          TRAMOS_X.forEach(([xa, xb], i) => TRAMOS_Z.forEach(([za, zb], j) => {
            if (i === iX && j === iZ) return;
            const x0 = xa + RETIRO, x1 = xb - RETIRO, z0 = za + RETIRO, z1 = zb - RETIRO;
            if (x1 - x0 < 6 || z1 - z0 < 6) return;
            if (Math.hypot(Math.max(0, Math.abs((x0 + x1) / 2) - (x1 - x0) / 2), Math.max(0, Math.abs((z0 + z1) / 2) - (z1 - z0) / 2)) >= HASTA_CONTEXTO) return;
            const vecina = Math.abs(i - iX) <= 1 && Math.abs(j - iZ) <= 1;
            const xm = x0 + (x1 - x0) * (0.35 + rndCtx() * 0.3), zm = z0 + (z1 - z0) * (0.35 + rndCtx() * 0.3);
            for (const [a, b] of [[x0, xm], [xm, x1]]) for (const [c, d] of [[z0, zm], [zm, z1]]) {
              const h = vecina ? 4 + rndCtx() : 6 + rndCtx() * 8;
              lotes.push([a, b, 0, h, c, d]);
            }
          }));
          if (lotes.length) {
            const manzanas = new THREE.Mesh(geometriaCajas(lotes), estandar(0xCDD0CD, { roughness: 0.95 }));
            manzanas.receiveShadow = true;
            grupoCalle.add(manzanas);
          }
        }
      }

      /* ============================================================
         4. CÁMARA
         ============================================================ */

      // Con CONJUNTO (varias torres) la cámara apunta al centro real de los
      // contornos, no al origen — ver también radio más abajo.
      const CENTRO_X = CONJUNTO ? CONJUNTO.cx : 0, CENTRO_Z = CONJUNTO ? CONJUNTO.cz : 0;
      const objetivo = new THREE.Vector3(CENTRO_X, ALTURA * 0.45, CENTRO_Z);
      // theta ya no orbita: es el azimut fijo de la cámara. Lo que antes
      // hacía "mover la cámara alrededor del edificio" ahora lo hace GIRO,
      // girando grupoEdificio en el lugar (ver ese grupo más arriba) — así
      // piso/calle/vereda/árboles, que quedan afuera del grupo, no se mueven
      // en pantalla al arrastrar ni en el auto-giro.
      //
      // El signo de theta decide desde qué lado (frente/calle en -Z, o
      // contrafrente en +Z, ver CLAUDE.md) arranca la cámara — nunca el
      // giro inicial, que se deja en 0 a propósito (ver GIRO más abajo):
      // el frente vive siempre en el mismo eje local sea cual sea el
      // edificio, así que no hace falta leer norte_grados acá (eso solo
      // orienta el sol, no esta vista). ÁNGULO_LATERAL es el mismo barrido
      // de siempre (~40°) que da la vista de "tres cuartos"; lo único que
      // cambia es el signo de cos(theta) para quedar del lado de la calle
      // en vez del contrafrente — con el mismo signo de sin(theta) para no
      // cambiar de lado lateral (el cartel vive del lado X negativo, ver
      // CARTEL_X, y así la cámara arranca de ese mismo lado, con el cartel
      // en primer plano en vez de en el borde del cuadro).
      // (ANGULO_LATERAL está declarado arriba, junto a FRENTE_GIRO: los
      // carteles de las calles laterales lo usan para ubicarse.)
      // + FRENTE_GIRO: si el frente no está en -Z (BRUSCO, frente en -X), la
      // cámara gira igual que grupoCalle, así arranca mirando desde la calle
      // de la dirección con el cartel en primer plano, como siempre.
      const theta = ANGULO_LATERAL - Math.PI + FRENTE_GIRO;
      // Elevación: ~24° sobre el horizonte (phi se mide desde el eje Y) —
      // ligeramente por arriba, no en picado, para que se lea la fachada
      // Y el lateral sin aplanar el volumen.
      const PHI_INICIAL = 1.15;
      // Distancia proporcional a la altura real (ALTURA ya sale de PISOS/
      // PASO, no un edificio fijo, ver CLAUDE.md): la constante de abajo
      // sale de calibrar contra ROSSO (11 pisos·PASO ≈ 36.5m → radio 96,
      // el valor de siempre) para que un edificio más bajo o más alto no
      // quede desencuadrado con el mismo número fijo.
      const RADIO_POR_ALTURA = 96 / ((10 + 1) * (3 + 0.32));
      // En pantallas angostas (celular vertical) el FOV horizontal es más
      // chico que el vertical (mismo fov, aspect < 1: three.js reparte el
      // ángulo así) y la calle — 44m de largo, bien más ancha que el
      // edificio — es lo primero que se corta. Alejar la cámara en esa
      // proporción (tan(hFov/2) = aspect·tan(vFov/2), de ahí el 1/aspect)
      // para que calle + cartel + edificio entren igual que en desktop.
      const ASPECT_REF = 1.6;
      // Mismo rango que el zoom a rueda de más abajo (34–190), para no
      // arrancar ya afuera del límite que el usuario puede alcanzar.
      // Con CONJUNTO, además, el radio no puede ser menor que la distancia a
      // la que la esfera que envuelve todo el conjunto (planta real + altura)
      // entra en el FOV vertical — un conjunto ancho y bajo se cortaría si
      // solo se mirara la altura.
      const radioConjunto = CONJUNTO
        ? Math.hypot((CONJUNTO.maxX - CONJUNTO.minX) / 2, (CONJUNTO.maxZ - CONJUNTO.minZ) / 2, ALTURA / 2) /
          Math.sin(THREE.MathUtils.degToRad(camara.fov / 2)) * 1.05
        : 0;
      // Con el aspecto de ahora: el encuadre general lo usa como mínimo y lo
      // vuelve a pedir al cambiar el tamaño de la ventana (ver
      // encuadreTorre()).
      function radioBase() {
        const factorAspecto = Math.min(2, Math.max(1, ASPECT_REF / Math.max(pantalla.ancho / pantalla.alto, 0.4)));
        return Math.min(190, Math.max(55, ALTURA * RADIO_POR_ALTURA, radioConjunto) * factorAspecto);
      }
      let radio = radioBase(),
        phi = PHI_INICIAL, giro = 0, arrastrando = false, ultimo = { x: 0, y: 0 };

      /* Giro automático: tras INACTIVIDAD_MS sin interacción el edificio gira
         solo, una vuelta cada 80 s, con una rampa suave de arranque. Cualquier
         interacción lo corta en seco (rampaGiro = 0) y reinicia el contador.
         Arranca como si la inactividad ya se hubiera cumplido: es el giro de
         bienvenida de siempre. giroForzado = el botón de la toolbar ("girar
         ahora"), que no espera la inactividad. Ver puedeGirar() en el BUCLE.
         En el modo showroom (kiosco, ver KIOSCO) es el mismo giro con otros
         tiempos: una vuelta cada 90 s y vuelve a los 20 s, para no ganarle
         a quien se acercó a mirar. KIOSCO_URL = la pantalla del showroom
         (?kiosco=1), que arranca ya en ese modo. */
      const INACTIVIDAD_MS = 6000, VEL_GIRO = 2 * Math.PI / 80, RAMPA_GIRO_S = 2.5;
      const INACTIVIDAD_KIOSCO_MS = 20000, VEL_GIRO_KIOSCO = 2 * Math.PI / 90;
      const KIOSCO_URL = new URLSearchParams(location.search).get('kiosco') === '1';
      let kiosco = false;
      let ultimaActividad = -Infinity, giroForzado = false, rampaGiro = 0;
      function registrarActividad() {
        ultimaActividad = performance.now();
        giroForzado = false;
        rampaGiro = 0;
      }
      // Un solo enganche, en fase de captura sobre document: cubre lienzo,
      // unidades, filtros, pisos, hojas y el deslizador del sol, y ningún
      // stopPropagation de más abajo lo puede saltear. El botón de giro se
      // excluye: su click decide solo (ver btnOrbita).
      const esBotonGiro = e => e.target.closest && e.target.closest('#hr-orbita');
      ['pointerdown', 'wheel', 'keydown'].forEach(tipo =>
        document.addEventListener(tipo, e => { if (!esBotonGiro(e)) registrarActividad(); },
          { capture: true, passive: true }));
      // Mover el mouse sin apretar no cuenta como actividad: ni corta el
      // giro ni atrasa que vuelva.
      // Al ocultar y al volver a la pestaña: corta y el contador arranca de cero.
      document.addEventListener('visibilitychange', registrarActividad);

      // La cámara nunca baja de ALTURA_MIN_CAMARA sobre el piso. Con phi al
      // máximo (un poco por debajo del objetivo) y el radio grande quedaba
      // debajo del terreno: ROSSO a radio 190, y ≈ −14 m. phiPiso es el phi
      // que la deja justo a esa altura con el radio y el objetivo de ahora; no
      // toca la vista inicial (1,15), una unidad (1,32) ni un piso (1,28).
      const ALTURA_MIN_CAMARA = 2;
      function ubicarCamara() {
        const phiPiso = Math.acos(Math.max(-1, Math.min(1, (ALTURA_MIN_CAMARA - objetivo.y) / radio)));
        phi = Math.max(0.18, Math.min(Math.PI / 2 + 0.16, phiPiso, phi));
        camara.position.set(
          objetivo.x + radio * Math.sin(phi) * Math.sin(theta),
          objetivo.y + radio * Math.cos(phi),
          objetivo.z + radio * Math.sin(phi) * Math.cos(theta)
        );
        camara.lookAt(objetivo);
        if (cielo) cielo.position.copy(camara.position);
        grupoEdificio.rotation.y = giro;
      }
      ubicarCamara();

      const lienzo = render.domElement;
      lienzo.style.cursor = 'grab';
      // Punteros apoyados en el lienzo. Con uno se gira; con dos, el pellizco
      // acerca o aleja la cámara hacia el objetivo, como la rueda (radio
      // 34–190). Cada vez que cambia la cantidad de dedos el pellizco vuelve
      // a medir desde ahí, y el dedo que queda sigue girando sin salto. Un
      // pellizco nunca cuenta como clic (ver arrastreClic, más abajo).
      const dedos = new Map();
      let pellizco = null;
      function distanciaDedos() {
        const [a, b] = [...dedos.values()];
        return Math.hypot(b.x - a.x, b.y - a.y) || 1;
      }
      function contarDedos() {
        pellizco = dedos.size >= 2 ? { d0: distanciaDedos(), r0: radio } : null;
        arrastrando = dedos.size > 0;
        if (dedos.size === 1) ultimo = { ...dedos.values().next().value };
      }
      lienzo.addEventListener('pointerdown', e => {
        // El primero de un gesto: no hay otro dedo apoyado, así que un
        // pointerup perdido no deja un dedo fantasma que lo vuelva pellizco.
        if (e.isPrimary) dedos.clear();
        dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        contarDedos();
        lienzo.setPointerCapture(e.pointerId);
      });
      function soltarDedo(e) {
        if (!dedos.delete(e.pointerId)) return;
        if (lienzo.hasPointerCapture(e.pointerId)) lienzo.releasePointerCapture(e.pointerId);
        contarDedos();
      }
      lienzo.addEventListener('pointerup', soltarDedo);
      lienzo.addEventListener('pointercancel', soltarDedo);
      lienzo.addEventListener('pointermove', e => {
        const dedo = dedos.get(e.pointerId);
        if (dedo) { dedo.x = e.clientX; dedo.y = e.clientY; }
        if (pellizco) {
          radio = Math.max(34, Math.min(190, pellizco.r0 * pellizco.d0 / distanciaDedos()));
          ubicarCamara();
          return;
        }
        const dx = e.clientX - ultimo.x, dy = e.clientY - ultimo.y;
        ultimo = { x: e.clientX, y: e.clientY };
        // Signo invertido respecto al theta -= de antes: acá lo que gira es
        // el edificio, no la cámara, así que para que arrastrar a la
        // derecha "se sienta" igual (el edificio girando hacia el mismo
        // lado que antes parecía girar la vista) el signo se da vuelta.
        if (arrastrando) { giro += dx * 0.005; phi -= dy * 0.004; ubicarCamara(); }
        raton.x = (e.clientX / innerWidth) * 2 - 1;
        raton.y = -(e.clientY / innerHeight) * 2 + 1;
        posRaton = { x: e.clientX, y: e.clientY };
      });
      lienzo.addEventListener('wheel', e => {
        e.preventDefault();
        radio = Math.max(34, Math.min(190, radio + e.deltaY * 0.09));
        ubicarCamara();
      }, { passive: false });

      /* ============================================================
         SOL — apagado por default (ver tieneNorte()): sin lat/lon/
         norte_grados el trigger queda hidden y nada de lo de acá se
         conecta a un botón. Activarlo prende la luz calculada y agranda
         la cámara de sombra a una esfera que cubre la torre entera desde
         cualquier ángulo — así no hace falta volver a dimensionarla en
         cada movimiento del slider, ni se corta con sol rasante. Al
         apagarlo se vuelve exactamente a los valores con los que arrancó
         la escena (solOriginal), que es la luz de siempre de ROSSO.
         ============================================================ */
      function tieneNorte() {
        return proyecto.lat != null && proyecto.lon != null && geo.norte_grados != null;
      }

      // Niebla y hemisférica fijas, a tono con el fondo (pintarFondo; la
      // niebla con el tono de sus esquinas). Antes esto seguía la altitud solar
      // (día/atardecer/noche) porque el cielo era un shader que se podía
      // redibujar; con un fondo fijo esa lógica ya no aplica. El simulador
      // solar sigue moviendo sombras y el color/intensidad del
      // DirectionalLight (ver aplicarSol) — acá solo se fija niebla/ambiente.
      const NIEBLA_COLOR = new THREE.Color(0xF1F4F2);
      const AMBIENTE_COLOR = new THREE.Color(0xFFFFFF);

      function aplicarCielo() {
        if (escena.fog) escena.fog.color.copy(NIEBLA_COLOR); // sin niebla con EXTENSION
        hemi.color.copy(AMBIENTE_COLOR);
      }

      function aplicarCieloDefault() {
        aplicarCielo();
      }

      const solOriginal = {
        color: sol.color.clone(), intensity: sol.intensity, position: sol.position.clone(),
        hemiIntensity: hemi.intensity,
      };
      // Radio de la esfera que contiene la torre + el disco de base: una
      // cámara ortográfica ajustada a esa esfera cubre el edificio sin
      // recortes sea cual sea la dirección de la luz (la silueta de una
      // esfera vista desde cualquier ángulo mide siempre lo mismo).
      const centroSombraSol = new THREE.Vector3(0, ALTURA / 2, 0);
      const radioSombraSol = Math.sqrt(RADIO_DISCO * RADIO_DISCO * 2 + (ALTURA / 2) * (ALTURA / 2)) * 1.08;
      const distanciaSol = radioSombraSol * 2.4;
      sol.target.position.copy(centroSombraSol);
      grupoEdificio.add(sol.target);
      // Luz por defecto (sin simulador): mismo azimut de siempre pero más
      // alta (~60°) — a ~42° la sombra de una torre de 10 pisos medía ~40 m
      // y cruzaba la calle como una mancha suelta; así queda pegada al
      // edificio, como en una maqueta iluminada desde arriba. Va a
      // distanciaSol del centro para usar el mismo encuadre de sombra que el
      // simulador (la esfera cubre todo el terreno); antes la vista por
      // defecto tenía un frustum fijo más chico y la sombra se cortaba en seco.
      const dirSolDefault = new THREE.Vector3(-34, 0, 30).normalize().setY(1.75).normalize();
      solOriginal.position.copy(centroSombraSol).addScaledVector(dirSolDefault, distanciaSol);
      sol.position.copy(solOriginal.position);
      function encuadrarSombra() {
        sc.left = -radioSombraSol; sc.right = radioSombraSol;
        sc.top = radioSombraSol; sc.bottom = -radioSombraSol;
        sc.near = Math.max(0.1, distanciaSol - radioSombraSol - 4);
        sc.far = distanciaSol + radioSombraSol + 4;
        sc.updateProjectionMatrix();
      }
      encuadrarSombra();
      // Fundido de la sombra en el entorno (ver conFundido): entera hasta
      // 0,65 del radio de su cámara y nada a 0,9 — la punta de una sombra
      // larga se cortaba recién pasando ~1 radio, así que no llega a verse.
      // Hoy son 32–45 m en ROSSO, 31–43 m en Altamira y 48–67 m en BRUSCO:
      // todo lo de cerca del edificio queda con su sombra entera, como antes.
      FUNDIDO.uRangoSombra.value.set(radioSombraSol * 0.65, radioSombraSol * 0.9);
      aplicarCieloDefault();

      let solActivo = false;
      let ultimoSol = { altitud: 0, azimut: 0 };
      const rayoSol = new THREE.Raycaster();

      function aplicarSol(fecha, minutosLocales) {
        const { altitud, azimut } = posicionSolar(proyecto.lat, proyecto.lon, tzOffsetHoras, fecha, minutosLocales);
        ultimoSol = { altitud, azimut, fecha, minutos: minutosLocales };
        document.getElementById('sol-lectura').textContent =
          'Azimut ' + Math.round(azimut) + '° · Altura ' + Math.round(altitud) + '°';
        const avisoNoche = document.getElementById('sol-aviso-noche');
        const dir = direccionSolModelo(altitud, azimut, geo.norte_grados);
        if (altitud <= 0) {
          sol.intensity = 0;
          hemi.intensity = solOriginal.hemiIntensity;
          avisoNoche.hidden = false;
        } else {
          avisoNoche.hidden = true;
          sol.position.copy(centroSombraSol).addScaledVector(dir, distanciaSol);
          // Cálido y rasante cerca del horizonte, blanco y vertical al
          // mediodía. La ambiente baja apenas (hasta 85%): antes bajaba en
          // la misma proporción que el sol (hasta 40%) y al amanecer la
          // maqueta entera se apagaba; con el sol bajo, el contraste ya lo
          // dan las sombras largas.
          const factor = Math.max(0.4, Math.sin(altitud * Math.PI / 180));
          sol.color.set(0xFFA660).lerp(new THREE.Color(0xFFF6E8), Math.min(1, altitud / 45));
          sol.intensity = solOriginal.intensity * factor;
          hemi.intensity = solOriginal.hemiIntensity * (0.85 + 0.15 * factor);
        }
        aplicarCielo();
        document.getElementById('sol-hora').style.setProperty('--sol-color', '#' + sol.color.getHexString());
        actualizarSolUnidad();
      }

      // ¿La unidad elegida tiene sol directo en este instante? Un solo rayo
      // desde el centro de su caja hacia el sol, contra todo lo demás que
      // pueda taparlo (losas, núcleo, otras unidades) — ver ocludoresSol.
      // Solo detecta autosombra del propio edificio: no sabe nada de
      // construcciones vecinas, así que es un "sí hay sol" confiable y un
      // "no hay sol" que puede ser optimista.
      // Con fachadas calculadas (FACHADAS, hoy BRUSCO) el rayo solo no
      // alcanza: desde el centro de una unidad al sur, en un piso alto, el
      // rayo hacia el norte sale por el pasillo sin chocar nada y decía
      // "recibe sol" mientras el bloque de asoleamiento decía "sin sol
      // directo". Ahora primero tiene que haber una fachada del lado del sol,
      // con las mismas franjas que actualizarAsoleamiento(), y recién después
      // se mira si algo del edificio la tapa. Los dos textos no pueden
      // contradecirse. En ese caso el rayo sale de afuera de esa fachada, no
      // del centro de la caja: con sol bajo y de costado, desde el centro
      // chocaba con la unidad vecina del mismo piso y decía "no" en plena
      // franja de sol.
      // Devuelve null si no hay fachadas calculadas (ROSSO, interior de
      // manzana: decide el rayo desde el centro, como antes), o la lista de
      // fachadas que tienen el sol de su lado en este minuto ([] = ninguna).
      function fachadasAlSol(u) {
        const fs = !u.orient && FACHADAS && FACHADAS.get(u.id);
        if (!fs || !fs.length) return null;
        const m = ultimoSol.minutos;
        return fs.filter(f => franjasSolFachada(proyecto.lat, proyecto.lon, tzOffsetHoras, ultimoSol.fecha, f.rumbo)
          .franjas.some(([a, b]) => m >= a && m <= b));
      }

      function actualizarSolUnidad() {
        const el = document.getElementById('p-sol');
        if (!solActivo || !elegida) { el.hidden = true; return; }
        if (ultimoSol.altitud <= 0) {
          el.textContent = 'Sin sol a esta hora en todo el edificio.';
          el.className = 'p-sol p-sol-sin';
          el.hidden = false;
          return;
        }
        // Interior de manzana en un proyecto con fachadas: el bloque de
        // asoleamiento ya dice que esas horas no las estimamos; un "recibe sol"
        // al lado se leía como contradicción. Sin aviso.
        const fsElegida = !elegida.orient && FACHADAS && FACHADAS.get(elegida.id);
        if (fsElegida && !fsElegida.length) { el.hidden = true; return; }
        const alSol = fachadasAlSol(elegida);
        if (alSol && !alSol.length) {
          el.textContent = 'No recibe sol directo a esta hora.';
          el.className = 'p-sol p-sol-sombra';
          el.hidden = false;
          return;
        }
        const caja = cajas.find(c => c.userData.unidad.id === elegida.id);
        if (!caja) { el.hidden = true; return; }
        if (alSol) {
          const dirSol = direccionSolModelo(ultimoSol.altitud, ultimoSol.azimut, geo.norte_grados)
            .applyQuaternion(grupoEdificio.quaternion);
          const limites = new THREE.Box3().setFromObject(caja);
          const centro = limites.getCenter(new THREE.Vector3());
          const tam = limites.getSize(new THREE.Vector3());
          const otros = ocludoresSol.filter(o => o !== caja);
          const libre = alSol.some(f => {
            // Normal de la fachada en el mundo: un "sol" horizontal en su rumbo.
            const n = direccionSolModelo(0, f.rumbo, geo.norte_grados).applyQuaternion(grupoEdificio.quaternion);
            const medio = 0.5 * (Math.abs(n.x) * tam.x + Math.abs(n.z) * tam.z);
            rayoSol.set(centro.clone().addScaledVector(n, medio + 0.3), dirSol);
            return rayoSol.intersectObjects(otros, false).length === 0;
          });
          el.textContent = libre ? 'Recibe sol directo ahora.' : 'A esta hora la tapa el propio edificio.';
          el.className = 'p-sol ' + (libre ? 'p-sol-sol' : 'p-sol-sombra');
          el.hidden = false;
          return;
        }
        // direccionSolModelo da la dirección relativa al edificio (mismo
        // sistema que usa sol.position, adentro de grupoEdificio) — pero
        // este rayo se tira en espacio del MUNDO (origen sale de
        // getWorldPosition), así que hay que rotarla por el giro actual del
        // edificio para que apunte al mismo sol "físico" sin importar cómo
        // esté girado en pantalla.
        const dir = direccionSolModelo(ultimoSol.altitud, ultimoSol.azimut, geo.norte_grados)
          .applyQuaternion(grupoEdificio.quaternion);
        const origen = caja.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.1);
        rayoSol.set(origen, dir);
        const ocluido = rayoSol.intersectObjects(ocludoresSol.filter(o => o !== caja), false).length > 0;
        el.textContent = ocluido ? 'No recibe sol directo a esta hora.' : 'Recibe sol directo ahora.';
        el.className = 'p-sol ' + (ocluido ? 'p-sol-sombra' : 'p-sol-sol');
        el.hidden = false;
      }

      function formatoHoraSol(minutos) {
        const h = Math.floor(minutos / 60), m = Math.round(minutos % 60);
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }

      const sliderHoraSol = document.getElementById('sol-hora');
      const etiquetaHoraSol = document.getElementById('sol-hora-txt');
      const etiquetaAmanecer = document.getElementById('sol-amanecer');
      const etiquetaAtardecer = document.getElementById('sol-atardecer');
      const etiquetaFechaSol = document.getElementById('sol-fecha-label');

      let fechaSol = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));

      function onSliderSolCambio() {
        const minutos = Number(sliderHoraSol.value);
        etiquetaHoraSol.textContent = formatoHoraSol(minutos);
        if (solActivo) aplicarSol(fechaSol, minutos);
      }
      sliderHoraSol.addEventListener('input', onSliderSolCambio);

      // Fija el día elegido, recalcula amanecer/atardecer (los bordes del
      // slider) y conserva la hora actual si sigue entrando en ese rango.
      function fijarFechaSol(fecha, etiqueta) {
        fechaSol = fecha;
        etiquetaFechaSol.textContent = etiqueta;
        const horario = horarioSolar(proyecto.lat, proyecto.lon, tzOffsetHoras, fecha);
        if (!horario) return; // no pasa en las latitudes soportadas hoy (UY/NI)
        sliderHoraSol.min = horario.amanecer;
        sliderHoraSol.max = horario.atardecer;
        etiquetaAmanecer.textContent = formatoHoraSol(horario.amanecer);
        etiquetaAtardecer.textContent = formatoHoraSol(horario.atardecer);
        const actual = Number(sliderHoraSol.value);
        const dentroDeRango = actual >= horario.amanecer && actual <= horario.atardecer;
        sliderHoraSol.value = dentroDeRango ? actual : Math.round((horario.amanecer + horario.atardecer) / 2);
        onSliderSolCambio();
        actualizarAsoleamiento();
      }

      // Fachadas por unidad (ver calcularFachadas()): null salvo en proyectos
      // con geometria.calles + norte + lat/lon — ROSSO y Altamira no entran.
      const FACHADAS = tieneNorte() ? calcularFachadas(UNIDADES, geo) : null;
      // Unidad del panel, para refrescar el bloque al cambiar la fecha del
      // simulador (no se usa `elegida` porque se declara más abajo).
      let unidadAsol = null;

      function nombreFachada(f) {
        return f.calle ? `${f.calle} (${f.cardinal})` : f.cardinal[0].toUpperCase() + f.cardinal.slice(1);
      }
      function unirConY(lista) {
        return lista.length > 1 ? lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1] : lista[0] || '';
      }

      // Texto de la celda "Orientación" de la tira de datos: units.orientacion
      // si está cargado (ROSSO), si no los puntos cardinales de las fachadas
      // calculadas (los nombres de calle van en el bloque de sol, que tiene
      // lugar para ellos), si no vacío y la celda se oculta.
      function textoOrientacion(u) {
        if (u.orient) return u.orient;
        const fs = FACHADAS && FACHADAS.get(u.id);
        if (!fs) return '';
        if (!fs.length) return 'Interior';
        const t = unirConY(fs.map(f => f.cardinal));
        return t[0].toUpperCase() + t.slice(1);
      }

      function actualizarAsoleamiento() {
        const caja = document.getElementById('p-asol');
        const u = unidadAsol;
        const fs = u && !u.orient && FACHADAS && FACHADAS.get(u.id);
        if (!fs) { caja.hidden = true; return; }
        document.getElementById('p-asol-fecha').textContent = etiquetaFechaSol.textContent;
        const lista = document.getElementById('p-asol-lista');
        const nota = document.getElementById('p-asol-nota');
        lista.replaceChildren();
        if (!fs.length) {
          nota.textContent = 'Da al interior de la manzana: sus horas de sol dependen de lo que tiene enfrente, así que no las estimamos.';
          caja.hidden = false;
          return;
        }
        for (const f of fs) {
          const { horario, franjas } = franjasSolFachada(proyecto.lat, proyecto.lon, tzOffsetHoras, fechaSol, f.rumbo);
          let txt;
          if (!franjas.length) txt = 'sin sol directo';
          else if (franjas.length === 1 && franjas[0][0] <= horario.amanecer + 1 && franjas[0][1] >= horario.atardecer - 1)
            txt = `todo el día, de ${formatoHoraSol(horario.amanecer)} a ${formatoHoraSol(horario.atardecer)}`;
          else txt = unirConY(franjas.map(([a, b]) => `de ${formatoHoraSol(a)} a ${formatoHoraSol(b)}`));
          const li = document.createElement('li');
          const b = document.createElement('strong');
          b.textContent = nombreFachada(f) + ': ';
          li.append(b, txt + '.');
          lista.appendChild(li);
        }
        // Hemisferio sur: el sol del mediodía viene del norte (y al revés en
        // el norte, p.ej. Managua). Una línea, sin exagerar.
        const ecuatorial = proyecto.lat < 0 ? 'norte' : 'sur';
        nota.textContent = (fs.some(f => f.cardinal === ecuatorial)
          ? `El sol del mediodía viene del ${ecuatorial}: es la orientación con más horas de sol en invierno. `
          : '') + 'Según la orientación de la fachada; no considera la sombra de edificios vecinos.';
        caja.hidden = false;
      }

      // Las etiquetas de estación dependen del hemisferio: el 21 de junio es
      // invierno en Montevideo pero verano en Managua (mismas dos fechas
      // físicas, nombre de estación al revés) — si no se ajusta, un
      // vendedor en Nicaragua termina mostrando "Verano" para el día que
      // menos sol tiene, justo el error de copy que más desconfianza genera.
      const ANIO_REF_SOL = new Date().getUTCFullYear();
      const hemisferioNorteSol = (proyecto.lat || 0) > 0;
      const FECHAS_FIJAS_SOL = [
        { etiqueta: (hemisferioNorteSol ? 'Verano' : 'Invierno') + ' · 21 jun', mes: 5, dia: 21 },
        { etiqueta: 'Equinoccio · 21 mar', mes: 2, dia: 21 },
        { etiqueta: (hemisferioNorteSol ? 'Invierno' : 'Verano') + ' · 21 dic', mes: 11, dia: 21 },
      ];
      const contFechaChipsSol = document.getElementById('sol-fecha-chips');
      const inputFechaCustomSol = document.getElementById('sol-fecha-custom');
      FECHAS_FIJAS_SOL.forEach(f => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = f.etiqueta;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          contFechaChipsSol.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          inputFechaCustomSol.value = '';
          fijarFechaSol(new Date(Date.UTC(ANIO_REF_SOL, f.mes, f.dia)), f.etiqueta);
        });
        contFechaChipsSol.appendChild(b);
      });
      inputFechaCustomSol.addEventListener('change', () => {
        if (!inputFechaCustomSol.value) return;
        contFechaChipsSol.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
        const fecha = new Date(inputFechaCustomSol.value);
        const etiqueta = fecha.toLocaleDateString('es-UY', { day: 'numeric', month: 'long', timeZone: 'UTC' });
        fijarFechaSol(fecha, etiqueta);
      });

      const fechaTriggerSol = document.getElementById('sol-fecha-trigger');
      const fechaPanelSol = document.getElementById('sol-fecha');
      fechaTriggerSol.addEventListener('click', () => {
        const abrir = fechaPanelSol.hidden;
        fechaPanelSol.hidden = !abrir;
        fechaTriggerSol.setAttribute('aria-expanded', String(abrir));
      });

      const solTrigger = document.getElementById('sol-trigger');
      const solPanel = document.getElementById('sol');
      const solEsHoja = matchMedia('(max-width:860px)');

      function activarSol(on) {
        solActivo = on;
        solTrigger.setAttribute('aria-pressed', String(on));
        solTrigger.setAttribute('aria-expanded', String(on));
        solPanel.classList.toggle('abierto', on);
        if (on) {
          aplicarSol(fechaSol, Number(sliderHoraSol.value));
        } else {
          sol.color.copy(solOriginal.color);
          sol.intensity = solOriginal.intensity;
          sol.position.copy(solOriginal.position);
          hemi.intensity = solOriginal.hemiIntensity;
          aplicarCieloDefault();
          actualizarSolUnidad();
        }
      }
      solTrigger.addEventListener('click', () => activarSol(!solActivo));

      // El sol es un control de la vista: en desktop vive en la toolbar,
      // al lado del giro automático. En mobile la toolbar se reduce a la
      // brújula, así que vuelve a la barra inferior como ícono cuadrado.
      const barraInferior = document.getElementById('barra-inferior');
      const grupoHerramientas = document.querySelector('#herramientas .hr-grupo');
      function ubicarSolTrigger() {
        const destino = solEsHoja.matches ? barraInferior : grupoHerramientas;
        // En la toolbar, junto al giro: antes de pantalla completa, que va última.
        if (solTrigger.parentElement !== destino)
          destino.insertBefore(solTrigger, destino === grupoHerramientas ? document.getElementById('hr-sep-pantalla') : null);
      }
      ubicarSolTrigger();
      solEsHoja.addEventListener('change', ubicarSolTrigger);
      document.getElementById('sol-cerrar').addEventListener('click', () => activarSol(false));

      // Desktop: la barra inferior va centrada salvo que choque con la
      // toolbar (Restablecer y los accesos a renders / avance la estiran;
      // en BRUSCO con todo a la vista pedía ~1450px). Entonces se corre a
      // la izquierda, como en tablet (.corrida, ver CSS). Se mide sin la
      // clase; los observadores cubren cualquier cambio de ancho.
      // Con el panel de la unidad abierto se centra en lo que queda libre
      // (ver CSS); si ni así entra (Restablecer y los accesos la estiran),
      // se esconde hasta que se cierre, como en mobile (.sin-lugar).
      const herramientasEl = document.getElementById('herramientas');
      function acomodarBarraInferior() {
        barraInferior.classList.remove('corrida', 'sin-lugar');
        if (solEsHoja.matches) return;
        barraInferior.classList.toggle('corrida',
          barraInferior.getBoundingClientRect().right + 16 > herramientasEl.getBoundingClientRect().left);
        barraInferior.classList.toggle('sin-lugar', document.getElementById('panel').classList.contains('abierto') &&
          barraInferior.scrollWidth > barraInferior.clientWidth + 1);
      }
      const obsBarra = new ResizeObserver(acomodarBarraInferior);
      obsBarra.observe(barraInferior);
      // Los hijos también: Restablecer aparece adentro de .fb-drops, y con la
      // barra ya al tope de su ancho eso no la cambia de tamaño.
      [...barraInferior.children].forEach(hijo => obsBarra.observe(hijo));
      obsBarra.observe(herramientasEl);
      addEventListener('resize', acomodarBarraInferior);

      // Mobile: la hoja del sol no tiene velo (ver CSS), así que arrastrar
      // sobre el edificio lo sigue girando con la hoja abierta. Un toque
      // sin arrastre hace lo que hacía el velo: cierra la hoja, y no llega
      // al click del lienzo (no abre además la tarjeta de una unidad).
      // Registrado antes que ese click, así corre primero.
      let inicioToqueSol = null;
      lienzo.addEventListener('pointerdown', e => { inicioToqueSol = { x: e.clientX, y: e.clientY }; });
      lienzo.addEventListener('click', e => {
        if (!solActivo || !solEsHoja.matches || !inicioToqueSol) return;
        if (Math.hypot(e.clientX - inicioToqueSol.x, e.clientY - inicioToqueSol.y) > 8) return;
        e.stopImmediatePropagation();
        activarSol(false);
      });

      if (tieneNorte()) {
        solTrigger.hidden = false;
        fijarFechaSol(fechaSol, 'Hoy');
      }

      /* ============================================================
         5. INTERACCIÓN
         ============================================================ */

      const rayo = new THREE.Raycaster();
      const raton = new THREE.Vector2(-2, -2);
      let posRaton = { x: 0, y: 0 }, sobre = null, sobreCalle = false, elegida = null, separado = false, pisoAislado = null;
      // Los valores de dormitorios (0 = monoambiente, 1, 2, 3...) salen de las
      // unidades cargadas, no de una lista fija: cada edificio tiene su propia
      // mezcla de tipologías.
      const dormsDisponibles = [...new Set(UNIDADES.map(u => u.dorms))].sort((a, b) => a - b);
      function etiquetaDorms(d) {
        return d === 0 ? 'Monoambiente' : d === 1 ? '1 dormitorio' : d + ' dormitorios';
      }
      let fDorms = new Set(dormsDisponibles), fEstado = new Set(Object.keys(ESTADOS));

      // Vinculación con el avance de obra (ver CLAUDE.md / diseño en el
      // chat): un piso cuenta como construido si tiene un hito
      // categoria='estructura' para ese `piso` con fecha_real cumplida.
      // Vacío si el desarrollador nunca marcó ningún hito así — el toggle
      // de abajo ni se muestra en ese caso, nunca se adivina qué está
      // construido. Atenúa las unidades exactamente como cualquier otro
      // filtro (aplicar()), así nunca inventa un segundo color de estado.
      const pisosConstruidos = new Set(
        (hitosObra || [])
          .filter(h => h.categoria === 'estructura' && h.piso != null && h.fecha_real)
          .map(h => h.piso)
      );
      let verSoloConstruido = false;

      const tooltip = document.getElementById('tooltip');
      const panel = document.getElementById('panel');

      // Filtro por torre (solo con TORRES): las opciones salen de las unidades
      // cargadas, en el orden Basamento → torres de geometria.torres.
      const torresDisponibles = TORRES
        ? ['Basamento', ...TORRES.map(t => t.codigo)].filter(t => UNIDADES.some(u => torreDe(u) === t))
        : [];
      let fTorre = new Set(torresDisponibles);

      const pasa = u => fDorms.has(u.dorms) && fEstado.has(u.estado) &&
        (!torresDisponibles.length || !torreDe(u) || fTorre.has(torreDe(u))) &&
        (pisoAislado === null || u.piso === pisoAislado) &&
        (!verSoloConstruido || pisosConstruidos.has(u.piso));

      const COLOR_FILTRADO = new THREE.Color(0x98A1A4);
      function aplicar() {
        cajas.forEach(c => {
          const u = c.userData.unidad, ok = pasa(u);
          c.userData.activa = ok;
          // Valores objetivo: animar() los interpola (fundido al filtrar).
          c.userData.opObj = ok ? aspectoDe(u).opacidad : 0.06;
          c.userData.colorObj = ok ? c.userData.colorBase : COLOR_FILTRADO;
          c.castShadow = ok;
          c.userData.bordeObj = ok ? BORDE_OPACIDAD : 0.04;
        });
        if (elegida && !pasa(elegida)) cerrar();
        actualizarBadgeFiltros();
      }

      // n: cantidad de unidades de la opción. En mobile da el ancho
      // proporcional del segmento (--n) y color la línea de composición (--c).
      function chip(cont, texto, color, alTocar, n) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.setAttribute('aria-pressed', 'true');
        if (n) b.style.setProperty('--n', n);
        if (color) b.style.setProperty('--c', color);
        b.innerHTML = (color ? '<span class="punto" style="background:' + color + '"></span>' : '') + texto;
        b.addEventListener('click', () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          b.setAttribute('aria-pressed', on);
          alTocar(on); aplicar();
        });
        cont.appendChild(b);
        return b;
      }
      // Guardados por valor para poder sincronizar su aria-pressed cuando
      // "ver unidades similares" cambia los filtros por código (ver
      // mostrarSimilares()), no solo cuando el visitante los toca a mano.
      const chipsDorms = {}, chipsEstado = {}, chipsTorre = {};
      const cifra = n => ' <span class="chip-n">' + n + '</span>';
      dormsDisponibles.forEach(d => {
        const n = UNIDADES.filter(u => u.dorms === d).length;
        chipsDorms[d] = chip(document.getElementById('f-dorms'), etiquetaDorms(d) + cifra(n), null,
          on => on ? fDorms.add(d) : fDorms.delete(d), n);
      });
      // Un chip por estado, pero solo los que tienen unidades: "Vendida 0"
      // en un edificio sin vendidas es ruido. Los estados sin unidades
      // siguen en fEstado (prendidos), así que pasa(u) no cambia. Si hay
      // unidades en alquiler (BRUSCO), "Disponible" pasa a "En venta": mismo
      // orden y nombres que la píldora de disponibilidad.
      Object.keys(ESTADOS).forEach(k => {
        const e = ESTADOS[k];
        const deEstado = UNIDADES.filter(u => u.estado === k);
        if (!deEstado.length) return;
        const nombre = k === 'disponible' && hayAlquiler ? 'En venta'
          : k === 'sin_dato' ? 'A consultar' : e.nombre;
        chipsEstado[k] = chip(document.getElementById('f-estado'), nombre + cifra(deEstado.length), e.color,
          on => on ? fEstado.add(k) : fEstado.delete(k), deEstado.length);
      });
      // Cifras al día después de refrescarDatos(). Un chip que queda en 0 se
      // oculta, como los que no tenían unidades al cargar; un estado que no
      // tenía chip al cargar no lo suma (su filtro sigue prendido).
      function actualizarCifrasEstado() {
        Object.entries(chipsEstado).forEach(([k, b]) => {
          const n = UNIDADES.filter(u => u.estado === k).length;
          b.hidden = !n;
          if (n) b.style.setProperty('--n', n);
          b.querySelector('.chip-n').textContent = n;
        });
      }
      if (torresDisponibles.length) {
        document.getElementById('f-torre-grupo').hidden = false;
        document.querySelector('.fb-drop[data-grupo="torre"]').hidden = false;
        torresDisponibles.forEach(t => {
          const n = UNIDADES.filter(u => torreDe(u) === t).length;
          chipsTorre[t] = chip(document.getElementById('f-torre'), (t === 'Basamento' ? t : 'Torre ' + t) + cifra(n), null,
            on => on ? fTorre.add(t) : fTorre.delete(t), n);
        });
      }

      // "Ver unidades disponibles similares" desde la lista de espera: misma
      // cantidad de dormitorios + disponibles, resaltadas atenuando el resto
      // (mismo mecanismo que los chips de filtro, ver aplicar()/pasa()).
      function mostrarSimilares(u) {
        fDorms = new Set([u.dorms]);
        fEstado = new Set(['disponible']);
        Object.entries(chipsDorms).forEach(([d, b]) => b.setAttribute('aria-pressed', Number(d) === u.dorms));
        Object.entries(chipsEstado).forEach(([k, b]) => b.setAttribute('aria-pressed', k === 'disponible'));
        cerrar();
        aplicar();
      }

      const btnObra = document.getElementById('obra-toggle');
      if (pisosConstruidos.size > 0) {
        btnObra.hidden = false;
        btnObra.addEventListener('click', () => {
          verSoloConstruido = !verSoloConstruido;
          btnObra.setAttribute('aria-pressed', verSoloConstruido);
          aplicar();
        });
      }

      const btnSep = document.getElementById('separar');
      btnSep.addEventListener('click', () => {
        separado = !separado;
        btnSep.setAttribute('aria-pressed', separado);
        pisosGrupo.forEach((g, i) => g.userData.objetivo = separado ? i * 2.5 : 0);
        // Al explotar la torre gana altura: sin esto la cámara general queda
        // encuadrada para la torre compacta y los pisos de arriba se cortan.
        // Acompaña a los pisos mientras se abren (ver pisosGrupo en el BUCLE).
        if (pisoAislado === null) {
          const { objetivo: obj, radio: r } = encuadreTorre();
          moverCamara({ objetivo: obj, radio: r }, MS_CAMARA_PISO);
        }
      });

      const riel = document.getElementById('pisos');
      const infoPiso = document.getElementById('piso-info');
      const phiGeneral = PHI_INICIAL;

      // Lleva la cámara a la altura del piso elegido (o de vuelta a la vista
      // general del edificio). Interpolada y más lenta que la toolbar: con
      // un salto corto cambiar de piso se siente como un corte.
      const MS_CAMARA_PISO = 750;
      function enfocarPiso(p) {
        if (p === null) moverCamara(encuadreTorre(), MS_CAMARA_PISO);
        else moverCamara({
          objetivo: new THREE.Vector3(CENTRO_X, p * PASO + ALTO / 2, CENTRO_Z),
          radio: CONJUNTO ? Math.max(72, radioBase() * 0.75) : 72, phi: 1.28,
        }, MS_CAMARA_PISO);
      }

      function actualizarInfoPiso() {
        if (pisoAislado === null) { infoPiso.classList.remove('visible'); return; }
        if (pisoAislado === 0) {
          infoPiso.innerHTML = '<b>Planta baja</b><span>Ingreso al edificio · aún sin definir</span>' +
            '<span class="pi-corto"><b>Planta baja</b> · ingreso al edificio</span>';
          infoPiso.classList.add('visible');
          return;
        }
        const enPiso = UNIDADES.filter(u => u.piso === pisoAislado);
        const disponibles = enPiso.filter(esOfertable).length;
        const sinConstruir = pisosConstruidos.size > 0 && !pisosConstruidos.has(pisoAislado);
        // Mobile: todo en una línea ("Piso 10 · 9 de 16 disponibles · Torre A 10 · B 6").
        let hayTorrePrevia = false;
        const corto = '<b>Piso ' + pisoAislado + '</b>' +
          (sinConstruir ? ' · sin construir' : '') + ' · ' +
          (disponibles ? disponibles + ' de ' + enPiso.length + ' disponibles'
            : enPiso.length + ' unidad' + (enPiso.length === 1 ? '' : 'es')) +
          torresDisponibles
            .map(t => [t, enPiso.filter(u => torreDe(u) === t).length])
            .filter(([, n]) => n)
            .map(([t, n]) => {
              const nombre = t === 'Basamento' ? t : (hayTorrePrevia ? '' : 'Torre ') + t;
              if (t !== 'Basamento') hayTorrePrevia = true;
              return ' · ' + nombre + ' ' + n;
            }).join('');
        infoPiso.innerHTML =
          '<b>Piso ' + pisoAislado + '</b>' +
          (sinConstruir ? '<span class="piso-obra-aviso">Todavía no construido</span>' : '') +
          '<span>' + (pisoAislado - 1) + ' piso' + (pisoAislado - 1 === 1 ? '' : 's') + ' por debajo · ' +
          (PISOS - pisoAislado) + ' por encima</span>' +
          '<span>' + enPiso.length + ' unidad' + (enPiso.length === 1 ? '' : 'es') +
          (disponibles ? ' · ' + disponibles + ' disponible' + (disponibles === 1 ? '' : 's') : '') + '</span>' +
          // Con varias torres, cuántas unidades aporta cada una a este nivel.
          (torresDisponibles.length
            ? '<span>' + torresDisponibles
                .map(t => [t, enPiso.filter(u => torreDe(u) === t).length])
                .filter(([, n]) => n)
                .map(([t, n]) => (t === 'Basamento' ? t : 'Torre ' + t) + ': ' + n)
                .join(' · ') + '</span>'
            : '') +
          '<span class="pi-corto">' + corto + '</span>';
        infoPiso.classList.add('visible');
      }

      // En mobile el riel es una hoja que se abre desde un botón del header
      // (ver #pisos-trigger); en desktop esos dos elementos quedan ocultos y sin
      // efecto. cerrarHoja() es un no-op inofensivo en desktop.
      const pisosTrigger = document.getElementById('pisos-trigger');
      const pisosTriggerLabel = pisosTrigger.querySelector('.pt-label');
      const pisosBackdrop = document.getElementById('pisos-backdrop');

      function abrirHoja() {
        cerrarFiltros();
        riel.classList.add('abierto');
        pisosBackdrop.classList.add('visible');
        pisosTrigger.setAttribute('aria-expanded', 'true');
      }
      function cerrarHoja() {
        riel.classList.remove('abierto');
        pisosBackdrop.classList.remove('visible');
        pisosTrigger.setAttribute('aria-expanded', 'false');
      }
      pisosTrigger.addEventListener('click', () => {
        riel.classList.contains('abierto') ? cerrarHoja() : abrirHoja();
      });
      pisosBackdrop.addEventListener('click', cerrarHoja);
      // Mobile: el riel no tiene velo (ver CSS), así que arrastrar sobre el
      // edificio lo sigue girando con el riel abierto. Un toque sin arrastre
      // lo cierra y sigue de largo: si tocó una unidad del piso elegido, se
      // abre su tarjeta en el mismo toque.
      let inicioToquePisos = null;
      lienzo.addEventListener('pointerdown', e => { inicioToquePisos = { x: e.clientX, y: e.clientY }; });
      // Lo mismo para la tarjeta de filtros (tampoco tiene velo).
      lienzo.addEventListener('click', e => {
        if (!inicioToquePisos) return;
        if (Math.hypot(e.clientX - inicioToquePisos.x, e.clientY - inicioToquePisos.y) > 8) return;
        if (riel.classList.contains('abierto')) cerrarHoja();
        if (filtrosEl.classList.contains('abierto')) cerrarFiltros();
      });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') { cerrarHoja(); cerrarFiltros(); } });

      // Mismo mecanismo de hoja que el riel de pisos, para Tipología/Estado/
      // Separar pisos: en desktop #filtros-trigger/#filtros-backdrop quedan
      // ocultos y estas funciones son no-ops inofensivos.
      const filtrosTrigger = document.getElementById('filtros-trigger');
      const filtrosBackdrop = document.getElementById('filtros-backdrop');
      const filtrosEl = document.getElementById('filtros');
      const ftBadge = document.getElementById('ft-badge');

      function abrirFiltros() {
        cerrarHoja();
        filtrosEl.classList.add('abierto');
        filtrosBackdrop.classList.add('visible');
        filtrosTrigger.setAttribute('aria-expanded', 'true');
      }
      function cerrarFiltros() {
        filtrosEl.classList.remove('abierto');
        filtrosBackdrop.classList.remove('visible');
        filtrosTrigger.setAttribute('aria-expanded', 'false');
      }
      filtrosTrigger.addEventListener('click', () => {
        filtrosEl.classList.contains('abierto') ? cerrarFiltros() : abrirFiltros();
      });
      filtrosBackdrop.addEventListener('click', cerrarFiltros);

      // Badge con la cantidad de opciones excluidas (todo prendido por default
      // = sin badge), para que se sepa desde afuera si hay un filtro activo sin
      // tener que abrir la hoja.
      function actualizarBadgeFiltros() {
        const excluidos = (dormsDisponibles.length - fDorms.size) + (Object.keys(ESTADOS).length - fEstado.size) +
          (torresDisponibles.length - fTorre.size);
        ftBadge.textContent = excluidos;
        ftBadge.hidden = excluidos === 0;
        // Hoja de mobile: cuántas unidades quedan a la vista con todo lo
        // aplicado (incluido el piso aislado) — lo mismo que muestra el 3D.
        const aLaVista = UNIDADES.filter(pasa).length;
        document.getElementById('ft-resumen').innerHTML = aLaVista === UNIDADES.length
          ? '<b>' + UNIDADES.length + '</b> unidades'
          : '<b>' + aLaVista + '</b> de ' + UNIDADES.length + ' unidades';
        // Barra de desktop: cuántas opciones quedan activas en cada grupo
        // filtrado ("Estado 2"), y Restablecer habilitado solo si hay algo
        // que restablecer (filtros, piso aislado, separar, solo construido).
        const activas = {
          dorms: fDorms.size < dormsDisponibles.length ? fDorms.size : 0,
          estado: Object.keys(chipsEstado).filter(k => fEstado.has(k)).length,
          torre: fTorre.size < torresDisponibles.length ? fTorre.size : 0,
          vista: (separado ? 1 : 0) + (verSoloConstruido ? 1 : 0),
        };
        if (activas.estado === Object.keys(chipsEstado).length) activas.estado = 0;
        document.querySelectorAll('.fb-drop').forEach(b => {
          const n = activas[b.dataset.grupo], badge = b.querySelector('.fb-n');
          badge.hidden = !n;
          badge.textContent = n;
          b.classList.toggle('filtrado', !!n);
        });
        const hayAlgo = excluidos > 0 || pisoAislado !== null || separado || verSoloConstruido;
        document.querySelectorAll('.fb-reset').forEach(b => b.hidden = !hayAlgo);
      }

      // Restablecer: vuelve todo a la vista inicial reusando los mismos
      // caminos que los controles (sets de filtro + aplicar(), click en los
      // toggles), así no hay una segunda lógica de filtrado.
      function restablecerFiltros() {
        fDorms = new Set(dormsDisponibles);
        fEstado = new Set(Object.keys(ESTADOS));
        fTorre = new Set(torresDisponibles);
        [chipsDorms, chipsEstado, chipsTorre].forEach(g =>
          Object.values(g).forEach(b => b.setAttribute('aria-pressed', 'true')));
        if (separado) btnSep.click();
        if (verSoloConstruido) btnObra.click();
        if (pisoAislado !== null) {
          pisoAislado = null;
          actualizarRielPisos();
          enfocarPiso(null);
        }
        aplicar();
      }
      document.querySelectorAll('.fb-reset').forEach(b => b.addEventListener('click', restablecerFiltros));

      // Popover de desktop: #filtros muestra un solo grupo, anclado sobre su
      // botón de la barra. En mobile los .fb-drop no se ven y esto no corre.
      const drops = document.querySelectorAll('.fb-drop');
      function cerrarGrupoFiltros() {
        filtrosEl.classList.remove('pop');
        delete filtrosEl.dataset.grupo;
        drops.forEach(b => b.setAttribute('aria-expanded', 'false'));
      }
      function abrirGrupoFiltros(boton) {
        const g = boton.dataset.grupo;
        if (filtrosEl.dataset.grupo === g) { cerrarGrupoFiltros(); return; }
        filtrosEl.dataset.grupo = g;
        filtrosEl.classList.add('pop');
        drops.forEach(b => b.setAttribute('aria-expanded', String(b === boton)));
        // Centrado sobre el botón, sin salirse de la pantalla.
        const r = boton.getBoundingClientRect(), w = filtrosEl.offsetWidth;
        const x = Math.min(window.innerWidth - w - 16, Math.max(16, r.left + r.width / 2 - w / 2));
        filtrosEl.style.left = x + 'px';
      }
      drops.forEach(b => b.addEventListener('click', () => abrirGrupoFiltros(b)));
      document.addEventListener('pointerdown', e => {
        if (!filtrosEl.classList.contains('pop')) return;
        if (filtrosEl.contains(e.target) || e.target.closest('.fb-drop')) return;
        cerrarGrupoFiltros();
      });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarGrupoFiltros(); });

      /* Plegar/desplegar el panel entero: solo tiene efecto visual en
         desktop (ver #pisos.colapsado en el CSS). En mobile #pisos-header
         queda oculto — abrir/cerrar la hoja completa desde #pisos-trigger
         ya cumple esa misma función, un segundo control adentro sería
         redundante. */
      const pisosHeader = document.getElementById('pisos-header');
      pisosHeader.addEventListener('click', () => {
        const colapsado = riel.classList.toggle('colapsado');
        pisosHeader.setAttribute('aria-expanded', String(!colapsado));
      });

      /* Filas del riel: se arman a partir de los datos, no de un rango fijo
         escrito a mano (mismo criterio que dormsDisponibles más arriba).
         proyecto.pisos sigue marcando el techo (PISOS), pero cada nivel de
         ese rango sin ninguna unidad cargada — un piso de amenities, como
         el 6 de Altamira — se muestra diferenciado y deshabilitado en vez
         de desaparecer: la lista tiene que seguir leyéndose como el
         edificio real, no como un catálogo de lo que hay data cargada.
         PB solo se dibuja si el proyecto la tiene (projects.tiene_pb; NULL
         o true = se muestra — así no le cambia el comportamiento a ningún
         proyecto existente hasta que alguien la ponga en false a mano en
         Supabase — ver supabase-migration-pisos.sql). */
      const listaPisos = document.getElementById('pisos-lista');
      const btnPB = document.getElementById('pisos-pb');
      const tienePB = proyecto.tiene_pb !== false;
      const filasPiso = [];

      // Disponibles = venta + alquiler: "hay algo que puedo tomar en este piso".
      // Sin ninguna, la fila no lleva cifra. refrescarDatos() la vuelve a llamar.
      function pintarCuentaPiso(b, p) {
        const disponibles = UNIDADES.filter(u => u.piso === p && esOfertable(u)).length;
        let cuenta = b.querySelector('.pf-count');
        if (!disponibles) { if (cuenta) cuenta.remove(); return; }
        if (!cuenta) {
          cuenta = document.createElement('span');
          cuenta.className = 'pf-count';
          b.appendChild(cuenta);
        }
        cuenta.textContent = disponibles;
      }

      for (let p = PISOS; p >= 1; p--) {
        const tieneUnidades = UNIDADES.some(u => u.piso === p);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pisos-fila';
        if (!tieneUnidades) {
          b.classList.add('pisos-fila--amenities');
          b.dataset.piso = p;
          b.textContent = 'Sin unidades';
          b.disabled = true;
        } else {
          b.setAttribute('aria-pressed', 'false');
          const num = document.createElement('span');
          num.textContent = p;
          b.appendChild(num);
          pintarCuentaPiso(b, p);
          if (pisosConstruidos.size > 0 && !pisosConstruidos.has(p)) b.classList.add('piso-sin-construir');
          b.addEventListener('click', () => {
            pisoAislado = pisoAislado === p ? null : p;
            actualizarRielPisos();
            enfocarPiso(pisoAislado);
            aplicar();
          });
        }
        filasPiso.push(b);
        listaPisos.appendChild(b);
      }

      if (tienePB) {
        btnPB.hidden = false;
        btnPB.textContent = 'PB';
        btnPB.setAttribute('aria-pressed', 'false');
        btnPB.addEventListener('click', () => {
          pisoAislado = pisoAislado === 0 ? null : 0;
          actualizarRielPisos();
          enfocarPiso(pisoAislado);
          aplicar();
        });
      }

      // Navegación por teclado: flechas arriba/abajo mueven el foco entre
      // filas seleccionables (se saltea "Sin unidades"), con tabindex
      // itinerante — una sola fila queda en el tab order a la vez, como
      // cualquier lista de radio buttons.
      const filasNavegables = filasPiso.filter(b => !b.disabled).concat(tienePB ? [btnPB] : []);
      filasNavegables.forEach((b, i) => b.tabIndex = i === 0 ? 0 : -1);
      function moverFocoPiso(desde, delta) {
        const i = filasNavegables.indexOf(desde);
        if (i === -1) return;
        const siguiente = filasNavegables[Math.min(filasNavegables.length - 1, Math.max(0, i + delta))];
        if (siguiente === desde) return;
        filasNavegables.forEach(b => b.tabIndex = -1);
        siguiente.tabIndex = 0;
        siguiente.focus();
      }
      function navegarPisoConTeclado(e) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        moverFocoPiso(document.activeElement, e.key === 'ArrowDown' ? 1 : -1);
      }
      listaPisos.addEventListener('keydown', navegarPisoConTeclado);
      btnPB.addEventListener('keydown', navegarPisoConTeclado);

      function actualizarRielPisos() {
        filasPiso.forEach((b, i) => {
          if (!b.disabled) b.setAttribute('aria-pressed', String(pisoAislado === PISOS - i));
        });
        if (tienePB) btnPB.setAttribute('aria-pressed', String(pisoAislado === 0));
        pisosTriggerLabel.textContent =
          pisoAislado === null ? 'Pisos' : pisoAislado === 0 ? 'PB' : 'Piso ' + pisoAislado;
        actualizarInfoPiso();
        actualizarFlechasPiso();
        // scrollIntoView mide: va al final, en el rAF, después de todas las
        // escrituras (antes estaba en el medio y forzaba un layout).
        const sel = filaSeleccionada();
        if (sel) requestAnimationFrame(() =>
          sel.scrollIntoView({ block: 'nearest', behavior: REDUCIR_MOVIMIENTO ? 'auto' : 'smooth' }));
      }

      // Flechas del riel: "arriba" sin piso elegido arranca desde abajo (el
      // recorrido natural de un edificio), "abajo" desde el último piso. Cada
      // paso es un click en la fila destino — el mismo camino que tocarla.
      const btnArriba = document.getElementById('pisos-arriba');
      const btnAbajo = document.getElementById('pisos-abajo');
      function filaSeleccionada() {
        return filasNavegables.find(b => b.getAttribute('aria-pressed') === 'true') || null;
      }
      function moverPisoAislado(haciaArriba) {
        const actual = filaSeleccionada(), n = filasNavegables.length;
        const i = actual ? filasNavegables.indexOf(actual) : (haciaArriba ? n : -1);
        const destino = filasNavegables[i + (haciaArriba ? -1 : 1)];
        if (destino && destino !== actual) destino.click();
      }
      function actualizarFlechasPiso() {
        const i = filasNavegables.indexOf(filaSeleccionada());
        btnArriba.disabled = i === 0;
        btnAbajo.disabled = i === filasNavegables.length - 1;
      }
      // Lecturas primero, escrituras después: el primer toggle invalidaba el
      // layout que medía el segundo. El scroll, una vez por cuadro; el tamaño
      // de la lista (al armarse, la ventana, la ficha), con un
      // ResizeObserver, que mide después del layout. Antes la primera
      // medición iba en un rAF, que corre antes del layout: con el DOM recién
      // armado lo forzaba.
      function actualizarBordesLista() {
        const L = listaPisos;
        const arriba = L.scrollTop > 2, abajo = L.scrollTop + L.clientHeight < L.scrollHeight - 2;
        L.classList.toggle('mas-arriba', arriba);
        L.classList.toggle('mas-abajo', abajo);
      }
      const bordesListaPorCuadro = porCuadro(actualizarBordesLista);
      listaPisos.addEventListener('scroll', bordesListaPorCuadro, { passive: true });
      new ResizeObserver(actualizarBordesLista).observe(listaPisos);
      btnArriba.addEventListener('click', () => moverPisoAislado(true));
      btnAbajo.addEventListener('click', () => moverPisoAislado(false));
      btnSep.addEventListener('click', actualizarBadgeFiltros);

      // Mobile: Filtros y Pisos no se abren juntos (abrirHoja/abrirFiltros
      // cierran el otro), pero los dos conviven con la ficha desplegada: ni
      // abrirlos la pliega ni desplegarla los cierra (pedido de Sebastian:
      // los datos del edificio no desaparecen). Ver --fin-ficha en el CSS.
      fichaToggle.addEventListener('click', () => {
        medirFinFicha();
        bordesListaPorCuadro(); // el riel cambia de alto: recalcular el fundido
      });

      /* ============================================================
         Descripción + plano de la unidad (#p-intro). El plano es la planta
         real de la tipología (subida por el cliente desde admin.html, ver
         MEDIA_POR_TIPOLOGIA más arriba); nunca un esquema dibujado a partir
         de m²/dorms: uno inventado que no coincide con los muros reales
         (diagonales, plantas en L) es peor que no mostrar nada. Sin planta,
         la tarjeta queda en su lugar con el estado vacío y un pedido por
         WhatsApp.
         - Título: geom.titulo de la unidad > typologies.titulo > "{tipología}
           en {barrio}".
         - Texto: geom.descripcion de la unidad > typologies.descripcion > uno
           armado con dormitorios, m² y orientación.
         ============================================================ */

      // Planta primero, después los renders de la tipología: el orden en que
      // se navega al ampliar con el lightbox.
      function mediaDeUnidad(u) {
        const media = (u.typologyId && MEDIA_POR_TIPOLOGIA[u.typologyId]) || { planta: [], render: [] };
        return media.planta.length ? [media.planta[0], ...media.render] : media.render;
      }

      // Barrio del título armado: el último tramo de la dirección, si tiene
      // coma y no es un número de puerta ("Ana Monterroso de Lavalleja 2162,
      // Cordón" → "Cordón"); si no, la ciudad.
      const BARRIO = (() => {
        const partes = (proyecto.direccion || '').split(',').map(s => s.trim()).filter(Boolean);
        const ultimo = partes.length > 1 ? partes[partes.length - 1] : '';
        return ultimo && !/\d/.test(ultimo) ? ultimo : (proyecto.ciudad || '').trim();
      })();

      // "Apartamento de 2 dormitorios, 64 m², orientación frente.", con lo
      // que haya: el dato que falta no va.
      function descripcionArmada(u) {
        // Espacio duro: "120,5 m²" no se parte entre renglones.
        const m2 = u.m2 != null ? formatearM2(u.m2, proyecto.locale) + '\xa0m²' : null;
        const orient = textoOrientacion(u);
        // Solo la inicial: "esquina Paullier", no "esquina paullier".
        const o = orient ? 'orientación ' + orient[0].toLowerCase() + orient.slice(1) : null;
        if (u.dorms == null && !m2 && !o) return '';
        // "Monoambiente de 38 m²", "Apartamento de 64 m²" (sin dormitorios cargados).
        const partes = u.dorms > 0 ? ['Apartamento de ' + etiquetaDorms(u.dorms), m2]
          : [(u.dorms === 0 ? 'Monoambiente' : 'Apartamento') + (m2 ? ' de ' + m2 : '')];
        return [...partes, o].filter(Boolean).join(', ') + '.';
      }

      const intro = {
        eyebrow: document.getElementById('p-intro-eyebrow'),
        tit: document.getElementById('p-intro-tit'),
        desc: document.getElementById('p-intro-desc'),
        ver: document.getElementById('p-ver-plano'),
        plano: document.getElementById('p-plano'),
        img: document.getElementById('p-plano-img'),
        pedir: document.getElementById('p-plano-pedir'),
        m2: document.getElementById('p-plano-m2'),
      };
      // cargando → listo, o vacio (sin planta, o la imagen no cargó). Sin
      // plano que mostrar, tampoco "Ver plano".
      function estadoPlano(e) {
        intro.plano.dataset.estado = e;
        intro.ver.hidden = e === 'vacio';
      }
      // getAttribute: sin src (estado vacío) no hay nada que resolver.
      intro.img.addEventListener('load', () => { if (intro.img.getAttribute('src')) estadoPlano('listo'); });
      intro.img.addEventListener('error', () => {
        if (!respaldoOriginal(intro.img) && intro.img.getAttribute('src')) estadoPlano('vacio');
      });
      // "Ver plano" y la tarjeta abren el lightbox de siempre en la planta, y
      // desde ahí se sigue a los renders de la tipología.
      function ampliarPlano() {
        if (elegida && intro.plano.dataset.estado !== 'vacio') galeria.abrir(mediaDeUnidad(elegida), 0, { zoom: true });
      }
      intro.ver.addEventListener('click', ampliarPlano);
      intro.plano.addEventListener('click', () => { if (intro.plano.dataset.estado === 'listo') ampliarPlano(); });

      const textoDe = v => typeof v === 'string' ? v.trim() : '';
      function pintarIntro(u) {
        const g = u.geom || {};
        const deTipologia = (u.typologyId && TEXTOS_TIPOLOGIA[u.typologyId]) || {};
        const tipo = tipologiaDe(u, NOMBRES_TIPOLOGIA) || (u.dorms != null ? etiquetaDorms(u.dorms) : 'Apartamento');
        intro.eyebrow.textContent = 'Unidad ' + numeroDe(u);
        intro.tit.textContent = textoDe(g.titulo) || deTipologia.titulo || [tipo, BARRIO].filter(Boolean).join(' en ');
        intro.desc.textContent = textoDe(g.descripcion) || deTipologia.descripcion || descripcionArmada(u);

        // Misma imagen (otra unidad de la tipología, o un repintado de
        // refrescarDatos()): ni se vuelve a pedir ni parpadea el esqueleto.
        const media = u.typologyId && MEDIA_POR_TIPOLOGIA[u.typologyId];
        const url = media && media.planta.length ? media.planta[0].url : '';
        intro.img.alt = url ? 'Plano de la unidad ' + numeroDe(u) : '';
        if (!url) {
          sacarImagenStorage(intro.img);
          estadoPlano('vacio');
        } else if (intro.img.dataset.original !== url) {
          estadoPlano('cargando');
          ponerImagenStorage(intro.img, url, VARIANTES_STORAGE.plano);
        } else if (intro.img.complete) estadoPlano(intro.img.naturalWidth ? 'listo' : 'vacio');
        intro.m2.textContent = u.m2 != null ? formatearM2(u.m2, proyecto.locale) + ' m²' : '';

        // Pedir el plano: el WhatsApp del pie, con otro mensaje. Donde el pie
        // no ofrece consulta (vendida/reservada) tampoco va.
        intro.pedir.hidden = !settingsRow.whatsapp || u.estado === 'vendido' || u.estado === 'reservado';
        if (!intro.pedir.hidden) {
          const texto = 'Hola, quiero pedir el plano de la unidad ' + numeroDe(u) + ' de ' + proyecto.nombre + ' (' +
            [tipo.toLowerCase(), u.m2 != null ? formatearM2(u.m2, proyecto.locale) + ' m²' : null]
              .filter(Boolean).join(', ') + '). ' + linkDe(u);
          intro.pedir.href = 'https://wa.me/' + settingsRow.whatsapp + '?text=' + encodeURIComponent(texto);
        }
      }

      // Lleva la cámara frente a la unidad, a la altura de su piso, con el
      // mismo recorrido suavizado que el resto de la cámara (moverCamara(),
      // que ya respeta prefers-reduced-motion y corta el giro automático).
      const MS_CAMARA_UNIDAD = 750;
      function enfocar(u) {
        // Unidades con contorno propio no tienen col/frente utilizables para
        // orientar la cámara — se deriva un ángulo equivalente del centroide
        // (mismo criterio: signo de Z = lado frente/contrafrente, X = desplazamiento lateral).
        // theta ya no orbita (ver CÁMARA): para dejar esa fachada mirando a
        // la cámara ahora hay que girar el EDIFICIO hasta que ese ángulo
        // quede alineado con el azimut fijo de la cámara, de ahí el theta - (...).
        // Con CONJUNTO la aproximación por SEP_X no sirve (unidades a ±20m del
        // centro): se usa el ángulo real del centroide visto desde el centro
        // del conjunto — mismo convenio (frente = π).
        const g = theta - (CONJUNTO && u._centro
          ? Math.atan2(u._centro.x - CENTRO_X, u._centro.z - CENTRO_Z)
          : u._centro
          ? (u._centro.z < 0 ? Math.PI : 0) - (u._centro.x / SEP_X) * 0.16
          : (u.frente < 0 ? Math.PI : 0) - u.col * 0.16);
        const PHI_UNIDAD = 1.32;
        // El objetivo es la unidad misma, no el centro del conjunto: en
        // BRUSCO una unidad de Torre B quedaba descentrada (o detrás de la
        // A). grupoEdificio gira alrededor del origen del mundo, así que el
        // centroide se rota con el giro de destino. Y = su piso, más lo que
        // lo levante "Separar pisos" (objetivo, no el offset en curso).
        const cx = u._centro ? u._centro.x : u.col * SEP_X;
        const cz = u._centro ? u._centro.z : u.frente * SEP_Z;
        const alto = u.geom && u.geom.alto ? u.geom.alto : ALTO;
        const sep = pisosGrupo[u.piso] ? pisosGrupo[u.piso].userData.objetivo || 0 : 0;
        const dest = new THREE.Vector3(
          cx * Math.cos(g) + cz * Math.sin(g),
          u.piso * PASO + sep + alto / 2,
          -cx * Math.sin(g) + cz * Math.cos(g));
        // Encuadre en la parte del lienzo que queda libre según lo que esté
        // abierto (se llama de nuevo al pasar de la tarjeta al panel):
        // - panel: en desktop tapa su ancho (--ancho-panel, ~37% de la
        //   pantalla) a la derecha; en mobile es una hoja inferior de hasta
        //   74vh, y una unidad en el centro de la pantalla quedaba abajo.
        // - tarjeta anclada (desktop): va arriba de la unidad; se le deja
        //   lugar, y abajo a la barra inferior, así el par queda centrado.
        // - tarjeta táctil: sube sobre la barra inferior.
        // Se corre el objetivo sobre los ejes de la cámara para que la unidad
        // caiga en el centro de lo visible.
        const W = innerWidth, H = innerHeight;
        const hoja = matchMedia('(max-width: 860px)').matches; // mismo corte que el @media del panel
        // En mobile arriba quedan la barra y la ficha, plegada o desplegada
        // (finFicha(): como queda al terminar de plegarse, abrir() la pliega
        // justo antes); en desktop, la barra superior (72px, 56 en ≤640: se
        // mide en vez de suponerla).
        const finBarra = document.getElementById('barra-sup').getBoundingClientRect().bottom;
        const techo = hoja ? Math.max(finBarra, finFicha() + 6) : finBarra;
        let libre;
        if (panel.classList.contains('abierto')) {
          libre = hoja
            ? { x0: 0, x1: W, y0: techo, y1: H - Math.min(panel.offsetHeight || H * 0.74, H * 0.74) }
            : { x0: 0, x1: W - panel.offsetWidth, y0: techo, y1: H };
        } else if (tarjeta.classList.contains('anclada')) {
          libre = { x0: 0, x1: W, y0: techo + tarjeta.offsetHeight + 16, y1: H - 80 };
        } else {
          libre = { x0: 0, x1: W, y0: techo, y1: tarjeta.getBoundingClientRect().top - 8 };
        }
        if (libre.y1 - libre.y0 < 80) libre.y0 = Math.min(56, libre.y1 - 80);
        const ndcX = (libre.x0 + libre.x1) / W - 1;
        const ndcY = 1 - (libre.y0 + libre.y1) / H;
        // Radio: 62 en desktop, de siempre. Pero nunca tan cerca que:
        // - a lo ancho entren menos de 40m: con el celular vertical el FOV
        //   horizontal es angosto (ver factorAspecto) y 62 dejaba ~25m, la
        //   unidad en primer plano con apenas sus vecinas. Con 40m la unidad
        //   queda en ~15% del ancho de cualquier celular y se ve el edificio.
        // - en la franja libre no entren ~10m de alto (hoja mobile abierta).
        const tanFov = Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
        const radioAncho = 40 / (2 * tanFov * (W / H));
        const radioFranja = 10 / (2 * tanFov * (libre.y1 - libre.y0) / H);
        const RADIO_UNIDAD = Math.min(150, Math.max(62, radioAncho, radioFranja));
        const medioH = RADIO_UNIDAD * tanFov;
        const medioW = medioH * (W / H);
        const D = new THREE.Vector3(Math.sin(PHI_UNIDAD) * Math.sin(theta), Math.cos(PHI_UNIDAD), Math.sin(PHI_UNIDAD) * Math.cos(theta));
        const derecha = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
        const arriba = new THREE.Vector3().crossVectors(D, derecha);
        dest.addScaledVector(derecha, -ndcX * medioW).addScaledVector(arriba, -ndcY * medioH);
        moverCamara({ giro: g, phi: PHI_UNIDAD, radio: RADIO_UNIDAD, objetivo: dest }, MS_CAMARA_UNIDAD);
      }

      // Links para compartir: siempre con ?p=, nunca con ?kiosco; fuera de
      // http, la URL canónica (BASE). El QR del showroom pasa BASE siempre
      // (ver actualizarQR()).
      function linkProyecto(propia = location.protocol.startsWith('http')
        ? location.origin + location.pathname
        : BASE) {
        return propia + '?p=' + encodeURIComponent(proyecto.slug);
      }
      // Con v= (ver versionCompartir()): lo usan el botón copiar del panel y el
      // mensaje de WhatsApp. El QR del showroom no pasa por acá: no lleva v=.
      function linkDe(u) {
        return linkProyecto() + '&u=' + u.id + '&v=' + versionCompartir([u]);
      }

      // En previsualizaciones (about:srcdoc) el historial no se puede tocar.
      function marcarURL(consulta) {
        try { history.replaceState(null, '', consulta); } catch (e) { /* sin historial */ }
      }

      // ?p=<slug> se preserva en la URL incluso al cerrar el panel — si no, un
      // edificio que no sea el default perdería su slug de la barra y una
      // recarga en ese momento resolvería al edificio equivocado. Lo mismo
      // ?kiosco=1: si la pantalla del showroom se recarga después de que
      // alguien abrió una unidad, tiene que volver en modo showroom.
      function queryProyecto() {
        return [
          proyecto.slug === DEFAULT_SLUG ? '' : 'p=' + encodeURIComponent(proyecto.slug),
          KIOSCO_URL ? 'kiosco=1' : '',
        ].filter(Boolean).join('&');
      }

      /* ============================================================
         FINANCIACIÓN — deslizador de entrega dentro del panel de unidad.
         Apagado y oculto por default (ver tieneFinanciacion()): sin
         fecha_ocupacion + entrega_min/max/default cargados el simulador ni
         aparece, nunca con valores default inventados — ver CLAUDE.md.
         `saldo_pct`/`ajuste_indice` son opcionales DENTRO del simulador:
         solo ocultan su propia línea, no lo apagan entero.
         ============================================================ */
      const finCfg = settingsRow.financiacion || {};
      function tieneFinanciacion() {
        return proyecto.fecha_ocupacion != null
          && finCfg.entrega_min != null && finCfg.entrega_max != null && finCfg.entrega_default != null;
      }

      // Cantidad de cuotas mensuales entre hoy y la fecha de ocupación del
      // proyecto — nunca un número fijo, sale de la fecha real cargada en
      // projects.fecha_ocupacion (no de projects.entrega, que es copy libre).
      function cuotasHasta(fechaISO) {
        const hoy = new Date();
        const fin = new Date(fechaISO + 'T00:00:00');
        let meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + (fin.getMonth() - hoy.getMonth());
        if (fin.getDate() < hoy.getDate()) meses--;
        return Math.max(meses, 1);
      }

      function calcularFinanciacion(u, entregaPct) {
        const saldoPct = finCfg.saldo_pct || 0;
        const cantidadCuotas = cuotasHasta(proyecto.fecha_ocupacion);
        const entregaMonto = u.precio * entregaPct / 100;
        const saldoMonto = u.precio * saldoPct / 100;
        const cuotaMensual = (u.precio - entregaMonto - saldoMonto) / cantidadCuotas;
        return { entregaPct, saldoPct, cantidadCuotas, entregaMonto, saldoMonto, cuotaMensual };
      }

      const finSlider = document.getElementById('p-fin-entrega');
      let finActual = null; // último desglose calculado — lo usan el link de WhatsApp y el evento

      function pintarFinanciacion(u, entregaPct) {
        const f = calcularFinanciacion(u, entregaPct);
        document.getElementById('p-fin-entrega-pct').textContent = f.entregaPct + '%';
        document.getElementById('p-fin-entrega-monto').textContent = formatearPrecio(f.entregaMonto, proyecto.moneda, proyecto.locale);
        document.getElementById('p-fin-cuota-monto').textContent = formatearPrecio(f.cuotaMensual, proyecto.moneda, proyecto.locale);
        const etiquetaFecha = new Intl.DateTimeFormat(proyecto.locale, { month: 'long', year: 'numeric' })
          .format(new Date(proyecto.fecha_ocupacion + 'T00:00:00'));
        document.getElementById('p-fin-cuota-detalle').textContent = f.cantidadCuotas + ' cuotas mensuales hasta ' + etiquetaFecha;
        const saldoEl = document.getElementById('p-fin-saldo');
        saldoEl.hidden = !f.saldoPct;
        if (f.saldoPct) saldoEl.textContent = 'Saldo contra entrega de llaves: ' + formatearPrecio(f.saldoMonto, proyecto.moneda, proyecto.locale);
        const ajusteEl = document.getElementById('p-fin-ajuste');
        ajusteEl.hidden = !(finCfg.mostrar_ajuste && finCfg.ajuste_indice);
        if (!ajusteEl.hidden) ajusteEl.textContent = 'Cuotas ajustadas por ' + finCfg.ajuste_indice + '.';
        return f;
      }

      function actualizarFinanciacionPanel(u) {
        const finPanel = document.getElementById('p-financiacion');
        // En alquiler no se financia una compra, aunque la unidad tenga
        // precio de venta cargado.
        if (!tieneFinanciacion() || u.precio == null || esAlquiler(u)) { finPanel.hidden = true; finActual = null; return; }
        finPanel.hidden = false;
        finSlider.min = finCfg.entrega_min;
        finSlider.max = finCfg.entrega_max;
        finSlider.value = finCfg.entrega_default;
        finActual = pintarFinanciacion(u, Number(finSlider.value));
      }

      finSlider.addEventListener('input', () => {
        if (!elegida || !tieneFinanciacion()) return;
        finActual = pintarFinanciacion(elegida, Number(finSlider.value));
        actualizarLinkWA(elegida);
      });
      // 'change' (no 'input'): un evento por elección soltada, no uno por
      // cada pixel arrastrado durante el gesto.
      finSlider.addEventListener('change', () => {
        if (!elegida || !finActual) return;
        registrarEventoSimulacion(proyecto.id, elegida.id, finActual.entregaPct);
      });

      // Arma el texto de WhatsApp; si hay una simulación activa, suma la
      // entrega y la cuota elegidas para que el vendedor arranque la
      // conversación sabiendo el presupuesto del visitante.
      function actualizarLinkWA(u) {
        let texto = 'Hola, quiero consultar por la unidad ' + numeroDe(u) + ' de ' + proyecto.nombre + ' (' +
          [(tipologiaDe(u, NOMBRES_TIPOLOGIA) || etiquetaDorms(u.dorms)).toLowerCase(), u.m2 != null ? formatearM2(u.m2, proyecto.locale) + ' m²' : null]
            .filter(Boolean).join(', ') + '). ' + linkDe(u);
        if (finActual) {
          texto += ' Simulé una entrega del ' + finActual.entregaPct + '% (' +
            formatearPrecio(finActual.entregaMonto, proyecto.moneda, proyecto.locale) + ') y una cuota mensual de ' +
            formatearPrecio(finActual.cuotaMensual, proyecto.moneda, proyecto.locale) + '.';
        }
        document.getElementById('p-wa').href = settingsRow.whatsapp
          ? 'https://wa.me/' + settingsRow.whatsapp + '?text=' + encodeURIComponent(texto)
          : '#';
      }

      /* ------------------------------------------------------------
         Consultar — solo con settings.consulta_url: URL plantilla del
         formulario de contacto del cliente, con {unidad}, {torre}, {piso},
         {tipologia} y {proyecto}. Embebido en un iframe abre en _top para
         que el visitante siga en el sitio del cliente.
         ------------------------------------------------------------ */
      const btnConsultar = document.getElementById('p-consultar');
      const consultaUrl = settingsRow.consulta_url || '';
      const enIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
      btnConsultar.target = enIframe ? '_top' : '_self';
      // Con Consultar, WhatsApp pasa a secundario: un solo botón verde. En el
      // pie queda solo el ícono, así que el nombre va en aria-label/title.
      if (consultaUrl) {
        const wa = document.getElementById('p-wa');
        wa.classList.replace('bton-p', 'bton-s');
        wa.setAttribute('aria-label', 'Consultar por WhatsApp');
        wa.title = 'Consultar por WhatsApp';
      }

      function actualizarConsulta(u) {
        btnConsultar.hidden = !consultaUrl || u.estado === 'vendido';
        if (btnConsultar.hidden) return;
        const valores = {
          unidad: numeroDe(u),
          torre: torreDe(u) || '',
          piso: u.piso,
          tipologia: tipologiaDe(u, NOMBRES_TIPOLOGIA) || etiquetaDorms(u.dorms),
          proyecto: partesNombre ? partesNombre[1] : proyecto.nombre,
        };
        // split/join y no replace(): un "$" en un valor no se interpreta.
        btnConsultar.href = Object.entries(valores).reduce(
          (url, [clave, valor]) => url.split('{' + clave + '}').join(encodeURIComponent(String(valor))),
          consultaUrl);
      }

      /* ------------------------------------------------------------
         Lista de espera — solo sobre unidades vendidas/reservadas (nunca
         'disponible'/'sin_dato', ver CLAUDE.md). Oculta .acciones-panel del
         pie y pone en su lugar un botón que lleva al formulario (#p-espera,
         en el cuerpo del panel).
         ------------------------------------------------------------ */
      const accionesPanel = document.getElementById('acciones-panel');
      const espera = document.getElementById('p-espera');
      const esperaForm = document.getElementById('p-espera-form');
      const esperaOk = document.getElementById('p-espera-ok');
      const esperaError = document.getElementById('p-espera-error');
      const esperaEnviar = document.getElementById('p-espera-enviar');
      const esperaIr = document.getElementById('p-espera-ir');
      // El botón del pie que lleva al formulario se esconde mientras el
      // botón "Anotarme" ya está a la vista: dos botones verdes que hacen
      // lo mismo confunden.
      let esperaIrPuede = false, esperaEnVista = false;
      function pintarEsperaIr() { esperaIr.hidden = !esperaIrPuede || esperaEnVista; }
      new IntersectionObserver(([e]) => { esperaEnVista = e.isIntersecting; pintarEsperaIr(); },
        { root: document.getElementById('panel') }).observe(esperaEnviar);
      const noDisponible = u => u.estado === 'vendido' || u.estado === 'reservado';

      // Unidades a las que este navegador ya se anotó — para no pedirle de
      // nuevo el nombre/contacto si vuelve a abrir la misma unidad más
      // tarde (el insert de todos modos quedaría bloqueado por el índice
      // único de dedup en Supabase; esto solo evita mostrarle el form).
      function esperaLocal() {
        try { return new Set(JSON.parse(localStorage.getItem('cota_espera') || '[]')); }
        catch { return new Set(); }
      }
      function marcarEsperaLocal(unitId) {
        try {
          const s = esperaLocal(); s.add(unitId);
          localStorage.setItem('cota_espera', JSON.stringify([...s]));
        } catch { /* sin localStorage no hay memoria entre visitas, no es bloqueante */ }
      }

      function actualizarEsperaPanel(u) {
        const mostrar = noDisponible(u);
        accionesPanel.hidden = mostrar;
        espera.hidden = !mostrar;
        esperaIrPuede = false;
        pintarEsperaIr();
        if (!mostrar) return;
        const yaAnotado = esperaLocal().has(u.id);
        esperaIrPuede = !yaAnotado;
        pintarEsperaIr();
        esperaForm.hidden = yaAnotado;
        esperaOk.hidden = !yaAnotado;
        if (!yaAnotado) {
          esperaForm.reset();
          esperaError.hidden = true;
          esperaEnviar.disabled = false;
        }
      }

      esperaForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!elegida) return;
        const nombre = document.getElementById('p-espera-nombre').value.trim();
        const contacto = document.getElementById('p-espera-contacto').value.trim();
        if (!nombre || !contacto) return;
        esperaEnviar.disabled = true;
        esperaError.hidden = true;
        const { error } = await sb.from('leads').insert({
          project_id: proyecto.id, unit_id: elegida.id, tipo: 'espera',
          nombre, contacto, sesion: obtenerSesion(), origen: obtenerOrigen(),
        });
        // 23505 = unique_violation: ya estaba anotado a esta unidad desde
        // esta sesión — se trata igual que un envío exitoso.
        if (error && error.code !== '23505') {
          esperaEnviar.disabled = false;
          esperaError.textContent = error.code === 'P0001'
            ? 'Dejaste varios contactos en poco tiempo — probá de nuevo en unos minutos.'
            : 'No pudimos guardar tu contacto. Probá de nuevo.';
          esperaError.hidden = false;
          return;
        }
        marcarEsperaLocal(elegida.id);
        esperaForm.hidden = true;
        esperaOk.hidden = false;
        esperaIrPuede = false;
        pintarEsperaIr();
      });

      esperaIr.addEventListener('click', () => {
        espera.scrollIntoView({ block: 'start', behavior: REDUCIR_MOVIMIENTO ? 'auto' : 'smooth' });
        document.getElementById('p-espera-nombre').focus({ preventScroll: true });
      });

      document.getElementById('p-espera-similares').addEventListener('click', () => {
        if (elegida) mostrarSimilares(elegida);
      });

      // En mobile el panel es una hoja con scroll propio (#panel, ver CSS);
      // el teclado tapa la mitad inferior de la pantalla y con ella el botón
      // de enviar, que queda debajo de los campos. Lo trae a la vista dentro
      // de esa misma hoja una vez que el teclado terminó de animarse.
      esperaForm.querySelectorAll('input').forEach(input => {
        input.addEventListener('focus', () => {
          setTimeout(() => esperaEnviar.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
        });
      });

      /* ============================================================
         Resumen de unidad: el mismo contenido en el tooltip (hover en
         desktop) y en la tarjeta táctil. Armado con nodos, no innerHTML:
         número y tipología vienen de la base.
         ============================================================ */
      const esTactil = matchMedia('(hover: none)').matches;
      // Siempre es-UY: el alquiler es siempre en UYU, sin importar el locale del
      // proyecto ("UYU 55.000").
      const fmtAlquiler = new Intl.NumberFormat('es-UY',
        { style: 'currency', currency: 'UYU', currencyDisplay: 'code', maximumFractionDigits: 0 });

      function nodo(tag, clase, texto) {
        const n = document.createElement(tag);
        if (clase) n.className = clase;
        if (texto != null) n.textContent = texto;
        return n;
      }

      const fmtVenta = formatoMoneda(proyecto.moneda, proyecto.locale);

      // Íconos de piso, dormitorios y m²: el trazo de los de la ficha (24×24,
      // 1.6, sin color propio) y el tamaño en em desde el CSS, así siguen al
      // texto en táctil y en el showroom. Contenido fijo, nunca de la base.
      const ICONOS_RESUMEN = {
        // El mismo de "pisos" en la ficha.
        piso: '<rect x="4" y="4" width="16" height="4.2"/><rect x="4" y="9.9" width="16" height="4.2"/><rect x="4" y="15.8" width="16" height="4.2"/>',
        dorms: '<path d="M3 19v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 16h18M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M12 5v6"/>',
        // Una planta en L: superficie, no "ampliar".
        m2: '<path d="M4 4h10v6h6v10H4z"/>',
        // Brújula: solo en el panel (la tarjeta no muestra orientación).
        orient: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-1.8 4.2L9 15l1.8-4.2z"/>',
      };
      // Los del panel están en el HTML vacíos (data-icono): una sola fuente.
      document.querySelectorAll('svg[data-icono]').forEach(s => { s.innerHTML = ICONOS_RESUMEN[s.dataset.icono]; });

      // Un dato del resumen: ícono + valor en tinta + etiqueta en gris, el
      // mismo lenguaje que los datos de la ficha (.cb-dato). antes = la
      // etiqueta va delante del valor ("Piso 3").
      function datoResumen(icono, valor, etiqueta, antes) {
        const d = nodo('span', 'tt-dato');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = ICONOS_RESUMEN[icono];
        d.appendChild(svg);
        if (etiqueta && antes) d.append(etiqueta + ' ');
        d.append(...valorEnTinta(valor));
        if (etiqueta && !antes) d.append(' ' + etiqueta);
        return d;
      }

      // Un texto de la base ("2 dormitorios", "Flex") con la misma regla:
      // si empieza con un número, la cifra en tinta y el resto en gris; si
      // no, todo en tinta. Así una tipología cargada como texto se ve igual
      // que la que sale de dorms.
      function valorEnTinta(texto) {
        const m = /^(\d+(?:[.,]\d+)?)(\s.+)$/.exec(texto);
        return m ? [nodo('b', null, m[1]), m[2]] : [nodo('b', null, texto)];
      }

      // Precio con la moneda en segundo plano ("US$" chico y gris, la cifra
      // en tinta): lo que se compara entre unidades es el número. Lo usan
      // la tarjeta y el panel; reemplaza el contenido de el.
      function pintarPrecio(el, fmt, valor) {
        el.textContent = '';
        for (const parte of fmt.formatToParts(valor))
          el.append(parte.type === 'currency' ? nodo('span', 'tt-moneda', parte.value) : parte.value);
        return el;
      }
      // Precio por m²: el número con el que se comparan unidades entre sí.
      // Solo con precio de venta y superficie (m² sin cargar o en 0, no).
      function tienePrecioM2(u) {
        return !esAlquiler(u) && u.precio != null && u.m2 > 0;
      }
      function precioPorM2(u) {
        return fmtVenta.format(u.precio / u.m2) + ' / m²';
      }

      function pintarResumenUnidad(cont, u, conPista) {
        const a = aspectoDe(u);
        const torreU = torresDisponibles.length ? torreDe(u) : null;
        cont.textContent = '';

        // Torre arriba, como el eyebrow del panel (solo en proyectos con torres).
        if (torreU) cont.appendChild(nodo('div', 'tt-torre', torreU === 'Basamento' ? torreU : 'Torre ' + torreU));

        const cab = nodo('div', 'tt-cab');
        const num = nodo('span', 'tt-num');
        num.append(nodo('span', 'tt-num-et', 'Unidad'), ' ' + numeroDe(u));
        cab.appendChild(num);
        const est = nodo('span', 'tt-estado');
        const punto = nodo('span', 'punto');
        punto.style.background = a.color;
        est.append(punto, nombreEstado(u));
        cab.appendChild(est);
        cont.appendChild(cab);

        // Piso · dormitorios · m², cada uno con su ícono. El que no tiene
        // dato no se arma: sin huecos ni separadores colgando.
        const datos = nodo('div', 'tt-datos');
        if (u.piso != null) datos.appendChild(u.piso === 0
          ? datoResumen('piso', 'PB')
          : datoResumen('piso', String(u.piso), 'Piso', true));
        const tipologia = tipologiaDe(u, NOMBRES_TIPOLOGIA);
        if (tipologia || u.dorms === 0) datos.appendChild(datoResumen('dorms', tipologia || etiquetaDorms(0)));
        else if (u.dorms > 0) datos.appendChild(datoResumen('dorms', String(u.dorms), 'dorm.'));
        if (u.m2 != null) datos.appendChild(datoResumen('m2', formatearM2(u.m2, proyecto.locale), 'm²'));
        if (datos.childElementCount) cont.appendChild(datos);

        // Precio: el de alquiler (UYU por mes) si es de alquiler — sin él,
        // ninguno: el de venta en una unidad que se alquila confunde —; el de
        // venta si hay uno y no está vendida. Sin dato, no se inventa nada.
        if (esAlquiler(u)) {
          if (u.precioAlquiler != null) {
            const p = pintarPrecio(nodo('div', 'tt-precio'), fmtAlquiler, u.precioAlquiler);
            p.appendChild(nodo('small', null, ' / mes'));
            cont.appendChild(p);
          }
        } else if (u.precio != null && u.estado !== 'vendido') {
          cont.appendChild(pintarPrecio(nodo('div', 'tt-precio'), fmtVenta, u.precio));
          if (tienePrecioM2(u)) cont.appendChild(nodo('div', 'tt-precio-m2', precioPorM2(u)));
        }
        // conPista: la línea "Click para ver la unidad" del tooltip; 'boton'
        // = la misma línea como botón (tarjeta anclada de desktop).
        if (conPista === 'boton') {
          const b = nodo('button', 'tt-hint tt-cta', 'Click para ver la unidad');
          b.type = 'button';
          cont.appendChild(b);
        } else if (conPista) cont.appendChild(nodo('div', 'tt-hint', 'Click para ver la unidad'));
      }

      // Sobre el puntero, centrado; sin salirse de la pantalla por los
      // costados, y debajo del puntero si arriba no entra (bajo el header).
      function ubicarTooltip() {
        const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
        const x = Math.min(innerWidth - w / 2 - 12, Math.max(w / 2 + 12, posRaton.x));
        tooltip.classList.toggle('abajo', posRaton.y - h - 24 < 76);
        tooltip.style.left = x + 'px';
        tooltip.style.top = posRaton.y + 'px';
      }

      /* Tarjeta de unidad: hoy solo la usa la demo del showroom (el clic o
         el toque en una unidad abre el panel directo, ver el click del
         lienzo). seleccionar() lleva la cámara hasta la unidad, la resalta y
         muestra el resumen; "Click para ver la unidad" (desktop) o "Ver
         unidad" (táctil) abre el panel y registra el evento en abrir(). En
         táctil la tarjeta sube sobre la barra inferior; en desktop va
         .anclada a la unidad, con el aspecto del tooltip, y aparece cuando
         la cámara ya casi llegó (viajando pegada a la unidad mientras gira
         el edificio se perdía entre los volúmenes). */
      const tarjeta = document.getElementById('tarjeta-unidad');
      if (!esTactil) tarjeta.classList.add('anclada');
      // cajaTarjeta = la unidad elegida; cajaAncla = donde está la tarjeta de
      // desktop en pantalla (al cambiar de unidad, la vieja se desvanece en
      // su lugar y con su contenido, y recién después pasa a la nueva).
      // inicioGuia = desde cuándo crece la línea guía (ver actualizarGuia()).
      let cajaTarjeta = null, cajaAncla = null, esperaTarjeta = 0, inicioGuia = 0;
      function seleccionar(caja) {
        cajaTarjeta = caja;
        clearTimeout(esperaTarjeta);
        tooltip.classList.remove('visible');
        const pintar = () => pintarResumenUnidad(document.getElementById('tarjeta-resumen'),
          caja.userData.unidad, esTactil ? false : 'boton');
        if (esTactil) {
          pintar();
          tarjeta.classList.add('visible');
          // La tarjeta táctil aparece enseguida; la línea, cuando la cámara
          // ya casi llegó (si no, barre la pantalla siguiendo a la unidad).
          inicioGuia = performance.now() + (REDUCIR_MOVIMIENTO ? 0 : MS_CAMARA_UNIDAD * 0.6);
        } else {
          if (!tarjeta.classList.contains('visible')) pintar();
          tarjeta.classList.remove('visible');
          esperaTarjeta = setTimeout(() => {
            if (cajaTarjeta !== caja) return;
            pintar();
            cajaAncla = caja;
            ubicarTarjeta();
            tarjeta.classList.add('visible');
            inicioGuia = performance.now();
          }, REDUCIR_MOVIMIENTO ? 0 : MS_CAMARA_UNIDAD * 0.6);
        }
        // Después de pintarla: enfocar() encuadra según el alto de la tarjeta.
        enfocar(caja.userData.unidad);
      }
      function ocultarTarjeta() {
        terminarViaje();
        clearTimeout(esperaTarjeta);
        cajaTarjeta = null;
        tarjeta.classList.remove('visible');
        guia.classList.remove('llego');
        sobre = null; // el próximo cuadro recalcula el hover (y su tooltip, que con la tarjeta no iba)
      }
      function verUnidadTarjeta() {
        const u = cajaTarjeta && cajaTarjeta.userData.unidad;
        if (u && !REDUCIR_MOVIMIENTO && !viaje) { viajarAlPanel(u); return; }
        ocultarTarjeta();
        if (u) abrir(u, true);
      }

      /* De la tarjeta al panel: la tarjeta no desaparece, viaja y se
         convierte en el panel. Su caja se desplaza y crece hasta el lugar
         final del panel (columna derecha en desktop, hoja inferior en
         mobile) en MS_VIAJE, con el easing de la interfaz (--ease); el
         contenido se funde en el primer tercio, y el panel, ya en su lugar
         sin deslizarse (.desde-tarjeta), aparece en el último 40%: acompaña
         el final del movimiento, no antes. El panel se abre con abrir(u,
         true) de siempre (evento, contenido, encuadre). La tarjeta queda
         debajo del panel (z-index 11 < 12) y al terminar vuelve a su estado
         oculto sin fundido. Con prefers-reduced-motion no hay viaje (ver
         verUnidadTarjeta()); con el panel ya abierto tampoco: el clic en
         otra unidad va directo a abrir() y la marca salta a la nueva. */
      const MS_VIAJE = 360;
      let viaje = null;
      function viajarAlPanel(u) {
        const desde = tarjeta.getBoundingClientRect();
        clearTimeout(esperaTarjeta);
        cajaTarjeta = null; // ubicarTarjeta() y la guía dejan de seguirla
        sobre = null;
        guia.classList.add('sin-linea');
        guia.classList.remove('llego');
        Object.assign(tarjeta.style, {
          transition: 'none', transform: 'none', right: 'auto', bottom: 'auto',
          boxSizing: 'border-box', overflow: 'hidden', pointerEvents: 'none',
          left: desde.left + 'px', top: desde.top + 'px',
          width: desde.width + 'px', height: desde.height + 'px',
        });
        panel.classList.add('desde-tarjeta');
        abrir(u, true);
        const hasta = panel.getBoundingClientRect();
        const caja = tarjeta.animate([
          { left: desde.left + 'px', top: desde.top + 'px', width: desde.width + 'px', height: desde.height + 'px',
            borderRadius: '16px' },
          { left: hasta.left + 'px', top: hasta.top + 'px', width: hasta.width + 'px', height: hasta.height + 'px',
            borderRadius: hasta.left < 1 ? '12px 12px 0 0' : '0px' },
        ], { duration: MS_VIAJE, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
        const contenido = [...tarjeta.children].map(n =>
          n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MS_VIAJE / 3, fill: 'forwards' }));
        const aparece = panel.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }],
          { duration: MS_VIAJE });
        viaje = { animaciones: [caja, aparece, ...contenido] };
        caja.finished.then(() => { if (viaje && viaje.animaciones[0] === caja) terminarViaje(); }, () => {});
      }
      function terminarViaje() {
        if (!viaje) return;
        viaje.animaciones.forEach(a => a.cancel());
        viaje = null;
        panel.classList.remove('desde-tarjeta');
        tarjeta.style.transition = 'none';
        tarjeta.classList.remove('visible');
        for (const p of ['transform', 'right', 'bottom', 'boxSizing', 'overflow', 'pointerEvents', 'left', 'top', 'width', 'height']) {
          tarjeta.style[p] = '';
        }
        void tarjeta.offsetWidth; // aplica el estado oculto antes de devolverle la transición
        tarjeta.style.transition = '';
      }
      document.getElementById('tarjeta-ver').addEventListener('click', verUnidadTarjeta);
      document.getElementById('tarjeta-cerrar').addEventListener('click', ocultarTarjeta);
      // Desktop: toda la tarjeta abre el panel; la pista es el botón visible.
      tarjeta.addEventListener('click', e => {
        if (esTactil) return;
        pausarHover(e);
        verUnidadTarjeta();
      });

      // Ancla de la tarjeta de desktop: el centro de la cara de arriba de la
      // unidad (la de abajo si arriba no entra, bajo el header), proyectado
      // a la pantalla. Se llama en cada cuadro, después del render.
      const ancla = new THREE.Vector3();
      function ubicarTarjeta() {
        const c = cajaAncla, u = c.userData.unidad;
        const medio = (u.geom && u.geom.alto ? u.geom.alto : ALTO) / 2;
        const W = innerWidth, H = innerHeight;
        const enPantalla = dy => {
          c.getWorldPosition(ancla);
          ancla.y += dy;
          ancla.project(camara);
          return { x: (ancla.x + 1) / 2 * W, y: (1 - ancla.y) / 2 * H, z: ancla.z };
        };
        const w = tarjeta.offsetWidth, h = tarjeta.offsetHeight;
        let p = enPantalla(medio);
        const abajo = p.y - h - 24 < 76;
        if (abajo) p = enPantalla(-medio);
        tarjeta.classList.toggle('abajo', abajo);
        tarjeta.classList.toggle('fuera', p.z > 1 || p.x < 0 || p.x > W || p.y < 0 || p.y > H);
        tarjeta.style.left = Math.min(W - w / 2 - 12, Math.max(w / 2 + 12, p.x)) + 'px';
        tarjeta.style.top = p.y + 'px';
      }

      /* Línea guía: une la tarjeta con su unidad. Sale del borde de la
         tarjeta que mira a la unidad (vertical sobre ella mientras entre en
         el ancho de la tarjeta) y termina en un punto sobre el centro de la
         unidad, proyectado en cada cuadro: acompaña al edificio si se gira.
         Crece desde la tarjeta en ~260ms y recién ahí aparece el punto. En
         desktop sigue a cajaAncla, para que al cambiar de unidad se
         desvanezca junto con la tarjeta vieja. */
      const guia = document.getElementById('tarjeta-guia');
      const [guiaHalo, guiaLinea] = guia.querySelectorAll('line');
      const guiaPunto = guia.querySelector('circle');
      // El punto va al centro de la fachada que mira a la cámara, no al
      // centro 3D de la unidad: ese queda metros adentro y, con la cámara
      // un poco desde arriba, su proyección subía hasta la losa de arriba.
      // Un rayo horizontal desde afuera, a media altura, hacia el centro:
      // donde toca la unidad está esa fachada (sirve con contornos curvos).
      const centroGuia = new THREE.Vector3(), haciaCamara = new THREE.Vector3();
      const origenRayo = new THREE.Vector3(), sentidoRayo = new THREE.Vector3();
      const rayoGuia = new THREE.Raycaster();
      function puntoFachada(c, destino) {
        c.getWorldPosition(destino);
        haciaCamara.set(camara.position.x - destino.x, 0, camara.position.z - destino.z).normalize();
        origenRayo.copy(destino).addScaledVector(haciaCamara, 60);
        rayoGuia.set(origenRayo, sentidoRayo.copy(haciaCamara).negate());
        const toque = rayoGuia.intersectObject(c, false);
        if (toque.length) destino.copy(toque[0].point);
        return destino;
      }
      function actualizarGuia(ahora) {
        const c = esTactil ? cajaTarjeta : cajaAncla;
        const p = REDUCIR_MOVIMIENTO ? 1 : Math.min(1, (ahora - inicioGuia) / 260);
        if (!c || p <= 0) { guia.classList.add('sin-linea'); guia.classList.remove('llego'); return; }
        const W = innerWidth, H = innerHeight;
        puntoFachada(c, centroGuia).project(camara);
        const ux = (centroGuia.x + 1) / 2 * W, uy = (1 - centroGuia.y) / 2 * H;
        const r = tarjeta.getBoundingClientRect();
        const sx = Math.min(r.right - 18, Math.max(r.left + 18, ux));
        const sy = uy > r.bottom ? r.bottom : uy < r.top ? r.top : null;
        // Sin línea si la unidad quedó detrás de la tarjeta o fuera de cuadro.
        if (sy === null || centroGuia.z > 1 || ux < 0 || ux > W || uy < 0 || uy > H) {
          guia.classList.add('sin-linea');
          guia.classList.remove('llego');
          return;
        }
        guia.classList.remove('sin-linea');
        const e = 1 - Math.pow(1 - p, 3);
        const ex = sx + (ux - sx) * e, ey = sy + (uy - sy) * e;
        for (const l of [guiaHalo, guiaLinea]) {
          l.setAttribute('x1', sx); l.setAttribute('y1', sy);
          l.setAttribute('x2', ex); l.setAttribute('y2', ey);
        }
        guiaPunto.setAttribute('cx', ux);
        guiaPunto.setAttribute('cy', uy);
        guia.classList.toggle('llego', p >= 1);
      }

      /* Marca de la unidad abierta en el panel: mientras el panel esté
         abierto, un punto con anillo sobre la fachada de la unidad (el mismo
         puntoFachada() de la guía) y una línea hasta el borde del panel que
         mira a ella: horizontal hasta el borde izquierdo en desktop, vertical
         hasta el borde de arriba de la hoja en mobile. Se proyecta en cada
         cuadro, así que sigue a la unidad al girar o hacer zoom. Como la
         guía, crece cuando la cámara ya casi llegó (si no, barre la pantalla)
         y vuelve a crecer al pasar a otra unidad.
         Unidad del otro lado: un rayo de la cámara al punto contra
         ocludoresSol (losas, núcleo, PB y el resto de las cajas); si algo lo
         corta antes, la marca pasa a punteada con el punto hueco (.tapada)
         en vez de dibujarse como si estuviera adelante. Tapada por el panel
         o la hoja, o fuera de cuadro: no se dibuja. */
      const marca = document.getElementById('marca-unidad');
      const [marcaHalo, marcaLinea] = marca.querySelectorAll('line');
      const marcaCirculos = marca.querySelectorAll('circle');
      const puntoMarca = new THREE.Vector3(), sentidoMarca = new THREE.Vector3();
      const rayoMarca = new THREE.Raycaster();
      let unidadMarca = null, cajaMarca = null, ocludoresMarca = [], inicioMarca = 0;
      function ocultarMarca() {
        marca.classList.remove('visible', 'llego');
      }
      function actualizarMarca(ahora) {
        if (elegida !== unidadMarca) {
          unidadMarca = elegida;
          cajaMarca = elegida ? cajas.find(c => c.userData.unidad.id === elegida.id) || null : null;
          ocludoresMarca = ocludoresSol.filter(o => o !== cajaMarca);
          inicioMarca = ahora + (REDUCIR_MOVIMIENTO ? 0 : MS_CAMARA_UNIDAD * 0.6);
          marca.classList.remove('llego');
        }
        const c = cajaMarca;
        const p = REDUCIR_MOVIMIENTO ? 1 : Math.min(1, (ahora - inicioMarca) / 260);
        if (!c || p <= 0 || !panel.classList.contains('abierto')) { ocultarMarca(); return; }
        puntoFachada(c, puntoMarca);
        const dist = camara.position.distanceTo(puntoMarca);
        rayoMarca.set(camara.position, sentidoMarca.subVectors(puntoMarca, camara.position).normalize());
        rayoMarca.far = dist - 0.05;
        const tapada = rayoMarca.intersectObjects(ocludoresMarca, false).length > 0;
        puntoMarca.project(camara);
        const W = innerWidth, H = innerHeight;
        const ux = (puntoMarca.x + 1) / 2 * W, uy = (1 - puntoMarca.y) / 2 * H;
        const r = panel.getBoundingClientRect();
        const hoja = r.left < 1; // mobile: el panel ocupa todo el ancho, abajo
        if (puntoMarca.z > 1 || ux < 0 || ux > W || uy < 0 || uy > H ||
          (hoja ? uy > r.top - 12 : ux > r.left - 12)) { ocultarMarca(); return; }
        // La línea sale del borde del panel y crece hasta el anillo (no
        // entra en él: el punto queda limpio).
        const sx = hoja ? ux : r.left, sy = hoja ? r.top : uy;
        const largo = Math.hypot(ux - sx, uy - sy);
        const e = (1 - Math.pow(1 - p, 3)) * Math.max(0, 1 - 10 / largo);
        const ex = sx + (ux - sx) * e, ey = sy + (uy - sy) * e;
        for (const l of [marcaHalo, marcaLinea]) {
          l.setAttribute('x1', sx); l.setAttribute('y1', sy);
          l.setAttribute('x2', ex); l.setAttribute('y2', ey);
        }
        for (const ci of marcaCirculos) { ci.setAttribute('cx', ux); ci.setAttribute('cy', uy); }
        marca.classList.add('visible');
        marca.classList.toggle('llego', p >= 1);
        marca.classList.toggle('tapada', tapada);
      }

      // Después de un clic que mueve la cámara el puntero queda quieto sobre
      // otra unidad: sin esto aparecían su tooltip y su resaltado apenas
      // terminaba el recorrido. El hover vuelve cuando el mouse se mueve.
      let hoverPausado = null;
      function pausarHover(e) {
        if (!esTactil) hoverPausado = { x: e.clientX, y: e.clientY };
      }
      lienzo.addEventListener('pointermove', e => {
        if (hoverPausado && Math.hypot(e.clientX - hoverPausado.x, e.clientY - hoverPausado.y) > 4) hoverPausado = null;
      });
      // La unidad elegida (en la tarjeta o en el panel) ya muestra su resumen:
      // no lleva tooltip, y se resalta como elegida, no como hover.
      function esElegidaCaja(c) {
        return c === cajaTarjeta || (!!elegida && c.userData.unidad.id === elegida.id);
      }
      // La ficha no: el edificio y la unidad se pueden ver a la vez (ver el
      // cierre de la ficha en captura).
      [pisosTrigger, filtrosTrigger].forEach(t => t.addEventListener('click', ocultarTarjeta));

      /* ============================================================
         Toolbar de vista: vista inicial, zoom, giro automático. Los
         movimientos se interpolan (~400ms) con los mismos límites que el
         arrastre y la rueda (radio 34–190), siempre vía ubicarCamara().
         ============================================================ */
      const REDUCIR_MOVIMIENTO = matchMedia('(prefers-reduced-motion: reduce)').matches;
      let transicionCamara = null;
      function moverCamara(destino, ms = 420) {
        registrarActividad();
        const desde = { giro, phi, radio, objetivo: objetivo.clone() };
        // Giro por el camino corto.
        let dGiro = 0;
        if (destino.giro != null) {
          dGiro = ((destino.giro - giro) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        }
        const t0 = performance.now(), dur = REDUCIR_MOVIMIENTO ? 1 : ms;
        const id = transicionCamara = {};
        (function paso(ahora) {
          if (transicionCamara !== id) return; // otro movimiento lo reemplazó
          const k = Math.min(1, (ahora - t0) / dur), e = 1 - Math.pow(1 - k, 3);
          giro = desde.giro + dGiro * e;
          if (destino.phi != null) phi = desde.phi + (destino.phi - desde.phi) * e;
          if (destino.radio != null) radio = desde.radio + (destino.radio - desde.radio) * e;
          if (destino.objetivo) objetivo.lerpVectors(desde.objetivo, destino.objetivo, e);
          ubicarCamara();
          if (k < 1) requestAnimationFrame(paso);
        })(t0);
      }
      // Arrastrar o usar la rueda corta cualquier transición en curso.
      lienzo.addEventListener('pointerdown', () => { transicionCamara = null; });
      lienzo.addEventListener('wheel', () => { transicionCamara = null; }, { passive: true });

      /* Encuadre general en lo que deja libre la interfaz: el edificio
         entero (de la base al techo) centrado entre los overlays, nunca
         debajo de uno. Arriba, el header y en mobile la ficha; abajo, la
         barra inferior y la toolbar; en desktop, a la izquierda la ficha
         (flota ahí) y a la derecha el riel de pisos. Se mide en vivo
         (rectLibre()). Mismo recurso que enfocar() con las unidades: correr
         el objetivo sobre los ejes de la cámara (y alejarla si no entra),
         sin setViewOffset: así enfocar() sigue igual. */
      const camaraEncuadre = camara.clone();
      function rectLibre() {
        const W = pantalla.ancho, H = pantalla.alto;
        const hoja = matchMedia('(max-width: 860px)').matches;
        // Lo oculto (showroom, hojas cerradas) no cuenta.
        const caja = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'
          ? el.getBoundingClientRect() : null;
        let x0 = 0, x1 = W, y0 = 0, y1 = H;
        const barraSup = caja(document.getElementById('barra-sup'));
        if (barraSup) y0 = barraSup.bottom;
        const fichaR = caja(ficha);
        // finFicha(): como queda al terminar de plegarse o desplegarse.
        if (fichaR) hoja ? y0 = Math.max(y0, finFicha()) : x0 = fichaR.right;
        for (const id of ['barra-inferior', 'herramientas']) {
          const r = caja(document.getElementById(id));
          if (r && r.height) y1 = Math.min(y1, r.top);
        }
        const rielR = hoja ? null : caja(riel);
        if (rielR && rielR.width) x1 = Math.min(x1, rielR.left);
        const m = hoja ? 12 : 24; // aire hasta cada overlay
        return { x0: x0 + m, x1: x1 - m, y0: y0 + m, y1: y1 - m };
      }
      // Planta del edificio (esquinas de cada volumen de los pisos, PB
      // incluida: unidades, losas, núcleo) con el giro en 0, que es como está
      // al armarse. De ahí
      // salen dos juegos de puntos: los de la vista inicial (giro 0), para el
      // ancho, y el cilindro que barre el edificio al girar, para el alto:
      // así ni el techo ni la base pasan debajo de un overlay en ningún punto
      // del giro automático.
      const plantaEdificio = [];
      let techoEdificio = 0;
      grupoEdificio.updateMatrixWorld(true);
      pisosGrupo.forEach(g => g.traverse(o => {
        if (!o.isMesh) return;
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) return;
        techoEdificio = Math.max(techoEdificio, b.max.y);
        plantaEdificio.push([b.min.x, b.min.z], [b.max.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.max.z]);
      }));
      const radioPlanta = Math.max(...plantaEdificio.map(([x, z]) => Math.hypot(x, z)));
      const cilindroPlanta = Array.from({ length: 32 }, (_, i) =>
        [radioPlanta * Math.cos(i / 32 * 2 * Math.PI), radioPlanta * Math.sin(i / 32 * 2 * Math.PI)]);
      // Rectángulo en pantalla (px) de los puntos de una planta, de la base
      // al techo, con camaraEncuadre ya ubicada.
      const vEncuadre = new THREE.Vector3();
      function rectPantalla(planta, techo) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, z] of planta) for (const y of [0, techo]) {
          vEncuadre.set(x, y, z).project(camaraEncuadre);
          const sx = (vEncuadre.x + 1) / 2 * pantalla.ancho, sy = (1 - vEncuadre.y) / 2 * pantalla.alto;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        return { x0, x1, y0, y1 };
      }
      // El encuadre general de la torre entera (con "Separar pisos", más
      // alta). Nunca más cerca que antes (radioBase()): solo se aleja si el
      // edificio no entra en lo libre. Converge en pocas vueltas: la
      // perspectiva hace que correr y alejar no sean exactos.
      function encuadreTorre() {
        const extra = separado ? (pisosGrupo.length - 1) * 2.5 : 0;
        const techo = techoEdificio + extra;
        const libre = rectLibre();
        const anchoLibre = Math.max(80, libre.x1 - libre.x0), altoLibre = Math.max(80, libre.y1 - libre.y0);
        camaraEncuadre.aspect = pantalla.ancho / pantalla.alto;
        camaraEncuadre.updateProjectionMatrix();
        const tanFov = Math.tan(THREE.MathUtils.degToRad(camaraEncuadre.fov / 2));
        const D = new THREE.Vector3(Math.sin(phiGeneral) * Math.sin(theta), Math.cos(phiGeneral), Math.sin(phiGeneral) * Math.cos(theta));
        const derecha = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
        const arriba = new THREE.Vector3().crossVectors(D, derecha);
        const minimo = Math.min(190, radioBase() + extra * 0.85);
        const obj = new THREE.Vector3(CENTRO_X, ALTURA * 0.45 + extra / 2, CENTRO_Z);
        let r = minimo;
        for (let i = 0; i < 8; i++) {
          camaraEncuadre.position.copy(obj).addScaledVector(D, r);
          camaraEncuadre.lookAt(obj);
          camaraEncuadre.updateMatrixWorld();
          const vista = rectPantalla(plantaEdificio, techo), giro = rectPantalla(cilindroPlanta, techo);
          // Centro: el de la vista inicial a lo ancho, el del giro a lo alto.
          const dx = (libre.x0 + libre.x1) / 2 - (vista.x0 + vista.x1) / 2;
          const dy = (libre.y0 + libre.y1) / 2 - (giro.y0 + giro.y1) / 2;
          const mundoPorPx = 2 * r * tanFov / pantalla.alto;
          obj.addScaledVector(derecha, -dx * mundoPorPx).addScaledVector(arriba, dy * mundoPorPx);
          const escala = Math.max((vista.x1 - vista.x0) / anchoLibre, (giro.y1 - giro.y0) / altoLibre);
          r = Math.min(190, Math.max(minimo, r * escala));
        }
        // Quien lo pide lo aplica (vista inicial, piso, separar, showroom):
        // reencuadrar() compara contra este.
        encuadreAplicado = { radio: r, objetivo: obj.clone() };
        return { phi: phiGeneral, radio: r, objetivo: obj };
      }
      // Mismo encuadre que enfocarPiso() / "Separar pisos", sin tocar el giro.
      // "Vista inicial" lo usa con el giro en 0; el showroom, tal cual.
      function encuadreGeneral() {
        if (pisoAislado !== null) {
          return {
            phi: 1.28,
            radio: CONJUNTO ? Math.max(72, radioBase() * 0.75) : 72,
            objetivo: new THREE.Vector3(CENTRO_X, pisoAislado * PASO + ALTO / 2, CENTRO_Z),
          };
        }
        return encuadreTorre();
      }
      // Al plegar o desplegar la ficha, al cambiar el tamaño de la ventana o
      // de la barra: si la cámara sigue en el encuadre general (no se acercó,
      // no inclinó, no hay una unidad ni un piso), va al nuevo. Arrastrando
      // espera a que se suelte: moverCamara() fija el giro mientras dura.
      let encuadreAplicado = null, encuadrePendiente = false;
      function reencuadrar() {
        if (!encuadreAplicado || pisoAislado !== null) return;
        if (Math.abs(radio - encuadreAplicado.radio) > 0.05 || objetivo.distanceTo(encuadreAplicado.objetivo) > 0.05 ||
          Math.abs(phi - phiGeneral) > 0.005) return;
        if (arrastrando) { encuadrePendiente = true; return; }
        const e = encuadreTorre();
        if (Math.abs(e.radio - radio) < 0.05 && e.objetivo.distanceTo(objetivo) < 0.05) return;
        moverCamara({ radio: e.radio, objetivo: e.objetivo });
      }
      // Después del pointerup que suelta el arrastre (por eso el cuadro de
      // espera: el orden de los listeners no importa).
      lienzo.addEventListener('pointerup', () => {
        if (encuadrePendiente) requestAnimationFrame(() => { encuadrePendiente = false; reencuadrar(); });
      });
      document.getElementById('hr-reset').addEventListener('click', () =>
        moverCamara({ giro: 0, ...encuadreGeneral() }));
      document.getElementById('hr-mas').addEventListener('click', () =>
        moverCamara({ radio: Math.max(34, radio - 16) }, 260));
      document.getElementById('hr-menos').addEventListener('click', () =>
        moverCamara({ radio: Math.min(190, radio + 16) }, 260));
      const btnOrbita = document.getElementById('hr-orbita');
      btnOrbita.addEventListener('click', () => {
        transicionCamara = null;
        // Girando (solo o pedido) → corta como cualquier interacción;
        // quieto → "girar ahora", sin esperar la inactividad.
        if (giroForzado || rampaGiro > 0) registrarActividad();
        else giroForzado = true;
      });

      /* Brújula (solo con norte_grados): el rumbo del modelo −Z es
         norte_grados, así que el norte en coordenadas del modelo es
         (−sin N, −cos N) (mismo contrato que direccionSolModelo()). Se lo
         gira con el edificio (giro) y se proyecta sobre la pantalla con la
         cámara fija en theta: ángulo horario desde "arriba" de la pantalla. */
      const brujula = document.getElementById('brujula');
      const aguja = document.getElementById('brujula-aguja');
      const tieneBrujula = geo.norte_grados != null;
      brujula.hidden = !tieneBrujula;
      function anguloNorte(g) {
        const n = THREE.MathUtils.degToRad(geo.norte_grados);
        const mx = -Math.sin(n), mz = -Math.cos(n);
        const wx = mx * Math.cos(g) + mz * Math.sin(g), wz = -mx * Math.sin(g) + mz * Math.cos(g);
        const sx = wx * Math.cos(theta) - wz * Math.sin(theta);   // · derecha de la cámara
        const sy = -wx * Math.sin(theta) - wz * Math.cos(theta);  // · adelante de la cámara
        return Math.atan2(sx, sy);
      }
      let anguloBrujula = null;
      function actualizarBrujula() {
        if (!tieneBrujula) return;
        const a = THREE.MathUtils.radToDeg(anguloNorte(giro));
        if (anguloBrujula !== null && Math.abs(a - anguloBrujula) < 0.1) return;
        anguloBrujula = a;
        aguja.setAttribute('transform', 'rotate(' + a.toFixed(1) + ' 15 15)');
      }
      // Click: gira el edificio hasta dejar el norte arriba.
      brujula.addEventListener('click', () => {
        const a = anguloNorte(giro);
        const g = Math.abs(anguloNorte(giro + a)) < Math.abs(anguloNorte(giro - a)) ? giro + a : giro - a;
        moverCamara({ giro: g });
      });

      function abrir(u, mover) {
        registrarEvento(proyecto.id, u.id);
        elegida = u;
        tooltip.classList.remove('visible'); // en touch queda pegado en la última posición tocada
        pintarPanel(u);
        // Con el panel ya abierto en otra unidad el contenido cambia en el
        // lugar (sin cerrar ni volver a deslizarse) y arranca desde arriba.
        panel.scrollTop = 0;

        marcarURL('?' + [queryProyecto(), 'u=' + u.id].filter(Boolean).join('&'));
        panel.classList.add('abierto');
        actualizarSolUnidad();
        // Mobile: el panel es una hoja de hasta 74vh; con la ficha desplegada
        // arriba no quedaba lugar para el edificio. (Tocar una unidad abre el
        // panel, así que también la pliega.)
        if (matchMedia('(max-width: 860px)').matches) cerrarFicha();
        // Al final: enfocar() encuadra en lo que el panel deja libre y en
        // mobile necesita la altura real de la hoja ya con su contenido.
        if (mover) enfocar(u);
      }

      // El contenido del panel, sin efectos: abrir() lo usa y refrescarDatos()
      // lo repinta con el panel abierto (sin registrar otro evento en Demanda).
      function pintarPanel(u) {
        const torreU = torresDisponibles.length ? torreDe(u) : null;
        document.getElementById('p-eyebrow').textContent =
          (torreU ? (torreU === 'Basamento' ? torreU : 'Torre ' + torreU) + ' · ' : '') + 'Piso ' + u.piso;
        document.getElementById('p-unidad').textContent = numeroDe(u);
        document.getElementById('p-estado-txt').textContent = nombreEstado(u);
        // El fondo de la píldora sale del CSS por estado: sobre la foto, los
        // colores claros de la leyenda (vendida, sin estado) no dejaban leer
        // el texto blanco.
        document.getElementById('p-estado').dataset.estado = u.estado;
        // Foto de la cabecera: un render de la tipología si tiene; si no, el
        // del proyecto; sin ninguno queda el fondo verde.
        const mediaTipo = u.typologyId && MEDIA_POR_TIPOLOGIA[u.typologyId];
        const foto = (mediaTipo && mediaTipo.render.length && mediaTipo.render[0].url) || renderPortada;
        const heroImg = document.getElementById('p-hero-img');
        if (foto && heroImg.dataset.original !== foto) ponerImagenStorage(heroImg, foto, VARIANTES_STORAGE.cabecera);
        heroImg.hidden = !foto;
        pintarIntro(u);
        const tipologia = tipologiaDe(u, NOMBRES_TIPOLOGIA);
        const comoCifra = !tipologia && u.dorms > 0;
        // Sin tipología ni dormitorios cargados, la celda no va (si no,
        // "null dormitorios").
        document.getElementById('p-dorms-c').hidden = !tipologia && u.dorms == null;
        // "1 dormitorio", "2 dormitorios", "Monoambiente" (etiquetaDorms());
        // una tipología con nombre va entera.
        document.getElementById('p-dorms-dt').textContent = comoCifra ? 'Dormitorios' : 'Tipología';
        document.getElementById('p-dorms').textContent =
          tipologia || (u.dorms != null ? etiquetaDorms(u.dorms) : '');
        // Sin m² / precio cargados (null, no 0) se ocultan en vez de mostrar
        // "null m²" o un precio en cero — ver cargarProyecto().
        document.getElementById('p-m2-c').hidden = u.m2 == null;
        const pSup = document.getElementById('p-m2');
        pSup.textContent = '';
        if (u.m2 != null) pSup.append(nodo('b', null, formatearM2(u.m2, proyecto.locale) + ' m²'));
        // La orientación va en la barra y, sobre la foto, en la píldora.
        const orient = textoOrientacion(u);
        document.getElementById('p-orient-c').hidden = !orient;
        document.getElementById('p-orient').textContent = orient;
        document.getElementById('p-vista').hidden = !orient;
        document.getElementById('p-vista-txt').textContent = orient;
        unidadAsol = u;
        actualizarAsoleamiento();
        // Alquiler: precio mensual en UYU (u.precioAlquiler), igual que en el
        // tooltip; sin él, ninguno (nunca el de venta). Si no, el de venta,
        // como siempre.
        // Moneda en segundo plano y precio por m² debajo, como en la tarjeta.
        const alquiler = esAlquiler(u);
        const alquilerUYU = alquiler ? u.precioAlquiler : null;
        const venta = !alquiler && u.precio != null;
        document.getElementById('p-precio-wrap').hidden = alquilerUYU == null && !venta;
        const pPrecio = document.getElementById('p-precio');
        pPrecio.textContent = '';
        if (alquilerUYU != null) {
          pintarPrecio(pPrecio, fmtAlquiler, alquilerUYU);
          pPrecio.appendChild(nodo('small', null, ' / mes'));
        } else if (venta) pintarPrecio(pPrecio, fmtVenta, u.precio);
        const pPrecioM2 = document.getElementById('p-precio-m2');
        pPrecioM2.hidden = !tienePrecioM2(u);
        pPrecioM2.textContent = tienePrecioM2(u) ? precioPorM2(u) : '';

        const terraza = document.getElementById('p-terraza');
        terraza.hidden = !u.m2Terraza;
        if (u.m2Terraza) terraza.textContent = '+ ' + formatearM2(u.m2Terraza, proyecto.locale) + ' m² terraza';

        // Cochera: debajo del precio, en el pie — es parte de lo que cuesta.
        const cochera = document.getElementById('p-cochera');
        cochera.hidden = !u.cocheraPrecio;
        if (u.cocheraPrecio) cochera.textContent = 'Cochera opcional ' + formatearPrecio(u.cocheraPrecio, proyecto.moneda, proyecto.locale);
        const fuente = document.getElementById('p-fuente');
        fuente.textContent = u.estimado ? 'Dato estimado' : 'Dato publicado';
        fuente.className = 'p-tag ' + (u.estimado ? 'p-tag-estimado' : 'p-tag-real');
        fuente.title = u.estimado
          ? 'Precio y superficie estimados — falta el dato real.'
          : 'Precio y superficie publicados en el aviso.';
        actualizarFinanciacionPanel(u);
        actualizarLinkWA(u);
        actualizarConsulta(u);
        actualizarEsperaPanel(u);
      }

      function cerrar() {
        elegida = null;
        unidadAsol = null;
        panel.classList.remove('abierto');
        const qp = queryProyecto();
        marcarURL(location.pathname + (qp ? '?' + qp : ''));
        actualizarSolUnidad();
      }

      // Copiar link: ícono en la cabecera; la confirmación sale en el mismo
      // aviso flotante que el botón de compartir de la barra.
      const btnCopiar = document.getElementById('p-copiar');
      btnCopiar.addEventListener('click', async () => {
        if (!elegida) return;
        try { await navigator.clipboard.writeText(linkDe(elegida)); }
        catch { return; }
        mostrarAvisoCompartir('Link copiado');
      });

      document.getElementById('cerrar').addEventListener('click', cerrar);
      addEventListener('keydown', e => { if (e.key === 'Escape') { ocultarTarjeta(); cerrar(); } });
      // Soltar después de arrastrar (girar el edificio) también dispara
      // click: sin esta guarda, terminar un giro sobre una unidad la abría
      // y terminarlo en el vacío cerraba el panel. Si el puntero se alejó más
      // de UMBRAL_ARRASTRE px del pointerdown antes del pointerup, es un
      // arrastre, no un clic. Se mide en el recorrido y no en el click: en
      // táctil el click de un toque viene con las coordenadas del comienzo,
      // y un arrastre corto del dedo abría la unidad.
      const UMBRAL_ARRASTRE = 5;
      let inicioClic = null, arrastreClic = 0;
      lienzo.addEventListener('pointerdown', e => {
        // Un segundo dedo en el lienzo (pellizco; `dedos` ya lo contó, ver el
        // giro) no arranca otro clic: el gesto entero pasa a ser un arrastre
        // y al soltar no abre ni cierra nada.
        if (dedos.size > 1) { arrastreClic = Infinity; return; }
        inicioClic = { x: e.clientX, y: e.clientY };
        arrastreClic = 0;
      });
      function medirArrastre(e) {
        if (!inicioClic) return;
        arrastreClic = Math.max(arrastreClic, Math.hypot(e.clientX - inicioClic.x, e.clientY - inicioClic.y));
      }
      lienzo.addEventListener('pointerup', medirArrastre);
      // Ficha mobile desplegada: el toque en sí no la pliega (ver el
      // pointerdown en captura junto a cerrarFicha()); arrastrar el edificio
      // o tocar el vacío sí, como antes, y tocar una unidad también, porque
      // abre el panel (ver abrir()).
      lienzo.addEventListener('pointermove', e => {
        if (!arrastrando) return;
        medirArrastre(e);
        if (arrastreClic > UMBRAL_ARRASTRE && ficha.classList.contains('abierta')) cerrarFicha();
      });
      lienzo.addEventListener('click', e => {
        if (arrastreClic > UMBRAL_ARRASTRE) return;
        // Táctil: el rayo sale del punto tocado (no hay hover que lo haya
        // calculado antes). Lo mismo con el hover en pausa (otro clic sin
        // mover el mouse después de elegir una unidad): si no, ese clic
        // contaba como tocar el vacío y cerraba todo.
        let caja = sobre;
        if (esTactil || hoverPausado) {
          raton.x = (e.clientX / innerWidth) * 2 - 1;
          raton.y = -(e.clientY / innerHeight) * 2 + 1;
          rayo.setFromCamera(raton, camara);
          const toque = rayo.intersectObjects(cajas.filter(c => c.userData.activa), false);
          caja = toque.length ? toque[0].object : null;
        }
        if (caja) {
          pausarHover(e);
          // El clic abre el panel directo (la tarjeta queda solo para la demo
          // del showroom, y si estaba a la vista se va). Con el panel abierto
          // en otra unidad, abrir() cambia el contenido en el lugar, sin
          // cerrarlo; en la misma solo la vuelve a encuadrar: un doble clic no
          // cuenta dos aperturas en Demanda.
          const u = caja.userData.unidad;
          if (elegida && elegida.id === u.id) { enfocar(u); return; }
          // Solo si está: ocultarTarjeta() suelta el hover (sobre = null) y,
          // con el hover en pausa, el cursor quedaba de mano sobre el vacío.
          if (cajaTarjeta) ocultarTarjeta();
          abrir(u, true);
          return;
        }
        ocultarTarjeta();
        cerrarFicha();
        if (sobreCalle) window.open(cartelCalle.userData.mapsUrl, '_blank', 'noopener');
        else cerrar();
      });

      aplicar();

      // Encuadre inicial: con la interfaz ya armada (header, ficha plegada,
      // barra, riel), el edificio entero en lo que queda libre (ver
      // encuadreTorre()). Antes de ?u=: enfocar() arranca desde acá. Después
      // se rehace solo si cambia lo que tapa o la pantalla (ver reencuadrar()):
      // obsInterfaz ya observa body, header y ficha. Es la única medición
      // sincrónica de la carga, a propósito: el primer cuadro sale con este
      // encuadre, así que es el único layout forzado (lo demás se mide en
      // obsInterfaz, después del layout). No depende de lo que ajusta
      // ajustarCabezal(): la ficha tiene ancho fijo, el header alto fijo y
      // --fin-ficha solo mueve el riel en mobile, donde no cuenta.
      // --fin-ficha se pone acá, con el mismo layout (medir no cuesta): si
      // esperara a obsInterfaz, la escritura en :root recalcularía el estilo
      // de toda la página justo antes de que el riel mida su fundido.
      {
        const e = encuadreTorre();
        medirFinFicha();
        radio = e.radio;
        objetivo.copy(e.objetivo);
        ubicarCamara();
        for (const el of [document.getElementById('barra-inferior'), riel, document.getElementById('herramientas')]) {
          obsInterfaz.observe(el);
        }
      }

      // ?u=703 abre el edificio con esa unidad seleccionada y la cámara frente a ella.
      // ?sol= se lee antes: abrir() reescribe la URL a ?p=&u= y lo perdería.
      const pedidoSol = new URLSearchParams(location.search).get('sol');
      const pedida = new URLSearchParams(location.search).get('u');
      if (pedida) {
        const u = UNIDADES.find(x => String(x.id) === pedida);
        if (u) abrir(u, true);
      }

      // ?sol=1 abre con el simulador solar prendido; ?sol=invierno además lo
      // fija en el 21 de junio (el peor día del año en el hemisferio sur, el
      // primer chip de FECHAS_FIJAS_SOL). Es el link de la landing. Sin los
      // tres datos del sol (tieneNorte()) se ignora: nunca un sol inventado.
      if (pedidoSol && tieneNorte()) {
        if (pedidoSol === 'invierno') contFechaChipsSol.querySelector('.chip')?.click();
        activarSol(true);
      }

      // Compartir de la barra (#red-compartir): la URL de la barra tal cual
      // (con ?sol=, ?src=… si los trae) más el v= de la unidad de ?u= o, sin
      // ella, del proyecto entero (ver versionCompartir()).
      conVersion = url => {
        const x = new URL(url);
        const u = UNIDADES.find(y => String(y.id) === x.searchParams.get('u'));
        x.searchParams.set('v', versionCompartir(u ? [u] : UNIDADES));
        return x.toString();
      };

      /* ============================================================
         DATOS AL DÍA AL VOLVER A LA PESTAÑA (visibilitychange)
         El visor pide los datos una sola vez, al cargar. Para la demo (el
         visor en una pestaña o ventana y el admin en otra), al volver a la
         pestaña se piden de nuevo las unidades, las tipologías y su media,
         y lo que cambió se actualiza en el lugar, sin recargar. El showroom
         llama a lo mismo cada minuto (ver MS_CONSULTA_KIOSCO, en KIOSCO).
         - Cubre lo que se edita desde el admin en Unidades y Tipologías:
           estado (color del volumen con fundido, ficha, riel, chips de
           estado), precio de venta y de alquiler, estimado, m², terraza,
           cochera, orientación y la tipología asignada con su nombre para
           el comprador (nombre_publico), su planta y sus renders. La
           tarjeta y el panel abiertos se repintan solo si cambió su unidad
           o su tipología: repintar el panel reinicia el simulador de
           financiación y el formulario de lista de espera.
         - NO cubre, sigue necesitando recargar la página: unidades nuevas o
           borradas, cambios de geom (contorno, número, torre,
           geom.tipologia), dormitorios, piso o posición, y todo lo que no son
           unidades (proyecto, settings, renders del proyecto, amenities,
           avance de obra). La torre y los chips de dormitorios y de torre se
           arman una sola vez; también "En venta" (hayAlquiler) se decide al
           cargar.
         Si una consulta falla queda lo que había, y se reintenta en la
         próxima vuelta.
         ============================================================ */
      const CAMPOS_AL_DIA = ['estado', 'precio', 'precioAlquiler', 'estimado', 'm2', 'm2Terraza', 'cocheraPrecio', 'orient', 'typologyId'];
      // Media de tipologías + nombres para el comprador + título y texto del
      // panel, para saber si algo cambió.
      const firmaTipologias = (media, nombres, textos) =>
        (media || []).map(m => [m.id, m.typology_id, m.tipo, m.url, m.orden].join(' ')).join('|') +
        '#' + JSON.stringify(Object.entries(nombres).sort()) + '#' + JSON.stringify(Object.entries(textos).sort());
      let firmaTip = firmaTipologias(mediaTipologias, NOMBRES_TIPOLOGIA, TEXTOS_TIPOLOGIA), refrescando = false;
      async function refrescarDatos() {
        if (refrescando) return;
        refrescando = true;
        let rU = null, rM = null, rT = null;
        try {
          [rU, rM, rT] = await Promise.all([
            consultaUnidades(proyecto.id), consultaMediaTipologias(proyecto.id), consultaTipologias(proyecto.id)]);
        } catch { rU = null; } finally { refrescando = false; }
        if (!rU || rU.error || !rU.data || rM.error) return;

        const nuevas = new Map(rU.data.map(r => [r.id, normalizarUnidad(r)]));
        const cambiadas = new Set();
        let cambioEstado = false;
        UNIDADES.forEach(u => {
          const n = nuevas.get(u.id);
          if (!n) return; // borrada o despublicada: queda como estaba hasta recargar
          CAMPOS_AL_DIA.forEach(k => {
            if (u[k] === n[k]) return;
            if (k === 'estado') cambioEstado = true;
            u[k] = n[k];
            cambiadas.add(u);
          });
        });
        // Si falla solo esta, quedan los nombres que había (como en la carga).
        const nombres = rT.error ? NOMBRES_TIPOLOGIA : nombresPublicosDe(rT.data);
        const textos = rT.error ? TEXTOS_TIPOLOGIA : textosTipologiaDe(rT.data);
        const firma = firmaTipologias(rM.data, nombres, textos);
        const cambioTipologias = firma !== firmaTip;
        if (cambioTipologias) {
          firmaTip = firma;
          agruparMediaTipologias(rM.data);
          NOMBRES_TIPOLOGIA = nombres;
          TEXTOS_TIPOLOGIA = textos;
        }
        if (!cambiadas.size && !cambioTipologias) return;

        if (cambioEstado) {
          cajas.forEach(c => {
            const d = c.userData;
            if (!cambiadas.has(d.unidad)) return;
            // colorObj apunta a colorBase (salvo filtrada): el bucle hace el
            // fundido al color nuevo. El resplandor de la elegida sale de colorBase.
            d.colorBase.set(aspectoDe(d.unidad).color);
            d.emElegida = null;
          });
          pintarDisponibilidad();
          filasPiso.forEach((b, i) => { if (!b.disabled) pintarCuentaPiso(b, PISOS - i); });
          actualizarInfoPiso();
          actualizarCifrasEstado();
          aplicar(); // opacidad del estado nuevo y filtros (cierra el panel si la unidad ya no pasa)
        }
        const tocada = u => cambiadas.has(u) || (cambioTipologias && !!u.typologyId);
        if (cajaTarjeta && tocada(cajaTarjeta.userData.unidad)) {
          pintarResumenUnidad(document.getElementById('tarjeta-resumen'), cajaTarjeta.userData.unidad, esTactil ? false : 'boton');
        }
        if (elegida && tocada(elegida)) {
          pintarPanel(elegida);
          actualizarSolUnidad();
        }
      }
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarDatos(); });

      /* ============================================================
         KIOSCO — modo showroom: el edificio solo, girando, para una
         pantalla o tablet en la sala de ventas que funciona todo el día
         sin que nadie la atienda.
         - Botón de la toolbar (#hr-pantalla): el modo dura lo que dura la
           pantalla completa. Escape, el mismo botón o el gesto del sistema
           la terminan, y todo sale de fullscreenchange.
         - ?kiosco=1 (la pantalla del showroom): arranca ya en el modo. El
           navegador no deja entrar en pantalla completa sin un gesto, así
           que muestra "Iniciar"; si después se sale de la pantalla completa
           vuelve "Iniciar", nunca la interfaz normal.
         El modo es body.kiosco (el CSS esconde la interfaz) + los tiempos
         del mismo giro automático (INACTIVIDAD_KIOSCO_MS, VEL_GIRO_KIOSCO)
         + la demo que cada tanto destaca una unidad (ver el reloj, abajo).
         No toca filtros, piso aislado ni separar pisos: al salir quedan
         como estaban. Sí cierra la tarjeta o el panel de una unidad, que
         frenan el giro.
         ============================================================ */
      const raiz = document.documentElement;
      const pedirPantalla = raiz.requestFullscreen || raiz.webkitRequestFullscreen;
      const salirPantalla = document.exitFullscreen || document.webkitExitFullscreen;
      const enPantallaCompleta = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
      // iPhone no tiene pantalla completa para la página: ahí ?kiosco=1 sigue
      // andando (modo limpio + giro + pantalla encendida), sin el botón.
      const hayPantallaCompleta = !!pedirPantalla && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
      const btnPantalla = document.getElementById('hr-pantalla');
      const btnIniciar = document.getElementById('kiosco-iniciar');
      btnPantalla.hidden = document.getElementById('hr-sep-pantalla').hidden = !hayPantallaCompleta;

      function entrarPantalla() {
        // Rechazada (o sin promesa en Safari viejo): con ?kiosco=1 vuelve
        // "Iniciar" para probar de nuevo; si no, no pasa nada.
        try {
          const p = pedirPantalla.call(raiz, { navigationUI: 'hide' });
          if (p && p.catch) p.catch(() => { if (KIOSCO_URL) btnIniciar.hidden = false; });
        } catch (e) { if (KIOSCO_URL) btnIniciar.hidden = false; }
      }
      btnPantalla.addEventListener('click', () => {
        if (enPantallaCompleta()) salirPantalla.call(document);
        else entrarPantalla();
      });

      function alCambiarPantalla() {
        const llena = enPantallaCompleta();
        document.body.classList.toggle('pantalla-llena', llena);
        const txt = llena ? 'Salir de pantalla completa' : 'Pantalla completa';
        btnPantalla.setAttribute('aria-label', txt);
        btnPantalla.title = txt;
        if (KIOSCO_URL) btnIniciar.hidden = llena;
        else ponerKiosco(llena);
      }
      document.addEventListener('fullscreenchange', alCambiarPantalla);
      document.addEventListener('webkitfullscreenchange', alCambiarPantalla);

      // Encuadre del edificio entero y giro apenas llega la cámara.
      // moverCamara() registra actividad (frenaría el giro 20 s): se corre
      // ultimaActividad para que el giro arranque, con su rampa, al terminar
      // el recorrido.
      const MS_VUELTA_KIOSCO = 1200;
      function volverAlGiro() {
        ocultarTarjeta();
        cerrar();
        moverCamara(encuadreGeneral(), MS_VUELTA_KIOSCO);
        ultimaActividad = performance.now() + MS_VUELTA_KIOSCO - INACTIVIDAD_KIOSCO_MS;
      }

      function ponerKiosco(activo) {
        if (kiosco === activo) return;
        kiosco = activo;
        document.body.classList.toggle('kiosco', activo);
        programarConsultaKiosco();
        if (activo) {
          volverAlGiro();
          pedirWakeLock();
        } else {
          soltarWakeLock();
          // Una demo a medias no se queda en la interfaz normal: esa
          // tarjeta no la eligió nadie.
          if (demo) { demo = null; ocultarTarjeta(); }
        }
      }

      // Que la pantalla no se apague mientras dure el modo. Sin soporte o
      // rechazado (batería baja, http): se ignora. El navegador lo suelta
      // solo al ocultar la pestaña; se pide de nuevo al volver.
      let wakeLock = null;
      async function pedirWakeLock() {
        if (!kiosco || wakeLock || document.hidden || !('wakeLock' in navigator)) return;
        try {
          const l = await navigator.wakeLock.request('screen');
          if (!kiosco) { l.release().catch(() => {}); return; } // se salió mientras tanto
          wakeLock = l;
          l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; });
        } catch (e) { /* sin soporte: la pantalla sigue su propia configuración */ }
      }
      function soltarWakeLock() {
        if (wakeLock) wakeLock.release().catch(() => {});
        wakeLock = null;
      }
      document.addEventListener('visibilitychange', () => { if (!document.hidden) pedirWakeLock(); });

      /* Datos al día en el showroom: la pantalla de la sala nunca se oculta,
         así que el visibilitychange de refrescarDatos() no le llega. Mientras
         dure el modo, la misma consulta cada MS_CONSULTA_KIOSCO. Con la
         pestaña oculta se detiene; al volver, el visibilitychange de
         refrescarDatos() trae lo último y el intervalo arranca de nuevo.
         Fuera del modo no corre. Sin conexiones abiertas ni migración (el
         tiempo real se descartó: en una campaña, el tope de conexiones
         simultáneas de Supabase es un riesgo que esto no tiene). */
      const MS_CONSULTA_KIOSCO = 60000;
      let consultaKiosco = 0;
      function programarConsultaKiosco() {
        clearInterval(consultaKiosco);
        consultaKiosco = kiosco && !document.hidden ? setInterval(refrescarDatos, MS_CONSULTA_KIOSCO) : 0;
      }
      document.addEventListener('visibilitychange', programarConsultaKiosco);

      /* Reloj del showroom (cada 0,5 s), para una pantalla que nadie atiende:
         - Una tarjeta o un panel que quedaron abiertos no pueden frenar el
           giro para siempre: pasados los mismos 20 s sin tocar nada se
           cierran y el edificio vuelve a girar entero.
         - Demo: tras CADA_DEMO_MS de giro, destaca una unidad disponible con
           la misma selección de un clic (seleccionar(): cámara con
           recorrido, resaltado, tarjeta ampliada y línea guía; no abre el
           panel ni registra el evento, así no ensucia Demanda), la deja
           MS_DEMO y vuelve al giro. El giro arranca INACTIVIDAD_KIOSCO_MS
           después de ultimaActividad, así que de ahí se cuenta.
         - Cualquier toque corta la demo igual que corta el giro: pasa por
           registrarActividad(), que mueve ultimaActividad, y la demo deja de
           manejar la tarjeta (queda del visitante; la cierra la regla 1).
         Con "Iniciar" a la vista (?kiosco=1 sin arrancar) solo gira. */
      const CADA_DEMO_MS = 45000, MS_DEMO = 8000;
      let demo = null; // { hasta, actividad }: la demo en curso
      setInterval(() => {
        if (!kiosco || document.hidden) return;
        actualizarQR();
        const ahora = performance.now();
        if (demo) {
          if (ultimaActividad !== demo.actividad) demo = null; // la cortó un toque
          else if (ahora >= demo.hasta) { demo = null; volverAlGiro(); }
          return;
        }
        const quieto = ahora - ultimaActividad;
        if (cajaTarjeta || elegida) {
          if (quieto >= INACTIVIDAD_KIOSCO_MS) volverAlGiro();
        } else if (quieto >= INACTIVIDAD_KIOSCO_MS + CADA_DEMO_MS && btnIniciar.hidden) {
          const caja = proximaUnidadDemo();
          if (!caja) return; // ninguna disponible: queda solo el giro
          seleccionar(caja);
          // seleccionar() → moverCamara() acaba de registrar actividad: esa es
          // la de la demo; otra distinta es un toque.
          demo = { hasta: performance.now() + MS_CAMARA_UNIDAD + MS_DEMO, actividad: ultimaActividad };
        }
      }, 500);

      // Recorre las disponibles sin repetir hasta agotarlas (y vuelve a
      // empezar), saltando de piso para que se vea la altura: al azar entre
      // las que quedan a un tercio del edificio o más de la anterior; si
      // ninguna queda tan lejos, entre las más lejanas. Solo estado
      // 'disponible' (nunca vendida, reservada ni sin estado público) y que
      // pase los filtros puestos (activa): con "2 dormitorios" filtrado, la
      // demo muestra esas.
      let pendientesDemo = [], pisoDemo = null;
      function proximaUnidadDemo() {
        const candidatas = cajas.filter(c => c.userData.activa && c.userData.unidad.estado === 'disponible');
        if (!candidatas.length) return null;
        pendientesDemo = pendientesDemo.filter(c => candidatas.includes(c));
        if (!pendientesDemo.length) pendientesDemo = candidatas.slice();
        const salto = c => pisoDemo === null ? Infinity : Math.abs(c.userData.unidad.piso - pisoDemo);
        let opciones = pendientesDemo.filter(c => salto(c) >= Math.max(1, Math.round(PISOS / 3)));
        if (!opciones.length) {
          const max = Math.max(...pendientesDemo.map(salto));
          opciones = pendientesDemo.filter(c => salto(c) === max);
        }
        const caja = opciones[Math.floor(Math.random() * opciones.length)];
        pendientesDemo.splice(pendientesDemo.indexOf(caja), 1);
        pisoDemo = caja.userData.unidad.piso;
        return caja;
      }

      /* QR para llevarse el visor al celular: la URL normal del proyecto
         (sin ?kiosco, así en el celular se abre la versión completa) o, si
         hay una unidad destacada (la de la demo, la tarjeta o el panel), la
         de esa unidad. &src=qr-showroom separa en Demanda a quien llegó
         escaneando. Lo llama el reloj de arriba: cambia a lo sumo medio
         segundo después que la tarjeta. La librería (qrcode-generator) se
         carga recién en el modo: el visor normal no la descarga. Sin red no
         hay QR (reintenta cada 30 s); el resto del modo sigue igual. */
      const LIB_QR = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      const SRI_QR = 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1';
      const cajaQR = document.getElementById('kiosco-qr');
      let libQR = null, urlQR = null, falloQR = -Infinity;
      function actualizarQR() {
        const u = elegida || (cajaTarjeta && cajaTarjeta.userData.unidad) || null;
        // Siempre la URL pública (BASE), no la de esta pestaña: abierto desde
        // localhost o una copia local, el celular no podría abrir el link.
        // Sin v= a propósito (no usa linkDe()): un QR fotografiado o impreso
        // tiene que seguir sirviendo aunque cambie el estado de la unidad.
        const url = linkProyecto(BASE) + (u ? '&u=' + u.id : '') + '&src=qr-showroom';
        if (url === urlQR || performance.now() - falloQR < 30000) return;
        urlQR = url;
        libQR ||= new Promise((ok, mal) => {
          const s = document.createElement('script');
          s.integrity = SRI_QR;
          s.crossOrigin = 'anonymous';
          s.src = LIB_QR;
          s.onload = () => ok(window.qrcode);
          s.onerror = mal;
          document.head.appendChild(s);
        });
        libQR.then(qrcode => {
          if (urlQR === url) pintarQR(qrcode, url, u); // si no, ya cambió mientras cargaba
        }, () => {
          libQR = urlQR = null;
          falloQR = performance.now();
        });
      }
      // Dibujado a mano (un path con un cuadrado por módulo) y no con el
      // svg de la librería: así el color sale del CSS y el margen de 2
      // módulos, más el padding de la tarjeta, deja el silencio que pide
      // la cámara.
      function pintarQR(qrcode, url, u) {
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        const n = qr.getModuleCount();
        let d = '';
        for (let f = 0; f < n; f++)
          for (let c = 0; c < n; c++) if (qr.isDark(f, c)) d += 'M' + c + ' ' + f + 'h1v1h-1z';
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
        svg.setAttribute('viewBox', '-2 -2 ' + (n + 4) + ' ' + (n + 4));
        svg.setAttribute('shape-rendering', 'crispEdges');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'currentColor');
        svg.appendChild(path);
        document.getElementById('kiosco-qr-codigo').replaceChildren(svg);
        document.getElementById('kiosco-qr-txt').textContent =
          u ? 'para ver la unidad ' + numeroDe(u) : 'para ver el edificio';
        cajaQR.classList.add('listo');
      }

      if (KIOSCO_URL) {
        ponerKiosco(true);
        btnIniciar.hidden = false;
        btnIniciar.addEventListener('click', () => {
          btnIniciar.hidden = true;
          if (hayPantallaCompleta) entrarPantalla();
          volverAlGiro();
          pedirWakeLock(); // por si sin un toque el navegador no lo dio
        });
      }

      /* ============================================================
         6. BUCLE
         ============================================================ */

      // Giro automático (ver INACTIVIDAD_MS): nunca con la pestaña oculta.
      // Pasar el mouse por encima (hover/tooltip) no lo frena: el hover se
      // recalcula en cada cuadro, así que sigue a lo que quede bajo el
      // cursor mientras gira. El de inactividad además se frena con
      // cualquier panel, hoja, tarjeta o piso aislado; el pedido con el botón
      // es explícito y solo se corta con una interacción. La ficha mobile no
      // frena: arranca desplegada y se llevaría el giro de bienvenida. No
      // respeta prefers-reduced-motion a propósito: es un giro muy lento
      // (una vuelta cada 80 s) y con esa preferencia prendida (común en
      // Windows/Android) el edificio no giraba nunca.
      const modalRenders = document.getElementById('renders-modal');
      const modalAvance = document.getElementById('avance-modal');
      // En el showroom el riel, los filtros y el sol no están a la vista
      // (quedan como estaban, ver KIOSCO): no lo frenan, y con un piso
      // aislado gira igual.
      function puedeGirar(ahora) {
        if (document.hidden) return false;
        if (giroForzado) return true;
        return ahora - ultimaActividad >= (kiosco ? INACTIVIDAD_KIOSCO_MS : INACTIVIDAD_MS) &&
          !elegida && !cajaTarjeta && modalRenders.hidden && modalAvance.hidden &&
          (kiosco || (pisoAislado === null &&
            !riel.classList.contains('abierto') && !filtrosEl.classList.contains('abierto') &&
            !filtrosEl.classList.contains('pop') && !solPanel.classList.contains('abierto') && !capaAbierta()));
      }

      /* Contorno de la unidad elegida (la de la tarjeta o la del panel): un
         trazo grueso sobre sus aristas reales — la misma EdgesGeometry del
         borde fino, así que sigue el contorno de BRUSCO y no una caja. El
         borde fino es LineBasicMaterial, cuyo `linewidth` se ignora: 1 px
         físico, medio px CSS en un celular con DPR 2, y no se leía. Las
         líneas de r128 tienen ancho fijo en px de pantalla (igual de cerca
         que de lejos) sin postprocesado. Doble trazo, halo oscuro + núcleo
         blanco, para leerse sobre cualquier estado y contra cielo o pasto.
         Profundidad: va en el grupo del piso, en la posición de su unidad, y
         se dibuja después de todas las unidades (renderOrder 1 y 2) con
         depthTest: lo tapa solo lo que de verdad está adelante — losas,
         núcleo, cualquier unidad, también una vendida — y sus aristas
         traseras quedan detrás de sus caras. Dibujado en el orden de las
         transparentes (justo después de su unidad), una vecina con la pared
         compartida lo pintaba encima al 86–94% aunque no estuviera delante:
         una unidad entre dos vecinas, vista de frente, perdía las verticales.
         Ver también el sesgo de profundidad en conSesgo().
         Dos trazos para toda la escena, no uno por unidad: al cambiar de
         unidad uno se apaga mientras el otro se enciende. Entra con fundido
         y crecimiento del ancho y después queda quieto: la selección dura lo
         que dura la lectura del panel y nada se mueve en bucle. Sin los
         scripts de las líneas CONTORNO es null y la elegida se resalta como
         antes (emissive + borde fino). */
      const CONTORNO = THREE.LineSegments2 && THREE.LineMaterial && THREE.LineSegmentsGeometry ? (() => {
        const MS_ENTRA = 450, MS_CAMBIO = 200, MS_SALE = 180, MS_SALE_CAMBIO = 150;
        const ANCHO_HALO = 5, ANCHO_NUCLEO = 2.5, OP_HALO = 0.85, CRECE_DESDE = 0.4;
        // Por EdgesGeometry: en ROSSO todas las unidades comparten una.
        const geos = new Map();
        function geoDe(caja) {
          const bordes = caja.userData.borde.geometry;
          if (!geos.has(bordes)) geos.set(bordes, new THREE.LineSegmentsGeometry().fromEdgesGeometry(bordes));
          return geos.get(bordes);
        }
        // Sesgo de profundidad: el trazo tiene el ancho de varios px pero la
        // profundidad de la arista, y en una esquina cóncava (la base de la
        // unidad contra el balcón de la losa, una unidad en L) la mitad cae
        // sobre una cara más cercana y queda tapada. Cada punto se acerca a
        // la cámara sobre su propio rayo (no cambia dónde cae en pantalla)
        // lo que mide ANCHO_HALO px a esa distancia: nunca atraviesa nada
        // más grueso que el propio trazo, a cualquier zoom. Un
        // polygonOffset fijo, en cambio, a 190 m equivalía a casi un metro.
        function conSesgo(sh) {
          sh.uniforms.sesgoPx = { value: ANCHO_HALO };
          sh.vertexShader = 'uniform float sesgoPx;\n' + sh.vertexShader.replace(
            'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
            `$&
            float sesgo = 1.0 - sesgoPx * 2.0 / ( projectionMatrix[ 1 ][ 1 ] * resolution.y );
            start.xyz *= sesgo;
            end.xyz *= sesgo;`);
        }
        const materiales = [];
        function material(color, ancho) {
          const m = new THREE.LineMaterial({
            color, linewidth: ancho, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
          });
          m.onBeforeCompile = conSesgo;
          m.resolution.set(pantalla.ancho, pantalla.alto);
          materiales.push(m);
          return m;
        }
        // Después de todas las unidades (renderOrder 0); el núcleo después
        // del halo.
        function linea(color, ancho, orden) {
          const l = new THREE.LineSegments2(undefined, material(color, ancho));
          l.renderOrder = orden;
          return l;
        }
        const trazos = [0, 1].map(() => ({
          halo: linea(0x1A2124, ANCHO_HALO, 1),
          nucleo: linea(0xFFFFFF, ANCHO_NUCLEO, 2),
          caja: null, op: 0, ancho: 1, op0: 0, op1: 0, ancho0: 1, ancho1: 1, inicio: 0, dur: 0,
        }));
        function asignar(t, caja) {
          soltar(t);
          t.caja = caja;
          const geo = geoDe(caja);
          for (const l of [t.halo, t.nucleo]) {
            l.geometry = geo;
            l.position.copy(caja.position);
            caja.parent.add(l); // el grupo del piso: acompaña "separar pisos"
          }
        }
        function soltar(t) {
          t.caja = null;
          for (const l of [t.halo, t.nucleo]) if (l.parent) l.parent.remove(l);
        }
        function animarA(t, op, ancho, ms, ahora) {
          Object.assign(t, { op0: t.op, ancho0: t.ancho, op1: op, ancho1: ancho, inicio: ahora,
            dur: REDUCIR_MOVIMIENTO ? 0 : ms });
        }
        function avanzar(t, ahora) {
          const p = t.dur ? Math.min(1, (ahora - t.inicio) / t.dur) : 1;
          const e = 1 - Math.pow(1 - p, 3); // ease-out cúbico, como la cámara
          t.op = t.op0 + (t.op1 - t.op0) * e;
          t.ancho = t.ancho0 + (t.ancho1 - t.ancho0) * e;
          t.halo.material.opacity = t.op * OP_HALO;
          t.nucleo.material.opacity = t.op;
          t.halo.material.linewidth = ANCHO_HALO * t.ancho;
          t.nucleo.material.linewidth = ANCHO_NUCLEO * t.ancho;
          if (p >= 1 && t.op1 === 0) soltar(t);
        }
        let actual = trazos[0], otro = trazos[1], marcada = null, uCache = null, cajaCache = null;
        function cajaElegida() {
          if (elegida !== uCache) {
            uCache = elegida;
            cajaCache = elegida ? cajas.find(c => c.userData.unidad.id === elegida.id) || null : null;
          }
          return cajaCache;
        }
        return {
          actualizar(ahora) {
            const objetivo = cajaTarjeta || cajaElegida();
            if (objetivo !== marcada) {
              // De una unidad a otra: sin el crecimiento, solo fundido cruzado.
              const cambio = !!marcada && !!objetivo;
              if (objetivo && actual.caja === objetivo) animarA(actual, 1, 1, MS_CAMBIO, ahora); // volvió a la que se iba
              else {
                if (actual.caja) animarA(actual, 0, actual.ancho, cambio ? MS_SALE_CAMBIO : MS_SALE, ahora);
                if (objetivo) {
                  [actual, otro] = [otro, actual];
                  if (actual.caja !== objetivo) {
                    asignar(actual, objetivo);
                    actual.op = 0;
                    actual.ancho = cambio ? 1 : CRECE_DESDE;
                  }
                  animarA(actual, 1, 1, cambio ? MS_CAMBIO : MS_ENTRA, ahora);
                }
              }
              marcada = objetivo;
            }
            for (const t of trazos) if (t.caja) avanzar(t, ahora);
          },
          resolucion(w, h) { for (const m of materiales) m.resolution.set(w, h); },
        };
      })() : null;

      // Resaltado (ver el fundido de cajas en animar()). Con CONTORNO la
      // marca es el trazo y el emissive de la elegida baja de 0.6 a 0.2: el
      // 0.6 aclaraba hacia blanco y lavaba el color del estado (un verde de
      // disponible aclarado se acerca al salvia de alquiler); sin nada, las
      // caras a la sombra quedaban apagadas (reservada barrosa). Con 0.2 cada
      // estado queda cerca del color de su leyenda (ver "Selección de
      // unidad" en CLAUDE.md). Sin CONTORNO, el resaltado de antes.
      const OPACIDAD_ELEGIDA = 0.92, BORDE_ELEGIDA = 0.9, EMISIVO_ELEGIDA = 0.6, EMISIVO_CON_CONTORNO = 0.2;
      const BLANCO = new THREE.Color(1, 1, 1);
      const EMISIVO_HOVER = new THREE.Color(0.22, 0.22, 0.22), EMISIVO_NADA = new THREE.Color(0, 0, 0);

      let tCuadro = performance.now();
      function animar() {
        requestAnimationFrame(animar);
        // Velocidad por tiempo real, no por cuadro (igual a 60 y a 120 Hz).
        // Tope de 0,1 s para que un cuadro largo no dé un salto.
        const ahora = performance.now(), dt = Math.min(0.1, (ahora - tCuadro) / 1000);
        tCuadro = ahora;
        if (puedeGirar(ahora)) {
          rampaGiro = Math.min(1, rampaGiro + dt / RAMPA_GIRO_S);
          giro -= (kiosco ? VEL_GIRO_KIOSCO : VEL_GIRO) * rampaGiro * rampaGiro * (3 - 2 * rampaGiro) * dt; // smoothstep
          ubicarCamara();
        } else rampaGiro = 0; // corte seco, sin salida

        // Fundidos exponenciales por tiempo real, no por cuadro: un celular a
        // 30 fps tardaba el doble y una pantalla de 120 Hz la mitad. k = la
        // fracción del camino que se recorre en este cuadro; con constante τ,
        // a 3τ queda hecho el 95%: filtros ~240 ms, resaltado ~200 ms,
        // separar pisos ~430 ms (lo mismo que antes a 60 fps).
        const k = tau => REDUCIR_MOVIMIENTO ? 1 : 1 - Math.exp(-dt / tau);
        const kF = k(0.08), kH = k(0.065), kP = k(0.143);
        pisosGrupo.forEach((g, i) => {
          const d = g.userData;
          d.offset += (d.objetivo - d.offset) * kP;
          g.position.y = i * PASO + d.offset;
        });

        // Fundido de color/opacidad al filtrar o aislar un piso (aplicar()
        // fija los objetivos) y del resaltado, que se deduce acá mismo: la
        // unidad bajo el mouse, la de la tarjeta táctil y la abierta en el
        // panel (más marcada). Así abrir/cerrar también entra y sale con
        // fundido. (Antes un forEach al final del bucle fijaba la elegida en
        // 0.34 y ponía en 0 el resto en cada cuadro: pisaba esta
        // interpolación y la tarjeta táctil nunca llegaba a resaltar.)
        // La elegida (en la tarjeta o en el panel) no usa el mismo gris del
        // hover (0.22 vs 0.34 no se distinguía, y una vendida casi
        // transparente apenas se aclaraba): brilla en su propio color, sube a
        // opacidad casi plena y marca el borde, aunque los filtros la estén
        // atenuando.
        for (const c of cajas) {
          const d = c.userData, m = c.material;
          const esElegida = esElegidaCaja(c);
          const opObj = esElegida ? Math.max(d.opObj ?? m.opacity, OPACIDAD_ELEGIDA) : d.opObj;
          if (opObj != null) m.opacity = Math.abs(opObj - m.opacity) < 0.003 ? opObj : m.opacity + (opObj - m.opacity) * kF;
          const colorObj = esElegida ? d.colorBase : d.colorObj;
          if (colorObj) m.color.lerp(colorObj, kF);
          // Con CONTORNO el trazo grueso reemplaza al borde fino de la elegida
          // (quedaría como una línea suelta adentro del trazo).
          const bordeObj = esElegida ? (CONTORNO ? 0 : BORDE_ELEGIDA) : d.bordeObj;
          if (bordeObj != null) {
            const bm = d.borde.material;
            bm.opacity = Math.abs(bordeObj - bm.opacity) < 0.003 ? bordeObj : bm.opacity + (bordeObj - bm.opacity) * kF;
          }
          const emObj = esElegida
            ? (d.emElegida ||= d.colorBase.clone().lerp(BLANCO, 0.3)
              .multiplyScalar(CONTORNO ? EMISIVO_CON_CONTORNO : EMISIVO_ELEGIDA))
            : c === sobre ? EMISIVO_HOVER : EMISIVO_NADA;
          if (!m.emissive.equals(emObj)) {
            m.emissive.lerp(emObj, kH);
            const e = m.emissive;
            if (Math.abs(e.r - emObj.r) + Math.abs(e.g - emObj.g) + Math.abs(e.b - emObj.b) < 0.01) e.copy(emObj);
          }
        }
        if (CONTORNO) CONTORNO.actualizar(ahora);
        actualizarBrujula();
        const girando = String(rampaGiro > 0);
        if (btnOrbita.getAttribute('aria-pressed') !== girando) btnOrbita.setAttribute('aria-pressed', girando);

        rayo.setFromCamera(raton, camara);
        // En táctil no hay hover: la posición del "ratón" es la del último
        // arrastre y resaltaría unidades al azar. El tap se resuelve aparte
        // (ver el click del lienzo). Tampoco mientras está en pausa (ver
        // pausarHover()).
        const golpes = esTactil || hoverPausado ? [] : rayo.intersectObjects(cajas.filter(c => c.userData.activa), false);
        const nuevo = golpes.length ? golpes[0].object : null;
        if (nuevo !== sobre) {
          sobre = nuevo;
          lienzo.style.cursor = sobre ? 'pointer' : 'grab';
          // Con la tarjeta a la vista el hover queda en resaltado + cursor:
          // un tooltip encima de la tarjeta se mezclaba con ella.
          if (sobre && !cajaTarjeta && !esElegidaCaja(sobre)) {
            tooltip.classList.add('tt-unidad');
            pintarResumenUnidad(tooltip, sobre.userData.unidad, true);
            tooltip.classList.add('visible');
          } else tooltip.classList.remove('visible');
        }
        if (sobre) ubicarTooltip();

        // Cartel de calle: mismo patrón de hover/tooltip que las unidades,
        // pero sin emissive que resaltar — solo cursor + tooltip para dejar
        // claro que abre Google Maps. En el showroom no: Maps se llevaría la
        // pantalla (sin sobreCalle, el click tampoco lo abre).
        const golpeCalle = (!sobre && cartelCalle && !hoverPausado && !kiosco) ? rayo.intersectObject(cartelCalle, false) : [];
        const nuevoSobreCalle = golpeCalle.length > 0;
        if (nuevoSobreCalle !== sobreCalle) {
          sobreCalle = nuevoSobreCalle;
          if (!sobre) lienzo.style.cursor = sobreCalle ? 'pointer' : 'grab';
          if (sobreCalle) {
            tooltip.classList.remove('tt-unidad');
            tooltip.textContent = 'Ver en Google Maps';
            tooltip.classList.add('visible');
          } else if (!sobre) tooltip.classList.remove('visible');
        }
        if (sobreCalle) ubicarTooltip();
        // Como el material es MeshBasicMaterial (no-lit, sin emissive que
        // resaltar como en las unidades), el feedback de hover es un
        // agrandado suave — crece desde el borde apoyado en la calzada
        // (el pivote del mesh, ver geoCartelCalle.translate), así que no
        // flota ni se hunde, solo "se levanta" un poco más hacia quien
        // pasa el mouse. Interpolado, no instantáneo, mismo estilo que el
        // offset de pisosGrupo más arriba.
        if (cartelCalle) {
          const escalaCartelObjetivo = sobreCalle ? 1.1 : 1;
          cartelCalle.scale.setScalar(cartelCalle.scale.x + (escalaCartelObjetivo - cartelCalle.scale.x) * kH);
        }

        render.render(escena, camara);
        // Después del render: cámara y edificio ya están en su lugar de este cuadro.
        if (cajaTarjeta && cajaAncla && !esTactil) ubicarTarjeta();
        if (cajaTarjeta) actualizarGuia(ahora);
        if (elegida || unidadMarca) actualizarMarca(ahora);
      }
      animar();
      // animar() pinta el primer cuadro en el acto (no espera al rAF): recién
      // ahora la escena puede reemplazar al poster.
      quitarPoster();
      // La utilería de la calle, con el edificio ya a la vista y el hilo
      // libre (como mucho 1,5 s; sin requestIdleCallback, a los 1,5 s).
      if ('requestIdleCallback' in window) requestIdleCallback(cargarAutos, { timeout: 1500 });
      else setTimeout(cargarAutos, 1500);

      // Tamaño del lienzo: ResizeObserver sobre su contenedor (body, que mide
      // la pantalla: html y body van con height 100% y overflow hidden), no
      // el resize de la ventana. Llega después del layout con la medida ya
      // calculada, así no lee innerWidth/innerHeight con el layout invalidado.
      // También avisa al empezar a observar: con la misma medida no hace nada.
      // Cambiar el tamaño borra el lienzo y el cuadro de este rAF ya se
      // dibujó: se vuelve a dibujar en el acto, si no parpadea al redimensionar.
      let anchoLienzo = pantalla.ancho, altoLienzo = pantalla.alto;
      new ResizeObserver(([entrada]) => {
        const w = Math.round(entrada.contentRect.width), h = Math.round(entrada.contentRect.height);
        if (!w || !h || (w === anchoLienzo && h === altoLienzo)) return;
        anchoLienzo = w;
        altoLienzo = h;
        camara.aspect = w / h;
        camara.updateProjectionMatrix();
        render.setSize(w, h);
        if (CONTORNO) CONTORNO.resolucion(w, h);
        if (!EXTENSION) pintarFondo();
        render.render(escena, camara);
      }).observe(document.body);

    } // fin de iniciar()

    // Fundido de salida del overlay de carga — 400ms coordinados con la
    // transition de #carga en CSS; recién después de eso lo saca del todo
    // (hidden) para que no le quede capturando clics ni foco de lector de
    // pantalla.
    function ocultarCarga() {
      const carga = document.getElementById('carga');
      carga.classList.add('carga-oculta');
      setTimeout(() => { carga.hidden = true; }, 420);
    }

    // Vuelve a poner el overlay en estado "cargando" — lo usa el botón
    // Reintentar antes de volver a llamar cargarTodo().
    function reiniciarCarga() {
      const carga = document.getElementById('carga');
      carga.hidden = false;
      carga.classList.remove('carga-oculta', 'carga-error-activo');
    }

    // Fundido de salida del poster (300 ms, la transition de #poster en CSS)
    // y después afuera del DOM, con su <picture> (sacarPoster(), en el
    // <head>). Lo llama iniciar() con el primer cuadro.
    function quitarPoster() {
      const poster = document.getElementById('poster');
      if (!poster) return;
      poster.classList.add('poster-oculto');
      setTimeout(sacarPoster, 320);
    }

    // La escena arranca recién con la página cargada (window load) y el hilo
    // libre, así el poster (el LCP) se pinta sin competir con three.js. Los
    // datos no esperan: cargarProyecto() corre en paralelo. Una sola promesa:
    // "Reintentar" no vuelve a esperar.
    const paginaCargada = new Promise(resolver => {
      const enReposo = () => {
        if ('requestIdleCallback' in window) requestIdleCallback(() => resolver(), { timeout: 1000 });
        else setTimeout(resolver, 0);
      };
      if (document.readyState === 'complete') enReposo();
      else addEventListener('load', enReposo, { once: true });
    });

    async function cargarTodo() {
      const resultado = await cargarProyecto();
      if (resultado.error === 'no-encontrado') {
        mostrarErrorCarga('Este edificio no existe o todavía no está publicado.', false);
        return;
      }
      if (resultado.error) {
        mostrarErrorCarga('No pudimos conectar con el servidor. Revisá tu conexión.', true);
        return;
      }
      document.title = resultado.proyecto.nombre + ' · disponibilidad navegable';
      // Antes de pintar: las imágenes que suman pintarRenders() y compañía
      // demorarían el load que se espera.
      await paginaCargada;
      pintarRedes(resultado.settings);
      pintarAmenities(resultado.amenities);
      pintarLegal(resultado.settings.textos);
      pintarRenders(resultado.renders);
      pintarAvance(resultado.proyecto, resultado.hitosObra, resultado.fotosObra);
      iniciar(resultado.proyecto, resultado.settings, resultado.unidades, resultado.mediaTipologias, resultado.tzOffsetHoras, resultado.hitosObra, resultado.tipologias);
      ocultarCarga();
    }

    document.getElementById('carga-reintentar').addEventListener('click', () => {
      reiniciarCarga();
      cargarTodo();
    });

    cargarTodo();
