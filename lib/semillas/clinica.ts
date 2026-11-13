// Los ejemplos de la clínica dental: un mes de una clínica de barrio en Barcelona, con citas en la
// rejilla de 30 minutos. 35 leads: 5 nuevos (uno añadido a mano), 10 hablando con el asistente (uno
// pidió que no le escribieran), 7 con cita, 11 con recepción y 2 de publicidad. Cierres: dos «Ha dicho
// que sí» (ortodoncia invisible con la entrada pagada e implante) y cinco «No sigue».
//
// Datos de salud (RGPD, art. 9): los ejemplos solo dicen qué tratamiento interesa («Limpieza»,
// «Revisión», «Ortodoncia invisible», «Blanqueamiento», «Implante»). Ningún mensaje, nota, etiqueta o
// dato habla de síntomas, salvo el único mensaje del paciente de «Posible urgencia», que la regla de la
// clínica pasa a recepción con la respuesta fija del 112.
//
// El asistente pregunta qué necesita, si es su primera visita y el seguro, de una en una; para reservar
// ofrece dos huecos y confirma el elegido con «Si prefieres hablar con una persona, dímelo por aquí.».
// Nunca da precios ni diagnostica; recepción «te escribe en cuanto pueda». El motor (lib/semilla.ts)
// les pone fecha, hora e historial.

import { generarSector } from "../semilla";
import type { AccionSemilla, AnclaSemilla, ConversacionSemilla, DatosSemilla, MensajeGuion, OpcionesSemilla, SemillaGenerada } from "./tipos";

type Extra = Omit<MensajeGuion, "de" | "texto">;

const PLANTILLA: MensajeGuion = { de: "agente", texto: "{plantilla}", plantilla: true };
const c = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "cliente", texto, ...extra });
const a = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "agente", texto, ...extra });
/** Lo escribe recepción desde el panel (el panel lo pinta «Tú»). */
const tu = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "agente", texto, manual: true, ...extra });

const visita = (od: number, hora: string): AnclaSemilla => ({ desde: "visita", od, hora });
const creacion = (od: number, hora: string): AnclaSemilla => ({ desde: "creacion", od, hora });
const dia = (d: number, hora: string): AnclaSemilla => ({ dia: d, hora });

const OFERTA = "Te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?";
const CONFIRMA = "Hecho, cita reservada para el {hueco}. Si prefieres hablar con una persona, dímelo por aquí.";
const PRIMERA = "¿Es tu primera visita o ya eres paciente?";
const SEGURO = "¿Tienes seguro dental o mutua?";
const PASE = "te paso con recepción, que te escribe en cuanto pueda.";
const URGENCIA = "Si es una urgencia grave, llama al 112. Te paso con recepción, que te escribe en cuanto pueda.";
const LLAMAR_SIN_RESPUESTA = "Llamar: no contesta al WhatsApp";
const PRESUPUESTO_ENVIADO = "Presupuesto enviado el {fecha}";

/** Un nuevo del formulario que nunca contestó: recepción le llamó al día siguiente, sin suerte. */
function sinRespuesta(): AccionSemilla[] {
  return [{ tipo: "tarea", texto: LLAMAR_SIN_RESPUESTA, en: creacion(1, "10:10"), hecha: creacion(2, "12:30") }];
}

// Rejilla de la clínica (índices de `horas`): 0 09:00 · 1 09:30 · 2 10:00 · 3 10:30 · 4 11:00 · 5 11:30 ·
// 6 12:00 · 7 12:30 · 8 13:00 · 9 13:30 · 10 16:00 · 11 16:30 · 12 17:00 · 13 17:30 · 14 18:00 · 15 18:30 ·
// 16 19:00 · 17 19:30. Las citas futuras evitan mañana a las 09:00, 09:30 y 16:00 y pasado mañana a las
// 16:00: son los primeros huecos que ofrecería el asistente a cualquier hora de hoy.

// Importes orientativos de una clínica dental de barrio en Barcelona en 2026, para que los ejemplos
// parezcan reales; no son una tarifa.
const IMPORTES = { ortodoncia: 3_900, ortodonciaOtra: 3_700, implante: 1_250, implanteOtro: 1_400, blanqueamiento: 350, entrada: 600 };

