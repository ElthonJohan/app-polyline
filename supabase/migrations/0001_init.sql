-- =====================================================================
-- Polyline SAC — Sistema de Cotizaciones
-- Migración inicial: schema completo con multimoneda (PEN / USD)
-- Compatible con Supabase (Postgres 15+).
--
-- Convenciones:
--   - Identificadores en español (snake_case) para alinear con la UI.
--   - Montos en NUMERIC(14,2) — sin redondeos sorpresa de float.
--   - Tipos de cambio en NUMERIC(10,4) — los TC peruanos suelen tener 3-4 decimales.
--   - Todas las tablas con created_at / updated_at y trigger automático.
--   - Row Level Security activado en todo. Las políticas iniciales asumen
--     que el sistema tendrá usuarios autenticados (Supabase Auth).
-- =====================================================================

-- ---------- EXTENSIONES ----------
create extension if not exists "pgcrypto";  -- gen_random_uuid()


-- ---------- TIPOS ENUM ----------
do $$ begin
  create type moneda as enum ('PEN', 'USD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_cotizacion as enum ('borrador', 'enviada', 'aprobada', 'rechazada', 'vencida');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rol_usuario as enum ('admin', 'vendedor');
exception when duplicate_object then null; end $$;


-- ---------- UTILIDADES ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;


-- =====================================================================
-- USUARIOS DE LA APP
-- Se relaciona con auth.users de Supabase. El registro en public.usuarios
-- se crea cuando un usuario se autentica por primera vez (trigger abajo).
-- =====================================================================
create table if not exists usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  email       text not null unique,
  rol         rol_usuario not null default 'vendedor',
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_usuarios_updated
  before update on usuarios
  for each row execute function set_updated_at();

-- Auto-crear fila en public.usuarios al registrar un auth.user nuevo.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, nombre, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- =====================================================================
-- CATEGORÍAS DE PRODUCTOS
-- 8 categorías fijas del catálogo (A-H). Se siembran abajo.
-- =====================================================================
create table if not exists categorias (
  id          char(1) primary key,         -- 'A', 'B', ... 'H'
  nombre      text not null,
  icon        text not null,               -- clase de FontAwesome ('fa-layer-group')
  color       text not null,               -- hex ('#C8956C')
  orden       smallint not null default 0,
  created_at  timestamptz not null default now()
);


-- =====================================================================
-- PROVEEDORES
-- Normalizado para evitar repetir nombres como string libre.
-- =====================================================================
create table if not exists proveedores (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  contacto    text,
  telefono    text,
  email       text,
  notas       text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_proveedores_updated
  before update on proveedores
  for each row execute function set_updated_at();


-- =====================================================================
-- PRODUCTOS
-- moneda es la moneda base del precio (PEN o USD).
-- =====================================================================
create table if not exists productos (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  categoria_id        char(1) not null references categorias(id) on delete restrict,
  descripcion         text not null default '',
  precio              numeric(14,2) not null check (precio >= 0),
  moneda              moneda not null default 'PEN',
  unidad              text not null default 'unidad',  -- 'm²', 'galón', 'm lineal'...
  imagen              text,                            -- URL
  proveedor_id        uuid references proveedores(id) on delete set null,
  stock_disponible    boolean not null default true,
  stock_cantidad      numeric(12,2),                   -- opcional; null = no se controla cantidad
  fecha_actualizacion date not null default current_date,
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_productos_categoria on productos(categoria_id);
create index if not exists idx_productos_activo on productos(activo);
create index if not exists idx_productos_nombre_trgm on productos using gin (nombre gin_trgm_ops);

create extension if not exists pg_trgm;  -- para búsqueda por similitud

create trigger trg_productos_updated
  before update on productos
  for each row execute function set_updated_at();


-- =====================================================================
-- CLIENTES
-- Antes era un string libre en la cotización. Ahora es entidad propia.
-- =====================================================================
create table if not exists clientes (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  ruc             text,                    -- 11 dígitos en Perú, opcional
  email           text,
  telefono        text,
  direccion       text,
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_clientes_nombre on clientes(nombre);
create index if not exists idx_clientes_ruc on clientes(ruc) where ruc is not null;

create trigger trg_clientes_updated
  before update on clientes
  for each row execute function set_updated_at();


-- =====================================================================
-- CONFIGURACIÓN DE EMPRESA
-- Tabla singleton (id fijo). Una sola fila por instalación.
-- =====================================================================
create table if not exists empresa_config (
  id                  smallint primary key default 1 check (id = 1),
  nombre              text not null default 'Polyline SAC',
  encargado           text,
  telefono            text,
  email               text,
  direccion           text,
  ruc                 text,
  condiciones         text not null default 'Precios vigentes a la fecha de emisión. Validez de 15 días hábiles. Incluye IGV del 18%.',
  igv_porcentaje      numeric(5,2) not null default 18.00,     -- editable; 0 para clientes exonerados
  moneda_default      moneda not null default 'PEN',
  tipo_cambio_default numeric(10,4) not null default 3.7500,   -- PEN por USD
  logo_url            text,
  updated_at          timestamptz not null default now()
);

create trigger trg_empresa_config_updated
  before update on empresa_config
  for each row execute function set_updated_at();

insert into empresa_config (id) values (1) on conflict (id) do nothing;


-- =====================================================================
-- HISTORIAL DE TIPOS DE CAMBIO
-- Para auditar y para autocompletar el TC del día en nuevas cotizaciones.
-- =====================================================================
create table if not exists tipos_cambio (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null unique,
  pen_por_usd numeric(10,4) not null check (pen_por_usd > 0),
  fuente      text,                                -- 'SBS', 'manual', 'API X'
  created_at  timestamptz not null default now()
);

create index if not exists idx_tipos_cambio_fecha on tipos_cambio(fecha desc);


-- =====================================================================
-- COTIZACIONES
-- Numeración por serie + correlativo (resetea al cambiar de año).
-- moneda_salida es la moneda en la que se presenta la cotización al cliente.
-- tipo_cambio_aplicado se "congela" al momento de crear: aunque cambie el TC
-- después, la cotización conserva los valores originales.
-- =====================================================================
create table if not exists cotizaciones (
  id                    uuid primary key default gen_random_uuid(),
  serie                 char(3) not null default 'COT',
  numero                integer not null,
  anio                  integer not null default extract(year from now())::int,
  cliente_id            uuid references clientes(id) on delete set null,
  cliente_nombre        text not null,                 -- snapshot (por si se borra el cliente)
  proyecto              text,
  notas                 text,
  fecha_emision         date not null default current_date,
  fecha_vencimiento     date,
  moneda_salida         moneda not null default 'PEN',
  tipo_cambio_aplicado  numeric(10,4) not null,        -- PEN por USD al momento
  subtotal              numeric(14,2) not null,        -- base imponible (sin IGV) en moneda_salida
  igv                   numeric(14,2) not null,        -- monto del IGV en moneda_salida
  total                 numeric(14,2) not null,        -- subtotal + igv en moneda_salida
  estado                estado_cotizacion not null default 'borrador',
  creado_por            uuid references usuarios(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (serie, anio, numero)
);

create index if not exists idx_cotizaciones_cliente on cotizaciones(cliente_id);
create index if not exists idx_cotizaciones_estado on cotizaciones(estado);
create index if not exists idx_cotizaciones_fecha on cotizaciones(fecha_emision desc);

create trigger trg_cotizaciones_updated
  before update on cotizaciones
  for each row execute function set_updated_at();


-- =====================================================================
-- ITEMS DE COTIZACIÓN
-- Guarda precio original Y precio convertido — así una auditoría
-- siempre puede recalcular la conversión.
-- =====================================================================
create table if not exists cotizacion_items (
  id                      uuid primary key default gen_random_uuid(),
  cotizacion_id           uuid not null references cotizaciones(id) on delete cascade,
  producto_id             uuid references productos(id) on delete set null,
  producto_nombre         text not null,            -- snapshot
  producto_unidad         text not null,            -- snapshot
  cantidad                numeric(12,2) not null check (cantidad > 0),
  precio_unitario_origen  numeric(14,2) not null,   -- precio en moneda original del producto
  moneda_origen           moneda not null,
  precio_unitario_salida  numeric(14,2) not null,   -- ya convertido a moneda_salida de la cotización
  subtotal                numeric(14,2) not null,   -- cantidad * precio_unitario_salida
  orden                   smallint not null default 0,
  created_at              timestamptz not null default now()
);

create index if not exists idx_items_cotizacion on cotizacion_items(cotizacion_id);


-- =====================================================================
-- SECUENCIA POR (SERIE, AÑO) — usada al crear cotización
-- =====================================================================
create or replace function siguiente_numero_cotizacion(p_serie char(3), p_anio integer)
returns integer language plpgsql as $$
declare v_next integer;
begin
  select coalesce(max(numero), 0) + 1 into v_next
  from cotizaciones
  where serie = p_serie and anio = p_anio;
  return v_next;
end $$;


-- =====================================================================
-- DATOS SEMILLA — CATEGORÍAS
-- =====================================================================
insert into categorias (id, nombre, icon, color, orden) values
  ('A', 'Acabados para Piso',     'fa-layer-group',   '#C8956C', 1),
  ('B', 'Acabados para Pared',    'fa-paint-roller',  '#8BAA7E', 2),
  ('C', 'Griferías',              'fa-faucet-drip',   '#7EAAB8', 3),
  ('D', 'Aparatos Sanitarios',    'fa-bath',          '#B87EA0', 4),
  ('E', 'Muebles de Cocina',      'fa-kitchen-set',   '#B8A47E', 5),
  ('F', 'Mármol para Cocina',     'fa-table',         '#9E9E9E', 6),
  ('G', 'Varios 1',               'fa-puzzle-piece',  '#A08BC8', 7),
  ('H', 'Varios 2',               'fa-shapes',        '#C8A07E', 8)
on conflict (id) do nothing;


-- =====================================================================
-- ROW LEVEL SECURITY
-- Política básica: cualquier usuario autenticado puede leer; admins
-- pueden escribir todo; vendedores pueden crear cotizaciones y clientes
-- pero no editar productos/categorías/config.
-- Ajusta según necesites antes de producción.
-- =====================================================================
alter table usuarios          enable row level security;
alter table categorias        enable row level security;
alter table proveedores       enable row level security;
alter table productos         enable row level security;
alter table clientes          enable row level security;
alter table empresa_config    enable row level security;
alter table tipos_cambio      enable row level security;
alter table cotizaciones      enable row level security;
alter table cotizacion_items  enable row level security;

-- Helper: ¿el usuario actual es admin?
create or replace function es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from usuarios
    where id = auth.uid() and rol = 'admin' and activo = true
  );
$$;

-- Lectura para autenticados
create policy p_select_autenticado_usuarios       on usuarios          for select to authenticated using (true);
create policy p_select_autenticado_categorias     on categorias        for select to authenticated using (true);
create policy p_select_autenticado_proveedores    on proveedores       for select to authenticated using (true);
create policy p_select_autenticado_productos      on productos         for select to authenticated using (true);
create policy p_select_autenticado_clientes       on clientes          for select to authenticated using (true);
create policy p_select_autenticado_config         on empresa_config    for select to authenticated using (true);
create policy p_select_autenticado_tc             on tipos_cambio      for select to authenticated using (true);
create policy p_select_autenticado_cotizaciones   on cotizaciones      for select to authenticated using (true);
create policy p_select_autenticado_items          on cotizacion_items  for select to authenticated using (true);

-- Escritura: admins en todo
create policy p_admin_all_proveedores   on proveedores      for all to authenticated using (es_admin()) with check (es_admin());
create policy p_admin_all_productos     on productos        for all to authenticated using (es_admin()) with check (es_admin());
create policy p_admin_all_config        on empresa_config   for all to authenticated using (es_admin()) with check (es_admin());
create policy p_admin_all_tc            on tipos_cambio     for all to authenticated using (es_admin()) with check (es_admin());
create policy p_admin_all_categorias    on categorias       for all to authenticated using (es_admin()) with check (es_admin());
create policy p_admin_all_usuarios      on usuarios         for all to authenticated using (es_admin()) with check (es_admin());

-- Cotizaciones y clientes: cualquier autenticado puede crear; solo admin o creador puede modificar/borrar.
create policy p_insert_cotizaciones on cotizaciones for insert to authenticated with check (true);
create policy p_update_cotizaciones on cotizaciones for update to authenticated using (es_admin() or creado_por = auth.uid());
create policy p_delete_cotizaciones on cotizaciones for delete to authenticated using (es_admin() or creado_por = auth.uid());

create policy p_insert_items on cotizacion_items for insert to authenticated with check (true);
create policy p_update_items on cotizacion_items for update to authenticated using (es_admin());
create policy p_delete_items on cotizacion_items for delete to authenticated using (
  es_admin() or exists (
    select 1 from cotizaciones c
    where c.id = cotizacion_items.cotizacion_id and c.creado_por = auth.uid()
  )
);

create policy p_insert_clientes on clientes for insert to authenticated with check (true);
create policy p_update_clientes on clientes for update to authenticated using (true);
create policy p_delete_clientes on clientes for delete to authenticated using (es_admin());
