// Preset de inmobiliaria: pisos, visitas y comisiones, con el texto final de la portada y las frases.

import { REGLAS_POR_DEFECTO } from "../agenda";
import { FRASES_POR_DEFECTO, PISTA_DATOS_REFORMAS, PLANTILLA_GENERAL, type Preset } from "../configuracion";
import { REGIONAL_POR_DEFECTO } from "../regional";

export const PRESET_INMOBILIARIA: Preset = {
  id: "inmobiliaria",
  etiqueta: "Inmobiliaria",
  descripcion: "Pisos, visitas y comisiones",
  perfilId: "inmobiliaria",
  archivo: "perfiles/inmobiliaria.md",
  negocio: { nombre: "Inmobiliaria", lema: "Compra y venta de pisos · Barcelona", color: "#c2562d" },
  plantilla: PLANTILLA_GENERAL,
  calendario: { ...REGLAS_POR_DEFECTO, diasAbiertos: [1, 2, 3, 4, 5, 6] },
  regional: REGIONAL_POR_DEFECTO,
  vocabulario: {
    cita: { singular: "visita", plural: "visitas", genero: "f" },
    cliente: { singular: "cliente", plural: "clientes", genero: "m" },
    importe: { singular: "comisión", plural: "comisiones", genero: "f" },
    zona: "Zona que busca",
    equipo: "el comercial",
    catalogo: { singular: "piso", plural: "pisos", genero: "m" },
    ejemplos: { etiquetas: "financiación, reformar", dato: "hipoteca" },
  },
  campos: [
    { clave: "piso", etiqueta: "Piso de interés", resumen: true },
    { clave: "uso", etiqueta: "Para vivir o invertir", resumen: true },
    { clave: "financiacion", etiqueta: "Financiación" },
    { clave: "plazo", etiqueta: "Plazo" },
  ],
  agente: { catalogo: "auto", negociar: "auto", pasarSiempre: [], excepciones: [], frases: FRASES_POR_DEFECTO, trato: "tu" },
  pistaDatos: PISTA_DATOS_REFORMAS,
  spam: { dominiosNormales: [], ganchosQuitados: [] },
  portada: {
    descripcion: "Pisos en venta en Barcelona. Pide una visita y te escribimos por WhatsApp en segundos.",
    hero: { antetitulo: "Inmobiliaria · Barcelona", titular: "Pide una visita.", subtitulo: "Te escribimos por WhatsApp en segundos.", foto: "/fotos/formulario.webp" },
    formulario: {
      chips: ["Respuesta en segundos", "Visita en esta conversación"],
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
        { titulo: "Te escribimos en segundos", detalle: "Por WhatsApp te preguntamos qué buscas, si es para vivir o invertir y cómo lo pagarías." },
        { titulo: "Reservas la visita", detalle: "Eliges {opciones}, sin salir de la conversación." },
        { titulo: "Ves el piso", detalle: "Te lo enseña una persona del equipo, sin compromiso." },
      ],
      ejemplo: [
        { de: "cliente", texto: "Me interesa el piso de Calle Mallorca. Es para vivir." },
        { de: "agente", texto: "Genial. ¿Tienes ya la hipoteca aprobada o la estás mirando?" },
        { de: "cliente", texto: "Preaprobada." },
        { de: "agente", texto: "Perfecto. Te propongo el {dia1} a las {hora1} o el {dia2} a las {hora2}. ¿Cuál te viene mejor?" },
        { de: "cliente", texto: "El {dia2}" },
        { de: "agente", texto: "Hecho: visita el {dia2} a las {hora2} en Calle Mallorca. Si prefieres hablar con una persona, dímelo por aquí." },
      ],
    },
    whatsapp: {
      descripcion: "Pisos en venta en Barcelona. Escríbenos por WhatsApp y te contestamos en segundos.",
      subtitulo: "Escríbenos por WhatsApp y te contestamos en segundos.",
      boton: "Escribir por WhatsApp",
      pasos: [
        { titulo: "Nos escribes por WhatsApp", detalle: "Pulsas el botón y se abre WhatsApp con el mensaje ya escrito: solo tienes que enviarlo." },
        { titulo: "Te contestamos en segundos", detalle: "Te preguntamos qué buscas, si es para vivir o invertir y cómo lo pagarías." },
        { titulo: "Reservas la visita", detalle: "Eliges {opciones}, sin salir de la conversación." },
        { titulo: "Ves el piso", detalle: "Te lo enseña una persona del equipo, sin compromiso." },
      ],
    },
  },
  web: { entrada: "whatsapp", mensaje: "Hola, quiero información sobre un inmueble." },
};
