async function getProductos() {

  const { data, error } = await supabaseClient
    .from('productos')
    .select(`
      *,
      producto_variantes (*)
    `);

  if (error) {
    console.error(error);
    return [];
  }

  return data.map(function(producto) {

    producto.variantes =
      producto.producto_variantes || [];

    delete producto.producto_variantes;

    return producto;
  });
}

async function createProducto(producto) {
  const { data, error } = await supabaseClient
    .from('productos')
    .insert(producto)
    .select();

  if (error) throw error;

  return data[0];
}

async function updateProducto(id, producto) {
  const { error } = await supabaseClient
    .from('productos')
    .update(producto)
    .eq('id', id);

  if (error) throw error;
}

async function deleteProducto(id) {
  const { error } = await supabaseClient
    .from('productos')
    .delete()
    .eq('id', id);

  if (error) throw error;
}


//CLIENTES
async function getOrCreateCliente(nombre, ruc) {

  let cliente = null;

  if (ruc) {

    const { data } = await supabaseClient
      .from('clientes')
      .select('*')
      .eq('ruc', ruc)
      .limit(1);

    if (data && data.length) {
      cliente = data[0];
    }
  }

  if (!cliente) {

    const { data } = await supabaseClient
      .from('clientes')
      .select('*')
      .eq('nombre', nombre)
      .limit(1);

    if (data && data.length) {
      cliente = data[0];
    }
  }

  if (cliente) return cliente;

  const { data: nuevo, error } = await supabaseClient
    .from('clientes')
    .insert([{
      nombre,
      ruc
    }])
    .select()
    .single();

  if (error) throw error;

  return nuevo;
}

// COTIZACIONES

async function createCotizacion(cotizacion) {

  const { data, error } = await supabaseClient
    .from('cotizaciones')
    .insert([cotizacion])
    .select()
    .single();

  if (error) throw error;

  return data;
}


async function getCotizaciones() {

  const { data, error } = await supabaseClient
    .from('cotizaciones')
    .select(`
      *,
      cotizacion_items (*)
    `)
    .order('created_at', {
      ascending: false
    });

  if (error) {
    console.error(error);
    return [];
  }

  return data.map(function(q){

    return {
      id: q.id,
      numero: q.numero,
      cliente: q.cliente_nombre,
      proyecto: q.proyecto,
      notas: q.notas,
      fecha: q.fecha_emision,
      estado: q.estado,
      moneda: q.moneda_salida,
      tipoCambio: q.tipo_cambio_aplicado,
      total: Number(q.total || 0),

      items: (q.cotizacion_items || []).map(function(item){

        return {
          productoId: item.producto_id,
          varianteId: item.variante_id,

          productoNombre: item.producto_nombre,
          productoUnidad: item.producto_unidad,

          cantidad: Number(item.cantidad),

          precioUnitario:
            Number(item.precio_unitario_salida),

          precioUnitarioOrigen:
            Number(item.precio_unitario_origen),

          monedaOrigen:
            item.moneda_origen,

          subtotal:
            Number(item.subtotal)
        };
      })
    };
  });
}



async function createCotizacionItems(items) {

  const { error } = await supabaseClient
    .from('cotizacion_items')
    .insert(items);

  if (error) throw error;
}


// Proveedores
async function getProveedores() {

  const { data, error } = await supabaseClient
    .from('proveedores')
    .select('*')
    .eq('activo', true)
    .order('nombre');

  if (error) {
    console.error(error);
    return [];
  }

  return data;
}

async function createProveedor(proveedor) {

  const { data, error } = await supabaseClient
    .from('proveedores')
    .insert([proveedor])
    .select()
    .single();

  if (error) throw error;

  return data;
}

async function updateProveedor(id, proveedor) {

  const { error } = await supabaseClient
    .from('proveedores')
    .update(proveedor)
    .eq('id', id);

  if (error) throw error;
}

async function deleteProveedor(id) {

  const { error } = await supabaseClient
    .from('proveedores')
    .delete()
    .eq('id', id);

  if (error) throw error;
}


//Empresa config

async function getEmpresaConfig() {

  const { data, error } = await supabaseClient
    .from('empresa_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}

async function updateEmpresaConfig(config) {

  const { error } = await supabaseClient
    .from('empresa_config')
    .update(config)
    .eq('id', 1);

  if (error) throw error;
}