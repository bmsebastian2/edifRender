# ROSSO by Block / plataforma multi-edificio

Ver `CLAUDE.md` para la arquitectura completa (cómo está armado `index.html`,
de dónde sale cada dato, etc.). Este archivo es el runbook operativo: qué
hacer para dar de alta un edificio nuevo, y cómo administrar accesos.

La base es multi-tenant desde `supabase-migration-multitenant.sql`: un solo
proyecto Supabase aloja varios edificios (`projects`) de varios clientes
(`orgs`). No hay panel de "alta de edificio" todavía — todo se hace con SQL
directo en el **SQL Editor** de Supabase (Dashboard → SQL Editor), corriendo
como el rol `postgres`, que no pasa por RLS. Es deliberado: para el volumen
de altas que va a haber al principio, es más rápido que construir una UI.

## Dar de alta un edificio nuevo

Orden estricto — cada paso depende de que el anterior ya exista (FKs).

### 1. País y moneda (solo si es la primera vez que aparecen)

`paises` y `monedas` ya tienen sembrado UY/NI y USD/UYU/NIO. Si el país o la
moneda del edificio nuevo no está, agregalo primero (es un insert, no una
migración):

```sql
insert into paises (codigo, nombre) values ('AR', 'Argentina');
insert into monedas (codigo, nombre, decimales) values ('ARS', 'Peso argentino', 2);
```

### 2. Org (el cliente / desarrolladora)

Si el cliente ya tiene otro edificio con nosotros, saltear este paso y usar
el `org_id` que ya existe (`select id from orgs where slug = '...'`).

```sql
insert into orgs (nombre, slug, pais) values ('Nombre del Cliente', 'slug-cliente', 'UY')
returning id;
```

Guardá el `id` que devuelve — lo necesitás en el paso siguiente.

### 3. Project (el edificio)

```sql
insert into projects (
  org_id, slug, nombre, direccion, ciudad, pais, entrega, pisos,
  publicado, muestra_totales, moneda, locale
) values (
  '<id-de-la-org>', 'slug-edificio', 'Nombre del Edificio',
  'Dirección completa', 'Ciudad', 'UY', 'marzo 2029', 12,
  false, true, 'USD', 'es-UY'
)
returning id;
```

- `publicado = false` a propósito: el edificio no aparece para nadie
  anónimo hasta que esté listo (ver paso 8).
- `slug` es lo que resuelve la URL pública (`?p=slug-edificio`, o
  `/slug-edificio` el día que se agregue el rewrite de Vercel). Tiene que
  ser único y sin espacios.
- `geometria` se deja vacía (default `{}`) salvo que la planta del edificio
  sea muy distinta a la de ROSSO — ver la nota en `CLAUDE.md` / en el
  comentario de la columna en `supabase-migration-multitenant.sql`.

Guardá el `id` que devuelve — es el `project_id` de todo lo que sigue.

### 4. Settings (redes, WhatsApp, textos)

Esta fila es obligatoria — el frontend espera encontrarla (si falta, el
`public_settings` de ese proyecto viene vacío pero no rompe la página).

```sql
insert into settings (project_id, instagram, youtube, sitio_web, whatsapp, textos)
values (
  '<project_id>', '', '', '', '59890000000',
  '{"legal": "Texto legal/promocional propio de este edificio, si aplica."}'
);
```

Dejá los campos de redes en `''` si no aplican — el frontend oculta el
ícono correspondiente.

### 5. Unidades

Insertá todas las filas de una vez con un `insert ... values (...), (...), ...`
— para no tipear 50+ filas a mano, generalo con un script corto (Node,
Python, o incluso una fórmula de Excel que arme el texto del INSERT) a partir
de la planilla de ventas del cliente, siguiendo el mismo patrón de columnas
que usa `supabase-schema.sql` para ROSSO. Ejemplo de una fila:

```sql
insert into units (project_id, id, piso, pos, col, frente, dorms, m2, orientacion, precio, estimado, estado)
values ('<project_id>', 101, 1, 1, -1.5, -1, 2, 92, 'Frente', 196500, false, 'sin_dato');
```

- `id` es `piso*100 + pos` (mismo criterio que ROSSO) — único **dentro de
  este proyecto**, no hace falta que sea único contra otros edificios.
- Arrancá todo en `estado = 'sin_dato'` salvo que ya tengas el dato real de
  cada unidad al momento del alta.

### 6. Amenities

```sql
insert into amenities (project_id, texto, orden, activo) values
  ('<project_id>', 'Primera amenity', 1, true),
  ('<project_id>', 'Segunda amenity', 2, true);
```

### 7. Cuenta del vendedor/cliente

1. Dashboard → **Authentication → Users → Add user** (email + contraseña, o
   invitalo por magic link). Copiá el `user_id` (UUID) que le asigna.
2. Vincularlo al proyecto:

```sql
insert into memberships (user_id, project_id, rol)
values ('<user_id>', '<project_id>', 'admin');
```

- `rol` es `'admin'` (administra su edificio completo: amenities, precios
  base de tipología, settings) o `'vendedor'` (solo puede cambiar `estado`
  de las unidades). Un mismo usuario puede tener varias filas de
  `memberships` si administra más de un edificio.
- Sin esta fila, el usuario puede loguearse en `admin.html` pero ve "no
  tenés acceso a ningún proyecto".

### 8. Publicar

Recién cuando el edificio esté listo para mostrarse:

```sql
update projects set publicado = true where id = '<project_id>';
```

(Desde el SQL Editor esto corre como `postgres`, sin pasar por RLS, así que
un `update` directo funciona — la función `plataforma_actualizar_proyecto()`
es para cuando este mismo cambio se haga alguna vez desde una sesión
logueada de `admin.html`, no hace falta usarla acá.)

### 9. Verificar

- `https://armadoporcota.vercel.app/?p=slug-edificio` muestra el edificio.
- El vendedor puede loguearse en `admin.html?p=slug-edificio` y ve solo ese
  proyecto (entra directo, sin selector, porque no es plataforma).
- Vos como plataforma seguís viendo el selector con todos los edificios.

## Acceso de plataforma (vos)

Tu propio acceso global vive en `plataforma_admins`, no en `memberships`:

```sql
insert into plataforma_admins (user_id)
select id from auth.users where email = 'tu-email@ejemplo.com';
```

Ya está cargado para `bmsebastian2@gmail.com` desde la migración inicial.
Si alguna vez sumás un socio con el mismo nivel de acceso total, es la misma
instrucción con su email.

## Revocar acceso

Borrar la fila de `memberships` (no la cuenta de Auth, salvo que quieras que
tampoco pueda loguearse en ningún lado):

```sql
delete from memberships where user_id = '<user_id>' and project_id = '<project_id>';
```
