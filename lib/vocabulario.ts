// Las palabras del negocio: cómo se llaman la cita, el cliente y el importe en cada sector, y las
// frases de la interfaz que dependen de ellas. Puro: lo usan el servidor y el navegador.

import { vinoDeLaWeb } from "./fuente";
import type { EstadoLead, Lead } from "./tipos";

export type Genero = "m" | "f";
export interface Sustantivo { singular: string; plural: string; genero: Genero; soloPlural?: boolean }
export interface CampoLead { clave: string; etiqueta: string; unidad?: string; resumen?: boolean }
export interface Vocabulario {
  cita: Sustantivo;          // visita | cita
  cliente: Sustantivo;       // cliente | paciente
  importe: Sustantivo;       // lo que nombra el asistente: presupuesto | comisión (la interfaz dice siempre «Importe»)
  zona: string | null;       // etiqueta de lead.zona; null = no se pide (también oculta el campo del formulario)
  equipo: string;            // a quién pasa el asistente: «el comercial» | «recepción» | «el equipo»
  catalogo: Sustantivo;      // lo que se reserva de una tabla Ref/Estado: «piso» por defecto
  ejemplos: { etiquetas: string; dato: string }; // ejemplos de la ficha
}
export const VOCABULARIO_REFORMAS: Vocabulario = {
  cita: { singular: "visita", plural: "visitas", genero: "f" },
  cliente: { singular: "cliente", plural: "clientes", genero: "m" },
  importe: { singular: "presupuesto", plural: "presupuestos", genero: "m" },
  zona: "Zona",
  equipo: "el comercial",
  catalogo: { singular: "piso", plural: "pisos", genero: "m" },
  ejemplos: { etiquetas: "cocina, financiación", dato: "presupuesto" },
};
export const CAMPOS_REFORMAS: CampoLead[] = [
  { clave: "tipo", etiqueta: "Tipo", resumen: true },
  { clave: "metros", etiqueta: "Metros", unidad: "m²", resumen: true },
  { clave: "plazo", etiqueta: "Plazo" },
];
export type Tono = "gris" | "ok" | "atencion";
export interface Formas { el: string; los: string; un: string; uno: string; ningun: string; otro: string; lo: string; ese: string; adj(raiz: string, plural?: boolean): string }
export interface DatosLineaMes { nuevos: number; conCita: number; si: number; importeSi: string; conversion: number | null; medianaSegundos: string | null }
export interface Frases {
  seccionClientes: string; buscarPlaceholder: string; nuevoCliente: string; tituloNuevoCliente: string;
  conTuAsistente: string; conCita: string; teToca: string; teTocaATi: string; publicidad: string; cerrados: string;
  cita: string; citaPasada: string; citasHoyYManana: string; sinCitasHoy: string; citasAparecenAqui: string;
  comoFue: string; comoFueCorto: string; haDichoQueSi: string; noSigue: string; reabrir: string;
  conversion(c: number): string; lineaMes(d: DatosLineaMes): string; nadieTeEspera: string;
  cliente: string; contactoEjemplo: string; pendientes(n: number): string; notasAyuda: string; notaPlaceholder: string;
  etiquetasPlaceholder: string; datoPlaceholder: string; importeConSimbolo: string; cobradoConSimbolo: string; zona: string | null;
}

// ---- Texto ----

export function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/** La primera letra en mayúscula. */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** «nuev» → «nuevo», «nueva», «nuevos», «nuevas», según el sustantivo. */
export function concordar(s: Sustantivo, raiz: string, plural = false): string {
  return raiz + (s.genero === "f" ? "a" : "o") + (plural || s.soloPlural ? "s" : "");
}

/** Artículos y determinantes que concuerdan con el sustantivo. */
export function formas(s: Sustantivo): Formas {
  const f = s.genero === "f";
  const adj = (raiz: string, plural?: boolean) => concordar(s, raiz, plural);
  if (s.soloPlural) {
    return f
      ? { el: "las", los: "las", un: "unas", uno: "unas", ningun: "ningunas", otro: "otras", lo: "las", ese: "esas", adj }
      : { el: "los", los: "los", un: "unos", uno: "unos", ningun: "ningunos", otro: "otros", lo: "los", ese: "esos", adj };
  }
  return f
    ? { el: "la", los: "las", un: "una", uno: "una", ningun: "ninguna", otro: "otra", lo: "la", ese: "esa", adj }
    : { el: "el", los: "los", un: "un", uno: "uno", ningun: "ningún", otro: "otro", lo: "lo", ese: "ese", adj };
}

/** El nombre del sustantivo tal como se usa en singular (los de solo plural, en plural). */
function nombre(s: Sustantivo): string {
  return s.soloPlural ? s.plural : s.singular;
}

// ---- Frases de la interfaz ----

const MONEDA_POR_DEFECTO = { simbolo: "€", nombre: "euros" };
const memoria = new WeakMap<Vocabulario, Map<string, Frases>>();

