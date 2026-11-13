import { randomUUID } from "node:crypto";
import type { ErrorApi, PlantillaAprobada } from "@/lib/api-tipos";
import { guardarMutaciones, leerLead } from "@/lib/bd";
import type { ConfiguracionResuelta } from "@/lib/configuracion";
import { configuracionActiva } from "@/lib/configuracion-servidor";
import { explicarMeta, type CodigoError } from "@/lib/errores";
import { ventana24h } from "@/lib/hilo";
import { log, logError } from "@/lib/log";
import { listarPlantillas, plantillasAprobadas } from "@/lib/meta";
import { modoWhatsApp } from "@/lib/modo-prueba";
import { NO_DISPONIBLE_EN_PRUEBA } from "@/lib/modo-prueba-reglas";
import { esEjemplo } from "@/lib/negocio";
import { PLANTILLA_AVISO, PLANTILLA_RETOMAR } from "@/lib/plantillas";
import { revisarVariables, sePuedeRetomar, textoRenderizado, variablesDePlantilla } from "@/lib/retomar";
import type { Lead, Mutacion } from "@/lib/tipos";
import { ErrorWhatsApp, enviarPlantillaConVariables } from "@/lib/whatsapp";

// «Retomar la conversación»: pasadas 24 h desde el último mensaje del cliente, WhatsApp solo deja
// escribirle con un mensaje aprobado. GET da los mensajes aprobados que tienen sentido para un
// cliente; POST manda uno con sus variables y lo guarda como cualquier mensaje (con su texto ya
// rellenado y «Retomado con «…»» en el historial). Nunca a quien ha pedido que no le escribamos (I15).

export const dynamic = "force-dynamic";

/** Las que no se mandan a un cliente: las de la app (la bienvenida va aparte, es la del negocio) y la de prueba de Meta. */
const FUERA = ["solicitud_general", "solicitud_recibida", PLANTILLA_AVISO.nombre, "hello_world"];
const REINTENTO_MS = 500;

function error(status: number, mensaje: string, extra?: { campo?: string; codigo?: CodigoError }): Response {
  return Response.json({ ok: false, error: mensaje, ...extra } satisfies ErrorApi, { status });
}

/** Lo que comparten GET y POST: el cliente existe y se le puede escribir con un mensaje aprobado. */
function sinPermiso(lead: Lead | undefined): Response | null {
  if (!lead) return error(404, "Ese cliente ya no existe");
  if (esEjemplo(lead)) return error(409, "Contacto de ejemplo: los mensajes no salen por WhatsApp");
  if (lead.silenciadoEn) return error(409, "Ha pedido que no le escribamos por WhatsApp");
  // Sin ningún mensaje (añadido a mano) no hay consentimiento para escribirle.
  if (lead.mensajes.length === 0) return error(409, "Aún no te ha escrito: hace falta su permiso para escribirle por WhatsApp");
  if (ventana24h(lead, Date.now()).abierta) return error(409, "La ventana sigue abierta: escríbele directamente");
  return null;
}

/** Las aprobadas en Meta que sirven para retomar, recién leídas: la sugerida primero y el resto por nombre. */
async function plantillasParaRetomar(config: ConfiguracionResuelta): Promise<PlantillaAprobada[]> {
  try {
    // La caché de Meta solo vuelve a pedir si su lista tiene más de 5 s.
    await listarPlantillas({ forzar: true });
  } catch {
    // plantillasAprobadas devuelve lo que haya.
  }
  const fuera = [config.plantilla.nombre, ...FUERA];
  return (await plantillasAprobadas())
    .filter((p) => sePuedeRetomar(p, fuera))
    .sort((a, b) => Number(b.nombre === PLANTILLA_RETOMAR.nombre) - Number(a.nombre === PLANTILLA_RETOMAR.nombre) || a.nombre.localeCompare(b.nombre) || a.idioma.localeCompare(b.idioma));
}

