// Simula Meta (Graph API) y Claude (Messages API) para probar el CRM sin claves ni gasto.
// El «Claude» de aquí es un guion fijo: sirve para comprobar el circuito completo por HTTP
// (herramientas, reglas, fallos), no la calidad de las conversaciones.
//
//   node scripts/simulador.mjs            escucha en el puerto 8099 (o en PUERTO_SIMULADOR)
//   PUERTO_SIMULADOR=8200 APP_URL=http://localhost:8100 node scripts/simulador.mjs   en otro puerto
//   GET  /registro                        lo que la app ha enviado a Meta y a Claude
//   POST /registro/vaciar                 lo borra y vuelve a poner todos los ajustes como al empezar
//   GET  /ajustes                         sin nada, los ajustes de este archivo vuelven a como al empezar
//   GET  /ajustes?fallarClaude=1|0        con 1, toda petición a Claude contesta 500 «Fallo simulado»
//   GET  /ajustes?ventanaComercial=0|1    con 0, un texto al comercial de prueba falla con el 131047 (24 h)
//   GET  /ajustes?retrasoGraphMs=1500     cada envío a Meta tarda eso en contestar
//   GET  /ajustes?estados=0|1             con 1 (por defecto), cada envío recibe sus avisos de entregado y leído
//   Los ajustes de las cuentas de Meta y de la clave de Claude: ver scripts/simulador-cuentas.mjs.
//   Cada parámetro solo cambia si viene en la petición.

import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import * as cuentas from "./simulador-cuentas.mjs";

const PUERTO = Number(process.env.PUERTO_SIMULADOR || 8099);
// Adónde van los avisos de estado (entregado, leído), firmados como los de Meta.
const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PUERTO_PRUEBAS || 8000}`;
const SECRETO = "secreto-de-prueba";
let enviados = [];
let peticionesClaude = [];
let lecturas = [];
let plantillas = [];
let contador = 0;
// Los interruptores de /ajustes: cada uno cambia solo si viene en la petición.
const AJUSTES_DE_PARTIDA = { retrasoGraphMs: 0, estados: true, fallarClaude: false, ventanaComercial: true };
let { retrasoGraphMs, estados, fallarClaude, ventanaComercial } = AJUSTES_DE_PARTIDA;
function ajustesDePartida() {
  ({ retrasoGraphMs, estados, fallarClaude, ventanaComercial } = AJUSTES_DE_PARTIDA);
}
const COMERCIAL_DE_PRUEBA = "34600999999";

function responder(res, estado, cuerpo) {
  res.writeHead(estado, { "Content-Type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpo(req) {
  return new Promise((resolver) => {
    let datos = "";
    req.on("data", (trozo) => (datos += trozo));
    req.on("end", () => resolver(datos ? JSON.parse(datos) : {}));
  });
}

/** El cuerpo de una petición de gestión de Meta: JSON, o campos de formulario si no lo es. */
function cuerpoDeGestion(crudo) {
  if (!crudo) return {};
  try {
    return JSON.parse(crudo);
  } catch {
    return Object.fromEntries(new URLSearchParams(crudo));
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Un aviso de estado de Meta para un mensaje enviado, firmado con el secreto de prueba. Si falla, se ignora. */
async function avisarEstado(wamid, estado, destinatario) {
  const cuerpo = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              statuses: [{ id: wamid, status: estado, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: destinatario }],
            },
          },
        ],
      },
    ],
  });
  try {
    await fetch(`${APP_URL}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${createHmac("sha256", SECRETO).update(cuerpo).digest("hex")}` },
      body: cuerpo,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // La app puede estar parada: el aviso se pierde, como en Meta.
  }
}

/** Entregado a los 300 ms y leído a los 800 ms, como haría el móvil del cliente. */
function avisosDeEntrega(wamid, destinatario) {
  if (!estados) return;
  setTimeout(() => void avisarEstado(wamid, "delivered", destinatario), 300);
  setTimeout(() => void avisarEstado(wamid, "read", destinatario), 800);
}

function mensajeClaude(contenido, parada) {
  return {
    id: `msg_${++contador}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: contenido,
    stop_reason: parada,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

