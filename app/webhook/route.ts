import { createHmac, timingSafeEqual } from "node:crypto";
import { actualizarEntregas } from "@/lib/bd";
import { buzon } from "@/lib/buzon";
import { explicarMeta } from "@/lib/errores";
import { registrarWebhook } from "@/lib/eventos";
import { log, logAviso, logError, recortar } from "@/lib/log";
import { leerModoPrueba, modoWhatsApp } from "@/lib/modo-prueba";
import { estaPermitido } from "@/lib/modo-prueba-reglas";
import { unificarTelefono } from "@/lib/negocio";
import { procesarLote } from "@/lib/proceso";
import type { CambioEntrega, Entrante, EstadoEntrega, ReferidoMeta } from "@/lib/tipos";
import { proveedorTranscripcion, transcribir } from "@/lib/transcripcion";

// La única ruta accesible desde fuera. Contesta 200 al momento y el mensaje se procesa en segundo plano.

const ETIQUETAS: Record<string, string> = {
  audio: "(audio)",
  image: "(foto)",
  video: "(vídeo)",
  document: "(documento)",
  location: "(ubicación)",
  sticker: "(sticker)",
  contacts: "(contacto)",
};

interface MensajeMeta {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string; voice?: boolean };
  /** Solo en el primer mensaje que llega desde un anuncio de clic a WhatsApp. */
  referral?: ReferidoMeta;
}

interface EstadoMeta {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp?: string;
  errors?: { code?: number; title?: string }[];
}

interface ValorMeta {
  messages?: MensajeMeta[];
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  statuses?: EstadoMeta[];
}

const ESTADOS: Record<EstadoMeta["status"], EstadoEntrega> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  failed: "fallido",
};

const texto = (v: unknown, max = 500): string | undefined => (typeof v === "string" && v ? v.slice(0, max) : undefined);

/** Solo los campos conocidos del anuncio, como texto: lo demás que mande Meta no se guarda. */
function referidoDe(r: unknown): ReferidoMeta | undefined {
  if (typeof r !== "object" || r === null) return undefined;
  const o = r as Record<string, unknown>;
  const referido: ReferidoMeta = {};
  for (const clave of ["source_type", "source_id", "source_url", "headline", "body", "ctwa_clid"] as const) {
    const valor = texto(o[clave]);
    if (valor !== undefined) referido[clave] = valor;
  }
  return Object.keys(referido).length ? referido : undefined;
}

/** Lo que Meta dice de un mensaje enviado: enviado, entregado, leído o fallido (con el motivo en español). */
function cambioDe(e: EstadoMeta): CambioEntrega | null {
  const estado = ESTADOS[e?.status];
  if (!estado || typeof e.id !== "string" || !e.id) return null;
  const cambio: CambioEntrega = { wamid: e.id, estado, ts: Number(e.timestamp) * 1000 || Date.now() };
  if (estado === "fallido") {
    const error = e.errors?.[0];
    cambio.fallo = explicarMeta(typeof error?.code === "number" ? error.code : undefined, error?.title).titulo;
  }
  return cambio;
}

/** En el modo prueba solo firma el puente local, con su propio secreto; en la vía oficial, Meta. */
function firmaValida(cuerpo: string, firma: string | null, prueba: boolean): boolean {
  const secreto = prueba ? leerModoPrueba()?.secreto : process.env.META_APP_SECRET;
  if (!secreto || !firma) return false;
  const esperada = Buffer.from(`sha256=${createHmac("sha256", secreto).update(cuerpo).digest("hex")}`);
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const correcto =
    url.searchParams.get("hub.mode") === "subscribe" &&
    !!process.env.WEBHOOK_VERIFY_TOKEN &&
    url.searchParams.get("hub.verify_token") === process.env.WEBHOOK_VERIFY_TOKEN;
  if (!correcto) return new Response("Token incorrecto", { status: 403 });
  return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
}

export async function POST(request: Request) {
  const cuerpo = await request.text();
  const prueba = modoWhatsApp() === "prueba";
  if (!firmaValida(cuerpo, request.headers.get("x-hub-signature-256"), prueba)) {
    registrarWebhook("rechazado");
    logAviso("Webhook rechazado: la firma no coincide (revisa la clave secreta de la app en Ajustes → Conexiones)");
    return new Response("Firma no válida", { status: 401 });
  }

  let datos: { entry?: { changes?: { value?: ValorMeta }[] }[] };
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    return new Response("JSON no válido", { status: 400 });
  }

  const recibidoEn = Date.now();
  const valores = (datos.entry ?? []).flatMap((entrada) => (entrada?.changes ?? []).map((cambio) => cambio?.value));
  // La prueba de la firma (Ajustes → Conexiones) manda un cuerpo vacío: contesta 200, pero no cuenta como aviso de Meta.
  if (valores.some((v) => (v?.messages?.length ?? 0) > 0 || (v?.statuses?.length ?? 0) > 0)) registrarWebhook("valido");

  // Los avisos de estado: nunca provocan una respuesta.
  const cambios = valores.flatMap((v) => v?.statuses ?? []).map(cambioDe).filter((c): c is CambioEntrega => c !== null);
  if (cambios.length) {
    try {
      await actualizarEntregas(cambios);
    } catch (error) {
      logError("al guardar el estado de los mensajes enviados", error);
    }
  }

  for (const valor of valores) {
    for (const mensaje of valor?.messages ?? []) {
      if (mensaje.type === "reaction") continue;
      // Modo prueba: quien no está en la lista de números permitidos no existe (ni se guarda ni se contesta).
      if (prueba && !estaPermitido(String(mensaje.from ?? ""), leerModoPrueba()?.permitidos ?? [])) continue;
      const contacto = valor?.contacts?.find((c) => c.wa_id === mensaje.from);
      const esAudio = mensaje.type === "audio" && !!mensaje.audio?.id;
      const referido = referidoDe(mensaje.referral);
      const entrante: Entrante = {
        wamid: mensaje.id,
        telefono: unificarTelefono(mensaje.from),
        nombrePerfil: contacto?.profile?.name ?? "",
        tipo: mensaje.type === "text" ? "texto" : esAudio ? "audio" : "otro",
        texto: mensaje.type === "text" ? (mensaje.text?.body ?? "") : (ETIQUETAS[mensaje.type] ?? "(mensaje)"),
        ts: Number(mensaje.timestamp) * 1000,
        recibidoEn,
        ...(esAudio ? { mediaId: mensaje.audio?.id } : {}),
        ...(referido ? { referido } : {}),
      };
      if (await buzon.recibir(entrante, procesarLote)) {
        log(`Mensaje de ${entrante.nombrePerfil || "cliente"}: ${recortar(entrante.texto)}`);
        // Se empieza a transcribir ya, mientras el buzón espera por si llegan más mensajes.
        if (entrante.mediaId && proveedorTranscripcion()) void transcribir(entrante.wamid, entrante.mediaId);
      }
    }
  }
  return new Response("OK", { status: 200 });
}
