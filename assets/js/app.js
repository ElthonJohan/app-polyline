// =====================================================================
// HELPERS DE SEGURIDAD
// El frontend construye HTML por concatenación de strings y lo inyecta
// con innerHTML. Cualquier dato controlado por el usuario DEBE pasar
// por esc() antes de embeberse — sin excepciones.
// =====================================================================

// Escapa caracteres HTML peligrosos. Sirve tanto para texto como para
// el contenido de atributos siempre que estos usen comillas dobles.
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sanitiza URLs (img src, href). Bloquea esquemas peligrosos (javascript:,
// data:text/html, file:, etc.). Solo permite http(s), data:image/*,
// data:application/pdf (para PDFs subidos en Recursos) y rutas relativas.
function escUrl(s) {
  if (s === null || s === undefined) return "";
  var u = String(s).trim();
  if (!u) return "";
  if (/^(https?:|data:image\/|data:application\/pdf;base64,)/i.test(u))
    return esc(u);
  if (u.charAt(0) === "/" || u.charAt(0) === ".") return esc(u);
  if (u.indexOf(":") === -1) return esc(u); // path relativo sin esquema
  return "";
}

// Validaciones reutilizables
var VALID = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  ruc: /^(10|15|17|20)\d{9}$/, // RUC peruano (11 dígitos, prefijos válidos)
  maxLen: {
    nombre: 200,
    descripcion: 1000,
    proveedor: 100,
    unidad: 30,
    cliente: 200,
    proyecto: 200,
    notas: 1000,
    ruc: 11,
    email: 254,
    telefono: 30,
    direccion: 300,
    condiciones: 2000,
  },
};

function trimMax(s, max) {
  s = (s == null ? "" : String(s)).trim();
  return s.length > max ? s.substring(0, max) : s;
}

// Estado global
const APP = {
  user: null,
  page: "dashboard",
  cart: [],
  products: [],
  proveedores: [],
  quotes: [],
  config: null,
  search: "",
  activeCat: "all",
  presentationMode: false,
  tourActive: false,
  tourStep: 0,
  quoteCounter: 0,
};

// Monedas soportadas. Coinciden con el ENUM `moneda` en Supabase.
const MONEDAS = {
  PEN: { codigo: "PEN", simbolo: "S/.", nombre: "Soles", locale: "es-PE" },
  USD: { codigo: "USD", simbolo: "US$", nombre: "Dólares", locale: "en-US" },
};

