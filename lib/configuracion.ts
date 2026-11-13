// La configuración del negocio: tipos, constantes y funciones puras. Lo usan el servidor y el navegador;
// leer y guardar la configuración es cosa de lib/configuracion-servidor.ts.

import { REGLAS_POR_DEFECTO, revisarReglas, verHuecos, ZONAS_HORARIAS } from "./agenda";
import { controles, horasCitadas, importesCitados, seccionDe, sinSeccion } from "./guion";
import { leerFichas, leerTitulo } from "./negocio";
import { MONEDAS, normalizarTelefono, PAISES, REGIONAL_POR_DEFECTO } from "./regional";
import type { Moneda, Regional } from "./regional";
import type { OpcionesSemilla } from "./semillas/tipos";
import { GANCHOS, ganchosEn } from "./spam";
import type { ReglasAgenda } from "./tipos";
import { CAMPOS_REFORMAS, normalizar, normalizarClave, seccionesDelPrompt, VOCABULARIO_REFORMAS } from "./vocabulario";
import type { CampoLead, Vocabulario } from "./vocabulario";

export type SectorPreset = "reformas" | "inmobiliaria" | "clinica" | "generico";
export type SectorId = "reformas" | "inmobiliaria" | "clinica" | "personalizado";
export type TriEstado = "auto" | "si" | "no";
export type ParcialProfundo<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? ParcialProfundo<T[K]> : T[K] };
export type ParcialConNulos<T> = { [K in keyof T]?: (T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? ParcialConNulos<T[K]> : T[K]) | null };

export interface Plantilla { nombre: string; idioma: string; texto: string } // texto = cuerpo aprobado, un {{1}} y un {{2}}
export interface ReglaPase { motivo: string /* "" → «Ha escrito «<frase>»»; la regla con motivo "" es la lista «Pásamelo siempre si escribe…» */; frases: string[]; respuesta?: string }
export interface FrasesFijas { pase: string; fallo: string; noTexto: string; audio: string; baja: string; presentacion: string /* con {negocio} */; borrarDatos: string /* con {negocio} */ }
export interface ReglasAgente { catalogo: TriEstado; negociar: TriEstado; pasarSiempre: ReglaPase[]; excepciones: string[]; frases: FrasesFijas; trato: "tu" | "usted" }

export const FOTOS_PORTADA = ["/fotos/formulario.webp", "/fotos/panel.webp", "/fotos/proyecto-1.webp", "/fotos/proyecto-2.webp", "/fotos/proyecto-3.webp", "/fotos/proyecto-4.webp", "/fotos/proyecto-5.webp", "/fotos/proyecto-6.webp"] as const;
export type FotoPortada = (typeof FOTOS_PORTADA)[number];
export interface Portada {
  descripcion: string;                                          // <meta description>, ≤ 160
  hero: { antetitulo: string /* ≤ 24 */; titular: string /* 1–40: «Pide presupuesto.» */; subtitulo: string /* 0–90: «Te escribimos por WhatsApp en segundos.» */; foto: FotoPortada | null };
  formulario: { chips: [string, string]; zona: string /* etiqueta; visible solo si vocabulario.zona !== null; la interfaz añade «(opcional)» */;
                consentimiento: string /* con {negocio} */; urlPrivacidad: string | null; marcado: boolean; boton: string; enviado: [string, string] /* pueden llevar {negocio} */ };
  proceso: { titular: string /* «Cómo funciona», ≤ 40 */; foto: FotoPortada | null; pasos: { titulo: string; detalle: string /* puede llevar {opciones} */ }[]; boton: string;
             ejemplo: { de: "cliente" | "agente"; texto: string /* {dia1} {hora1} {dia2} {hora2} {opciones} */ }[] };
  /** Los textos que cambian cuando te escriben con el botón de WhatsApp (web.entrada = "whatsapp") en vez del formulario. */
  whatsapp: { descripcion: string /* ≤ 160 */; subtitulo: string /* 0–90 */; boton: string /* el de «Cómo funciona» */; pasos: { titulo: string; detalle: string }[] };
  /** Opcionales: ningún preset los trae; solo los pone Claude Code con negocios/*.json. Sin ellos no se pintan. */
  galeria?: { titular: string; nota: string; tarjetas: { titulo: string; detalle: string; foto: number | null /* 1..6 */; descripcion: string }[] };
  estudio?: { titular: string; texto: string; servicios: { nombre: string; detalle: string }[] };
}
/** Cómo te escribe un cliente desde la web: con el botón de WhatsApp (él escribe primero) o con el formulario. */
export type EntradaWeb = "whatsapp" | "formulario";
export const ENTRADAS_WEB: readonly EntradaWeb[] = ["whatsapp", "formulario"];
export interface Web { entrada: EntradaWeb; mensaje: string /* 1–300, el texto que se escribe solo; puede llevar {negocio} */ }
export interface ValoresSector {
  negocio: { nombre: string; lema: string; color: string | null }; // null = verde clásico
  plantilla: Plantilla;
  calendario: ReglasAgenda;
  regional: Regional;
  vocabulario: Vocabulario;
  campos: CampoLead[];
  agente: ReglasAgente;
  pistaDatos: { descripcion: string; campo: string } | null;       // null = generada desde campos
  spam: { dominiosNormales: string[]; ganchosQuitados: string[] };
  portada: Portada;
  web: Web;
}
export interface Preset extends ValoresSector { id: SectorPreset; etiqueta: string; descripcion: string; perfilId: string | null /* null en generico */; archivo: string }
export interface ConfiguracionPerfil {
  sector?: "personalizado"; base?: SectorPreset;
  negocio?: { nombre?: string; lema?: string; color?: string | null; logoVersion?: string /* hash del contenido */ };
  plantilla?: Plantilla;
  calendario?: Partial<ReglasAgenda>; regional?: Partial<Regional>;
  vocabulario?: ParcialProfundo<Vocabulario>; campos?: CampoLead[];
  agente?: ParcialProfundo<ReglasAgente>;
  spam?: Partial<ValoresSector["spam"]>; portada?: ParcialProfundo<Portada>;
  web?: Partial<Web>;
}
export const MODELOS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;
export type IdModelo = (typeof MODELOS)[number];
export const NOMBRES_MODELO: Record<IdModelo, string> = { "claude-haiku-5-5": "Rápido (recomendado)", "claude-sonnet-5-5": "Más cuidadoso, más caro" };
export interface ConfiguracionSistema {
  asistente: { activo: boolean; pausadoEn: number | null; modelo: IdModelo | null /* null = MODELO de .env, si no Haiku */ };
  avisos: { comercial: { telefono: string | null /* null = TELEFONO_COMERCIAL de .env; "" = sin aviso */; detalle: "completo" | "minimo" } };
  primerCliente: { contestado: boolean };  // «Ha llegado tu primer cliente de verdad…» ya contestado
}
export type CambiosSistema = {
  asistente?: { modelo?: IdModelo | null };
  avisos?: { comercial?: { telefono?: string | null; detalle?: "completo" | "minimo" } };
  primerCliente?: { contestado?: boolean };
}; // los campos en vivo (activo, pausadoEn) no entran: solo POST /api/asistente/activo
export interface ConfiguracionGuardada { version: 1; rev: number; perfiles: Record<string, ConfiguracionPerfil>; sistema: ParcialProfundo<ConfiguracionSistema> }
/** PATCH de un perfil: objetos se fusionan, arrays se sustituyen, null borra. logoVersion solo por /api/logo. */
export type CambiosPerfil = ParcialConNulos<Omit<ConfiguracionPerfil, "sector" | "base">>;
export interface CopiaInstrucciones { texto: string; hash: string; origen: string | null; guardadaEn: number }
export type CopiasInstrucciones = Record<string, CopiaInstrucciones>;
export interface ConfiguracionResuelta extends ValoresSector {
  perfil: { id: string; nombre: string; hash: string };
  sector: SectorId; base: SectorPreset; guardada: boolean;
  negocio: ValoresSector["negocio"] & { logoUrl: string | null }; // "/api/logo?perfil=<id>&v=<logoVersion>"
  pistaDatos: { descripcion: string; campo: string };
  sistema: ConfiguracionSistema;
  rev: number; firma: string;                                       // FNV-1a de la parte pública
}
/** Lo que viaja en Bd cada 3 s. */
export type ConfiguracionPublica = Omit<ConfiguracionResuelta, "portada" | "spam" | "agente" | "pistaDatos" | "plantilla"> & { plantilla: Pick<Plantilla, "nombre" | "idioma"> };
export interface ConfigAgente { negocio: string; calendario: ReglasAgenda; vocabulario: Vocabulario; campos: CampoLead[]; pistaDatos: { descripcion: string; campo: string }; agente: ReglasAgente; moneda: Moneda }
export interface NegocioExportado { formato: "crm-whatsapp/negocio@1"; nombre: string; base: SectorPreset; configuracion: Omit<ConfiguracionPerfil, "sector" | "base">; instrucciones: string }
export interface RevisionPrompt { error?: string; avisos: string[]; info: string[]; catalogo: { activo: boolean; refs: number; disponibles: number }; negociarAPersona: boolean }
export type IdSeccionConfiguracion = "negocio" | "web" | "asistente" | "agenda" | "whatsapp";
export const SECCIONES_CONFIGURACION: { id: IdSeccionConfiguracion; nombre: string; ancla: string }[] = [
  { id: "negocio", nombre: "Tu negocio", ancla: "negocio" },
  { id: "web", nombre: "Tu web", ancla: "web" },
  { id: "asistente", nombre: "Tu asistente", ancla: "asistente" },
  { id: "agenda", nombre: "Horario de citas", ancla: "horario" },
  { id: "whatsapp", nombre: "Conexiones", ancla: "conexiones" },
];
export const COLORES_MARCA: { color: string | null; nombre: string }[] = [
  { color: null, nombre: "Clásico" }, { color: "#2b7bb9", nombre: "Azul" }, { color: "#c2562d", nombre: "Teja" },
  { color: "#5b5bd6", nombre: "Violeta" }, { color: "#d9467a", nombre: "Frambuesa" }, { color: "#3d3d3d", nombre: "Grafito" },
];