export async function GET(request: Request) {
  if (modoWhatsApp() === "prueba") return error(409, `${NO_DISPONIBLE_EN_PRUEBA}: retomar usa los mensajes aprobados de Meta`);
  const lead = await leerLead(new URL(request.url).searchParams.get("leadId") ?? "");
  const no = sinPermiso(lead);
  if (no) return no;
  const { config } = await configuracionActiva();
  return Response.json({ plantillas: await plantillasParaRetomar(config) });
}

export async function POST(request: Request) {
  if (modoWhatsApp() === "prueba") return error(409, `${NO_DISPONIBLE_EN_PRUEBA}: retomar usa los mensajes aprobados de Meta`);
  const leido = (await request.json().catch(() => null)) as unknown;
  const cuerpo = (typeof leido === "object" && leido !== null && !Array.isArray(leido) ? leido : {}) as Record<string, unknown>;
  const lead = await leerLead(typeof cuerpo.leadId === "string" ? cuerpo.leadId : "");
  const no = sinPermiso(lead);
  if (no || !lead) return no ?? error(404, "Ese cliente ya no existe");

  const pedida = (typeof cuerpo.plantilla === "object" && cuerpo.plantilla !== null ? cuerpo.plantilla : null) as { nombre?: unknown; idioma?: unknown } | null;
  if (!pedida || typeof pedida.nombre !== "string" || !pedida.nombre) return error(400, "Elige un mensaje");

  const { config } = await configuracionActiva();
  const p = (await plantillasParaRetomar(config)).find((x) => x.nombre === pedida.nombre && (typeof pedida.idioma !== "string" || x.idioma === pedida.idioma));
  if (!p) return error(409, "Ese mensaje ya no está aprobado en Meta");

  // Lo que ha escrito el dueño, por número; el nombre del cliente y el del negocio, si se saben, mandan.
  const escritas = (typeof cuerpo.variables === "object" && cuerpo.variables !== null && !Array.isArray(cuerpo.variables) ? cuerpo.variables : {}) as Record<string, unknown>;
  const { fijas } = variablesDePlantilla(p, lead, config.negocio.nombre);
  const hasta = p.variables.length ? Math.max(...p.variables) : 0;
  const valores = Array.from({ length: hasta }, (_, i) => {
    const n = i + 1;
    if (fijas[n] !== undefined) return fijas[n];
    const valor = escritas[String(n)];
    return typeof valor === "string" ? valor : "";
  });
  const revisadas = revisarVariables(p, valores);
  if ("error" in revisadas) return error(400, revisadas.error, { campo: String(revisadas.variable) });

  let wamid: string;
  try {
    wamid = await enviarPlantillaConVariables(lead.telefono, { nombre: p.nombre, idioma: p.idioma, variables: revisadas.valores });
  } catch (e) {
    logError(`al retomar con ${p.nombre} la conversación de ${lead.nombre}`, e);
    const explicado = e instanceof ErrorWhatsApp ? e.explicado : explicarMeta();
    return error(502, explicado.titulo, { codigo: explicado.codigo });
  }

  const ts = Date.now();
  const mutaciones: Mutacion[] = [
    {
      t: "mensaje",
      leadId: lead.id,
      mensaje: {
        id: wamid || `manual-${randomUUID()}`,
        de: "agente",
        texto: textoRenderizado(p, revisadas.valores),
        ts,
        plantilla: true,
        nombrePlantilla: p.nombre,
        manual: true,
        entrega: "enviado",
      },
    },
    { t: "actividad", leadId: lead.id, id: `retomar-${lead.id}-${ts}`, texto: `Retomado con «${p.nombre}»`, ts },
  ];
  try {
    await guardarMutaciones(mutaciones);
  } catch (e) {
    // El WhatsApp ya ha salido: se reintenta una vez y, pase lo que pase, la respuesta es que ha ido bien.
    logError(`al guardar el mensaje aprobado de ${lead.nombre}`, e);
    await new Promise((r) => setTimeout(r, REINTENTO_MS));
    await guardarMutaciones(mutaciones).catch((otro: unknown) => logError(`al guardar otra vez el mensaje aprobado de ${lead.nombre}`, otro));
  }
  log(`Conversación retomada con «${p.nombre}»: ${lead.nombre}`);
  return Response.json({ ok: true });
}
