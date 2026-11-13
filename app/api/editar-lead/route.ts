import type { ErrorApi } from "@/lib/api-tipos";
import { guardarMutaciones, leerLead } from "@/lib/bd";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { log } from "@/lib/log";
import { revisarCambiosFicha } from "@/lib/negocio";

// El dueño corrige o completa la ficha de un cliente. El asistente lo ve en su siguiente respuesta:
// el nombre y los datos van en lo que lee de cada cliente. La ficha revisa lo mismo antes de enviarlo.

export const dynamic = "force-dynamic";

function error(status: number, mensaje: string): Response {
  return Response.json({ ok: false, error: mensaje } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;
  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error(404, "Ese cliente ya no existe");

  const cfg = await configuracionParaPintar();
  const revision = revisarCambiosFicha(lead, cuerpo.cambios, { vocabulario: cfg.vocabulario, moneda: cfg.regional.moneda });
  if ("error" in revision) return error(400, revision.error);

  const { cambios } = revision;
  const campos = [
    ...(["nombre", "email", "zona", "presupuesto", "cobrado", "etiquetas"] as const).filter((c) => c in cambios),
    ...Object.keys(cambios.datos ?? {}),
  ];
  if (campos.length) {
    await guardarMutaciones([{ t: "ficha", leadId: lead.id, cambios }]);
    log(`Ficha editada desde el panel: ${cambios.nombre ?? lead.nombre} (${campos.join(", ")})`);
  }
  return Response.json({ ok: true });
}
