// Fechas en la zona del negocio, huecos de cita y la agenda del panel. Puro: lo usan el servidor y el navegador.
// Las horas que ofrece el asistente las decide este código, nunca el modelo. Sin reglas, la rejilla de
// siempre: de lunes a viernes, a las 10:00, 12:30 y 17:00, desde mañana y en hora de Madrid.

import type { Hueco, ReglasAgenda, Reserva } from "./tipos";
import { cap, formas, normalizar, VOCABULARIO_REFORMAS, type Sustantivo } from "./vocabulario";

export const ZONA = "Europe/Madrid";
const HORAS = ["10:00", "12:30", "17:00"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_A_MIRAR = 60;
/** Tope de vueltas al buscar días abiertos: unas reglas sin ningún día abierto no se cuelgan. */
const MAX_VUELTAS = 3 * 366;
/** El orden de la semana en los textos: de lunes a domingo. */
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

export const REGLAS_POR_DEFECTO: Readonly<ReglasAgenda> = Object.freeze({
  zona: ZONA,
  horas: Object.freeze([...HORAS]) as string[],
  diasAbiertos: Object.freeze([1, 2, 3, 4, 5]) as number[],
  cerrados: Object.freeze([]) as unknown as string[],
  diasVista: DIAS_A_MIRAR,
  desdeDias: 1,
  antelacionMinutos: 0,
  corteTarde: "14:00",
});

export const ZONAS_HORARIAS: { id: string; ciudad: string }[] = [
  { id: "Europe/Madrid", ciudad: "Madrid" },
  { id: "Atlantic/Canary", ciudad: "Canarias" },
  { id: "America/Mexico_City", ciudad: "Ciudad de México" },
  { id: "America/Cancun", ciudad: "Cancún" },
  { id: "America/Tijuana", ciudad: "Tijuana" },
  { id: "America/Bogota", ciudad: "Bogotá" },
  { id: "America/Lima", ciudad: "Lima" },
  { id: "America/Guayaquil", ciudad: "Guayaquil" },
  { id: "America/Caracas", ciudad: "Caracas" },
  { id: "America/Santiago", ciudad: "Santiago de Chile" },
  { id: "America/Argentina/Buenos_Aires", ciudad: "Buenos Aires" },
  { id: "America/Montevideo", ciudad: "Montevideo" },
  { id: "America/Asuncion", ciudad: "Asunción" },
  { id: "America/La_Paz", ciudad: "La Paz" },
  { id: "America/Panama", ciudad: "Panamá" },
  { id: "America/Costa_Rica", ciudad: "San José (Costa Rica)" },
  { id: "America/Guatemala", ciudad: "Guatemala" },
  { id: "America/El_Salvador", ciudad: "San Salvador" },
  { id: "America/Tegucigalpa", ciudad: "Tegucigalpa" },
  { id: "America/Managua", ciudad: "Managua" },
  { id: "America/Santo_Domingo", ciudad: "Santo Domingo" },
  { id: "America/Puerto_Rico", ciudad: "San Juan (Puerto Rico)" },
  { id: "America/New_York", ciudad: "Nueva York" },
  { id: "America/Los_Angeles", ciudad: "Los Ángeles" },
];

// ---- Fechas en la zona del negocio ----

const formateadores = new Map<string, Intl.DateTimeFormat>();

/** Un formateador por zona: crearlos es lo caro. Una zona que no existe lanza, como siempre. */
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
      hourCycle: "h23",
    });
    formateadores.set(zona, f);
  }
  return f;
}

/** Fecha y hora de `ahora` en la zona: { fecha: "2026-11-03", hora: "10:02" }. */
export function fechaEn(ahora: Date, zona: string = ZONA): { fecha: string; hora: string } {
  const partes = formateador(zona).formatToParts(ahora);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return {
    fecha: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: `${valor("hour")}:${valor("minute")}`,
  };
}

export function fechaMadrid(ahora: Date): { fecha: string; hora: string } {
  return fechaEn(ahora);
}

