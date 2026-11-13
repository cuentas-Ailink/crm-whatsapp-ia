// Preset de reformas: el negocio de siempre del CRM, con el texto final de la portada y las frases.

import { REGLAS_POR_DEFECTO } from "../agenda";
import { FRASES_POR_DEFECTO, PISTA_DATOS_REFORMAS, PLANTILLA_GENERAL, type Preset } from "../configuracion";
import { REGIONAL_POR_DEFECTO } from "../regional";
import { CAMPOS_REFORMAS, VOCABULARIO_REFORMAS } from "../vocabulario";

export const PRESET_REFORMAS: Preset = {
  id: "reformas",
  etiqueta: "Reformas",
  descripcion: "Visitas para presupuestar obras",
  perfilId: "estudio-de-reformas",
  archivo: "perfiles/reformas.md",
  negocio: { nombre: "Estudio de reformas", lema: "Reformas integrales · Barcelona centro", color: null },
  plantilla: PLANTILLA_GENERAL,
  calendario: REGLAS_POR_DEFECTO,
  regional: REGIONAL_POR_DEFECTO,
  vocabulario: VOCABULARIO_REFORMAS,
  campos: CAMPOS_REFORMAS,
  agente: { catalogo: "auto", negociar: "auto", pasarSiempre: [], excepciones: [], frases: FRASES_POR_DEFECTO, trato: "tu" },
  pistaDatos: PISTA_DATOS_REFORMAS,
  spam: { dominiosNormales: [], ganchosQuitados: [] },
  portada: {
    descripcion: "Reformas integrales en Barcelona. Pide presupuesto y te escribimos por WhatsApp en segundos para reservar la visita.",
    hero: { antetitulo: "Reformas · Barcelona", titular: "Pide presupuesto.", subtitulo: "Te escribimos por WhatsApp en segundos.", foto: "/fotos/formulario.webp" },
    formulario: {
      chips: ["Respuesta en segundos", "Visita sin compromiso"],
      zona: "Zona o barrio",
      consentimiento: "Acepto que {negocio} me escriba por WhatsApp sobre esta solicitud.",
      urlPrivacidad: null,
      marcado: false,
      boton: "Enviar solicitud",
      enviado: ["Hecho", "Busca el mensaje de {negocio} en tu móvil"],
    },
    proceso: {
      titular: "Cómo funciona",
      foto: "/fotos/panel.webp",
      boton: "Rellenar el formulario",
      pasos: [
        { titulo: "Envías la solicitud", detalle: "Con tu nombre y tu WhatsApp es suficiente." },
        { titulo: "Te escribimos en segundos", detalle: "Por WhatsApp te preguntamos qué quieres reformar, los metros y cuándo te gustaría empezar." },
        { titulo: "Reservas la visita", detalle: "Eliges {opciones}, sin salir de la conversación." },
        { titulo: "Vemos el espacio contigo", detalle: "La visita es sin compromiso. Antes no damos precios: dependen de lo que veamos." },
        { titulo: "Recibes el presupuesto", detalle: "Si te encaja, fijamos las fechas y empezamos." },
      ],
      ejemplo: [
        { de: "cliente", texto: "La cocina, unos 12 metros. Me gustaría empezar en enero." },
        { de: "agente", texto: "Perfecto. Te propongo el {dia1} a las {hora1} o el {dia2} a las {hora2}. ¿Cuál te viene mejor?" },
        { de: "cliente", texto: "El {dia1}" },
        { de: "agente", texto: "Queda reservada: {dia1} a las {hora1}. Si prefieres hablar con una persona, dímelo por aquí." },
      ],
    },
    whatsapp: {
      descripcion: "Reformas integrales en Barcelona. Escríbenos por WhatsApp y te contestamos en segundos para reservar la visita.",
      subtitulo: "Escríbenos por WhatsApp y te contestamos en segundos.",
      boton: "Escribir por WhatsApp",
      pasos: [
        { titulo: "Nos escribes por WhatsApp", detalle: "Pulsas el botón y se abre WhatsApp con el mensaje ya escrito: solo tienes que enviarlo." },
        { titulo: "Te contestamos en segundos", detalle: "Te preguntamos qué quieres reformar, los metros y cuándo te gustaría empezar." },
        { titulo: "Reservas la visita", detalle: "Eliges {opciones}, sin salir de la conversación." },
        { titulo: "Vemos el espacio contigo", detalle: "La visita es sin compromiso. Antes no damos precios: dependen de lo que veamos." },
        { titulo: "Recibes el presupuesto", detalle: "Si te encaja, fijamos las fechas y empezamos." },
      ],
    },
  },
  web: { entrada: "whatsapp", mensaje: "Hola, quiero pedir presupuesto para una reforma." },
};
