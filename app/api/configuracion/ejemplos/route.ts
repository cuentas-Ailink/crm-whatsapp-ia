import type { ErrorApi } from "@/lib/api-tipos";
import { borrarEjemplos, sustituirEjemplos } from "@/lib/bd";
import { opcionesSemilla } from "@/lib/configuracion";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { explicarBd } from "@/lib/errores";
import { log, logError } from "@/lib/log";

export const dynamic = "force-dynamic";

// Los datos de ejemplo: «cargar» los cambia por los del negocio configurado y «borrar» los quita.
// Los clientes reales no se tocan en ningún caso.
export async function POST(request: Request) {
  const cuerpo: unknown = await request.json().catch(() => null);
  const accion = cuerpo !== null && typeof cuerpo === "object" ? (cuerpo as { accion?: unknown }).accion : undefined;
  if (accion !== "cargar" && accion !== "borrar") {
    return Response.json({ ok: false, error: "Falta indicar si cargar o borrar los ejemplos" } satisfies ErrorApi, { status: 400 });
  }
  try {
    if (accion === "cargar") {
      const opciones = opcionesSemilla(await configuracionParaPintar());
      const { leads } = await sustituirEjemplos(opciones);
      log(`Datos de ejemplo cargados (${opciones.sector})`);
      return Response.json({ ok: true, leads });
    }
    await borrarEjemplos();
    log("Datos de ejemplo borrados");
    return Response.json({ ok: true, leads: 0 });
  } catch (error) {
    logError(accion === "cargar" ? "al cargar los datos de ejemplo" : "al borrar los datos de ejemplo", error);
    const explicado = explicarBd(error);
    return Response.json({ ok: false, error: explicado.titulo, codigo: explicado.codigo } satisfies ErrorApi, { status: 500 });
  }
}
