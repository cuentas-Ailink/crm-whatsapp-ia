// El corazón del puente del modo prueba: un servidor HTTP en 127.0.0.1 que hace de «Graph» para el
// CRM (lo poco que usa lib/whatsapp.ts) y que pasa al webhook, firmado, lo que llega por WhatsApp.
// No sabe si detrás hay un WhatsApp de verdad (baileys.mjs) o el de mentira de las pruebas
// (falso.mjs): los dos tienen la misma forma.
//
// Quien no está en la lista de números permitidos no existe: ni se lee, ni se marca como leído, ni
// llega al CRM, ni se le escribe. El móvil vinculado puede ser una cuenta con otros chats.

import { createServer } from "node:http";
import {
  NO_DISPONIBLE,
  NO_PERMITIDO,
  accionDeGraph,
  autorizado,
  cuerpoWebhook,
  errorGraph,
  estaPermitido,
  firma,
  hostLocal,
  idDeWamid,
  mensajeMeta,
  wamidDe,
} from "./traducir.mjs";

const MAXIMO_CUERPO = 1_000_000;
const TIEMPO_WEBHOOK_MS = 10_000;
const REINTENTO_WEBHOOK_MS = 2_000;

/**
 * @typedef {{ fase: "conectando" | "qr" | "conectado" | "parado" | "error", qr: string | null, numero: string | null, error: string | null }} EstadoPuente
 * @typedef {{
 *   enviar(telefono: string, texto: string): Promise<string>,
 *   leer(id: string, escribiendo: boolean): Promise<void>,
 *   descargar(id: string): Promise<{ datos: Buffer, mime: string } | null>,
 *   mimeDe(id: string): string | null,
 *   cerrarSesion(): Promise<void>,
 *   parar(): Promise<void>,
 *   control?: { vincular(numero: string): void, entrante(p: { de: string, texto?: string, nombre?: string, audio?: boolean }): Promise<void>, enviados(): unknown[] },
 * }} Conexion
 * @typedef {{
 *   alCambiar(parcial: Partial<EstadoPuente>): void,
 *   alMensaje(m: any, telefono: string | null, nombre: string): Promise<boolean>,
 * }} Eventos
 */

/**
 * Arranca el puente. `leerConfig` lee cada vez el secreto y la lista de números permitidos: si el
 * CRM cambia la lista, vale para el siguiente mensaje sin reiniciar nada.
 *
 * @param {{
 *   puerto: number,
 *   urlWebhook: string,
 *   leerConfig: () => { secreto: string, permitidos: string[] } | null,
 *   crearConexion: (eventos: Eventos) => Promise<Conexion>,
 *   log: (texto: string) => void,
 *   alParar?: () => void,
 * }} o
 */
