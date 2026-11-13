import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buscarHuecos,
  citasProximas,
  diasAbiertos,
  diasDeAgenda,
  encaja,
  fechaCorta,
  generarHoras,
  huecoLibre,
  huecosLibres,
  lugarDeZona,
  momentoDeHueco,
  momentoMinimo,
  REGLAS_POR_DEFECTO,
  resumenHoras,
  revisarReglas,
  textoAhora,
  textoDiasAbiertos,
  textoDiasCabecera,
  verHuecos,
} from "./agenda";
import type { ReglasAgenda, Reserva } from "./tipos";

// Lunes 2 nov 2026, 10:00 en Madrid.
const LUNES = new Date("2026-11-02T09:00:00Z");
const CITA = { singular: "cita", plural: "citas", genero: "f" as const };

const reglas = (cambios: Partial<ReglasAgenda>): ReglasAgenda => ({ ...REGLAS_POR_DEFECTO, ...cambios });

const reserva = (huecoId: string, leadId = "otro"): Reserva => ({ huecoId, texto: huecoId, leadId, nombre: "X", perfilNombre: "Y" });

const textos = (h: { texto: string }[]) => h.map((x) => x.texto);

describe("sin reglas, lo de siempre", () => {
  it("martes 10:00 y miércoles 17:00", () => {
    expect(textos(verHuecos([], LUNES))).toEqual(["martes 3 nov a las 10:00", "miércoles 4 nov a las 17:00"]);
    expect(verHuecos([], LUNES, REGLAS_POR_DEFECTO)).toEqual(verHuecos([], LUNES));
  });

  it("la nota de una hora fuera de la rejilla es la de hoy, palabra por palabra", () => {
    expect(buscarHuecos([], LUNES, { hora: "19:00" }).nota).toBe(
      "Las visitas solo son a las 10:00, 12:30, 17:00, de lunes a viernes. Estos son los más próximos: ofrécelos tal cual.",
    );
  });

  it("huecoLibre sin reglas acepta un id futuro fuera de la rejilla, como hoy", () => {
    expect(huecoLibre("2026-11-07T11:15", [], LUNES)).toBe(true);
    expect(huecoLibre("2026-11-02T09:00", [], LUNES)).toBe(false);
  });

  it("la agenda tiene 10 días", () => {
    expect(diasDeAgenda(LUNES)).toHaveLength(10);
  });
});

describe("clínica", () => {
  const CLINICA = reglas({
    horas: [...generarHoras("09:00", "13:30", 30), ...generarHoras("16:00", "19:30", 30)],
    desdeDias: 0,
    antelacionMinutos: 120,
    diasVista: 40,
  });
  // Martes 3 nov 2026, 08:15 en Madrid.
  const MARTES = new Date("2026-11-03T07:15:00Z");

  it("hoy mismo con dos horas de antelación, y la tarde del día siguiente", () => {
    expect(textos(verHuecos([], MARTES, CLINICA))).toEqual(["martes 3 nov a las 10:30", "miércoles 4 nov a las 16:00"]);
  });

  it("una cita a las 10:30 mueve A a las 11:00", () => {
    expect(verHuecos([reserva("2026-11-03T10:30")], MARTES, CLINICA)[0].texto).toBe("martes 3 nov a las 11:00");
  });

  it("la nota de una hora fuera de la rejilla resume las horas", () => {
    expect(buscarHuecos([], MARTES, { hora: "8" }, CLINICA, CITA).nota).toBe(
      "Las citas solo son de 09:00 a 13:30 y de 16:00 a 19:30, cada 30 min, de lunes a viernes. Estos son los más próximos: ofrécelos tal cual.",
    );
  });
});