function construirFrases(v: Vocabulario, moneda: { simbolo: string; nombre: string }): Frases {
  const cita = v.cita;
  const cliente = v.cliente;
  const fc = formas(cita);
  const fcl = formas(cliente);
  const Cita = cap(nombre(cita));
  const Citas = cap(cita.plural);
  const este = cliente.soloPlural ? (cliente.genero === "f" ? "estas" : "estos") : cliente.genero === "f" ? "esta" : "este";
  const conversion = (c: number) => `el ${Math.round(c)} % de ${fc.los} ${cita.plural} acaban en sí`;
  return {
    seccionClientes: cap(cliente.plural),
    buscarPlaceholder: `Buscar ${cliente.singular} o teléfono`,
    nuevoCliente: `+ ${cap(cliente.singular)}`,
    tituloNuevoCliente: `${cap(concordar(cliente, "nuev"))} ${cliente.singular}`,
    conTuAsistente: "Con tu asistente",
    conCita: `Con ${cita.singular}`,
    teToca: "Te toca",
    teTocaATi: "Te toca a ti",
    publicidad: "Publicidad",
    cerrados: "Cerrados",
    cita: cap(cita.singular),
    citaPasada: `${Cita} ${concordar(cita, "pasad")}`,
    citasHoyYManana: `${Citas} de hoy y mañana`,
    sinCitasHoy: `Hoy no tienes ${cita.plural}.`,
    citasAparecenAqui: `Aquí saldrán ${fc.los} ${cita.plural} que reserve tu asistente`,
    comoFue: `¿Cómo fue ${fc.el} ${nombre(cita)}?`,
    comoFueCorto: "¿Cómo fue?",
    haDichoQueSi: "Ha dicho que sí",
    noSigue: "No sigue",
    reabrir: "Reabrir",
    conversion,
    lineaMes(d: DatosLineaMes): string {
      const partes = [
        `${d.nuevos} ${d.nuevos === 1 ? cliente.singular : cliente.plural} ${concordar(cliente, "nuev", d.nuevos !== 1)}`,
        `${d.conCita} con ${cita.singular}`,
        `${d.si} ${d.si === 1 ? "ha" : "han"} dicho que sí${d.si > 0 && d.importeSi ? ` (${d.importeSi})` : ""}`,
      ];
      if (d.conversion !== null) partes.push(conversion(d.conversion));
      if (d.medianaSegundos !== null) partes.push(`primer WhatsApp en ${d.medianaSegundos} s de mediana`);
      return `Este mes: ${partes.join(" · ")}`;
    },
    nadieTeEspera: "Nadie te espera. Tu asistente lo lleva todo.",
    cliente: cap(cliente.singular),
    contactoEjemplo: "Contacto de ejemplo",
    pendientes: (n: number) => (n === 1 ? "1 pendiente" : `${n} pendientes`),
    notasAyuda: `Solo las ves tú; ${fcl.el} ${nombre(cliente)}, nunca.`,
    notaPlaceholder: `Algo que quieras recordar de ${este} ${nombre(cliente)}`,
    etiquetasPlaceholder: `Separadas por comas, p. ej. ${v.ejemplos.etiquetas}`,
    datoPlaceholder: `Nombre, como «${v.ejemplos.dato}»`,
    importeConSimbolo: `Importe (${moneda.simbolo})`,
    cobradoConSimbolo: `Cobrado (${moneda.simbolo})`,
    zona: v.zona,
  };
}

/** Las frases de la interfaz para un vocabulario y una moneda. Se calculan una vez por objeto. */
export function frases(v: Vocabulario = VOCABULARIO_REFORMAS, moneda: { simbolo: string; nombre: string } = MONEDA_POR_DEFECTO): Frases {
  let porMoneda = memoria.get(v);
  if (!porMoneda) {
    porMoneda = new Map();
    memoria.set(v, porMoneda);
  }
  const clave = `${moneda.simbolo}|${moneda.nombre}`;
  let f = porMoneda.get(clave);
  if (!f) {
    f = construirFrases(v, moneda);
    porMoneda.set(clave, f);
  }
  return f;
}

/** Los nombres de etapa que ve el dueño. */
export function nombresEtapa(v: Vocabulario = VOCABULARIO_REFORMAS): Record<EstadoLead, { nombre: string; tono: Tono }> {
  return {
    nuevo: { nombre: "Con tu asistente", tono: "gris" },
    conversacion: { nombre: "Con tu asistente", tono: "gris" },
    visita: { nombre: `Con ${v.cita.singular}`, tono: "ok" },
    persona: { nombre: "Te toca", tono: "atencion" },
    spam: { nombre: "Publicidad", tono: "gris" },
  };
}

/** Los nombres internos de cada etapa: el contexto del asistente y el historial guardado. */
export function nombresInternos(v: Vocabulario = VOCABULARIO_REFORMAS): Record<EstadoLead, string> {
  return {
    nuevo: "Nuevo",
    conversacion: "En conversación",
    visita: `${cap(nombre(v.cita))} ${concordar(v.cita, "reservad")}`,
    persona: "Pasado a persona",
    spam: "Spam",
  };
}

