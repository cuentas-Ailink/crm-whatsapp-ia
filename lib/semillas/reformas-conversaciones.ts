// Las conversaciones de los ejemplos de reformas: un mes de un estudio de Barcelona, lead a lead, en
// el orden de la tabla del plan (día de llegada, de más antiguo a hoy). Salen de la biblioteca de la
// auditoría de realismo, adaptadas a lo que el producto hace de verdad:
//
// - El asistente pregunta qué, metros y plazo, de una en una; para reservar ofrece dos huecos y
//   confirma el elegido con «Hecho, visita reservada para el {hueco}. Si prefieres hablar con una
//   persona, dímelo por aquí.». No da precios, no promete presupuestos antes de la visita y no
//   asesora sobre licencias (eso lo pasa a una persona, que «te escribe en cuanto pueda»).
// - El asistente no promete mensajes que ningún código envía: nada de avisos antes de la visita.
// - Se presenta como asistente virtual en su primer mensaje si la plantilla no lo ha dicho:
//   {presentacion} lo resuelve el motor según el cuerpo de la plantilla.
// - Lo que escribe el dueño (manual) solo va dentro de las 24 h del último mensaje del cliente.
//
// Marcas: {plantilla}, {nombre}, {presentacion}, {hueco1}/{hueco2} (los dos de la reserva), {hueco}
// (el elegido), {libre1}/{libre2} (lo que ofrecería el asistente en ese momento), {diaHueco},
// {horaHueco}, {baja}; en las notas, {fecha} e {importe:N}.

import type { AccionSemilla, AnclaSemilla, ConversacionSemilla, MensajeGuion } from "./tipos";

type Extra = Omit<MensajeGuion, "de" | "texto">;

const PLANTILLA: MensajeGuion = { de: "agente", texto: "{plantilla}", plantilla: true };
const c = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "cliente", texto, ...extra });
const a = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "agente", texto, ...extra });
/** Lo escribe el dueño desde el panel (el panel lo pinta «Tú»). */
const tu = (texto: string, extra: Extra = {}): MensajeGuion => ({ de: "agente", texto, manual: true, ...extra });

const visita = (od: number, hora: string): AnclaSemilla => ({ desde: "visita", od, hora });
const creacion = (od: number, hora: string): AnclaSemilla => ({ desde: "creacion", od, hora });
const hoyOd = (od: number, hora: string): AnclaSemilla => ({ desde: "hoy", od, hora });
const dia = (d: number, hora: string): AnclaSemilla => ({ dia: d, hora });

const CONFIRMA = "Hecho, visita reservada para el {hueco}. Si prefieres hablar con una persona, dímelo por aquí.";
const CONFIRMA_OS = "Hecho, visita reservada para el {hueco}. Si preferís hablar con una persona, decídmelo por aquí.";
const LLAMAR_SIN_RESPUESTA = "Llamar: no contesta al WhatsApp";
const PRESUPUESTO_ENVIADO = "Presupuesto enviado el {fecha}";

/** Un nuevo del formulario que nunca contestó: el dueño le llamó al día siguiente, sin suerte. */
function sinRespuesta(): AccionSemilla[] {
  return [{ tipo: "tarea", texto: LLAMAR_SIN_RESPUESTA, en: creacion(1, "10:10"), hecha: creacion(2, "12:30") }];
}