// Formatea un monto con su símbolo. Si no se pasa moneda, usa PEN (default histórico).
function formatMoney(amount, codigo) {
  var m = MONEDAS[codigo] || MONEDAS.PEN;
  var n = (typeof amount === "number" ? amount : 0).toLocaleString(m.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return m.simbolo + " " + n;
}

// Convierte un precio entre PEN y USD usando un tipo de cambio (PEN por USD).
function convertirPrecio(precio, monedaOrigen, monedaDestino, tipoCambio) {
  if (!monedaOrigen) monedaOrigen = "PEN";
  if (monedaOrigen === monedaDestino) return precio;
  if (monedaOrigen === "USD" && monedaDestino === "PEN")
    return precio * tipoCambio;
  if (monedaOrigen === "PEN" && monedaDestino === "USD")
    return precio / tipoCambio;
  return precio;
}

// Tipo de cambio actual desde configuración (PEN por USD).
function tipoCambioActual() {
  var tc = APP.config?.tipo_cambio_default;

  tc = parseFloat(tc);

  return isNaN(tc) || tc <= 0 ? 3.75 : tc;
}

// Migra productos antiguos (sin campo moneda o variantes) al nuevo schema.
function normalizarProducto(p) {
  if (!p.moneda) p.moneda = "PEN";
  if (!Array.isArray(p.variantes)) p.variantes = [];
  // Cada variante hereda moneda del padre si no la trae.
  p.variantes.forEach(function (v) {
    if (!v.moneda) v.moneda = p.moneda;
    if (typeof v.stock_disponible !== "boolean") v.stock = true;
    // Dimensiones en cm. null = sin medidas (no se puede calcular cobertura).
    if (v.ancho == null || isNaN(parseFloat(v.ancho))) v.ancho = null;
    if (v.largo == null || isNaN(parseFloat(v.largo))) v.largo = null;
    // Unidades que vienen por paquete/caja. null = se vende por unidad suelta.
    if (
      v.unidadesPorPaquete == null ||
      isNaN(parseInt(v.unidadesPorPaquete, 10))
    )
      v.unidadesPorPaquete = null;
  });
  return p;
}

// Área de una variante en m² (a partir de sus medidas en cm). 0 si no tiene.
function areaVarianteM2(v) {
  if (!v || !v.ancho || !v.largo) return 0;
  return (Number(v.ancho) / 100) * (Number(v.largo) / 100);
}

// Devuelve { precio, moneda, esRango } para mostrar en el catálogo.
// Si el producto tiene variantes usa el precio mínimo (convertido a PEN
// solo para comparar correctamente entre monedas distintas).
function precioMinimo(p) {
  if (!p.variantes || !p.variantes.length) {
    return { precio: p.precio, moneda: p.moneda || "PEN", esRango: false };
  }
  var tc = tipoCambioActual();
  var min = null;
  p.variantes.forEach(function (v) {
    var mon = v.moneda || p.moneda || "PEN";
    var enPEN = convertirPrecio(v.precio, mon, "PEN", tc);
    if (min === null || enPEN < min.enPEN) {
      min = { precio: v.precio, moneda: mon, enPEN: enPEN };
    }
  });
  return {
    precio: min.precio,
    moneda: min.moneda,
    esRango: p.variantes.length > 1,
  };
}

// Producto con al menos una variante en stock o sin variantes y stock=true.
function productoDisponible(p) {
  if (p.variantes && p.variantes.length) {
    return p.variantes.some(function (v) {
      return v.stock_disponible;
    });
  }
  return p.stock_disponible;
}

// Para un item del carrito: si es variante, resuelve datos del producto
// padre + la variante. Si es producto suelto, devuelve sus datos directos.
// Devuelve null si la entidad ya no existe.
function resolveCartItem(item) {
  if (item.parentId) {
    var prod = APP.products.find(function (p) {
      return p.id === item.parentId;
    });
    if (!prod) return null;
    var v = (prod.variantes || []).find(function (x) {
      return x.id === item.id;
    });
    if (!v) return null;
    return {
      nombre: prod.nombre + " — " + v.nombre,
      imagen: v.imagen || prod.imagen,
      unidad: prod.unidad,
      moneda: v.moneda || prod.moneda || "PEN",
      precio: v.precio,
      stock: v.stock_disponible,
      esVariante: true,
    };
  }
  var p = APP.products.find(function (x) {
    return x.id === item.id;
  });
  if (!p) return null;
  return {
    nombre: p.nombre,
    imagen: p.imagen,
    unidad: p.unidad,
    moneda: p.moneda || "PEN",
    precio: p.precio,
    stock: p.stock_disponible,
    esVariante: false,
  };
}

// Migra cotizaciones antiguas (sin moneda/TC) al nuevo schema. PEN por defecto.
function normalizarCotizacion(q) {
  if (!q.moneda) q.moneda = "PEN";
  if (!q.tipoCambio) q.tipoCambio = 3.75;
  return q;
}

const CATEGORIAS = [
  {
    id: "A",
    nombre: "Acabados para Piso",
    icon: "fa-layer-group",
    color: "#C8956C",
  },
  {
    id: "B",
    nombre: "Acabados para Pared",
    icon: "fa-paint-roller",
    color: "#8BAA7E",
  },
  { id: "C", nombre: "Griferías", icon: "fa-faucet-drip", color: "#7EAAB8" },
  { id: "D", nombre: "Aparatos Sanitarios", icon: "fa-bath", color: "#B87EA0" },
  {
    id: "E",
    nombre: "Muebles de Cocina",
    icon: "fa-kitchen-set",
    color: "#B8A47E",
  },
  { id: "F", nombre: "Mármol para Cocina", icon: "fa-table", color: "#9E9E9E" },
  { id: "G", nombre: "Varios 1", icon: "fa-puzzle-piece", color: "#A08BC8" },
  { id: "H", nombre: "Varios 2", icon: "fa-shapes", color: "#C8A07E" },
];

const DEFAULT_PRODUCTS = [
  {
    id: "p1",
    nombre: "Porcelanato Calcáreo Natural 60x60",
    categoria: "A",
    descripcion:
      "Porcelanato de alta resistencia con acabado mate que replica la piedra calcárea. Ideal para áreas de alto tráfico.",
    precio: 45.9,
    imagen:
      "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=600&q=80",
    proveedor: "Cerámicas del Sur",
    stock: true,
    unidad: "m²",
    fechaActualizacion: "2025-01-10",
  },
  {
    id: "p2",
    nombre: "Mármol Carrara Pulido 80x80",
    categoria: "A",
    descripcion:
      "Loseta de mármol importado con vetas grises características. Acabado pulido de alto brillo.",
    precio: 128.5,
    imagen:
      "https://images.unsplash.com/photo-1618219908412-a29a1bb7b86e?auto=format&fit=crop&w=600&q=80",
    proveedor: "Mármoles Premium",
    stock: true,
    unidad: "m²",
    fechaActualizacion: "2025-01-08",
  },
  {
    id: "p3",
    nombre: "Parquet de Roble Europeo",
    categoria: "A",
    descripcion:
      "Tarugo de madera maciza de roble con acabado natural mate. Grosor 15mm.",
    precio: 89.0,
    imagen:
      "https://images.unsplash.com/photo-1581858726788-75bc0f6a952d?auto=format&fit=crop&w=600&q=80",
    proveedor: "Maderas Finas",
    stock: true,
    unidad: "m²",
    fechaActualizacion: "2025-01-12",
  },
  {
    id: "p4",
    nombre: "Gres Porcelánico Wood 20x120",
    categoria: "A",
    descripcion:
      "Formato largo que imita la madera con la durabilidad del gres. Acabado rugoso natural.",
    precio: 52.3,
    imagen:
      "https://images.unsplash.com/photo-1507089947368-19c1da9775ae?auto=format&fit=crop&w=600&q=80",
    proveedor: "Cerámicas del Sur",
    stock: false,
    unidad: "m²",
    fechaActualizacion: "2025-01-05",
  },
  {
    id: "p5",
    nombre: "Pintura Látex Premium Blanca",
    categoria: "B",
    descripcion:
      "Pintura látex de alta cobertura y lavabilidad. Acabado mate elegante para paredes interiores.",
    precio: 38.5,
    imagen:
      "https://images.unsplash.com/photo-1562624232-a5413d33342b?auto=format&fit=crop&w=600&q=80",
    proveedor: "ColorPro",
    stock: true,
    unidad: "galón",
    fechaActualizacion: "2025-01-11",
  },
  {
    id: "p6",
    nombre: "Papel Mural Veneciano",
    categoria: "B",
    descripcion:
      "Papel mural texturizado con diseño de encaje veneciano. Tono crema con relieve.",
    precio: 65.0,
    imagen:
      "https://images.unsplash.com/photo-1615529182904-14819c35db37?auto=format&fit=crop&w=600&q=80",
    proveedor: "DecoWalls",
    stock: true,
    unidad: "rollo",
    fechaActualizacion: "2025-01-09",
  },
  {
    id: "p7",
    nombre: "Revestimiento 3D Piedra Volcánica",
    categoria: "B",
    descripcion:
      "Panel decorativo con textura de piedra volcánica en relieve. Perfecto para acentos verticales.",
    precio: 78.9,
    imagen:
      "https://images.unsplash.com/photo-1531971589569-0d93700fd1a5?auto=format&fit=crop&w=600&q=80",
    proveedor: "Texturas Plus",
    stock: true,
    unidad: "m²",
    fechaActualizacion: "2025-01-07",
  },
  {
    id: "p8",
    nombre: "Grifería Monomando Lavabo Línea Neo",
    categoria: "C",
    descripcion:
      "Grifería contemporánea de una sola palanca con acabado cromado brillante. Cartucho cerámico.",
    precio: 95.0,
    imagen:
      "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=600&q=80",
    proveedor: "HidroLux",
    stock: true,
    unidad: "unidad",
    fechaActualizacion: "2025-01-10",
  },
  {
    id: "p9",
    nombre: "Grifería de Ducha Termostática",
    categoria: "C",
    descripcion:
      "Sistema termostático con salida para ducha manual y teléfono. Acabado negro mate.",
    precio: 245.0,
    imagen:
      "https://images.unsplash.com/photo-1604014237800-1c9102c219da?auto=format&fit=crop&w=600&q=80",
    proveedor: "HidroLux",
    stock: true,
    unidad: "unidad",
    fechaActualizacion: "2025-01-06",
  },
  {
    id: "p10",
    nombre: "Grifería Cocina con Pull-Out",
    categoria: "C",
    descripcion:
      "Grifería de cocina con caño retráctil y rociador dual. Acabado acero inoxidable.",
    precio: 165.0,
    imagen:
      "https://images.unsplash.com/photo-1588854337236-6889d631faa8?auto=format&fit=crop&w=600&q=80",
    proveedor: "HidroLux",
    stock: false,
    unidad: "unidad",
    fechaActualizacion: "2025-01-04",
  },
  {
    id: "p11",
    nombre: "Inodoro de Pie Compacto",
    categoria: "D",
    descripcion:
      "Inodoro de pie con descarga dual 3/6 litros. Cerámica blanca con tapa de cierre suave.",
    precio: 185.0,
    imagen:
      "https://images.unsplash.com/photo-1564540574859-0dfb63985953?auto=format&fit=crop&w=600&q=80",
    proveedor: "SanitariosPro",
    stock: true,
    unidad: "unidad",
    fechaActualizacion: "2025-01-12",
  },
  {
    id: "p12",
    nombre: "Lavabo Sobre Encimera Oval",
    categoria: "D",
    descripcion:
      "Lavabo ovalado en porcelana vitrificada para instalación sobre mueble. Acabado blanco brillante.",
    precio: 120.0,
    imagen:
      "https://images.unsplash.com/photo-1620626011761-996317b8d101?auto=format&fit=crop&w=600&q=80",
    proveedor: "SanitariosPro",
    stock: true,
    unidad: "unidad",
    fechaActualizacion: "2025-01-11",
  },
  {
    id: "p13",
    nombre: "Bañera Freestanding Acrílica",
    categoria: "D",
    descripcion:
      "Bañera de pie en acrílico reforzado con forma orgánica moderna. Capacidad 280L.",
    precio: 890.0,
    imagen:
      "https://images.unsplash.com/photo-1584622781564-1d987f7333c1?auto=format&fit=crop&w=600&q=80",
    proveedor: "BañoLux",
    stock: true,
    unidad: "unidad",
    fechaActualizacion: "2025-01-03",
  },
  {
    id: "p14",
    nombre: "Mueble Cocina Lacado Gris Paloma",
    categoria: "E",
    descripcion:
      "Gabinete superior e inferior en MDF lacado color gris paloma. Herrajes soft-close incluidos.",
    precio: 320.0,
    imagen:
      "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=600&q=80",
    proveedor: "CocinasModerna",
    stock: true,
    unidad: "módulo",
    fechaActualizacion: "2025-01-10",
  },
  {
    id: "p15",
    nombre: "Isla de Cocina con Top de Madera",
    categoria: "E",
    descripcion:
      "Isla central con gabinetes de almacenamiento y top de madera tratada. Incluye barra desayunadora.",
    precio: 1850.0,
    imagen:
      "https://images.unsplash.com/photo-1565183997392-2f6f122e5912?auto=format&fit=crop&w=600&q=80",
    proveedor: "CocinasModerna",
    stock: true,
    unidad: "unidad",
    fechaActualizacion: "2025-01-08",
  },
  {
    id: "p16",
    nombre: "Mármol Nero Marquina para Cocina",
    categoria: "F",
    descripcion:
      "Mármol negro con vetas blancas intensas. Ideal para mesada de cocina con acabado pulido.",
    precio: 195.0,
    imagen:
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80",
    proveedor: "Mármoles Premium",
    stock: true,
    unidad: "m²",
    fechaActualizacion: "2025-01-09",
  },
  {
    id: "p17",
    nombre: "Cuarcita Calacatta Gold",
    categoria: "F",
    descripcion:
      "Cuarcita con patrón de veta dorada sobre fondo blanco cremoso. Resistente a manchas.",
    precio: 220.0,
    imagen:
      "https://images.unsplash.com/photo-160060768739-ce8a6c25118c?auto=format&fit=crop&w=600&q=80",
    proveedor: "StoneTop",
    stock: true,
    unidad: "m²",
    fechaActualizacion: "2025-01-07",
  },
  {
    id: "p18",
    nombre: "Espejo LED con Sensor Táctil",
    categoria: "G",
    descripcion:
      "Espejo rectangular con iluminación LED perimetral, anti-empañamiento y sensor táctil.",
    precio: 175.0,
    imagen:
      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=600&q=80",
    proveedor: "DecoLux",
    stock: true,
    unidad: "unidad",
    fechaActualizacion: "2025-01-11",
  },
  {
    id: "p19",
    nombre: "Accesorios de Baño Negro Mate (Set x5)",
    categoria: "G",
    descripcion:
      "Juego completo: portapapel, portacepillo, jabonera, gancho y dispensador. Negro mate.",
    precio: 85.0,
    imagen:
      "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=600&q=80",
    proveedor: "DecoLux",
    stock: true,
    unidad: "set",
    fechaActualizacion: "2025-01-10",
  },
  {
    id: "p20",
    nombre: "Barandal de Vidrio Templado",
    categoria: "H",
    descripcion:
      "Barandal de 1m lineal en vidrio templado de 10mm con soportes de acero inoxidable.",
    precio: 135.0,
    imagen:
      "https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=600&q=80",
    proveedor: "VidriosSeguros",
    stock: true,
    unidad: "m lineal",
    fechaActualizacion: "2025-01-06",
  },
  {
    id: "p21",
    nombre: "Moldura de Corrida PU Premium",
    categoria: "H",
    descripcion:
      "Moldura decorativa de poliuretano de alta densidad. Diseño clásico francés. Largo 2.4m.",
    precio: 28.5,
    imagen:
      "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=600&q=80",
    proveedor: "MoldurasPro",
    stock: true,
    unidad: "pieza",
    fechaActualizacion: "2025-01-09",
  },
];

const DEFAULT_USERS = [
  {
    id: "u1",
    nombre: "Administrador",
    email: "admin@acabadospro.com",
    password: "admin123",
    rol: "admin",
  },
];

// =====================================================================
// PERSISTENCIA
// Capa fina sobre localStorage. NOTA: localStorage no es multi-dispositivo
// ni sobrevive a limpiezas del navegador. El schema de Supabase en
// supabase/migrations/0001_init.sql ya está listo para reemplazar esto
// — basta cambiar saveData/loadData por llamadas al SDK manteniendo
// la misma firma.
// =====================================================================
var MAX_BYTES = 4 * 1024 * 1024; // 4MB de margen (límite típico ~5MB)

function saveData(key, data) {
  try {
    var json = JSON.stringify(data);
    if (json.length > MAX_BYTES) {
      toast("Datos demasiado grandes para guardar localmente", "error");
      return false;
    }
    localStorage.setItem("acabados_" + key, json);
    return true;
  } catch (e) {
    // QuotaExceededError o localStorage deshabilitado (incógnito, etc.)
    toast(
      "No se pudo guardar: " +
        (e && e.name === "QuotaExceededError"
          ? "espacio agotado"
          : "almacenamiento no disponible"),
      "error",
    );
    return false;
  }
}

function loadData(key, fallback) {
  try {
    var d = localStorage.getItem("acabados_" + key);
    return d ? JSON.parse(d) : fallback;
  } catch (e) {
    return fallback;
  }
}
async function initAppData() {
  APP.products = await getProductos();
  APP.proveedores = await getProveedores();
  APP.quotes = await getCotizaciones();
  APP.config = await getEmpresaConfig();

  APP.quoteCounter = APP.quotes.length;

  console.log(
  APP.products.find(
    p => p.nombre === "prueba elthon"
  )
);
}

// Autenticación
async function handleLogin() {
  var email = document.getElementById("login-email").value.trim();
  var pass = document.getElementById("login-password").value;
  var user = await login(email, pass);
  if (!user) {
    toast("Credenciales incorrectas", "error");
    return;
  }
  APP.user = user;
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("user-name").textContent = user.nombre;
  document.getElementById("user-role").textContent =
    user.rol === "admin" ? "Administrador" : "Vendedor";
  document.getElementById("user-avatar").textContent = user.nombre
    .charAt(0)
    .toUpperCase();
  await initAppData();
  navigateTo("dashboard");
  toast("Bienvenido, " + user.nombre, "success");
}

async function checkSession() {

  const {
    data: { session }
  } = await supabaseClient.auth.getSession();

  console.log("SESSION:", session);

  if (!session) return false;

  const { data: usuario, error } =
    await supabaseClient
      .from("usuarios")
      .select("*")
      .eq("id", session.user.id)
      .single();

  if (error) {
    console.error(error);
    return false;
  }

  APP.user = usuario;

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";

  document.getElementById("user-name").textContent =
    usuario.nombre;

  document.getElementById("user-role").textContent =
    usuario.rol === "admin"
      ? "Administrador"
      : "Vendedor";

  document.getElementById("user-avatar").textContent =
    usuario.nombre.charAt(0).toUpperCase();

  await initAppData();

  const ultimaPagina =
  localStorage.getItem("ultimaPagina") ||
  "dashboard";

navigateTo(ultimaPagina);
updateCartBadge();

  return true;
}


async function handleLogout() {
  await supabaseClient.auth.signOut();

  APP.user = null;
  APP.cart = [];
  APP.page = "dashboard";

  document.getElementById("app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
}
document
  .getElementById("login-password")
  .addEventListener("keydown", function (e) {
    if (e.key === "Enter") handleLogin();
  });
document
  .getElementById("login-email")
  .addEventListener("keydown", function (e) {
    if (e.key === "Enter") handleLogin();
  });

// NAVEGACIÓN
var PAGE_TITLES = {
  dashboard: "Panel General",
  catalog: "Catálogo de Acabados",
  quotes: "Cotizaciones",
  admin: "Administrar Productos",
  recursos: "Recursos Técnicos",
  proveedores: "Agenda de Proveedores",
  settings: "Configuración",
};
function navigateTo(page) {

  console.log(
    "NAVEGANDO A:",
    page,
    new Error().stack
  );

  APP.page = page;

  localStorage.setItem(
    "ultimaPagina",
    page
  );

  document.getElementById("page-title").textContent =
    PAGE_TITLES[page] || "";

  document.querySelectorAll(".nav-item").forEach(function (n) {
    n.classList.toggle(
      "active",
      n.dataset.page === page
    );
  });

  renderPage();

  document.getElementById("sidebar")
    .classList.remove("mobile-open");
}


function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("mobile-open");
}

function togglePresentationMode() {
  APP.presentationMode = !APP.presentationMode;
  var sidebar = document.getElementById("sidebar");
  var topbar = document.getElementById("top-bar");
  var presbar = document.getElementById("presentation-bar");
  var main = document.getElementById("main-content");
  if (APP.presentationMode) {
    sidebar.classList.add("hidden-sidebar");
    topbar.style.display = "none";
    presbar.style.display = "flex";
    main.classList.add("full-width");
    main.style.paddingTop = "76px"; // alto de la presentation-bar (60) + 16 de colchón
    if (APP.page !== "catalog") navigateTo("catalog");
    toast("Modo Presentación activado", "info");
  } else {
    sidebar.classList.remove("hidden-sidebar");
    topbar.style.display = "flex";
    presbar.style.display = "none";
    main.classList.remove("full-width");
    main.style.paddingTop = ""; // dejar que el CSS (80px) tome control
    stopTour();
    toast("Modo Presentación desactivado", "info");
  }
}

// RENDERIZADO
function renderPage() {
  var c = document.getElementById("page-content");
  switch (APP.page) {
    case "dashboard":
      c.innerHTML = renderDashboard();
      break;
    case "catalog":
      c.innerHTML = renderCatalog();
      break;
    case "quotes":
      c.innerHTML = renderQuotes();
      break;
    case "admin":
      c.innerHTML = renderAdmin();
      break;
    case "recursos":
      c.innerHTML = renderRecursos();
      break;
    case "proveedores":
      c.innerHTML = renderProveedores();
      break;
    case "settings":
      c.innerHTML = renderSettings();
      break;
  }
}

// DASHBOARD
function renderDashboard() {
  var totalProducts = APP.products.length;
  var inStock = APP.products.filter(function (p) {
    return p.stock_disponible;
  }).length;
  var totalQuotes = APP.quotes.length;
  var tc = tipoCambioActual();
  // Suma todo en PEN para el indicador del dashboard, sin importar moneda de cada cotización.
  var totalRevenue = APP.quotes.reduce(function (s, q) {
    return (
      s + convertirPrecio(q.total, q.moneda || "PEN", "PEN", q.tipoCambio || tc)
    );
  }, 0);

  var cats = CATEGORIAS.map(function (cat) {
    var count = APP.products.filter(function (p) {
      return p.categoria === cat.id;
    }).length;
    return (
      '<div class="flex items-center gap-3 p-3 rounded-xl" style="background:var(--card);border:1px solid var(--border)">' +
      '<div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:' +
      cat.color +
      "15;color:" +
      cat.color +
      '"><i class="fas ' +
      cat.icon +
      '"></i></div>' +
      '<div class="flex-1"><p class="text-sm font-medium">' +
      cat.nombre +
      '</p><p class="text-xs" style="color:var(--muted)">' +
      count +
      " productos</p></div></div>"
    );
  }).join("");

  var recentQuotes =
    APP.quotes
      .slice(-3)
      .reverse()
      .map(function (q) {
        var estadoColor =
          q.estado === "enviada"
            ? "rgba(107,159,120,0.15);color:var(--success)"
            : q.estado === "borrador"
              ? "rgba(212,168,67,0.15);color:var(--warning)"
              : "rgba(200,149,108,0.15);color:var(--accent)";
        return (
          '<tr><td class="font-mono text-sm" style="color:var(--accent)">COT-' +
          String(q.numero).padStart(4, "0") +
          "</td><td>" +
          esc(q.cliente) +
          '</td><td class="text-sm" style="color:var(--muted)">' +
          esc(q.fecha) +
          '</td><td class="font-semibold">' +
          formatMoney(q.total, q.moneda || "PEN") +
          '</td><td><span class="px-2 py-1 rounded-md text-xs font-semibold" style="background:' +
          estadoColor +
          '">' +
          esc(q.estado) +
          "</span></td></tr>"
        );
      })
      .join("") ||
    '<tr><td colspan="5" class="text-center py-8" style="color:var(--muted)">Sin cotizaciones aún</td></tr>';

  return (
    '<div class="max-w-7xl mx-auto">' +
    '<div class="mb-8"><h1 class="text-3xl md:text-4xl font-bold mb-2">Buenos días, ' +
    (APP.user?.nombre || "Usuario") +
    '</h1><p style="color:var(--muted)">Resumen de tu catálogo y actividad reciente.</p></div>' +
    '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">' +
    '<div class="stat-card"><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:var(--accent-glow);color:var(--accent)"><i class="fas fa-boxes-stacked"></i></div></div><p class="text-2xl font-bold">' +
    totalProducts +
    '</p><p class="text-xs mt-1" style="color:var(--muted)">Productos totales</p></div>' +
    '<div class="stat-card"><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:rgba(107,159,120,0.12);color:var(--success)"><i class="fas fa-check-circle"></i></div></div><p class="text-2xl font-bold">' +
    inStock +
    '</p><p class="text-xs mt-1" style="color:var(--muted)">En stock</p></div>' +
    '<div class="stat-card"><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:rgba(126,170,184,0.12);color:#7EAAB8"><i class="fas fa-file-invoice"></i></div></div><p class="text-2xl font-bold">' +
    totalQuotes +
    '</p><p class="text-xs mt-1" style="color:var(--muted)">Cotizaciones</p></div>' +
    '<div class="stat-card"><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background:rgba(212,168,67,0.12);color:var(--warning)"><i class="fas fa-coins"></i></div></div><p class="text-2xl font-bold">' +
    formatMoney(totalRevenue, "PEN") +
    '</p><p class="text-xs mt-1" style="color:var(--muted)">Total cotizado (en S/.)</p></div>' +
    "</div>" +
    '<div class="grid lg:grid-cols-2 gap-6">' +
    '<div><h3 class="text-lg font-bold mb-4">Productos por Categoría</h3><div class="space-y-2">' +
    cats +
    "</div></div>" +
    '<div><div class="flex items-center justify-between mb-4"><h3 class="text-lg font-bold">Cotizaciones Recientes</h3><button class="text-sm font-medium" style="color:var(--accent)" onclick="navigateTo(\'quotes\')">Ver todas <i class="fas fa-arrow-right ml-1"></i></button></div><div class="rounded-xl overflow-hidden" style="background:var(--card);border:1px solid var(--border)"><div class="overflow-x-auto"><table class="quote-table"><thead><tr><th>Nro</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Estado</th></tr></thead><tbody>' +
    recentQuotes +
    "</tbody></table></div></div></div>" +
    "</div>" +
    '<div class="mt-8 p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4" style="background:linear-gradient(135deg,rgba(200,149,108,0.08),rgba(200,149,108,0.02));border:1px solid var(--border)"><div><h3 class="text-lg font-bold mb-1">Listo para tu próxima reunión</h3><p class="text-sm" style="color:var(--muted)">Abre el catálogo en modo presentación y genera cotizaciones en tiempo real.</p></div><button class="btn-primary" onclick="navigateTo(\'catalog\')"><i class="fas fa-play"></i> Abrir Catálogo</button></div>' +
    "</div>"
  );
}

/* ---------- CATÁLOGO ---------- */
function renderCatalog() {
  var filtered = APP.products.filter(function (p) {
    var matchCat = APP.activeCat === "all" || p.categoria === APP.activeCat;
    var s = APP.search.toLowerCase();
    var matchSearch =
      !s ||
      p.nombre.toLowerCase().indexOf(s) !== -1 ||
      p.descripcion.toLowerCase().indexOf(s) !== -1;
    return matchCat && matchSearch;
  });

  var catFilters =
    '<button class="cat-filter ' +
    (APP.activeCat === "all" ? "active" : "") +
    '" onclick="filterCat(\'all\')">Todos</button>';
  CATEGORIAS.forEach(function (c) {
    catFilters +=
      '<button class="cat-filter ' +
      (APP.activeCat === c.id ? "active" : "") +
      '" onclick="filterCat(\'' +
      c.id +
      '\')"><i class="fas ' +
      c.icon +
      ' mr-1"></i>' +
      c.nombre
        .replace("Acabados para ", "")
        .replace("Mármol para Cocina", "Mármol") +
      "</button>";
  });

  var cards = "";
  if (filtered.length) {
    filtered.forEach(function (p, i) {
      var cat = CATEGORIAS.find(function (c) {
        return c.id === p.categoria;
      });
      var inCart = APP.cart.find(function (c) {
        return c.id === p.id;
      });
      var tieneVariantes = (p.variantes || []).length > 0;
      var disponible = productoDisponible(p);
      // El precio NO se muestra en la tarjeta — vive en cada variante (o en el detalle si no hay variantes).
      var clickHandler = tieneVariantes
        ? "showVariantesPicker"
        : "showProductDetail";
      var addHandler = tieneVariantes
        ? "showVariantesPicker('" + esc(p.id) + "')"
        : "showProductDetail('" + esc(p.id) + "')";
      var iconoAdd = tieneVariantes
        ? "fa-layer-group"
        : inCart
          ? "fa-check"
          : "fa-eye";
      var ctaTexto = tieneVariantes
        ? '<i class="fas fa-layer-group mr-1"></i>' +
          p.variantes.length +
          " opcion" +
          (p.variantes.length === 1 ? "" : "es")
        : '<i class="fas fa-eye mr-1"></i>Ver detalle';
      cards +=
        '<div class="product-card" style="animation-delay:' +
        i * 0.06 +
        's" onclick="' +
        clickHandler +
        "('" +
        esc(p.id) +
        "')\">" +
        '<div class="img-wrap">' +
        '<img src="' +
        escUrl(p.imagen) +
        '" alt="' +
        esc(p.nombre) +
        '" loading="lazy" onerror="this.src=\'https://picsum.photos/seed/' +
        encodeURIComponent(p.id) +
        "/600/400'\">" +
        '<span class="cat-badge">' +
        esc(cat ? cat.nombre : p.categoria) +
        "</span>" +
        (!disponible
          ? '<span class="absolute top-12 right-12 px-2 py-1 rounded-md text-xs font-semibold" style="background:rgba(199,92,92,0.2);color:var(--danger)">Agotado</span>'
          : "") +
        '<button class="add-btn" onclick="event.stopPropagation();' +
        addHandler +
        '" title="' +
        (tieneVariantes ? "Elegir variantes" : "Ver detalle") +
        '" ' +
        (!disponible
          ? 'disabled style="opacity:0.3;cursor:not-allowed;transform:scale(1)"'
          : "") +
        '><i class="fas ' +
        iconoAdd +
        '"></i></button>' +
        "</div>" +
        '<div class="p-4">' +
        '<h4 class="font-semibold text-sm mb-1 leading-tight">' +
        esc(p.nombre) +
        "</h4>" +
        '<p class="text-xs mb-3" style="color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' +
        esc(p.descripcion) +
        "</p>" +
        '<div class="flex items-center justify-between">' +
        '<span class="text-xs px-2 py-1 rounded-md font-medium" style="background:var(--accent-glow);color:var(--accent)">' +
        ctaTexto +
        "</span>" +
        "</div>" +
        "</div></div>";
    });
  } else {
    cards =
      '<div class="col-span-full text-center py-20"><i class="fas fa-search text-4xl mb-4" style="color:var(--muted)"></i><p class="text-lg" style="color:var(--muted)">No se encontraron productos</p></div>';
  }

  return (
    '<div class="max-w-7xl mx-auto">' +
    '<div class="mb-6">' +
    '<div class="relative mb-4"><i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2" style="color:var(--muted)"></i><input type="text" class="input-field pl-12" placeholder="Buscar acabados por nombre o descripción..." value="' +
    APP.search +
    '" oninput="handleSearch(this.value)" id="catalog-search">' +
    (APP.search
      ? '<button onclick="handleSearch(\'\')" class="absolute right-4 top-1/2 -translate-y-1/2" style="color:var(--muted);background:none;border:none;cursor:pointer"><i class="fas fa-xmark"></i></button>'
      : "") +
    "</div>" +
    '<div class="flex gap-2 overflow-x-auto pb-2" style="-webkit-overflow-scrolling:touch">' +
    catFilters +
    "</div>" +
    "</div>" +
    '<div class="flex items-center justify-between mb-4"><p class="text-sm" style="color:var(--muted)">' +
    filtered.length +
    " producto" +
    (filtered.length !== 1 ? "s" : "") +
    " encontrado" +
    (filtered.length !== 1 ? "s" : "") +
    '</p><button onclick="startTour()" class="btn-secondary text-xs"><i class="fas fa-route"></i> Tour Guiado</button></div>' +
    '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">' +
    cards +
    "</div></div>"
  );
}

function handleSearch(val) {
  APP.search = val;
  renderPage();
}
function filterCat(id) {
  APP.activeCat = id;
  renderPage();
}

/* ---------- DETALLE PRODUCTO ---------- */
function showProductDetail(id) {
  var p = APP.products.find(function (pr) {
    return pr.id === id;
  });
  if (!p) return;
  var cat = CATEGORIAS.find(function (c) {
    return c.id === p.categoria;
  });
  var inCart = APP.cart.find(function (c) {
    return c.id === p.id;
  });
  document.getElementById("modal-body").innerHTML =
    '<div class="relative"><img src="' +
    escUrl(p.imagen) +
    '" alt="' +
    esc(p.nombre) +
    '" class="w-full h-64 md:h-80 object-cover rounded-t-2xl" onerror="this.src=\'https://picsum.photos/seed/' +
    encodeURIComponent(p.id) +
    "/800/500'\">" +
    '<button onclick="closeModal()" class="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center" style="background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);color:#fff;border:none;cursor:pointer"><i class="fas fa-xmark"></i></button>' +
    '<span class="absolute bottom-4 left-4 px-3 py-1 rounded-lg text-xs font-semibold" style="background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);color:' +
    (cat ? cat.color : "var(--accent)") +
    '"><i class="fas ' +
    (cat ? cat.icon : "fa-tag") +
    ' mr-1"></i>' +
    esc(cat ? cat.nombre : p.categoria) +
    "</span></div>" +
    '<div class="p-6 md:p-8">' +
    '<div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6"><div><h2 class="text-2xl font-bold mb-2">' +
    esc(p.nombre) +
    '</h2><p class="text-sm" style="color:var(--muted)">Proveedor: ' +
    esc(p.proveedor) +
    " &middot; Actualizado: " +
    esc(p.fechaActualizacion) +
    '</p></div><div class="text-right"><p class="text-3xl font-bold" style="color:var(--accent)">' +
    formatMoney(p.precio, p.moneda) +
    '</p><p class="text-sm" style="color:var(--muted)">por ' +
    esc(p.unidad) +
    "</p></div></div>" +
    '<p class="mb-6 leading-relaxed" style="color:var(--fg2)">' +
    esc(p.descripcion) +
    "</p>" +
    '<div class="flex flex-wrap gap-3 mb-6"><span class="px-3 py-1.5 rounded-lg text-xs font-medium" style="background:' +
    (p.stock_disponible
      ? "rgba(107,159,120,0.12);color:var(--success)"
      : "rgba(199,92,92,0.12);color:var(--danger)") +
    '"><i class="fas ' +
    (p.stock_disponible ? "fa-circle-check" : "fa-circle-xmark") +
    ' mr-1"></i>' +
    (p.stock_disponible ? "Disponible" : "Agotado") +
    '</span><span class="px-3 py-1.5 rounded-lg text-xs font-medium" style="background:var(--card);color:var(--muted)">' +
    esc(p.unidad) +
    "</span></div>" +
    '<div class="flex gap-3"><button class="btn-primary flex-1 justify-center" onclick="addToCart(\'' +
    esc(p.id) +
    "');closeModal()\" " +
    (!p.stock_disponible ? "disabled" : "") +
    '><i class="fas ' +
    (inCart ? "fa-check" : "fa-plus") +
    '"></i> ' +
    (inCart ? "Ya en cotización" : "Agregar a Cotización") +
    '</button><button class="btn-secondary" onclick="closeModal()">Cerrar</button></div>' +
    "</div>";
  openModal();
}

// =====================================================================
// PICKER DE VARIANTES (catálogo)
// Modal con checkboxes — el usuario elige una, varias o todas.
// =====================================================================
function showVariantesPicker(productoId) {
  var p = APP.products.find(function (pr) {
    return pr.id === productoId;
  });
  if (!p || !p.variantes || !p.variantes.length) {
    // Sin variantes: comportamiento normal
    showProductDetail(productoId);
    return;
  }
  var cat = CATEGORIAS.find(function (c) {
    return c.id === p.categoria;
  });
  var imgFallback =
    "https://picsum.photos/seed/" + encodeURIComponent(p.id) + "/600/400";

  var filas = p.variantes
    .map(function (v) {
      var enCarrito = APP.cart.some(function (c) {
        return c.parentId === p.id && c.id === v.id;
      });
      var vImgFallback =
        "https://picsum.photos/seed/" + encodeURIComponent(v.id) + "/200/200";
      var checked = enCarrito ? "checked disabled" : "";
      var disabledRow = !v.stock_disponible || enCarrito;
      var precioMon = v.moneda || p.moneda || "PEN";

      // Meta línea bajo el precio: tamaño y unidades por paquete (solo si existen).
      var meta = [];
      if (v.ancho && v.largo)
        meta.push(
          '<span><i class="fas fa-ruler-combined mr-1"></i>' +
            Number(v.ancho) +
            "×" +
            Number(v.largo) +
            " cm</span>",
        );
      if (v.unidadesPorPaquete)
        meta.push(
          '<span><i class="fas fa-box mr-1"></i>' +
            Number(v.unidadesPorPaquete) +
            " u/caja</span>",
        );
      var metaHtml = meta.length
        ? '<p class="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-0.5" style="color:var(--muted)">' +
          meta.join("") +
          "</p>"
        : "";

      return (
        '<label class="flex items-start gap-3 p-3 rounded-xl mb-2" style="background:var(--card);border:1px solid var(--border);cursor:' +
        (disabledRow ? "not-allowed" : "pointer") +
        ";opacity:" +
        (disabledRow && !enCarrito ? "0.5" : "1") +
        '">' +
        '<input type="checkbox" class="variante-check mt-1" data-vid="' +
        esc(v.id) +
        '" ' +
        checked +
        " " +
        (!v.stock_disponible ? "disabled" : "") +
        ' style="accent-color:var(--accent);width:18px;height:18px;flex-shrink:0">' +
        '<img src="' +
        escUrl(v.imagen || p.imagen) +
        '" class="w-16 h-16 rounded-lg object-cover flex-shrink-0" onerror="this.src=\'' +
        vImgFallback +
        "'\">" +
        '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center justify-between gap-2 mb-1"><p class="text-sm font-semibold">' +
        esc(v.nombre) +
        (enCarrito
          ? ' <span class="text-xs" style="color:var(--success)">(ya en carrito)</span>'
          : "") +
        '</p><p class="text-sm font-bold whitespace-nowrap" style="color:var(--accent)">' +
        formatMoney(v.precio, precioMon) +
        "</p></div>" +
        metaHtml +
        (v.descripcion
          ? '<p class="text-xs mt-1" style="color:var(--muted)">' +
            esc(v.descripcion) +
            "</p>"
          : "") +
        (!v.stock_disponible
          ? '<p class="text-xs mt-1" style="color:var(--danger)"><i class="fas fa-circle-xmark"></i> Agotado</p>'
          : "") +
        "</div>" +
        "</label>"
      );
    })
    .join("");

  document.getElementById("modal-body").innerHTML =
    '<div class="relative"><img src="' +
    escUrl(p.imagen) +
    '" alt="' +
    esc(p.nombre) +
    '" class="w-full h-40 md:h-48 object-cover rounded-t-2xl" onerror="this.src=\'' +
    imgFallback +
    "'\">" +
    '<button onclick="closeModal()" class="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center" style="background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);color:#fff;border:none;cursor:pointer"><i class="fas fa-xmark"></i></button>' +
    '<span class="absolute bottom-3 left-4 px-3 py-1 rounded-lg text-xs font-semibold" style="background:rgba(0,0,0,0.7);color:' +
    (cat ? cat.color : "var(--accent)") +
    '"><i class="fas ' +
    (cat ? cat.icon : "fa-tag") +
    ' mr-1"></i>' +
    esc(cat ? cat.nombre : p.categoria) +
    "</span></div>" +
    '<div class="p-6 md:p-8">' +
    '<h2 class="text-xl font-bold mb-1">' +
    esc(p.nombre) +
    "</h2>" +
    '<p class="text-sm mb-4" style="color:var(--muted)">Elige una o varias opciones para agregarlas al carrito.</p>' +
    '<div class="mb-4">' +
    filas +
    "</div>" +
    '<div class="flex gap-3">' +
    '<button class="btn-primary flex-1 justify-center" onclick="addVariantesAlCarrito(\'' +
    esc(p.id) +
    '\')"><i class="fas fa-cart-plus"></i> Agregar selección</button>' +
    '<button class="btn-secondary" onclick="closeModal()">Cerrar</button>' +
    "</div>" +
    "</div>";
  openModal();
}

function addVariantesAlCarrito(productoId) {
  var p = APP.products.find(function (pr) {
    return pr.id === productoId;
  });
  if (!p) return;
  var checks = document.querySelectorAll(
    ".variante-check:checked:not(:disabled)",
  );
  if (!checks.length) {
    toast("Selecciona al menos una variante", "error");
    return;
  }
  var agregadas = 0;
  checks.forEach(function (chk) {
    var vid = chk.getAttribute("data-vid");
    var v = (p.variantes || []).find(function (x) {
      return x.id === vid;
    });
    if (!v || !v.stock_disponible) return;
    var yaEsta = APP.cart.some(function (c) {
      return c.parentId === p.id && c.id === v.id;
    });
    if (yaEsta) return;
    APP.cart.push({
      id: v.id,
      parentId: p.id,
      cantidad: 1,
      precioUnitario: v.precio,
      moneda: v.moneda || p.moneda || "PEN",
    });
    agregadas++;
  });
  updateCartBadge();
  closeModal();
  if (APP.page === "catalog") renderPage();
  if (agregadas) toast(agregadas + " variante(s) agregada(s)", "success");
}

/* ---------- COTIZACIONES ---------- */
function renderQuotes() {
  if (!APP.quotes.length)
    return '<div class="max-w-2xl mx-auto text-center py-20"><i class="fas fa-file-invoice text-5xl mb-4" style="color:var(--muted)"></i><h2 class="text-2xl font-bold mb-2">Sin cotizaciones</h2><p class="mb-6" style="color:var(--muted)">Agrega productos al carrito desde el catálogo para crear tu primera cotización.</p><button class="btn-primary" onclick="navigateTo(\'catalog\')"><i class="fas fa-swatchbook"></i> Ir al Catálogo</button></div>';
  var rows = APP.quotes
    .slice()
    .reverse()
    .map(function (q) {
      var estadoColor =
        q.estado === "enviada"
          ? "rgba(107,159,120,0.15);color:var(--success)"
          : q.estado === "borrador"
            ? "rgba(212,168,67,0.15);color:var(--warning)"
            : "rgba(200,149,108,0.15);color:var(--accent)";
      return (
        '<tr><td class="font-mono font-semibold" style="color:var(--accent)">COT-' +
        String(q.numero).padStart(4, "0") +
        '</td><td class="font-medium">' +
        esc(q.cliente) +
        '</td><td class="text-sm" style="color:var(--muted)">' +
        esc(q.fecha) +
        '</td><td class="text-sm" style="color:var(--muted)">' +
        q.items.length +
        ' items</td><td class="font-bold">' +
        formatMoney(q.total, q.moneda || "PEN") +
        '</td><td><span class="px-2 py-1 rounded-md text-xs font-semibold" style="background:' +
        estadoColor +
        '">' +
        esc(q.estado) +
        '</span></td><td><div class="flex gap-1"><button onclick="viewQuote(\'' +
        esc(q.id) +
        '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:var(--card);color:var(--fg2);border:1px solid var(--border);cursor:pointer" title="Ver"><i class="fas fa-eye"></i></button><button onclick="generatePDF(\'' +
        esc(q.id) +
        '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:var(--card);color:var(--accent);border:1px solid var(--border);cursor:pointer" title="PDF"><i class="fas fa-file-pdf"></i></button><button onclick="deleteQuote(\'' +
        esc(q.id) +
        '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:rgba(199,92,92,0.08);color:var(--danger);border:1px solid rgba(199,92,92,0.15);cursor:pointer" title="Eliminar"><i class="fas fa-trash"></i></button></div></td></tr>'
      );
    })
    .join("");
  return (
    '<div class="max-w-7xl mx-auto"><div class="flex items-center justify-between mb-6"><div><h1 class="text-2xl font-bold">Historial de Cotizaciones</h1><p class="text-sm mt-1" style="color:var(--muted)">' +
    APP.quotes.length +
    ' cotización(es) registrada(s)</p></div></div><div class="rounded-xl overflow-hidden" style="background:var(--card);border:1px solid var(--border)"><div class="overflow-x-auto"><table class="quote-table"><thead><tr><th>Nro</th><th>Cliente</th><th>Fecha</th><th>Items</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' +
    rows +
    "</tbody></table></div></div></div>"
  );
}

function viewQuote(id) {
  var q = APP.quotes.find(function (qu) {
    return qu.id === id;
  });
  if (!q) return;
  var moneda = q.moneda || "PEN";
  var items = q.items
    .map(function (item) {
      // Preferir el snapshot guardado al crear la cotización; fallback al producto/variante actual.
      var p = APP.products.find(function (pr) {
        return pr.id === item.productoId;
      });
      var nombre = item.productoNombre || (p ? p.nombre : "Producto eliminado");
      var unidad = item.productoUnidad || (p ? p.unidad : "");
      return (
        '<tr><td class="text-sm">' +
        esc(nombre) +
        '</td><td class="text-sm" style="color:var(--muted)">' +
        esc(item.cantidad) +
        (unidad ? " " + esc(unidad) : "") +
        '</td><td class="text-sm">' +
        formatMoney(item.precioUnitario, moneda) +
        '</td><td class="font-semibold text-sm">' +
        formatMoney(item.subtotal, moneda) +
        "</td></tr>"
      );
    })
    .join("");
  var qSub = q.total / 1.18;
  var qIgv = q.total - qSub;
  var estadoColor =
    q.estado === "enviada"
      ? "rgba(107,159,120,0.15);color:var(--success)"
      : "rgba(212,168,67,0.15);color:var(--warning)";
  var tcInfo = q.tipoCambio
    ? '<p class="text-xs" style="color:var(--muted)">Moneda: ' +
      esc(moneda) +
      " &middot; TC: " +
      Number(q.tipoCambio).toFixed(4) +
      "</p>"
    : "";
  document.getElementById("modal-body").innerHTML =
    '<div class="p-6 md:p-8"><div class="flex items-center justify-between mb-6"><div><h2 class="text-2xl font-bold">COT-' +
    String(q.numero).padStart(4, "0") +
    '</h2><p class="text-sm mt-1" style="color:var(--muted)">' +
    esc(q.fecha) +
    " &middot; " +
    esc(q.cliente) +
    "</p>" +
    tcInfo +
    '</div><span class="px-3 py-1 rounded-lg text-xs font-semibold" style="background:' +
    estadoColor +
    '">' +
    esc(q.estado) +
    "</span></div>" +
    '<div class="rounded-xl overflow-hidden mb-6" style="background:var(--card);border:1px solid var(--border)">' +
    '<table class="quote-table">' +
    "<thead><tr><th>Producto</th><th>Cantidad</th><th>P. Unitario</th><th>Subtotal</th></tr></thead>" +
    "<tbody>" +
    items +
    "</tbody>" +
    "<tfoot>" +
    '<tr><td colspan="3" class="text-right text-xs font-semibold pt-4" style="color:var(--muted);border-top:1px solid var(--border)">SUBTOTAL (Base Imponible)</td><td class="text-sm font-semibold pt-4" style="color:var(--fg);border-top:1px solid var(--border)">' +
    formatMoney(qSub, moneda) +
    "</td></tr>" +
    '<tr><td colspan="3" class="text-right text-xs font-semibold pt-1" style="color:var(--muted)">IGV (18%)</td><td class="text-sm font-semibold pt-1" style="color:var(--fg)">' +
    formatMoney(qIgv, moneda) +
    "</td></tr>" +
    '<tr><td colspan="3" class="text-right font-bold text-base pt-2" style="border-top:1px solid rgba(255,255,255,0.08)">TOTAL</td><td class="font-bold text-lg pt-2" style="color:var(--accent);border-top:1px solid rgba(255,255,255,0.08)">' +
    formatMoney(q.total, moneda) +
    "</td></tr>" +
    "</tfoot>" +
    "</table>" +
    "</div>" +
    (q.notas
      ? '<div class="mb-6 p-4 rounded-xl" style="background:var(--card);border:1px solid var(--border)"><p class="text-xs font-semibold uppercase mb-1" style="color:var(--muted)">Notas</p><p class="text-sm" style="white-space:pre-wrap">' +
        esc(q.notas) +
        "</p></div>"
      : "") +
    '<div class="flex gap-3"><button class="btn-primary" onclick="generatePDF(\'' +
    esc(q.id) +
    '\');closeModal()"><i class="fas fa-file-pdf"></i> Descargar PDF</button><button class="btn-secondary" onclick="closeModal()">Cerrar</button></div></div>';
  openModal();
}

function deleteQuote(id) {
  document.getElementById("modal-body").innerHTML =
    '<div class="p-8 text-center"><div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style="background:rgba(199,92,92,0.12)"><i class="fas fa-trash text-2xl" style="color:var(--danger)"></i></div><h3 class="text-xl font-bold mb-2">Eliminar Cotización</h3><p class="mb-6" style="color:var(--muted)">Esta acción no se puede deshacer.</p><div class="flex gap-3 justify-center"><button class="btn-danger" onclick="confirmDeleteQuote(\'' +
    id +
    '\')"><i class="fas fa-trash"></i> Eliminar</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div></div>';
  openModal();
}
async function confirmDeleteQuote(id) {
  try {
    // Primero elimina los items
    const { error: itemsError } = await supabaseClient
      .from("cotizacion_items")
      .delete()
      .eq("cotizacion_id", id);

    if (itemsError) throw itemsError;

    // Luego elimina la cotización
    const { error } = await supabaseClient
      .from("cotizaciones")
      .delete()
      .eq("id", id);

    if (error) throw error;

    APP.quotes = await getCotizaciones();

    closeModal();

    renderPage();

    toast("Cotización eliminada", "success");
  } catch (error) {
    console.error(error);

    toast("Error al eliminar cotización: " + error.message, "error");
  }
}

// Admin
function renderAdmin() {
  var rows = APP.products
    .map(function (p) {
      var cat = CATEGORIAS.find(function (c) {
        return c.id === p.categoria;
      });
      var nVar = (p.variantes || []).length;
      // El precio vive en cada variante. Aquí solo mostramos cuántas hay.
      var varCol = nVar
        ? '<span class="text-sm font-semibold" style="color:var(--accent)">' +
          nVar +
          " opcion" +
          (nVar === 1 ? "" : "es") +
          "</span>"
        : '<span class="text-xs" style="color:var(--muted)"><i class="fas fa-circle-exclamation mr-1"></i>Sin variantes</span>';
      var detallesBtn =
        "<button onclick=\"editVariantes('" +
        esc(p.id) +
        '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:var(--card);color:var(--accent);border:1px solid var(--border);cursor:pointer" title="Aplicar detalles / variantes"><i class="fas fa-list-ul"></i></button>';
      return (
        '<tr><td><div class="flex items-center gap-3"><img src="' +
        escUrl(p.imagen) +
        '" class="w-10 h-10 rounded-lg object-cover" onerror="this.src=\'https://picsum.photos/seed/' +
        encodeURIComponent(p.id) +
        '/100/100\'"><span class="text-sm font-medium">' +
        esc(p.nombre) +
        '</span></div></td><td class="text-xs" style="color:' +
        (cat ? cat.color : "var(--muted)") +
        '">' +
        esc(cat ? cat.nombre : p.categoria) +
        "</td><td>" +
        varCol +
        '</td><td><span class="px-2 py-1 rounded-md text-xs font-semibold" style="background:' +
        (productoDisponible(p)
          ? "rgba(107,159,120,0.12);color:var(--success)"
          : "rgba(199,92,92,0.12);color:var(--danger)") +
        '">' +
        (productoDisponible(p) ? "Sí" : "No") +
        '</span></td><td><div class="flex gap-1"><button onclick="editProduct(\'' +
        esc(p.id) +
        '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:var(--card);color:var(--accent);border:1px solid var(--border);cursor:pointer" title="Editar"><i class="fas fa-pen"></i></button>' +
        detallesBtn +
        "<button onclick=\"deleteProduct('" +
        esc(p.id) +
        '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:rgba(199,92,92,0.08);color:var(--danger);border:1px solid rgba(199,92,92,0.15);cursor:pointer" title="Eliminar"><i class="fas fa-trash"></i></button></div></td></tr>'
      );
    })
    .join("");
  return (
    '<div class="max-w-7xl mx-auto"><div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6"><div><h1 class="text-2xl font-bold">Administrar Productos</h1><p class="text-sm mt-1" style="color:var(--muted)">' +
    APP.products.length +
    ' productos en el catálogo · El precio se define en cada variante.</p></div><button class="btn-primary" onclick="editProduct(null)"><i class="fas fa-plus"></i> Nuevo Producto</button></div><div class="rounded-xl overflow-hidden" style="background:var(--card);border:1px solid var(--border)"><div class="overflow-x-auto"><table class="quote-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Variantes</th><th>Stock</th><th>Acciones</th></tr></thead><tbody>' +
    rows +
    "</tbody></table></div></div></div>"
  );
}

function editProduct(id) {
  var p = id
    ? APP.products.find(function (pr) {
        return pr.id === id;
      })
    : null;
  var isEdit = !!p;
  var catOptions = CATEGORIAS.map(function (c) {
    return (
      '<option value="' +
      c.id +
      '" ' +
      (p && p.categoria === c.id ? "selected" : "") +
      ">" +
      c.nombre +
      "</option>"
    );
  }).join("");

  // Sección de variantes inline (solo al editar — para "Nuevo" hay que guardar primero).
  var variantesSection;
  if (isEdit) {
    var pVar = p.variantes || [];
    var lista = pVar.length
      ? pVar
          .map(function (v) {
            var imgFallback =
              "https://picsum.photos/seed/" +
              encodeURIComponent(v.id) +
              "/60/60";
            return (
              '<div class="flex items-center gap-3 p-2 rounded-lg mb-2" style="background:var(--bg2);border:1px solid var(--border)">' +
              '<img src="' +
              escUrl(v.imagen || p.imagen) +
              '" class="w-10 h-10 rounded-lg object-cover flex-shrink-0" onerror="this.src=\'' +
              imgFallback +
              "'\">" +
              '<div class="flex-1 min-w-0"><p class="text-sm font-semibold truncate">' +
              esc(v.nombre) +
              '</p><p class="text-xs" style="color:var(--muted)">' +
              formatMoney(v.precio, v.moneda || p.moneda) +
              " · " +
              (v.stock_disponible
                ? "Disponible"
                : '<span style="color:var(--danger)">Agotado</span>') +
              "</p></div>" +
              '<div class="flex gap-1 flex-shrink-0">' +
              "<button onclick=\"editVariante('" +
              esc(p.id) +
              "','" +
              esc(v.id) +
              '\',\'editProduct\')" class="w-8 h-8 rounded flex items-center justify-center text-xs" style="background:var(--card);color:var(--accent);border:1px solid var(--border);cursor:pointer" title="Editar"><i class="fas fa-pen"></i></button>' +
              "<button onclick=\"deleteVariante('" +
              esc(p.id) +
              "','" +
              esc(v.id) +
              '\',\'editProduct\')" class="w-8 h-8 rounded flex items-center justify-center text-xs" style="background:rgba(199,92,92,0.08);color:var(--danger);border:1px solid rgba(199,92,92,0.15);cursor:pointer" title="Eliminar"><i class="fas fa-trash"></i></button>' +
              "</div>" +
              "</div>"
            );
          })
          .join("")
      : '<p class="text-xs text-center py-3" style="color:var(--muted)">Sin variantes aún. Añade la primera para que el catálogo muestre opciones con precios.</p>';
    variantesSection =
      '<div class="mt-6 pt-6" style="border-top:1px solid var(--border)">' +
      '<div class="flex items-center justify-between mb-3">' +
      '<h3 class="text-sm font-bold uppercase tracking-wider" style="color:var(--muted)"><i class="fas fa-list-ul mr-2"></i>Variantes / Detalles</h3>' +
      '<span class="text-xs" style="color:var(--muted)">' +
      pVar.length +
      " opcion" +
      (pVar.length === 1 ? "" : "es") +
      "</span>" +
      "</div>" +
      lista +
      '<button class="btn-secondary w-full justify-center mt-2" onclick="editVariante(\'' +
      esc(p.id) +
      "',null,'editProduct')\"><i class=\"fas fa-plus\"></i> Nueva Variante</button>" +
      "</div>";
  } else {
    variantesSection =
      '<div class="mt-6 pt-6" style="border-top:1px solid var(--border)">' +
      '<p class="text-xs text-center" style="color:var(--muted)"><i class="fas fa-info-circle mr-1"></i>Guarda el producto primero para añadir variantes.</p>' +
      "</div>";
  }

  document.getElementById("modal-body").innerHTML =
    '<div class="p-6 md:p-8"><h2 class="text-xl font-bold mb-6">' +
    (isEdit ? "Editar" : "Nuevo") +
    ' Producto</h2><div class="space-y-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Nombre</label><input type="text" id="prod-nombre" class="input-field" maxlength="200" value="' +
    esc(p ? p.nombre : "") +
    '"></div>' +
    '<div class="grid grid-cols-2 gap-4"><div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Categoría</label><select id="prod-cat" class="input-field">' +
    catOptions +
    '</select></div><div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Unidad</label><input type="text" id="prod-unidad" class="input-field" maxlength="30" value="' +
    esc(p ? p.unidad : "unidad") +
    '" placeholder="m², unidad, ml..."></div></div>' +
    '<div class="grid grid-cols-3 gap-4"><div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Precio base</label><input type="number" id="prod-precio" class="input-field" step="0.01" min="0" max="9999999" value="' +
    (p ? Number(p.precio) : "") +
    '"></div><div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Moneda</label><select id="prod-moneda" class="input-field"><option value="PEN" ' +
    (!p || p.moneda !== "USD" ? "selected" : "") +
    '>S/. Soles</option><option value="USD" ' +
    (p && p.moneda === "USD" ? "selected" : "") +
    '>US$ Dólares</option></select></div><div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Stock</label><select id="prod-stock" class="input-field"><option value="true" '+
    (p && p.stock_disponible ? 'selected' : '') +'>Disponible</option><option value="false" '+
    (p && p.stock_disponible === false ? 'selected' : '') +
    '>Agotado</option></select></div></div>' 
    +
    '<p class="text-xs" style="color:var(--muted)"><i class="fas fa-info-circle mr-1"></i>El precio base aplica cuando el producto no tiene variantes. Si añades variantes, cada una usa su propio precio.</p>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">URL de Imagen</label><input type="url" id="prod-imagen" class="input-field" maxlength="2000" value="' +
    esc(p ? p.imagen : "") +
    '" placeholder="https://..."></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Proveedor</label><input type="text" id="prod-proveedor" class="input-field" maxlength="100" value="' +
    esc(p ? p.proveedor : "") +
    '"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Descripción</label><textarea id="prod-desc" class="input-field" rows="3" maxlength="1000" style="resize:vertical">' +
    esc(p ? p.descripcion : "") +
    "</textarea></div>" +
    "</div>" +
    variantesSection +
    '<div class="flex gap-3 mt-6"><button class="btn-primary flex-1 justify-center" onclick="saveProduct(\'' +
    esc(id || "") +
    '\')"><i class="fas fa-save"></i> ' +
    (isEdit ? "Guardar Cambios" : "Crear Producto") +
    '</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div>' +
    "</div>";
  openModal();
}

async function saveProduct(id) {
  var nombre = trimMax(
    document.getElementById("prod-nombre").value,
    VALID.maxLen.nombre,
  );
  var categoria = document.getElementById("prod-cat").value;
  var unidad =
    trimMax(
      document.getElementById("prod-unidad").value,
      VALID.maxLen.unidad,
    ) || "unidad";
  var precio = parseFloat(document.getElementById("prod-precio").value);
  var moneda =
    document.getElementById("prod-moneda").value === "USD" ? "USD" : "PEN";
  var stock = document.getElementById("prod-stock").value === "true";
  var imagenRaw = document.getElementById("prod-imagen").value.trim();
  var proveedor = trimMax(
    document.getElementById("prod-proveedor").value,
    VALID.maxLen.proveedor,
  );
  var descripcion = trimMax(
    document.getElementById("prod-desc").value,
    VALID.maxLen.descripcion,
  );

  // Validaciones
  if (!nombre) {
    toast("El nombre es obligatorio", "error");
    return;
  }
  if (
    !CATEGORIAS.some(function (c) {
      return c.id === categoria;
    })
  ) {
    toast("Categoría inválida", "error");
    return;
  }
  if (isNaN(precio) || precio < 0 || precio > 9999999) {
    toast("Precio fuera de rango (0 a 9,999,999)", "error");
    return;
  }
  // URL: bloquear esquemas peligrosos; default a placeholder si no hay
  var imagen = imagenRaw
    ? /^(https?:\/\/|\/|\.)/i.test(imagenRaw)
      ? imagenRaw.substring(0, 2000)
      : ""
    : "";
  if (imagenRaw && !imagen) {
    toast("La URL de imagen debe empezar con http(s)://", "error");
    return;
  }
  if (!imagen)
    imagen =
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80";

  var today = new Date().toISOString().split("T")[0];

  const producto = {
    nombre,
    categoria_id: categoria,
    descripcion,
    precio,
    moneda,
    imagen: imagen,
    stock_disponible: stock,
    unidad,
    proveedor_id: null,
  };

  try {
    if (id) {
      const { error } = await supabaseClient
        .from("productos")
        .update(producto)
        .eq("id", id);

      if (error) throw error;

      toast("Producto actualizado", "success");
    } else {
      const { error } = await supabaseClient
        .from("productos")
        .insert([producto]);

      if (error) throw error;

      toast("Producto creado", "success");
    }

    APP.products = await getProductos();

    closeModal();
    renderPage();
  } catch (error) {
    console.error(error);

    toast("Error al guardar producto: " + error.message, "error");
  }
}

function deleteProduct(id) {
  document.getElementById("modal-body").innerHTML =
    '<div class="p-8 text-center"><div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style="background:rgba(199,92,92,0.12)"><i class="fas fa-trash text-2xl" style="color:var(--danger)"></i></div><h3 class="text-xl font-bold mb-2">Eliminar Producto</h3><p class="mb-6" style="color:var(--muted)">Se eliminará del catálogo.</p><div class="flex gap-3 justify-center"><button class="btn-danger" onclick="confirmDeleteProduct(\'' +
    id +
    '\')"><i class="fas fa-trash"></i> Eliminar</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div></div>';
  openModal();
}

async function confirmDeleteProduct(id) {
  try {
    const { error } = await supabaseClient
      .from("productos")
      .delete()
      .eq("id", id);

    if (error) throw error;

    APP.products = await getProductos();

    APP.cart = APP.cart.filter(function (c) {
      return c.id !== id && c.parentId !== id;
    });

    updateCartBadge();
    closeModal();
    renderPage();

    toast("Producto eliminado", "success");
  } catch (error) {
    console.error(error);

    toast("Error al eliminar: " + error.message, "error");
  }
}

// =====================================================================
// VARIANTES (detalles) de un producto
// Ejemplo: producto "Mármol" con variantes "Negro" y "Blanco", cada una
// con su propio precio, imagen y descripción.
// =====================================================================

// Modal principal: lista todas las variantes del producto + alta/edición.
function editVariantes(productoId) {
  var p = APP.products.find(function (pr) {
    return pr.id === productoId;
  });
  if (!p) return;
  var variantes = p.variantes || [];
  var filas = variantes.length
    ? variantes
        .map(function (v) {
          var imgFallback =
            "https://picsum.photos/seed/" + encodeURIComponent(v.id) + "/80/80";
          return (
            '<div class="flex items-center gap-3 p-3 rounded-xl mb-2" style="background:var(--bg2);border:1px solid var(--border)">' +
            '<img src="' +
            escUrl(v.imagen || p.imagen) +
            '" class="w-12 h-12 rounded-lg object-cover" onerror="this.src=\'' +
            imgFallback +
            "'\">" +
            '<div class="flex-1 min-w-0">' +
            '<p class="text-sm font-semibold">' +
            esc(v.nombre) +
            "</p>" +
            '<p class="text-xs" style="color:var(--muted)">' +
            formatMoney(v.precio, v.moneda || p.moneda) +
            " · " +
            (v.stock_disponible
              ? "Disponible"
              : '<span style="color:var(--danger)">Agotado</span>') +
            "</p>" +
            "</div>" +
            '<div class="flex gap-1">' +
            "<button onclick=\"editVariante('" +
            esc(p.id) +
            "','" +
            esc(v.id) +
            '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:var(--card);color:var(--accent);border:1px solid var(--border);cursor:pointer" title="Editar"><i class="fas fa-pen"></i></button>' +
            "<button onclick=\"deleteVariante('" +
            esc(p.id) +
            "','" +
            esc(v.id) +
            '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:rgba(199,92,92,0.08);color:var(--danger);border:1px solid rgba(199,92,92,0.15);cursor:pointer" title="Eliminar"><i class="fas fa-trash"></i></button>' +
            "</div>" +
            "</div>"
          );
        })
        .join("")
    : '<p class="text-sm text-center py-6" style="color:var(--muted)">Sin variantes. Añade la primera para que el catálogo muestre opciones de este producto.</p>';

  document.getElementById("modal-body").innerHTML =
    '<div class="p-6 md:p-8">' +
    '<div class="flex items-start justify-between mb-2"><div>' +
    '<h2 class="text-xl font-bold">Detalles de "' +
    esc(p.nombre) +
    '"</h2>' +
    '<p class="text-sm" style="color:var(--muted)">Crea opciones (ej. Mármol Negro / Blanco) con precio e imagen independientes.</p>' +
    "</div></div>" +
    '<div class="mt-4 mb-4">' +
    filas +
    "</div>" +
    '<div class="flex gap-3"><button class="btn-primary flex-1 justify-center" onclick="editVariante(\'' +
    esc(p.id) +
    '\',null)"><i class="fas fa-plus"></i> Nueva Variante</button><button class="btn-secondary" onclick="closeModal()">Cerrar</button></div>' +
    "</div>";
  openModal();
}

// Formulario alta/edición de UNA variante.
// returnTo: 'editProduct' o 'editVariantes' (default) — decide a qué modal vuelve
// el usuario al guardar, cancelar o tras borrar.
function editVariante(productoId, varianteId, returnTo) {
  var p = APP.products.find(function (pr) {
    return pr.id === productoId;
  });
  if (!p) return;
  var ret = returnTo === "editProduct" ? "editProduct" : "editVariantes";
  var v = varianteId
    ? (p.variantes || []).find(function (x) {
        return x.id === varianteId;
      })
    : null;
  console.log(v);
  var isEdit = !!v;
  document.getElementById("modal-body").innerHTML =
    '<div class="p-6 md:p-8">' +
    '<h2 class="text-xl font-bold mb-2">' +
    (isEdit ? "Editar" : "Nueva") +
    " variante</h2>" +
    '<p class="text-sm mb-6" style="color:var(--muted)">de "' +
    esc(p.nombre) +
    '"</p>' +
    '<div class="space-y-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Nombre de la variante</label><input type="text" id="var-nombre" class="input-field" maxlength="100" placeholder="Ej. Negro, Blanco, 60x60..." value="' +
    esc(v ? v.nombre : "") +
    '"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Descripción / Detalle</label><textarea id="var-desc" class="input-field" rows="3" maxlength="1000" placeholder="Detalle específico de esta variante">' +
    esc(v ? v.descripcion || "" : "") +
    "</textarea></div>" +
    '<div class="grid grid-cols-3 gap-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Precio</label><input type="number" id="var-precio" class="input-field" step="0.01" min="0" max="9999999" value="' +
    (v ? Number(v.precio) : "") +
    '"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Moneda</label><select id="var-moneda" class="input-field"><option value="PEN" ' +
    (!v || v.moneda !== "USD" ? "selected" : "") +
    '>S/. Soles</option><option value="USD" ' +
    (v && v.moneda === "USD" ? "selected" : "") +
    ">US$ Dólares</option></select></div>" +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Stock</label><select id="var-stock" class="input-field"><option value="true" ' +
    (!v || v.stock_disponible ? "selected" : "") +
    '>Disponible</option><option value="false" ' +
    (v && !v.stock_disponible ? "selected" : "") +
    ">Agotado</option></select></div>" +
    "</div>" +
    '<div class="grid grid-cols-2 gap-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Ancho de pieza (cm)</label><input type="number" id="var-ancho" class="input-field" step="0.1" min="0" max="9999" value="' +
    (v && v.ancho_cm ? Number(v.ancho_cm) : "") +
    '" placeholder="ej. 60"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Largo de pieza (cm)</label><input type="number" id="var-largo" class="input-field" step="0.1" min="0" max="9999" value="' +
    (v && v.largo_cm ? Number(v.largo_cm) : "") +
    '" placeholder="ej. 60"></div>' +
    "</div>" +
    '<p class="text-xs" style="color:var(--muted)"><i class="fas fa-info-circle mr-1"></i>Dimensiones opcionales. Si las llenas, la calculadora podrá usar esta variante para estimar cobertura de superficies.</p>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Unidades por paquete (opcional)</label><input type="number" id="var-upp" class="input-field" step="1" min="1" max="9999" value="' +
    (v && v.unidades_por_paquete ? Number(v.unidades_por_paquete) : "") +
    '" placeholder="ej. 10 unidades por caja"></div>' +
    '<p class="text-xs" style="color:var(--muted)"><i class="fas fa-box mr-1"></i>Cuántas piezas trae cada paquete/caja. La calculadora mostrará cuántas cajas comprar.</p>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">URL de Imagen (opcional, usa la del producto si se deja vacío)</label><input type="url" id="var-imagen" class="input-field" maxlength="2000" placeholder="https://..." value="' +
    esc(v ? v.imagen || "" : "") +
    '"></div>' +
    "</div>" +
    '<div class="flex gap-3 mt-6">' +
    '<button class="btn-primary flex-1 justify-center" onclick="saveVariante(\'' +
    esc(p.id) +
    "','" +
    esc(varianteId || "") +
    "','" +
    esc(ret) +
    '\')"><i class="fas fa-save"></i> ' +
    (isEdit ? "Guardar Cambios" : "Crear Variante") +
    "</button>" +
    '<button class="btn-secondary" onclick="' +
    ret +
    "('" +
    esc(p.id) +
    '\')"><i class="fas fa-arrow-left"></i> Volver</button>' +
    "</div>" +
    "</div>";
  openModal();
  setTimeout(function () {
    var el = document.getElementById("var-nombre");
    if (el) el.focus();
  }, 200);
}

async function saveVariante(productoId, varianteId, returnTo) {
  var p = APP.products.find(function (pr) {
    return pr.id === productoId;
  });
  if (!p) return;
  if (!Array.isArray(p.variantes)) p.variantes = [];

  var nombre = trimMax(document.getElementById("var-nombre").value, 100);
  var descripcion = trimMax(
    document.getElementById("var-desc").value,
    VALID.maxLen.descripcion,
  );
  var precio = parseFloat(document.getElementById("var-precio").value);
  var moneda =
    document.getElementById("var-moneda").value === "USD" ? "USD" : "PEN";
  var stock = document.getElementById("var-stock").value === "true";
  var imagenRaw = document.getElementById("var-imagen").value.trim();
  var anchoRaw = document.getElementById("var-ancho").value;
  var largoRaw = document.getElementById("var-largo").value;
  var uppRaw = document.getElementById("var-upp").value;

  if (!nombre) {
    toast("El nombre de la variante es obligatorio", "error");
    return;
  }
  if (isNaN(precio) || precio < 0 || precio > 9999999) {
    toast("Precio fuera de rango", "error");
    return;
  }
  var imagen = imagenRaw
    ? /^(https?:\/\/|\/|\.)/i.test(imagenRaw)
      ? imagenRaw.substring(0, 2000)
      : ""
    : "";
  if (imagenRaw && !imagen) {
    toast("La URL de imagen debe empezar con http(s)://", "error");
    return;
  }

  // Dimensiones (opcionales). Si se llena una, se llenan ambas.
  var ancho = anchoRaw === "" ? null : parseFloat(anchoRaw);
  var largo = largoRaw === "" ? null : parseFloat(largoRaw);
  if ((ancho !== null) !== (largo !== null)) {
    toast("Completa ancho Y largo, o deja ambos vacíos", "error");
    return;
  }
  if (ancho !== null && (isNaN(ancho) || ancho <= 0 || ancho > 9999)) {
    toast("Ancho inválido (0 a 9999 cm)", "error");
    return;
  }
  if (largo !== null && (isNaN(largo) || largo <= 0 || largo > 9999)) {
    toast("Largo inválido (0 a 9999 cm)", "error");
    return;
  }

  // Unidades por paquete (entero ≥ 1; vacío = sin paquetes definidos)
  var upp = uppRaw === "" ? null : parseInt(uppRaw, 10);
  if (upp !== null && (isNaN(upp) || upp < 1 || upp > 9999)) {
    toast("Unidades por paquete fuera de rango (1 a 9999)", "error");
    return;
  }

  const variante = {
    producto_id: productoId,
    nombre,
    descripcion,
    precio,
    moneda,
    imagen,
    stock_disponible: stock,
    ancho_cm: ancho,
    largo_cm: largo,
    unidades_por_paquete: upp,
  };

  try {
    if (varianteId) {
      console.log("EDITANDO VARIANTE:", varianteId);

      const { error } = await supabaseClient
        .from("producto_variantes")
        .update(variante)
        .eq("id", varianteId);

      if (error) throw error;

      toast("Variante actualizada", "success");
    } else {
      const { error } = await supabaseClient
        .from("producto_variantes")
        .insert([variante]);

      if (error) throw error;

      toast("Variante creada", "success");
    }

    APP.products = await getProductos();
  } catch (error) {
    console.error(error);

    toast("Error al guardar variante: " + error.message, "error");

    return;
  }
  toast(varianteId ? "Variante actualizada" : "Variante creada", "success");
  if (returnTo === "editProduct") editProduct(productoId);
  else editVariantes(productoId);
}

function deleteVariante(productoId, varianteId, returnTo) {
  var ret = returnTo === "editProduct" ? "editProduct" : "editVariantes";
  document.getElementById("modal-body").innerHTML =
    '<div class="p-8 text-center"><div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style="background:rgba(199,92,92,0.12)"><i class="fas fa-trash text-2xl" style="color:var(--danger)"></i></div>' +
    '<h3 class="text-xl font-bold mb-2">Eliminar Variante</h3>' +
    '<p class="mb-6" style="color:var(--muted)">Se removerá del catálogo y del carrito (no afecta cotizaciones ya emitidas).</p>' +
    '<div class="flex gap-3 justify-center"><button class="btn-danger" onclick="confirmDeleteVariante(\'' +
    esc(productoId) +
    "','" +
    esc(varianteId) +
    "','" +
    esc(ret) +
    '\')"><i class="fas fa-trash"></i> Eliminar</button><button class="btn-secondary" onclick="' +
    ret +
    "('" +
    esc(productoId) +
    "')\">Cancelar</button></div></div>";
  openModal();
}

async function confirmDeleteVariante(productoId, varianteId, returnTo) {
  try {
    const { error } = await supabaseClient
      .from("producto_variantes")
      .delete()
      .eq("id", varianteId);

    if (error) throw error;

    APP.products = await getProductos();

    APP.cart = APP.cart.filter(function (c) {
      return !(c.parentId === productoId && c.id === varianteId);
    });

    updateCartBadge();

    toast("Variante eliminada", "success");

    if (returnTo === "editProduct") editProduct(productoId);
    else editVariantes(productoId);
  } catch (error) {
    console.error(error);

    toast("Error al eliminar variante: " + error.message, "error");
  }
}
// =====================================================================
// RECURSOS TÉCNICOS — enlaces de Drive a documentación técnica
// (Suplemento Técnico de Costos, Precios Oficiales CAP, etc.).
// Cada recurso recién agregado nace "en revisión"; el admin lo marca
// como "completado" cuando ya lo revisó.
// =====================================================================
var RECURSO_CATEGORIAS = [
  {
    id: "suplemento_tecnico",
    nombre: "Suplemento Técnico",
    desc: "Revista Costos",
    icono: "fa-book",
  },
  {
    id: "precios_construccion",
    nombre: "Precios Oficiales",
    desc: "Colegio de Arquitectos del Perú",
    icono: "fa-money-bill-trend-up",
  },
  {
    id: "otro",
    nombre: "Otro",
    desc: "Documentos varios",
    icono: "fa-file-lines",
  },
];

function recursoCategoria(id) {
  return (
    RECURSO_CATEGORIAS.find(function (c) {
      return c.id === id;
    }) || RECURSO_CATEGORIAS[RECURSO_CATEGORIAS.length - 1]
  );
}

function renderRecursos() {
  var recursos = loadData("recursos", []);
  // Agrupar por categoría
  var html =
    '<div class="max-w-5xl mx-auto">' +
    '<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">' +
    '<div><h1 class="text-2xl font-bold">Recursos Técnicos</h1><p class="text-sm mt-1" style="color:var(--muted)">Enlaces de Drive con documentación técnica. ' +
    recursos.length +
    " recurso(s) registrado(s).</p></div>" +
    '<button class="btn-primary" onclick="editRecurso(null)"><i class="fas fa-plus"></i> Agregar enlace</button>' +
    "</div>";

  // Tarjetas por categoría
  html += '<div class="space-y-6">';
  RECURSO_CATEGORIAS.forEach(function (cat) {
    var lista = recursos.filter(function (r) {
      return r.categoria === cat.id;
    });
    var items = lista.length
      ? lista
          .map(function (r) {
            var estadoCompletado = r.estado === "completado";
            var badge = estadoCompletado
              ? '<span class="px-2 py-1 rounded-md text-xs font-semibold" style="background:rgba(107,159,120,0.12);color:var(--success)"><i class="fas fa-check mr-1"></i>Completado</span>'
              : '<span class="px-2 py-1 rounded-md text-xs font-semibold" style="background:rgba(212,168,67,0.12);color:var(--warning)"><i class="fas fa-clock mr-1"></i>En revisión</span>';
            var toggleBtn = estadoCompletado
              ? "<button onclick=\"toggleRecursoEstado('" +
                esc(r.id) +
                '\')" class="btn-secondary text-xs" title="Marcar como en revisión"><i class="fas fa-rotate-left"></i> Reabrir</button>'
              : "<button onclick=\"toggleRecursoEstado('" +
                esc(r.id) +
                '\')" class="btn-secondary text-xs" title="Marcar como completado"><i class="fas fa-check"></i> Marcar completado</button>';
            return (
              '<div class="p-4 rounded-xl flex flex-col sm:flex-row sm:items-center gap-3" style="background:var(--bg2);border:1px solid var(--border)">' +
              '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-2 mb-1 flex-wrap">' +
              '<p class="text-sm font-semibold truncate">' +
              esc(r.titulo) +
              "</p>" +
              badge +
              "</div>" +
              '<p class="text-xs truncate" style="color:var(--muted)">' +
              (r.periodo
                ? '<i class="fas fa-calendar mr-1"></i>' +
                  esc(r.periodo) +
                  " · "
                : "") +
              (r.tipo === "pdf"
                ? '<i class="fas fa-file-pdf mr-1"></i><a href="' +
                  escUrl(r.url) +
                  '" target="_blank" rel="noopener noreferrer" style="color:var(--accent)" download="' +
                  esc(r.archivoNombre || "recurso.pdf") +
                  '">Abrir PDF</a>' +
                  (r.tamanio
                    ? ' <span style="color:var(--muted)">(' +
                      (r.tamanio / 1024).toFixed(0) +
                      " KB)</span>"
                    : "")
                : '<i class="fas fa-link mr-1"></i><a href="' +
                  escUrl(r.url) +
                  '" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">Abrir enlace</a>') +
              "</p>" +
              (r.notas
                ? '<p class="text-xs mt-1" style="color:var(--muted)">' +
                  esc(r.notas) +
                  "</p>"
                : "") +
              "</div>" +
              '<div class="flex gap-2 flex-shrink-0">' +
              toggleBtn +
              "<button onclick=\"editRecurso('" +
              esc(r.id) +
              '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:var(--card);color:var(--accent);border:1px solid var(--border);cursor:pointer" title="Editar"><i class="fas fa-pen"></i></button>' +
              "<button onclick=\"deleteRecurso('" +
              esc(r.id) +
              '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:rgba(199,92,92,0.08);color:var(--danger);border:1px solid rgba(199,92,92,0.15);cursor:pointer" title="Eliminar"><i class="fas fa-trash"></i></button>' +
              "</div>" +
              "</div>"
            );
          })
          .join("")
      : '<p class="text-xs text-center py-6" style="color:var(--muted)">Aún no hay recursos en esta categoría.</p>';
    html +=
      '<div class="p-5 rounded-2xl" style="background:var(--card);border:1px solid var(--border)">' +
      '<div class="flex items-center gap-3 mb-4">' +
      '<div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:var(--accent-glow);border:1px solid var(--border)"><i class="fas ' +
      cat.icono +
      '" style="color:var(--accent)"></i></div>' +
      '<div><h3 class="text-base font-bold">' +
      esc(cat.nombre) +
      '</h3><p class="text-xs" style="color:var(--muted)">' +
      esc(cat.desc) +
      " · " +
      lista.length +
      " recurso(s)</p></div>" +
      "</div>" +
      '<div class="space-y-2">' +
      items +
      "</div>" +
      "</div>";
  });
  html += "</div></div>";
  return html;
}

// Tamaño máximo de PDF subido. Como guardamos en localStorage (~4MB total),
// limitamos un poco por debajo para dejar margen al resto del JSON.
var MAX_PDF_BYTES = 3 * 1024 * 1024;

function editRecurso(id) {
  var recursos = loadData("recursos", []);
  var r = id
    ? recursos.find(function (x) {
        return x.id === id;
      })
    : null;
  var isEdit = !!r;
  var catOptions = RECURSO_CATEGORIAS.map(function (c) {
    return (
      '<option value="' +
      c.id +
      '" ' +
      (r && r.categoria === c.id ? "selected" : "") +
      ">" +
      c.nombre +
      (c.desc ? " — " + c.desc : "") +
      "</option>"
    );
  }).join("");
  // Si ya hay un PDF cargado, lo conservamos en hidden y mostramos info.
  var esPdfExistente = r && r.tipo === "pdf";
  var pdfInfo = esPdfExistente
    ? '<div class="mt-2 p-2 rounded-lg flex items-center gap-2" style="background:var(--bg2);border:1px solid var(--border)"><i class="fas fa-file-pdf" style="color:var(--accent)"></i><span class="text-xs truncate flex-1">' +
      esc(r.archivoNombre || "PDF cargado") +
      '</span><span class="text-xs" style="color:var(--muted)">' +
      (r.tamanio ? (r.tamanio / 1024).toFixed(0) + " KB" : "") +
      "</span></div>"
    : "";
  document.getElementById("modal-body").innerHTML =
    '<div class="p-6 md:p-8"><h2 class="text-xl font-bold mb-6">' +
    (isEdit ? "Editar recurso" : "Agregar recurso") +
    '</h2><div class="space-y-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Título</label><input type="text" id="rec-titulo" class="input-field" maxlength="200" value="' +
    esc(r ? r.titulo : "") +
    '" placeholder="Suplemento Técnico Marzo 2026"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Categoría</label><select id="rec-cat" class="input-field">' +
    catOptions +
    "</select></div>" +
    // Toggle URL vs PDF
    '<div class="flex gap-2">' +
    '<button type="button" id="rec-tab-url" class="btn-secondary text-xs flex-1 justify-center" onclick="cambiarTipoRecurso(\'url\')"><i class="fas fa-link"></i> Enlace</button>' +
    '<button type="button" id="rec-tab-pdf" class="btn-secondary text-xs flex-1 justify-center" onclick="cambiarTipoRecurso(\'pdf\')"><i class="fas fa-file-pdf"></i> Subir PDF</button>' +
    "</div>" +
    // Panel URL (link de Drive u otro)
    '<div id="rec-panel-url" style="display:none">' +
    '<label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Enlace (Drive / Dropbox / URL pública)</label>' +
    '<input type="url" id="rec-url" class="input-field" maxlength="2000" value="' +
    esc(r && r.tipo !== "pdf" ? r.url || "" : "") +
    '" placeholder="https://drive.google.com/...">' +
    "</div>" +
    // Panel PDF (subir archivo)
    '<div id="rec-panel-pdf" style="display:none">' +
    '<label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Archivo PDF (máx ' +
    (MAX_PDF_BYTES / 1024 / 1024).toFixed(0) +
    " MB)</label>" +
    '<input type="file" id="rec-pdf-file" accept="application/pdf" class="input-field" style="padding:8px;cursor:pointer">' +
    '<input type="hidden" id="rec-pdf-data" value="' +
    (esPdfExistente ? esc(r.url) : "") +
    '">' +
    '<input type="hidden" id="rec-pdf-nombre" value="' +
    (esPdfExistente ? esc(r.archivoNombre || "") : "") +
    '">' +
    '<input type="hidden" id="rec-pdf-tamanio" value="' +
    (esPdfExistente ? esc(r.tamanio || 0) : "0") +
    '">' +
    '<div id="rec-pdf-info">' +
    pdfInfo +
    "</div>" +
    '<p class="text-xs mt-2" style="color:var(--muted)"><i class="fas fa-info-circle mr-1"></i>Para PDFs grandes (>3 MB), súbelos a Drive y usa el modo Enlace.</p>' +
    "</div>" +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Periodo / Edición (opcional)</label><input type="text" id="rec-periodo" class="input-field" maxlength="60" value="' +
    esc(r ? r.periodo : "") +
    '" placeholder="Marzo 2026"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Notas (opcional)</label><textarea id="rec-notas" class="input-field" rows="3" maxlength="1000">' +
    esc(r ? r.notas : "") +
    "</textarea></div>" +
    (isEdit
      ? '<p class="text-xs" style="color:var(--muted)"><i class="fas fa-info-circle mr-1"></i>Estado actual: <strong>' +
        (r.estado === "completado" ? "Completado" : "En revisión") +
        "</strong>. Para cambiarlo usa el botón en la lista.</p>"
      : '<p class="text-xs" style="color:var(--muted)"><i class="fas fa-info-circle mr-1"></i>El recurso quedará en estado <strong>"En revisión"</strong> hasta que lo marques como completado.</p>') +
    "</div>" +
    '<div class="flex gap-3 mt-6"><button class="btn-primary flex-1 justify-center" onclick="saveRecurso(\'' +
    esc(id || "") +
    '\')"><i class="fas fa-save"></i> ' +
    (isEdit ? "Guardar Cambios" : "Agregar") +
    '</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div>' +
    "</div>";

  // Wire file input
  var fileInput = document.getElementById("rec-pdf-file");
  if (fileInput) fileInput.addEventListener("change", leerArchivoPdf);

  // Activar tab inicial según tipo del recurso editado (default URL)
  cambiarTipoRecurso(esPdfExistente ? "pdf" : "url");
  openModal();
}

function cambiarTipoRecurso(tipo) {
  var panelUrl = document.getElementById("rec-panel-url");
  var panelPdf = document.getElementById("rec-panel-pdf");
  var tabUrl = document.getElementById("rec-tab-url");
  var tabPdf = document.getElementById("rec-tab-pdf");
  if (!panelUrl || !panelPdf) return;
  var esPdf = tipo === "pdf";
  panelUrl.style.display = esPdf ? "none" : "block";
  panelPdf.style.display = esPdf ? "block" : "none";
  // Estilo del tab activo
  if (tabUrl)
    tabUrl.style.borderColor = esPdf ? "var(--border)" : "var(--accent)";
  if (tabPdf)
    tabPdf.style.borderColor = esPdf ? "var(--accent)" : "var(--border)";
  if (tabUrl) tabUrl.style.color = esPdf ? "var(--fg2)" : "var(--accent)";
  if (tabPdf) tabPdf.style.color = esPdf ? "var(--accent)" : "var(--fg2)";
  // Guardamos el modo activo en un data-attr del modal-body para saberlo en save
  document
    .getElementById("modal-body")
    .setAttribute("data-rec-tipo", esPdf ? "pdf" : "url");
}

function leerArchivoPdf(evt) {
  var f = evt.target.files && evt.target.files[0];
  if (!f) return;
  if (f.type !== "application/pdf") {
    toast("Solo se permiten archivos PDF", "error");
    evt.target.value = "";
    return;
  }
  if (f.size > MAX_PDF_BYTES) {
    toast(
      "PDF demasiado grande (" +
        (f.size / 1024 / 1024).toFixed(1) +
        " MB, máx " +
        (MAX_PDF_BYTES / 1024 / 1024).toFixed(0) +
        " MB)",
      "error",
    );
    evt.target.value = "";
    return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    document.getElementById("rec-pdf-data").value = e.target.result; // data:application/pdf;base64,...
    document.getElementById("rec-pdf-nombre").value = f.name;
    document.getElementById("rec-pdf-tamanio").value = String(f.size);
    document.getElementById("rec-pdf-info").innerHTML =
      '<div class="mt-2 p-2 rounded-lg flex items-center gap-2" style="background:var(--bg2);border:1px solid var(--border)">' +
      '<i class="fas fa-file-pdf" style="color:var(--accent)"></i>' +
      '<span class="text-xs truncate flex-1">' +
      esc(f.name) +
      "</span>" +
      '<span class="text-xs" style="color:var(--success)"><i class="fas fa-check"></i> ' +
      (f.size / 1024).toFixed(0) +
      " KB cargado</span>" +
      "</div>";
  };
  reader.onerror = function () {
    toast("No se pudo leer el archivo", "error");
  };
  reader.readAsDataURL(f);
}

function saveRecurso(id) {
  var titulo = trimMax(document.getElementById("rec-titulo").value, 200);
  var cat = document.getElementById("rec-cat").value;
  var periodo = trimMax(document.getElementById("rec-periodo").value, 60);
  var notas = trimMax(document.getElementById("rec-notas").value, 1000);
  var tipo =
    document.getElementById("modal-body").getAttribute("data-rec-tipo") ||
    "url";

  if (!titulo) {
    toast("El título es obligatorio", "error");
    return;
  }
  if (
    !RECURSO_CATEGORIAS.some(function (c) {
      return c.id === cat;
    })
  ) {
    toast("Categoría inválida", "error");
    return;
  }

  var url,
    archivoNombre = null,
    tamanio = null;
  if (tipo === "pdf") {
    url = document.getElementById("rec-pdf-data").value;
    archivoNombre = trimMax(
      document.getElementById("rec-pdf-nombre").value,
      200,
    );
    tamanio =
      parseInt(document.getElementById("rec-pdf-tamanio").value, 10) || null;
    if (!url || !/^data:application\/pdf;base64,/i.test(url)) {
      toast("Sube un archivo PDF", "error");
      return;
    }
  } else {
    var urlRaw = document.getElementById("rec-url").value.trim();
    if (!urlRaw) {
      toast("El enlace es obligatorio", "error");
      return;
    }
    if (!/^https?:\/\//i.test(urlRaw)) {
      toast("El enlace debe empezar con http(s)://", "error");
      return;
    }
    url = urlRaw.substring(0, 2000);
  }

  var recursos = loadData("recursos", []);
  if (id) {
    var idx = recursos.findIndex(function (x) {
      return x.id === id;
    });
    if (idx >= 0)
      recursos[idx] = Object.assign({}, recursos[idx], {
        titulo: titulo,
        categoria: cat,
        url: url,
        periodo: periodo,
        notas: notas,
        tipo: tipo,
        archivoNombre: archivoNombre,
        tamanio: tamanio,
      });
  } else {
    recursos.push({
      id: "r" + Date.now(),
      titulo: titulo,
      categoria: cat,
      url: url,
      periodo: periodo,
      notas: notas,
      tipo: tipo,
      archivoNombre: archivoNombre,
      tamanio: tamanio,
      estado: "revision",
      createdAt: new Date().toISOString(),
    });
  }
  if (!saveData("recursos", recursos)) return;
  closeModal();
  renderPage();
  toast(
    id ? "Recurso actualizado" : "Recurso agregado — queda en revisión",
    "success",
  );
}

function toggleRecursoEstado(id) {
  var recursos = loadData("recursos", []);
  var idx = recursos.findIndex(function (x) {
    return x.id === id;
  });
  if (idx < 0) return;
  recursos[idx].estado =
    recursos[idx].estado === "completado" ? "revision" : "completado";
  if (!saveData("recursos", recursos)) return;
  renderPage();
  toast(
    recursos[idx].estado === "completado"
      ? "Marcado como completado"
      : "Reabierto — en revisión",
    "success",
  );
}

function deleteRecurso(id) {
  var recursos = loadData("recursos", []);
  var r = recursos.find(function (x) {
    return x.id === id;
  });
  if (!r) return;
  document.getElementById("modal-body").innerHTML =
    '<div class="p-8 text-center">' +
    '<div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style="background:rgba(199,92,92,0.12)"><i class="fas fa-trash text-2xl" style="color:var(--danger)"></i></div>' +
    '<h3 class="text-xl font-bold mb-2">Eliminar recurso</h3>' +
    '<p class="mb-6" style="color:var(--muted)">Se eliminará "' +
    esc(r.titulo) +
    '". Esta acción no se puede deshacer.</p>' +
    '<div class="flex gap-3 justify-center"><button class="btn-danger" onclick="confirmDeleteRecurso(\'' +
    esc(id) +
    '\')"><i class="fas fa-check"></i> Eliminar</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div>' +
    "</div>";
  openModal();
}

function confirmDeleteRecurso(id) {
  var recursos = loadData("recursos", []).filter(function (x) {
    return x.id !== id;
  });
  if (!saveData("recursos", recursos)) return;
  closeModal();
  renderPage();
  toast("Recurso eliminado", "success");
}

// =====================================================================
// AGENDA DE PROVEEDORES — contactos por rubro con enlace directo a
// WhatsApp. Categorías base: muebles, puertas, mármol, sanitarios.
// =====================================================================
var PROV_CATEGORIAS = [
  { id: "muebles", nombre: "Muebles", icono: "fa-couch" },
  { id: "puertas", nombre: "Puertas", icono: "fa-door-open" },
  { id: "marmol", nombre: "Mármol", icono: "fa-cube" },
  { id: "sanitarios", nombre: "Sanitarios", icono: "fa-toilet" },
  { id: "otro", nombre: "Otro", icono: "fa-store" },
];

function provCategoria(id) {
  return (
    PROV_CATEGORIAS.find(function (c) {
      return c.id === id;
    }) || PROV_CATEGORIAS[PROV_CATEGORIAS.length - 1]
  );
}

// Normaliza un teléfono a dígitos para wa.me. Asume Perú (+51) si tiene
// 9 dígitos y empieza con 9; si ya viene con prefijo internacional, lo respeta.
function telefonoAWhatsapp(tel) {
  var digits = String(tel || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 9 && digits.charAt(0) === "9") return "51" + digits;
  return digits;
}

function renderProveedores() {
  var agenda = APP.proveedores || [];
  var html =
    '<div class="max-w-5xl mx-auto">' +
    '<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">' +
    '<div><h1 class="text-2xl font-bold">Agenda de Proveedores</h1><p class="text-sm mt-1" style="color:var(--muted)">Contactos por rubro con enlace directo a WhatsApp. ' +
    agenda.length +
    " contacto(s) registrado(s).</p></div>" +
    '<button class="btn-primary" onclick="editProveedorContacto(null)"><i class="fas fa-plus"></i> Nuevo Contacto</button>' +
    "</div>";

  html += '<div class="space-y-6">';
  PROV_CATEGORIAS.forEach(function (cat) {
    var lista = agenda.filter(function (p) {
      return p.categoria === cat.id;
    });
    var items = lista.length
      ? lista
          .map(function (p) {
            var waNum = telefonoAWhatsapp(p.telefono);
            var waUrl = waNum ? "https://wa.me/" + waNum : "";
            var waBtn = waNum
              ? '<a href="' +
                escUrl(waUrl) +
                '" target="_blank" rel="noopener noreferrer" class="btn-secondary text-xs" style="background:rgba(107,159,120,0.12);color:var(--success);border-color:rgba(107,159,120,0.25)" title="Abrir WhatsApp"><i class="fab fa-whatsapp"></i> WhatsApp</a>'
              : '<span class="text-xs" style="color:var(--muted)">Sin teléfono</span>';
            return (
              '<div class="p-4 rounded-xl flex flex-col sm:flex-row sm:items-center gap-3" style="background:var(--bg2);border:1px solid var(--border)">' +
              '<div class="flex-1 min-w-0">' +
              '<p class="text-sm font-semibold truncate">' +
              esc(p.nombre) +
              (p.contacto
                ? ' <span class="text-xs font-normal" style="color:var(--muted)">· ' +
                  esc(p.contacto) +
                  "</span>"
                : "") +
              "</p>" +
              '<p class="text-xs mt-0.5" style="color:var(--muted)">' +
              (p.telefono
                ? '<i class="fas fa-phone mr-1"></i>' + esc(p.telefono)
                : "") +
              (p.email
                ? ' &nbsp; <i class="fas fa-envelope mr-1"></i>' + esc(p.email)
                : "") +
              "</p>" +
              (p.notas
                ? '<p class="text-xs mt-1" style="color:var(--muted)">' +
                  esc(p.notas) +
                  "</p>"
                : "") +
              "</div>" +
              '<div class="flex gap-2 flex-shrink-0">' +
              waBtn +
              "<button onclick=\"editProveedorContacto('" +
              esc(p.id) +
              '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:var(--card);color:var(--accent);border:1px solid var(--border);cursor:pointer" title="Editar"><i class="fas fa-pen"></i></button>' +
              "<button onclick=\"deleteProveedorContacto('" +
              esc(p.id) +
              '\')" class="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style="background:rgba(199,92,92,0.08);color:var(--danger);border:1px solid rgba(199,92,92,0.15);cursor:pointer" title="Eliminar"><i class="fas fa-trash"></i></button>' +
              "</div>" +
              "</div>"
            );
          })
          .join("")
      : '<p class="text-xs text-center py-6" style="color:var(--muted)">Sin contactos en esta categoría todavía.</p>';
    html +=
      '<div class="p-5 rounded-2xl" style="background:var(--card);border:1px solid var(--border)">' +
      '<div class="flex items-center gap-3 mb-4">' +
      '<div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:var(--accent-glow);border:1px solid var(--border)"><i class="fas ' +
      cat.icono +
      '" style="color:var(--accent)"></i></div>' +
      '<div><h3 class="text-base font-bold">' +
      esc(cat.nombre) +
      '</h3><p class="text-xs" style="color:var(--muted)">' +
      lista.length +
      " contacto(s)</p></div>" +
      "</div>" +
      '<div class="space-y-2">' +
      items +
      "</div>" +
      "</div>";
  });
  html += "</div></div>";
  return html;
}

function editProveedorContacto(id) {
  var agenda = APP.proveedores || [];
  var p = id
    ? agenda.find(function (x) {
        return x.id === id;
      })
    : null;
  var isEdit = !!p;
  var catOptions = PROV_CATEGORIAS.map(function (c) {
    return (
      '<option value="' +
      c.id +
      '" ' +
      (p && p.categoria === c.id ? "selected" : "") +
      ">" +
      c.nombre +
      "</option>"
    );
  }).join("");
  document.getElementById("modal-body").innerHTML =
    '<div class="p-6 md:p-8"><h2 class="text-xl font-bold mb-6">' +
    (isEdit ? "Editar contacto" : "Nuevo contacto de proveedor") +
    '</h2><div class="space-y-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Nombre del proveedor / empresa</label><input type="text" id="prov-nombre" class="input-field" maxlength="200" value="' +
    esc(p ? p.nombre : "") +
    '" placeholder="Maderera del Sur SAC"></div>' +
    '<div class="grid grid-cols-2 gap-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Rubro</label><select id="prov-cat" class="input-field">' +
    catOptions +
    "</select></div>" +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Persona de contacto</label><input type="text" id="prov-contacto" class="input-field" maxlength="200" value="' +
    esc(p ? p.contacto : "") +
    '" placeholder="Juan Pérez"></div>' +
    "</div>" +
    '<div class="grid grid-cols-2 gap-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Teléfono / WhatsApp</label><input type="tel" id="prov-tel" class="input-field" maxlength="30" value="' +
    esc(p ? p.telefono : "") +
    '" placeholder="987 654 321"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Correo (opcional)</label><input type="email" id="prov-email" class="input-field" maxlength="254" value="' +
    esc(p ? p.email : "") +
    '"></div>' +
    "</div>" +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Notas (opcional)</label><textarea id="prov-notas" class="input-field" rows="3" maxlength="1000">' +
    esc(p ? p.notas : "") +
    "</textarea></div>" +
    '<p class="text-xs" style="color:var(--muted)"><i class="fab fa-whatsapp mr-1"></i>Si el teléfono tiene 9 dígitos empezando con 9, se asume Perú (+51) al abrir WhatsApp. De lo contrario, incluye el prefijo internacional (ej. 511234567).</p>' +
    "</div>" +
    '<div class="flex gap-3 mt-6"><button class="btn-primary flex-1 justify-center" onclick="saveProveedorContacto(\'' +
    esc(id || "") +
    '\')"><i class="fas fa-save"></i> ' +
    (isEdit ? "Guardar Cambios" : "Crear Contacto") +
    '</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div>' +
    "</div>";
  openModal();
}

async function saveProveedorContacto(id) {
  var nombre = trimMax(document.getElementById("prov-nombre").value, 200);
  var cat = document.getElementById("prov-cat").value;
  var contacto = trimMax(document.getElementById("prov-contacto").value, 200);
  var tel = trimMax(document.getElementById("prov-tel").value, 30);
  var email = trimMax(document.getElementById("prov-email").value, 254);
  var notas = trimMax(document.getElementById("prov-notas").value, 1000);

  if (!nombre) {
    toast("El nombre es obligatorio", "error");
    return;
  }

  if (
    !PROV_CATEGORIAS.some(function (c) {
      return c.id === cat;
    })
  ) {
    toast("Rubro inválido", "error");
    return;
  }

  if (email && !VALID.email.test(email)) {
    toast("Correo con formato inválido", "error");
    return;
  }

  if (tel && !/^[\d\s\-\+\(\)]{6,30}$/.test(tel)) {
    toast("Teléfono inválido", "error");
    return;
  }

  const proveedor = {
    nombre,
    categoria: cat,
    contacto,
    telefono: tel,
    email,
    notas,
    activo: true,
  };

  try {
    if (id) {
      await updateProveedor(id, proveedor);

      toast("Contacto actualizado", "success");
    } else {
      await createProveedor(proveedor);

      toast("Contacto agregado", "success");
    }

    APP.proveedores = await getProveedores();

    closeModal();

    renderPage();
  } catch (error) {
    console.error(error);

    toast("Error al guardar proveedor: " + error.message, "error");
  }
}

function deleteProveedorContacto(id) {
  var agenda = APP.proveedores || [];
  var p = agenda.find(function (x) {
    return x.id === id;
  });
  if (!p) return;
  document.getElementById("modal-body").innerHTML =
    '<div class="p-8 text-center">' +
    '<div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style="background:rgba(199,92,92,0.12)"><i class="fas fa-trash text-2xl" style="color:var(--danger)"></i></div>' +
    '<h3 class="text-xl font-bold mb-2">Eliminar contacto</h3>' +
    '<p class="mb-6" style="color:var(--muted)">Se eliminará "' +
    esc(p.nombre) +
    '" de la agenda. Esta acción no se puede deshacer.</p>' +
    '<div class="flex gap-3 justify-center"><button class="btn-danger" onclick="confirmDeleteProveedorContacto(\'' +
    esc(id) +
    '\')"><i class="fas fa-check"></i> Eliminar</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div>' +
    "</div>";
  openModal();
}
async function confirmDeleteProveedorContacto(id) {
  try {
    await updateProveedor(id, {
      activo: false,
    });

    APP.proveedores = await getProveedores();

    closeModal();

    renderPage();

    toast("Contacto eliminado", "success");
  } catch (error) {
    console.error(error);

    toast("Error al eliminar proveedor: " + error.message, "error");
  }
}

// =====================================================================
// CALCULADORA DE COBERTURA
// Diseña una pared/piso/techo (rectángulo simple O polígono libre en
// malla SVG) y estima cuántas piezas de un material (variante del
// catálogo o manual) se necesitan, con merma, vanos y descuento.
// =====================================================================

// SVG del polígono: viewBox grande (600×400 en unidades internas) que se
// renderiza al ancho del contenedor vía width:100%. POLI_GRID = 20 unidades
// = 1 cuadro = `escala_cm` cm (default 10 cm).
var POLI_W = 600,
  POLI_H = 400,
  POLI_GRID = 20;

function nuevaSuperficie(nombre) {
  return {
    id: "s" + Date.now() + Math.floor(Math.random() * 1000),
    nombre: nombre || "Superficie",
    tipo: "rect",
    // rect:
    ancho: "",
    alto: "",
    unidad: "m",
    // polígono:
    puntos: [], // [{x,y}] en px del SVG
    escala_cm: 10, // cm por cuadro de la malla
    lados: [], // medidas reales por lado en cm
    zoom: 1, // factor de zoom visual de la malla (Ctrl+rueda)
    // común:
    vanos: [],
  };
}

// Estado completo. Sobrevive al re-render del modal.
var CALC = {
  superficies: [nuevaSuperficie("Superficie 1")],
  loza_ancho: "",
  loza_largo: "",
  precio: "",
  precio_base: "loza",
  moneda: "PEN",
  merma: "5",
  descuento: "0",
  variante_sel: "",
  plantilla_sel: "", // id de la plantilla actualmente seleccionada (para poder borrarla)
  ultimoResultado: null,
};

// Punto seleccionado para mover/eliminar: { surfId, idx } | null.
var CALC_SEL = null;

function aMetros(valor, unidad) {
  var n = parseFloat(valor);
  if (isNaN(n) || n <= 0) return 0;
  return unidad === "cm" ? n / 100 : n;
}

// Área en m² de un polígono (puntos en px del SVG) usando shoelace.
function areaPoligonoM2(puntos, escala_cm) {
  if (!puntos || puntos.length < 3) return 0;
  var sum = 0;
  for (var i = 0; i < puntos.length; i++) {
    var j = (i + 1) % puntos.length;
    sum += puntos[i].x * puntos[j].y - puntos[j].x * puntos[i].y;
  }
  var areaPx2 = Math.abs(sum / 2);
  // 1 cuadro = POLI_GRID px = escala_cm cm. Por eje.
  var cmPorPx = escala_cm / POLI_GRID;
  var areaCm2 = areaPx2 * cmPorPx * cmPorPx;
  return areaCm2 / 10000;
}

// Encuentra el índice donde insertar un nuevo punto para que las líneas no
// se crucen: el que produce el menor aumento de perímetro al partir esa arista.
// Esto es la heurística de "nearest edge insertion" (similar a TSP).
function indiceMejorInsercion(puntos, nuevo) {
  if (!puntos || puntos.length === 0) return 0;
  if (puntos.length === 1) return 1; // simplemente atrás del primero
  var mejor = puntos.length; // append por defecto
  var menorAumento = Infinity;
  for (var i = 0; i < puntos.length; i++) {
    var a = puntos[i];
    var b = puntos[(i + 1) % puntos.length];
    var distAB = Math.hypot(b.x - a.x, b.y - a.y);
    var distAN = Math.hypot(nuevo.x - a.x, nuevo.y - a.y);
    var distNB = Math.hypot(b.x - nuevo.x, b.y - nuevo.y);
    var aumento = distAN + distNB - distAB;
    if (aumento < menorAumento) {
      menorAumento = aumento;
      mejor = i + 1; // insertar después del vértice i
    }
  }
  return mejor;
}

// Información de cada lado del polígono: puntos, longitud desde el sketch (cm)
// y longitud real ingresada por el usuario (cm, null si no la tipeó).
function ladosPoligono(s) {
  var n = (s.puntos || []).length;
  if (n < 2) return [];
  var out = [];
  var cmPorPx = s.escala_cm / POLI_GRID;
  for (var i = 0; i < n; i++) {
    var p1 = s.puntos[i];
    var p2 = s.puntos[(i + 1) % n];
    var dx = p2.x - p1.x,
      dy = p2.y - p1.y;
    var lenPx = Math.sqrt(dx * dx + dy * dy);
    var lenCmGrid = lenPx * cmPorPx;
    var lenCmReal =
      s.lados && s.lados[i] != null && s.lados[i] !== ""
        ? parseFloat(s.lados[i])
        : null;
    out.push({
      i: i,
      p1: p1,
      p2: p2,
      midX: (p1.x + p2.x) / 2,
      midY: (p1.y + p2.y) / 2,
      lenPx: lenPx,
      lenCmGrid: lenCmGrid,
      lenCmReal: lenCmReal,
      lenCm: lenCmReal != null && !isNaN(lenCmReal) ? lenCmReal : lenCmGrid,
    });
  }
  return out;
}

// ¿El usuario ingresó al menos una medida real?
function tieneLadosReales(s) {
  if (!s.lados) return false;
  return s.lados.some(function (v) {
    return v != null && v !== "" && !isNaN(parseFloat(v));
  });
}

// Rellena automáticamente los slots vacíos de s.lados con la longitud del
// sketch. No toca valores que el usuario ya tipeó.
function autoRellenarLadosNulos(s) {
  if (!s || !s.puntos || s.puntos.length < 2) return;
  if (!Array.isArray(s.lados)) s.lados = [];
  // Ajustar longitud al número de puntos
  while (s.lados.length < s.puntos.length) s.lados.push(null);
  s.lados.length = s.puntos.length;
  var lados = ladosPoligono(s);
  for (var i = 0; i < lados.length; i++) {
    if (s.lados[i] == null || s.lados[i] === "") {
      s.lados[i] = lados[i].lenCmGrid.toFixed(1);
    }
  }
}

// Área en m² + error de cierre (m) cuando se usan medidas reales.
// Usa las direcciones del sketch y multiplica por las longitudes reales
// (las que faltan se completan con la longitud del grid).
function areaPoligonoConLadosReales(s) {
  var n = (s.puntos || []).length;
  if (n < 3) return { area: 0, errorM: 0 };
  var lados = ladosPoligono(s);
  var coords = [{ x: 0, y: 0 }];
  for (var i = 0; i < n; i++) {
    var l = lados[i];
    if (l.lenPx === 0) continue;
    var unitX = (l.p2.x - l.p1.x) / l.lenPx;
    var unitY = (l.p2.y - l.p1.y) / l.lenPx;
    var lenM = l.lenCm / 100;
    var prev = coords[coords.length - 1];
    coords.push({ x: prev.x + unitX * lenM, y: prev.y + unitY * lenM });
  }
  // Último coord = predicción del cierre. Si no vuelve a (0,0) hay error.
  var ultimo = coords[coords.length - 1];
  var errorM = Math.sqrt(ultimo.x * ultimo.x + ultimo.y * ultimo.y);
  coords.pop(); // descartar el extra para shoelace
  var sum = 0;
  for (var i = 0; i < coords.length; i++) {
    var j = (i + 1) % coords.length;
    sum += coords[i].x * coords[j].y - coords[j].x * coords[i].y;
  }
  return { area: Math.abs(sum / 2), errorM: errorM };
}

// Área efectiva de UNA superficie (rectángulo o polígono, menos vanos).
function areaSuperficieM2(s) {
  var bruta = 0;
  if (s.tipo === "poligono") {
    bruta = tieneLadosReales(s)
      ? areaPoligonoConLadosReales(s).area
      : areaPoligonoM2(s.puntos, s.escala_cm);
  } else {
    bruta = aMetros(s.ancho, s.unidad) * aMetros(s.alto, s.unidad);
  }
  var vanos = (s.vanos || []).reduce(function (acc, v) {
    return acc + aMetros(v.ancho, v.unidad) * aMetros(v.alto, v.unidad);
  }, 0);
  return Math.max(0, bruta - vanos);
}

// Formatea cm como "X.XX m" o "Y cm" según convenga.
function fmtLongitudCm(cm) {
  if (cm == null || isNaN(cm)) return "";
  if (cm >= 100) return (cm / 100).toFixed(2) + " m";
  return Math.round(cm) + " cm";
}

// Lista plana de variantes (TODAS), con flag `usable` cuando tienen dimensiones.
function todasVariantes() {
  var out = [];
  APP.products.forEach(function (p) {
    (p.variantes || []).forEach(function (v) {
      out.push({
        productoId: p.id,
        productoNombre: p.nombre,
        varianteId: v.id,
        varianteNombre: v.nombre,
        ancho: v.ancho,
        largo: v.largo,
        precio: v.precio,
        moneda: v.moneda || p.moneda || "PEN",
        unidadesPorPaquete: v.unidadesPorPaquete || null,
        usable: !!(v.ancho && v.largo),
      });
    });
  });
  return out;
}

// Guarda el estado actual de los inputs DOM en CALC antes de un re-render
// (necesario porque renderCalculadora() vuelve a inyectar todo el HTML).
function snapshotCalcInputs() {
  var ids = [
    "calc-loza-ancho",
    "calc-loza-largo",
    "calc-precio",
    "calc-precio-base",
    "calc-moneda",
    "calc-merma",
    "calc-descuento",
    "calc-variante",
  ];
  var keys = [
    "loza_ancho",
    "loza_largo",
    "precio",
    "precio_base",
    "moneda",
    "merma",
    "descuento",
    "variante_sel",
  ];
  ids.forEach(function (id, i) {
    var el = document.getElementById(id);
    if (el) CALC[keys[i]] = el.value;
  });
}

function openCalculadora() {
  if (!CALC.superficies.length)
    CALC.superficies = [nuevaSuperficie("Superficie 1")];
  // La calculadora necesita más espacio horizontal que el modal genérico (700px).
  var mc = document.querySelector(".modal-content");
  if (mc) mc.style.maxWidth = "1100px";
  renderCalculadora();
  openModal();
}

// Renderiza UNA tarjeta de superficie (rect o polígono).
function renderSuperficieCard(s, total) {
  var canRemove = total > 1;
  var header =
    '<div class="flex items-center gap-2 mb-3">' +
    '<input id="sup-' +
    esc(s.id) +
    '-nombre" type="text" maxlength="60" class="input-field" style="flex:1" value="' +
    esc(s.nombre) +
    '" oninput="actualizarSuperficie(\'' +
    esc(s.id) +
    "','nombre',this.value)\" placeholder=\"Nombre\">" +
    '<select class="input-field" style="width:auto;padding-right:28px" onchange="cambiarTipoSuperficie(\'' +
    esc(s.id) +
    "',this.value)\">" +
    '<option value="rect" ' +
    (s.tipo === "rect" ? "selected" : "") +
    ">Rectángulo</option>" +
    '<option value="poligono" ' +
    (s.tipo === "poligono" ? "selected" : "") +
    ">Polígono</option>" +
    "</select>" +
    (canRemove
      ? "<button onclick=\"quitarSuperficie('" +
        esc(s.id) +
        '\')" class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:rgba(199,92,92,0.08);color:var(--danger);border:1px solid rgba(199,92,92,0.15);cursor:pointer" title="Quitar"><i class="fas fa-xmark"></i></button>'
      : "") +
    "</div>";

  var body;
  if (s.tipo === "poligono") {
    var n = (s.puntos || []).length;
    var lados = ladosPoligono(s);

    // Polígono o línea visual
    var poly =
      n >= 3
        ? '<polygon points="' +
          s.puntos
            .map(function (p) {
              return p.x + "," + p.y;
            })
            .join(" ") +
          '" fill="rgba(200,149,108,0.25)" stroke="var(--accent)" stroke-width="2"/>'
        : "";
    var linea2 =
      n === 2
        ? '<line x1="' +
          s.puntos[0].x +
          '" y1="' +
          s.puntos[0].y +
          '" x2="' +
          s.puntos[1].x +
          '" y2="' +
          s.puntos[1].y +
          '" stroke="var(--accent)" stroke-width="2"/>'
        : "";

    // Vértices clickeables. Si el punto está seleccionado, se pinta más grande y en rojo
    // para indicar "modo mover" (el siguiente clic en el grid lo reubica).
    var hayPuntoSeleccionado = CALC_SEL && CALC_SEL.surfId === s.id;
    var puntosSvg = (s.puntos || [])
      .map(function (p, i) {
        var sel = hayPuntoSeleccionado && CALC_SEL.idx === i;
        var r = sel ? 8 : 5;
        var fill = sel ? "var(--danger)" : "var(--accent)";
        var strokeW = sel ? 2.5 : 1.5;
        return (
          '<circle cx="' +
          p.x +
          '" cy="' +
          p.y +
          '" r="' +
          r +
          '" fill="' +
          fill +
          '" stroke="var(--bg)" stroke-width="' +
          strokeW +
          '" style="cursor:pointer" onmousedown="event.stopPropagation()" onclick="seleccionarPuntoPoligono(\'' +
          esc(s.id) +
          "'," +
          i +
          ',event)"/>' +
          '<text x="' +
          (p.x + 8) +
          '" y="' +
          (p.y - 8) +
          '" font-size="11" fill="var(--fg2)" style="pointer-events:none">' +
          (i + 1) +
          "</text>"
        );
      })
      .join("");

    // Etiquetas de longitud sobre cada lado (en m o cm).
    // Si el lado tiene medida real → color accent; si solo grid → color muted.
    var etiquetasLados =
      n >= 2
        ? lados
            .map(function (l) {
              // Solo mostrar etiqueta si hay polígono cerrado o es lado entre 2 puntos consecutivos válidos
              if (n === 2 && l.i === 1) return ""; // evitar duplicar la única línea
              var texto = fmtLongitudCm(l.lenCm);
              var color = l.lenCmReal != null ? "var(--accent)" : "var(--fg2)";
              // Caja de fondo para legibilidad
              return (
                '<g style="pointer-events:none">' +
                '<rect x="' +
                (l.midX - 22) +
                '" y="' +
                (l.midY - 9) +
                '" width="44" height="14" rx="3" fill="rgba(10,10,10,0.85)"/>' +
                '<text x="' +
                l.midX +
                '" y="' +
                (l.midY + 2) +
                '" text-anchor="middle" font-size="10" fill="' +
                color +
                '" font-weight="600">' +
                esc(texto) +
                "</text>" +
                "</g>"
              );
            })
            .join("")
        : "";

    var areaResult = tieneLadosReales(s)
      ? areaPoligonoConLadosReales(s)
      : { area: areaPoligonoM2(s.puntos, s.escala_cm), errorM: 0 };
    var usandoReales = tieneLadosReales(s);

    // Indicador de cierre
    var cierreInfo = "";
    if (n >= 3 && usandoReales) {
      var errorCm = areaResult.errorM * 100;
      if (errorCm < 5) {
        cierreInfo =
          '<p class="text-xs" style="color:var(--success)"><i class="fas fa-check-circle mr-1"></i>Forma cerrada correctamente</p>';
      } else {
        cierreInfo =
          '<p class="text-xs" style="color:var(--warning)"><i class="fas fa-triangle-exclamation mr-1"></i>Las medidas no cierran: faltan/sobran ' +
          errorCm.toFixed(0) +
          " cm. Revisa los lados.</p>";
      }
    }

    // Inputs por lado, full width abajo, grid 2-4 columnas según ancho.
    // Si el usuario no ha tipeado nada, mostramos el valor del sketch como
    // "value" del input (no como placeholder) para que nunca se vea vacío
    // Y para que al cambiar la escala se actualice automáticamente.
    var ladosInputs =
      n >= 3
        ? lados
            .map(function (l) {
              var tipeado =
                s.lados && s.lados[l.i] != null && s.lados[l.i] !== "";
              var val = tipeado ? s.lados[l.i] : l.lenCmGrid.toFixed(1);
              return (
                '<div class="flex flex-col gap-1">' +
                '<label class="text-xs font-semibold" style="color:var(--accent)">Lado ' +
                (l.i + 1) +
                " → " +
                (((l.i + 1) % n) + 1) +
                "</label>" +
                '<div class="grid grid-cols-[1fr_auto] gap-1 items-center">' +
                '<input id="lado-' +
                esc(s.id) +
                "-" +
                l.i +
                '" type="number" step="0.1" min="0" max="100000" class="input-field" value="' +
                esc(val) +
                '" oninput="actualizarLadoPoligono(\'' +
                esc(s.id) +
                "'," +
                l.i +
                ',this.value)" style="' +
                (tipeado ? "" : "color:var(--fg2)") +
                '">' +
                '<span class="text-xs" style="color:var(--muted)">cm</span>' +
                "</div>" +
                "</div>"
              );
            })
            .join("")
        : "";

    var zoom = typeof s.zoom === "number" && s.zoom > 0 ? s.zoom : 1;
    // El zoom controla cuánta "ventana del mundo" se ve en el SVG.
    // zoom > 1 → viewBox chico → todo se ve más grande (zoom in detalle).
    // zoom < 1 → viewBox grande → más área para dibujar (zoom out, malla "crece").
    var viewW = Math.round(POLI_W / zoom);
    var viewH = Math.round(POLI_H / zoom);
    body =
      '<svg data-surf-id="' +
      esc(s.id) +
      '" viewBox="0 0 ' +
      viewW +
      " " +
      viewH +
      '" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;background:#0a0a0a;border:1px solid var(--border);border-radius:8px;cursor:crosshair;display:block" onclick="clickPoligono(\'' +
      esc(s.id) +
      "',event)\">" +
      '<defs><pattern id="grid-' +
      esc(s.id) +
      '" width="' +
      POLI_GRID +
      '" height="' +
      POLI_GRID +
      '" patternUnits="userSpaceOnUse"><path d="M ' +
      POLI_GRID +
      " 0 L 0 0 0 " +
      POLI_GRID +
      '" fill="none" stroke="rgba(200,149,108,0.18)" stroke-width="0.5"/></pattern></defs>' +
      '<rect width="100%" height="100%" fill="url(#grid-' +
      esc(s.id) +
      ')"/>' +
      poly +
      linea2 +
      etiquetasLados +
      puntosSvg +
      "</svg>" +
      // Hint dinámico: cambia cuando hay punto seleccionado
      (hayPuntoSeleccionado
        ? '<p class="text-xs mt-1 font-semibold" style="color:var(--danger)"><i class="fas fa-arrows-up-down-left-right mr-1"></i>Punto #' +
          (CALC_SEL.idx + 1) +
          " seleccionado. Haz clic en la malla para reubicarlo o presiona <strong>Eliminar vértice</strong>.</p>"
        : '<p class="text-xs mt-1" style="color:var(--muted)"><i class="fas fa-hand-pointer mr-1"></i>Clic = nuevo vértice. Clic en un punto = seleccionar. <strong>Ctrl + rueda</strong> sobre la malla = zoom (' +
          Math.round(zoom * 100) +
          "%)" +
          (zoom !== 1
            ? ' · <a href="#" onclick="resetZoomPoligono(\'' +
              esc(s.id) +
              '\');return false" style="color:var(--accent)">reset</a>'
            : "") +
          ".</p>") +
      // Barra de controles + área (horizontal, debajo del SVG)
      '<div class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 mt-3 items-end">' +
      '<div><label class="block text-xs mb-1" style="color:var(--muted)">Escala del sketch (cm por cuadro)</label><input id="sup-' +
      esc(s.id) +
      '-escala" type="number" step="1" min="1" max="500" class="input-field" value="' +
      esc(s.escala_cm) +
      '" oninput="actualizarSuperficie(\'' +
      esc(s.id) +
      "','escala_cm',this.value)\"></div>" +
      '<div class="p-3 rounded-lg text-center" style="background:rgba(200,149,108,0.12)">' +
      '<p class="text-xs" style="color:var(--muted)">' +
      n +
      " puntos · " +
      (usandoReales ? "medidas reales" : "desde el sketch") +
      "</p>" +
      '<p class="text-2xl font-bold leading-tight" style="color:var(--accent)">' +
      areaResult.area.toFixed(2) +
      " m²</p>" +
      cierreInfo +
      "</div>" +
      '<div class="flex gap-1">' +
      (hayPuntoSeleccionado
        ? '<button class="btn-danger text-xs" onclick="eliminarPuntoSeleccionado()" title="Eliminar el vértice seleccionado"><i class="fas fa-trash"></i> Eliminar vértice</button>'
        : '<button class="btn-secondary text-xs" onclick="deshacerPuntoPoligono(\'' +
          esc(s.id) +
          '\')" title="Deshacer último punto"><i class="fas fa-rotate-left"></i></button>') +
      '<button class="btn-secondary text-xs" onclick="limpiarPoligono(\'' +
      esc(s.id) +
      '\')" title="Limpiar polígono"><i class="fas fa-trash"></i></button>' +
      "</div>" +
      "</div>" +
      // Medidas reales por lado (full width)
      (n >= 3
        ? '<div class="mt-4 p-3 rounded-lg" style="background:rgba(255,255,255,0.03);border:1px solid var(--border)">' +
          '<div class="flex items-center justify-between mb-3">' +
          '<span class="text-sm font-bold uppercase tracking-wider" style="color:var(--muted)"><i class="fas fa-ruler mr-1"></i>Medidas reales por lado</span>' +
          "<button onclick=\"rellenarLadosDesdeGrid('" +
          esc(s.id) +
          '\')" class="btn-secondary text-xs" title="Copiar valores del sketch"><i class="fas fa-wand-magic-sparkles"></i> Rellenar con sketch</button>' +
          "</div>" +
          '<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">' +
          ladosInputs +
          "</div>" +
          '<p class="text-xs mt-3" style="color:var(--muted)"><i class="fas fa-circle-info mr-1"></i>Tipea la medida real en cm de cada lado. Deja vacío para usar la medida aproximada del sketch.</p>' +
          "</div>"
        : '<p class="text-xs mt-3" style="color:var(--muted)">Haz clic en 3+ puntos para activar la edición de medidas por lado.</p>');
  } else {
    body =
      '<div class="grid grid-cols-[1fr_1fr_auto] gap-2">' +
      '<div><label class="block text-xs mb-1" style="color:var(--muted)">Ancho</label><input id="sup-' +
      esc(s.id) +
      '-ancho" type="number" step="0.01" min="0.01" max="9999" class="input-field" value="' +
      esc(s.ancho) +
      '" oninput="actualizarSuperficie(\'' +
      esc(s.id) +
      "','ancho',this.value)\" placeholder=\"3\"></div>" +
      '<div><label class="block text-xs mb-1" style="color:var(--muted)">Alto</label><input id="sup-' +
      esc(s.id) +
      '-alto" type="number" step="0.01" min="0.01" max="9999" class="input-field" value="' +
      esc(s.alto) +
      '" oninput="actualizarSuperficie(\'' +
      esc(s.id) +
      "','alto',this.value)\" placeholder=\"2.5\"></div>" +
      '<div><label class="block text-xs mb-1" style="color:var(--muted)">Unidad</label><select class="input-field" style="padding-right:28px" onchange="actualizarSuperficie(\'' +
      esc(s.id) +
      "','unidad',this.value)\"><option value=\"m\" " +
      (s.unidad === "m" ? "selected" : "") +
      '>m</option><option value="cm" ' +
      (s.unidad === "cm" ? "selected" : "") +
      ">cm</option></select></div>" +
      "</div>";
  }

  // Vanos (aplican tanto a rect como a polígono)
  var vanosHtml = (s.vanos || [])
    .map(function (v, i) {
      var pre = "vano-" + esc(s.id) + "-" + i;
      return (
        '<div class="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 items-center mt-2">' +
        '<input id="' +
        pre +
        '-nombre" type="text" maxlength="40" class="input-field" value="' +
        esc(v.nombre) +
        '" oninput="actualizarVano(\'' +
        esc(s.id) +
        "'," +
        i +
        ',\'nombre\',this.value)" placeholder="Ventana">' +
        '<input id="' +
        pre +
        '-ancho" type="number" step="0.01" min="0.01" max="9999" class="input-field" value="' +
        esc(v.ancho) +
        '" oninput="actualizarVano(\'' +
        esc(s.id) +
        "'," +
        i +
        ',\'ancho\',this.value)" placeholder="Ancho">' +
        '<input id="' +
        pre +
        '-alto" type="number" step="0.01" min="0.01" max="9999" class="input-field" value="' +
        esc(v.alto) +
        '" oninput="actualizarVano(\'' +
        esc(s.id) +
        "'," +
        i +
        ',\'alto\',this.value)" placeholder="Alto">' +
        '<select class="input-field" style="padding-right:28px" onchange="actualizarVano(\'' +
        esc(s.id) +
        "'," +
        i +
        ',\'unidad\',this.value)"><option value="m" ' +
        (v.unidad === "m" ? "selected" : "") +
        '>m</option><option value="cm" ' +
        (v.unidad === "cm" ? "selected" : "") +
        ">cm</option></select>" +
        "<button onclick=\"quitarVano('" +
        esc(s.id) +
        "'," +
        i +
        ')" class="w-8 h-8 rounded flex items-center justify-center" style="background:rgba(199,92,92,0.08);color:var(--danger);border:1px solid rgba(199,92,92,0.15);cursor:pointer" title="Quitar vano"><i class="fas fa-xmark"></i></button>' +
        "</div>"
      );
    })
    .join("");
  var vanosSection =
    '<div class="mt-3 pt-3" style="border-top:1px dashed var(--border)">' +
    '<div class="flex items-center justify-between">' +
    '<span class="text-xs uppercase tracking-wider" style="color:var(--muted)"><i class="fas fa-window-restore mr-1"></i>Vanos a restar (puertas / ventanas) — ' +
    (s.vanos || []).length +
    "</span>" +
    "<button onclick=\"agregarVano('" +
    esc(s.id) +
    '\')" class="btn-secondary text-xs"><i class="fas fa-plus"></i> Vano</button>' +
    "</div>" +
    vanosHtml +
    "</div>";

  // Sub-total visible por superficie
  var areaEfectiva = areaSuperficieM2(s);
  var subInfo =
    '<p class="text-xs mt-3 text-right" style="color:var(--muted)">Área efectiva: <strong style="color:var(--accent)">' +
    areaEfectiva.toFixed(2) +
    " m²</strong></p>";

  return (
    '<div class="p-3 rounded-xl mb-3" style="background:rgba(255,255,255,0.02);border:1px solid var(--border)">' +
    header +
    body +
    vanosSection +
    subInfo +
    "</div>"
  );
}

function renderCalculadora() {
  var monedaDefault = APP.config?.moneda_default || "PEN";
  if (!CALC.moneda) CALC.moneda = monedaDefault;
  var variantes = todasVariantes();
  var plantillas = loadData("calc_plantillas", []);

  var superficiesHtml = CALC.superficies
    .map(function (s) {
      return renderSuperficieCard(s, CALC.superficies.length);
    })
    .join("");

  // Picker: muestra TODAS las variantes; deshabilita las que no tienen ancho/largo.
  var opcionesVariante = '<option value="">— Personalizado (manual) —</option>';
  if (variantes.length) {
    var grupos = {};
    variantes.forEach(function (x) {
      if (!grupos[x.productoId])
        grupos[x.productoId] = { nombre: x.productoNombre, items: [] };
      grupos[x.productoId].items.push(x);
    });
    opcionesVariante += Object.keys(grupos)
      .map(function (pid) {
        var g = grupos[pid];
        var opts = g.items
          .map(function (v) {
            var key = v.productoId + "::" + v.varianteId;
            var label = v.usable
              ? v.varianteNombre +
                " · " +
                Number(v.ancho) +
                "×" +
                Number(v.largo) +
                " cm · " +
                formatMoney(v.precio, v.moneda) +
                (v.unidadesPorPaquete
                  ? " · " + v.unidadesPorPaquete + " u/caja"
                  : "")
              : v.varianteNombre + " — sin medidas (no usable)";
            var sel = key === CALC.variante_sel ? " selected" : "";
            return (
              '<option value="' +
              esc(key) +
              '"' +
              (v.usable ? "" : " disabled") +
              sel +
              ">" +
              esc(label) +
              "</option>"
            );
          })
          .join("");
        return (
          '<optgroup label="' + esc(g.nombre) + '">' + opts + "</optgroup>"
        );
      })
      .join("");
  }
  var avisoVariantes =
    variantes.length &&
    variantes.some(function (v) {
      return !v.usable;
    })
      ? '<p class="text-xs mb-2" style="color:var(--warning)"><i class="fas fa-circle-info mr-1"></i>Algunas variantes aparecen en gris porque no tienen ancho/largo. Edítalas en <strong>Administrar Productos</strong> para usarlas aquí.</p>'
      : "";

  // Plantillas — la opción seleccionada se mantiene visible para que el usuario
  // pueda borrarla si quiere (antes el dropdown se reiniciaba a vacío al cargar).
  var optPlantillas =
    '<option value="">— Cargar plantilla —</option>' +
    plantillas
      .map(function (p) {
        return (
          '<option value="' +
          esc(p.id) +
          '"' +
          (p.id === CALC.plantilla_sel ? " selected" : "") +
          ">" +
          esc(p.nombre) +
          "</option>"
        );
      })
      .join("");

  // Preservamos el scroll del .modal-content (que es quien realmente scrollea
  // porque tiene max-height:90vh definido en CSS) y el foco del input activo.
  var modalContent = document.querySelector(".modal-content");
  var prevScroll = modalContent ? modalContent.scrollTop : 0;
  var activeId = null,
    selStart = null,
    selEnd = null;
  var ae = document.activeElement;
  if (ae && ae.id && modalContent && modalContent.contains(ae)) {
    activeId = ae.id;
    try {
      if (typeof ae.selectionStart === "number") {
        selStart = ae.selectionStart;
        selEnd = ae.selectionEnd;
      }
    } catch (e) {
      /* number inputs no soportan selection en algunos browsers */
    }
  }

  document.getElementById("modal-body").innerHTML =
    '<div class="p-6 md:p-8">' +
    '<div class="flex items-center gap-3 mb-4">' +
    '<div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:var(--accent-glow);border:1px solid var(--border)"><i class="fas fa-calculator" style="color:var(--accent)"></i></div>' +
    '<div class="flex-1"><h2 class="text-xl font-bold">Calculadora de Cobertura</h2><p class="text-xs" style="color:var(--muted)">Diseña la superficie y elige el material para estimar piezas y costo.</p></div>' +
    "</div>" +
    // Plantillas
    '<div class="grid grid-cols-[1fr_auto] gap-2 mb-4 p-3 rounded-xl" style="background:var(--bg2);border:1px solid var(--border)">' +
    '<select id="calc-plantilla" class="input-field" onchange="cargarPlantillaCalc(this.value)">' +
    optPlantillas +
    "</select>" +
    '<div class="flex gap-1">' +
    '<button class="btn-secondary text-xs" onclick="guardarPlantillaCalc()"><i class="fas fa-save"></i> Guardar</button>' +
    (plantillas.length
      ? '<button class="btn-danger text-xs" onclick="eliminarPlantillaCalc()"><i class="fas fa-trash"></i></button>'
      : "") +
    "</div>" +
    "</div>" +
    // Superficies
    '<div class="p-4 rounded-xl mb-4" style="background:var(--bg2);border:1px solid var(--border)">' +
    '<div class="flex items-center justify-between mb-3">' +
    '<h3 class="text-sm font-bold uppercase tracking-wider" style="color:var(--muted)"><i class="fas fa-vector-square mr-1"></i>Superficies a cubrir</h3>' +
    '<button onclick="agregarSuperficie()" class="btn-secondary text-xs"><i class="fas fa-plus"></i> Agregar</button>' +
    "</div>" +
    superficiesHtml +
    "</div>" +
    // Material
    '<div class="p-4 rounded-xl mb-4" style="background:var(--bg2);border:1px solid var(--border)">' +
    '<h3 class="text-sm font-bold uppercase tracking-wider mb-3" style="color:var(--muted)"><i class="fas fa-th-large mr-1"></i>Material</h3>' +
    avisoVariantes +
    '<label class="block text-xs mb-1" style="color:var(--muted)">Elegir del catálogo</label>' +
    '<select id="calc-variante" class="input-field mb-3" onchange="aplicarVarianteCalc(this.value)">' +
    opcionesVariante +
    "</select>" +
    '<div class="grid grid-cols-2 gap-3">' +
    '<div><label class="block text-xs mb-1" style="color:var(--muted)">Ancho de pieza (cm)</label><input type="number" id="calc-loza-ancho" class="input-field" step="0.1" min="0.1" max="9999" oninput="onCalcInput()" value="' +
    esc(CALC.loza_ancho) +
    '" placeholder="60"></div>' +
    '<div><label class="block text-xs mb-1" style="color:var(--muted)">Largo de pieza (cm)</label><input type="number" id="calc-loza-largo" class="input-field" step="0.1" min="0.1" max="9999" oninput="onCalcInput()" value="' +
    esc(CALC.loza_largo) +
    '" placeholder="60"></div>' +
    "</div>" +
    '<div class="grid grid-cols-[1fr_auto_auto] gap-2 items-end mt-3">' +
    '<div><label class="block text-xs mb-1" style="color:var(--muted)">Precio</label><input type="number" id="calc-precio" class="input-field" step="0.01" min="0" max="9999999" oninput="onCalcInput()" value="' +
    esc(CALC.precio) +
    '" placeholder="0.00"></div>' +
    '<div><label class="block text-xs mb-1" style="color:var(--muted)">Base</label><select id="calc-precio-base" class="input-field" onchange="onCalcInput()" style="padding-right:28px"><option value="loza" ' +
    (CALC.precio_base === "loza" ? "selected" : "") +
    '>por loza</option><option value="m2" ' +
    (CALC.precio_base === "m2" ? "selected" : "") +
    ">por m²</option></select></div>" +
    '<div><label class="block text-xs mb-1" style="color:var(--muted)">Moneda</label><select id="calc-moneda" class="input-field" onchange="onCalcInput()" style="padding-right:28px"><option value="PEN" ' +
    (CALC.moneda === "PEN" ? "selected" : "") +
    '>S/.</option><option value="USD" ' +
    (CALC.moneda === "USD" ? "selected" : "") +
    ">US$</option></select></div>" +
    "</div>" +
    "</div>" +
    // Merma + descuento
    '<div class="grid grid-cols-2 gap-3 mb-4">' +
    '<div class="p-4 rounded-xl" style="background:var(--bg2);border:1px solid var(--border)">' +
    '<label class="block text-xs font-semibold uppercase tracking-wider mb-2" style="color:var(--muted)"><i class="fas fa-percent mr-1"></i>Merma (%)</label>' +
    '<input type="number" id="calc-merma" class="input-field" step="1" min="0" max="50" value="' +
    esc(CALC.merma) +
    '" oninput="onCalcInput()">' +
    "</div>" +
    '<div class="p-4 rounded-xl" style="background:var(--bg2);border:1px solid var(--border)">' +
    '<label class="block text-xs font-semibold uppercase tracking-wider mb-2" style="color:var(--muted)"><i class="fas fa-tag mr-1"></i>Descuento (%)</label>' +
    '<input type="number" id="calc-descuento" class="input-field" step="0.5" min="0" max="100" value="' +
    esc(CALC.descuento) +
    '" oninput="onCalcInput()">' +
    "</div>" +
    "</div>" +
    // Resultado
    '<div id="calc-resultado" class="p-5 rounded-xl mb-4" style="background:linear-gradient(145deg,var(--accent-glow),rgba(200,149,108,0.05));border:1px solid rgba(200,149,108,0.25)">' +
    '<p class="text-xs text-center" style="color:var(--muted)">Ingresa las medidas para ver el cálculo.</p>' +
    "</div>" +
    // Acciones finales
    '<div class="flex flex-wrap gap-2">' +
    '<button class="btn-secondary justify-center flex-1" onclick="limpiarCalculadora()"><i class="fas fa-eraser"></i> Limpiar</button>' +
    '<button class="btn-primary justify-center flex-1" id="calc-add-cart" onclick="agregarCalculoAlCarrito()" disabled style="opacity:0.5"><i class="fas fa-cart-plus"></i> Agregar al carrito</button>' +
    '<button class="btn-secondary justify-center" onclick="closeModal()"><i class="fas fa-xmark"></i> Cerrar</button>' +
    "</div>" +
    "</div>";
  // Restaurar scroll y foco. El scroll se setea después de que el navegador
  // calcule layout para que no se ignore.
  if (modalContent) modalContent.scrollTop = prevScroll;
  if (activeId) {
    var newEl = document.getElementById(activeId);
    if (newEl) {
      newEl.focus();
      if (selStart !== null) {
        try {
          newEl.setSelectionRange(selStart, selEnd);
        } catch (e) {}
      }
    }
  }
  // Attach wheel listeners a cada SVG de polígono (necesitan passive:false
  // para poder hacer preventDefault, así que no podemos usar onwheel inline).
  document.querySelectorAll("svg[data-surf-id]").forEach(function (svg) {
    svg.addEventListener("wheel", onPoligonoWheel, { passive: false });
  });
  calcularLozas();
}

function onCalcInput() {
  snapshotCalcInputs();
  calcularLozas();
}

function agregarSuperficie() {
  snapshotCalcInputs();
  CALC.superficies.push(
    nuevaSuperficie("Superficie " + (CALC.superficies.length + 1)),
  );
  renderCalculadora();
}

function quitarSuperficie(id) {
  if (CALC.superficies.length <= 1) return;
  snapshotCalcInputs();
  CALC.superficies = CALC.superficies.filter(function (s) {
    return s.id !== id;
  });
  renderCalculadora();
}

function actualizarSuperficie(id, campo, valor) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  s[campo] = valor;
  // Algunos campos (escala) cambian el render del SVG
  if (campo === "escala_cm") {
    snapshotCalcInputs();
    renderCalculadora();
  } else calcularLozas();
}