export const CONVERSACIONES_CLINICA: ConversacionSemilla[] = [
  // ---- Con recepción tras la primera cita (7) ----

  // Claudia Romero Vega: ortodoncia invisible; acepta y paga la entrada.
  {
    canal: "formulario", estado: "persona", tipo: "Ortodoncia invisible", variante: 1, nombre: "Claudia Romero Vega", dia: -28, hora: "20:30",
    datos: { tratamiento: "Ortodoncia invisible", primera_visita: "Sí", seguro: "Sin seguro" }, etiquetas: ["ortodoncia"], elige: 1,
    visita: { desde: "creacion", od: 2, hora: 11 }, cierre: { accion: "si", importe: IMPORTES.ortodoncia, cobrado: IMPORTES.entrada },
    mensajes: [
      PLANTILLA,
      c("¡Hola! Quería información sobre ortodoncia invisible"),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("Primera visita"),
      a("Perfecto. " + SEGURO),
      c("No, ninguno"),
      a("Entendido. " + OFERTA),
      c("El primero"),
      a(CONFIRMA),
      c("Gracias por la primera visita. ¿Me podéis mandar el presupuesto por escrito?", { en: visita(0, "18:40") }),
      tu("¡Claro, Claudia! Te lo enviamos por email esta tarde."),
      c("Me lo hago. ¿Cómo pago la entrada?", { en: visita(3, "12:10") }),
      tu("¡Genial! La entrada son 600 €; la puedes pagar en recepción o por transferencia."),
      c("Hecha la transferencia 😊", { en: visita(4, "10:00") }),
      tu("Recibida, Claudia. ¡Nos vemos en la próxima cita!"),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 11, tipo: "ficha", presupuesto: IMPORTES.ortodoncia, etiquetas: ["ortodoncia", "presupuesto enviado"], nota: PRESUPUESTO_ENVIADO, en: visita(1, "10:00") },
      { tipo: "cierre", en: visita(4, "10:30") },
      { tipo: "ficha", etiquetas: ["ortodoncia", "presupuesto aceptado"] },
    ],
  },
  // Antonio: ya es paciente; acepta el implante. Aún no ha pagado nada.
  {
    canal: "whatsapp", estado: "persona", tipo: "Implante", variante: 1, nombre: "Antonio", dia: -24, hora: "10:20",
    datos: { tratamiento: "Implante", primera_visita: "No, ya es paciente", seguro: "Adeslas" }, etiquetas: ["implante"], elige: 2,
    visita: { desde: "creacion", od: 3, hora: 4 }, cierre: { accion: "si", importe: IMPORTES.implante },
    mensajes: [
      c("Buenos días, quería información para un implante"),
      a("¡Buenos días! {presentacion}Claro. " + PRIMERA),
      c("Ya soy paciente, vine el año pasado"),
      a("Perfecto. ¿Sigues con la misma mutua?"),
      c("Sí, Adeslas"),
      a("Genial. " + OFERTA),
      c("El segundo"),
      a(CONFIRMA),
      c("Gracias. ¿Cuándo tendría el presupuesto?", { en: visita(0, "13:00") }),
      tu("Hola, Antonio. Te lo damos mañana por la mañana."),
      c("Recibido el presupuesto. Adelante con el implante", { en: visita(2, "11:15") }),
      tu("¡Perfecto, Antonio! Te llamamos para darte la primera cita del tratamiento."),
    ],
    acciones: [
      { antes: 8, tipo: "persona" },
      { antes: 10, tipo: "ficha", presupuesto: IMPORTES.implante, etiquetas: ["implante", "presupuesto enviado"], nota: PRESUPUESTO_ENVIADO, en: visita(1, "10:00") },
      { tipo: "cierre", en: visita(2, "12:00") },
    ],
  },
  // Francisco Gil: el implante se le va de precio.
  {
    canal: "formulario", estado: "persona", tipo: "Implante", variante: 2, nombre: "Francisco Gil", dia: -22, hora: "13:00",
    datos: { tratamiento: "Implante", primera_visita: "Sí", seguro: "Sanitas" }, etiquetas: ["implante"], elige: 1,
    visita: { desde: "creacion", od: 2, hora: 13 }, cierre: { accion: "no", motivo: "Precio" },
    mensajes: [
      PLANTILLA,
      c("Hola, quería pedir cita para valorar un implante"),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("Primera visita"),
      a(SEGURO),
      c("Sanitas"),
      a("Perfecto. " + OFERTA),
      c("El primero"),
      a(CONFIRMA),
      c("Gracias por atenderme. Me ha salido más caro de lo que pensaba", { en: visita(1, "11:30") }),
      tu("Lo entiendo, Francisco. Se puede pagar en 12 meses sin intereses, por si te ayuda."),
      c("Gracias, pero de momento lo dejo", { en: visita(2, "17:00") }),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 9, tipo: "ficha", presupuesto: IMPORTES.implanteOtro, etiquetas: ["implante", "presupuesto enviado"] },
      { tipo: "cierre" },
    ],
  },
  // Irene: blanqueamiento; lo deja para más adelante.
  {
    canal: "whatsapp", estado: "persona", tipo: "Blanqueamiento", variante: 1, nombre: "Irene", dia: -20, hora: "18:00",
    datos: { tratamiento: "Blanqueamiento", primera_visita: "Sí", seguro: "Sin seguro" }, etiquetas: ["blanqueamiento"], elige: 2,
    visita: { desde: "creacion", od: 2, hora: 12 }, cierre: { accion: "no", motivo: "Se lo ha pensado" },
    mensajes: [
      c("¡Hola! ¿Hacéis blanqueamiento dental?"),
      a("¡Hola! {presentacion}Sí. " + PRIMERA),
      c("Primera"),
      a(SEGURO),
      c("No"),
      a("Perfecto. " + OFERTA),
      c("El segundo"),
      a(CONFIRMA),
      c("Gracias por la visita, me lo pienso", { en: visita(0, "19:00") }),
      tu("Claro, Irene. Cualquier duda, por aquí."),
      c("Al final lo voy a dejar para después del verano", { en: visita(5, "10:40") }),
      tu("Entendido, Irene. Cuando quieras, aquí estamos."),
    ],
    acciones: [
      { antes: 8, tipo: "persona" },
      { antes: 10, tipo: "ficha", presupuesto: IMPORTES.blanqueamiento },
      { tipo: "cierre" },
    ],
  },
  // Marc Esteve Font: ortodoncia para su hija; elige otra clínica.
  {
    canal: "formulario", estado: "persona", tipo: "Ortodoncia invisible", variante: 2, nombre: "Marc Esteve Font", dia: -19, hora: "21:30",
    datos: { tratamiento: "Ortodoncia invisible", primera_visita: "Sí", seguro: "DKV" }, etiquetas: ["ortodoncia"], elige: 1,
    visita: { desde: "creacion", od: 3, hora: 1 }, cierre: { accion: "no", motivo: "Ha elegido a otro" },
    mensajes: [
      PLANTILLA,
      c("Buenas, quería información sobre ortodoncia invisible para mi hija de 15 años"),
      a("¡Hola, {nombre}! Claro. ¿Sería su primera visita o ya es paciente?"),
      c("Primera visita"),
      a("¿Tenéis seguro dental o mutua?"),
      c("DKV"),
      a("Perfecto. " + OFERTA),
      c("El primero"),
      a(CONFIRMA),
      c("Gracias. Hemos pedido otro presupuesto para comparar", { en: visita(1, "17:00") }),
      tu("Claro, Marc. Si tenéis cualquier duda, por aquí."),
      c("Al final lo hacemos en otra clínica más cerca de casa. ¡Gracias!", { en: visita(6, "12:00") }),
      tu("Gracias por avisar, Marc. ¡Mucha suerte!"),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 9, tipo: "ficha", presupuesto: IMPORTES.ortodonciaOtra, etiquetas: ["ortodoncia", "presupuesto enviado"] },
      { tipo: "cierre" },
    ],
  },
  // Eva Martín: limpieza el último día abierto; sin importe.
  {
    canal: "formulario", estado: "persona", tipo: "Limpieza", variante: 1, nombre: "Eva Martín", dia: -6, hora: "08:50",
    datos: { tratamiento: "Limpieza", primera_visita: "No, ya es paciente" }, etiquetas: ["limpieza"], elige: 2,
    visita: { od: -1, hora: 3 },
    mensajes: [
      PLANTILLA,
      c("Hola, quería una limpieza"),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("Ya soy paciente"),
      a("Perfecto. ¿Sigues con la misma mutua?"),
      c("Sí"),
      a("Genial. " + OFERTA),
      c("El segundo"),
      a(CONFIRMA),
      c("Gracias por la limpieza. ¿Cuándo me toca la siguiente revisión?", { en: visita(0, "12:30") }),
      tu("¡Gracias a ti, Eva! En seis meses. Cuando quieras, pide cita por aquí."),
    ],
    acciones: [{ antes: 9, tipo: "persona" }],
  },
  // Luis Miguel: implante; la primera cita fue hace dos días abiertos y espera el presupuesto.
  {
    canal: "whatsapp", estado: "persona", tipo: "Implante", variante: 3, nombre: "Luis Miguel", dia: -5, hora: "16:10",
    datos: { tratamiento: "Implante", primera_visita: "Sí", seguro: "Sin seguro" }, etiquetas: ["implante"], elige: 1,
    visita: { od: -2, hora: 12 },
    mensajes: [
      c("Hola, buenas tardes. Quería valorar un implante"),
      a("¡Buenas tardes! {presentacion}Claro. " + PRIMERA),
      c("Primera vez"),
      a(SEGURO),
      c("Sin seguro"),
      a("Perfecto. " + OFERTA),
      c("El primero"),
      a(CONFIRMA),
      c("Gracias por atenderme. ¿El presupuesto me lo mandáis por aquí?", { en: visita(0, "18:40") }),
      tu("Sí, Luis Miguel. Te lo mandamos por email mañana."),
      c("Perfecto, gracias"),
    ],
    acciones: [
      { antes: 8, tipo: "persona" },
      { tipo: "ficha", presupuesto: IMPORTES.implanteOtro, etiquetas: ["implante", "presupuesto enviado"], nota: PRESUPUESTO_ENVIADO, en: visita(1, "10:30") },
    ],
  },

  // ---- Pasados a recepción por el asistente (4) ----

  // Pablo Herrero: posible urgencia; la regla de la clínica le da el 112 y lo pasa a recepción.
  {
    canal: "formulario", estado: "persona", tipo: "Urgencia", variante: 1, nombre: "Pablo Herrero", od: -1, hora: "09:40",
    datos: {}, motivo: "Posible urgencia",
    mensajes: [
      PLANTILLA,
      c("Buenas, se me ha partido una muela y me duele mucho"),
      a(URGENCIA, { pase: true }),
      tu("Hola, soy de recepción. Te llamo ahora para verlo."),
      c("Vale, gracias"),
    ],
  },
  // Mercedes: pide hablar con una persona; después no contesta.
  {
    canal: "whatsapp", estado: "persona", tipo: "Revisión", variante: 1, nombre: "Mercedes", od: -15, hora: "11:20",
    datos: { tratamiento: "Revisión" }, motivo: "Pide hablar con una persona", cierre: { accion: "no", motivo: "No contesta" },
    mensajes: [
      c("Hola, quería pedir cita para mi madre"),
      a("¡Hola! {presentacion}Claro. ¿Qué necesita, en una frase?"),
      c("Prefiero hablar con una persona, es mayor y quiero explicarlo bien"),
      a("Claro, sin problema. Te paso con recepción, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Mercedes, soy de recepción. ¿Te va bien que te llame ahora y lo vemos?"),
    ],
    acciones: [
      { tipo: "tarea", texto: "Llamar a Mercedes para la cita de su madre", en: creacion(1, "10:00"), hecha: creacion(2, "11:30") },
      { tipo: "cierre", en: creacion(5, "10:00") },
    ],
  },
  // Javier Prieto: pregunta por un presupuesto que ya le dieron; se lo piensa.
  {
    canal: "formulario", estado: "persona", tipo: "Implante", variante: 4, nombre: "Javier Prieto", od: -13, hora: "19:10",
    datos: { tratamiento: "Implante", primera_visita: "No, ya es paciente" }, etiquetas: ["implante"], motivo: "Pregunta por un presupuesto que ya le dimos",
    cierre: { accion: "no", motivo: "Se lo ha pensado" },
    mensajes: [
      PLANTILLA,
      c("Hola, ya estuve en la clínica y me disteis presupuesto para un implante. Quería preguntar por la financiación"),
      a("Gracias, {nombre}. Lo de tu presupuesto lo lleva recepción: " + PASE, { pase: true }),
      tu("Hola, Javier, soy de recepción. Se puede pagar en 12 meses sin intereses. ¿Te lo preparamos así?"),
      c("Me lo pienso y os digo, gracias"),
      c("Al final lo dejo para más adelante", { en: creacion(4, "18:30") }),
      tu("Entendido, Javier. Cuando quieras retomarlo, escríbenos por aquí."),
    ],
    acciones: [
      { antes: 3, tipo: "ficha", presupuesto: IMPORTES.implanteOtro },
      { tipo: "cierre" },
    ],
  },
  // Rocío G.: molesta porque no le cogen el teléfono para cambiar su cita.
  {
    canal: "whatsapp", estado: "persona", tipo: "Revisión", variante: 2, nombre: "Rocío G.", od: -2, hora: "12:30",
    datos: {}, motivo: "Está molesta",
    mensajes: [
      c("Hola, ¿esto es la clínica?"),
      a("¡Hola! {presentacion}Sí. ¿En qué te puedo ayudar?"),
      c("Llevo dos días llamando y nadie coge el teléfono. Quiero cambiar mi cita"),
      a("Perdona las molestias. Te paso con recepción, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Rocío, soy de recepción. Disculpa, hemos tenido la centralita saturada. ¿Para qué día la tenías?"),
      c("Para el jueves por la tarde, pero no puedo ir"),
    ],
  },

  // ---- Hablando con el asistente (10) ----

  // Paco: solo quería el precio y pide que no le escriban más.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "Limpieza", variante: 2, nombre: "Paco", dia: -20, hora: "12:10",
    datos: { tratamiento: "Limpieza" },
    mensajes: [
      c("Hola, ¿cuánto cuesta una limpieza?"),
      a("¡Hola! {presentacion}Los precios te los explican en la clínica. " + PRIMERA),
      c("Solo quería el precio. No me escribáis más", { baja: true }),
      a("{baja}"),
    ],
  },
  {
    canal: "formulario", estado: "conversacion", tipo: "Ortodoncia invisible", variante: 3, nombre: "Carolina Méndez", dia: -27, hora: "22:40",
    datos: { tratamiento: "Ortodoncia invisible", primera_visita: "Sí" },
    mensajes: [
      PLANTILLA,
      c("Buenos días, quería información de ortodoncia invisible"),
      a("¡Buenos días, {nombre}! Claro. " + PRIMERA),
      c("Primera. ¿Cuánto cuesta más o menos?"),
      a("Depende de cada caso: te lo explican en la primera visita, sin compromiso. " + SEGURO),
    ],
  },
  {
    canal: "whatsapp", estado: "conversacion", tipo: "Revisión", variante: 3, nombre: "Alberto", dia: -25, hora: "10:05",
    datos: { tratamiento: "Revisión" },
    mensajes: [
      c("Buenas, ¿abrís los sábados?"),
      a("¡Buenas! {presentacion}Abrimos de lunes a viernes, de 9:00 a 14:00 y de 16:00 a 20:00. ¿Qué necesitas, en una frase?"),
      c("Una revisión, pero entre semana no puedo"),
      a("Entendido. Si algún día entre semana te va bien, me escribes por aquí y te busco cita."),
    ],
  },
  {
    canal: "formulario", estado: "conversacion", tipo: "Revisión", variante: 4, nombre: "Nerea Ibáñez", dia: -23, hora: "21:20",
    datos: { tratamiento: "Revisión", primera_visita: "Sí" },
    mensajes: [
      PLANTILLA,
      c("Hola, quería pedir cita para una revisión"),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("Primera visita"),
      a(SEGURO),
    ],
  },
  {
    canal: "whatsapp", estado: "conversacion", tipo: "Blanqueamiento", variante: 2, nombre: "Gemma", dia: -19, hora: "17:40",
    datos: { tratamiento: "Blanqueamiento", primera_visita: "Sí" }, etiquetas: ["blanqueamiento"],
    mensajes: [
      c("¡Hola! Quería un blanqueamiento antes de una boda en diciembre"),
      a("¡Hola! {presentacion}Claro. " + PRIMERA),
      c("Primera"),
      a("Perfecto. Te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
  },
  {
    canal: "formulario", estado: "conversacion", tipo: "Limpieza", variante: 3, nombre: "Hugo Sanz", dia: -16, hora: "13:30",
    datos: { tratamiento: "Limpieza", seguro: "Sanitas" },
    mensajes: [
      PLANTILLA,
      c("Hola, ¿trabajáis con Sanitas?"),
      a("¡Hola, {nombre}! Trabajamos con las mutuas dentales más habituales; lo revisamos en la primera visita. ¿Qué necesitas, en una frase?"),
      c("Una limpieza"),
      a(PRIMERA),
    ],
  },
  {
    canal: "whatsapp", estado: "conversacion", tipo: "Revisión", variante: 5, nombre: "Silvia R.", dia: -12, hora: "09:30",
    datos: { tratamiento: "Revisión", primera_visita: "Sí" },
    mensajes: [
      c("Buenos días, quería pedir cita para mi hijo de 8 años, una revisión"),
      a("¡Buenos días! {presentacion}Claro. ¿Sería su primera visita o ya es paciente?"),
      c("Primera"),
      a("Perfecto. Te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
      c("Tengo que mirar el horario del cole y te digo"),
      a("Sin problema. Cuando lo sepas, me dices por aquí."),
    ],
  },
  {
    canal: "formulario", estado: "conversacion", tipo: "Implante", variante: 5, nombre: "Mohamed Benali", dia: -9, hora: "20:45",
    datos: { tratamiento: "Implante", primera_visita: "Sí", seguro: "Sin seguro" },
    mensajes: [
      PLANTILLA,
      c("Hola, quería información de implantes"),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("Primera, y no tengo mutua"),
      a("Perfecto. Te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
  },
  {
    canal: "whatsapp", estado: "conversacion", tipo: "Ortodoncia invisible", variante: 4, nombre: "Inés", dia: -5, hora: "19:10",
    datos: { tratamiento: "Ortodoncia invisible", primera_visita: "Sí" },
    mensajes: [
      c("¡Hola! ¿Hacéis ortodoncia invisible?"),
      a("¡Hola! {presentacion}Sí. " + PRIMERA),
      c("Primera. ¿Se puede financiar?"),
      a("Las formas de pago te las explican en la primera visita. " + SEGURO),
    ],
  },
  // Pilar Navarro (ayer): contesta por la noche y vuelve hoy por la mañana.
  {
    canal: "formulario", estado: "conversacion", tipo: "Revisión", variante: 6, nombre: "Pilar Navarro", dia: -1, hora: "21:00",
    datos: { tratamiento: "Revisión", primera_visita: "Sí", seguro: "DKV" }, acciones: [],
    mensajes: [
      PLANTILLA,
      c("Hola, quería una revisión", { en: dia(-1, "21:12") }),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("Primera visita"),
      a(SEGURO),
      c("DKV", { en: dia(0, "08:30") }),
      a("Perfecto. Te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
  },

  // ---- Con cita (7), en la rejilla de 30 minutos ----

  {
    canal: "formulario", estado: "visita", tipo: "Limpieza", variante: 4, nombre: "Laura Castells", dia: -4, hora: "21:10",
    datos: { tratamiento: "Limpieza", primera_visita: "Sí", seguro: "Adeslas" }, elige: 1, visita: { od: 0, hora: 4 }, acciones: [],
    mensajes: [
      PLANTILLA,
      c("Hola, quería pedir cita para una limpieza"),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("Primera visita"),
      a(SEGURO),
      c("Adeslas"),
      a("Perfecto. " + OFERTA),
      c("El primero"),
      a(CONFIRMA),
    ],
  },
  {
    canal: "whatsapp", estado: "visita", tipo: "Revisión", variante: 6, nombre: "Nacho", dia: -3, hora: "13:20",
    datos: { tratamiento: "Revisión", primera_visita: "No, ya es paciente", seguro: "Sanitas" }, elige: 2, visita: { od: 0, hora: 13 }, acciones: [],
    mensajes: [
      c("Hola, ¿me dais cita para una revisión?"),
      a("¡Hola! {presentacion}Claro. " + PRIMERA),
      c("Ya soy paciente"),
      a("Perfecto. ¿Sigues con la misma mutua?"),
      c("Sí, la misma"),
      a("Genial. " + OFERTA),
      c("El segundo, por la tarde mejor"),
      a(CONFIRMA),
    ],
  },
  {
    canal: "formulario", estado: "visita", tipo: "Blanqueamiento", variante: 3, nombre: "Olga Petrova", dia: -3, hora: "22:50",
    datos: { tratamiento: "Blanqueamiento", primera_visita: "Sí", seguro: "Sin seguro" }, etiquetas: ["blanqueamiento"], elige: 1, visita: { od: 1, hora: 2 }, acciones: [],
    mensajes: [
      PLANTILLA,
      c("Buenos días. Quiero un blanqueamiento, por favor"),
      a("¡Buenos días, {nombre}! Claro. " + PRIMERA),
      c("Primera"),
      a(SEGURO),
      c("No tengo"),
      a("Perfecto. " + OFERTA),
      c("El primero"),
      a(CONFIRMA),
    ],
  },
  {
    canal: "whatsapp", estado: "visita", tipo: "Ortodoncia invisible", variante: 5, nombre: "Dani", dia: -2, hora: "11:45",
    datos: { tratamiento: "Ortodoncia invisible", primera_visita: "Sí", seguro: "DKV" }, etiquetas: ["ortodoncia"], elige: 2, visita: { od: 2, hora: 15 }, acciones: [],
    mensajes: [
      c("Hola! Me interesa la ortodoncia invisible"),
      a("¡Hola! {presentacion}Claro. " + PRIMERA),
      c("Primera"),
      a(SEGURO),
      c("DKV"),
      a("Perfecto. " + OFERTA),
      c("El segundo"),
      a(CONFIRMA),
    ],
  },
  {
    canal: "formulario", estado: "visita", tipo: "Revisión", variante: 7, nombre: "Teresa Campos Ruiz", dia: -2, hora: "20:20",
    datos: { tratamiento: "Revisión", primera_visita: "No, ya es paciente" }, elige: 1, visita: { od: 3, hora: 6 }, acciones: [],
    mensajes: [
      PLANTILLA,
      c("Hola, me toca la revisión de cada año"),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("Ya soy paciente"),
      a("Perfecto. ¿Sigues con la misma mutua?"),
      c("Sí"),
      a("Genial. " + OFERTA),
      c("El primero"),
      a(CONFIRMA),
    ],
  },
  {
    canal: "formulario", estado: "visita", tipo: "Implante", variante: 6, nombre: "joan sala", dia: -1, hora: "09:15",
    datos: { tratamiento: "Implante", primera_visita: "Sí", seguro: "Sin seguro" }, etiquetas: ["implante"], elige: 2, visita: { od: 5, hora: 11 }, acciones: [],
    mensajes: [
      PLANTILLA,
      c("hola, queria valorar un implante"),
      a("¡Hola, {nombre}! Claro. " + PRIMERA),
      c("primera vez"),
      a(SEGURO),
      c("no"),
      a("Perfecto. " + OFERTA),
      c("el segundo"),
      a(CONFIRMA),
    ],
  },
  {
    canal: "whatsapp", estado: "visita", tipo: "Limpieza", variante: 5, nombre: "Yolanda", dia: -1, hora: "18:30",
    datos: { tratamiento: "Limpieza", primera_visita: "No, ya es paciente", seguro: "Adeslas" }, elige: 1, visita: { od: 7, hora: 1 }, acciones: [],
    mensajes: [
      c("Buenas tardes, quería cita para una limpieza"),
      a("¡Buenas tardes! {presentacion}Claro. " + PRIMERA),
      c("Ya soy paciente"),
      a("Perfecto. ¿Sigues con la misma mutua?"),
      c("Sí, Adeslas"),
      a("Genial. " + OFERTA),
      c("El primero"),
      a(CONFIRMA),
    ],
  },

  // ---- Nuevos (5): cuatro del formulario que no contestaron y uno añadido a mano ----

  { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 1, nombre: "Rubén Soto", dia: -21, hora: "22:10", datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta() },
  { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 2, nombre: "maría josé pérez", dia: -14, hora: "15:20", datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta() },
  { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 3, nombre: "Aitana Ruiz Molina", dia: -8, hora: "21:05", datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta() },
  { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 4, nombre: "Kevin Smith", dia: -2, hora: "23:15", datos: {}, mensajes: [PLANTILLA], acciones: [] },
  {
    canal: "manual", estado: "nuevo", tipo: "Limpieza", variante: 6, nombre: "Josefina Martí", dia: -10, hora: "11:00",
    datos: { tratamiento: "Limpieza" }, mensajes: [],
    acciones: [{ tipo: "nota", texto: "Ha llamado por teléfono: quiere cita para una limpieza." }],
  },

  // ---- Publicidad (2) ----

  // Lo para el código (detectarSpam): enlace acortado y ganchos; sin respuesta.
  {
    canal: "whatsapp", estado: "spam", tipo: "spam", variante: 1, nombre: "Promo Dental Pro", dia: -17, hora: "02:50",
    datos: {}, porRegla: true, motivo: "Enlace raro (tinyurl.com) y publicidad («pincha aqui», «oferta exclusiva»)",
    mensajes: [c("Oferta exclusiva para clínicas: 30 % de descuento en material. Pincha aquí: tinyurl.com/promo-dental")],
  },
  // Un proveedor: el asistente contesta una vez y lo marca.
  {
    canal: "whatsapp", estado: "spam", tipo: "spam", variante: 2, nombre: "Laboratorio Dental Sur", dia: -9, hora: "10:15",
    datos: {}, motivo: "Proveedor ofreciendo material",
    mensajes: [
      c("Buenos días, somos un laboratorio dental y trabajamos con clínicas de la zona. ¿Os puedo enviar nuestro catálogo?"),
      a("¡Hola! {presentacion}Gracias, pero ahora mismo no buscamos proveedores. ¡Que vaya bien!"),
    ],
  },
];

/** Los datos del sector: guiones, cuotas por etapa y lo que el motor necesita para completar. */
export const DATOS_CLINICA: DatosSemilla = {
  semilla: 20_261_113,
  nombres: {
    formulario: ["Cristina Vallès", "Óscar Lara", "Patricia Soler", "Enric Bosch"],
    whatsapp: ["Mari Carmen", "Toni", "Lidia", "Jorge M."],
  },
  // La clínica no pide zona: su vocabulario la tiene a null.
  zonas: [],
  servicios: [
    { tipo: "Limpieza", etiqueta: "Limpieza", rango: [0, 0], datos: {} },
    { tipo: "Revisión", etiqueta: "Revisión", rango: [0, 0], datos: {} },
  ],
  conversaciones: CONVERSACIONES_CLINICA,
  cuotas: { nuevo: 5, conversacion: 10, visita: 7, persona: 11, spam: 2 },
  tareas: [],
  notas: [],
  fuentes: { campana: "Clínica dental", anuncio: "¿Te toca revisión? Pide cita por WhatsApp" },
};

/** El generador de la clínica: los datos de arriba con el motor genérico. */
export function generarClinica(o: OpcionesSemilla, ahora: Date): SemillaGenerada {
  return generarSector(DATOS_CLINICA, o, ahora);
}
