// Tipos de los contactos de ejemplo. Solo se añaden campos: lo usan los generadores de cada sector.
// Lo marcado con [W3] es opcional: un guion que no lo trae lo completa el motor (lib/semilla.ts) con
// su generador con semilla, así que los datos de W0 siguen valiendo tal cual.

import type { SectorId, SectorPreset } from "../configuracion";
import type { Moneda } from "../regional";
import type { EstadoLead, Lead, MotivoNoSigue, ReglasAgenda, Reserva } from "../tipos";
import type { CampoLead, Vocabulario } from "../vocabulario";

export interface OpcionesSemilla { sector: SectorId; base: SectorPreset; negocio: string; plantilla: string /* cuerpo */; reglas: ReglasAgenda; vocabulario: Vocabulario; campos: CampoLead[]; moneda: Moneda; servicios?: string[]; ocupados?: string[] }
export interface SemillaGenerada { leads: Record<string, Lead>; reservas: Reserva[] }
export type GeneradorSemilla = (o: OpcionesSemilla, ahora: Date) => SemillaGenerada;
export interface MensajeGuion {
  de: "cliente" | "agente"; texto: string; plantilla?: boolean; audio?: boolean; manual?: boolean; tras?: number;
  /** [W3] Cuándo llega, en vez de `tras` segundos después del anterior. Nunca antes del paso anterior. */
  en?: AnclaSemilla;
  /** [W3] Mensaje del asistente con el que pasa la conversación a una persona (motivo: el de la conversación). */
  pase?: boolean;
  /** [W3] Mensaje del cliente que pide que no le escriban más: desde él, `silenciadoEn` y «Ha pedido que no le escribamos». */
  baja?: boolean;
}
export interface ConversacionSemilla {
  canal: "formulario" | "whatsapp" | "manual"; estado: EstadoLead; tipo: string; variante: number;
  datos: Record<string, string>; etiquetas?: string[]; motivo?: string; nombre?: string; elige?: 1 | 2;
  cierre?: { accion: "si"; importe: number; cobrado?: number } | { accion: "no"; motivo: MotivoNoSigue };
  mensajes: MensajeGuion[];
  /** [W3] Día de llegada en días naturales desde hoy (0 = hoy, −1 = ayer). */
  dia?: number;
  /** [W3] Día de llegada en días abiertos desde hoy (−1 = el último día abierto antes de hoy). Gana a `dia`. */
  od?: number;
  /** [W3] Hora local de llegada, «HH:MM». */
  hora?: string;
  /** [W3] Llega estos minutos antes de `ahora`; si cae antes de las 07:40 o ayer, llega ayer a las 23:10. */
  minutosAntes?: number;
  /** [W3] La zona del formulario (los de WhatsApp y los añadidos a mano no la tienen). */
  zona?: string;
  /**
   * [W3] La visita reservada. `hora` es un índice en `reglas.horas` (con módulo). Con `desde: "hoy"` (por
   * defecto), `od` ≥ 0 es el índice entre los próximos días abiertos (0 = el primero después de hoy) y
   * `od` < 0, un día abierto ya pasado; con `desde: "creacion"`, días abiertos después de la llegada.
   */
  visita?: { od: number; hora: number; desde?: "hoy" | "creacion" };
  /** [W3] La estimación que pone el dueño al repasar el lead, junto con las etiquetas (en euros; el motor la escala). */
  presupuesto?: number;
  /** [W3] Spam que para el código (`detectarSpam`): sin respuesta y `motivo` es exactamente lo que devuelve. */
  porRegla?: boolean;
  /** [W3] Al reservar, los dos huecos que se ofrecen son del mismo día (el cliente ha pedido ese día). */
  parMismoDia?: boolean;
  /** [W3] Lo que hace el dueño desde el panel, en orden, entre los mensajes. */
  acciones?: AccionSemilla[];
}
export interface DatosSemilla {
  semilla: number; nombres: { formulario: string[]; whatsapp: string[] }; zonas: string[];
  /** `metros` [W3]: rango para los guiones que dicen «{metros}». */
  servicios: { tipo: string; etiqueta: string; rango: [number, number]; datos: Record<string, string>; metros?: [number, number] }[];
  conversaciones: ConversacionSemilla[]; cuotas: Record<EstadoLead, number>; tareas: { texto: string; dias?: number; hecha?: boolean }[]; notas: string[];
  /** [W3] El origen de los anuncios: la campaña del formulario (utm_campaign) y el titular del anuncio de clic a WhatsApp. */
  fuentes?: { campana: string; anuncio: string };
}

/**
 * [W3] Un momento del guion, en la zona del negocio. `dia`: días naturales desde hoy. `od`: días abiertos
 * (los de `reglas.diasAbiertos` que no están en `cerrados`) desde `desde`: 0 es ese mismo día, 1 el
 * siguiente abierto, −1 el anterior abierto. `desde: "visita"` solo vale en leads con visita.
 */
export type AnclaSemilla = { dia: number; hora: string } | { od: number; hora: string; desde?: "hoy" | "creacion" | "visita" };

/** [W3] Cuándo vence una tarea: días abiertos o naturales desde hoy, o el día de la visita. */
export type VenceSemilla = { od: number } | { dia: number } | { visita: true };

/**
 * [W3] Algo que hace el dueño desde el panel. Va delante del mensaje `antes` (sin él, al final) y, sin
 * `en`, en el primer rato de oficina después del paso anterior. Si ese rato es hoy, no pasa: ni eso ni
 * nada de lo que viene detrás (lo del dueño nunca es de hoy, para que los ejemplos no dependan de la hora).
 */
export type AccionSemilla = { antes?: number; en?: AnclaSemilla } & (
  | { tipo: "persona"; motivo?: string } // lo coge desde el panel; por defecto «Lo llevas tú desde el panel»
  | { tipo: "devuelto" } // «Devuelto a tu asistente»
  | { tipo: "ficha"; presupuesto?: number; etiquetas?: string[]; nota?: string } // `nota` admite {fecha} e {importe:N}
  | { tipo: "nota"; texto: string } // admite {fecha} e {importe:N}
  | { tipo: "tarea"; texto: string; vence?: VenceSemilla; hecha?: AnclaSemilla | true }
  | { tipo: "cierre"; nota?: string } // el de `cierre` de la conversación
  | { tipo: "vista" } // abre la ficha tras «Ha vuelto a escribir»: `vueltaVistaEn`
);