function aDiaUtc(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

function diaSemana(fecha: string): number {
  return aDiaUtc(fecha).getUTCDay();
}

export function sumarDias(fecha: string, dias: number): string {
  const d = aDiaUtc(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Si el negocio abre ese día: el día de la semana está abierto y la fecha no está cerrada. */
export function abierto(fecha: string, r: ReglasAgenda = REGLAS_POR_DEFECTO): boolean {
  return r.diasAbiertos.includes(diaSemana(fecha)) && !r.cerrados.includes(fecha);
}

/**
 * Los primeros `cuantos` días abiertos a partir de `fecha + desde` (con `desde` 0 cuenta `fecha`).
 * Como mucho 3 × 366 vueltas: sin ningún día abierto devuelve [] (o menos de `cuantos`).
 */
export function diasAbiertos(fecha: string, cuantos: number, r: ReglasAgenda = REGLAS_POR_DEFECTO, desde = 1): string[] {
  const dias: string[] = [];
  let actual = sumarDias(fecha, desde);
  for (let vuelta = 0; vuelta < MAX_VUELTAS && dias.length < cuantos; vuelta++) {
    if (abierto(actual, r)) dias.push(actual);
    actual = sumarDias(actual, 1);
  }
  return dias;
}

/** Días abiertos a partir del siguiente a `fecha`. */
export function diasLaborables(fecha: string, cuantos: number, r?: ReglasAgenda): string[] {
  return diasAbiertos(fecha, cuantos, r, 1);
}

/** Lunes de la semana de `fecha`. */
export function lunesDe(fecha: string): string {
  const dia = diaSemana(fecha);
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia);
}

export function textoDia(fecha: string): string {
  const d = aDiaUtc(fecha);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

export function textoHueco(huecoId: string): string {
  const [fecha, hora] = huecoId.split("T");
  return `${textoDia(fecha)} a las ${hora}`;
}

/** Fecha y hora para el contexto del modelo: martes 3 de noviembre de 2026, 10:02. */
export function textoAhora(ahora: Date, zona: string = ZONA): string {
  const { fecha, hora } = fechaEn(ahora, zona);
  const d = aDiaUtc(fecha);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES_LARGOS[d.getUTCMonth()]} de ${d.getUTCFullYear()}, ${hora}`;
}

/** La ciudad de la zona horaria: «Madrid», «Ciudad de México»… Fuera de la lista, el último tramo del id. */
export function lugarDeZona(zona: string = ZONA): string {
  return ZONAS_HORARIAS.find((z) => z.id === zona)?.ciudad ?? (zona.split("/").pop() ?? zona).replace(/_/g, " ");
}

const MINUTO = 60_000;
const DIA = 86_400_000;

/** La hora de pared de un instante en la zona, leída como si fuera UTC (en ms, al minuto). */
function paredEn(t: number, zona: string): number {
  const partes = formateador(zona).formatToParts(new Date(t));
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? Number.NaN);
  return Date.UTC(valor("year"), valor("month") - 1, valor("day"), valor("hour"), valor("minute"));
}

/**
 * El instante (ms) de un hueco `AAAA-MM-DDTHH:MM` leído como hora de pared en la zona. Seguro con
 * los cambios de hora: en una hora repetida, la primera; en una hora que no existe, la que queda
 * al adelantar el reloj. Un id mal formado da NaN.
 */
export function momentoDeHueco(id: string, zona: string = ZONA): number {
  const m = typeof id === "string" ? id.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/) : null;
  if (!m || !fechaReal(m[1])) return Number.NaN;
  const [ano, mes, dia] = m[1].split("-").map(Number);
  const g = Date.UTC(ano, mes - 1, dia, Number(m[2]), Number(m[3]));
  try {
    const desfase = (t: number): number => {
      const minuto = Math.floor(t / MINUTO) * MINUTO;
      return paredEn(minuto, zona) - minuto;
    };
    const candidatos = [g - desfase(g - DIA), g - desfase(g + DIA)];
    const validos = candidatos.filter((c) => paredEn(c, zona) === g);
    return validos.length > 0 ? Math.min(...validos) : Math.max(...candidatos);
  } catch {
    return Number.NaN;
  }
}

/** Días de calendario de `desde` a `hasta` si caen a ±6 días; si no, null. Siempre sobre fechas, nunca con ms. */
function difCercana(desde: string, hasta: string): number | null {
  for (let k = -6; k <= 6; k++) if (sumarDias(desde, k) === hasta) return k;
  return null;
}

/**
 * Fechas que se leen solas: «Hoy, 12:30», «Mañana, 10:00», «Ayer, 18:40», «vie 13, 12:30» (a ±6 días),
 * «21 nov, 11:00» y, a medio año o más, «21 nov 2025, 11:00». Nunca un día de la semana sin su mes
 * fuera de esa semana.
 */
export function fechaCorta(ts: number, ahora: Date, zona: string = ZONA): string {
  if (typeof ts !== "number" || !Number.isFinite(ts) || !(ahora instanceof Date) || Number.isNaN(ahora.getTime())) return "";
  const { fecha, hora } = fechaEn(new Date(ts), zona);
  const hoy = fechaEn(ahora, zona).fecha;
  const dif = difCercana(hoy, fecha);
  if (dif === 0) return `Hoy, ${hora}`;
  if (dif === 1) return `Mañana, ${hora}`;
  if (dif === -1) return `Ayer, ${hora}`;
  const d = aDiaUtc(fecha);
  if (dif !== null) return `${DIAS_CORTOS[d.getUTCDay()]} ${d.getUTCDate()}, ${hora}`;
  const lejos = fecha >= sumarDias(hoy, 183) || fecha <= sumarDias(hoy, -183);
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}${lejos ? ` ${d.getUTCFullYear()}` : ""}, ${hora}`;
}

// ---- Huecos ----

/** Todas las horas de cita del día, en orden. */
export function todasLasHoras(r: ReglasAgenda = REGLAS_POR_DEFECTO): string[] {
  return [...r.horas].sort();
}

/** Mañana antes del corte; tarde desde el corte. */
export function franja(huecoId: string, r: ReglasAgenda = REGLAS_POR_DEFECTO): "manana" | "tarde" {
  return huecoId.split("T")[1] < r.corteTarde ? "manana" : "tarde";
}

/** El primer momento que se puede reservar: `AAAA-MM-DDTHH:MM` de ahora más la antelación, en la zona. */
export function momentoMinimo(ahora: Date, r: ReglasAgenda = REGLAS_POR_DEFECTO): string {
  const { fecha, hora } = fechaEn(new Date(ahora.getTime() + r.antelacionMinutos * MINUTO), r.zona);
  return `${fecha}T${hora}`;
}

/** Si un hueco cae en un día abierto y en una hora de la rejilla. */
export function encaja(id: string, r: ReglasAgenda = REGLAS_POR_DEFECTO): boolean {
  if (typeof id !== "string") return false;
  const [fecha, hora] = id.split("T");
  return fechaReal(fecha) && abierto(fecha, r) && r.horas.includes(hora ?? "");
}

function diaDe(huecoId: string): string {
  return huecoId.split("T")[0];
}

/**
 * Todos los huecos libres en orden: los días abiertos a la vista por cada hora de la rejilla, sin los
 * reservados y solo después del momento mínimo (una cita de hoy necesita la antelación).
 */
function libres(reservas: Reserva[], ahora: Date, r: ReglasAgenda): string[] {
  const ocupados = new Set(reservas.map((x) => x.huecoId));
  const minimo = momentoMinimo(ahora, r);
  const horas = todasLasHoras(r);
  return diasAbiertos(fechaEn(ahora, r.zona).fecha, r.diasVista, r, r.desdeDias)
    .flatMap((dia) => horas.map((hora) => `${dia}T${hora}`))
    .filter((id) => !ocupados.has(id) && id > minimo);
}

const comoHueco = (id: string): Hueco => ({ id, texto: textoHueco(id) });

/**
 * Los huecos libres en orden, como `Hueco`, hasta `max` huecos: lo que enseña el selector manual de
 * citas. Nunca uno reservado, pasado, dentro de la antelación ni en un día cerrado.
 */
export function huecosLibres(reservas: Reserva[], ahora: Date, r: ReglasAgenda = REGLAS_POR_DEFECTO, max = 60): Hueco[] {
  try {
    const tope = Math.floor(max);
    if (!(tope > 0)) return [];
    return libres(reservas, ahora, r).slice(0, tope).map(comoHueco);
  } catch {
    return [];
  }
}

/** A es el primero; B, el primero de un día posterior en la otra franja o, si no hay, el primero de un día posterior. */
function elegirDos(ids: string[], r: ReglasAgenda): Hueco[] {
  const a = ids[0];
  if (!a) return [];
  const posteriores = ids.filter((id) => diaDe(id) > diaDe(a));
  const b = posteriores.find((id) => franja(id, r) !== franja(a, r)) ?? posteriores[0];
  return [a, b].filter(Boolean).map(comoHueco);
}

/**
 * Los dos huecos que se ofrecen. A es el primero libre. B es el primero libre de un día
 * posterior en la otra franja, que es lo que enseñan las maquetas: martes 10:00 y
 * miércoles 17:00, y tras reservar el primero, martes 12:30 y miércoles 17:00.
 */
export function verHuecos(reservas: Reserva[], ahora: Date, r: ReglasAgenda = REGLAS_POR_DEFECTO): Hueco[] {
  return elegirDos(libres(reservas, ahora, r), r);
}

export interface Preferencia {
  /** Día concreto: 2026-11-05 */
  dia?: string;
  /** Hora concreta: 17:00 */
  hora?: string;
  franja?: "manana" | "tarde";
}

const MAS_PROXIMOS = "Estos son los más próximos: ofrécelos tal cual.";
const SOLO_UNO = "Solo queda este hueco: ofrécelo solo a él.";

/**
 * Para cuando el cliente pide otro día u otra hora. Devuelve hasta dos huecos libres que cumplan
 * lo que pide; si no hay ninguno, los dos de siempre y una nota para que el modelo lo explique.
 * Las notas de «no queda ninguno» y «solo queda uno» miran todos los huecos libres, no la búsqueda.
 */
export function buscarHuecos(
  reservas: Reserva[],
  ahora: Date,
  preferencia: Preferencia = {},
  r: ReglasAgenda = REGLAS_POR_DEFECTO,
  cita: Sustantivo = VOCABULARIO_REFORMAS.cita,
): { huecos: Hueco[]; nota?: string } {
  const todos = libres(reservas, ahora, r);
  if (todos.length === 0) {
    return {
      huecos: [],
      nota: `No quedan huecos libres en los próximos ${r.diasVista} días. No propongas ninguno: usa pasar_a_persona y dile que un compañero le escribe en cuanto pueda para buscar fecha.`,
    };
  }
  const conAviso = (resultado: { huecos: Hueco[]; nota?: string }): { huecos: Hueco[]; nota?: string } => {
    if (todos.length !== 1) return resultado;
    return { huecos: resultado.huecos, nota: resultado.nota ? `${resultado.nota} ${SOLO_UNO}` : SOLO_UNO };
  };

  const { dia, franja: franjaPedida } = preferencia;
  const hora = preferencia.hora?.trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?$/);
  const horaPedida = hora ? `${hora[1].padStart(2, "0")}:${hora[2] ?? "00"}` : undefined;
  if (!dia && !horaPedida && !franjaPedida) return conAviso({ huecos: elegirDos(todos, r) });
  if (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    return conAviso({ huecos: elegirDos(todos, r), nota: "Para buscar un día, pásalo como AAAA-MM-DD. Mientras, estos son los más próximos." });
  }

  const candidatos = todos.filter(
    (id) =>
      (!dia || diaDe(id) === dia) &&
      (!horaPedida || id.endsWith(`T${horaPedida}`)) &&
      (!franjaPedida || franja(id, r) === franjaPedida),
  );
  const a = candidatos[0];
  if (!a) {
    const horas = todasLasHoras(r);
    const horasTexto = horas.length <= 6 ? `a las ${horas.join(", ")}` : resumenHoras(horas);
    const motivo =
      horaPedida && !r.horas.includes(horaPedida)
        ? `${cap(formas(cita).los)} ${cita.plural} solo son ${horasTexto}, ${textoDiasAbiertos(r.diasAbiertos)}.`
        : "No hay ningún hueco libre con lo que pide.";
    return conAviso({ huecos: elegirDos(todos, r), nota: `${motivo} ${MAS_PROXIMOS}` });
  }
  const b = candidatos.find((id) => diaDe(id) > diaDe(a)) ?? candidatos[1];
  return conAviso({ huecos: [a, b].filter(Boolean).map(comoHueco) });
}

/** Lo nuevo primero, sin repetir y sin acumular demasiados: el cliente puede volver a uno anterior. */
export function juntarOfrecidos(nuevos: Hueco[], anteriores: Hueco[]): Hueco[] {
  const ids = new Set(nuevos.map((h) => h.id));
  return [...nuevos, ...anteriores.filter((h) => !ids.has(h.id))].slice(0, 6);
}

/** Acepta el identificador o el texto legible, y solo si salió de `ver_huecos`. */
export function buscarOfrecido(ofrecidos: Hueco[], peticion: string): Hueco | undefined {
  const buscado = normalizar(peticion);
  return ofrecidos.find((h) => normalizar(h.id) === buscado || normalizar(h.texto) === buscado);
}

/**
 * Si se puede reservar el hueco. Sin reglas, la regla de siempre: libre y posterior a ahora. Con
 * reglas, además fuera de la antelación y dentro de los días y las horas del negocio, para que un
 * hueco ofrecido con reglas viejas no se reserve tras cambiarlas.
 */
export function huecoLibre(huecoId: string, reservas: Reserva[], ahora: Date, leadId?: string, r?: ReglasAgenda): boolean {
  const ocupado = reservas.some((x) => x.huecoId === huecoId && x.leadId !== leadId);
  if (!r) {
    const { fecha, hora } = fechaMadrid(ahora);
    return !ocupado && huecoId > `${fecha}T${hora}`;
  }
  return !ocupado && huecoId > momentoMinimo(ahora, r) && encaja(huecoId, r);
}

// ---- Textos de las reglas ----

/** Los días en orden de lunes a domingo, sin repetir. */
function enOrden(d: number[]): number[] {
  return ORDEN_SEMANA.filter((dia) => d.includes(dia));
}

/** Si los días forman un solo tramo seguido de lunes a domingo. */
function seguidos(dias: number[]): boolean {
  const posiciones = dias.map((d) => ORDEN_SEMANA.indexOf(d));
  return posiciones.every((p, i) => i === 0 || p === posiciones[i - 1] + 1);
}

function lista(partes: string[]): string {
  return partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** «de lunes a viernes», «todos los días», «los lunes, miércoles y viernes», «los sábados y domingos». */
export function textoDiasAbiertos(d: number[]): string {
  const dias = enOrden(d);
  if (dias.length === 0) return "";
  if (dias.length === 7) return "todos los días";
  if (dias.length >= 3 && seguidos(dias)) return `de ${DIAS[dias[0]]} a ${DIAS[dias[dias.length - 1]]}`;
  return `los ${lista(dias.map((x) => DIAS_PLURAL[x]))}`;
}

/** «Lunes a viernes», «Todos los días», «Lunes, miércoles y viernes», «Sábado y domingo». */
export function textoDiasCabecera(d: number[]): string {
  const dias = enOrden(d);
  if (dias.length === 0) return "";
  if (dias.length === 7) return "Todos los días";
  if (dias.length >= 3 && seguidos(dias)) return cap(`${DIAS[dias[0]]} a ${DIAS[dias[dias.length - 1]]}`);
  return cap(lista(dias.map((x) => DIAS[x])));
}

function aMinutos(hora: string): number | null {
  const m = hora.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Las horas de cita en pocas palabras. Hasta 6, una a una: «10:00, 12:30, 17:00». Con más, los tramos
 * de paso fijo (al menos 3 horas) como «de A a B» y las sueltas como «a las HH:MM»:
 * «de 09:00 a 13:30 y de 16:00 a 19:30, cada 30 min». El texto se puede leer de vuelta a las mismas horas.
 */
export function resumenHoras(horas: string[]): string {
  const orden = [...new Set(horas)].sort();
  if (orden.length <= 6) return orden.join(", ");
  const minutos = orden.map((h) => aMinutos(h) ?? Number.NaN);
  const partes: { texto: string; paso?: number }[] = [];
  let i = 0;
  while (i < orden.length) {
    let fin = i;
    const paso = minutos[i + 1] - minutos[i];
    while (fin + 1 < orden.length && minutos[fin + 1] - minutos[fin] === paso) fin++;
    if (fin - i + 1 >= 3 && Number.isFinite(paso)) {
      partes.push({ texto: `de ${orden[i]} a ${orden[fin]}`, paso });
      i = fin + 1;
    } else {
      partes.push({ texto: `a las ${orden[i]}` });
      i++;
    }
  }
  const pasos = new Set(partes.flatMap((p) => (p.paso === undefined ? [] : [p.paso])));
  if (pasos.size <= 1) {
    const texto = lista(partes.map((p) => p.texto));
    return pasos.size === 1 ? `${texto}, cada ${[...pasos][0]} min` : texto;
  }
  return lista(partes.map((p) => (p.paso === undefined ? p.texto : `${p.texto}, cada ${p.paso} min`)));
}

/** «HH:MM» de `desde` a `hasta`, ambos incluidos, cada `cadaMin` minutos. */
export function generarHoras(desde: string, hasta: string, cadaMin: number): string[] {
  const inicio = aMinutos(desde);
  const fin = aMinutos(hasta);
  if (inicio === null || fin === null || inicio > fin || !Number.isFinite(cadaMin) || cadaMin <= 0) return [];
  const horas: string[] = [];
  for (let m = inicio; m <= fin; m += cadaMin) {
    horas.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return horas;
}

// ---- Cifras del panel ----

export function esHoy(ts: number, ahora: Date, zona: string = ZONA): boolean {
  return fechaEn(new Date(ts), zona).fecha === fechaEn(ahora, zona).fecha;
}

/**
 * Las columnas de la Agenda: el primer día abierto desde hoy marca la semana con la que empieza, y
 * se listan los días de la semana abiertos durante `semanas` semanas desde su lunes. Las fechas
 * cerradas se quedan: un día cerrado después de reservar sigue enseñando sus citas.
 */
export function diasDeAgenda(ahora: Date, r: ReglasAgenda = REGLAS_POR_DEFECTO, semanas = 2): string[] {
  const { fecha } = fechaEn(ahora, r.zona);
  let base: string | undefined;
  for (let k = 0; k < 7 && base === undefined; k++) {
    const dia = sumarDias(fecha, k);
    if (r.diasAbiertos.includes(diaSemana(dia))) base = dia;
  }
  if (base === undefined) return [];
  const lunes = lunesDe(base);
  const total = Math.max(0, Math.floor(semanas)) * 7;
  const dias: string[] = [];
  for (let n = 0; n < total; n++) {
    const dia = sumarDias(lunes, n);
    if (r.diasAbiertos.includes(diaSemana(dia))) dias.push(dia);
  }
  return dias;
}

/** Las citas de ahora a `dias` días vista, ambos incluidos: la cifra «próximos 7 días» del panel. */
export function citasProximas(reservas: Reserva[], ahora: Date, zona: string = ZONA, dias = 7): number {
  const { fecha, hora } = fechaEn(ahora, zona);
  const desde = `${fecha}T${hora}`;
  const limite = `${sumarDias(fecha, dias)}T23:59`;
  return reservas.filter((x) => x.huecoId >= desde && x.huecoId <= limite).length;
}

// ---- Revisión de las reglas ----

function fechaReal(fecha: unknown): fecha is string {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = aDiaUtc(fecha);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

function entero(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Lectura flexible de una hora: «9», «9:00», «09:00», «9.30», «17h30», «17h» → «HH:MM». */
function leerHora(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2})|h(\d{2})?)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? "0");
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function zonaValida(zona: unknown): zona is string {
  if (typeof zona !== "string" || !ZONAS_HORARIAS.some((z) => z.id === zona)) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

type Revision = { reglas: ReglasAgenda } | { error: string; campo: string };

/**
 * Revisa y normaliza unas reglas: parte de `actuales`, aplica los campos de `e` en orden (zona, horas,
 * días abiertos, cerrados, días a la vista, desde, antelación y corte) y devuelve las reglas o el
 * primer error. Lo que no viene se queda como estaba; nunca lanza.
 */
export function revisarReglas(e: unknown, actuales: ReglasAgenda = REGLAS_POR_DEFECTO): Revision {
  const reglas: ReglasAgenda = {
    ...actuales,
    horas: [...actuales.horas],
    diasAbiertos: [...actuales.diasAbiertos],
    cerrados: [...actuales.cerrados],
  };
  if (typeof e !== "object" || e === null || Array.isArray(e)) return { reglas };
  try {
    return aplicarReglas(e as Record<string, unknown>, reglas);
  } catch {
    return { reglas: { ...actuales, horas: [...actuales.horas], diasAbiertos: [...actuales.diasAbiertos], cerrados: [...actuales.cerrados] } };
  }
}

function aplicarReglas(x: Record<string, unknown>, reglas: ReglasAgenda): Revision {
  if (x.zona !== undefined) {
    if (!zonaValida(x.zona)) return { error: "Elige la zona horaria de la lista", campo: "zona" };
    reglas.zona = x.zona;
  }
  if (x.horas !== undefined) {
    if (!Array.isArray(x.horas)) return { error: "Las horas van como 10:00", campo: "horas" };
    if (x.horas.length === 0) return { error: "Pon al menos una hora de cita", campo: "horas" };
    const leidas = x.horas.map(leerHora);
    if (leidas.some((h) => h === null)) return { error: "Las horas van como 10:00", campo: "horas" };
    const horas = [...new Set(leidas as string[])].sort();
    if (horas.length > 48) return { error: "Caben 48 horas al día", campo: "horas" };
    reglas.horas = horas;
  }
  if (x.diasAbiertos !== undefined) {
    if (!Array.isArray(x.diasAbiertos) || x.diasAbiertos.length === 0 || x.diasAbiertos.some((d) => !entero(d, 0, 6))) {
      return { error: "Elige al menos un día abierto", campo: "diasAbiertos" };
    }
    reglas.diasAbiertos = [...new Set(x.diasAbiertos as number[])].sort((a, b) => a - b);
  }
  if (x.cerrados !== undefined) {
    if (!Array.isArray(x.cerrados) || x.cerrados.some((f) => !fechaReal(f))) return { error: "Esa fecha no existe", campo: "cerrados" };
    const hoy = fechaEn(new Date(), reglas.zona).fecha;
    const cerrados = [...new Set(x.cerrados as string[])].sort().filter((f) => f >= hoy);
    if (cerrados.length > 60) return { error: "Caben 60 días cerrados", campo: "cerrados" };
    reglas.cerrados = cerrados;
  }
  if (x.diasVista !== undefined) {
    if (!entero(x.diasVista, 1, 365)) return { error: "De 1 a 365 días", campo: "diasVista" };
    reglas.diasVista = x.diasVista;
  }
  if (x.desdeDias !== undefined) {
    if (!entero(x.desdeDias, 0, 30)) return { error: "De 0 a 30 días", campo: "desdeDias" };
    reglas.desdeDias = x.desdeDias;
  }
  if (x.antelacionMinutos !== undefined) {
    if (!entero(x.antelacionMinutos, 0, 10080)) return { error: "La antelación va de 0 a 7 días", campo: "antelacionMinutos" };
    reglas.antelacionMinutos = x.antelacionMinutos;
  }
  if (x.corteTarde !== undefined) {
    const corte = leerHora(x.corteTarde);
    if (corte === null) return { error: "Las horas van como 10:00", campo: "corteTarde" };
    reglas.corteTarde = corte;
  }
  return { reglas };
}
