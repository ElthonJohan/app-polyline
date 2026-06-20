# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Catálogo digital y sistema de cotizaciones para **Polyline SAC** (acabados de construcción, mercado peruano). Aplicación web client-side: HTML + CSS + JavaScript vanilla, sin build. UI y datos en español.

Soporta **dos monedas**: Soles (`PEN`) y Dólares (`USD`). Cada producto tiene su moneda base; al cotizar el vendedor elige la moneda de salida y el sistema aplica el tipo de cambio configurado.

Hoy el frontend persiste en `localStorage`. Existe un schema completo en [supabase/](supabase/) preparado para migrar a Supabase (multi-dispositivo).

## Running locally

No hay `package.json` ni build step. Cualquier servidor estático sirve:

```powershell
npx --yes serve -l 3000 .
```

Abrir `http://localhost:3000`. Login por defecto: `admin@acabadospro.com` / `admin123` (definido en `DEFAULT_USERS` en `app.js`).

No hay tests, linter ni typecheck configurados. Para validar sintaxis JS: `node --check assets/js/app.js`.

## Arquitectura del frontend

Tres archivos relevantes:

- [index.html](index.html) — shell de la app: login, layout (sidebar + topbar + main), panel de carrito, modal genérico, contenedor de toasts. El contenido se inyecta en `#page-content`. CDN: TailwindCSS, jsPDF, FontAwesome, Google Fonts.
- [assets/js/app.js](assets/js/app.js) — toda la lógica. Sin módulos, sin clases: funciones globales + estado `APP`.
- [assets/css/styles.css](assets/css/styles.css) — estilos custom además de Tailwind. Tema oscuro definido en `:root`.

### Estado global

