import type { ErrorApi } from "@/lib/api-tipos";
import { borrarClave, guardarClave } from "@/lib/claves";
import { ipDeCabecera } from "@/lib/freno";
import { log, logAviso } from "@/lib/log";
import {
  asegurarSecreto,
  cabeceraCookie,
  codigoAltaValido,
  comprobarClave,
  cookieCaducada,
  errorDeClavePanel,
  firmarSesion,
  hashClave,
  intentoLogin,
  olvidarIntentos,
} from "@/lib/sesion";
import { modoServidor } from "@/lib/tunel";

// La sesión del panel en modo servidor: crear la contraseña con el código de alta (una sola vez),
// entrar, cambiarla y salir. En local no existe. Nunca se escribe aquí una contraseña, un hash, el
// secreto ni el código (I16).

export const dynamic = "force-dynamic";

const TEXTO_ALTA = "El código de alta no es correcto o hay demasiados intentos. Espera unos minutos.";
const TEXTO_ENTRAR = "Contraseña incorrecta o demasiados intentos. Espera unos minutos.";
const TEXTO_FALLO = "No se ha podido crear la sesión. Vuelve a intentarlo.";

function responder(cuerpo: { ok: true } | ErrorApi, status = 200, cookie?: string): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(cuerpo, { status, headers });
}

const error = (status: number, texto: string, campo?: string) => responder({ ok: false, error: texto, ...(campo ? { campo } : {}) }, status);
const conSesionNueva = () => responder({ ok: true }, 200, cabeceraCookie(firmarSesion(Date.now())));
const noEncontrado = () => error(404, "No encontrado");

/** La IP del visitante, la que añade Caddy. Sin ella, todos comparten un mismo cupo de intentos. */
const ipDe = (request: Request) => ipDeCabecera(request.headers.get("x-forwarded-for")) ?? "sin-ip";

const hayClave = () => !!process.env.CLAVE_PANEL_HASH;

async function cuerpoDe(request: Request): Promise<Record<string, unknown>> {
  const leido = (await request.json().catch(() => null)) as unknown;
  return typeof leido === "object" && leido !== null && !Array.isArray(leido) ? (leido as Record<string, unknown>) : {};
}

const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");

// Crear la contraseña, de una en una: dos peticiones a la vez nunca gastan el mismo código.
let cola: Promise<unknown> = Promise.resolve();
function enExclusiva<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = cola.then(tarea, tarea);
  cola = resultado.catch(() => undefined);
  return resultado;
}

async function crear(ip: string, codigo: string, clave: unknown): Promise<Response> {
  if (!intentoLogin(ip, Date.now()).permitido) return error(429, TEXTO_ALTA);
  if (hayClave()) return error(409, "Ya hay contraseña: entra con ella.");
  if (!process.env.CODIGO_ALTA) return error(409, "Pide el código de alta a quien instaló el CRM");
  if (!codigoAltaValido(codigo)) return error(401, TEXTO_ALTA);
  const fallo = errorDeClavePanel(clave);
  if (fallo) return error(400, fallo, "clave");

  return enExclusiva(async () => {
    if (hayClave()) return error(409, "Ya hay contraseña: entra con ella.");
    if (!codigoAltaValido(codigo)) return error(401, TEXTO_ALTA);
    // Primero el secreto: si no se puede guardar, el código sigue valiendo.
    await asegurarSecreto();
    const guardado = await guardarClave("CLAVE_PANEL_HASH", await hashClave(clave as string));
    if (!guardado.ok) return error(500, TEXTO_FALLO);
    try {
      await borrarClave("CODIGO_ALTA");
    } catch {
      logAviso("No se ha podido quitar el código de alta del archivo de claves: ya no vale, pero conviene borrarlo a mano");
    }
    // Venga del archivo o del entorno del proceso, el código muere aquí.
    delete process.env.CODIGO_ALTA;
    olvidarIntentos(ip);
    log("Contraseña del panel creada");
    return conSesionNueva();
  });
}

async function entrar(ip: string, clave: string): Promise<Response> {
  if (!intentoLogin(ip, Date.now()).permitido) return error(429, TEXTO_ENTRAR);
  const hash = process.env.CLAVE_PANEL_HASH;
  if (!hash) return error(409, "Primero crea la contraseña del panel");
  if (!(await comprobarClave(clave, hash))) return error(401, TEXTO_ENTRAR);
  await asegurarSecreto();
  olvidarIntentos(ip);
  return conSesionNueva();
}

export async function GET() {
  if (!modoServidor()) return noEncontrado();
  // Solo llega aquí con una sesión válida: la ha mirado proxy.ts.
  return responder({ ok: true });
}

export async function POST(request: Request) {
  if (!modoServidor()) return noEncontrado();
  try {
    const cuerpo = await cuerpoDe(request);
    const ip = ipDe(request);
    if (Object.hasOwn(cuerpo, "codigo")) return await crear(ip, texto(cuerpo.codigo), cuerpo.clave);
    return await entrar(ip, texto(cuerpo.clave));
  } catch {
    logAviso("No se ha podido crear la sesión del panel");
    return error(500, TEXTO_FALLO);
  }
}

export async function PUT(request: Request) {
  if (!modoServidor()) return noEncontrado();
  try {
    const cuerpo = await cuerpoDe(request);
    const ip = ipDe(request);
    if (!intentoLogin(ip, Date.now()).permitido) return error(429, TEXTO_ENTRAR);
    const hash = process.env.CLAVE_PANEL_HASH;
    if (!hash || !(await comprobarClave(texto(cuerpo.actual), hash))) return error(401, "La contraseña actual no es correcta");
    const fallo = errorDeClavePanel(cuerpo.nueva);
    if (fallo) return error(400, fallo, "nueva");
    await asegurarSecreto();
    const guardado = await guardarClave("CLAVE_PANEL_HASH", await hashClave(cuerpo.nueva as string));
    if (!guardado.ok) return error(500, TEXTO_FALLO);
    olvidarIntentos(ip);
    log("Contraseña del panel cambiada");
    // La huella de la cookie ha cambiado: todas las anteriores dejan de valer, esta no.
    return conSesionNueva();
  } catch {
    logAviso("No se ha podido cambiar la contraseña del panel");
    return error(500, TEXTO_FALLO);
  }
}

export async function DELETE() {
  if (!modoServidor()) return noEncontrado();
  return responder({ ok: true }, 200, cookieCaducada());
}