export const PERFIL_EJEMPLO = "ejemplo";
export const CANAL_CONFIGURACION = "demo:configuracion";
/** Heredado: el cuerpo de solicitud_recibida. Solo con PLANTILLA en .env (regla E1) y para pintar mensajes guardados. */
export const CUERPO_POR_DEFECTO = "Hola {{1}}, soy el asistente de {{2}}. Acabamos de recibir tu solicitud. Para preparar bien la visita, ¿me cuentas en una frase qué te gustaría reformar?";
export const CUERPO_GENERAL = "Hola {{1}}, soy el asistente virtual de {{2}}. Acabamos de recibir tu solicitud. ¿Me cuentas en una frase qué necesitas?";
export const PLANTILLA_GENERAL: Plantilla = { nombre: "solicitud_general", idioma: "es_ES", texto: CUERPO_GENERAL };
export const CUERPOS_CONOCIDOS: Record<string, string> = { solicitud_recibida: CUERPO_POR_DEFECTO, solicitud_general: CUERPO_GENERAL };
export const FRASES_POR_DEFECTO: FrasesFijas = {
  pase: "Entendido, te paso con un compañero del equipo, que te escribe en cuanto pueda.",
  fallo: "Perdona, se me ha cortado. ¿Me lo repites?",
  noTexto: "¿Me lo puedes escribir? Así no se me escapa nada",
  audio: "Perdona, no se me ha oído bien el audio. ¿Me lo mandas otra vez o me lo escribes?",
  baja: "Entendido: no te escribiremos más por aquí. Si algún día lo necesitas, escríbenos y te atendemos.",
  presentacion: "Soy el asistente virtual de {negocio}.",
  borrarDatos: "Se lo paso a {negocio} para que borre tus datos.",
};
export const FRASES_USTED: FrasesFijas = {
  pase: "Entendido, le paso con un compañero del equipo, que le escribe en cuanto pueda.",
  fallo: "Disculpe, se me ha cortado. ¿Me lo repite?",
  noTexto: "¿Me lo puede escribir? Así no se me escapa nada",
  audio: "Disculpe, no se ha oído bien el audio. ¿Me lo manda otra vez o me lo escribe?",
  baja: "Entendido: no le escribiremos más por aquí. Si algún día lo necesita, escríbanos y le atendemos.",
  presentacion: "Soy el asistente virtual de {negocio}.",
  borrarDatos: "Se lo paso a {negocio} para que borre sus datos.",
};
export const SISTEMA_POR_DEFECTO: ConfiguracionSistema = {
  asistente: { activo: true, pausadoEn: null, modelo: null },
  avisos: { comercial: { telefono: null, detalle: "completo" } },
  primerCliente: { contestado: false },
};
export const LIMITES = {
  nombreNegocio: 60, lema: 60, sustantivo: 30, etiquetaZona: 30, campos: 12, claveCampo: 40, etiquetaCampo: 40, unidad: 8, resumenes: 3,
  reglasPase: 5, frasesPorRegla: 20, fraseReglaMin: 3, fraseReglaMax: 40, motivoRegla: 60, respuestaRegla: 200,
  excepciones: 20, excepcionMin: 3, excepcionMax: 60, fraseFija: 200, dominios: 30,
  antetitulo: 24, titular: 40, subtitulo: 90, descripcion: 160, textoEstudio: 400, servicios: 6, pasosMin: 3, pasosMax: 6, tarjetas: 9,
  ejemploMin: 2, ejemploMax: 8, lineaEjemplo: 200, urlPrivacidad: 200, consentimiento: 200, mensajeWeb: 300,
  plantillaTexto: 1024, guardadaBytes: 512 * 1024, copia: 12_000, promptMin: 50, promptMax: 12_000, promptAviso: 8_000, informacion: 4_000,
  quiere: 200, notaCierre: 500, cuerpoConfigBytes: 200 * 1024, cuerpoLogoBytes: 450 * 1024, logoBytes: 300 * 1024, logoLado: 512,
} as const;

/** Las descripciones de siempre de `guardar_dato` (lib/agente.ts). */
export const PISTA_DATOS_REFORMAS = {
  descripcion: "Guarda un dato útil del cliente: tipo de reforma, metros, plazo, presupuesto, zona, piso de interés, financiación…",
  campo: "Nombre corto del dato, en minúsculas: tipo, metros, plazo…",
};

// ---- Ayudas internas ----

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const CLAVES_PROHIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

/** Copia profunda de datos JSON: objetos planos y arrays. */
function copiar<T>(v: T): T {
  if (Array.isArray(v)) return v.map(copiar) as T;
  if (esObjetoPlano(v)) {
    const salida: Record<string, unknown> = {};
    for (const [k, valor] of Object.entries(v)) if (!CLAVES_PROHIBIDAS.has(k)) salida[k] = copiar(valor);
    return salida as T;
  }
  return v;
}

function fusionar(base: unknown, cambios: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = esObjetoPlano(base) ? copiar(base) : {};
  for (const [clave, valor] of Object.entries(cambios)) {
    if (CLAVES_PROHIBIDAS.has(clave) || valor === undefined) continue;
    if (valor === null) delete salida[clave];
    else if (esObjetoPlano(valor)) salida[clave] = fusionar(salida[clave], valor);
    else salida[clave] = copiar(valor);
  }
  return salida;
}

// ---- [W0] Funciones puras ----

/** El texto de la plantilla con el nombre y el negocio. Con el cuerpo por defecto, el de siempre. */
export function textoPlantilla(nombre: string, negocio: string, cuerpo: string = CUERPO_POR_DEFECTO): string {
  return cuerpo.replace(/\{\{(\d+)\}\}/g, (marca: string, n: string) => (n === "1" ? nombre : n === "2" ? negocio : marca));
}

/** Un parámetro de plantilla para Meta: una línea, sin tabuladores ni 4 espacios seguidos, recortado. */
export function parametroSeguro(texto: string, max = 60): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return Array.from(limpio).slice(0, max).join("").trim();
}