function cambiarTipoSuperficie(id, tipo) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  s.tipo = tipo === "poligono" ? "poligono" : "rect";
  snapshotCalcInputs();
  renderCalculadora();
}

// --- Polígono ---
function clickPoligono(id, evt) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  // El viewBox actual depende del zoom de la superficie.
  var zoom = typeof s.zoom === "number" && s.zoom > 0 ? s.zoom : 1;
  var viewW = POLI_W / zoom;
  var viewH = POLI_H / zoom;
  var rect = evt.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  var scaleX = viewW / rect.width;
  var scaleY = viewH / rect.height;
  var rawX = (evt.clientX - rect.left) * scaleX;
  var rawY = (evt.clientY - rect.top) * scaleY;
  var x = Math.round(rawX / POLI_GRID) * POLI_GRID;
  var y = Math.round(rawY / POLI_GRID) * POLI_GRID;
  x = Math.max(0, Math.min(viewW, x));
  y = Math.max(0, Math.min(viewH, y));
  if (!s.puntos) s.puntos = [];
  if (!Array.isArray(s.lados)) s.lados = [];
  // Si hay un punto seleccionado en ESTA superficie → mover ese punto.
  if (CALC_SEL && CALC_SEL.surfId === id && s.puntos[CALC_SEL.idx]) {
    s.puntos[CALC_SEL.idx] = { x: x, y: y };
    // Las dos aristas adyacentes al punto movido ya no reflejan la geometría
    // que el usuario hubiera tipeado — las reseteamos a null para que el
    // input muestre la nueva medida del sketch.
    var n = s.puntos.length;
    var prev = (CALC_SEL.idx - 1 + n) % n;
    s.lados[prev] = null;
    s.lados[CALC_SEL.idx] = null;
    CALC_SEL = null;
  } else {
    // Insertar en el lugar que evita que las líneas se crucen.
    var nuevo = { x: x, y: y };
    var idx = indiceMejorInsercion(s.puntos, nuevo);
    s.puntos.splice(idx, 0, nuevo);
    // La arista anterior (de idx-1 a idx-original) ahora está partida en dos.
    // Reseteamos para que muestren las nuevas medidas del sketch.
    if (idx > 0 && idx - 1 < s.lados.length) s.lados[idx - 1] = null;
    s.lados.splice(idx, 0, null);
  }
  snapshotCalcInputs();
  renderCalculadora();
}