`APP` ([app.js:2](assets/js/app.js#L2)) mantiene `user`, `page`, `cart`, `products`, `quotes`, `search`, `activeCat`, `presentationMode`, `tourActive/tourStep`, `quoteCounter`. No hay framework reactivo — cualquier mutación debe ir seguida de `renderPage()` y/o `updateCartBadge()` / `renderCartPanel()`.

### Patrón de renderizado

Cada página tiene una función `render<Page>()` que devuelve un string HTML. El router [renderPage()](assets/js/app.js#L122) hace `switch` sobre `APP.page` e inyecta en `#page-content` via `innerHTML`. Handlers via `onclick="..."` inline (funciones globales). Páginas: `dashboard`, `catalog`, `quotes`, `admin`, `recursos`, `proveedores`, `settings`.

Al modificar UI, mantener el patrón: construir string, llamar `renderPage()`.

### Persistencia (localStorage)

[saveData(key, data)](assets/js/app.js#L60) / [loadData(key, fallback)](assets/js/app.js#L61) envuelven `localStorage` con prefijo `acabados_`. Claves:

- `products`, `quotes`, `quoteCounter`, `users`
- `recursos` (enlaces de Drive), `proveedoresAgenda` (contactos WhatsApp), `calc_plantillas` (plantillas de la calculadora)
- `cfg_empresa`, `cfg_encargado`, `cfg_tel`, `cfg_email`, `cfg_dir`, `cfg_condiciones`
- `cfg_moneda_default` (`PEN` | `USD`), `cfg_tipo_cambio` (PEN por 1 USD)

[initAppData()](assets/js/app.js#L65) corre en `window.load` y tras login. Aplica `normalizarProducto` y `normalizarCotizacion` para migrar registros viejos al nuevo schema (les añade `moneda='PEN'`).

### Multimoneda — modelo y conversión

Helpers en [app.js:8-37](assets/js/app.js#L8-L37):

- `MONEDAS` — `PEN` (`S/.`, locale `es-PE`) y `USD` (`US$`, locale `en-US`).
- `formatMoney(amount, codigo)` — formatea con símbolo y locale correctos.
- `convertirPrecio(precio, monedaOrigen, monedaDestino, tipoCambio)` — convierte PEN ↔ USD. `tipoCambio` = PEN por 1 USD.
- `tipoCambioActual()` — lee `cfg_tipo_cambio` (default `3.75`).

Reglas:

| Caso | Conversión |
|---|---|
| origen = destino | sin cambio |
| USD → PEN | `precio * tc` |
| PEN → USD | `precio / tc` |

**Producto**: `{ ..., precio, moneda: 'PEN'|'USD' }`. Default `PEN`.
**Item del carrito**: `{ id, cantidad, precioUnitario, moneda }` — guarda la moneda del producto al momento de agregarse.
**Cotización**: al crearse, el vendedor elige `moneda` (salida) y `tipoCambio`. Cada item guarda `precioUnitarioOrigen` + `monedaOrigen` (auditoría) y `precioUnitario` (ya convertido a la moneda de la cotización). El TC queda **congelado** en la cotización — cambiar la config no afecta cotizaciones pasadas.

### Variantes ("detalles") de producto

Un producto puede tener un array `variantes` con N opciones. Ejemplo: `Mármol` → `Negro`, `Blanco`. Cada variante tiene su propio `precio`, `moneda`, `imagen`, `descripcion`, `stock`.

Helpers en [app.js](assets/js/app.js):

- `normalizarProducto(p)` — asegura `variantes:[]` y propaga moneda a variantes sin ella.
- `precioMinimo(p)` — `{ precio, moneda, esRango }`. Convierte a PEN para comparar correctamente entre monedas.
- `productoDisponible(p)` — `true` si al menos una variante tiene stock (o si no hay variantes y el producto en sí tiene stock).
- `resolveCartItem(item)` — devuelve `{ nombre, imagen, unidad, moneda, precio, stock, esVariante }`. Si el item del carrito tiene `parentId`, resuelve "Producto — Variante".

**Reglas de UI**:

- **Admin** ([app.js](assets/js/app.js) `editVariantes`, `editVariante`, `saveVariante`, `deleteVariante`): cada producto tiene botón "Detalles" en la tabla. Abre un modal con la lista de variantes y un botón "Nueva variante".
- **Catálogo**: si `p.variantes.length > 0`, la tarjeta muestra `N opciones / Desde S/X` y un badge superior. Click → `showVariantesPicker(productoId)` (multi-select con checkboxes). Productos sin variantes mantienen el flujo viejo (`showProductDetail`).
- **Carrito**: cada variante seleccionada entra como item independiente con `{ id: varianteId, parentId: productoId, cantidad, precioUnitario, moneda }`. Items sin `parentId` son productos sueltos.
- **Cotización**: al crear, `item` guarda `productoId` (padre), `varianteId`, `productoNombre` (snapshot "Producto — Variante") y `productoUnidad`. Así sobrevive aunque se borre la variante.

### Cotizaciones y PDF

- Carrito → `showQuoteForm()` (datos cliente + moneda + TC con preview en vivo via `actualizarPreviewCotizacion()`) → `createQuote()` ([app.js:~615](assets/js/app.js)) persiste y dispara `generatePDF()`.
- `total` se guarda **inc. IGV** en la moneda de salida; `subtotal = total/1.18`, `igv = total-subtotal`.
- **IGV 18% hardcodeado** en cotización, PDF, dashboard y carrito. Para cambiarlo buscar `1.18` y `(18%)` en `app.js`. En Supabase es `empresa_config.igv_porcentaje`.
- PDF: jsPDF (`window.jspdf.jsPDF`) en `generatePDF()`. Layout manual con coordenadas en mm sobre A4. Usa `simboloMoneda` / `localeMoneda` derivados de `q.moneda`. Datos de empresa desde `cfg_*` en localStorage.

### Modo presentación y tour

`togglePresentationMode()` oculta sidebar/topbar y fuerza navegación al catálogo. `TOUR_STEPS` itera sobre `CATEGORIAS` con tooltips superpuestos.

### Calculadora de Cobertura (botón en topbar)

Modal de cálculo accesible desde el ícono de calculadora en la topbar. Estima piezas + costo para cubrir una superficie (rectángulo simple o polígono irregular dibujado en malla).

**Estado global** `CALC` (sobrevive aperturas del modal): `{ superficies, loza_ancho, loza_largo, precio, precio_base, moneda, merma, descuento, variante_sel, ultimoResultado }`. Re-renderizar el modal preserva todo porque `snapshotCalcInputs()` vuelca DOM a CALC antes de cada `renderCalculadora()`.

**Cada superficie** es `{ id, nombre, tipo, ancho/alto/unidad, puntos[], escala_cm, vanos[] }`:

- `tipo='rect'`: ancho × alto en m o cm.
- `tipo='poligono'`: vértices en píxeles del SVG (`POLI_W=280`, `POLI_H=200`, grid `POLI_GRID=20`), snap a grid en cada clic. Área via shoelace, convertida usando `escala_cm` (cm por cuadro). Default 10 cm/cuadro.
- `vanos`: lista de `{ nombre, ancho, alto, unidad }` que se restan del área bruta (puertas/ventanas).
- `areaSuperficieM2(s)` aplica la lógica completa (rect o polígono − vanos, clamp ≥ 0).

**Picker de material** (`todasVariantes`): lista todas las variantes del catálogo agrupadas por producto. Las que no tienen `ancho`+`largo` aparecen **disabled** con etiqueta "— sin medidas (no usable)". Muestra aviso si hay alguna así.

**Agregar al carrito** (`agregarCalculoAlCarrito`): solo se habilita cuando hay variante del catálogo seleccionada. Pushea (o reemplaza) el item `{ id:varianteId, parentId:productoId, cantidad:lozasConMerma, precioUnitario, moneda }` para que entre al flujo normal de cotización.

**Plantillas** (`calc_plantillas` en localStorage): `guardarPlantillaCalc` snapshot completo del estado, `cargarPlantillaCalc(id)` lo restaura, `eliminarPlantillaCalc()` borra la seleccionada. Útiles para "Baño completo: 4 paredes + piso + vanos".

Las **variantes** tienen campos opcionales `ancho` y `largo` (cm). Validación: o se llenan ambos o ninguno (0–9999 cm). Sin medidas → no aparecen como usables en el picker. Migración SQL: [supabase/migrations/0003_dimensiones_variante.sql](supabase/migrations/0003_dimensiones_variante.sql).

### Recursos Técnicos (página `recursos`)

Enlaces de Google Drive con documentación técnica que el equipo consulta (Suplemento Técnico de la revista *Costos*, Precios Oficiales de Construcción del CAP, etc.).

- Categorías base en `RECURSO_CATEGORIAS`: `suplemento_tecnico`, `precios_construccion`, `otro`. Extender ese array para añadir más.
- Cada recurso: `{ id, titulo, categoria, url, periodo, notas, estado: 'revision'|'completado', createdAt }`.
- Al agregarse, el recurso nace en estado `'revision'` (badge ámbar). Se promueve a `'completado'` con `toggleRecursoEstado(id)`.
- Persistencia: clave `recursos` en localStorage.
- Funciones: `renderRecursos`, `editRecurso`, `saveRecurso`, `toggleRecursoEstado`, `deleteRecurso`, `confirmDeleteRecurso`.

### Agenda de Proveedores (página `proveedores`)

Contactos por rubro con enlace directo a WhatsApp. Pensada para tener a mano proveedores de muebles, puertas, mármol y sanitarios.

- Categorías base en `PROV_CATEGORIAS`: `muebles`, `puertas`, `marmol`, `sanitarios`, `otro`.
- Cada contacto: `{ id, nombre, categoria, contacto, telefono, email, notas, createdAt }`.
- `telefonoAWhatsapp(tel)` normaliza el número: si tiene 9 dígitos empezando con 9 → prefija `51` (Perú); en otro caso respeta lo que venga. El botón abre `https://wa.me/<digits>`.
- Persistencia: clave `proveedoresAgenda` en localStorage.
- Funciones: `renderProveedores`, `editProveedorContacto`, `saveProveedorContacto`, `deleteProveedorContacto`, `confirmDeleteProveedorContacto`.

### Configuración (página `settings`)

Cuatro secciones:

1. **Datos de la Empresa** — nombre, encargado, teléfono, correo, dirección.
2. **Moneda y Tipo de Cambio** — moneda default (`cfg_moneda_default`) y TC (`cfg_tipo_cambio`).
3. **Condiciones en Cotización** — texto al pie del PDF (`cfg_condiciones`).
4. **Gestión de Datos** — acciones granulares. **Ya no existe un único botón "Borrar Todo"**: cada acción afecta solo lo que indica:
   - Restaurar productos demo
   - Vaciar catálogo (no toca cotizaciones)
   - Borrar historial de cotizaciones
   - Restablecer configuración de empresa
   - Reset del TC
   - Vaciar carrito

   Implementado en `confirmAccion(accion)` + `ejecutarAccion(accion)` ([app.js](assets/js/app.js)). Para añadir una acción nueva: extender ambos diccionarios.

## Backend Supabase

Migraciones en orden:

1. [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) — tablas base, RLS, helpers.
2. [supabase/migrations/0002_variantes.sql](supabase/migrations/0002_variantes.sql) — tabla `producto_variantes` + `variante_id` en items + función `producto_precio_minimo_pen()`.
3. [supabase/migrations/0003_dimensiones_variante.sql](supabase/migrations/0003_dimensiones_variante.sql) — columnas `ancho_cm` / `largo_cm` en `producto_variantes` + función `variante_area_m2()`.

Seed en [supabase/seed.sql](supabase/seed.sql). Instrucciones de setup en [supabase/README.md](supabase/README.md).

Resumen del modelo:

| Tabla | Notas |
|---|---|
| `usuarios` | Espejo de `auth.users`, con `rol` (`admin`/`vendedor`). Trigger autollena al registrarse. |
| `categorias` | 8 fijas (`A`–`H`). Sembradas. |
| `proveedores` | Normalizado, antes era string libre. |
| `productos` | + `moneda` (enum `PEN`/`USD`), `stock_disponible` + `stock_cantidad` opcional. |
| `producto_variantes` | "Detalles" del producto. Cada fila tiene su propio precio/moneda/imagen/stock. |
| `clientes` | Antes string libre en la cotización; ahora entidad con `ruc`. |
| `empresa_config` | Singleton. `igv_porcentaje`, `moneda_default`, `tipo_cambio_default` configurables. |
| `tipos_cambio` | Histórico por fecha. |
| `cotizaciones` | Único compuesto `(serie, anio, numero)`. Congela `tipo_cambio_aplicado`. `subtotal`, `igv`, `total` separados. |
| `cotizacion_items` | Guarda `precio_unitario_origen` + `moneda_origen` Y `precio_unitario_salida` para auditoría. |

RLS activo: lectura abierta a autenticados; admins escriben todo; vendedores crean cotizaciones/clientes y editan solo las propias. Helper `es_admin()`.

Función `siguiente_numero_cotizacion(serie, año)` calcula el correlativo (resetea por año).

## Migración localStorage → Supabase

El frontend aún no llama a Supabase. Para conectarlo: ver instrucciones en [supabase/README.md](supabase/README.md). El JS ya respeta el mismo modelo (moneda en producto, conversión en cotización, TC congelado), así que el reemplazo de `saveData`/`loadData` por llamadas al SDK es directo.

## Seguridad

El frontend construye HTML por concatenación de strings y lo inyecta con `innerHTML`. Para no ser vulnerable a XSS, **todo dato controlado por el usuario** que entra a un string HTML debe pasar por uno de estos helpers:

| Helper | Cuándo |
|---|---|
| `esc(s)` | Texto, contenido de atributos (`value="..."`), `id` en `onclick='...'`. |
| `escUrl(s)` | URLs en `src`/`href`. Bloquea `javascript:`, `data:text/html`, `file:`, etc. — solo permite `http(s)`, `data:image/*` y rutas relativas. |
| `encodeURIComponent(...)` | IDs interpolados en URLs externas (ej. `picsum.photos/seed/<id>`). |

**Regla**: si concatenas algo distinto a un literal hardcodeado o un número validado, escápalo. La auditoría se hace con `grep '+(p\.|q\.|item\.|loadData|APP\.user)'` y verificando que cada match esté envuelto en `esc()`, `escUrl()`, `formatMoney()` o pase por `doc.text()` (jsPDF, no es HTML).

`toast(msg, type)` construye sus nodos con `textContent` — es seguro pasarle cualquier string.

### Validaciones

`VALID` ([app.js:~30](assets/js/app.js)) centraliza regex y longitudes máximas:

- `VALID.email` — formato básico.
- `VALID.ruc` — 11 dígitos peruanos con prefijos válidos (10/15/17/20).
- `VALID.maxLen` — diccionario de longitudes máximas por tipo de campo.
- `trimMax(s, max)` — trim + corte por longitud.

Validaciones de números:
- Precio: `0 ≤ x ≤ 9,999,999`.
- TC: `0 < x ≤ 1000`.
- Cantidad en carrito: `1 ≤ x ≤ 99,999`.

Los `<input maxlength>` son defensa-en-profundidad — la validación real está en JS.

### Persistencia segura

`saveData()` ([app.js](assets/js/app.js)) tiene:
- `try/catch` para `QuotaExceededError` y modo incógnito.
- Límite duro de **4 MB** por escritura (`MAX_BYTES`), con `toast` de error.
- Retorno `boolean` para que el caller sepa si persistió.

`loadData()` swallowea `JSON.parse` corruptos y devuelve el fallback.

### Deuda de seguridad pendiente

Lo que **NO** se ha arreglado (requiere cambios mayores, no se hicieron en el último turno):

1. **Autenticación sigue siendo decorativa**: `DEFAULT_USERS` con contraseña en JS público. Cualquiera con DevTools entra. Se arregla migrando a Supabase Auth (el schema ya está listo en `usuarios` + trigger `handle_new_user`).
2. **Aún es localStorage**: el modelo en JS coincide con el schema de Supabase, pero `saveData`/`loadData` siguen leyendo del navegador local. **No es multi-dispositivo todavía.** Para conectar Supabase: ver [supabase/README.md](supabase/README.md).
3. **CSP no configurado**: los `onclick="..."` inline impedirían usar Content Security Policy estricto sin `unsafe-inline`.
4. **Sin rate limiting** en el login (porque no hay backend).
5. **CDN sin Subresource Integrity** (`integrity="sha384-..."`) en jsPDF/Tailwind/FontAwesome — un CDN comprometido inyecta código.

## Detalles que conviene recordar

- `formatMoney(monto, codigo)` para mostrar precios. Nunca volver a hardcodear `'S/. '` ni `toLocaleString('es-PE', ...)`.
- `convertirPrecio()` es la única vía oficial para convertir PEN ↔ USD.
- Productos antiguos sin `moneda` se asumen `PEN` (vía `normalizarProducto`). Lo mismo aplica a cotizaciones (`normalizarCotizacion`).
- Fallback de imágenes via `onerror="this.src='https://picsum.photos/seed/<id>/...'"` — el `id` va por `encodeURIComponent`.
- Fondo animado de partículas IIFE al final de [app.js](assets/js/app.js) — respeta `prefers-reduced-motion`.
