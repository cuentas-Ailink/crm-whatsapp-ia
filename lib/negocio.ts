// Las reglas del negocio las decide este código, no el modelo: qué huecos existen,
// qué está reservado y cómo cambia el estado de un lead. Es puro: lo usan el servidor
// y el navegador, y no toca ni el disco ni la red.

import { ESTADOS_OBRA, type CambiosFicha, type CambiosProyecto, type EstadoLead, type EstadoObra, type Lead, type Mensaje } from "./tipos";
import { importeMaximo, MONEDAS, type Moneda } from "./regional";
import { normalizar, type Vocabulario } from "./vocabulario";

export * from "./agenda";
export * from "./regional";
export * from "./guion";

// ---- Catálogo (los pisos de la inmobiliaria) ----

export interface Ficha {
  ref: string;
  descripcion: string;
  estado: string;
  disponible: boolean;
}

const celdas = (linea: string) =>
  linea
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/**
 * Lee la tabla de agente.md que tenga columnas «Ref» y «Estado». Así el código sabe qué está
 * disponible sin tocar el código: si cambia la tabla, cambia lo que se puede reservar. Un perfil
 * sin tabla, como el de reformas, no tiene catálogo.
 */
export function leerFichas(markdown: string): Ficha[] {
  const lineas = markdown.split(/\r?\n/);
  const cabecera = lineas.findIndex((l) => l.trim().startsWith("|") && /\bref\b/i.test(l) && /\bestado\b/i.test(l));
  if (cabecera < 0) return [];
  const nombres = celdas(lineas[cabecera]).map(normalizar);
  const iRef = nombres.findIndex((c) => c.startsWith("ref"));
  const iEstado = nombres.indexOf("estado");
  const fichas: Ficha[] = [];
  for (const linea of lineas.slice(cabecera + 2)) {
    if (!linea.trim().startsWith("|")) break;
    const fila = celdas(linea);
    const ref = fila[iRef];
    const estado = fila[iEstado] ?? "";
    if (!ref) continue;
    fichas.push({ ref, descripcion: fila[iRef === 0 ? 1 : 0] ?? "", estado, disponible: normalizar(estado).startsWith("disponible") });
  }
  return fichas;
}

const PALABRAS_VACIAS = new Set(["calle", "carrer", "avenida", "plaza", "paseo", "piso"]);

/** Por referencia (P-103, 103) o por la calle o el barrio (Sants, calle Mallorca). Si es ambiguo, ninguna. */
export function buscarFicha(fichas: Ficha[], texto: string): Ficha | undefined {
  const compacto = (t: string) => normalizar(t).replace(/[^a-z0-9]/g, "");
  const buscado = normalizar(texto);
  const soloNumero = /^\D{0,3}\d+$/.test(buscado) ? buscado.replace(/\D/g, "") : null;
  const porRef = fichas.find((f) => compacto(f.ref) === compacto(texto) || f.ref.replace(/\D/g, "") === soloNumero);
  if (porRef) return porRef;
  const palabrasBuscadas = new Set(buscado.split(/[^a-z0-9]+/));
  const coinciden = fichas.filter((f) =>
    normalizar(f.descripcion)
      .split(/[^a-z0-9]+/)
      .some((palabra) => palabra.length >= 4 && !PALABRAS_VACIAS.has(palabra) && palabrasBuscadas.has(palabra)),
  );
  return coinciden.length === 1 ? coinciden[0] : undefined;
}

// ---- Perfil ----

/** El perfil activo se deduce del título de agente.md. */
export function leerTitulo(markdown: string): { id: string; nombre: string } {
  const titulo = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Asistente";
  const nombre = titulo.split("·").pop()?.trim() || titulo;
  return { id: normalizar(nombre).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), nombre };
}

// ---- Leads ----

export function idDeLead(telefono: string, perfilId: string): string {
  return `${telefono}:${perfilId}`;
}

export function crearLead(campos: Pick<Lead, "telefono" | "perfilId" | "perfilNombre" | "nombre" | "origen"> & Partial<Lead>): Lead {
  const ahora = campos.creadoEn ?? Date.now();
  return {
    id: idDeLead(campos.telefono, campos.perfilId),
    estado: "nuevo",
    datos: {},
    mensajes: [],
    creadoEn: ahora,
    actualizadoEn: ahora,
    cambioEstadoEn: ahora,
    huecosOfrecidos: [],
    ...campos,
  };
}

