// Los ejemplos de «Otro»: un negocio cualquiera, con conversaciones sencillas. 20 leads: 3 nuevos, 6
// hablando con el asistente (uno pidió que no le escribieran), 4 con cita, 6 con el dueño y 1 de
// publicidad. Cierres: un «Ha dicho que sí» con señal y dos «No sigue».
//
// Lo que piden los clientes sale de los servicios del negocio (`o.servicios`, los de la portada) y, si
// no tiene, de «Primera consulta», «Presupuesto» y «Seguimiento». El nombre de la cita sale de su
// vocabulario. El asistente pregunta qué necesita y para cuándo, de una en una; para reservar ofrece dos
// huecos y confirma el elegido con «Si prefieres hablar con una persona, dímelo por aquí.». Nunca da
// precios; una persona del equipo «te escribe en cuanto pueda». El motor (lib/semilla.ts) les pone
// fecha, hora e historial.
//
// El origen: algunos llegan desde Google y el resto sin origen. El motor reparte también anuncios de
// Meta; un negocio que empieza no los tiene, así que aquí se quitan.

import { generarSector } from "../semilla";
import { formas, type Vocabulario } from "../vocabulario";
import type { AccionSemilla, AnclaSemilla, ConversacionSemilla, DatosSemilla, MensajeGuion, OpcionesSemilla, SemillaGenerada } from "./tipos";

type Extra = Omit<MensajeGuion, "de" | "texto">;

const PLANTILLA: MensajeGuion = { de: "agente", texto: "{plantilla}", plantilla: true };
const c = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "cliente", texto, ...extra });
const a = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "agente", texto, ...extra });
/** Lo escribe el dueño desde el panel (el panel lo pinta «Tú»). */
const tu = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "agente", texto, manual: true, ...extra });

const visita = (od: number, hora: string): AnclaSemilla => ({ desde: "visita", od, hora });
const creacion = (od: number, hora: string): AnclaSemilla => ({ desde: "creacion", od, hora });

/** Lo que ofrece un negocio sin servicios propios. */
export const SERVICIOS_GENERICOS = ["Primera consulta", "Presupuesto", "Seguimiento"];

const OFERTA = "Te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?";
const LIBRES = "Te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?";
const NECESITA = "¿Qué necesitas, en una frase?";
const CUANDO = "¿Para cuándo lo necesitas?";
const PASE = "te paso con una persona del equipo, que te escribe en cuanto pueda.";
const LLAMAR_SIN_RESPUESTA = "Llamar: no contesta al WhatsApp";

/** «Hecho, cita reservada para el …», con el nombre y el género de la cita del negocio. */
function confirmacion(v: Vocabulario): string {
  const cita = v.cita.soloPlural ? v.cita.plural : v.cita.singular;
  return `Hecho, ${cita} ${formas(v.cita).adj("reservad")} para el {hueco}. Si prefieres hablar con una persona, dímelo por aquí.`;
}

function sinRespuesta(): AccionSemilla[] {
  return [{ tipo: "tarea", texto: LLAMAR_SIN_RESPUESTA, en: creacion(1, "10:10"), hecha: creacion(2, "12:30") }];
}

