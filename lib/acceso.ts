// Quién puede llegar a qué: toda la decisión de proxy.ts, sin Next ni process.env (proxy.ts solo
// traduce la petición y el entorno). En local el túnel de ngrok expone todo el puerto y desde fuera
// solo se puede llegar al webhook: /lead envía mensajes y /api/leads enseña los teléfonos y las
// conversaciones. En modo servidor (CRM_DOMINIO) la portada y el formulario son públicos y todo lo
// demás pide la sesión de la contraseña del panel (I21).

export interface PeticionAcceso {
  ruta: string;
  consulta: string;
  metodo: string;
  host: string | null;
  reenviado: string | null;
  sitio: string | null;
  origen: string | null;
  tipo: string | null;
  cookie: string | null;
}

export type DecisionAcceso =
  | { tipo: "pasa" }
  | { tipo: "respuesta"; status: 401 | 403 | 404 | 415; cuerpo: string; json?: boolean }
  | { tipo: "redirige"; a: string };

const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PUBLICAS = new Set(["/webhook", "/api/whatsapp/webhook"]);

const PASA: DecisionAcceso = { tipo: "pasa" };
const NO_ENCONTRADO: DecisionAcceso = { tipo: "respuesta", status: 404, cuerpo: "No encontrado" };
const PROHIBIDO: DecisionAcceso = { tipo: "respuesta", status: 403, cuerpo: "Prohibido" };
const SIN_JSON: DecisionAcceso = { tipo: "respuesta", status: 415, cuerpo: "Se esperaba JSON" };

function hostSinPuerto(valor: string | null): string | null {
  if (!valor) return null;
  return valor.split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
}

