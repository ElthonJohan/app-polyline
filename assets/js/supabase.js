const SUPABASE_URL =
  "https://lxobuhdibnbpkknxlezz.supabase.co";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4b2J1aGRpYm5icGtrbnhsZXp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwODQzNzIsImV4cCI6MjA5NzY2MDM3Mn0.ixaEPR3tM4kJfze7fBFsEnHtmV3O8CvoVHNxgCQiWIY";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

console.log("Supabase conectado");

async function testProductos() {
  const { data, error } = await supabaseClient
    .from('productos')
    .select('*');

  console.log('DATA:', data);
  console.log('ERROR:', error);
}

testProductos();