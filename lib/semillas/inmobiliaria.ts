// Los ejemplos de la inmobiliaria: un mes de una inmobiliaria de barrio de Barcelona con los tres pisos
// de perfiles/inmobiliaria.md. 35 leads: 5 nuevos (uno añadido a mano), 10 hablando con el asistente
// (uno pidió que no le escribieran), 6 con visita a P-101 o P-102, 12 con el dueño y 2 de publicidad.
// Cierres: «Ha dicho que sí» con P-103 (la señal de las arras es la mitad de la comisión: por eso sale
// «Reservado» en la tabla) y con P-097, un piso ya vendido que no está en la tabla; cinco «No sigue».
//
// Lo que hace el asistente es lo que haría el de verdad con esas instrucciones: pregunta qué busca,
// para qué y cómo lo paga, de una en una; para reservar ofrece dos huecos y confirma el elegido con la
// calle tal como sale en la tabla y «Si prefieres hablar con una persona, dímelo por aquí.». No da más
// precios que los de la tabla, no negocia (pasa a una persona, que «te escribe en cuanto pueda») y no
// promete mensajes que ningún código envía. El motor (lib/semilla.ts) les pone fecha, hora e historial.
//
// Comisión: el 3 % del precio de la tabla, redondeado a 10 €. Marcas: las de lib/semillas/tipos.ts.

import { generarSector } from "../semilla";
import type { AccionSemilla, AnclaSemilla, ConversacionSemilla, DatosSemilla, MensajeGuion, OpcionesSemilla, SemillaGenerada } from "./tipos";

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

// Los pisos como los guarda el asistente al reservar.
const P101 = "P-101 · Calle Mallorca (Eixample)";
const P102 = "P-102 · Carrer de Verdi (Gràcia)";
const P103 = "P-103 · Carrer de Sants (Sants)";
const P097 = "P-097 · Carrer del Parlament (Sant Antoni)";

const OFERTA = "Te propongo el {hueco1} o el {hueco2}. ¿Cuál te va mejor?";
const OFERTA_OS = "Te propongo el {hueco1} o el {hueco2}. ¿Cuál os va mejor?";
const confirma = (calle: string) => `Hecho, visita reservada para el {hueco} en ${calle}. Si prefieres hablar con una persona, dímelo por aquí.`;
const HIPOTECA = "¿Tienes la hipoteca aprobada, la estás mirando o compras sin hipoteca?";
const HIPOTECA_OS = "¿Tenéis la hipoteca aprobada, la estáis mirando o compráis sin hipoteca?";
const LLAMAR_SIN_RESPUESTA = "Llamar: no contesta al WhatsApp";

/** Un nuevo del formulario que nunca contestó: el dueño le llamó al día siguiente, sin suerte. */
function sinRespuesta(): AccionSemilla[] {
  return [{ tipo: "tarea", texto: LLAMAR_SIN_RESPUESTA, en: creacion(1, "10:10"), hecha: creacion(2, "12:30") }];
}