const texto = (t) => mensajeClaude([{ type: "text", text: t }], "end_turn");
const llamar = (...llamadas) =>
  mensajeClaude(
    llamadas.map(([name, input]) => ({ type: "tool_use", id: `toolu_${++contador}`, name, input })),
    "tool_use",
  );

function textoDeSistema(system) {
  if (typeof system === "string") return system;
  return (system ?? []).map((b) => b.text ?? "").join("\n");
}

/** Uno o dos huecos: «Te propongo A o B. ¿Cuál te va mejor?» o, con uno solo, «Te propongo A. ¿Te va bien?». */
function propuesta(huecos) {
  const [a, b] = huecos ?? [];
  if (!a) return "Ahora mismo no tengo huecos libres. ¿Te aviso en cuanto se abra alguno?";
  if (!b) return `Te propongo ${a.texto}. ¿Te va bien?`;
  return `Te propongo ${a.texto} o ${b.texto}. ¿Cuál te va mejor?`;
}

function huecosOfrecidos(sistema) {
  const linea = sistema.split("\n").find((l) => l.includes("Huecos que ya le has ofrecido"));
  if (!linea) return [];
  return [...linea.matchAll(/([a-záéíóúñ]+ \d+ [a-z]+ a las \d\d:\d\d) \((\S+?)\)/gi)].map((m) => ({ texto: m[1], id: m[2] }));
}