export const CONVERSACIONES_REFORMAS: ConversacionSemilla[] = [
  // 1 · Cristina Navarro: visita, presupuesto y «Ha dicho que sí» con la señal del 30 %.
  {
    canal: "formulario", estado: "persona", tipo: "cocina", variante: 1, nombre: "Cristina Navarro", dia: -29, hora: "21:40", zona: "Sarrià",
    datos: { tipo: "Cocina", metros: "12 m²", plazo: "después de Reyes" }, etiquetas: ["cocina"], elige: 1,
    visita: { desde: "creacion", od: 3, hora: 0 }, cierre: { accion: "si", importe: 18_640, cobrado: 5_592 },
    mensajes: [
      PLANTILLA,
      c("¡Hola! La cocina, que es de los años 80 y está fatal 😅"),
      a("¡Hola, {nombre}! {presentacion}Pues vamos a darle una vuelta 🙂 ¿Cuántos metros tiene, más o menos?"),
      c("Unos 12, creo"),
      a("Perfecto. ¿Y para cuándo te gustaría empezar?"),
      c("Después de Reyes, si puede ser"),
      a("Genial. Para verla en persona te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?"),
      c("El primero"),
      a(CONFIRMA),
      c("Gracias por venir esta mañana. ¿Para cuándo tendríais el presupuesto?", { en: visita(0, "18:20") }),
      tu("¡Gracias a ti, Cristina! Te lo enviamos por email a principios de la semana que viene."),
      c("¡Hola! Lo hemos estado mirando y nos decidimos: lo hacemos con vosotros 😊 ¿Cómo hacemos la señal?", { en: visita(7, "18:30") }),
      tu("¡Qué buena noticia, Cristina! Te mando por email el contrato y la cuenta para la señal del 30 %."),
      c("¡Perfecto, gracias!"),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 11, tipo: "ficha", presupuesto: 18_640, etiquetas: ["cocina", "presupuesto enviado"], nota: PRESUPUESTO_ENVIADO, en: visita(2, "12:10") },
      { tipo: "tarea", texto: "Firmar contrato y pedir señal del 30 %", hecha: visita(9, "10:20") },
      { tipo: "cierre", en: visita(9, "10:30") },
      { tipo: "ficha", etiquetas: ["cocina", "presupuesto aceptado"] },
      { tipo: "tarea", texto: "Pedir el comunicat d'obres al Ajuntament", vence: { od: 5 }, en: hoyOd(-1, "10:20") },
    ],
  },
  // 2 · Laia Soler: formulario sin respuesta.
  {
    canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 1, nombre: "Laia Soler", dia: -29, hora: "22:05", zona: "Poble-sec",
    datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta(),
  },
  // 3 · Toni Ruiz: pregunta el precio y no sigue.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "baño", variante: 1, nombre: "Toni Ruiz", dia: -28, hora: "10:20",
    datos: { tipo: "Baño", metros: "5 m²" }, etiquetas: ["baño"],
    mensajes: [
      c("Hola, quería pedir presupuesto para reformar el baño"),
      a("¡Hola! {presentacion}¿Cuántos metros tiene el baño, más o menos?"),
      c("Unos 5. ¿Más o menos cuánto me puede salir?"),
      a("Sin verlo no te puedo dar una cifra fiable: depende de lo que haya debajo y de los acabados. ¿Para cuándo te gustaría hacerlo?"),
    ],
  },
  // 4 · David Ribas: visita, presupuesto y «Ha dicho que sí».
  {
    canal: "formulario", estado: "persona", tipo: "baño", variante: 2, nombre: "David Ribas", dia: -27, hora: "13:15", zona: "Eixample",
    datos: { tipo: "Baño", metros: "6 m²", plazo: "antes de Navidad" }, etiquetas: ["baño"], elige: 1,
    visita: { desde: "creacion", od: 4, hora: 0 }, cierre: { accion: "si", importe: 10_460, cobrado: 3_138 },
    mensajes: [
      PLANTILLA,
      c("Hola, buenas. Quería cambiar la bañera por un plato de ducha y renovar todo el baño"),
      a("¡Hola, {nombre}! {presentacion}¿Cuántos metros tiene el baño, más o menos?"),
      c("Unos 6. ¿Y cuánto costaría, más o menos?"),
      a("Sin verlo no te puedo dar una cifra fiable, porque depende de lo que haya debajo y de los acabados. ¿Para cuándo te gustaría hacerlo?"),
      c("Antes de Navidad, si se puede"),
      a("Entendido. Un técnico puede pasar a verlo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?"),
      c("El primero, perfecto"),
      a(CONFIRMA),
      c("¡Hola! Nos ha encajado el presupuesto. ¿Cuándo podríais empezar?", { en: visita(6, "17:30") }),
      tu("¡Genial, David! Te paso por email el contrato. Con la señal del 30 % reservamos la fecha de inicio."),
      c("Perfecto, lo miro esta noche"),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 9, tipo: "ficha", presupuesto: 10_460, etiquetas: ["baño", "presupuesto enviado"], nota: PRESUPUESTO_ENVIADO, en: visita(2, "11:40") },
      { tipo: "tarea", texto: "Firmar contrato y pedir señal del 30 %", hecha: visita(7, "10:50") },
      { tipo: "cierre", en: visita(7, "11:00") },
      { tipo: "ficha", etiquetas: ["baño", "presupuesto aceptado"] },
      { tipo: "tarea", texto: "Encargar la mampara a medida", vence: { od: 2 }, en: hoyOd(-2, "12:10") },
    ],
  },
  // 5 · Ferran: lo tiene que hablar con su pareja.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "cocina", variante: 2, nombre: "Ferran", dia: -27, hora: "18:40",
    datos: { tipo: "Cocina", metros: "10 m²", plazo: "después de Reyes" }, etiquetas: ["cocina"],
    mensajes: [
      c("¡Buenas! Queremos cambiar los muebles de la cocina y la encimera. Son unos 10 m²"),
      a("¡Buenas! {presentacion}¿Para cuándo os gustaría empezar?"),
      c("Después de Reyes"),
      a("Genial. Para verla os propongo el {libre1} o el {libre2}. ¿Cuál os va mejor?"),
      c("Lo tengo que hablar con mi pareja, que tiene un horario complicado"),
      a("Claro, sin problema. Cuando lo sepáis, me decís por aquí."),
    ],
  },
  // 6 · Rosa Camps: pasa a una persona por la bajante y el dueño lo devuelve al asistente.
  {
    canal: "formulario", estado: "conversacion", tipo: "baño", variante: 3, nombre: "Rosa Camps", dia: -26, hora: "20:50", zona: "El Born",
    datos: { tipo: "Baño", metros: "4 m²" }, etiquetas: ["baño", "comunidad"], motivo: "Bajante comunitaria: permiso de la comunidad",
    mensajes: [
      PLANTILLA,
      c("Buenos días. Quiero mover el baño a donde ahora está el lavadero, para ganar una habitación", { en: creacion(1, "09:20") }),
      a("¡Buenos días, {nombre}! {presentacion}¿Cuántos metros tendría el baño nuevo, más o menos?"),
      c("Unos 4. El administrador de la finca dice que por la bajante necesito permiso de la comunidad", { audio: true }),
      a("Gracias por contármelo. Si hay que tocar la bajante y pedir permiso a la comunidad, es mejor que lo lleve alguien del equipo: te paso con un compañero, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Rosa, he visto lo de la bajante. Hasta que la comunidad no dé el permiso no podemos mover el baño. ¿Tenéis ya fecha de junta?"),
      c("La junta es a final de mes. Cuando lo aprueben, os digo"),
      tu("Perfecto, Rosa. Mientras tanto, cualquier duda nos la puedes escribir por aquí."),
    ],
    acciones: [
      { tipo: "devuelto" },
      { tipo: "nota", texto: "La comunidad vota la bajante en la junta de final de mes." },
      { tipo: "tarea", texto: "Pedir a la comunidad el acta de la bajante", vence: { od: 5 }, en: hoyOd(-2, "16:30") },
    ],
  },
  // 7 · Paula Riera: visita y presupuesto; «No sigue · Precio».
  {
    canal: "formulario", estado: "persona", tipo: "cocina", variante: 3, nombre: "Paula Riera", dia: -24, hora: "21:30", zona: "Horta",
    datos: { tipo: "Cocina", metros: "10 m²", plazo: "en primavera" }, etiquetas: ["cocina"], elige: 2,
    visita: { desde: "creacion", od: 3, hora: 2 }, cierre: { accion: "no", motivo: "Precio" },
    mensajes: [
      PLANTILLA,
      c("¡Hola! Queremos cambiar la cocina entera, está muy vieja"),
      a("¡Hola, {nombre}! {presentacion}¿Cuántos metros tiene, más o menos?"),
      c("Unos 10"),
      a("Perfecto. ¿Para cuándo os gustaría empezar?"),
      c("En primavera"),
      a("Genial. Para verla os propongo el {hueco1} o el {hueco2}. ¿Cuál os va mejor?"),
      c("El segundo, que ese día estamos los dos"),
      a(CONFIRMA_OS),
      c("¡Hola! Gracias por venir ayer. ¿Cuándo tendríamos el presupuesto?", { en: visita(1, "13:20") }),
      tu("¡Hola, Paula! Lo estamos terminando: te lo enviamos por email mañana."),
      c("Hola, gracias por el presupuesto. De momento lo dejamos, se nos va de lo que teníamos pensado.", { en: visita(4, "12:40") }),
      tu("Entendido, Paula, gracias por avisar. Si lo retomáis, aquí estamos."),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { tipo: "cierre", nota: "Le pasamos {importe:13950}: se le va de presupuesto." },
    ],
  },
  // 8 · Sara | Marketing: una agencia; el asistente contesta una vez y lo marca como publicidad.
  {
    canal: "whatsapp", estado: "spam", tipo: "spam", variante: 1, nombre: "Sara | Marketing", dia: -23, hora: "11:05",
    datos: {}, motivo: "Publicidad de una agencia",
    mensajes: [
      c("¡Hola! Somos una agencia y conseguimos 30 clientes de reformas al mes con anuncios. ¿Te va bien una llamada de 10 min?"),
      a("¡Hola! {presentacion}Gracias por escribirnos, pero ahora mismo no nos interesa. ¡Que vaya bien!"),
    ],
  },
  // 9 · Gemma Pujol: deja de contestar.
  {
    canal: "formulario", estado: "conversacion", tipo: "terraza", variante: 1, nombre: "Gemma Pujol", dia: -23, hora: "22:15", zona: "Sant Andreu",
    datos: { tipo: "Terraza", metros: "16 m²" }, etiquetas: ["terraza"],
    mensajes: [
      PLANTILLA,
      c("¡Hola! La terraza del ático"),
      a("¡Hola, {nombre}! {presentacion}¿Cuántos metros tiene la terraza, más o menos?"),
      c("Unos 16. Queremos cambiar el suelo y poner una pérgola"),
      a("Perfecto. ¿Para cuándo te gustaría empezar?"),
    ],
  },
  // 10 · Edu: pide una horquilla de precio.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "suelos", variante: 1, nombre: "Edu", dia: -22, hora: "09:40",
    datos: { tipo: "Suelos", metros: "70 m²" }, etiquetas: ["suelos"],
    mensajes: [
      c("Buenas, ¿cuánto cuesta cambiar el suelo de un piso de 70 metros?"),
      a("¡Buenas! {presentacion}Sin verlo no te puedo dar una cifra fiable, porque depende del suelo que haya ahora y del material. ¿Para cuándo te gustaría hacerlo?"),
      c("Pero aproximado, una horquilla"),
      a("Te entiendo, pero cualquier cifra sin verlo podría no parecerse al presupuesto real. Para verlo te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
      c("Ya, es que estoy pidiendo varios presupuestos y no quiero hacer venir a todo el mundo", { audio: true }),
      a("Lo entiendo perfectamente. Si te decides, me dices por aquí y te busco hueco."),
    ],
  },
  // 11 · Valentina Rojas: «más adelante».
  {
    canal: "whatsapp", estado: "conversacion", tipo: "plato de ducha", variante: 1, nombre: "Valentina Rojas", dia: -22, hora: "19:30",
    datos: { tipo: "Plato de ducha" }, etiquetas: ["baño"],
    mensajes: [
      c("Hola, buenas tardes. Quería información para cambiar la bañera por un plato de ducha"),
      a("¡Buenas tardes! {presentacion}Claro. ¿Para cuándo te gustaría hacerlo?"),
      c("Es para más adelante, ahora solo estoy mirando"),
      a("Sin problema. Cuando quieras, me escribes por aquí y te propongo un par de días para verlo."),
    ],
  },
  // 12 · Mireia: deja de contestar.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "cocina", variante: 4, nombre: "Mireia", dia: -21, hora: "12:45",
    datos: { tipo: "Cocina", metros: "8 m²" }, etiquetas: ["cocina"],
    mensajes: [
      c("¡Hola! Quiero reformar la cocina, es pequeñita"),
      a("¡Hola! {presentacion}¿Cuántos metros tiene, más o menos?"),
      c("Unos 8 m²"),
      a("Perfecto. ¿Para cuándo te gustaría empezar?"),
    ],
  },
  // 13 · Andrés Gómez: pasa a una persona por la licencia; tras la llamada, vuelve al asistente.
  {
    canal: "formulario", estado: "conversacion", tipo: "local", variante: 1, nombre: "Andrés Gómez", dia: -20, hora: "21:55", zona: "Sants",
    datos: { tipo: "Local comercial", metros: "120 m²", plazo: "lo antes posible" }, etiquetas: ["local", "licencia"],
    motivo: "Local de 120 m²: licencia de actividad",
    mensajes: [
      PLANTILLA,
      c("Buenos días. Tengo un local de 120 m² y quiero montar un restaurante", { en: creacion(1, "08:50") }),
      a("¡Buen proyecto, {nombre}! {presentacion}¿Para cuándo te gustaría empezar?"),
      c("Lo antes posible. Necesitaría también la licencia de actividad, no sé cómo va eso", { audio: true }),
      a("Lo de la licencia lo lleva directamente el equipo, así que te paso con un compañero, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Andrés, te escribo del estudio. Para un restaurante hace falta proyecto de actividad y salida de humos. ¿Te va bien que lo hablemos por teléfono esta tarde?"),
      c("Sí, a partir de las 17:00"),
      tu("Perfecto, hablamos a las 17:00."),
      c("Hola, lo he hablado con mi socio y seguimos adelante. ¿Qué tenemos que hacer ahora?", { en: creacion(2, "10:40") }),
      a("¡Qué bien! Cuando sepáis qué día podéis venir los dos al local, me lo dices por aquí y te propongo un par de huecos para verlo."),
    ],
    acciones: [
      { antes: 8, tipo: "nota", texto: "Llamada hecha: restaurante, necesita proyecto de actividad y salida de humos.", en: creacion(1, "17:40") },
      { antes: 8, tipo: "devuelto" },
    ],
  },
  // 14 · Óscar: pide que no le escriban más.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "vivienda entera", variante: 1, nombre: "Óscar", dia: -19, hora: "17:20",
    datos: { tipo: "Vivienda entera", metros: "65 m²" }, etiquetas: ["vivienda entera"],
    mensajes: [
      c("Hola, quería información para reformar un piso de 65 m²"),
      a("¡Hola! {presentacion}¿Para cuándo te gustaría empezar?"),
      c("No lo sé todavía, estoy mirando opciones"),
      a("Sin problema. Para verlo te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
      c("No me escribáis más, gracias", { baja: true }),
      a("{baja}"),
    ],
  },
  // 15 · Anna Bertran: formulario sin respuesta.
  {
    canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 2, nombre: "Anna Bertran", dia: -19, hora: "21:15", zona: "Gràcia",
    datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta(),
  },
  // 16 · Quim: pregunta cuánto dura la obra.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "baño", variante: 4, nombre: "Quim", dia: -18, hora: "11:30",
    datos: { tipo: "Baño", metros: "5 m²", plazo: "en enero" }, etiquetas: ["baño"],
    mensajes: [
      c("¡Hola! ¿Cuánto se tarda en reformar un baño de 5 metros?"),
      a("¡Hola! {presentacion}Depende de lo que haya que hacer, y eso lo concreta el equipo después de ver el baño. ¿Para cuándo te gustaría empezar?"),
      c("En enero, pero no podemos estar muchos días sin baño"),
      a("Entendido, lo tendrá en cuenta el técnico. Para verlo te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
  },
  // 17 · Elena Costa: visita y presupuesto; tras la llamada de seguimiento, «No sigue · Ha elegido a otro».
  {
    canal: "formulario", estado: "persona", tipo: "cocina", variante: 5, nombre: "Elena Costa", dia: -17, hora: "22:40", zona: "Les Corts",
    datos: { tipo: "Cocina", metros: "13 m²", plazo: "en febrero" }, etiquetas: ["cocina"], elige: 2,
    visita: { desde: "creacion", od: 4, hora: 2 }, cierre: { accion: "no", motivo: "Ha elegido a otro" },
    mensajes: [
      PLANTILLA,
      c("¡Buenos días! Es la cocina, queremos cambiarla entera"),
      a("¡Buenos días, {nombre}! {presentacion}¿Cuántos metros tiene, más o menos?"),
      c("13 m², es alargada"),
      a("Perfecto. ¿Para cuándo os gustaría empezar?"),
      c("En febrero"),
      a("Genial. Para verla os propongo el {hueco1} o el {hueco2}. ¿Cuál os va mejor?"),
      c("El segundo, que ese día salgo antes del trabajo"),
      a(CONFIRMA),
      c("Recibido el presupuesto, gracias. Lo miramos con calma.", { en: visita(2, "13:10") }),
      tu("Perfecto, Elena. Si tienes cualquier duda, me dices por aquí."),
      c("Gracias por la llamada. Al final nos quedamos con otra empresa que puede empezar antes. ¡Gracias por todo!", { en: visita(5, "12:30") }),
      tu("Gracias a ti por avisar, Elena. ¡Mucha suerte con la obra!"),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 9, tipo: "ficha", presupuesto: 16_840, etiquetas: ["cocina", "presupuesto enviado"], nota: PRESUPUESTO_ENVIADO, en: visita(2, "11:30") },
      { antes: 9, tipo: "tarea", texto: "Llamar a Elena: seguimiento del presupuesto", hecha: visita(5, "12:15") },
      { tipo: "cierre" },
    ],
  },
  // 18 · Bea: pide hablar con una persona; tras la llamada, vuelve al asistente para la visita.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "baño", variante: 5, nombre: "Bea", od: -12, hora: "09:50",
    datos: { tipo: "Baño", metros: "6 m²" }, etiquetas: ["baño"], motivo: "Pide hablar con una persona",
    mensajes: [
      c("Hola, quiero reformar el baño de mi casa"),
      a("¡Hola! {presentacion}¿Cuántos metros tiene el baño, más o menos?"),
      c("Prefiero hablar con una persona, la verdad"),
      a("Claro, sin problema. Te paso con un compañero del equipo, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Bea, te escribo del estudio. ¿Te va bien que te llame ahora y me cuentas?"),
      c("Sí, perfecto"),
      c("¡Hola de nuevo! Me ha dicho tu compañero que por aquí me buscáis día para ver el baño. Son unos 6 m²", { en: creacion(0, "12:30") }),
      a("¡Hola, Bea! Para verlo te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
    acciones: [{ antes: 6, tipo: "devuelto", en: creacion(0, "10:40") }],
  },
  // 19 · Irene Casals: la añadió el dueño a mano tras una llamada.
  {
    canal: "manual", estado: "nuevo", tipo: "plato de ducha", variante: 2, nombre: "Irene Casals", dia: -16, hora: "16:20",
    datos: { tipo: "Plato de ducha" }, mensajes: [],
    acciones: [{ tipo: "nota", texto: "Ha llamado por teléfono: quiere cambiar la bañera por un plato de ducha." }],
  },
  // 20 · Marc Valls: deja de contestar.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "suelos", variante: 2, nombre: "Marc Valls", dia: -15, hora: "13:05",
    datos: { tipo: "Suelos", metros: "90 m²" }, etiquetas: ["suelos"],
    mensajes: [
      c("¡Hola! Quiero cambiar el parquet de todo el piso, está destrozado por el perro 😅"),
      a("¡Hola! {presentacion}Pasa más de lo que parece. ¿Cuántos metros son, más o menos?"),
      c("Unos 90"),
      a("Perfecto. ¿Para cuándo te gustaría empezar?"),
    ],
  },
  // 21 · Laura G.: pregunta el precio.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "vivienda entera", variante: 2, nombre: "Laura G.", dia: -15, hora: "20:10",
    datos: { tipo: "Vivienda entera", metros: "60 m²" }, etiquetas: ["vivienda entera"],
    mensajes: [
      c("Hola. Tengo un piso de 60 m² para reformar entero. ¿Más o menos cuánto cuesta?"),
      a("¡Hola! {presentacion}Sin verlo no te puedo dar una cifra fiable: depende mucho del estado del piso y de los acabados. ¿Para cuándo te gustaría empezar?"),
      c("Pues no sé, depende del precio"),
      a("Normal. Si quieres, un técnico lo ve y el equipo te prepara el presupuesto. Te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
  },
  // 22 · Xavier Gil: «No sigue · Se lo ha pensado» y vuelve a escribir: «Ha vuelto a escribir».
  {
    canal: "formulario", estado: "persona", tipo: "vivienda entera", variante: 3, nombre: "Xavier Gil", dia: -14, hora: "21:20", zona: "Sant Gervasi",
    datos: { tipo: "Vivienda entera", metros: "110 m²", plazo: "lo antes posible" }, etiquetas: ["vivienda entera"], elige: 1,
    visita: { desde: "creacion", od: 4, hora: 0 }, cierre: { accion: "no", motivo: "Se lo ha pensado" },
    mensajes: [
      PLANTILLA,
      c("¡Hola! Acabamos de comprar un piso y queremos reformarlo entero antes de entrar a vivir"),
      a("¡Enhorabuena por el piso, {nombre}! {presentacion}¿Cuántos metros tiene, más o menos?"),
      c("110, según la escritura"),
      a("Perfecto. ¿Y para cuándo os gustaría empezar?"),
      c("Pues mira, nos dan las llaves a final de mes y ahora estamos de alquiler, así que cuanto antes mejor. La idea sería entrar a vivir antes del verano.", { audio: true }),
      a("Entendido. Para ver el piso os propongo el {hueco1} o el {hueco2}. ¿Cuál os va mejor?"),
      c("El primero, allí estaremos"),
      a(CONFIRMA_OS),
      c("Hola, hemos recibido el presupuesto. Es más de lo que esperábamos, lo tenemos que pensar", { en: visita(2, "18:10") }),
      tu("Claro, Xavier. Si queréis, lo repasamos juntos y vemos dónde se puede ajustar."),
      c("Gracias. Al final lo vamos a dejar por ahora, nos lo hemos repensado", { en: hoyOd(-3, "10:05") }),
      tu("Entendido, gracias por decírnoslo. Si en algún momento lo retomáis, aquí estamos."),
      c("¡Hola! ¿Y si lo hacemos por fases? Primero cocina y baños, y el resto más adelante", { en: hoyOd(-1, "08:40") }),
      tu("¡Hola, Xavier! Por fases se puede hacer, sí. ¿Te va bien que te llame mañana y lo vemos con el presupuesto delante?", { en: hoyOd(-1, "09:15") }),
      c("Perfecto, mañana a partir de las 10 me va bien", { en: hoyOd(-1, "09:40") }),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 9, tipo: "ficha", presupuesto: 129_380, etiquetas: ["vivienda entera", "presupuesto enviado"], nota: PRESUPUESTO_ENVIADO, en: visita(2, "12:00") },
      { antes: 13, tipo: "cierre", en: hoyOd(-3, "10:20") },
      { antes: 14, tipo: "vista", en: hoyOd(-1, "09:14") },
      { antes: 15, tipo: "tarea", texto: "Llamar a Xavier: obra por fases", vence: { od: 1 }, en: hoyOd(-1, "09:16") },
      { antes: 15, tipo: "nota", texto: "Quiere hacerlo por fases: primero cocina y baños.", en: hoyOd(-1, "09:17") },
    ],
  },
  // 23 · Soporte Business: intento de phishing; el asistente contesta una vez y lo marca.
  {
    canal: "whatsapp", estado: "spam", tipo: "spam", variante: 2, nombre: "Soporte Business", dia: -13, hora: "03:12",
    datos: {}, motivo: "Intento de phishing",
    mensajes: [
      c("Tu cuenta de WhatsApp Business será suspendida en 24 h por incumplir las políticas. Verifica tus datos en el enlace."),
      a("Hola. {presentacion}Gracias, pero lo que tenga que ver con la cuenta lo revisamos directamente en WhatsApp."),
    ],
  },
  // 24 · Noelia Prat: «más adelante».
  {
    canal: "whatsapp", estado: "conversacion", tipo: "terraza", variante: 2, nombre: "Noelia Prat", dia: -13, hora: "18:45",
    datos: { tipo: "Terraza", metros: "25 m²", plazo: "en primavera" }, etiquetas: ["terraza"],
    mensajes: [
      c("¡Hola! Queremos arreglar la terraza y poner una pérgola. Son unos 25 m²"),
      a("¡Hola! {presentacion}¿Para cuándo os gustaría empezar?"),
      c("Es para más adelante, en primavera. Ahora solo estamos mirando"),
      a("Perfecto. Cuando queráis, me escribís por aquí y os propongo un par de días para verla."),
    ],
  },
  // 25 · Teresa Molina: visita hace tres días abiertos y presupuesto enviado ayer.
  {
    canal: "formulario", estado: "persona", tipo: "suelos", variante: 3, nombre: "Teresa Molina", dia: -12, hora: "13:35", zona: "Sant Antoni",
    datos: { tipo: "Suelos", metros: "85 m²", plazo: "en enero" }, etiquetas: ["suelos"], elige: 2,
    visita: { od: -3, hora: 1 },
    mensajes: [
      PLANTILLA,
      c("Hola. Cambiar el suelo de todo el piso, ahora hay gres de los 90"),
      a("¡Hola, {nombre}! {presentacion}¿Cuántos metros son, más o menos?"),
      c("85 sin contar baño y cocina"),
      a("Perfecto. ¿Para cuándo te gustaría empezar?"),
      c("En enero. Estaría bien saber cuántos días tendríamos que irnos de casa", { audio: true }),
      a("Eso te lo concreta el equipo cuando lo haya visto. Para la visita te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?"),
      c("El segundo"),
      a(CONFIRMA),
      c("Gracias por venir. Una duda: ¿el porcelánico imitación madera va bien con suelo radiante?", { en: visita(0, "18:30") }),
      tu("¡Hola, Teresa! Sí, va muy bien. Te lo incluimos en el presupuesto como opción."),
      c("¡Recibido, gracias! Lo miramos esta semana", { en: visita(2, "19:00") }),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 11, tipo: "ficha", presupuesto: 6_120, etiquetas: ["suelos", "presupuesto enviado"], nota: PRESUPUESTO_ENVIADO, en: visita(2, "11:40") },
      { antes: 11, tipo: "tarea", texto: "Llamar a Teresa: ¿le encaja el porcelánico?", vence: { od: 1 } },
    ],
  },
  // 26 · maria lopez: formulario sin respuesta.
  {
    canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 3, nombre: "maria lopez", dia: -10, hora: "23:40", zona: "Esplugues",
    datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta(),
  },
  // 27 · Carmen Ortiz: clienta con la obra en curso; pasa a una persona y el dueño registra el «sí».
  {
    canal: "whatsapp", estado: "persona", tipo: "baño", variante: 6, nombre: "Carmen Ortiz", od: -7, hora: "08:55",
    datos: { tipo: "Baño" }, etiquetas: ["baño"], motivo: "Cliente con obra en curso (baño)",
    cierre: { accion: "si", importe: 11_800, cobrado: 8_260 },
    mensajes: [
      c("Hola, buenos días. Soy Carmen, la del baño de la calle Provença"),
      a("¡Buenos días, {nombre}! {presentacion}¿En qué te puedo ayudar?"),
      c("El fontanero tenía que venir esta mañana y no ha aparecido, y los albañiles están esperando para cerrar la pared.", { audio: true }),
      a("Vaya, lo siento. Esto lo lleva directamente el equipo: te paso con un compañero, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Carmen, perdona el lío. Acabo de hablar con el fontanero: mañana a las 9:00 está allí sin falta."),
      c("Vale, gracias. Y la factura del segundo pago, ¿me la mandáis por email?"),
      tu("Sí, hoy te la enviamos."),
    ],
    acciones: [
      { tipo: "tarea", texto: "Confirmar fontanero mañana 9:00", hecha: creacion(1, "09:20") },
      { tipo: "cierre" },
      { tipo: "ficha", etiquetas: ["baño", "presupuesto aceptado"] },
      { tipo: "nota", texto: "Obra en curso: lleva pagado el 70 % (señal y pago a mitad de obra)." },
      { tipo: "tarea", texto: "Revisar con Carmen los acabados del baño", vence: { od: 3 }, en: hoyOd(-2, "15:45") },
    ],
  },
  // 28 · Montse Ferrer Puig: visita hace dos días abiertos; el presupuesto está pendiente (tarea vencida).
  {
    canal: "formulario", estado: "persona", tipo: "vivienda entera", variante: 4, nombre: "Montse Ferrer Puig", dia: -9, hora: "13:50", zona: "Gràcia",
    datos: { tipo: "Vivienda entera", metros: "75 m²", plazo: "lo antes posible" }, etiquetas: ["vivienda entera", "financiación"], elige: 1,
    visita: { od: -2, hora: 0 },
    mensajes: [
      PLANTILLA,
      c("Hola, reforma integral de un piso de 75 m²"),
      a("¡Hola, {nombre}! {presentacion}¿Para cuándo te gustaría empezar?"),
      c("Lo antes posible. ¿Ofrecéis financiación?"),
      a("Las condiciones de pago las ve el equipo contigo junto con el presupuesto, después de la visita. Para ver el piso te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?"),
      c("El primero"),
      a(CONFIRMA),
      c("Gracias por venir esta mañana. Se me olvidó comentaros que el radiador del salón también lo queremos cambiar", { en: visita(0, "13:30"), audio: true }),
      tu("¡Gracias a ti, Montse! Apuntado, lo incluimos en el presupuesto."),
      c("Genial. ¿Para cuándo lo tendríais?"),
      tu("Esta semana te lo enviamos por email."),
    ],
    acciones: [
      { antes: 7, tipo: "persona" },
      { antes: 7, tipo: "ficha", presupuesto: 74_000 },
      { antes: 7, tipo: "tarea", texto: "Enviar presupuesto a Montse", vence: { od: -1 } },
    ],
  },
  // 29 · Jordi: deja de contestar tras los dos huecos.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "cocina", variante: 6, nombre: "Jordi", dia: -9, hora: "20:30",
    datos: { tipo: "Cocina", metros: "9 m²", plazo: "antes de Navidad" }, etiquetas: ["cocina", "antes de Navidad"],
    mensajes: [
      c("Buenas noches. Quiero cambiar la cocina, tiene unos 9 metros"),
      a("¡Buenas noches! {presentacion}¿Para cuándo te gustaría empezar?"),
      c("Antes de Navidad, si puede ser"),
      a("Perfecto. Para verla te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
  },
  // 30 · Thomas Weber: visita ayer (día abierto); el dueño lo coge por la tarde y prepara el presupuesto.
  {
    canal: "formulario", estado: "persona", tipo: "baño", variante: 7, nombre: "Thomas Weber", dia: -8, hora: "09:05", zona: "Sarrià",
    datos: { tipo: "Baño", metros: "7 m²", plazo: "después de Reyes" }, etiquetas: ["baño"], elige: 2,
    visita: { od: -1, hora: 1 },
    mensajes: [
      PLANTILLA,
      c("¡Hola! Perdona mi español. Quiero reformar el baño principal"),
      a("¡Hola, {nombre}! {presentacion}Sin problema. ¿Cuántos metros tiene el baño, más o menos?"),
      c("About 7 m². Siete metros"),
      a("Perfecto. ¿Para cuándo te gustaría empezar?"),
      c("En enero, después de Reyes"),
      a("Genial. Para verlo te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?"),
      c("The second one, please. El segundo"),
      a(CONFIRMA),
      c("Thank you for the visit! ¿Me enviáis el presupuesto por email?", { en: visita(0, "17:20") }),
      tu("¡Claro, Thomas! Te lo enviamos esta semana."),
    ],
    acciones: [
      { antes: 9, tipo: "persona", en: visita(0, "16:10") },
      { tipo: "ficha", presupuesto: 12_500 },
      { tipo: "tarea", texto: "Enviar presupuesto a Thomas", vence: { od: 2 } },
    ],
  },
  // 31 · Miquel Bosch: un tabique que puede ser de carga; lo lleva el dueño.
  {
    canal: "formulario", estado: "persona", tipo: "vivienda entera", variante: 5, nombre: "Miquel Bosch", dia: -8, hora: "21:10", zona: "Sants",
    datos: { tipo: "Vivienda entera", metros: "70 m²" }, etiquetas: ["vivienda entera"], motivo: "Tabique que puede ser de carga",
    mensajes: [
      PLANTILLA,
      c("¡Hola! Queremos reformar el piso entero y abrir la cocina al salón"),
      a("¡Hola, {nombre}! {presentacion}¿Cuántos metros tiene el piso, más o menos?"),
      c("Unos 70. El vecino de arriba dice que la pared de la cocina es de carga, no sé si es verdad", { audio: true }),
      a("Gracias por avisar. Si puede ser un muro de carga, prefiero que lo vea directamente alguien del equipo: te paso con un compañero, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Miquel, he visto lo del tabique. Antes de decidir nada tiene que verlo el arquitecto. ¿Qué días te van bien?"),
      c("Por las tardes, a partir de las 18:00"),
      tu("Perfecto. Lo cuadro con él y te digo el día."),
    ],
    acciones: [{ tipo: "tarea", texto: "Visita con el arquitecto para ver el tabique", vence: { od: 1 }, en: hoyOd(-1, "17:05") }],
  },
  // 32 · Joan Vila: visita reservada.
  {
    canal: "formulario", estado: "visita", tipo: "cocina y baño", variante: 1, nombre: "Joan Vila", dia: -7, hora: "22:30", zona: "Sagrada Família",
    datos: { tipo: "Cocina y baño", plazo: "en febrero" }, etiquetas: ["cocina", "baño"], presupuesto: 26_000, elige: 1,
    visita: { od: 1, hora: 0 },
    mensajes: [
      PLANTILLA,
      c("¡Buenos días! Queremos reformar la cocina y el baño a la vez"),
      a("¡Buenos días, {nombre}! {presentacion}¿Cuántos metros tienen, más o menos, entre los dos?"),
      c("La cocina unos 9 y el baño unos 5"),
      a("Perfecto. ¿Para cuándo os gustaría empezar?"),
      c("En febrero, si puede ser"),
      a("Genial. Para verlos os propongo el {hueco1} o el {hueco2}. ¿Cuál os va mejor?"),
      c("El primero"),
      a(CONFIRMA_OS),
    ],
    acciones: [{ tipo: "tarea", texto: "Mirar si la cocina y el baño comparten bajante", vence: { visita: true }, en: hoyOd(-1, "12:40") }],
  },
  // 33 · Sergi Planas: formulario sin respuesta; la segunda llamada está vencida.
  {
    canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 4, nombre: "Sergi Planas", dia: -6, hora: "07:50", zona: "Sant Antoni",
    datos: {}, mensajes: [PLANTILLA],
    acciones: [
      { tipo: "tarea", texto: LLAMAR_SIN_RESPUESTA, en: creacion(0, "11:30"), hecha: creacion(1, "10:05") },
      { tipo: "tarea", texto: "Volver a llamar: no contesta al WhatsApp", vence: { dia: -1 }, en: hoyOd(-2, "10:05") },
    ],
  },
  // 34 · Cerámica Distribución: un proveedor; el asistente contesta una vez y lo marca.
  {
    canal: "whatsapp", estado: "spam", tipo: "spam", variante: 3, nombre: "Cerámica Distribución", dia: -6, hora: "08:20",
    datos: {}, motivo: "Proveedor ofreciendo material",
    mensajes: [
      c("Buenas, distribuimos porcelánico de gran formato a precio de fábrica. ¿Os paso el catálogo?"),
      a("¡Hola! {presentacion}Gracias, pero ahora mismo no buscamos proveedores. ¡Que vaya bien!"),
    ],
  },
  // 35 · Biel: visita reservada.
  {
    canal: "whatsapp", estado: "visita", tipo: "terraza", variante: 3, nombre: "Biel", dia: -5, hora: "19:15",
    datos: { tipo: "Terraza", metros: "18 m²", plazo: "en primavera" }, etiquetas: ["terraza"], presupuesto: 5_500, elige: 2,
    visita: { od: 2, hora: 2 },
    mensajes: [
      c("¡Buenas! ¿Hacéis reformas de terrazas?"),
      a("¡Hola! {presentacion}Sí, claro. ¿Cuántos metros tiene la terraza, más o menos?"),
      c("18 m². Queremos poner tarima de madera y unas jardineras"),
      a("Perfecto. ¿Para cuándo te gustaría empezar?"),
      c("Para primavera"),
      a("Genial. Para verla te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?"),
      c("El segundo me va bien"),
      a(CONFIRMA),
    ],
    acciones: [{ tipo: "tarea", texto: "Llevar muestras de tarima exterior a la visita", vence: { visita: true }, en: hoyOd(-2, "11:15") }],
  },
  // 36 · Sílvia Mas: visita reservada.
  {
    canal: "whatsapp", estado: "visita", tipo: "baño", variante: 8, nombre: "Sílvia Mas", dia: -4, hora: "11:40",
    datos: { tipo: "Baño", metros: "6 m²", plazo: "en enero" }, etiquetas: ["baño"], presupuesto: 11_000, elige: 2,
    visita: { od: 3, hora: 2 },
    mensajes: [
      c("¡Hola! ¿Me pasáis información para reformar un baño?"),
      a("¡Hola! {presentacion}Claro. ¿Cuántos metros tiene el baño, más o menos?"),
      c("Unos 6. Quiero quitar la bañera y poner un plato de ducha grande"),
      a("Perfecto. ¿Para cuándo te gustaría empezar?"),
      c("Pues mira, lo ideal sería en enero, que en diciembre tenemos a toda la familia en casa y no quiero estar de obras", { audio: true }),
      a("Normal. Para verlo te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?"),
      c("El segundo, por la tarde me va mejor"),
      a(CONFIRMA),
    ],
    acciones: [{ tipo: "tarea", texto: "Llevar catálogo de platos de ducha", vence: { visita: true }, en: hoyOd(-1, "13:20") }],
  },
  // 37 · Albert Serra: visita reservada.
  {
    canal: "formulario", estado: "visita", tipo: "vivienda entera", variante: 6, nombre: "Albert Serra", dia: -3, hora: "21:35", zona: "Eixample",
    datos: { tipo: "Vivienda entera", metros: "90 m²", plazo: "lo antes posible" }, etiquetas: ["vivienda entera", "urgente"], presupuesto: 98_000, elige: 2,
    visita: { od: 0, hora: 2 },
    mensajes: [
      PLANTILLA,
      c("¡Hola! Hemos heredado el piso de mi abuela y queremos reformarlo entero para irnos a vivir"),
      a("¡Hola, {nombre}! {presentacion}¿Cuántos metros tiene el piso, más o menos?"),
      c("90 m², tres habitaciones. Está todo original de los 70"),
      a("Entendido. ¿Para cuándo os gustaría empezar?"),
      c("Lo antes posible"),
      a("Perfecto. Para ver el piso os propongo el {hueco1} o el {hueco2}. ¿Cuál os va mejor?"),
      c("El segundo"),
      a(CONFIRMA_OS),
    ],
    acciones: [{ tipo: "tarea", texto: "Llevar planos y medidor láser a la visita", vence: { visita: true } }],
  },
  // 38 · Giulia Ricci: visita reservada.
  {
    canal: "formulario", estado: "visita", tipo: "cocina", variante: 7, nombre: "Giulia Ricci", dia: -3, hora: "22:50", zona: "Gràcia",
    datos: { tipo: "Cocina", metros: "11 m²", plazo: "en febrero" }, etiquetas: ["cocina"], presupuesto: 14_500, elige: 1,
    visita: { od: 3, hora: 0 },
    mensajes: [
      PLANTILLA,
      c("Buongiorno! Perdón, ¡buenos días! 😅 Quiero cambiar la cocina, tiene 11 m²"),
      a("¡Buenos días, {nombre}! {presentacion}¿Para cuándo te gustaría empezar?"),
      c("En febrero o marzo"),
      a("Perfecto. Para verla te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?"),
      c("El primero"),
      a(CONFIRMA),
      c("Grazie! ¡Gracias!"),
      a("¡A ti! Cualquier cosa, me dices por aquí."),
    ],
    acciones: [{ tipo: "tarea", texto: "Llevar muestras de encimera a la visita", vence: { visita: true } }],
  },
  // 39 · Marc Roca (anteayer): local con licencia de actividad; lo lleva el dueño.
  {
    canal: "formulario", estado: "persona", tipo: "local", variante: 2, nombre: "Marc Roca", dia: -2, hora: "12:10", zona: "Gràcia",
    datos: { tipo: "Local comercial", metros: "80 m²" }, etiquetas: ["local", "licencia"], motivo: "Reforma con licencia de actividad",
    mensajes: [
      PLANTILLA,
      c("Tengo un local en Gràcia y quiero montar una cafetería", { tras: 60 }),
      a("¡Buen proyecto, {nombre}! {presentacion}¿Cuántos metros tiene el local, más o menos?", { tras: 7 }),
      c("Unos 80. También necesito que me ayudéis con la licencia de actividad, que todavía no la he pedido", { tras: 95 }),
      a("Lo de la licencia lo lleva directamente el equipo, así que te paso con un compañero, que te escribe en cuanto pueda.", { tras: 9, pase: true }),
      tu("Hola, Marc, te escribo del estudio. Para una cafetería lo primero es la licencia y la salida de humos. ¿Te llamo esta tarde y lo vemos?", { en: dia(-2, "12:40") }),
      c("Sí, a partir de las 17:00", { tras: 240 }),
    ],
    acciones: [
      { tipo: "nota", texto: "Llamada hecha. Local de 80 m², antigua imprenta: cambio de uso a restauración. Necesita proyecto de actividad y salida de humos.", en: dia(-2, "17:35") },
      { tipo: "tarea", texto: "Llamar al arquitecto: proyecto de actividad", vence: { od: 0 }, en: dia(-2, "17:36") },
      { tipo: "ficha", presupuesto: 72_000, en: dia(-2, "17:40") },
    ],
  },
  // 40 · Marta Soler (anteayer): reserva a la mañana siguiente, a la hora que le va bien.
  {
    canal: "formulario", estado: "visita", tipo: "cocina", variante: 8, nombre: "Marta Soler", dia: -2, hora: "20:15", zona: "Sants",
    datos: { tipo: "Cocina", metros: "9 m²", plazo: "antes de Navidad" }, etiquetas: ["cocina", "antes de Navidad"], presupuesto: 12_000, elige: 2,
    visita: { od: 1, hora: 1 },
    mensajes: [
      PLANTILLA,
      c("Hola, es una cocina pequeña, de 9 m². Quiero cambiar los muebles y el suelo", { en: dia(-2, "20:31") }),
      a("Perfecto, {nombre}. {presentacion}¿Para cuándo te gustaría empezar?"),
      c("Antes de Navidad, si se puede", { tras: 75 }),
      a("Genial. Para verla te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
      c("¡Buenos días! Me iría mejor a las {horaHueco}, que es cuando salgo a comer. ¿Tenéis algo?", { en: dia(-1, "09:10") }),
      a("Sí, a las {horaHueco} te propongo el {hueco1} o el {hueco2}. ¿Cuál prefieres?"),
      c("El segundo"),
      a(CONFIRMA),
    ],
    acciones: [
      { tipo: "nota", texto: "Quiere mantener la distribución. Le gustaría tenerla antes de Navidad." },
      { tipo: "tarea", texto: "Llevar catálogo de frentes y muestras de suelo", vence: { visita: true } },
    ],
  },
  // 41 · Jordi Puig (ayer): nota de voz con el plazo; tiene dos huecos y aún no ha elegido.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "vivienda entera", variante: 7, nombre: "Jordi Puig", dia: -1, hora: "19:20",
    datos: { tipo: "Vivienda entera", metros: "85 m²", plazo: "lo antes posible" }, acciones: [],
    mensajes: [
      c("Buenas. Es un piso de 85 m² y queremos reformarlo entero"),
      a("¡Buenas! {presentacion}¿Para cuándo os gustaría empezar?", { tras: 8 }),
      c("Pues mira, lo antes posible, porque nos casamos en junio y querríamos entrar a vivir antes del verano. Tenemos los planos, por si os sirven.", { en: dia(-1, "19:40"), audio: true }),
      a("¡Enhorabuena! Los planos enséñaselos al técnico en la visita. Para ver el piso os propongo el {libre1} o el {libre2}. ¿Cuál os va mejor?", { tras: 9 }),
    ],
  },
  // 42 · Laura Martínez (ayer): contesta por la noche y vuelve hoy por la mañana.
  {
    canal: "formulario", estado: "conversacion", tipo: "cocina", variante: 9, nombre: "Laura Martínez", dia: -1, hora: "21:47", zona: "Eixample",
    datos: { tipo: "Cocina", metros: "12 m²", plazo: "en enero" }, acciones: [],
    mensajes: [
      PLANTILLA,
      c("¡Hola! Quiero reformar la cocina entera, son unos 12 m²", { en: dia(-1, "21:58") }),
      a("¡Genial, {nombre}! {presentacion}¿Para cuándo te gustaría empezar?"),
      c("En enero. Me encanta el cuarzo para la encimera", { en: dia(-1, "22:03") }),
      a("¡Buena elección! Para verla te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
      c("Perdona, ayer me dormí. ¿Se puede pagar en dos plazos?", { en: dia(0, "08:47") }),
      a("La forma de pago la ves con el equipo junto con el presupuesto, después de la visita. ¿Te va bien alguno de los dos días que te propuse?"),
    ],
  },
  // 43 · Núria Vidal (ayer): hoy contesta el plazo y reserva el día que le va bien.
  {
    canal: "whatsapp", estado: "visita", tipo: "baño", variante: 9, nombre: "Núria Vidal", dia: -1, hora: "22:40",
    datos: { tipo: "Baño", metros: "5 m²", plazo: "en enero" }, elige: 1, parMismoDia: true, acciones: [],
    visita: { od: 2, hora: 0 },
    mensajes: [
      c("¡Hola! Quiero reformar el baño, unos 5 m². No tiene ventana y se llena de humedad"),
      a("¡Hola! {presentacion}Lo de la humedad lo mira el técnico en la visita. ¿Para cuándo te gustaría empezar?"),
      c("En enero, si puede ser", { en: dia(0, "08:13") }),
      a("Perfecto. Para verlo te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
      c("Esos dos días trabajo fuera. ¿Podría ser el {diaHueco} por la mañana?", { tras: 50 }),
      a("Sí, te propongo el {hueco1} o el {hueco2}. ¿Cuál prefieres?"),
      c("El de las {horaHueco}, perfecto", { en: dia(0, "08:15") }),
      a(CONFIRMA),
    ],
  },
  // 44 · Pau Ferrer (hoy): acaba de llegar por el formulario.
  {
    canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 5, nombre: "Pau Ferrer", minutosAntes: 35, zona: "Gràcia",
    datos: {}, mensajes: [PLANTILLA],
  },
];
