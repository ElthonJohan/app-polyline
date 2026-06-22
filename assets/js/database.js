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