describe("otras reglas", () => {
  it("de lunes a sábado, desde el viernes por la tarde", () => {
    const viernes = new Date("2026-11-06T16:00:00Z");
    expect(textos(verHuecos([], viernes, reglas({ diasAbiertos: [1, 2, 3, 4, 5, 6] })))).toEqual([
      "sábado 7 nov a las 10:00",
      "lunes 9 nov a las 17:00",
    ]);
  });

  it("solo mañanas: B es el primero de un día posterior", () => {
    expect(textos(verHuecos([], LUNES, reglas({ horas: ["10:00", "12:30"] })))).toEqual([
      "martes 3 nov a las 10:00",
      "miércoles 4 nov a las 10:00",
    ]);
  });

  it("una hora y un día abierto: dos miércoles", () => {
    expect(textos(verHuecos([], LUNES, reglas({ horas: ["10:00"], diasAbiertos: [3] })))).toEqual([
      "miércoles 4 nov a las 10:00",
      "miércoles 11 nov a las 10:00",
    ]);
  });

  it("sin ningún día abierto, nada y sin colgarse", () => {
    const sinDias = reglas({ diasAbiertos: [], diasVista: 365 });
    const inicio = Date.now();
    expect(verHuecos([], LUNES, sinDias)).toEqual([]);
    expect(diasAbiertos("2026-11-02", 365, sinDias)).toEqual([]);
    expect(huecosLibres([], LUNES, sinDias)).toEqual([]);
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });

  it("encaja: día abierto, fecha no cerrada y hora de la rejilla", () => {
    const r = reglas({ diasAbiertos: [1, 2, 3, 4, 5, 6], cerrados: ["2026-11-10"] });
    expect(encaja("2026-11-07T10:00", r)).toBe(true);
    expect(encaja("2026-11-08T10:00", r)).toBe(false);
    expect(encaja("2026-11-07T11:00", r)).toBe(false);
    expect(encaja("2026-11-10T10:00", r)).toBe(false);
    expect(encaja("2026-02-30T10:00", r)).toBe(false);
    expect(encaja("mañana", r)).toBe(false);
    expect(encaja("2026-11-07T10:00")).toBe(false);
    expect(encaja("2026-11-06T17:00")).toBe(true);
  });

  it("momentoMinimo suma la antelación en la zona", () => {
    expect(momentoMinimo(LUNES)).toBe("2026-11-02T10:00");
    expect(momentoMinimo(LUNES, reglas({ antelacionMinutos: 90 }))).toBe("2026-11-02T11:30");
    expect(momentoMinimo(LUNES, reglas({ zona: "America/Mexico_City" }))).toBe("2026-11-02T03:00");
  });

  it("huecoLibre con reglas respeta la antelación, los días y las horas", () => {
    const r = reglas({ desdeDias: 0, antelacionMinutos: 120 });
    expect(huecoLibre("2026-11-02T12:30", [], LUNES, undefined, r)).toBe(true);
    expect(huecoLibre("2026-11-02T12:30", [], LUNES, undefined, reglas({ antelacionMinutos: 180 }))).toBe(false);
    expect(huecoLibre("2026-11-07T10:00", [], LUNES, undefined, r)).toBe(false);
    expect(huecoLibre("2026-11-03T11:15", [], LUNES, undefined, r)).toBe(false);
    expect(huecoLibre("2026-11-03T10:00", [reserva("2026-11-03T10:00")], LUNES, undefined, r)).toBe(false);
    expect(huecoLibre("2026-11-03T10:00", [reserva("2026-11-03T10:00", "yo")], LUNES, "yo", r)).toBe(true);
  });
});

describe("zonas", () => {
  it("Ciudad de México: aún es martes 10 de noviembre", () => {
    const ahora = new Date("2026-11-11T05:30:00Z");
    const r = reglas({ zona: "America/Mexico_City" });
    expect(verHuecos([], ahora, r)[0].texto).toBe("miércoles 11 nov a las 10:00");
    expect(textoAhora(ahora, "America/Mexico_City")).toBe("martes 10 de noviembre de 2026, 23:30");
    expect(textoAhora(ahora)).toBe("miércoles 11 de noviembre de 2026, 06:30");
    expect(lugarDeZona("America/Mexico_City")).toBe("Ciudad de México");
  });

  it("Santiago: sábado 19:00 y el lunes ya en horario de verano", () => {
    const ahora = new Date("2026-09-05T23:00:00Z");
    const r = reglas({ zona: "America/Santiago" });
    const [a] = verHuecos([], ahora, r);
    expect(a.texto).toBe("lunes 7 sep a las 10:00");
    expect(new Date(momentoDeHueco(a.id, "America/Santiago")).toISOString()).toBe("2026-09-07T13:00:00.000Z");
    expect(textoAhora(ahora, "America/Santiago")).toBe("sábado 5 de septiembre de 2026, 19:00");
    expect(lugarDeZona("America/Santiago")).toBe("Santiago de Chile");
  });

  it("lugarDeZona: Madrid por defecto y, fuera de la lista, el último tramo", () => {
    expect(lugarDeZona()).toBe("Madrid");
    expect(lugarDeZona("America/Bogota")).toBe("Bogotá");
    expect(lugarDeZona("America/Port_of_Spain")).toBe("Port of Spain");
  });
});

