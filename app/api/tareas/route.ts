import { guardarMutaciones, leerLead } from "@/lib/bd";
import { log } from "@/lib/log";

// Tareas del equipo sobre un lead: «llamar el jueves», «pedir planos». Se crean, se marcan y se borran.

const LARGO_TAREA = 200;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function error(mensaje: string, status: number) {
  return Response.json({ ok: false, error: mensaje }, { status });
}

export async function POST(request: Request) {
  const cuerpo = await request.json().catch(() => null);
  const lead = await leerLead(typeof cuerpo?.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error("Ese lead ya no existe", 404);

  if (cuerpo?.accion === "crear") {
    const texto = typeof cuerpo.texto === "string" ? cuerpo.texto.trim() : "";
    if (!texto) return error("La tarea está vacía", 400);
    if (texto.length > LARGO_TAREA) return error(`La tarea no puede pasar de ${LARGO_TAREA} caracteres`, 400);
    const vence = typeof cuerpo.vence === "string" && cuerpo.vence ? cuerpo.vence : undefined;
    if (vence && (!FECHA.test(vence) || Number.isNaN(Date.parse(`${vence}T12:00:00Z`)))) return error("La fecha no es válida", 400);
    const tarea = { id: crypto.randomUUID(), texto, ...(vence ? { vence } : {}), hecha: false, ts: Date.now() };
    await guardarMutaciones([{ t: "tarea", leadId: lead.id, tarea }]);
    log(`Tarea añadida a ${lead.nombre}`);
    return Response.json({ ok: true });
  }

  const tareaId = typeof cuerpo?.tareaId === "string" ? cuerpo.tareaId : "";
  if (!lead.tareas?.some((t) => t.id === tareaId)) return error("Esa tarea ya no existe", 404);

  if (cuerpo?.accion === "cambiar" && typeof cuerpo.hecha === "boolean") {
    await guardarMutaciones([{ t: "tareaCambio", leadId: lead.id, tareaId, hecha: cuerpo.hecha }]);
    return Response.json({ ok: true });
  }
  if (cuerpo?.accion === "borrar") {
    await guardarMutaciones([{ t: "tareaCambio", leadId: lead.id, tareaId, borrar: true }]);
    log(`Tarea borrada de ${lead.nombre}`);
    return Response.json({ ok: true });
  }
  return error("No sé qué hacer con esa tarea", 400);
}
