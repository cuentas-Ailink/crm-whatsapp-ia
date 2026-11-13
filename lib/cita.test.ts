import { describe, expect, it } from "vitest";
import { REGLAS_POR_DEFECTO, textoHueco } from "./agenda";
import { etiquetaDia, revisarCita, textoCitaParaCliente } from "./cita";
import { crearLead } from "./negocio";
import { PRESETS } from "./presets";
import type { Hueco, Lead, ReglasAgenda, Reserva } from "./tipos";
import { VOCABULARIO_REFORMAS, type Vocabulario } from "./vocabulario";

// Lunes 2 nov 2026, 09:00 en Madrid (08:00 UTC). Con las reglas por defecto: de lunes a viernes,
// 10:00, 12:30 y 17:00, desde mañana y 60 días abiertos a la vista.
const LUNES = new Date("2026-11-02T08:00:00Z");
const reglas = (r: Partial<ReglasAgenda> = {}): ReglasAgenda => ({ ...REGLAS_POR_DEFECTO, ...r });
const hueco = (id: string): Hueco => ({ id, texto: textoHueco(id) });

const laura = crearLead({ telefono: "34612345678", perfilId: "p", perfilNombre: "Estudio de reformas", nombre: "Laura Martínez", origen: "whatsapp" });
const conCita = (lead: Lead, id: string): Lead => ({ ...lead, visita: hueco(id), estado: "visita" });
const reserva = (huecoId: string, leadId = "otro:p"): Reserva => ({ huecoId, texto: textoHueco(huecoId), leadId, nombre: "Otro", perfilNombre: "P" });