/** Los títulos de las secciones del prompt que el código busca. */
export function seccionesDelPrompt(v: Vocabulario = VOCABULARIO_REFORMAS): {
  preguntas: "Qué preguntas";
  cita: string;
  persona: "Pasar a una persona";
  informacion: "Información que puedes dar tal cual";
} {
  return {
    preguntas: "Qué preguntas",
    cita: `${cap(formas(v.cita).el)} ${nombre(v.cita)}`,
    persona: "Pasar a una persona",
    informacion: "Información que puedes dar tal cual",
  };
}

// ---- Historial ----

/**
 * Cambia las palabras del historial guardado al pintarlo; lo guardado no se toca nunca. Lo que no
 * está en la tabla sale tal cual.
 */
export function etiquetarActividad(texto: string, f: Frases): string {
  const femenina = f.citaPasada.endsWith("pasada");
  const participio = (raiz: string) => raiz + (femenina ? "a" : "o");
  const conResto = (prefijo: string, nuevo: string): string | null => {
    if (texto === prefijo) return nuevo;
    if (texto.startsWith(`${prefijo}: `)) return `${nuevo}${texto.slice(prefijo.length)}`;
    return null;
  };
  const fijos: [string, string][] = [
    ["Estado: Nuevo", "Llegó"],
    ["Estado: En conversación", "Ha contestado"],
    ["Estado: Visita reservada", `${f.cita} ${participio("reservad")}`],
    ["Visita reservada", `${f.cita} ${participio("reservad")}`],
    ["Visita cambiada", `${f.cita} ${participio("cambiad")}`],
    ["Visita anulada", `${f.cita} ${participio("anulad")}`],
    ["Pasado a persona", "Te toca"],
    ["Marcado como spam", "Es publicidad"],
    ["Nota interna", "Nota"],
    ["Tarea añadida", "Pendiente"],
  ];
  for (const [prefijo, nuevo] of fijos) {
    const resultado = conResto(prefijo, nuevo);
    if (resultado !== null) return resultado;
  }
  if (texto.startsWith("Ficha editada: ")) {
    const lista = texto.slice("Ficha editada: ".length).split(", ");
    return `Ficha editada: ${lista.map((c) => (c === "presupuesto" ? "importe" : c)).join(", ")}`;
  }
  const tareas: Record<string, string> = {
    "Tarea hecha": "Pendiente hecho",
    "Tarea reabierta": "Pendiente reabierto",
    "Tarea borrada": "Pendiente borrado",
  };
  return tareas[texto] ?? texto;
}

// ---- Campos de la ficha ----

/** En minúsculas, sin acentos y con «_» en vez de espacios. */
export function normalizarClave(c: string): string {
  return normalizar(c).replace(/ /g, "_");
}

function campoDe(clave: string, campos?: CampoLead[]): CampoLead | undefined {
  if (!campos) return undefined;
  const buscada = normalizarClave(clave);
  return campos.find((c) => normalizarClave(c.clave) === buscada);
}

export function etiquetaCampo(clave: string, campos?: CampoLead[]): string {
  return campoDe(clave, campos)?.etiqueta ?? clave.replace(/_/g, " ");
}

const NUMERO = /^\d+([.,]\d+)?$/;

/** Añade la unidad a un número suelto. Sin campos, la regla de siempre de los metros. */
export function valorCampo(clave: string, valor: string, campos?: CampoLead[]): string {
  const campo = campoDe(clave, campos);
  if (campo) {
    if (campo.unidad && NUMERO.test(valor.trim())) return `${valor.trim()} ${campo.unidad}`;
    return valor.replace(/\bm2\b/gi, "m²");
  }
  return clave.includes("metro") && NUMERO.test(valor.trim()) ? `${valor.trim()} m²` : valor.replace(/\bm2\b/gi, "m²");
}

export function campoPrincipal(campos?: CampoLead[]): string | undefined {
  return campos?.find((c) => c.resumen)?.clave;
}

/** Los tres primeros datos que ha dado el cliente, para la tarjeta y la lista. */
export function resumenDatos(lead: Lead, campos?: CampoLead[]): string {
  const partes = Object.entries(lead.datos)
    .slice(0, 3)
    .map(([campo, valor]) => valorCampo(campo, valor, campos));
  if (partes.length === 0) return vinoDeLaWeb(lead) ? "Te escribió desde tu web" : lead.origen === "whatsapp" ? "Escribió por WhatsApp" : "Pidió información";
  partes[0] = partes[0].charAt(0).toUpperCase() + partes[0].slice(1);
  return partes.join(" · ");
}

/** «Laura Martínez» → «Laura». Un teléfono enmascarado sale tal cual. */
export function nombreDePila(nombre: string): string {
  const limpio = nombre.trim();
  if (!limpio || /^[+\d]/.test(limpio)) return limpio;
  return limpio.split(/\s+/)[0];
}
