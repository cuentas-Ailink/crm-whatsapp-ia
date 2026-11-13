// Cuentas de Meta y estado de la clave de Claude para el simulador: la app, el token, las cuentas de
// WhatsApp, los números, la suscripción, el webhook y las plantillas, con datos de prueba fijos.
// Sin dependencias. scripts/simulador.mjs llama a manejar() antes de sus respuestas de siempre.
//
//   GET /ajustes?cuentas=0|1|2&numeroPrueba=0|1&aprobar=0|1&claude=ok|sin-saldo|clave-mala&caduca=0|1&plantillas=0|1
//                &categoriaNuevas=MARKETING|UTILITY   (la categoría que «pone Meta» a las que se creen después;
//                                                       sin ella, la que se pide)
//   POST /registro/vaciar   todo vuelve a como empieza

import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";
import { Server } from "node:http";

const TOKEN = "token-de-prueba";
const SECRETO = "secreto-de-prueba";
const APP = { id: "1234567890", nombre: "CRM de prueba" };
const TOKEN_APP = `${APP.id}|${SECRETO}`;
const APROBAR_TRAS_MS = 1000;

const CUERPO_POR_DEFECTO =
  "Hola {{1}}, soy el asistente de {{2}}. Acabamos de recibir tu solicitud. Para preparar bien la visita, ¿me cuentas en una frase qué te gustaría reformar?";
const CUERPO_GENERAL = "Hola {{1}}, soy el asistente virtual de {{2}}. Acabamos de recibir tu solicitud. ¿Me cuentas en una frase qué necesitas?";
const CUERPO_SEGUIMIENTO = "Hola {{1}}, soy de {{2}}. Te escribo por {{3}}. ¿Te viene bien que lo hablemos?";
const CUERPO_NOMBRADA = "Hola {{nombre}}, tenemos una oferta para ti.";
const CATEGORIAS = ["MARKETING", "UTILITY"];

// ---- Las cabeceras de la petición en curso ----
// manejar() recibe método, ruta, consulta y cuerpo, no las cabeceras. Para leer el token de cada
// petición, cada «request» del servidor HTTP de este proceso corre dentro de un AsyncLocalStorage
// con su petición; el contexto sigue por todos los await del manejador del simulador.
const peticionActual = new AsyncLocalStorage();
const emitirOriginal = Server.prototype.emit;
Server.prototype.emit = function emitir(evento, ...argumentos) {
  if (evento === "request") return peticionActual.run(argumentos[0], () => emitirOriginal.call(this, evento, ...argumentos));
  return emitirOriginal.call(this, evento, ...argumentos);
};

/** El token de la petición: «Authorization: Bearer …» o ?access_token=. null si no se sabe (llamada directa). */
function tokenDe(consulta, cabeceras) {
  const autorizacion = cabeceras?.authorization ?? peticionActual.getStore()?.headers?.authorization;
  if (typeof autorizacion === "string") return autorizacion.replace(/^Bearer\s+/i, "");
  if (consulta?.get?.("access_token")) return consulta.get("access_token");
  if (!cabeceras && !peticionActual.getStore()) return null;
  return "";
}

// ---- Estado ----

function plantillasDePartida(completas) {
  const fila = (name, language, text, category = "UTILITY") => ({ id: `${++contadorPlantillas}`, name, language, status: "APPROVED", category, components: [{ type: "BODY", text }], rejected_reason: "NONE", creada: 0 });
  const holaMundo = fila("hello_world", "en_US", "Hello World");
  if (!completas) return [holaMundo];
  return [
    fila("solicitud_recibida", "es_ES", CUERPO_POR_DEFECTO),
    fila("solicitud_general", "es_ES", CUERPO_GENERAL),
    holaMundo,
    // Para «Retomar la conversación»: una con un dato más que pedir y otra con una variable con nombre,
    // que la app no puede rellenar y no ofrece.
    fila("seguimiento_presupuesto", "es_ES", CUERPO_SEGUIMIENTO, "MARKETING"),
    fila("oferta_nombrada", "es_ES", CUERPO_NOMBRADA, "MARKETING"),
  ];
}

