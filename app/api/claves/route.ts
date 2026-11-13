import { ZONA } from "@/lib/agenda";
import type { ErrorApi, NombreClave } from "@/lib/api-tipos";
import { borrarClave, CLAVES_DESDE_EL_PANEL, clavesGuardadas, comprobarClaveClaude, guardarClave, nombreClaveVoz } from "@/lib/claves";
import { modeloEfectivo } from "@/lib/configuracion";
import { configuracionActiva } from "@/lib/configuracion-servidor";
import { ErrorCrm, explicar, type CodigoError, type ErrorExplicado } from "@/lib/errores";
import { appDelToken, caducidad, comprobarSecreto } from "@/lib/meta";
import { abrirTunel } from "@/lib/tunel";

// Las claves que se pegan en la app, una a una: cada campo se guarda en cuanto se pega, con lo que se
// puede comprobar de él solo. Nunca se devuelve un valor: solo cómo termina. El cuerpo de la petición
// no se escribe en ningún registro. Las tres de Meta (token, clave secreta y ngrok) se guardan aquí
// también desde «Conecta tu WhatsApp»; «Conectar» hace luego el resto con las guardadas.

export const dynamic = "force-dynamic";

const NO_HAY_ARCHIVO = "No se pueden guardar claves en este servidor de pruebas";
const DOS_DIAS_MS = 48 * 3600_000;
const TIEMPO_VOZ_MS = 5_000;

type Respuesta = Response;

function errorApi(status: number, error: string, extra: Omit<ErrorApi, "ok" | "error"> = {}): Respuesta {
  return Response.json({ ok: false, error, ...extra } satisfies ErrorApi, { status });
}

/** «{titulo}. {solucion}»; un título que ya acaba en punto se deja tal cual. */
function frase(e: ErrorExplicado): string {
  const titulo = e.titulo.endsWith(".") ? e.titulo : `${e.titulo}.`;
  return e.solucion ? `${titulo} ${e.solucion}` : titulo;
}

function conCodigo(status: number, e: ErrorExplicado): Respuesta {
  return errorApi(status, frase(e), { codigo: e.codigo });
}

async function guardar(nombre: NombreClave, valor: string, extra: Record<string, unknown> = {}): Promise<Respuesta> {
  const r = await guardarClave(nombre, valor);
  if (!r.ok) return errorApi(r.error === NO_HAY_ARCHIVO ? 409 : 500, r.error);
  return Response.json({ ok: true, terminaEn: r.terminaEn, ...extra });
}

/** Guardada, pero ahora no se puede usar: 200 con el aviso. */
async function guardarConAviso(nombre: NombreClave, valor: string, e: ErrorExplicado): Promise<Respuesta> {
  const r = await guardarClave(nombre, valor);
  if (!r.ok) return errorApi(r.error === NO_HAY_ARCHIVO ? 409 : 500, r.error);
  return Response.json({ ok: false, guardada: true, error: frase(e), codigo: e.codigo });
}

/** «12 de noviembre a las 10:30» en la zona del negocio. */
function fecha(segundos: number, zona: string): string {
  const partes = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zona }).formatToParts(new Date(segundos * 1000));
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")} de ${parte("month")} a las ${parte("hour")}:${parte("minute")}`;
}

async function configuracion() {
  try {
    return (await configuracionActiva()).config;
  } catch {
    return null;
  }
}

function caducaPronto(expira: number | null): boolean {
  return expira !== null && expira > 0 && expira * 1000 - Date.now() < DOS_DIAS_MS;
}

async function textoCaducidad(expira: number): Promise<string> {
  const zona = (await configuracion())?.calendario.zona || ZONA;
  return `Ese token caduca el ${fecha(expira, zona)}. Usa el token permanente del usuario del sistema: el de la pantalla de inicio de Meta caduca en 24 h.`;
}

const SECRETO_AJENO: ErrorExplicado = {
  codigo: "meta.firma",
  titulo: "Esa clave secreta no es de la app de tu token",
  solucion: "Cópiala otra vez de la configuración básica de tu app en Meta.",
};

function errorLanzado(error: unknown): Respuesta {
  const codigo: CodigoError = error instanceof ErrorCrm ? error.codigo : "desconocido";
  return conCodigo(502, explicar(codigo === "red" ? "red" : "desconocido"));
}

