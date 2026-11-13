import { randomUUID } from "node:crypto";
import type { ErrorApi } from "@/lib/api-tipos";
import { guardarMutaciones, leerLead } from "@/lib/bd";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { explicar, type ErrorExplicado } from "@/lib/errores";
import { ventana24h } from "@/lib/hilo";
import { log, logError, recortar } from "@/lib/log";
import { esEjemplo } from "@/lib/negocio";
import { ErrorWhatsApp, enviarTexto } from "@/lib/whatsapp";

// Lo que escribe el dueño desde la ficha. Sale por WhatsApp desde el número del negocio y queda en
// la conversación como «Tú». Solo cuando no le contesta el asistente: porque lo lleva él («Te toca»)
// o porque el asistente está apagado. Y solo dentro de las 24 h desde el último mensaje del cliente,
// que es lo que deja WhatsApp sin un mensaje aprobado.

export const dynamic = "force-dynamic";

const LARGO_MAXIMO = 4_096;

function error(status: number, mensaje: string, codigo?: ErrorExplicado["codigo"]): Response {
  return Response.json({ ok: false, error: mensaje, ...(codigo ? { codigo } : {}) } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;
  const texto = typeof cuerpo.texto === "string" ? cuerpo.texto.trim() : "";
  if (!texto) return error(400, "Escribe el mensaje");
  if (texto.length > LARGO_MAXIMO) return error(400, `WhatsApp no deja enviar más de ${LARGO_MAXIMO} caracteres`);

  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error(404, "Ese cliente ya no existe");
  if (lead.estado === "spam") return error(409, "Es publicidad: no se le contesta");
  if (esEjemplo(lead)) return error(409, "Es un contacto de ejemplo: no tiene WhatsApp");
  if (lead.silenciadoEn) return error(409, "Ha pedido que no le escribamos por WhatsApp");

  const cfg = await configuracionParaPintar();
  // Mientras le contesta el asistente, escribir a mano lo pisaría.
  if (cfg.sistema.asistente.activo && lead.estado !== "persona") {
    return error(409, "Mientras le contesta tu asistente, no le escribas a mano: pulsa «Lo llevo yo»");
  }
  if (!ventana24h(lead, Date.now()).abierta) {
    return error(409, "Han pasado 24 h desde su último mensaje: WhatsApp solo deja escribirle con un mensaje aprobado.");
  }

  try {
    const wamid = await enviarTexto(lead.telefono, texto);
    const ts = Date.now();
    await guardarMutaciones([
      {
        t: "mensaje",
        leadId: lead.id,
        mensaje: { id: wamid || `manual-${randomUUID()}`, de: "agente", texto, ts, manual: true, entrega: wamid ? "enviado" : undefined },
      },
    ]);
    log(`Respuesta a mano a ${lead.nombre}: ${recortar(texto)}`);
    return Response.json({ ok: true });
  } catch (e) {
    logError(`al contestar a mano a ${lead.nombre}`, e);
    const explicado = e instanceof ErrorWhatsApp ? e.explicado : explicar("desconocido");
    return error(502, `No se ha enviado: ${explicado.titulo}`, explicado.codigo);
  }
}
