import type { ErrorApi } from "@/lib/api-tipos";
import { LIMITES, revisarInstrucciones } from "@/lib/configuracion";
import { configuracionActiva, guardarInformacion, guardarPrompt, restaurarPrompt } from "@/lib/configuracion-servidor";
import { logError } from "@/lib/log";

// Las instrucciones del asistente desde Ajustes: el texto entero, solo «Lo que tiene que saber de tu
// negocio» o volver al texto de partida.

export const dynamic = "force-dynamic";

const DEMASIADO = "El cambio es demasiado grande";
const NO_SE_ENTIENDE = "No se ha entendido la petición";
const ALGO_HA_FALLADO = "Algo ha fallado. Vuelve a intentarlo en un momento.";
const ESTADOS = new Set([400, 404, 409, 413, 500]);

function error(status: number, mensaje: string, campo?: string): Response {
  return Response.json({ ok: false, error: mensaje, ...(campo ? { campo } : {}) } satisfies ErrorApi, { status });
}

function respuestaDeError(e: unknown, contexto: string): Response {
  const status = typeof e === "object" && e !== null ? (e as { status?: unknown }).status : undefined;
  if (e instanceof Error && typeof status === "number" && ESTADOS.has(status)) {
    const campo = (e as { campo?: unknown }).campo;
    return error(status, e.message, typeof campo === "string" ? campo : undefined);
  }
  logError(contexto, e);
  return error(500, ALGO_HA_FALLADO);
}

/** El cuerpo JSON, sin pasar del límite: primero por la cabecera y luego por lo leído. */
async function leerJson(request: Request, limite: number): Promise<{ cuerpo: unknown } | { respuesta: Response }> {
  if (Number(request.headers.get("content-length") ?? 0) > limite) return { respuesta: error(413, DEMASIADO) };
  const trozos: Uint8Array[] = [];
  let total = 0;
  const lector = request.body?.getReader();
  if (lector) {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > limite) {
        await lector.cancel().catch(() => {});
        return { respuesta: error(413, DEMASIADO) };
      }
      trozos.push(value);
    }
  }
  try {
    return { cuerpo: JSON.parse(Buffer.concat(trozos).toString("utf8")) as unknown };
  } catch {
    return { respuesta: error(400, NO_SE_ENTIENDE) };
  }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(request: Request) {
  const leido = await leerJson(request, LIMITES.cuerpoConfigBytes);
  if ("respuesta" in leido) return leido.respuesta;
  const cuerpo = leido.cuerpo;
  if (!esObjeto(cuerpo)) return error(400, NO_SE_ENTIENDE);
  try {
    if (cuerpo.restaurar === true) {
      const perfil = await restaurarPrompt();
      const { config } = await configuracionActiva();
      const revision = revisarInstrucciones(perfil.instrucciones, {
        perfilId: perfil.id,
        vocabulario: config.vocabulario,
        agente: config.agente,
        moneda: config.regional.moneda,
        negocio: config.negocio.nombre,
        plantilla: config.plantilla,
      });
      return Response.json({ ok: true, hash: perfil.hash, revision });
    }
    if (typeof cuerpo.hash !== "string") return error(400, NO_SE_ENTIENDE);
    if (typeof cuerpo.texto === "string") {
      const { perfil, revision } = await guardarPrompt(cuerpo.texto, cuerpo.hash);
      return Response.json({ ok: true, hash: perfil.hash, revision });
    }
    if (typeof cuerpo.informacion === "string") {
      const { perfil, revision } = await guardarInformacion(cuerpo.informacion, cuerpo.hash);
      return Response.json({ ok: true, hash: perfil.hash, revision });
    }
    return error(400, NO_SE_ENTIENDE);
  } catch (e) {
    return respuestaDeError(e, "al guardar las instrucciones");
  }
}