// Ctrl + rueda dentro del SVG = zoom in/out. Sin Ctrl, deja pasar el scroll normal.
function onPoligonoWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return; // metaKey para Mac
  e.preventDefault();
  var svg = e.currentTarget;
  var surfId = svg.getAttribute("data-surf-id");
  var s = CALC.superficies.find(function (x) {
    return x.id === surfId;
  });
  if (!s) return;
  if (typeof s.zoom !== "number" || s.zoom <= 0) s.zoom = 1;
  var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  // Rango: 0.25 (4× área dibujable) a 5 (5× detalle)
  s.zoom = Math.max(0.25, Math.min(5, s.zoom * factor));
  snapshotCalcInputs();
  renderCalculadora();
}

function resetZoomPoligono(surfId) {
  var s = CALC.superficies.find(function (x) {
    return x.id === surfId;
  });
  if (!s) return;
  s.zoom = 1;
  snapshotCalcInputs();
  renderCalculadora();
}

// Clic sobre un círculo del SVG. Toggle de selección.
function seleccionarPuntoPoligono(surfId, idx, evt) {
  if (evt) evt.stopPropagation();
  if (CALC_SEL && CALC_SEL.surfId === surfId && CALC_SEL.idx === idx) {
    CALC_SEL = null; // segundo clic en el mismo = deseleccionar
  } else {
    CALC_SEL = { surfId: surfId, idx: idx };
  }
  snapshotCalcInputs();
  renderCalculadora();
}