/** Los guiones con los servicios y la cita de este negocio. */
export function conversacionesGenericas(servicios: string[], v: Vocabulario): ConversacionSemilla[] {
  const lista = servicios.map((s) => s.trim()).filter(Boolean);
  const s = (k: number) => (lista.length ? lista : SERVICIOS_GENERICOS)[k % (lista.length || SERVICIOS_GENERICOS.length)];
  const CONFIRMA = confirmacion(v);
  return [
    // ---- Con el dueño tras la cita (4) ----

    // Marta Gil: dice que sí y paga la señal.
    {
      canal: "formulario", estado: "persona", tipo: s(0), variante: 1, nombre: "Marta Gil Ferrer", dia: -26, hora: "20:10", zona: "Centro",
      datos: { necesidad: s(0), plazo: "Este mes" }, elige: 1,
      visita: { desde: "creacion", od: 2, hora: 0 }, cierre: { accion: "si", importe: 1_200, cobrado: 300 },
      mensajes: [
        PLANTILLA,
        c(`${s(0)}, si puede ser.`),
        a("¡Hola, {nombre}! Claro. " + CUANDO),
        c("Este mes, cuanto antes mejor"),
        a("Perfecto. " + OFERTA),
        c("El primero"),
        a(CONFIRMA),
        c("Gracias por atenderme. ¿Me pasáis el presupuesto por escrito?", { en: visita(0, "13:30") }),
        tu("¡Claro, Marta! Te lo mando por email esta tarde."),
        c("Lo he visto y me encaja. ¿Cómo os pago la señal?", { en: visita(2, "11:00") }),
        tu("¡Genial! Son 300 € de señal; te paso los datos por email."),
        c("Hecha la transferencia", { en: visita(3, "10:20") }),
        tu("Recibida, Marta. ¡Muchas gracias!"),
      ],
      acciones: [
        { antes: 7, tipo: "persona" },
        { antes: 9, tipo: "ficha", presupuesto: 1_200, nota: "Presupuesto enviado el {fecha}", en: visita(1, "10:00") },
        { tipo: "cierre", en: visita(3, "11:00") },
      ],
    },
    // Rubén: el presupuesto se le va de precio.
    {
      canal: "whatsapp", estado: "persona", tipo: s(1), variante: 1, nombre: "Rubén", dia: -21, hora: "11:40",
      datos: { necesidad: s(1), plazo: "Sin prisa" }, elige: 2,
      visita: { desde: "creacion", od: 2, hora: 1 }, cierre: { accion: "no", motivo: "Precio" },
      mensajes: [
        c("Hola, quería información"),
        a("¡Hola! {presentacion}Claro. " + NECESITA),
        c(`${s(1)}, por favor.`),
        a("Perfecto. " + CUANDO),
        c("Sin prisa, cuando podáis"),
        a("Genial. " + OFERTA),
        c("El segundo"),
        a(CONFIRMA),
        c("Gracias por la cita. ¿Para cuándo tendría el presupuesto?", { en: visita(0, "15:40") }),
        tu("Hola, Rubén. Te lo envío mañana por la mañana."),
        c("Lo he visto, pero se me va de lo que quería gastar. Lo dejo, gracias", { en: visita(2, "18:10") }),
      ],
      acciones: [
        { antes: 8, tipo: "persona" },
        { antes: 10, tipo: "ficha", presupuesto: 900, en: visita(1, "10:30") },
        { tipo: "cierre" },
      ],
    },
    // Lidia Campos: la cita fue el último día abierto; espera el presupuesto.
    {
      canal: "formulario", estado: "persona", tipo: s(2), variante: 1, nombre: "Lidia Campos", dia: -6, hora: "21:30", zona: "Norte",
      datos: { necesidad: s(2), plazo: "Esta semana" }, elige: 1,
      visita: { od: -1, hora: 0 },
      mensajes: [
        PLANTILLA,
        c(`Hola. ${s(2)}, si puede ser.`),
        a("¡Hola, {nombre}! Claro. " + CUANDO),
        c("Esta semana o la que viene"),
        a("Perfecto. " + OFERTA),
        c("El primero"),
        a(CONFIRMA),
        c("Gracias por atenderme. ¿Me mandáis el presupuesto?", { en: visita(0, "12:10") }),
        tu("¡Gracias a ti, Lidia! Te lo mando por email."),
        c("Perfecto, quedo atenta"),
        tu("Enviado. Cualquier duda, me dices por aquí."),
      ],
      acciones: [
        { antes: 7, tipo: "persona" },
        { antes: 10, tipo: "ficha", presupuesto: 600 },
      ],
    },
    // Andrés: la cita fue hace tres días abiertos; aún no ha dicho nada.
    {
      canal: "whatsapp", estado: "persona", tipo: s(0), variante: 2, nombre: "Andrés", dia: -8, hora: "17:15",
      datos: { necesidad: s(0), plazo: "Este mes" }, elige: 2,
      visita: { od: -3, hora: 2 },
      mensajes: [
        c("Buenas tardes, ¿me dais cita?"),
        a("¡Buenas tardes! {presentacion}Claro. " + NECESITA),
        c(`${s(0)}, por favor.`),
        a("Perfecto. " + CUANDO),
        c("Este mes"),
        a("Genial. " + OFERTA),
        c("El segundo"),
        a(CONFIRMA),
        c("Gracias por la cita de hoy. Me lo pienso y te digo", { en: visita(0, "18:40") }),
        tu("Gracias a ti, Andrés. Cualquier duda, por aquí."),
        c("Perfecto"),
      ],
      acciones: [
        { antes: 8, tipo: "persona" },
        { tipo: "ficha", presupuesto: 1_500, nota: "Presupuesto enviado el {fecha}", en: visita(1, "10:00") },
      ],
    },

    // ---- Pasados a una persona por el asistente (2) ----

    // Carmen Vega: pide hablar con una persona; se lo piensa.
    {
      canal: "formulario", estado: "persona", tipo: s(1), variante: 2, nombre: "Carmen Vega", od: -12, hora: "10:30", zona: "Centro",
      datos: { necesidad: s(1) }, motivo: "Pide hablar con una persona", cierre: { accion: "no", motivo: "Se lo ha pensado" },
      mensajes: [
        PLANTILLA,
        c(`Hola. ${s(1)}, pero prefiero hablar con una persona`),
        a("Claro, sin problema. Te paso con una persona del equipo, que te escribe en cuanto pueda.", { pase: true }),
        tu("Hola, Carmen. ¿Te va bien que te llame ahora y me cuentas?"),
        c("Sí, perfecto"),
        c("Gracias por la llamada. Al final lo dejo para más adelante", { en: creacion(2, "17:30") }),
        tu("Entendido, Carmen. Cuando quieras, escríbenos por aquí."),
      ],
      acciones: [{ tipo: "cierre" }],
    },
    // Jaime: no queda claro qué necesita tras dos preguntas.
    {
      canal: "whatsapp", estado: "persona", tipo: s(2), variante: 2, nombre: "Jaime", od: -2, hora: "12:15",
      datos: {}, motivo: "No queda claro qué necesita",
      mensajes: [
        c("Hola, tengo una duda"),
        a("¡Hola! {presentacion}Claro. " + NECESITA),
        c("Es un poco largo de explicar, es sobre algo que me hicisteis el año pasado"),
        a("Para que te lo mire bien, " + PASE, { pase: true }),
        tu("Hola, Jaime. Cuéntame y lo vemos, o si prefieres te llamo."),
        c("Mejor llámame esta tarde"),
      ],
    },

    // ---- Hablando con el asistente (6) ----

    // Nuria: pide que no le escriban más.
    {
      canal: "whatsapp", estado: "conversacion", tipo: s(0), variante: 3, nombre: "Nuria", dia: -17, hora: "13:05",
      datos: { necesidad: s(0) },
      mensajes: [
        c("Hola, ¿cuánto cuesta?"),
        a("¡Hola! {presentacion}Depende de lo que necesites. " + NECESITA),
        c("Era solo para saber el precio. No me escribáis más", { baja: true }),
        a("{baja}"),
      ],
    },
    {
      canal: "formulario", estado: "conversacion", tipo: s(1), variante: 3, nombre: "Pedro Alonso", dia: -24, hora: "22:50", zona: "Sur",
      datos: { necesidad: s(1) },
      mensajes: [
        PLANTILLA,
        c(`Buenos días. ${s(1)}, si puede ser.`),
        a("¡Buenos días, {nombre}! Claro. " + CUANDO),
      ],
    },
    {
      canal: "whatsapp", estado: "conversacion", tipo: s(2), variante: 3, nombre: "Vane", dia: -15, hora: "18:20",
      datos: { necesidad: s(2), plazo: "El mes que viene" },
      mensajes: [
        c("Hola! Quería información"),
        a("¡Hola! {presentacion}Claro. " + NECESITA),
        c(`${s(2)}. Para el mes que viene`),
        a("Perfecto. " + LIBRES),
      ],
    },
    {
      canal: "formulario", estado: "conversacion", tipo: s(0), variante: 4, nombre: "lucía herrera", dia: -11, hora: "09:45", zona: "Norte",
      datos: { necesidad: s(0) },
      mensajes: [
        PLANTILLA,
        c(`${s(0)}. ¿Cuánto cuesta más o menos?`),
        a("El precio depende de cada caso y te lo explican en la cita, sin compromiso. " + CUANDO),
        c("Lo miro y te digo"),
        a("Sin problema. Cuando lo sepas, me escribes por aquí y te propongo un par de días."),
      ],
    },
    {
      canal: "whatsapp", estado: "conversacion", tipo: s(1), variante: 4, nombre: "Tomás", dia: -7, hora: "16:30",
      datos: { necesidad: s(1), plazo: "Esta semana" },
      mensajes: [
        c("Buenas, ¿tenéis hueco esta semana?"),
        a("¡Buenas! {presentacion}" + NECESITA),
        c(`${s(1)}, por favor.`),
        a("Perfecto. " + LIBRES),
      ],
    },
    {
      canal: "formulario", estado: "conversacion", tipo: s(2), variante: 4, nombre: "Ingrid Larsen", dia: -3, hora: "20:40", zona: "Centro",
      datos: { necesidad: s(2), plazo: "Sin prisa" },
      mensajes: [
        PLANTILLA,
        c(`Hello! ${s(2)}, si puede ser.`),
        a("¡Hola, {nombre}! Claro. " + CUANDO),
        c("Sin prisa"),
        a("Perfecto. " + LIBRES),
      ],
    },

    // ---- Con cita (4) ----

    {
      canal: "formulario", estado: "visita", tipo: s(0), variante: 5, nombre: "Sonia Prieto", dia: -5, hora: "21:20", zona: "Sur",
      datos: { necesidad: s(0), plazo: "Esta semana" }, elige: 1, visita: { od: 1, hora: 0 }, acciones: [],
      mensajes: [
        PLANTILLA,
        c(`Hola. ${s(0)}, si puede ser.`),
        a("¡Hola, {nombre}! Claro. " + CUANDO),
        c("Esta semana o la que viene"),
        a("Perfecto. " + OFERTA),
        c("El primero"),
        a(CONFIRMA),
        c("¡Gracias!"),
        a("¡A ti! Cualquier cosa, me dices por aquí."),
      ],
    },
    {
      canal: "whatsapp", estado: "visita", tipo: s(1), variante: 5, nombre: "Álvaro", dia: -4, hora: "12:40",
      datos: { necesidad: s(1), plazo: "Sin prisa" }, elige: 2, visita: { od: 0, hora: 2 }, acciones: [],
      mensajes: [
        c("Hola, ¿me dais cita?"),
        a("¡Hola! {presentacion}Claro. " + NECESITA),
        c(`${s(1)}, por favor.`),
        a("Perfecto. " + CUANDO),
        c("Sin prisa, mejor por la tarde"),
        a("Genial. " + OFERTA),
        c("El segundo"),
        a(CONFIRMA),
      ],
    },
    {
      canal: "formulario", estado: "visita", tipo: s(2), variante: 5, nombre: "Rosa Martínez Gil", dia: -2, hora: "10:15", zona: "Centro",
      datos: { necesidad: s(2), plazo: "Este mes" }, elige: 2, visita: { od: 2, hora: 1 }, acciones: [],
      mensajes: [
        PLANTILLA,
        c(`Buenos días. ${s(2)}, si puede ser.`),
        a("¡Buenos días, {nombre}! Claro. " + CUANDO),
        c("Este mes"),
        a("Perfecto. " + OFERTA),
        c("El segundo"),
        a(CONFIRMA),
        c("Perfecto, gracias"),
        a("¡A ti! Cualquier cosa, me dices por aquí."),
      ],
    },
    {
      canal: "whatsapp", estado: "visita", tipo: s(0), variante: 6, nombre: "Miguel Á.", dia: -1, hora: "17:50",
      datos: { necesidad: s(0), plazo: "La semana que viene" }, elige: 1, visita: { od: 3, hora: 2 }, acciones: [],
      mensajes: [
        c("Buenas tardes, quería pedir cita"),
        a("¡Buenas tardes! {presentacion}Claro. " + NECESITA),
        c(`${s(0)}, por favor.`),
        a("Perfecto. " + CUANDO),
        c("La semana que viene"),
        a("Genial. " + OFERTA),
        c("El primero"),
        a(CONFIRMA),
      ],
    },

    // ---- Nuevos (3): del formulario, sin respuesta ----

    { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 1, nombre: "Javier Romero", dia: -19, hora: "22:05", zona: "Norte", datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta() },
    { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 2, nombre: "elena soto", dia: -9, hora: "14:10", zona: "Centro", datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta() },
    { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 3, nombre: "Hanna Schmidt", dia: -2, hora: "21:30", zona: "Sur", datos: {}, mensajes: [PLANTILLA], acciones: [] },

    // ---- Publicidad (1): una agencia; el asistente contesta una vez y lo marca ----

    {
      canal: "whatsapp", estado: "spam", tipo: "spam", variante: 1, nombre: "Agencia Crece", dia: -13, hora: "10:50",
      datos: {}, motivo: "Publicidad de una agencia",
      mensajes: [
        c("¡Hola! Somos una agencia y ayudamos a negocios como el tuyo a conseguir más clientes con anuncios. ¿Hablamos 10 minutos?"),
        a("¡Hola! {presentacion}Gracias por escribirnos, pero ahora mismo no nos interesa. ¡Que vaya bien!"),
      ],
    },
  ];
}

