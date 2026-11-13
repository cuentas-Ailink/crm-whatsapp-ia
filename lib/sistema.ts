// El estado de la instalación: qué falta de la puesta en marcha y cómo están las conexiones.
// Solo en el servidor. La comprobación de la clave de Claude es comprobarClaveClaude (lib/claves.ts).
//
// Nada de aquí escribe: solo lee y pregunta. Lo que tarda (Claude, Meta) se guarda 10 min en
// globalThis, por huella de la clave («…abcd»): una clave nueva se vuelve a comprobar al momento.

import { ZONA } from "./agenda";
import type { EstadoConexiones, EstadoFila, FilaConexion, PasoPuesta, Puesta } from "./api-tipos";
import { contarEjemplos, contarLeads, hayMensajeRealDeCliente } from "./bd";
import { comprobarClaveClaude, terminaEn } from "./claves";
import { MODELOS, modeloEfectivo, telefonoComercial, type ConfiguracionResuelta, type IdModelo } from "./configuracion";
import { configuracionActiva, configuracionParaPintar } from "./configuracion-servidor";
import { explicar, explicarBd, type ErrorExplicado } from "./errores";
import { ultimosWebhooks } from "./eventos";
import { appDelToken, caducidad, comprobarFirma, comprobarSecreto, estadoConexionMeta, estadoPlantilla, numeroDelNegocio, numeros } from "./meta";
import { leerModoPrueba, modoWhatsApp } from "./modo-prueba";
import { consultarPuente, ultimoEstadoPuente } from "./modo-prueba-puente";
import { enmascararVinculado } from "./modo-prueba-reglas";
import { configuracionPorDefecto } from "./presets";
import { estadoAcceso, estadoTunel, modoServidor, tokenNgrok, urlPublica } from "./tunel";

/** Las variables cuyo valor nunca puede salir en un texto. */
const SECRETOS = [
  "ANTHROPIC_API_KEY",
  "WHATSAPP_TOKEN",
  "META_APP_SECRET",
  "NGROK_AUTHTOKEN",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "WEBHOOK_VERIFY_TOKEN",
  "SESION_SECRETO",
  "CLAVE_PANEL_HASH",
  "CODIGO_ALTA",
  "SUPABASE_DB_URL",
] as const;

/** Un valor más corto podría aparecer en cualquier texto normal: no se censura. */
const MINIMO_SECRETO = 6;
const MAXIMO_TEXTO = 160;
const TAPADO = "•••";

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
/** Lo que se pregunta a Claude y a Meta vale 10 min; un fallo de red, solo 1 min. */
const VIDA_COMPROBACION_MS = 10 * MINUTO;
const VIDA_SIN_RED_MS = MINUTO;
/** Las partes de la puesta que salen de la base de datos. */
const VIDA_PUESTA_BD_MS = 10 * SEGUNDO;
/** El estado de las conexiones se guarda 60 s; «Comprobar» solo vuelve a mirar pasados 10 s. */
const VIDA_CONEXIONES_MS = MINUTO;
const ESPERA_FORZAR_MS = 10 * SEGUNDO;
/** Cada comprobación espera como mucho 5 s. */
const TIEMPO_MS = 5 * SEGUNDO;
const LENTO_MS = 1500;

const NO_SE_HA_PODIDO = "No se ha podido comprobar ahora mismo";
const TIEMPO = Symbol("tiempo");
type ConTiempo<T> = T | typeof TIEMPO;

// ---- Estado compartido (Next puede cargar el módulo una vez por ruta) ----
// «Arreglar» borra __sistemaConexiones y __sistemaComprobaciones para mirar todo de nuevo;
// la puesta (__sistemaPuesta) no se toca: lo que ya está hecho no vuelve atrás.

interface Sello { clave: string; valor: unknown; hasta: number }
interface Comprobaciones { cache: Map<string, Sello>; enCurso: Map<string, Promise<unknown>> }
interface Conexiones { ultimo: EstadoConexiones | null; calculando: Promise<EstadoConexiones> | null }
interface PuestaInterna {
  bd: { en: number; negocio: boolean; primerMensaje: boolean; modelo: string } | null;
  leyendo: Promise<void> | null;
  negocio: boolean;
  primerMensaje: boolean;
}

type Global = { __sistemaComprobaciones?: Comprobaciones; __sistemaConexiones?: Conexiones; __sistemaPuesta?: PuestaInterna };
const g = globalThis as unknown as Global;

function comprobaciones(): Comprobaciones {
  return (g.__sistemaComprobaciones ??= { cache: new Map(), enCurso: new Map() });
}
function conexiones(): Conexiones {
  return (g.__sistemaConexiones ??= { ultimo: null, calculando: null });
}
function puestaInterna(): PuestaInterna {
  return (g.__sistemaPuesta ??= { bd: null, leyendo: null, negocio: false, primerMensaje: false });
}

// ---- Utilidades ----

const env = (nombre: string): string | undefined => process.env[nombre]?.trim() || undefined;

function metaConectada(): boolean {
  return !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID") && env("WHATSAPP_BUSINESS_ACCOUNT_ID") && env("META_APP_SECRET"));
}