export async function arrancarNucleo(o) {
  /** @type {EstadoPuente} */
  const estado = { fase: "conectando", qr: null, numero: null, error: null };
  const secreto = () => o.leerConfig()?.secreto ?? "";
  const permitidos = () => o.leerConfig()?.permitidos ?? [];

  async function pasarAlWebhook(telefono, nombre, mensaje) {
    const cuerpo = JSON.stringify(cuerpoWebhook(telefono, nombre, mensaje));
    const enviar = () =>
      fetch(o.urlWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": firma(cuerpo, secreto()) },
        body: cuerpo,
        signal: AbortSignal.timeout(TIEMPO_WEBHOOK_MS),
      });
    try {
      const r = await enviar().catch(async () => {
        // El CRM puede estar arrancando: un segundo intento antes de darlo por perdido.
        await new Promise((resolver) => setTimeout(resolver, REINTENTO_WEBHOOK_MS));
        return enviar();
      });
      if (!r.ok) o.log(`El CRM ha respondido ${r.status} a un mensaje del modo prueba`);
    } catch {
      o.log("El CRM no contesta: se ha perdido un mensaje del modo prueba. Escríbelo otra vez en un momento.");
    }
  }

  /** @type {Eventos} */
  const eventos = {
    alCambiar(parcial) {
      Object.assign(estado, parcial);
    },
    async alMensaje(m, telefono, nombre) {
      if (!telefono || !estaPermitido(telefono, permitidos())) return false;
      const mensaje = mensajeMeta(m, telefono);
      if (!mensaje) return false;
      await pasarAlWebhook(telefono, nombre, mensaje);
      return true;
    },
  };

  const conexion = await o.crearConexion(eventos);

  /** @returns {Promise<[number, unknown]>} */
  async function atenderGraph(cuerpo) {
    const accion = accionDeGraph(cuerpo);
    if (accion.tipo === "plantilla") return [400, errorGraph(NO_DISPONIBLE)];
    if (accion.tipo === "no-valida") return [400, errorGraph("El modo prueba no sabe enviar ese mensaje")];
    if (estado.fase !== "conectado") return [503, errorGraph("WhatsApp no está vinculado: escanea el QR del modo prueba")];
    if (accion.tipo === "leido") {
      const id = idDeWamid(accion.wamid);
      if (id) await conexion.leer(id, accion.escribiendo).catch(() => undefined);
      return [200, { success: true }];
    }
    if (!estaPermitido(accion.to, permitidos())) {
      o.log("Bloqueado un envío a un número que no está en la lista del modo prueba");
      return [403, errorGraph(NO_PERMITIDO)];
    }
    const id = await conexion.enviar(accion.to, accion.texto);
    return [200, { messaging_product: "whatsapp", contacts: [{ input: accion.to, wa_id: accion.to }], messages: [{ id: wamidDe(id) }] }];
  }

  const servidor = createServer(async (req, res) => {
    const json = (status, cuerpo) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(cuerpo));
    };
    const leerCuerpo = async () => {
      let texto = "";
      for await (const trozo of req) {
        texto += trozo;
        if (texto.length > MAXIMO_CUERPO) throw new Error("demasiado grande");
      }
      try {
        return texto ? JSON.parse(texto) : {};
      } catch {
        return null;
      }
    };

    try {
      if (!hostLocal(req.headers.host)) return json(404, errorGraph("No encontrado"));
      if (!autorizado(req.headers.authorization, secreto())) return json(401, errorGraph("Sin permiso"));
      const ruta = (req.url ?? "/").split("?")[0];

      if (req.method === "GET" && ruta === "/estado") return json(200, estado);

      if (req.method === "POST" && /^\/graph\/[^/]+\/messages$/.test(ruta)) {
        const cuerpo = await leerCuerpo();
        const [status, respuesta] = await atenderGraph(cuerpo).catch((error) => [500, errorGraph(`No se ha podido enviar: ${error?.message ?? error}`)]);
        return json(status, respuesta);
      }

      // Notas de voz, en los dos pasos de Meta: primero la URL del archivo y luego el archivo.
      const media = req.method === "GET" && ruta.match(/^\/graph\/([^/]+)$/);
      if (media) {
        const mime = conexion.mimeDe(media[1]);
        if (!mime) return json(404, errorGraph("Ese audio no ha pasado por el modo prueba"));
        const host = req.headers.host;
        return json(200, { url: `http://${host}/archivo/${encodeURIComponent(media[1])}`, mime_type: mime });
      }
      const archivo = req.method === "GET" && ruta.match(/^\/archivo\/([^/]+)$/);
      if (archivo) {
        const descargado = await conexion.descargar(decodeURIComponent(archivo[1])).catch(() => null);
        if (!descargado) return json(502, errorGraph("No se ha podido descargar la nota de voz"));
        res.writeHead(200, { "Content-Type": descargado.mime, "Cache-Control": "no-store" });
        return res.end(descargado.datos);
      }

      if (req.method === "POST" && ruta === "/desvincular") {
        await conexion.cerrarSesion().catch((error) => o.log(`No se ha podido cerrar la sesión en el móvil: ${error?.message ?? error}`));
        Object.assign(estado, { fase: "parado", qr: null, numero: null, error: null });
        return json(200, { ok: true });
      }

      if (req.method === "POST" && ruta === "/parar") {
        json(200, { ok: true });
        o.alParar?.();
        return;
      }

      // Solo con el WhatsApp de mentira de las pruebas (falso.mjs): nunca existe con Baileys.
      if (conexion.control) {
        if (req.method === "POST" && ruta === "/falso/vincular") {
          const cuerpo = await leerCuerpo();
          conexion.control.vincular(String(cuerpo?.numero ?? ""));
          return json(200, { ok: true });
        }
        if (req.method === "POST" && ruta === "/falso/entrante") {
          const cuerpo = await leerCuerpo();
          await conexion.control.entrante({ de: String(cuerpo?.de ?? ""), texto: cuerpo?.texto, nombre: cuerpo?.nombre, audio: cuerpo?.audio === true });
          return json(200, { ok: true });
        }
        if (req.method === "GET" && ruta === "/falso/enviados") return json(200, { enviados: conexion.control.enviados() });
      }

      return json(404, errorGraph("No encontrado"));
    } catch (error) {
      return json(500, errorGraph(`Error del modo prueba: ${error?.message ?? error}`));
    }
  });

  await new Promise((resolver, rechazar) => {
    servidor.once("error", rechazar);
    servidor.listen(o.puerto, "127.0.0.1", () => {
      servidor.off("error", rechazar);
      resolver(undefined);
    });
  });

  const direccion = servidor.address();
  return {
    puerto: typeof direccion === "object" && direccion ? direccion.port : o.puerto,
    estado: () => ({ ...estado }),
    async cerrar() {
      await conexion.parar().catch(() => undefined);
      await new Promise((resolver) => servidor.close(() => resolver(undefined)));
    },
  };
}
