import { describe, expect, it } from "vitest";
import { baseDeCifras, citasDeHoy, citasHoyYManana, pendientes, resumenMes, teToca, ultimaLlegada } from "./inicio";
import { crearLead } from "./negocio";
import type { Bd, Lead, Mensaje, Reserva, Tarea } from "./tipos";
import { frases, VOCABULARIO_REFORMAS } from "./vocabulario";

// Miércoles 11 nov 2026, 10:00 en Madrid.
const AHORA = new Date("2026-11-11T09:00:00Z");
const T = AHORA.getTime();
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

let siguiente = 0;
function lead(campos: Partial<Lead> = {}): Lead {
  siguiente += 1;
  return crearLead({
    perfilId: "p",
    perfilNombre: "P",
    nombre: `Cliente ${siguiente}`,
    telefono: `3460000${String(siguiente).padStart(4, "0")}`,
    origen: "formulario",
    creadoEn: T - DIA,
    ...campos,
  });
}

function msg(de: Mensaje["de"], ts: number, extra: Partial<Mensaje> = {}): Mensaje {
  siguiente += 1;
  return { id: `m${siguiente}`, de, texto: "…", ts, ...extra };
}

function reserva(huecoId: string, leadId = "x", extra: Partial<Reserva> = {}): Reserva {
  return { huecoId, texto: huecoId, leadId, nombre: extra.nombre ?? "X", perfilNombre: "P", ...extra };
}

function bd(leads: Lead[], reservas: Reserva[] = [], extra: Partial<Bd> = {}): Bd {
  return { leads: Object.fromEntries(leads.map((l) => [l.id, l])), reservas, ajustes: { leadsPrueba: false }, proyectos: [], ...extra };
}

describe("baseDeCifras", () => {
  it("con solo ejemplos, usa los ejemplos y lo dice", () => {
    const a = lead({ ejemplo: true });
    const b = lead({ origen: "prueba" });
    const r = reserva("2026-11-12T10:00", a.id, { prueba: true });
    const base = baseDeCifras(bd([a, b], [r]));
    expect(base.ejemplo).toBe(true);
    expect(base.leads).toHaveLength(2);
    expect(base.reservas).toEqual([r]);
  });

  it("con un cliente de verdad, solo los de verdad, sin las reservas de ejemplo", () => {
    const real = lead();
    const ejemplo = lead({ ejemplo: true });
    const deVerdad = reserva("2026-11-12T10:00", real.id);
    const base = baseDeCifras(
      bd([real, ejemplo], [deVerdad, reserva("2026-11-12T12:30", ejemplo.id, { prueba: true }), reserva("2026-11-13T10:00", real.id, { prueba: true })]),
    );
    expect(base).toEqual({ leads: [real], reservas: [deVerdad], ejemplo: false });
  });
});

describe("ultimaLlegada", () => {
  it("el formulario mide el primer WhatsApp y WhatsApp la primera respuesta", () => {
    const form = lead({ nombre: "Laura Martínez", creadoEn: T - 2 * HORA, msPrimerWhatsApp: 1600 });
    expect(ultimaLlegada(bd([form]))).toEqual({ leadId: form.id, nombre: "Laura", canal: "formulario", ms: 1600, ts: form.creadoEn, ejemplo: false });
    const wa = lead({ nombre: "Raquel", origen: "whatsapp", creadoEn: T - HORA, msPrimeraRespuesta: 4200, msPrimerWhatsApp: 99 });
    expect(ultimaLlegada(bd([form, wa]))).toMatchObject({ leadId: wa.id, canal: "whatsapp", ms: 4200 });
  });

  it("gana la más reciente medida; sin medida no cuenta", () => {
    const vieja = lead({ creadoEn: T - 3 * HORA, msPrimerWhatsApp: 1000 });
    const sinMedida = lead({ creadoEn: T - HORA });
    const manual = lead({ origen: "manual", creadoEn: T - 2 * HORA, msPrimerWhatsApp: 2000 });
    expect(ultimaLlegada(bd([vieja, sinMedida, manual]))).toMatchObject({ leadId: manual.id, canal: "manual", ms: 2000 });
  });

  it("los de verdad antes que los ejemplos, y los `prueba` cuentan como formulario", () => {
    const ejemplo = lead({ origen: "prueba", creadoEn: T - MIN, msPrimerWhatsApp: 900 });
    expect(ultimaLlegada(bd([ejemplo]))).toMatchObject({ canal: "formulario", ejemplo: true });
    const real = lead({ creadoEn: T - DIA, msPrimerWhatsApp: 1200 });
    expect(ultimaLlegada(bd([ejemplo, real]))).toMatchObject({ leadId: real.id, ejemplo: false });
  });

  it("null cuando nada está medido", () => {
    expect(ultimaLlegada(bd([]))).toBeNull();
    expect(ultimaLlegada(bd([lead(), lead({ origen: "whatsapp", msPrimerWhatsApp: 10 })]))).toBeNull();
  });
});

