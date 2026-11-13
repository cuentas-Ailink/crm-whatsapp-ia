// Los clientes de ejemplo: un mes de uso creíble de un negocio, con solo lo que este producto puede
// producir de verdad (mensajes de la plantilla, del asistente y del dueño; reservas; notas, tareas,
// etiquetas e importes de la ficha; pases, devoluciones y cierres). El motor es genérico: cada sector
// trae sus guiones (lib/semillas/<sector>.ts) y aquí se les pone fecha, hora, teléfono, historial y
// visita, siempre con las mismas reglas.
//
// Determinista por día: con la misma fecha salen los mismos leads, estados, cierres, importes y
// visitas a cualquier hora; solo se mueven las horas de lo que aún no ha pasado. Nada de lo que hace el
// dueño es de hoy (no se genera), y lo del cliente que caería después de `ahora` pasa a la noche
// anterior. Ni azar del sistema ni reloj: todo sale de `ahora` y del generador con semilla.
//
// Ciclo de importación: este archivo importa `generadorDe` (./semillas/index), que importa los
// generadores, que importan este motor. Por eso nada de lo de otro módulo del ciclo se usa al cargar:
// solo dentro de las funciones.

import { REGLAS_POR_DEFECTO, sumarDias, textoHueco } from "./agenda";
import { CUERPO_GENERAL, CUERPOS_CONOCIDOS, FRASES_POR_DEFECTO, PERFIL_EJEMPLO, textoPlantilla } from "./configuracion";
import { necesitaPresentacion } from "./guion";
import { recortar } from "./log";
import { crearLead, idDeLead } from "./negocio";
import { formatoImporte, MONEDAS, type Moneda } from "./regional";
import { generadorDe } from "./semillas/index";
import type { AccionSemilla, AnclaSemilla, ConversacionSemilla, DatosSemilla, MensajeGuion, OpcionesSemilla, SemillaGenerada } from "./semillas/tipos";
import type { Actividad, EstadoLead, FuenteLead, Hueco, Lead, Mensaje, Nota, ReglasAgenda, Reserva, Tarea } from "./tipos";
import { CAMPOS_REFORMAS, nombreDePila, VOCABULARIO_REFORMAS } from "./vocabulario";

/** Una instalación nueva: reformas, en euros, con la plantilla `solicitud_general` y la agenda por defecto. */
export const OPCIONES_POR_DEFECTO: OpcionesSemilla = {
  sector: "reformas",
  base: "reformas",
  negocio: "Estudio de reformas",
  plantilla: CUERPO_GENERAL,
  reglas: REGLAS_POR_DEFECTO,
  vocabulario: VOCABULARIO_REFORMAS,
  campos: CAMPOS_REFORMAS,
  moneda: "EUR",
};

/** Los ejemplos del sector de `opciones.base` (reformas si no se dice), con el nombre del negocio. */
export function crearSemilla(negocio: string, ahora: Date, opciones?: Partial<OpcionesSemilla>): SemillaGenerada {
  const o: OpcionesSemilla = { ...OPCIONES_POR_DEFECTO };
  for (const [clave, valor] of Object.entries(opciones ?? {})) {
    if (valor !== undefined) (o as unknown as Record<string, unknown>)[clave] = valor;
  }
  o.negocio = negocio;
  return generadorDe(o.base)(o, ahora);
}

// ---- Azar y tiempo ----

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
/** Los ratos en los que el dueño toca el panel: de lunes a viernes (los días abiertos), mañana y tarde. */
const VENTANAS: [string, string][] = [["09:00", "14:00"], ["15:30", "19:30"]];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const LLEVAS_TU = "Lo llevas tú desde el panel";
const MAXIMO_ETIQUETAS = 6;

/** Números pseudoaleatorios entre 0 y 1 a partir de una semilla fija (mulberry32). */
export function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formateadores.set(zona, f);
  }
  return f;
}

/** Fecha y hora de pared de un instante en la zona: { fecha: "2026-11-11", hora: "10:00" }. */
function pared(ts: number, zona: string): { fecha: string; hora: string } {
  const partes = formateador(zona).formatToParts(new Date(ts));
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";
  return { fecha: `${valor("year")}-${valor("month")}-${valor("day")}`, hora: `${valor("hour")}:${valor("minute")}` };
}

