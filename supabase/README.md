# Backend Supabase — Polyline SAC

Migración del sistema desde `localStorage` (un solo dispositivo) a Supabase (multi-dispositivo, datos en la nube).

## Estructura

```
supabase/
├── migrations/
│   └── 0001_init.sql      # Schema completo + RLS + triggers
├── seed.sql               # 21 productos demo + proveedores + TC inicial
└── README.md              # Este archivo
```

## Crear el proyecto en Supabase

1. Crea cuenta en https://supabase.com y un proyecto nuevo (tier gratis).
2. Anota: **Project URL** y **anon public key** (`Settings → API`).
3. En el dashboard, **SQL Editor → New query**, pega y ejecuta:
   - Primero `migrations/0001_init.sql`
   - Luego `seed.sql`
4. **Authentication → Providers**: activa Email/Password.
5. **Authentication → Users → Add user**: crea el primer admin (ej. `admin@polyline.pe`).
6. En **SQL Editor**, eleva ese usuario a admin:
   ```sql
   update usuarios set rol = 'admin' where email = 'admin@polyline.pe';
   ```

## Modelo de datos (resumen)

| Tabla | Para qué sirve |
|---|---|
| `usuarios` | Espejo de `auth.users` con `rol` (admin / vendedor) |
| `categorias` | 8 categorías fijas (A–H), sembradas |
| `proveedores` | Catálogo de proveedores normalizado |
| `productos` | Antes en `localStorage`; ahora con `moneda` (PEN/USD) |
| `clientes` | Antes string libre en la cotización; ahora entidad propia con RUC |
| `empresa_config` | Singleton con datos de la empresa, IGV%, TC default |
| `tipos_cambio` | Histórico de TC por fecha |
| `cotizaciones` | `serie + año + numero` único, congela el TC al crearse |
| `cotizacion_items` | Guarda precio en moneda origen Y en moneda de salida |

### Multimoneda — cómo funciona

- Cada **producto** tiene su `moneda` base (`PEN` o `USD`).
- Al crear una **cotización**, el vendedor elige la `moneda_salida` y confirma el `tipo_cambio_aplicado`.
- Cada **item** guarda:
  - `precio_unitario_origen` + `moneda_origen` (datos del producto, intactos)
  - `precio_unitario_salida` (ya convertido a la moneda de la cotización)
- Una auditoría siempre puede recalcular la conversión exacta porque el TC quedó congelado en `cotizaciones.tipo_cambio_aplicado`.

Conversión:
```
si moneda_origen = moneda_salida    → precio_salida = precio_origen
si origen=USD y salida=PEN          → precio_salida = precio_origen * tipo_cambio
si origen=PEN y salida=USD          → precio_salida = precio_origen / tipo_cambio
```

### Numeración de cotizaciones

Función `siguiente_numero_cotizacion(serie, año)` calcula el siguiente correlativo. Se resetea automáticamente al cambiar de año.

## RLS (Row Level Security)

Activo en todas las tablas. Política inicial:

- **Lectura**: cualquier usuario autenticado puede leer todo.
- **Admin** (rol=`admin`): puede escribir en todo.
- **Vendedor**: puede crear cotizaciones, items y clientes; puede editar/borrar **solo** sus propias cotizaciones; no puede tocar productos, proveedores ni configuración de empresa.

Helper `es_admin()` consulta `usuarios.rol` para el `auth.uid()` actual.

> **Antes de producción**: revisa las políticas según tu modelo de negocio (¿quieres que un vendedor vea cotizaciones de otros? ¿quieres separar por sucursal?).

## Conectar el frontend

El frontend actual (`assets/js/app.js`) usa `localStorage` con prefijo `acabados_`. Para conectar Supabase:

1. Añade el SDK en `index.html` antes de `app.js`:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   <script>
     window.SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
     window.SUPABASE_ANON_KEY = 'tu-anon-key';
   </script>
   ```
2. Reemplaza `saveData()` / `loadData()` por una capa que use `supabase.from('productos').select()`, etc.
3. Reemplaza `handleLogin()` por `supabase.auth.signInWithPassword({ email, password })`.

> **Importante**: la `anon key` es pública (RLS la protege). Nunca expongas la `service_role key` en el frontend.

## Migrar datos existentes de localStorage

Si tienes datos guardados en el navegador y quieres subirlos:

1. Abre DevTools en la app actual y ejecuta:
   ```js
   copy(JSON.stringify({
     products: JSON.parse(localStorage.getItem('acabados_products') || '[]'),
     quotes:   JSON.parse(localStorage.getItem('acabados_quotes')   || '[]'),
     config:   {
       empresa:     localStorage.getItem('acabados_cfg_empresa'),
       encargado:   localStorage.getItem('acabados_cfg_encargado'),
       tel:         localStorage.getItem('acabados_cfg_tel'),
       email:       localStorage.getItem('acabados_cfg_email'),
       dir:         localStorage.getItem('acabados_cfg_dir'),
       condiciones: localStorage.getItem('acabados_cfg_condiciones'),
     }
   }))
   ```
2. Pega el JSON en algún archivo y, con un script Node corto (o el SQL Editor), insértalo en las tablas correspondientes asignando `moneda='PEN'` a todos los productos viejos.

## Cambios respecto al modelo anterior (localStorage)

| Antes | Ahora |
|---|---|
| `precio` (sin moneda) | `precio` + `moneda` |
| `stock: bool` | `stock_disponible: bool` + `stock_cantidad: numeric?` |
| `proveedor: string` | `proveedor_id` → tabla `proveedores` |
| `cliente: string` | `cliente_id` → tabla `clientes` (+ snapshot `cliente_nombre`) |
| `numero` global | `serie + anio + numero` (único compuesto) |
| Total inc. IGV | `subtotal`, `igv` y `total` separados |
| TC implícito | `tipo_cambio_aplicado` congelado por cotización |
| IGV 18% hardcodeado | `empresa_config.igv_porcentaje` editable |
