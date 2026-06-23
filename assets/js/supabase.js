const SUPABASE_URL =
  "https://lxobuhdibnbpkknxlezz.supabase.co";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4b2J1aGRpYm5icGtrbnhsZXp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODQzNzIsImV4cCI6MjA5NzY2MDM3Mn0.ixaEPR3tM4kJfze7fBFsEnHtmV3O8CvoVHNxgCQiWIY";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

console.log("Supabase conectado");

// async function testProductos() {
//   const { data, error } = await supabaseClient
//     .from('productos')
//     .select('*');

//   console.log('DATA:', data);
//   console.log('ERROR:', error);
// }

// testProductos();

async function login(email, password) {

  const { data, error } = await supabaseClient
    .from('usuarios')
    .select('*')
    .eq('email', email)
    .eq('password', password)
    .eq('activo', true)
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}

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