/** Los datos del sector para unas opciones: los servicios y la cita del negocio. */
export function datosGenericos(o: OpcionesSemilla): DatosSemilla {
  const servicios = o.servicios?.map((s) => s.trim()).filter(Boolean) ?? [];
  const lista = servicios.length ? servicios : SERVICIOS_GENERICOS;
  return {
    semilla: 20_261_114,
    nombres: { formulario: ["Laura Benítez", "Iván Cano", "Noa Ferrer"], whatsapp: ["Edu", "Marisa", "Chema"] },
    zonas: ["Centro", "Norte", "Sur"],
    servicios: lista.map((s) => ({ tipo: s, etiqueta: s, rango: [0, 0] as [number, number], datos: {} })),
    conversaciones: conversacionesGenericas(lista, o.vocabulario),
    cuotas: { nuevo: 3, conversacion: 6, visita: 4, persona: 6, spam: 1 },
    tareas: [],
    notas: [],
    fuentes: { campana: "", anuncio: "" },
  };
}

/** El generador de «Otro»: los datos de arriba con el motor genérico, sin anuncios de Meta. */
export function generarGenerico(o: OpcionesSemilla, ahora: Date): SemillaGenerada {
  const s = generarSector(datosGenericos(o), o, ahora);
  for (const lead of Object.values(s.leads)) {
    if (lead.fuente?.tipo === "anuncio") delete lead.fuente;
  }
  return s;
}
