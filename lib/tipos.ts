// Tipos compartidos entre el servidor y el navegador. Sin dependencias de Node.

import type { Moneda } from "./regional";

export type EstadoLead = "nuevo" | "conversacion" | "visita" | "persona" | "spam";   // sin cambios (I2)
export type OrigenLead = "formulario" | "whatsapp" | "prueba" | "manual";           // + "manual": «+ Cliente»
export type EstadoEntrega = "enviado" | "entregado" | "leido" | "fallido";
export type Cierre = "si" | "no";
export const MOTIVOS_NO_SIGUE = ["Precio", "Se lo ha pensado", "Ha elegido a otro", "No contesta", "Otro"] as const;
export type MotivoNoSigue = (typeof MOTIVOS_NO_SIGUE)[number];

export interface Mensaje {
  id: string;
  de: "cliente" | "agente";
  texto: string;
  ts: number;
  plantilla?: boolean;
  /** Nota de voz: `texto` es la transcripción. */
  audio?: boolean;
  /** Escrito desde el panel, no por el asistente. Se pinta «Tú». */
  manual?: boolean;
  /** Solo salientes: lo último que Meta ha dicho de este mensaje. Sin valor = desconocido. */
  entrega?: EstadoEntrega;
  /** Solo con entrega "fallido": el motivo, en español. */
  fallo?: string;
  /** Solo plantillas: el nombre en Meta («solicitud_general», «retomar_conversacion»). */
  nombrePlantilla?: string;
}

export interface FuenteLead {
  /** "web": empezó a escribir por WhatsApp con el mensaje del botón de la web. */
  tipo: "anuncio" | "buscador" | "redes" | "recomendacion" | "directo" | "web" | "otro";
  plataforma?: string; // ≤ 40
  campana?: string;    // utm_campaign, ≤ 100
  anuncio?: string;    // titular del anuncio de clic a WhatsApp, ≤ 100
}

export interface Hueco {
  /** Fecha y hora locales de Madrid: 2026-11-03T10:00 */
  id: string;
  /** Formato legible: martes 3 nov a las 10:00 */
  texto: string;
}

export interface Lead {
  /** `${telefono}:${perfilId}`. El historial y el silencio van por perfil. */
  id: string;
  /** Solo dígitos, con prefijo de país: 34612345678 */
  telefono: string;
  perfilId: string;
  perfilNombre: string;
  nombre: string;
  email?: string;
  zona?: string;
  origen: OrigenLead;
  estado: EstadoLead;
  datos: Record<string, string>;
  mensajes: Mensaje[];
  creadoEn: number;
  actualizadoEn: number;
  /** Cuándo cambió de columna por última vez. El panel lo usa para el borde verde. */
  cambioEstadoEn: number;
  /** Solo en leads del formulario: de recibir la solicitud a la respuesta de Meta. */
  msPrimerWhatsApp?: number;
  huecosOfrecidos: Hueco[];
  visita?: Hueco;
  motivoPersona?: string;
  motivoSpam?: string;
  /** Lo que el equipo calcula para el trabajo, en euros, sin decimales. */
  presupuesto?: number;
  /** Lo que ya ha pagado el cliente, en euros. */
  cobrado?: number;
  notas?: Nota[];
  tareas?: Tarea[];
  /** Lead de ejemplo del CRM de muestra: tiene canal de verdad (formulario o WhatsApp), pero ningún móvil real. */
  ejemplo?: boolean;
  /** Etiquetas libres que pone el equipo: «cocina», «financiación»… */
  etiquetas?: string[];
  actividad?: Actividad[];
  /** Pidió que no le escriban (ms): nadie le escribe por WhatsApp desde entonces (I15). */
  silenciadoEn?: number;
  fuente?: FuenteLead;
  /** Solo leads de WhatsApp: de la llegada del primer mensaje al envío de la primera respuesta. */
  msPrimeraRespuesta?: number;
  /** Lo decide el dueño; el importe de un «sí» va en presupuesto y la señal en cobrado. */
  cierre?: Cierre;
  cierreEn?: number;
  /** Solo con cierre "no". */
  motivoCierre?: MotivoNoSigue;
  /** El dueño abrió la ficha después de «Ha vuelto a escribir». */
  vueltaVistaEn?: number;
}

/** Una anotación interna del equipo. El cliente y el asistente no la ven. */
export interface Nota {
  id: string;
  texto: string;
  ts: number;
}

export interface Tarea {
  id: string;
  texto: string;
  /** Día límite, opcional: 2026-11-12 */
  vence?: string;
  hecha: boolean;
  ts: number;
}

/** Algo que ha pasado con el lead, para la línea de tiempo de la ficha. */
export interface Actividad {
  id: string;
  texto: string;
  ts: number;
}

export interface Reserva {
  huecoId: string;
  texto: string;
  leadId: string;
  nombre: string;
  perfilNombre: string;
  /** Los ejemplos ocupan su hueco, pero la Agenda los marca como tales. */
  prueba?: boolean;
}

