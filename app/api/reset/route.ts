import type { ErrorApi } from "@/lib/api-tipos";
import { reiniciarBd } from "@/lib/bd";
import { buzon } from "@/lib/buzon";
import { opcionesSemilla } from "@/lib/configuracion";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { explicarBd } from "@/lib/errores";
import { log, logError } from "@/lib/log";

export const dynamic = "force-dynamic";

// El reinicio ({}: vuelven los ejemplos) y «Borrar todo» ({ ejemplos: false }, también los clientes reales).
// Primero se cancela lo que esté en curso, para que no escriba nada en la base de datos ya vacía.
export async function POST(request: Request) {
  const cuerpo: unknown = await request.json().catch(() => null);
  const ejemplos = cuerpo !== null && typeof cuerpo === "object" && Object.hasOwn(cuerpo, "ejemplos") ? (cuerpo as { ejemplos: unknown }).ejemplos : undefined;
  if (ejemplos !== undefined && ejemplos !== false) {
    return Response.json({ ok: false, error: "El campo «ejemplos» solo admite false" } satisfies ErrorApi, { status: 400 });
  }
  buzon.reiniciar();
  try {
    await reiniciarBd(opcionesSemilla(await configuracionParaPintar()), ejemplos === false ? { ejemplos: false } : undefined);
  } catch (error) {
    logError("al reiniciar la base de datos", error);
    const explicado = explicarBd(error);
    return Response.json({ ok: false, error: explicado.titulo, codigo: explicado.codigo } satisfies ErrorApi, { status: 500 });
  }
  log(ejemplos === false ? "Todo borrado, también los clientes reales" : "CRM reiniciado");
  return Response.json({ ok: true });
}
