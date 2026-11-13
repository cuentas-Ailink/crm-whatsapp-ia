// WhatsApp Cloud API directa de Meta (Graph API), sin intermediarios.

import { parametroSeguro } from "./configuracion";
import { explicarMeta, type ErrorExplicado } from "./errores";
import { destinoModoPrueba } from "./modo-prueba";
import { NO_DISPONIBLE_EN_PRUEBA } from "./modo-prueba-reglas";

export { textoPlantilla } from "./configuracion";

const TIEMPO_MAXIMO_MS = 10_000;
const NO_ESTA_EN_LA_LISTA = 131030;

/** Un error de Meta con su código y la explicación en español (título, solución y paso). */
export class ErrorWhatsApp extends Error {
  readonly explicado: ErrorExplicado;
  constructor(
    mensaje: string,
    readonly codigo?: number,
    tituloMeta?: string,
  ) {
    super(mensaje);
    this.explicado = explicarMeta(codigo, tituloMeta);
  }
}

/**
 * Adónde va cada llamada. En la vía oficial, Meta con las claves de .env, como siempre; en el modo
 * prueba (lib/modo-prueba.ts), el puente local del QR, que entiende lo mismo.
 */
function destino(): { base: string; numero: string | undefined; token: string | undefined } {
  return (
    destinoModoPrueba() ?? {
      base: process.env.GRAPH_BASE_URL || "https://graph.facebook.com/v26.0",
      numero: process.env.WHATSAPP_PHONE_NUMBER_ID,
      token: process.env.WHATSAPP_TOKEN,
    }
  );
}

async function llamarMensajes(cuerpo: object): Promise<{ messages?: { id: string }[] }> {
  const { base, numero, token } = destino();
  const respuesta = await fetch(`${base}/${numero}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...cuerpo }),
    signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const codigo = typeof datos?.error?.code === "number" ? (datos.error.code as number) : undefined;
    const tituloMeta: string = datos?.error?.message ?? `Meta respondió ${respuesta.status}`;
    const e = explicarMeta(codigo, tituloMeta);
    throw new ErrorWhatsApp(`${e.titulo}. ${e.solucion}`, codigo, tituloMeta);
  }
  return datos;
}

/** La lista de destinatarios puede guardar un móvil de México con el 1 o sin él: se prueban los dos. */
async function enviarA(telefono: string, cuerpo: object): Promise<string> {
  try {
    const datos = await llamarMensajes({ to: telefono, ...cuerpo });
    return datos.messages?.[0]?.id ?? "";
  } catch (error) {
    const esMexico = /^52\d{10}$/.test(telefono);
    if (!(error instanceof ErrorWhatsApp) || error.codigo !== NO_ESTA_EN_LA_LISTA || !esMexico) throw error;
    const datos = await llamarMensajes({ to: `521${telefono.slice(2)}`, ...cuerpo });
    return datos.messages?.[0]?.id ?? "";
  }
}

/** Una plantilla aprobada con sus variables, en orden: {{1}}, {{2}}… Devuelve el id del mensaje (wamid). */
export function enviarPlantillaConVariables(telefono: string, p: { nombre: string; idioma: string; variables: string[] }): Promise<string> {
  // Los mensajes aprobados son de Meta: en el modo prueba no existen.
  if (destinoModoPrueba()) return Promise.reject(new ErrorWhatsApp(NO_DISPONIBLE_EN_PRUEBA, undefined, NO_DISPONIBLE_EN_PRUEBA));
  return enviarA(telefono, {
    type: "template",
    template: {
      name: p.nombre,
      language: { code: p.idioma },
      // Sin variables (hello_world) no va la lista: Meta la rechaza vacía.
      ...(p.variables.length
        ? { components: [{ type: "body", parameters: p.variables.map((v) => ({ type: "text", text: parametroSeguro(v) })) }] }
        : {}),
    },
  });
}

/** La plantilla de bienvenida con el nombre y el negocio. Sin `plantilla`, la de .env o solicitud_recibida. */
export function enviarPlantilla(telefono: string, nombre: string, negocio: string, plantilla?: { nombre: string; idioma: string }): Promise<string> {
  return enviarPlantillaConVariables(telefono, {
    nombre: plantilla?.nombre ?? (process.env.PLANTILLA || "solicitud_recibida"),
    idioma: plantilla?.idioma ?? (process.env.PLANTILLA_IDIOMA || "es_ES"),
    variables: [nombre, negocio],
  });
}

export function enviarTexto(telefono: string, texto: string): Promise<string> {
  return enviarA(telefono, { type: "text", text: { preview_url: false, body: texto } });
}

/**
 * Descarga un archivo que ha mandado el cliente, como una nota de voz. Son dos pasos: Meta da
 * una URL temporal para el id y esa URL también pide el token.
 */
export async function descargarMedia(mediaId: string): Promise<{ datos: ArrayBuffer; mime: string }> {
  const { base, token } = destino();
  const autorizacion = { Authorization: `Bearer ${token}` };
  const respuesta = await fetch(`${base}/${mediaId}`, { headers: autorizacion, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
  const info = (await respuesta.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: { message?: string } };
  if (!respuesta.ok || !info.url) throw new ErrorWhatsApp(`Meta no da el audio (${respuesta.status}): ${info.error?.message ?? "sin URL"}`);
  const archivo = await fetch(info.url, { headers: autorizacion, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
  if (!archivo.ok) throw new ErrorWhatsApp(`no se ha podido descargar el audio (${archivo.status})`);
  return { datos: await archivo.arrayBuffer(), mime: info.mime_type ?? archivo.headers.get("content-type") ?? "audio/ogg" };
}

/** Marca como leído y, si se puede, enseña «escribiendo…». No debe romper la conversación si falla. */
export async function marcarLeido(wamid: string, escribiendo: boolean): Promise<void> {
  const leido = { status: "read", message_id: wamid };
  if (escribiendo) {
    try {
      await llamarMensajes({ ...leido, typing_indicator: { type: "text" } });
      return;
    } catch {
      // Si el indicador no funciona, basta con marcarlo como leído.
    }
  }
  await llamarMensajes(leido).catch(() => undefined);
}
