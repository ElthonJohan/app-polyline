-- =====================================================================
-- Datos demo — los mismos 21 productos del catálogo original.
-- Ejecuta DESPUÉS de 0001_init.sql.
-- =====================================================================

-- Proveedores
insert into proveedores (nombre) values
  ('Cerámicas del Sur'),
  ('Mármoles Premium'),
  ('Maderas Finas'),
  ('ColorPro'),
  ('DecoWalls'),
  ('Texturas Plus'),
  ('HidroLux'),
  ('SanitariosPro'),
  ('BañoLux'),
  ('CocinasModerna'),
  ('StoneTop'),
  ('DecoLux'),
  ('VidriosSeguros'),
  ('MoldurasPro')
on conflict (nombre) do nothing;

-- Productos demo (todos en PEN para mantener compatibilidad con el localStorage)
insert into productos (nombre, categoria_id, descripcion, precio, moneda, unidad, imagen, proveedor_id, stock_disponible)
select * from (values
  ('Porcelanato Calcáreo Natural 60x60', 'A'::char(1), 'Porcelanato de alta resistencia con acabado mate que replica la piedra calcárea. Ideal para áreas de alto tráfico.', 45.90::numeric, 'PEN'::moneda, 'm²', 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='Cerámicas del Sur'), true),
  ('Mármol Carrara Pulido 80x80', 'A', 'Loseta de mármol importado con vetas grises características. Acabado pulido de alto brillo.', 128.50, 'PEN', 'm²', 'https://images.unsplash.com/photo-1618219908412-a29a1bb7b86e?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='Mármoles Premium'), true),
  ('Parquet de Roble Europeo', 'A', 'Tarugo de madera maciza de roble con acabado natural mate. Grosor 15mm.', 89.00, 'PEN', 'm²', 'https://images.unsplash.com/photo-1581858726788-75bc0f6a952d?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='Maderas Finas'), true),
  ('Gres Porcelánico Wood 20x120', 'A', 'Formato largo que imita la madera con la durabilidad del gres. Acabado rugoso natural.', 52.30, 'PEN', 'm²', 'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='Cerámicas del Sur'), false),
  ('Pintura Látex Premium Blanca', 'B', 'Pintura látex de alta cobertura y lavabilidad. Acabado mate elegante para paredes interiores.', 38.50, 'PEN', 'galón', 'https://images.unsplash.com/photo-1562624232-a5413d33342b?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='ColorPro'), true),
  ('Papel Mural Veneciano', 'B', 'Papel mural texturizado con diseño de encaje veneciano. Tono crema con relieve.', 65.00, 'PEN', 'rollo', 'https://images.unsplash.com/photo-1615529182904-14819c35db37?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='DecoWalls'), true),
  ('Revestimiento 3D Piedra Volcánica', 'B', 'Panel decorativo con textura de piedra volcánica en relieve. Perfecto para acentos verticales.', 78.90, 'PEN', 'm²', 'https://images.unsplash.com/photo-1531971589569-0d93700fd1a5?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='Texturas Plus'), true),
  ('Grifería Monomando Lavabo Línea Neo', 'C', 'Grifería contemporánea de una sola palanca con acabado cromado brillante. Cartucho cerámico.', 95.00, 'PEN', 'unidad', 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='HidroLux'), true),
  ('Grifería de Ducha Termostática', 'C', 'Sistema termostático con salida para ducha manual y teléfono. Acabado negro mate.', 245.00, 'PEN', 'unidad', 'https://images.unsplash.com/photo-1604014237800-1c9102c219da?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='HidroLux'), true),
  ('Grifería Cocina con Pull-Out', 'C', 'Grifería de cocina con caño retráctil y rociador dual. Acabado acero inoxidable.', 165.00, 'PEN', 'unidad', 'https://images.unsplash.com/photo-1588854337236-6889d631faa8?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='HidroLux'), false),
  ('Inodoro de Pie Compacto', 'D', 'Inodoro de pie con descarga dual 3/6 litros. Cerámica blanca con tapa de cierre suave.', 185.00, 'PEN', 'unidad', 'https://images.unsplash.com/photo-1564540574859-0dfb63985953?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='SanitariosPro'), true),
  ('Lavabo Sobre Encimera Oval', 'D', 'Lavabo ovalado en porcelana vitrificada para instalación sobre mueble. Acabado blanco brillante.', 120.00, 'PEN', 'unidad', 'https://images.unsplash.com/photo-1620626011761-996317b8d101?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='SanitariosPro'), true),
  ('Bañera Freestanding Acrílica', 'D', 'Bañera de pie en acrílico reforzado con forma orgánica moderna. Capacidad 280L.', 890.00, 'PEN', 'unidad', 'https://images.unsplash.com/photo-1584622781564-1d987f7333c1?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='BañoLux'), true),
  ('Mueble Cocina Lacado Gris Paloma', 'E', 'Gabinete superior e inferior en MDF lacado color gris paloma. Herrajes soft-close incluidos.', 320.00, 'PEN', 'módulo', 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='CocinasModerna'), true),
  ('Isla de Cocina con Top de Madera', 'E', 'Isla central con gabinetes de almacenamiento y top de madera tratada. Incluye barra desayunadora.', 1850.00, 'PEN', 'unidad', 'https://images.unsplash.com/photo-1565183997392-2f6f122e5912?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='CocinasModerna'), true),
  ('Mármol Nero Marquina para Cocina', 'F', 'Mármol negro con vetas blancas intensas. Ideal para mesada de cocina con acabado pulido.', 195.00, 'PEN', 'm²', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='Mármoles Premium'), true),
  ('Cuarcita Calacatta Gold', 'F', 'Cuarcita con patrón de veta dorada sobre fondo blanco cremoso. Resistente a manchas.', 220.00, 'PEN', 'm²', 'https://images.unsplash.com/photo-160060768739-ce8a6c25118c?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='StoneTop'), true),
  ('Espejo LED con Sensor Táctil', 'G', 'Espejo rectangular con iluminación LED perimetral, anti-empañamiento y sensor táctil.', 175.00, 'PEN', 'unidad', 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='DecoLux'), true),
  ('Accesorios de Baño Negro Mate (Set x5)', 'G', 'Juego completo: portapapel, portacepillo, jabonera, gancho y dispensador. Negro mate.', 85.00, 'PEN', 'set', 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='DecoLux'), true),
  ('Barandal de Vidrio Templado', 'H', 'Barandal de 1m lineal en vidrio templado de 10mm con soportes de acero inoxidable.', 135.00, 'PEN', 'm lineal', 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='VidriosSeguros'), true),
  ('Moldura de Corrida PU Premium', 'H', 'Moldura decorativa de poliuretano de alta densidad. Diseño clásico francés. Largo 2.4m.', 28.50, 'PEN', 'pieza', 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=600&q=80', (select id from proveedores where nombre='MoldurasPro'), true)
) as p(nombre, categoria_id, descripcion, precio, moneda, unidad, imagen, proveedor_id, stock_disponible)
where not exists (select 1 from productos where productos.nombre = p.nombre);

-- Tipo de cambio inicial
insert into tipos_cambio (fecha, pen_por_usd, fuente)
values (current_date, 3.7500, 'manual')
on conflict (fecha) do nothing;