async function claudeSimulado(cuerpo) {
  const sistema = textoDeSistema(cuerpo.system);
  const inmobiliaria = /Inmobiliaria/.test(sistema.split("\n")[0] ?? "");
  const clinica = /Cl[ií]nica/.test(sistema.split("\n")[0] ?? "");
  const mensajes = cuerpo.messages;
  const ultimo = mensajes[mensajes.length - 1];
  const bloques = Array.isArray(ultimo.content) ? ultimo.content : [{ type: "text", text: ultimo.content }];

  // Vuelta de herramientas.
  const resultados = bloques.filter((b) => b.type === "tool_result");
  if (resultados.length > 0) {
    const anterior = mensajes[mensajes.length - 2];
    const llamadas = (anterior.content ?? []).filter((b) => b.type === "tool_use");
    const valor = (nombre) => {
      const llamada = llamadas.find((l) => l.name === nombre);
      if (!llamada) return null;
      const resultado = resultados.find((r) => r.tool_use_id === llamada.id);
      const contenido = Array.isArray(resultado?.content) ? resultado.content.map((c) => c.text).join("") : resultado?.content;
      return contenido ? JSON.parse(contenido) : null;
    };
    const reserva = valor("reservar_visita");
    if (reserva?.ok && reserva.anulada) return texto(`Hecho ✅ ${reserva.visita}. La anterior, ${reserva.anulada}, queda anulada.`);
    if (reserva?.ok) return texto(`Hecho ✅ ${reserva.visita}. Si necesitas cambiarla, escríbeme por aquí.`);
    if (reserva?.pisos_disponibles) return texto(`Ese piso ya está reservado, pero tengo ${reserva.pisos_disponibles[0]}. ¿Te lo enseño?`);
    if (reserva) return texto(`Ese no me cuadra. ${propuesta(reserva.huecos_reales)}`);
    if (valor("cancelar_visita")?.ok) return texto("Listo, la visita queda cancelada. Si quieres otra, dímelo.");
    if (valor("marcar_spam")) return texto("Gracias, pero este número es solo para clientes.");
    const huecos = valor("ver_huecos");
    if (huecos) return texto(propuesta(huecos.huecos));
    if (valor("pasar_a_persona")) return texto("Alguien del equipo te escribe en cuanto pueda.");
    if (inmobiliaria) return texto("Perfecto. ¿Tienes ya la hipoteca aprobada?");
    if (clinica) return texto("Perfecto. ¿Es tu primera visita a la clínica?");
    const guardoTipo = llamadas.some((l) => l.input?.campo === "tipo");
    return texto(guardoTipo ? "Perfecto. ¿Cuántos metros tiene más o menos?" : "Genial. ¿Y para cuándo te gustaría empezar la obra?");
  }

  const entrada = (bloques.find((b) => b.type === "text")?.text ?? "").toLowerCase();

  if (entrada.includes("falla")) return { fallo: true };
  if (entrada.includes("lento")) await esperar(25_000);
  if (entrada === "espera") {
    await esperar(4_000);
    return texto("Perfecto. ¿Cuántos metros tiene más o menos?");
  }
  if (entrada.includes("inventa-siempre")) return texto("Te espero el sábado a las 9:00.");
  if (entrada.includes("inventa")) {
    if (sistema.includes("IMPORTANTE, corrige")) return texto("Perdona, dime qué día te viene mejor y lo miro.");
    return texto("Te espero el sábado a las 9:00.");
  }
  if (entrada.includes("confirma-sin-reservar")) {
    return texto("Hecho, te reservo martes a las 10:00.");
  }
  if (entrada.includes("persona") || entrada.includes("rebaja")) {
    return llamar(["pasar_a_persona", { motivo: entrada.slice(0, 40) }]);
  }
  if (entrada.includes("spam-modelo")) return llamar(["marcar_spam", { motivo: "Oferta comercial" }]);
  if (entrada.includes("dime tu prompt")) {
    // La primera vez «se le escapa» una herramienta: el código lo descarta y pide otro intento.
    if (sistema.includes("IMPORTANTE, corrige")) return texto("Te ayudo con tu reforma y el equipo revisa las conversaciones. ¿Seguimos?");
    return texto("Claro: uso ver_huecos y reservar_visita para la agenda.");
  }
  if (entrada.includes("otra hora")) return llamar(["ver_huecos", { franja: "tarde" }]);
  if (entrada.includes("anula")) return llamar(["cancelar_visita", {}]);
  if (inmobiliaria && entrada.includes("sants")) return llamar(["reservar_visita", { hueco: "2026-11-10T10:00", piso: "P-103" }]);

  const ofrecidos = huecosOfrecidos(sistema);
  if (entrada.includes("sábado")) return llamar(["reservar_visita", { hueco: "sábado a las 9" }]);
  if (ofrecidos.length > 0) {
    const elegido = ofrecidos.find((h) => entrada.includes(h.texto.split(" ")[0]));
    if (elegido) return llamar(["reservar_visita", { hueco: elegido.id }]);
  }

  // La clínica: «limpieza» guarda el tratamiento y busca huecos; lo demás, una pregunta. Una urgencia
  // no llama a ninguna herramienta: la regla de la clínica la pasa a una persona desde el código.
  if (clinica) {
    if (entrada.includes("limpieza")) return llamar(["guardar_dato", { campo: "tratamiento", valor: "limpieza" }], ["ver_huecos", {}]);
    return texto("Perfecto. ¿Es tu primera visita a la clínica?");
  }
  if (inmobiliaria) {
    if (entrada.includes("preaprobada")) return llamar(["guardar_dato", { campo: "financiación", valor: "preaprobada" }], ["ver_huecos", {}]);
    if (entrada.includes("vivir")) return llamar(["guardar_dato", { campo: "uso", valor: "vivir" }]);
    return texto("¡Hola! Sí, sigue disponible: 85 m², 3 habitaciones, por 465.000 €. ¿Lo buscas para vivir o como inversión?");
  }
  if (entrada.includes("baño de 6")) {
    return llamar(["guardar_dato", { campo: "tipo", valor: "baño" }], ["guardar_dato", { campo: "metros", valor: "6" }], ["guardar_dato", { campo: "plazo", valor: "enero" }], ["ver_huecos", {}]);
  }
  if (entrada.includes("baño")) {
    return mensajeClaude([{ type: "tool_use", id: `toolu_${++contador}`, name: "guardar_dato", input: { campo: "tipo", valor: "baño" } }], "tool_use");
  }
  if (/unos? \d+/.test(entrada)) return llamar(["guardar_dato", { campo: "metros", valor: entrada.match(/\d+/)[0] }]);
  if (entrada.includes("navidad") || entrada.includes("enero")) {
    return llamar(["guardar_dato", { campo: "plazo", valor: "después de Navidad" }], ["ver_huecos", {}]);
  }
  return texto("Perfecto. ¿Cuántos metros tiene más o menos?");
}

