import type { ErrorApi } from "@/lib/api-tipos";
import { leerConfiguracionGuardada, leerLogo } from "@/lib/bd";
import { LIMITES, normalizarGuardada } from "@/lib/configuracion";
import { guardarLogoActivo } from "@/lib/configuracion-servidor";
import { logError } from "@/lib/log";

// El logo del negocio activo: subirlo o quitarlo, y servirlo. Se sirve solo como imagen (PNG, JPG o
// WebP), con nosniff y una CSP que no deja ejecutar nada; con su versión en la URL, para siempre.

export const dynamic = "force-dynamic";

const DEMASIADO = "La imagen es demasiado grande";
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
  const leido = await leerJson(request, LIMITES.cuerpoLogoBytes);
  if ("respuesta" in leido) return leido.respuesta;
  const cuerpo = leido.cuerpo;
  if (!esObjeto(cuerpo) || (cuerpo.dataUrl !== null && typeof cuerpo.dataUrl !== "string")) return error(400, NO_SE_ENTIENDE);
  try {
    return Response.json({ ok: true, activa: await guardarLogoActivo(cuerpo.dataUrl) });
  } catch (e) {
    return respuestaDeError(e, "al guardar el logo");
  }
}

function noEsta(): Response {
  return new Response("No encontrado", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const parametros = new URL(request.url).searchParams;
  const perfil = parametros.get("perfil") ?? "";
  const version = parametros.get("v");
  if (!/^[a-z0-9-]{1,80}$/.test(perfil)) return noEsta();
  try {
    const [dataUrl, raw] = await Promise.all([leerLogo(perfil), leerConfiguracionGuardada()]);
    const m = dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!m) return noEsta();
    const actual = normalizarGuardada(raw).perfiles[perfil]?.negocio?.logoVersion;
    const vigente = typeof actual === "string" && actual !== "" && version === actual;
    return new Response(new Uint8Array(Buffer.from(m[2], "base64")), {
      headers: {
        "Content-Type": m[1],
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": vigente ? "public, max-age=31536000, immutable" : "no-store",
      },
    });
  } catch (e) {
    return respuestaDeError(e, "al leer el logo");
  }
}