let contadorPlantillas = 0;
let ajustes;
let suscrita;
let callback;
let override;
let plantillas;

export function reiniciar() {
  ajustes = { cuentas: 1, numeroPrueba: false, aprobar: true, claude: "ok", caduca: false, categoriaNuevas: null };
  suscrita = false;
  callback = null;
  override = null;
  plantillas = plantillasDePartida(true);
}
reiniciar();

/** @param {URLSearchParams} consulta */
export function ajustar(consulta) {
  const si = (nombre) => consulta.get(nombre) === "1";
  if (consulta.has("cuentas")) ajustes.cuentas = Math.max(0, Math.min(2, Number(consulta.get("cuentas")) || 0));
  if (consulta.has("numeroPrueba")) ajustes.numeroPrueba = si("numeroPrueba");
  if (consulta.has("aprobar")) ajustes.aprobar = si("aprobar");
  if (consulta.has("claude") && ["ok", "sin-saldo", "clave-mala"].includes(consulta.get("claude"))) ajustes.claude = consulta.get("claude");
  if (consulta.has("caduca")) ajustes.caduca = si("caduca");
  if (consulta.has("plantillas")) plantillas = plantillasDePartida(si("plantillas"));
  if (consulta.has("categoriaNuevas")) ajustes.categoriaNuevas = CATEGORIAS.includes(consulta.get("categoriaNuevas")) ? consulta.get("categoriaNuevas") : null;
}

/** @returns {"ok" | "sin-saldo" | "clave-mala"} */
export function estadoClaude() {
  return ajustes.claude;
}

// ---- Datos de prueba ----

function cuentas() {
  const lista = [{ id: "987654321", name: "Estudio de prueba" }];
  if (ajustes.cuentas === 2) lista.push({ id: "987654322", name: "Otra cuenta de prueba" });
  return lista;
}

/** Las cuentas que ve el token en debug_token (con cuentas=0, ninguna; la primera sigue existiendo). */
function cuentasDelPermiso() {
  if (ajustes.cuentas === 0) return [];
  return cuentas().map((c) => c.id);
}

function cuenta(id) {
  return cuentas().find((c) => c.id === id) ?? null;
}

function numerosDe(waba) {
  if (waba === "987654321") {
    const prueba = ajustes.numeroPrueba;
    return [
      {
        id: "123456789",
        display_phone_number: prueba ? "+1 555 0100" : "+34 600 000 000",
        verified_name: prueba ? "Test Number" : "Estudio de prueba",
        quality_rating: "GREEN",
        account_mode: prueba ? "SANDBOX" : "LIVE",
      },
    ];
  }
  if (waba === "987654322" && cuenta(waba)) {
    return [{ id: "123456780", display_phone_number: "+34 600 000 001", verified_name: "Otra cuenta de prueba", quality_rating: "GREEN", account_mode: "LIVE" }];
  }
  return [];
}

function numero(id) {
  for (const c of cuentas()) {
    const n = numerosDe(c.id).find((x) => x.id === id);
    if (n) return n;
  }
  return null;
}

// ---- Respuestas ----

const bien = (cuerpo) => ({ estado: 200, cuerpo });
const tokenMalo = () => ({ estado: 401, cuerpo: { error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } } });
const noExiste = () => ({ estado: 400, cuerpo: { error: { message: "Unsupported get request.", type: "GraphMethodException", code: 100 } } });
const verificacionFallida = (detalle) => ({
  estado: 400,
  cuerpo: { error: { message: `(#2200) Callback verification failed with the following errors: ${detalle}`, type: "OAuthException", code: 2200 } },
});

