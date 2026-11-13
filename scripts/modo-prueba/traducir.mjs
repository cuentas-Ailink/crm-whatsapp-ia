// El modo prueba traduce entre un WhatsApp vinculado con un QR (Baileys) y la forma de la API de
// Meta que ya entiende el CRM. Todo lo de aquí es puro: sin red, sin disco y sin Baileys, para que
// las pruebas lo cubran entero (lib/modo-prueba.test.ts).

import { createHmac, timingSafeEqual } from "node:crypto";

/** Lo que dice el puente cuando el CRM pide algo que necesita los mensajes aprobados de Meta. */
export const NO_DISPONIBLE = "No disponible en modo prueba";
export const NO_PERMITIDO = "Ese número no está en la lista de números permitidos del modo prueba";

/** Igual que unificarTelefono (lib/regional.ts): los móviles de México llegan como 521… y se guardan sin el 1. */
export function unificar(telefono) {
  const digitos = String(telefono ?? "").replace(/\D/g, "");
  return /^521\d{10}$/.test(digitos) ? `52${digitos.slice(3)}` : digitos;
}

/** Si un teléfono está en la lista de números permitidos. Una lista vacía no deja pasar a nadie. */
export function estaPermitido(telefono, permitidos) {
  const t = unificar(telefono);
  if (!t || !Array.isArray(permitidos)) return false;
  return permitidos.some((p) => unificar(p) === t);
}

/** Chats que nunca se miran: grupos, difusiones, estados y canales. */
export function jidIgnorado(jid) {
  return typeof jid !== "string" || !jid || /@(g\.us|broadcast|newsletter)$/.test(jid);
}

/** El teléfono de un jid: «34600111222:5@s.whatsapp.net» → «34600111222». Un @lid no es un teléfono: null. */
export function telefonoDeJid(jid) {
  if (typeof jid !== "string") return null;
  const m = jid.match(/^(\d{6,15})(?::\d+)?@(s\.whatsapp\.net|c\.us)$/);
  return m ? m[1] : null;
}

/** El jid al que se escribe un teléfono. */
export function jidDe(telefono) {
  return `${unificar(telefono)}@s.whatsapp.net`;
}

const PREFIJO_WAMID = "wamid.prueba.";

/** El id de Meta («wamid…») de un mensaje de WhatsApp Web, y al revés. */
export function wamidDe(id) {
  return `${PREFIJO_WAMID}${id}`;
}
export function idDeWamid(wamid) {
  return typeof wamid === "string" && wamid.startsWith(PREFIJO_WAMID) ? wamid.slice(PREFIJO_WAMID.length) : null;
}

/** Los envoltorios que WhatsApp pone a algunos mensajes (temporales, de una sola vez, documentos con texto). */
const ENVOLTORIOS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"];

/** El contenido de verdad de un mensaje, sin envoltorios. */
export function contenidoDe(mensaje) {
  let m = mensaje && typeof mensaje === "object" ? mensaje : null;
  for (let vuelta = 0; vuelta < 5 && m; vuelta++) {
    const envoltorio = ENVOLTORIOS.find((clave) => m[clave]?.message);
    if (!envoltorio) break;
    m = m[envoltorio].message;
  }
  return m;
}

/** Cada tipo de WhatsApp Web con su tipo de Meta; null = no es un mensaje del cliente (se ignora). */
const TIPOS = {
  conversation: "text",
  extendedTextMessage: "text",
  audioMessage: "audio",
  imageMessage: "image",
  videoMessage: "video",
  documentMessage: "document",
  stickerMessage: "sticker",
  locationMessage: "location",
  liveLocationMessage: "location",
  contactMessage: "contacts",
  contactsArrayMessage: "contacts",
  reactionMessage: null,
  protocolMessage: null,
  pollUpdateMessage: null,
  editedMessage: null,
};

/** Los segundos de un mensaje: Baileys a veces los da como número y a veces como un Long de protobuf. */
function segundosDe(ts) {
  if (ts && typeof ts === "object" && typeof ts.toNumber === "function") return ts.toNumber();
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Math.floor(Date.now() / 1000);
}

