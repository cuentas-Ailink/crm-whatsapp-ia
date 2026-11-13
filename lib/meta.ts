// Meta (WhatsApp Business) desde el servidor: cuentas, números, plantillas, la suscripción de la app
// y adónde apunta el webhook. Solo en el servidor; toda llamada va por GRAPH_BASE_URL y ninguna
// respuesta devuelve un token. Los textos de Meta pasan por un censor antes de salir del proceso.

import { createHmac, randomBytes } from "node:crypto";
import { ZONA } from "./agenda";
import type { EstadoPlantilla, PasoMeta, PeticionConectarMeta, PlantillaAprobada, ResultadoPasoMeta } from "./api-tipos";
import { guardarClave } from "./claves";
import { configuracionActiva } from "./configuracion-servidor";
import { ErrorCrm, explicar, explicarMeta, type CodigoError, type ErrorExplicado } from "./errores";
import { log, logAviso } from "./log";
import { componentesParaMeta, variablesDe, type PlantillaApp } from "./plantillas";
import { formatoTelefono } from "./regional";
import { abrirTunel, modoServidor, tokenNgrok, urlPublica } from "./tunel";

export interface CuentaWhatsApp { id: string; nombre: string }
export interface NumeroWhatsApp { id: string; texto: string /* «+34 600 000 000» */; nombre: string /* verified_name */; prueba: boolean }
export interface PlantillaMeta {
  nombre: string;
  idioma: string;
  estado: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED";
  categoria: string;
  cuerpo: string | null;
  motivo?: string;
}

const TIEMPO_MS = 10_000;
const CACHE_PLANTILLAS_MS = 60_000;
const ESPERA_FORZAR_MS = 5_000;
const VIDA_NUMERO_MS = 10 * 60_000;
const ESPERA_NUMERO_MS = 60_000;
const VIDA_DESTINO_MS = 5 * 60_000;
const PAGINAS_PLANTILLAS = 5;
const DOS_DIAS_MS = 48 * 3600_000;

// ---- Estado compartido (Next puede cargar el módulo una vez por ruta) ----

interface EstadoMeta {
  plantillas: { waba: string; lista: PlantillaMeta[]; en: number } | null;
  pidiendoPlantillas: { waba: string; promesa: Promise<PlantillaMeta[]> } | null;
  numero: { id: string; valor: NumeroWhatsApp | null; en: number } | null;
  numeroIntento: number;
  numeroEnCurso: boolean;
  destino: { url: string | null; conMensajes: boolean } | null; // null = no se sabe
  destinoEn: number | null;
  destinoEnCurso: boolean;
}

function estado(): EstadoMeta {
  const g = globalThis as unknown as { __meta?: EstadoMeta };
  g.__meta ??= {
    plantillas: null,
    pidiendoPlantillas: null,
    numero: null,
    numeroIntento: 0,
    numeroEnCurso: false,
    destino: null,
    destinoEn: null,
    destinoEnCurso: false,
  };
  return g.__meta;
}

// ---- Utilidades ----

const SECRETOS = ["ANTHROPIC_API_KEY", "WHATSAPP_TOKEN", "META_APP_SECRET", "NGROK_AUTHTOKEN", "WEBHOOK_VERIFY_TOKEN", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY"] as const;

/** Tapa con «•••» toda clave (de process.env o de la petición en curso) y lo deja en 160 caracteres. */
function limpiar(texto: string, extra: (string | undefined)[] = []): string {
  const valores = new Set<string>();
  for (const nombre of SECRETOS) {
    const valor = process.env[nombre];
    if (valor) valores.add(valor);
  }
  for (const valor of extra) if (valor) valores.add(valor);
  const ordenados = [...valores].filter((v) => v.length >= 6).sort((a, b) => b.length - a.length);
  let salida = texto;
  for (const valor of ordenados) salida = salida.split(valor).join("•••");
  return Array.from(salida).slice(0, 160).join("");
}

const env = (nombre: string): string | undefined => process.env[nombre]?.trim() || undefined;

function baseGraph(): string {
  return (process.env.GRAPH_BASE_URL || "https://graph.facebook.com/v26.0").replace(/\/+$/, "");
}

function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

interface RespuestaGraph {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  datos: any;
  /** null si Meta ha contestado bien. */
  error: ErrorExplicado | null;
  codigoMeta?: number;
  mensaje: string;
}

/**
 * La única puerta a Meta. `token`: el del usuario del sistema; `appToken`: «{app}|{secreto}».
 * Sin red, ErrorCrm("red"). Un error de Meta solo sale en español y censurado.
 */
async function pedirGraph(
  ruta: string,
  o: { metodo?: "GET" | "POST"; token?: string; cuerpo?: unknown; appToken?: string; extra?: (string | undefined)[] } = {},
): Promise<RespuestaGraph> {
  const url = /^https?:\/\//.test(ruta) ? ruta : `${baseGraph()}${ruta.startsWith("/") ? "" : "/"}${ruta}`;
  const autorizacion = o.appToken ?? o.token;
  const cabeceras: Record<string, string> = {};
  if (autorizacion) cabeceras.Authorization = `Bearer ${autorizacion}`;
  if (o.cuerpo !== undefined) cabeceras["Content-Type"] = "application/json";
  let respuesta: Response;
  let texto: string;
  try {
    respuesta = await fetch(url, {
      method: o.metodo ?? "GET",
      headers: cabeceras,
      body: o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo),
      signal: AbortSignal.timeout(TIEMPO_MS),
    });
    texto = await respuesta.text();
  } catch {
    throw new ErrorCrm("red");
  }
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }
  const extra = [o.token, o.appToken, o.appToken?.split("|")[1], ...(o.extra ?? [])];
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : null;
  const errorMeta = objeto?.error as { code?: unknown; message?: unknown } | undefined;
  if (respuesta.ok && objeto && !errorMeta) return { status: respuesta.status, datos: objeto, error: null, mensaje: "" };
  if (errorMeta && typeof errorMeta === "object") {
    const mensaje = limpiar(typeof errorMeta.message === "string" ? errorMeta.message : "", extra);
    const codigo = typeof errorMeta.code === "number" ? errorMeta.code : undefined;
    return { status: respuesta.status, datos: objeto, error: explicarMeta(codigo, mensaje), codigoMeta: codigo, mensaje };
  }
  // HTML o vacío: un error de Meta sin código.
  const mensaje = limpiar(respuesta.statusText || `HTTP ${respuesta.status}`, extra);
  return { status: respuesta.status, datos: objeto, error: explicar("meta.otro", mensaje), mensaje };
}