export const CONVERSACIONES_INMOBILIARIA: ConversacionSemilla[] = [
  // ---- Con el dueño tras la visita (7) ----

  // Marta Vidal Roig: visita a P-103, arras firmadas y la mitad de la comisión cobrada.
  {
    canal: "formulario", estado: "persona", tipo: "P-103", variante: 1, nombre: "Marta Vidal Roig", dia: -29, hora: "20:40", zona: "Sants",
    datos: { piso: P103, uso: "Para vivir", financiacion: "Hipoteca preaprobada", plazo: "Antes del verano" }, etiquetas: ["para vivir"], elige: 1,
    visita: { desde: "creacion", od: 2, hora: 2 }, cierre: { accion: "si", importe: 8_940, cobrado: 4_470 },
    mensajes: [
      PLANTILLA,
      c("¡Hola! Me interesa el de Carrer de Sants, el de tres habitaciones"),
      a("¡Hola, {nombre}! Está en 298.000 € y tiene ascensor. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir, somos una pareja con un bebé"),
      a("Genial. " + HIPOTECA_OS),
      c("Preaprobada con el banco"),
      a("Perfecto. " + OFERTA),
      c("El primero"),
      a(confirma("Carrer de Sants (Sants)")),
      c("Nos ha encantado el piso. ¿Cómo hacemos para reservarlo?", { en: visita(0, "19:10") }),
      tu("¡Qué bien, Marta! Mañana te llamo y te explico cómo van las arras."),
      c("Perfecto, mañana estamos pendientes"),
      c("Ya hemos hecho la transferencia de la señal 😊", { en: visita(3, "11:20") }),
      tu("Recibida, Marta. ¡Enhorabuena por el piso!"),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 12, tipo: "nota", texto: "Arras firmadas el {fecha}: la mitad de la comisión, a la firma.", en: visita(2, "12:00") },
      { tipo: "cierre", en: visita(3, "12:30") },
    ],
  },
  // Jordi Pons Bassols: inversor; compra P-097 (ya vendido, fuera de la tabla). La comisión, a la escritura.
  {
    canal: "formulario", estado: "persona", tipo: "P-097", variante: 1, nombre: "Jordi Pons Bassols", dia: -27, hora: "21:15", zona: "Sant Antoni",
    datos: { piso: P097, uso: "Para invertir", financiacion: "Sin hipoteca", plazo: "Este año" }, etiquetas: ["inversión"], elige: 1,
    visita: { desde: "creacion", od: 3, hora: 0 }, cierre: { accion: "si", importe: 10_560 },
    mensajes: [
      PLANTILLA,
      c("Buenas, vi el piso de Carrer del Parlament en el portal. ¿Sigue disponible?"),
      a("¡Hola, {nombre}! Sí, sigue disponible. ¿Lo buscas para vivir o como inversión?"),
      c("Como inversión, para alquilarlo"),
      a("Entendido. ¿Comprarías con hipoteca o sin hipoteca?"),
      c("Sin hipoteca"),
      a("Perfecto. " + OFERTA),
      c("El primero, a primera hora mejor"),
      a(confirma("Carrer del Parlament (Sant Antoni)")),
      c("Me interesa. ¿El propietario tiene la cédula y el certificado energético?", { en: visita(0, "13:40") }),
      tu("Sí, Jordi, lo tiene todo. Te lo mando por email esta tarde."),
      c("Hacemos oferta al precio de salida. Adelante", { en: visita(2, "10:15") }),
      tu("¡Genial! Se lo traslado ahora mismo al propietario y te llamo."),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { tipo: "nota", texto: "Oferta al precio de salida, aceptada por el propietario." },
      { tipo: "cierre", en: visita(3, "11:00") },
      { tipo: "tarea", texto: "Preparar la firma en notaría con Jordi", vence: { od: 4 }, en: hoyOd(-1, "10:30") },
    ],
  },
  // Laura Giménez: visita al ático; se queda con otro con ascensor.
  {
    canal: "formulario", estado: "persona", tipo: "P-102", variante: 1, nombre: "Laura Giménez", dia: -24, hora: "22:35", zona: "Gràcia",
    datos: { piso: P102, uso: "Para vivir", financiacion: "Mirando hipoteca" }, etiquetas: ["terraza"], elige: 2,
    visita: { desde: "creacion", od: 3, hora: 1 }, cierre: { accion: "no", motivo: "Ha elegido a otro" },
    mensajes: [
      PLANTILLA,
      c("¡Buenos días! Me interesa el ático de Gràcia"),
      a("¡Buenos días, {nombre}! Es el de Carrer de Verdi, con terraza de 15 m²; está en 389.000 €. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir. La terraza es justo lo que busco"),
      a(HIPOTECA),
      c("La estoy mirando con dos bancos"),
      a("Perfecto. " + OFERTA),
      c("El segundo"),
      a(confirma("Carrer de Verdi (Gràcia)")),
      c("Gracias por enseñármelo. Lo de no tener ascensor me hace dudar", { en: visita(0, "15:40") }),
      tu("Normal, Laura. Si quieres, lo volvemos a ver con calma otro día."),
      c("Al final hemos encontrado otro con ascensor en la misma zona. ¡Gracias por todo!", { en: visita(5, "18:30") }),
      tu("Gracias a ti por avisar, Laura. ¡Mucha suerte con la mudanza!"),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 11, tipo: "ficha", presupuesto: 11_670 },
      { tipo: "cierre" },
    ],
  },
  // Daniel Ortega: visita a P-101; 465.000 € se le van.
  {
    canal: "formulario", estado: "persona", tipo: "P-101", variante: 1, nombre: "Daniel Ortega", dia: -22, hora: "13:10", zona: "Eixample",
    datos: { piso: P101, uso: "Para vivir", financiacion: "Hipoteca aprobada" }, etiquetas: ["para vivir"], elige: 1,
    visita: { desde: "creacion", od: 2, hora: 2 }, cierre: { accion: "no", motivo: "Precio" },
    mensajes: [
      PLANTILLA,
      c("Hola, el de Calle Mallorca. ¿El balcón da a la calle?"),
      a("¡Hola, {nombre}! Sí, tiene balcón a la calle, ascensor y está reformado. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir"),
      a(HIPOTECA),
      c("Aprobada"),
      a("Genial. " + OFERTA),
      c("El primero"),
      a(confirma("Calle Mallorca (Eixample)")),
      c("El piso está muy bien, pero 465.000 se nos va", { en: visita(0, "18:45") }),
      tu("Lo entiendo, Daniel. El propietario de momento no baja; si cambia algo, te escribo."),
      c("Vale, gracias. Seguimos mirando", { en: visita(1, "10:05") }),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 9, tipo: "ficha", presupuesto: 13_950 },
      { tipo: "cierre" },
    ],
  },
  // Àlex: inversor; lo deja para más adelante.
  {
    canal: "whatsapp", estado: "persona", tipo: "P-102", variante: 2, nombre: "Àlex", dia: -21, hora: "11:30",
    datos: { piso: P102, uso: "Para invertir", financiacion: "Mirando hipoteca" }, etiquetas: ["inversión"], elige: 2,
    visita: { desde: "creacion", od: 3, hora: 0 }, cierre: { accion: "no", motivo: "Se lo ha pensado" },
    mensajes: [
      c("Hola, ¿el ático de Gràcia sigue disponible?"),
      a("¡Hola! {presentacion}Sí, el de Carrer de Verdi sigue disponible. ¿Lo buscas para vivir o como inversión?"),
      c("Como inversión, para alquilarlo"),
      a("Entendido. ¿Comprarías con hipoteca o sin hipoteca?"),
      c("Con hipoteca, la estoy mirando"),
      a("Perfecto. " + OFERTA),
      c("El segundo"),
      a(confirma("Carrer de Verdi (Gràcia)")),
      c("Gracias por la visita. Me lo pienso con calma", { en: visita(0, "13:30") }),
      tu("Claro, Àlex. Cualquier duda, por aquí."),
      c("Al final lo dejo, prefiero esperar a ver cómo van los tipos", { en: visita(4, "17:10") }),
      tu("Entendido, gracias por avisar. Si lo retomas, aquí estamos."),
    ],
    acciones: [
      { antes: 8, tipo: "persona" },
      { antes: 10, tipo: "ficha", presupuesto: 11_670 },
      { tipo: "cierre" },
    ],
  },
  // Sofia Mancini: visita hace dos días abiertos; le gusta y pide la nota simple.
  {
    canal: "formulario", estado: "persona", tipo: "P-101", variante: 2, nombre: "Sofia Mancini", dia: -7, hora: "21:50", zona: "Eixample",
    datos: { piso: P101, uso: "Para vivir", financiacion: "Sin hipoteca" }, etiquetas: ["para vivir"], elige: 1,
    visita: { od: -2, hora: 0 },
    mensajes: [
      PLANTILLA,
      c("Buongiorno! Perdón: buenos días. Me interesa el piso de Calle Mallorca"),
      a("¡Buenos días, {nombre}! Sin problema 🙂 ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir, me mudo a Barcelona por trabajo"),
      a("¡Bienvenida! " + HIPOTECA),
      c("Sin hipoteca, vendo mi casa en Milán"),
      a("Perfecto. " + OFERTA),
      c("El primero"),
      a(confirma("Calle Mallorca (Eixample)")),
      c("Grazie por la visita. Me gusta mucho. ¿Cuánto son los gastos de comunidad?", { en: visita(0, "12:40") }),
      tu("¡Gracias a ti, Sofia! Son 90 € al mes. Te mando por email la nota simple."),
    ],
    acciones: [
      { antes: 9, tipo: "persona" },
      { antes: 9, tipo: "ficha", presupuesto: 13_950 },
      { tipo: "tarea", texto: "Enviar la nota simple a Sofia", vence: { od: 1 } },
    ],
  },
  // Pau: visita al ático el último día abierto; lo hablan el fin de semana.
  {
    canal: "whatsapp", estado: "persona", tipo: "P-102", variante: 3, nombre: "Pau", dia: -5, hora: "18:20",
    datos: { piso: P102, uso: "Para vivir", financiacion: "Hipoteca aprobada" }, etiquetas: ["terraza"], elige: 2,
    visita: { od: -1, hora: 1 },
    mensajes: [
      c("¡Hola! Vi el ático de Verdi en idealista. ¿Se puede visitar?"),
      a("¡Hola! {presentacion}Claro. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir con mi pareja"),
      a(HIPOTECA_OS),
      c("Aprobada, del 80 %"),
      a("Genial. " + OFERTA_OS),
      c("El segundo"),
      a(confirma("Carrer de Verdi (Gràcia)")),
      c("Gracias por enseñárnoslo. Nos ha gustado mucho la terraza", { en: visita(0, "14:10") }),
      tu("¡Me alegro, Pau! Si queréis verlo otra vez con calma, me decís."),
      c("Lo hablamos este fin de semana y te contamos"),
    ],
    acciones: [
      { antes: 8, tipo: "persona" },
      { antes: 8, tipo: "ficha", presupuesto: 11_670 },
    ],
  },

  // ---- Pasados a una persona por el asistente (5) ----

  // Ricardo Fuentes: quiere negociar el precio; el propietario no baja.
  {
    canal: "formulario", estado: "persona", tipo: "P-101", variante: 3, nombre: "Ricardo Fuentes", od: -14, hora: "10:40", zona: "Les Corts",
    datos: { piso: P101, uso: "Para vivir" }, etiquetas: ["negociación"], motivo: "Quiere negociar el precio",
    cierre: { accion: "no", motivo: "Precio" },
    mensajes: [
      PLANTILLA,
      c("Hola, me interesa el de Calle Mallorca"),
      a("¡Hola, {nombre}! Está en 465.000 €, reformado y con ascensor. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir. ¿Aceptaríais 440.000?"),
      a("El precio lo lleva directamente un compañero: te paso con él, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Ricardo, te escribo de la inmobiliaria. Le traslado tu oferta al propietario y te cuento lo que diga."),
      c("Vale, quedo a la espera"),
      tu("Ricardo, el propietario no baja de 460.000 €. ¿Te encaja?", { en: creacion(1, "09:40") }),
      c("Se nos va de presupuesto, lo dejamos. Gracias", { en: creacion(1, "13:05") }),
      tu("Entendido, Ricardo. Si cambia algo, te lo digo por aquí."),
    ],
    acciones: [{ tipo: "cierre", en: creacion(1, "13:30") }],
  },
  // Montse: pide hablar con una persona.
  {
    canal: "whatsapp", estado: "persona", tipo: "P-102", variante: 4, nombre: "Montse", od: -3, hora: "11:10",
    datos: { piso: P102 }, motivo: "Pide hablar con una persona",
    mensajes: [
      c("Hola, quería información del piso de Gràcia"),
      a("¡Hola! {presentacion}Es el ático de Carrer de Verdi, con terraza de 15 m². ¿Lo buscas para vivir o como inversión?"),
      c("Prefiero hablar con una persona, la verdad"),
      a("Claro, sin problema. Te paso con un compañero, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Montse, te escribo de la inmobiliaria. ¿Te va bien que te llame ahora y te cuento?"),
      c("Mejor por la tarde, a partir de las 18:00"),
      tu("Perfecto, a las 18:00 te llamo."),
    ],
    acciones: [{ tipo: "nota", texto: "Llamada hecha: busca ático para vivir, sin prisa. Quiere verlo con su hermana.", en: creacion(0, "18:25") }],
  },
  // Iván Morales Castro: pregunta la hipoteca en detalle; después no contesta.
  {
    canal: "formulario", estado: "persona", tipo: "P-101", variante: 4, nombre: "Iván Morales Castro", od: -16, hora: "12:20", zona: "Sant Martí",
    datos: { uso: "Para vivir", financiacion: "Mirando hipoteca" }, etiquetas: ["hipoteca"], motivo: "Pregunta por la hipoteca en detalle",
    cierre: { accion: "no", motivo: "No contesta" },
    mensajes: [
      PLANTILLA,
      c("Hola, busco un piso de tres habitaciones para vivir"),
      a("¡Hola, {nombre}! Tenemos el de Calle Mallorca: 85 m², tres habitaciones y ascensor. " + HIPOTECA),
      c("La estoy mirando. ¿Me conviene más fija o variable? ¿Y cuánto me darían con mi sueldo?"),
      a("Eso prefiero que lo veas con un compañero del equipo: te paso con él, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Iván, te escribo de la inmobiliaria. Trabajamos con un asesor hipotecario que te lo estudia sin compromiso. ¿Te paso su contacto?"),
    ],
    acciones: [
      { tipo: "tarea", texto: "Llamar a Iván: no contesta al WhatsApp", en: creacion(2, "10:15"), hecha: creacion(3, "12:00") },
      { tipo: "cierre", en: creacion(6, "11:00") },
    ],
  },
  // Carlos R.: pregunta algo que no está en la tabla (el parking).
  {
    canal: "whatsapp", estado: "persona", tipo: "P-101", variante: 5, nombre: "Carlos R.", od: -2, hora: "16:40",
    datos: { piso: P101 }, motivo: "Pregunta algo que no está en la tabla",
    mensajes: [
      c("Buenas, ¿el de Calle Mallorca tiene parking?"),
      a("¡Buenas! {presentacion}Ese dato no lo tengo. Si quieres, te paso con una persona del equipo y te lo confirma."),
      c("Sí, porfa"),
      a("Perfecto: te paso con un compañero, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Carlos. El piso no tiene parking, pero en la misma manzana alquilan plazas. ¿Te interesa verlo igualmente?"),
      c("Vale, me lo pienso"),
    ],
  },
  // Elena Sánchez: molesta porque nadie le contestó por otro piso.
  {
    canal: "formulario", estado: "persona", tipo: "P-102", variante: 5, nombre: "Elena Sánchez", od: -1, hora: "10:05", zona: "Gràcia",
    datos: { piso: P102 }, motivo: "Está molesta",
    mensajes: [
      PLANTILLA,
      c("Os escribí la semana pasada por otro piso y nadie me contestó. Muy mal"),
      a("Perdona, {nombre}, siento la espera. Te paso con un compañero del equipo, que te escribe en cuanto pueda.", { pase: true }),
      tu("Hola, Elena. Disculpa de verdad, se nos pasó tu mensaje. ¿Qué piso era y te lo cuento ahora?"),
      c("El de Gràcia, el ático. ¿Sigue disponible?"),
    ],
  },

  // ---- Hablando con el asistente (10) ----

  // Toni: busca alquiler y pide que no le escriban más.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "alquiler", variante: 1, nombre: "Toni", dia: -18, hora: "19:30",
    datos: {},
    mensajes: [
      c("Hola, ¿tenéis pisos de alquiler?"),
      a("¡Hola! {presentacion}Ahora mismo solo tenemos pisos en venta. ¿Qué tipo de piso buscas?"),
      c("Solo alquiler. No me escribáis más, gracias", { baja: true }),
      a("{baja}"),
    ],
  },
  // Núria Ferrer Soler: el ático se le va de precio.
  {
    canal: "formulario", estado: "conversacion", tipo: "P-102", variante: 6, nombre: "Núria Ferrer Soler", dia: -26, hora: "21:30", zona: "Gràcia",
    datos: { piso: P102, uso: "Para vivir" },
    mensajes: [
      PLANTILLA,
      c("Hola, busco algo de dos habitaciones por Gràcia"),
      a("¡Hola, {nombre}! Tenemos el ático de Carrer de Verdi: dos habitaciones y terraza de 15 m², por 389.000 €. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir, pero se me va un poco de precio"),
      a("Entendido. " + HIPOTECA),
    ],
  },
  // Rosa M.: pregunta por P-103, reservado; se le ofrece el que más se le parece.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "P-103", variante: 2, nombre: "Rosa M.", dia: -12, hora: "12:15",
    datos: {},
    mensajes: [
      c("¿El de Carrer de Sants sigue disponible?"),
      a("¡Hola! {presentacion}Ese está reservado, lo siento. El que más se le parece es el de Calle Mallorca: tres habitaciones y ascensor, por 465.000 €. ¿Lo buscas para vivir o como inversión?"),
      c("Uf, se me va mucho. Lo dejo, gracias"),
      a("Gracias a ti. Si buscas otra cosa más adelante, escríbeme por aquí."),
    ],
  },
  // Guillermo Díaz: inversor; pregunta la rentabilidad y deja de contestar tras los dos huecos.
  {
    canal: "formulario", estado: "conversacion", tipo: "P-102", variante: 7, nombre: "Guillermo Díaz", dia: -20, hora: "22:40", zona: "Poblenou",
    datos: { uso: "Para invertir", financiacion: "Sin hipoteca" }, etiquetas: ["inversión"],
    mensajes: [
      PLANTILLA,
      c("Buenos días. Busco un piso para invertir y alquilarlo"),
      a("¡Buenos días, {nombre}! Tenemos el de Calle Mallorca y el ático de Carrer de Verdi. ¿Comprarías con hipoteca o sin hipoteca?"),
      c("Sin hipoteca. ¿Qué rentabilidad sacaría con el de Verdi?"),
      a("Eso no te lo puedo calcular yo; en la visita lo ves con el equipo. Te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
  },
  // Iker: pregunta por las mascotas, un dato que no está en la tabla.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "P-101", variante: 6, nombre: "Iker", dia: -16, hora: "13:40",
    datos: { piso: P101, uso: "Para vivir" },
    mensajes: [
      c("¡Hola! Info del piso de Mallorca porfa"),
      a("¡Hola! {presentacion}Es un piso reformado de 85 m², tres habitaciones, ascensor y balcón, por 465.000 €. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir. ¿Aceptan mascotas en la comunidad?"),
      a("Ese dato no lo tengo. Si quieres, te paso con una persona del equipo y te lo confirma."),
    ],
  },
  // Andrea Castillo: aún no sabe cuánto le dan de hipoteca.
  {
    canal: "formulario", estado: "conversacion", tipo: "P-101", variante: 7, nombre: "Andrea Castillo", dia: -14, hora: "20:05", zona: "Sant Andreu",
    datos: { uso: "Para vivir", financiacion: "Mirando hipoteca" },
    mensajes: [
      PLANTILLA,
      c("Hola, quería ver pisos de tres habitaciones para vivir"),
      a("¡Hola, {nombre}! Tenemos el de Calle Mallorca: 85 m², tres habitaciones, reformado. " + HIPOTECA),
      c("La estoy mirando, aún no sé cuánto me dan"),
      a("Sin problema. Cuando lo sepas, me escribes por aquí y te propongo un par de días para verlo."),
    ],
  },
  // Héctor: el ático sin ascensor no le convence.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "P-102", variante: 8, nombre: "Héctor", dia: -10, hora: "10:50",
    datos: { piso: P102, uso: "Para invertir" },
    mensajes: [
      c("Buenas, ¿cuánto piden por el ático de Gràcia?"),
      a("¡Buenas! {presentacion}Está en 389.000 €: dos habitaciones y terraza de 15 m², sin ascensor. ¿Lo buscas para vivir o como inversión?"),
      c("Para invertir. Sin ascensor no sé..."),
      a("Entendido. ¿Comprarías con hipoteca o sin hipoteca?"),
    ],
  },
  // chen wei: escribe en minúsculas y con poco español.
  {
    canal: "formulario", estado: "conversacion", tipo: "P-102", variante: 9, nombre: "chen wei", dia: -8, hora: "23:20", zona: "Eixample",
    datos: {},
    mensajes: [
      PLANTILLA,
      c("Hello, perdona mi español. Busco piso para comprar"),
      a("¡Hola, {nombre}! Sin problema 🙂 ¿Qué tipo de piso buscas: cuántas habitaciones o en qué zona?"),
      c("Dos habitaciones, Gràcia o Eixample"),
      a("Tenemos el ático de Carrer de Verdi, en Gràcia: dos habitaciones y terraza de 15 m². ¿Lo buscas para vivir o como inversión?"),
    ],
  },
  // Lucía: busca terraza; tiene los dos huecos y aún no ha elegido.
  {
    canal: "whatsapp", estado: "conversacion", tipo: "P-102", variante: 10, nombre: "Lucía", dia: -6, hora: "17:35",
    datos: { piso: P102, uso: "Para vivir", financiacion: "Hipoteca aprobada" }, etiquetas: ["terraza"],
    mensajes: [
      c("Hola, he visto el anuncio. ¿El de Mallorca tiene terraza?"),
      a("¡Hola! {presentacion}No, tiene balcón. Si buscas terraza, el ático de Carrer de Verdi tiene una de 15 m². ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir"),
      a(HIPOTECA),
      c("Aprobada"),
      a("Perfecto. Te propongo el {libre1} o el {libre2}. ¿Cuál te va mejor?"),
    ],
  },
  // Oriol Puig (ayer): contesta por la noche y vuelve hoy por la mañana.
  {
    canal: "formulario", estado: "conversacion", tipo: "P-101", variante: 8, nombre: "Oriol Puig", dia: -1, hora: "19:45", zona: "Eixample",
    datos: { piso: P101, uso: "Para vivir", financiacion: "Hipoteca aprobada", plazo: "En primavera" }, acciones: [],
    mensajes: [
      PLANTILLA,
      c("Hola, me interesa el de Calle Mallorca", { en: dia(-1, "19:58") }),
      a("¡Hola, {nombre}! Está en 465.000 €, reformado y con ascensor. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir con mi familia"),
      a(HIPOTECA_OS),
      c("Aprobada. Y nos querríamos mudar en primavera", { en: dia(0, "08:40") }),
      a("Perfecto. Te propongo el {libre1} o el {libre2}. ¿Cuál os va mejor?"),
    ],
  },

  // ---- Con visita (6), siempre a P-101 o P-102 ----

  {
    canal: "formulario", estado: "visita", tipo: "P-101", variante: 9, nombre: "Marina López García", dia: -5, hora: "21:00", zona: "Eixample",
    datos: { piso: P101, uso: "Para vivir", financiacion: "Hipoteca preaprobada" }, etiquetas: ["para vivir"], elige: 1,
    visita: { od: 1, hora: 0 },
    mensajes: [
      PLANTILLA,
      c("¡Hola! Me interesa el de Calle Mallorca. ¿Se puede visitar?"),
      a("¡Hola, {nombre}! Claro. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir"),
      a(HIPOTECA),
      c("Preaprobada"),
      a("Genial. " + OFERTA),
      c("El primero"),
      a(confirma("Calle Mallorca (Eixample)")),
    ],
    acciones: [{ tipo: "tarea", texto: "Pedir las llaves de Mallorca al propietario", vence: { visita: true }, en: hoyOd(-1, "10:20") }],
  },
  {
    canal: "whatsapp", estado: "visita", tipo: "P-102", variante: 11, nombre: "Joan", dia: -4, hora: "12:00",
    datos: { piso: P102, uso: "Para invertir", financiacion: "Sin hipoteca" }, etiquetas: ["inversión"], elige: 2,
    visita: { od: 2, hora: 2 },
    mensajes: [
      c("Bon dia! ¿El ático de Verdi sigue disponible?"),
      a("¡Hola! {presentacion}Sí, sigue disponible. ¿Lo buscas para vivir o como inversión?"),
      c("Para invertir, alquiler de temporada"),
      a("Entendido. ¿Comprarías con hipoteca o sin hipoteca?"),
      c("Sin hipoteca"),
      a("Perfecto. " + OFERTA),
      c("El segundo"),
      a(confirma("Carrer de Verdi (Gràcia)")),
    ],
    acciones: [],
  },
  {
    canal: "formulario", estado: "visita", tipo: "P-101", variante: 10, nombre: "Beatriz Navarro", dia: -3, hora: "22:45", zona: "Les Corts",
    datos: { piso: P101, uso: "Para vivir", financiacion: "Mirando hipoteca" }, elige: 2,
    visita: { od: 3, hora: 1 },
    mensajes: [
      PLANTILLA,
      c("Buenos días, el de Calle Mallorca"),
      a("¡Buenos días, {nombre}! Está en 465.000 €: 85 m², tres habitaciones y balcón. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir"),
      a(HIPOTECA),
      c("La estoy mirando, pero quiero verlo primero"),
      a("Claro. " + OFERTA),
      c("El segundo, por favor"),
      a(confirma("Calle Mallorca (Eixample)")),
    ],
    acciones: [],
  },
  {
    canal: "whatsapp", estado: "visita", tipo: "P-102", variante: 12, nombre: "Samuel", dia: -3, hora: "17:20",
    datos: { piso: P102, uso: "Para vivir", financiacion: "Hipoteca aprobada" }, etiquetas: ["terraza"], elige: 1,
    visita: { od: 0, hora: 2 },
    mensajes: [
      c("Hola, ¿se puede ver el ático de Gràcia?"),
      a("¡Hola! {presentacion}Claro. ¿Lo buscas para vivir o como inversión?"),
      c("Para vivir, con mi novia"),
      a(HIPOTECA_OS),
      c("Aprobada"),
      a("Genial. " + OFERTA_OS),
      c("El primero"),
      a(confirma("Carrer de Verdi (Gràcia)")),
    ],
    acciones: [{ tipo: "tarea", texto: "Llevar el plano del ático a la visita", vence: { visita: true }, en: hoyOd(-1, "17:10") }],
  },
  {
    canal: "formulario", estado: "visita", tipo: "P-101", variante: 11, nombre: "Ana Belén Ruiz", dia: -2, hora: "13:30", zona: "Sant Gervasi",
    datos: { piso: P101, uso: "Para vivir", financiacion: "Sin hipoteca", plazo: "Después de Navidad" }, elige: 1,
    visita: { od: 4, hora: 0 },
    mensajes: [
      PLANTILLA,
      c("Hola, quiero ver el de Calle Mallorca. Vendo el mío y busco uno más grande"),
      a("¡Hola, {nombre}! ¿Lo buscas para vivir tú o como inversión?"),
      c("Para vivir yo"),
      a(HIPOTECA),
      c("Sin hipoteca, con lo de la venta. Para después de Navidad"),
      a("Perfecto. " + OFERTA),
      c("El primero"),
      a(confirma("Calle Mallorca (Eixample)")),
    ],
    acciones: [],
  },
  {
    canal: "whatsapp", estado: "visita", tipo: "P-102", variante: 13, nombre: "Martí", dia: -2, hora: "20:15",
    datos: { piso: P102, uso: "Para vivir", financiacion: "Mirando hipoteca" }, elige: 2,
    visita: { od: 5, hora: 2 },
    mensajes: [
      c("Bona nit! Me interesa el ático de Carrer de Verdi"),
      a("¡Buenas noches! {presentacion}¿Lo buscas para vivir o como inversión?"),
      c("Para vivir"),
      a(HIPOTECA),
      c("La estoy mirando con el banco"),
      a("Perfecto. " + OFERTA),
      c("El segundo"),
      a(confirma("Carrer de Verdi (Gràcia)")),
    ],
    acciones: [],
  },

  // ---- Nuevos (5): cuatro del formulario que no contestaron y uno añadido a mano ----

  { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 1, nombre: "Sergio Blanco", dia: -23, hora: "22:20", zona: "Horta", datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta() },
  { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 2, nombre: "isabel moreno", dia: -15, hora: "09:10", zona: "Sants", datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta() },
  { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 3, nombre: "Fatima Zahra El Idrissi", dia: -9, hora: "21:40", zona: "El Clot", datos: {}, mensajes: [PLANTILLA], acciones: sinRespuesta() },
  { canal: "formulario", estado: "nuevo", tipo: "nuevo", variante: 4, nombre: "Raúl Domínguez", dia: -1, hora: "21:25", zona: "Gràcia", datos: {}, mensajes: [PLANTILLA], acciones: [] },
  {
    canal: "manual", estado: "nuevo", tipo: "P-101", variante: 1, nombre: "Carmen Vidal", dia: -11, hora: "11:00",
    datos: { piso: P101 }, mensajes: [],
    acciones: [{ tipo: "nota", texto: "Ha llamado por teléfono: quiere ver el de Calle Mallorca con su hija." }],
  },

  // ---- Publicidad (2) ----

  // Lo para el código (detectarSpam): enlace acortado y ganchos; sin respuesta.
  {
    canal: "whatsapp", estado: "spam", tipo: "spam", variante: 1, nombre: "Inversiones Top", dia: -17, hora: "03:40",
    datos: {}, porRegla: true, motivo: "Enlace raro (bit.ly) y publicidad («gana dinero», «desde casa»)",
    mensajes: [c("Gana dinero desde casa con trading de cripto. Haz clic aquí: bit.ly/inver-top")],
  },
  // Un proveedor: el asistente contesta una vez y lo marca.
  {
    canal: "whatsapp", estado: "spam", tipo: "spam", variante: 2, nombre: "Fotografía Inmobiliaria BCN", dia: -9, hora: "10:30",
    datos: {}, motivo: "Proveedor ofreciendo sus servicios",
    mensajes: [
      c("Hola, hacemos reportajes de fotos y tours virtuales para inmobiliarias. ¿Os paso nuestras tarifas?"),
      a("¡Hola! {presentacion}Gracias por escribirnos, pero ahora mismo no nos interesa. ¡Que vaya bien!"),
    ],
  },
];