describe("teToca", () => {
  const f = frases();

  it("sin contestar: el asistente debía contestar hace más de 2 minutos", () => {
    const espera = T - 7 * MIN;
    const l = lead({ estado: "conversacion", mensajes: [msg("agente", T - HORA), msg("cliente", espera), msg("cliente", T - 3 * MIN)] });
    expect(teToca(bd([l]), AHORA)).toEqual([
      { leadId: l.id, nombre: l.nombre, motivo: "sinContestar", texto: "Sin contestar · 7 min", desde: espera, ejemplo: false },
    ]);
  });

  it("el borde de los 2 minutos y «escribiendo» lo callan", () => {
    const justo = lead({ estado: "nuevo", mensajes: [msg("cliente", T - 2 * MIN)] });
    expect(teToca(bd([justo]), AHORA)).toEqual([]);
    const pasado = lead({ estado: "nuevo", mensajes: [msg("cliente", T - 2 * MIN - 1)] });
    expect(teToca(bd([pasado]), AHORA).map((r) => r.motivo)).toEqual(["sinContestar"]);
    expect(teToca(bd([pasado], [], { escribiendo: [pasado.id] }), AHORA)).toEqual([]);
  });

  it("con el asistente en pausa, «pausa» en vez de «sin contestar»", () => {
    const l = lead({ estado: "conversacion", mensajes: [msg("cliente", T - 30 * MIN)] });
    const [fila] = teToca(bd([l]), AHORA, { pausadoEn: T - HORA });
    expect(fila).toMatchObject({ motivo: "pausa", texto: "Asistente apagado · espera respuesta", desde: T - 30 * MIN });
  });

  it("pase: con su motivo, o «Te ha pedido hablar contigo» si no lo tiene", () => {
    const conMotivo = lead({ estado: "persona", motivoPersona: "Quiere hablar del precio", cambioEstadoEn: T - 20 * MIN, mensajes: [msg("cliente", T - 21 * MIN), msg("agente", T - 20 * MIN)] });
    const sinMotivo = lead({ estado: "persona", motivoPersona: "  ", cambioEstadoEn: T - 10 * MIN, mensajes: [] });
    expect(teToca(bd([conMotivo, sinMotivo]), AHORA)).toMatchObject([
      { leadId: conMotivo.id, motivo: "pase", texto: "Quiere hablar del precio", desde: T - 20 * MIN },
      { leadId: sinMotivo.id, motivo: "pase", texto: "Te ha pedido hablar contigo", desde: T - 10 * MIN },
    ]);
  });

  it("pase: si lo último lo has escrito tú no espera; si el cliente contesta, vuelve a esperar desde ese mensaje", () => {
    const pase = T - HORA;
    const contestado = lead({ estado: "persona", cambioEstadoEn: pase, mensajes: [msg("cliente", pase - MIN), msg("agente", T - 40 * MIN, { manual: true })] });
    expect(teToca(bd([contestado]), AHORA)).toEqual([]);
    const vuelve = lead({
      estado: "persona",
      cambioEstadoEn: pase,
      mensajes: [msg("agente", T - 40 * MIN, { manual: true }), msg("cliente", T - 15 * MIN), msg("cliente", T - 5 * MIN)],
    });
    expect(teToca(bd([vuelve]), AHORA)).toMatchObject([{ motivo: "pase", desde: T - 15 * MIN }]);
  });

  it("volvió a escribir después del cierre (y solo así salen los cerrados)", () => {
    const cierreEn = T - 2 * DIA;
    const volvio = lead({ estado: "visita", cierre: "si", cierreEn, mensajes: [msg("cliente", cierreEn - HORA), msg("cliente", T - 3 * HORA), msg("cliente", T - HORA)] });
    expect(teToca(bd([volvio]), AHORA)).toMatchObject([{ motivo: "volvio", texto: "Ha vuelto a escribir · hace 3 h", desde: T - 3 * HORA }]);
    const visto = { ...volvio, vueltaVistaEn: T - 30 * MIN };
    expect(teToca(bd([visto]), AHORA)).toEqual([]);
    // Cerrado, en «persona» y sin contestar: no sale si no ha vuelto a escribir.
    const cerrado = lead({ estado: "persona", cierre: "no", motivoCierre: "Precio", cierreEn: T - HORA, mensajes: [msg("cliente", T - 2 * HORA)], visita: { id: "2026-11-10T10:00", texto: "x" } });
    expect(teToca(bd([cerrado]), AHORA)).toEqual([]);
  });

  it("cita pasada sin decir cómo fue", () => {
    const l = lead({ estado: "visita", visita: { id: "2026-11-10T17:00", texto: "x" }, mensajes: [msg("agente", T - 2 * DIA)] });
    const [fila] = teToca(bd([l]), AHORA);
    expect(fila).toMatchObject({ motivo: "visitaPasada", texto: "¿Cómo fue la visita?", desde: Date.parse("2026-11-10T16:00:00Z") });
    const clinica = frases({ ...VOCABULARIO_REFORMAS, cita: { singular: "cita", plural: "citas", genero: "f" } });
    expect(teToca(bd([l]), AHORA, { frases: clinica })[0].texto).toBe("¿Cómo fue la cita?");
    const futura = lead({ estado: "visita", visita: { id: "2026-11-11T12:30", texto: "x" } });
    expect(teToca(bd([futura]), AHORA)).toEqual([]);
  });

  it("una fila por cliente, con el primer motivo que le toque", () => {
    // Sin contestar y con la cita pasada: gana «sin contestar».
    const l = lead({ estado: "visita", visita: { id: "2026-11-10T10:00", texto: "x" }, mensajes: [msg("cliente", T - 10 * MIN)] });
    expect(teToca(bd([l]), AHORA).map((r) => r.motivo)).toEqual(["sinContestar"]);
  });

  it("del que más espera al que menos, con los ejemplos marcados; el spam nunca", () => {
    const reciente = lead({ estado: "persona", cambioEstadoEn: T - 5 * MIN });
    const antiguo = lead({ estado: "persona", cambioEstadoEn: T - 2 * HORA, ejemplo: true });
    const spam = lead({ estado: "spam", mensajes: [msg("cliente", T - HORA)], visita: { id: "2026-11-10T10:00", texto: "x" } });
    expect(teToca(bd([reciente, antiguo, spam]), AHORA).map((r) => [r.leadId, r.ejemplo])).toEqual([
      [antiguo.id, true],
      [reciente.id, false],
    ]);
  });

  it("la pausa sale de la configuración si no se pasa", () => {
    const l = lead({ estado: "nuevo", mensajes: [msg("cliente", T - HORA)] });
    const conPausa = bd([l], [], { configuracion: { sistema: { asistente: { activo: false, pausadoEn: T - DIA, modelo: null } } } as Bd["configuracion"] });
    expect(teToca(conPausa, AHORA)[0].motivo).toBe("pausa");
  });

  it("las duraciones: minutos (al menos 1), horas y días", () => {
    const fila = (ms: number) => teToca(bd([lead({ estado: "nuevo", mensajes: [msg("cliente", T - ms)] })]), AHORA)[0].texto;
    expect(fila(59 * MIN)).toBe("Sin contestar · 59 min");
    expect(fila(90 * MIN)).toBe("Sin contestar · 2 h");
    expect(fila(23 * HORA)).toBe("Sin contestar · 23 h");
    expect(fila(3 * DIA)).toBe("Sin contestar · 3 d");
    expect(f.comoFue).toBe("¿Cómo fue la visita?");
  });
});