async function claveClaude(valor: string): Promise<Respuesta> {
  const config = await configuracion();
  const modelo = config ? modeloEfectivo(config.sistema, process.env.MODELO) : undefined;
  const r = await comprobarClaveClaude(valor, modelo);
  if (r.ok) return guardar("ANTHROPIC_API_KEY", valor);
  if (r.guardable) return guardarConAviso("ANTHROPIC_API_KEY", valor, r.error);
  return conCodigo(r.error.codigo === "claude.clave" ? 400 : 502, r.error);
}

/**
 * El token de Meta, en cuanto se pega: que valga y que no caduque pronto (para eso hace falta la clave
 * secreta; si aún no está, lo mira «Conectar»). Meta lo enseña una sola vez, así que si es válido se
 * guarda aunque la clave secreta guardada sea de otra app: se avisa y se cambia la clave secreta.
 */
async function tokenMeta(valor: string): Promise<Respuesta> {
  try {
    if (!(await appDelToken(valor))) return conCodigo(400, explicar("meta.token"));
    const expira = await caducidad(valor);
    if (caducaPronto(expira)) return errorApi(400, await textoCaducidad(expira!), { codigo: "meta.token" });
    const secreto = process.env.META_APP_SECRET?.trim();
    if (secreto && (await comprobarSecreto(valor, secreto)) === false) return guardarConAviso("WHATSAPP_TOKEN", valor, SECRETO_AJENO);
  } catch (error) {
    // Sin red no se puede comprobar, pero no se pierde: «Conectar» lo comprueba luego.
    if (error instanceof ErrorCrm && error.codigo === "red") return guardarConAviso("WHATSAPP_TOKEN", valor, explicar("red"));
    return errorLanzado(error);
  }
  return guardar("WHATSAPP_TOKEN", valor);
}

/**
 * La clave secreta, en cuanto se pega. Con el token ya guardado se comprueban juntos: si no es de su
 * app no se guarda; si es suya, ya se puede leer la caducidad del token y, si caduca pronto, se avisa.
 */
async function secretoMeta(valor: string): Promise<Respuesta> {
  const token = process.env.WHATSAPP_TOKEN?.trim() || undefined;
  try {
    if (token && (await comprobarSecreto(token, valor)) === false) {
      return errorApi(400, frase(SECRETO_AJENO), { codigo: SECRETO_AJENO.codigo });
    }
  } catch (error) {
    // Sin red no se puede comprobar con el token, pero tampoco se pierde lo pegado: «Conectar» lo comprueba luego.
    if (error instanceof ErrorCrm && error.codigo === "red") return guardarConAviso("META_APP_SECRET", valor, explicar("red"));
    return errorLanzado(error);
  }
  const r = await guardarClave("META_APP_SECRET", valor);
  if (!r.ok) return errorApi(r.error === NO_HAY_ARCHIVO ? 409 : 500, r.error);
  if (token) {
    try {
      if (!(await appDelToken(token))) return Response.json({ ok: false, guardada: true, error: frase(explicar("meta.token")), codigo: "meta.token" });
      const expira = await caducidad(token);
      if (caducaPronto(expira)) return Response.json({ ok: false, guardada: true, error: await textoCaducidad(expira!), codigo: "meta.token" });
    } catch {
      // Guardada; el token lo vuelve a comprobar «Conectar».
    }
  }
  return Response.json({ ok: true, terminaEn: r.terminaEn });
}

