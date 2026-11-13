import type { ErrorApi } from "@/lib/api-tipos";
import { guardarMutaciones, leerLead } from "@/lib/bd";
import { buzon } from "@/lib/buzon";

// «Borrar sus datos» (RGPD): el cliente, su teléfono, la conversación, las notas, el historial y
// su cita, en una sola transacción. No se puede deshacer. La línea del registro («Cliente borrado
// a petición», sin nombre ni teléfono) la escribe la mutación.

export const dynamic = "force-dynamic";

function error(status: number, mensaje: string): Response {
  return Response.json({ ok: false, error: mensaje } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;

  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error(404, "Ese cliente ya no existe");

  // Primero lo pendiente en memoria: si se procesara después, volvería a crear el lead.
  buzon.olvidar(lead.telefono);
  await guardarMutaciones([{ t: "borrar", leadId: lead.id, ts: Date.now() }]);
  return Response.json({ ok: true });
}
