import type { ErrorApi } from "@/lib/api-tipos";
import { comprobarClaveClaude } from "@/lib/claves";
import { MODELOS, type IdModelo } from "@/lib/configuracion";
import type { ErrorExplicado } from "@/lib/errores";

// Comprueba que la clave de Claude puede usar un modelo, con una llamada de verdad de un token.
// Solo comprueba: el modelo se guarda en Ajustes con el resto de la configuración.

export const dynamic = "force-dynamic";

function errorApi(status: number, e: ErrorExplicado): Response {
  const titulo = e.titulo.endsWith(".") ? e.titulo : `${e.titulo}.`;
  const error = e.solucion ? `${titulo} ${e.solucion}` : titulo;
  return Response.json({ ok: false, error, codigo: e.codigo } satisfies ErrorApi, { status });
}

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => undefined)) as { modelo?: unknown } | null | undefined;
  if (cuerpo === undefined || typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return Response.json({ ok: false, error: "No se ha entendido la petición" } satisfies ErrorApi, { status: 400 });
  }
  if (typeof cuerpo.modelo !== "string" || !MODELOS.includes(cuerpo.modelo as IdModelo)) {
    return Response.json({ ok: false, error: "Elige uno de los dos modelos" } satisfies ErrorApi, { status: 400 });
  }
  const r = await comprobarClaveClaude(undefined, cuerpo.modelo);
  if (r.ok) return Response.json({ ok: true });
  if (r.error.codigo === "claude.clave") return errorApi(401, r.error);
  if (r.error.codigo === "claude.modelo") return errorApi(404, r.error);
  return errorApi(502, r.error);
}
