import { guardarMutaciones, leerLead } from "@/lib/bd";
import { log } from "@/lib/log";

// Notas internas del equipo sobre un lead. El cliente y el asistente no las ven.

const LARGO_NOTA = 500;

function error(mensaje: string, status: number) {
  return Response.json({ ok: false, error: mensaje }, { status });
}

export async function POST(request: Request) {
  const cuerpo = await request.json().catch(() => null);
  const lead = await leerLead(typeof cuerpo?.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error("Ese lead ya no existe", 404);

  const texto = typeof cuerpo?.texto === "string" ? cuerpo.texto.trim() : "";
  if (!texto) return error("La nota está vacía", 400);
  if (texto.length > LARGO_NOTA) return error(`La nota no puede pasar de ${LARGO_NOTA} caracteres`, 400);

  await guardarMutaciones([{ t: "nota", leadId: lead.id, nota: { id: crypto.randomUUID(), texto, ts: Date.now() } }]);
  log(`Nota interna añadida a ${lead.nombre}`);
  return Response.json({ ok: true });
}
