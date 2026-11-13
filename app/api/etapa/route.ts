import type { ErrorApi } from "@/lib/api-tipos";
import { guardarMutaciones, leerLead } from "@/lib/bd";
import { buzon } from "@/lib/buzon";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { log } from "@/lib/log";
import { momentoDeHueco } from "@/lib/negocio";
import { procesarLote } from "@/lib/proceso";
import type { EstadoLead, Lead } from "@/lib/tipos";

// La etapa que cambia el dueño desde la pastilla de la ficha: «Lo llevo yo», «Devolver a tu
// asistente», «Es publicidad» y «No es publicidad». A un cliente de ejemplo también: no se le envía
// nada. El historial y el aviso en tiempo real los pone la mutación.

export const dynamic = "force-dynamic";

const DESTINOS = ["asistente", "persona", "spam", "no-spam"] as const;
type Destino = (typeof DESTINOS)[number];

const CON_EL_ASISTENTE: EstadoLead[] = ["nuevo", "conversacion", "visita"];

/** Desde dónde se puede ir a cada etapa. Con un cierre, solo se reabre. */
const PERMITIDO: Record<Destino, (l: Lead) => boolean> = {
  persona: (l) => CON_EL_ASISTENTE.includes(l.estado) && !l.cierre,
  asistente: (l) => l.estado === "persona" && !l.cierre,
  spam: (l) => l.estado !== "spam" && !l.cierre,
  "no-spam": (l) => l.estado === "spam",
};

const LINEA_LOG: Record<Destino, string> = {
  persona: "Lo llevas tú",
  asistente: "Devuelto a tu asistente",
  spam: "Es publicidad",
  "no-spam": "No es publicidad",
};

function error(status: number, mensaje: string): Response {
  return Response.json({ ok: false, error: mensaje } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;

  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error(404, "Ese cliente ya no existe");
  if (!DESTINOS.includes(cuerpo.a as Destino)) return error(400, "No sé a qué etapa pasarlo");
  const a = cuerpo.a as Destino;
  if (!PERMITIDO[a](lead)) return error(409, "Ese cambio no se puede hacer desde aquí");

  const ts = Date.now();
  if (a === "persona") {
    await guardarMutaciones([{ t: "etapa", leadId: lead.id, ts, a: "persona", motivo: "Lo llevas tú desde el panel" }]);
    // Después de guardar: si el asistente le estaba preparando una respuesta, se cancela antes de enviarla.
    buzon.tomarControl(lead.telefono, procesarLote);
  } else if (a === "spam") {
    const cfg = await configuracionParaPintar();
    const anularCita = !!lead.visita && momentoDeHueco(lead.visita.id, cfg.calendario.zona) > ts;
    await guardarMutaciones([{ t: "etapa", leadId: lead.id, ts, a: "spam", anularCita }]);
  } else {
    await guardarMutaciones([{ t: "etapa", leadId: lead.id, ts, a }]);
  }
  log(`${lead.nombre}: ${LINEA_LOG[a]} (desde el panel)`);
  return Response.json({ ok: true });
}
