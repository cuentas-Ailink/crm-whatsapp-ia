// Las citas que da el dueño a mano desde la ficha: si un hueco se puede dar (las mismas reglas y los
// mismos huecos libres que usa el asistente) y el WhatsApp que confirma la cita al cliente. Puro: lo
// usan la ruta y el selector del navegador.

import { huecosLibres, momentoDeHueco, sumarDias, textoDia } from "./agenda";
import type { Hueco, Lead, ReglasAgenda, Reserva } from "./tipos";
import { formas, nombreDePila, type Vocabulario } from "./vocabulario";

const ID_HUECO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Si se le puede dar (o cambiar a) ese hueco. En este orden: un id mal formado, el mismo hueco que ya
 * tiene, un hueco pasado, uno de otro cliente y uno fuera del horario (días, horas, fechas cerradas,
 * antelación y días a la vista). Su propia cita nunca le bloquea.
 */
export function revisarCita(
  accion: "dar" | "cambiar",
  huecoId: string,
  lead: Lead,
  reservas: Reserva[],
  ahora: Date,
  reglas: ReglasAgenda,
): { hueco: Hueco } | { error: string } {
  if (typeof huecoId !== "string" || !ID_HUECO.test(huecoId)) return { error: "Elige un hueco" };
  if (accion === "cambiar" && lead.visita?.id === huecoId) return { error: "Elige un hueco distinto del que ya tiene" };
  // Una fecha que no existe (2026-02-30) da NaN: no es pasada y acaba «fuera de tu horario».
  if (momentoDeHueco(huecoId, reglas.zona) <= ahora.getTime()) return { error: "Ese hueco ya ha pasado" };
  const otras = reservas.filter((r) => r.leadId !== lead.id);
  if (otras.some((r) => r.huecoId === huecoId)) return { error: "Ese hueco ya está ocupado" };
  const hueco = huecosLibres(otras, ahora, reglas, reglas.diasVista * reglas.horas.length).find((h) => h.id === huecoId);
  if (!hueco) return { error: "Ese hueco está fuera de tu horario" };
  return { hueco };
}

/**
 * El WhatsApp que confirma la cita: «Hola Laura, te confirmo la visita el martes 3 nov a las 10:00. Si
 * necesitas cambiarla, escríbenos por aquí.». No promete nada más sobre lo que vendrá (ni avisos ni llamadas).
 * Un nombre sin letras (el teléfono enmascarado de quien no tiene nombre) no se usa: «Hola, …».
 */
export function textoCitaParaCliente(hueco: Hueco, o: { vocabulario: Vocabulario; nombre: string; trato: "tu" | "usted" }): string {
  const cita = o.vocabulario.cita;
  const f = formas(cita);
  const nombre = nombreDePila(o.nombre);
  const saludo = /\p{L}/u.test(nombre) ? `Hola ${nombre}` : "Hola";
  return o.trato === "usted"
    ? `${saludo}, le confirmo ${f.el} ${cita.singular} el ${hueco.texto}. Si necesita cambiar${f.lo}, escríbanos por aquí.`
    : `${saludo}, te confirmo ${f.el} ${cita.singular} el ${hueco.texto}. Si necesitas cambiar${f.lo}, escríbenos por aquí.`;
}

/** La cabecera de un día en el selector: «Hoy · martes 11 nov», «Mañana · miércoles 12 nov» o «jueves 13 nov». */
export function etiquetaDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return `Hoy · ${textoDia(fecha)}`;
  if (fecha === sumarDias(hoy, 1)) return `Mañana · ${textoDia(fecha)}`;
  return textoDia(fecha);
}
