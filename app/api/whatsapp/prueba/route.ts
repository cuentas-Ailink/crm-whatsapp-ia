import type { ErrorApi } from "@/lib/api-tipos";
import { parametroSeguro } from "@/lib/configuracion";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { explicar, explicarMeta, type ErrorExplicado } from "@/lib/errores";
import { log, logError } from "@/lib/log";
import { modoWhatsApp } from "@/lib/modo-prueba";
import { NO_DISPONIBLE_EN_PRUEBA } from "@/lib/modo-prueba-reglas";
import { estadoPlantilla } from "@/lib/meta";
import { enmascararTelefono, normalizarTelefono } from "@/lib/negocio";
import { censurar } from "@/lib/sistema";
import { enviarPlantillaConVariables, enviarTexto, ErrorWhatsApp } from "@/lib/whatsapp";

// Un WhatsApp de prueba al móvil del dueño. No crea ningún cliente.
// - Con el botón de WhatsApp en la web (lo normal) no hace falta ningún mensaje aprobado: va un texto
//   normal, que Meta deja enviar si ese móvil ha escrito al número del negocio en las últimas 24 h; si
//   no, «Hello World», el mensaje de prueba que Meta trae en todas las cuentas.
// - Con el formulario, el primer WhatsApp que recibe un cliente: la bienvenida aprobada o, mientras
//   Meta no la aprueba, «Hello World».

export const dynamic = "force-dynamic";

const POR_MINUTO = 3;
const MINUTO_MS = 60_000;
const HOLA_MUNDO = { nombre: "hello_world", idioma: "en_US" };
const NOTA_HOLA_MUNDO = "Te llega «Hello World», el mensaje de prueba de Meta, en inglés. El tuyo saldrá cuando Meta lo apruebe.";
const NOTA_FUERA_DE_VENTANA =
  "Te llega «Hello World», el mensaje de prueba de Meta, en inglés: tu móvil no ha escrito al número del negocio en las últimas 24 h. Tus clientes no lo necesitan, porque te escriben ellos primero.";
const FUERA_DE_VENTANA = 131047;


function errorApi(status: number, error: string, extra: Omit<ErrorApi, "ok" | "error"> = {}): Response {
  return Response.json({ ok: false, error, ...extra } satisfies ErrorApi, { status });
}

function frase(e: ErrorExplicado): string {
  const titulo = e.titulo.endsWith(".") ? e.titulo : `${e.titulo}.`;
  return e.solucion ? `${titulo} ${e.solucion}` : titulo;
}

function metaConectada(): boolean {
  const e = (nombre: string) => !!process.env[nombre]?.trim();
  return e("WHATSAPP_TOKEN") && e("WHATSAPP_PHONE_NUMBER_ID") && e("WHATSAPP_BUSINESS_ACCOUNT_ID") && e("META_APP_SECRET");
}

/** Como mucho 3 por minuto en este proceso. */
function puedeEnviar(): boolean {
  const g = globalThis as unknown as { __whatsappPrueba?: number[] };
  const ahora = Date.now();
  const recientes = (g.__whatsappPrueba ?? []).filter((t) => ahora - t < MINUTO_MS);
  const puede = recientes.length < POR_MINUTO;
  if (puede) recientes.push(ahora);
  g.__whatsappPrueba = recientes;
  return puede;
}

function falloDeEnvio(error: unknown): Response {
  const e = error instanceof ErrorWhatsApp ? explicarMeta(error.codigo, censurar(error.message)) : explicar("red");
  logError("al enviar el WhatsApp de prueba", censurar(error instanceof Error ? error.message : String(error)));
  return errorApi(502, censurar(`No se ha enviado: ${frase(e)}`), { codigo: e.codigo });
}

/** Con el botón de WhatsApp: un texto normal y, fuera de las 24 h, «Hello World». Nunca la bienvenida. */
async function pruebaSinPlantilla(telefono: string, nombre: string, negocio: string, prefijo: string): Promise<Response> {
  const texto = `Hola ${nombre}, soy el asistente virtual de ${negocio}. Este es un WhatsApp de prueba: si me contestas, te respondo como a un cliente nuevo.`;
  try {
    await enviarTexto(telefono, texto);
    log(`WhatsApp de prueba enviado a ${enmascararTelefono(telefono, prefijo)} (texto)`);
    return Response.json({ ok: true, plantilla: "" });
  } catch (error) {
    if (!(error instanceof ErrorWhatsApp && error.codigo === FUERA_DE_VENTANA)) return falloDeEnvio(error);
  }
  try {
    await enviarPlantillaConVariables(telefono, { nombre: HOLA_MUNDO.nombre, idioma: HOLA_MUNDO.idioma, variables: [] });
  } catch (error) {
    return falloDeEnvio(error);
  }
  log(`WhatsApp de prueba enviado a ${enmascararTelefono(telefono, prefijo)} (${HOLA_MUNDO.nombre})`);
  return Response.json({ ok: true, plantilla: HOLA_MUNDO.nombre, nota: NOTA_FUERA_DE_VENTANA });
}

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => undefined)) as { telefono?: unknown; nombre?: unknown } | null | undefined;
  if (cuerpo === undefined || typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return errorApi(400, "No se ha entendido la petición");
  }
  const config = await configuracionParaPintar();
  const prefijo = config.regional.prefijo;
  const telefono = typeof cuerpo.telefono === "string" ? normalizarTelefono(cuerpo.telefono, prefijo) : null;
  if (!telefono) return errorApi(400, "Revisa el teléfono");
  const nombre = cuerpo.nombre === undefined || cuerpo.nombre === null ? "Prueba" : typeof cuerpo.nombre === "string" ? cuerpo.nombre.trim() : "";
  if (Array.from(nombre).length < 1 || Array.from(nombre).length > 40) return errorApi(400, "El nombre, de 1 a 40 letras");
  if (modoWhatsApp() === "prueba") return errorApi(409, `${NO_DISPONIBLE_EN_PRUEBA}: este envío es de WhatsApp oficial; en modo prueba, escríbele «Hola» al móvil vinculado`);
  if (!metaConectada()) return errorApi(409, "Primero conecta tu WhatsApp");
  if (!puedeEnviar()) return errorApi(429, "Espera un minuto antes de enviar otra prueba");

  const negocio = parametroSeguro(config.negocio.nombre) || config.perfil.nombre;
  if (config.web.entrada === "whatsapp") return pruebaSinPlantilla(telefono, nombre, negocio, prefijo);
  const bienvenida = config.plantilla;
  const estado = await estadoPlantilla(bienvenida.nombre, bienvenida.idioma);
  const aprobada = estado.estado === "APROBADA";
  const plantilla = aprobada ? bienvenida.nombre : HOLA_MUNDO.nombre;
  try {
    if (aprobada) {
      await enviarPlantillaConVariables(telefono, { nombre: bienvenida.nombre, idioma: bienvenida.idioma, variables: [nombre, negocio] });
    } else {
      await enviarPlantillaConVariables(telefono, { nombre: HOLA_MUNDO.nombre, idioma: HOLA_MUNDO.idioma, variables: [] });
    }
  } catch (error) {
    return falloDeEnvio(error);
  }
  log(`WhatsApp de prueba enviado a ${enmascararTelefono(telefono, prefijo)} (${plantilla})`);
  return Response.json(aprobada ? { ok: true, plantilla } : { ok: true, plantilla, nota: NOTA_HOLA_MUNDO });
}