/** Un ErrorCrm que lleva el error explicado (en meta.otro, el título de Meta va en el mensaje). */
function errorDe(e: ErrorExplicado): ErrorCrm {
  return new ErrorCrm(e.codigo, e.codigo === "meta.otro" ? e.solucion : undefined);
}

/** Lo que se cuenta de un error lanzado. */
function explicarLanzado(error: unknown): ErrorExplicado {
  if (error instanceof ErrorCrm) return explicar(error.codigo, error.codigo === "meta.otro" ? error.message : undefined);
  return explicar("desconocido");
}

/** «{titulo}. {solucion}»; un título que ya acaba en punto se deja tal cual. */
function frase(e: { titulo: string; solucion: string }): string {
  const titulo = e.titulo.endsWith(".") ? e.titulo : `${e.titulo}.`;
  return e.solucion ? `${titulo} ${e.solucion}` : titulo;
}

/** «12 de noviembre a las 10:30» en la zona del negocio. */
async function fechaDeCaducidad(segundos: number): Promise<string> {
  let zona = ZONA;
  try {
    zona = (await configuracionActiva()).config.calendario.zona || zona;
  } catch {
    // Sin configuración, la zona por defecto.
  }
  const partes = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zona }).formatToParts(new Date(segundos * 1000));
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")} de ${parte("month")} a las ${parte("hour")}:${parte("minute")}`;
}

function caducaPronto(expira: number | null): boolean {
  return expira !== null && expira > 0 && expira * 1000 - Date.now() < DOS_DIAS_MS;
}

// ---- La app, el token y el secreto ----

/** GET /app?fields=id */
export async function appDelToken(token?: string): Promise<{ id: string } | null> {
  const usado = token ?? env("WHATSAPP_TOKEN");
  if (!usado) return null;
  const r = await pedirGraph("/app?fields=id", { token: usado });
  if (r.error || r.datos?.id === undefined || r.datos?.id === null) return null;
  return { id: String(r.datos.id) };
}

/** appsecret_proof sobre /me: true si el secreto es de la app del token, false si no, null si no se sabe. */
export async function comprobarSecreto(token?: string, secreto?: string): Promise<boolean | null> {
  const t = token ?? env("WHATSAPP_TOKEN");
  const s = secreto ?? env("META_APP_SECRET");
  if (!t || !s) return null;
  const prueba = createHmac("sha256", s).update(t).digest("hex");
  const r = await pedirGraph(`/me?appsecret_proof=${prueba}`, { token: t, extra: [s] });
  if (r.error && /appsecret_proof/i.test(r.mensaje)) return false;
  if (!r.error && r.status === 200) return true;
  return null;
}

/** debug_token con el token de la app: expires_at (0 = no caduca) o null si no se puede leer. */
async function leerDebugToken(token: string, secreto: string, appId: string): Promise<Record<string, unknown> | null> {
  const r = await pedirGraph(`/debug_token?input_token=${encodeURIComponent(token)}`, { appToken: `${appId}|${secreto}`, extra: [token] });
  if (r.error) return null;
  const datos = r.datos?.data;
  return typeof datos === "object" && datos !== null ? datos : null;
}

async function caducidadCon(token: string, secreto: string, appId: string): Promise<number | null> {
  const datos = await leerDebugToken(token, secreto, appId);
  return typeof datos?.expires_at === "number" ? datos.expires_at : null;
}

/** expires_at de debug_token (0 = no caduca). */
export async function caducidad(token?: string): Promise<number | null> {
  const t = token ?? env("WHATSAPP_TOKEN");
  const secreto = env("META_APP_SECRET");
  if (!t || !secreto) return null;
  const app = await appDelToken(t);
  if (!app) return null;
  return caducidadCon(t, secreto, app.id);
}