describe("notas", () => {
  const MIERCOLES = reglas({ horas: ["10:00"], diasAbiertos: [3], diasVista: 2 });

  it("sin ningún hueco libre: ni uno, y a una persona", () => {
    const reservas = [reserva("2026-11-04T10:00"), reserva("2026-11-11T10:00")];
    const nota =
      "No quedan huecos libres en los próximos 2 días. No propongas ninguno: usa pasar_a_persona y dile que un compañero le escribe en cuanto pueda para buscar fecha.";
    expect(buscarHuecos(reservas, LUNES, {}, MIERCOLES)).toEqual({ huecos: [], nota });
    expect(buscarHuecos(reservas, LUNES, { dia: "jueves" }, MIERCOLES)).toEqual({ huecos: [], nota });
    expect(verHuecos(reservas, LUNES, MIERCOLES)).toEqual([]);
  });

  it("un solo hueco libre: se ofrece solo ese", () => {
    const reservas = [reserva("2026-11-04T10:00")];
    expect(buscarHuecos(reservas, LUNES, {}, MIERCOLES)).toEqual({
      huecos: [{ id: "2026-11-11T10:00", texto: "miércoles 11 nov a las 10:00" }],
      nota: "Solo queda este hueco: ofrécelo solo a él.",
    });
    expect(buscarHuecos(reservas, LUNES, { hora: "19:00" }, MIERCOLES).nota).toBe(
      "Las visitas solo son a las 10:00, los miércoles. Estos son los más próximos: ofrécelos tal cual. Solo queda este hueco: ofrécelo solo a él.",
    );
  });

  it("una búsqueda de día y hora que da un hueco no lleva nota", () => {
    const resultado = buscarHuecos([], LUNES, { dia: "2026-11-05", hora: "17:00" });
    expect(resultado.huecos.map((h) => h.id)).toEqual(["2026-11-05T17:00"]);
    expect(resultado.nota).toBeUndefined();
  });
});

describe("huecosLibres", () => {
  // Martes 3 nov 2026, 08:15 en Madrid: con 2 h de antelación, nada antes de las 10:15.
  const MARTES = new Date("2026-11-03T07:15:00Z");
  const R = reglas({ horas: ["17:00", "09:00", "10:00"], cerrados: ["2026-11-05"], desdeDias: 0, antelacionMinutos: 120, diasVista: 5 });
  const reservas = [reserva("2026-11-03T17:00"), reserva("2026-11-06T10:00")];

  it("en orden y sin huecos ocupados, pasados, dentro de la antelación ni en días cerrados", () => {
    const ids = huecosLibres(reservas, MARTES, R, 100).map((h) => h.id);
    expect(ids).toEqual([
      "2026-11-04T09:00", "2026-11-04T10:00", "2026-11-04T17:00",
      "2026-11-06T09:00", "2026-11-06T17:00",
      "2026-11-09T09:00", "2026-11-09T10:00", "2026-11-09T17:00",
      "2026-11-10T09:00", "2026-11-10T10:00", "2026-11-10T17:00",
    ]);
    expect([...ids].sort()).toEqual(ids);
    expect(huecosLibres(reservas, MARTES, R)[0]).toEqual({ id: "2026-11-04T09:00", texto: "miércoles 4 nov a las 09:00" });
  });

  it("un hueco pasado de hoy no sale", () => {
    const mediodia = new Date("2026-11-03T11:00:00Z");
    const ids = huecosLibres([], mediodia, reglas({ desdeDias: 0 })).map((h) => h.id);
    expect(ids.slice(0, 2)).toEqual(["2026-11-03T12:30", "2026-11-03T17:00"]);
  });

  it("max corta huecos, no días", () => {
    expect(huecosLibres(reservas, MARTES, R, 4).map((h) => h.id)).toEqual([
      "2026-11-04T09:00", "2026-11-04T10:00", "2026-11-04T17:00", "2026-11-06T09:00",
    ]);
    expect(huecosLibres(reservas, MARTES, R, 2.7)).toHaveLength(2);
    expect(huecosLibres(reservas, MARTES, R, 0)).toEqual([]);
    expect(huecosLibres(reservas, MARTES, R, -3)).toEqual([]);
  });

  it("sin reglas, los 60 primeros de siempre", () => {
    const lista = huecosLibres([], LUNES);
    expect(lista).toHaveLength(60);
    expect(lista[0].id).toBe("2026-11-03T10:00");
  });

  it("nunca lanza", () => {
    expect(huecosLibres([], new Date(Number.NaN))).toEqual([]);
  });
});