// ---- Ficha editada desde el panel ----

export const LARGO_FICHA = { nombre: 80, email: 120, zona: 80, campo: 40, valor: 300, etiqueta: 24 };
export const MAXIMO_DATOS = 20;
export const MAXIMO_ETIQUETAS = 6;
export const IMPORTE_MAXIMO = 1_000_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Los de ejemplo no tienen WhatsApp: no se les escribe ni avisan al comercial. `prueba` es la marca antigua. */
export function esEjemplo(lead: Pick<Lead, "origen" | "ejemplo">): boolean {
  return lead.ejemplo === true || lead.origen === "prueba";
}

/** Cómo se llama cada etapa en el panel, en los informes y en la hoja exportada. */
export const NOMBRE_ETAPA: Record<EstadoLead, string> = {
  nuevo: "Nuevo",
  conversacion: "En conversación",
  visita: "Visita reservada",
  persona: "Pasado a persona",
  spam: "Spam",
};

/** Lo que el panel puede cambiar en una obra. Solo se acepta lo que existe y tiene sentido. */
export function revisarCambioProyecto(entrada: unknown): { cambios: CambiosProyecto } | { error: string } {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) return { error: "No hay cambios que guardar" };
  const e = entrada as Record<string, unknown>;
  const cambios: CambiosProyecto = {};

  if (e.estado !== undefined) {
    if (!(ESTADOS_OBRA as readonly unknown[]).includes(e.estado)) return { error: "Esa fase no existe" };
    cambios.estado = e.estado as EstadoObra;
  }
  if (e.avance !== undefined) {
    if (typeof e.avance !== "number" || !Number.isInteger(e.avance) || e.avance < 0 || e.avance > 100) {
      return { error: "El avance tiene que ser un número entero de 0 a 100" };
    }
    cambios.avance = e.avance;
  }
  if (e.leadId !== undefined) {
    if (e.leadId !== null && typeof e.leadId !== "string") return { error: "El cliente no tiene el formato esperado" };
    cambios.leadId = e.leadId;
  }
  if (!Object.keys(cambios).length) return { error: "No hay cambios que guardar" };
  return { cambios };
}

/** Como los guarda el asistente (`guardar_dato`): en minúsculas y sin espacios en los extremos. */
export function nombreDeDato(campo: string): string {
  return campo.toLowerCase().trim();
}