/** Un nombre que va dentro del prompt: no puede colar instrucciones. */
export function nombreParaPrompt(nombre: string): string {
  return nombre.replace(/[\r\n#*`<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Las instrucciones con {{negocio}} sustituido por el nombre del negocio. */
export function componerInstrucciones(texto: string, c: { negocio: { nombre: string } }): string {
  return texto.split("{{negocio}}").join(nombreParaPrompt(c.negocio.nombre));
}

/** El mensaje que se escribe solo al pulsar el botón de WhatsApp de la web, con el nombre del negocio. */
export function mensajeWeb(c: { web: Web; negocio: { nombre: string } }): string {
  return c.web.mensaje.split("{negocio}").join(c.negocio.nombre.trim());
}

/** El enlace que abre WhatsApp con el mensaje escrito: https://wa.me/<cifras>?text=<mensaje>. Sin cifras, null. */
export function enlaceWhatsApp(numero: string | null | undefined, mensaje: string): string | null {
  const cifras = String(numero ?? "").replace(/\D/g, "");
  if (cifras.length < 6 || cifras.length > 15) return null;
  return `https://wa.me/${cifras}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * La firma que mira la portada cada 3 s: la de la configuración y, con el botón de WhatsApp y un número
 * conectado, también las cifras del número. Sin número es la misma firma: así la portada se vuelve a
 * pintar cuando se conecta (o cambia) el número sin que /api/estado?solo=firma dé nada más que la firma.
 */
export function firmaDePortada(c: { firma: string; web: Web }, cifras: string | null): string {
  return c.web.entrada === "whatsapp" && cifras ? firmaDe([c.firma, cifras]) : c.firma;
}

/** Los textos de la portada que dependen de cómo te escriben desde la web: el formulario o el botón de WhatsApp. */
export function textosDeEntrada(c: { portada: Portada; web: Web }): { descripcion: string; subtitulo: string; boton: string; pasos: Portada["proceso"]["pasos"] } {
  const { portada } = c;
  if (c.web.entrada === "whatsapp") return { ...portada.whatsapp };
  return { descripcion: portada.descripcion, subtitulo: portada.hero.subtitulo, boton: portada.proceso.boton, pasos: portada.proceso.pasos };
}

/** Aplica un PATCH: los objetos se fusionan, los arrays se sustituyen y null borra. No toca las entradas. */
export function aplicarCambios(actual: ConfiguracionPerfil, cambios: CambiosPerfil): ConfiguracionPerfil {
  const limpios: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries((esObjetoPlano(cambios) ? cambios : {}) as Record<string, unknown>)) {
    if (clave === "sector" || clave === "base") continue;
    if (clave === "negocio" && esObjetoPlano(valor)) {
      const { logoVersion: _ignorado, ...resto } = valor;
      limpios.negocio = resto;
    } else {
      limpios[clave] = valor;
    }
  }
  return fusionar(actual, limpios) as ConfiguracionPerfil;
}

/** Una copia sin `negocio.logoVersion`. */
export function sinLogoVersion<T extends { negocio?: { logoVersion?: string } }>(c: T): T {
  if (!c.negocio || !("logoVersion" in c.negocio)) return { ...c };
  const { logoVersion: _ignorado, ...negocio } = c.negocio;
  return { ...c, negocio };
}

function luminancia(color: string): number | null {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

/** El color del texto sobre un fondo: casi negro si contrasta al menos tanto como el blanco. */
export function colorTexto(fondo: string): "#111111" | "#ffffff" {
  const l = luminancia(fondo);
  if (l === null) return "#111111";
  const oscuro = luminancia("#111111") as number;
  const contrasteOscuro = (l + 0.05) / (oscuro + 0.05);
  const contrasteBlanco = 1.05 / (l + 0.05);
  return contrasteOscuro >= contrasteBlanco ? "#111111" : "#ffffff";
}

function estable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estable);
  if (typeof v === "object" && v !== null) {
    const salida: Record<string, unknown> = {};
    for (const clave of Object.keys(v).sort()) {
      const valor = (v as Record<string, unknown>)[clave];
      if (valor !== undefined) salida[clave] = estable(valor);
    }
    return salida;
  }
  return v;
}

/** JSON estable → UTF-8 → FNV-1a de 32 bits, en 8 cifras hexadecimales. Igual en Node y en el navegador. */
export function firmaDe(valor: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(estable(valor)) ?? "");
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function configAgenteDe(c: ConfiguracionResuelta): ConfigAgente {
  return {
    negocio: c.negocio.nombre,
    calendario: c.calendario,
    vocabulario: c.vocabulario,
    campos: c.campos,
    pistaDatos: c.pistaDatos,
    agente: c.agente,
    moneda: c.regional.moneda,
  };
}

/** Lo que puede viajar al navegador: sin portada, spam, reglas del asistente ni cuerpo de la plantilla. */
export function publica(c: ConfiguracionResuelta): ConfiguracionPublica {
  const { portada: _portada, spam: _spam, agente: _agente, pistaDatos: _pista, plantilla, ...resto } = c;
  return { ...resto, plantilla: { nombre: plantilla.nombre, idioma: plantilla.idioma } };
}

/** Lo guardado del sistema sobre los valores por defecto; lo que no tiene el tipo correcto se ignora. Nunca lanza. */
export function resolverSistema(guardado: unknown, sector: SectorId): ConfiguracionSistema {
  const s = copiar(SISTEMA_POR_DEFECTO);
  if (sector === "clinica") s.avisos.comercial.detalle = "minimo";
  try {
    const g = esObjetoPlano(guardado) ? guardado : {};
    const asistente = esObjetoPlano(g.asistente) ? g.asistente : {};
    if (typeof asistente.activo === "boolean") s.asistente.activo = asistente.activo;
    if (asistente.pausadoEn === null || (typeof asistente.pausadoEn === "number" && Number.isFinite(asistente.pausadoEn))) {
      s.asistente.pausadoEn = asistente.pausadoEn as number | null;
    }
    if (asistente.modelo === null || (MODELOS as readonly unknown[]).includes(asistente.modelo)) s.asistente.modelo = asistente.modelo as IdModelo | null;
    const avisos = esObjetoPlano(g.avisos) ? g.avisos : {};
    const comercial = esObjetoPlano(avisos.comercial) ? avisos.comercial : {};
    if (comercial.telefono === null || typeof comercial.telefono === "string") s.avisos.comercial.telefono = comercial.telefono as string | null;
    if (comercial.detalle === "completo" || comercial.detalle === "minimo") s.avisos.comercial.detalle = comercial.detalle;
    const primerCliente = esObjetoPlano(g.primerCliente) ? g.primerCliente : {};
    if (typeof primerCliente.contestado === "boolean") s.primerCliente.contestado = primerCliente.contestado;
  } catch {
    // Un valor raro no rompe la lectura: se queda lo que haya podido copiarse.
  }
  return s;
}

export function modeloEfectivo(s: ConfiguracionSistema, envModelo?: string): string {
  return s.asistente.modelo ?? (envModelo || "claude-haiku-5-5");
}

/** El móvil al que avisar: "" guardado = sin aviso; null = el de .env. */
export function telefonoComercial(s: ConfiguracionSistema, envTelefono?: string, prefijo?: string): string | null {
  const guardado = s.avisos.comercial.telefono;
  if (guardado === "") return null;
  const valor = guardado === null ? envTelefono : guardado;
  return normalizarTelefono(valor ?? "", prefijo);
}

export function opcionesSemilla(c: ConfiguracionResuelta, ocupados?: string[]): OpcionesSemilla {
  const servicios = c.portada.estudio?.servicios.map((s) => s.nombre);
  return {
    sector: c.sector,
    base: c.base,
    negocio: c.negocio.nombre,
    plantilla: c.plantilla.texto,
    reglas: c.calendario,
    vocabulario: c.vocabulario,
    campos: c.campos,
    moneda: c.regional.moneda,
    ...(servicios !== undefined ? { servicios } : {}),
    ...(ocupados !== undefined ? { ocupados } : {}),
  };
}

/** Lo que usa el asistente con el preset de reformas y nada guardado. */
export const CONFIG_AGENTE_POR_DEFECTO: ConfigAgente = {
  negocio: "Estudio de reformas",
  calendario: { ...REGLAS_POR_DEFECTO },
  vocabulario: VOCABULARIO_REFORMAS,
  campos: CAMPOS_REFORMAS,
  pistaDatos: PISTA_DATOS_REFORMAS,
  agente: { catalogo: "auto", negociar: "auto", pasarSiempre: [], excepciones: [], frases: FRASES_POR_DEFECTO, trato: "tu" },
  moneda: "EUR",
};

export const GUARDADA_VACIA: ConfiguracionGuardada = Object.freeze({
  version: 1,
  rev: 0,
  perfiles: Object.freeze({}),
  sistema: Object.freeze({}),
}) as ConfiguracionGuardada;

// ---- [W1] Validación: ayudas internas ----

type Fallo = { error: string; campo: string };
type Revision = { valor: unknown } | Fallo;
type Hoja = (v: unknown, ruta: string) => Revision;
type Esquema = Hoja | { readonly [clave: string]: Esquema };

const SIN_CAMBIOS = "No hay cambios que guardar";
const SI_O_NO = "Tiene que ser sí o no";
const TITULAR = `El titular, de 1 a ${LIMITES.titular} caracteres`;
const FOTO = "Elige una foto de la lista";

const esFallo = (r: Revision): r is Fallo => "error" in r;
const fallo = (error: string, campo: string): Fallo => ({ error, campo });
const unir = (ruta: string, clave: string | number): string => (ruta === "" ? String(clave) : `${ruta}.${clave}`);
const noSePuede = (ruta: string): Fallo => fallo(`No se puede cambiar «${ruta}» desde aquí`, ruta);

const CONTROL_LINEA = /[\u0000-\u001f\u007f\u2028\u2029]/;
const CONTROL_TEXTO = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/** Caracteres de verdad (un emoji cuenta uno). */
function largo(texto: string): number {
  return Array.from(texto).length;
}

function recortar(texto: string, max: number): string {
  return Array.from(texto).slice(0, max).join("");
}

/** Sin espacios al principio ni al final y sin espacios dobles; con `lineas`, los saltos de línea se quedan como \n. */
function limpiarTexto(texto: string, lineas = false): string {
  const t = lineas ? texto.replace(/\r\n?/g, "\n") : texto;
  return t.replace(/ {2,}/g, " ").trim();
}

function sinMarcas(texto: string, marcas: readonly string[]): string {
  return marcas.reduce((t, m) => t.split(m).join(""), texto);
}

interface OpcionesTexto {
  min: number;
  max: number;
  mensaje?: string;
  /** Admite saltos de línea. */
  lineas?: boolean;
  /** Si se da, las únicas llaves permitidas son estas marcas. */
  marcas?: readonly string[];
  mensajeMarcas?: string;
}

function texto(o: OpcionesTexto): Hoja {
  const mensaje = o.mensaje ?? (o.min >= 1 ? `De ${o.min} a ${o.max} caracteres` : `Hasta ${o.max} caracteres`);
  return (v, ruta) => {
    if (typeof v !== "string") return fallo(mensaje, ruta);
    const t = limpiarTexto(v, o.lineas);
    if ((o.lineas ? CONTROL_TEXTO : CONTROL_LINEA).test(t)) return fallo(mensaje, ruta);
    const n = largo(t);
    if (n < o.min || n > o.max) return fallo(mensaje, ruta);
    if (o.marcas && /[{}]/.test(sinMarcas(t, o.marcas))) return fallo(o.mensajeMarcas ?? mensaje, ruta);
    return { valor: t };
  };
}

/** Una hoja con una comprobación más sobre el valor ya normalizado. */
function con(hoja: Hoja, comprobar: (valor: unknown) => string | null): Hoja {
  return (v, ruta) => {
    const r = hoja(v, ruta);
    if (esFallo(r)) return r;
    const error = comprobar(r.valor);
    return error === null ? r : fallo(error, ruta);
  };
}

function opcion(valores: () => readonly unknown[], mensaje: string, preparar: (s: string) => string = (s) => s.trim()): Hoja {
  return (v, ruta) => {
    const x = typeof v === "string" ? preparar(v) : v;
    return valores().includes(x) ? { valor: x } : fallo(mensaje, ruta);
  };
}

const siNo: Hoja = (v, ruta) => (typeof v === "boolean" ? { valor: v } : fallo(SI_O_NO, ruta));

function lista(o: { min?: number; max: number; mensaje: string; item: Hoja }): Hoja {
  return (v, ruta) => {
    if (!Array.isArray(v) || v.length < (o.min ?? 0) || v.length > o.max) return fallo(o.mensaje, ruta);
    const salida: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const r = o.item(v[i], unir(ruta, i));
      if (esFallo(r)) return r;
      salida.push(r.valor);
    }
    return { valor: salida };
  };
}

/**
 * Un objeto que va entero (los elementos de una lista): cada campo del esquema tiene que estar, salvo
 * los de `opcionales`, que toman ese valor si faltan (undefined: no se pone). Una hoja que devuelve
 * undefined deja el campo fuera.
 */
function completo(esquema: Record<string, Hoja>, opcionales: Record<string, unknown> = {}): Hoja {
  return (v, ruta) => {
    const x = esObjetoPlano(v) ? v : {};
    for (const clave of Object.keys(x)) if (!Object.hasOwn(esquema, clave)) return noSePuede(unir(ruta, clave));
    const salida: Record<string, unknown> = {};
    for (const [clave, hoja] of Object.entries(esquema)) {
      if (x[clave] === undefined && Object.hasOwn(opcionales, clave)) {
        if (opcionales[clave] !== undefined) salida[clave] = copiar(opcionales[clave]);
        continue;
      }
      const r = hoja(x[clave], unir(ruta, clave));
      if (esFallo(r)) return r;
      if (r.valor !== undefined) salida[clave] = r.valor;
    }
    return { valor: salida };
  };
}

/** Un PATCH contra un esquema: solo las claves conocidas; null borra lo guardado y siempre vale. */
function revisarEsquema(esquema: Esquema, v: unknown, ruta: string): Revision {
  if (typeof esquema === "function") return esquema(v, ruta);
  if (!esObjetoPlano(v)) return noSePuede(ruta);
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(v)) {
    const r = unir(ruta, clave);
    if (!Object.hasOwn(esquema, clave)) return noSePuede(r);
    if (valor === undefined) continue;
    if (valor === null) {
      salida[clave] = null;
      continue;
    }
    const res = revisarEsquema(esquema[clave], valor, r);
    if (esFallo(res)) return res;
    salida[clave] = res.valor;
  }
  return { valor: salida };
}

// ---- [W1] Las hojas de cada campo ----

const color: Hoja = (v, ruta) => {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^#[0-9a-f]{6}$/.test(t) ? { valor: t } : fallo("El color va como #2f9e6e", ruta);
};

const fotoPortada = opcion(() => FOTOS_PORTADA, FOTO);

const fotoGaleria: Hoja = (v, ruta) =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 6) ? { valor: v } : fallo(FOTO, ruta);

const COMPLETA = "Cada palabra necesita singular, plural y género";
const CLAVES_SUSTANTIVO = new Set(["singular", "plural", "genero", "soloPlural"]);
const palabra = texto({ min: 1, max: LIMITES.sustantivo });

/** Un sustantivo va entero: «cita» con «visitas» no puede salir de un PATCH a medias. */
const sustantivo: Hoja = (v, ruta) => {
  if (!esObjetoPlano(v)) return fallo(COMPLETA, ruta);
  for (const clave of Object.keys(v)) if (!CLAVES_SUSTANTIVO.has(clave)) return noSePuede(unir(ruta, clave));
  for (const clave of ["singular", "plural"]) {
    const x = v[clave];
    if (typeof x !== "string" || limpiarTexto(x) === "") return fallo(COMPLETA, unir(ruta, clave));
  }
  if (v.genero === undefined || v.genero === null) return fallo(COMPLETA, unir(ruta, "genero"));
  if (v.genero !== "m" && v.genero !== "f") return fallo("Elige masculino o femenino", unir(ruta, "genero"));
  if (v.soloPlural !== undefined && typeof v.soloPlural !== "boolean") return fallo(SI_O_NO, unir(ruta, "soloPlural"));
  const salida: Record<string, unknown> = {};
  for (const clave of ["singular", "plural"]) {
    const r = palabra(v[clave], unir(ruta, clave));
    if (esFallo(r)) return r;
    const t = r.valor as string;
    if (t.charAt(0) !== t.charAt(0).toLowerCase()) return fallo("Escríbelo en minúscula: la mayúscula se pone sola", unir(ruta, clave));
    salida[clave] = t;
  }
  salida.genero = v.genero;
  if (v.soloPlural !== undefined) salida.soloPlural = v.soloPlural;
  return { valor: salida };
};

const NOMBRE_DATO = "Cada dato necesita un nombre";
const claveCampo: Hoja = (v, ruta) => {
  if (typeof v !== "string") return fallo(NOMBRE_DATO, ruta);
  const c = normalizarClave(v);
  if (c === "") return fallo(NOMBRE_DATO, ruta);
  if (CONTROL_LINEA.test(c) || largo(c) > LIMITES.claveCampo) return fallo(`De 1 a ${LIMITES.claveCampo} caracteres`, ruta);
  return { valor: c };
};
const etiquetaCampo: Hoja = (v, ruta) =>
  typeof v !== "string" || limpiarTexto(v) === "" ? fallo(NOMBRE_DATO, ruta) : texto({ min: 1, max: LIMITES.etiquetaCampo })(v, ruta);
const unidadCampo: Hoja = (v, ruta) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? { valor: undefined } : texto({ min: 1, max: LIMITES.unidad, mensaje: `Hasta ${LIMITES.unidad} caracteres` })(v, ruta);
const resumenCampo: Hoja = (v, ruta) => (v === undefined ? { valor: undefined } : siNo(v, ruta));

const campos: Hoja = (v, ruta) => {
  const r = lista({
    max: LIMITES.campos,
    mensaje: `Caben ${LIMITES.campos} datos en la ficha`,
    item: completo({ clave: claveCampo, etiqueta: etiquetaCampo, unidad: unidadCampo, resumen: resumenCampo }),
  })(v, ruta);
  if (esFallo(r)) return r;
  const datos = r.valor as CampoLead[];
  const vistas = new Set<string>();
  for (let i = 0; i < datos.length; i++) {
    const clave = datos[i].clave;
    if (vistas.has(clave)) return fallo(`La clave «${clave}» está repetida`, unir(ruta, `${i}.clave`));
    vistas.add(clave);
  }
  if (datos.filter((c) => c.resumen === true).length > LIMITES.resumenes) return fallo(`Como mucho ${LIMITES.resumenes} datos en el resumen`, ruta);
  return r;
};

const TRI_ESTADO = "Elige Automático, Sí o No";
const triEstado = opcion(() => ["auto", "si", "no"], TRI_ESTADO);

const fraseRegla = texto({
  min: LIMITES.fraseReglaMin,
  max: LIMITES.fraseReglaMax,
  mensaje: `Cada frase, de ${LIMITES.fraseReglaMin} a ${LIMITES.fraseReglaMax} caracteres`,
});
/**
 * Las frases se guardan como las escribió el dueño (recortadas), para que el motivo y la pantalla las
 * muestren con sus acentos; se comparan con normalizar(), así que «Me DUELE» y «me duele» son la misma.
 */
const frasesRegla: Hoja = (v, ruta) => {
  const r = lista({ max: LIMITES.frasesPorRegla, mensaje: `Caben ${LIMITES.frasesPorRegla} frases por regla`, item: fraseRegla })(v, ruta);
  if (esFallo(r)) return r;
  const vistas = new Set<string>();
  const frases: string[] = [];
  for (const frase of r.valor as string[]) {
    const clave = normalizar(frase);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    frases.push(frase);
  }
  return { valor: frases };
};
const RESPUESTA = `La respuesta va en una línea de hasta ${LIMITES.respuestaRegla} caracteres, sin llaves`;
const respuestaRegla: Hoja = (v, ruta) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? { valor: undefined }
    : texto({ min: 1, max: LIMITES.respuestaRegla, mensaje: RESPUESTA, marcas: [] })(v, ruta);
const reglaPase = completo(
  {
    motivo: texto({ min: 0, max: LIMITES.motivoRegla, mensaje: `El motivo, hasta ${LIMITES.motivoRegla} caracteres` }),
    frases: frasesRegla,
    respuesta: respuestaRegla,
  },
  { motivo: "", frases: [], respuesta: undefined },
);
const pasarSiempre: Hoja = (v, ruta) => {
  const r = lista({ max: LIMITES.reglasPase, mensaje: `Caben ${LIMITES.reglasPase} reglas`, item: reglaPase })(v, ruta);
  if (esFallo(r)) return r;
  const sinMotivo = (r.valor as ReglaPase[]).flatMap((regla, i) => (regla.motivo === "" ? [i] : []));
  if (sinMotivo.length > 1) return fallo("Solo puede haber una lista sin motivo", unir(ruta, `${sinMotivo[1]}.motivo`));
  return r;
};

const excepciones = lista({
  max: LIMITES.excepciones,
  mensaje: `Caben ${LIMITES.excepciones} frases que no cuentan`,
  item: texto({ min: LIMITES.excepcionMin, max: LIMITES.excepcionMax, mensaje: `Cada frase que no cuenta, de ${LIMITES.excepcionMin} a ${LIMITES.excepcionMax} caracteres` }),
});

const fraseFija = (marcas: readonly string[] = []) =>
  texto({ min: 1, max: LIMITES.fraseFija, mensaje: `Cada frase va en una línea de 1 a ${LIMITES.fraseFija} caracteres`, marcas });
const NOMBRA_NEGOCIO = "La frase tiene que nombrar al negocio: pon {negocio}";

const dominio: Hoja = (v, ruta) => {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) ? { valor: t } : fallo("Ese dominio no es válido", ruta);
};
const GANCHO_FUERA = "Esa palabra no está en la lista de publicidad";
const ganchosQuitados: Hoja = (v, ruta) => {
  const r = lista({ max: Number.MAX_SAFE_INTEGER, mensaje: GANCHO_FUERA, item: opcion(() => GANCHOS, GANCHO_FUERA, normalizar) })(v, ruta);
  return esFallo(r) ? r : { valor: [...new Set(r.valor as string[])] };
};

const urlPrivacidad: Hoja = (v, ruta) => {
  const mensaje = "La política de privacidad tiene que empezar por https://";
  if (typeof v !== "string") return fallo(mensaje, ruta);
  const t = v.trim();
  if (t === "") return { valor: null };
  if (CONTROL_LINEA.test(t) || largo(t) > LIMITES.urlPrivacidad || !/^https:\/\//i.test(t)) return fallo(mensaje, ruta);
  try {
    const url = new URL(t);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "") return fallo(mensaje, ruta);
  } catch {
    return fallo(mensaje, ruta);
  }
  return { valor: t };
};

const MARCAS_EJEMPLO = ["{dia1}", "{hora1}", "{dia2}", "{hora2}", "{opciones}"] as const;
const SOLO_OPCIONES = "Solo vale {opciones}";

const prefijo: Hoja = (v, ruta) => {
  const t = typeof v === "string" ? v.trim() : "";
  return /^[1-9]\d{0,2}$/.test(t) ? { valor: t } : fallo("El prefijo va sin +, de 1 a 3 cifras", ruta);
};

const plantilla: Hoja = (v, ruta) => {
  const r = revisarPlantilla(v);
  return "error" in r ? fallo(r.error, unir(ruta, r.campo)) : { valor: r.plantilla };
};

const pasosProceso = lista({
  min: LIMITES.pasosMin,
  max: LIMITES.pasosMax,
  mensaje: `Entre ${LIMITES.pasosMin} y ${LIMITES.pasosMax} pasos`,
  item: completo({
    titulo: texto({ min: 1, max: 40, marcas: ["{opciones}"], mensajeMarcas: SOLO_OPCIONES }),
    detalle: texto({ min: 1, max: 200, marcas: ["{opciones}"], mensajeMarcas: SOLO_OPCIONES }),
  }),
});

const MENSAJE_WEB = `El mensaje va en una línea de 1 a ${LIMITES.mensajeWeb} caracteres`;

// ---- [W1] El esquema de lo que puede cambiar un perfil ----

const ESQUEMA_PERFIL: Record<string, Esquema> = {
  negocio: {
    nombre: texto({ min: 1, max: LIMITES.nombreNegocio, mensaje: `El nombre va en una sola línea, de 1 a ${LIMITES.nombreNegocio} caracteres`, marcas: [] }),
    lema: texto({ min: 0, max: LIMITES.lema, mensaje: `El lema no puede pasar de ${LIMITES.lema} caracteres` }),
    color,
  },
  plantilla,
  regional: {
    pais: opcion(() => PAISES.map((p) => p.id), "Ese país no está en la lista", (s) => s.trim().toUpperCase()),
    moneda: opcion(() => Object.keys(MONEDAS), "Esa moneda no está en la lista", (s) => s.trim().toUpperCase()),
    prefijo,
  },
  vocabulario: {
    cita: sustantivo,
    cliente: sustantivo,
    importe: sustantivo,
    catalogo: sustantivo,
    zona: texto({ min: 1, max: LIMITES.etiquetaZona, mensaje: `La etiqueta de la zona, de 1 a ${LIMITES.etiquetaZona} caracteres` }),
    equipo: texto({ min: 1, max: 30 }),
    ejemplos: { etiquetas: texto({ min: 1, max: 60 }), dato: texto({ min: 1, max: 30 }) },
  },
  campos,
  agente: {
    catalogo: triEstado,
    negociar: triEstado,
    trato: opcion(() => ["tu", "usted"], "Elige tú o usted"),
    pasarSiempre,
    excepciones,
    frases: {
      pase: fraseFija(),
      fallo: fraseFija(),
      noTexto: fraseFija(),
      audio: fraseFija(),
      baja: fraseFija(),
      presentacion: con(fraseFija(["{negocio}"]), (v) =>
        normalizar(v as string).includes("asistente virtual") ? null : "La presentación tiene que decir que es un asistente virtual",
      ),
      borrarDatos: con(fraseFija(["{negocio}"]), (v) => ((v as string).includes("{negocio}") ? null : NOMBRA_NEGOCIO)),
    },
  },
  spam: {
    dominiosNormales: lista({ max: LIMITES.dominios, mensaje: `Caben ${LIMITES.dominios} dominios`, item: dominio }),
    ganchosQuitados,
  },
  portada: {
    descripcion: texto({ min: 0, max: LIMITES.descripcion }),
    hero: {
      antetitulo: texto({ min: 1, max: LIMITES.antetitulo, mensaje: `El antetítulo, de 1 a ${LIMITES.antetitulo} caracteres` }),
      titular: texto({ min: 1, max: LIMITES.titular, mensaje: TITULAR }),
      subtitulo: texto({ min: 0, max: LIMITES.subtitulo, mensaje: `El subtítulo, hasta ${LIMITES.subtitulo} caracteres` }),
      foto: fotoPortada,
    },
    formulario: {
      chips: lista({ min: 2, max: 2, mensaje: "De 1 a 30 caracteres", item: texto({ min: 1, max: 30 }) }),
      zona: texto({ min: 1, max: LIMITES.etiquetaZona, mensaje: `La etiqueta de la zona, de 1 a ${LIMITES.etiquetaZona} caracteres` }),
      consentimiento: con(texto({ min: 10, max: LIMITES.consentimiento }), (v) =>
        (v as string).includes("{negocio}") ? null : "El texto de la casilla tiene que nombrar al negocio: pon {negocio}",
      ),
      urlPrivacidad,
      marcado: siNo,
      boton: texto({ min: 1, max: 30 }),
      enviado: lista({ min: 2, max: 2, mensaje: "De 1 a 60 caracteres", item: texto({ min: 1, max: 60, marcas: ["{negocio}"] }) }),
    },
    proceso: {
      titular: texto({ min: 1, max: LIMITES.titular, mensaje: TITULAR }),
      foto: fotoPortada,
      pasos: pasosProceso,
      boton: texto({ min: 1, max: 30 }),
      ejemplo: lista({
        min: LIMITES.ejemploMin,
        max: LIMITES.ejemploMax,
        mensaje: `La conversación de ejemplo, de ${LIMITES.ejemploMin} a ${LIMITES.ejemploMax} mensajes`,
        item: completo({
          de: opcion(() => ["cliente", "agente"], "Cada mensaje es del cliente o del asistente"),
          texto: texto({
            min: 1,
            max: LIMITES.lineaEjemplo,
            marcas: MARCAS_EJEMPLO,
            mensajeMarcas: "Solo valen {dia1}, {hora1}, {dia2}, {hora2} y {opciones}",
          }),
        }),
      }),
    },
    whatsapp: {
      descripcion: texto({ min: 0, max: LIMITES.descripcion }),
      subtitulo: texto({ min: 0, max: LIMITES.subtitulo, mensaje: `El subtítulo, hasta ${LIMITES.subtitulo} caracteres` }),
      boton: texto({ min: 1, max: 30 }),
      pasos: pasosProceso,
    },
    galeria: {
      titular: texto({ min: 1, max: LIMITES.titular, mensaje: TITULAR }),
      nota: texto({ min: 0, max: 120 }),
      tarjetas: lista({
        max: LIMITES.tarjetas,
        mensaje: `Caben ${LIMITES.tarjetas} tarjetas`,
        item: completo({
          titulo: texto({ min: 1, max: 40 }),
          detalle: texto({ min: 0, max: 60 }),
          foto: fotoGaleria,
          descripcion: texto({ min: 0, max: 160 }),
        }),
      }),
    },
    estudio: {
      titular: texto({ min: 1, max: LIMITES.titular, mensaje: TITULAR }),
      texto: texto({ min: 0, max: LIMITES.textoEstudio, lineas: true }),
      servicios: lista({
        max: LIMITES.servicios,
        mensaje: `Caben ${LIMITES.servicios} servicios`,
        item: completo({ nombre: texto({ min: 1, max: 40 }), detalle: texto({ min: 0, max: 120 }) }),
      }),
    },
  },
  web: {
    entrada: opcion(() => ENTRADAS_WEB, "Elige el botón de WhatsApp o el formulario"),
    mensaje: texto({ min: 1, max: LIMITES.mensajeWeb, mensaje: MENSAJE_WEB, marcas: ["{negocio}"], mensajeMarcas: "En el mensaje solo vale {negocio}" }),
  },
};

const CLAVES_CALENDARIO = new Set(["zona", "horas", "diasAbiertos", "cerrados", "diasVista", "desdeDias", "antelacionMinutos", "corteTarde"]);
const SECCIONES_PERFIL = new Set(["negocio", "plantilla", "calendario", "regional", "vocabulario", "campos", "agente", "spam", "portada", "web"]);

interface ContextoSeccion {
  /** Sin fecha no se comprueba que queden huecos (lo guardado se revisa sin ella). */
  ahora?: Date;
  calendario: ReglasAgenda;
  regional: Pick<Regional, "pais">;
}

function zonaValida(zona: string): boolean {
  if (!ZONAS_HORARIAS.some((z) => z.id === zona)) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/** El calendario pasa por revisarReglas con lo actual debajo; solo se devuelven los campos que traía el PATCH. */
function revisarCalendario(v: unknown, ctx: ContextoSeccion): Revision {
  if (!esObjetoPlano(v)) return noSePuede("calendario");
  const cambio: Record<string, unknown> = {};
  const nulos: string[] = [];
  for (const [clave, valor] of Object.entries(v)) {
    if (!CLAVES_CALENDARIO.has(clave)) return noSePuede(`calendario.${clave}`);
    if (valor === undefined) continue;
    if (valor === null) nulos.push(clave);
    else cambio[clave] = valor;
  }
  if (typeof cambio.zona === "string") {
    cambio.zona = cambio.zona.trim();
    if (!zonaValida(cambio.zona as string)) return fallo("Elige la zona horaria de la lista", "calendario.zona");
  }
  const actuales = ctx.calendario;
  const r = revisarReglas({ ...actuales, ...cambio }, actuales);
  if ("error" in r) return fallo(r.error, r.campo ? `calendario.${r.campo}` : "calendario");
  const salida: Record<string, unknown> = {};
  for (const clave of Object.keys(cambio)) salida[clave] = copiar((r.reglas as unknown as Record<string, unknown>)[clave]);
  for (const clave of nulos) salida[clave] = null;
  if (ctx.ahora && Object.keys(cambio).length > 0 && verHuecos([], ctx.ahora, r.reglas).length < 1) {
    return fallo(`Con estas reglas no hay ningún hueco libre en los próximos ${r.reglas.diasVista} días`, "calendario");
  }
  return { valor: salida };
}

/** El prefijo tiene que ser el del país (el del PATCH o el actual), salvo «Otro». */
function revisarRegional(v: unknown, ctx: ContextoSeccion): Revision {
  const r = revisarEsquema(ESQUEMA_PERFIL.regional, v, "regional");
  if (esFallo(r)) return r;
  const valor = r.valor as Record<string, unknown>;
  if (typeof valor.prefijo === "string") {
    const paisId = typeof valor.pais === "string" ? valor.pais : ctx.regional.pais;
    const pais = PAISES.find((p) => p.id === paisId);
    if (pais && pais.id !== "OTRO" && pais.prefijo !== valor.prefijo) return fallo(`Ese prefijo no es el de ${pais.nombre}`, "regional.prefijo");
  }
  return r;
}

function revisarSeccion(clave: string, valor: unknown, ctx: ContextoSeccion): Revision {
  if (clave === "calendario") return revisarCalendario(valor, ctx);
  if (clave === "regional") return revisarRegional(valor, ctx);
  if (clave === "negocio" && esObjetoPlano(valor) && Object.hasOwn(valor, "logoVersion")) {
    return fallo("El logo se cambia con su botón", "negocio.logoVersion");
  }
  return revisarEsquema(ESQUEMA_PERFIL[clave], valor, clave);
}

function bytesJson(valor: unknown): number {
  return new TextEncoder().encode(JSON.stringify(valor) ?? "").length;
}

// ---- [W1] Validadores públicos ----

/**
 * Revisa un PATCH de un perfil: solo los campos que se pueden cambiar, con los valores normalizados.
 * `calendario` y `regional` son los valores resueltos de ahora (sin ellos, los de por defecto).
 */
export function revisarCambios(
  e: unknown,
  ctx: { ahora: Date; vocabulario?: Vocabulario; calendario?: ReglasAgenda; regional?: Regional },
): { cambios: CambiosPerfil } | { error: string; campo: string } {
  try {
    if (!esObjetoPlano(e)) return fallo(SIN_CAMBIOS, "");
    if (bytesJson(e) > LIMITES.guardadaBytes) return fallo("La configuración es demasiado grande", "");
    const contexto: ContextoSeccion = {
      ahora: ctx?.ahora instanceof Date && !Number.isNaN(ctx.ahora.getTime()) ? ctx.ahora : new Date(),
      calendario: ctx?.calendario ?? REGLAS_POR_DEFECTO,
      regional: ctx?.regional ?? REGIONAL_POR_DEFECTO,
    };
    const cambios: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(e)) {
      if (!SECCIONES_PERFIL.has(clave)) return noSePuede(clave);
      if (valor === undefined) continue;
      if (valor === null) {
        cambios[clave] = null;
        continue;
      }
      const r = revisarSeccion(clave, valor, contexto);
      if (esFallo(r)) return r;
      cambios[clave] = r.valor;
    }
    return { cambios: cambios as CambiosPerfil };
  } catch {
    return fallo(SIN_CAMBIOS, "");
  }
}

/** El móvil del aviso tal como se guarda: solo cifras, de 6 a 15 (E.164), o "" para «sin aviso». */
const MOVIL_AVISO = /^(\d{6,15})?$/;

/** Revisa un PATCH del bloque global. Los campos en vivo (activo, pausadoEn) se descartan sin decir nada. */
export function revisarSistema(e: unknown, ctx?: { prefijo?: string }): { cambios: CambiosSistema } | { error: string; campo: string } {
  try {
    if (!esObjetoPlano(e)) return fallo(SIN_CAMBIOS, "sistema");
    const cambios: CambiosSistema = {};
    for (const [clave, valor] of Object.entries(e)) {
      const ruta = `sistema.${clave}`;
      if (valor === undefined) continue;
      if (clave === "asistente") {
        if (!esObjetoPlano(valor)) return noSePuede(ruta);
        for (const [sub, x] of Object.entries(valor)) {
          if (sub === "activo" || sub === "pausadoEn" || x === undefined) continue;
          if (sub !== "modelo") return noSePuede(`${ruta}.${sub}`);
          const modelo = typeof x === "string" ? x.trim() : x;
          if (modelo !== null && !(MODELOS as readonly unknown[]).includes(modelo)) {
            return fallo(`Elige ${MODELOS.map((m) => `«${NOMBRES_MODELO[m]}»`).join(" o ")}`, `${ruta}.modelo`);
          }
          cambios.asistente = { modelo: modelo as IdModelo | null };
        }
      } else if (clave === "avisos") {
        if (!esObjetoPlano(valor)) return noSePuede(ruta);
        for (const [sub, x] of Object.entries(valor)) {
          if (x === undefined) continue;
          if (sub !== "comercial") return noSePuede(`${ruta}.${sub}`);
          if (!esObjetoPlano(x)) return noSePuede(`${ruta}.comercial`);
          const comercial: { telefono?: string | null; detalle?: "completo" | "minimo" } = {};
          for (const [campo, y] of Object.entries(x)) {
            const rutaCampo = `${ruta}.comercial.${campo}`;
            if (y === undefined) continue;
            if (campo === "telefono") {
              if (y === null) comercial.telefono = null;
              else {
                const t = typeof y === "string" ? y.trim() : null;
                const numero = t === "" ? "" : t === null ? null : normalizarTelefono(t, ctx?.prefijo);
                // Lo que no se podría leer después (más de 15 cifras, por ejemplo) no se guarda: se quedaría
                // en nada al leerlo y el móvil de antes se perdería sin decir nada.
                if (numero === null || !MOVIL_AVISO.test(numero)) return fallo("Revisa el móvil: con prefijo, como +34 612 345 678", rutaCampo);
                comercial.telefono = numero;
              }
            } else if (campo === "detalle") {
              if (y !== "completo" && y !== "minimo") return fallo("Elige completo o mínimo", rutaCampo);
              comercial.detalle = y;
            } else return noSePuede(rutaCampo);
          }
          if (Object.keys(comercial).length) cambios.avisos = { comercial };
        }
      } else if (clave === "primerCliente") {
        if (!esObjetoPlano(valor)) return noSePuede(ruta);
        for (const [sub, x] of Object.entries(valor)) {
          if (x === undefined) continue;
          if (sub !== "contestado") return noSePuede(`${ruta}.${sub}`);
          if (typeof x !== "boolean") return fallo(SI_O_NO, `${ruta}.contestado`);
          cambios.primerCliente = { contestado: x };
        }
      } else return noSePuede(ruta);
    }
    return { cambios };
  } catch {
    return fallo(SIN_CAMBIOS, "sistema");
  }
}

/** La plantilla de bienvenida va entera: nombre, idioma y el cuerpo aprobado por Meta. */
export function revisarPlantilla(e: unknown): { plantilla: Plantilla } | { error: string; campo: string } {
  const x = esObjetoPlano(e) ? e : {};
  const nombre = typeof x.nombre === "string" ? x.nombre.trim() : "";
  if (!/^[a-z0-9_]{1,512}$/.test(nombre)) return fallo("El nombre de la plantilla solo lleva minúsculas, números y _", "nombre");
  const idioma = typeof x.idioma === "string" ? x.idioma.trim() : "";
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(idioma)) return fallo("El idioma va como es_ES", "idioma");
  const cuerpo = typeof x.texto === "string" ? x.texto.replace(/\r\n?/g, "\n").trim() : "";
  const VARIABLES = "El texto necesita {{1}} (el nombre) y {{2}} (el negocio), una vez cada uno";
  if (largo(cuerpo) > LIMITES.plantillaTexto) return fallo(`De 1 a ${LIMITES.plantillaTexto} caracteres`, "texto");
  const variables = [...cuerpo.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1]);
  if (variables.length !== 2 || !variables.includes("1") || !variables.includes("2")) return fallo(VARIABLES, "texto");
  if (/^\{\{[^{}]*\}\}/.test(cuerpo) || /\{\{[^{}]*\}\}$/.test(cuerpo)) return fallo("Meta no deja empezar ni acabar con una variable", "texto");
  const i1 = cuerpo.indexOf("{{1}}");
  const i2 = cuerpo.indexOf("{{2}}");
  if (cuerpo.slice(Math.min(i1, i2) + 5, Math.max(i1, i2)).trim() === "") return fallo("Pon texto entre {{1}} y {{2}}", "texto");
  return { plantilla: { nombre, idioma, texto: cuerpo } };
}

// ---- [W1] Comprobaciones de las instrucciones ----

const TITULOS_DEL_SISTEMA = ["Contexto de esta conversación", "Cómo funciona este canal", "Seguridad"];
const NO_ES_IA =
  /no (digas|reveles|admitas|menciones) que eres (una? )?(ia|inteligencia artificial|bot|robot|m[aá]quina|asistente virtual)|finge (que eres|ser) (una )?persona/gi;

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** La primera coincidencia de una expresión, sin depender de su lastIndex. */
function coincidencia(re: RegExp, texto: string): string | null {
  return new RegExp(re.source, re.flags.replace(/[gy]/g, "")).exec(texto)?.[0] ?? null;
}

function trozo(texto: string): string {
  return recortar(texto.replace(/\s+/g, " ").trim(), 60).trim();
}

/** Los títulos «#…» del texto: nivel y texto tal cual. */
function titulos(texto: string): { nivel: number; texto: string }[] {
  const salida: { nivel: number; texto: string }[] = [];
  for (const linea of texto.split("\n")) {
    const m = linea.match(/^(#{1,6})(?!#)\s*(.+?)\s*$/);
    if (m) salida.push({ nivel: m[1].length, texto: m[2] });
  }
  return salida;
}

/** Monedas distintas del euro con una cifra al lado: «$100», «100 pesos», «S/ 250». */
function otrasMonedasCitadas(texto: string): Moneda[] {
  const marcas: { marca: string; moneda: Moneda; letras: boolean }[] = [];
  for (const [moneda, datos] of Object.entries(MONEDAS) as [Moneda, (typeof MONEDAS)[Moneda]][]) {
    if (moneda === "EUR") continue;
    for (const s of datos.simbolos) marcas.push({ marca: s, moneda, letras: /\p{L}/u.test(s) });
    for (const p of datos.palabras) marcas.push({ marca: p, moneda, letras: true });
  }
  const encontradas: Moneda[] = [];
  const vistas = new Set<string>(); // «$» o «pesos» cuentan para la primera moneda que los usa
  for (const { marca, moneda, letras } of marcas) {
    if (vistas.has(marca.toLowerCase())) continue;
    vistas.add(marca.toLowerCase());
    if (encontradas.includes(moneda)) continue;
    const m = escaparRegex(marca);
    // Delante de la marca no puede ir otra letra ni otro «$» («US$» no es «$»); detrás de una palabra, nada de letras.
    const antes = String.raw`(?<![\p{L}$])${m}\s?\d`;
    const despues = String.raw`\d\s?${m}${letras ? String.raw`(?![\p{L}])` : ""}`;
    const re = new RegExp(`${antes}|${despues}`, letras && marca === marca.toLowerCase() ? "iu" : "u");
    if (re.test(texto)) encontradas.push(moneda);
  }
  return encontradas;
}

function palabrasLargas(texto: string): Set<string> {
  return new Set(normalizar(texto).split(/[^a-z0-9]+/).filter((p) => p.length >= 5));
}

/** Lo que se ve en Ajustes → Avanzado → «Comprobaciones». Un error impide guardar; los avisos, no. */
export function revisarInstrucciones(
  texto: string,
  ctx: { perfilId: string; vocabulario: Vocabulario; agente: ReglasAgente; moneda: Moneda; negocio: string; plantilla?: Plantilla },
): RevisionPrompt {
  const t = String(texto ?? "").replace(/\r\n/g, "\n");
  const s = seccionesDelPrompt(ctx.vocabulario);
  const fichas = leerFichas(t);
  const hayTabla = fichas.length > 0;
  const catalogo = {
    activo: ctx.agente.catalogo === "si" || (ctx.agente.catalogo === "auto" && hayTabla),
    refs: fichas.length,
    disponibles: fichas.filter((f) => f.disponible).length,
  };
  const negociaEnPersona = normalizar(seccionDe(t, s.persona)).includes("negoci");
  const negociarAPersona = ctx.agente.negociar === "si" || (ctx.agente.negociar === "auto" && negociaEnPersona);
  const base = { avisos: [] as string[], info: [] as string[], catalogo, negociarAPersona };

  if (t.length < LIMITES.promptMin || t.length > LIMITES.promptMax || t.includes("\u0000")) {
    return { error: "Las instrucciones necesitan entre 50 y 12.000 caracteres", ...base };
  }
  if (!/^#\s+(.+)$/m.test(t)) return { error: "Falta la primera línea: # Asistente de WhatsApp · <Nombre>", ...base };
  if (leerTitulo(t).id !== ctx.perfilId) {
    return { error: "No cambies la primera línea: identifica el perfil y separa las conversaciones.", ...base };
  }

  const avisos: string[] = [];
  const avisar = (a: string) => {
    if (!avisos.includes(a)) avisos.push(a);
  };
  const c = controles(ctx.vocabulario);
  const encabezados = titulos(t);

  for (const nombre of [s.preguntas, s.cita, s.persona]) {
    const buscado = normalizar(nombre);
    if (!encabezados.some((h) => h.nivel === 2 && normalizar(h.texto).startsWith(buscado))) {
      avisar(`Falta la sección «${nombre}»: el código la nombra y sin ella el asistente pregunta peor`);
    }
  }

  for (const hora of horasCitadas(sinSeccion(t, s.informacion))) {
    avisar(`Escribes las ${hora} fuera de «${s.informacion}»: el asistente no podrá decirla`);
  }

  if (ctx.moneda !== "EUR") {
    if (importesCitados(t).length > 0) avisar(`Hay importes en euros y el negocio cobra en ${MONEDAS[ctx.moneda]?.nombre ?? ctx.moneda}`);
  } else {
    for (const moneda of otrasMonedasCitadas(t)) avisar(`Hay importes en ${MONEDAS[moneda].nombre} y el negocio cobra en euros`);
  }

  for (const m of t.matchAll(/\{\{[^{}\n]*\}\}/g)) {
    if (m[0] !== "{{negocio}}") avisar(`${m[0]} no se sustituye: solo existe {{negocio}}`);
  }

  for (const h of encabezados) {
    const titulo = normalizar(h.texto).replace(/[:.]+$/, "").trim();
    if (TITULOS_DEL_SISTEMA.some((n) => normalizar(n) === titulo)) avisar(`Ese título lo añade el sistema: quita «${h.texto}»`);
  }

  if (ctx.agente.catalogo === "no" && hayTabla) avisar(`Hay una tabla de ${ctx.vocabulario.catalogo.plural} pero el catálogo está apagado`);
  if (ctx.agente.catalogo === "si" && !hayTabla) avisar("El catálogo está en Sí pero no hay tabla con columnas Ref y Estado");
  if (ctx.agente.negociar === "no" && negociaEnPersona) avisar("Dices que negociar pasa a una persona, pero la regla está en No");

  if (t.length > LIMITES.promptAviso) avisar("Es largo: cada respuesta reenvía todo y irá más lento");

  if (coincidencia(c.AVISA_PERSONA, sinSeccion(sinSeccion(t, s.persona), s.informacion)) !== null) {
    avisar("El asistente no puede prometer que alguien llame o escriba sin pasar a una persona: el código lo bloquea");
  }

  for (const linea of t.split("\n")) {
    const m = coincidencia(c.PROMETE_RECORDATORIO, linea);
    if (m !== null) avisar(`Prometes un aviso que nadie envía («${trozo(m)}»): el código descartará esa respuesta`);
  }

  for (const m of t.matchAll(NO_ES_IA)) avisar(`El asistente tiene que poder decir que es un asistente virtual: quita «${trozo(m[0])}»`);

  for (const gancho of new Set([...ganchosEn(t), ...ganchosEn(ctx.negocio ?? "")])) {
    avisar(`«${gancho}» cuenta como publicidad para el filtro de spam: quítalo de las instrucciones o del nombre del negocio`);
  }

  if (ctx.plantilla) {
    const preguntas = [...ctx.plantilla.texto.matchAll(/¿[^¿?]*\?/g)];
    const pregunta = preguntas.at(-1)?.[0];
    const primera = seccionDe(t, s.preguntas)
      .split("\n")
      .map((l) => l.match(/^\s*(?:1[.)]|[-*•])\s+(.+)$/)?.[1])
      .find((l) => l !== undefined);
    if (pregunta && primera) {
      const enLaPregunta = palabrasLargas(pregunta);
      if (![...palabrasLargas(primera)].some((p) => enLaPregunta.has(p))) {
        avisar(`El mensaje de bienvenida pregunta «${pregunta}» y tu primera pregunta es otra: que vayan de la mano`);
      }
    }
  }

  const info: string[] = [];
  info.push(
    catalogo.activo
      ? `Catálogo activo · ${catalogo.refs} ${catalogo.refs === 1 ? "referencia" : "referencias"}, ${catalogo.disponibles} ${catalogo.disponibles === 1 ? "disponible" : "disponibles"}`
      : "Sin catálogo",
  );
  info.push(`Negociar el precio pasa a una persona: ${negociarAPersona ? "sí" : "no"}`);
  if (t.includes("{{negocio}}")) info.push(`{{negocio}} → ${nombreParaPrompt(ctx.negocio ?? "")}`);
  info.push(`Unos ${Math.round(t.length / 3.5)} tokens por mensaje`);

  return { avisos, info, catalogo, negociarAPersona };
}

// ---- [W1] Lo guardado ----

type Arbol = ((v: unknown) => boolean) | { readonly [clave: string]: Arbol };

const ARBOL_SISTEMA: Arbol = {
  asistente: {
    activo: (v) => typeof v === "boolean",
    pausadoEn: (v) => v === null || (typeof v === "number" && Number.isFinite(v)),
    modelo: (v) => v === null || (MODELOS as readonly unknown[]).includes(v),
  },
  avisos: {
    comercial: {
      telefono: (v) => v === null || (typeof v === "string" && MOVIL_AVISO.test(v)),
      detalle: (v) => v === "completo" || v === "minimo",
    },
  },
  primerCliente: { contestado: (v) => typeof v === "boolean" },
};

/** Se queda con cada campo válido; lo demás se descarta campo a campo y se avisa. */
function filtrarArbol(arbol: Arbol, v: unknown, ruta: string, avisar: (ruta: string) => void): unknown {
  if (typeof arbol === "function") {
    if (arbol(v)) return v;
    avisar(ruta);
    return undefined;
  }
  if (!esObjetoPlano(v)) {
    avisar(ruta);
    return undefined;
  }
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(v)) {
    const r = unir(ruta, clave);
    if (!Object.hasOwn(arbol, clave)) {
      avisar(r);
      continue;
    }
    const filtrado = filtrarArbol(arbol[clave], valor, r, avisar);
    if (filtrado !== undefined) salida[clave] = filtrado;
  }
  return Object.keys(salida).length ? salida : undefined;
}

const SECTORES_PRESET: readonly unknown[] = ["reformas", "inmobiliaria", "clinica", "generico"];

function normalizarPerfil(p: Record<string, unknown>, ruta: string, avisar: (ruta: string) => void): ConfiguracionPerfil {
  const ctx: ContextoSeccion = { calendario: REGLAS_POR_DEFECTO, regional: REGIONAL_POR_DEFECTO };
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(p)) {
    const r = unir(ruta, clave);
    if (valor === undefined || valor === null) continue;
    if (clave === "sector") {
      if (valor === "personalizado") salida.sector = valor;
      else avisar(r);
    } else if (clave === "base") {
      if (SECTORES_PRESET.includes(valor)) salida.base = valor;
      else avisar(r);
    } else if (!SECCIONES_PERFIL.has(clave)) {
      avisar(r);
    } else if (clave === "negocio" && esObjetoPlano(valor)) {
      const { logoVersion, ...resto } = valor;
      const negocio: Record<string, unknown> = {};
      if (Object.keys(resto).length > 0) {
        const res = revisarSeccion("negocio", resto, ctx);
        if (esFallo(res)) avisar(r);
        else Object.assign(negocio, res.valor);
      }
      if (logoVersion !== undefined) {
        if (typeof logoVersion === "string" && /^[0-9a-f]{12}$/.test(logoVersion)) negocio.logoVersion = logoVersion;
        else avisar(`${r}.logoVersion`);
      }
      if (Object.keys(negocio).length > 0) salida.negocio = negocio;
    } else {
      const res = revisarSeccion(clave, valor, ctx);
      if (esFallo(res)) avisar(r);
      else salida[clave] = res.valor;
    }
  }
  return salida as ConfiguracionPerfil;
}

/** Lo guardado, sección a sección: lo que no valida se descarta y se avisa con su ruta. Nunca lanza. */
export function normalizarGuardada(raw: unknown, alDescartar?: (ruta: string) => void): ConfiguracionGuardada {
  const avisar = (ruta: string) => {
    try {
      alDescartar?.(ruta);
    } catch {
      // Quien escucha no puede romper la lectura.
    }
  };
  try {
    if (!esObjetoPlano(raw)) return copiar(GUARDADA_VACIA);
    const rev = typeof raw.rev === "number" && Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;
    const perfiles: Record<string, ConfiguracionPerfil> = {};
    if (raw.perfiles !== undefined && !esObjetoPlano(raw.perfiles)) avisar("perfiles");
    for (const [id, valor] of Object.entries(esObjetoPlano(raw.perfiles) ? raw.perfiles : {})) {
      if (!/^[a-z0-9-]{1,80}$/.test(id) || !esObjetoPlano(valor)) {
        avisar(`perfiles.${id}`);
        continue;
      }
      perfiles[id] = normalizarPerfil(valor, `perfiles.${id}`, avisar);
    }
    const sistema = raw.sistema === undefined ? {} : ((filtrarArbol(ARBOL_SISTEMA, raw.sistema, "sistema", avisar) ?? {}) as ParcialProfundo<ConfiguracionSistema>);
    return { version: 1, rev, perfiles, sistema };
  } catch {
    return copiar(GUARDADA_VACIA);
  }
}

// ---- [W1] Perfiles nuevos y pista de datos ----

/** Los mismos que PERFILES_RESERVADOS de lib/presets (no se importa: los presets importan este módulo). */
const RESERVADOS: ReadonlySet<string> = new Set([PERFIL_EJEMPLO, "estudio-de-reformas", "inmobiliaria", "clinica"]);
const TITULO_PERFIL = "# Asistente de WhatsApp · ";

/** El id y la primera línea de un negocio nuevo, sin pisar uno reservado ni uno ocupado. Vuelve igual por leerTitulo. */
export function slugPerfil(nombre: string, ocupados: Set<string>): { id: string; titulo: string } {
  const idDe = (n: string) => leerTitulo(TITULO_PERFIL + n).id;
  const limpio = recortar(
    String(nombre ?? "")
      .replace(/·/g, " ")
      .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    60,
  ).trim();
  const base = limpio === "" || idDe(limpio) === "" ? "Negocio" : limpio;
  const libre = (id: string) => id !== "" && !RESERVADOS.has(id) && !ocupados?.has(id);
  let final = base;
  for (let n = 2; !libre(idDe(final)) && n < 100_000; n++) {
    const sufijo = ` (${n})`;
    final = recortar(base, 60 - sufijo.length).trim() + sufijo;
  }
  return { id: idDe(final), titulo: TITULO_PERFIL + final };
}

/** Las descripciones de `guardar_dato` a partir de los campos del negocio. */
export function generarPistaDatos(campos: CampoLead[], v: Vocabulario): { descripcion: string; campo: string } {
  const de = v.cliente.genero === "f" ? "de la" : "del";
  if (campos.length === 0) {
    return { descripcion: `Guarda un dato útil ${de} ${v.cliente.singular}.`, campo: "Nombre corto del dato, en minúsculas." };
  }
  return {
    descripcion: `Guarda un dato útil ${de} ${v.cliente.singular}: ${campos.map((c) => c.etiqueta.toLowerCase()).join(", ")}…`,
    campo: `Nombre corto del dato, en minúsculas: ${campos.map((c) => c.clave).join(", ")}…`,
  };
}
