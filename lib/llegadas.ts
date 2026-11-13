// El cronómetro de la llegada de un cliente, como máquina de estados. Puro y determinista: ni
// Date.now() ni azar. Lo usan el tablero, la cabecera de Hoy y la puesta en marcha (cliente/llegada.tsx).
//
// Reloj: `inicio` y `fin` de cada EstadoLlegada van en el reloj del NAVEGADOR. El servidor manda
// `llegada.inicio` con su reloj; al recibirla se resta `desfaseMs` (servidor − navegador, el de
// desfaseServidor() de cliente/datos.ts), así el cronómetro corre contra Date.now() sin saltos.

import type { EstadoLlegada, EventoPanel } from "./api-tipos";
import type { Lead } from "./tipos";

/** Aplica un evento del panel. `cambio` y `hora` devuelven el mismo objeto. */
export function aplicarEventoLlegada(
  estado: Record<string, EstadoLlegada>,
  e: EventoPanel,
  desfaseMs: number,
): Record<string, EstadoLlegada> {
  if (e.tipo === "llegada") {
    const { leadId, nombre, canal, inicio } = e.llegada;
    return { ...estado, [leadId]: { leadId, nombre, canal, inicio: inicio - desfaseMs, fin: null, fallo: null, enDirecto: true } };
  }
  if (e.tipo === "llegada-fallida") {
    const { leadId, nombre, codigo, texto } = e.fallo;
    const previa = estado[leadId];
    const siguiente: EstadoLlegada = previa
      ? { ...previa, fallo: { codigo, texto } }
      : { leadId, nombre, canal: "formulario", inicio: 0, fin: null, fallo: { codigo, texto }, enDirecto: false };
    return { ...estado, [leadId]: siguiente };
  }
  return estado;
}

/** La medida que cierra el cronómetro de cada canal, si el lead ya la tiene. */
export function medidaDe(canal: EstadoLlegada["canal"], lead: Lead): number | undefined {
  const ms = canal === "whatsapp" ? lead.msPrimeraRespuesta : lead.msPrimerWhatsApp;
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/**
 * Para cada llegada en marcha (sin `fin` ni fallo) cuyo lead ya enseña su medida, `fin = inicio + ms`:
 * `msPrimerWhatsApp` en formulario y a mano, `msPrimeraRespuesta` en WhatsApp. Sin cambios, el mismo objeto.
 */
export function cerrarConLeads(estado: Record<string, EstadoLlegada>, leads: Record<string, Lead>): Record<string, EstadoLlegada> {
  let siguiente: Record<string, EstadoLlegada> | null = null;
  for (const [id, entrada] of Object.entries(estado)) {
    if (entrada.fin !== null || entrada.fallo !== null) continue;
    const lead = leads[entrada.leadId];
    if (!lead) continue;
    const ms = medidaDe(entrada.canal, lead);
    if (ms === undefined) continue;
    siguiente ??= { ...estado };
    siguiente[id] = { ...entrada, fin: entrada.inicio + ms };
  }
  return siguiente ?? estado;
}