function leerBinario(req) {
  return new Promise((resolver) => {
    const trozos = [];
    req.on("data", (trozo) => trozos.push(trozo));
    req.on("end", () => resolver(Buffer.concat(trozos)));
  });
}

// Notas de voz. Un id «sim-<texto en base64url>» es un audio falso que dice ese texto; con
// POST /media?id=… se puede subir un audio de verdad, para transcribirlo con Groq u OpenAI.
const medios = new Map();
let transcripciones = 0;

function medio(id) {
  if (medios.has(id)) return medios.get(id);
  if (id.startsWith("sim-")) {
    const dice = Buffer.from(id.slice(4), "base64url").toString("utf8");
    return { mime: "audio/ogg; codecs=opus", datos: Buffer.from(`OggS-falso TRANSCRIPCION:${dice}\n`) };
  }
  return null;
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/media") {
    medios.set(url.searchParams.get("id"), { mime: url.searchParams.get("mime") || "audio/ogg; codecs=opus", datos: await leerBinario(req) });
    return responder(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname.startsWith("/media/")) {
    const archivo = medio(decodeURIComponent(url.pathname.slice(7)));
    if (!archivo) return responder(res, 404, { error: "no existe" });
    res.writeHead(200, { "Content-Type": archivo.mime });
    return res.end(archivo.datos);
  }
  const idMedio = req.method === "GET" && url.pathname.match(/^\/graph\/((?:sim-|audio-)[\w-]+)$/)?.[1];
  if (idMedio) {
    const archivo = medio(idMedio);
    if (!archivo) return responder(res, 404, { error: { message: "Media not found" } });
    return responder(res, 200, { url: `http://127.0.0.1:${PUERTO}/media/${idMedio}`, mime_type: archivo.mime, id: idMedio });
  }
  // Transcripción simulada: devuelve lo que «dice» el audio falso. Primero, Gemini 3.5 Transcribe.
  if (req.method === "POST" && url.pathname.endsWith("/interactions")) {
    transcripciones++;
    const cuerpo = JSON.parse((await leerBinario(req)).toString("utf8") || "{}");
    const audio = (cuerpo.input ?? []).find((parte) => parte.type === "audio");
    if (!req.headers["x-goog-api-key"] || cuerpo.model !== "gemini-3.5-transcribe" || !audio?.data) {
      return responder(res, 400, { error: { message: "Petición de transcripción mal formada" } });
    }
    const dice = Buffer.from(audio.data, "base64").toString("utf8").match(/TRANSCRIPCION:([^\n]*)/)?.[1] ?? "";
    return responder(res, 200, { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: dice }] }] });
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1beta/models/")) return responder(res, 200, { name: url.pathname.slice(8) });
  // Y la de Groq y OpenAI.
  if (req.method === "POST" && url.pathname.endsWith("/audio/transcriptions")) {
    transcripciones++;
    const cuerpo = (await leerBinario(req)).toString("utf8");
    const dice = cuerpo.match(/TRANSCRIPCION:([^\n]*)/)?.[1] ?? "";
    return responder(res, 200, { text: dice });
  }

  if (url.pathname === "/registro") return responder(res, 200, { enviados, plantillas, lecturas, transcripciones, peticionesClaude: peticionesClaude.length, ultimaPeticion: peticionesClaude.at(-1) ?? null });
  if (url.pathname === "/registro/vaciar") {
    enviados = [];
    plantillas = [];
    lecturas = [];
    peticionesClaude = [];
    transcripciones = 0;
    ajustesDePartida();
    cuentas.reiniciar();
    return responder(res, 200, { ok: true });
  }
  if (url.pathname === "/ajustes") {
    const p = url.searchParams;
    if ([...p.keys()].length === 0) ajustesDePartida();
    if (p.has("retrasoGraphMs")) retrasoGraphMs = Math.max(0, Number(p.get("retrasoGraphMs")) || 0);
    if (p.has("estados")) estados = p.get("estados") !== "0";
    if (p.has("fallarClaude")) fallarClaude = p.get("fallarClaude") === "1";
    if (p.has("ventanaComercial")) ventanaComercial = p.get("ventanaComercial") !== "0";
    cuentas.ajustar(p);
    return responder(res, 200, { retrasoGraphMs, estados, fallarClaude, ventanaComercial });
  }

  // Las rutas de gestión de Meta (app, token, números, suscripción, plantillas…) las atiende
  // simulador-cuentas.mjs. Si devuelve null, un GET de Graph contesta { id: "1" } (el número, por ejemplo).
  if (url.pathname.startsWith("/graph/") && !url.pathname.endsWith("/messages")) {
    const cuerpoGraph = req.method === "GET" || req.method === "HEAD" ? {} : cuerpoDeGestion((await leerBinario(req)).toString("utf8"));
    let r;
    try {
      r = await cuentas.manejar(req.method, url.pathname.slice("/graph".length), url.searchParams, cuerpoGraph);
    } catch (error) {
      return responder(res, 500, { error: { message: error instanceof Error ? error.message : String(error) } });
    }
    if (r) return responder(res, r.estado, r.cuerpo);
    if (req.method !== "GET" && req.method !== "HEAD") return responder(res, 404, { error: "ruta desconocida" });
  }

  if (req.method === "GET" && url.pathname.includes("/graph/")) return responder(res, 200, { id: "1" });
  if (req.method === "GET" && url.pathname.startsWith("/v1/models")) return responder(res, 200, { id: url.pathname.split("/").pop() });

  const cuerpo = await leerCuerpo(req);

  if (url.pathname.endsWith("/messages") && url.pathname.includes("/graph/")) {
    if (retrasoGraphMs) await esperar(retrasoGraphMs);
    if (cuerpo.status === "read") {
      lecturas.push(cuerpo);
      return responder(res, 200, { success: true });
    }
    if (cuerpo.type !== "template" && !ventanaComercial && cuerpo.to === COMERCIAL_DE_PRUEBA) {
      return responder(res, 400, {
        error: {
          message: "(#131047) Re-engagement message",
          type: "OAuthException",
          code: 131047,
          error_data: {
            messaging_product: "whatsapp",
            details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
          },
        },
      });
    }
    if (cuerpo.type === "template") plantillas.push(cuerpo);
    else enviados.push({ to: cuerpo.to, texto: cuerpo.text?.body, ts: Date.now() });
    const wamid = `wamid.sim.${++contador}`;
    avisosDeEntrega(wamid, cuerpo.to);
    return responder(res, 200, { messages: [{ id: wamid }] });
  }

  if (url.pathname.endsWith("/messages")) {
    if (fallarClaude) return responder(res, 500, { type: "error", error: { type: "api_error", message: "Fallo simulado" } });
    const estadoClave = cuentas.estadoClaude();
    if (estadoClave === "clave-mala") {
      return responder(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    }
    if (estadoClave === "sin-saldo") {
      return responder(res, 400, {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
        },
      });
    }
    peticionesClaude.push({ system: textoDeSistema(cuerpo.system), messages: cuerpo.messages, tools: (cuerpo.tools ?? []).map((t) => t.name), effort: cuerpo.output_config?.effort });
    const respuesta = await claudeSimulado(cuerpo);
    if (respuesta.fallo) return responder(res, 500, { type: "error", error: { type: "api_error", message: "Fallo simulado" } });
    return responder(res, 200, respuesta);
  }

  responder(res, 404, { error: "ruta desconocida" });
});

servidor.listen(PUERTO, "127.0.0.1", () => console.log(`Simulador de Meta y Claude en http://127.0.0.1:${PUERTO}`));
