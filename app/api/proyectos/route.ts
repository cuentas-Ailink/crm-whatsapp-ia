import { editarProyecto, leerLead } from "@/lib/bd";
import { log } from "@/lib/log";
import { revisarCambioProyecto } from "@/lib/negocio";

// El equipo cambia la fase, el avance o el cliente de una obra desde el panel.

function error(mensaje: string, status: number) {
  return Response.json({ ok: false, error: mensaje }, { status });
}

export async function POST(request: Request) {
  const cuerpo = await request.json().catch(() => null);
  const id = typeof cuerpo?.id === "string" ? cuerpo.id : "";

  const revision = revisarCambioProyecto(cuerpo?.cambios);
  if ("error" in revision) return error(revision.error, 400);

  const { cambios } = revision;
  if (typeof cambios.leadId === "string" && !(await leerLead(cambios.leadId))) return error("Ese cliente ya no existe", 404);

  const guardada = await editarProyecto(id, cambios);
  if (!guardada) return error("Esa obra no existe", 404);
  log(`Obra actualizada desde el panel (${Object.keys(cambios).join(", ")})`);
  return Response.json({ ok: true });
}