function eliminarPuntoSeleccionado() {
  if (!CALC_SEL) return;
  var s = CALC.superficies.find(function (x) {
    return x.id === CALC_SEL.surfId;
  });
  if (!s) {
    CALC_SEL = null;
    renderCalculadora();
    return;
  }
  s.puntos.splice(CALC_SEL.idx, 1);
  if (Array.isArray(s.lados)) s.lados.splice(CALC_SEL.idx, 1);
  // La arista que conectaba los dos vecinos del punto eliminado ahora es nueva.
  if (Array.isArray(s.lados) && s.puntos.length >= 1) {
    var prevIdx = (CALC_SEL.idx - 1 + s.puntos.length) % s.puntos.length;
    s.lados[prevIdx] = null;
  }
  CALC_SEL = null;
  snapshotCalcInputs();
  renderCalculadora();
}

function deshacerPuntoPoligono(id) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s || !s.puntos || !s.puntos.length) return;
  s.puntos.pop();
  if (s.lados) {
    s.lados.pop();
    // Al cerrar el polígono, la arista que enlaza con el último punto cambia.
    if (s.lados.length) s.lados[s.lados.length - 1] = null;
  }
  snapshotCalcInputs();
  renderCalculadora();
}

function limpiarPoligono(id) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  s.puntos = [];
  s.lados = [];
  if (CALC_SEL && CALC_SEL.surfId === id) CALC_SEL = null;
  snapshotCalcInputs();
  renderCalculadora();
}

