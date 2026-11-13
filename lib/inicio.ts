// Lo que enseña «Hoy», la primera pantalla del panel: quién te espera, las citas de hoy y mañana, lo
// pendiente y una línea con el mes. Todo sale de los leads y las reservas: nada aparte. Puro (I3).

import { fechaEn, momentoDeHueco, sumarDias, ZONA } from "./agenda";
import { asistenteCallado, esperaDesde, visitaSinCerrar, volvioAEscribir } from "./hilo";
import { esEjemplo } from "./negocio";
import type { Bd, Lead, Reserva, Tarea } from "./tipos";
import { frases as frasesPorDefecto, nombreDePila, type Frases } from "./vocabulario";

const MINUTO = 60_000;

/** El día de un instante en la zona: «2026-11-11». */
const fechaDe = (ts: number, zona: string) => fechaEn(new Date(ts), zona).fecha;

/**
 * Las cifras salen de los clientes de verdad en cuanto hay uno; mientras solo haya ejemplos, de los
 * ejemplos (y entonces la pantalla lo dice).
 */
export function baseDeCifras(bd: Bd): { leads: Lead[]; reservas: Reserva[]; ejemplo: boolean } {
  const todos = Object.values(bd.leads);
  const reales = todos.filter((l) => !esEjemplo(l));
  if (reales.length === 0) return { leads: todos, reservas: bd.reservas, ejemplo: true };
  const ids = new Set(reales.map((l) => l.id));
  return { leads: reales, reservas: bd.reservas.filter((r) => !r.prueba && ids.has(r.leadId)), ejemplo: false };
}

type Canal = "formulario" | "whatsapp" | "manual";

/** El canal por el que llegó: los `prueba` antiguos cuentan como formulario. */
function canalDe(lead: Lead): Canal {
  return lead.origen === "whatsapp" ? "whatsapp" : lead.origen === "manual" ? "manual" : "formulario";
}

/** Lo que tardó el primer WhatsApp (formulario y «+ Cliente») o la primera respuesta (WhatsApp). */
function medidaDe(lead: Lead): number | undefined {
  return canalDe(lead) === "whatsapp" ? lead.msPrimeraRespuesta : lead.msPrimerWhatsApp;
}

/** La llegada más reciente que tiene su tiempo medido: la cabecera de «Hoy». */
export function ultimaLlegada(
  bd: Bd,
): { leadId: string; nombre: string; canal: Canal; ms: number; ts: number; ejemplo: boolean } | null {
  let mejor: Lead | null = null;
  for (const lead of baseDeCifras(bd).leads) {
    if (medidaDe(lead) === undefined) continue;
    if (mejor === null || lead.creadoEn > mejor.creadoEn) mejor = lead;
  }
  if (mejor === null) return null;
  return {
    leadId: mejor.id,
    nombre: nombreDePila(mejor.nombre),
    canal: canalDe(mejor),
    ms: medidaDe(mejor) as number,
    ts: mejor.creadoEn,
    ejemplo: esEjemplo(mejor),
  };
}

export type MotivoTeToca = "pase" | "sinContestar" | "pausa" | "visitaPasada" | "volvio";

export interface FilaTeToca {
  leadId: string;
  nombre: string;
  motivo: MotivoTeToca;
  texto: string;
  desde: number;
  ejemplo: boolean;
}

/** «3 min», «2 h», «4 d»: redondeado como «hace…» en el resto del panel, y nunca menos de un minuto. */
export function duracion(ms: number): string {
  const minutos = Math.max(0, Math.round(ms / MINUTO));
  if (minutos < 60) return `${Math.max(1, minutos)} min`;
  if (minutos < 60 * 24) return `${Math.round(minutos / 60)} h`;
  return `${Math.round(minutos / (60 * 24))} d`;
}

/** Cuándo empezó a esperarte un cliente que está en «Te toca». */
function desdeDelPase(lead: Lead): number {
  let ultimoManual = -1;
  for (let i = lead.mensajes.length - 1; i >= 0; i--) {
    if (lead.mensajes[i].manual) {
      ultimoManual = i;
      break;
    }
  }
  if (ultimoManual < 0) return lead.cambioEstadoEn;
  const primero = lead.mensajes.slice(ultimoManual + 1).find((m) => m.de === "cliente");
  return primero ? Math.max(lead.cambioEstadoEn, primero.ts) : lead.cambioEstadoEn;
}

function filaDe(
  lead: Lead,
  ahora: number,
  pausadoEn: number | null,
  escribiendo: boolean,
  zona: string,
  f: Frases,
): Pick<FilaTeToca, "motivo" | "texto" | "desde"> | null {
  if (lead.estado === "spam") return null;

  if (!lead.cierre) {
    const callado = asistenteCallado(lead, ahora, escribiendo, pausadoEn);
    const espera = esperaDesde(lead);
    if (callado === "fallo" && espera !== null) {
      return { motivo: "sinContestar", texto: `Sin contestar · ${duracion(ahora - espera)}`, desde: espera };
    }
    if (callado === "pausa" && espera !== null) {
      return { motivo: "pausa", texto: "Asistente apagado · espera respuesta", desde: espera };
    }
    // «Te toca» significa que alguien te espera: si lo último del hilo lo has escrito tú, ese cliente
    // es tuyo pero no espera nada. Por eso el contador, el título de la pestaña y el sonido «turno»
    // solo cuentan el pase mientras el último mensaje no sea tuyo.
    if (lead.estado === "persona") {
      const ultimo = lead.mensajes[lead.mensajes.length - 1];
      if (!ultimo || !ultimo.manual) {
        return { motivo: "pase", texto: lead.motivoPersona?.trim() || "Te ha pedido hablar contigo", desde: desdeDelPase(lead) };
      }
    }
  }

  if (volvioAEscribir(lead)) {
    const desdeCierre = Math.max(lead.cierreEn ?? 0, lead.vueltaVistaEn ?? 0);
    const primero = lead.mensajes.find((m) => m.de === "cliente" && m.ts > desdeCierre);
    if (primero) return { motivo: "volvio", texto: `Ha vuelto a escribir · hace ${duracion(ahora - primero.ts)}`, desde: primero.ts };
  }

  if (!lead.cierre && lead.visita && visitaSinCerrar(lead, ahora, zona)) {
    return { motivo: "visitaPasada", texto: f.comoFue, desde: momentoDeHueco(lead.visita.id, zona) };
  }
  return null;
}