/** Meta comprueba la dirección del webhook: GET con hub.challenge, que tiene que volver tal cual. */
async function verificar(url, tokenVerificacion) {
  const reto = randomBytes(8).toString("hex");
  let destino;
  try {
    destino = new URL(url);
  } catch {
    return "URL no válida";
  }
  destino.searchParams.set("hub.mode", "subscribe");
  destino.searchParams.set("hub.verify_token", String(tokenVerificacion ?? ""));
  destino.searchParams.set("hub.challenge", reto);
  try {
    const r = await fetch(destino, { signal: AbortSignal.timeout(10_000) });
    const texto = await r.text();
    if (r.status === 200 && texto === reto) return null;
    return `HTTP Status Code = ${r.status}; HTTP Message = ${r.statusText || "sin texto"}`;
  } catch {
    return "No se ha podido conectar con la dirección";
  }
}

/** Las plantillas pendientes pasan a aprobadas al leerlas pasado un segundo, si aprobar está encendido. */
function aprobarPendientes() {
  if (!ajustes.aprobar) return;
  const ahora = Date.now();
  for (const p of plantillas) if (p.status === "PENDING" && ahora - p.creada >= APROBAR_TRAS_MS) p.status = "APPROVED";
}

const publica = ({ creada: _creada, ...resto }) => resto;

/**
 * @param {string} metodo @param {string} ruta «/graph/app» o, sin «/graph», «/app»
 * @param {URLSearchParams} consulta @param {unknown} cuerpo
 * @param {Record<string, string | string[] | undefined>} [cabeceras] si no llegan, las de la petición en curso
 * @returns {{ estado: number, cuerpo: unknown } | null | Promise<{ estado: number, cuerpo: unknown } | null>} null = no lo atiende
 */
