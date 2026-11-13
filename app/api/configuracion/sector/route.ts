import type { ErrorApi } from "@/lib/api-tipos";
import { LIMITES } from "@/lib/configuracion";
import { cambiarDeNegocio, type Destino } from "@/lib/configuracion-servidor";
import { logError } from "@/lib/log";
import { PRESETS } from "@/lib/presets";

// Cambiar de tipo de negocio de una vez, con la casilla de los clientes de ejemplo. También aplica un
// negocio propio (nuevo) y, si el destino ya es el activo, solo cambia el nombre y los ejemplos.

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

/** El destino, si tiene la forma esperada. */
function destinoDe(d: unknown): Destino | null {
  if (!esObjeto(d)) return null;
  const claves = Object.keys(d);
  if (claves.length !== 1) return null;
  if (claves[0] === "sector") {
    return d.sector === "reformas" || d.sector === "inmobiliaria" || d.sector === "clinica" ? { sector: d.sector } : null;
  }
  if (claves[0] === "perfilId") return typeof d.perfilId === "string" && d.perfilId !== "" ? { perfilId: d.perfilId } : null;
  if (claves[0] === "nuevo") {
    const n = d.nuevo;
    if (!esObjeto(n) || typeof n.nombre !== "string" || typeof n.base !== "string" || !Object.hasOwn(PRESETS, n.base)) return null;
    if (n.configuracion !== undefined && !esObjeto(n.configuracion)) return null;
    if (n.instrucciones !== undefined && typeof n.instrucciones !== "string") return null;
    return { nuevo: n as unknown as Extract<Destino, { nuevo: unknown }>["nuevo"] };
  }
  return null;
}

export async function POST(request: Request) {
  const leido = await leerJson(request, LIMITES.cuerpoConfigBytes);
  if ("respuesta" in leido) return leido.respuesta;
  const cuerpo = leido.cuerpo;
  if (!esObjeto(cuerpo)) return error(400, NO_SE_ENTIENDE);
  const destino = destinoDe(cuerpo.destino);
  if (!destino) return error(400, NO_SE_ENTIENDE);
  const ejemplos = cuerpo.ejemplos;
  if (ejemplos !== undefined && ejemplos !== "sustituir" && ejemplos !== "borrar") {
    return error(400, "Elige si cargar los clientes de ejemplo o empezar vacío");
  }
  if (cuerpo.nombre !== undefined && typeof cuerpo.nombre !== "string") return error(400, NO_SE_ENTIENDE, "nombre");
  try {
    const { activa, avisos } = await cambiarDeNegocio(destino, {
      ...(ejemplos !== undefined ? { ejemplos } : {}),
      ...(cuerpo.nombre !== undefined ? { nombre: cuerpo.nombre } : {}),
    });
    return Response.json({ ok: true, activa, avisos });
  } catch (e) {
    return respuestaDeError(e, "al cambiar de tipo de negocio");
  }
}
