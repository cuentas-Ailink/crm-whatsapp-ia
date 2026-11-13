import type { ErrorApi } from "@/lib/api-tipos";
import { huecosLibres } from "@/lib/agenda";
import { leerLead, leerReservas } from "@/lib/bd";
import { configuracionActiva } from "@/lib/configuracion-servidor";

// Los huecos libres para dar o cambiar una cita a mano: los mismos que puede ofrecer el asistente,
// con las reglas del horario y en todo el horizonte a la vista. La cita que ya tiene el cliente no
// sale (la ficha la enseña como «Ahora: …»). De 40 en 40: «Ver más días» pide los siguientes con
// `desde` (el id del último que ya tiene). También va el trato, para que la vista previa del WhatsApp
// sea el texto exacto que mandará la ruta.

export const dynamic = "force-dynamic";

const POR_PAGINA = 40;

export async function GET(request: Request) {
  const consulta = new URL(request.url).searchParams;
  const lead = await leerLead(consulta.get("leadId") ?? "");
  if (!lead) return Response.json({ ok: false, error: "Ese cliente ya no existe" } satisfies ErrorApi, { status: 404 });

  const { config } = await configuracionActiva();
  const reglas = config.calendario;
  const otras = (await leerReservas()).filter((r) => r.leadId !== lead.id);
  const todos = huecosLibres(otras, new Date(), reglas, reglas.diasVista * reglas.horas.length).filter((h) => h.id !== lead.visita?.id);
  const desde = consulta.get("desde");
  const lista = desde ? todos.filter((h) => h.id > desde) : todos;
  return Response.json({ huecos: lista.slice(0, POR_PAGINA), mas: lista.length > POR_PAGINA, trato: config.agente.trato });
}