/** Las cuentas de WhatsApp a las que llega el token, con su nombre. */
export async function cuentasDelToken(token?: string, secreto?: string): Promise<CuentaWhatsApp[]> {
  const t = token ?? env("WHATSAPP_TOKEN");
  const s = secreto ?? env("META_APP_SECRET");
  if (!t || !s) return [];
  const app = await appDelToken(t);
  if (!app) return [];
  const datos = await leerDebugToken(t, s, app.id);
  const permisos = Array.isArray(datos?.granular_scopes) ? (datos.granular_scopes as { scope?: unknown; target_ids?: unknown }[]) : [];
  const de = (scope: string) => permisos.filter((p) => p?.scope === scope);
  const elegidos = de("whatsapp_business_management").length ? de("whatsapp_business_management") : de("whatsapp_business_messaging");
  const ids = [...new Set(elegidos.flatMap((p) => (Array.isArray(p.target_ids) ? p.target_ids.map(String) : [])))];
  const cuentas: CuentaWhatsApp[] = [];
  for (const id of ids) {
    const r = await pedirGraph(`/${encodeURIComponent(id)}?fields=name`, { token: t });
    const nombre = !r.error && typeof r.datos?.name === "string" ? r.datos.name : id;
    cuentas.push({ id, nombre });
  }
  return cuentas;
}

// ---- Números ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aNumero(fila: any): NumeroWhatsApp {
  const digitos = soloDigitos(String(fila?.display_phone_number ?? ""));
  const nombre = typeof fila?.verified_name === "string" ? fila.verified_name : "";
  return {
    id: String(fila?.id ?? ""),
    texto: formatoTelefono(digitos),
    nombre,
    prueba: fila?.account_mode === "SANDBOX" || /^test number$/i.test(nombre) || digitos.startsWith("1555"),
  };
}

const CAMPOS_NUMERO = "display_phone_number,verified_name,quality_rating";

/** Un GET de números con account_mode; si Meta no conoce el campo (código 100), otra vez sin él. */
async function pedirConModo(ruta: string, token: string): Promise<RespuestaGraph> {
  const r = await pedirGraph(`${ruta}?fields=${CAMPOS_NUMERO},account_mode`, { token });
  if (r.error && r.codigoMeta === 100) return pedirGraph(`${ruta}?fields=${CAMPOS_NUMERO}`, { token });
  return r;
}

/** GET /{waba}/phone_numbers */
export async function numeros(waba: string, token?: string): Promise<NumeroWhatsApp[]> {
  const t = token ?? env("WHATSAPP_TOKEN");
  if (!t || !waba) return [];
  const r = await pedirConModo(`/${encodeURIComponent(waba)}/phone_numbers`, t);
  if (r.error) throw errorDe(r.error);
  const filas = Array.isArray(r.datos?.data) ? r.datos.data : [];
  return filas.map(aNumero);
}

// ---- Suscripción y webhook ----

/** POST /{waba}/subscribed_apps, solo si aún no lo está. */
export async function suscribirApp(waba?: string): Promise<boolean> {
  const w = waba ?? env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const token = env("WHATSAPP_TOKEN");
  if (!w || !token) return false;
  const app = await appDelToken(token);
  if (!app) return false;
  const ruta = `/${encodeURIComponent(w)}/subscribed_apps`;
  const lista = await pedirGraph(ruta, { token });
  if (lista.error) return false;
  const filas: { whatsapp_business_api_data?: { id?: unknown } }[] = Array.isArray(lista.datos?.data) ? lista.datos.data : [];
  if (filas.some((f) => String(f?.whatsapp_business_api_data?.id ?? "") === app.id)) return true;
  const alta = await pedirGraph(ruta, { metodo: "POST", token });
  if (alta.error || alta.datos?.success !== true) return false;
  log("Tu app de Meta escucha la cuenta de WhatsApp");
  return true;
}

interface Destino { override: string | null; suscripcion: { callback_url?: string; fields?: unknown } | null; url: string | null; conMensajes: boolean }

/** Adónde manda Meta los avisos: el override de esta app en la cuenta o la suscripción de la app. */
async function leerDestino(appId: string, waba: string, token: string, secreto: string): Promise<Destino> {
  const suscritas = await pedirGraph(`/${encodeURIComponent(waba)}/subscribed_apps`, { token });
  const filas: { whatsapp_business_api_data?: { id?: unknown }; override_callback_uri?: unknown }[] = Array.isArray(suscritas.datos?.data) ? suscritas.datos.data : [];
  const propia = filas.find((f) => String(f?.whatsapp_business_api_data?.id ?? "") === appId);
  const override = typeof propia?.override_callback_uri === "string" && propia.override_callback_uri ? propia.override_callback_uri : null;
  const r = await pedirGraph(`/${encodeURIComponent(appId)}/subscriptions`, { appToken: `${appId}|${secreto}` });
  const lista: { object?: unknown; callback_url?: string; fields?: unknown }[] = Array.isArray(r.datos?.data) ? r.datos.data : [];
  const suscripcion = lista.find((s) => s?.object === "whatsapp_business_account") ?? null;
  const campos = Array.isArray(suscripcion?.fields) ? suscripcion.fields : [];
  const conMensajes = campos.some((f: unknown) => f === "messages" || (typeof f === "object" && f !== null && (f as { name?: unknown }).name === "messages"));
  return { override, suscripcion, url: override ?? suscripcion?.callback_url ?? null, conMensajes };
}