describe("fechaCorta", () => {
  // Miércoles 11 nov 2026, 10:00 en Madrid.
  const AHORA = new Date("2026-11-11T09:00:00Z");
  const en = (iso: string, zona?: string) => fechaCorta(Date.parse(iso), AHORA, zona);

  it("hoy, mañana, ayer, la semana y más allá", () => {
    expect(en("2026-11-11T10:30:00Z")).toBe("Hoy, 11:30");
    expect(en("2026-11-12T09:00:00Z")).toBe("Mañana, 10:00");
    expect(en("2026-11-10T17:40:00Z")).toBe("Ayer, 18:40");
    expect(en("2026-11-13T11:30:00Z")).toBe("vie 13, 12:30");
    expect(en("2026-11-17T09:00:00Z")).toBe("mar 17, 10:00");
    expect(en("2026-11-18T09:00:00Z")).toBe("18 nov, 10:00");
    expect(en("2026-11-05T09:00:00Z")).toBe("jue 5, 10:00");
    expect(en("2026-11-04T09:00:00Z")).toBe("4 nov, 10:00");
    expect(en("2025-11-21T10:00:00Z")).toBe("21 nov 2025, 11:00");
  });

  it("en la zona del negocio", () => {
    const ahora = new Date("2026-11-11T05:30:00Z");
    const ts = Date.parse("2026-11-11T06:30:00Z");
    expect(fechaCorta(ts, ahora, "America/Mexico_City")).toBe("Mañana, 00:30");
    expect(fechaCorta(ts, ahora)).toBe("Hoy, 07:30");
    expect(fechaCorta(Date.parse("2026-09-06T13:00:00Z"), new Date("2026-09-05T23:00:00Z"), "America/Santiago")).toBe("Mañana, 10:00");
  });

  it("sin número, nada", () => {
    expect(fechaCorta(Number.NaN, AHORA)).toBe("");
    expect(fechaCorta(Number.POSITIVE_INFINITY, AHORA)).toBe("");
  });
});

describe("momentoDeHueco", () => {
  const iso = (id: string, zona?: string) => new Date(momentoDeHueco(id, zona)).toISOString();

  it("los valores esperados, con los cambios de hora", () => {
    expect(iso("2026-11-11T10:00")).toBe("2026-11-11T09:00:00.000Z");
    expect(iso("2026-09-07T10:00", "America/Santiago")).toBe("2026-09-07T13:00:00.000Z");
    expect(iso("2026-09-04T10:00", "America/Santiago")).toBe("2026-09-04T14:00:00.000Z");
    expect(iso("2026-09-06T00:30", "America/Santiago")).toBe("2026-09-06T04:30:00.000Z");
    expect(iso("2026-04-04T23:30", "America/Santiago")).toBe("2026-04-05T02:30:00.000Z");
    expect(iso("2026-03-29T02:30")).toBe("2026-03-29T01:30:00.000Z");
    expect(iso("2026-10-25T02:30")).toBe("2026-10-25T00:30:00.000Z");
    expect(iso("2026-11-11T00:30", "America/Mexico_City")).toBe("2026-11-11T06:30:00.000Z");
  });

  it("un id mal formado da NaN", () => {
    expect(momentoDeHueco("2026-11-11 10:00")).toBeNaN();
    expect(momentoDeHueco("2026-02-30T10:00")).toBeNaN();
    expect(momentoDeHueco("2026-11-11T25:00")).toBeNaN();
    expect(momentoDeHueco("")).toBeNaN();
  });
});