function actualizarLadoPoligono(id, idx, valor) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  if (!Array.isArray(s.lados)) s.lados = [];
  // Validación: número > 0 o vacío
  if (valor === "" || valor == null) {
    s.lados[idx] = null;
  } else {
    var n = parseFloat(valor);
    if (isNaN(n) || n < 0 || n > 100000) return;
    s.lados[idx] = valor; // guardamos el string para no perder lo que tipea
  }
  // Re-render para actualizar las etiquetas del SVG y el área
  snapshotCalcInputs();
  renderCalculadora();
}

function rellenarLadosDesdeGrid(id) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  var lados = ladosPoligono(s);
  s.lados = lados.map(function (l) {
    return l.lenCmGrid.toFixed(1);
  });
  snapshotCalcInputs();
  renderCalculadora();
  toast("Medidas del sketch copiadas a los lados", "success");
}

// --- Vanos ---
function agregarVano(id) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s) return;
  if (!s.vanos) s.vanos = [];
  s.vanos.push({
    nombre: "Vano " + (s.vanos.length + 1),
    ancho: "",
    alto: "",
    unidad: "m",
  });
  snapshotCalcInputs();
  renderCalculadora();
}

function quitarVano(id, idx) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s || !s.vanos) return;
  s.vanos.splice(idx, 1);
  snapshotCalcInputs();
  renderCalculadora();
}

function actualizarVano(id, idx, campo, valor) {
  var s = CALC.superficies.find(function (x) {
    return x.id === id;
  });
  if (!s || !s.vanos || !s.vanos[idx]) return;
  s.vanos[idx][campo] = valor;
  // Repintar info de área de la tarjeta sin re-render completo: simple, re-render parcial
  // Para mantener simple, recalculamos y dejamos el área inline desactualizada hasta cambio estructural.
  calcularLozas();
}

function aplicarVarianteCalc(value) {
  CALC.variante_sel = value || "";
  if (!value) {
    snapshotCalcInputs();
    calcularLozas();
    return;
  }
  var partes = value.split("::");
  var prod = APP.products.find(function (p) {
    return p.id === partes[0];
  });
  if (!prod) return;
  var v = (prod.variantes || []).find(function (x) {
    return x.id === partes[1];
  });
  if (!v || !v.ancho || !v.largo) return;
  CALC.loza_ancho = String(v.ancho);
  CALC.loza_largo = String(v.largo);
  CALC.precio = String(v.precio);
  CALC.precio_base = "loza";
  CALC.moneda = v.moneda || prod.moneda || "PEN";
  renderCalculadora();
}