/** `destino` es esta dirección: «{base}/webhook» o la ruta antigua «{base}/api/whatsapp/webhook». */
function apuntaA(destino: string | null, callback: string): boolean {
  if (!destino) return false;
  const base = callback.replace(/\/webhook$/, "");
  return destino === callback || destino === `${base}/api/whatsapp/webhook`;
}

function recordarDestino(destino: { url: string | null; conMensajes: boolean } | null): void {
  const e = estado();
  e.destino = destino;
  e.destinoEn = Date.now();
}

/** Apunta el webhook de Meta a `url` (la dirección completa, «…/webhook»), solo si apunta a otro sitio. */
export async function apuntarWebhook(url: string): Promise<{ ok: boolean; cambiado: boolean }> {
  const token = env("WHATSAPP_TOKEN");
  const secreto = env("META_APP_SECRET");
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (!token || !secreto || !waba) {
    recordarDestino(null);
    return { ok: false, cambiado: false };
  }
  try {
    const app = await appDelToken(token);
    if (!app) {
      recordarDestino(null);
      return { ok: false, cambiado: false };
    }
    if (!env("WEBHOOK_VERIFY_TOKEN")) {
      const guardado = await guardarClave("WEBHOOK_VERIFY_TOKEN", randomBytes(16).toString("hex"));
      if (!guardado.ok) {
        logAviso(`No se ha podido apuntar el webhook de Meta: ${guardado.error}`);
        recordarDestino(null);
        return { ok: false, cambiado: false };
      }
    }
    const verificacion = env("WEBHOOK_VERIFY_TOKEN")!;
    const destino = await leerDestino(app.id, waba, token, secreto);
    if (apuntaA(destino.url, url) && destino.conMensajes) {
      recordarDestino({ url: destino.url, conMensajes: true });
      return { ok: true, cambiado: false };
    }
    // Con override, Meta usa el override: es lo que hay que cambiar.
    const alta = destino.override
      ? await pedirGraph(`/${encodeURIComponent(waba)}/subscribed_apps`, {
          metodo: "POST",
          token,
          cuerpo: { override_callback_uri: url, verify_token: verificacion },
        })
      : await pedirGraph(`/${encodeURIComponent(app.id)}/subscriptions`, {
          metodo: "POST",
          appToken: `${app.id}|${secreto}`,
          cuerpo: { object: "whatsapp_business_account", callback_url: url, verify_token: verificacion, fields: "messages" },
        });
    if (!alta.error && alta.datos?.success === true) {
      recordarDestino({ url, conMensajes: destino.override ? destino.conMensajes : true });
      log(`Webhook de Meta apuntado a ${url}`);
      return { ok: true, cambiado: true };
    }
    recordarDestino({ url: destino.url, conMensajes: destino.conMensajes });
    logAviso(`No se ha podido apuntar el webhook de Meta: ${alta.error?.titulo ?? explicar("meta.otro").titulo}`);
    return { ok: false, cambiado: false };
  } catch (error) {
    recordarDestino(null);
    throw error;
  }
}

