// Lo que se lee del hilo de un cliente: quién habló el último, si espera respuesta y la ventana de
// 24 h de WhatsApp. Puro.

import { fechaEn, momentoDeHueco, sumarDias, textoDia } from "./agenda";
import type { Lead, Mensaje } from "./tipos";

export function ultimoMensaje(lead: Pick<Lead, "mensajes">): Mensaje | undefined {
  return lead.mensajes[lead.mensajes.length - 1];
}

/** Los mensajes del cliente después del último del asistente (todos, si no hay ninguno del asistente). */
export function sinResponder(lead: Pick<Lead, "mensajes">): number {
  let n = 0;
  for (let i = lead.mensajes.length - 1; i >= 0; i--) {
    if (lead.mensajes[i].de === "agente") break;
    n++;
  }
  return n;
}

/** El instante del primer mensaje del cliente que sigue sin respuesta. */
export function esperaDesde(lead: Pick<Lead, "mensajes">): number | null {
  const n = sinResponder(lead);
  if (n === 0) return null;
  return lead.mensajes[lead.mensajes.length - n].ts;
}

export const MS_SIN_CONTESTAR = 120_000;

/** Si el asistente debería haber contestado y no lo ha hecho: por un fallo o porque está en pausa. */
export function asistenteCallado(lead: Lead, ahora: number, escribiendo: boolean, pausadoEn: number | null): "fallo" | "pausa" | null {
  if (lead.ejemplo || lead.origen === "prueba" || lead.cierre || lead.silenciadoEn || escribiendo) return null;
  if (lead.estado !== "nuevo" && lead.estado !== "conversacion" && lead.estado !== "visita") return null;
  const desde = esperaDesde(lead);
  if (desde === null || !(ahora - desde > MS_SIN_CONTESTAR)) return null;
  return pausadoEn !== null ? "pausa" : "fallo";
}

/** Tiene una cita que ya ha pasado y el dueño aún no ha dicho cómo fue. */
export function visitaSinCerrar(lead: Lead, ahora: number, zona?: string): boolean {
  return !lead.cierre && !!lead.visita && momentoDeHueco(lead.visita.id, zona) < ahora;
}

/** Cerrado, pero el cliente ha escrito después del cierre y de la última vez que el dueño lo vio. */
export function volvioAEscribir(lead: Lead): boolean {
  if (!lead.cierre) return false;
  const desde = Math.max(lead.cierreEn ?? 0, lead.vueltaVistaEn ?? 0);
  return lead.mensajes.some((m) => m.de === "cliente" && m.ts > desde);
}

/** La ventana de 24 h de WhatsApp desde el último mensaje del cliente. */
export function ventana24h(lead: Pick<Lead, "mensajes">, ahora: number): { abierta: boolean; hasta: number | null } {
  const delCliente = lead.mensajes.filter((m) => m.de === "cliente");
  if (delCliente.length === 0) return { abierta: false, hasta: null };
  const hasta = Math.max(...delCliente.map((m) => m.ts)) + 86_400_000;
  return { abierta: ahora < hasta, hasta };
}

// ---- El hilo pintado: días, grupos y la ventana (fase 3) ----

/** Mensajes seguidos del mismo remitente a menos de esto se pintan juntos, como en WhatsApp. */
export const MS_GRUPO = 120_000;

export type TipoRemitente = "cliente" | "asistente" | "manual" | "bienvenida" | "aprobado";
export interface Grupo { tipo: TipoRemitente; remitente: string; mensajes: Mensaje[] }
export type ItemHilo = { tipo: "dia"; texto: string } | { tipo: "grupo"; grupo: Grupo };

const REMITENTES: Record<Exclude<TipoRemitente, "cliente">, string> = {
  asistente: "Tu asistente",
  manual: "Tú",
  bienvenida: "Mensaje de bienvenida",
  aprobado: "Mensaje aprobado",
};

/**
 * Quién firma un mensaje. Una plantilla sin nombre es de antes de guardarlo: entonces solo se
 * mandaba la bienvenida, así que cuenta como tal.
 */
export function tipoRemitente(m: Mensaje, bienvenidas: readonly string[]): TipoRemitente {
  if (m.de === "cliente") return "cliente";
  if (m.plantilla) return !m.nombrePlantilla || bienvenidas.includes(m.nombrePlantilla) ? "bienvenida" : "aprobado";
  if (m.manual) return "manual";
  return "asistente";
}

/** «Hoy», «Ayer», «lunes 9 nov» o, en otro año, «lunes 9 nov 2025». */
function textoSeparador(fecha: string, hoy: string): string {
  if (fecha === hoy) return "Hoy";
  if (fecha === sumarDias(hoy, -1)) return "Ayer";
  const ano = fecha.slice(0, 4);
  return ano === hoy.slice(0, 4) ? textoDia(fecha) : `${textoDia(fecha)} ${ano}`;
}

/**
 * El hilo listo para pintar: un separador antes del primer mensaje de cada día (en la zona del
 * negocio) y los mensajes en grupos. Un grupo se corta al cambiar de remitente, al pasar más de
 * MS_GRUPO desde el anterior o al cambiar de día; una plantilla va siempre sola.
 */
export function agruparMensajes(
  m: Mensaje[],
  o: { zona: string; ahora: number; nombreCliente: string; bienvenidas: readonly string[] },
): ItemHilo[] {
  const hoy = fechaEn(new Date(o.ahora), o.zona).fecha;
  const orden = [...m].sort((a, b) => a.ts - b.ts);
  const items: ItemHilo[] = [];
  let dia: string | null = null;
  let grupo: Grupo | null = null;
  let anterior: Mensaje | null = null;
  for (const mensaje of orden) {
    const fecha = fechaEn(new Date(mensaje.ts), o.zona).fecha;
    if (fecha !== dia) {
      items.push({ tipo: "dia", texto: textoSeparador(fecha, hoy) });
      dia = fecha;
      grupo = null;
    }
    const tipo = tipoRemitente(mensaje, o.bienvenidas);
    const plantilla = tipo === "bienvenida" || tipo === "aprobado";
    if (!grupo || !anterior || grupo.tipo !== tipo || plantilla || mensaje.ts - anterior.ts > MS_GRUPO) {
      grupo = { tipo, remitente: tipo === "cliente" ? o.nombreCliente : REMITENTES[tipo], mensajes: [mensaje] };
      items.push({ tipo: "grupo", grupo });
    } else {
      grupo.mensajes.push(mensaje);
    }
    anterior = mensaje;
  }
  return items;
}

/** «Puedes escribirle hasta las 18:40» o «… hasta mañana a las 18:40», en la zona del negocio. Cerrada, null. */
export function textoVentana(v: { abierta: boolean; hasta: number | null }, ahora: number, zona?: string): string | null {
  if (!v.abierta || v.hasta === null) return null;
  const { fecha, hora } = fechaEn(new Date(v.hasta), zona);
  const hoy = fechaEn(new Date(ahora), zona).fecha;
  if (fecha === hoy) return `Puedes escribirle hasta las ${hora}`;
  if (fecha === sumarDias(hoy, 1)) return `Puedes escribirle hasta mañana a las ${hora}`;
  // La ventana dura 24 h desde un mensaje que ya ha llegado: no pasa de mañana. Por si el reloj miente.
  return `Puedes escribirle hasta el ${textoDia(fecha)} a las ${hora}`;
}