function calcularLozas() {
  var box = document.getElementById("calc-resultado");
  if (!box) return;

  var areaTotal = 0;
  var detalleAreas = [];
  CALC.superficies.forEach(function (s) {
    var area = areaSuperficieM2(s);
    if (area > 0) {
      areaTotal += area;
      detalleAreas.push({
        nombre: s.nombre || "(sin nombre)",
        area: area,
        tipo: s.tipo,
      });
    }
  });

  var lozaA =
    parseFloat(document.getElementById("calc-loza-ancho").value) / 100;
  var lozaL =
    parseFloat(document.getElementById("calc-loza-largo").value) / 100;
  var merma = parseFloat(document.getElementById("calc-merma").value);
  if (isNaN(merma) || merma < 0) merma = 0;
  if (merma > 50) merma = 50;
  var descuento = parseFloat(document.getElementById("calc-descuento").value);
  if (isNaN(descuento) || descuento < 0) descuento = 0;
  if (descuento > 100) descuento = 100;

  var addBtn = document.getElementById("calc-add-cart");

  if (
    areaTotal <= 0 ||
    isNaN(lozaA) ||
    isNaN(lozaL) ||
    lozaA <= 0 ||
    lozaL <= 0
  ) {
    box.innerHTML =
      '<p class="text-xs text-center" style="color:var(--muted)">' +
      (areaTotal <= 0
        ? "Ingresa las medidas de al menos una superficie."
        : "Ingresa las dimensiones de la pieza.") +
      "</p>";
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.style.opacity = "0.5";
    }
    CALC.ultimoResultado = null;
    return;
  }

  var areaLoza = lozaA * lozaL;
  var lozasExactas = areaTotal / areaLoza;
  var lozasNetas = Math.ceil(lozasExactas);
  var lozasConMerma = Math.ceil(lozasExactas * (1 + merma / 100));

  var precio = parseFloat(document.getElementById("calc-precio").value);
  var base = document.getElementById("calc-precio-base").value;
  var moneda = document.getElementById("calc-moneda").value;
  var costoHtml = "";
  var total = 0,
    subtotal = 0,
    igv = 0,
    bruto = 0,
    montoDescuento = 0;
  if (!isNaN(precio) && precio > 0) {
    bruto =
      base === "loza"
        ? lozasConMerma * precio
        : areaTotal * (1 + merma / 100) * precio;
    montoDescuento = bruto * (descuento / 100);
    subtotal = bruto - montoDescuento;
    igv = subtotal * 0.18;
    total = subtotal + igv;
    var descRow =
      descuento > 0
        ? '<div class="flex justify-between text-sm py-1"><span style="color:var(--muted)">Descuento (' +
          descuento +
          '%)</span><span style="color:var(--success)">- ' +
          formatMoney(montoDescuento, moneda) +
          "</span></div>"
        : "";
    costoHtml =
      '<div class="mt-4 pt-4" style="border-top:1px dashed rgba(200,149,108,0.3)">' +
      '<div class="flex justify-between text-sm py-1"><span style="color:var(--muted)">Bruto (con merma)</span><span>' +
      formatMoney(bruto, moneda) +
      "</span></div>" +
      descRow +
      '<div class="flex justify-between text-sm py-1"><span style="color:var(--muted)">Subtotal</span><span class="font-semibold">' +
      formatMoney(subtotal, moneda) +
      "</span></div>" +
      '<div class="flex justify-between text-sm py-1"><span style="color:var(--muted)">IGV (18%)</span><span>' +
      formatMoney(igv, moneda) +
      "</span></div>" +
      '<div class="flex justify-between text-base py-2 mt-1" style="border-top:1px solid rgba(200,149,108,0.2)"><span class="font-semibold">Total estimado</span><span class="font-bold" style="color:var(--accent)">' +
      formatMoney(total, moneda) +
      "</span></div>" +
      "</div>";
  }

  var desgloseHtml =
    detalleAreas.length > 1
      ? '<div class="mt-3 p-2 rounded-lg text-xs" style="background:rgba(255,255,255,0.03)">' +
        detalleAreas
          .map(function (d) {
            return (
              '<div class="flex justify-between py-0.5"><span style="color:var(--muted)">' +
              esc(d.nombre) +
              " (" +
              (d.tipo === "poligono" ? "polígono" : "rect") +
              ")</span><span>" +
              d.area.toFixed(2) +
              " m²</span></div>"
            );
          })
          .join("") +
        "</div>"
      : "";

  // Si la variante elegida del catálogo trae "unidades por paquete", mostramos cuántas cajas comprar.
  var paquetesHtml = "";
  if (CALC.variante_sel) {
    var partesV = CALC.variante_sel.split("::");
    var prodV = APP.products.find(function (p) {
      return p.id === partesV[0];
    });
    var varV = prodV
      ? (prodV.variantes || []).find(function (x) {
          return x.id === partesV[1];
        })
      : null;
    if (varV && varV.unidadesPorPaquete) {
      var cajas = Math.ceil(lozasConMerma / varV.unidadesPorPaquete);
      paquetesHtml =
        '<p class="text-xs mt-2" style="color:var(--muted)"><i class="fas fa-box mr-1"></i><strong style="color:var(--fg)">' +
        cajas +
        " paquete" +
        (cajas === 1 ? "" : "s") +
        "</strong> (de " +
        varV.unidadesPorPaquete +
        " u. c/u)</p>";
    }
  }

  box.innerHTML =
    '<h3 class="text-sm font-bold uppercase tracking-wider mb-3" style="color:var(--accent)"><i class="fas fa-square-root-variable mr-1"></i>Resultado</h3>' +
    '<div class="grid grid-cols-2 gap-3 text-sm">' +
    '<div><p class="text-xs" style="color:var(--muted)">Área total</p><p class="text-lg font-bold">' +
    areaTotal.toFixed(2) +
    " m²</p></div>" +
    '<div><p class="text-xs" style="color:var(--muted)">Área por pieza</p><p class="text-lg font-bold">' +
    areaLoza.toFixed(4) +
    " m²</p></div>" +
    '<div><p class="text-xs" style="color:var(--muted)">Piezas exactas</p><p class="text-lg">' +
    lozasExactas.toFixed(2) +
    "</p></div>" +
    '<div><p class="text-xs" style="color:var(--muted)">Redondeado</p><p class="text-lg">' +
    lozasNetas +
    " pza</p></div>" +
    "</div>" +
    desgloseHtml +
    '<div class="mt-3 p-3 rounded-lg text-center" style="background:rgba(200,149,108,0.12)">' +
    '<p class="text-xs" style="color:var(--muted)">Comprar con merma del ' +
    merma +
    "%</p>" +
    '<p class="text-2xl font-bold" style="color:var(--accent)">' +
    lozasConMerma +
    " piezas</p>" +
    paquetesHtml +
    "</div>" +
    costoHtml;

  CALC.ultimoResultado = {
    lozasConMerma: lozasConMerma,
    areaTotal: areaTotal,
    total: total,
    precio: precio,
    moneda: moneda,
    base: base,
  };

  // Habilitar "agregar al carrito" solo si hay variante seleccionada
  if (addBtn) {
    var hayVariante = !!CALC.variante_sel;
    addBtn.disabled = !hayVariante;
    addBtn.style.opacity = hayVariante ? "1" : "0.5";
    addBtn.title = hayVariante
      ? ""
      : "Selecciona una variante del catálogo para agregar al carrito";
  }
}

function agregarCalculoAlCarrito() {
  if (!CALC.variante_sel) {
    toast("Elige una variante del catálogo", "error");
    return;
  }
  if (!CALC.ultimoResultado) {
    toast("Completa los datos del cálculo primero", "error");
    return;
  }
  var partes = CALC.variante_sel.split("::");
  var prod = APP.products.find(function (p) {
    return p.id === partes[0];
  });
  if (!prod) return;
  var v = (prod.variantes || []).find(function (x) {
    return x.id === partes[1];
  });
  if (!v) return;
  var cantidad = CALC.ultimoResultado.lozasConMerma;
  if (!cantidad || cantidad < 1) {
    toast("Cantidad inválida", "error");
    return;
  }

  // Reemplazar si ya estaba esa variante en el carrito; si no, push.
  var existing = APP.cart.find(function (c) {
    return c.parentId === prod.id && c.id === v.id;
  });
  if (existing) {
    existing.cantidad = cantidad;
    existing.precioUnitario = v.precio;
    existing.moneda = v.moneda || prod.moneda || "PEN";
  } else {
    APP.cart.push({
      id: v.id,
      parentId: prod.id,
      cantidad: cantidad,
      precioUnitario: v.precio,
      moneda: v.moneda || prod.moneda || "PEN",
    });
  }
  updateCartBadge();
  toast("Agregado al carrito: " + cantidad + " × " + v.nombre, "success");
  closeModal();
}

// --- Plantillas ---
function guardarPlantillaCalc() {
  snapshotCalcInputs();
  var nombre = prompt('Nombre de la plantilla (ej. "Baño completo")');
  if (nombre === null) return;
  nombre = String(nombre).trim();
  if (!nombre) {
    toast("Nombre vacío", "error");
    return;
  }
  if (nombre.length > 80) nombre = nombre.substring(0, 80);
  var plantillas = loadData("calc_plantillas", []);
  if (plantillas.length >= 50) {
    toast("Máximo 50 plantillas", "error");
    return;
  }
  plantillas.push({
    id: "pl" + Date.now(),
    nombre: nombre,
    fecha: new Date().toISOString(),
    datos: JSON.parse(
      JSON.stringify({
        superficies: CALC.superficies,
        loza_ancho: CALC.loza_ancho,
        loza_largo: CALC.loza_largo,
        precio: CALC.precio,
        precio_base: CALC.precio_base,
        moneda: CALC.moneda,
        merma: CALC.merma,
        descuento: CALC.descuento,
        variante_sel: CALC.variante_sel,
      }),
    ),
  });
  if (!saveData("calc_plantillas", plantillas)) return;
  toast("Plantilla guardada", "success");
  renderCalculadora();
}

function cargarPlantillaCalc(id) {
  // Al elegir la opción vacía simplemente deseleccionamos.
  if (!id) {
    CALC.plantilla_sel = "";
    renderCalculadora();
    return;
  }
  var plantillas = loadData("calc_plantillas", []);
  var p = plantillas.find(function (x) {
    return x.id === id;
  });
  if (!p) return;
  CALC.plantilla_sel = id;
  // Restaura estado (con normalización defensiva)
  CALC.superficies = (p.datos.superficies || []).map(function (s) {
    return Object.assign(nuevaSuperficie(s.nombre), s);
  });
  if (!CALC.superficies.length)
    CALC.superficies = [nuevaSuperficie("Superficie 1")];
  CALC.loza_ancho = p.datos.loza_ancho || "";
  CALC.loza_largo = p.datos.loza_largo || "";
  CALC.precio = p.datos.precio || "";
  CALC.precio_base = p.datos.precio_base || "loza";
  CALC.moneda = p.datos.moneda || "PEN";
  CALC.merma = p.datos.merma || "5";
  CALC.descuento = p.datos.descuento || "0";
  CALC.variante_sel = p.datos.variante_sel || "";
  renderCalculadora();
  toast('Plantilla "' + p.nombre + '" cargada', "success");
}

function eliminarPlantillaCalc() {
  // Preferimos el id guardado en estado; si no, leemos el dropdown como fallback.
  var id = CALC.plantilla_sel;
  if (!id) {
    var sel = document.getElementById("calc-plantilla");
    id = sel ? sel.value : "";
  }
  if (!id) {
    toast("Elige una plantilla primero", "info");
    return;
  }
  var plantillas = loadData("calc_plantillas", []);
  var p = plantillas.find(function (x) {
    return x.id === id;
  });
  if (!p) return;
  if (!confirm('¿Eliminar plantilla "' + p.nombre + '"?')) return;
  plantillas = plantillas.filter(function (x) {
    return x.id !== id;
  });
  if (!saveData("calc_plantillas", plantillas)) return;
  CALC.plantilla_sel = "";
  toast("Plantilla eliminada", "success");
  renderCalculadora();
}

function limpiarCalculadora() {
  CALC.superficies = [nuevaSuperficie("Superficie 1")];
  CALC.loza_ancho = "";
  CALC.loza_largo = "";
  CALC.precio = "";
  CALC.precio_base = "loza";
  CALC.merma = "5";
  CALC.descuento = "0";
  CALC.variante_sel = "";
  CALC.ultimoResultado = null;
  renderCalculadora();
}

// Configuración y gestión de datos de la empresa
function renderSettings() {
  var config = APP.config || {};

  var tcGuardado = config.tipo_cambio_default || 3.75;

  var monedaDefault = config.moneda_default || "PEN";
  return (
    '<div class="max-w-2xl mx-auto"><h1 class="text-2xl font-bold mb-6">Configuración</h1><div class="space-y-6">' +
    // --- Datos de empresa ---
    '<div class="p-6 rounded-2xl" style="background:var(--card);border:1px solid var(--border)"><h3 class="text-lg font-bold mb-4"><i class="fas fa-building mr-2" style="color:var(--accent)"></i>Datos de la Empresa</h3><div class="space-y-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Nombre</label><input type="text" id="cfg-empresa" class="input-field" maxlength="200" value="' +
    esc(APP.config?.nombre || "Polyline SAC") +
    '"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Encargado</label><input type="text" id="cfg-encargado" class="input-field" maxlength="200" value="' +
    esc(APP.config?.encargado || "Arq. Luis Alberto Salas Castro") +
    '"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Teléfono</label><input type="tel" id="cfg-tel" class="input-field" maxlength="30" value="' +
    esc(APP.config?.telefono || "+51 943 812 536") +
    '"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Correo</label><input type="email" id="cfg-email" class="input-field" maxlength="254" value="' +
    esc(APP.config?.email || "polylinesac@yahoo.com") +
    '"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Dirección</label><textarea id="cfg-dir" class="input-field" rows="2" maxlength="300">' +
    esc(
      APP.config?.direccion ||
        "Av. Benavides 3008. Lima\nArq. Luis Alberto Salas Castro",
    ) +
    "</textarea></div>" +
    '</div><button class="btn-primary mt-4" onclick="saveSettings()"><i class="fas fa-save"></i> Guardar</button></div>' +
    // --- Moneda y TC ---
    '<div class="p-6 rounded-2xl" style="background:var(--card);border:1px solid var(--border)"><h3 class="text-lg font-bold mb-4"><i class="fas fa-coins mr-2" style="color:var(--accent)"></i>Moneda y Tipo de Cambio</h3><div class="grid grid-cols-2 gap-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Moneda por defecto en cotizaciones</label><select id="cfg-moneda" class="input-field"><option value="PEN" ' +
    (monedaDefault === "PEN" ? "selected" : "") +
    '>S/. Soles</option><option value="USD" ' +
    (monedaDefault === "USD" ? "selected" : "") +
    ">US$ Dólares</option></select></div>" +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Tipo de Cambio (PEN por 1 USD)</label><input type="number" id="cfg-tc" class="input-field" step="0.0001" min="0.0001" max="1000" value="' +
    esc(tcGuardado) +
    '"></div>' +
    '</div><p class="text-xs mt-3" style="color:var(--muted)">El TC se aplica al convertir entre monedas. Cada cotización guarda el TC del momento, así que cambiarlo no afecta cotizaciones ya emitidas.</p><button class="btn-primary mt-4" onclick="saveSettings()"><i class="fas fa-save"></i> Guardar</button></div>' +
    // --- Condiciones PDF ---
    '<div class="p-6 rounded-2xl" style="background:var(--card);border:1px solid var(--border)"><h3 class="text-lg font-bold mb-4"><i class="fas fa-file-lines mr-2" style="color:var(--accent)"></i>Condiciones en Cotización</h3><textarea id="cfg-condiciones" class="input-field" rows="4" maxlength="2000" placeholder="Ej: Precios vigentes al momento de la cotización...">' +
    esc(
      APP.config?.condiciones ||
        "Precios vigentes a la fecha de emisión. Validez de 15 días hábiles. Incluye IGV del 18%. Sujeto a disponibilidad de stock.",
    ) +
    '</textarea><button class="btn-primary mt-4" onclick="saveSettings()"><i class="fas fa-save"></i> Guardar</button></div>' +
    // --- Gestión granular de datos ---
    '<div class="p-6 rounded-2xl" style="background:var(--card);border:1px solid var(--border)"><h3 class="text-lg font-bold mb-4"><i class="fas fa-database mr-2" style="color:var(--accent)"></i>Gestión de Datos</h3>' +
    '<p class="text-sm mb-4" style="color:var(--muted)">Acciones específicas. Ninguna borra todo a la vez — elige qué quieres tocar.</p>' +
    '<div class="space-y-3">' +
    // Productos
    '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg" style="background:var(--bg2);border:1px solid var(--border)"><div><p class="text-sm font-semibold">Productos del catálogo</p><p class="text-xs" style="color:var(--muted)">' +
    esc(APP.products.length) +
    ' productos · No afecta cotizaciones ya emitidas.</p></div><div class="flex gap-2"><button class="btn-secondary text-xs" onclick="resetProducts()"><i class="fas fa-rotate-right"></i> Restaurar demo</button><button class="btn-danger text-xs" onclick="confirmAccion(\'productos\')"><i class="fas fa-trash"></i> Vaciar catálogo</button></div></div>' +
    // Cotizaciones
    '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg" style="background:var(--bg2);border:1px solid var(--border)"><div><p class="text-sm font-semibold">Cotizaciones emitidas</p><p class="text-xs" style="color:var(--muted)">' +
    esc(APP.quotes.length) +
    ' cotización(es) en el historial.</p></div><button class="btn-danger text-xs" onclick="confirmAccion(\'cotizaciones\')"><i class="fas fa-trash"></i> Borrar historial</button></div>' +
    // Configuración empresa
    '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg" style="background:var(--bg2);border:1px solid var(--border)"><div><p class="text-sm font-semibold">Configuración de la empresa</p><p class="text-xs" style="color:var(--muted)">Vuelve a los valores por defecto (nombre, encargado, teléfono, etc.).</p></div><button class="btn-danger text-xs" onclick="confirmAccion(\'config\')"><i class="fas fa-rotate-left"></i> Restablecer</button></div>' +
    // TC
    '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg" style="background:var(--bg2);border:1px solid var(--border)"><div><p class="text-sm font-semibold">Tipo de cambio</p><p class="text-xs" style="color:var(--muted)">Vuelve al TC por defecto (3.7500). No toca cotizaciones pasadas.</p></div><button class="btn-danger text-xs" onclick="confirmAccion(\'tc\')"><i class="fas fa-rotate-left"></i> Reset TC</button></div>' +
    // Carrito
    '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg" style="background:var(--bg2);border:1px solid var(--border)"><div><p class="text-sm font-semibold">Carrito en curso</p><p class="text-xs" style="color:var(--muted)">Quita los productos del carrito sin generar cotización.</p></div><button class="btn-secondary text-xs" onclick="clearCart()"><i class="fas fa-broom"></i> Vaciar carrito</button></div>' +
    "</div>" +
    "</div>" +
    "</div></div>"
  );
}
async function saveSettings() {
  var emailEl = document.getElementById("cfg-email");

  if (emailEl) {
    var em = emailEl.value.trim();

    if (em && !VALID.email.test(em)) {
      toast("Correo con formato inválido", "error");
      return;
    }
  }

  var tcEl = document.getElementById("cfg-tc");

  var tcInput = null;

  if (tcEl) {
    tcInput = parseFloat(tcEl.value);

    if (isNaN(tcInput) || tcInput <= 0 || tcInput > 1000) {
      toast("Tipo de cambio fuera de rango", "error");
      return;
    }
  }

  const moneda = document.getElementById("cfg-moneda").value;

  if (moneda !== "PEN" && moneda !== "USD") {
    toast("Moneda inválida", "error");
    return;
  }

  try {
    const config = {
      nombre: trimMax(
        document.getElementById("cfg-empresa").value,
        VALID.maxLen.nombre,
      ),

      encargado: trimMax(
        document.getElementById("cfg-encargado").value,
        VALID.maxLen.nombre,
      ),

      telefono: trimMax(
        document.getElementById("cfg-tel").value,
        VALID.maxLen.telefono,
      ),

      email: trimMax(
        document.getElementById("cfg-email").value,
        VALID.maxLen.email,
      ),

      direccion: trimMax(
        document.getElementById("cfg-dir").value,
        VALID.maxLen.direccion,
      ),

      condiciones: trimMax(
        document.getElementById("cfg-condiciones").value,
        VALID.maxLen.condiciones,
      ),

      moneda_default: moneda,

      tipo_cambio_default: tcInput,
    };

    await updateEmpresaConfig(config);

    APP.config = await getEmpresaConfig();

    renderPage();

    toast("Configuración guardada", "success");
  } catch (error) {
    console.error(error);

    toast("Error al guardar configuración", "error");
  }
}
// function resetProducts() {
//   APP.products = JSON.parse(JSON.stringify(DEFAULT_PRODUCTS)).map(normalizarProducto);
//   saveData('products', APP.products); renderPage(); toast('Productos restaurados', 'success');
// }

// Confirmación genérica para acciones destructivas específicas.
// El parámetro `accion` decide qué se borra. NINGUNA borra cotizaciones por accidente.
function confirmAccion(accion) {
  var textos = {
    productos: {
      titulo: "Vaciar catálogo de productos",
      msg:
        "Se eliminarán los " +
        APP.products.length +
        " productos. El historial de cotizaciones NO se toca.",
      boton: "Vaciar catálogo",
    },
    cotizaciones: {
      titulo: "Borrar historial de cotizaciones",
      msg:
        "Se eliminarán " +
        APP.quotes.length +
        " cotización(es). Esta acción no se puede deshacer.",
      boton: "Borrar historial",
    },
    config: {
      titulo: "Restablecer configuración de empresa",
      msg: "Los datos de empresa, condiciones, moneda default y TC volverán a los valores por defecto.",
      boton: "Restablecer",
    },
    tc: {
      titulo: "Reset del tipo de cambio",
      msg: "El TC volverá a 3.7500. Las cotizaciones ya emitidas conservan su TC original.",
      boton: "Reset TC",
    },
  };
  var t = textos[accion];
  if (!t) return;
  document.getElementById("modal-body").innerHTML =
    '<div class="p-8 text-center">' +
    '<div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style="background:rgba(199,92,92,0.12)"><i class="fas fa-exclamation-triangle text-2xl" style="color:var(--danger)"></i></div>' +
    '<h3 class="text-xl font-bold mb-2">' +
    t.titulo +
    "</h3>" +
    '<p class="mb-6" style="color:var(--muted)">' +
    t.msg +
    "</p>" +
    '<div class="flex gap-3 justify-center"><button class="btn-danger" onclick="ejecutarAccion(\'' +
    accion +
    '\')"><i class="fas fa-check"></i> ' +
    t.boton +
    '</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div>' +
    "</div>";
  openModal();
}

async function ejecutarAccion(accion) {
  if (accion === "productos") {
    try {
      const { error } = await supabaseClient
        .from("productos")
        .delete()
        .neq("id", "");

      if (error) throw error;

      APP.products = [];

      toast("Catálogo vaciado", "success");
    } catch (error) {
      console.error(error);

      toast("Error al vaciar catálogo", "error");
    }
  } else if (accion === "cotizaciones") {
    try {
      // Eliminar primero los detalles
      const { error: itemsError } = await supabaseClient
        .from("cotizacion_items")
        .delete()
        .neq("id", "");

      if (itemsError) throw itemsError;

      // Luego las cabeceras
      const { error } = await supabaseClient
        .from("cotizaciones")
        .delete()
        .neq("id", "");

      if (error) throw error;

      APP.quotes = [];
      APP.quoteCounter = 0;

      toast("Historial de cotizaciones eliminado", "success");
    } catch (error) {
      console.error(error);

      toast("Error al eliminar cotizaciones", "error");
    }
  } else if (accion === "config") {
    try {
      await updateEmpresaConfig({
        nombre: "Polyline SAC",

        encargado: "",

        telefono: "",

        email: "",

        direccion: "",

        condiciones: "Precios vigentes a la fecha de emisión.",

        moneda_default: "PEN",

        tipo_cambio_default: 3.75,
      });

      APP.config = await getEmpresaConfig();

      toast("Configuración restablecida", "success");
    } catch (error) {
      console.error(error);

      toast("Error al restablecer configuración", "error");
    }
  } else if (accion === "tc") {
    await updateEmpresaConfig({
      tipo_cambio_default: 3.75,
    });

    APP.config = await getEmpresaConfig();
    toast("Tipo de cambio reseteado a 3.7500", "success");
  }
  updateCartBadge();
  closeModal();
  renderPage();
}

// CARRO DE COTIZACIÓN
function addToCart(id) {
  var p = APP.products.find(function (pr) {
    return pr.id === id;
  });
  if (!p) return;
  // Si el producto tiene variantes, la entrada al carrito es por el picker.
  if ((p.variantes || []).length) {
    showVariantesPicker(id);
    return;
  }
  if (!p.stock_disponible) {
    toast("Producto agotado", "error");
    return;
  }
  var existing = APP.cart.find(function (c) {
    return c.id === id && !c.parentId;
  });
  if (existing) {
    toast("Ya está en la cotización", "info");
    return;
  }
  APP.cart.push({
    id: p.id,
    cantidad: 1,
    precioUnitario: p.precio,
    moneda: p.moneda || "PEN",
  });
  updateCartBadge();
  toast(p.nombre + " agregado", "success");
  if (APP.page === "catalog") renderPage();
}
function removeFromCart(id) {
  APP.cart = APP.cart.filter(function (c) {
    return c.id !== id;
  });
  updateCartBadge();
  renderCartPanel();
  if (APP.page === "catalog") renderPage();
}
function updateCartQty(id, delta) {
  var item = APP.cart.find(function (c) {
    return c.id === id;
  });
  if (!item) return;
  var nueva = item.cantidad + (Number(delta) || 0);
  if (nueva < 1) nueva = 1;
  if (nueva > 99999) nueva = 99999;
  item.cantidad = nueva;
  renderCartPanel();
  if (APP.page === "catalog") renderPage();
}
function updateCartBadge() {
  var badge = document.getElementById("cart-badge");
  if (APP.cart.length > 0) {
    badge.style.display = "flex";
    badge.textContent = APP.cart.length;
  } else {
    badge.style.display = "none";
  }
}
function openCart() {
  document.getElementById("cart-panel").classList.add("open");
  document.getElementById("cart-overlay").style.display = "block";
  renderCartPanel();
}
function closeCart() {
  document.getElementById("cart-panel").classList.remove("open");
  document.getElementById("cart-overlay").style.display = "none";
}

