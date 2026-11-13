import type { ErrorApi } from "@/lib/api-tipos";
import { cambiarAsistente } from "@/lib/configuracion-servidor";
import { explicarBd } from "@/lib/errores";
import { logError } from "@/lib/log";

// Encender o pausar el asistente. Al pausarlo se guarda desde cuándo.

export const dynamic = "force-dynamic";

function errorApi(status: number, error: string): Response {
  return Response.json({ ok: false, error } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => undefined)) as { activo?: unknown } | null | undefined;
  if (cuerpo === undefined || typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return errorApi(400, "No se ha entendido la petición");
  }
  if (typeof cuerpo.activo !== "boolean") return errorApi(400, "Falta indicar si el asistente contesta");
  try {
    const a = await cambiarAsistente(cuerpo.activo);
    return Response.json({ ok: true, activo: a.activo, pausadoEn: a.pausadoEn });
  } catch (error) {
    logError("al encender o pausar el asistente", error);
    const e = explicarBd(error);
    return Response.json({ ok: false, error: `${e.titulo.replace(/\.$/, "")}. ${e.solucion}`, codigo: e.codigo } satisfies ErrorApi, { status: 500 });
  }
}
