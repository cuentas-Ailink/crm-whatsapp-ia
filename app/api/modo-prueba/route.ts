import type { ErrorApi } from "@/lib/api-tipos";
import { cambioDeSistema } from "@/lib/cambio-sistema";
import { telefonoComercial } from "@/lib/configuracion";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { log, logError } from "@/lib/log";
import { activarModoPrueba, borrarModoPrueba, guardarPermitidos, leerModoPrueba } from "@/lib/modo-prueba";
import { consultarPuente, desvincularPuente, estadoInstalacion, prepararModoPrueba } from "@/lib/modo-prueba-puente";
import { enmascararVinculado, estaPermitido, revisarPermitidos, type EstadoModoPrueba } from "@/lib/modo-prueba-reglas";
import { modoServidor } from "@/lib/tunel";

// El «modo prueba» (WhatsApp vinculado con un QR, no la vía oficial): elegirlo, prepararlo, la lista
// de números permitidos, desvincular y volver a la vía oficial. Solo en local: en modo servidor no
// existe, y aquí solo contesta a quien llama a este ordenador por su nombre (además de proxy.ts).

export const dynamic = "force-dynamic";

const ACCIONES = ["activar", "preparar", "permitidos", "desvincular", "oficial"] as const;
type Accion = (typeof ACCIONES)[number];

const SOLO_LOCAL = "El modo prueba solo funciona con el CRM abierto en este ordenador";
const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function errorApi(status: number, error: string, extra: Omit<ErrorApi, "ok" | "error"> = {}): Response {
  return Response.json({ ok: false, error, ...extra } satisfies ErrorApi, { status });
}

/** null si se puede usar; si no, la respuesta que lo niega. */
function negar(request: Request): Response | null {
  if (modoServidor()) return errorApi(404, SOLO_LOCAL);
  const host = (request.headers.get("host") ?? "").split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
  const reenviado = request.headers.get("x-forwarded-host");
  if (!LOCALES.has(host) || (reenviado && !LOCALES.has(reenviado.split(",")[0].trim().replace(/:\d+$/, "").toLowerCase()))) return errorApi(404, SOLO_LOCAL);
  return null;
}

/** Lo que se cuenta al navegador: el móvil vinculado, tapado; nunca el secreto. */
async function estado(): Promise<EstadoModoPrueba> {
  const config = leerModoPrueba();
  const pintar = await configuracionParaPintar();
  const prefijo = pintar.regional.prefijo;
  const puente = config ? await consultarPuente() : { fase: "parado" as const, qr: null, numero: null, error: null };
  const aviso = telefonoComercial(pintar.sistema, process.env.TELEFONO_COMERCIAL, prefijo);
  return {
    ok: true,
    activo: config !== null,
    instalacion: estadoInstalacion(),
    puente: { ...puente, numero: puente.numero ? enmascararVinculado(puente.numero, prefijo) : null },
    permitidos: config?.permitidos ?? [],
    avisoPermitido: aviso ? estaPermitido(aviso, config?.permitidos ?? []) : null,
  };
}

export async function GET(request: Request) {
  const negado = negar(request);
  if (negado) return negado;
  return Response.json(await estado());
}

export async function POST(request: Request) {
  const negado = negar(request);
  if (negado) return negado;
  const cuerpo = (await request.json().catch(() => undefined)) as { accion?: unknown; acepto?: unknown; numeros?: unknown } | null | undefined;
  if (cuerpo === undefined || typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) return errorApi(400, "No se ha entendido la petición");
  if (typeof cuerpo.accion !== "string" || !(ACCIONES as readonly string[]).includes(cuerpo.accion)) return errorApi(400, "No se ha entendido la petición");
  const accion = cuerpo.accion as Accion;

  try {
    if (accion === "activar") {
      if (cuerpo.acepto !== true) return errorApi(400, "Marca «Entiendo que es solo para probar» para seguir", { campo: "acepto" });
      activarModoPrueba();
      log("Modo prueba elegido: WhatsApp por QR, no la vía oficial");
    } else if (!leerModoPrueba()) {
      return errorApi(409, "Primero elige el modo prueba");
    } else if (accion === "preparar") {
      prepararModoPrueba();
    } else if (accion === "permitidos") {
      const { regional } = await configuracionParaPintar();
      const revisados = revisarPermitidos(cuerpo.numeros, regional.prefijo);
      if ("error" in revisados) return errorApi(400, revisados.error, { campo: revisados.indice !== undefined ? `numeros.${revisados.indice}` : "numeros" });
      guardarPermitidos(revisados.numeros);
    } else if (accion === "desvincular") {
      await desvincularPuente();
      log("Modo prueba: móvil desvinculado y sesión borrada");
    } else {
      await desvincularPuente();
      borrarModoPrueba();
      log("Vuelta a WhatsApp oficial: el modo prueba está apagado");
    }
  } catch (error) {
    logError(`en el modo prueba (${accion})`, error);
    return errorApi(500, "No se ha podido hacer. Vuelve a intentarlo en un momento.");
  }
  cambioDeSistema();
  return Response.json(await estado());
}
