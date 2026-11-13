import { randomUUID } from "node:crypto";
import type { ErrorApi } from "@/lib/api-tipos";
import { momentoDeHueco } from "@/lib/agenda";
import { guardarMutaciones, leerLead, leerReservas } from "@/lib/bd";
import { revisarCita, textoCitaParaCliente } from "@/lib/cita";
import { configuracionActiva } from "@/lib/configuracion-servidor";
import { explicarMeta } from "@/lib/errores";
import { ventana24h } from "@/lib/hilo";
import { log, logError } from "@/lib/log";
import { esEjemplo } from "@/lib/negocio";
import type { Mutacion } from "@/lib/tipos";
import { formas } from "@/lib/vocabulario";
import { ErrorWhatsApp, enviarTexto } from "@/lib/whatsapp";

// Dar, cambiar o anular una cita a mano desde la ficha. Los huecos y las reglas son los mismos que
// usa el asistente (lib/cita.ts) y la base de datos no deja dos citas en el mismo hueco. Dar o cambiar
// la cita la confirma al cliente por WhatsApp si se puede (ventana de 24 h abierta, sin silencio y no
// es un ejemplo); anular no le manda nada. El historial lo escribe cada mutación y el aviso en tiempo
// real lo da guardarMutaciones.

export const dynamic = "force-dynamic";

const ACCIONES = ["dar", "cambiar", "anular"] as const;
type Accion = (typeof ACCIONES)[number];

const AVISO_SILENCIO = "Ha pedido que no le escribamos por WhatsApp: avísale tú.";
const AVISO_VENTANA = "La ventana de 24 h está cerrada: avísale tú o retoma con un mensaje aprobado.";

function error(status: number, mensaje: string, campo?: string): Response {
  return Response.json({ ok: false, error: mensaje, ...(campo ? { campo } : {}) } satisfies ErrorApi, { status });
}

/** Otra cita en ese hueco (por ejemplo, la acaba de reservar el asistente): clave repetida en `visitas`. */
function esHuecoOcupado(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505";
}

export async function POST(request: Request) {
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;
  if (!ACCIONES.includes(cuerpo.accion as Accion)) return error(400, "Elige qué hacer con la cita");
  const accion = cuerpo.accion as Accion;

  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  if (!lead) return error(404, "Ese cliente ya no existe");
  if (lead.estado === "spam") return error(409, "Es publicidad: no se le da cita");
  if (lead.cierre) return error(409, "Está cerrado: pulsa «Reabrir» antes de darle cita");

  const { config } = await configuracionActiva();
  const v = config.vocabulario;
  const f = formas(v.cita);
  const reglas = config.calendario;
  const ahora = new Date();
  const futura = !!lead.visita && momentoDeHueco(lead.visita.id, reglas.zona) > ahora.getTime();
  if (accion === "dar" && futura) return error(409, `Ya tiene ${f.un} ${v.cita.singular}: cámbia${f.lo} o anúla${f.lo}`);
  if (accion !== "dar" && !futura) return error(409, `No tiene ${f.ningun} ${v.cita.singular} pendiente`);

  const ts = ahora.getTime();

  if (accion === "anular") {
    const mutaciones: Mutacion[] = [{ t: "cancelar", leadId: lead.id, ts }];
    if (lead.estado === "visita") {
      // Quien nunca ha escrito (un cliente añadido a mano) no puede leer «Ha contestado».
      const estado = lead.mensajes.some((m) => m.de === "cliente") ? "conversacion" : "nuevo";
      mutaciones.push({ t: "estado", leadId: lead.id, estado, ts });
    }
    try {
      await guardarMutaciones(mutaciones);
    } catch (e) {
      logError(`al anular la cita de ${lead.nombre}`, e);
      return error(500, "No se ha podido anular la cita. Vuelve a intentarlo.");
    }
    log(`Cita anulada a mano: ${lead.nombre}, ${lead.visita?.texto ?? ""}`);
    return Response.json({ ok: true, enviado: false });
  }

  const revisada = revisarCita(accion, typeof cuerpo.huecoId === "string" ? cuerpo.huecoId : "", lead, await leerReservas(), ahora, reglas);
  if ("error" in revisada) return error(revisada.error === "Ese hueco ya está ocupado" ? 409 : 400, revisada.error, "huecoId");
  const { hueco } = revisada;

  const mutaciones: Mutacion[] = [
    {
      t: "reserva",
      reserva: { huecoId: hueco.id, texto: hueco.texto, leadId: lead.id, nombre: lead.nombre, perfilNombre: lead.perfilNombre, prueba: esEjemplo(lead) || undefined },
      hueco,
      ts,
    },
  ];
  if (lead.estado === "nuevo" || lead.estado === "conversacion") mutaciones.push({ t: "estado", leadId: lead.id, estado: "visita", ts });
  // Sale de «Te toca» y, como ya tiene la cita en esta misma transacción, cae en «visita».
  else if (lead.estado === "persona") mutaciones.push({ t: "etapa", leadId: lead.id, ts, a: "asistente" });
  try {
    await guardarMutaciones(mutaciones);
  } catch (e) {
    if (esHuecoOcupado(e)) return error(409, "Ese hueco ya está ocupado", "huecoId");
    logError(`al guardar la cita de ${lead.nombre}`, e);
    return error(500, "No se ha podido guardar la cita. Vuelve a intentarlo.");
  }
  log(`Cita a mano: ${lead.nombre}, ${hueco.texto}`);

  // El WhatsApp al cliente, con la cita ya guardada. Se vuelve a leer: puede haber pedido que no le
  // escribamos mientras el dueño elegía.
  if (cuerpo.enviar === false || esEjemplo(lead)) return Response.json({ ok: true, enviado: false });
  const actual = (await leerLead(lead.id)) ?? lead;
  if (actual.silenciadoEn) return Response.json({ ok: true, enviado: false, aviso: AVISO_SILENCIO });
  if (!ventana24h(actual, Date.now()).abierta) return Response.json({ ok: true, enviado: false, aviso: AVISO_VENTANA });

  const texto = textoCitaParaCliente(hueco, { vocabulario: v, nombre: actual.nombre, trato: config.agente.trato });
  let wamid: string;
  try {
    wamid = await enviarTexto(actual.telefono, texto);
  } catch (e) {
    logError(`al confirmar por WhatsApp la cita de ${lead.nombre}`, e);
    const titulo = e instanceof ErrorWhatsApp ? e.explicado.titulo : explicarMeta().titulo;
    return Response.json({ ok: true, enviado: false, aviso: `No se ha podido enviar el WhatsApp: ${titulo}` });
  }
  try {
    await guardarMutaciones([
      { t: "mensaje", leadId: lead.id, mensaje: { id: wamid || `manual-${randomUUID()}`, de: "agente", texto, ts: Date.now(), manual: true, entrega: "enviado" } },
    ]);
  } catch (e) {
    // El WhatsApp ya ha salido: no se cuenta como fallo.
    logError(`al guardar el WhatsApp de la cita de ${lead.nombre}`, e);
  }
  return Response.json({ ok: true, enviado: true });
}