/**
 * Un mensaje de WhatsApp Web (Baileys) con la forma de un mensaje de Meta (value.messages[]).
 * `telefono` ya viene resuelto: los @lid los resuelve el puente con la sesión. null = no se pasa.
 */
export function mensajeMeta(m, telefono) {
  const contenido = contenidoDe(m?.message);
  const id = m?.key?.id;
  if (!contenido || typeof id !== "string" || !id || !telefono) return null;
  const clave = Object.keys(contenido).find((k) => k in TIPOS);
  const tipo = clave ? TIPOS[clave] : "unsupported";
  if (tipo === null) return null;
  const base = { from: unificar(telefono), id: wamidDe(id), timestamp: String(segundosDe(m.messageTimestamp)) };
  if (tipo === "text") {
    const texto = contenido.conversation ?? contenido.extendedTextMessage?.text ?? "";
    if (typeof texto !== "string" || !texto.trim()) return null;
    return { ...base, type: "text", text: { body: texto } };
  }
  if (tipo === "audio") {
    const audio = contenido.audioMessage ?? {};
    return { ...base, type: "audio", audio: { id, mime_type: typeof audio.mimetype === "string" ? audio.mimetype : "audio/ogg", voice: !!audio.ptt } };
  }
  if (tipo === "location") return { ...base, type: "location", location: {} };
  if (tipo === "unsupported") return { ...base, type: "unsupported" };
  return { ...base, type: tipo, [tipo]: { id } };
}

/** El aviso que manda Meta al webhook por cada mensaje, con un solo mensaje dentro. */
export function cuerpoWebhook(telefono, nombre, mensaje) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "modo-prueba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "", phone_number_id: "modo-prueba" },
              contacts: [{ wa_id: unificar(telefono), profile: { name: typeof nombre === "string" && nombre.trim() ? nombre.trim().slice(0, 60) : "Cliente" } }],
              messages: [mensaje],
            },
          },
        ],
      },
    ],
  };
}

/** La cabecera X-Hub-Signature-256 de un cuerpo, como la calcula Meta. */
export function firma(cuerpo, secreto) {
  return `sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`;
}

/** «Bearer <secreto>» en tiempo constante. */
export function autorizado(cabecera, secreto) {
  if (typeof cabecera !== "string" || !secreto) return false;
  const esperada = Buffer.from(`Bearer ${secreto}`);
  const recibida = Buffer.from(cabecera);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/**
 * Lo que el CRM pide al «Graph» del puente (lib/whatsapp.ts): enviar un texto, marcar como leído
 * (con «escribiendo…» o sin él) o una plantilla, que en el modo prueba no existe.
 */
export function accionDeGraph(cuerpo) {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return { tipo: "no-valida" };
  if (cuerpo.status === "read") {
    if (typeof cuerpo.message_id !== "string" || !cuerpo.message_id) return { tipo: "no-valida" };
    return { tipo: "leido", wamid: cuerpo.message_id, escribiendo: !!cuerpo.typing_indicator };
  }
  if (cuerpo.type === "template") return { tipo: "plantilla" };
  if (cuerpo.type === "text") {
    const to = unificar(cuerpo.to);
    const texto = cuerpo.text?.body;
    if (!to || typeof texto !== "string" || !texto) return { tipo: "no-valida" };
    return { tipo: "texto", to, texto };
  }
  return { tipo: "no-valida" };
}

/** Un error con la forma de los de Meta, para que lib/whatsapp.ts lo cuente igual que los suyos. */
export function errorGraph(mensaje, codigo) {
  return { error: { message: mensaje, type: "ModoPrueba", ...(typeof codigo === "number" ? { code: codigo } : {}) } };
}

/** Solo se contesta a quien llama a 127.0.0.1 o localhost por su nombre: una web no puede usar el puente. */
export function hostLocal(host) {
  if (typeof host !== "string") return false;
  const nombre = host.trim().toLowerCase().replace(/:\d+$/, "");
  return nombre === "127.0.0.1" || nombre === "localhost" || nombre === "[::1]";
}
