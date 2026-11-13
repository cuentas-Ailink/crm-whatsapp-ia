import type { ErrorApi } from "@/lib/api-tipos";
import { guardarMutaciones, leerLead } from "@/lib/bd";
import { LIMITES } from "@/lib/configuracion";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { volvioAEscribir } from "@/lib/hilo";
import { log } from "@/lib/log";
import { formatoImporte, importeMaximo, momentoDeHueco, MONEDAS } from "@/lib/negocio";
import { MOTIVOS_NO_SIGUE, type MotivoNoSigue } from "@/lib/tipos";

// Cómo fue la cita: «Ha dicho que sí» (con el importe y, si la hay, la señal cobrada) o «No sigue»
// (con un motivo). «Reabrir» lo deshace y «visto» apaga el «Ha vuelto a escribir». Solo lo decide
// el dueño: un mensaje del cliente nunca cambia un cierre (I23). El historial lo escribe la mutación.

export const dynamic = "force-dynamic";

const ACCIONES = ["si", "no", "reabrir", "visto"] as const;
type Accion = (typeof ACCIONES)[number];

function error(status: number, mensaje: string, campo?: string): Response {
  return Response.json({ ok: false, error: mensaje, ...(campo ? { campo } : {}) } satisfies ErrorApi, { status });
}

const esEntero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export async function POST(request: Request) {
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;

  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error(404, "Ese cliente ya no existe");
  if (!ACCIONES.includes(cuerpo.accion as Accion)) return error(400, "No sé qué hacer con ese cierre");
  const accion = cuerpo.accion as Accion;
  if (lead.estado === "spam") return error(409, "Es publicidad: no se cierra");

  const cfg = await configuracionParaPintar();
  const moneda = cfg.regional.moneda;
  const zona = cfg.calendario.zona;
  const ts = Date.now();

  const nota = typeof cuerpo.nota === "string" ? cuerpo.nota.trim() : "";
  const notaLarga = nota.length > LIMITES.notaCierre;

  if (accion === "si") {
    const { importe, cobrado } = cuerpo;
    if (importe === undefined || importe === null || importe === "") return error(400, "Escribe el importe", "importe");
    const enMoneda = MONEDAS[moneda].nombre;
    if (!esEntero(importe) || importe < 0 || importe > importeMaximo(moneda)) {
      return error(400, `El importe tiene que ser una cantidad en ${enMoneda}, sin decimales`, "importe");
    }
    if (cobrado !== undefined && cobrado !== null) {
      if (!esEntero(cobrado) || cobrado < 0) return error(400, `Lo cobrado tiene que ser una cantidad en ${enMoneda}, sin decimales`, "cobrado");
      if (cobrado > importe) return error(400, "Lo cobrado no puede pasar del importe", "cobrado");
    }
    if (notaLarga) return error(400, `La nota no puede pasar de ${LIMITES.notaCierre} caracteres`, "nota");
    await guardarMutaciones([
      { t: "cierre", leadId: lead.id, ts, accion: "si", importe, cobrado: (cobrado as number | null | undefined) ?? null, nota: nota || undefined, moneda },
    ]);
    log(`Cierre de ${lead.nombre}: Ha dicho que sí · ${formatoImporte(importe, moneda)}`);
    return Response.json({ ok: true });
  }

  if (accion === "no") {
    if (!MOTIVOS_NO_SIGUE.includes(cuerpo.motivo as MotivoNoSigue)) return error(400, "Elige un motivo", "motivo");
    if (notaLarga) return error(400, `La nota no puede pasar de ${LIMITES.notaCierre} caracteres`, "nota");
    const motivo = cuerpo.motivo as MotivoNoSigue;
    // Solo se anula una cita futura: la que ya pasó se queda como constancia de la visita.
    const anularCita = !!lead.visita && momentoDeHueco(lead.visita.id, zona) > ts;
    await guardarMutaciones([{ t: "cierre", leadId: lead.id, ts, accion: "no", motivo, nota: nota || undefined, anularCita }]);
    log(`Cierre de ${lead.nombre}: No sigue · ${motivo}`);
    return Response.json({ ok: true });
  }

  if (accion === "reabrir") {
    if (!lead.cierre) return error(409, "No estaba cerrado");
    await guardarMutaciones([{ t: "cierre", leadId: lead.id, ts, accion: "reabrir" }]);
    log(`Cierre de ${lead.nombre}: Reabierto`);
    return Response.json({ ok: true });
  }

  // «visto»: el dueño ha abierto la ficha después de que el cliente volviera a escribir.
  if (volvioAEscribir(lead)) await guardarMutaciones([{ t: "cierre", leadId: lead.id, ts, accion: "visto" }]);
  return Response.json({ ok: true });
}
