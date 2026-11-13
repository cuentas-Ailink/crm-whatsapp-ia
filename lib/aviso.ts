import { telefonoComercial, type ConfiguracionResuelta } from "./configuracion";
import { configuracionActiva } from "./configuracion-servidor";
import { log, logAviso, logError, recortar } from "./log";
import { estadoPlantilla } from "./meta";
import { leerModoPrueba, modoWhatsApp } from "./modo-prueba";
import { estaPermitido } from "./modo-prueba-reglas";
import { PLANTILLA_AVISO } from "./plantillas";
import { enmascararTelefono, formatoTelefono } from "./regional";
import type { Lead } from "./tipos";
import { resumenDatos, type CampoLead } from "./vocabulario";
import { ErrorWhatsApp, enviarPlantillaConVariables, enviarTexto } from "./whatsapp";

// Cuando el asistente pasa una conversación a una persona, avisa al dueño por WhatsApp, desde el
// mismo número del negocio. Es opcional: sin móvil para los avisos, el aviso se queda en el panel y
// en la terminal.

const FUERA_DE_VENTANA = 131047;

/**
 * El texto que recibe el dueño en su móvil. Lleva el teléfono entero: es para llamarle.
 * Con detalle «minimo», solo las dos primeras líneas.
 */
export function textoAviso(
  lead: Lead,
  motivo: string,
  ultimoMensaje: string,
  o?: { detalle?: "completo" | "minimo"; campos?: CampoLead[]; prefijo?: string },
): string {
  const telefono = formatoTelefono(lead.telefono, o?.prefijo);
  const lineas = [`🔔 Te toca: ${lead.nombre} · ${motivo}`, `Llámale: ${telefono}`];
  if (o?.detalle === "minimo") return lineas.join("\n");
  // Sin datos, resumenDatos pone «Pidió información»: eso no es lo que quiere, así que no hay línea.
  if (Object.keys(lead.datos ?? {}).length > 0) {
    const quiere = resumenDatos(lead, o?.campos);
    if (quiere) lineas.push(`Quiere: ${quiere}`);
  }
  const ultimo = recortar(ultimoMensaje ?? "", 160);
  if (ultimo) lineas.push(`Último mensaje: «${ultimo}»`);
  lineas.push("", "Tu asistente ya no le contesta. Contéstale desde el panel del ordenador o llámale.");
  return lineas.join("\n");
}

/** En el modo prueba, el aviso solo sale si el móvil de los avisos está en la lista de números permitidos. */
export function aDondeAvisaElModoPrueba(telefono: string): boolean {
  return estaPermitido(telefono, leerModoPrueba()?.permitidos ?? []);
}

/** Manda un aviso por WhatsApp. Nunca lanza: dice si ha ido bien y, si no, si es por la ventana de 24 h. */
export async function enviarAviso(
  telefono: string,
  texto: string,
): Promise<{ ok: true } | { ok: false; fueraDeVentana: boolean; error: string }> {
  try {
    await enviarTexto(telefono, texto);
    return { ok: true };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    const fueraDeVentana = error instanceof ErrorWhatsApp && error.codigo === FUERA_DE_VENTANA;
    return { ok: false, fueraDeVentana, error: mensaje };
  }
}

/**
 * Avisa al dueño de que le toca un cliente. Nunca lanza. Si han pasado más de 24 h desde que el
 * dueño escribió al número del negocio, WhatsApp no deja mandarle texto libre: entonces va con el
 * mensaje aprobado «aviso_comercial», si Meta ya lo ha aprobado.
 */
export async function avisarComercial(lead: Lead, motivo: string, ultimoMensaje: string, config?: ConfiguracionResuelta): Promise<void> {
  try {
    const cfg = config ?? (await configuracionActiva()).config;
    const prefijo = cfg.regional.prefijo;
    const telefono = telefonoComercial(cfg.sistema, process.env.TELEFONO_COMERCIAL, prefijo);
    if (!telefono) return;
    const enmascarado = enmascararTelefono(telefono, prefijo);
    const texto = textoAviso(lead, motivo, ultimoMensaje, { detalle: cfg.sistema.avisos.comercial.detalle, campos: cfg.campos, prefijo });
    if (modoWhatsApp() === "prueba") {
      // Modo prueba: un mensaje normal desde el móvil vinculado, solo a un número de la lista. Sin mensaje aprobado.
      if (!aDondeAvisaElModoPrueba(telefono)) {
        logAviso("Modo prueba: el aviso no sale porque tu móvil de los avisos no está en la lista de números permitidos");
        return;
      }
      const enPrueba = await enviarAviso(telefono, texto);
      if (enPrueba.ok) log(`Aviso enviado por WhatsApp en modo prueba (${enmascarado})`);
      else logError("al avisarte por WhatsApp en modo prueba", enPrueba.error);
      return;
    }
    const resultado = await enviarAviso(telefono, texto);
    if (resultado.ok) {
      log(`Aviso enviado por WhatsApp (${enmascarado})`);
      return;
    }
    if (!resultado.fueraDeVentana) {
      logError("al avisarte por WhatsApp", resultado.error);
      return;
    }
    const estado = await estadoPlantilla(PLANTILLA_AVISO.nombre, PLANTILLA_AVISO.idioma);
    if (estado.estado !== "APROBADA") {
      logAviso(
        "No se ha podido avisarte por WhatsApp: han pasado más de 24 h desde que escribiste al número del negocio. Escribe «hola» a ese número una vez al día o envía a Meta el aviso desde Ajustes → Conexiones.",
      );
      return;
    }
    await enviarPlantillaConVariables(telefono, {
      nombre: PLANTILLA_AVISO.nombre,
      idioma: PLANTILLA_AVISO.idioma,
      variables: [lead.nombre, motivo, formatoTelefono(lead.telefono, prefijo)],
    });
    log(`Aviso enviado con el mensaje aprobado «${PLANTILLA_AVISO.nombre}» (${enmascarado})`);
  } catch (error) {
    logError("al avisarte por WhatsApp", error);
  }
}
