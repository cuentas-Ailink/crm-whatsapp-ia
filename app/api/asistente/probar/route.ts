import type { ErrorApi, PeticionPrueba } from "@/lib/api-tipos";
import { logError } from "@/lib/log";
import { ErrorPrueba, probarAsistente } from "@/lib/probar";

// «Probar tu asistente»: la respuesta que daría a una conversación inventada. No envía ni guarda
// nada. Si se cierra el chat de prueba, la petición se cancela y la llamada al modelo también.

export const dynamic = "force-dynamic";

function errorApi(status: number, error: string): Response {
  return Response.json({ ok: false, error } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => null)) as PeticionPrueba | null;
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) return errorApi(400, "No se ha entendido la petición");
  try {
    return Response.json(await probarAsistente(cuerpo, { senal: request.signal }));
  } catch (error) {
    if (error instanceof ErrorPrueba) return errorApi(error.status, error.message);
    if (request.signal.aborted) return errorApi(400, "Prueba cancelada");
    logError("al probar el asistente", error);
    return errorApi(500, "Algo ha fallado. Vuelve a intentarlo en un momento.");
  }
}