/** Un POST firmado y vacío a {url}/webhook tiene que dar 200. No toca ningún dato. */
export async function comprobarFirma(urlPublica: string): Promise<boolean> {
  const secreto = env("META_APP_SECRET");
  if (!secreto) return false;
  const cuerpo = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [] } }] }] });
  const firma = `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`;
  try {
    const r = await fetch(`${urlPublica.replace(/\/+$/, "")}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": firma },
      body: cuerpo,
      signal: AbortSignal.timeout(TIEMPO_MS),
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

// ---- Plantillas ----

const OCULTAS = new Set(["DELETED", "PENDING_DELETION", "ARCHIVED"]);

function estadoMeta(status: unknown): PlantillaMeta["estado"] {
  if (status === "APPROVED") return "APPROVED";
  if (status === "PENDING" || status === "IN_APPEAL") return "PENDING";
  if (status === "REJECTED") return "REJECTED";
  if (status === "PAUSED") return "PAUSED";
  return "DISABLED";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aPlantilla(fila: any): PlantillaMeta {
  const componentes: { type?: unknown; text?: unknown }[] = Array.isArray(fila?.components) ? fila.components : [];
  const cuerpo = componentes.find((c) => c?.type === "BODY")?.text;
  const motivo = typeof fila?.rejected_reason === "string" && fila.rejected_reason && fila.rejected_reason !== "NONE" ? fila.rejected_reason : undefined;
  return {
    nombre: String(fila?.name ?? ""),
    idioma: String(fila?.language ?? ""),
    estado: estadoMeta(fila?.status),
    categoria: String(fila?.category ?? ""),
    cuerpo: typeof cuerpo === "string" ? cuerpo : null,
    ...(motivo ? { motivo } : {}),
  };
}

async function pedirPlantillas(waba: string, token: string): Promise<PlantillaMeta[]> {
  const lista: PlantillaMeta[] = [];
  const origen = new URL(baseGraph()).origin;
  let ruta: string | null = `/${encodeURIComponent(waba)}/message_templates?fields=name,status,category,language,components,rejected_reason&limit=200`;
  for (let pagina = 0; ruta && pagina < PAGINAS_PLANTILLAS; pagina++) {
    const r = await pedirGraph(ruta, { token });
    if (r.error) throw errorDe(r.error);
    for (const fila of Array.isArray(r.datos?.data) ? r.datos.data : []) {
      if (OCULTAS.has(String(fila?.status))) continue;
      lista.push(aPlantilla(fila));
    }
    const siguiente: unknown = r.datos?.paging?.next;
    ruta = null;
    if (typeof siguiente === "string" && siguiente) {
      try {
        // Solo se sigue una página de Meta: nunca se manda el token a otro sitio.
        if (new URL(siguiente).origin === origen) ruta = siguiente;
      } catch {
        ruta = null;
      }
    }
  }
  return lista;
}

/** Todas las plantillas de la cuenta, 60 s en caché; null sin claves. Un error de Meta se lanza. */
export async function listarPlantillas(o?: { forzar?: boolean }): Promise<PlantillaMeta[] | null> {
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const token = env("WHATSAPP_TOKEN");
  if (!waba || !token) return null;
  const e = estado();
  const cache = e.plantillas?.waba === waba ? e.plantillas : null;
  if (cache) {
    const edad = Date.now() - cache.en;
    // Varias pestañas preguntan a la vez y Meta limita: forzar solo vuelve a pedir pasados 5 s.
    if (edad < (o?.forzar ? ESPERA_FORZAR_MS : CACHE_PLANTILLAS_MS)) return cache.lista;
  }
  if (e.pidiendoPlantillas?.waba === waba) return e.pidiendoPlantillas.promesa;
  const promesa = pedirPlantillas(waba, token);
  e.pidiendoPlantillas = { waba, promesa };
  try {
    const lista = await promesa;
    e.plantillas = { waba, lista, en: Date.now() };
    return lista;
  } finally {
    if (e.pidiendoPlantillas?.promesa === promesa) e.pidiendoPlantillas = null;
  }
}

function vaciarPlantillas(): void {
  estado().plantillas = null;
}

/** El estado de una plantilla (nombre e idioma) en Meta, en el vocabulario de la app. */
export async function estadoPlantilla(nombre: string, idioma: string): Promise<EstadoPlantilla> {
  let lista: PlantillaMeta[] | null;
  try {
    lista = await listarPlantillas();
  } catch (error) {
    return { nombre, idioma, estado: "ERROR", motivo: explicarLanzado(error).titulo };
  }
  if (lista === null) return { nombre, idioma, estado: "SIN_CLAVES" };
  const p = lista.find((x) => x.nombre === nombre && x.idioma === idioma);
  if (!p) return { nombre, idioma, estado: "NO_EXISTE" };
  const comun = { nombre, idioma, categoria: p.categoria, ...(p.cuerpo !== null ? { texto: p.cuerpo } : {}) };
  if (p.estado === "APPROVED") return { ...comun, estado: "APROBADA" };
  if (p.estado === "PENDING") return { ...comun, estado: "EN_REVISION" };
  if (p.estado === "REJECTED") return { ...comun, estado: "RECHAZADA", ...(p.motivo ? { motivo: p.motivo } : {}) };
  return { ...comun, estado: "PAUSADA" };
}

/** POST /{waba}/message_templates */
export async function crearPlantilla(p: PlantillaApp): Promise<EstadoPlantilla> {
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const token = env("WHATSAPP_TOKEN");
  const base = { id: p.id, nombre: p.nombre, idioma: p.idioma };
  if (!waba || !token) return { ...base, estado: "SIN_CLAVES" };
  try {
    const r = await pedirGraph(`/${encodeURIComponent(waba)}/message_templates`, {
      metodo: "POST",
      token,
      cuerpo: { name: p.nombre, language: p.idioma, category: p.categoria, components: componentesParaMeta(p) },
    });
    if (r.error) return { ...base, estado: "ERROR", motivo: frase(r.error) };
    const status = r.datos?.status;
    const estadoApp: EstadoPlantilla["estado"] = status === "APPROVED" ? "APROBADA" : status === "REJECTED" ? "RECHAZADA" : "EN_REVISION";
    log(`Mensaje para Meta enviado a revisión: ${p.nombre}`);
    // Meta puede pasar una UTILITY a MARKETING: se enseña lo que diga.
    return { ...base, estado: estadoApp, categoria: typeof r.datos?.category === "string" ? r.datos.category : p.categoria, texto: p.texto };
  } catch (error) {
    return { ...base, estado: "ERROR", motivo: frase(explicarLanzado(error)) };
  } finally {
    vaciarPlantillas();
  }
}

/** Las plantillas aprobadas de la cuenta, con su texto y sus variables. */
export async function plantillasAprobadas(): Promise<PlantillaAprobada[]> {
  try {
    const lista = await listarPlantillas();
    if (!lista) return [];
    return lista
      .filter((p): p is PlantillaMeta & { cuerpo: string } => p.estado === "APPROVED" && p.cuerpo !== null)
      .map((p) => ({ nombre: p.nombre, idioma: p.idioma, categoria: p.categoria, texto: p.cuerpo, variables: variablesDe(p.cuerpo) }));
  } catch {
    return [];
  }
}

// ---- Estado guardado (nunca espera a la red ni lanza) ----

function recordarNumero(n: NumeroWhatsApp): void {
  estado().numero = { id: n.id, valor: n, en: Date.now() };
}

async function refrescarNumero(id: string, token: string): Promise<void> {
  const e = estado();
  try {
    const r = await pedirConModo(`/${encodeURIComponent(id)}`, token);
    if (r.error) throw errorDe(r.error);
    if (env("WHATSAPP_PHONE_NUMBER_ID") === id) e.numero = { id, valor: aNumero({ ...r.datos, id }), en: Date.now() };
  } catch (error) {
    // Se intenta como mucho una vez por minuto: este aviso sale como mucho una vez por minuto.
    logAviso(`No se ha podido leer el número de WhatsApp: ${explicarLanzado(error).titulo}`);
  } finally {
    e.numeroEnCurso = false;
  }
}

/** El último número conocido del negocio. Si es viejo, lo refresca en segundo plano. */
export function numeroDelNegocio(): NumeroWhatsApp | null {
  const e = estado();
  const id = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!id) return null;
  if (e.numero && e.numero.id !== id) e.numero = null;
  const token = env("WHATSAPP_TOKEN");
  const ahora = Date.now();
  const viejo = !e.numero || ahora - e.numero.en > VIDA_NUMERO_MS;
  if (viejo && token && !e.numeroEnCurso && ahora - e.numeroIntento >= ESPERA_NUMERO_MS) {
    e.numeroEnCurso = true;
    e.numeroIntento = ahora;
    void refrescarNumero(id, token);
  }
  return e.numero?.valor ?? null;
}

async function refrescarDestino(token: string, secreto: string, waba: string): Promise<void> {
  const e = estado();
  try {
    const app = await appDelToken(token);
    if (!app) return recordarDestino(null);
    const destino = await leerDestino(app.id, waba, token, secreto);
    recordarDestino({ url: destino.url, conMensajes: destino.conMensajes });
  } catch {
    recordarDestino(null);
  } finally {
    e.destinoEnCurso = false;
  }
}

/** Si el webhook de Meta apunta aquí y cuándo se miró. null = no se sabe. */
export function estadoConexionMeta(): { webhookApuntaAqui: boolean | null; comprobadoEn: number | null } {
  const e = estado();
  const token = env("WHATSAPP_TOKEN");
  const secreto = env("META_APP_SECRET");
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const publica = urlPublica();
  if (token && secreto && waba && publica && !e.destinoEnCurso && (e.destinoEn === null || Date.now() - e.destinoEn > VIDA_DESTINO_MS)) {
    e.destinoEnCurso = true;
    void refrescarDestino(token, secreto, waba);
  }
  const webhookApuntaAqui = !publica || !e.destino ? null : apuntaA(e.destino.url, `${publica}/webhook`) && e.destino.conMensajes;
  return { webhookApuntaAqui, comprobadoEn: e.destinoEn };
}

// ---- «Conecta tu WhatsApp» ----

type ErrorPaso = NonNullable<ResultadoPasoMeta["error"]>;

function fallo(paso: PasoMeta, error: { titulo: string; solucion: string; codigo: CodigoError }, siguiente: PasoMeta | null, extra: Partial<ResultadoPasoMeta> = {}): ResultadoPasoMeta {
  return { paso, ok: false, texto: error.titulo, error: { titulo: error.titulo, solucion: error.solucion, codigo: error.codigo }, siguiente, ...extra };
}

function bien(paso: PasoMeta, texto: string, siguiente: PasoMeta | null): ResultadoPasoMeta {
  return { paso, ok: true, texto, siguiente };
}

const FALTAN_CLAVES: ErrorPaso = { titulo: "Faltan las claves de Meta", solucion: "Pega el token permanente y la clave secreta de la app.", codigo: "meta.token" };
const FALTA_CUENTA: ErrorPaso = { titulo: "Primero elige tu cuenta de WhatsApp", solucion: "Pulsa otra vez Conectar.", codigo: "meta.permisos" };
const SIN_URL: ErrorPaso = { titulo: "Primero abre el túnel", solucion: "Pulsa otra vez Conectar.", codigo: "ngrok.token" };

function aErrorPaso(e: ErrorExplicado): ErrorPaso {
  return { titulo: e.titulo, solucion: e.solucion, codigo: e.codigo };
}

/** Un guardado que falla en un paso: su frase va de título. */
function errorDeGuardado(error: string): ErrorPaso {
  return { titulo: error, solucion: explicar("desconocido").solucion, codigo: "desconocido" };
}

async function guardarTodas(claves: [Parameters<typeof guardarClave>[0], string][]): Promise<ErrorPaso | null> {
  for (const [nombre, valor] of claves) {
    const r = await guardarClave(nombre, valor);
    if (!r.ok) return errorDeGuardado(r.error);
  }
  return null;
}

async function pasoClaves(p: PeticionConectarMeta): Promise<ResultadoPasoMeta> {
  const token = p.token || env("WHATSAPP_TOKEN");
  const secreto = p.secreto || env("META_APP_SECRET");
  if (!token || !secreto) return fallo("claves", FALTAN_CLAVES, "claves");
  const app = await appDelToken(token);
  if (!app) return fallo("claves", aErrorPaso(explicar("meta.token")), "claves");
  // En una instalación nueva el secreto solo viene en la petición: la caducidad se lee con este.
  const expira = await caducidadCon(token, secreto, app.id);
  if (caducaPronto(expira)) {
    return fallo(
      "claves",
      { titulo: `Ese token caduca el ${await fechaDeCaducidad(expira!)}`, solucion: "Usa el token permanente del usuario del sistema: el de la pantalla de inicio de Meta caduca en 24 h.", codigo: "meta.token" },
      "claves",
    );
  }
  if ((await comprobarSecreto(token, secreto)) === false) {
    return fallo("claves", { titulo: "Esa clave secreta no es de la app de tu token", solucion: "Cópiala otra vez de la configuración básica de tu app en Meta.", codigo: "meta.firma" }, "claves");
  }
  const guardar: [Parameters<typeof guardarClave>[0], string][] = [];
  if (p.token) guardar.push(["WHATSAPP_TOKEN", p.token]);
  if (p.secreto) guardar.push(["META_APP_SECRET", p.secreto]);
  if (p.ngrok) guardar.push(["NGROK_AUTHTOKEN", p.ngrok]);
  if (!env("WEBHOOK_VERIFY_TOKEN")) guardar.push(["WEBHOOK_VERIFY_TOKEN", randomBytes(16).toString("hex")]);
  const error = await guardarTodas(guardar);
  if (error) return fallo("claves", error, "claves");
  return bien("claves", "Claves guardadas", "cuenta");
}

async function pasoCuenta(p: PeticionConectarMeta): Promise<ResultadoPasoMeta> {
  const token = env("WHATSAPP_TOKEN");
  const secreto = env("META_APP_SECRET");
  if (!token || !secreto) return fallo("cuenta", FALTAN_CLAVES, "claves");
  if (p.waba) {
    const ajena: ErrorPaso = { titulo: "Esa cuenta de WhatsApp no es de tu token", solucion: "Cópiala de WhatsApp → Configuración de la API, en tu app de Meta.", codigo: "meta.permisos" };
    if (!/^\d+$/.test(p.waba)) return fallo("cuenta", ajena, "cuenta");
    const r = await pedirGraph(`/${p.waba}?fields=name`, { token });
    if (r.error) return fallo("cuenta", ajena, "cuenta");
    const error = await guardarTodas([["WHATSAPP_BUSINESS_ACCOUNT_ID", p.waba]]);
    if (error) return fallo("cuenta", error, "cuenta");
    return bien("cuenta", `Cuenta de WhatsApp de ${typeof r.datos?.name === "string" ? r.datos.name : p.waba}`, "numero");
  }
  const cuentas = await cuentasDelToken(token, secreto);
  if (cuentas.length === 0) {
    return fallo("cuenta", aErrorPaso(explicar("meta.permisos")), "cuenta", { texto: "No encuentro tu cuenta de WhatsApp", opciones: [] });
  }
  if (cuentas.length > 1) {
    return { paso: "cuenta", ok: false, texto: "Elige tu cuenta de WhatsApp", opciones: cuentas.map((c) => ({ id: c.id, texto: c.nombre })), siguiente: "cuenta" };
  }
  const error = await guardarTodas([["WHATSAPP_BUSINESS_ACCOUNT_ID", cuentas[0].id]]);
  if (error) return fallo("cuenta", error, "cuenta");
  return bien("cuenta", `Cuenta de WhatsApp de ${cuentas[0].nombre}`, "numero");
}

async function pasoNumero(p: PeticionConectarMeta): Promise<ResultadoPasoMeta> {
  if (!env("WHATSAPP_TOKEN") || !env("META_APP_SECRET")) return fallo("numero", FALTAN_CLAVES, "claves");
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (!waba) return fallo("numero", FALTA_CUENTA, "cuenta");
  const lista = await numeros(waba);
  if (lista.length === 0) {
    return fallo("numero", { titulo: "Esa cuenta no tiene ningún número de WhatsApp", solucion: "Añade uno en tu app de Meta (WhatsApp → Configuración de la API) y vuelve a pulsar Conectar.", codigo: "meta.otro" }, "numero");
  }
  let elegido: NumeroWhatsApp | undefined;
  if (p.numero) {
    elegido = lista.find((n) => n.id === p.numero);
    if (!elegido) return fallo("numero", { titulo: "Ese número no está en tu cuenta de WhatsApp", solucion: "Elige uno de la lista.", codigo: "meta.otro" }, "numero");
  } else if (lista.length === 1) {
    elegido = lista[0];
  } else {
    return { paso: "numero", ok: false, texto: "Elige el número", opciones: lista.map((n) => ({ id: n.id, texto: `${n.texto} · ${n.nombre}` })), siguiente: "numero" };
  }
  const error = await guardarTodas([["WHATSAPP_PHONE_NUMBER_ID", elegido.id]]);
  if (error) return fallo("numero", error, "numero");
  recordarNumero(elegido);
  return bien("numero", `${elegido.texto} · ${elegido.nombre}`, "tunel");
}

async function pasoTunel(): Promise<ResultadoPasoMeta> {
  if (modoServidor()) return bien("tunel", `Tu servidor recibe los mensajes en https://${env("CRM_DOMINIO")}`, "suscripcion");
  if (env("CRM_URL_PUBLICA")) return bien("tunel", `Los mensajes llegan a ${urlPublica()}`, "suscripcion");
  if (process.env.BD_LOCAL) {
    return fallo("tunel", { titulo: "En el servidor de pruebas no se abre el túnel", solucion: "Los mensajes de prueba los manda el simulador.", codigo: "desconocido" }, "tunel");
  }
  if (!tokenNgrok()) {
    return fallo("tunel", { titulo: "Falta tu clave de ngrok", solucion: "Cópiala de dashboard.ngrok.com → Your Authtoken y pégala aquí.", codigo: "ngrok.token" }, "tunel");
  }
  const tunel = await abrirTunel();
  if (tunel.abierto) return bien("tunel", "Túnel abierto: los mensajes llegan a este ordenador", "suscripcion");
  return fallo("tunel", aErrorPaso(tunel.error ?? explicar("desconocido")), "tunel");
}

async function pasoSuscripcion(): Promise<ResultadoPasoMeta> {
  if (!env("WHATSAPP_TOKEN") || !env("META_APP_SECRET")) return fallo("suscripcion", FALTAN_CLAVES, "claves");
  if (!env("WHATSAPP_BUSINESS_ACCOUNT_ID")) return fallo("suscripcion", FALTA_CUENTA, "cuenta");
  if (await suscribirApp()) return bien("suscripcion", "Tu app escucha esta cuenta", "webhook");
  return fallo("suscripcion", aErrorPaso(explicar("meta.permisos")), "suscripcion");
}

async function pasoWebhook(): Promise<ResultadoPasoMeta> {
  if (!env("WHATSAPP_TOKEN") || !env("META_APP_SECRET")) return fallo("webhook", FALTAN_CLAVES, "claves");
  if (!env("WHATSAPP_BUSINESS_ACCOUNT_ID")) return fallo("webhook", FALTA_CUENTA, "cuenta");
  const publica = urlPublica();
  if (!publica) return fallo("webhook", SIN_URL, "tunel");
  const r = await apuntarWebhook(`${publica}/webhook`);
  if (r.ok) return bien("webhook", modoServidor() ? "Meta avisa a tu servidor" : "Meta avisa a este ordenador", "firma");
  return fallo("webhook", { titulo: "Meta no ha podido comprobar la dirección de tu CRM", solucion: "Comprueba que el CRM sigue abierto y vuelve a pulsar Conectar.", codigo: "meta.otro" }, "webhook");
}

async function pasoFirma(): Promise<ResultadoPasoMeta> {
  if (!env("WHATSAPP_TOKEN") || !env("META_APP_SECRET")) return fallo("firma", FALTAN_CLAVES, "claves");
  const publica = urlPublica();
  if (!publica) return fallo("firma", SIN_URL, "tunel");
  if (await comprobarFirma(publica)) return bien("firma", "Firma comprobada", null);
  return fallo("firma", { titulo: "Tu dirección pública no llega a este CRM", solucion: "Vuelve a pulsar Conectar; si sigue igual, cierra el CRM y ábrelo otra vez.", codigo: "red" }, "firma");
}

/** Censura los textos de un resultado con las claves de la petición (aún no están en process.env). */
function censurarResultado(r: ResultadoPasoMeta, p: PeticionConectarMeta): ResultadoPasoMeta {
  const extra = [p.token, p.secreto, p.ngrok];
  return {
    ...r,
    texto: limpiar(r.texto, extra),
    ...(r.error ? { error: { ...r.error, titulo: limpiar(r.error.titulo, extra), solucion: limpiar(r.error.solucion, extra) } } : {}),
    ...(r.opciones ? { opciones: r.opciones.map((o) => ({ id: o.id, texto: limpiar(o.texto, extra) })) } : {}),
  };
}

/** Un paso de «Conecta tu WhatsApp»: lo hace y dice cuál va después. Nunca lanza. */
export async function conectarPaso(p: PeticionConectarMeta): Promise<ResultadoPasoMeta> {
  let r: ResultadoPasoMeta;
  try {
    switch (p.paso) {
      case "claves":
        r = await pasoClaves(p);
        break;
      case "cuenta":
        r = await pasoCuenta(p);
        break;
      case "numero":
        r = await pasoNumero(p);
        break;
      case "tunel":
        r = await pasoTunel();
        break;
      case "suscripcion":
        r = await pasoSuscripcion();
        break;
      case "webhook":
        r = await pasoWebhook();
        break;
      case "firma":
        r = await pasoFirma();
        break;
      default:
        r = fallo(p.paso, aErrorPaso(explicar("desconocido")), null);
    }
  } catch (error) {
    r = fallo(p.paso, aErrorPaso(explicarLanzado(error)), p.paso);
  }
  return censurarResultado(r, p);
}

/** Con el túnel abierto en otra URL, vuelve a apuntar la suscripción y el webhook. Nunca lanza. */
export async function alAbrirTunel(url: string): Promise<void> {
  if (!env("WHATSAPP_TOKEN") || !env("META_APP_SECRET") || !env("WHATSAPP_BUSINESS_ACCOUNT_ID")) return;
  try {
    await suscribirApp();
    await apuntarWebhook(`${url.replace(/\/+$/, "")}/webhook`);
  } catch (error) {
    logAviso(`No se ha podido avisar a Meta de la dirección del CRM: ${explicarLanzado(error).titulo}`);
  }
}
