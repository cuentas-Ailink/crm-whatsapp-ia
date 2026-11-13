import type { ErrorApi } from "@/lib/api-tipos";
import { guardarMutaciones, leerLead } from "@/lib/bd";
import { log } from "@/lib/log";
import { esEjemplo } from "@/lib/negocio";

// «Volver a permitir mensajes»: el cliente pidió que no le escribieran y luego, por teléfono o en
// persona, ha dicho que sí. Lo decide el equipo; la mutación escribe «Se le puede volver a escribir:
// lo has decidido tú» en el historial.

export const dynamic = "force-dynamic";

function error(status: number, mensaje: string): Response {
  return Response.json({ ok: false, error: mensaje } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;

  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error(404, "Ese cliente ya no existe");
  if (esEjemplo(lead)) return error(409, "Es un contacto de ejemplo: no tiene WhatsApp");
  if (!lead.silenciadoEn) return error(409, "No había pedido que no le escribamos");

  await guardarMutaciones([{ t: "permitir", leadId: lead.id, ts: Date.now(), por: "equipo" }]);
  log(`Se le puede volver a escribir: ${lead.nombre} (desde el panel)`);
  return Response.json({ ok: true });
}