describe("citasHoyYManana", () => {
  it("las que quedan hoy y las de mañana, en orden, en la zona del negocio (cerca de medianoche)", () => {
    // 23:30 del 10 nov en Ciudad de México = 05:30 UTC del 11.
    const ahora = new Date("2026-11-11T05:30:00Z");
    const zona = "America/Mexico_City";
    const ejemplo = lead({ ejemplo: true });
    const datos = bd(
      [ejemplo],
      [
        reserva("2026-11-11T10:00", "a", { nombre: "Mañana" }),
        reserva("2026-11-10T23:45", "b", { nombre: "Ahora" }),
        reserva("2026-11-10T18:00", "c", { nombre: "Pasada" }),
        reserva("2026-11-12T10:00", "d", { nombre: "Pasado mañana" }),
        reserva("2026-11-11T09:00", ejemplo.id, { nombre: "Ejemplo" }),
        reserva("2026-11-11T12:00", "e", { nombre: "Prueba", prueba: true }),
      ],
    );
    expect(citasHoyYManana(datos, ahora, zona)).toEqual([
      { dia: "hoy", hora: "23:45", leadId: "b", nombre: "Ahora", ejemplo: false },
      { dia: "manana", hora: "09:00", leadId: ejemplo.id, nombre: "Ejemplo", ejemplo: true },
      { dia: "manana", hora: "10:00", leadId: "a", nombre: "Mañana", ejemplo: false },
      { dia: "manana", hora: "12:00", leadId: "e", nombre: "Prueba", ejemplo: true },
    ]);
  });
});

