// El WhatsApp de verdad del modo prueba: un dispositivo vinculado con un QR, como WhatsApp Web, con
// Baileys. Baileys no está en las dependencias del CRM: el CRM lo instala aparte, la primera vez que
// se elige el modo prueba, en su propia carpeta (DIR_HERRAMIENTA_MODO_PRUEBA), y se carga de ahí.
//
// Solo pasa al CRM lo que escriben otros a este móvil desde un número de la lista (lo decide
// nucleo.mjs). Lo que escribes tú desde el móvil vinculado solo cuenta en tu chat contigo mismo.

import { rmSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { jidDe, jidIgnorado, telefonoDeJid } from "./traducir.mjs";

const REINTENTO_MS = 1_500;
const DURACION_QR_MS = 60_000;

/** La entrada ESM de un paquete instalado en la carpeta de la herramienta. */
function entradaDe(raiz) {
  const paquete = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8"));
  const elegir = (e) => (typeof e === "string" ? e : e && typeof e === "object" ? elegir(e.import ?? e.default ?? e["."]) : null);
  return path.join(raiz, elegir(paquete.exports) ?? paquete.main ?? "lib/index.js");
}

/** Baileys y su registro (pino), de la carpeta donde los instaló el CRM. */
async function cargar(carpeta) {
  const baileys = await import(pathToFileURL(entradaDe(path.join(carpeta, "node_modules", "baileys"))).href);
  let registro;
  try {
    registro = createRequire(path.join(carpeta, "package.json"))("pino")({ level: "silent" });
  } catch {
    registro = undefined;
  }
  return { baileys, registro };
}

/**
 * @param {import("./nucleo.mjs").Eventos} eventos
 * @param {{ carpeta: string, sesion: string, log: (texto: string) => void }} o
 */
export async function crearConexionBaileys(eventos, o) {
  const { baileys, registro } = await cargar(o.carpeta);
  const makeWASocket = baileys.default?.default ?? baileys.default ?? baileys.makeWASocket;
  const { Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, isLidUser, jidNormalizedUser, useMultiFileAuthState } = baileys;

  const inicio = Math.floor(Date.now() / 1000) - 5;
  const enviadosPorMi = new Set();
  /** Solo los mensajes que han pasado al CRM: para el «leído», el «escribiendo…» y las notas de voz. */
  const pasados = new Map();
  let sock = null;
  let parando = false;

  const miNumero = () => (sock?.user?.id ? telefonoDeJid(jidNormalizedUser(sock.user.id)) : null);
  const esMiChat = (jid) => {
    if (!sock?.user || !jid) return false;
    const yo = [jidNormalizedUser(sock.user.id), sock.user.lid && jidNormalizedUser(sock.user.lid)].filter(Boolean);
    return yo.includes(jidNormalizedUser(jid));
  };

  async function telefonoDe(clave) {
    const jid = clave.remoteJid;
    if (esMiChat(jid)) return miNumero();
    if (!isLidUser(jid)) return telefonoDeJid(jidNormalizedUser(jid));
    const alternativo = clave.remoteJidAlt || clave.senderPn;
    if (alternativo) return telefonoDeJid(jidNormalizedUser(alternativo));
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid).catch(() => null);
    return pn ? telefonoDeJid(jidNormalizedUser(pn)) : null;
  }

  async function conectar() {
    if (parando) return;
    const { state, saveCreds } = await useMultiFileAuthState(o.sesion);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      ...(registro ? { logger: registro } : {}),
      browser: Browsers.macOS("CRM modo prueba"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      qrTimeout: DURACION_QR_MS,
    });
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) eventos.alCambiar({ fase: "qr", qr, numero: null, error: null });
      if (connection === "open") {
        eventos.alCambiar({ fase: "conectado", qr: null, numero: miNumero(), error: null });
        o.log("WhatsApp vinculado en modo prueba");
      }
      if (connection === "close") {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        if (parando) return;
        if (codigo === DisconnectReason.loggedOut) {
          // Desvinculado desde el móvil: la sesión ya no vale. Se borra y sale un QR nuevo.
          o.log("El móvil ha desvinculado el modo prueba: hace falta escanear otra vez el QR");
          rmSync(o.sesion, { recursive: true, force: true });
        }
        eventos.alCambiar({ fase: "conectando", qr: null, numero: null, error: null });
        setTimeout(() => void conectar().catch((error) => eventos.alCambiar({ fase: "error", error: String(error?.message ?? error) })), REINTENTO_MS);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const m of messages ?? []) {
        try {
          const jid = m.key?.remoteJid;
          if (!m.message || jidIgnorado(jid)) continue;
          if (Number(m.messageTimestamp) < inicio) continue;
          if (enviadosPorMi.has(m.key.id)) continue;
          // Lo que escribes tú solo cuenta en tu chat contigo mismo: el resto son tus chats normales.
          if (m.key.fromMe && !esMiChat(jid)) continue;
          const telefono = await telefonoDe(m.key);
          if (m.message.audioMessage) pasados.set(m.key.id, m);
          const pasa = await eventos.alMensaje(m, telefono, m.pushName || "Cliente");
          if (pasa) pasados.set(m.key.id, m);
          else pasados.delete(m.key.id);
        } catch (error) {
          o.log(`No se ha podido leer un mensaje del modo prueba: ${error?.message ?? error}`);
        }
      }
    });
  }

  await conectar();

  const destinoDe = (telefono) => (telefono === miNumero() && sock?.user ? jidNormalizedUser(sock.user.id) : jidDe(telefono));

  return {
    async enviar(telefono, texto) {
      const destino = destinoDe(telefono);
      const enviado = await sock.sendMessage(destino, { text: texto });
      if (enviado?.key?.id) enviadosPorMi.add(enviado.key.id);
      await sock.sendPresenceUpdate("paused", destino).catch(() => undefined);
      return enviado?.key?.id ?? `${Date.now()}`;
    },
    async leer(id, escribiendo) {
      const m = pasados.get(id);
      if (!m) return;
      await sock.readMessages([m.key]).catch(() => undefined);
      if (escribiendo) await sock.sendPresenceUpdate("composing", m.key.remoteJid).catch(() => undefined);
    },
    mimeDe(id) {
      const audio = pasados.get(id)?.message?.audioMessage;
      return audio ? (audio.mimetype ?? "audio/ogg") : null;
    },
    async descargar(id) {
      const m = pasados.get(id);
      if (!m?.message?.audioMessage) return null;
      const datos = await downloadMediaMessage(m, "buffer", {}, { ...(registro ? { logger: registro } : {}), reuploadRequest: sock.updateMediaMessage });
      return { datos, mime: m.message.audioMessage.mimetype ?? "audio/ogg" };
    },
    async cerrarSesion() {
      parando = true;
      // Cierra la sesión de verdad: WhatsApp quita también el dispositivo de la lista del móvil.
      await sock?.logout().catch(() => undefined);
      rmSync(o.sesion, { recursive: true, force: true });
      eventos.alCambiar({ fase: "parado", qr: null, numero: null, error: null });
    },
    async parar() {
      parando = true;
      try {
        sock?.end(undefined);
      } catch {
        // Ya estaba cerrado.
      }
    },
  };
}