export interface ReglasAgenda {
  zona: string;              // IANA, de ZONAS_HORARIAS.        default "Europe/Madrid"
  horas: string[];           // "HH:MM", ordenadas, únicas, 1..48. default ["10:00","12:30","17:00"]
  diasAbiertos: number[];    // 0 = domingo … 6 = sábado, ≥ 1.    default [1,2,3,4,5]
  cerrados: string[];        // "AAAA-MM-DD", ≤ 60.               default []
  diasVista: number;         // días ABIERTOS por delante, 1..365. default 60
  desdeDias: number;         // 1 = desde mañana, 0 = también hoy. default 1
  antelacionMinutos: number; // 0..10080.                          default 0
  corteTarde: string;        // "HH:MM": mañana < corte ≤ tarde.   default "14:00"
}

export interface Ajustes { leadsPrueba: boolean; ejemplosDe?: string | null } // sector de los ejemplos cargados

/** Lo que el equipo cambia a mano en la ficha de un lead. Solo va lo que cambia; `null` lo borra. */
export interface CambiosFicha {
  nombre?: string;
  email?: string | null;
  zona?: string | null;
  presupuesto?: number | null;
  cobrado?: number | null;
  etiquetas?: string[];
  datos?: Record<string, string | null>;
}

/** Las fases de una obra, en orden. */
export const ESTADOS_OBRA = ["Proyecto", "Licencias", "En obra", "Acabados", "Entregada"] as const;
export type EstadoObra = (typeof ESTADOS_OBRA)[number];

/** Una obra guardada en la tabla `proyectos`: el panel ya no las enseña ni hay obras de ejemplo, pero se conservan las que ya había. */
export interface Proyecto {
  id: string;
  foto: number;
  tipo: string;
  barrio: string;
  estado: EstadoObra;
  /** De 0 a 100. */
  avance: number;
  descripcion: string;
  /** El cliente al que pertenece la obra, si está vinculado a un lead. */
  leadId?: string;
}

/** Lo que el equipo cambia en una obra. Solo va lo que cambia; `null` quita el cliente. */
export interface CambiosProyecto {
  estado?: EstadoObra;
  avance?: number;
  leadId?: string | null;
}

export interface Bd {
  leads: Record<string, Lead>;
  reservas: Reserva[];
  ajustes: Ajustes;
  /** Sin uso en la interfaz desde la fase 3 (F20); el tipo no cambia. */
  proyectos: Proyecto[];
  /** Opcional: las pruebas construyen Bd a mano. */
  configuracion?: import("./configuracion").ConfiguracionPublica;
  /** Leads a los que el asistente está contestando ahora mismo. */
  escribiendo?: string[];
}

export type Mutacion =
  | { t: "lead"; lead: Lead }
  | { t: "mensaje"; leadId: string; mensaje: Mensaje }
  | { t: "dato"; leadId: string; campo: string; valor: string; ts: number }
  | { t: "estado"; leadId: string; estado: EstadoLead; ts: number; motivo?: string }
  | { t: "huecos"; leadId: string; huecos: Hueco[] }
  | { t: "ficha"; leadId: string; cambios: CambiosFicha }
  | { t: "reserva"; reserva: Reserva; hueco: Hueco; ts: number }
  | { t: "cancelar"; leadId: string; ts: number }
  | { t: "nota"; leadId: string; nota: Nota }
  | { t: "tarea"; leadId: string; tarea: Tarea }
  | { t: "tareaCambio"; leadId: string; tareaId: string; hecha?: boolean; borrar?: boolean }
  | { t: "silencio"; leadId: string; ts: number }
  | { t: "permitir"; leadId: string; ts: number; por: "cliente" | "equipo" }
  | { t: "cierre"; leadId: string; ts: number; accion: "si"; importe: number; cobrado?: number | null; nota?: string; moneda?: Moneda /* para el historial «Ha dicho que sí · 5.200 €» */ }
  | { t: "cierre"; leadId: string; ts: number; accion: "no"; motivo: MotivoNoSigue; nota?: string; anularCita?: boolean /* la ruta decide, con la zona del negocio, si la cita es futura */ }
  | { t: "cierre"; leadId: string; ts: number; accion: "reabrir" | "visto" }
  | { t: "etapa"; leadId: string; ts: number; a: "asistente" | "persona" | "spam" | "no-spam"; motivo?: string; anularCita?: boolean }
  | { t: "borrar"; leadId: string; ts: number }
  | { t: "actividad"; leadId: string; id: string; texto: string; ts: number }   // línea de historial; id idempotente
  | { t: "respuesta"; leadId: string; ms: number };                             // msPrimeraRespuesta, solo si aún no tiene

export interface ReferidoMeta { source_type?: string; source_id?: string; source_url?: string; headline?: string; body?: string; ctwa_clid?: string }

export interface Entrante {
  wamid: string;
  telefono: string;
  nombrePerfil: string;
  tipo: "texto" | "audio" | "otro";
  /** En un audio, una etiqueta hasta que se transcribe. */
  texto: string;
  ts: number;
  /** Solo en audios: el id del archivo en Meta. */
  mediaId?: string;
  /** Solo en el primer mensaje que llega desde un anuncio. */
  referido?: ReferidoMeta;
  /** Ms del reloj del servidor al llegar el webhook (la llegada y msPrimeraRespuesta). */
  recibidoEn?: number;
}

export interface CambioEntrega { wamid: string; estado: EstadoEntrega; ts: number; fallo?: string }

export interface Lote {
  loteId: string;
  telefono: string;
  mensajes: Entrante[];
}