describe("pendientes", () => {
  it("lo de hoy y lo atrasado sin hacer, primero lo atrasado; ni sin fecha ni hecho", () => {
    const tarea = (id: string, vence: string | undefined, hecha = false): Tarea => ({ id, texto: id, vence, hecha, ts: T });
    const bea = lead({ nombre: "Bea", tareas: [tarea("hoy-bea", "2026-11-11"), tarea("hecha", "2026-11-09", true), tarea("sin", undefined)] });
    const ana = lead({ nombre: "Ana", tareas: [tarea("hoy-ana", "2026-11-11"), tarea("atrasada", "2026-11-09"), tarea("futura", "2026-11-12")] });
    const filas = pendientes(bd([bea, ana]), AHORA);
    expect(filas.map((p) => [p.tarea.id, p.nombre, p.atrasada])).toEqual([
      ["atrasada", "Ana", true],
      ["hoy-ana", "Ana", false],
      ["hoy-bea", "Bea", false],
    ]);
  });
});

describe("resumenMes", () => {
  it("el mes de calendario en la zona, sin el spam en los nuevos", () => {
    const zona = "America/Mexico_City";
    // 1 nov 03:00 UTC = 31 oct 21:00 en México: es de octubre allí.
    const octubre = lead({ creadoEn: Date.parse("2026-11-01T03:00:00Z"), msPrimerWhatsApp: 99_000 });
    const nov = lead({ creadoEn: Date.parse("2026-11-02T12:00:00Z"), visita: { id: "2026-11-05T10:00", texto: "x" }, msPrimerWhatsApp: 1000 });
    const wa = lead({ origen: "whatsapp", creadoEn: Date.parse("2026-11-03T12:00:00Z"), msPrimeraRespuesta: 3000 });
    const spam = lead({ estado: "spam", creadoEn: Date.parse("2026-11-04T12:00:00Z") });
    const r = resumenMes(bd([octubre, nov, wa, spam]), AHORA, zona);
    expect(r).toEqual({ ejemplo: false, nuevos: 2, conCita: 1, si: 0, importeSi: 0, conversion: null, medianaPrimerWhatsAppMs: 2000 });
  });

  it("los «sí» y la conversión van por la fecha del cierre", () => {
    const creado = T - 40 * DIA;
    const si1 = lead({ creadoEn: creado, cierre: "si", cierreEn: T - DIA, presupuesto: 5200 });
    const si2 = lead({ creadoEn: creado, cierre: "si", cierreEn: T - 2 * DIA, presupuesto: 800 });
    const no = lead({ creadoEn: creado, cierre: "no", motivoCierre: "Precio", cierreEn: T - DIA });
    const siViejo = lead({ creadoEn: creado, cierre: "si", cierreEn: T - 20 * DIA, presupuesto: 9999 });
    const r = resumenMes(bd([si1, si2, no, siViejo]), AHORA);
    expect(r).toMatchObject({ nuevos: 0, si: 2, importeSi: 6000, conversion: 67, medianaPrimerWhatsAppMs: null });
  });

  it("la mediana de las dos medidas y la base de ejemplo", () => {
    const leads = [1000, 4000, 2000].map((ms) => lead({ ejemplo: true, creadoEn: T - HORA, msPrimerWhatsApp: ms }));
    expect(resumenMes(bd(leads), AHORA)).toMatchObject({ ejemplo: true, nuevos: 3, medianaPrimerWhatsAppMs: 2000 });
  });
});

describe("citasDeHoy", () => {
  it("todas las de hoy en la zona, también las pasadas y los ejemplos", () => {
    const datos = bd([], [reserva("2026-11-11T08:00"), reserva("2026-11-11T17:00", "x", { prueba: true }), reserva("2026-11-12T10:00"), reserva("2026-11-10T17:00")]);
    expect(citasDeHoy(datos, AHORA)).toBe(2);
    // A las 05:00 UTC del 11, en Ciudad de México son las 23:00 del 10: hoy es el 10.
    expect(citasDeHoy(datos, new Date("2026-11-11T05:00:00Z"), "America/Mexico_City")).toBe(1);
  });
});