function limpiar(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

/**
 * Revisa lo que llega de la ficha y se queda con lo que cambia de verdad. Un campo vacío se
 * borra. El teléfono no está: forma parte del id del lead. La etapa y la visita tienen sus reglas.
 */
export function revisarCambiosFicha(
  lead: Lead,
  entrada: unknown,
  o?: { vocabulario?: Vocabulario; moneda?: Moneda },
): { cambios: CambiosFicha } | { error: string } {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) return { error: "No hay cambios que guardar" };
  const e = entrada as Record<string, unknown>;
  const cambios: CambiosFicha = {};

  if (e.nombre !== undefined) {
    const nombre = typeof e.nombre === "string" ? limpiar(e.nombre) : "";
    if (!nombre) return { error: "El nombre no puede quedar vacío" };
    if (nombre.length > LARGO_FICHA.nombre) return { error: `El nombre no puede pasar de ${LARGO_FICHA.nombre} caracteres` };
    if (nombre !== lead.nombre) cambios.nombre = nombre;
  }

  for (const [campo, etiqueta] of [["email", "El email"], ["zona", "La zona"]] as const) {
    if (e[campo] === undefined) continue;
    if (e[campo] !== null && typeof e[campo] !== "string") return { error: `${etiqueta} no tiene el formato esperado` };
    const valor = typeof e[campo] === "string" ? limpiar(e[campo]) || null : null;
    if (valor && valor.length > LARGO_FICHA[campo]) return { error: `${etiqueta} no puede pasar de ${LARGO_FICHA[campo]} caracteres` };
    if (campo === "email" && valor && !EMAIL.test(valor)) return { error: "Revisa el email: le falta la @ o el dominio" };
    if (valor !== (lead[campo] ?? null)) cambios[campo] = valor;
  }

  // Los importes van en la moneda del negocio, sin decimales y hasta el máximo de esa moneda.
  // Una sola palabra para el dinero en la interfaz (F46): «El importe», en cualquier sector.
  const moneda = o?.moneda ?? "EUR";
  for (const [campo, etiqueta] of [["presupuesto", "El importe"], ["cobrado", "Lo cobrado"]] as const) {
    if (e[campo] === undefined) continue;
    const valor = e[campo];
    if (valor === null) {
      if (lead[campo] !== undefined) cambios[campo] = null;
      continue;
    }
    if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 0 || valor > importeMaximo(moneda)) {
      return { error: `${etiqueta} tiene que ser una cantidad en ${MONEDAS[moneda].nombre}, sin decimales` };
    }
    if (valor !== lead[campo]) cambios[campo] = valor;
  }

  if (e.etiquetas !== undefined) {
    if (!Array.isArray(e.etiquetas) || e.etiquetas.some((t) => typeof t !== "string")) {
      return { error: "Las etiquetas no tienen el formato esperado" };
    }
    const etiquetas = [...new Set(e.etiquetas.map((t) => limpiar(t).toLowerCase()).filter(Boolean))];
    if (etiquetas.length > MAXIMO_ETIQUETAS) return { error: `Caben ${MAXIMO_ETIQUETAS} etiquetas por lead` };
    const larga = etiquetas.find((t) => t.length > LARGO_FICHA.etiqueta);
    if (larga) return { error: `Una etiqueta no puede pasar de ${LARGO_FICHA.etiqueta} caracteres` };
    const actuales = lead.etiquetas ?? [];
    if (etiquetas.join("\n") !== actuales.join("\n")) cambios.etiquetas = etiquetas;
  }

  if (e.datos !== undefined) {
    if (typeof e.datos !== "object" || e.datos === null || Array.isArray(e.datos)) return { error: "Los datos no tienen el formato esperado" };
    const datos = new Map<string, string | null>();
    for (const [crudo, v] of Object.entries(e.datos)) {
      // Uno que ya existe se respeta tal cual, aunque lo guardara así una versión anterior.
      const campo = crudo in lead.datos ? crudo : nombreDeDato(crudo);
      if (!campo) return { error: "Cada dato necesita un nombre" };
      if (campo.length > LARGO_FICHA.campo) return { error: `El nombre de un dato no puede pasar de ${LARGO_FICHA.campo} caracteres` };
      if (v !== null && typeof v !== "string") return { error: `«${campo}» no tiene el formato esperado` };
      const valor = typeof v === "string" ? limpiar(v) || null : null;
      if (valor && valor.length > LARGO_FICHA.valor) return { error: `«${campo}» no puede pasar de ${LARGO_FICHA.valor} caracteres` };
      const actual = Object.hasOwn(lead.datos, campo) ? lead.datos[campo] : null;
      if (valor !== actual) datos.set(campo, valor);
    }
    const quedan = new Set(Object.keys(lead.datos));
    for (const [campo, valor] of datos) {
      if (valor === null) quedan.delete(campo);
      else quedan.add(campo);
    }
    if (quedan.size > MAXIMO_DATOS) return { error: `Caben ${MAXIMO_DATOS} datos por lead` };
    if (datos.size) cambios.datos = Object.fromEntries(datos);
  }

  return { cambios };
}

// ---- Historial para el modelo ----

export interface MensajeModelo {
  role: "user" | "assistant";
  content: string;
}

/**
 * Últimos 30 mensajes como texto. Junta los seguidos del mismo rol y empieza siempre por
 * `user`: la plantilla abre la conversación con `assistant` y la API lo rechaza con un 400.
 */
export function normalizarHistorial(mensajes: Mensaje[]): MensajeModelo[] {
  const salida: MensajeModelo[] = [];
  const recientes = mensajes.slice(-30);
  for (const m of recientes) {
    const role = m.de === "cliente" ? "user" : "assistant";
    const texto = m.audio ? `[nota de voz] ${m.texto}` : m.texto;
    const ultimo = salida[salida.length - 1];
    if (ultimo?.role === role) ultimo.content += `\n${texto}`;
    else salida.push({ role, content: texto });
  }
  if (salida[0]?.role === "assistant") {
    const inicio = recientes[0].plantilla
      ? "(El cliente acaba de rellenar el formulario web)"
      : "(Continuación de la conversación)";
    salida.unshift({ role: "user", content: inicio });
  }
  return salida;
}