/** Lo que tarde más de `ms` deja de esperarse: la promesa sigue y guarda su resultado al acabar. */
function conTiempo<T>(promesa: Promise<T>, ms = TIEMPO_MS): Promise<ConTiempo<T>> {
  return new Promise((resolver) => {
    const reloj = setTimeout(() => resolver(TIEMPO), ms);
    (reloj as { unref?: () => void }).unref?.();
    promesa.then(
      (valor) => {
        clearTimeout(reloj);
        resolver(valor);
      },
      () => {
        clearTimeout(reloj);
        resolver(TIEMPO);
      },
    );
  });
}

/** «{titulo}. {solucion}»; un título que ya acaba en punto se deja tal cual. */
function frase(e: { titulo: string; solucion: string }): string {
  const titulo = e.titulo.endsWith(".") ? e.titulo : `${e.titulo}.`;
  return e.solucion ? `${titulo} ${e.solucion}` : titulo;
}

/** «hace un momento», «hace 5 min», «hace 2 h», «hace 3 días». */
function hace(ts: number): string {
  const minutos = Math.floor(Math.max(0, Date.now() - ts) / MINUTO);
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

/** «12 de noviembre a las 10:30» en la zona del negocio. */
function fecha(segundos: number, zona: string): string {
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zona }).formatToParts(new Date(segundos * 1000));
  } catch {
    partes = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONA }).formatToParts(new Date(segundos * 1000));
  }
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")} de ${parte("month")} a las ${parte("hour")}:${parte("minute")}`;
}

// ---- Lo que se pregunta fuera, guardado ----

/** Lanza la comprobación (una sola a la vez por nombre y clave) y guarda el resultado al acabar. */
function lanzar<T>(nombre: string, clave: string, f: () => Promise<T>, vida: (v: T) => number): Promise<T> {
  const c = comprobaciones();
  const id = `${nombre}|${clave}`;
  const ya = c.enCurso.get(id);
  if (ya) return ya as Promise<T>;
  const promesa = f()
    .then((valor) => {
      c.cache.set(nombre, { clave, valor, hasta: Date.now() + vida(valor) });
      return valor;
    })
    .finally(() => c.enCurso.delete(id));
  c.enCurso.set(id, promesa);
  return promesa;
}

/** El último resultado con esta clave (aunque sea viejo) o undefined. */
function guardado<T>(nombre: string, clave: string): { valor: T; vigente: boolean } | undefined {
  const s = comprobaciones().cache.get(nombre);
  if (!s || s.clave !== clave) return undefined;
  return { valor: s.valor as T, vigente: Date.now() < s.hasta };
}

/** Para la pantalla de Conexiones: lo guardado si vale; si no (o con `refrescar`), se pregunta, 5 s como mucho. */
async function comprobar<T>(nombre: string, clave: string, f: () => Promise<T>, vida: (v: T) => number, refrescar: boolean): Promise<ConTiempo<T>> {
  const s = guardado<T>(nombre, clave);
  if (!refrescar && s?.vigente) return s.valor;
  return conTiempo(lanzar(nombre, clave, f, vida));
}

/** Para la puesta en marcha: nunca espera. Lo guardado (o undefined) y, si es viejo, se pregunta detrás. */
function sinEsperar<T>(nombre: string, clave: string, f: () => Promise<T>, vida: (v: T) => number): T | undefined {
  const s = guardado<T>(nombre, clave);
  if (!s?.vigente) void lanzar(nombre, clave, f, vida).catch(() => undefined);
  return s?.valor;
}

type ResultadoClaude = { ok: true } | { ok: false; error: ErrorExplicado };
type ResultadoApp = { id: string } | null | "red";

function preguntarClaude(modelo: string): () => Promise<ResultadoClaude> {
  return () =>
    comprobarClaveClaude(undefined, modelo).then(
      (r): ResultadoClaude => (r.ok ? { ok: true } : { ok: false, error: r.error }),
      (): ResultadoClaude => ({ ok: false, error: explicar("red") }),
    );
}
const vidaClaude = (r: ResultadoClaude) => (!r.ok && r.error.codigo === "red" ? VIDA_SIN_RED_MS : VIDA_COMPROBACION_MS);
const claveClaude = (modelo: string) => `${terminaEn(env("ANTHROPIC_API_KEY")) ?? ""}|${modelo}`;

function preguntarApp(): Promise<ResultadoApp> {
  return appDelToken().then(
    (r): ResultadoApp => (r ? { id: r.id } : null),
    (): ResultadoApp => "red",
  );
}
const vidaApp = (r: ResultadoApp) => (r === "red" ? VIDA_SIN_RED_MS : VIDA_COMPROBACION_MS);
const claveToken = () => terminaEn(env("WHATSAPP_TOKEN")) ?? "";

function preguntarCaducidad(): Promise<number | null | "red"> {
  return caducidad().catch(() => "red" as const);
}
const vidaCaducidad = (r: number | null | "red") => (r === "red" || r === null ? VIDA_SIN_RED_MS : VIDA_COMPROBACION_MS);

