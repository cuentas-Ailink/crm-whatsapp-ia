// El WhatsApp de mentira de las pruebas: nunca habla con WhatsApp. Saca un QR inventado que cambia
// cada pocos segundos, «se vincula» cuando las pruebas lo piden y deja escribir mensajes como si
// llegaran de un móvil, con la misma forma que los de Baileys. Solo lo arranca el servidor de
// pruebas (BD_LOCAL y MODO_PRUEBA_FALSO=1): el CRM de verdad nunca.

import { telefonoDeJid } from "./traducir.mjs";

const CAMBIO_QR_MS = 20_000;
const MIME_AUDIO = "audio/ogg; codecs=opus";

/** @param {import("./nucleo.mjs").Eventos} eventos */
export async function crearConexionFalsa(eventos) {
  let numero = null;
  let vuelta = 0;
  let contador = 0;
  const enviados = [];
  const audios = new Map();

  const nuevoQr = () => {
    vuelta++;
    eventos.alCambiar({ fase: "qr", qr: `modo-prueba-falso,${vuelta},${Date.now().toString(36)}`, numero: null, error: null });
  };
  nuevoQr();
  const reloj = setInterval(() => {
    if (!numero) nuevoQr();
  }, CAMBIO_QR_MS);
  reloj.unref?.();

  return {
    async enviar(telefono, texto) {
      const id = `FALSO${++contador}`;
      enviados.push({ tipo: "texto", id, a: telefono, texto, en: Date.now() });
      return id;
    },
    async leer(id, escribiendo) {
      enviados.push({ tipo: "leido", id, escribiendo, en: Date.now() });
    },
    mimeDe(id) {
      return audios.has(id) ? MIME_AUDIO : null;
    },
    async descargar(id) {
      return audios.has(id) ? { datos: audios.get(id), mime: MIME_AUDIO } : null;
    },
    async cerrarSesion() {
      numero = null;
      eventos.alCambiar({ fase: "parado", qr: null, numero: null, error: null });
    },
    async parar() {
      clearInterval(reloj);
    },
    control: {
      vincular(otro) {
        numero = String(otro).replace(/\D/g, "") || "34600000001";
        eventos.alCambiar({ fase: "conectado", qr: null, numero, error: null });
      },
      async entrante({ de, texto, nombre, audio }) {
        const id = `ENTRA${++contador}`;
        const m = {
          key: { remoteJid: `${String(de).replace(/\D/g, "")}@s.whatsapp.net`, fromMe: false, id },
          messageTimestamp: Math.floor(Date.now() / 1000),
          pushName: nombre ?? "Cliente",
          message: audio ? { audioMessage: { mimetype: MIME_AUDIO, ptt: true } } : { conversation: String(texto ?? "") },
        };
        // El audio tiene que estar antes de avisar al CRM: empieza a descargarlo al momento.
        if (audio) audios.set(id, Buffer.from(String(texto ?? "audio de prueba")));
        const pasa = await eventos.alMensaje(m, telefonoDeJid(m.key.remoteJid), m.pushName);
        if (!pasa) audios.delete(id);
        enviados.push({ tipo: "entrante", id, de: String(de), pasa, en: Date.now() });
      },
      enviados() {
        return [...enviados];
      },
    },
  };
}
