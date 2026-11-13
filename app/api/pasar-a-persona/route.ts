import type { ErrorApi } from "@/lib/api-tipos";
import { guardarMutaciones, leerLead } from "@/lib/bd";
import { buzon } from "@/lib/buzon";
import { log } from "@/lib/log";
import { procesarLote } from "@/lib/proceso";

// El dueño coge la conversación desde el panel («Lo llevo yo»). Queda igual que cuando el pase lo
// hace el asistente: deja de contestarle y se le escribe a mano. No se le avisa por WhatsApp, porque
// lo ha hecho él. La pastilla de la ficha usa /api/etapa; esta ruta se queda por compatibilidad.

export const dynamic = "force-dynamic";

const MOTIVO = "Lo llevas tú desde el panel";

function error(status: number, mensaje: string): Response {
  return Response.json({ ok: false, error: mensaje } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;
  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error(404, "Ese cliente ya no existe");
  if (lead.estado === "spam") return error(409, "Es publicidad: no se pasa a una persona");

  if (lead.estado !== "persona") {
    await guardarMutaciones([{ t: "estado", leadId: lead.id, estado: "persona", ts: Date.now(), motivo: MOTIVO }]);
    // Después de guardar el estado: si el asistente le estaba contestando, no llega a enviar nada.
    buzon.tomarControl(lead.telefono, procesarLote);
    log(`Lo llevas tú desde el panel: ${lead.nombre}`);
  }
  return Response.json({ ok: true });
}