/** Si esta app escucha la cuenta de WhatsApp: true, false o null si no se sabe. Solo lee. */
async function leerSuscripcion(appId: string): Promise<boolean | null> {
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const token = env("WHATSAPP_TOKEN");
  if (!waba || !token) return null;
  const base = (process.env.GRAPH_BASE_URL || "https://graph.facebook.com/v26.0").replace(/\/+$/, "");
  try {
    const r = await fetch(`${base}/${encodeURIComponent(waba)}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIEMPO_MS),
    });
    if (!r.ok) return null;
    const datos = (await r.json()) as { data?: { whatsapp_business_api_data?: { id?: unknown } }[] };
    if (!Array.isArray(datos?.data)) return null;
    return datos.data.some((f) => String(f?.whatsapp_business_api_data?.id ?? "") === appId);
  } catch {
    return null;
  }
}
const vidaSuscripcion = (r: boolean | null) => (r === null ? VIDA_SIN_RED_MS : VIDA_COMPROBACION_MS);

// ---- La puesta en marcha ----

const PUESTA_HECHA: Puesta = { negocio: true, claude: true, whatsapp: true, mensajes: true, primerMensaje: true };

/** Una fuente que falla o tarda cuenta como hecha: una instalación que funciona nunca ve la puesta por un tropiezo. */
async function siFallaHecho(f: () => Promise<boolean>): Promise<boolean> {
  const r = await conTiempo(f());
  return r === TIEMPO ? true : r;
}

async function leerPuestaBd(p: PuestaInterna): Promise<void> {
  let modelo = env("MODELO") || "claude-haiku-5-5";
  const negocio = siFallaHecho(async () => {
    let config: ConfiguracionResuelta;
    try {
      config = (await configuracionActiva()).config;
      modelo = modeloEfectivo(config.sistema, process.env.MODELO);
    } catch (error) {
      if (env("NOMBRE_NEGOCIO")) return true;
      throw error;
    }
    if (env("NOMBRE_NEGOCIO") || config.guardada) return true;
    return (await contarEjemplos()).reales > 0;
  });
  const primer = siFallaHecho(() => hayMensajeRealDeCliente());
  const [n, m] = await Promise.all([negocio, primer]);
  p.bd = { en: Date.now(), negocio: n, primerMensaje: m, modelo };
  if (n) p.negocio = true;
  if (m) p.primerMensaje = true;
}

async function calcularPuesta(): Promise<Puesta> {
  const p = puestaInterna();
  if (!p.bd || Date.now() - p.bd.en > VIDA_PUESTA_BD_MS) {
    p.leyendo ??= leerPuestaBd(p).finally(() => {
      p.leyendo = null;
    });
    await p.leyendo;
  }
  const modelo = p.bd?.modelo ?? "claude-haiku-5-5";

  let claude = !!env("ANTHROPIC_API_KEY");
  if (claude) {
    const r = sinEsperar("claude", claveClaude(modelo), preguntarClaude(modelo), vidaClaude);
    claude = !(r && !r.ok && r.error.codigo === "claude.clave");
  }

  // Modo prueba: WhatsApp está hecho con el móvil vinculado y la lista de números permitidos.
  // Lo del puente se pregunta detrás, sin esperar, como lo de Meta.
  if (modoWhatsApp() === "prueba") {
    void consultarPuente().catch(() => undefined);
    const vinculado = ultimoEstadoPuente().fase === "conectado" && (leerModoPrueba()?.permitidos.length ?? 0) > 0;
    return { negocio: p.negocio, claude, whatsapp: vinculado, mensajes: true, primerMensaje: p.primerMensaje };
  }

  let whatsapp = metaConectada();
  if (whatsapp) {
    const r = sinEsperar("app", claveToken(), preguntarApp, vidaApp);
    whatsapp = r !== null;
  }

  let mensajes = true;
  try {
    mensajes = ultimosWebhooks().valido !== null || estadoConexionMeta().webhookApuntaAqui === true;
  } catch {
    mensajes = true;
  }

  return { negocio: p.negocio, claude, whatsapp, mensajes, primerMensaje: p.primerMensaje };
}

/**
 * Los pasos de la puesta en marcha, sacados de lo que hay de verdad. Nunca lanza ni espera a Claude
 * o a Meta (lo que tarda se pregunta detrás). «negocio» y «primerMensaje», una vez hechos, no
 * vuelven atrás hasta reiniciar.
 */
export async function estadoPuesta(): Promise<Puesta> {
  try {
    return await calcularPuesta();
  } catch {
    return { ...PUESTA_HECHA };
  }
}

// ---- Las conexiones ----

type Fila = FilaConexion;
const fila = (id: Fila["id"], nombre: string, estado: EstadoFila, detalle: string, accion?: Fila["accion"]): Fila => ({
  id,
  nombre,
  estado,
  detalle,
  ...(accion ? { accion } : {}),
});
const arreglarPaso = (paso: PasoPuesta): Fila["accion"] => ({ texto: "Arreglar", paso });

/** Cómo se dice cada modelo en una línea: «claude-haiku-5-5» → «Claude Haiku 5.5 · rápido». */
const CARACTER_MODELO: Record<IdModelo, string> = { "claude-haiku-5-5": "rápido", "claude-sonnet-5-5": "más cuidadoso" };

function etiquetaModelo(modelo: IdModelo): string {
  const [marca, familia, ...version] = modelo.split("-");
  const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return `${mayuscula(marca)} ${mayuscula(familia)} ${version.join(".")} · ${CARACTER_MODELO[modelo]}`;
}

async function filaClaude(config: ConfiguracionResuelta, refrescar: boolean): Promise<Fila> {
  const nombre = "Claude (tu asistente)";
  if (!env("ANTHROPIC_API_KEY")) return fila("claude", nombre, "error", "Falta la clave de Claude", arreglarPaso("claude"));
  const modelo = modeloEfectivo(config.sistema, process.env.MODELO);
  const r = await comprobar("claude", claveClaude(modelo), preguntarClaude(modelo), vidaClaude, refrescar);
  if (r === TIEMPO) return fila("claude", nombre, "atencion", NO_SE_HA_PODIDO);
  if (r.ok) {
    const conocido = (MODELOS as readonly string[]).includes(modelo);
    return fila("claude", nombre, "ok", conocido ? `Contesta con ${etiquetaModelo(modelo as IdModelo)}` : `Contesta con ${modelo}`);
  }
  const c = r.error.codigo;
  if (c === "claude.clave" || c === "claude.saldo") return fila("claude", nombre, "error", frase(r.error), arreglarPaso("claude"));
  if (c === "claude.modelo") return fila("claude", nombre, "error", frase(r.error));
  if (c === "claude.ocupado") return fila("claude", nombre, "atencion", frase(r.error));
  return fila("claude", nombre, "atencion", NO_SE_HA_PODIDO);
}

async function leerApp(refrescar: boolean): Promise<ConTiempo<ResultadoApp>> {
  return comprobar("app", claveToken(), preguntarApp, vidaApp, refrescar);
}

/** Modo prueba: WhatsApp es el móvil vinculado por QR, siempre en ámbar porque no es la vía oficial. */
async function filaWhatsAppPrueba(config: ConfiguracionResuelta): Promise<Fila> {
  const nombre = "WhatsApp";
  const puente = await consultarPuente();
  if (puente.fase !== "conectado" || !puente.numero) {
    return fila("whatsapp", nombre, "error", "Modo prueba · sin vincular: escanea el QR", arreglarPaso("whatsapp"));
  }
  if ((leerModoPrueba()?.permitidos.length ?? 0) === 0) {
    return fila("whatsapp", nombre, "error", "Modo prueba · falta la lista de números permitidos", arreglarPaso("whatsapp"));
  }
  return fila("whatsapp", nombre, "atencion", `Modo prueba · ${enmascararVinculado(puente.numero, config.regional.prefijo)} · no oficial`);
}

async function filaMensajesPrueba(): Promise<Fila> {
  const nombre = "Mensajes que llegan a este ordenador";
  if (ultimoEstadoPuente().fase !== "conectado") return fila("mensajes", nombre, "atencion", "Primero vincula el móvil de pruebas", arreglarPaso("whatsapp"));
  const avisos = ultimosWebhooks();
  if (avisos.valido !== null) return fila("mensajes", nombre, "ok", `Llegan del móvil de pruebas · último ${hace(avisos.valido)}`);
  return fila("mensajes", nombre, "ok", "Llegan del móvil de pruebas, solo de los números permitidos");
}

async function filaWhatsApp(config: ConfiguracionResuelta, refrescar: boolean): Promise<Fila> {
  const nombre = "WhatsApp";
  if (modoWhatsApp() === "prueba") return filaWhatsAppPrueba(config);
  if (!metaConectada()) return fila("whatsapp", nombre, "error", "Sin conectar", arreglarPaso("whatsapp"));
  const app = await leerApp(refrescar);
  if (app === TIEMPO || app === "red") return fila("whatsapp", nombre, "atencion", NO_SE_HA_PODIDO);
  if (app === null) return fila("whatsapp", nombre, "error", frase(explicar("meta.token")), arreglarPaso("whatsapp"));
  const expira = await comprobar("caducidad", claveToken(), preguntarCaducidad, vidaCaducidad, refrescar);
  if (typeof expira === "number" && expira > 0) {
    if (expira * 1000 <= Date.now()) return fila("whatsapp", nombre, "error", frase(explicar("meta.token")), arreglarPaso("whatsapp"));
    return fila(
      "whatsapp",
      nombre,
      "atencion",
      `El token caduca el ${fecha(expira, config.calendario.zona)}: usa el permanente del usuario del sistema`,
      { texto: "Cambiar", paso: "whatsapp" },
    );
  }
  const numero = numeroDelNegocio();
  if (!numero) return fila("whatsapp", nombre, "ok", "Conectado");
  return fila("whatsapp", nombre, "ok", numero.nombre ? `${numero.texto} · ${numero.nombre}` : numero.texto);
}

async function filaMensajes(refrescar: boolean): Promise<Fila> {
  if (modoWhatsApp() === "prueba") return filaMensajesPrueba();
  const servidor = modoServidor();
  const nombre = servidor ? "Mensajes que llegan a tu servidor" : "Mensajes que llegan a este ordenador";
  if (!metaConectada()) return fila("mensajes", nombre, "atencion", "Primero conecta tu WhatsApp", arreglarPaso("whatsapp"));
  const url = urlPublica();
  if (!url) {
    const motivo = estadoTunel().error;
    const detalle = motivo ? `WhatsApp no recibe mensajes. ${frase(motivo)}` : "WhatsApp no recibe mensajes: el túnel está cerrado";
    const accion: Fila["accion"] = tokenNgrok() ? { texto: "Arreglar", arreglar: "tunel" } : arreglarPaso("whatsapp");
    return fila("mensajes", nombre, "error", detalle, accion);
  }
  const avisos = ultimosWebhooks();
  if (avisos.rechazado !== null && (avisos.valido === null || avisos.rechazado > avisos.valido)) {
    return fila("mensajes", nombre, "error", frase(explicar("meta.firma")), arreglarPaso("whatsapp"));
  }
  const app = await leerApp(refrescar);
  if (app !== TIEMPO && app !== null && app !== "red") {
    const suscrita = await comprobar(
      "suscripcion",
      `${claveToken()}|${env("WHATSAPP_BUSINESS_ACCOUNT_ID") ?? ""}|${app.id}`,
      () => leerSuscripcion(app.id),
      vidaSuscripcion,
      refrescar,
    );
    if (suscrita === false) {
      return fila("mensajes", nombre, "error", "Tu app de Meta no escucha esta cuenta: no llegarían los mensajes", { texto: "Arreglar", arreglar: "suscripcion" });
    }
  }
  const destino = estadoConexionMeta().webhookApuntaAqui;
  if (destino === false) return fila("mensajes", nombre, "error", "Meta avisa a otra dirección", { texto: "Arreglar", arreglar: "webhook" });
  if (avisos.valido !== null) {
    const donde = servidor ? `${url}/webhook` : "este ordenador";
    return fila("mensajes", nombre, "ok", `Meta avisa a ${donde} · último aviso ${hace(avisos.valido)}`);
  }
  if (servidor && destino === true) return fila("mensajes", nombre, "ok", `Meta avisa a ${url}/webhook`);
  return fila("mensajes", nombre, "atencion", "Aún no ha llegado nada de Meta desde que se abrió");
}

async function filaDatos(): Promise<Fila> {
  const nombre = "Tus datos";
  const inicio = Date.now();
  let total: ConTiempo<number>;
  try {
    total = await new Promise<ConTiempo<number>>((resolver, rechazar) => {
      const reloj = setTimeout(() => resolver(TIEMPO), TIEMPO_MS);
      (reloj as { unref?: () => void }).unref?.();
      contarLeads().then(
        (n) => {
          clearTimeout(reloj);
          resolver(n);
        },
        (e: unknown) => {
          clearTimeout(reloj);
          rechazar(e);
        },
      );
    });
  } catch (error) {
    return fila("datos", nombre, "error", frase(explicarBd(error)));
  }
  if (total === TIEMPO) return fila("datos", nombre, "atencion", NO_SE_HA_PODIDO);
  const ms = Date.now() - inicio;
  const clientes = total === 1 ? "1 cliente" : `${total} clientes`;
  if (process.env.BD_LOCAL) return fila("datos", nombre, "ok", `Datos de pruebas en este ordenador · ${clientes} · ${ms} ms`);
  if (process.env.SUPABASE_DB_URL) {
    if (ms > LENTO_MS) return fila("datos", nombre, "atencion", "Va lento: cada respuesta tarda más");
    return fila("datos", nombre, "ok", `Tus datos se guardan en Supabase · ${clientes} · ${ms} ms`);
  }
  if (modoServidor()) return fila("datos", nombre, "ok", "Tus datos se guardan en tu servidor y se copian cada día");
  return fila("datos", nombre, "ok", "Tus datos se guardan en este ordenador, en la carpeta datos/. Haz copia de esa carpeta.");
}

function filaAcceso(): Fila | null {
  try {
    if (estadoAcceso() !== "error") return null;
  } catch {
    return null;
  }
  return fila("acceso", "Acceso", "error", "El panel se puede abrir desde internet: cierra el CRM");
}

const GRAVEDAD: Record<EstadoFila, number> = { ok: 0, atencion: 1, error: 2 };

// ---- La lista completa (para la comprobación desde la terminal) ----

type Linea = NonNullable<EstadoConexiones["comprobaciones"]>[number];
const linea = (id: string, ok: boolean | null, texto: string, solucion?: string): Linea => ({ id, ok, texto, ...(solucion ? { solucion } : {}) });
const deFila = (id: string, f: Fila): Linea => linea(id, f.estado === "ok" ? true : f.estado === "atencion" ? null : false, f.detalle);
const EN_AJUSTES = "Pulsa Arreglar en Ajustes → Conexiones";

function lineaClaves(): Linea {
  const faltan = [
    ["ANTHROPIC_API_KEY", "la clave de Claude"],
    ["WHATSAPP_TOKEN", "el token de WhatsApp"],
    ["META_APP_SECRET", "la clave secreta de la app"],
    ["WHATSAPP_PHONE_NUMBER_ID", "el número de WhatsApp"],
    ["WHATSAPP_BUSINESS_ACCOUNT_ID", "la cuenta de WhatsApp"],
  ]
    .filter(([variable]) => !env(variable))
    .map(([, texto]) => texto);
  if (faltan.length === 0) return linea("claves", true, "Claves guardadas: Claude, WhatsApp y la clave secreta de la app");
  const lista = faltan.length === 1 ? faltan[0] : `${faltan.slice(0, -1).join(", ")} y ${faltan.at(-1)}`;
  return linea("claves", false, `Faltan claves: ${lista}`, "Pégalas en Ajustes → Conexiones");
}

async function lineaToken(config: ConfiguracionResuelta): Promise<Linea> {
  if (!metaConectada()) return linea("token", false, "Sin conectar", "Conecta tu WhatsApp en Ajustes → Conexiones");
  const app = await leerApp(false);
  if (app === null) {
    const e = explicar("meta.token");
    return linea("token", false, e.titulo, e.solucion);
  }
  if (app === TIEMPO || app === "red") return linea("token", null, "No se ha podido comprobar el token de Meta");
  const expira = await comprobar("caducidad", claveToken(), preguntarCaducidad, vidaCaducidad, false);
  if (expira === 0) return linea("token", true, "El token de Meta no caduca");
  if (typeof expira === "number") {
    if (expira * 1000 <= Date.now()) {
      const e = explicar("meta.token");
      return linea("token", false, e.titulo, e.solucion);
    }
    return linea("token", null, `El token de Meta caduca el ${fecha(expira, config.calendario.zona)}`, "Usa el permanente del usuario del sistema");
  }
  if (expira === null) return linea("token", true, "El token de Meta es válido");
  return linea("token", null, "No se ha podido comprobar si el token de Meta caduca");
}

async function lineaNumero(): Promise<Linea> {
  const waba = env("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const id = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!waba || !id || !env("WHATSAPP_TOKEN")) return linea("numero", false, "Falta el número de WhatsApp", "Conecta tu WhatsApp en Ajustes → Conexiones");
  const lista = await conTiempo(numeros(waba));
  if (lista === TIEMPO) return linea("numero", null, "No se ha podido comprobar el número de WhatsApp");
  const numero = lista.find((n) => n.id === id);
  if (!numero) return linea("numero", false, "El número no es de esa cuenta de WhatsApp", "Vuelve a conectar tu WhatsApp en Ajustes → Conexiones");
  const texto = numero.nombre ? `${numero.texto} · ${numero.nombre}` : numero.texto;
  return linea("numero", true, `El número del negocio: ${texto}${numero.prueba ? " (número de prueba de Meta)" : ""}`);
}

async function lineaPlantilla(config: ConfiguracionResuelta): Promise<Linea> {
  const { nombre, idioma } = config.plantilla;
  // Con el botón de WhatsApp en la web el cliente escribe primero: la bienvenida no se usa y no falta.
  if (config.web.entrada === "whatsapp") return linea("plantilla", true, "Tu web usa el botón de WhatsApp: no hace falta mensaje de bienvenida");
  const e = await conTiempo(estadoPlantilla(nombre, idioma));
  if (e === TIEMPO) return linea("plantilla", null, "No se ha podido comprobar el mensaje de bienvenida");
  if (e.estado === "APROBADA") return linea("plantilla", true, `Mensaje de bienvenida aprobado (${nombre})`);
  if (e.estado === "EN_REVISION") return linea("plantilla", null, `Meta está revisando el mensaje de bienvenida (${nombre})`);
  if (e.estado === "SIN_CLAVES") return linea("plantilla", false, "Sin conectar: no se puede mirar el mensaje de bienvenida", "Conecta tu WhatsApp en Ajustes → Conexiones");
  if (e.estado === "NO_EXISTE") return linea("plantilla", false, `El mensaje de bienvenida (${nombre}) no existe en Meta`, "Créalo en Ajustes → Conexiones");
  if (e.estado === "ERROR") return linea("plantilla", false, `No se ha podido leer el mensaje de bienvenida: ${e.motivo ?? "error de Meta"}`);
  return linea("plantilla", false, `El mensaje de bienvenida (${nombre}) no está aprobado${e.motivo ? `: ${e.motivo}` : ""}`, "Revísalo en Ajustes → Conexiones");
}

async function lineaAviso(config: ConfiguracionResuelta): Promise<Linea | null> {
  const telefono = telefonoComercial(config.sistema, process.env.TELEFONO_COMERCIAL, config.regional.prefijo);
  if (!telefono) return null;
  const sin = "Sin el aviso aprobado, los avisos solo te llegan si has escrito al número del negocio en las últimas 24 h";
  const e = await conTiempo(estadoPlantilla("aviso_comercial", "es_ES"));
  if (e !== TIEMPO && e.estado === "APROBADA") return linea("aviso", true, "El aviso a tu móvil está aprobado");
  return linea("aviso", null, sin);
}

async function lineaSuscripcion(): Promise<Linea> {
  if (!metaConectada()) return linea("suscripcion", false, "Sin conectar", "Conecta tu WhatsApp en Ajustes → Conexiones");
  const app = await leerApp(false);
  if (app === TIEMPO || app === "red" || app === null) return linea("suscripcion", null, "No se ha podido comprobar si tu app escucha la cuenta");
  const suscrita = await comprobar(
    "suscripcion",
    `${claveToken()}|${env("WHATSAPP_BUSINESS_ACCOUNT_ID") ?? ""}|${app.id}`,
    () => leerSuscripcion(app.id),
    vidaSuscripcion,
    false,
  );
  if (suscrita === true) return linea("suscripcion", true, "Tu app escucha esta cuenta de WhatsApp");
  if (suscrita === false) return linea("suscripcion", false, "Tu app de Meta no escucha esta cuenta: no llegarían los mensajes", EN_AJUSTES);
  return linea("suscripcion", null, "No se ha podido comprobar si tu app escucha la cuenta");
}

async function lineaSecreto(): Promise<Linea> {
  if (!env("WHATSAPP_TOKEN") || !env("META_APP_SECRET")) return linea("secreto", false, "Falta la clave secreta de la app", "Pégala en Ajustes → Conexiones");
  const r = await conTiempo(comprobarSecreto());
  if (r === true) return linea("secreto", true, "La clave secreta es de la app del token");
  if (r === false) return linea("secreto", false, "La clave secreta no es de la app del token", "Vuelve a pegar la clave secreta de la app en Ajustes → Conexiones");
  return linea("secreto", null, "No se ha podido comprobar la clave secreta");
}

function lineaUrl(url: string | null): Linea {
  if (url) return linea("url", true, `Los mensajes llegan a ${url}/webhook`);
  const motivo = estadoTunel().error;
  return linea("url", false, "WhatsApp no recibe mensajes: el túnel está cerrado", motivo ? frase(motivo) : undefined);
}

function lineaWebhook(): Linea {
  const destino = estadoConexionMeta().webhookApuntaAqui;
  if (destino === true) return linea("webhook", true, "Meta avisa a esta dirección");
  if (destino === false) return linea("webhook", false, "Meta avisa a otra dirección", EN_AJUSTES);
  return linea("webhook", null, "Aún no se sabe adónde avisa Meta");
}

async function lineaFirma(url: string | null): Promise<Linea> {
  if (!url || !env("META_APP_SECRET")) return linea("firma", null, "Sin dirección o sin clave secreta: no se puede comprobar la firma");
  const r = await conTiempo(comprobarFirma(url));
  if (r === true) return linea("firma", true, "Los avisos firmados llegan y se aceptan");
  const e = explicar("meta.firma");
  if (r === false) return linea("firma", false, e.titulo, e.solucion);
  return linea("firma", null, "No se ha podido comprobar la firma");
}

function lineaAcceso(): Linea {
  const a = estadoAcceso();
  if (a === "ok") return linea("acceso", true, "El panel no se puede abrir desde internet");
  if (a === "error") return linea("acceso", false, "El panel se puede abrir desde internet: cierra el CRM");
  return linea("acceso", null, "Sin comprobar el acceso desde internet");
}

/** El mismo orden que la transcripción: Google, Groq, OpenAI. */
async function lineaVoz(): Promise<Linea> {
  const base = process.env.TRANSCRIPCION_BASE_URL;
  const gemini = env("GEMINI_API_KEY");
  const groq = env("GROQ_API_KEY");
  const openai = env("OPENAI_API_KEY");
  const voz = gemini
    ? {
        nombre: "Google",
        url: `${base || "https://generativelanguage.googleapis.com/v1beta"}/models/${process.env.TRANSCRIPCION_MODELO || "gemini-3.5-transcribe"}`,
        cabeceras: { "x-goog-api-key": gemini } as Record<string, string>,
      }
    : groq
      ? { nombre: "Groq", url: `${base || "https://api.groq.com/openai/v1"}/models`, cabeceras: { Authorization: `Bearer ${groq}` } }
      : openai
        ? { nombre: "OpenAI", url: `${base || "https://api.openai.com/v1"}/models`, cabeceras: { Authorization: `Bearer ${openai}` } }
        : null;
  if (!voz) return linea("voz", null, "Sin clave de notas de voz: se pide que lo escriban");
  let status: number;
  try {
    const r = await fetch(voz.url, { headers: voz.cabeceras, signal: AbortSignal.timeout(TIEMPO_MS) });
    status = r.status;
  } catch {
    return linea("voz", null, `No se ha podido comprobar la clave de ${voz.nombre}`);
  }
  if (status === 200) return linea("voz", true, `Clave de ${voz.nombre} válida: las notas de voz se transcriben`);
  if (status === 404) return linea("voz", false, `El modelo de transcripción no está disponible con esta clave de ${voz.nombre}`);
  if (status === 400 || status === 401 || status === 403) return linea("voz", false, `La clave de ${voz.nombre} no es válida`, "Vuelve a pegarla en Ajustes → Conexiones");
  return linea("voz", null, `${voz.nombre} ha respondido ${status}`, "Vuelve a probar en un momento");
}

async function lineaInstrucciones(): Promise<Linea> {
  const r = await conTiempo(configuracionActiva());
  if (r === TIEMPO) return linea("instrucciones", false, "No se han podido leer las instrucciones del asistente");
  return linea("instrucciones", true, `Instrucciones del asistente: ${r.perfil.nombre}`);
}

async function listaCompleta(config: ConfiguracionResuelta, filas: Fila[]): Promise<Linea[]> {
  const de = (id: Fila["id"]) => filas.find((f) => f.id === id);
  const url = urlPublica();
  const resultado = await Promise.all([
    lineaClaves(),
    deFila("claude", de("claude")!),
    lineaToken(config),
    lineaNumero(),
    lineaPlantilla(config),
    lineaAviso(config),
    lineaSuscripcion(),
    lineaSecreto(),
    lineaUrl(url),
    lineaWebhook(),
    lineaFirma(url),
    lineaAcceso(),
    deFila("datos", de("datos")!),
    lineaVoz(),
    lineaInstrucciones(),
  ]);
  return resultado.filter((l): l is Linea => l !== null);
}

/** Todo pasa por el censor y solo van los campos del tipo. */
function limpio(e: EstadoConexiones): EstadoConexiones {
  return {
    comprobadoEn: e.comprobadoEn,
    resumen: e.resumen,
    filas: e.filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      estado: f.estado,
      detalle: censurar(f.detalle),
      ...(f.accion ? { accion: { ...f.accion } } : {}),
    })),
    numeroDePrueba: e.numeroDePrueba,
    ...(e.comprobaciones
      ? {
          comprobaciones: e.comprobaciones.map((c) => ({
            id: c.id,
            ok: c.ok,
            texto: censurar(c.texto),
            ...(c.solucion ? { solucion: censurar(c.solucion) } : {}),
          })),
        }
      : {}),
  };
}

async function calcular(refrescar: boolean, completo: boolean): Promise<EstadoConexiones> {
  const pintar = await conTiempo(configuracionParaPintar());
  const config = pintar === TIEMPO ? configuracionPorDefecto() : pintar;
  const seguro = (id: Fila["id"], nombre: string, f: () => Promise<Fila>): Promise<Fila> =>
    f().catch(() => fila(id, nombre, "atencion", NO_SE_HA_PODIDO));
  const filas = await Promise.all([
    seguro("claude", "Claude (tu asistente)", () => filaClaude(config, refrescar)),
    seguro("whatsapp", "WhatsApp", () => filaWhatsApp(config, refrescar)),
    seguro("mensajes", modoServidor() ? "Mensajes que llegan a tu servidor" : "Mensajes que llegan a este ordenador", () => filaMensajes(refrescar)),
    seguro("datos", "Tus datos", () => filaDatos()),
  ]);
  const acceso = filaAcceso();
  if (acceso) filas.push(acceso);
  let numeroDePrueba = false;
  try {
    numeroDePrueba = modoWhatsApp() === "prueba" ? false : (numeroDelNegocio()?.prueba ?? false);
  } catch {
    numeroDePrueba = false;
  }
  const resumen = filas.reduce<EstadoFila>((peor, f) => (GRAVEDAD[f.estado] > GRAVEDAD[peor] ? f.estado : peor), "ok");
  const estado: EstadoConexiones = { comprobadoEn: Date.now(), resumen, filas, numeroDePrueba };
  if (completo) estado.comprobaciones = await listaCompleta(config, filas);
  return limpio(estado);
}

/**
 * Cómo están Claude, WhatsApp, los mensajes, los datos y (solo si falla) el acceso. Se guarda 60 s;
 * `forzar` vuelve a mirar todo si lo último tiene más de 10 s; `completo` siempre mira de nuevo y
 * añade la lista de comprobaciones. Solo lee: lo único que escribe es «Arreglar».
 */
export async function estadoConexiones(o?: { forzar?: boolean; completo?: boolean }): Promise<EstadoConexiones> {
  const c = conexiones();
  const completo = !!o?.completo;
  if (!completo && c.ultimo) {
    const edad = Date.now() - c.ultimo.comprobadoEn;
    if (edad < VIDA_CONEXIONES_MS && (!o?.forzar || edad < ESPERA_FORZAR_MS)) return structuredClone(c.ultimo);
  }
  if (!completo && c.calculando) return structuredClone(await c.calculando);
  const promesa = calcular(!!o?.forzar || completo, completo);
  if (!completo) c.calculando = promesa;
  try {
    const estado = await promesa;
    const { comprobaciones: _lista, ...sinLista } = estado;
    c.ultimo = sinLista;
    return structuredClone(estado);
  } finally {
    if (c.calculando === promesa) c.calculando = null;
  }
}

/** La contraseña de una cadena de conexión, tal cual y descodificada. */
function contrasenaDe(url: string): string[] {
  try {
    const crudo = new URL(url).password;
    if (!crudo) return [];
    let descodificado = crudo;
    try {
      descodificado = decodeURIComponent(crudo);
    } catch {
      // Una contraseña mal codificada se tapa tal cual.
    }
    return [crudo, descodificado];
  } catch {
    return [];
  }
}

/** Tapa con «•••» el valor de cada clave que aparezca en el texto y lo deja en 160 caracteres. */
export function censurar(texto: string): string {
  const valores = new Set<string>();
  for (const nombre of SECRETOS) {
    const valor = process.env[nombre];
    if (!valor) continue;
    valores.add(valor);
    if (nombre === "SUPABASE_DB_URL") for (const parte of contrasenaDe(valor)) valores.add(parte);
  }
  // Los largos primero: una clave puede contener a otra más corta.
  const ordenados = [...valores].filter((v) => v.length >= MINIMO_SECRETO).sort((a, b) => b.length - a.length);
  let salida = texto;
  for (const valor of ordenados) salida = salida.split(valor).join(TAPADO);
  return Array.from(salida).slice(0, MAXIMO_TEXTO).join("");
}
