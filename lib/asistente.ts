// Si el asistente contesta o no, y por qué. Puro: lo usan el servidor, la prueba del asistente y el panel.

import type { ConfiguracionSistema } from "./configuracion"; // type-only
import { pideBaja, pideBorrarDatos } from "./guion";
import { esEjemplo } from "./negocio";
import type { Lead } from "./tipos";
import { normalizar } from "./vocabulario";

export type MotivoSilencio = "persona" | "spam" | "silencio" | "pausa";

/**
 * Por qué el asistente no contesta a este cliente, o null si contesta. En este orden: lo lleva una
 * persona, es publicidad, pidió que no le escriban, o el asistente está apagado. Un cliente
 * cerrado que vuelve a escribir se atiende como siempre: el cierre no es un motivo.
 */
export function porQueNoContesta(
  lead: Pick<Lead, "estado" | "silenciadoEn">,
  sistema: Pick<ConfiguracionSistema, "asistente">,
): MotivoSilencio | null {
  if (lead.estado === "persona") return "persona";
  if (lead.estado === "spam") return "spam";
  if (lead.silenciadoEn) return "silencio";
  if (!sistema.asistente.activo) return "pausa";
  return null;
}

/**
 * La regla de publicidad solo mira a quien nadie ha avalado: no a quien llegó por el formulario, ni
 * a quien añadió el dueño a mano («+ Cliente»), ni a quien ya tiene cita.
 */
export function aplicaReglaSpam(lead: Pick<Lead, "origen" | "estado">): boolean {
  return lead.origen !== "formulario" && lead.origen !== "manual" && lead.estado !== "visita";
}

const ESPERAN: ReadonlySet<Lead["estado"]> = new Set(["nuevo", "conversacion", "visita"]);

/** Cuántos clientes han escrito desde que se apagó el asistente y esperan respuesta. */
export function esperanRespuesta(leads: Lead[], pausadoEn: number | null): number {
  if (pausadoEn === null) return 0;
  return leads.filter((lead) => {
    if (esEjemplo(lead) || lead.silenciadoEn || !ESPERAN.has(lead.estado)) return false;
    const ultimo = lead.mensajes[lead.mensajes.length - 1];
    return ultimo !== undefined && ultimo.de === "cliente" && ultimo.ts >= pausadoEn;
  }).length;
}

/** Palabras que escribe casi todo el mundo: una regla de pase con ellas pasaría casi todo a una persona. */
export const PALABRAS_COMUNES: readonly string[] = ["hola", "precio", "cita", "visita", "información", "presupuesto", "gracias"];
const COMUNES = new Set(PALABRAS_COMUNES.map(normalizar));

/** Palabras sueltas de un texto, sin mayúsculas, acentos, puntuación ni emojis. */
function palabras(texto: string): string[] {
  return normalizar(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Si la frase lleva alguna palabra que escribe casi todo el mundo («precio», «hola»…). */
export function palabraDemasiadoComun(frase: string): boolean {
  return palabras(frase).some((p) => COMUNES.has(p));
}

/** Las palabras de una despedida o un agradecimiento, sin acentos. */
export const CIERRES: readonly string[] = [
  "ok", "okay", "oki", "vale", "gracias", "muchas", "mil", "perfecto", "de", "acuerdo", "entendido", "genial", "igualmente",
  "adios", "hasta", "luego", "pronto", "manana", "un", "saludo", "saludos", "buenas", "buenos", "noches", "tardes", "dias",
  "bien", "nada", "si", "claro", "venga", "va", "a", "ti", "vosotros", "y", "pues", "eh",
];
const CIERRE = new Set(CIERRES);

/** Si el texto solo cierra la conversación («gracias», «Ok 👍», «Perfecto, hasta luego»), o está vacío. */
export function esCierre(texto: string): boolean {
  return normalizar(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .every((p) => CIERRE.has(p));
}

/**
 * Si un mensaje nuevo levanta el silencio de quien pidió que no le escribieran: sí si escribe algo
 * de verdad; no si vuelve a pedir la baja, pide que borren sus datos o solo se despide.
 */
export function levantaSilencio(lead: Pick<Lead, "silenciadoEn">, textoNuevo: string): boolean {
  return !!lead.silenciadoEn && !pideBaja(textoNuevo) && !pideBorrarDatos(textoNuevo) && !esCierre(textoNuevo);
}