/**
 * Quién te espera, del que más lleva al que menos: «Te toca a ti» en Hoy, el contador de Clientes y
 * el título de la pestaña. Un cliente sale una vez, con el primer motivo que le toque.
 */
export function teToca(bd: Bd, ahora: Date, o?: { pausadoEn?: number | null; zona?: string; frases?: Frases }): FilaTeToca[] {
  const zona = o?.zona ?? ZONA;
  const f = o?.frases ?? frasesPorDefecto();
  const pausadoEn = o?.pausadoEn ?? bd.configuracion?.sistema.asistente.pausadoEn ?? null;
  const t = ahora.getTime();
  const filas: FilaTeToca[] = [];
  for (const lead of Object.values(bd.leads)) {
    const fila = filaDe(lead, t, pausadoEn, !!bd.escribiendo?.includes(lead.id), zona, f);
    if (fila) filas.push({ leadId: lead.id, nombre: lead.nombre, ejemplo: esEjemplo(lead), ...fila });
  }
  return filas.sort((a, b) => a.desde - b.desde);
}

/** Las citas que quedan hoy (desde ahora) y las de mañana, en orden. Los ejemplos también salen. */
export function citasHoyYManana(
  bd: Bd,
  ahora: Date,
  zona: string = ZONA,
): { dia: "hoy" | "manana"; hora: string; leadId: string; nombre: string; ejemplo: boolean }[] {
  const { fecha: hoy, hora } = fechaEn(ahora, zona);
  const manana = sumarDias(hoy, 1);
  const desde = `${hoy}T${hora}`;
  return bd.reservas
    .filter((r) => (r.huecoId.slice(0, 10) === hoy && r.huecoId >= desde) || r.huecoId.slice(0, 10) === manana)
    .sort((a, b) => a.huecoId.localeCompare(b.huecoId))
    .map((r) => {
      const lead = bd.leads[r.leadId];
      return {
        dia: r.huecoId.slice(0, 10) === hoy ? ("hoy" as const) : ("manana" as const),
        hora: r.huecoId.slice(11, 16),
        leadId: r.leadId,
        nombre: r.nombre,
        ejemplo: !!r.prueba || (lead !== undefined && esEjemplo(lead)),
      };
    });
}

/** Lo que vence hoy o ya ha vencido y no está hecho: primero lo atrasado. Sin fecha no es de «Hoy». */
export function pendientes(bd: Bd, ahora: Date, zona: string = ZONA): { leadId: string; nombre: string; tarea: Tarea; atrasada: boolean }[] {
  const hoy = fechaEn(ahora, zona).fecha;
  const filas = Object.values(bd.leads).flatMap((lead) =>
    (lead.tareas ?? [])
      .filter((t) => !t.hecha && !!t.vence && t.vence <= hoy)
      .map((tarea) => ({ leadId: lead.id, nombre: lead.nombre, tarea, atrasada: (tarea.vence as string) < hoy })),
  );
  return filas.sort(
    (a, b) => (a.tarea.vence as string).localeCompare(b.tarea.vence as string) || a.nombre.localeCompare(b.nombre, "es"),
  );
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

/** «Este mes»: el mes de calendario de `ahora` en la zona, sobre los clientes de verdad si los hay. */
export function resumenMes(
  bd: Bd,
  ahora: Date,
  zona: string = ZONA,
): { ejemplo: boolean; nuevos: number; conCita: number; si: number; importeSi: number; conversion: number | null; medianaPrimerWhatsAppMs: number | null } {
  const base = baseDeCifras(bd);
  const mes = fechaEn(ahora, zona).fecha.slice(0, 7);
  const delMes = (ts: number | undefined) => ts !== undefined && fechaDe(ts, zona).slice(0, 7) === mes;
  const nuevos = base.leads.filter((l) => l.estado !== "spam" && delMes(l.creadoEn));
  const cerrados = base.leads.filter((l) => l.cierre && delMes(l.cierreEn));
  const conSi = cerrados.filter((l) => l.cierre === "si");
  const medidas = nuevos.flatMap((l) => {
    const ms = medidaDe(l);
    return ms === undefined ? [] : [ms];
  });
  return {
    ejemplo: base.ejemplo,
    nuevos: nuevos.length,
    conCita: nuevos.filter((l) => l.visita).length,
    si: conSi.length,
    importeSi: conSi.reduce((total, l) => total + (l.presupuesto ?? 0), 0),
    conversion: cerrados.length ? Math.round((100 * conSi.length) / cerrados.length) : null,
    medianaPrimerWhatsAppMs: mediana(medidas),
  };
}

/** Las citas de hoy, todas (también las que ya han pasado y los ejemplos): el contador de Agenda. */
export function citasDeHoy(bd: Bd, ahora: Date, zona: string = ZONA): number {
  const hoy = fechaEn(ahora, zona).fecha;
  return bd.reservas.filter((r) => r.huecoId.slice(0, 10) === hoy).length;
}