function renderCartPanel() {
  var itemsEl = document.getElementById("cart-items");
  var footerEl = document.getElementById("cart-footer");
  if (!APP.cart.length) {
    itemsEl.innerHTML =
      '<div class="text-center py-16"><i class="fas fa-shopping-bag text-4xl mb-4" style="color:var(--muted)"></i><p style="color:var(--muted)">Tu cotización está vacía</p><p class="text-xs mt-1" style="color:var(--muted)">Agrega productos desde el catálogo</p></div>';
    footerEl.innerHTML = "";
    return;
  }
  var tc = tipoCambioActual();
  var totalPEN = 0;
  var hayMezcla = false;
  var monedaUnica = null;
  var items = APP.cart
    .map(function (item) {
      var info = resolveCartItem(item);
      if (!info) return "";
      var monedaItem = item.moneda || info.moneda || "PEN";
      if (monedaUnica === null) monedaUnica = monedaItem;
      else if (monedaUnica !== monedaItem) hayMezcla = true;
      var sub = item.cantidad * item.precioUnitario;
      totalPEN += convertirPrecio(sub, monedaItem, "PEN", tc);
      var imgFallbackSeed = encodeURIComponent(item.id);
      return (
        '<div class="flex gap-3 p-3 rounded-xl mb-2" style="background:var(--card);border:1px solid var(--border)">' +
        '<img src="' +
        escUrl(info.imagen) +
        '" class="w-14 h-14 rounded-lg object-cover flex-shrink-0" onerror="this.src=\'https://picsum.photos/seed/' +
        imgFallbackSeed +
        "/100/100'\">" +
        '<div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">' +
        esc(info.nombre) +
        '</p><p class="text-xs" style="color:var(--muted)">' +
        formatMoney(item.precioUnitario, monedaItem) +
        " / " +
        esc(info.unidad) +
        "</p>" +
        '<div class="flex items-center gap-2 mt-1.5"><button onclick="updateCartQty(\'' +
        esc(item.id) +
        '\',-1)" class="w-6 h-6 rounded flex items-center justify-center text-xs" style="background:var(--card-hover);border:1px solid var(--border);color:var(--fg);cursor:pointer">-</button><span class="text-sm font-semibold w-8 text-center">' +
        esc(item.cantidad) +
        "</span><button onclick=\"updateCartQty('" +
        esc(item.id) +
        '\',1)" class="w-6 h-6 rounded flex items-center justify-center text-xs" style="background:var(--card-hover);border:1px solid var(--border);color:var(--fg);cursor:pointer">+</button></div></div>' +
        '<div class="text-right flex flex-col justify-between"><button onclick="removeFromCart(\'' +
        esc(item.id) +
        '\')" class="text-xs self-end" style="color:var(--danger);cursor:pointer;background:none;border:none" title="Quitar"><i class="fas fa-xmark"></i></button><p class="text-sm font-bold" style="color:var(--accent)">' +
        formatMoney(sub, monedaItem) +
        "</p></div></div>"
      );
    })
    .join("");
  itemsEl.innerHTML = items;
  var subtotal = totalPEN / 1.18;
  var igv = totalPEN - subtotal;
  var totalUSD = totalPEN / tc;
  var nota = hayMezcla
    ? '<p class="text-xs mb-2" style="color:var(--warning)"><i class="fas fa-info-circle"></i> Carrito con productos en S/. y US$. Elige la moneda de salida al cotizar.</p>'
    : "";
  footerEl.innerHTML =
    nota +
    '<div class="space-y-1 mb-4" style="border-top:1px solid var(--border); padding-top: 15px;">' +
    '<div class="flex items-center justify-between text-xs" style="color:var(--muted)"><span class="font-medium">Subtotal (Base Imponible)</span><span>' +
    formatMoney(subtotal, "PEN") +
    "</span></div>" +
    '<div class="flex items-center justify-between text-xs" style="color:var(--muted)"><span class="font-medium">IGV (18%)</span><span>' +
    formatMoney(igv, "PEN") +
    "</span></div>" +
    '<div class="flex items-center justify-between pt-2"><span class="font-bold text-base">Total estimado</span><span class="text-2xl font-bold" style="color:var(--accent)">' +
    formatMoney(totalPEN, "PEN") +
    "</span></div>" +
    '<div class="flex items-center justify-between text-xs" style="color:var(--muted)"><span>Equivalente</span><span>' +
    formatMoney(totalUSD, "USD") +
    " &nbsp;(TC " +
    tc.toFixed(4) +
    ")</span></div>" +
    "</div>" +
    '<button class="btn-primary w-full justify-center mb-2" onclick="showQuoteForm()"><i class="fas fa-file-invoice-dollar"></i> Generar Cotización</button>' +
    '<button class="btn-secondary w-full justify-center" onclick="clearCart()"><i class="fas fa-broom"></i> Vaciar</button>';
}

function clearCart() {
  APP.cart = [];
  updateCartBadge();
  renderCartPanel();
  if (APP.page === "catalog") renderPage();
  toast("Cotización vaciada", "info");
}

function showQuoteForm() {
  closeCart();
  var tc = tipoCambioActual();
  var monedaDefault = APP.config?.moneda_default || "PEN";
  document.getElementById("modal-body").innerHTML =
    '<div class="p-6 md:p-8"><h2 class="text-xl font-bold mb-6">Completar Cotización</h2><div class="space-y-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Nombre del Cliente</label><input type="text" id="quote-cliente" class="input-field" placeholder="Nombre completo o razón social"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">RUC / Documento (opcional)</label><input type="text" id="quote-ruc" class="input-field" placeholder="11 dígitos"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Proyecto / Referencia</label><input type="text" id="quote-proyecto" class="input-field" placeholder="Ej: Residencia Los Robles"></div>' +
    '<div class="grid grid-cols-2 gap-4">' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Moneda de la cotización</label><select id="quote-moneda" class="input-field" onchange="actualizarPreviewCotizacion()"><option value="PEN" ' +
    (monedaDefault === "PEN" ? "selected" : "") +
    '>S/. Soles</option><option value="USD" ' +
    (monedaDefault === "USD" ? "selected" : "") +
    ">US$ Dólares</option></select></div>" +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Tipo de Cambio (PEN/USD)</label><input type="number" id="quote-tc" class="input-field" step="0.0001" min="0" value="' +
    tc.toFixed(4) +
    '" oninput="actualizarPreviewCotizacion()"></div>' +
    "</div>" +
    '<div id="quote-preview" class="p-3 rounded-lg text-sm" style="background:var(--card);border:1px solid var(--border)"></div>' +
    '<div><label class="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style="color:var(--muted)">Notas adicionales</label><textarea id="quote-notas" class="input-field" rows="3" placeholder="Instrucciones especiales, plazo de entrega..."></textarea></div>' +
    '</div><div class="flex gap-3 mt-6"><button class="btn-primary flex-1 justify-center" onclick="createQuote()"><i class="fas fa-check"></i> Crear y Generar PDF</button><button class="btn-secondary" onclick="closeModal()">Cancelar</button></div></div>';
  openModal();
  setTimeout(function () {
    document.getElementById("quote-cliente").focus();
    actualizarPreviewCotizacion();
  }, 300);
}

// Recalcula total previsto al cambiar moneda o TC en el formulario de cotización.
function actualizarPreviewCotizacion() {
  var monedaEl = document.getElementById("quote-moneda");
  var tcEl = document.getElementById("quote-tc");
  var preview = document.getElementById("quote-preview");
  if (!monedaEl || !tcEl || !preview) return;
  var monedaSalida = monedaEl.value;
  var tc = parseFloat(tcEl.value);
  if (isNaN(tc) || tc <= 0) {
    preview.innerHTML =
      '<span style="color:var(--danger)">Tipo de cambio inválido</span>';
    return;
  }
  var total = APP.cart.reduce(function (s, item) {
    var monedaItem = item.moneda || "PEN";
    var sub = item.cantidad * item.precioUnitario;
    return s + convertirPrecio(sub, monedaItem, monedaSalida, tc);
  }, 0);
  var subtotal = total / 1.18;
  var igv = total - subtotal;
  preview.innerHTML =
    '<div class="flex justify-between"><span style="color:var(--muted)">Subtotal</span><span>' +
    formatMoney(subtotal, monedaSalida) +
    "</span></div>" +
    '<div class="flex justify-between"><span style="color:var(--muted)">IGV (18%)</span><span>' +
    formatMoney(igv, monedaSalida) +
    "</span></div>" +
    '<div class="flex justify-between font-bold pt-1 mt-1" style="border-top:1px solid var(--border)"><span>Total</span><span style="color:var(--accent)">' +
    formatMoney(total, monedaSalida) +
    "</span></div>";
}

async function createQuote() {
  if (!APP.cart.length) {
    toast("Carrito vacío", "error");
    return;
  }
  var cliente = trimMax(
    document.getElementById("quote-cliente").value,
    VALID.maxLen.cliente,
  );
  if (!cliente) {
    toast("Ingresa el nombre del cliente", "error");
    return;
  }
  var ruc = trimMax(
    (document.getElementById("quote-ruc") || {}).value || "",
    VALID.maxLen.ruc,
  );
  if (ruc && !VALID.ruc.test(ruc)) {
    toast(
      "RUC inválido (debe tener 11 dígitos y empezar con 10/15/17/20)",
      "error",
    );
    return;
  }
  var proyecto = trimMax(
    document.getElementById("quote-proyecto").value,
    VALID.maxLen.proyecto,
  );
  var notas = trimMax(
    document.getElementById("quote-notas").value,
    VALID.maxLen.notas,
  );
  var monedaSalida =
    document.getElementById("quote-moneda").value === "USD" ? "USD" : "PEN";
  var tc = parseFloat(document.getElementById("quote-tc").value);
  if (isNaN(tc) || tc <= 0 || tc > 1000) {
    toast("Tipo de cambio fuera de rango (0 a 1000)", "error");
    return;
  }
  APP.quoteCounter++;
  var now = new Date();
  var fecha = now.toLocaleDateString("es-PE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  var total = 0;
  var items = APP.cart.map(function (item) {
    var monedaOrigen = item.moneda || "PEN";
    var precioSalida = convertirPrecio(
      item.precioUnitario,
      monedaOrigen,
      monedaSalida,
      tc,
    );
    var sub = item.cantidad * precioSalida;
    total += sub;
    // Snapshot del nombre y unidad — si luego se borra el producto o variante,
    // la cotización mantiene la información.
    var info = resolveCartItem(item) || { nombre: "(eliminado)", unidad: "" };
    return {
      productoId: item.parentId || item.id, // id del producto padre
      varianteId: item.parentId ? item.id : null,
      productoNombre: info.nombre, // snapshot "Producto — Variante"
      productoUnidad: info.unidad,
      cantidad: item.cantidad,
      precioUnitarioOrigen: item.precioUnitario,
      monedaOrigen: monedaOrigen,
      precioUnitario: precioSalida,
      subtotal: sub,
    };
  });

  const clienteDb = await getOrCreateCliente(cliente, ruc);
  var quote = {
    id: "q" + Date.now(),
    numero: APP.quoteCounter,
    cliente: cliente,
    ruc: ruc,
    proyecto: proyecto,
    notas: notas,
    fecha: fecha,
    items: items,
    total: total,
    estado: "enviada",
    moneda: monedaSalida,
    tipoCambio: tc,
    createdAt: now.toISOString(),
  };
  try {
    const subtotal = total / 1.18;

    const igv = total - subtotal;

    const { data: cotizacion, error } = await supabaseClient
      .from("cotizaciones")
      .insert([
        {
          numero: quote.numero,

          cliente_id: clienteDb.id,

          cliente_nombre: cliente,

          proyecto: proyecto,

          notas: notas,

          moneda_salida: monedaSalida,

          tipo_cambio_aplicado: tc,

          subtotal: subtotal,

          igv: igv,

          total: total,

          estado: "enviada",
        },
      ])
      .select()
      .single();

    if (error) throw error;

    const itemsDb = items.map(function (item, index) {
      return {
        cotizacion_id: cotizacion.id,

        producto_id: item.productoId,

        variante_id: item.varianteId,

        producto_nombre: item.productoNombre,

        producto_unidad: item.productoUnidad,

        cantidad: item.cantidad,

        precio_unitario_origen: item.precioUnitarioOrigen,

        moneda_origen: item.monedaOrigen,

        precio_unitario_salida: item.precioUnitario,

        subtotal: item.subtotal,

        orden: index,
      };
    });

    const { error: itemsError } = await supabaseClient
      .from("cotizacion_items")
      .insert(itemsDb);

    if (itemsError) throw itemsError;

    APP.quotes = await getCotizaciones();
  } catch (error) {
    console.error(error);

    toast("Error al guardar cotización: " + error.message, "error");

    return;
  }
  APP.cart = [];
  updateCartBadge();
  closeModal();
  generatePDF(quote.id);
  var cotNum = String(quote.numero).padStart(4, "0");
  setTimeout(function () {
    document.getElementById("modal-body").innerHTML =
      '<div class="p-8 text-center"><div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style="background:rgba(107,159,120,0.12)"><i class="fas fa-check text-2xl" style="color:var(--success)"></i></div><h3 class="text-xl font-bold mb-2">Cotización Creada</h3><p class="mb-1" style="color:var(--muted)">COT-' +
      esc(cotNum) +
      " — " +
      esc(quote.cliente) +
      '</p><p class="text-2xl font-bold my-4" style="color:var(--accent)">' +
      formatMoney(total, monedaSalida) +
      '</p><p class="text-sm mb-6" style="color:var(--muted)">El PDF se ha descargado automáticamente.</p><div class="flex flex-col sm:flex-row gap-3 justify-center"><button class="btn-primary" onclick="shareQuote(\'' +
      esc(quote.id) +
      '\')"><i class="fas fa-share"></i> Enviar al Cliente</button><button class="btn-secondary" onclick="closeModal();navigateTo(\'quotes\')"><i class="fas fa-list"></i> Ver Cotizaciones</button><button class="btn-secondary" onclick="closeModal()"><i class="fas fa-xmark"></i> Cerrar</button></div></div>';
    openModal();
  }, 500);
}

function shareQuote(id) {
  var q = APP.quotes.find(function (qu) {
    return qu.id === id;
  });
  if (!q) return;
  var empresa = APP.config?.nombre || "Polyline SAC";
  var subject = encodeURIComponent(
    "Cotización COT-" + String(q.numero).padStart(4, "0") + " — " + empresa,
  );
  var body = encodeURIComponent(
    "Estimado/a " +
      q.cliente +
      ",\n\nAdjunto encontrará la cotización COT-" +
      String(q.numero).padStart(4, "0") +
      " correspondiente a " +
      (q.proyecto || "su proyecto") +
      ".\n\nTotal: " +
      formatMoney(q.total, q.moneda || "PEN") +
      "\n\nQuedamos atentos a sus comentarios.\n\n" +
      empresa,
  );
  window.location.href = "mailto:?subject=" + subject + "&body=" + body;
  toast("Abriendo cliente de correo...", "info");
}

// Generación de PDF con jsPDF
function generatePDF(id) {
  var q = APP.quotes.find(function (qu) {
    return qu.id === id;
  });
  if (!q) return;
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF("p", "mm", "a4");
  var empresa = APP.config?.nombre || "Polyline SAC";

  var encargado = APP.config?.encargado || "";

  var email = APP.config?.email || "";

  var tel = APP.config?.telefono || "";

  var dir = APP.config?.direccion || "";

  var condiciones = APP.config?.condiciones || "";
  var monedaQ = MONEDAS[q.moneda] ? MONEDAS[q.moneda] : MONEDAS.PEN;
  var simboloMoneda = monedaQ.simbolo;
  var localeMoneda = monedaQ.locale;
  var accent = [200, 149, 108];
  var dark = [30, 30, 30];
  var gray = [120, 115, 110];
  var lightGray = [220, 216, 210];
  var y = 20;

  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, 210, 4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text(empresa, 20, y + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(gray[0], gray[1], gray[2]);
  var contactY = y + 16;
  if (encargado) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text(encargado, 20, contactY);
    contactY += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(gray[0], gray[1], gray[2]);
  }
  if (tel) {
    doc.text("Tel: " + tel, 20, contactY);
    contactY += 4;
  }
  if (email) {
    doc.text(email, 20, contactY);
    contactY += 4;
  }
  if (dir) {
    var dirLines = doc.splitTextToSize(dir, 90);
    doc.text(dirLines, 20, contactY);
    contactY += dirLines.length * 3.5;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text("COTIZACION", 190, y + 10, { align: "right" });
  doc.setFontSize(20);
  doc.text(String(q.numero).padStart(4, "0"), 190, y + 20, { align: "right" });

  y = contactY + 4;
  doc.setDrawColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.setLineWidth(0.5);
  doc.line(20, y, 190, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text("CLIENTE", 20, y);
  doc.text("FECHA", 120, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(q.cliente, 20, y);
  doc.text(q.fecha, 120, y);
  y += 5;
  if (q.proyecto) {
    doc.setFontSize(8);
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text("Proyecto: " + q.proyecto, 20, y);
    y += 5;
  }
  if (q.ruc) {
    doc.setFontSize(8);
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text("RUC: " + q.ruc, 20, y);
    y += 5;
  }
  // Moneda y TC (solo informativo si es USD o si hubo conversión)
  doc.setFontSize(8);
  doc.setTextColor(gray[0], gray[1], gray[2]);
  var infoMoneda = "Moneda: " + (q.moneda || "PEN");
  if (q.tipoCambio)
    infoMoneda += "  |  Tipo de Cambio: " + Number(q.tipoCambio).toFixed(4);
  doc.text(infoMoneda, 20, y);
  y += 5;
  y += 4;

  doc.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.rect(20, y, 170, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text("#", 22, y + 5.5);
  doc.text("PRODUCTO", 30, y + 5.5);
  doc.text("CANT.", 120, y + 5.5);
  doc.text("P. UNIT.", 140, y + 5.5);
  doc.text("SUBTOTAL", 168, y + 5.5);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(dark[0], dark[1], dark[2]);

  q.items.forEach(function (item, i) {
    var p = APP.products.find(function (pr) {
      return pr.id === item.productoId;
    });
    var nombre = item.productoNombre || (p ? p.nombre : "Producto eliminado");
    var unidad = item.productoUnidad || (p ? p.unidad : "");
    if (i % 2 === 0) {
      doc.setFillColor(248, 246, 243);
      doc.rect(20, y - 4, 170, 8, "F");
    }
    doc.setTextColor(gray[0], gray[1], gray[2]);
    doc.text(String(i + 1), 22, y);
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.text(
      nombre.length > 55 ? nombre.substring(0, 55) + "..." : nombre,
      30,
      y,
    );
    doc.text(item.cantidad + " " + unidad, 120, y);
    doc.text(
      simboloMoneda +
        " " +
        item.precioUnitario.toLocaleString(localeMoneda, {
          minimumFractionDigits: 2,
        }),
      140,
      y,
    );
    doc.setFont("helvetica", "bold");
    doc.text(
      simboloMoneda +
        " " +
        item.subtotal.toLocaleString(localeMoneda, {
          minimumFractionDigits: 2,
        }),
      168,
      y,
    );
    doc.setFont("helvetica", "normal");
    y += 8;
  });

  y += 2;
  doc.setDrawColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.setLineWidth(0.5);
  doc.line(130, y, 190, y);
  y += 6;

  var subtotalVal = q.total / 1.18;
  var igvVal = q.total - subtotalVal;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(gray[0], gray[1], gray[2]);
  doc.text("SUBTOTAL (Base Imp.)", 130, y);
  doc.text(
    simboloMoneda +
      " " +
      subtotalVal.toLocaleString(localeMoneda, { minimumFractionDigits: 2 }),
    190,
    y,
    { align: "right" },
  );
  y += 5.5;

  doc.text("IGV (18%)", 130, y);
  doc.text(
    simboloMoneda +
      " " +
      igvVal.toLocaleString(localeMoneda, { minimumFractionDigits: 2 }),
    190,
    y,
    { align: "right" },
  );
  y += 5.5;

  doc.setDrawColor(dark[0], dark[1], dark[2]);
  doc.setLineWidth(0.8);
  // draw a short divider under the right column (amounts) so it doesn't cross labels like 'IGV'
  var lineY = y + 2;
  var lineXStart = 150; // start further right to avoid overlapping the 'IGV (18%)' label at x=130
  doc.line(lineXStart, lineY, 190, lineY);

  y = lineY + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(dark[0], dark[1], dark[2]);
  doc.text("TOTAL", 130, y);
  doc.setFontSize(15);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(
    simboloMoneda +
      " " +
      q.total.toLocaleString(localeMoneda, { minimumFractionDigits: 2 }),
    190,
    y,
    { align: "right" },
  );

  y += 16;
  doc.setDrawColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.setLineWidth(0.3);
  doc.line(20, y, 190, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(gray[0], gray[1], gray[2]);
  doc.text("CONDICIONES", 20, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  var condLines = doc.splitTextToSize(condiciones, 170);
  doc.text(condLines, 20, y);
  y += condLines.length * 3.5 + 4;

  if (q.notas) {
    y += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("NOTAS", 20, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    var notaLines = doc.splitTextToSize(q.notas, 170);
    doc.text(notaLines, 20, y);
  }

  var pageH = doc.internal.pageSize.height;
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, pageH - 6, 210, 6, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text(
    empresa + (tel ? "  |  " + tel : "") + (email ? "  |  " + email : ""),
    105,
    pageH - 2.5,
    { align: "center" },
  );

  doc.save(
    "COT-" +
      String(q.numero).padStart(4, "0") +
      "_" +
      q.cliente.replace(/\s+/g, "_") +
      ".pdf",
  );
  toast("PDF descargado", "success");
}

// Pantalla para tour guiado
function startTour() {
  if (APP.tourActive) {
    stopTour();
    return;
  }
  APP.tourActive = true;
  APP.tourStep = 0;
  showTourStep();
}
function stopTour() {
  APP.tourActive = false;
  document.querySelectorAll(".tour-overlay-bg").forEach(function (el) {
    el.remove();
  });
  document.querySelectorAll(".tour-tooltip").forEach(function (el) {
    el.remove();
  });
}

var TOUR_STEPS = [
  {
    title: "Bienvenido al Tour",
    text: "Te guiaré por las 8 categorías de acabados disponibles. Cada una contiene productos seleccionados para tus proyectos.",
    cat: null,
  },
];
CATEGORIAS.forEach(function (c) {
  TOUR_STEPS.push({
    title: c.nombre,
    text:
      "Aquí encontrarás todos los acabados de " +
      c.nombre.toLowerCase() +
      ". Desliza para ver los productos con precios actualizados.",
    cat: c.id,
  });
});
TOUR_STEPS.push({
  title: "Cotización en Tiempo Real",
  text: "Durante la presentación puedes agregar productos al carrito presionando el botón +. Al finalizar, genera una cotización PDF al instante.",
  cat: null,
});

function showTourStep() {
  if (!APP.tourActive) return;
  document.querySelectorAll(".tour-overlay-bg").forEach(function (el) {
    el.remove();
  });
  document.querySelectorAll(".tour-tooltip").forEach(function (el) {
    el.remove();
  });
  var step = TOUR_STEPS[APP.tourStep];
  var bg = document.createElement("div");
  bg.className = "tour-overlay-bg";
  document.body.appendChild(bg);

  var tooltip = document.createElement("div");
  tooltip.className = "tour-tooltip";
  var prevBtn =
    APP.tourStep > 0
      ? '<button class="btn-secondary text-xs" onclick="prevTourStep()"><i class="fas fa-arrow-left"></i> Anterior</button>'
      : "";
  var nextBtn =
    APP.tourStep < TOUR_STEPS.length - 1
      ? '<button class="btn-primary text-xs" onclick="nextTourStep()">Siguiente <i class="fas fa-arrow-right"></i></button>'
      : '<button class="btn-primary text-xs" onclick="stopTour()"><i class="fas fa-check"></i> Finalizar Tour</button>';
  tooltip.innerHTML =
    '<div class="flex items-center justify-between mb-3"><span class="text-xs font-semibold px-2 py-0.5 rounded" style="background:var(--accent-glow);color:var(--accent)">' +
    (APP.tourStep + 1) +
    " / " +
    TOUR_STEPS.length +
    '</span><button onclick="stopTour()" style="color:var(--muted);cursor:pointer;background:none;border:none;font-size:16px"><i class="fas fa-xmark"></i></button></div><h4 class="text-lg font-bold mb-2" style="font-family:\'Playfair Display\',serif">' +
    esc(step.title) +
    '</h4><p class="text-sm mb-4" style="color:var(--fg2)">' +
    esc(step.text) +
    '</p><div class="flex gap-2 justify-end">' +
    prevBtn +
    nextBtn +
    "</div>";

  if (step.cat) {
    APP.activeCat = step.cat;
    renderPage();
    setTimeout(function () {
      var firstCard = document.querySelector(".product-card");
      if (firstCard) {
        var rect = firstCard.getBoundingClientRect();
        tooltip.style.top = Math.max(80, rect.top - 20) + "px";
        tooltip.style.left =
          Math.min(window.innerWidth - 400, Math.max(20, rect.left)) + "px";
      } else {
        tooltip.style.top = "100px";
        tooltip.style.left = "50%";
        tooltip.style.transform = "translateX(-50%)";
      }
    }, 100);
  } else {
    tooltip.style.top = "100px";
    tooltip.style.left = "50%";
    tooltip.style.transform = "translateX(-50%)";
  }
  document.body.appendChild(tooltip);
}
function nextTourStep() {
  APP.tourStep++;
  showTourStep();
}
function prevTourStep() {
  APP.tourStep = Math.max(0, APP.tourStep - 1);
  showTourStep();
}

// Modal genérico
function openModal() {
  document.getElementById("modal-overlay").classList.add("show");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("show");
  document.body.style.overflow = "";
  // Restaurar ancho default del modal (la calculadora lo ensancha temporalmente).
  var mc = document.querySelector(".modal-content");
  if (mc) mc.style.maxWidth = "";
}
document
  .getElementById("modal-overlay")
  .addEventListener("click", function (e) {
    if (e.target === e.currentTarget) closeModal();
  });

// Enter dentro del modal NO debe disparar acciones (crear/guardar). El usuario
// decide cuándo enviar haciendo click en el botón. Excepciones:
//  - <textarea>: Enter es salto de línea legítimo
//  - <button>: foco con Enter = click (es lo esperado)
document
  .getElementById("modal-overlay")
  .addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var tag = (
      e.target && e.target.tagName ? e.target.tagName : ""
    ).toUpperCase();
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
  });

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeModal();
    closeCart();
    stopTour();
  }
});

function toast(msg, type) {
  type = type || "info";
  var container = document.getElementById("toast-container");
  if (!container) return;
  var t = document.createElement("div");
  t.className = "toast " + type;
  var icons = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    info: "fa-circle-info",
  };
  // Construir nodos manualmente — msg puede contener input del usuario.
  var i = document.createElement("i");
  i.className = "fas " + (icons[type] || icons.info);
  var sp = document.createElement("span");
  sp.textContent = String(msg == null ? "" : msg);
  t.appendChild(i);
  t.appendChild(sp);
  container.appendChild(t);
  setTimeout(function () {
    t.style.opacity = "0";
    t.style.transform = "translateX(20px)";
    t.style.transition = "all 0.3s";
    setTimeout(function () {
      t.remove();
    }, 300);
  }, 3000);
}

// Fondo animado de partículas
(function () {
  var canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.4";
  document.body.prepend(canvas);
  var ctx = canvas.getContext("2d");
  var w,
    h,
    particles = [];
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);
  for (var i = 0; i < 35; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.5 + 0.5,
      dx: (Math.random() - 0.5) * 0.3,
      dy: (Math.random() - 0.5) * 0.3,
      o: Math.random() * 0.5 + 0.1,
    });
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.1, p.r), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(200,149,108," + p.o + ")";
      ctx.fill();
      for (var j = i + 1; j < particles.length; j++) {
        var dx2 = p.x - particles[j].x,
          dy2 = p.y - particles[j].y;
        var dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (dist < 140) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = "rgba(200,149,108," + 0.06 * (1 - dist / 140) + ")";
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) draw();
})();


window.addEventListener("load", async () => {

  const tieneSesion = await checkSession();

  if (!tieneSesion) {
    document.getElementById("login-screen").style.display = "flex";
  }

});