/** Los datos del sector: guiones, cuotas por etapa y lo que el motor necesita para completar. */
export const DATOS_INMOBILIARIA: DatosSemilla = {
  semilla: 20_261_112,
  nombres: {
    formulario: ["Clara Puig", "Víctor Hernández", "Noelia Ramos", "Adrià Serra", "Lorena Gil"],
    whatsapp: ["Nando", "Bea", "Quim", "Sara P."],
  },
  zonas: ["Eixample", "Gràcia", "Sants", "Sant Antoni", "Les Corts", "Poblenou", "Sant Gervasi"],
  servicios: [
    { tipo: "P-101", etiqueta: "P-101", rango: [13_950, 13_950], datos: {} },
    { tipo: "P-102", etiqueta: "P-102", rango: [11_670, 11_670], datos: {} },
  ],
  conversaciones: CONVERSACIONES_INMOBILIARIA,
  cuotas: { nuevo: 5, conversacion: 10, visita: 6, persona: 12, spam: 2 },
  tareas: [],
  notas: [],
  fuentes: { campana: "Inmobiliaria Barcelona", anuncio: "¿Buscas piso en Barcelona? Pide una visita" },
};

/** El generador de la inmobiliaria: los datos de arriba con el motor genérico. */
export function generarInmobiliaria(o: OpcionesSemilla, ahora: Date): SemillaGenerada {
  return generarSector(DATOS_INMOBILIARIA, o, ahora);
}