async function claveNgrok(valor: string): Promise<Respuesta> {
  const anterior = process.env.NGROK_AUTHTOKEN?.trim() || null;
  const r = await guardarClave("NGROK_AUTHTOKEN", valor);
  if (!r.ok) return errorApi(r.error === NO_HAY_ARCHIVO ? 409 : 500, r.error);
  const listo = { ok: true, terminaEn: r.terminaEn };
  if (process.env.BD_LOCAL) return Response.json({ ...listo, nota: "En el servidor de pruebas no se abre el túnel" });
  const dominio = process.env.CRM_DOMINIO?.trim();
  if (dominio) return Response.json({ ...listo, nota: `No hace falta túnel: tu servidor recibe los mensajes en https://${dominio}` });
  const publica = process.env.CRM_URL_PUBLICA?.trim();
  if (publica) return Response.json({ ...listo, nota: `No hace falta túnel: los mensajes llegan a ${publica}` });
  const tunel = await abrirTunel({ token: valor });
  if (tunel.abierto) return Response.json({ ...listo, nota: "Túnel abierto: los mensajes llegan a este ordenador" });
  const error = tunel.error ?? explicar("desconocido");
  if (error.codigo === "ngrok.token") {
    if (anterior) await guardarClave("NGROK_AUTHTOKEN", anterior);
    else await borrarClave("NGROK_AUTHTOKEN");
    return conCodigo(400, error);
  }
  return Response.json({ ok: false, guardada: true, error: frase(error), codigo: error.codigo });
}

const PROVEEDORES = {
  GEMINI_API_KEY: { nombre: "Google" },
  GROQ_API_KEY: { nombre: "Groq" },
  OPENAI_API_KEY: { nombre: "OpenAI" },
} as const;

/** La petición de comprobación de cada proveedor, como la hace la comprobación de la instalación. */
function peticionVoz(nombre: keyof typeof PROVEEDORES, valor: string): { url: string; cabeceras: Record<string, string> } {
  const base = process.env.TRANSCRIPCION_BASE_URL;
  if (nombre === "GEMINI_API_KEY") {
    return {
      url: `${base || "https://generativelanguage.googleapis.com/v1beta"}/models/${process.env.TRANSCRIPCION_MODELO || "gemini-3.5-transcribe"}`,
      cabeceras: { "x-goog-api-key": valor },
    };
  }
  const url = nombre === "GROQ_API_KEY" ? `${base || "https://api.groq.com/openai/v1"}/models` : `${base || "https://api.openai.com/v1"}/models`;
  return { url, cabeceras: { Authorization: `Bearer ${valor}` } };
}

async function claveVoz(nombre: NombreClave, valor: string): Promise<Respuesta> {
  const detectado = nombreClaveVoz(valor);
  if (!detectado) return errorApi(400, "No reconozco esa clave: tiene que ser de Google (empieza por AIza), de Groq (gsk_) o de OpenAI (sk-)", { campo: "valor" });
  const proveedor = PROVEEDORES[detectado].nombre;
  const { url, cabeceras } = peticionVoz(detectado, valor);
  let status: number;
  try {
    status = (await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(TIEMPO_VOZ_MS) })).status;
  } catch {
    return conCodigo(502, explicar("red"));
  }
  if (status === 200) return guardar(detectado, valor, detectado !== nombre ? { nota: `Guardada como clave de ${proveedor}` } : {});
  if (status === 400 || status === 401 || status === 403) return errorApi(400, `Esa clave de ${proveedor} no es válida. Cópiala otra vez de su web.`, { campo: "valor" });
  if (status === 404) return errorApi(400, `Tu clave de ${proveedor} no tiene acceso al modelo de transcripción`, { campo: "valor" });
  return conCodigo(502, explicar("desconocido"));
}

export async function GET() {
  return Response.json({ claves: clavesGuardadas() });
}

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => null)) as { nombre?: unknown; valor?: unknown } | null;
  const nombre = cuerpo?.nombre;
  if (typeof nombre !== "string" || !(CLAVES_DESDE_EL_PANEL as readonly string[]).includes(nombre)) {
    return errorApi(400, "Esa clave no se puede guardar desde aquí", { campo: "nombre" });
  }
  const valor = String(cuerpo?.valor ?? "").trim();
  if (/[\r\n\0]/.test(valor)) return errorApi(400, "Esa clave lleva un salto de línea: vuelve a copiarla", { campo: "valor" });
  if (valor.length < 8 || valor.length > 500) return errorApi(400, "Esa clave parece incompleta", { campo: "valor" });

  switch (nombre as NombreClave) {
    case "ANTHROPIC_API_KEY":
      return claveClaude(valor);
    case "WHATSAPP_TOKEN":
      return tokenMeta(valor);
    case "META_APP_SECRET":
      return secretoMeta(valor);
    case "NGROK_AUTHTOKEN":
      return claveNgrok(valor);
    default:
      return claveVoz(nombre as NombreClave, valor);
  }
}