describe("agenda", () => {
  it("diasDeAgenda: 10, 12 y 6 columnas", () => {
    expect(diasDeAgenda(LUNES)).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
    ]);
    // Sábado: empieza la semana siguiente.
    expect(diasDeAgenda(new Date("2026-11-07T10:00:00Z"))[0]).toBe("2026-11-09");
    const lunesASabado = diasDeAgenda(LUNES, reglas({ diasAbiertos: [1, 2, 3, 4, 5, 6] }));
    expect(lunesASabado).toHaveLength(12);
    expect(lunesASabado[5]).toBe("2026-11-07");
    expect(diasDeAgenda(LUNES, reglas({ diasAbiertos: [1, 3, 5] }))).toEqual([
      "2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13",
    ]);
    expect(diasDeAgenda(LUNES, REGLAS_POR_DEFECTO, 3)).toHaveLength(15);
  });

  it("una fecha cerrada sigue en la agenda", () => {
    expect(diasDeAgenda(LUNES, reglas({ cerrados: ["2026-11-04"] }))).toContain("2026-11-04");
  });

  it("citasProximas cuenta desde ahora hasta el día 7", () => {
    // Miércoles 11 nov 2026, 10:00 en Madrid.
    const ahora = new Date("2026-11-11T09:00:00Z");
    expect(citasProximas([reserva("2026-11-11T09:30")], ahora)).toBe(0);
    expect(citasProximas([reserva("2026-11-11T12:30")], ahora)).toBe(1);
    expect(citasProximas([reserva("2026-11-18T17:00")], ahora)).toBe(1);
    expect(citasProximas([reserva("2026-11-19T10:00")], ahora)).toBe(0);
    expect(
      citasProximas([reserva("2026-11-11T09:30"), reserva("2026-11-11T12:30"), reserva("2026-11-18T17:00"), reserva("2026-11-19T10:00")], ahora),
    ).toBe(2);
  });
});

/** Lee el texto de `resumenHoras` de vuelta a las horas. */
function leerResumen(texto: string): string[] {
  if (!/de |a las /.test(texto)) return texto.split(", ");
  const pasoFinal = texto.match(/, cada (\d+) min$/);
  const horas: string[] = [];
  const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  const hora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  for (const m of texto.matchAll(/de (\d\d:\d\d) a (\d\d:\d\d)(?:, cada (\d+) min)?|a las (\d\d:\d\d)/g)) {
    if (m[4]) {
      horas.push(m[4]);
      continue;
    }
    const paso = Number(m[3] ?? pasoFinal?.[1]);
    for (let t = minutos(m[1]); t <= minutos(m[2]); t += paso) horas.push(hora(t));
  }
  return horas;
}