describe("revisarCita", () => {
  it("un id mal formado → «Elige un hueco»", () => {
    for (const id of ["", "mañana", "2026-11-03 10:00", "2026-11-03T10:00:00", "2026-11-3T10:00"]) {
      expect(revisarCita("dar", id, laura, [], LUNES, reglas())).toEqual({ error: "Elige un hueco" });
    }
    expect(revisarCita("dar", undefined as unknown as string, laura, [], LUNES, reglas())).toEqual({ error: "Elige un hueco" });
  });

  it("cambiar al mismo hueco que ya tiene", () => {
    const lead = conCita(laura, "2026-11-03T10:00");
    expect(revisarCita("cambiar", "2026-11-03T10:00", lead, [reserva("2026-11-03T10:00", lead.id)], LUNES, reglas())).toEqual({
      error: "Elige un hueco distinto del que ya tiene",
    });
  });

  it("un hueco pasado", () => {
    expect(revisarCita("dar", "2026-10-30T10:00", laura, [], LUNES, reglas())).toEqual({ error: "Ese hueco ya ha pasado" });
    // Hoy a las 09:00 en Madrid es justo ahora: tampoco.
    expect(revisarCita("dar", "2026-11-02T09:00", laura, [], LUNES, reglas({ horas: ["09:00"], desdeDias: 0 }))).toEqual({ error: "Ese hueco ya ha pasado" });
  });

  it("un hueco de otro cliente", () => {
    expect(revisarCita("dar", "2026-11-03T10:00", laura, [reserva("2026-11-03T10:00")], LUNES, reglas())).toEqual({ error: "Ese hueco ya está ocupado" });
  });

  it("al cambiar, su propia cita no le bloquea", () => {
    const lead = conCita(laura, "2026-11-03T10:00");
    const propias = [reserva("2026-11-03T10:00", lead.id)];
    expect(revisarCita("cambiar", "2026-11-03T12:30", lead, propias, LUNES, reglas())).toEqual({ hueco: hueco("2026-11-03T12:30") });
    // Con otra cita del mismo cliente en la rejilla, tampoco sale como ocupado.
    expect(revisarCita("dar", "2026-11-03T10:00", laura, [reserva("2026-11-03T10:00", laura.id)], LUNES, reglas())).toEqual({ hueco: hueco("2026-11-03T10:00") });
  });

  it("un día de la semana cerrado", () => {
    // Sábado 7 y domingo 8 de noviembre.
    expect(revisarCita("dar", "2026-11-07T10:00", laura, [], LUNES, reglas())).toEqual({ error: "Ese hueco está fuera de tu horario" });
    expect(revisarCita("dar", "2026-11-08T10:00", laura, [], LUNES, reglas())).toEqual({ error: "Ese hueco está fuera de tu horario" });
  });

  it("una hora fuera de la rejilla", () => {
    expect(revisarCita("dar", "2026-11-03T11:11", laura, [], LUNES, reglas())).toEqual({ error: "Ese hueco está fuera de tu horario" });
    expect(revisarCita("dar", "2026-11-03T25:00", laura, [], LUNES, reglas())).toEqual({ error: "Ese hueco está fuera de tu horario" });
  });

  it("una fecha cerrada", () => {
    expect(revisarCita("dar", "2026-11-04T10:00", laura, [], LUNES, reglas({ cerrados: ["2026-11-04"] }))).toEqual({ error: "Ese hueco está fuera de tu horario" });
  });

  it("más allá de los días a la vista", () => {
    const r = reglas({ diasVista: 3 });
    // Mar 3, mié 4 y jue 5: el viernes 6 ya no.
    expect(revisarCita("dar", "2026-11-05T17:00", laura, [], LUNES, r)).toEqual({ hueco: hueco("2026-11-05T17:00") });
    expect(revisarCita("dar", "2026-11-06T10:00", laura, [], LUNES, r)).toEqual({ error: "Ese hueco está fuera de tu horario" });
  });

  it("dentro de la antelación", () => {
    const r = reglas({ desdeDias: 0, antelacionMinutos: 120 });
    // Son las 09:00: las 10:00 de hoy caen dentro de las 2 h; las 12:30, no.
    expect(revisarCita("dar", "2026-11-02T10:00", laura, [], LUNES, r)).toEqual({ error: "Ese hueco está fuera de tu horario" });
    expect(revisarCita("dar", "2026-11-02T12:30", laura, [], LUNES, r)).toEqual({ hueco: hueco("2026-11-02T12:30") });
  });

  it("hoy, solo si las reglas lo dejan", () => {
    expect(revisarCita("dar", "2026-11-02T12:30", laura, [], LUNES, reglas())).toEqual({ error: "Ese hueco está fuera de tu horario" });
  });

  it("un hueco válido, con el texto de siempre", () => {
    const r = revisarCita("dar", "2026-11-03T10:00", laura, [reserva("2026-11-04T10:00")], LUNES, reglas());
    expect(r).toEqual({ hueco: { id: "2026-11-03T10:00", texto: "martes 3 nov a las 10:00" } });
    expect("hueco" in r && r.hueco.texto).toBe(textoHueco("2026-11-03T10:00"));
  });

  it("la rejilla de 30 minutos de la clínica, en todo su horizonte", () => {
    const clinica = PRESETS.clinica.calendario;
    expect(revisarCita("dar", "2026-11-02T13:30", laura, [], LUNES, clinica)).toEqual({ hueco: hueco("2026-11-02T13:30") });
    expect(revisarCita("dar", "2026-11-02T10:30", laura, [], LUNES, clinica)).toEqual({ error: "Ese hueco está fuera de tu horario" });
    expect(revisarCita("dar", "2026-11-02T14:00", laura, [], LUNES, clinica)).toEqual({ error: "Ese hueco está fuera de tu horario" });
    expect(revisarCita("dar", "2026-11-02T13:45", laura, [], LUNES, clinica)).toEqual({ error: "Ese hueco está fuera de tu horario" });
    // Día abierto número 40 (el último a la vista) a última hora: dentro, aunque haya cientos de huecos antes.
    expect(revisarCita("dar", "2026-12-25T19:30", laura, [], LUNES, clinica)).toEqual({ hueco: hueco("2026-12-25T19:30") });
    expect(revisarCita("dar", "2026-12-28T09:00", laura, [], LUNES, clinica)).toEqual({ error: "Ese hueco está fuera de tu horario" });
  });

  it("Ciudad de México cerca de la medianoche", () => {
    const r = reglas({ zona: "America/Mexico_City", horas: ["09:00", "23:30"], desdeDias: 0 });
    // Martes 3 nov a las 05:30 UTC = lunes 2 nov a las 23:30 en México (UTC−6): ese hueco ya ha pasado.
    const ahora = new Date("2026-11-03T05:30:00Z");
    expect(revisarCita("dar", "2026-11-02T23:30", laura, [], ahora, r)).toEqual({ error: "Ese hueco ya ha pasado" });
    // A las 09:00 del martes en México aún no se ha llegado, aunque en Madrid ya sea martes por la mañana.
    expect(revisarCita("dar", "2026-11-03T09:00", laura, [], ahora, r)).toEqual({ hueco: hueco("2026-11-03T09:00") });
    // Un minuto antes, el de las 23:30 del lunes aún se puede dar.
    expect(revisarCita("dar", "2026-11-02T23:30", laura, [], new Date("2026-11-03T05:29:00Z"), r)).toEqual({ hueco: hueco("2026-11-02T23:30") });
  });
});

