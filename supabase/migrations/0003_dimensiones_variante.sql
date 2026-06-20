-- =====================================================================
-- Polyline SAC — Migración 0003
-- Dimensiones físicas de cada variante (ancho × largo en cm).
-- Necesario para que la calculadora estime cuántas piezas cubren
-- una superficie dada.
-- =====================================================================

alter table producto_variantes
  add column if not exists ancho_cm numeric(8,2) check (ancho_cm is null or (ancho_cm > 0 and ancho_cm <= 9999)),
  add column if not exists largo_cm numeric(8,2) check (largo_cm is null or (largo_cm > 0 and largo_cm <= 9999)),
  add column if not exists unidades_por_paquete integer check (unidades_por_paquete is null or (unidades_por_paquete >= 1 and unidades_por_paquete <= 9999));

comment on column producto_variantes.ancho_cm is 'Ancho físico de la pieza en centímetros. NULL = no aplica (sanitarios, muebles, etc.).';
comment on column producto_variantes.largo_cm is 'Largo físico de la pieza en centímetros. NULL = no aplica.';
comment on column producto_variantes.unidades_por_paquete is 'Cuántas piezas trae cada paquete/caja del proveedor. NULL = se vende por unidad suelta.';

-- Helper: área en m² de una variante (0 si no tiene dimensiones).
create or replace function variante_area_m2(p_variante_id uuid)
returns numeric language sql stable as $$
  select coalesce(
    (select (ancho_cm / 100.0) * (largo_cm / 100.0)
     from producto_variantes
     where id = p_variante_id and ancho_cm is not null and largo_cm is not null),
    0
  );
$$;