/** Números pseudoaleatorios entre 0 y 1 a partir de una semilla fija (mulberry32). */
function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("resumenHoras", () => {
  it("hasta 6 horas, una a una", () => {
    expect(resumenHoras(["17:00", "10:00", "12:30", "10:00"])).toBe("10:00, 12:30, 17:00");
  });

  it("dos tramos con el mismo paso", () => {
    const horas = [...generarHoras("09:00", "13:30", 30), ...generarHoras("16:00", "19:30", 30)];
    expect(resumenHoras(horas)).toBe("de 09:00 a 13:30 y de 16:00 a 19:30, cada 30 min");
  });

  it("dos tramos con pasos distintos", () => {
    const horas = [...generarHoras("09:00", "10:00", 30), ...generarHoras("16:00", "19:00", 60)];
    expect(resumenHoras(horas)).toBe("de 09:00 a 10:00, cada 30 min y de 16:00 a 19:00, cada 60 min");
  });

  it("horas sueltas", () => {
    expect(resumenHoras(["08:00", "09:00", "10:00", "11:00", "13:15", "20:00", "21:30"])).toBe(
      "de 08:00 a 11:00, a las 13:15, a las 20:00 y a las 21:30, cada 60 min",
    );
    expect(resumenHoras(["01:00", "02:00", "04:00", "07:00", "11:00", "16:00", "22:00"])).toBe(
      "a las 01:00, a las 02:00, a las 04:00, a las 07:00, a las 11:00, a las 16:00 y a las 22:00",
    );
  });

  it("ida y vuelta en 2.000 rejillas al azar", () => {
    const azar = generador(7);
    const entero = (n: number) => Math.floor(azar() * n);
    const hora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    for (let i = 0; i < 2000; i++) {
      const total = 1 + entero(48);
      const conjunto = new Set<string>();
      while (conjunto.size < total) {
        if (azar() < 0.5) {
          const paso = [5, 10, 15, 20, 30, 45, 60, 90, 120][entero(9)];
          const inicio = entero(24 * 60);
          for (let k = 0, largo = 1 + entero(10); k < largo && inicio + k * paso < 24 * 60 && conjunto.size < total; k++) {
            conjunto.add(hora(inicio + k * paso));
          }
        } else {
          conjunto.add(hora(entero(24 * 60)));
        }
      }
      const horas = [...conjunto].sort();
      expect(leerResumen(resumenHoras(horas))).toEqual(horas);
    }
  });
});