function origenLocal(origen: string): boolean {
  try {
    return LOCALES.has(new URL(origen).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Una web cualquiera abierta en el navegador no debe poder llamar a /lead ni a /api/*. */
function deOtraWeb(p: PeticionAcceso): boolean {
  return (p.ruta === "/lead" || p.ruta.startsWith("/api/")) && !!p.sitio && p.sitio !== "same-origin" && p.sitio !== "none";
}

const esEscritura = (metodo: string) => metodo !== "GET" && metodo !== "HEAD";
const esJson = (tipo: string | null) => !!tipo?.includes("application/json");

/** Modo local: exactamente el proxy.ts de siempre (I9). No mira nunca la sesión. */
function decidirLocal(p: PeticionAcceso): DecisionAcceso {
  if (PUBLICAS.has(p.ruta)) return PASA;

  const host = hostSinPuerto(p.host);
  const reenviado = hostSinPuerto(p.reenviado);
  if (!host || !LOCALES.has(host) || (reenviado && !LOCALES.has(reenviado))) return NO_ENCONTRADO;

  if (deOtraWeb(p)) return PROHIBIDO;
  if (esEscritura(p.metodo)) {
    if (p.origen && !origenLocal(p.origen)) return PROHIBIDO;
    if (!esJson(p.tipo)) return SIN_JSON;
  }
  return PASA;
}

// ─── Modo servidor ────────────────────────────────────────────────────────────────────────────────

/**
 * Lo único que se ve sin contraseña en modo servidor (I21). «GET» vale también para HEAD, «*» es
 * cualquier método, «/x/*» cualquier ruta que empiece por «/x/» y «?solo=firma» pide ese parámetro.
 */
export const RUTAS_PUBLICAS_SERVIDOR: readonly string[] = [
  "GET /",
  "GET /_next/*",
  "GET /fotos/*",
  "GET /icono.svg",
  "GET /favicon.ico",
  "GET /api/logo",
  "POST /lead",
  "* /webhook",
  "* /api/whatsapp/webhook",
  "GET /api/estado?solo=firma",
  "GET /entrar",
  "POST /api/sesion",
];

interface ReglaPublica {
  metodo: string;
  ruta: string;
  prefijo: boolean;
  parametro: [string, string] | null;
}

/** Las reglas salen de la lista de arriba, nunca de una segunda copia. */
const REGLAS_PUBLICAS: readonly ReglaPublica[] = RUTAS_PUBLICAS_SERVIDOR.map((entrada) => {
  const [metodo, resto] = entrada.split(" ");
  const [ruta, consulta] = resto.split("?");
  const prefijo = ruta.endsWith("/*");
  const par = consulta ? consulta.split("=") : null;
  return { metodo, ruta: prefijo ? ruta.slice(0, -1) : ruta, prefijo, parametro: par ? [par[0], par[1] ?? ""] : null };
});

function esPublica(metodo: string, ruta: string, consulta: string): boolean {
  return REGLAS_PUBLICAS.some((r) => {
    const metodoVale = r.metodo === "*" || r.metodo === metodo || (r.metodo === "GET" && metodo === "HEAD");
    if (!metodoVale) return false;
    if (r.prefijo ? !ruta.startsWith(r.ruta) : ruta !== r.ruta) return false;
    return !r.parametro || new URLSearchParams(consulta).get(r.parametro[0]) === r.parametro[1];
  });
}

const SIN_SESION = JSON.stringify({ ok: false, error: "Tienes que entrar con tu contraseña", codigo: "sesion" });

function decidirServidor(p: PeticionAcceso, dominio: string, sesionValida?: (cookie: string | null) => boolean): DecisionAcceso {
  // 1. El webhook, desde donde sea: la ruta mira la firma de Meta.
  if (PUBLICAS.has(p.ruta)) return PASA;

  // 2. Solo el dominio, también detrás de Caddy. localhost no vale aquí.
  const host = hostSinPuerto(p.host);
  const reenviado = hostSinPuerto(p.reenviado);
  if (host !== dominio || (reenviado && reenviado !== dominio)) return NO_ENCONTRADO;

  // 3. Lo mismo que en local: nada de /lead ni /api/* desde otra web.
  if (deOtraWeb(p)) return PROHIBIDO;

  // 4. Escrituras: desde el propio dominio por https y en JSON.
  if (esEscritura(p.metodo)) {
    if (p.origen !== `https://${dominio}`) return PROHIBIDO;
    if (!esJson(p.tipo)) return SIN_JSON;
  }

  // 5. Lo público no mira la sesión.
  if (esPublica(p.metodo, p.ruta, p.consulta)) return PASA;

  // 6. Con sesión, todo lo demás.
  if (sesionValida?.(p.cookie) === true) return PASA;

  // 7. Sin sesión: las páginas van a entrar y vuelven luego; las API y las escrituras, 401.
  if ((p.metodo === "GET" || p.metodo === "HEAD") && !p.ruta.startsWith("/api/") && p.ruta !== "/lead") {
    return { tipo: "redirige", a: "/entrar?volver=" + encodeURIComponent(p.ruta + p.consulta) };
  }
  return { tipo: "respuesta", status: 401, cuerpo: SIN_SESION, json: true };
}

export function decidirAcceso(p: PeticionAcceso, e: { dominio?: string; sesionValida?: (cookie: string | null) => boolean }): DecisionAcceso {
  const dominio = e.dominio?.trim().toLowerCase();
  if (!dominio) return decidirLocal(p);
  return decidirServidor(p, dominio, e.sesionValida);
}

const LARGO_MAXIMO_VOLVER = 512;

/** Adónde volver después de entrar: solo una ruta de este mismo sitio, y nunca otra vez a entrar. */
export function destinoSeguro(volver: string | null): string {
  if (!volver || volver.length > LARGO_MAXIMO_VOLVER) return "/panel";
  if (!volver.startsWith("/") || volver.startsWith("//") || volver.startsWith("/\\")) return "/panel";
  if (volver.startsWith("/entrar")) return "/panel";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(volver)) return "/panel";
  return volver;
}
