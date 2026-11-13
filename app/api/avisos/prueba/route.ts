import type { ErrorApi } from "@/lib/api-tipos";
import { telefonoComercial } from "@/lib/configuracion";
import { configuracionParaPintar } from "@/lib/configuracion-servidor";
import { aDondeAvisaElModoPrueba, enviarAviso, textoAviso } from "@/lib/aviso";
import { explicar, explicarMeta, type ErrorExplicado } from "@/lib/errores";
import { log, logError } from "@/lib/log";
import { estadoPlantilla } from "@/lib/meta";
import { modoWhatsApp } from "@/lib/modo-prueba";
import { crearLead, enmascararTelefono, formatoTelefono } from "@/lib/negocio";
import { censurar } from "@/lib/sistema";
import { enviarPlantillaConVariables, ErrorWhatsApp } from "@/lib/whatsapp";

// Un aviso de ejemplo a tu móvil, como el que te llega cuando te toca a ti. El cliente de la muestra
// lleva tu propio número: así «Llámale» nunca enseña un número inventado que pueda ser de alguien.
// No se guarda nada.

export const dynamic = "force-dynamic";

const POR_MINUTO = 3;
const MINUTO_MS = 60_000;
const MOTIVO = "Aviso de prueba";
const NOMBRE = "Cliente de prueba";
const SIN_VENTANA = "Para que te lleguen los avisos, escribe «hola» al número del negocio una vez al día. Luego vuelve a probar.";

function errorApi(status: number, error: string, extra: Omit<ErrorApi, "ok" | "error"> = {}): Response {
  return Response.json({ ok: false, error, ...extra } satisfies ErrorApi, { status });
}

function frase(e: ErrorExplicado): string {
  const titulo = e.titulo.endsWith(".") ? e.titulo : `${e.titulo}.`;
  return e.solucion ? `${titulo} ${e.solucion}` : titulo;
}

/** Como mucho 3 por minuto en este proceso. */
function puedeEnviar(): boolean {
  const g = globalThis as unknown as { __avisoPrueba?: number[] };
  const ahora = Date.now();
  const recientes = (g.__avisoPrueba ?? []).filter((t) => ahora - t < MINUTO_MS);
  const puede = recientes.length < POR_MINUTO;
  if (puede) recientes.push(ahora);
  g.__avisoPrueba = recientes;
  return puede;
}

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => undefined)) as unknown;
  if (cuerpo === undefined || typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return errorApi(400, "No se ha entendido la petición");
  }
  const config = await configuracionParaPintar();
  const prefijo = config.regional.prefijo;
  const telefono = telefonoComercial(config.sistema, process.env.TELEFONO_COMERCIAL, prefijo);
  if (!telefono) return errorApi(409, "Pon antes tu móvil");
  const prueba = modoWhatsApp() === "prueba";
  if (prueba && !aDondeAvisaElModoPrueba(telefono)) {
    return errorApi(409, "Modo prueba: los avisos solo llegan a un número de la lista de números permitidos. Añádelo en Ajustes → Conexiones.");
  }
  if (!puedeEnviar()) return errorApi(429, "Espera un minuto antes de enviar otra prueba");

  const muestra = crearLead({ telefono, perfilId: config.perfil.id, perfilNombre: config.negocio.nombre, nombre: NOMBRE, origen: "whatsapp" });
  const texto = textoAviso(muestra, MOTIVO, "Quiero hablar con una persona", {
    detalle: config.sistema.avisos.comercial.detalle,
    campos: config.campos,
    prefijo,
  });
  const enviado = await enviarAviso(telefono, texto);
  if (enviado.ok) {
    log(`Aviso de prueba enviado a ${enmascararTelefono(telefono, prefijo)} (texto)`);
    return Response.json({ ok: true, como: "texto" });
  }
  if (!enviado.fueraDeVentana || prueba) {
    // El texto del error puede traer pistas para la terminal: a la pantalla va la explicación.
    logError("al enviar el aviso de prueba", censurar(enviado.error));
    return errorApi(502, `No se ha enviado: ${frase(explicar("meta.otro"))}`, { codigo: "meta.otro" });
  }
  const estado = await estadoPlantilla("aviso_comercial", "es_ES");
  if (estado.estado !== "APROBADA") return errorApi(409, SIN_VENTANA);
  try {
    await enviarPlantillaConVariables(telefono, {
      nombre: "aviso_comercial",
      idioma: "es_ES",
      variables: [NOMBRE, MOTIVO, formatoTelefono(telefono, prefijo)],
    });
  } catch (error) {
    const e = error instanceof ErrorWhatsApp ? explicarMeta(error.codigo, censurar(error.message)) : explicar("red");
    logError("al enviar el aviso de prueba", censurar(error instanceof Error ? error.message : String(error)));
    return errorApi(502, censurar(`No se ha enviado: ${frase(e)}`), { codigo: e.codigo });
  }
  log(`Aviso de prueba enviado a ${enmascararTelefono(telefono, prefijo)} (plantilla)`);
  return Response.json({ ok: true, como: "plantilla" });
}