describe("textoCitaParaCliente", () => {
  const h = hueco("2026-11-03T10:00");
  const TURNO: Vocabulario = { ...VOCABULARIO_REFORMAS, cita: { singular: "turno", plural: "turnos", genero: "m" } };

  it("reformas, de tú: la frase exacta", () => {
    expect(textoCitaParaCliente(h, { vocabulario: VOCABULARIO_REFORMAS, nombre: "Laura", trato: "tu" })).toBe(
      "Hola Laura, te confirmo la visita el martes 3 nov a las 10:00. Si necesitas cambiarla, escríbenos por aquí.",
    );
  });

  it("de usted", () => {
    expect(textoCitaParaCliente(h, { vocabulario: VOCABULARIO_REFORMAS, nombre: "Laura", trato: "usted" })).toBe(
      "Hola Laura, le confirmo la visita el martes 3 nov a las 10:00. Si necesita cambiarla, escríbanos por aquí.",
    );
  });

  it("la clínica dice cita", () => {
    expect(textoCitaParaCliente(h, { vocabulario: PRESETS.clinica.vocabulario, nombre: "Pedro", trato: "tu" })).toBe(
      "Hola Pedro, te confirmo la cita el martes 3 nov a las 10:00. Si necesitas cambiarla, escríbenos por aquí.",
    );
  });

  it("un sustantivo masculino concuerda", () => {
    expect(textoCitaParaCliente(h, { vocabulario: TURNO, nombre: "Pedro", trato: "tu" })).toBe(
      "Hola Pedro, te confirmo el turno el martes 3 nov a las 10:00. Si necesitas cambiarlo, escríbenos por aquí.",
    );
  });

  it("solo el nombre de pila", () => {
    expect(textoCitaParaCliente(h, { vocabulario: VOCABULARIO_REFORMAS, nombre: "  Laura Martínez Pérez ", trato: "tu" })).toMatch(/^Hola Laura, te confirmo/);
  });

  it("sin nombre (el teléfono enmascarado), sin saludo con el teléfono", () => {
    expect(textoCitaParaCliente(h, { vocabulario: VOCABULARIO_REFORMAS, nombre: "+34 6•• ••• •••", trato: "tu" })).toBe(
      "Hola, te confirmo la visita el martes 3 nov a las 10:00. Si necesitas cambiarla, escríbenos por aquí.",
    );
  });

  it("no promete nada más", () => {
    for (const vocabulario of [VOCABULARIO_REFORMAS, PRESETS.clinica.vocabulario, TURNO]) {
      for (const trato of ["tu", "usted"] as const) {
        const texto = textoCitaParaCliente(h, { vocabulario, nombre: "Laura", trato }).toLowerCase();
        for (const promesa of ["día antes", "recordatorio", "te avisaremos", "le avisaremos", "hoy mismo", "te llamaremos"]) {
          expect(texto).not.toContain(promesa);
        }
      }
    }
  });
});

describe("etiquetaDia", () => {
  it("hoy, mañana o el día", () => {
    expect(etiquetaDia("2026-11-11", "2026-11-11")).toBe("Hoy · miércoles 11 nov");
    expect(etiquetaDia("2026-11-12", "2026-11-11")).toBe("Mañana · jueves 12 nov");
    expect(etiquetaDia("2026-11-13", "2026-11-11")).toBe("viernes 13 nov");
    expect(etiquetaDia("2027-01-01", "2026-12-31")).toBe("Mañana · viernes 1 ene");
  });
});
