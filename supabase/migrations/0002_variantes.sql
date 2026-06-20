-- =====================================================================
-- Polyline SAC — Migración 0002
-- Variantes / "detalles" de un producto.
-- Ejemplo: producto "Mármol" con variantes "Negro" y "Blanco",
-- cada una con su propio precio, imagen, descripción y stock.
-- =====================================================================

-- ---------- TABLA ----------
create table if not exists producto_variantes (
  id                  uuid primary key default gen_random_uuid(),
  producto_id         uuid not null references productos(id) on delete cascade,
  nombre              text not null,                   -- "Negro", "60x60", etc.
  descripcion         text not null default '',
  precio              numeric(14,2) not null check (precio >= 0),
  moneda              moneda not null default 'PEN',
  imagen              text,                            -- URL; null = usa la del producto padre
  stock_disponible    boolean not null default true,
  stock_cantidad      numeric(12,2),
  orden               smallint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_variantes_producto on producto_variantes(producto_id, orden);

create trigger trg_variantes_updated
  before update on producto_variantes
  for each row execute function set_updated_at();


-- ---------- ITEMS DE COTIZACIÓN ----------
-- Cada línea puede referir a un producto suelto O a una variante.
-- Si variante_id != null, producto_id es el padre y precio/imagen vienen
-- de la variante. Mantenemos producto_nombre como snapshot ya escrito
-- "Producto — Variante" para que la cotización sobreviva si se borra
-- la variante o el producto.
alter table cotizacion_items
  add column if not exists variante_id uuid references producto_variantes(id) on delete set null;

create index if not exists idx_items_variante on cotizacion_items(variante_id);


-- ---------- RLS ----------
alter table producto_variantes enable row level security;

create policy p_select_autenticado_variantes
  on producto_variantes for select to authenticated using (true);

create policy p_admin_all_variantes
  on producto_variantes for all to authenticated
  using (es_admin()) with check (es_admin());


-- ---------- HELPER: precio mínimo (para el catálogo) ----------
-- Devuelve el menor precio entre el producto y sus variantes, convertido
-- a PEN para comparar correctamente entre monedas distintas.
create or replace function producto_precio_minimo_pen(p_producto_id uuid, p_tipo_cambio numeric)
returns numeric language sql stable as $$
  with precios as (
    -- Precio del producto si NO tiene variantes
    select p.precio as precio_local, p.moneda as moneda_local
    from productos p
    where p.id = p_producto_id
      and not exists (select 1 from producto_variantes v where v.producto_id = p.id)
    union all
    -- Precios de cada variante
    select v.precio, v.moneda
    from producto_variantes v
    where v.producto_id = p_producto_id
  )
  select min(
    case
      when moneda_local = 'PEN' then precio_local
      when moneda_local = 'USD' then precio_local * p_tipo_cambio
    end
  )
  from precios;
$$;