/** Los milisegundos de una hora de pared (`fecha` «AAAA-MM-DD», `hora` «HH:MM») en la zona `zona`. */
export function momentoEn(fecha: string, hora: string, zona: string): number {
  const m = `${fecha}T${hora}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return Number.NaN;
  const comoUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const desfase = (t: number): number => {
    const partes = formateador(zona).formatToParts(new Date(t));
    const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
    return Date.UTC(valor("year"), valor("month") - 1, valor("day"), valor("hour"), valor("minute"), valor("second")) - Math.floor(t / 1000) * 1000;
  };
  const primero = desfase(comoUtc);
  let instante = comoUtc - primero;
  const segundo = desfase(instante);
  if (segundo !== primero) instante = comoUtc - segundo;
  return instante;
}

function diaSemana(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

/** «HH:MM» más `minutos`, sin pasar de las 23:59. */
function sumarMinutos(hora: string, minutos: number): string {
  const [h, m] = hora.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + Math.round(minutos)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Reglas de agenda que se pueden usar siempre: lo que falta o no vale se queda con el valor por defecto. */
function reglasSeguras(r: ReglasAgenda | undefined): ReglasAgenda {
  const base = REGLAS_POR_DEFECTO;
  const horas = [...new Set((r?.horas ?? []).filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)))].sort();
  const dias = [...new Set((r?.diasAbiertos ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  let zona = typeof r?.zona === "string" && r.zona ? r.zona : base.zona;
  try {
    formateador(zona);
  } catch {
    zona = base.zona;
  }
  return {
    zona,
    horas: horas.length ? horas : [...base.horas],
    diasAbiertos: dias.length ? dias : [...base.diasAbiertos],
    cerrados: Array.isArray(r?.cerrados) ? [...r.cerrados] : [],
    diasVista: Math.min(365, Math.max(1, Math.floor(r?.diasVista ?? base.diasVista))),
    desdeDias: Math.min(30, Math.max(0, Math.floor(r?.desdeDias ?? base.desdeDias))),
    antelacionMinutos: Math.min(10_080, Math.max(0, Math.floor(r?.antelacionMinutos ?? 0))),
    corteTarde: typeof r?.corteTarde === "string" && /^\d{2}:\d{2}$/.test(r.corteTarde) ? r.corteTarde : base.corteTarde,
  };
}

function abiertoEn(fecha: string, r: ReglasAgenda): boolean {
  return r.diasAbiertos.includes(diaSemana(fecha)) && !r.cerrados.includes(fecha);
}

/** `k` días abiertos desde `fecha`: 0 es la misma fecha, 1 el siguiente abierto, −1 el anterior abierto. */
function moverAbiertos(fecha: string, k: number, r: ReglasAgenda): string {
  if (k === 0) return fecha;
  const paso = k > 0 ? 1 : -1;
  let quedan = Math.abs(k);
  let f = fecha;
  for (let i = 0; i < 5000 && quedan > 0; i++) {
    f = sumarDias(f, paso);
    if (abiertoEn(f, r)) quedan--;
  }
  return f;
}

function franjaDe(hora: string, r: ReglasAgenda): "manana" | "tarde" {
  return hora < r.corteTarde ? "manana" : "tarde";
}

/** «2 nov»: la fecha como la escribe el dueño en una nota. */
function fechaNota(fecha: string): string {
  const [, mes, dia] = fecha.split("-").map(Number);
  return `${dia} ${MESES[mes - 1]}`;
}

/** Un número entre 0 y 1 que solo depende del texto: para lo que no puede gastar azar del generador. */
function hash01(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100_000) / 100_000;
}

/** Interpola en una tabla de cuantiles [p, valor]: con `r` uniforme, sale esa distribución. */
function cuantil(r: number, tabla: [number, number][]): number {
  for (let i = 1; i < tabla.length; i++) {
    const [p0, v0] = tabla[i - 1];
    const [p1, v1] = tabla[i];
    if (r <= p1) return v0 + ((r - p0) / (p1 - p0)) * (v1 - v0);
  }
  return tabla[tabla.length - 1][1];
}

// ---- Huecos ----

/** Lo que necesita saber el motor de la agenda y del momento. */
interface Contexto {
  o: OpcionesSemilla;
  r: ReglasAgenda;
  zona: string;
  ahora: number;
  hoy: string;
  inicioHoy: number;
  moneda: Moneda;
}

/** Los huecos libres a partir de un momento, en orden, hasta encontrar A, A′ y B (o agotar los días a la vista). */
function primerosLibres(ocupados: Set<string>, desde: number, r: ReglasAgenda): { a?: string; aPrima?: string; b?: string } {
  const { fecha, hora } = pared(desde, r.zona);
  const minimo = desde + r.antelacionMinutos * MINUTO;
  let f = sumarDias(fecha, r.desdeDias);
  let vistos = 0;
  let a: string | undefined;
  let aPrima: string | undefined;
  let posterior: string | undefined;
  for (let i = 0; i < 5000 && vistos < r.diasVista; i++, f = sumarDias(f, 1)) {
    if (!abiertoEn(f, r)) continue;
    vistos++;
    for (const h of r.horas) {
      const id = `${f}T${h}`;
      if (ocupados.has(id)) continue;
      if (f === fecha && h <= hora) continue;
      if (momentoEn(f, h, r.zona) < minimo) continue;
      if (!a) {
        a = id;
        continue;
      }
      if (!aPrima) aPrima = id;
      if (f > a.slice(0, 10)) {
        posterior ??= id;
        if (franjaDe(h, r) !== franjaDe(a.slice(11), r)) return { a, aPrima, b: id };
      }
    }
  }
  return { a, aPrima, b: posterior };
}

/**
 * Los huecos que el asistente ofrecería primero si ahora le escribiera alguien: A (el primero libre),
 * B (el primero de un día posterior en la otra franja) y A′ (el que pasa a ser el primero en cuanto
 * reservan A). Las visitas de ejemplo futuras nunca los ocupan, para que una prueba en directo los tenga.
 */
export function huecosProtegidos(reservas: Reserva[], ahora: Date, reglas: ReglasAgenda): Set<string> {
  const r = reglasSeguras(reglas);
  const { a, aPrima, b } = primerosLibres(new Set(reservas.map((x) => x.huecoId)), ahora.getTime(), r);
  return new Set([a, aPrima, b].filter((x): x is string => !!x));
}

function comoReservas(ids: Iterable<string>): Reserva[] {
  return [...ids].map((huecoId) => ({ huecoId, texto: "", leadId: "", nombre: "", perfilNombre: "" }));
}

// ---- Los pasos de cada lead ----

type Canal = "formulario" | "whatsapp" | "manual";
type Servicio = DatosSemilla["servicios"][number];

const SERVICIOS_DE_RESERVA: Servicio[] = [{ tipo: "Servicio", etiqueta: "servicio", rango: [600, 3000], datos: {} }];

/** Un paso del guion de un lead: un mensaje, algo que hace el dueño o el repaso (etiquetas y estimación). */
type Paso = { clase: "mensaje"; m: MensajeGuion; n: number } | { clase: "accion"; a: AccionSemilla } | { clase: "repaso" };

interface Uso {
  i: number;
  conv: ConversacionSemilla;
  repetida: boolean;
  canal: Canal;
  spam: boolean;
  telefono: string;
  id: string;
  clave: string;
  nombre: string;
  zona?: string;
  fuente?: FuenteLead;
  msPrimerWhatsApp?: number;
  rPrimer: [number, number];
  creadoEn: number;
  servicio: Servicio;
  metros?: number;
  visitaPlan?: { od: number; hora: number; desde: "hoy" | "creacion" };
  futura: boolean;
  slot?: string;
  mensajes: MensajeGuion[];
  /** Tareas y notas genéricas de `datos.tareas` y `datos.notas` que le tocan a este lead. */
  extra: AccionSemilla[];
  pasos: Paso[];
  /** Los pasos que pasan de verdad, con su instante (el de los mensajes, antes de mover lo de después de `ahora`). */
  hechos: { p: Paso; ts: number }[];
  /** El instante final de cada mensaje que pasa, por su índice en `mensajes`. */
  finales: Map<number, number>;
  /** Índice del mensaje que confirma la visita, si llega a pasar. */
  confirma?: number;
  /** Índice del último mensaje con los dos huecos de la reserva. */
  oferta?: number;
  /** Índice del mensaje del asistente con el que pasa a una persona. */
  pase?: number;
}

function anclaEn(a: AnclaSemilla, u: Uso, ctx: Contexto): number {
  if ("dia" in a) return momentoEn(sumarDias(ctx.hoy, a.dia), a.hora, ctx.zona);
  const desde = a.desde ?? "hoy";
  let base: string;
  if (desde === "hoy") base = ctx.hoy;
  else if (desde === "creacion") base = pared(u.creadoEn, ctx.zona).fecha;
  else {
    if (!u.slot || u.futura) return Number.POSITIVE_INFINITY;
    base = u.slot.slice(0, 10);
  }
  return momentoEn(moverAbiertos(base, a.od, ctx.r), a.hora, ctx.zona);
}

/** El primer instante desde `ts` en un rato de oficina de un día abierto. */
function primeraVentana(ts: number, ctx: Contexto): number {
  let { fecha } = pared(ts, ctx.zona);
  for (let i = 0; i < 800; i++, fecha = sumarDias(fecha, 1)) {
    if (!abiertoEn(fecha, ctx.r)) continue;
    for (const [inicio, fin] of VENTANAS) {
      if (ts < momentoEn(fecha, fin, ctx.zona)) return Math.max(ts, momentoEn(fecha, inicio, ctx.zona));
    }
  }
  return ts;
}

/** El último rato de oficina antes de hoy (para un alta a mano que caería hoy). */
function ultimaVentanaAntesDeHoy(ctx: Contexto): number {
  const dia = moverAbiertos(ctx.hoy, -1, ctx.r);
  return momentoEn(dia, "17:00", ctx.zona);
}

function escalar(n: number, ctx: Contexto): number {
  const { factorEjemplo, redondeo } = MONEDAS[ctx.moneda] ?? MONEDAS.EUR;
  if (factorEjemplo === 1) return n;
  return Math.max(redondeo, Math.round((n * factorEjemplo) / redondeo) * redondeo);
}

/** Una estimación antes del presupuesto: a 500 € por debajo de 20.000 y a 1.000 € por encima (luego, la moneda). */
function estimacion(n: number, ctx: Contexto): number {
  const paso = n < 20_000 ? 500 : 1_000;
  return escalar(Math.max(paso, Math.round(n / paso) * paso), ctx);
}

function etiquetasLimpias(etiquetas: string[]): string[] {
  return [...new Set(etiquetas.map((e) => e.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, MAXIMO_ETIQUETAS);
}

// Pesos por hora del día (% del día) de las llegadas reales: los formularios suben por la noche y
// WhatsApp va con el horario de oficina.
const PESOS_HORA: Record<"formulario" | "whatsapp", number[]> = {
  formulario: [3.8, 2.2, 1.1, 0.7, 0.5, 0.7, 1.3, 2.8, 3.9, 4.8, 5.2, 5.3, 5.2, 4.8, 4.4, 4.6, 5.0, 5.2, 5.4, 5.7, 6.1, 7.2, 8.1, 6.1],
  whatsapp: [0.5, 0, 0, 0, 0, 0, 0, 1.5, 4.0, 7.1, 9.1, 9.1, 8.1, 6.1, 4.5, 5.1, 7.1, 7.6, 7.6, 7.1, 6.1, 5.1, 3.0, 1.5],
};

function horaAlAzar(canal: Canal, azar: () => number): string {
  const r1 = azar();
  const r2 = azar();
  if (canal === "manual") return sumarMinutos("10:00", Math.floor(r1 * 3) * 60 + r2 * 50);
  const pesos = PESOS_HORA[canal];
  const total = pesos.reduce((s, p) => s + p, 0);
  let x = r1 * total;
  let h = 0;
  while (h < 23 && x >= pesos[h]) x -= pesos[h++];
  return sumarMinutos(`${String(h).padStart(2, "0")}:00`, r2 * 59);
}

function servicioDe(conv: ConversacionSemilla, servicios: Servicio[], i: number): Servicio {
  const buscado = conv.tipo.toLowerCase();
  return servicios.find((s) => s.etiqueta.toLowerCase() === buscado || s.tipo.toLowerCase() === buscado) ?? servicios[i % servicios.length];
}

/** Metros como los guarda la ficha: «12 m²», y por encima de 20, de 5 en 5. */
function metrosLimpios(n: number): number {
  return n > 20 ? Math.max(25, Math.round(n / 5) * 5) : Math.max(1, Math.round(n));
}

// ---- Reparto: quién es quién ----

const ESTADOS: EstadoLead[] = ["nuevo", "conversacion", "visita", "persona", "spam"];

function repartir(datos: DatosSemilla, ctx: Contexto): Uso[] {
  const azar = generador(datos.semilla);
  const servicios = datos.servicios.length ? datos.servicios : SERVICIOS_DE_RESERVA;
  const usos: Uso[] = [];

  // Cuántos de cada etapa, con las conversaciones de esa etapa en orden (y otra vuelta si faltan).
  const elegidas: { conv: ConversacionSemilla; repetida: boolean }[] = [];
  for (const estado of ESTADOS) {
    const delEstado = datos.conversaciones.filter((c) => c.estado === estado);
    const cuantos = Math.max(0, Math.floor(datos.cuotas?.[estado] ?? 0));
    if (!delEstado.length) continue;
    for (let k = 0; k < cuantos; k++) elegidas.push({ conv: delEstado[k % delEstado.length], repetida: k >= delEstado.length });
  }

  // Teléfonos: 34600 y seis cifras, distintos y nunca seguidos.
  const telefonos = new Set<number>();
  const telefono = (): string => {
    for (;;) {
      const n = Math.floor(azar() * 1_000_000);
      if (telefonos.has(n) || telefonos.has(n - 1) || telefonos.has(n + 1)) continue;
      telefonos.add(n);
      return `34600${String(n).padStart(6, "0")}`;
    }
  };

  // Nombres: los fijos de los guiones, y para el resto, las listas barajadas.
  const fijos = new Set(elegidas.filter((e) => !e.repetida && e.conv.nombre).map((e) => e.conv.nombre as string));
  const baraja = (lista: string[]) => {
    const copia = lista.filter((n) => !fijos.has(n));
    for (let k = copia.length - 1; k > 0; k--) {
      const j = Math.floor(azar() * (k + 1));
      [copia[k], copia[j]] = [copia[j], copia[k]];
    }
    return copia;
  };
  const listas = { formulario: baraja(datos.nombres.formulario), whatsapp: baraja(datos.nombres.whatsapp) };
  const usados = { formulario: 0, whatsapp: 0 };
  const nombreLibre = (de: "formulario" | "whatsapp"): string => {
    const lista = listas[de].length ? listas[de] : listas[de === "formulario" ? "whatsapp" : "formulario"];
    if (!lista.length) return de === "formulario" ? "Cliente de ejemplo" : "Contacto de ejemplo";
    return lista[usados[de]++ % lista.length];
  };

  elegidas.forEach(({ conv, repetida }, i) => {
    const plan = generador((datos.semilla ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const canal: Canal = conv.canal;
    const spam = conv.estado === "spam";
    const tel = telefono();
    const id = idDeLead(tel, PERFIL_EJEMPLO);
    const nombre = !repetida && conv.nombre ? conv.nombre : nombreLibre(canal === "whatsapp" ? "whatsapp" : "formulario");
    const servicio = servicioDe(conv, servicios, i);
    const [mMin, mMax] = servicio.metros ?? [0, 0];
    const rMetros = plan();
    const metros = mMax > 0 ? metrosLimpios(mMin + rMetros * (mMax - mMin)) : undefined;

    // El día y la hora de llegada: los del guion o, si no los trae, unos creíbles para su etapa.
    const rDia = plan();
    const hora = !repetida && conv.hora ? conv.hora : horaAlAzar(spam ? "whatsapp" : canal, plan);
    const conVisita = conv.estado === "visita" || (conv.estado === "persona" && !!conv.elige);
    let fecha: string;
    if (!repetida && conv.od !== undefined) fecha = moverAbiertos(ctx.hoy, conv.od, ctx.r);
    else if (!repetida && conv.dia !== undefined) fecha = sumarDias(ctx.hoy, conv.dia);
    else if (conv.estado === "visita") fecha = sumarDias(ctx.hoy, -(2 + Math.floor(rDia * 4)));
    else if (conVisita) fecha = sumarDias(ctx.hoy, conv.cierre ? -(18 + Math.floor(rDia * 9)) : -(8 + Math.floor(rDia * 4)));
    else fecha = sumarDias(ctx.hoy, -(1 + Math.floor(rDia * 27)));
    let creadoEn: number;
    if (!repetida && conv.minutosAntes !== undefined) {
      const candidato = ctx.ahora - conv.minutosAntes * MINUTO;
      const p = pared(candidato, ctx.zona);
      creadoEn = p.fecha === ctx.hoy && p.hora >= "07:40" ? candidato : momentoEn(sumarDias(ctx.hoy, -1), "23:10", ctx.zona);
    } else {
      creadoEn = momentoEn(fecha, hora, ctx.zona);
      if (creadoEn > ctx.ahora) creadoEn = momentoEn(sumarDias(ctx.hoy, -1), sumarMinutos("23:10", i % 40), ctx.zona);
    }
    if (canal === "manual") {
      creadoEn = primeraVentana(creadoEn, ctx);
      if (creadoEn >= ctx.inicioHoy) creadoEn = ultimaVentanaAntesDeHoy(ctx);
    }

    // La visita: la del guion o, si no la trae, una creíble para su etapa.
    const rVisita = plan();
    let visitaPlan: Uso["visitaPlan"];
    if (conv.visita && !repetida) visitaPlan = { od: conv.visita.od, hora: conv.visita.hora, desde: conv.visita.desde ?? "hoy" };
    else if (conv.estado === "visita") visitaPlan = { od: Math.floor(rVisita * 5), hora: Math.floor(plan() * 48), desde: "hoy" };
    else if (conVisita) visitaPlan = conv.cierre ? { od: 3, hora: Math.floor(plan() * 48), desde: "creacion" } : { od: -(1 + (i % 3)), hora: Math.floor(plan() * 48), desde: "hoy" };
    const futura = !!visitaPlan && visitaPlan.desde === "hoy" && visitaPlan.od >= 0;

    // Para el tiempo hasta el primer WhatsApp (se reparte abajo, por orden entre los del formulario).
    const rPrimer: [number, number] = [plan(), plan()];

    // Los mensajes: el formulario abre con la plantilla; WhatsApp, con el cliente; a mano, ninguno.
    let mensajes = canal === "manual" ? [] : conv.mensajes.filter((m, n) => !(m.plantilla && (canal !== "formulario" || n > 0)));
    if (canal === "formulario" && !mensajes[0]?.plantilla) mensajes = [{ de: "agente", texto: "{plantilla}", plantilla: true }, ...mensajes];

    usos.push({
      i,
      conv,
      repetida,
      canal,
      spam,
      telefono: tel,
      id,
      clave: tel,
      nombre,
      zona: canal === "formulario" && !spam ? (!repetida && conv.zona ? conv.zona : datos.zonas.length ? datos.zonas[Math.floor(plan() * datos.zonas.length)] : undefined) : undefined,
      creadoEn,
      servicio,
      metros,
      visitaPlan,
      futura,
      mensajes,
      extra: [],
      pasos: [],
      hechos: [],
      finales: new Map(),
      rPrimer,
    });
  });

  // Del formulario al primer WhatsApp: casi siempre entre 1,1 y 2,8 s (mediana ≈ 2 s); uno de cada doce, más lento.
  usos
    .filter((u) => u.canal === "formulario")
    .forEach((u, j) => {
      const [r1, r2] = u.rPrimer;
      u.msPrimerWhatsApp = j % 12 === 7 ? 3000 + Math.round(r1 * 2000) : 1300 + Math.round(1500 * ((r1 + r2) / 2));
    });

  // El origen: formulario 60 % anuncio, 25 % buscador, 15 % nada; WhatsApp 45 % anuncio de clic.
  const fuentes = datos.fuentes ?? { campana: "Captación", anuncio: "Escríbenos por WhatsApp" };
  const repartirFuente = (lista: Uso[], cuotas: [number, FuenteLead | undefined][]) => {
    const orden = lista.map((u) => ({ u, r: azar() })).sort((a, b) => a.r - b.r);
    let k = 0;
    for (const [cuota, fuente] of cuotas) {
      const n = Math.round(cuota * lista.length);
      for (let j = 0; j < n && k < orden.length; j++, k++) if (fuente) orden[k].u.fuente = { ...fuente };
    }
  };
  repartirFuente(
    usos.filter((u) => u.canal === "formulario" && !u.spam),
    [
      [0.6, { tipo: "anuncio", plataforma: "Meta", campana: fuentes.campana }],
      [0.25, { tipo: "buscador", plataforma: "Google" }],
    ],
  );
  repartirFuente(
    usos.filter((u) => u.canal === "whatsapp" && !u.spam),
    [[0.45, { tipo: "anuncio", plataforma: "Meta", anuncio: fuentes.anuncio }]],
  );

  // Las tareas y notas genéricas del sector, una por lead, a los que el guion no les dice qué hace el dueño.
  const libres = usos.filter((u) => !u.spam && !u.conv.acciones);
  (datos.tareas ?? []).forEach((t, k) => {
    const u = libres[k % Math.max(1, libres.length)];
    if (!u) return;
    u.extra.push(
      t.hecha
        ? { tipo: "tarea", texto: t.texto, hecha: true }
        : { tipo: "tarea", texto: t.texto, ...(t.dias !== undefined ? { vence: { od: t.dias } } : {}), en: { desde: "hoy", od: -1, hora: sumarMinutos("10:00", k * 7) } },
    );
  });
  const conDueno = libres.filter((u) => u.conv.estado === "persona" || u.conv.estado === "visita");
  (datos.notas ?? []).forEach((texto, k) => {
    const u = (conDueno.length ? conDueno : libres)[k % Math.max(1, (conDueno.length ? conDueno : libres).length)];
    if (u) u.extra.push({ tipo: "nota", texto });
  });
  return usos;
}

// ---- Visitas pasadas: en su día, a la hora de la rejilla en que se ofrecieron, sin chocar ----

function visitasPasadas(usos: Uso[], ctx: Contexto, ocupados: Set<string>): void {
  const horas = ctx.r.horas;
  for (const u of usos) {
    if (!u.visitaPlan || u.futura) continue;
    const base = u.visitaPlan.desde === "creacion" ? pared(u.creadoEn, ctx.zona).fecha : ctx.hoy;
    const dia = moverAbiertos(base, u.visitaPlan.od, ctx.r);
    const preferida = ((u.visitaPlan.hora % horas.length) + horas.length) % horas.length;
    for (let d = 0; d < 60 && !u.slot; d++) {
      const fecha = d === 0 ? dia : moverAbiertos(dia, d % 2 ? -Math.ceil(d / 2) : Math.ceil(d / 2), ctx.r);
      for (let k = 0; k < horas.length && !u.slot; k++) {
        const id = `${fecha}T${horas[(preferida + k) % horas.length]}`;
        if (!ocupados.has(id)) u.slot = id;
      }
    }
    if (u.slot) ocupados.add(u.slot);
  }
}

// ---- El reloj de cada lead ----

/** Los pasos en orden: los mensajes, lo que hace el dueño (delante del mensaje `antes`) y el repaso de la ficha. */
function ordenarPasos(u: Uso): Paso[] {
  const acciones = [...(u.conv.acciones ?? autoAcciones(u)), ...u.extra];
  const pasos: Paso[] = [];
  const total = u.mensajes.length;
  for (let n = 0; n <= total; n++) {
    for (const a of acciones) if (Math.min(a.antes ?? total, total) === n) pasos.push({ clase: "accion", a });
    if (n < total) pasos.push({ clase: "mensaje", m: u.mensajes[n], n });
  }
  const repaso = (u.conv.etiquetas?.length ?? 0) > 0 || presupuestoRepaso(u) !== undefined;
  if (repaso && u.canal !== "manual" && !u.spam) {
    const primero = pasos.findIndex((p) => p.clase === "accion" || (p.clase === "mensaje" && p.m.manual));
    pasos.splice(primero < 0 ? pasos.length : primero, 0, { clase: "repaso" });
  }
  return pasos;
}

function presupuestoRepaso(u: Uso): number | undefined {
  if (u.conv.presupuesto !== undefined && !u.repetida) return u.conv.presupuesto;
  if (u.conv.acciones || u.conv.estado !== "visita") return undefined;
  const [min, max] = u.servicio.rango;
  return min + hash01(`${u.clave}-estimacion`) * Math.max(0, max - min);
}

/** Lo que hace el dueño cuando el guion no lo dice: coger la visita, el presupuesto y el cierre. */
function autoAcciones(u: Uso): AccionSemilla[] {
  const acciones: AccionSemilla[] = [];
  const confirma = u.mensajes.findIndex((m) => m.de === "agente" && !m.manual && m.texto.includes("{hueco}"));
  if (u.conv.estado === "persona" && u.conv.elige && confirma >= 0) {
    acciones.push({ tipo: "persona", antes: confirma + 1 });
    const cierre = u.conv.cierre;
    if (cierre?.accion === "si") {
      acciones.push({ tipo: "ficha", presupuesto: cierre.importe, etiquetas: [...(u.conv.etiquetas ?? []), "presupuesto enviado"], nota: "Presupuesto enviado el {fecha}", en: { desde: "visita", od: 2, hora: "12:00" } });
      acciones.push({ tipo: "cierre", en: { desde: "visita", od: 4, hora: "11:30" } });
    } else if (cierre) acciones.push({ tipo: "cierre", en: { desde: "visita", od: 3, hora: "12:30" } });
  } else if (u.conv.cierre) acciones.push({ tipo: "cierre" });
  if (u.conv.estado === "conversacion" && u.mensajes.some((m) => m.pase)) acciones.push({ tipo: "devuelto" });
  return acciones;
}

/**
 * Pone hora a cada paso. El cliente y el asistente escriben a cualquier hora; el dueño, solo en sus
 * ratos de oficina y nunca hoy: si un paso suyo caería hoy, ni ese ni nada de lo que viene detrás
 * pasa. Un mensaje a mano solo sale dentro de las 24 h del último del cliente (la regla de Meta).
 */
function cronometrar(u: Uso, ctx: Contexto): void {
  const azar = generador((u.i * 7919 + 17) ^ 0x5bd1e995);
  u.pasos = ordenarPasos(u);
  let t = u.creadoEn;
  let ultimoCliente = Number.NEGATIVE_INFINITY;
  let previo: Paso | undefined;
  const inicioManana = momentoEn(sumarDias(ctx.hoy, 1), "00:00", ctx.zona);
  const horaCreacion = pared(u.creadoEn, ctx.zona).hora;
  const deNoche = horaCreacion >= "22:30" || horaCreacion < "07:00";

  for (const p of u.pasos) {
    const r1 = azar();
    const r2 = azar();
    azar();
    let ts: number;
    if (p.clase === "mensaje") {
      const m = p.m;
      if (m.plantilla) ts = u.creadoEn;
      else if (m.manual) {
        const base = m.en ? Math.max(anclaEn(m.en, u, ctx), t + MINUTO) : t + (m.tras !== undefined ? m.tras * 1000 : (3 + r1 * 12) * MINUTO);
        if (!Number.isFinite(base)) break;
        ts = primeraVentana(base, ctx);
        if (ts >= ctx.inicioHoy) break;
        if (ts - ultimoCliente > DIA) continue;
      } else {
        if (m.en) ts = Math.max(anclaEn(m.en, u, ctx), t + 1000);
        else if (m.tras !== undefined) ts = t + m.tras * 1000;
        else ts = t + espera(previo, m, r1, r2, u, ctx, deNoche, t);
        if (!Number.isFinite(ts) || ts >= inicioManana) break;
      }
      if (m.de === "cliente") ultimoCliente = ts;
    } else {
      const a = p.clase === "accion" ? p.a : undefined;
      let base = a?.en ? Math.max(anclaEn(a.en, u, ctx), t + MINUTO) : t + (5 + r1 * 20) * MINUTO;
      // El dueño coge la visita cuando ya ha pasado: hora y algo después.
      if (a?.tipo === "persona" && !a.en && u.slot && !u.futura) base = Math.max(base, momentoEn(u.slot.slice(0, 10), u.slot.slice(11), ctx.zona) + (60 + r2 * 30) * MINUTO);
      if (!Number.isFinite(base)) break;
      ts = primeraVentana(base, ctx);
      if (ts >= ctx.inicioHoy) break;
    }
    ts = Math.round(ts);
    u.hechos.push({ p, ts });
    t = ts;
    previo = p;
  }
}

/** Lo que tarda un mensaje del cliente o del asistente después del paso anterior. */
function espera(previo: Paso | undefined, m: MensajeGuion, r1: number, r2: number, u: Uso, ctx: Contexto, deNoche: boolean, t: number): number {
  if (!previo) return 0;
  const anterior = previo.clase === "mensaje" ? previo.m : undefined;
  if (m.de === "agente") return (anterior?.de === "cliente" ? 5 + r1 * 7 : 2 + r1 * 3) * 1000;
  if (!anterior) return (30 + r1 * 90) * MINUTO;
  if (anterior.plantilla) {
    // La primera respuesta a la plantilla: mediana de 9 min; si llegó después de las 22:30 (o de madrugada), por la mañana.
    if (deNoche) {
      const { fecha, hora } = pared(u.creadoEn, ctx.zona);
      const manana = hora >= "22:30" ? sumarDias(fecha, 1) : fecha;
      return Math.max(MINUTO, momentoEn(manana, sumarMinutos("07:50", r1 * 100), ctx.zona) - t);
    }
    return cuantil(r1, [[0, 0.7], [0.25, 2], [0.5, 9], [0.75, 25], [1, 90]]) * MINUTO;
  }
  if (anterior.de === "cliente") return (10 + r1 * 80) * 1000;
  if (anterior.manual) return (2 + r1 * 23) * MINUTO;
  // Contesta al asistente: de 30 s a 6 min (mediana 1,5 min) y, a veces, una pausa de 1 a 3 h (si no cae de madrugada).
  if (r2 < 0.15) {
    const pausa = (60 + r1 * 120) * MINUTO;
    const hora = pared(t + pausa, ctx.zona).hora;
    if (hora >= "07:30") return pausa;
  }
  return cuantil(r1, [[0, 0.5], [0.5, 1.5], [1, 6]]) * MINUTO;
}

/** Lo del cliente (y la respuesta del asistente) que caería después de `ahora` pasa a la noche anterior. */
function moverTrasAhora(u: Uso, ctx: Contexto): void {
  const mensajes = u.hechos.filter((h) => h.p.clase === "mensaje");
  let anterior = u.creadoEn;
  const k = mensajes.findIndex((h) => h.ts > ctx.ahora);
  for (const h of mensajes.slice(0, k < 0 ? mensajes.length : k)) {
    u.finales.set((h.p as { n: number }).n, h.ts);
    anterior = h.ts;
  }
  if (k < 0) return;
  const cola = mensajes.slice(k);
  const huecos = cola.map((h, j) => Math.min((j === 0 ? h.ts - anterior : h.ts - cola[j - 1].ts), 20 * MINUTO));
  if (k === 0 && (cola[0].p as { m: MensajeGuion }).m.plantilla) huecos[0] = 0;
  const total = huecos.reduce((s, x) => s + x, 0);
  const disponible = ctx.ahora - anterior - 1000;
  const escala = total > disponible && total > 0 ? Math.max(0, disponible) / total : 1;
  let t = anterior;
  for (const [j, h] of cola.entries()) {
    t += Math.floor(huecos[j] * escala);
    u.finales.set((h.p as { n: number }).n, t);
  }
}

// ---- Visitas futuras: en la rejilla, en días abiertos, nunca en los primeros huecos libres ----

function visitasFuturas(usos: Uso[], ctx: Contexto, ocupados: Set<string>): void {
  const horas = ctx.r.horas;
  const proximos: string[] = [];
  const dias = (cuantos: number): string[] => {
    while (proximos.length < cuantos) proximos.push(moverAbiertos(proximos.at(-1) ?? ctx.hoy, 1, ctx.r));
    return proximos.slice(0, cuantos);
  };
  const ahora = new Date(ctx.ahora);
  const colocar = (u: Uso, todos: Set<string>): string | undefined => {
    const plan = u.visitaPlan ?? { od: 0, hora: 0 };
    for (const cuantos of [ctx.r.diasVista, 365]) {
      const lista = dias(cuantos).flatMap((d) => horas.map((h) => `${d}T${h}`));
      const inicio = (((plan.od % cuantos) + cuantos) % cuantos) * horas.length + (((plan.hora % horas.length) + horas.length) % horas.length);
      const protegidos = huecosProtegidos(comoReservas(todos), ahora, ctx.r);
      for (let j = 0; j < lista.length; j++) {
        const id = lista[(inicio + j) % lista.length];
        if (!todos.has(id) && !protegidos.has(id)) return id;
      }
    }
    for (const d of dias(365)) for (const h of horas) if (!todos.has(`${d}T${h}`)) return `${d}T${h}`;
    return undefined;
  };
  const futuras = usos.filter((u) => u.futura && u.confirma !== undefined);
  for (const u of futuras) {
    const id = colocar(u, ocupados);
    if (!id) continue;
    u.slot = id;
    ocupados.add(id);
  }
  // Comprobación: con las demás visitas puestas, ninguna futura es de las que ofrecería el asistente.
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    let cambios = 0;
    for (const u of futuras) {
      if (!u.slot) continue;
      const otras = new Set(ocupados);
      otras.delete(u.slot);
      if (!huecosProtegidos(comoReservas(otras), ahora, ctx.r).has(u.slot)) continue;
      const id = colocar(u, otras);
      if (!id || id === u.slot) continue;
      ocupados.delete(u.slot);
      u.slot = id;
      ocupados.add(id);
      cambios++;
    }
    if (!cambios) break;
  }
}

// ---- Textos ----

interface Reservada {
  slot: string;
  confirmadaEn: number;
  uso: Uso;
}

/** El par de huecos con el que se reservó: el elegido y otro cercano de la rejilla. */
function parDeReserva(u: Uso, ctx: Contexto, ofertaEn: number, tomados: Set<string>): { hueco1: string; hueco2: string; elegido: string } | undefined {
  const s = u.slot;
  if (!s) return undefined;
  const horas = ctx.r.horas;
  const dia = s.slice(0, 10);
  const hora = s.slice(11);
  const libre = (id: string) => id !== s && !tomados.has(id);
  const desde = pared(ofertaEn, ctx.zona);
  const primerDia = sumarDias(desde.fecha, ctx.r.desdeDias);
  const valeAntes = (id: string) => libre(id) && id.slice(0, 10) >= primerDia && momentoEn(id.slice(0, 10), id.slice(11), ctx.zona) > ofertaEn;

  const despues = (): string | undefined => {
    if (u.conv.parMismoDia) {
      const misma = horas.filter((h) => h > hora).map((h) => `${dia}T${h}`).find(libre);
      if (misma) return misma;
    }
    let primero: string | undefined;
    for (let k = 1; k <= 40; k++) {
      const d = moverAbiertos(dia, k, ctx.r);
      for (const h of horas) {
        const id = `${d}T${h}`;
        if (!libre(id)) continue;
        primero ??= id;
        if (franjaDe(h, ctx.r) !== franjaDe(hora, ctx.r)) return id;
      }
      if (primero && k > 3) return primero;
    }
    return primero;
  };
  const antes = (): string | undefined => {
    const candidatos: string[] = [];
    if (u.conv.parMismoDia) candidatos.push(...horas.filter((h) => h < hora).reverse().map((h) => `${dia}T${h}`));
    for (let k = 1; k <= 10; k++) {
      const d = moverAbiertos(dia, -k, ctx.r);
      candidatos.push(`${d}T${hora}`, ...horas.filter((h) => h !== hora).reverse().map((h) => `${d}T${h}`));
      if (k === 1 && !u.conv.parMismoDia) candidatos.push(...horas.filter((h) => h < hora).reverse().map((h) => `${dia}T${h}`));
    }
    return candidatos.find(valeAntes);
  };

  if ((u.conv.elige ?? 1) === 2) {
    const otro = antes();
    if (otro) return { hueco1: otro, hueco2: s, elegido: s };
  }
  const otro = despues();
  if (!otro) return { hueco1: s, hueco2: s, elegido: s };
  return { hueco1: s, hueco2: otro, elegido: s };
}

/** Los dos huecos que ofrecería el asistente en ese momento, con las visitas que había entonces. */
function libresEn(ts: number, u: Uso, reservadas: Reservada[], ctx: Contexto): [string | undefined, string | undefined] {
  const ocupados = new Set(ctx.o.ocupados ?? []);
  for (const r of reservadas) if (r.uso !== u && r.confirmadaEn < ts) ocupados.add(r.slot);
  const { a, b } = primerosLibres(ocupados, ts, ctx.r);
  return [a, b];
}

/** Inserta la presentación tras un saludo inicial («¡Hola, Laura! …») o al principio. */
function insertarPresentacion(texto: string, frase: string): string {
  const saludo = texto.match(/^(¡[^!]{1,40}!|(?:hola|buenas|buenos días|buenas tardes|buenas noches)[^.!?]{0,30}[.!])\s+/i);
  if (saludo) return `${saludo[0]}${frase} ${texto.slice(saludo[0].length)}`;
  return `${frase} ${texto}`;
}

// ---- El motor ----

/**
 * El motor genérico: con los guiones de un sector (`datos`) y las opciones del negocio, un mes de uso
 * creíble hasta `ahora`. Cada etapa sale con `datos.cuotas[etapa]` leads, tomando las conversaciones de
 * esa etapa en orden. Lo que un guion no fija (día, hora, nombre, visita, lo que hace el dueño) lo
 * decide el generador con `datos.semilla`.
 */
export function generarSector(datos: DatosSemilla, o: OpcionesSemilla, ahora: Date): SemillaGenerada {
  const r = reglasSeguras(o.reglas);
  const ahoraMs = ahora.getTime();
  const hoy = pared(ahoraMs, r.zona).fecha;
  const ctx: Contexto = {
    o,
    r,
    zona: r.zona,
    ahora: ahoraMs,
    hoy,
    inicioHoy: momentoEn(hoy, "00:00", r.zona),
    moneda: o.moneda && MONEDAS[o.moneda] ? o.moneda : "EUR",
  };

  const usos = repartir(datos, ctx);
  const ocupados = new Set((o.ocupados ?? []).filter((x) => typeof x === "string"));
  visitasPasadas(usos, ctx, ocupados);
  for (const u of usos) {
    cronometrar(u, ctx);
    const pasan = new Set(u.hechos.filter((h) => h.p.clase === "mensaje").map((h) => (h.p as { n: number }).n));
    const confirma = u.mensajes.findIndex((m, n) => pasan.has(n) && m.de === "agente" && !m.manual && m.texto.includes("{hueco}"));
    if (confirma >= 0 && u.visitaPlan) {
      u.confirma = confirma;
      for (let n = confirma - 1; n >= 0; n--) {
        if (/\{hueco[12]\}/.test(u.mensajes[n].texto)) {
          u.oferta = n;
          break;
        }
      }
    }
    if (u.conv.estado === "persona" || u.conv.estado === "conversacion") {
      const marcado = u.mensajes.findIndex((m) => m.pase);
      if (marcado >= 0) u.pase = marcado;
      else if (u.conv.estado === "persona" && !u.conv.elige) {
        const primerManual = u.mensajes.findIndex((m) => m.manual);
        const hasta = primerManual < 0 ? u.mensajes.length : primerManual;
        for (let n = hasta - 1; n >= 0; n--) {
          if (u.mensajes[n].de === "agente" && !u.mensajes[n].plantilla && !u.mensajes[n].manual) {
            u.pase = n;
            break;
          }
        }
      }
    }
    moverTrasAhora(u, ctx);
  }
  // Una visita pasada cuya confirmación no llega a pasar no ocupa su hueco.
  for (const u of usos) {
    if (u.slot && u.confirma === undefined) {
      ocupados.delete(u.slot);
      u.slot = undefined;
    }
  }
  visitasFuturas(usos, ctx, ocupados);

  const reservadas: Reservada[] = [];
  for (const u of usos) {
    if (!u.slot || u.confirma === undefined) continue;
    const nominal = u.hechos.find((h) => h.p.clase === "mensaje" && h.p.n === u.confirma)?.ts ?? u.creadoEn;
    reservadas.push({ slot: u.slot, confirmadaEn: nominal, uso: u });
  }
  const tomados = new Set([...ocupados]);

  const leads: Record<string, Lead> = {};
  const reservas: Reserva[] = [];
  for (const u of usos) {
    const { lead, reserva } = montar(u, ctx, reservadas, tomados);
    leads[lead.id] = lead;
    if (reserva) reservas.push(reserva);
  }
  return { leads, reservas };
}

/** El lead acabado: textos, historial, ficha y visita, a partir de los pasos que han pasado. */
function montar(u: Uso, ctx: Contexto, reservadas: Reservada[], tomados: Set<string>): { lead: Lead; reserva?: Reserva } {
  const { o } = ctx;
  const pila = nombreDePila(u.nombre);
  const frases = FRASES_POR_DEFECTO;
  const presentacion = frases.presentacion.replaceAll("{negocio}", o.negocio);
  const plantillaNombre = Object.entries(CUERPOS_CONOCIDOS).find(([, cuerpo]) => cuerpo === o.plantilla)?.[0];
  const formatear = (n: number) => formatoImporte(n, ctx.moneda);

  // Los datos de la ficha: solo los campos del negocio; los metros, como los guarda la ficha.
  const claves = new Set((o.campos ?? []).map((c) => c.clave));
  const datos: Record<string, string> = {};
  const metros = (() => {
    const crudo = u.conv.datos.metros ?? "";
    const n = /^\d+/.test(crudo) ? Number(crudo.match(/^\d+/)?.[0]) : u.metros;
    return n !== undefined && Number.isFinite(n) ? metrosLimpios(n) : undefined;
  })();
  for (const [clave, valor] of Object.entries({ ...(u.repetida || u.conv.acciones ? {} : u.servicio.datos), ...u.conv.datos })) {
    if (!claves.has(clave)) continue;
    if (clave === "metros") {
      if (metros !== undefined) datos.metros = `${metros} m²`;
      continue;
    }
    const limpio = valor.replaceAll("{metros}", String(metros ?? "")).replaceAll("{zona}", u.zona ?? "").trim();
    if (limpio) datos[clave] = limpio;
  }

  // La visita y los huecos que se ofrecieron.
  const ofertaEn = u.oferta !== undefined ? (u.hechos.find((h) => h.p.clase === "mensaje" && h.p.n === u.oferta)?.ts ?? u.creadoEn) : u.creadoEn;
  const otrosTomados = new Set(tomados);
  if (u.slot) otrosTomados.delete(u.slot);
  const par = u.slot && u.confirma !== undefined ? parDeReserva(u, ctx, ofertaEn, otrosTomados) : undefined;
  const hueco = (id?: string): Hueco | undefined => (id ? { id, texto: textoHueco(id) } : undefined);
  let ofrecidos: Hueco[] = [];

  const texto = (m: MensajeGuion, nominal: number, previos: Mensaje[]): string => {
    let t = m.texto;
    if (m.plantilla) return textoPlantilla(pila, o.negocio, o.plantilla);
    const conLibres = /\{libre[12]\}/.test(t) || (!par && /\{hueco[12]?\}/.test(t));
    const libres = conLibres ? libresEn(nominal, u, reservadas, ctx) : [undefined, undefined];
    if (/\{(libre|hueco)[12]\}/.test(t)) {
      const a = conLibres ? libres[0] : par?.hueco1;
      const b = conLibres ? libres[1] : par?.hueco2;
      ofrecidos = [hueco(a), hueco(b)].filter((h): h is Hueco => !!h);
    }
    const agenteLibre = m.de === "agente" && !m.manual;
    let frase = "";
    if (agenteLibre && necesitaPresentacion(previos)) frase = presentacion;
    const sustituciones: Record<string, string> = {
      "{nombre}": pila,
      "{negocio}": o.negocio,
      "{metros}": String(metros ?? ""),
      "{zona}": u.zona ?? "",
      "{pase}": frases.pase,
      "{baja}": frases.baja,
      "{hueco1}": par ? textoHueco(par.hueco1) : libres[0] ? textoHueco(libres[0]) : "",
      "{hueco2}": par ? textoHueco(par.hueco2) : libres[1] ? textoHueco(libres[1]) : "",
      "{hueco}": par ? textoHueco(par.elegido) : libres[0] ? textoHueco(libres[0]) : "",
      "{libre1}": libres[0] ? textoHueco(libres[0]) : "",
      "{libre2}": libres[1] ? textoHueco(libres[1]) : "",
      "{diaHueco}": u.slot ? textoHueco(u.slot).replace(/ a las .*$/, "") : "",
      "{horaHueco}": u.slot ? u.slot.slice(11) : "",
    };
    const conPlaceholder = t.includes("{presentacion}");
    t = t.replaceAll("{presentacion}", frase ? `${frase} ` : "");
    for (const [marca, valor] of Object.entries(sustituciones)) t = t.replaceAll(marca, valor);
    if (frase && !conPlaceholder) t = insertarPresentacion(t, frase);
    return t.replace(/ {2,}/g, " ").trim();
  };

  // ---- Recorrido: el historial, la ficha y la conversación tal como quedan ----
  const mensajes: Mensaje[] = [];
  const actividad: (Actividad & { orden: number })[] = [];
  const notas: Nota[] = [];
  const tareas: Tarea[] = [];
  let orden = 0;
  const linea = (id: string, textoLinea: string, ts: number) => actividad.push({ id, texto: textoLinea, ts, orden: orden++ });

  let estado = "nuevo" as EstadoLead;
  let cambioEstadoEn = u.creadoEn;
  let motivoPersona: string | undefined;
  let motivoSpam: string | undefined;
  let presupuesto: number | undefined;
  let cobrado: number | undefined;
  let etiquetas: string[] | undefined;
  let silenciadoEn: number | undefined;
  let cierre: Lead["cierre"];
  let cierreEn: number | undefined;
  let motivoCierre: Lead["motivoCierre"];
  let vueltaVistaEn: number | undefined;
  let volvio = false;
  let reservada = false;
  let primerCliente: number | undefined;
  let primerAgente: number | undefined;
  let marcaSpam: number | undefined;

  const cambiarEstado = (nuevo: EstadoLead, ts: number) => {
    estado = nuevo;
    cambioEstadoEn = ts;
  };
  const conFecha = (t: string, ts: number) =>
    t.replaceAll("{fecha}", fechaNota(pared(ts, ctx.zona).fecha)).replace(/\{importe:(\d+)\}/g, (_, n: string) => formatear(escalar(Number(n), ctx)));
  const anotar = (textoNota: string, ts: number) => {
    const nota: Nota = { id: `${u.clave}-nota-${notas.length + 1}`, texto: conFecha(textoNota, ts), ts };
    notas.push(nota);
    linea(`nota-${nota.id}`, `Nota interna: ${recortar(nota.texto, 60)}`, ts);
  };
  const editarFicha = (cambios: { presupuesto?: number; etiquetas?: string[] }, ts: number) => {
    const campos: string[] = [];
    if (cambios.presupuesto !== undefined && cambios.presupuesto !== presupuesto) {
      presupuesto = cambios.presupuesto;
      campos.push("presupuesto");
    }
    if (cambios.etiquetas) {
      const limpias = etiquetasLimpias(cambios.etiquetas);
      if (limpias.join("\n") !== (etiquetas ?? []).join("\n")) {
        etiquetas = limpias;
        campos.push("etiquetas");
      }
    }
    if (campos.length) linea(`ficha-${u.id}-${ts}`, `Ficha editada: ${campos.join(", ")}`, ts);
  };
  const venceDe = (v: NonNullable<Extract<AccionSemilla, { tipo: "tarea" }>["vence"]>): string | undefined => {
    if ("visita" in v) return u.slot?.slice(0, 10);
    if ("od" in v) return moverAbiertos(ctx.hoy, v.od, ctx.r);
    return sumarDias(ctx.hoy, v.dia);
  };

  if (u.canal === "formulario") linea(`permiso-${u.id}-${u.creadoEn}`, "Ha pedido que le escribamos por WhatsApp desde tu web", u.creadoEn);
  if (u.canal === "manual") linea(`alta-${u.id}-${u.creadoEn}`, "Lo añadiste tú", u.creadoEn);

  for (const { p, ts: nominal } of u.hechos) {
    if (p.clase === "mensaje") {
      const m = p.m;
      const ts = u.finales.get(p.n) ?? nominal;
      const mensaje: Mensaje = {
        id: `${u.clave}-${p.n + 1}`,
        de: m.de,
        texto: texto(m, nominal, mensajes),
        ts,
        ...(m.plantilla ? { plantilla: true } : {}),
        ...(m.plantilla && plantillaNombre ? { nombrePlantilla: plantillaNombre } : {}),
        ...(m.audio && m.de === "cliente" ? { audio: true } : {}),
        ...(m.manual && m.de === "agente" ? { manual: true } : {}),
      };
      mensajes.push(mensaje);
      if (m.de === "cliente") {
        primerCliente ??= ts;
        if (estado === "nuevo") {
          cambiarEstado("conversacion", ts);
          linea(`estado-${u.id}-${ts}`, "Estado: En conversación", ts);
        }
        if (m.baja && silenciadoEn === undefined) {
          silenciadoEn = ts;
          linea(`silencio-${u.id}-${ts}`, "Ha pedido que no le escribamos", ts);
        }
        if (cierre && cierreEn !== undefined && ts > cierreEn && !volvio) {
          volvio = true;
          linea(`volvio-${u.id}-${cierreEn}`, "Ha vuelto a escribir", ts);
        }
      } else if (!m.plantilla && !m.manual) {
        primerAgente ??= ts;
        if (u.spam && marcaSpam === undefined && !u.conv.porRegla) marcaSpam = ts;
        if (p.n === u.confirma && u.slot && !reservada) {
          reservada = true;
          linea(`reserva-${u.id}-${ts}`, `Visita reservada: ${textoHueco(u.slot)}`, ts);
          if (estado !== "persona" && estado !== "spam") {
            cambiarEstado("visita", ts);
            linea(`estado-${u.id}-${ts}`, "Estado: Visita reservada", ts);
          }
        }
        if (p.n === u.pase && estado !== "persona") {
          motivoPersona = u.conv.motivo ?? "Pide hablar con una persona";
          cambiarEstado("persona", ts);
          linea(`estado-${u.id}-${ts}`, `Pasado a persona: ${motivoPersona}`, ts);
        }
      }
      continue;
    }

    const ts = nominal;
    if (p.clase === "repaso") {
      const estimado = presupuestoRepaso(u);
      editarFicha({ ...(estimado !== undefined ? { presupuesto: estimacion(estimado, ctx) } : {}), ...(u.conv.etiquetas ? { etiquetas: u.conv.etiquetas } : {}) }, ts);
      continue;
    }
    const a = p.a;
    if (a.tipo === "persona") {
      motivoPersona = a.motivo ?? LLEVAS_TU;
      cambiarEstado("persona", ts);
      linea(`etapa-${u.id}-${ts}`, `Pasado a persona: ${motivoPersona}`, ts);
    } else if (a.tipo === "devuelto") {
      motivoPersona = undefined;
      cambiarEstado("conversacion", ts);
      linea(`etapa-${u.id}-${ts}`, "Devuelto a tu asistente", ts);
    } else if (a.tipo === "ficha") {
      editarFicha({ ...(a.presupuesto !== undefined ? { presupuesto: escalar(a.presupuesto, ctx) } : {}), ...(a.etiquetas ? { etiquetas: a.etiquetas } : {}) }, ts);
      if (a.nota) anotar(a.nota, ts + MINUTO);
    } else if (a.tipo === "nota") {
      anotar(a.texto, ts);
    } else if (a.tipo === "tarea") {
      const tarea: Tarea = { id: `${u.clave}-tarea-${tareas.length + 1}`, texto: a.texto, hecha: false, ts };
      const vence = a.vence ? venceDe(a.vence) : undefined;
      if (vence) tarea.vence = vence;
      tareas.push(tarea);
      linea(`tarea-${tarea.id}`, `Tarea añadida: ${tarea.texto}`, ts);
      if (a.hecha) {
        const base = a.hecha === true ? ts + (90 + hash01(tarea.id) * 120) * MINUTO : Math.max(anclaEn(a.hecha, u, ctx), ts + MINUTO);
        const hecha = Number.isFinite(base) ? Math.round(primeraVentana(base, ctx)) : Number.POSITIVE_INFINITY;
        if (hecha < ctx.inicioHoy) {
          tarea.hecha = true;
          linea(`hecha-${tarea.id}`, "Tarea hecha", hecha);
        }
      }
    } else if (a.tipo === "cierre") {
      const c = u.conv.cierre;
      if (!c || cierre) continue;
      cierre = c.accion;
      cierreEn = ts;
      if (c.accion === "si") {
        presupuesto = escalar(c.importe, ctx);
        if (c.cobrado !== undefined) cobrado = escalar(c.cobrado, ctx);
        linea(`cierre-${u.id}-${ts}`, `Ha dicho que sí · ${formatear(presupuesto)}`, ts);
      } else {
        motivoCierre = c.motivo;
        linea(`cierre-${u.id}-${ts}`, `No sigue · ${c.motivo}`, ts);
      }
      if (a.nota) anotar(a.nota, ts + MINUTO);
    } else if (a.tipo === "vista") {
      vueltaVistaEn = ts;
    }
  }

  // Spam: lo marca el código al llegar (sin respuesta) o el asistente al contestar.
  if (u.spam && mensajes.length) {
    const ultimoCliente = [...mensajes].reverse().find((m) => m.de === "cliente");
    const ts = marcaSpam ?? (ultimoCliente ? ultimoCliente.ts + 1500 : u.creadoEn);
    motivoSpam = u.conv.motivo ?? "Publicidad";
    cambiarEstado("spam", ts);
    linea(`estado-${u.id}-${ts}`, `Marcado como spam: ${motivoSpam}`, ts);
  }

  // Los vistos: leído si el cliente ha escrito después; si no, leído o entregado según lo viejo que sea.
  for (const [n, m] of mensajes.entries()) {
    if (m.de !== "agente") continue;
    const despues = mensajes.slice(n + 1).some((x) => x.de === "cliente");
    m.entrega = despues ? "leido" : ctx.ahora - m.ts > 30 * MINUTO && hash01(m.id) < 0.7 ? "leido" : "entregado";
  }

  actividad.sort((a, b) => a.ts - b.ts || a.orden - b.orden);
  const ultimo = Math.max(u.creadoEn, ...mensajes.map((m) => m.ts), ...actividad.map((a) => a.ts));
  const visita = u.slot && reservada ? hueco(u.slot) : undefined;

  const lead = crearLead({
    telefono: u.telefono,
    perfilId: PERFIL_EJEMPLO,
    perfilNombre: o.negocio,
    nombre: u.nombre,
    origen: u.canal,
    ejemplo: true,
    estado,
    datos,
    creadoEn: u.creadoEn,
    actualizadoEn: ultimo,
    cambioEstadoEn,
    mensajes,
    notas,
    tareas,
    actividad: actividad.map(({ id, texto: t, ts }) => ({ id, texto: t, ts })),
    huecosOfrecidos: ofrecidos,
    ...(u.zona ? { zona: u.zona } : {}),
    ...(u.fuente ? { fuente: u.fuente } : {}),
    ...(u.canal === "formulario" && u.msPrimerWhatsApp !== undefined ? { msPrimerWhatsApp: u.msPrimerWhatsApp } : {}),
    ...(u.canal === "whatsapp" && primerCliente !== undefined && primerAgente !== undefined && primerAgente > primerCliente
      ? { msPrimeraRespuesta: primerAgente - primerCliente }
      : {}),
    ...(motivoPersona && estado === "persona" ? { motivoPersona } : {}),
    ...(motivoSpam ? { motivoSpam } : {}),
    ...(presupuesto !== undefined ? { presupuesto } : {}),
    ...(cobrado !== undefined ? { cobrado } : {}),
    ...(etiquetas?.length ? { etiquetas } : {}),
    ...(silenciadoEn !== undefined ? { silenciadoEn } : {}),
    ...(cierre ? { cierre, cierreEn } : {}),
    ...(motivoCierre ? { motivoCierre } : {}),
    ...(vueltaVistaEn !== undefined ? { vueltaVistaEn } : {}),
    ...(visita ? { visita } : {}),
  });
  if (!visita) return { lead };
  return { lead, reserva: { huecoId: visita.id, texto: visita.texto, leadId: lead.id, nombre: u.nombre, perfilNombre: o.negocio, prueba: true } };
}