export function manejar(metodo, ruta, consulta, cuerpo, cabeceras) {
  const limpia = ruta.startsWith("/graph/") ? ruta.slice("/graph".length) : ruta;
  const partes = limpia.split("/").filter(Boolean);
  const datos = cuerpo && typeof cuerpo === "object" ? cuerpo : {};
  const token = tokenDe(consulta, cabeceras);
  // null: llamada directa sin cabeceras, se da por buena.
  const conUsuario = token === null || token === TOKEN;
  const conApp = token === null || token === TOKEN_APP;
  const [primero, segundo] = partes;

  if (partes.length === 1 && primero === "app" && metodo === "GET") return conUsuario ? bien({ id: APP.id }) : tokenMalo();

  if (partes.length === 1 && primero === "me" && metodo === "GET") {
    if (!conUsuario) return tokenMalo();
    const prueba = consulta.get("appsecret_proof");
    const esperada = createHmac("sha256", SECRETO).update(token ?? TOKEN).digest("hex");
    if (prueba !== null && prueba !== esperada) {
      return { estado: 400, cuerpo: { error: { message: "Invalid appsecret_proof provided in the API argument", type: "GraphMethodException", code: 100 } } };
    }
    return bien({ id: "1122334455", name: "Usuario del sistema" });
  }

  if (partes.length === 1 && primero === "debug_token" && metodo === "GET") {
    if (!conApp) return tokenMalo();
    const entrada = consulta.get("input_token");
    const ids = cuentasDelPermiso();
    const granular_scopes =
      ajustes.cuentas === 0
        ? [{ scope: "business_management" }]
        : [
            { scope: "whatsapp_business_management", target_ids: ids },
            { scope: "whatsapp_business_messaging", target_ids: ids },
          ];
    return bien({
      data: {
        app_id: APP.id,
        type: "SYSTEM_USER",
        application: APP.nombre,
        is_valid: entrada === TOKEN,
        expires_at: ajustes.caduca ? Math.floor(Date.now() / 1000) + 23 * 3600 : 0,
        granular_scopes,
      },
    });
  }

  // La app: su suscripción al webhook (con el token de la app).
  if (partes.length === 2 && primero === APP.id && segundo === "subscriptions") {
    if (!conApp) return tokenMalo();
    if (metodo === "GET") {
      return bien({ data: callback ? [{ object: "whatsapp_business_account", callback_url: callback, active: true, fields: [{ name: "messages", version: "v26.0" }] }] : [] });
    }
    if (metodo === "POST") {
      return (async () => {
        const url = String(datos.callback_url ?? "");
        const fallo = await verificar(url, datos.verify_token);
        if (fallo) return verificacionFallida(fallo);
        callback = url;
        return bien({ success: true });
      })();
    }
    return null;
  }

  // Una cuenta de WhatsApp.
  if (primero && cuenta(primero)) {
    const waba = primero;
    if (!conUsuario) return tokenMalo();
    if (partes.length === 1 && metodo === "GET") return bien({ id: waba, name: cuenta(waba).name });
    if (partes.length === 2 && segundo === "phone_numbers" && metodo === "GET") return bien({ data: numerosDe(waba) });
    if (partes.length === 2 && segundo === "subscribed_apps") {
      if (metodo === "GET") {
        return bien({
          data: suscrita ? [{ whatsapp_business_api_data: { id: APP.id, name: APP.nombre }, ...(override ? { override_callback_uri: override } : {}) }] : [],
        });
      }
      if (metodo === "POST") {
        suscrita = true;
        if (!datos.override_callback_uri) return bien({ success: true });
        return (async () => {
          const url = String(datos.override_callback_uri);
          const fallo = await verificar(url, datos.verify_token);
          if (fallo) return verificacionFallida(fallo);
          override = url;
          return bien({ success: true });
        })();
      }
      return null;
    }
    if (partes.length === 2 && segundo === "message_templates") {
      if (metodo === "GET") {
        aprobarPendientes();
        const nombre = consulta.get("name");
        const estado = consulta.get("status");
        const data = plantillas.filter((p) => (!nombre || p.name === nombre) && (!estado || p.status === estado)).map(publica);
        return bien({ data, paging: {} });
      }
      if (metodo === "POST") {
        const name = String(datos.name ?? "");
        const language = String(datos.language ?? "");
        if (plantillas.some((p) => p.name === name && p.language === language)) {
          return { estado: 400, cuerpo: { error: { message: "Message template already exists in this language", type: "OAuthException", code: 100, error_subcode: 2388024 } } };
        }
        const componentes = Array.isArray(datos.components) ? datos.components : [];
        const texto = componentes.find((c) => c?.type === "BODY")?.text ?? "";
        const rechazada = name.includes("rechazar");
        const nueva = {
          id: `${++contadorPlantillas}`,
          name,
          language,
          status: rechazada ? "REJECTED" : "PENDING",
          // Meta puede cambiar la categoría que se pide (una UTILITY que considera MARKETING).
          category: ajustes.categoriaNuevas ?? String(datos.category ?? "UTILITY"),
          components: [{ type: "BODY", text: texto }],
          rejected_reason: rechazada ? "INVALID_FORMAT" : "NONE",
          creada: Date.now(),
        };
        plantillas.push(nueva);
        return bien({ id: nueva.id, status: nueva.status, category: nueva.category });
      }
      return null;
    }
    return null;
  }

  // Un número.
  if (partes.length === 1 && metodo === "GET" && numero(primero)) return conUsuario ? bien(numero(primero)) : tokenMalo();

  // Una cuenta que no es de este token (o que no existe).
  const deCuenta = partes.length === 2 && ["phone_numbers", "subscribed_apps", "message_templates"].includes(segundo);
  const nombreDeCuenta = partes.length === 1 && metodo === "GET" && /(^|,)name(,|$)/.test(consulta.get("fields") ?? "");
  if (/^\d+$/.test(primero ?? "") && (deCuenta || nombreDeCuenta)) return conUsuario ? noExiste() : tokenMalo();

  return null;
}
