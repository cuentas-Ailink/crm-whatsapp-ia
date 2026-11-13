// Ayudas de la página de Ajustes. Puro: lo usa el navegador y lo prueba vitest.

import { verHuecos } from "./agenda";
import type { ReglaPase, ReglasAgente } from "./configuracion";
import { seccionDe } from "./guion";
import type { ReglasAgenda, Reserva } from "./tipos";
import { normalizar } from "./vocabulario";

/** El color «Clásico»: se guarda explícito, porque null en un cambio borra lo guardado y volvería el del tipo de negocio. */
const VERDE_CLASICO = "#2f9e6e";
const SECCION_INFORMACION = "Información que puedes dar tal cual";
const PREFIJO_VISTA_PREVIA = "Si alguien pidiera cita ahora, le ofrecería: ";

/** Las frases de la lista «Pásamelo siempre si escribe…»: la regla con motivo "" (si hay varias, todas en orden y sin repetir). */
export function listaPaseSiempre(agente: ReglasAgente): string[] {
  const frases: string[] = [];
  const vistas = new Set<string>();
  for (const regla of agente.pasarSiempre ?? []) {
    if (regla.motivo !== "") continue;
    for (const frase of regla.frases ?? []) {
      const clave = normalizar(frase);
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      frases.push(frase);
    }
  }
  return frases;
}

/**
 * Las reglas con la lista nueva: las demás, intactas y en su sitio; la de motivo "" se sustituye donde
 * estaba (con su respuesta, si la tenía), se añade al final si no existía y se quita si se queda vacía.
 */
export function conListaPaseSiempre(agente: ReglasAgente, frases: string[]): ReglaPase[] {
  const limpias: string[] = [];
  const vistas = new Set<string>();
  for (const frase of frases) {
    const t = frase.trim();
    const clave = normalizar(t);
    if (!t || vistas.has(clave)) continue;
    vistas.add(clave);
    limpias.push(t);
  }

  const reglas = agente.pasarSiempre ?? [];
  const resultado: ReglaPase[] = [];
  let puesta = false;
  for (const regla of reglas) {
    if (regla.motivo !== "") {
      resultado.push(regla);
      continue;
    }
    // Solo la primera regla sin motivo se queda (con la lista entera); las demás se funden en ella.
    if (puesta || limpias.length === 0) continue;
    puesta = true;
    resultado.push(regla.respuesta !== undefined ? { motivo: "", frases: limpias, respuesta: regla.respuesta } : { motivo: "", frases: limpias });
  }
  if (!puesta && limpias.length > 0) resultado.push({ motivo: "", frases: limpias });
  return resultado;
}

/** «Si alguien pidiera cita ahora, le ofrecería: {A} o {B}», con los huecos de verdad que daría el asistente. */
export function vistaPreviaHuecos(reservas: Reserva[], ahora: Date, reglas: ReglasAgenda): string {
  let huecos: { texto: string }[] = [];
  try {
    huecos = verHuecos(reservas, ahora, reglas);
  } catch {
    huecos = [];
  }
  if (huecos.length === 0) return "Con este horario no hay huecos en las próximas semanas";
  if (huecos.length === 1) return `${PREFIJO_VISTA_PREVIA}${huecos[0].texto}`;
  return `${PREFIJO_VISTA_PREVIA}${huecos[0].texto} o ${huecos[1].texto}`;
}

/** El cuerpo de «## Información que puedes dar tal cual» (sin mayúsculas ni acentos en el título), o "". */
export function informacionDe(instrucciones: string): string {
  return seccionDe(String(instrucciones ?? "").replace(/\r\n/g, "\n"), SECCION_INFORMACION);
}

/** Semanas a días abiertos por delante (lo que guarda `diasVista`), entre 1 y 365. */
export function semanasADias(semanas: number, diasAbiertos: number[]): number {
  const dias = Math.round(semanas) * Math.max(1, diasAbiertos.length);
  if (!Number.isFinite(dias)) return 1;
  return Math.min(365, Math.max(1, dias));
}

/** Días abiertos por delante a semanas, como mínimo 1. */
export function diasASemanas(diasVista: number, diasAbiertos: number[]): number {
  const semanas = Math.round(diasVista / Math.max(1, diasAbiertos.length));
  return Number.isFinite(semanas) ? Math.max(1, semanas) : 1;
}

/** El color que se guarda al elegir una muestra: «Clásico» (null) va explícito como el verde. */
export function colorAGuardar(elegido: string | null): string {
  return elegido ?? VERDE_CLASICO;
}

/** La muestra activa: null y el verde clásico son la misma, «Clásico». */
export function muestraActiva(resuelto: string | null): string | null {
  if (resuelto === null || resuelto.toLowerCase() === VERDE_CLASICO) return null;
  return resuelto;
}
