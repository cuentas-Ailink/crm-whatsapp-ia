// Preset de clínica: citas para pacientes, con el texto final de la portada, las frases y la regla de urgencias.

import { generarHoras, REGLAS_POR_DEFECTO } from "../agenda";
import { FRASES_POR_DEFECTO, PLANTILLA_GENERAL, type Preset } from "../configuracion";
import { REGIONAL_POR_DEFECTO } from "../regional";

export const PRESET_CLINICA: Preset = {
  id: "clinica",
  etiqueta: "Clínica",
  descripcion: "Citas para pacientes",
  perfilId: "clinica",
  archivo: "perfiles/clinica.md",
  negocio: { nombre: "Clínica dental", lema: "Odontología general y estética", color: "#2b7bb9" },
  plantilla: PLANTILLA_GENERAL,
  calendario: {
    ...REGLAS_POR_DEFECTO,
    horas: [...generarHoras("09:00", "13:30", 30), ...generarHoras("16:00", "19:30", 30)],
    desdeDias: 0,
    antelacionMinutos: 120,
    diasVista: 40,
  },
  regional: REGIONAL_POR_DEFECTO,
  vocabulario: {
    cita: { singular: "cita", plural: "citas", genero: "f" },
    cliente: { singular: "paciente", plural: "pacientes", genero: "m" },
    importe: { singular: "presupuesto", plural: "presupuestos", genero: "m" },
    zona: null,
    equipo: "recepción",
    catalogo: { singular: "piso", plural: "pisos", genero: "m" },
    ejemplos: { etiquetas: "ortodoncia, financiación", dato: "seguro" },
  },
  campos: [
    { clave: "tratamiento", etiqueta: "Tratamiento", resumen: true },
    { clave: "primera_visita", etiqueta: "Primera visita", resumen: true },
    { clave: "seguro", etiqueta: "Seguro o mutua" },
  ],
  agente: {
    catalogo: "no",
    negociar: "no",
    pasarSiempre: [
      {
        motivo: "Posible urgencia",
        // Frases enteras: «hinchad» (una raíz) no coincidiría con nada. Un falso positivo solo pasa al paciente a recepción.
        frases: [
          "urgencia",
          "urgente",
          "me duele mucho",
          "mucho dolor",
          "dolor fuerte",
          "no aguanto el dolor",
          "sangra",
          "sangrando",
          "hinchado",
          "hinchada",
          "se me ha roto",
          "se me ha partido",
          "se me ha caído",
          "flemón",
          "infección",
        ],
        respuesta: "Si es una urgencia grave, llama al 112. Te paso con recepción, que te escribe en cuanto pueda.",
      },
    ],
    excepciones: ["no es urgente"],
    frases: {
      ...FRASES_POR_DEFECTO,
      pase: "Entendido, te paso con recepción, que te escribe en cuanto pueda.",
      borrarDatos: "Se lo paso a recepción de {negocio} para que borre tus datos.",
    },
    trato: "tu",
  },
  pistaDatos: null,
  spam: { dominiosNormales: ["doctoralia.es", "topdoctors.es"], ganchosQuitados: [] },
  portada: {
    descripcion: "Clínica dental de barrio. Pide tu cita y te escribimos por WhatsApp en segundos.",
    hero: { antetitulo: "Odontología · Barcelona", titular: "Pide tu cita.", subtitulo: "Te escribimos por WhatsApp en segundos.", foto: null },
    formulario: {
      chips: ["Respuesta en segundos", "Cita en esta conversación"],
      zona: "Zona o barrio",
      consentimiento: "Acepto que {negocio} me escriba por WhatsApp sobre esta solicitud.",
      urlPrivacidad: null,
      marcado: false,
      boton: "Enviar solicitud",
      enviado: ["Hecho", "Busca el mensaje de {negocio} en tu móvil"],
    },
    proceso: {
      titular: "Cómo funciona",
      foto: null,
      boton: "Rellenar el formulario",
      pasos: [
        { titulo: "Envías la solicitud", detalle: "Con tu nombre y tu WhatsApp es suficiente." },
        { titulo: "Te escribimos en segundos", detalle: "Por WhatsApp te preguntamos qué necesitas y si ya eres paciente." },
        { titulo: "Eliges tu cita", detalle: "Eliges {opciones}, sin salir de la conversación." },
        { titulo: "Vienes a la clínica", detalle: "En la primera visita vemos qué necesitas y te explicamos las opciones." },
      ],
      ejemplo: [
        { de: "cliente", texto: "Una limpieza. Es mi primera visita." },
        { de: "agente", texto: "Perfecto. Te propongo el {dia1} a las {hora1} o el {dia2} a las {hora2}. ¿Cuál te viene mejor?" },
        { de: "cliente", texto: "El {dia2}" },
        { de: "agente", texto: "Hecho: cita el {dia2} a las {hora2}. Si prefieres hablar con una persona, dímelo por aquí." },
      ],
    },
    whatsapp: {
      descripcion: "Clínica dental de barrio. Escríbenos por WhatsApp para pedir tu cita y te contestamos en segundos.",
      subtitulo: "Escríbenos por WhatsApp y te contestamos en segundos.",
      boton: "Escribir por WhatsApp",
      pasos: [
        { titulo: "Nos escribes por WhatsApp", detalle: "Pulsas el botón y se abre WhatsApp con el mensaje ya escrito: solo tienes que enviarlo." },
        { titulo: "Te contestamos en segundos", detalle: "Te preguntamos qué necesitas y si ya eres paciente." },
        { titulo: "Eliges tu cita", detalle: "Eliges {opciones}, sin salir de la conversación." },
        { titulo: "Vienes a la clínica", detalle: "En la primera visita vemos qué necesitas y te explicamos las opciones." },
      ],
    },
  },
  web: { entrada: "whatsapp", mensaje: "Hola, quiero pedir cita." },
};
