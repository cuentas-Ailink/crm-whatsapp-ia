// Preset genérico («Otro»): un negocio desde cero, con el texto final de la portada y las frases.

import { REGLAS_POR_DEFECTO } from "../agenda";
import { FRASES_POR_DEFECTO, PLANTILLA_GENERAL, type Preset } from "../configuracion";
import { REGIONAL_POR_DEFECTO } from "../regional";

export const PRESET_GENERICO: Preset = {
  id: "generico",
  etiqueta: "Otro",
  descripcion: "Tu negocio, desde cero",
  perfilId: null,
  archivo: "perfiles/generico.md",
  negocio: { nombre: "Mi negocio", lema: "", color: null },
  plantilla: PLANTILLA_GENERAL,
  calendario: REGLAS_POR_DEFECTO,
  regional: REGIONAL_POR_DEFECTO,
  vocabulario: {
    cita: { singular: "cita", plural: "citas", genero: "f" },
    cliente: { singular: "cliente", plural: "clientes", genero: "m" },
    importe: { singular: "presupuesto", plural: "presupuestos", genero: "m" },
    zona: "Zona",
    equipo: "el equipo",
    catalogo: { singular: "piso", plural: "pisos", genero: "m" },
    ejemplos: { etiquetas: "urgente", dato: "presupuesto" },
  },
  campos: [
    { clave: "necesidad", etiqueta: "Qué necesita", resumen: true },
    { clave: "plazo", etiqueta: "Plazo" },
  ],
  agente: {
    catalogo: "auto",
    negociar: "auto",
    pasarSiempre: [],
    excepciones: [],
    frases: { ...FRASES_POR_DEFECTO, pase: "Entendido, te paso con una persona del equipo, que te escribe en cuanto pueda." },
    trato: "tu",
  },
  pistaDatos: null,
  spam: { dominiosNormales: [], ganchosQuitados: [] },
  portada: {
    descripcion: "Pide información o cita y te escribimos por WhatsApp en segundos.",
    hero: { antetitulo: "Atención por WhatsApp", titular: "Escríbenos.", subtitulo: "Te escribimos por WhatsApp en segundos.", foto: null },
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
        { titulo: "Te escribimos en segundos", detalle: "Por WhatsApp te preguntamos qué necesitas y para cuándo." },
        { titulo: "Eliges tu cita", detalle: "Eliges {opciones}, sin salir de la conversación." },
      ],
      ejemplo: [
        { de: "cliente", texto: "Quería información para empezar el mes que viene." },
        { de: "agente", texto: "Claro. Te propongo el {dia1} a las {hora1} o el {dia2} a las {hora2}. ¿Cuál te viene mejor?" },
        { de: "cliente", texto: "El {dia1}" },
        { de: "agente", texto: "Hecho: cita el {dia1} a las {hora1}. Si prefieres hablar con una persona, dímelo por aquí." },
      ],
    },
    whatsapp: {
      descripcion: "Escríbenos por WhatsApp para pedir información o cita y te contestamos en segundos.",
      subtitulo: "Escríbenos por WhatsApp y te contestamos en segundos.",
      boton: "Escribir por WhatsApp",
      pasos: [
        { titulo: "Nos escribes por WhatsApp", detalle: "Pulsas el botón y se abre WhatsApp con el mensaje ya escrito: solo tienes que enviarlo." },
        { titulo: "Te contestamos en segundos", detalle: "Te preguntamos qué necesitas y para cuándo." },
        { titulo: "Eliges tu cita", detalle: "Eliges {opciones}, sin salir de la conversación." },
      ],
    },
  },
  web: { entrada: "whatsapp", mensaje: "Hola, quiero más información." },
};