describe("revisarReglas", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const error = (e: unknown, actuales?: ReglasAgenda) => {
    const r = revisarReglas(e, actuales);
    return "error" in r ? r : { error: "", campo: "" };
  };
  const ok = (e: unknown, actuales?: ReglasAgenda): ReglasAgenda => {
    const r = revisarReglas(e, actuales);
    if (!("reglas" in r)) throw new Error(r.error);
    return r.reglas;
  };

  it("sin cambios, las de ahora; las claves desconocidas no cuentan", () => {
    expect(ok({})).toEqual(REGLAS_POR_DEFECTO);
    expect(ok({ otra: 1 })).toEqual(REGLAS_POR_DEFECTO);
    for (const raro of [null, undefined, "x", 3, [1, 2]]) expect(ok(raro)).toEqual(REGLAS_POR_DEFECTO);
    const mias = reglas({ diasVista: 10 });
    expect(ok("x", mias)).toEqual(mias);
  });

  it("zona", () => {
    expect(ok({ zona: "America/Bogota" }).zona).toBe("America/Bogota");
    expect(error({ zona: "Europe/Paris" })).toEqual({ error: "Elige la zona horaria de la lista", campo: "zona" });
    expect(error({ zona: 3 })).toEqual({ error: "Elige la zona horaria de la lista", campo: "zona" });
  });

  it("horas: lectura flexible, en orden y sin repetir", () => {
    expect(ok({ horas: ["17h", "9", "9:00", "09:00", "9.30", "17h30"] }).horas).toEqual(["09:00", "09:30", "17:00", "17:30"]);
    expect(error({ horas: [] })).toEqual({ error: "Pon al menos una hora de cita", campo: "horas" });
    const muchas = generarHoras("00:00", "23:59", 29);
    expect(muchas.length).toBe(50);
    expect(error({ horas: muchas })).toEqual({ error: "Caben 48 horas al día", campo: "horas" });
    expect(ok({ horas: Array(60).fill("10:00") }).horas).toEqual(["10:00"]);
    for (const mala of ["24:00", "9:60", "nueve", "9:", 9, "10:000"]) {
      expect(error({ horas: [mala] })).toEqual({ error: "Las horas van como 10:00", campo: "horas" });
    }
    expect(error({ horas: "10:00" })).toEqual({ error: "Las horas van como 10:00", campo: "horas" });
  });

  it("días abiertos", () => {
    expect(ok({ diasAbiertos: [5, 1, 3, 1] }).diasAbiertos).toEqual([1, 3, 5]);
    for (const malo of [[], [7], [1.5], ["1"], "1"]) {
      expect(error({ diasAbiertos: malo })).toEqual({ error: "Elige al menos un día abierto", campo: "diasAbiertos" });
    }
  });

  it("cerrados: fechas reales, en orden, sin repetir y sin las pasadas", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T09:00:00Z"));
    expect(ok({ cerrados: ["2026-12-25", "2026-11-10", "2026-11-11", "2026-12-25"] }).cerrados).toEqual(["2026-11-11", "2026-12-25"]);
    expect(error({ cerrados: ["2026-02-30"] })).toEqual({ error: "Esa fecha no existe", campo: "cerrados" });
    expect(error({ cerrados: ["25/12/2026"] })).toEqual({ error: "Esa fecha no existe", campo: "cerrados" });
    const futuras = Array.from({ length: 61 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
    expect(error({ cerrados: futuras })).toEqual({ error: "Caben 60 días cerrados", campo: "cerrados" });
    expect(ok({ cerrados: ["2026-01-01", ...futuras.slice(0, 60)] }).cerrados).toHaveLength(60);
  });

  it("cerrados: «hoy» es el de la zona de las reglas", () => {
    vi.useFakeTimers();
    // Las 03:00 en UTC: en Madrid ya es día 11; en Ciudad de México, aún día 10.
    vi.setSystemTime(new Date("2026-11-11T03:00:00Z"));
    expect(ok({ cerrados: ["2026-11-10"] }).cerrados).toEqual([]);
    expect(ok({ zona: "America/Mexico_City", cerrados: ["2026-11-10"] }).cerrados).toEqual(["2026-11-10"]);
  });

  it("los números", () => {
    expect(ok({ diasVista: 365, desdeDias: 0, antelacionMinutos: 10080 })).toMatchObject({ diasVista: 365, desdeDias: 0, antelacionMinutos: 10080 });
    for (const malo of [0, 366, 1.5, "10"]) expect(error({ diasVista: malo })).toEqual({ error: "De 1 a 365 días", campo: "diasVista" });
    for (const malo of [-1, 31, 0.5]) expect(error({ desdeDias: malo })).toEqual({ error: "De 0 a 30 días", campo: "desdeDias" });
    for (const malo of [-1, 10081, 2.5]) {
      expect(error({ antelacionMinutos: malo })).toEqual({ error: "La antelación va de 0 a 7 días", campo: "antelacionMinutos" });
    }
  });

  it("corte de la tarde", () => {
    expect(ok({ corteTarde: "13h" }).corteTarde).toBe("13:00");
    expect(ok({ corteTarde: "15.30" }).corteTarde).toBe("15:30");
    expect(error({ corteTarde: "tarde" })).toEqual({ error: "Las horas van como 10:00", campo: "corteTarde" });
  });

  it("gana el primer error, en el orden de los campos", () => {
    expect(error({ corteTarde: "x", zona: "x", horas: [] }).campo).toBe("zona");
    expect(error({ diasVista: 0, horas: [] }).campo).toBe("horas");
    expect(error({ antelacionMinutos: -1, diasAbiertos: [] }).campo).toBe("diasAbiertos");
  });

  it("nunca lanza", () => {
    const trampa = new Proxy({}, { get: () => { throw new Error("x"); } });
    expect(() => revisarReglas(trampa)).not.toThrow();
  });
});

describe("días en texto", () => {
  const casos: [number[], string, string][] = [
    [[1, 2, 3, 4, 5], "de lunes a viernes", "Lunes a viernes"],
    [[6, 1, 2, 3, 4, 5], "de lunes a sábado", "Lunes a sábado"],
    [[2, 3, 4, 5, 6], "de martes a sábado", "Martes a sábado"],
    [[5, 1, 3], "los lunes, miércoles y viernes", "Lunes, miércoles y viernes"],
    [[0, 6], "los sábados y domingos", "Sábado y domingo"],
    [[1], "los lunes", "Lunes"],
    [[0, 1, 2, 3, 4, 5, 6], "todos los días", "Todos los días"],
  ];
  it.each(casos)("%j", (dias, texto, cabecera) => {
    expect(textoDiasAbiertos(dias)).toBe(texto);
    expect(textoDiasCabecera(dias)).toBe(cabecera);
  });
});
